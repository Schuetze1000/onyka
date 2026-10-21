import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEditorState, type Editor } from '@tiptap/react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  IoArrowUndoOutline, IoArrowRedoOutline, IoChevronDownOutline, IoChevronUpOutline,
  IoOptionsOutline, IoListOutline, IoCheckboxOutline, IoChatbubbleOutline,
  IoCodeOutline, IoLinkOutline, IoImageOutline, IoGridOutline,
  IoRemoveOutline, IoCloseOutline, IoTextOutline, IoAddOutline,
} from 'react-icons/io5'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useEditorToolbarDock } from '@/hooks/useEditorToolbarDock'
import { useEditorToolbarStore } from '@/stores/editorToolbar'
import { EditorStyleMenu } from './EditorStyleMenu'
import {
  COLORS, HIGHLIGHT_COLORS, AlignLeftIcon, AlignCenterIcon, AlignRightIcon, ColumnsIcon,
} from './editorConstants'

interface EditorToolbarProps {
  editor: Editor
  onInsertImage: () => void
  isUploadingImage: boolean
}

interface ToolButtonProps {
  label: string
  children: ReactNode
  onClick: () => void
  active?: boolean
  disabled?: boolean
  compact?: boolean
  className?: string
}

// HTML parsing may return rgb() even when a swatch was saved as hex.
function normalizeColor(color?: string): string | null {
  if (!color) return null
  const rgb = color.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/)
  return rgb
    ? `#${rgb.slice(1).map((value) => Number(value).toString(16).padStart(2, '0')).join('')}`
    : color.toLowerCase()
}

function ToolButton({ label, children, onClick, active, disabled, compact, className = '' }: ToolButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`editor-format-button ${compact ? 'editor-format-button-icon' : ''} ${className}`}
      data-active={active || undefined}
    >
      <span className="editor-format-icon" aria-hidden="true">{children}</span>
      {!compact && <span>{label}</span>}
    </button>
  )
}

