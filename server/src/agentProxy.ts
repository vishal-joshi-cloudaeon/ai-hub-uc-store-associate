import { Router, type ErrorRequestHandler } from 'express'
import axios, { AxiosError, type AxiosInstance } from 'axios'
import { getAccessToken } from './azureToken.js'

type EnvName = 'dev' | 'prod'

// Both environments now go through an APIM "AI Hub" gateway (subscription-key
// auth, its own request/response shape) rather than calling Foundry's
// Responses API directly with AAD — dev via apim-01, prod via apim-02, each
// with its own subscription key. The `aad` variant below is the direct-Foundry
// path; it's kept as a known-good fallback (point FOUNDRY_AGENT_ENDPOINT_* at
// a bare project URL, e.g. https://<resource>.services.ai.azure.com/api/projects/<project>)
// but nothing selects it today.
type FoundryEnvConfig =
  | { authType: 'apimKey'; endpoint: string; agentId: string; subscriptionKey: string }
  | { authType: 'aad'; endpoint: string; agentId: string }

const API_VERSION = process.env.FOUNDRY_API_VERSION || '2025-05-15-preview'

const ENV_CONFIG: Record<EnvName, FoundryEnvConfig> = {
  dev: {
    authType: 'apimKey',
    endpoint: (process.env.FOUNDRY_AGENT_ENDPOINT_DEV || '').replace(/\/+$/, ''),
    agentId: process.env.FOUNDRY_AGENT_ID_DEV || '',
    subscriptionKey: process.env.APIM_SUBSCRIPTION_KEY_DEV || '',
  },
  prod: {
    authType: 'apimKey',
    endpoint: (process.env.FOUNDRY_AGENT_ENDPOINT_PROD || '').replace(/\/+$/, ''),
    agentId: process.env.FOUNDRY_AGENT_ID_PROD || '',
    subscriptionKey: process.env.APIM_SUBSCRIPTION_KEY_PROD || '',
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
        `and FOUNDRY_AGENT_ID_${env.toUpperCase()} in .env.`
    )
  }
  if (config.authType === 'apimKey' && !config.subscriptionKey) {
    throw new Error(
      `APIM subscription key not configured for "${env}". Set APIM_SUBSCRIPTION_KEY_${env.toUpperCase()} in .env.`
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

// Both environments are invoked through the APIM "AI Hub" gateway: a single
// POST to its `/invoke` route, subscription-key auth, and the agent reference
// nested under `agent_reference`. The URL carries the full path, so there's no
// `api-version` query param on this path.
//
// The `aad` branch below targets Azure AI Foundry's Responses API directly
// (POST /openai/responses), not the classic Assistants threads/runs API — the
// agent's own "Agent ID" isn't an `asst_...` id, it's a plain agent_reference
// by name, and there it's nested under `agent` rather than `agent_reference`.
//
// Either way, multi-turn continuity is a `previous_response_id` pointer (like
// the old Assistants API's thread id, but stateless on our side — the frontend
// just carries the last response's id forward).
agentProxyRouter.post('/responses', async (req, res, next) => {
  try {
    const env = resolveEnv(req.body.env)
    const config = getConfig(env)

    if (config.authType === 'apimKey') {
      const body: Record<string, unknown> = {
        agent_reference: { type: 'agent_reference', name: config.agentId },
        input: req.body.input,
      }
      if (req.body.previous_response_id) {
        body.previous_response_id = req.body.previous_response_id
      }

      const { data } = await axios.post(config.endpoint, body, {
        headers: {
          'Ocp-Apim-Subscription-Key': config.subscriptionKey,
          'Content-Type': 'application/json',
          // APIM/AML compresses (br/gzip) in a way axios's auto-decompress
          // doesn't unwrap cleanly through this hop, yielding garbled JSON —
          // ask for an uncompressed body instead.
          'Accept-Encoding': 'identity',
        },
      })
      res.json(data)
      return
    }

    const token = await getAccessToken()
    const body: Record<string, unknown> = {
      agent: { type: 'agent_reference', name: config.agentId },
      input: req.body.input,
    }
    if (req.body.previous_response_id) {
      body.previous_response_id = req.body.previous_response_id
    }

    const { data } = await getFoundryClient(config.endpoint).post('/openai/responses', body, {
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
