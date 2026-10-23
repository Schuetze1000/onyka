import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ folder: vi.fn(), tree: vi.fn(), permission: vi.fn(), note: vi.fn() }))
vi.mock('../../repositories/folder.repository.js', () => ({ folderRepository: { findById: mocks.folder, findTreeByOwner: mocks.tree } }))
vi.mock('../../repositories/share.repository.js', () => ({ shareRepository: { hasAccess: mocks.permission } }))
vi.mock('../../repositories/note.repository.js', () => ({ noteRepository: { findByIdWithTags: mocks.note } }))
vi.mock('../../repositories/page.repository.js', () => ({ pageRepository: {} }))
vi.mock('archiver', () => ({ default: () => ({ on: vi.fn(), pipe: vi.fn(), append: vi.fn(), finalize: async () => {} }) }))
import { exportService } from '../../services/export.service.js'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.folder.mockResolvedValue({ id: 'shared', name: 'Team', ownerId: 'owner' })
  mocks.note.mockResolvedValue(null)
  mocks.tree.mockResolvedValue([
    { id: 'private', name: 'Private', notes: [{ id: 'private-note' }], children: [] },
    { id: 'shared', name: 'Team', notes: [{ id: 'shared-note' }], children: [
      { id: 'child', name: 'Child', notes: [{ id: 'nested-note' }], children: [] },
    ] },
  ])
})
describe('Shared folder export', () => {
  it('allows readers to export only the shared subtree from the owner workspace', async () => {
    mocks.permission.mockResolvedValue(true)
    const result = await exportService.exportFolder('shared', 'reader', 'txt')
    expect(mocks.permission).toHaveBeenCalledWith('reader', 'shared', 'folder', 'read')
    expect(mocks.tree).toHaveBeenCalledWith('owner')
    expect(mocks.note.mock.calls.map(call => call[0])).toEqual(['shared-note', 'nested-note'])
    expect(result.filename).toBe('Team.zip')
    result.stream.destroy()
  })
  it('denies unrelated users before reading any folder content', async () => {
    mocks.permission.mockResolvedValue(false)
    await expect(exportService.exportFolder('shared', 'stranger', 'txt')).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.tree).not.toHaveBeenCalled()
    expect(mocks.note).not.toHaveBeenCalled()
  })
})
