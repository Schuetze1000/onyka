import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { io as connect, type Socket } from 'socket.io-client'

vi.mock('../../server/src/db/index.js', async () => {
  const { createTestDb } = await import('../../server/src/__tests__/helpers/test-db.js')
  const schema = await import('../../server/src/db/schema.js')
  const { db, sqlite } = createTestDb()
  return { db, schema, rawDb: sqlite }
})
vi.mock('../../server/src/config/env.js', () => ({ env: {
  JWT_SECRET: 'page-lock-test-secret-'.repeat(3), JWT_ACCESS_EXPIRY: '15m', JWT_REFRESH_EXPIRY_DAYS: 30,
  CORS_ORIGIN: 'http://localhost', NODE_ENV: 'test',
} }))
vi.mock('../../server/src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import pagesRouter from '../../server/src/routes/pages.routes'
import { setupCollaborationSocket } from '../../server/src/websocket/collaboration'
import { db, schema, rawDb } from '../../server/src/db/index.js'
import { tokenService } from '../../server/src/services/token.service'
import { noteUploadRepository } from '../../server/src/repositories/note-upload.repository'

const express = createRequire(new URL('../../server/package.json', import.meta.url))('express')
const app = express()
app.use(express.json())
app.use('/pages', pagesRouter)
app.use((error: Error & { statusCode?: number; code?: string }, _req: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } }, _next: unknown) => {
  res.status(error.statusCode ?? 500).json({ error: { code: error.code, message: error.message } })
})
const http = createServer(app)
let server: ReturnType<typeof setupCollaborationSocket>
let url: string
const clients: Socket[] = []
let tokens: Record<string, string>

function event<T = unknown>(socket: Socket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off(name, handler); reject(new Error(`Missing ${name}`)) }, 3000)
    const handler = (data: T) => { clearTimeout(timeout); resolve(data) }
    socket.once(name, handler)
  })
}
async function join(user: string, transport: 'polling' | 'websocket' = 'websocket') {
  const socket = connect(url, { autoConnect: false, transports: [transport], reconnection: false,
    extraHeaders: { Cookie: `access_token=${tokens[user]}` }, forceNew: true })
  clients.push(socket)
  socket.on('connect', () => socket.emit('join-room', { noteId: 'note' }))
  const joined = event(socket, 'room-joined'); socket.connect(); await joined
  return socket
}
const patch = (user: string, body: object) => fetch(`${url}/pages/page`, {
  method: 'PATCH', headers: { Authorization: `Bearer ${tokens[user]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

beforeAll(async () => {
  server = setupCollaborationSocket(http)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  url = `http://127.0.0.1:${address.port}`
})
beforeEach(async () => {
  for (const table of ['note_pages', 'shares', 'notes', 'refresh_tokens', 'users']) rawDb.prepare(`DELETE FROM ${table}`).run()
  const now = new Date()
  for (const id of ['owner', 'editor', 'reader', 'outsider']) db.insert(schema.users).values({
    id, username: id, name: id, passwordHash: 'unused', trackingEnabled: false, createdAt: now, updatedAt: now,
  }).run()
  db.insert(schema.notes).values({ id: 'note', title: 'Shared', ownerId: 'owner', createdAt: now, updatedAt: now }).run()
  db.insert(schema.notePages).values({ id: 'page', noteId: 'note', content: '<p>Saved text</p>', createdAt: now, updatedAt: now }).run()
  for (const [user, permission] of [['editor', 'edit'], ['reader', 'read']] as const) db.insert(schema.shares).values({
    id: user, resourceId: 'note', resourceType: 'note', ownerId: 'owner', sharedWithId: user, permission, createdAt: now,
  }).run()
  tokens = {}
  for (const user of ['owner', 'editor', 'reader', 'outsider']) tokens[user] = (await tokenService.generateTokenPair(user, user)).accessToken
})
afterEach(() => { clients.splice(0).forEach(socket => socket.disconnect()); vi.restoreAllMocks() })
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); rawDb.close() })

