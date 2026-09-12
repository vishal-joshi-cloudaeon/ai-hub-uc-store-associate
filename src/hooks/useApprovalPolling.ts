import { useEffect, useRef, useState } from 'react'
import { getApproval, listApprovals } from '../api/approvals'
import type { Approval } from '../types'
import type { EnvName } from '../config/environments'

const POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS ?? 5000)

/**
 * Polls a single approval by id until it resolves to approved/denied.
 * Pass null to disable polling.
 */
export function useApprovalPolling(approvalId: string | null, env: EnvName) {
  const [result, setResult] = useState<Approval | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setResult(null)
    setError(null)
    if (!approvalId) return

    let cancelled = false

    const poll = async () => {
      try {
        const approval = await getApproval(approvalId, env)
        if (cancelled) return
        if (approval.status === 'approved' || approval.status === 'denied') {
          setResult(approval)
          return
        }
        timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to poll approval status.')
        timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    poll()

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [approvalId, env])

  return { result, error }
}

/**
 * Polls the pending-approvals list on an interval, for the cluster head
 * pending tab. Set `active` to false to pause polling (e.g. on other tabs).
 */
export function usePendingApprovalsPolling(active: boolean, env: EnvName) {
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!active) return

    let cancelled = false

    const poll = async () => {
      try {
        const data = await listApprovals('pending', env)
        if (cancelled) return
        setApprovals(data)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load pending approvals.')
      } finally {
        if (!cancelled) {
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
        }
      }
    }

    poll()

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [active, env])

  return { approvals, error }
}
