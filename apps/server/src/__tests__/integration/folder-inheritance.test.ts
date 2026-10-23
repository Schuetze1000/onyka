import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../db/index.js', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const schema = await import('../../db/schema.js')
  const rawDb = new Database(':memory:')
  rawDb.exec(`
    CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT, owner_id TEXT);
    CREATE TABLE notes (id TEXT PRIMARY KEY, folder_id TEXT, owner_id TEXT, is_deleted INTEGER DEFAULT 0);
    CREATE TABLE note_uploads (note_id TEXT, filename TEXT);
    CREATE TABLE shares (id TEXT PRIMARY KEY, resource_id TEXT, resource_type TEXT,
      owner_id TEXT, shared_with_id TEXT, permission TEXT, created_at INTEGER);
  `)
  return { db: drizzle(rawDb, { schema }), schema, rawDb }
})

import { rawDb } from '../../db/index.js'
import { shareRepository } from '../../repositories/share.repository.js'

beforeEach(() => {
  rawDb.exec(`DELETE FROM shares; DELETE FROM notes; DELETE FROM folders; DELETE FROM note_uploads;
    INSERT INTO folders VALUES ('root', NULL, 'owner'), ('child', 'root', 'owner'),
      ('grandchild', 'child', 'owner'), ('private', NULL, 'owner'), ('foreign', 'root', 'other');
    INSERT INTO notes(id,folder_id,owner_id) VALUES ('a','root','owner'), ('b','grandchild','owner'),
      ('private-note','private','owner'), ('foreign-note','root','other'), ('foreign-child','foreign','other');
    INSERT INTO shares VALUES ('grant','root','folder','owner','reader','read',1234);
    INSERT INTO note_uploads VALUES ('b','image.png');`)
})
afterAll(() => rawDb.close())

describe('Inherited folder permissions through the production repository', () => {
  it('lists nested notes once, without private or foreign content', async () => {
    const grants = await shareRepository.findEffectiveBySharedWith('reader')
    expect(grants.filter(g => g.resourceType === 'note').map(g => g.resourceId).sort()).toEqual(['a', 'b'])
    expect(grants.find(g => g.resourceId === 'grandchild')?.permission).toBe('read')
    expect(grants[0].createdAt.getTime()).toBe(1234000)
    expect(await shareRepository.hasAccess('stranger', 'b', 'note')).toBe(false)
  })
  it('enforces read/edit/admin consistently, including attachments', async () => {
    expect(await shareRepository.hasAccess('reader', 'b', 'note')).toBe(true)
    expect(await shareRepository.hasAccess('reader', 'b', 'note', 'edit')).toBe(false)
    expect(await shareRepository.hasAccessToUpload('reader', 'image.png')).toBe(true)
    rawDb.exec("UPDATE shares SET permission='edit' WHERE id='grant'")
    expect(await shareRepository.hasAccess('reader', 'b', 'note', 'edit')).toBe(true)
    expect(await shareRepository.hasAccess('reader', 'b', 'note', 'admin')).toBe(false)
  })
  it('automatically includes new children and stops inheriting after moving out', async () => {
    rawDb.exec("INSERT INTO notes(id,folder_id,owner_id) VALUES ('new','grandchild','owner')")
    expect(await shareRepository.hasAccess('reader', 'new', 'note')).toBe(true)
    rawDb.exec("UPDATE folders SET parent_id='private' WHERE id='child'")
    expect(await shareRepository.hasAccess('reader', 'b', 'note')).toBe(false)
    expect(await shareRepository.hasAccessToUpload('reader', 'image.png')).toBe(false)
    expect(await shareRepository.hasAccess('reader', 'a', 'note')).toBe(true)
  })
  it('uses the strongest grant and preserves independent direct shares after revocation', async () => {
    rawDb.exec("INSERT INTO shares VALUES ('direct','b','note','owner','reader','admin',1234)")
    expect(await shareRepository.getEffectivePermission('reader', 'b', 'note')).toBe('admin')
    const grants = await shareRepository.findEffectiveBySharedWith('reader')
    expect(grants.filter(g => g.resourceId === 'b')).toHaveLength(1)
    rawDb.exec("DELETE FROM shares WHERE id='grant'")
    expect(await shareRepository.hasAccess('reader', 'a', 'note')).toBe(false)
    expect(await shareRepository.hasAccess('reader', 'b', 'note', 'admin')).toBe(true)
  })
  it('terminates on a corrupt cycle and revokes upload access', async () => {
    rawDb.exec("UPDATE folders SET parent_id='grandchild' WHERE id='root'")
    expect(await shareRepository.hasAccess('reader', 'b', 'note')).toBe(true)
    rawDb.exec('DELETE FROM shares')
    expect(await shareRepository.hasAccessToUpload('reader', 'image.png')).toBe(false)
  })
})
