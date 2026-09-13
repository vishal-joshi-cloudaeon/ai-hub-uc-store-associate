import { Router, type ErrorRequestHandler } from 'express'
import axios, { AxiosError } from 'axios'

// approvals-service is a separate Azure Web App — the browser can't call it
// cross-origin directly in this deployment (see cluster-head design note:
// keeping this same-origin through this app's own backend avoids exposing
// approvals-service's URL/CORS to the browser at all). So this app's own
// backend proxies the call instead, server-to-server, authenticating with a
// shared API key (APPROVALS_API_KEY, set identically on both Web Apps) that
// approvals-service checks on its /api/approvals routes.
const APPROVALS_SERVICE_URL = (process.env.APPROVALS_SERVICE_URL || '').replace(/\/+$/, '')
const APPROVALS_API_KEY = process.env.APPROVALS_API_KEY || ''

export const approvalsProxyRouter = Router()

approvalsProxyRouter.all('*', async (req, res, next) => {
  try {
    if (!APPROVALS_SERVICE_URL) {
      throw new Error('APPROVALS_SERVICE_URL is not configured on this app.')
    }
    const response = await axios({
      method: req.method,
      url: `${APPROVALS_SERVICE_URL}${req.url}`,
      data: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      headers: { 'X-Api-Key': APPROVALS_API_KEY, 'Content-Type': 'application/json' },
      validateStatus: () => true,
    })
    res.status(response.status).json(response.data)
  } catch (err) {
    next(err)
  }
})

export const approvalsProxyErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AxiosError && err.response) {
    res.status(err.response.status).json(err.response.data)
    return
  }
  console.error(err)
  res.status(500).json({ error: { message: err instanceof Error ? err.message : 'Unknown error' } })
}
