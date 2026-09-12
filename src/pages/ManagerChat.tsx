import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message, Store } from '../types'
import ChatMessage from '../components/ChatMessage'
import EnvBadge from '../components/EnvBadge'
import { useAgentChat } from '../hooks/useAgentChat'
import { useApprovalPolling } from '../hooks/useApprovalPolling'
import { useEnv } from '../hooks/useEnv'

const STORES: Store[] = [
  { store_id: 'S001', store_name: 'Aberdeen' },
  { store_id: 'S002', store_name: 'Edinburgh' },
  { store_id: 'S003', store_name: 'Manchester' },
  { store_id: 'S004', store_name: 'Leeds Central' },
  { store_id: 'S005', store_name: 'Birmingham' },
  { store_id: 'S006', store_name: 'Cardiff' },
  { store_id: 'S007', store_name: 'Bristol West' },
  { store_id: 'S008', store_name: 'London Flagship' },
  { store_id: 'S009', store_name: 'Newcastle' },
  { store_id: 'S010', store_name: 'Plymouth' },
]

function makeId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function ManagerChat() {
  const { env } = useEnv()
  const [storeId, setStoreId] = useState(STORES[0].store_id)
  const [input, setInput] = useState('')

  const chat = useAgentChat(storeId, env)
  const messages = chat.messages
  const scrollRef = useRef<HTMLDivElement>(null)

  const awaitingMessage = messages.find((m) => m.state === 'awaiting_approval')
  const { result: approvalResult, error: approvalError } = useApprovalPolling(
    awaitingMessage?.approval_id ?? null,
    env
  )

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!approvalResult || !awaitingMessage) return

    const resolutionMessage: Message = {
      id: makeId(),
      role: 'agent',
      state: approvalResult.status === 'approved' ? 'approved' : 'denied',
      content:
        approvalResult.status === 'approved'
          ? `✓ Approved by ${approvalResult.resolved_by ?? 'cluster head'}. The vouchers are being sent now.`
          : `✗ Denied by ${approvalResult.resolved_by ?? 'cluster head'}.${
              approvalResult.reason_denied ? ` Reason: ${approvalResult.reason_denied}` : ''
            }`,
      timestamp: new Date(),
    }

    chat.appendMessage(resolutionMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalResult])

  const isAwaitingApproval = Boolean(awaitingMessage) && !approvalResult
  const isInputDisabled = isAwaitingApproval || chat.isSending

  const handleStoreChange = (nextStoreId: string) => {
    setStoreId(nextStoreId)
    chat.clear()
  }

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || isInputDisabled) return
    setInput('')
    await chat.send(trimmed)
  }

  const inputPlaceholder = useMemo(
    () => (isAwaitingApproval ? 'Awaiting cluster head approval...' : 'Message the loyalty agent...'),
    [isAwaitingApproval]
  )

  return (
    <div className="flex h-screen items-center justify-center bg-gray-100 p-6">
      <div className="flex h-[88vh] w-full max-w-[33vw] min-w-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-lg">
        <header className="flex flex-shrink-0 flex-col gap-3 border-b border-border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-text-primary">Store manager</span>
              <EnvBadge />
            </div>
            <span className="text-xs text-text-muted">Loyalty agent</span>
          </div>
          <select
            value={storeId}
            onChange={(e) => handleStoreChange(e.target.value)}
            className="w-full rounded-card border border-border bg-white px-3 py-1.5 text-sm text-text-primary transition focus:border-text-secondary focus:outline-none sm:w-auto"
          >
            {STORES.map((store) => (
              <option key={store.store_id} value={store.store_id}>
                {store.store_id} {store.store_name}
              </option>
            ))}
          </select>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-chat-bg py-4">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              Start a conversation with the loyalty agent.
            </div>
          ) : (
            messages.map((message) => <ChatMessage key={message.id} message={message} />)
          )}
          {approvalError && (
            <div className="px-4 py-2">
              <p className="rounded-card bg-red-50 px-3 py-2 text-sm text-brand-red">
                {approvalError}
              </p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-border bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              disabled={isInputDisabled}
              placeholder={inputPlaceholder}
              className="flex-1 rounded-card border border-border px-3 py-2 text-sm text-text-primary transition focus:border-text-secondary focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-text-muted"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isInputDisabled || !input.trim()}
              className="flex items-center gap-2 rounded-card bg-text-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {chat.isSending && (
                <svg className="h-3.5 w-3.5 animate-spin-slow" viewBox="0 0 24 24" fill="none">
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
              )}
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
