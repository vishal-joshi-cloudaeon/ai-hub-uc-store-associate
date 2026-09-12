import type { MessageState } from '../types'

const CONFIG: Record<
  MessageState,
  { label: string; bg: string; text: string; icon: JSX.Element }
> = {
  loading: {
    label: 'Thinking...',
    bg: 'bg-gray-100',
    text: 'text-gray-600',
    icon: (
      <svg className="h-3 w-3 animate-spin-slow" viewBox="0 0 24 24" fill="none">
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="40"
          strokeDashoffset="10"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  completed: {
    label: 'Completed',
    bg: 'bg-green-50',
    text: 'text-green-700',
    icon: (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  blocked: {
    label: 'Blocked — data policy',
    bg: 'bg-red-50',
    text: 'text-red-700',
    icon: (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
      </svg>
    ),
  },
  awaiting_approval: {
    label: 'Awaiting cluster head approval',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    icon: (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  approved: {
    label: 'Approved',
    bg: 'bg-green-50',
    text: 'text-green-700',
    icon: (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  denied: {
    label: 'Denied',
    bg: 'bg-red-50',
    text: 'text-red-700',
    icon: (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  error: {
    label: 'Error',
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    icon: (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5" strokeLinecap="round" />
        <circle cx="12" cy="16" r="0.75" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
}

export default function StateBadge({ state }: { state: MessageState }) {
  const cfg = CONFIG[state]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-badge px-2.5 py-1 text-xs font-medium ${cfg.bg} ${cfg.text}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  )
}
