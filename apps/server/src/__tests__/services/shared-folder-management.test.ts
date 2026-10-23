import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  folder: vi.fn(), folders: vi.fn(), permission: vi.fn(), createNote: vi.fn(), createFolder: vi.fn(),
  grants: vi.fn(), updateNote: vi.fn(), note: vi.fn(),
  updateFolder: vi.fn(), deleteFolder: vi.fn(), children: vi.fn(), ownerNotes: vi.fn(), softDelete: vi.fn(),
}))
vi.mock('../../repositories/folder.repository.js', () => ({ folderRepository: {
  findById: mocks.folder, findByIds: mocks.folders, create: mocks.createFolder, update: mocks.updateFolder,
  delete: mocks.deleteFolder, findByParent: mocks.children, hasChildren: async () => false, hasNotes: async () => false,
} }))
vi.mock('../../repositories/share.repository.js', () => ({ shareRepository: { hasAccess: mocks.permission } }))
vi.mock('../../repositories/note.repository.js', () => ({ noteRepository: {
  create: mocks.createNote, findById: mocks.note, update: mocks.updateNote,
  findByOwner: mocks.ownerNotes, softDelete: mocks.softDelete,
} }))
vi.mock('../../repositories/tag.repository.js', () => ({ tagRepository: {} }))
vi.mock('../../repositories/user.repository.js', () => ({ userRepository: { getTrackingEnabled: async () => false } }))
vi.mock('../../repositories/note-upload.repository.js', () => ({ noteUploadRepository: { syncFromNoteContent: vi.fn() } }))
vi.mock('../../services/sharing.service.js', () => ({ sharingService: { getSharedWithMe: mocks.grants } }))
vi.mock('../../services/search.service.js', () => ({ searchService: { indexNote: vi.fn() } }))
vi.mock('../../services/stats.service.js', () => ({ statsService: {} }))
vi.mock('../../utils/index.js', () => ({ logger: { warn: vi.fn() } }))

import { notesService } from '../../services/notes.service.js'
import { foldersService } from '../../services/folders.service.js'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.folder.mockResolvedValue({ id: 'shared', name: 'Team', parentId: null, ownerId: 'owner' })
  mocks.createNote.mockImplementation(async (ownerId, input) => ({ id: 'new', ownerId, ...input, content: '' }))
  mocks.createFolder.mockImplementation(async (ownerId, input) => ({ id: 'new-folder', ownerId, ...input }))
})

describe('Create content inside shared folders', () => {
  it('requires edit rights for renaming and icons, keeping moves owner-only', async () => {
    mocks.permission.mockResolvedValue(false)
    await expect(foldersService.update('shared', 'reader', { name: 'Renamed' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(foldersService.update('shared', 'reader', { icon: 'Star' })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.updateFolder).not.toHaveBeenCalled()
    mocks.permission.mockResolvedValue(true)
    await foldersService.update('shared', 'editor', { name: 'Renamed', icon: 'Star' })
    expect(mocks.permission).toHaveBeenLastCalledWith('editor', 'shared', 'folder', 'edit')
    expect(mocks.updateFolder).toHaveBeenCalledWith('shared', { name: 'Renamed', icon: 'Star' })
    await expect(foldersService.update('shared', 'editor', { parentId: null })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('requires admin rights for deletion and traverses the original owner workspace', async () => {
    mocks.permission.mockResolvedValue(false)
    await expect(foldersService.delete('shared', 'editor', true)).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.permission).toHaveBeenCalledWith('editor', 'shared', 'folder', 'admin')
    expect(mocks.deleteFolder).not.toHaveBeenCalled()
    mocks.permission.mockResolvedValue(true)
    mocks.children.mockResolvedValue([])
    mocks.ownerNotes.mockResolvedValue([{ id: 'contained' }])
    await foldersService.delete('shared', 'admin', true)
    expect(mocks.children).toHaveBeenCalledWith('owner', 'shared')
    expect(mocks.ownerNotes).toHaveBeenCalledWith('owner', { folderId: 'shared' })
    expect(mocks.softDelete).toHaveBeenCalledWith('contained')
    expect(mocks.deleteFolder).toHaveBeenCalledWith('shared')
  })
  it.each(['read', 'none'])('rejects %s access for both notes and subfolders', async () => {
    mocks.permission.mockResolvedValue(false)
    await expect(notesService.create('reader', { folderId: 'shared' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(foldersService.create('reader', { parentId: 'shared', name: 'Child' })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.createNote).not.toHaveBeenCalled()
    expect(mocks.createFolder).not.toHaveBeenCalled()
    expect(mocks.permission).toHaveBeenCalledWith('reader', 'shared', 'folder', 'edit')
  })
  it.each(['editor', 'admin'])('creates %s content in the original owner workspace', async user => {
    mocks.permission.mockResolvedValue(true)
    expect((await notesService.create(user, { folderId: 'shared' })).ownerId).toBe('owner')
    expect((await foldersService.create(user, { parentId: 'shared', name: 'Child' })).ownerId).toBe('owner')
  })
  it('allows owner creation without a share and rejects missing folders', async () => {
    await notesService.create('owner', { folderId: 'shared' })
    expect(mocks.permission).not.toHaveBeenCalled()
    mocks.folder.mockResolvedValue(null)
    await expect(notesService.create('owner', { folderId: 'missing' })).rejects.toMatchObject({ statusCode: 404 })
    await expect(foldersService.create('owner', { parentId: 'missing', name: 'Child' })).rejects.toMatchObject({ statusCode: 404 })
  })
  it('lists authorized empty and nested folders without fetching private ancestors', async () => {
    mocks.grants.mockResolvedValue([
      { resourceId: 'shared', resourceType: 'folder', permission: 'edit', owner: { id: 'owner' } },
      { resourceId: 'child', resourceType: 'folder', permission: 'read', owner: { id: 'owner' } },
      { resourceId: 'note', resourceType: 'note' },
    ])
    mocks.folders.mockResolvedValue([
      { id: 'shared', parentId: 'private', name: 'Empty' }, { id: 'child', parentId: 'shared', name: 'Child' },
    ])
    const folders = await foldersService.getSharedWithMe('editor')
    expect(mocks.folders).toHaveBeenCalledWith(['shared', 'child'])
    expect(folders.map(f => [f.id, f.permission])).toEqual([['shared', 'edit'], ['child', 'read']])
  })
  it('prevents collaborators from moving shared notes out of the workspace', async () => {
    mocks.note.mockResolvedValue({ id: 'note', ownerId: 'owner', folderId: 'shared' })
    mocks.permission.mockResolvedValue(true)
    await expect(notesService.update('note', 'editor', { folderId: null })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.updateNote).not.toHaveBeenCalled()
  })
})
