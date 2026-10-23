/** Real-time collaboration hook for live editing, presence, and cursor sync. */

import { useEffect, useRef, useState, useCallback } from 'react'
import type { Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth'
import { getSharedSocket } from './useSocket'

interface UserPresence {
  socketId: string
  id: string
  name: string
  avatarUrl?: string
  cursorPosition?: { from: number; to: number } | null
}

interface ContentUpdate {
  noteId: string
  pageId?: string | null
  content: string
  title: string
  fromUser: {
    id: string
    name: string
  }
}

interface UseCollaborationOptions {
  noteId: string
  enabled?: boolean
  onContentUpdate?: (update: ContentUpdate) => void
  onUsersChange?: (users: UserPresence[]) => void
}

interface UseCollaborationReturn {
  isConnected: boolean
  users: UserPresence[]
  sendContentChange: (content: string, title: string, pageId?: string | null) => void
  sendCursorUpdate: (position: { from: number; to: number } | null) => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debounced = ((...args: any[]) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }) as T & { cancel: () => void }
  debounced.cancel = () => { if (timeoutId) clearTimeout(timeoutId); timeoutId = null }
  return debounced
}

export function useCollaboration({
  noteId,
  enabled = true,
  onContentUpdate,
  onUsersChange,
}: UseCollaborationOptions): UseCollaborationReturn {
  const [isConnected, setIsConnected] = useState(false)
  const [users, setUsers] = useState<UserPresence[]>([])
  const socketRef = useRef<Socket | null>(null)
  const noteIdRef = useRef(noteId)
  const { user } = useAuthStore()

  const onContentUpdateRef = useRef(onContentUpdate)
  const onUsersChangeRef = useRef(onUsersChange)

  useEffect(() => {
    noteIdRef.current = noteId
    onContentUpdateRef.current = onContentUpdate
    onUsersChangeRef.current = onUsersChange
  }, [noteId, onContentUpdate, onUsersChange])

  useEffect(() => {
    setUsers([])
    setIsConnected(false)
    onUsersChangeRef.current?.([])

    if (!enabled || !noteId || !user) return

    const socket = getSharedSocket()
    socketRef.current = socket
    setIsConnected(socket.connected)

    // socket.io queues emits if not yet connected
    socket.emit('join-room', { noteId })

    const handleRoomJoined = (data: { noteId: string; users: UserPresence[] }) => {
      if (data.noteId === noteIdRef.current) {
        const otherUsers = data.users.filter(u => u.socketId !== socket.id)
        setUsers(otherUsers)
        onUsersChangeRef.current?.(otherUsers)
      }
    }

    const handleUserJoined = (userData: UserPresence) => {
      if (userData.socketId === socket.id) return
      setUsers(prev => {
        if (prev.some(u => u.socketId === userData.socketId)) return prev
        const updated = [...prev, userData]
        onUsersChangeRef.current?.(updated)
        return updated
      })
    }

    const handleUserLeft = (data: { socketId: string }) => {
      setUsers(prev => {
        const updated = prev.filter(u => u.socketId !== data.socketId)
        if (updated.length === prev.length) return prev
        onUsersChangeRef.current?.(updated)
        return updated
      })
    }

    const handleContentUpdate = (update: ContentUpdate) => {
      if (update.noteId === noteIdRef.current) {
        onContentUpdateRef.current?.(update)
      }
    }

    const handleCursorMoved = debounce((data: { socketId: string; userId: string; name: string; position: { from: number; to: number } | null }) => {
      if (data.socketId === socket.id) return
      setUsers(prev => {
        const updated = prev.map(u =>
          u.socketId === data.socketId
            ? { ...u, cursorPosition: data.position }
            : u
        )
        onUsersChangeRef.current?.(updated)
        return updated
      })
    }, 50)

    const handleConnect = () => {
      setIsConnected(true)
      socket.emit('join-room', { noteId: noteIdRef.current })
    }
    const handleDisconnect = () => setIsConnected(false)

    socket.on('room-joined', handleRoomJoined)
    socket.on('user-joined', handleUserJoined)
    socket.on('user-left', handleUserLeft)
    socket.on('content-update', handleContentUpdate)
    socket.on('cursor-moved', handleCursorMoved)
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)

    return () => {
      sendContentChangeRef.current.cancel()
      sendCursorUpdateRef.current.cancel()
      handleCursorMoved.cancel()
      socketRef.current = null
      socket.off('room-joined', handleRoomJoined)
      socket.off('user-joined', handleUserJoined)
      socket.off('user-left', handleUserLeft)
      socket.off('content-update', handleContentUpdate)
      socket.off('cursor-moved', handleCursorMoved)
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)

      if (socket.connected) {
        socket.emit('leave-room', { noteId })
      }
    }
  }, [noteId, enabled, user])

  const sendContentChangeRef = useRef(
    debounce((targetNoteId: string, content: string, title: string, pageId: string | null) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('content-change', {
          noteId: targetNoteId,
          pageId,
          content,
          title,
        })
      }
    }, 150)
  )

  const sendContentChange = useCallback((content: string, title: string, pageId: string | null = null) => {
    if (enabled) sendContentChangeRef.current(noteId, content, title, pageId)
  }, [noteId, enabled])

  const sendCursorUpdateRef = useRef(
    debounce((targetNoteId: string, position: { from: number; to: number } | null) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('cursor-update', {
          noteId: targetNoteId,
          position,
        })
      }
    }, 50)
  )

  const sendCursorUpdate = useCallback((position: { from: number; to: number } | null) => {
    if (enabled) sendCursorUpdateRef.current(noteId, position)
  }, [noteId, enabled])

  return {
    isConnected,
    users,
    sendContentChange,
    sendCursorUpdate,
  }
}
