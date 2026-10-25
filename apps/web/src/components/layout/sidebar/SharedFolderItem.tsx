import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IoEllipsisHorizontal, IoChevronDown } from 'react-icons/io5'
import type { SharedFolder } from '@onyka/shared'
import { foldersApi, notesApi } from '@/services/api'
import { FolderContextMenu } from './FolderContextMenu'
import { IconPicker } from '@/components/ui'
import { getIconByName, isEmoji } from '@/utils/icons'
import { useNotesStore } from '@/stores/notes'
import { ShareDialog, ExportDialog, ConfirmDialog } from '@/components/features'
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
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(true)
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [form, setForm] = useState<'folder' | 'rename' | null>(null)
  const [iconOpen, setIconOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const children = folders.filter(f => f.parentId === folder.id && !ancestors.includes(f.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  const containedNotes = notes.filter(n => n.folderId === folder.id)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  const canEdit = folder.permission !== 'read'

  const createNote = async () => {
    setBusy(true); setError(false)
    try {
      const { note } = await notesApi.create({ title: '', content: '', folderId: folder.id })
      await onRefresh()
      setMenuPosition(null); setOpen(true)
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
      setName(''); setForm(null); setMenuPosition(null); setOpen(true)
    } catch { setError(true) }
    finally { setBusy(false) }
  }

  const closeMenu = () => setMenuPosition(null)
  const openMenu = (x: number, y: number) => {
    window.dispatchEvent(new CustomEvent('close-context-menus'))
    setMenuPosition({ x, y })
  }
  useEffect(() => {
    const close = () => { setMenuPosition(null); setIconOpen(false) }
    window.addEventListener('close-context-menus', close)
    return () => window.removeEventListener('close-context-menus', close)
  }, [])
  const saveRename = async () => {
    if (!name.trim() || busy) return
    setBusy(true); setError(false)
    try { await foldersApi.update(folder.id, { name: name.trim() }); await onRefresh(); setForm(null) }
    catch { setError(true) } finally { setBusy(false) }
  }
  const changeIcon = async (icon: string) => {
    setIconOpen(false); setBusy(true); setError(false)
    try { await foldersApi.update(folder.id, { icon }); await onRefresh() }
    catch { setError(true) } finally { setBusy(false) }
  }
  const deleteFolder = async () => {
    setBusy(true); setError(false)
    try {
      await foldersApi.delete(folder.id, true)
      const removed = new Set([folder.id])
      for (let i = 0; i < folders.length; i++) {
        for (const child of folders) if (child.parentId && removed.has(child.parentId)) removed.add(child.id)
      }
      if (notes.some(n => n.id === selectedNoteId && n.folderId && removed.has(n.folderId))) useNotesStore.getState().setCurrentNote(null)
      await onRefresh(); setDeleteOpen(false)
    } catch { setError(true) } finally { setBusy(false) }
  }
  const FolderIcon = getIconByName(folder.icon || 'Folder')

  return (
    <div className="min-w-0" aria-busy={busy}>
      <div className="group flex items-center rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors"
        title={`${t('share.shared_by', { name: folder.sharedBy.name || folder.sharedBy.username })} · ${t(`share.permission_badge.${folder.permission}`)}`}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openMenu(event.clientX, event.clientY) }}>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
          className="flex items-center gap-1 flex-1 min-w-0 min-h-11 md:min-h-0 py-0.5 px-2 text-left text-sm text-[var(--color-text-secondary)]">
          <IoChevronDown className={`w-3 h-3 shrink-0 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
          {isEmoji(folder.icon) ? <span className="w-4 h-4 shrink-0 text-base leading-none">{folder.icon}</span>
            : <FolderIcon className="w-4 h-4 shrink-0 text-[var(--color-accent)]" />}
          <span className="truncate flex-1">{folder.name}</span>
          <span className="text-[10px] text-[var(--color-text-tertiary)]">{t(`share.permission_badge.${folder.permission}`)}</span>
        </button>
        <button ref={menuButtonRef} type="button" aria-expanded={Boolean(menuPosition)}
          aria-label={`${t('common.more_options')}: ${folder.name}`} title={t('common.more_options')}
          onClick={event => {
            event.stopPropagation()
            if (menuPosition) closeMenu()
            else { const rect = event.currentTarget.getBoundingClientRect(); openMenu(rect.right - 160, rect.bottom + 4) }
          }}
          className={`w-11 h-11 md:w-7 md:h-7 shrink-0 flex items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] focus-visible:opacity-100 transition-all ${menuPosition ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]' : 'md:opacity-0 group-hover:opacity-100'}`}>
          <IoEllipsisHorizontal className="w-4 h-4" />
        </button>
      </div>
      {menuPosition && <FolderContextMenu position={menuPosition} triggerRef={menuButtonRef} onClose={closeMenu}
        canEdit={canEdit && !busy} canManage={folder.permission === 'admin' && !busy} canExport={!busy}
        onNewNote={() => { closeMenu(); void createNote() }}
        onNewFolder={() => { closeMenu(); setForm('folder'); setName(''); setError(false); setOpen(true) }}
        onRename={() => { closeMenu(); setForm('rename'); setName(folder.name); setError(false) }}
        onIcon={() => { closeMenu(); setIconOpen(true) }}
        onShare={() => { closeMenu(); setShareOpen(true) }}
        onExport={() => { closeMenu(); setExportOpen(true) }}
        onDelete={() => { closeMenu(); setError(false); setDeleteOpen(true) }} />}
      {form && <form onSubmit={e => { e.preventDefault(); void (form === 'folder' ? createFolder() : saveRename()) }}
        className="ml-3 my-1 p-2 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-secondary)] animate-fade-in space-y-2">
        <label className="block text-xs text-[var(--color-text-secondary)]">
          {t(form === 'folder' ? 'share.new_subfolder' : 'common.rename')}
          <input autoFocus value={name} maxLength={100} disabled={busy} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setForm(null) }}
            className="mt-1 w-full min-h-11 px-2 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-sm" />
        </label>
        <div className="flex flex-wrap gap-1">
          <button type="submit" disabled={busy || !name.trim()} className="min-h-11 px-3 rounded-lg bg-[var(--color-accent-muted)] text-[var(--color-accent)] text-sm disabled:opacity-50">{t(form === 'folder' ? 'common.create' : 'common.save')}</button>
          <button type="button" disabled={busy} onClick={() => setForm(null)} className="min-h-11 px-3 text-sm">{t('common.cancel')}</button>
        </div>
      </form>}
      {error && !deleteOpen && <p role="alert" className="px-3 py-2 text-xs text-[var(--color-error)]">{t('common.error')}</p>}
      {open && <div className="ml-3 pl-1 border-l border-[var(--color-border-subtle)] animate-fade-in">
        {children.map(child => <SharedFolderItem key={child.id} folder={child} folders={folders} notes={notes}
          selectedNoteId={selectedNoteId} onSelectNote={onSelectNote} onRefresh={onRefresh} renderNote={renderNote}
          ancestors={[...ancestors, folder.id]} />)}
        {containedNotes.map(renderNote)}
        {!children.length && !containedNotes.length && <p className="px-3 py-2 text-xs text-[var(--color-text-tertiary)]">{t('sidebar.no_notes')}</p>}
      </div>}
      {iconOpen && <IconPicker selectedIcon={folder.icon || 'Folder'} onSelectIcon={icon => void changeIcon(icon)} onClose={() => setIconOpen(false)} triggerRef={menuButtonRef} />}
      {exportOpen && <ExportDialog type="folder" isOpen onClose={() => setExportOpen(false)} folderId={folder.id} title={folder.name} />}
      {deleteOpen && <ConfirmDialog isOpen onClose={() => { if (!busy) setDeleteOpen(false) }} onConfirm={() => void deleteFolder()}
        title={t('folders.delete_title')} message={t('folders.delete_message', { name: folder.name })} isLoading={busy}>
        {error && <p role="alert" className="text-sm text-[var(--color-error)]">{t('common.error')}</p>}
      </ConfirmDialog>}
      {shareOpen && <ShareDialog isOpen onClose={() => setShareOpen(false)} resourceId={folder.id} resourceType="folder" resourceTitle={folder.name} />}
    </div>
  )
}
