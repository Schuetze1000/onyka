import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
vi.mock('../../repositories/folder.repository.js', () => ({ folderRepository: {
  findById: async () => ({ id: 'folder', ownerId: 'owner', name: 'Large export' }),
  findTreeByOwner: async () => [{ id: 'folder', name: 'Large export', notes: [{ id: 'note' }], children: [] }],
} }))
vi.mock('../../repositories/share.repository.js', () => ({ shareRepository: {} }))
vi.mock('../../repositories/note.repository.js', () => ({ noteRepository: {
  findByIdWithTags: async () => ({ id: 'note', title: 'Content', tags: [], content: randomBytes(256 * 1024).toString('base64') }),
} }))
vi.mock('../../repositories/page.repository.js', () => ({ pageRepository: { findByNoteId: async () => [] } }))
import { exportService } from '../../services/export.service.js'

describe('Large folder exports', () => {
  it('returns a stream before ZIP finalization fills the buffer and completes the archive', async () => {
    const { stream } = await exportService.exportFolder('folder', 'owner', 'txt')
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    const archive = Buffer.concat(chunks)
    expect(archive.length).toBeGreaterThan(128 * 1024)
    expect(archive.subarray(0, 2).toString()).toBe('PK')
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50)
  })
})