describe('Persisted page lock synchronization across people', () => {
  it('broadcasts locking and unlocking from HTTP to owners, editors and readers', async () => {
    const owner = await join('owner'), editor = await join('editor'), reader = await join('reader', 'polling')
    const locked = [owner, editor, reader].map(socket => event(socket, 'page-lock-changed'))
    expect((await patch('owner', { isLocked: true })).status).toBe(200)
    for (const update of await Promise.all(locked)) expect(update).toEqual({ noteId: 'note', pageId: 'page', isLocked: true })
    const unlocked = [owner, editor, reader].map(socket => event(socket, 'page-lock-changed'))
    expect((await patch('editor', { isLocked: false })).status).toBe(200)
    for (const update of await Promise.all(unlocked)) expect(update).toEqual({ noteId: 'note', pageId: 'page', isLocked: false })
  })
  it('does not let readers or unrelated accounts change the lock', async () => {
    const owner = await join('owner')
    const updates = vi.fn(); owner.on('page-lock-changed', updates)
    for (const user of ['reader', 'outsider']) expect((await patch(user, { isLocked: true })).status).toBe(403)
    expect(rawDb.prepare('SELECT is_locked FROM note_pages').get()).toEqual({ is_locked: 0 })
    expect(updates).not.toHaveBeenCalled()
  })
  it('makes missed locks available after reconnect and resumes live unlock events', async () => {
    const reader = await join('reader', 'polling')
    reader.disconnect()
    expect((await patch('owner', { isLocked: true })).status).toBe(200)
    const joined = event(reader, 'room-joined'); reader.connect(); await joined
    const response = await fetch(`${url}/pages/note/note`, { headers: { Authorization: `Bearer ${tokens.reader}` } })
    expect((await response.json()).pages[0].isLocked).toBe(true)
    const unlocked = event(reader, 'page-lock-changed')
    expect((await patch('owner', { isLocked: false })).status).toBe(200)
    expect(await unlocked).toMatchObject({ isLocked: false })
  })
  it('blocks persisted and live content updates while locked', async () => {
    const owner = await join('owner'), editor = await join('editor')
    expect((await patch('owner', { isLocked: true })).status).toBe(200)
    expect((await patch('editor', { content: '<p>Must not save</p>' })).status).toBe(423)
    const updates = vi.fn(); owner.on('content-update', updates)
    const cursor = event(owner, 'cursor-moved')
    editor.emit('content-change', { noteId: 'note', pageId: 'page', title: 'Shared', content: '<p>Must not broadcast</p>' })
    editor.emit('cursor-update', { noteId: 'note', position: { from: 0, to: 0 } })
    await cursor
    expect(updates).not.toHaveBeenCalled()
    expect(rawDb.prepare('SELECT content FROM note_pages').get()).toEqual({ content: '<p>Saved text</p>' })
  })
  it('rejects an in-flight save if the page is locked before its database write', async () => {
    let release!: (allowed: boolean) => void, validationStarted!: () => void
    const started = new Promise<void>(resolve => { validationStarted = resolve })
    vi.spyOn(noteUploadRepository, 'canReferenceUploads').mockImplementationOnce(() => {
      validationStarted()
      return new Promise<boolean>(resolve => { release = resolve })
    })
    const saving = patch('editor', { content: '<p>Racing save</p>' })
    await started
    try { expect((await patch('owner', { isLocked: true })).status).toBe(200) } finally { release(true) }
    const response = await saving
    expect(response.status).toBe(423)
    expect(await response.json()).toMatchObject({ error: { code: 'PAGE_LOCKED' } })
    expect(rawDb.prepare('SELECT content FROM note_pages').get()).toEqual({ content: '<p>Saved text</p>' })
  })
  it('never broadcasts lock metadata to someone whose share was revoked', async () => {
    const reader = await join('reader')
    const updates = vi.fn(); reader.on('page-lock-changed', updates)
    rawDb.prepare('DELETE FROM shares WHERE id=?').run('reader')
    const removed = event(reader, 'access-revoked')
    expect((await patch('owner', { isLocked: true })).status).toBe(200)
    await removed
    expect(updates).not.toHaveBeenCalled()
  })
})
