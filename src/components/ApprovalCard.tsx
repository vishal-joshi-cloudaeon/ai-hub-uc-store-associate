import { useState } from 'react'
import type { Approval } from '../types'
import DenyModal from './DenyModal'
import { resolveApproval } from '../api/approvals'
import type { EnvName } from '../config/environments'

const RESOLVER_NAME = 'Sarah Chen'

function timeAgo(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const minutes = Math.max(0, Math.floor(diffMs / 60000))

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.floor(minutes / 60)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)

  if (date.toDateString() === yesterday.toDateString()) {
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    return `Yesterday ${time}`
  }
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function formatGbp(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value)
}

function parseJustification(actionDetailJson: string): string {
  try {
    const parsed = JSON.parse(actionDetailJson)
    return parsed.justification ?? parsed.reason ?? actionDetailJson
  } catch {
    return actionDetailJson
  }
}

function parseCustomerSummary(actionDetailJson: string): string | null {
  try {
    const parsed = JSON.parse(actionDetailJson)
    if (parsed.customer_count && parsed.tier) {
      return `${parsed.customer_count} customers · ${parsed.tier} tier`
    }
    return null
  } catch {
    return null
  }
}

type ApprovalCardProps = {
  approval: Approval
  env: EnvName
  onResolved?: (updated: Approval) => void
  /** Fired the instant the API call succeeds, before the 1s reveal delay, so a
   * parent that re-fetches from the server can keep this card pinned in view
   * (server-side it is no longer "pending") until onResolved fires. */
  onResolvingChange?: (approvalId: string, isResolving: boolean) => void
}

type LocalStatus = 'pending' | 'approved' | 'denied'

export default function ApprovalCard({ approval, env, onResolved, onResolvingChange }: ApprovalCardProps) {
  const [localStatus, setLocalStatus] = useState<LocalStatus>(approval.status)
  const [showDenyModal, setShowDenyModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPending = approval.status === 'pending'
  const isResolvedView = !isPending

  const handleApprove = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const updated = await resolveApproval(
        approval.approval_id,
        {
          status: 'approved',
          resolved_by: RESOLVER_NAME,
        },
        env
      )
      setLocalStatus('approved')
      onResolvingChange?.(approval.approval_id, true)
      setTimeout(() => {
        onResolvingChange?.(approval.approval_id, false)
        onResolved?.(updated)
      }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve request.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeny = async (reason: string) => {
    setSubmitting(true)
    setError(null)
    try {
      const updated = await resolveApproval(
        approval.approval_id,
        {
          status: 'denied',
          resolved_by: RESOLVER_NAME,
          reason_denied: reason,
        },
        env
      )
      setShowDenyModal(false)
      setLocalStatus('denied')
      onResolvingChange?.(approval.approval_id, true)
      setTimeout(() => {
        onResolvingChange?.(approval.approval_id, false)
        onResolved?.(updated)
      }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deny request.')
    } finally {
      setSubmitting(false)
    }
  }

  const customerSummary = parseCustomerSummary(approval.action_detail_json)

  return (
    <div
      className={`rounded-card border border-border bg-white p-4 transition ${
        isResolvedView ? 'opacity-60' : ''
      }`}
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-sm font-semibold text-text-primary">{approval.store_name}</p>
          <p className="text-sm text-text-secondary">{approval.requested_by}</p>
          <p className="mt-1 text-sm text-text-secondary">{approval.action_type}</p>
          {customerSummary && (
            <p className="text-xs text-text-muted">{customerSummary}</p>
          )}
        </div>
        <div className="flex flex-row items-start gap-4 sm:flex-col sm:items-end sm:gap-1.5">
          <div className="sm:text-right">
            <p className="text-xl font-semibold text-text-primary">
              {formatGbp(approval.total_value_gbp)}
            </p>
            <p className="text-xs text-text-muted">total value</p>
          </div>
          <span
            className={`inline-flex items-center rounded-badge px-2.5 py-1 text-xs font-medium ${
              isPending ? 'bg-amber-50 text-brand-amber' : 'bg-gray-100 text-text-secondary'
            }`}
          >
            {timeAgo(approval.requested_at)}
          </span>
        </div>
      </div>

      <div className="mt-3 rounded-card bg-gray-50 p-3">
        <p className="text-sm text-text-primary">{parseJustification(approval.action_detail_json)}</p>
        <p className="mt-2 text-xs text-text-muted">
          Customer identifiers are anonymised. No PII accessed.
        </p>
      </div>

      {approval.status === 'denied' && approval.reason_denied && (
        <div className="mt-2 rounded-card bg-red-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-red">
            Reason for denial
          </p>
          <p className="mt-1 text-sm text-red-700">{approval.reason_denied}</p>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-brand-red">{error}</p>}

      {isPending && (
        <div className="mt-4 flex gap-3">
          {localStatus === 'pending' && (
            <>
              <button
                type="button"
                onClick={handleApprove}
                disabled={submitting}
                className="flex-1 rounded-card border border-brand-green bg-green-50 px-4 py-2 text-sm font-medium text-green-700 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ✓ Approve
              </button>
              <button
                type="button"
                onClick={() => setShowDenyModal(true)}
                disabled={submitting}
                className="flex-1 rounded-card border border-brand-red bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ✗ Deny
              </button>
            </>
          )}
          {localStatus === 'approved' && (
            <span className="flex-1 rounded-card bg-green-50 px-4 py-2 text-center text-sm font-medium text-green-700">
              ✓ Approved
            </span>
          )}
          {localStatus === 'denied' && (
            <span className="flex-1 rounded-card bg-red-50 px-4 py-2 text-center text-sm font-medium text-red-700">
              ✗ Denied
            </span>
          )}
        </div>
      )}

      {isResolvedView && (
        <div className="mt-4 flex items-center gap-2">
          <span
            className={`inline-flex rounded-badge px-2.5 py-1 text-xs font-medium ${
              approval.status === 'approved'
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {approval.status === 'approved' ? '✓ Approved' : '✗ Denied'}
          </span>
          {approval.resolved_by && (
            <span className="text-xs text-text-muted">
              {approval.status === 'approved' ? 'Approved' : 'Denied'} by {approval.resolved_by}
            </span>
          )}
        </div>
      )}

      {showDenyModal && (
        <DenyModal
          onCancel={() => setShowDenyModal(false)}
          onSubmit={handleDeny}
          submitting={submitting}
        />
      )}
    </div>
  )
}
