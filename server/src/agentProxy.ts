import { Router, type ErrorRequestHandler } from 'express'
import axios, { AxiosError, type AxiosInstance } from 'axios'
import { getAccessToken } from './azureToken.js'

type EnvName = 'dev' | 'prod'

type FoundryEnvConfig = {
  endpoint: string
  agentId: string
}

const API_VERSION = process.env.FOUNDRY_API_VERSION || '2025-05-15-preview'

// One AAD identity (DefaultAzureCredential, see azureToken.ts) is shared
// across both environments — it needs RBAC on both Foundry projects. Each
// environment's endpoint/agent id are separate config, resolved per request
// from the `env` field the frontend sends, so one running proxy instance
// serves both /dev and /prod routes.
const ENV_CONFIG: Record<EnvName, FoundryEnvConfig> = {
  dev: {
    endpoint: (process.env.FOUNDRY_AGENT_ENDPOINT_DEV || '').replace(/\/+$/, ''),
    agentId: process.env.FOUNDRY_AGENT_ID_DEV || '',
  },
  prod: {
    endpoint: (process.env.FOUNDRY_AGENT_ENDPOINT_PROD || '').replace(/\/+$/, ''),
    agentId: process.env.FOUNDRY_AGENT_ID_PROD || '',
  },
}

function resolveEnv(value: unknown): EnvName {
  return value === 'prod' ? 'prod' : 'dev'
}

function getConfig(env: EnvName): FoundryEnvConfig {
  const config = ENV_CONFIG[env]
  if (!config.endpoint || !config.agentId) {
    throw new Error(
      `Foundry "${env}" environment is not configured. Set FOUNDRY_AGENT_ENDPOINT_${env.toUpperCase()} ` +
        `and FOUNDRY_AGENT_ID_${env.toUpperCase()} in server/.env.`
    )
  }
  return config
}

const foundryClients = new Map<string, AxiosInstance>()
function getFoundryClient(baseURL: string): AxiosInstance {
  let client = foundryClients.get(baseURL)
  if (!client) {
    client = axios.create({ baseURL })
    foundryClients.set(baseURL, client)
  }
  return client
}

export const agentProxyRouter = Router()

// This agent is invoked through Azure AI Foundry's Responses API
// (POST /openai/responses), not the classic Assistants threads/runs API —
// the agent's own "Agent ID" isn't an `asst_...` id, it's a plain
// agent_reference by name. Multi-turn continuity is a `previous_response_id`
// pointer (like the old Assistants API's thread id, but stateless on our
// side — the frontend just carries the last response's id forward).
agentProxyRouter.post('/responses', async (req, res, next) => {
  try {
    const env = resolveEnv(req.body.env)
    const { endpoint, agentId } = getConfig(env)
    const token = await getAccessToken()
    const body: Record<string, unknown> = {
      agent: { type: 'agent_reference', name: agentId },
      input: req.body.input,
    }
    if (req.body.previous_response_id) {
      body.previous_response_id = req.body.previous_response_id
    }

    const { data } = await getFoundryClient(endpoint).post('/openai/responses', body, {
      params: { 'api-version': API_VERSION },
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

export const agentProxyErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AxiosError && err.response) {
    // Pass Foundry's own status/body straight through — the frontend's
    // detectState/error handling already expects a plain error message.
    res.status(err.response.status).json(err.response.data)
    return
  }
  console.error(err)
  res.status(500).json({ error: { message: err instanceof Error ? err.message : 'Unknown error' } })
}
