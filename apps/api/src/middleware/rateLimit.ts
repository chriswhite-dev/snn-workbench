import rateLimit from 'express-rate-limit'
import type { Request } from 'express'

// Prevents all requests sharing a bucket when req.ip is undefined (trust proxy misconfigured).
function ipKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

export const generalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'Too many requests, please slow down.' },
})

export const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'Upload limit reached. You may upload 5 networks per hour.' },
})

export const voteRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'Vote limit reached for today.' },
})

export const flagRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'Flag limit reached.' },
})

export const runRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'Run limit reached. Please slow down.' },
})
