import { useState } from 'react'
import type { ToolCall } from '../types'

function ToolIcon({ toolName }: { toolName: string }) {
  if (toolName === 'query_store_data' || toolName.startsWith('query_space_')) {
    return (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
        <path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" />
      </svg>
    )
  }
  if (toolName === 'get_weather') {
    return (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 17.5a4 4 0 0 1 .5-7.98A5.5 5.5 0 0 1 18 11a3.5 3.5 0 0 1-.5 6.5H7z" />
      </svg>
    )
  }
  if (toolName === 'get_calendar') {
    return (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="5" width="16" height="16" rx="2" />
        <path d="M4 10h16M8 3v4M16 3v4" strokeLinecap="round" />
      </svg>
    )
  }
  if (toolName === 'send_loyalty_voucher') {
    return (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M13 4h4a2 2 0 0 1 2 2v4l-9 9-6-6 9-9z" />
        <circle cx="15.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (toolName.startsWith('poll_response_')) {
    return (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" strokeLinecap="round" />
        <path d="M18 4v4h-4M6 20v-4h4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

export default function ToolCallPanel({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-1.5 rounded-card border border-border bg-white text-sm">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-gray-50"
      >
        <span className="text-text-secondary">
          <ToolIcon toolName={call.tool_name} />
        </span>
        <span className="font-medium text-text-primary">{call.tool_name}</span>
        <span className="text-text-muted">→</span>
        <span className="flex-1 truncate text-text-secondary">{call.output_summary}</span>
        <svg
          className={`h-4 w-4 flex-shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-text-muted">Input</div>
            <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-gray-50 p-2 font-mono text-xs text-text-primary">
              {call.input_summary}
            </pre>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-text-muted">Output</div>
            <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-gray-50 p-2 font-mono text-xs text-text-primary">
              {call.output_summary}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
