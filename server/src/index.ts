import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { agentProxyRouter, agentProxyErrorHandler } from './agentProxy.js'
import { approvalsRouter } from './approvals/approvalsRouter.js'
import { toolsRouter } from './approvals/toolsRouter.js'
import { approvalsErrorHandler } from './approvals/http.js'
import { startDatabricksTokenRefresh } from './approvals/databricks.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// The built React app (`npm run build` -> dist/public), served by this same
// process so the whole thing deploys as one Azure Web App. In local dev the
// frontend runs on Vite's own server instead and proxies /agent, /api and
// /tools back here (see vite.config.ts), so this directory is simply absent.
const STATIC_DIR = path.join(__dirname, '../public')

const app = express()
const PORT = Number(process.env.PORT || process.env.WEBSITES_PORT || 8787)
// Everything is same-origin in the combined app, so CORS is off unless an
// origin is explicitly configured (e.g. to keep a separately hosted frontend
// working during a migration).
const CORS_ORIGIN = process.env.CORS_ORIGIN || ''

if (CORS_ORIGIN) {
  app.use(cors({ origin: CORS_ORIGIN, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'] }))
}
app.use(express.json())

app.get('/healthz', (_req, res) => res.json({ ok: true }))

// Azure AI Foundry agent proxy — holds this app's Azure identity so no token
// or subscription key ever reaches the browser.
app.use('/agent', agentProxyRouter)
app.use('/agent', agentProxyErrorHandler)

// Cluster-head approvals API, read/written by the SPA (same origin).
app.use('/api/approvals', approvalsRouter)
app.use('/api/approvals', approvalsErrorHandler)

// OpenAPI tool endpoints the Foundry Loyalty-Agent calls directly.
app.use('/tools', toolsRouter)
app.use('/tools', approvalsErrorHandler)

// Serve the built frontend (if present) with a SPA fallback, so this one
// process is the app's single public listener.
app.use(express.static(STATIC_DIR))
app.get('*', (req, res, next) => {
  if (/^\/(agent|api|tools|healthz)\b/.test(req.path)) return next()
  res.sendFile(path.join(STATIC_DIR, 'index.html'), (err) => err && next(err))
})

startDatabricksTokenRefresh()

app.listen(PORT, () => {
  console.log(`uc-store-associate listening on :${PORT}${CORS_ORIGIN ? ` (CORS origin: ${CORS_ORIGIN})` : ''}`)
})
