/** Shared, non-secret config used by both approvals routers.
 *
 * Unity Catalog catalog/schema names — the same in both the dev and prod
 * Databricks workspaces (each workspace has its own "dev.retail" catalog;
 * this isn't related to the dev/prod *application* environment switch).
 */
const CATALOG = process.env.CATALOG || 'dev'
const SCHEMA = process.env.SCHEMA || 'retail'

export const APPROVAL_TABLE = `${CATALOG}.${SCHEMA}.dim_approval`
export const VOUCHER_TABLE = `${CATALOG}.${SCHEMA}.dim_voucher_issued`

export type EnvName = 'dev' | 'prod'

/** The Foundry agent sends the environment as an `X-Environment` header;
 * the UI sends it as an `env` query param. Both default to "dev". */
export function resolveEnv(value: unknown): EnvName {
  return String(value ?? '').toLowerCase() === 'prod' ? 'prod' : 'dev'
}
