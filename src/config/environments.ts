export type EnvName = 'dev' | 'prod'

export type EnvConfig = {
  name: EnvName
  label: 'DEV' | 'PROD'
  /** Tailwind classes for the EnvBadge — kept here so badge styling stays
   * data-driven rather than hardcoded per environment in the component. */
  badgeClassName: string
  /** Base URL of the approvals-service backend. Normally the SAME single
   * instance for both environments — it switches Databricks connections
   * internally based on the `env` query param it receives on each request.
   * Only set VITE_APPROVALS_API_URL_DEV/_PROD to different values if you
   * actually deploy separate instances per environment. */
  approvalsApiUrl: string
}

const ENV_CONFIG: Record<EnvName, EnvConfig> = {
  dev: {
    name: 'dev',
    label: 'DEV',
    badgeClassName: 'bg-blue-50 text-blue-700 border-blue-200',
    approvalsApiUrl: (import.meta.env.VITE_APPROVALS_API_URL_DEV as string) || 'http://localhost:8000',
  },
  prod: {
    name: 'prod',
    label: 'PROD',
    badgeClassName: 'bg-green-50 text-green-700 border-green-200',
    approvalsApiUrl: (import.meta.env.VITE_APPROVALS_API_URL_PROD as string) || 'http://localhost:8000',
  },
}

export function getEnvConfig(env: string): EnvConfig {
  return ENV_CONFIG[env as EnvName] ?? ENV_CONFIG.dev
}
