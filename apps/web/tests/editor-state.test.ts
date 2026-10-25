import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
vi.mock('../src/services/api', () => ({ notesApi: { get: api.get }, pagesApi: { update: api.update } }))
import { useNotesStore, resetNoteCache } from '../src/stores/notes'
import { usePagesStore } from '../src/stores/pages'

beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); resetNoteCache() })
afterEach(() => { resetNoteCache(); vi.useRealTimers() })

describe('Editor state safety', () => {
  it('does not restore cached private content after the account data is cleared', async () => {
    api.get.mockResolvedValueOnce({ note: { id: 'note', content: 'old private text' } })
    await useNotesStore.getState().fetchNote('note')
    await vi.advanceTimersByTimeAsync(60)
    expect(useNotesStore.getState().currentNote?.content).toBe('old private text')
    resetNoteCache()
    useNotesStore.setState({ currentNote: null })
    api.get.mockResolvedValueOnce({ note: { id: 'note', content: 'new permitted text' } })
    await useNotesStore.getState().fetchNote('note')
    expect(useNotesStore.getState().currentNote).toBeNull()
    await vi.advanceTimersByTimeAsync(60)
    expect(useNotesStore.getState().currentNote?.content).toBe('new permitted text')
  })
  it('surfaces failed page saves instead of reporting them as saved', async () => {
    usePagesStore.setState({ pagesByNote: { note: [{ id: 'page', content: 'unsaved' } as never] } })
    api.update.mockRejectedValueOnce(new Error('connection lost'))
    await expect(usePagesStore.getState().updatePage('page', { content: 'new text' })).rejects.toThrow('connection lost')
    expect(usePagesStore.getState().pagesByNote.note[0].content).toBe('unsaved')
    await expect(usePagesStore.getState().updatePage('missing', { content: 'text' })).rejects.toThrow()
  })
})
