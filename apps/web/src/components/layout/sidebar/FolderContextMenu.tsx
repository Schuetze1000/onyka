import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IoCreateOutline, IoHappyOutline, IoTrashOutline, IoDocumentOutline, IoFolderOutline, IoPeopleOutline, IoDownloadOutline } from 'react-icons/io5'

interface Props {
  position: { x: number; y: number }
  triggerRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  canEdit?: boolean
  canManage?: boolean
  canExport?: boolean
  onNewNote: () => void
  onNewFolder: () => void
  onRename: () => void
  onIcon: () => void
  onShare: () => void
  onExport: () => void
  onDelete: () => void
}

/** One menu for owned and shared folders; permissions only disable actions. */
export function FolderContextMenu({ position, triggerRef, onClose, canEdit = true, canManage = true, canExport = true, ...actions }: Props) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [location, setLocation] = useState(position)
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const place = () => {
      setLocation({ x: Math.max(8, Math.min(position.x, innerWidth - menu.offsetWidth - 8)),
        y: Math.max(8, Math.min(position.y, innerHeight - menu.offsetHeight - 8)) })
    }
    const outside = (event: PointerEvent) => {
      if (menu.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node)) return
      onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); triggerRef.current?.focus() }
    }
    place()
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [position, triggerRef, onClose])
  const items = [
    { key: 'new-note', label: t('sidebar.new_note'), Icon: IoDocumentOutline, enabled: canEdit, action: actions.onNewNote },
    { key: 'new-folder', label: t('sidebar.new_folder'), Icon: IoFolderOutline, enabled: canEdit, action: actions.onNewFolder },
    { key: 'rename', label: t('common.rename'), Icon: IoCreateOutline, enabled: canEdit, action: actions.onRename, divider: true },
    { key: 'icon', label: t('notes.change_icon'), Icon: IoHappyOutline, enabled: canEdit, action: actions.onIcon },
    { key: 'share', label: t('share.title'), Icon: IoPeopleOutline, enabled: canManage, action: actions.onShare },
    { key: 'export', label: t('export.title'), Icon: IoDownloadOutline, enabled: canExport, action: actions.onExport },
    { key: 'delete', label: t('common.delete'), Icon: IoTrashOutline, enabled: canManage, action: actions.onDelete, divider: true },
  ]
  return createPortal(
    <div ref={ref} role="group" aria-label={t('common.more_options')}
      className="fixed z-[9999] border rounded-xl py-1.5 min-w-[160px] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] overflow-y-auto animate-scale-in floating-panel"
      style={{ top: location.y, left: location.x }}>
      {items.map(({ key, label, Icon, enabled, action, divider }) => <div key={key}>
        {divider && <div className="my-1 border-t border-[var(--color-border-subtle)]" />}
        <button type="button" disabled={!enabled} onClick={event => { event.stopPropagation(); if (enabled) action() }}
          className={`w-full min-h-11 md:min-h-0 flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${key === 'delete' ? 'enabled:hover:bg-[var(--color-error)]/15 enabled:hover:text-[var(--color-error)]' : 'enabled:hover:bg-[var(--color-bg-tertiary)] enabled:hover:text-[var(--color-text-primary)]'}`}>
          <Icon className="w-4 h-4 shrink-0" />{label}
        </button>
      </div>)}
    </div>, document.body)
}
