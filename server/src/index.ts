import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { agentProxyRouter, agentProxyErrorHandler } from './agentProxy.js'

const app = express()
const PORT = Number(process.env.PORT || 8787)
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173'

app.use(cors({ origin: CORS_ORIGIN }))
app.use(express.json())

app.get('/healthz', (_req, res) => res.json({ ok: true }))

app.use('/agent', agentProxyRouter)
app.use(agentProxyErrorHandler)

app.listen(PORT, () => {
  console.log(`loyalty-agent-proxy listening on :${PORT} (CORS origin: ${CORS_ORIGIN})`)
})
