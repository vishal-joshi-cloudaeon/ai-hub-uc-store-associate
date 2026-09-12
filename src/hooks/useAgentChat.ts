import { useCallback, useState } from 'react'
import { resetThread, sendMessage } from '../api/agent'
import type { Message } from '../types'
import type { EnvName } from '../config/environments'

function makeId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useAgentChat(storeId: string, env: EnvName) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isSending, setIsSending] = useState(false)

  const send = useCallback(
    async (content: string) => {
      const userMessage: Message = {
        id: makeId(),
        role: 'user',
        content,
        timestamp: new Date(),
      }
      const loadingMessage: Message = {
        id: makeId(),
        role: 'agent',
        content: '',
        state: 'loading',
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, userMessage, loadingMessage])
      setIsSending(true)

      try {
        const result = await sendMessage(storeId, content, env)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingMessage.id
              ? {
                  ...m,
                  content: result.content,
                  state: result.state,
                  tool_calls: result.tool_calls,
                  approval_id: result.approval_id,
                }
              : m
          )
        )
      } catch (err) {
        const errorText =
          err instanceof Error ? err.message : 'Something went wrong talking to the agent.'
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingMessage.id ? { ...m, content: errorText, state: 'error' as const } : m
          )
        )
      } finally {
        setIsSending(false)
      }
    },
    [storeId, env]
  )

  const appendMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message])
  }, [])

  const updateMessage = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }, [])

  const clear = useCallback(() => {
    resetThread(storeId, env)
    setMessages([])
  }, [storeId, env])

  const setAll = useCallback((next: Message[]) => {
    setMessages(next)
  }, [])

  return { messages, isSending, send, appendMessage, updateMessage, clear, setAll }
}
