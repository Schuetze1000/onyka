// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoSave } from '../src/hooks/useAutoSave'

let root: Root
let editor: ReturnType<typeof useAutoSave>
let container: HTMLDivElement
const save = vi.fn()
function Editor() { editor = useAutoSave({ onSave: save, delay: 100 }); return null }
beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  save.mockReset()
  await act(async () => { root.render(createElement(Editor)) })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Autosave during slow requests', () => {
  it('does not mark newer edits as saved when an older save completes', async () => {
    let finish!: () => void
    save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })).mockResolvedValue(undefined)
    act(() => editor.triggerSave())
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(editor.status).toBe('saving')
    act(() => editor.triggerSave())
    expect(editor.status).toBe('unsaved')
    await act(async () => finish())
    expect(editor.status).toBe('unsaved')
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(editor.status).toBe('saved')
    expect(save).toHaveBeenCalledTimes(2)
  })
  it('ignores an old failure after leaving the edited page', async () => {
    let fail!: (error: Error) => void
    save.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject }))
    act(() => editor.triggerSave())
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    act(() => editor.cancel())
    await act(async () => fail(new Error('Old page failed')))
    expect(editor.status).toBe('saved')
  })
  it('shows a real save failure and accepts a later retry', async () => {
    save.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    await act(async () => { await editor.saveNow() })
    expect(editor.status).toBe('error')
    await act(async () => { await editor.saveNow() })
    expect(editor.status).toBe('saved')
  })
})
