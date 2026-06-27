import { Router, Request, Response } from 'express'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import { eq, ilike, desc, sql, and, or, getTableColumns } from 'drizzle-orm'
import { db } from '../db/client'
import { networks } from '../db/schema'
import { validateRispNetwork } from '../validators/rispNetwork'
import { uploadNetworkFile } from '../storage/r2'
import { uploadRateLimit, flagRateLimit } from '../middleware/rateLimit'
import type { NetworkMeta } from '@risp/shared/types'

const router = Router()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.match(/\.json$/i)) {
      return cb(new Error('Only .json files are accepted'))
    }
    cb(null, true)
  },
})

// Wraps multer so file-filter and size errors surface as 400 JSON instead of 500.
function uploadSingle(req: Request, res: Response, next: () => void) {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 5 MB limit' : err.message })
      return
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message })
      return
    }
    next()
  })
}

// Correlated subquery for upvotes — uses quoted identifiers directly because
// Drizzle treats interpolated Column objects as bound parameters, not SQL refs.
const voteCountSub = sql<number>`(SELECT COUNT(*) FROM "votes" WHERE "votes"."network_id" = "networks"."id" AND "votes"."direction" = 'up')`

function rowToMeta(row: typeof networks.$inferSelect & { vote_count: number; user_voted: number }): NetworkMeta {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    submitter_name: row.submitter_name,
    file_url: row.file_url,
    neuron_count: row.neuron_count,
    synapse_count: row.synapse_count,
    tags: row.tags,
    run_count: row.run_count,
    vote_count: Number(row.vote_count),
    user_voted: Number(row.user_voted) > 0,
    created_at: row.created_at.toISOString(),
  }
}

export function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + (process.env.IP_SALT ?? 'risp')).digest('hex')
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20)
    const offset = (page - 1) * limit
    const search = ((req.query.search as string) || '').slice(0, 128)
    const sortParam = req.query.sort as string
    const sort = sortParam === 'run_count' ? 'run_count' : sortParam === 'vote_count' ? 'vote_count' : 'created_at'

    const searchFilter = search
      ? or(
          ilike(networks.name, `%${search}%`),
          sql`EXISTS (SELECT 1 FROM unnest(${networks.tags}) AS t WHERE t ILIKE ${`%${search}%`})`
        )
      : undefined

    const where = searchFilter
      ? and(eq(networks.flagged, false), searchFilter)
      : eq(networks.flagged, false)

    const orderCol = sort === 'run_count'
      ? desc(networks.run_count)
      : sort === 'vote_count'
        ? desc(voteCountSub)
        : desc(networks.created_at)

    const ip_hash = hashIp(req.ip ?? '0.0.0.0')
    const userVotedSub = sql<number>`(SELECT COUNT(*) FROM "votes" WHERE "votes"."network_id" = "networks"."id" AND "votes"."ip_hash" = ${ip_hash})`
    const cols = { ...getTableColumns(networks), vote_count: voteCountSub, user_voted: userVotedSub }

    const [rows, countResult] = await Promise.all([
      db.select(cols).from(networks).where(where).orderBy(orderCol).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(networks).where(where),
    ])

    res.json({
      data: rows.map(rowToMeta),
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      res.status(404).json({ error: 'Network not found' })
      return
    }
    const ip_hash = hashIp(req.ip ?? '0.0.0.0')
    const userVotedSub = sql<number>`(SELECT COUNT(*) FROM "votes" WHERE "votes"."network_id" = "networks"."id" AND "votes"."ip_hash" = ${ip_hash})`
    const row = await db
      .select({ ...getTableColumns(networks), vote_count: voteCountSub, user_voted: userVotedSub })
      .from(networks)
      .where(eq(networks.id, req.params.id))
      .limit(1)
    if (!row[0] || row[0].flagged) {
      res.status(404).json({ error: 'Network not found' })
      return
    }
    res.json({ data: rowToMeta(row[0]) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post(
  '/',
  uploadRateLimit,
  uploadSingle,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const name = (req.body.name as string | undefined)?.trim()
      const submitter_name = (req.body.submitter_name as string | undefined)?.trim()
      const description = (req.body.description as string | undefined)?.trim()
      const tags = (req.body.tags as string | undefined)?.trim()

      if (!name || !submitter_name) {
        res.status(400).json({ error: 'name and submitter_name are required' })
        return
      }
      if (name.length > 255) {
        res.status(400).json({ error: 'name must be 255 characters or fewer' })
        return
      }
      if (submitter_name.length > 100) {
        res.status(400).json({ error: 'submitter_name must be 100 characters or fewer' })
        return
      }
      if (description && description.length > 1000) {
        res.status(400).json({ error: 'description must be 1000 characters or fewer' })
        return
      }
      if (tags && tags.length > 500) {
        res.status(400).json({ error: 'tags string must be 500 characters or fewer' })
        return
      }

      if (!req.file) {
        res.status(400).json({ error: 'file is required' })
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(req.file.buffer.toString('utf-8'))
      } catch {
        res.status(400).json({ error: 'File is not valid JSON' })
        return
      }

      const validation = validateRispNetwork(parsed)
      if (!validation.success) {
        res.status(422).json({ errors: validation.errors })
        return
      }

      const network = validation.data
      const id = uuidv4()
      const filename = `${id}.json`
      const fileUrl = await uploadNetworkFile(req.file.buffer, filename)

      const tagList = tags
        ? tags.split(',').map(t => t.trim().slice(0, 50)).filter(Boolean).slice(0, 20)
        : []

      const [row] = await db.insert(networks).values({
        id,
        name,
        description,
        submitter_name,
        file_url: fileUrl,
        neuron_count: network.Nodes.length,
        synapse_count: network.Edges.length,
        tags: tagList,
        run_count: 0,
        flagged: false,
        created_at: new Date(),
      }).returning()

      res.status(201).json({ data: rowToMeta({ ...row, vote_count: 0, user_voted: 0 }) })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

router.delete('/:id/flag', flagRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      res.status(404).json({ error: 'Network not found' })
      return
    }
    // Check the network exists before updating so we can return 404 on unknown IDs
    // instead of silently succeeding.
    const row = await db.select({ id: networks.id }).from(networks).where(eq(networks.id, req.params.id)).limit(1)
    if (!row[0]) {
      res.status(404).json({ error: 'Network not found' })
      return
    }
    await db.update(networks).set({ flagged: true }).where(eq(networks.id, req.params.id))
    res.json({ data: { flagged: true } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
