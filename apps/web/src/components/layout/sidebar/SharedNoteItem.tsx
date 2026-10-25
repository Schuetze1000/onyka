import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  IoPeopleOutline,
  IoEllipsisHorizontal,
  IoCreateOutline,
} from 'react-icons/io5'
import { ShareDialog } from '@/components/features'
import type { SharedNote } from '@/stores/shares'
import { notesApi } from '@/services/api'

const PERMISSION_COLORS: Record<string, string> = {
  read: 'bg-blue-500/20 text-blue-400',
  edit: 'bg-green-500/20 text-green-400',
  admin: 'bg-purple-500/20 text-purple-400',
}

export function SharedNoteItem({
  note,
  isSelected,
  onSelect,
  onNoteUpdated,
}: {
  note: SharedNote
  isSelected: boolean
  onSelect: () => void
  onNoteUpdated: () => void
}) {
  const { t } = useTranslation()
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(note.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const canEdit = note.permission === 'edit' || note.permission === 'admin'
  const canShare = note.permission === 'admin'

  useEffect(() => {
    const handleCloseOtherMenus = () => {
      setMenuPosition(null)
    }
    window.addEventListener('close-context-menus', handleCloseOtherMenus)
    return () => window.removeEventListener('close-context-menus', handleCloseOtherMenus)
  }, [])

  useEffect(() => {
    if (!menuPosition) return
    const handleOutsideMouseDown = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return
      closeMenu()
    }
    window.addEventListener('mousedown', handleOutsideMouseDown, true)
    return () => window.removeEventListener('mousedown', handleOutsideMouseDown, true)
  }, [menuPosition])

  const openMenu = (x: number, y: number) => {
    window.dispatchEvent(new CustomEvent('close-context-menus'))
    const menuWidth = 160
    const menuHeight = 150
    const adjustedX = Math.min(x, window.innerWidth - menuWidth - 10)
    const adjustedY = Math.min(y, window.innerHeight - menuHeight - 10)
    setTimeout(() => setMenuPosition({ x: adjustedX, y: adjustedY }), 0)
  }

  const closeMenu = () => {
    setMenuPosition(null)
  }

  const handleStartRename = (e: React.MouseEvent) => {
    e.stopPropagation()
    closeMenu()
    setRenameValue(note.title)
    setIsRenaming(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleConfirmRename = async () => {
    if (renameValue.trim() && renameValue !== note.title) {
      await notesApi.update(note.id, { title: renameValue.trim() })
      onNoteUpdated()
    }
    setIsRenaming(false)
  }

  if (isRenaming) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-0.5 rounded-lg overflow-hidden">
        <input
          ref={inputRef}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => void handleConfirmRename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleConfirmRename()
            if (e.key === 'Escape') setIsRenaming(false)
          }}
          className="flex-1 min-w-0 px-2 py-0.5 text-[13px] bg-[var(--color-bg-tertiary)] border border-[var(--color-accent)] rounded-md text-[var(--color-text-primary)] focus:outline-none"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )
  }

  return (
    <div
      title={`${t('share.shared_by', { name: note.sharedBy.name || note.sharedBy.username })} · ${t(`share.permission_badge.${note.permission}`)}`}
      onClick={onSelect}
      onContextMenu={(e) => {
        if (!canEdit) return
        e.preventDefault()
        openMenu(e.clientX, e.clientY)
      }}
      className={`
        group w-full flex items-center gap-2 px-2 py-0.5 min-h-11 md:min-h-0 rounded-lg relative
        text-left transition-all duration-150 ease-out cursor-pointer
        ${isSelected
          ? 'bg-[var(--color-accent)]/10 text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]/80 hover:text-[var(--color-text-primary)]'
        }
      `}
    >
      {isSelected && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-full bg-[var(--color-accent)]" />
      )}

      <span className={`truncate text-sm flex-1 ${isSelected ? 'font-medium' : ''}`}>
        {note.title || t('editor.untitled')}
      </span>

      <IoPeopleOutline className="w-3 h-3 text-[var(--color-accent)] opacity-60 shrink-0" />
      <span className={`text-[10px] px-1.5 py-px rounded font-medium leading-tight ${PERMISSION_COLORS[note.permission]}`}>
        {t(`share.permission_badge.${note.permission}`)}
      </span>

      {canEdit && (
        <button
          ref={menuButtonRef}
          onClick={(e) => {
            e.stopPropagation()
            if (menuPosition) {
              closeMenu()
            } else {
              const rect = e.currentTarget.getBoundingClientRect()
              openMenu(rect.right - 140, rect.bottom + 4)
            }
          }}
          aria-label={t('common.more_options')}
          className="opacity-100 md:opacity-0 group-hover:opacity-100 min-w-8 min-h-8 p-0.5 rounded hover:bg-[var(--color-bg-elevated)] transition-opacity"
        >
          <IoEllipsisHorizontal className="w-3 h-3" />
        </button>
      )}

      {menuPosition && canEdit && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] border rounded-xl py-1.5 min-w-[140px] animate-scale-in floating-panel"
          style={{ top: menuPosition.y, left: menuPosition.x }}
        >
          <button
            onClick={handleStartRename}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <IoCreateOutline className="w-4 h-4" />
            {t('notes.rename')}
          </button>
          {canShare && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeMenu()
                setShowShareDialog(true)
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <IoPeopleOutline className="w-4 h-4" />
              {t('share.title')}
            </button>
          )}
        </div>,
        document.body
      )}

      {canShare && (
        <ShareDialog
          isOpen={showShareDialog}
          onClose={() => setShowShareDialog(false)}
          resourceId={note.id}
          resourceType="note"
          resourceTitle={note.title}
        />
      )}
    </div>
  )
}

