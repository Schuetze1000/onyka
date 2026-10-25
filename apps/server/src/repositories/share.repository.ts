import { eq, and, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db, schema } from '../db/index.js'
import type { Share, ShareWithUser, Permission, ResourceType, ShareCreateInput } from '@onyka/shared'

const { shares, users, notes, noteUploads } = schema

export class ShareRepository {
  /** Expand grants at query time: moves, new children and revocations take effect immediately.
   * UNION also terminates safely if a corrupt folder hierarchy contains a cycle.
   * Never inherit across resource owners, even if a foreign folder ID was stored.
   */
  private effectiveResources(userId?: string) {
    return sql`WITH RECURSIVE grants(id, resource_id, resource_type, owner_id, shared_with_id, permission, created_at) AS (
      SELECT id, resource_id, resource_type, owner_id, shared_with_id, permission, created_at
      FROM shares s ${userId ? sql`WHERE shared_with_id = ${userId}` : sql`WHERE 1 = 1`}
        AND (resource_type <> 'note' OR EXISTS (
          SELECT 1 FROM notes n WHERE n.id = s.resource_id AND n.owner_id = s.owner_id AND n.is_deleted = 0
        ))
      UNION
      SELECT g.id, f.id, 'folder', g.owner_id, g.shared_with_id, g.permission, g.created_at
      FROM grants g JOIN folders f ON g.resource_type = 'folder'
        AND f.parent_id = g.resource_id AND f.owner_id = g.owner_id
      UNION
      SELECT g.id, n.id, 'note', g.owner_id, g.shared_with_id, g.permission, g.created_at
      FROM grants g JOIN notes n ON g.resource_type = 'folder'
        AND n.folder_id = g.resource_id AND n.owner_id = g.owner_id AND n.is_deleted = 0
    )`
  }

  async findEffectiveBySharedWith(userId: string): Promise<Share[]> {
    const rows = await db.all<{
      id: string; resourceId: string; resourceType: ResourceType; ownerId: string;
      sharedWithId: string; permission: Permission; createdAt: number
    }>(sql`${this.effectiveResources(userId)}
      SELECT id, resource_id AS resourceId, resource_type AS resourceType,
        owner_id AS ownerId, shared_with_id AS sharedWithId, permission, created_at AS createdAt
      FROM grants ORDER BY CASE permission WHEN 'admin' THEN 3 WHEN 'edit' THEN 2 ELSE 1 END DESC`)
    const resources = new Map<string, Share>()
    for (const row of rows) {
      const key = `${row.resourceType}:${row.resourceId}`
      if (!resources.has(key)) resources.set(key, { ...row, createdAt: new Date(row.createdAt * 1000) })
    }
    return [...resources.values()]
  }

  async getEffectivePermission(userId: string, resourceId: string, resourceType: ResourceType): Promise<Permission | null> {
    const rows = await db.all<{ permission: Permission }>(sql`${this.effectiveResources(userId)}
      SELECT permission FROM grants WHERE resource_id = ${resourceId} AND resource_type = ${resourceType}
      ORDER BY CASE permission WHEN 'admin' THEN 3 WHEN 'edit' THEN 2 ELSE 1 END DESC LIMIT 1`)
    return rows[0]?.permission ?? null
  }

  async findById(id: string): Promise<Share | null> {
    const result = await db.select().from(shares).where(eq(shares.id, id)).limit(1)
    return result[0] ? this.mapToShare(result[0]) : null
  }

  async findByIdWithUser(id: string): Promise<ShareWithUser | null> {
    const result = await db
      .select({
        share: shares,
        sharedWith: {
          id: users.id,
          username: users.username,
          name: users.name,
          avatarUrl: users.avatarUrl,
          avatarColor: users.avatarColor,
        },
      })
      .from(shares)
      .innerJoin(users, eq(shares.sharedWithId, users.id))
      .where(eq(shares.id, id))
      .limit(1)

    if (!result[0]) return null

    return {
      ...this.mapToShare(result[0].share),
      sharedWith: {
        id: result[0].sharedWith.id,
        username: result[0].sharedWith.username,
        name: result[0].sharedWith.name,
        avatarUrl: result[0].sharedWith.avatarUrl ?? undefined,
        avatarColor: result[0].sharedWith.avatarColor,
      },
    }
  }

