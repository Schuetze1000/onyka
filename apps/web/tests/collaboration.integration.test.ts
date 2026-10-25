import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { io as connect, type Socket } from 'socket.io-client'
import { setupCollaborationSocket } from '../../server/src/websocket/collaboration'

const revoked = vi.hoisted(() => ({ shares: new Set<string>(), sessions: new Set<string>() }))

vi.mock('../../server/src/config/env.js', () => ({ env: { CORS_ORIGIN: 'http://localhost' } }))
vi.mock('../../server/src/middleware/auth.js', () => ({ SYSTEM_USERNAME: 'system' }))
vi.mock('../../server/src/repositories/page.repository.js', () => ({ pageRepository: {
  findById: async (id: string) => ({ id, noteId: 'private-owner', isLocked: false, isDeleted: false }),
} }))
vi.mock('../../server/src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../server/src/services/settings.service.js', () => ({ settingsService: { isAuthDisabled: async () => false } }))
vi.mock('../../server/src/services/token.service.js', () => ({ tokenService: {
  verifyAccessToken: async (token: string) => {
    await new Promise(resolve => setTimeout(resolve, 20))
    return token === 'expired' || revoked.sessions.has(token) ? null : { sub: token }
  },
} }))
vi.mock('../../server/src/repositories/index.js', () => ({
  noteRepository: { findById: async (id: string) => ({ id, isDeleted: id === 'deleted' }) },
  userRepository: { findById: async (id: string) => ({ id, name: id, isDisabled: false }) },
  shareRepository: { findByResource: async () => [{ id: 'share' }] },
}))
vi.mock('../../server/src/services/sharing.service.js', () => ({ sharingService: {
  getPermissionLevel: async (user: string, note: string) => revoked.shares.has(user) ? null : note === 'private-owner' && user === 'alice' ? 'owner'
    : note !== 'shared' ? null : user === 'reader' ? 'read' : 'edit',
} }))

const http = createServer()
let server: ReturnType<typeof setupCollaborationSocket>
let url: string
const clients: Socket[] = []

