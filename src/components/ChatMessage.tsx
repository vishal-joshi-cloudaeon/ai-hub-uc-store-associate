import type { Message } from '../types'
import StateBadge from './StateBadge'
import ToolCallPanel from './ToolCallPanel'

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function AgentAvatar() {
  return (
    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-border bg-white text-text-secondary">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="4" y="8" width="16" height="11" rx="2.5" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" strokeLinecap="round" />
        <circle cx="9" cy="13.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="15" cy="13.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    </div>
  )
}

export default function ChatMessage({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end px-4 py-2">
        <div className="flex max-w-[80%] flex-col items-end sm:max-w-[65%]">
          <div className="rounded-2xl rounded-br-sm border border-border bg-white px-4 py-2.5 shadow-sm">
            <p className="whitespace-pre-wrap text-sm text-text-primary">{message.content}</p>
          </div>
          <span className="mt-1 px-1 text-[11px] text-text-muted">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2.5 px-4 py-2">
      <AgentAvatar />
      <div className="min-w-0 max-w-[85%] flex-1 sm:max-w-[70%]">
        {message.state && (
          <div className="mb-2">
            <StateBadge state={message.state} />
          </div>
        )}

        {message.tool_calls?.map((call, idx) => (
          <ToolCallPanel key={`${message.id}-tool-${idx}`} call={call} />
        ))}

        {message.content && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
            {message.content}
          </p>
        )}
        <span className="mt-1 block text-[11px] text-text-muted">{formatTime(message.timestamp)}</span>
      </div>
    </div>
  )
}
