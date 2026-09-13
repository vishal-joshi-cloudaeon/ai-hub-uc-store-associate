/**
 * Request/response shapes for the approvals + tools endpoints — the
 * TypeScript replacement for the old Python service's `models.py`
 * (pydantic). zod validates incoming bodies and, like FastAPI, a body that
 * doesn't match is rejected with a 422 before any SQL runs.
 */
import { z } from 'zod'
import type { Row } from './databricks.js'

export const ResolveApprovalBody = z.object({
  status: z.enum(['approved', 'denied']),
  resolved_by: z.string().min(1),
  reason_denied: z.string().nullish(),
})
export type ResolveApprovalBody = z.infer<typeof ResolveApprovalBody>

/** Body the Foundry Loyalty-Agent's `request_approval` tool call sends.
 *
 * Matches the OpenAPI schema actually registered on the agent (confirmed
 * live via the agent's own tool list) — customer_ids/voucher_value_gbp as
 * separate fields, no action_detail_json or threshold_gbp from the caller. */
export const RequestApprovalBody = z.object({
  store_id: z.string().min(1),
  store_name: z.string().min(1),
  requested_by: z.string().min(1),
  action_type: z.string().default('loyalty_voucher_batch'),
  customer_ids: z.array(z.string()).min(1),
  voucher_value_gbp: z.number(),
  total_value_gbp: z.number(),
})
export type RequestApprovalBody = z.infer<typeof RequestApprovalBody>

/** Body the Foundry Loyalty-Agent's `send_loyalty_voucher` tool call sends. */
export const SendVoucherBody = z.object({
  store_id: z.string().min(1),
  customer_ids: z.array(z.string()).min(1),
  voucher_value_gbp: z.number(),
  approval_id: z.string().min(1),
  approved_by: z.string().min(1),
})
export type SendVoucherBody = z.infer<typeof SendVoucherBody>

export type Approval = {
  approval_id: string
  store_id: string
  store_name: string
  requested_by: string
  action_type: string
  action_detail_json: string
  total_value_gbp: number
  threshold_gbp: number | null
  status: 'pending' | 'approved' | 'denied'
  reason_denied: string | null
  requested_at: string | null
  resolved_at: string | null
  resolved_by: string | null
  workflow_run_id: string | null
}

function str(value: unknown): string | null {
  return value == null ? null : String(value)
}

function num(value: unknown): number | null {
  return value == null ? null : Number(value)
}

/** TIMESTAMP columns already arrive as UTC-marked ISO strings from
 * `databricks.ts`; anything else is passed through as text. */
function ts(value: unknown): string | null {
  return value == null ? null : String(value)
}

export function rowToApproval(row: Row): Approval {
  return {
    approval_id: String(row.approval_id),
    store_id: String(row.store_id),
    store_name: String(row.store_name),
    requested_by: String(row.requested_by),
    action_type: String(row.action_type),
    action_detail_json: String(row.action_detail_json),
    total_value_gbp: Number(row.total_value_gbp),
    threshold_gbp: num(row.threshold_gbp),
    status: row.status as Approval['status'],
    reason_denied: str(row.reason_denied),
    requested_at: ts(row.requested_at),
    resolved_at: ts(row.resolved_at),
    resolved_by: str(row.resolved_by),
    workflow_run_id: str(row.workflow_run_id),
  }
}
