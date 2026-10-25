import { afterEach, describe, expect, it, vi } from 'vitest'
import { invalidateSessionRequests, notesApi, resetRefreshState } from '../src/services/api'

afterEach(() => { vi.unstubAllGlobals(); resetRefreshState() })

describe('API response and session isolation', () => {
  it('accepts successful deletes without a JSON response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    await expect(notesApi.delete('note')).resolves.toBeUndefined()
  })
  it('rejects old in-flight responses after logout or an account switch', async () => {
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
    const pending = notesApi.get('old-private-note')
    invalidateSessionRequests()
    finish(Response.json({ note: { id: 'old-private-note', content: 'private' } }))
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
  })
  it('recovers when a second tab has just rotated the shared refresh cookie', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json({ note: { id: 'note' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(notesApi.get('note')).resolves.toEqual({ note: { id: 'note' } })
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})
