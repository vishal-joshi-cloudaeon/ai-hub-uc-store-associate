/**
 * Databricks SQL access for the approvals routers — the TypeScript
 * replacement for the old Python service's `database.py`
 * (databricks-sql-connector).
 *
 * Statements go over the SQL Statement Execution REST API
 * (POST /api/2.0/sql/statements) rather than a driver, so this process has
 * no native/thrift dependencies to build — it only needs axios, which the
 * Foundry proxy already uses.
 *
 * Dual-environment: dev and prod are two entirely separate Databricks
 * workspaces, each with its own OAuth service principal. Auth is Azure AD
 * service-principal client-credentials OAuth per environment (not a static
 * PAT): a token is fetched for each *configured* environment at startup and
 * proactively refreshed before it expires. `getAccessToken` is a lazy
 * fallback so a request never fails just because that timer hasn't run yet
 * or died. An unconfigured environment (e.g. prod, before its credentials
 * are supplied) is simply skipped at startup rather than blocking the other
 * environment from working.
 */
import axios from 'axios'
import type { EnvName } from './config.js'

type DbConfig = {
  hostname: string
  httpPath: string
  warehouseId: string
  clientId: string
  clientSecret: string
}

function cleanHost(raw: string): string {
  return raw.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

function envConfig(env: EnvName): DbConfig {
  const suffix = env.toUpperCase()
  const httpPath = process.env[`DATABRICKS_HTTP_PATH_${suffix}`] || ''
  return {
    hostname: cleanHost(process.env[`DATABRICKS_SERVER_HOSTNAME_${suffix}`] || ''),
    httpPath,
    // The REST API addresses the warehouse by id, while the connector took
    // the full `/sql/1.0/warehouses/<id>` path. Keep the same env var and
    // pull the id off the end so no existing configuration has to change.
    warehouseId: httpPath.replace(/\/+$/, '').split('/').pop() || '',
    clientId: process.env[`DATABRICKS_CLIENT_ID_${suffix}`] || '',
    clientSecret: process.env[`DATABRICKS_CLIENT_SECRET_${suffix}`] || '',
  }
}

const DB_CONFIG: Record<EnvName, DbConfig> = {
  dev: envConfig('dev'),
  prod: envConfig('prod'),
}

function isConfigured(env: EnvName): boolean {
  return Object.values(DB_CONFIG[env]).every(Boolean)
}

function requireConfig(env: EnvName): DbConfig {
  const config = DB_CONFIG[env]
  if (!config) throw new Error(`Unknown environment '${env}'. Must be 'dev' or 'prod'.`)
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (missing.length) {
    throw new Error(
      `Databricks connection for env='${env}' is not configured (missing: ${missing.join(', ')}). ` +
        `Set DATABRICKS_*_${env.toUpperCase()} in .env (or the Azure Web App's application settings).`
    )
  }
  return config
}

// --- OAuth token cache ------------------------------------------------------

const TOKEN_REFRESH_SKEW_MS = 60_000

const tokenCache = new Map<EnvName, { token: string; expiresAtMs: number }>()
const inFlight = new Map<EnvName, Promise<string>>()

async function fetchNewToken(env: EnvName): Promise<{ token: string; expiresAtMs: number }> {
  const config = requireConfig(env)
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'all-apis',
  })
  const { data } = await axios.post(`https://${config.hostname}/oidc/v1/token`, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  })
  return { token: data.access_token, expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000 }
}

async function refreshNow(env: EnvName): Promise<string> {
  // Collapse concurrent refreshes for the same environment onto one request,
  // the way the Python version's lock did.
  const existing = inFlight.get(env)
  if (existing) return existing

  const promise = (async () => {
    const entry = await fetchNewToken(env)
    tokenCache.set(env, entry)
    console.log(
      `Databricks OAuth token refreshed for env=${env}, expires in ` +
        `${Math.round((entry.expiresAtMs - Date.now()) / 1000)}s`
    )
    return entry.token
  })().finally(() => inFlight.delete(env))

  inFlight.set(env, promise)
  return promise
}

