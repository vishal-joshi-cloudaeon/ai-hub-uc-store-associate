/**
 * Per-environment agent connection values, shown in the manager chat's
 * settings panel (the gear icon) and kept in localStorage.
 *
 * Each environment ships with a working default connection (DEFAULT_OVERRIDES
 * below), so the chat talks to the right APIM route with no setup. The panel
 * exists so a demo/testing session can be pointed at a different APIM route,
 * a different agent or a different subscription key without a redeploy or an
 * .env change. Nothing about the call itself changes: the SPA still posts to
 * this app's own /agent/responses proxy, and the proxy still builds the same
 * request — it just reads these values instead of its
 * FOUNDRY_AGENT_ENDPOINT_* / FOUNDRY_AGENT_ID_* / APIM_SUBSCRIPTION_KEY_*
 * environment variables.
 *
 * Each field is independent: clear one and that environment's default is used
 * for it. Clearing all of them puts the environment back on its defaults
 * entirely, and nothing is left in localStorage.
 *
 * Keyed by environment, since dev and prod are different gateways with
 * different keys and must never share a value.
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

/** The connection each environment uses unless the panel says otherwise —
 * dev via apim-01, prod via apim-02, each with its own subscription key.
 * These are sent with every request, so the server's FOUNDRY_* / APIM_* env
 * vars are never reached for a field that has a default here. */
export const DEFAULT_OVERRIDES: Record<EnvName, AgentOverrides> = {
  dev: {
    endpoint:
      'https://dta-euw-prod-apim-01.azure-api.net/saw-loyalty-agent-conversational-retail-assistant/invoke',
    agentId: 'Loyalty-Agent',
    subscriptionKey: 'd7d357c8f0f443eb8d6617f1c551a2a7',
  },
  prod: {
    endpoint:
      'https://dta-euw-prod-apim-02.azure-api.net/saw-loyalty-agent-conversational-retail-assistant/invoke',
    agentId: 'Loyalty-Agent',
    subscriptionKey: '65c6bbf3ea0547a8b2d6bc61273ccb9c',
  },
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

/** Fills each blank field from the environment's default, so callers always
 * get a complete, usable connection. */
function withDefaults(env: EnvName, overrides: AgentOverrides): AgentOverrides {
  const defaults = DEFAULT_OVERRIDES[env]
  return {
    endpoint: overrides.endpoint || defaults.endpoint,
    agentId: overrides.agentId || defaults.agentId,
    subscriptionKey: overrides.subscriptionKey || defaults.subscriptionKey,
  }
}

export function loadOverrides(env: EnvName): AgentOverrides {
  try {
    const stored = window.localStorage.getItem(storageKey(env))
    return withDefaults(env, stored ? normalize(JSON.parse(stored)) : EMPTY_OVERRIDES)
  } catch {
    // Private-window / blocked storage / corrupt JSON — fall back to the
    // environment's defaults rather than breaking the page.
    return { ...DEFAULT_OVERRIDES[env] }
  }
}

export function saveOverrides(env: EnvName, overrides: AgentOverrides): AgentOverrides {
  const effective = withDefaults(env, normalize(overrides))
  try {
    if (isCustomized(env, effective)) {
      window.localStorage.setItem(storageKey(env), JSON.stringify(effective))
    } else {
      window.localStorage.removeItem(storageKey(env))
    }
  } catch {
    /* ignore — the values still apply for this page's lifetime via the caller */
  }
  return effective
}

export function clearOverrides(env: EnvName): AgentOverrides {
  try {
    window.localStorage.removeItem(storageKey(env))
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_OVERRIDES[env] }
}

/** True when the values in effect differ from what the environment ships
 * with — drives the dot on the gear icon and the panel's Reset button. */
export function isCustomized(env: EnvName, overrides: AgentOverrides): boolean {
  const defaults = DEFAULT_OVERRIDES[env]
  return (
    overrides.endpoint !== defaults.endpoint ||
    overrides.agentId !== defaults.agentId ||
    overrides.subscriptionKey !== defaults.subscriptionKey
  )
}

/** The snake_case subset the proxy reads. Every field is always populated
 * (blank ones fall back to the environment's default), so the proxy never has
 * to reach for its own configuration. */
export function overridePayload(env: EnvName): Record<string, string> | undefined {
  const { endpoint, agentId, subscriptionKey } = loadOverrides(env)
  const payload: Record<string, string> = {}
  if (endpoint) payload.endpoint = endpoint
  if (agentId) payload.agent_id = agentId
  if (subscriptionKey) payload.subscription_key = subscriptionKey
  return Object.keys(payload).length ? payload : undefined
}
