import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { env } from '../config/env.js'
import { AuthError } from '../services/auth.service.js'
import { NotesServiceError } from '../services/notes.service.js'
import { FoldersServiceError } from '../services/folders.service.js'
import { TagsServiceError } from '../services/tags.service.js'
import { SharingServiceError } from '../services/sharing.service.js'
import { TwoFactorError } from '../services/two-factor.service.js'
import { EmailVerificationError } from '../services/email-verification.service.js'
import { ExportServiceError } from '../services/export.service.js'
import { SparksServiceError } from '../services/sparks.service.js'
import { PagesServiceError } from '../services/pages.service.js'
import { CommentsServiceError } from '../services/comments.service.js'
import { RecapsServiceError } from '../services/recaps.service.js'
import { logger } from '../utils/logger.js'

export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 400,
    public details?: Record<string, string[]>
  ) {
    super(message)
    this.name = 'AppError'
  }
}

function expectedStatus(err: Error): number | undefined {
  if (err instanceof ZodError) return 400
  if (
    err instanceof AppError || err instanceof AuthError ||
    err instanceof NotesServiceError || err instanceof FoldersServiceError ||
    err instanceof TagsServiceError || err instanceof SharingServiceError ||
    err instanceof TwoFactorError || err instanceof EmailVerificationError ||
    err instanceof ExportServiceError || err instanceof SparksServiceError ||
    err instanceof PagesServiceError || err instanceof CommentsServiceError ||
    err instanceof RecapsServiceError
  ) return err.statusCode
  return undefined
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const statusCode = expectedStatus(err)
  const context = { path: req.path, method: req.method, statusCode: statusCode ?? 500 }
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    // Rejected credentials, expired sessions and invalid inputs are handled
    // requests. Login failures already have a separate security warning.
    logger.debug('Request rejected', context)
  } else {
    logger.error(statusCode === undefined ? 'Unhandled error' : 'Request failed', err, context)
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    })
  }

  if (err instanceof PagesServiceError || err instanceof CommentsServiceError || err instanceof RecapsServiceError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
      timestamp: new Date().toISOString(),
      path: req.path,
    })
  }

  if (err instanceof AuthError) {
    if (err.statusCode === 429 && err.rateLimitInfo?.retryAfter) {
      res.set('Retry-After', String(err.rateLimitInfo.retryAfter))
    }
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        rateLimitInfo: err.rateLimitInfo,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    })
  }

  if (err instanceof NotesServiceError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    })
  }

  if (err instanceof FoldersServiceError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    })
  }

  if (err instanceof TagsServiceError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    })
  }

  if (err instanceof SharingServiceError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    })
  }

  if (err instanceof TwoFactorError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    })
  }

  if (err instanceof EmailVerificationError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    })
  }

  if (err instanceof ExportServiceError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    })
  }

  if (err instanceof SparksServiceError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    })
  }

  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {}
    err.issues.forEach((e) => {
      const path = e.path.join('.')
      if (!details[path]) details[path] = []
      details[path].push(e.message)
    })

    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    })
  }

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
    },
    timestamp: new Date().toISOString(),
    path: req.path,
  })
}