async function getAccessToken(env: EnvName): Promise<string> {
  const cached = tokenCache.get(env)
  if (cached && Date.now() < cached.expiresAtMs - TOKEN_REFRESH_SKEW_MS) return cached.token
  return refreshNow(env)
}

function scheduleRefresh(env: EnvName): void {
  const cached = tokenCache.get(env)
  const delay = Math.max((cached?.expiresAtMs ?? Date.now()) - Date.now() - TOKEN_REFRESH_SKEW_MS, 5_000)
  const timer = setTimeout(() => {
    refreshNow(env)
      .then(() => scheduleRefresh(env))
      .catch((err) => {
        console.error(`Failed to refresh Databricks OAuth token for env=${env}; will retry shortly`, err)
        setTimeout(() => scheduleRefresh(env), 10_000).unref()
      })
  }, delay)
  timer.unref()
}

/**
 * Fetch a token for every *configured* environment at startup, then keep
 * refreshing each in the background before it expires. An unconfigured
 * environment (e.g. prod, before real credentials exist) is skipped.
 *
 * Unlike the standalone Python service, a Databricks misconfiguration here
 * must NOT take the whole process down — this one Web App also serves the
 * SPA and the Foundry agent proxy. Problems are logged loudly and surface as
 * a clear error on the approvals endpoints instead.
 */
export function startDatabricksTokenRefresh(): void {
  const configured = (['dev', 'prod'] as const).filter(isConfigured)
  if (!configured.length) {
    console.error(
      'No Databricks environment is fully configured — the /api/approvals and /tools endpoints ' +
        'will fail until DATABRICKS_*_DEV (at minimum) is set.'
    )
    return
  }
  console.log(`Databricks environments configured at startup: ${configured.join(', ')}`)

  for (const env of configured) {
    refreshNow(env)
      .then(() => scheduleRefresh(env))
      .catch((err) => console.error(`Databricks OAuth token fetch failed at startup for env=${env}`, err))
  }
}

// --- Statement execution ----------------------------------------------------

/** A bound parameter value. The REST API needs an explicit SQL type per
 * value, so callers build these with the `sql` helpers below rather than
 * passing bare JS values — a double silently bound as an INT would corrupt a
 * money column. */
type ParamValue = { value: string | null; type: string }

export const sql = {
  string: (value: string | null | undefined): ParamValue => ({
    value: value == null ? null : String(value),
    type: 'STRING',
  }),
  double: (value: number | null | undefined): ParamValue => ({
    value: value == null ? null : String(value),
    type: 'DOUBLE',
  }),
  int: (value: number | null | undefined): ParamValue => ({
    value: value == null ? null : String(Math.trunc(value)),
    type: 'INT',
  }),
}

export type Params = Record<string, ParamValue>

type StatementColumn = { name: string; type_name: string; position: number }
type StatementResult = { data_array?: (string | null)[][]; next_chunk_internal_link?: string }
type StatementResponse = {
  statement_id: string
  status: { state: string; error?: { message?: string; error_code?: string } }
  manifest?: { schema?: { columns?: StatementColumn[] } }
  result?: StatementResult
}

const STATEMENT_POLL_INTERVAL_MS = 1_000
const STATEMENT_TIMEOUT_MS = 300_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function databricksRequest<T>(
  env: EnvName,
  method: 'GET' | 'POST',
  urlPath: string,
  body?: unknown
): Promise<T> {
  const config = requireConfig(env)
  const token = await getAccessToken(env)
  const { data } = await axios.request<T>({
    method,
    url: `https://${config.hostname}${urlPath}`,
    data: body,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 60_000,
  })
  return data
}

