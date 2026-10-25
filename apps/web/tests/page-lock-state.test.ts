import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotePage } from '@onyka/shared'
const api = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() }))
vi.mock('../src/services/api', () => ({ pagesApi: api }))
import { usePagesStore } from '../src/stores/pages'

const page = { id: 'page', noteId: 'note', content: '<p>Text kept while locking</p>', isLocked: false } as NotePage
beforeEach(() => {
  vi.resetAllMocks()
  usePagesStore.setState({ pagesByNote: { note: [{ ...page }] }, activePageByNote: { note: 'page' }, pageLocks: {}, error: null })
})

describe('Page lock state', () => {
  it('updates the active page immediately without replacing its text', () => {
    const store = usePagesStore.getState()
    store.applyPageLock('note', 'page', true)
    expect(store.getActivePage('note')).toMatchObject({ isLocked: true, content: page.content })
    store.applyPageLock('note', 'page', false)
    expect(store.getActivePage('note')).toMatchObject({ isLocked: false, content: page.content })
  })
  it('does not let an old save response undo a newer lock/unlock sequence', async () => {
    let finish!: (response: { page: NotePage }) => void
    api.update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const saving = usePagesStore.getState().updatePage('page', { content: '<p>New text</p>' })
    usePagesStore.getState().applyPageLock('note', 'page', true)
    usePagesStore.getState().applyPageLock('note', 'page', false)
    finish({ page: { ...page, isLocked: true, content: '<p>New text</p>' } })
    await saving
    expect(usePagesStore.getState().getActivePage('note')).toMatchObject({ isLocked: false, content: '<p>New text</p>' })
  })
  it('preserves notifications arriving before the initial page fetch finishes', async () => {
    usePagesStore.setState({ pagesByNote: {}, activePageByNote: {} })
    let finish!: (response: { pages: NotePage[] }) => void
    api.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const fetching = usePagesStore.getState().fetchPages('note')
    usePagesStore.getState().applyPageLock('note', 'page', true)
    expect(usePagesStore.getState().pagesByNote.note).toBeUndefined()
    finish({ pages: [{ ...page }] })
    await fetching
    expect(usePagesStore.getState().getActivePage('note')?.isLocked).toBe(true)
  })
  it('preserves a newer lock while reconnect metadata is loading', async () => {
    let finish!: (response: { pages: NotePage[] }) => void
    api.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const refreshing = usePagesStore.getState().refetchPages('note')
    usePagesStore.getState().applyPageLock('note', 'page', true)
    finish({ pages: [{ ...page }] })
    await refreshing
    expect(usePagesStore.getState().getActivePage('note')?.isLocked).toBe(true)
  })
  it('does not apply a notification for a different note and clears stored lock state', () => {
    usePagesStore.getState().applyPageLock('other-note', 'page', true)
    expect(usePagesStore.getState().getActivePage('note')?.isLocked).toBe(false)
    usePagesStore.getState().applyPageLock('note', 'page', true)
    usePagesStore.getState().clearNotePages('note')
    expect(usePagesStore.getState().pageLocks).toEqual({})
  })
  it('preserves a lock received before page creation finishes without duplicating a fetched page', async () => {
    const created = { ...page, id: 'new-page' }
    let finish!: (response: { page: NotePage }) => void
    api.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const creating = usePagesStore.getState().createPage('note')
    usePagesStore.setState({ pagesByNote: { note: [{ ...page }, created] } })
    usePagesStore.getState().applyPageLock('note', created.id, true)
    finish({ page: created })
    await creating
    expect(usePagesStore.getState().pagesByNote.note.filter(p => p.id === created.id)).toHaveLength(1)
    expect(usePagesStore.getState().getActivePage('note')?.isLocked).toBe(true)
  })
  it('keeps newer locks on surviving pages while a deletion is in flight', async () => {
    const surviving = { ...page, id: 'other-page' }
    usePagesStore.setState({ pagesByNote: { note: [{ ...page }, surviving] } })
    let finish!: () => void
    api.delete.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const deleting = usePagesStore.getState().deletePage('note', 'page')
    usePagesStore.getState().applyPageLock('note', surviving.id, true)
    finish()
    await deleting
    expect(usePagesStore.getState().getActivePage('note')).toMatchObject({ id: surviving.id, isLocked: true })
  })
})
