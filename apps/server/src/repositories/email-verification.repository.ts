import { eq, and, gt, lt } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db, schema } from '../db/index.js'

const { emailVerificationTokens } = schema

export interface EmailVerificationToken {
  id: string
  userId: string
  email: string
  tokenHash: string
  expiresAt: Date
  createdAt: Date
}

export class EmailVerificationRepository {
  async consumeAndVerify(tokenHash: string): Promise<{ userId: string; email: string } | null> {
    return db.transaction((tx) => {
      const now = new Date()
      const token = tx.select().from(emailVerificationTokens).where(and(
        eq(emailVerificationTokens.tokenHash, tokenHash), gt(emailVerificationTokens.expiresAt, now)
      )).get()
      if (!token) return null
      tx.update(schema.users).set({ email: token.email, emailVerified: true, updatedAt: now })
        .where(eq(schema.users.id, token.userId)).run()
      tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, token.userId)).run()
      return { userId: token.userId, email: token.email }
    })
  }

  async create(userId: string, email: string, tokenHash: string, expiresAt: Date): Promise<void> {
    const now = new Date()
    const id = nanoid()

    // Delete any existing tokens for this user
    await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId))

    await db.insert(emailVerificationTokens).values({
      id,
      userId,
      email: email.toLowerCase(),
      tokenHash,
      expiresAt,
      createdAt: now,
    })
  }

  async findValidByHash(tokenHash: string): Promise<EmailVerificationToken | null> {
    const now = new Date()
    const result = await db
      .select()
      .from(emailVerificationTokens)
      .where(
        and(eq(emailVerificationTokens.tokenHash, tokenHash), gt(emailVerificationTokens.expiresAt, now))
      )
      .limit(1)

    return result[0] ?? null
  }

  async delete(id: string): Promise<void> {
    await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, id))
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId))
  }

  async cleanupExpired(): Promise<number> {
    const now = new Date()
    const result = await db
      .delete(emailVerificationTokens)
      .where(lt(emailVerificationTokens.expiresAt, now))

    return result.changes
  }
}

export const emailVerificationRepository = new EmailVerificationRepository()
