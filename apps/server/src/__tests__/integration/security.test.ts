import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import express, { type Request, type Response, type NextFunction } from 'express'
import { eq } from 'drizzle-orm'

vi.mock('../../db/index.js', async () => {
  const { createTestDb } = await import('../helpers/test-db.js')
  const schema = await import('../../db/schema.js')
  const { db, sqlite } = createTestDb()
  return { db, schema, rawDb: sqlite }
})
vi.mock('../../config/env.js', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'onyka-security-'))
  return { env: { JWT_SECRET: 'a'.repeat(64), JWT_ACCESS_EXPIRY: '15m', JWT_REFRESH_EXPIRY_DAYS: 30,
    DATABASE_URL: path.join(directory, 'test.db'), NODE_ENV: 'test' } }
})
vi.mock('../../middleware/auth.js', () => ({ authenticate: (req: Request, _res: Response, next: NextFunction) => {
  req.userId = String(req.headers['x-test-user'] || 'owner')
  req.user = { role: req.userId === 'admin' ? 'admin' : 'user' } as Request['user']
  next()
} }))
vi.mock('../../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { db, schema, rawDb } from '../../db/index.js'
import { passwordResetService } from '../../services/password-reset.service.js'
import { emailService } from '../../services/email.service.js'
import { tokenService } from '../../services/token.service.js'
import { refreshTokenRepository } from '../../repositories/refresh-token.repository.js'
import { twoFactorRepository } from '../../repositories/two-factor.repository.js'
import { recoveryCodeRepository } from '../../repositories/recovery-code.repository.js'
import { passwordResetRepository } from '../../repositories/password-reset.repository.js'
import { emailVerificationRepository } from '../../repositories/email-verification.repository.js'
import { noteUploadRepository } from '../../repositories/note-upload.repository.js'
import { notesService } from '../../services/notes.service.js'
import { pagesService } from '../../services/pages.service.js'
import { extractUploadFilenames } from '../../utils/upload-refs.js'
import { getUploadsDir, trackUpload, validateFileContent, getUploadPath } from '../../services/uploads.service.js'
import uploadsRouter from '../../routes/uploads.routes.js'
import authRouter from '../../routes/auth.routes.js'
import { AppError, errorHandler } from '../../middleware/error.js'
import { passwordService } from '../../services/password.service.js'
import { logger } from '../../utils/logger.js'

const app = express()
app.use(express.json())
app.use('/uploads', uploadsRouter)
app.use('/auth', authRouter)
app.get('/unexpected-error', (_req, _res, next) => next(new Error('Unexpected test failure')))
app.get('/service-error', (_req, _res, next) => next(new AppError('UNAVAILABLE', 'Service unavailable', 503)))
app.use(errorHandler)
const http = createServer(app)
let base: string
const now = () => new Date()
const future = () => new Date(Date.now() + 600000)
const upload = (filename: string, size = 12) => ({ filename, size, mimetype: 'image/png', originalname: filename } as Express.Multer.File)

beforeAll(async () => {
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  base = `http://127.0.0.1:${address.port}`
})
beforeEach(() => {
  vi.clearAllMocks()
  for (const table of ['note_uploads', 'uploads', 'shares', 'note_pages', 'notes', 'folders', 'refresh_tokens',
    'revoked_access_tokens', 'trusted_devices', 'password_reset_tokens', 'email_verification_tokens', 'email_otp_codes', 'recovery_codes', 'login_attempts', 'users']) {
    rawDb.prepare(`DELETE FROM ${table}`).run()
  }
  for (const id of ['owner', 'reader', 'attacker', 'admin']) db.insert(schema.users).values({
    id, username: id, name: id, passwordHash: 'old-hash', trackingEnabled: false, createdAt: now(), updatedAt: now(),
  }).run()
})
afterAll(async () => {
  await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()))
  rawDb.close()
  const root = resolve(getUploadsDir(), '..')
  if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith('onyka-security-')) throw new Error('Unsafe test cleanup path')
  rmSync(root, { recursive: true, force: true })
})