function event<T = unknown>(socket: Socket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Missing ${name}`)), 3000)
    socket.once(name, (data: T) => { clearTimeout(timeout); resolve(data) })
  })
}
function client(user: string, transport: 'polling' | 'websocket') {
  const socket = connect(url, { autoConnect: false, transports: [transport], reconnection: false,
    extraHeaders: { Cookie: `access_token=${user}` }, forceNew: true })
  clients.push(socket)
  return socket
}
beforeAll(async () => {
  server = setupCollaborationSocket(http)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  url = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
  clients.forEach(socket => socket.disconnect())
  await new Promise<void>(resolve => server.close(() => resolve()))
})

describe('Two-client collaboration connection', () => {
  it('syncs two sessions of the same user on a private note and preserves the page ID', async () => {
    const first = client('alice', 'polling')
    const second = client('alice', 'websocket')
    for (const socket of [first, second]) {
      socket.on('connect', () => socket.emit('join-room', { noteId: 'private-owner' }))
      const joined = event(socket, 'room-joined')
      socket.connect()
      await joined
    }
    const update = event<{ content: string; pageId: string; fromUser: { id: string } }>(second, 'content-update')
    first.emit('content-change', { noteId: 'private-owner', pageId: 'page-2', title: 'Own note', content: '<p>Other device</p>' })
    expect(await update).toMatchObject({ content: '<p>Other device</p>', pageId: 'page-2', fromUser: { id: 'alice' } })
    const reverse = event<{ title: string }>(first, 'content-update')
    second.emit('content-change', { noteId: 'private-owner', title: 'Renamed on phone', content: '<p>Updated</p>' })
    expect((await reverse).title).toBe('Renamed on phone')
    first.disconnect(); second.disconnect()
  })
  it('joins immediately after delayed authentication, across polling and WebSocket clients', async () => {
    const first = client('alice', 'polling')
    const second = client('bob', 'websocket')
    first.on('connect', () => first.emit('join-room', { noteId: 'shared' }))
    second.on('connect', () => second.emit('join-room', { noteId: 'shared' }))
    const firstJoined = event(first, 'room-joined')
    first.connect()
    await firstJoined
    const presence = event<{ name: string }>(first, 'user-joined')
    const secondJoined = event<{ users: unknown[] }>(second, 'room-joined')
    second.connect()
    expect((await secondJoined).users).toHaveLength(2)
    expect((await presence).name).toBe('bob')
    const update = event<{ content: string }>(first, 'content-update')
    second.emit('content-change', { noteId: 'shared', title: 'Title', content: '<p>Hello</p>' })
    expect((await update).content).toBe('<p>Hello</p>')
    const rejoined = event<{ users: unknown[] }>(second, 'room-joined')
    second.disconnect().connect()
    expect((await rejoined).users).toHaveLength(2)
    first.disconnect()
    second.disconnect()
  })
  it('rejects expired credentials before a session is acknowledged', async () => {
    const socket = client('expired', 'polling')
    const error = event<{ data: { code: string } }>(socket, 'connect_error')
    socket.connect()
    expect((await error).data.code).toBe('AUTH_REQUIRED')
    expect(socket.connected).toBe(false)
  })
  it('denies access to an unrelated note', async () => {
    const socket = client('alice', 'polling')
    const connected = event(socket, 'connect')
    socket.connect()
    await connected
    const denied = event<{ message: string }>(socket, 'error')
    socket.emit('join-room', { noteId: 'private' })
    expect((await denied).message).toBe('Access denied')
    socket.disconnect()
  })
  it('removes a revoked recipient before sending further note content', async () => {
    const writer = client('alice', 'polling'), reader = client('revocable', 'websocket')
    for (const socket of [writer, reader]) {
      socket.on('connect', () => socket.emit('join-room', { noteId: 'shared' }))
      const joined = event(socket, 'room-joined'); socket.connect(); await joined
    }
    const updates = vi.fn(); reader.on('content-update', updates)
    revoked.shares.add('revocable')
    const removed = event(reader, 'access-revoked')
    writer.emit('content-change', { noteId: 'shared', title: 'Secret', content: 'After revocation' })
    await removed
    expect(updates).not.toHaveBeenCalled()
    writer.disconnect(); reader.disconnect()
  })
  it('disconnects a revoked session even when it only receives updates', async () => {
    const writer = client('alice', 'polling'), reader = client('inactive-session', 'websocket')
    for (const socket of [writer, reader]) {
      socket.on('connect', () => socket.emit('join-room', { noteId: 'shared' }))
      const joined = event(socket, 'room-joined'); socket.connect(); await joined
    }
    const updates = vi.fn(); reader.on('content-update', updates)
    revoked.sessions.add('inactive-session')
    const rejected = event(reader, 'auth-error')
    writer.emit('content-change', { noteId: 'shared', title: 'Secret', content: 'After logout' })
    await rejected
    expect(updates).not.toHaveBeenCalled()
    writer.disconnect(); reader.disconnect()
  })
  it('rejects malformed messages without breaking the connection or later joins', async () => {
    const socket = client('alice', 'polling')
    const connected = event(socket, 'connect'); socket.connect(); await connected
    const rejected = event(socket, 'error'); socket.emit('join-room', null); await rejected
    const joined = event(socket, 'room-joined'); socket.emit('join-room', { noteId: 'shared' }); await joined
    expect(socket.connected).toBe(true)
    socket.disconnect()
  })
  it('rejects WebSocket handshakes from an untrusted browser origin', async () => {
    const socket = connect(url, { autoConnect: false, transports: ['websocket'], reconnection: false,
      extraHeaders: { Cookie: 'access_token=alice', Origin: 'https://evil.example' }, forceNew: true })
    clients.push(socket)
    const rejected = event(socket, 'connect_error'); socket.connect(); await rejected
    expect(socket.connected).toBe(false)
  })

  it('lets readers send cursors but prevents them from publishing content', async () => {
    const writer = client('alice', 'polling'), reader = client('reader', 'websocket')
    for (const socket of [writer, reader]) {
      socket.on('connect', () => socket.emit('join-room', { noteId: 'shared' }))
      const joined = event(socket, 'room-joined'); socket.connect(); await joined
    }
    const updates = vi.fn(); writer.on('content-update', updates)
    const cursor = event(writer, 'cursor-moved')
    reader.emit('content-change', { noteId: 'shared', title: 'Spoofed', content: 'Unauthorized change' })
    reader.emit('cursor-update', { noteId: 'shared', position: { from: 0, to: 0 } })
    await cursor
    expect(updates).not.toHaveBeenCalled()
    writer.disconnect(); reader.disconnect()
  })

})
