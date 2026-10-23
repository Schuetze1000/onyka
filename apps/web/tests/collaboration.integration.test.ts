import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { io as connect, type Socket } from 'socket.io-client'
import { setupCollaborationSocket } from '../../server/src/websocket/collaboration'

vi.mock('../../server/src/config/env.js', () => ({ env: { CORS_ORIGIN: 'http://localhost' } }))
vi.mock('../../server/src/middleware/auth.js', () => ({ SYSTEM_USERNAME: 'system' }))
vi.mock('../../server/src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }))
vi.mock('../../server/src/services/settings.service.js', () => ({ settingsService: { isAuthDisabled: async () => false } }))
vi.mock('../../server/src/services/token.service.js', () => ({ tokenService: {
  verifyAccessToken: async (token: string) => {
    await new Promise(resolve => setTimeout(resolve, 20))
    return token === 'expired' ? null : { sub: token }
  },
} }))
vi.mock('../../server/src/repositories/index.js', () => ({
  userRepository: { findById: async (id: string) => ({ id, name: id, isDisabled: false }) },
  shareRepository: { findByResource: async () => [{ id: 'share' }] },
}))
vi.mock('../../server/src/services/sharing.service.js', () => ({ sharingService: {
  getPermissionLevel: async (user: string, note: string) => note === 'private-owner' && user === 'alice' ? 'owner'
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
})
