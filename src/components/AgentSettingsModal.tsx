import { useState } from 'react'
import {
  DEFAULT_OVERRIDES,
  clearOverrides,
  isCustomized,
  loadOverrides,
  saveOverrides,
  type AgentOverrides,
} from '../config/agentOverrides'
import type { EnvName } from '../config/environments'

type AgentSettingsModalProps = {
  env: EnvName
  onClose: () => void
  /** Called after Save or Reset with the values now in effect, so the page
   * can refresh its indicator and start a fresh conversation (a
   * previous_response_id from one agent/endpoint is meaningless on another). */
  onApplied: (overrides: AgentOverrides) => void
}

type Field = {
  key: keyof AgentOverrides
  label: string
  hint: string
  secret?: boolean
}

const FIELDS: Field[] = [
  {
    key: 'endpoint',
    label: 'Endpoint',
    hint: 'Full URL the request is POSTed to, including the /invoke path.',
  },
  {
    key: 'agentId',
    label: 'Agent ID',
    hint: 'Agent name sent as agent_reference.',
  },
  {
    key: 'subscriptionKey',
    label: 'Subscription key',
    hint: 'Sent as the Ocp-Apim-Subscription-Key header.',
    secret: true,
  },
]

export default function AgentSettingsModal({ env, onClose, onApplied }: AgentSettingsModalProps) {
  const [values, setValues] = useState<AgentOverrides>(() => loadOverrides(env))
  const [showSecret, setShowSecret] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const setField = (key: keyof AgentOverrides, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setError(null)
    setStatus(null)
  }

  const handleSave = () => {
    const endpoint = values.endpoint.trim()
    if (endpoint && !/^https?:\/\//i.test(endpoint)) {
      setError('Endpoint must be a full URL starting with https:// (or http:// for a local test).')
      return
    }
    const saved = saveOverrides(env, values)
    setValues(saved)
    onApplied(saved)
    onClose()
  }

  const handleReset = () => {
    const defaults = clearOverrides(env)
    setValues(defaults)
    setError(null)
    setStatus(`Reset — ${env.toUpperCase()} is back to its default connection.`)
    onApplied(defaults)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-card bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Agent connection</h2>
            <p className="mt-1 text-xs text-text-secondary">
              Used for <span className="font-medium">{env.toUpperCase()}</span> chat only, and
              pre-filled with that environment's default. Clear a field to put it back on the
              default.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex-shrink-0 rounded-card p-1 text-text-muted transition hover:bg-gray-100 hover:text-text-secondary"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          {FIELDS.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <label htmlFor={`agent-${field.key}`} className="text-xs font-medium text-text-primary">
                {field.label}
              </label>
              <div className="relative">
                <input
                  id={`agent-${field.key}`}
                  type={field.secret && !showSecret ? 'password' : 'text'}
                  value={values[field.key]}
                  onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={
                    field.secret && !showSecret
                      ? 'Default subscription key'
                      : DEFAULT_OVERRIDES[env][field.key]
                  }
                  spellCheck={false}
                  autoComplete="off"
                  className={`w-full rounded-card border border-border px-3 py-2 text-sm text-text-primary transition placeholder:text-text-muted focus:border-brand-blue focus:outline-none ${
                    field.secret ? 'pr-16' : ''
                  }`}
                />
                {field.secret && (
                  <button
                    type="button"
                    onClick={() => setShowSecret((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-text-secondary transition hover:bg-gray-100"
                  >
                    {showSecret ? 'Hide' : 'Show'}
                  </button>
                )}
              </div>
              <span className="text-xs text-text-muted">{field.hint}</span>
            </div>
          ))}
        </div>

        {error && (
          <p className="mt-4 rounded-card bg-red-50 px-3 py-2 text-xs text-brand-red">{error}</p>
        )}
        {status && (
          <p className="mt-4 rounded-card bg-gray-50 px-3 py-2 text-xs text-text-secondary">{status}</p>
        )}

        <p className="mt-4 text-xs text-text-muted">
          Saving starts a fresh conversation — a reply id from one agent can't be continued on
          another. Values are stored in this browser only.
        </p>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={handleReset}
            disabled={!isCustomized(env, values)}
            className="flex-1 rounded-card border border-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset to default
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 rounded-card bg-text-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
