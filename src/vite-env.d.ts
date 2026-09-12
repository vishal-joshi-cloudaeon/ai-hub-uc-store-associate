/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FOUNDRY_AGENT_ENDPOINT: string
  readonly VITE_FOUNDRY_API_KEY: string
  readonly VITE_APPROVALS_API_URL: string
  readonly VITE_POLL_INTERVAL_MS: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
