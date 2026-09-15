import axios from 'axios'
import type { Message, MessageState, ToolCall } from '../types'
import type { EnvName } from '../config/environments'
import { hasAnyOverride, loadOverrides, overridePayload } from '../config/agentOverrides'

// The browser never talks to Azure AI Foundry directly, and never holds a
// Foundry API key or AAD token — it only calls this app's own backend proxy
// (server/src/agentProxy.ts), which authenticates to Foundry using its own
// Azure identity (managed identity in production, `az login`/service
// principal locally). See the root README for why.
//
// Same-origin by default: the backend serves this bundle in production, and
// Vite proxies /agent to it in dev (see vite.config.ts).
const AGENT_API_BASE = ((import.meta.env.VITE_AGENT_API_URL as string) || '/agent').replace(/\/+$/, '')

const client = axios.create({
  baseURL: AGENT_API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Azure AI Foundry's Responses API (POST /openai/responses, proxied through
// server/ as POST /responses). Multi-turn continuity is a `previous_response_id`
// pointer carried forward per store — there's no separate "thread" resource
// to create or clean up, unlike the classic Assistants API.
type FoundryOutputTextContent = { type: 'output_text'; text: string }
type FoundryMessageItem = {
  type: 'message'
  role: 'assistant' | 'user'
  content: FoundryOutputTextContent[]
}
type FoundryToolCallItem = {
  type: string // e.g. 'mcp_call', 'function_call', 'openapi_call'
  name?: string
  arguments?: string
  output?: string | Record<string, unknown>
}
type FoundryOutputItem = FoundryMessageItem | FoundryToolCallItem | { type: 'mcp_list_tools' }

type FoundryResponse = {
  id: string
  status: 'completed' | 'failed' | 'in_progress' | 'incomplete'
  error?: { message?: string } | null
  output: FoundryOutputItem[]
}

// Keyed by `${env}:${storeId}` — the same store id exists in both dev and
// prod (different backing data), so continuity pointers must not leak
// across environments.
const previousResponseIdByStore = new Map<string, string>()

function continuityKey(storeId: string, env: EnvName) {
  return `${env}:${storeId}`
}

export function resetThread(storeId: string, env: EnvName) {
  previousResponseIdByStore.delete(continuityKey(storeId, env))
}

function summarize(value: unknown, max = 80): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

function isToolCallItem(item: FoundryOutputItem): item is FoundryToolCallItem {
  return item.type !== 'message' && item.type !== 'mcp_list_tools'
}

function parseToolCalls(output: FoundryOutputItem[]): ToolCall[] {
  const calls: ToolCall[] = []
  for (const item of output) {
    if (!isToolCallItem(item) || !item.name) continue
    calls.push({
      tool_name: item.name,
      input_summary: summarize(item.arguments),
      output_summary: summarize(item.output),
    })
  }
  return calls
}

function getFinalText(output: FoundryOutputItem[]): string {
  const messages = output.filter((item): item is FoundryMessageItem => item.type === 'message')
  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant')
  const textContent = lastAssistantMessage?.content?.find((c) => c.type === 'output_text')
  return textContent?.text ?? ''
}

function detectState(content: string): { state: MessageState; approvalId?: string } {
  const lower = content.toLowerCase()

  if (lower.includes('blocked') || lower.includes('data policy') || lower.includes('pii')) {
    return { state: 'blocked' }
  }

  // Require a real approval_id, not just the phrasing — the agent can
  // mention "cluster head" while explaining it *hasn't* submitted anything
  // yet (e.g. asking a clarifying question first), which must not freeze
  // the input bar waiting on an approval that was never actually created.
  const approvalIdMatch = content.match(/APR-\d+/)
  if (
    approvalIdMatch &&
    (lower.includes('awaiting approval') ||
      lower.includes('cluster head') ||
      lower.includes('approval request'))
  ) {
    return { state: 'awaiting_approval', approvalId: approvalIdMatch[0] }
  }

  if (content.includes('✓') && lower.includes('approved')) {
    return { state: 'approved' }
  }

  if (content.includes('✗') && lower.includes('denied')) {
    return { state: 'denied' }
  }

  return { state: 'completed' }
}

async function callResponses(
  userContent: string,
  env: EnvName,
  previousResponseId?: string
): Promise<FoundryResponse> {
  // We keep calling our own proxy (server/agentProxy.ts) with the same
  // Responses API shape that's already proven working — env just tells the
  // proxy which Foundry project/agent to route to server-side. The browser
  // never talks to Foundry or APIM directly.
  const { data } = await client.post<FoundryResponse>('/responses', {
    input: userContent,
    previous_response_id: previousResponseId,
    env,
    // Optional per-environment connection overrides from the chat's settings
    // panel (endpoint / agent id / subscription key). Omitted entirely when
    // the user hasn't set any, so the proxy uses its own configuration —
    // nothing else about this call changes either way.
    overrides: overridePayload(env),
  })
  return data
}

function isStalePreviousResponseError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false
  const code = (err.response?.data as { error?: { code?: string } } | undefined)?.error?.code
  return code === 'previous_response_not_found'
}

// --- error reporting -------------------------------------------------------
// A failed call must never surface axios's bare "Request failed with status
// code 500" in the chat: at this point in the stack we know whether the
// request died before reaching the agent (a connection problem the user can
// fix in the settings panel) or came back from the agent itself (nothing the
// settings panel will help with), so say which.

type ErrorBody = {
  error?: { message?: string; code?: string; request_id?: string }
  message?: string
  statusCode?: number
  activityId?: string
}

const SETTINGS_LOCATION = 'the gear icon at the top right'

// The connection values live only in the settings panel now — the server
// ships with no endpoint/agent/key of its own — so "go and fill them in" is
// the right thing to say when nothing has been saved yet.
function missingConnectionHint(env: EnvName): string {
  return (
    `Open Agent connection settings (${SETTINGS_LOCATION}) and enter the Endpoint, Agent ID and ` +
    `Subscription key to use for ${env.toUpperCase()}, then send the message again.`
  )
}

// Appended to failures that happened *at* the gateway. If the user has
// already saved connection values, this stays silent: a gateway rejection
// says nothing about whether those values are right (an APIM policy that
// throws before routing returns the same 500 for every endpoint, agent and
// key, including none at all), so sending them back to re-check settings
// they've already filled in just sends them round in circles.
function settingsHintIfUnset(env: EnvName): string {
  return hasAnyOverride(loadOverrides(env)) ? '' : `

${missingConnectionHint(env)}`
}

function describeError(err: unknown, env: EnvName): Error {
  if (!axios.isAxiosError(err)) {
    return err instanceof Error ? err : new Error('Something went wrong talking to the agent.')
  }

  // No response at all — this app's own backend is unreachable, so the
  // connection values aren't the problem.
  if (!err.response) {
    return new Error(
      `Couldn't reach this app's backend (${err.message}). ` +
        'Check that the server is running, then send the message again.'
    )
  }

  const status = err.response.status
  const body = (err.response.data ?? {}) as ErrorBody
  const label = env.toUpperCase()

  const code = body.error?.code

  // Connection problems this app diagnosed itself. This one always points at
  // the settings panel regardless of what's saved: it means a required value
  // is genuinely missing, and the panel is the only place to supply it.
  if (code === 'connection_not_configured') {
    return new Error(
      `The ${label} agent connection isn't configured.

${missingConnectionHint(env)}`
    )
  }
  if (code === 'invalid_override') {
    const detail = body.error?.message || 'The saved connection values are not valid.'
    return new Error(`${detail}

Fix it in Agent connection settings (${SETTINGS_LOCATION}).`)
  }
  if (code === 'endpoint_unreachable') {
    return new Error(
      `Couldn't reach the ${label} agent endpoint — check the URL is correct and reachable.

` +
        `Details: ${body.error?.message ?? 'no response from the endpoint'}` +
        settingsHintIfUnset(env)
    )
  }

  // Any other code means the agent itself ran and reported a failure
  // (Foundry sends an error.code and usually a request_id). The connection is
  // fine — surface the real message rather than pointing at settings that
  // aren't at fault.
  if (code) {
    return new Error(body.error?.message || `The agent returned ${code}.`)
  }

  // Anything else died before the agent: an APIM gateway rejection (bare
  // { statusCode, message, activityId }), a 401/403 from a wrong key, a 404
  // from a wrong route.
  const gatewayMessage = body.message || body.error?.message || err.message
  const reason =
    status === 401 || status === 403
      ? 'the subscription key was rejected'
      : status === 404
        ? 'the endpoint URL was not found'
        : 'the request was rejected before it reached the agent'

  return new Error(
    `The ${label} agent connection failed (HTTP ${status}) — ${reason}.

` +
      `Gateway response: ${gatewayMessage}` +
      (body.activityId ? ` (activityId: ${body.activityId})` : '') +
      settingsHintIfUnset(env)
  )
}

export type SendMessageResult = Pick<Message, 'content' | 'state' | 'tool_calls' | 'approval_id'>

export async function sendMessage(
  storeId: string,
  userContent: string,
  env: EnvName
): Promise<SendMessageResult> {
  const key = continuityKey(storeId, env)
  const previousResponseId = previousResponseIdByStore.get(key)

  let data: FoundryResponse
  try {
    data = await callResponses(userContent, env, previousResponseId)
  } catch (err) {
    // The continuity pointer we had stored is no longer valid on Foundry's
    // side (expired/deleted) — silently retry as a fresh conversation for
    // this store instead of surfacing an opaque 400 for something the user
    // did nothing to cause.
    if (previousResponseId && isStalePreviousResponseError(err)) {
      try {
        data = await callResponses(userContent, env, undefined)
      } catch (retryErr) {
        throw describeError(retryErr, env)
      }
    } else {
      throw describeError(err, env)
    }
  }

  previousResponseIdByStore.set(key, data.id)

  if (data.status === 'failed') {
    throw new Error(data.error?.message || 'The agent run failed.')
  }

  const content = getFinalText(data.output)
  const toolCalls = parseToolCalls(data.output)
  const { state, approvalId } = detectState(content)

  return {
    content,
    state,
    tool_calls: toolCalls.length ? toolCalls : undefined,
    approval_id: approvalId,
  }
}
