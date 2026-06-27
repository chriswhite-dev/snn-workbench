import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { votes, networks } from '../db/schema'
import { voteRateLimit } from '../middleware/rateLimit'
import { hashIp } from './networks'

const router = Router()

const VoteBody = z.object({
  network_id: z.string().uuid(),
  direction: z.literal('up'),
})

router.post('/', voteRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = VoteBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ errors: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`) })
      return
    }

    const { network_id, direction } = parsed.data
    const net = await db.select().from(networks).where(eq(networks.id, network_id)).limit(1)
    if (!net[0] || net[0].flagged) {
      res.status(404).json({ error: 'Network not found' })
      return
    }

    const ip_hash = hashIp(req.ip ?? '0.0.0.0')

    // Atomic upsert: the DB schema has UNIQUE(network_id, ip_hash), so concurrent requests
    // from the same IP are safely handled by the conflict clause instead of a SELECT-then-write.
    await db.insert(votes)
      .values({ id: uuidv4(), network_id, ip_hash, direction, created_at: new Date() })
      .onConflictDoUpdate({
        target: [votes.network_id, votes.ip_hash],
        set: { direction, created_at: new Date() },
      })

    res.json({ data: { direction } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

const UnvoteBody = z.object({ network_id: z.string().uuid() })

router.delete('/', voteRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = UnvoteBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ errors: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`) })
      return
    }

    const { network_id } = parsed.data
    const ip_hash = hashIp(req.ip ?? '0.0.0.0')

    await db.delete(votes).where(and(eq(votes.network_id, network_id), eq(votes.ip_hash, ip_hash)))

    res.json({ data: { removed: true } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
