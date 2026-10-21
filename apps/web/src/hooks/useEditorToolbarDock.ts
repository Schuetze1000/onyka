import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'

interface DockViewport {
  left: number
  width: number
  height: number
  inset: number
  keyboardOpen: boolean
}

interface KeyboardGeometry extends EventTarget {
  boundingRect: DOMRectReadOnly
}

/** Keep editor tools inside the visible viewport, including above the soft keyboard. */
export function useEditorToolbarDock(editor: Editor, mobile: boolean, enabled = true) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [viewport, setViewport] = useState<DockViewport>({ left: 0, width: 0, height: 0, inset: 0, keyboardOpen: false })
  const docked = mobile && enabled && editing && viewport.width > 0

  useEffect(() => {
    if (!mobile) return
    let frame = 0
    const updateFocus = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return
        // Retain an existing editing session while a toolbar input has focus.
        // Starting a session only from the editor avoids moving focused inputs.
        setEditing((wasEditing) => editor.isFocused || (wasEditing && Boolean(toolbarRef.current?.contains(document.activeElement))))
      })
    }
    editor.on('focus', updateFocus)
    editor.on('blur', updateFocus)
    document.addEventListener('focusin', updateFocus)
    document.addEventListener('focusout', updateFocus)
    updateFocus()
    return () => {
      cancelAnimationFrame(frame)
      editor.off('focus', updateFocus)
      editor.off('blur', updateFocus)
      document.removeEventListener('focusin', updateFocus)
      document.removeEventListener('focusout', updateFocus)
    }
  }, [editor, mobile])

  useEffect(() => {
    if (!mobile) return
    const visual = window.visualViewport
    const keyboard = (navigator as Navigator & { virtualKeyboard?: KeyboardGeometry }).virtualKeyboard
    let restingHeight = document.documentElement.clientHeight
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const layoutHeight = document.documentElement.clientHeight
        const width = visual?.width || window.innerWidth
        const height = visual?.height || window.innerHeight
        const visualBottom = Math.min(layoutHeight, (visual?.offsetTop || 0) + height)
        const keyboardRect = keyboard?.boundingRect
        const hasGeometry = Boolean(keyboardRect && keyboardRect.height > 0 && keyboardRect.width >= width * 0.75)
        const visibleBottom = hasGeometry ? Math.min(visualBottom, keyboardRect!.top) : visualBottom
        const inset = Math.max(0, layoutHeight - visibleBottom)
        restingHeight = Math.max(restingHeight, layoutHeight)
        setViewport({
          left: visual?.offsetLeft || 0,
          width,
          height: Math.min(height, visibleBottom - (visual?.offsetTop || 0)),
          inset,
          keyboardOpen: hasGeometry || inset > 100 || restingHeight - height > 100,
        })
      })
    }
    measure()
    visual?.addEventListener('resize', measure)
    visual?.addEventListener('scroll', measure)
    keyboard?.addEventListener('geometrychange', measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      visual?.removeEventListener('resize', measure)
      visual?.removeEventListener('scroll', measure)
      keyboard?.removeEventListener('geometrychange', measure)
      window.removeEventListener('resize', measure)
    }
  }, [mobile])

  useEffect(() => {
    if (!mobile || !editing) return
    const editorRoot = editor.view.dom.closest<HTMLElement>('.fluid-editor')
    return () => { editorRoot?.style.removeProperty('--editor-dock-space') }
  }, [mobile, editing, editor])

  useEffect(() => {
    if (!mobile || !editing) return
    let frame = 0
    const editorRoot = editor.view.dom.closest<HTMLElement>('.fluid-editor')
    const revealCaret = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return
        const toolbarHeight = docked && toolbarRef.current ? toolbarRef.current.offsetHeight : 0
        editorRoot?.style.setProperty('--editor-dock-space', `${viewport.inset + toolbarHeight + 18}px`)
        if (!editor.isFocused) return
        const surface = editor.view.dom.closest<HTMLElement>('.editor-writing-surface')
        if (!surface) return
        const caret = editor.view.coordsAtPos(editor.state.selection.head)
        const top = surface.getBoundingClientRect().top + 8
        const bottom = (docked && toolbarRef.current
          ? toolbarRef.current.getBoundingClientRect().top
          : document.documentElement.clientHeight - viewport.inset) - 12
        if (bottom <= top) return
        if (caret.bottom > bottom) surface.scrollTop += caret.bottom - bottom
        else if (caret.top < top) surface.scrollTop -= top - caret.top
      })
    }
    const observer = new ResizeObserver(revealCaret)
    if (toolbarRef.current) observer.observe(toolbarRef.current)
    editor.on('selectionUpdate', revealCaret)
    editor.on('update', revealCaret)
    revealCaret()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      editor.off('selectionUpdate', revealCaret)
      editor.off('update', revealCaret)
    }
  }, [docked, mobile, editing, editor, viewport])

  return { toolbarRef, docked, viewport }
}
