import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'

interface DockViewport {
  top: number
  left: number
  width: number
  height: number
  inset: number
}

/** Keep editor tools inside the visible viewport, including above the soft keyboard. */
export function useEditorToolbarDock(editor: Editor, mobile: boolean) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [viewport, setViewport] = useState<DockViewport>({ top: 0, left: 0, width: 0, height: 0, inset: 0 })
  const docked = mobile && editing && viewport.width > 0

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
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const top = (visual?.offsetTop || 0) + (visual?.height || window.innerHeight)
        setViewport({
          top,
          left: visual?.offsetLeft || 0,
          width: visual?.width || window.innerWidth,
          height: visual?.height || window.innerHeight,
          inset: Math.max(0, Math.max(document.documentElement.clientHeight, window.innerHeight) - top),
        })
      })
    }
    measure()
    visual?.addEventListener('resize', measure)
    visual?.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      visual?.removeEventListener('resize', measure)
      visual?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [mobile])

  useEffect(() => {
    if (!docked) return
    const editorRoot = editor.view.dom.closest<HTMLElement>('.fluid-editor')
    return () => { editorRoot?.style.removeProperty('--editor-dock-space') }
  }, [docked, editor])

  useEffect(() => {
    if (!docked) return
    let frame = 0
    const editorRoot = editor.view.dom.closest<HTMLElement>('.fluid-editor')
    const revealCaret = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed || !toolbarRef.current) return
        editorRoot?.style.setProperty('--editor-dock-space', `${viewport.inset + toolbarRef.current.offsetHeight + 18}px`)
        if (!editor.isFocused) return
        const surface = editor.view.dom.closest<HTMLElement>('.editor-writing-surface')
        if (!surface) return
        const caret = editor.view.coordsAtPos(editor.state.selection.head)
        const top = surface.getBoundingClientRect().top + 8
        const bottom = toolbarRef.current.getBoundingClientRect().top - 12
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
  }, [docked, editor, viewport])

  return { toolbarRef, docked, viewport }
}