export function EditorToolbar({ editor, onInsertImage, isUploadingImage }: EditorToolbarProps) {
  const { t } = useTranslation()
  const panelId = useId()
  const urlId = useId()
  const reducedMotion = useReducedMotion()
  const mobile = useIsMobile()
  const collapsed = useEditorToolbarStore((state) => state.collapsed[mobile ? 'mobile' : 'desktop'])
  const setCollapsed = useEditorToolbarStore((state) => state.setCollapsed)
  const { toolbarRef, docked, viewport } = useEditorToolbarDock(editor, mobile, !collapsed)
  const [expanded, setExpanded] = useState(false)
  const [mobileTab, setMobileTab] = useState<'format' | 'insert'>('insert')
  const [showLink, setShowLink] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')
  const [linkError, setLinkError] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const linkButtonRef = useRef<HTMLDivElement>(null)

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      codeBlock: current.isActive('codeBlock'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      taskList: current.isActive('taskList'),
      blockquote: current.isActive('blockquote'),
      link: current.isActive('link'),
      heading: current.isActive('heading') ? String(current.getAttributes('heading').level) : 'text',
      align: current.getAttributes('paragraph').textAlign || current.getAttributes('heading').textAlign || 'left',
      color: normalizeColor(current.getAttributes('textStyle').color),
      highlight: normalizeColor(current.getAttributes('highlight').color),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
      canTable: current.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
      canColumns: current.can().setColumns(),
      canIndent: current.can().sinkListItem(current.isActive('taskList') ? 'taskItem' : 'listItem'),
      canOutdent: current.can().liftListItem(current.isActive('taskList') ? 'taskItem' : 'listItem'),
    }),
  })

  const openLink = () => {
    setLinkUrl(editor.getAttributes('link').href || '')
    setLinkText('')
    setLinkError(false)
    setShowLink(true)
  }

  const closeLink = () => {
    setShowLink(false)
    if (mobile) editor.commands.focus()
    else linkButtonRef.current?.querySelector('button')?.focus()
  }

  const saveLink = () => {
    let href = linkUrl.trim()
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      setShowLink(false)
      if (mobile) setExpanded(false)
      return
    }
    if (!/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('/')) href = `https://${href}`
    let valid = /^(https?:\/\/|mailto:.+|tel:.+|\/)/i.test(href) && !/\s/.test(href)
    if (/^https?:/i.test(href)) {
      try { valid = valid && Boolean(new URL(href).hostname) }
      catch { valid = false }
    }
    if (!valid) {
      setLinkError(true)
      return
    }
    const chain = editor.chain().focus()
    const applied = editor.state.selection.empty && !editor.isActive('link')
      ? chain.insertContent({ type: 'text', text: linkText.trim() || href, marks: [{ type: 'link', attrs: { href } }] }).run()
      : chain.extendMarkRange('link').setLink({ href }).run()
    if (applied) { setShowLink(false); if (mobile) setExpanded(false) }
    else setLinkError(true)
  }

  const insert = (action: () => void) => {
    action()
    if (mobile) setExpanded(false)
  }

  const toggleCollapsed = () => {
    setCollapsed(mobile ? 'mobile' : 'desktop', !collapsed)
    setExpanded(false)
    setShowLink(false)
    if (docked) editor.commands.focus()
    else if (!mobile && !editor.isFocused) requestAnimationFrame(() => toolbarRef.current?.querySelector<HTMLButtonElement>('[data-toolbar-toggle]')?.focus())
  }

  const toolbar = (
    <div ref={toolbarRef} className={`editor-format-toolbar${docked ? ' editor-format-docked' : ''}${collapsed ? ' editor-format-collapsed' : ''}`}
      data-mobile={mobile || undefined}
      style={docked ? {
        bottom: viewport.inset,
        left: viewport.left + 6,
        width: viewport.width - 12,
        paddingBottom: viewport.keyboardOpen ? 0 : 'env(safe-area-inset-bottom, 0px)',
        '--editor-tools-max-height': `${Math.max(96, Math.min(360, viewport.height * 0.55))}px`,
        '--editor-style-max-height': `${Math.max(96, viewport.height - 80)}px`,
      } as CSSProperties : undefined}
      role="region" aria-label={t('editor.toolbar.title')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        if (showLink) closeLink()
        else { setExpanded(false); moreRef.current?.focus() }
      }}
    >
      {collapsed ? (
        <button type="button" className="editor-format-restore editor-format-button"
          data-toolbar-toggle aria-expanded="false" aria-label={t('editor.toolbar.show')}
          onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()}
          onClick={toggleCollapsed}>
          <IoOptionsOutline aria-hidden="true" /><span>{t('editor.toolbar.show')}</span>
        </button>
      ) : (
      <>
      <div className="editor-format-primary" role="group" aria-label={t('editor.toolbar.text_format')}>
        <EditorStyleMenu editor={editor} value={state.heading} compact={mobile}
          toolsOpen={expanded} onOpen={() => setExpanded(false)} />
        <ToolButton compact label={t('editor.bold')} active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></ToolButton>
        <ToolButton compact className="editor-format-quick-italic" label={t('editor.italic')} active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></ToolButton>
        {mobile
          ? <ToolButton compact className="editor-format-quick-list" label={t('editor.bullet_list')} active={state.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}><IoListOutline /></ToolButton>
          : <ToolButton compact label={t('editor.underline')} active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></ToolButton>}
        <div className="editor-format-desktop">
          <span className="editor-format-divider" />
          <ToolButton compact label={t('editor.bullet_list')} active={state.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}><IoListOutline /></ToolButton>
          <ToolButton compact label={t('editor.todo_list')} active={state.taskList} onClick={() => editor.chain().focus().toggleTaskList().run()}><IoCheckboxOutline /></ToolButton>
          <span className="editor-format-divider" />
          <ToolButton compact label={t('editor.toolbar.undo')} disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}><IoArrowUndoOutline /></ToolButton>
          <ToolButton compact label={t('editor.toolbar.redo')} disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}><IoArrowRedoOutline /></ToolButton>
        </div>
        {mobile && <ToolButton compact className="editor-format-quick-undo" label={t('editor.toolbar.undo')}
          disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}><IoArrowUndoOutline /></ToolButton>}
        <button
          ref={moreRef} type="button" className="editor-format-more editor-format-button"
          title={t('editor.toolbar.more')} aria-label={t(mobile ? 'editor.toolbar.insert' : 'editor.toolbar.more')}
          aria-expanded={expanded} aria-controls={panelId} data-active={expanded || undefined}
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { setExpanded(!expanded); setShowLink(false); setMobileTab('insert') }}
        >
          {mobile ? <IoAddOutline aria-hidden="true" /> : <IoOptionsOutline aria-hidden="true" />}
          <span>{t(mobile ? 'editor.toolbar.insert' : 'editor.toolbar.tools')}</span>
          {!mobile && <IoChevronDownOutline className={expanded ? 'rotate-180' : ''} aria-hidden="true" />}
        </button>
        <button type="button" className="editor-format-button editor-format-button-icon editor-format-collapse"
          data-toolbar-toggle aria-expanded="true" aria-label={t('editor.toolbar.hide')} title={t('editor.toolbar.hide')}
          onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()}
          onClick={toggleCollapsed}>
          {docked ? <IoChevronDownOutline aria-hidden="true" /> : <IoChevronUpOutline aria-hidden="true" />}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={panelId} key="tools" className="editor-format-expanded"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {mobile && (
              <div className="editor-format-sheet-header">
                <div role="tablist" aria-label={t('editor.toolbar.title')}>
                  {(['format', 'insert'] as const).map((tab) => (
                    <button key={tab} type="button" role="tab" id={`${panelId}-${tab}-tab`}
                      aria-selected={mobileTab === tab} aria-controls={`${panelId}-${tab}-panel`}
                      tabIndex={mobileTab === tab ? 0 : -1}
                      onPointerDown={(event) => event.preventDefault()}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => { setMobileTab(tab); setShowLink(false) }}
                      onKeyDown={(event) => {
                        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                        event.preventDefault()
                        const next = event.key === 'Home' ? 'format' : event.key === 'End' ? 'insert' : tab === 'format' ? 'insert' : 'format'
                        setMobileTab(next)
                        setShowLink(false)
                        document.getElementById(`${panelId}-${next}-tab`)?.focus()
                      }}
                    >{t(tab === 'format' ? 'editor.toolbar.format' : 'editor.toolbar.insert')}</button>
                  ))}
                </div>
                <button type="button" className="editor-format-button editor-format-button-icon"
                  aria-label={t('common.close')} onPointerDown={(event) => event.preventDefault()}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => { setExpanded(false); setShowLink(false); editor.commands.focus() }}
                ><IoCloseOutline aria-hidden="true" /></button>
              </div>
            )}
            {showLink && (
              <form className="editor-format-link animate-in" onSubmit={(event) => { event.preventDefault(); saveLink() }}>
                <label htmlFor={urlId}>{t('editor.toolbar.link_url')}</label>
                <div className="flex gap-2">
                  <input id={urlId} type="text" inputMode="url" autoFocus value={linkUrl}
                    placeholder="https://…" aria-invalid={linkError} aria-describedby={linkError ? `${urlId}-error` : undefined}
                    onChange={(event) => { setLinkUrl(event.target.value); setLinkError(false) }} />
                  <button type="button" className="editor-format-button editor-format-button-icon" aria-label={t('common.close')} onClick={closeLink}><IoCloseOutline /></button>
                </div>
                {linkError && <p id={`${urlId}-error`} role="alert" className="text-[var(--color-error)]">{t('editor.toolbar.invalid_link')}</p>}
                {editor.state.selection.empty && !state.link && (
                  <input type="text" aria-label={t('editor.toolbar.link_text')} placeholder={t('editor.toolbar.link_text')} value={linkText} onChange={(event) => setLinkText(event.target.value)} />
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className="editor-format-link-save">{t('common.save')}</button>
                  {state.link && <button type="button" className="editor-format-button" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setShowLink(false) }}>{t('editor.toolbar.remove_link')}</button>}
                </div>
              </form>
            )}
            <div className="editor-format-tools" data-tab={mobile ? mobileTab : undefined}>
              <div className="editor-format-section-group" data-section="format"
                id={`${panelId}-format-panel`} role={mobile ? 'tabpanel' : undefined}
                aria-labelledby={mobile ? `${panelId}-format-tab` : undefined}
                hidden={mobile && mobileTab !== 'format'}>
              <fieldset>
                <legend>{t('editor.toolbar.text_format')}</legend>
                <div className="editor-format-grid">
                  {mobile && <ToolButton label={t('editor.bold')} active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></ToolButton>}
                  {mobile && <ToolButton label={t('editor.italic')} active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></ToolButton>}
                  {mobile && <ToolButton label={t('editor.underline')} active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></ToolButton>}
                  <ToolButton label={t('editor.strikethrough')} active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></ToolButton>
                  <ToolButton label={t('editor.code')} active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}><IoCodeOutline /></ToolButton>
                  <ToolButton label={t('editor.toolbar.clear')} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><IoTextOutline /></ToolButton>
                  <ToolButton label={t('editor.toolbar.undo')} disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}><IoArrowUndoOutline /></ToolButton>
                  <ToolButton label={t('editor.toolbar.redo')} disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}><IoArrowRedoOutline /></ToolButton>
                </div>
              </fieldset>
              <fieldset>
                <legend>{t('editor.toolbar.structure')}</legend>
                <div className="editor-format-grid">
                  <ToolButton label={t('editor.bullet_list')} active={state.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}><IoListOutline /></ToolButton>
                  <ToolButton label={t('editor.numbered_list')} active={state.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolButton>
                  <ToolButton label={t('editor.todo_list')} active={state.taskList} onClick={() => editor.chain().focus().toggleTaskList().run()}><IoCheckboxOutline /></ToolButton>
                  <ToolButton label={t('editor.quote')} active={state.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}><IoChatbubbleOutline /></ToolButton>
                  <ToolButton label={t('editor.toolbar.indent')} disabled={!state.canIndent} onClick={() => editor.chain().focus().sinkListItem(state.taskList ? 'taskItem' : 'listItem').run()}><span>→</span></ToolButton>
                  <ToolButton label={t('editor.toolbar.outdent')} disabled={!state.canOutdent} onClick={() => editor.chain().focus().liftListItem(state.taskList ? 'taskItem' : 'listItem').run()}><span>←</span></ToolButton>
                </div>
              </fieldset>
              <fieldset>
                <legend>{t('editor.toolbar.alignment')}</legend>
                <div className="flex flex-wrap gap-1">
                  {([{ value: 'left', icon: AlignLeftIcon }, { value: 'center', icon: AlignCenterIcon }, { value: 'right', icon: AlignRightIcon }] as const).map(({ value, icon: Icon }) => (
                    <ToolButton compact key={value} label={t(`editor.align_${value}`)} active={state.align === value} onClick={() => editor.chain().focus().setTextAlign(value).run()}><Icon /></ToolButton>
                  ))}
                </div>
                <p className="editor-format-color-label">{t('editor.text_color')}</p>
                <div className="editor-format-swatches">
                  {COLORS.map((color) => (
                    <button key={color.name} type="button" className="editor-format-swatch"
                      title={t(`editor.toolbar.colors.${color.name.toLowerCase()}`)}
                      aria-label={`${t('editor.text_color')}: ${t(`editor.toolbar.colors.${color.name.toLowerCase()}`)}`}
                      aria-pressed={state.color === color.value}
                      onPointerDown={(event) => event.preventDefault()}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => color.value ? editor.chain().focus().setColor(color.value).run() : editor.chain().focus().unsetColor().run()}
                    ><span style={{ background: color.value || 'var(--color-text-primary)' }} /></button>
                  ))}
                </div>
                <p className="editor-format-color-label">{t('editor.highlight')}</p>
                <div className="editor-format-swatches">
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button key={color.name} type="button" className="editor-format-swatch"
                      title={t(`editor.toolbar.colors.${color.name.toLowerCase()}`)}
                      aria-label={`${t('editor.highlight')}: ${t(`editor.toolbar.colors.${color.name.toLowerCase()}`)}`}
                      aria-pressed={state.highlight === color.value}
                      onPointerDown={(event) => event.preventDefault()}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => color.value ? editor.chain().focus().setHighlight({ color: color.value }).run() : editor.chain().focus().unsetHighlight().run()}
                    ><span style={{ background: color.value || 'var(--color-bg-tertiary)' }}>{!color.value && <IoCloseOutline />}</span></button>
                  ))}
                </div>
              </fieldset>
              </div>
              <div className="editor-format-section-group" data-section="insert"
                id={`${panelId}-insert-panel`} role={mobile ? 'tabpanel' : undefined}
                aria-labelledby={mobile ? `${panelId}-insert-tab` : undefined}
                hidden={mobile && mobileTab !== 'insert'}>
              <fieldset>
                <legend>{t('editor.toolbar.insert')}</legend>
                <div className="editor-format-grid">
                  <div ref={linkButtonRef}><ToolButton label={t('editor.add_link')} active={state.link} onClick={openLink}><IoLinkOutline /></ToolButton></div>
                  <ToolButton label={t('editor.image')} disabled={isUploadingImage} onClick={() => insert(onInsertImage)}><IoImageOutline /></ToolButton>
                  <ToolButton label={t('editor.table')} disabled={!state.canTable} onClick={() => insert(() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() })}><IoGridOutline /></ToolButton>
                  <ToolButton label={t('editor.columns')} disabled={!state.canColumns} onClick={() => insert(() => { editor.chain().focus().setColumns().run() })}><ColumnsIcon /></ToolButton>
                  <ToolButton label={t('editor.code_block')} active={state.codeBlock} onClick={() => insert(() => { editor.chain().focus().toggleCodeBlock().run() })}><IoCodeOutline /></ToolButton>
                  <ToolButton label={t('editor.divider')} onClick={() => insert(() => { editor.chain().focus().setHorizontalRule().run() })}><IoRemoveOutline /></ToolButton>
                </div>
              </fieldset>
              </div>
            </div>

          </motion.div>
        )}
      </AnimatePresence>
      </>
      )}
    </div>
  )

  if (mobile && collapsed) return null

  return docked
    ? <><div className="editor-format-placeholder" aria-hidden="true" />{createPortal(toolbar, document.body)}</>
    : toolbar
}
