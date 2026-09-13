import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { agentProxyRouter, agentProxyErrorHandler } from './agentProxy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Populated at deploy time by copying the built React app (root `npm run
// build` output) here — see the deploy steps in the repo root README. Not
// present in local dev, where the frontend runs on its own via `npm run dev`.
const STATIC_DIR = path.join(__dirname, '../public')

const app = express()
const PORT = Number(process.env.DATABRICKS_APP_PORT || process.env.PORT || 8787)
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173'

app.use(cors({ origin: CORS_ORIGIN }))
app.use(express.json())

app.get('/healthz', (_req, res) => res.json({ ok: true }))

app.use('/agent', agentProxyRouter)
app.use(agentProxyErrorHandler)

// Serve the built frontend (if present) with a SPA fallback, so this one
// process can be deployed as the app's single public listener.
app.use(express.static(STATIC_DIR))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/agent')) return next()
  res.sendFile(path.join(STATIC_DIR, 'index.html'), (err) => err && next(err))
})

app.listen(PORT, () => {
  console.log(`loyalty-agent-proxy listening on :${PORT} (CORS origin: ${CORS_ORIGIN})`)
})
