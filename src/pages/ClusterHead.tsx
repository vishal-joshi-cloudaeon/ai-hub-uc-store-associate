import { useEffect, useMemo, useState } from 'react'
import type { Approval } from '../types'
import ApprovalCard from '../components/ApprovalCard'
import EnvBadge from '../components/EnvBadge'
import { listApprovals } from '../api/approvals'
import { usePendingApprovalsPolling } from '../hooks/useApprovalPolling'
import { useEnv } from '../hooks/useEnv'

type Tab = 'pending' | 'history'

function InboxIcon() {
  return (
    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 12h4l1.5 3h5L16 12h4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="6" width="16" height="13" rx="2" />
    </svg>
  )
}

export default function ClusterHead() {
  const { env } = useEnv()
  const [activeTab, setActiveTab] = useState<Tab>('pending')
  const [resolvingSnapshots, setResolvingSnapshots] = useState<Record<string, Approval>>({})
  const [history, setHistory] = useState<Approval[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const { approvals: polledPending, error: pendingError } = usePendingApprovalsPolling(
    activeTab === 'pending',
    env
  )

  const handleResolvingChange = (approvalId: string, isResolving: boolean, snapshot?: Approval) => {
    setResolvingSnapshots((prev) => {
      if (isResolving && snapshot) {
        return { ...prev, [approvalId]: snapshot }
      }
      const next = { ...prev }
      delete next[approvalId]
      return next
    })
  }

  const displayedPending = useMemo(() => {
    const byId = new Map(polledPending.map((a) => [a.approval_id, a]))
    for (const [id, snapshot] of Object.entries(resolvingSnapshots)) {
      if (!byId.has(id)) byId.set(id, snapshot)
    }
    return Array.from(byId.values())
  }, [polledPending, resolvingSnapshots])

  useEffect(() => {
    if (activeTab !== 'history') return
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError(null)
    listApprovals('resolved', env)
      .then((data) => {
        if (!cancelled) setHistory(data)
      })
      .catch((err) => {
        if (!cancelled) {
          setHistoryError(err instanceof Error ? err.message : 'Failed to load history.')
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, env])

  return (
    <div className="flex h-screen items-center justify-center bg-gray-100 p-6">
      <div className="flex h-[88vh] w-full max-w-[33vw] min-w-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-lg">
        <header className="flex flex-shrink-0 flex-col gap-2 border-b border-border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">Cluster head</span>
            <EnvBadge />
          </div>
          <span className="text-xs text-text-muted">Sarah Chen &middot; North cluster</span>
        </header>

        <nav className="flex flex-shrink-0 gap-6 border-b border-border px-4">
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`border-b-2 px-1 py-3 text-sm font-medium transition ${
              activeTab === 'pending'
                ? 'border-brand-blue text-brand-blue'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            Pending ({displayedPending.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`border-b-2 px-1 py-3 text-sm font-medium transition ${
              activeTab === 'history'
                ? 'border-brand-blue text-brand-blue'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            History
          </button>
        </nav>

        <div className="flex-1 overflow-y-auto bg-chat-bg px-4 py-4">
          {activeTab === 'pending' && (
            <>
              {pendingError && (
                <p className="mb-3 rounded-card bg-red-50 px-3 py-2 text-sm text-brand-red">
                  {pendingError}
                </p>
              )}
              {displayedPending.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-text-muted">
                  <InboxIcon />
                  <p className="text-sm">No pending approvals</p>
                </div>
              ) : (
                <div className="mx-auto flex max-w-2xl flex-col gap-3">
                  {displayedPending.map((approval) => (
                    <ApprovalCard
                      key={approval.approval_id}
                      approval={approval}
                      env={env}
                      onResolvingChange={(id, resolving) =>
                        handleResolvingChange(id, resolving, resolving ? approval : undefined)
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'history' && (
            <>
              {historyError && (
                <p className="mb-3 rounded-card bg-red-50 px-3 py-2 text-sm text-brand-red">
                  {historyError}
                </p>
              )}
              {historyLoading ? (
                <p className="text-sm text-text-muted">Loading history...</p>
              ) : history.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-text-muted">
                  <InboxIcon />
                  <p className="text-sm">No resolved approvals yet</p>
                </div>
              ) : (
                <div className="mx-auto flex max-w-2xl flex-col gap-3">
                  {history.map((approval) => (
                    <ApprovalCard key={approval.approval_id} approval={approval} env={env} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
