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

// Deliberately empty by default: the endpoint, agent id and subscription key
// are no longer shipped with the app (they're absent from .env and from the
// Azure Web App's settings) and are supplied per-session through the chat's
// Agent connection settings panel instead. These env vars are still read, so
// a deployment can pre-fill them again, but nothing depends on them being set.
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

/**
 * A connection problem this app can describe itself, as opposed to an error
 * coming back from APIM or the agent. The `code` travels to the SPA so the
 * chat can point the user at the settings panel for exactly the right
 * reason — see `describeError` in src/api/agent.ts.
 */
class ProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: 'connection_not_configured' | 'invalid_override' | 'endpoint_unreachable',
    message: string
  ) {
    super(message)
    this.name = 'ProxyError'
  }
}

/**
 * Optional per-request connection overrides, sent by the manager chat's
 * settings panel so a session can be pointed at a different APIM route,
 * agent or subscription key without a redeploy. Each field is independent:
 * whatever isn't supplied falls back to this environment's configured value,
 * and a request with no overrides behaves exactly as before.
 */
type ConnectionOverrides = {
  endpoint?: string
  agentId?: string
  subscriptionKey?: string
}

function parseOverrides(raw: unknown): ConnectionOverrides {
  if (!raw || typeof raw !== 'object') return {}
  const body = raw as Record<string, unknown>
  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined
  return {
    endpoint: text(body.endpoint),
    agentId: text(body.agent_id),
    subscriptionKey: text(body.subscription_key),
  }
}

function getConfig(env: EnvName, overrides: ConnectionOverrides = {}): FoundryEnvConfig {
  const base = ENV_CONFIG[env]

  if (overrides.endpoint && !/^https?:\/\//i.test(overrides.endpoint)) {
    throw new ProxyError(
      400,
      'invalid_override',
      'The endpoint must be a full URL starting with https:// (or http:// for a local test).'
    )
  }

  const endpoint = (overrides.endpoint ?? base.endpoint).replace(/\/+$/, '')
  const agentId = overrides.agentId ?? base.agentId
  const config: FoundryEnvConfig =
    base.authType === 'apimKey'
      ? {
          authType: 'apimKey',
          endpoint,
          agentId,
          subscriptionKey: overrides.subscriptionKey ?? base.subscriptionKey,
        }
      : { authType: 'aad', endpoint, agentId }

  if (!config.endpoint || !config.agentId) {
    throw new ProxyError(
      500,
      'connection_not_configured',
      `No endpoint or agent is configured for the "${env}" environment. Set them in the chat's ` +
        `Agent connection settings, which send them as "overrides" on the request.`
    )
  }
  if (config.authType === 'apimKey' && !config.subscriptionKey) {
    throw new ProxyError(
      500,
      'connection_not_configured',
      `No subscription key is configured for the "${env}" environment. Set it in the chat's ` +
        `Agent connection settings, which send it as an "override" on the request.`
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
    const config = getConfig(env, parseOverrides(req.body.overrides))

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
  if (err instanceof ProxyError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } })
    return
  }
  if (err instanceof AxiosError && err.response) {
    // Pass Foundry's own status/body straight through — the frontend's
    // detectState/error handling already expects a plain error message.
    res.status(err.response.status).json(err.response.data)
    return
  }
  if (err instanceof AxiosError) {
    // No response at all: DNS failure, refused connection, timeout. Common
    // with a mistyped endpoint in the settings panel, so it gets its own
    // code rather than looking like a gateway rejection.
    res.status(502).json({ error: { code: 'endpoint_unreachable', message: err.message } })
    return
  }
  console.error(err)
  res.status(500).json({ error: { message: err instanceof Error ? err.message : 'Unknown error' } })
}