  async findByResource(resourceId: string, resourceType: ResourceType): Promise<ShareWithUser[]> {
    const result = await db
      .select({
        share: shares,
        sharedWith: {
          id: users.id,
          username: users.username,
          name: users.name,
          avatarUrl: users.avatarUrl,
          avatarColor: users.avatarColor,
        },
      })
      .from(shares)
      .innerJoin(users, eq(shares.sharedWithId, users.id))
      .where(and(eq(shares.resourceId, resourceId), eq(shares.resourceType, resourceType)))

    return result.map((r) => ({
      ...this.mapToShare(r.share),
      sharedWith: {
        id: r.sharedWith.id,
        username: r.sharedWith.username,
        name: r.sharedWith.name,
        avatarUrl: r.sharedWith.avatarUrl ?? undefined,
        avatarColor: r.sharedWith.avatarColor,
      },
    }))
  }

  async findBySharedWith(userId: string): Promise<Share[]> {
    const result = await db
      .select()
      .from(shares)
      .where(eq(shares.sharedWithId, userId))
    return result.map(this.mapToShare)
  }

  async findBySharedWithWithOwner(userId: string): Promise<(Share & { owner: { id: string; username: string; name: string; avatarUrl?: string; avatarColor?: string } })[]> {
    const result = await db
      .select({
        share: shares,
        owner: {
          id: users.id,
          username: users.username,
          name: users.name,
          avatarUrl: users.avatarUrl,
          avatarColor: users.avatarColor,
        },
      })
      .from(shares)
      .innerJoin(users, eq(shares.ownerId, users.id))
      .where(eq(shares.sharedWithId, userId))

    return result.map((r) => ({
      ...this.mapToShare(r.share),
      owner: {
        id: r.owner.id,
        username: r.owner.username,
        name: r.owner.name,
        avatarUrl: r.owner.avatarUrl ?? undefined,
        avatarColor: r.owner.avatarColor,
      },
    }))
  }

  async findByOwner(ownerId: string): Promise<Share[]> {
    const result = await db.select().from(shares).where(eq(shares.ownerId, ownerId))
    return result.map(this.mapToShare)
  }

  async findExisting(
    resourceId: string,
    resourceType: ResourceType,
    sharedWithId: string
  ): Promise<Share | null> {
    const result = await db
      .select()
      .from(shares)
      .where(
        and(
          eq(shares.resourceId, resourceId),
          eq(shares.resourceType, resourceType),
          eq(shares.sharedWithId, sharedWithId)
        )
      )
      .limit(1)
    return result[0] ? this.mapToShare(result[0]) : null
  }

  async create(
    ownerId: string,
    sharedWithId: string,
    input: Omit<ShareCreateInput, 'username'>
  ): Promise<Share> {
    const id = nanoid()
    const now = new Date()

    await db.insert(shares).values({
      id,
      resourceId: input.resourceId,
      resourceType: input.resourceType,
      ownerId,
      sharedWithId,
      permission: input.permission,
      createdAt: now,
    })

    return {
      id,
      resourceId: input.resourceId,
      resourceType: input.resourceType as ResourceType,
      ownerId,
      sharedWithId,
      permission: input.permission as Permission,
      createdAt: now,
    }
  }

  async updatePermission(id: string, permission: Permission): Promise<Share | null> {
    await db.update(shares).set({ permission }).where(eq(shares.id, id))
    return this.findById(id)
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(shares).where(eq(shares.id, id))
    return result.changes > 0
  }

  async deleteByResource(resourceId: string, resourceType: ResourceType): Promise<number> {
    const result = await db
      .delete(shares)
      .where(and(eq(shares.resourceId, resourceId), eq(shares.resourceType, resourceType)))
    return result.changes
  }

  async hasAccess(
    userId: string,
    resourceId: string,
    resourceType: ResourceType,
    requiredPermission: Permission = 'read'
  ): Promise<boolean> {
    const permissionLevels: Record<Permission, number> = {
      read: 1,
      edit: 2,
      admin: 3,
    }

    const permission = await this.getEffectivePermission(userId, resourceId, resourceType)
    return permission !== null && permissionLevels[permission] >= permissionLevels[requiredPermission]
  }

  /** Upload access follows the same live folder inheritance as the note itself. */
  async hasAccessToUpload(userId: string, filename: string): Promise<boolean> {
    const references = await db.select({ noteId: notes.id, ownerId: notes.ownerId })
      .from(noteUploads).innerJoin(notes, eq(notes.id, noteUploads.noteId))
      .where(and(eq(noteUploads.filename, filename), eq(notes.isDeleted, false)))
    for (const reference of references) {
      if (reference.ownerId === userId || await this.hasAccess(userId, reference.noteId, 'note')) return true
    }
    return false
  }

  private mapToShare(row: typeof shares.$inferSelect): Share {
    return {
      id: row.id,
      resourceId: row.resourceId,
      resourceType: row.resourceType as ResourceType,
      ownerId: row.ownerId,
      sharedWithId: row.sharedWithId,
      permission: row.permission as Permission,
      createdAt: row.createdAt,
    }
  }
}

export const shareRepository = new ShareRepository()
