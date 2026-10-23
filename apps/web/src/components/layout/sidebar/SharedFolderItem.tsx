import { useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IoEllipsisHorizontal, IoChevronDown, IoDocumentTextOutline, IoFolderOutline, IoPeopleOutline } from 'react-icons/io5'
import type { SharedFolder } from '@onyka/shared'
import { foldersApi, notesApi } from '@/services/api'
import { ShareDialog } from '@/components/features'
import type { SharedNote } from '@/stores/shares'

interface Props {
  folder: SharedFolder
  folders: SharedFolder[]
  notes: SharedNote[]
  selectedNoteId: string | null
  onSelectNote: (id: string) => void
  onRefresh: () => Promise<void>
  renderNote: (note: SharedNote) => ReactNode
  ancestors?: string[]
}

export function SharedFolderItem({ folder, folders, notes, selectedNoteId, onSelectNote, onRefresh, renderNote, ancestors = [] }: Props) {
  const { t } = useTranslation()
  const actionsId = useId()
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(true)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const children = folders.filter(f => f.parentId === folder.id && !ancestors.includes(f.id))
  const containedNotes = notes.filter(n => n.folderId === folder.id)
  const canEdit = folder.permission !== 'read'

  const createNote = async () => {
    setBusy(true); setError(false)
    try {
      const { note } = await notesApi.create({ title: '', content: '', folderId: folder.id })
      await onRefresh()
      setActionsOpen(false); setOpen(true)
      onSelectNote(note.id)
    } catch { setError(true) }
    finally { setBusy(false) }
  }
  const createFolder = async () => {
    if (!name.trim() || busy) return
    setBusy(true); setError(false)
    try {
      await foldersApi.create({ name: name.trim(), parentId: folder.id })
      await onRefresh()
      setName(''); setCreatingFolder(false); setActionsOpen(false); setOpen(true)
    } catch { setError(true) }
    finally { setBusy(false) }
  }

  return (
    <div className="min-w-0" onKeyDown={event => {
      if (event.key === 'Escape' && actionsOpen) {
        event.stopPropagation()
        setActionsOpen(false)
        menuButtonRef.current?.focus()
      }
    }}>
      <div className="group flex items-center rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
          className="flex items-center gap-2 flex-1 min-w-0 min-h-11 px-2 text-left text-[13px] text-[var(--color-text-secondary)]">
          <IoChevronDown className={`w-3 h-3 shrink-0 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
          <IoFolderOutline className="w-4 h-4 shrink-0 text-[var(--color-accent)]" />
          <span className="truncate flex-1">{folder.name}</span>
          <span className="text-[10px] text-[var(--color-text-tertiary)]">{t(`share.permission_badge.${folder.permission}`)}</span>
        </button>
        {canEdit && <button ref={menuButtonRef} type="button" aria-expanded={actionsOpen} aria-controls={actionsId}
          aria-label={`${t('common.more_options')}: ${folder.name}`} title={t('common.more_options')}
          onClick={() => { setActionsOpen(!actionsOpen); setError(false) }}
          className={`w-11 h-11 md:w-7 md:h-7 shrink-0 flex items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] focus-visible:opacity-100 transition-all ${actionsOpen ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]' : 'md:opacity-0 group-hover:opacity-100'}`}>
          <IoEllipsisHorizontal className="w-4 h-4" />
        </button>}
      </div>
      {actionsOpen && canEdit && (
        <div id={actionsId} className="ml-3 my-1 p-1 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-secondary)] animate-fade-in">
          {!creatingFolder ? <>
            <button type="button" disabled={busy} onClick={() => void createNote()}
              className="w-full min-h-11 flex items-center gap-2 px-3 rounded-lg text-sm hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50">
              <IoDocumentTextOutline />{busy ? t('common.loading') : t('sidebar.new_note')}
            </button>
            <button type="button" disabled={busy} onClick={() => { setCreatingFolder(true); setName('') }}
              className="w-full min-h-11 flex items-center gap-2 px-3 rounded-lg text-sm hover:bg-[var(--color-bg-tertiary)]">
              <IoFolderOutline />{t('share.new_subfolder')}
            </button>
            {folder.permission === 'admin' && <button type="button" onClick={() => { setShareOpen(true); setActionsOpen(false) }}
              className="w-full min-h-11 flex items-center gap-2 px-3 rounded-lg text-sm hover:bg-[var(--color-bg-tertiary)]">
              <IoPeopleOutline />{t('share.title')}
            </button>}
          </> : <form onSubmit={e => { e.preventDefault(); void createFolder() }} className="p-2 space-y-2">
            <label className="block text-xs text-[var(--color-text-secondary)]">
              {t('share.new_subfolder')}
              <input autoFocus value={name} maxLength={100} disabled={busy} onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setCreatingFolder(false) }}
                className="mt-1 w-full min-h-11 px-2 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-sm" />
            </label>
            <div className="flex flex-wrap gap-1">
              <button type="submit" disabled={busy || !name.trim()} className="min-h-11 px-3 rounded-lg bg-[var(--color-accent-muted)] text-[var(--color-accent)] text-sm disabled:opacity-50">{t('common.create')}</button>
              <button type="button" disabled={busy} onClick={() => setCreatingFolder(false)} className="min-h-11 px-3 text-sm">{t('common.cancel')}</button>
            </div>
          </form>}
          {error && <p role="alert" className="px-3 py-2 text-xs text-[var(--color-error)]">{t('share.create_error')}</p>}
        </div>
      )}
      {open && <div className="ml-3 pl-1 border-l border-[var(--color-border-subtle)] animate-fade-in">
        {children.map(child => <SharedFolderItem key={child.id} folder={child} folders={folders} notes={notes}
          selectedNoteId={selectedNoteId} onSelectNote={onSelectNote} onRefresh={onRefresh} renderNote={renderNote}
          ancestors={[...ancestors, folder.id]} />)}
        {containedNotes.map(renderNote)}
        {!children.length && !containedNotes.length && <p className="px-3 py-2 text-xs text-[var(--color-text-tertiary)]">{t('sidebar.no_notes')}</p>}
      </div>}
      {shareOpen && <ShareDialog isOpen onClose={() => setShareOpen(false)} resourceId={folder.id} resourceType="folder" resourceTitle={folder.name} />}
    </div>
  )
}
