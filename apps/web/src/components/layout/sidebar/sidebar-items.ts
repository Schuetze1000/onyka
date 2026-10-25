import type { SharedFolder } from '@onyka/shared'
import type { FolderNote } from '@onyka/shared'
import type { FolderTreeItem } from '@/services/api'
import type { SharedNote } from '@/stores/shares'

type SidebarEntry = { id: string; name: string } & (
  | { source: 'owned'; type: 'folder'; folder: FolderTreeItem }
  | { source: 'owned'; type: 'note'; note: FolderNote }
  | { source: 'shared'; type: 'folder'; folder: SharedFolder }
  | { source: 'shared'; type: 'note'; note: SharedNote }
)

/** Keep ownership metadata separate from placement so shared items retain their permissions. */
export function buildSidebarItems(
  folders: FolderTreeItem[],
  notes: FolderNote[],
  sharedFolders: SharedFolder[],
  sharedNotes: SharedNote[],
): SidebarEntry[] {
  const folderIds = new Set<string>()
  const noteIds = new Set(notes.map(note => note.id))
  const visit = (tree: FolderTreeItem[]) => {
    for (const folder of tree) {
      folderIds.add(folder.id)
      folder.notes.forEach(note => noteIds.add(note.id))
      visit(folder.children)
    }
  }
  visit(folders)

  const visibleSharedFolders = [...new Map(sharedFolders.map(folder => [folder.id, folder])).values()]
    .filter(folder => !folderIds.has(folder.id))
  const sharedFolderIds = new Set(visibleSharedFolders.map(folder => folder.id))
  const items: SidebarEntry[] = [
    ...folders.map(folder => ({ id: folder.id, name: folder.name, source: 'owned' as const, type: 'folder' as const, folder })),
    ...notes.map(note => ({ id: note.id, name: note.title, source: 'owned' as const, type: 'note' as const, note })),
    ...visibleSharedFolders.filter(folder => !folder.parentId || !sharedFolderIds.has(folder.parentId))
      .map(folder => ({ id: folder.id, name: folder.name, source: 'shared' as const, type: 'folder' as const, folder })),
    ...[...new Map(sharedNotes.map(note => [note.id, note])).values()]
      .filter(note => !noteIds.has(note.id) && (!note.folderId || !sharedFolderIds.has(note.folderId)))
      .map(note => ({ id: note.id, name: note.title, source: 'shared' as const, type: 'note' as const, note })),
  ]
  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)
  })
}
