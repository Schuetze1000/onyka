/** Shared WebSocket connection singleton used by collaboration and notification hooks. */

import { io, Socket } from 'socket.io-client'
import { handleTokenRefresh } from '@/services/api'

let socket: Socket | null = null

/** Returns the shared socket, creating it on first call. */
export function getSharedSocket(): Socket {
  if (socket) return socket

  socket = io(window.location.origin, {
    path: '/socket.io',
    withCredentials: true,
    // Establish a session through ordinary HTTP first; upgrade when the proxy
    // supports WebSockets. This also works behind hosts without an upgrade rule.
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  })

  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket!.id)
  })

  const currentSocket = socket
  socket.on('connect_error', async (error: Error & { data?: { code?: string } }) => {
    console.error('[Socket] Connection error:', error.message)
    if (error.data?.code === 'AUTH_REQUIRED' && await handleTokenRefresh()) {
      if (socket === currentSocket) currentSocket.connect()
    }
  })

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason)
  })

  return socket
}

/** Disconnect and destroy the socket (call on logout). */
export function resetSocket(): void {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
