/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides the agent proxy base URL. Unset = same origin (`/agent`). */
  readonly VITE_AGENT_API_URL: string
  /** Overrides the approvals API base URL per environment. Unset = same
   * origin, i.e. this app's own `/api/approvals`. */
  readonly VITE_APPROVALS_API_URL_DEV: string
  readonly VITE_APPROVALS_API_URL_PROD: string
  readonly VITE_POLL_INTERVAL_MS: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
