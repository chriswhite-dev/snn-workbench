import 'dotenv/config'
import express, { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import path from 'path'
import { generalRateLimit } from './middleware/rateLimit'
import networksRouter from './routes/networks'
import runsRouter from './routes/runs'
import votesRouter from './routes/votes'

const app = express()
const PORT = process.env.PORT ?? 3001

app.set('trust proxy', 1)

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }))
app.use(express.json({ limit: '100kb' }))
app.use(generalRateLimit)

app.use('/uploads', express.static(path.resolve(process.env.UPLOADS_DIR ?? './uploads')))

app.use('/api/networks', networksRouter)
app.use('/api/runs', runsRouter)
app.use('/api/votes', votesRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

// Four parameters required — Express uses arity to identify error handlers.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled route error:', err)
  if (res.headersSent) return
  res.status(500).json({ error: 'Internal server error' })
})

const server = app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`)
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`)
  } else {
    console.error('Server error:', err)
  }
  process.exit(1)
})

export default app