/** Run a statement, wait for it to finish, and gather every result chunk. */
async function executeStatement(
  env: EnvName,
  statement: string,
  params: Params
): Promise<{ columns: StatementColumn[]; rows: (string | null)[][] }> {
  const config = requireConfig(env)
  // A parameter whose `value` key is absent binds as SQL NULL — an explicit
  // JSON null is not the documented way to express it, so drop the key.
  const parameters = Object.entries(params).map(([name, { value, type }]) =>
    value === null ? { name, type } : { name, value, type }
  )

  let response = await databricksRequest<StatementResponse>(env, 'POST', '/api/2.0/sql/statements', {
    warehouse_id: config.warehouseId,
    statement,
    parameters,
    // Wait inline for up to 30s (covers a warm warehouse in a single round
    // trip), then fall back to polling rather than failing — a cold warehouse
    // can take minutes to start.
    wait_timeout: '30s',
    on_wait_timeout: 'CONTINUE',
    format: 'JSON_ARRAY',
    disposition: 'INLINE',
  })

  const deadline = Date.now() + STATEMENT_TIMEOUT_MS
  while (response.status.state === 'PENDING' || response.status.state === 'RUNNING') {
    if (Date.now() > deadline) {
      throw new Error(`Databricks statement ${response.statement_id} timed out after 5 minutes`)
    }
    await sleep(STATEMENT_POLL_INTERVAL_MS)
    response = await databricksRequest<StatementResponse>(
      env,
      'GET',
      `/api/2.0/sql/statements/${response.statement_id}`
    )
  }

  if (response.status.state !== 'SUCCEEDED') {
    const { state, error } = response.status
    throw new Error(
      `Databricks statement ${response.statement_id} ended in state ${state}` +
        (error?.message ? `: ${error.message}` : '')
    )
  }

  const columns = response.manifest?.schema?.columns ?? []
  const rows: (string | null)[][] = [...(response.result?.data_array ?? [])]

  // INLINE results are chunked once they get large; each chunk links to the
  // next. Small approval lists never hit this, but following the links keeps
  // a growing table from silently truncating.
  let nextLink = response.result?.next_chunk_internal_link
  while (nextLink) {
    const chunk = await databricksRequest<StatementResult>(env, 'GET', nextLink)
    rows.push(...(chunk?.data_array ?? []))
    nextLink = chunk?.next_chunk_internal_link
  }

  return { columns, rows }
}

/**
 * Databricks renders a TIMESTAMP as UTC wall-clock text. Left as-is, a
 * browser parses a zone-less string as *local* time, silently shifting every
 * timestamp by the viewer's UTC offset. Mark it UTC explicitly so the
 * frontend gets an unambiguous instant.
 */
function toIsoUtc(raw: string): string {
  const trimmed = raw.trim()
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)
  const parsed = new Date(hasZone ? trimmed : `${trimmed.replace(' ', 'T')}Z`)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString()
}

const NUMERIC_TYPES = new Set(['BYTE', 'SHORT', 'INT', 'LONG', 'FLOAT', 'DOUBLE', 'DECIMAL'])

function coerce(raw: string | null, typeName: string): unknown {
  if (raw === null) return null
  const type = (typeName || '').toUpperCase()
  if (NUMERIC_TYPES.has(type)) {
    const n = Number(raw)
    return Number.isNaN(n) ? raw : n
  }
  if (type === 'BOOLEAN') return raw.toLowerCase() === 'true'
  if (type === 'TIMESTAMP' || type === 'TIMESTAMP_NTZ') return toIsoUtc(raw)
  return raw
}

export type Row = Record<string, unknown>

/** Run a SELECT and return rows as a list of column-name -> value objects. */
export async function query(statement: string, params: Params = {}, env: EnvName = 'dev'): Promise<Row[]> {
  const { columns, rows } = await executeStatement(env, statement, params)
  return rows.map((row) => {
    const record: Row = {}
    columns.forEach((column, index) => {
      record[column.name] = coerce(row[index] ?? null, column.type_name)
    })
    return record
  })
}

/** Run an INSERT/UPDATE statement with no result set expected. */
export async function execute(statement: string, params: Params = {}, env: EnvName = 'dev'): Promise<void> {
  await executeStatement(env, statement, params)
}
