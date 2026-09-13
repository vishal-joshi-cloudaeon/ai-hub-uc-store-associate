export type EnvName = 'dev' | 'prod'

export type EnvConfig = {
  name: EnvName
  label: 'DEV' | 'PROD'
  /** Tailwind classes for the EnvBadge — kept here so badge styling stays
   * data-driven rather than hardcoded per environment in the component. */
  badgeClassName: string
  /** Base URL of the approvals API. Empty by default: it's served by this
   * same app (server/src/approvals), so the browser calls its own origin.
   * One backend serves both environments — it switches Databricks
   * connections internally based on the `env` query param each request
   * carries. Only set VITE_APPROVALS_API_URL_DEV/_PROD if you point an
   * environment at a separately hosted backend. */
  approvalsApiUrl: string
}

const ENV_CONFIG: Record<EnvName, EnvConfig> = {
  dev: {
    name: 'dev',
    label: 'DEV',
    badgeClassName: 'bg-blue-50 text-blue-700 border-blue-200',
    approvalsApiUrl: (import.meta.env.VITE_APPROVALS_API_URL_DEV as string) || '',
  },
  prod: {
    name: 'prod',
    label: 'PROD',
    badgeClassName: 'bg-green-50 text-green-700 border-green-200',
    approvalsApiUrl: (import.meta.env.VITE_APPROVALS_API_URL_PROD as string) || '',
  },
}

export function getEnvConfig(env: string): EnvConfig {
  return ENV_CONFIG[env as EnvName] ?? ENV_CONFIG.dev
}
