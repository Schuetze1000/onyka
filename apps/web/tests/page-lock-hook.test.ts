// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotePage } from '@onyka/shared'
const mocks = vi.hoisted(() => ({ user: { id: 'editor' }, list: vi.fn(), handlers: new Map<string, (data: unknown) => void>(), emit: vi.fn() }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => ({ user: mocks.user }) }))
vi.mock('../src/services/api', () => ({ pagesApi: { list: mocks.list } }))
vi.mock('../src/hooks/useSocket', () => ({ getSharedSocket: () => ({
  id: 'self', connected: true, emit: mocks.emit,
  on: (event: string, handler: (data: unknown) => void) => mocks.handlers.set(event, handler),
  off: (event: string) => mocks.handlers.delete(event),
}) }))
import { useCollaboration } from '../src/hooks/useCollaboration'
import { usePagesStore } from '../src/stores/pages'

let root: Root, container: HTMLDivElement
const page = { id: 'page', noteId: 'note', content: '<p>Unsaved local text</p>', isLocked: false } as NotePage
function Editor() {
  useCollaboration({ noteId: 'note' })
  const active = usePagesStore(state => state.getActivePage('note'))
  return createElement('div', null, active?.isLocked ? 'read-only' : 'editable')
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.handlers.clear(); vi.clearAllMocks()
  mocks.list.mockResolvedValue({ pages: [{ ...page }] })
  usePagesStore.setState({ pagesByNote: { note: [{ ...page }] }, activePageByNote: { note: 'page' }, pageLocks: {} })
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(Editor)))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe('Lock notifications in an open editor', () => {
  it('immediately switches between read-only and editable for another person', async () => {
    await act(async () => mocks.handlers.get('page-lock-changed')?.({ noteId: 'note', pageId: 'page', isLocked: true }))
    expect(container.textContent).toBe('read-only')
    expect(usePagesStore.getState().getActivePage('note')?.content).toBe(page.content)
    await act(async () => mocks.handlers.get('page-lock-changed')?.({ noteId: 'note', pageId: 'page', isLocked: false }))
    expect(container.textContent).toBe('editable')
  })
  it('reloads a missed lock after joining again despite the existing page cache', async () => {
    mocks.list.mockResolvedValueOnce({ pages: [{ ...page, isLocked: true }] })
    await act(async () => mocks.handlers.get('room-joined')?.({ noteId: 'note', users: [] }))
    expect(mocks.list).toHaveBeenCalledWith('note')
    expect(container.textContent).toBe('read-only')
  })
  it('ignores notifications for a note that is no longer open', async () => {
    await act(async () => mocks.handlers.get('page-lock-changed')?.({ noteId: 'other', pageId: 'page', isLocked: true }))
    expect(container.textContent).toBe('editable')
  })
})
