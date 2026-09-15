import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message, Store } from '../types'
import AgentSettingsModal from '../components/AgentSettingsModal'
import ChatMessage from '../components/ChatMessage'
import EnvBadge from '../components/EnvBadge'
import SuggestedQuestions from '../components/SuggestedQuestions'
import { RECOMMENDED_QUESTIONS } from '../config/recommendedQuestions'
import { useAgentChat } from '../hooks/useAgentChat'
import { useApprovalPolling } from '../hooks/useApprovalPolling'
import { useEnv } from '../hooks/useEnv'
import { hasAnyOverride, loadOverrides, type AgentOverrides } from '../config/agentOverrides'

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
  const [showSettings, setShowSettings] = useState(false)
  // Only drives the dot on the gear icon — the values themselves are read
  // per request in src/api/agent.ts, so this never has to be threaded
  // through the chat hook.
  const [usingOverrides, setUsingOverrides] = useState(() => hasAnyOverride(loadOverrides(env)))

  useEffect(() => {
    setUsingOverrides(hasAnyOverride(loadOverrides(env)))
  }, [env])

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

  // A previous_response_id belongs to the endpoint/agent that issued it, so
  // changing the connection starts a fresh conversation rather than trying
  // to continue the old one somewhere it doesn't exist.
  const handleSettingsApplied = (next: AgentOverrides) => {
    setUsingOverrides(hasAnyOverride(next))
    chat.clear()
  }

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || isInputDisabled) return
    setInput('')
    await chat.send(trimmed)
  }

  const handleSuggestedClick = async (question: string) => {
    if (isInputDisabled) return
    await chat.send(question)
  }

  // Stage 1: only the first recommended question, before anything is sent.
  // Stage 2: the remaining two, once the first response has come back.
  // After that, the manager is free-typing — no more suggestions to avoid
  // clutter. "Clear chat" resets `messages` to [], which puts this straight
  // back to stage 1.
  const userMessageCount = messages.filter((m) => m.role === 'user').length
  const showFirstSuggestion = userMessageCount === 0 && !isInputDisabled
  const showRemainingSuggestions = userMessageCount === 1 && !isInputDisabled

  const inputPlaceholder = useMemo(
    () => (isAwaitingApproval ? 'Awaiting cluster head approval...' : 'Message the loyalty agent...'),
    [isAwaitingApproval]
  )

  return (
    <div className="flex h-screen items-center justify-center bg-gray-100 p-6">
      <div className="flex h-[88vh] w-full max-w-[33vw] min-w-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-lg">
        <header className="flex flex-shrink-0 flex-col gap-3 border-b border-border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-sm font-semibold text-text-primary">
                Store manager
              </span>
              <EnvBadge />
            </div>
            <span className="text-xs text-text-muted">Loyalty agent</span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <select
              value={storeId}
              onChange={(e) => handleStoreChange(e.target.value)}
              className="min-w-0 flex-1 rounded-card border border-border bg-white px-2 py-1.5 text-sm text-text-primary transition focus:border-text-secondary focus:outline-none sm:flex-none"
            >
              {STORES.map((store) => (
                <option key={store.store_id} value={store.store_id}>
                  {store.store_id} {store.store_name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => chat.clear()}
              title="Clear chat"
              aria-label="Clear chat"
              className="flex-shrink-0 rounded-card border border-border bg-white p-1.5 text-text-secondary transition hover:bg-gray-50"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              title={
                usingOverrides
                  ? 'Agent connection — custom values in use'
                  : 'Agent connection settings'
              }
              aria-label="Agent connection settings"
              className="relative flex-shrink-0 rounded-card border border-border bg-white p-1.5 text-text-secondary transition hover:bg-gray-50"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              {usingOverrides && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand-amber ring-2 ring-white"
                  aria-hidden="true"
                />
              )}
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-chat-bg py-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-sm text-text-muted">
              <span>Start a conversation with the loyalty agent.</span>
              {showFirstSuggestion && (
                <div className="w-full max-w-sm">
                  <SuggestedQuestions
                    questions={[RECOMMENDED_QUESTIONS[0]]}
                    onSelect={handleSuggestedClick}
                  />
                </div>
              )}
            </div>
          ) : (
            messages.map((message) => <ChatMessage key={message.id} message={message} />)
          )}
          {showRemainingSuggestions && (
            <SuggestedQuestions
              questions={RECOMMENDED_QUESTIONS.slice(1)}
              onSelect={handleSuggestedClick}
            />
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

      {showSettings && (
        <AgentSettingsModal
          env={env}
          onClose={() => setShowSettings(false)}
          onApplied={handleSettingsApplied}
        />
      )}
    </div>
  )
}
