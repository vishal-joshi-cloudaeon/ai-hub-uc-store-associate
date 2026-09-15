/**
 * Per-environment agent connection overrides, entered by the user in the
 * manager chat's settings panel and kept in localStorage.
 *
 * These exist purely so a demo/testing session can be pointed at a different
 * APIM route, a different agent or a different subscription key without a
 * redeploy or an .env change. Nothing about the call itself changes: the SPA
 * still posts to this app's own /agent/responses proxy, and the proxy still
 * builds the same request — it just reads these values instead of its
 * FOUNDRY_AGENT_ENDPOINT_* / FOUNDRY_AGENT_ID_* / APIM_SUBSCRIPTION_KEY_*
 * defaults for the fields that are filled in.
 *
 * Each field is independent: leave one blank and the server's configured
 * value for that environment is used for it.
 *
 * Keyed by environment, since dev and prod are different gateways with
 * different keys and must never share an override.
 */
import type { EnvName } from './environments'

export type AgentOverrides = {
  endpoint: string
  agentId: string
  subscriptionKey: string
}

export const EMPTY_OVERRIDES: AgentOverrides = {
  endpoint: '',
  agentId: '',
  subscriptionKey: '',
}

/** Shown as input placeholders so the expected shape of each field is
 * obvious. Deliberately not the real values — the subscription key is a
 * made-up 32-hex string of the right length. */
export const OVERRIDE_PLACEHOLDERS: AgentOverrides = {
  endpoint: 'https://dta-euw-prod-apim-01.azure-api.net/<api-route>/invoke',
  agentId: 'Loyalty-Agent',
  subscriptionKey: '0a1b2c3d4e5f60718293a4b5c6d7e8f9',
}

const STORAGE_PREFIX = 'uc-store-associate:agent-overrides'

function storageKey(env: EnvName): string {
  return `${STORAGE_PREFIX}:${env}`
}

function normalize(raw: unknown): AgentOverrides {
  const value = (raw ?? {}) as Partial<Record<keyof AgentOverrides, unknown>>
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return {
    endpoint: text(value.endpoint),
    agentId: text(value.agentId),
    subscriptionKey: text(value.subscriptionKey),
  }
}

export function loadOverrides(env: EnvName): AgentOverrides {
  try {
    const stored = window.localStorage.getItem(storageKey(env))
    return stored ? normalize(JSON.parse(stored)) : { ...EMPTY_OVERRIDES }
  } catch {
    // Private-window / blocked storage / corrupt JSON — fall back to the
    // server's own configuration rather than breaking the page.
    return { ...EMPTY_OVERRIDES }
  }
}

export function saveOverrides(env: EnvName, overrides: AgentOverrides): AgentOverrides {
  const normalized = normalize(overrides)
  try {
    if (hasAnyOverride(normalized)) {
      window.localStorage.setItem(storageKey(env), JSON.stringify(normalized))
    } else {
      window.localStorage.removeItem(storageKey(env))
    }
  } catch {
    /* ignore — the values still apply for this page's lifetime via the caller */
  }
  return normalized
}

export function clearOverrides(env: EnvName): AgentOverrides {
  try {
    window.localStorage.removeItem(storageKey(env))
  } catch {
    /* ignore */
  }
  return { ...EMPTY_OVERRIDES }
}

export function hasAnyOverride(overrides: AgentOverrides): boolean {
  return Boolean(overrides.endpoint || overrides.agentId || overrides.subscriptionKey)
}

/** The snake_case subset the proxy reads, with blank fields omitted so the
 * server keeps its own value for each one it doesn't receive. */
export function overridePayload(env: EnvName): Record<string, string> | undefined {
  const { endpoint, agentId, subscriptionKey } = loadOverrides(env)
  const payload: Record<string, string> = {}
  if (endpoint) payload.endpoint = endpoint
  if (agentId) payload.agent_id = agentId
  if (subscriptionKey) payload.subscription_key = subscriptionKey
  return Object.keys(payload).length ? payload : undefined
}
