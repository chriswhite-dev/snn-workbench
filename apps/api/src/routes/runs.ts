import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { runs, networks } from '../db/schema'
import { hashIp } from './networks'
import { runRateLimit } from '../middleware/rateLimit'

const router = Router()

const RunBody = z.object({
  network_id: z.string().uuid(),
  params_used: z.record(z.union([z.string().max(256), z.number(), z.boolean(), z.null()]))
    .refine(obj => Object.keys(obj).length <= 50, 'params_used exceeds 50 keys')
    .optional().default({}),
  timesteps: z.number().int().positive().max(100_000),
  spike_count: z.number().int().min(0).max(1_000_000_000),
})

router.post('/', runRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = RunBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ errors: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`) })
      return
    }

    const { network_id, params_used, timesteps, spike_count } = parsed.data

    const net = await db.select().from(networks).where(eq(networks.id, network_id)).limit(1)
    if (!net[0] || net[0].flagged) {
      res.status(404).json({ error: 'Network not found' })
      return
    }

    const ip = req.ip ?? '0.0.0.0'
    const ip_hash = hashIp(ip)
    const id = uuidv4()

    // Use a transaction so the run insert and run_count increment are atomic.
    // A crash between the two statements would otherwise leave the count wrong.
    await db.transaction(async (tx) => {
      await tx.insert(runs).values({ id, network_id, params_used, timesteps, spike_count, ip_hash, created_at: new Date() })
      await tx.update(networks).set({ run_count: sql`${networks.run_count} + 1` }).where(eq(networks.id, network_id))
    })

    res.status(201).json({ data: { id, network_id, timesteps, spike_count } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
