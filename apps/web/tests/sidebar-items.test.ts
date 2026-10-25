import { describe, expect, it } from 'vitest'
import type { FolderNote, SharedFolder } from '@onyka/shared'
import type { FolderTreeItem } from '../src/services/api'
import type { SharedNote } from '../src/stores/shares'
import { buildSidebarItems } from '../src/components/layout/sidebar/sidebar-items'

const note = (id: string, title: string, folderId: string | null = null): SharedNote => ({
  id, title, folderId, permission: 'read', sharedBy: { id: 'other', name: 'Other', username: 'other' },
} as SharedNote)
const folder = (id: string, name: string, parentId: string | null = null): SharedFolder => ({
  id, name, parentId, permission: 'edit', sharedBy: { id: 'other', name: 'Other', username: 'other' },
} as SharedFolder)
const ownFolder = (id: string, name: string, children: FolderTreeItem[] = [], notes: FolderNote[] = []): FolderTreeItem => ({
  id, name, children, notes,
} as FolderTreeItem)

describe('One sidebar for owned and shared notes', () => {
  it('interleaves shared and owned entries alphabetically, with folders first', () => {
    const entries = buildSidebarItems(
      [ownFolder('own-folder', 'Zulu')], [{ id: 'own-note', title: 'Bravo' } as FolderNote],
      [folder('shared-folder', 'Alpha')], [note('shared-note', 'Alpha')],
    )
    expect(entries.map(entry => [entry.id, entry.source])).toEqual([
      ['shared-folder', 'shared'], ['own-folder', 'owned'], ['shared-note', 'shared'], ['own-note', 'owned'],
    ])
  })

  it('keeps inherited notes and subfolders in their folder instead of duplicating them at the root', () => {
    const folders = [folder('parent', 'Parent'), folder('child', 'Child', 'parent')]
    const childNote = note('nested-note', 'Nested', 'child')
    // Direct shares can overlap inherited shares of the same resource.
    const entries = buildSidebarItems([], [], [...folders, folders[1]], [childNote, childNote, note('loose', 'Loose')])
    expect(entries.map(entry => entry.id)).toEqual(['parent', 'loose'])
    expect(folders).toHaveLength(2)
  })

  it('shows individually shared resources when their parent folder is not accessible', () => {
    const entries = buildSidebarItems([], [], [folder('child', 'Child', 'private-parent')], [
      note('individual', 'Individual', 'another-private-folder'), note('nested', 'Nested', 'child'),
    ])
    expect(entries.map(entry => entry.id)).toEqual(['child', 'individual'])
  })

  it('preserves permissions and excludes owned entries already present in a nested folder', () => {
    const shared = note('shared', 'Shared')
    const sharedFolder = folder('shared-folder', 'Shared folder')
    const entries = buildSidebarItems([ownFolder('own', 'Own', [ownFolder('own-child', 'Child', [], [
      { id: 'own-nested-note', title: 'Own nested note' } as FolderNote,
    ])])], [], [sharedFolder, folder('own-child', 'Duplicate')], [shared, note('own-nested-note', 'Duplicate')])
    expect(entries.map(entry => entry.id)).toEqual(['own', 'shared-folder', 'shared'])
    expect(entries.find(entry => entry.id === shared.id)).toMatchObject({ source: 'shared', note: { permission: 'read' } })
    expect(entries.find(entry => entry.id === sharedFolder.id)).toMatchObject({ source: 'shared', folder: { permission: 'edit' } })
  })
})