describe('Expected authentication failures', () => {
  it('rejects a wrong password without logging an unhandled server error', async () => {
    const passwordHash = await passwordService.hash('CorrectPassword2026!')
    db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, 'owner')).run()
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'WrongPassword2026!' }),
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } })
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('Login failed', expect.objectContaining({ username: 'owner' }))
    expect(rawDb.prepare('SELECT success FROM login_attempts').all()).toEqual([{ success: 0 }])
  })

  it('handles a missing refresh cookie as an expected rejected request', async () => {
    const response = await fetch(`${base}/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'MISSING_REFRESH_TOKEN' } })
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledWith('Request rejected', expect.objectContaining({ statusCode: 400 }))
  })

  it('handles invalid login input without a server-error stack trace', async () => {
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '', password: '' }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('continues logging unexpected server errors with their exception', async () => {
    const response = await fetch(`${base}/unexpected-error`)
    expect(response.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith('Unhandled error', expect.any(Error),
      expect.objectContaining({ path: '/unexpected-error', statusCode: 500 }))
  })

  it('does not silence handled service failures with status 500 or above', async () => {
    const response = await fetch(`${base}/service-error`)
    expect(response.status).toBe(503)
    expect(logger.error).toHaveBeenCalledWith('Request failed', expect.any(AppError),
      expect.objectContaining({ path: '/service-error', statusCode: 503 }))
  })
})

describe('Revocable login sessions', () => {
  it('immediately rejects access tokens after individual session revocation', async () => {
    const first = await tokenService.generateTokenPair('owner', 'owner')
    const second = await tokenService.generateTokenPair('owner', 'owner')
    const payload = await tokenService.verifyAccessToken(first.accessToken)
    expect(payload?.sid).toBeTruthy()
    expect(await tokenService.revokeSession(payload!.sid, 'attacker')).toBe(false)
    expect(await tokenService.revokeSession(payload!.sid, 'owner')).toBe(true)
    expect(await tokenService.verifyAccessToken(first.accessToken)).toBeNull()
    expect(await tokenService.verifyAccessToken(second.accessToken)).not.toBeNull()
  })
  it('rotates atomically without extending short sessions or revoking other devices', async () => {
    const pair = await tokenService.generateTokenPair('owner', 'owner')
    const other = await tokenService.generateTokenPair('owner', 'owner')
    const original = await refreshTokenRepository.findByTokenHash(tokenService.hashToken(pair.refreshToken))
    const results = await Promise.all([tokenService.rotateRefreshToken(pair.refreshToken, 'owner'), tokenService.rotateRefreshToken(pair.refreshToken, 'owner')])
    expect(results.filter(Boolean)).toHaveLength(1)
    const rotated = await refreshTokenRepository.findByTokenHash(tokenService.hashToken(results.find(Boolean)!))
    expect(rotated?.id).toBe(original?.id)
    expect(rotated?.expiresAt).toEqual(original?.expiresAt)
    expect(await tokenService.verifyAccessToken(pair.accessToken)).not.toBeNull()
    expect(await tokenService.verifyAccessToken(other.accessToken)).not.toBeNull()
    expect(await tokenService.verifyRefreshToken(pair.refreshToken)).toBeNull()
  })
  it('invalidates all access tokens and trusted devices on global revocation', async () => {
    const pair = await tokenService.generateTokenPair('owner', 'owner')
    rawDb.prepare('INSERT INTO trusted_devices(id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)')
      .run('device', 'owner', 'trusted', Math.floor(future().getTime() / 1000), Math.floor(Date.now() / 1000))
    await tokenService.revokeAllUserTokens('owner')
    expect(await tokenService.verifyAccessToken(pair.accessToken)).toBeNull()
    expect(rawDb.prepare('SELECT * FROM trusted_devices').all()).toHaveLength(0)
  })
})

describe('One-time credentials under concurrent requests', () => {
  it('never sends password-reset links to an unverified email address', async () => {
    db.update(schema.users).set({ email: 'unverified@example.com', emailVerified: false }).where(eq(schema.users.id, 'owner')).run()
    const send = vi.spyOn(emailService, 'sendPasswordReset').mockResolvedValue(true)
    await passwordResetService.requestReset('owner')
    expect(send).not.toHaveBeenCalled()
    expect(rawDb.prepare('SELECT * FROM password_reset_tokens').all()).toHaveLength(0)
    send.mockRestore()
  })
  it('keeps only one active OTP when codes are issued concurrently', async () => {
    await Promise.all([twoFactorRepository.createOtpCode('owner', 'first', 'login', future()), twoFactorRepository.createOtpCode('owner', 'second', 'login', future())])
    expect(rawDb.prepare('SELECT code FROM email_otp_codes').all()).toEqual([{ code: 'second' }])
  })
  it('consumes an OTP once and enforces the failure limit atomically', async () => {
    await twoFactorRepository.createOtpCode('owner', 'hash', 'login', future())
    expect(await Promise.all([twoFactorRepository.consumeCode('owner', 'login', 'hash'), twoFactorRepository.consumeCode('owner', 'login', 'hash')])).toEqual([true, false])
    await twoFactorRepository.createOtpCode('owner', 'hash', 'login', future())
    await Promise.all(Array.from({ length: 10 }, () => twoFactorRepository.consumeCode('owner', 'login', 'wrong')))
    expect(await twoFactorRepository.consumeCode('owner', 'login', 'hash')).toBe(false)
    expect(rawDb.prepare('SELECT attempts FROM email_otp_codes').get()).toEqual({ attempts: 5 })
  })
  it('does not accept expired OTPs or recovery-code replay', async () => {
    await twoFactorRepository.createOtpCode('owner', 'hash', 'login', new Date(0))
    expect(await twoFactorRepository.consumeCode('owner', 'login', 'hash')).toBe(false)
    await recoveryCodeRepository.create('owner', 'recovery')
    expect(await Promise.all([recoveryCodeRepository.consumeCode('owner', 'recovery'), recoveryCodeRepository.consumeCode('owner', 'recovery')])).toEqual([true, false])
  })
  it('resets the password once, invalidates reset links and all existing sessions', async () => {
    const pair = await tokenService.generateTokenPair('owner', 'owner')
    await passwordResetRepository.create('owner', 'reset', future())
    await passwordResetRepository.create('owner', 'other-reset', future())
    expect(await Promise.all([passwordResetRepository.consumeAndResetPassword('reset', 'new-hash'), passwordResetRepository.consumeAndResetPassword('reset', 'replayed-hash')])).toEqual([true, false])
    expect(await passwordResetRepository.findValidByHash('other-reset')).toBeNull()
    expect(rawDb.prepare('SELECT password_hash FROM users WHERE id=?').get('owner')).toEqual({ password_hash: 'new-hash' })
    expect(await tokenService.verifyAccessToken(pair.accessToken)).toBeNull()
  })
  it('cannot replay an email-change link to overwrite a newer email', async () => {
    await emailVerificationRepository.create('owner', 'verified@example.com', 'verify', future())
    expect(await emailVerificationRepository.consumeAndVerify('verify')).toEqual({ userId: 'owner', email: 'verified@example.com' })
    expect(await emailVerificationRepository.consumeAndVerify('verify')).toBeNull()
  })
})

describe('Attachment authorization and validation', () => {
  it('recognizes HTML attributes and entities without granting access from plain text', () => {
    expect(extractUploadFilenames('<img src="&#47;api/uploads/image.png"><a href="/api/uploads/image.png">download</a>')).toEqual(['image.png'])
    expect(extractUploadFilenames('<p>/api/uploads/image.png</p><code>&lt;img src="/api/uploads/image.png"&gt;</code><img src="https://evil.test/api/uploads/image.png">')).toEqual([])
  })
  it('cannot turn a guessed file URL into access by saving it in an owned note or page', async () => {
    await trackUpload(upload('private.png'), 'owner')
    const content = '<img src="/api/uploads/private.png">'
    expect(await noteUploadRepository.canReferenceUploads('attacker', content)).toBe(false)
    await expect(notesService.create('attacker', { title: 'Attack', content })).rejects.toMatchObject({ statusCode: 403 })
    const own = await notesService.create('attacker', { title: 'Own note', content: '' })
    await expect(notesService.update(own.id, 'attacker', { content })).rejects.toMatchObject({ statusCode: 403 })
    await expect(pagesService.createPage(own.id, 'attacker', { content })).rejects.toMatchObject({ statusCode: 403 })
    expect(rawDb.prepare('SELECT * FROM note_uploads').all()).toHaveLength(0)
  })
  it('allows attachments through a current share and stops allowing them after revocation', async () => {
    await trackUpload(upload('shared.png'), 'owner')
    const content = '<img src="/api/uploads/shared.png">'
    const note = await notesService.create('owner', { content })
    db.insert(schema.shares).values({ id: 'grant', ownerId: 'owner', sharedWithId: 'reader', resourceId: note.id, resourceType: 'note', permission: 'read', createdAt: now() }).run()
    expect(await noteUploadRepository.canReferenceUploads('reader', content)).toBe(true)
    db.delete(schema.shares).where(eq(schema.shares.id, 'grant')).run()
    expect(await noteUploadRepository.canReferenceUploads('reader', content)).toBe(false)
  })
  it('serializes quota reservations across parallel uploads', async () => {
    const size = 60 * 1024 * 1024
    const results = await Promise.allSettled([trackUpload(upload('large-1.png', size), 'owner'), trackUpload(upload('large-2.png', size), 'owner')])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(rawDb.prepare('SELECT * FROM uploads').all()).toHaveLength(1)
  })
  it('rejects content whose detected format does not match the stored extension', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64')
    writeFileSync(join(getUploadsDir(), 'mismatch.jpg'), png)
    expect(await validateFileContent(upload('mismatch.jpg'))).toMatchObject({ code: 'INVALID_CONTENT' })
    writeFileSync(join(getUploadsDir(), 'valid.png'), png)
    expect(await validateFileContent(upload('valid.png'))).toBeNull()
    expect(getUploadPath('../secret')).toBeNull()
  })
  it('denies untracked files and preserves visibility of current legacy avatars', async () => {
    writeFileSync(join(getUploadsDir(), 'untracked.png'), Buffer.from('private'))
    for (const method of ['GET', 'DELETE']) {
      expect((await fetch(`${base}/uploads/untracked.png`, { method, headers: { 'x-test-user': 'attacker' } })).status).toBe(403)
    }
    writeFileSync(join(getUploadsDir(), 'avatar-legacy.png'), Buffer.from('avatar'))
    db.update(schema.users).set({ avatarUrl: '/api/uploads/avatar-legacy.png' }).where(eq(schema.users.id, 'owner')).run()
    const avatar = await fetch(`${base}/uploads/avatar-legacy.png`, { headers: { 'x-test-user': 'reader' } })
    expect(avatar.status).toBe(200)
    expect(avatar.headers.get('cache-control')).toBe('private, no-store')
    expect(await avatar.text()).toBe('avatar')
    expect((await fetch(`${base}/uploads/avatar-legacy.png`, { method: 'DELETE', headers: { 'x-test-user': 'reader' } })).status).toBe(403)
  })
})
