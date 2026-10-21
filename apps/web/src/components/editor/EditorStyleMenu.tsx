import { useEffect, useId, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { IoCheckmarkOutline, IoChevronDownOutline } from 'react-icons/io5'

interface EditorStyleMenuProps {
  editor: Editor
  value: string
  compact: boolean
  toolsOpen: boolean
  onOpen: () => void
}

export function EditorStyleMenu({ editor, value, compact, toolsOpen, onOpen }: EditorStyleMenuProps) {
  const { t } = useTranslation()
  const id = useId()
  const reducedMotion = useReducedMotion()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pointerInteraction = useRef(false)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const options = ['text', '1', '2', '3']
  const selected = Math.max(0, options.indexOf(value))
  const label = (option: string) => t(option === 'text' ? 'editor.text' : `editor.heading${option}`)

  useEffect(() => {
    if (toolsOpen) setOpen(false)
  }, [toolsOpen])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  const choose = (option: string) => {
    if (option === 'text') editor.chain().focus().setParagraph().run()
    else editor.chain().focus().setHeading({ level: Number(option) as 1 | 2 | 3 }).run()
    setOpen(false)
  }

  const openFromKeyboard = (index: number) => {
    onOpen()
    setOpen(true)
    requestAnimationFrame(() => itemRefs.current[index]?.focus())
  }

  return (
    <div ref={rootRef} className="editor-format-style">
      <button ref={triggerRef} type="button" className="editor-style-trigger"
        aria-label={`${t('editor.toolbar.text_style')}: ${label(value)}`}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onPointerDown={(event) => { pointerInteraction.current = true; event.preventDefault() }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          if (event.detail === 0 && !pointerInteraction.current && !open) openFromKeyboard(selected)
          else { if (!open) onOpen(); setOpen(!open) }
          pointerInteraction.current = false
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openFromKeyboard(event.key === 'ArrowUp' ? options.length - 1 : selected)
          }
        }}
      >
        <span>{compact && value !== 'text' ? t('editor.toolbar.heading_short') : label(value)}</span>
        <IoChevronDownOutline className={open ? 'rotate-180' : ''} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div id={id} role="menu" aria-label={t('editor.toolbar.text_style')}
            className="editor-style-menu floating-panel"
            initial={{ opacity: 0, y: compact ? 5 : -5, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: reducedMotion ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
            onKeyDown={(event) => {
              const index = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
                itemRefs.current[next]?.focus()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setOpen(false)
                triggerRef.current?.focus()
              } else if (event.key === 'Tab') setOpen(false)
            }}
          >
            {options.map((option, index) => (
              <button key={option} ref={(element) => { itemRefs.current[index] = element }}
                type="button" role="menuitemradio" aria-checked={value === option} tabIndex={-1}
                onPointerDown={(event) => event.preventDefault()}
                onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}
                className="editor-style-option" data-active={value === option || undefined}
              >
                <span className="editor-style-preview" data-level={option}>{label(option)}</span>
                {value === option && <IoCheckmarkOutline aria-hidden="true" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
