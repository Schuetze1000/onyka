import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ io: vi.fn(), refresh: vi.fn() }))
vi.mock('socket.io-client', () => ({ io: mocks.io }))
vi.mock('../src/services/api', () => ({ handleTokenRefresh: mocks.refresh }))
import { getSharedSocket, resetSocket } from '../src/hooks/useSocket'

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const socket = { on: vi.fn((event, handler) => handlers.set(event, handler)),
    connect: vi.fn(), disconnect: vi.fn() }
  mocks.io.mockReturnValue(socket)
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
  getSharedSocket()
  return { socket, handlers }
}
afterEach(() => { resetSocket(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('Socket recovery', () => {
  it('refreshes expired credentials and reconnects the same socket', async () => {
    const { socket, handlers } = setup()
    mocks.refresh.mockResolvedValue(true)
    await handlers.get('connect_error')?.({ message: 'expired', data: { code: 'AUTH_REQUIRED' } })
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(socket.connect).toHaveBeenCalledOnce()
    expect(mocks.io.mock.calls[0][1].transports).toEqual(['polling', 'websocket'])
  })
  it('does not resurrect a logged-out socket after an in-flight refresh', async () => {
    const { socket, handlers } = setup()
    let complete!: (success: boolean) => void
    mocks.refresh.mockReturnValue(new Promise<boolean>(resolve => { complete = resolve }))
    const pending = handlers.get('connect_error')?.({ message: 'expired', data: { code: 'AUTH_REQUIRED' } })
    resetSocket()
    complete(true)
    await pending
    expect(socket.connect).not.toHaveBeenCalled()
  })
  it('does not retry invalid credentials or refresh a transport error', async () => {
    const { socket, handlers } = setup()
    mocks.refresh.mockResolvedValue(false)
    await handlers.get('connect_error')?.({ message: 'expired', data: { code: 'AUTH_REQUIRED' } })
    await handlers.get('connect_error')?.({ message: 'network' })
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(socket.connect).not.toHaveBeenCalled()
  })
})
