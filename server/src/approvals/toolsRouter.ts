/**
 * Endpoints the Foundry Loyalty-Agent calls directly as OpenAPI tools — the
 * TypeScript replacement for the old Python service's `routers/tools.py`,
 * mounted at /tools.
 *
 * Environment (dev/prod) is read from the `X-Environment` header the Foundry
 * agent sends, defaulting to "dev" if absent/invalid — there's no dev/prod
 * toggle in the tool's own request body.
 *
 * These endpoints write to Databricks and are reachable by anything that can
 * resolve this Web App's URL, so they take an optional shared secret:
 * when TOOLS_API_KEY is set, callers must send it as `X-Api-Key`. It is only
 * enforced when set, so an existing agent registration keeps working until
 * the header is added on the Foundry/APIM side.
 */
import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { APPROVAL_TABLE, VOUCHER_TABLE, resolveEnv } from './config.js'
import type { EnvName } from './config.js'
import { execute, query, sql } from './databricks.js'
import { HttpError, asyncHandler, parseBody } from './http.js'
import { RequestApprovalBody, SendVoucherBody } from './models.js'

const TOOLS_API_KEY = process.env.TOOLS_API_KEY || ''

// The registered request_approval tool doesn't send this — it's this
// service's own business rule, not something the caller configures.
const AUTO_EXECUTE_THRESHOLD_GBP = 50.0

export const toolsRouter = Router()

toolsRouter.use((req, _res, next) => {
  if (TOOLS_API_KEY && req.header('x-api-key') !== TOOLS_API_KEY) {
    next(new HttpError(401, 'Invalid or missing X-Api-Key'))
    return
  }
  next()
})

function envFromHeader(req: { header(name: string): string | undefined }): EnvName {
  return resolveEnv(req.header('x-environment'))
}

async function nextApprovalId(env: EnvName): Promise<string> {
  // NOTE: MAX+1 as explicitly specified. Not perfectly race-safe under
  // concurrent inserts (no unique constraint enforced client-side here) —
  // acceptable for this use case's expected request volume.
  const rows = await query(`SELECT MAX(approval_id) AS max_id FROM ${APPROVAL_TABLE}`, {}, env)
  const maxId = rows.length ? rows[0].max_id : null
  if (!maxId) return 'APR-0001'
  const nextN = parseInt(String(maxId).split('-')[1], 10) + 1
  return `APR-${String(nextN).padStart(4, '0')}`
}

toolsRouter.post(
  '/request_approval',
  asyncHandler(async (req, res) => {
    const env = envFromHeader(req)
    const body = parseBody(RequestApprovalBody, req)

    const approvalId = await nextApprovalId(env)
    const now = new Date()
    const actionDetailJson = JSON.stringify({
      customer_ids: body.customer_ids,
      customer_count: body.customer_ids.length,
      voucher_value_gbp: body.voucher_value_gbp,
    })

    await execute(
      `
      INSERT INTO ${APPROVAL_TABLE} (
          approval_id, store_id, store_name, requested_by, action_type,
          action_detail_json, total_value_gbp, threshold_gbp, status,
          requested_at, year, month, day
      ) VALUES (
          :approval_id, :store_id, :store_name, :requested_by, :action_type,
          :action_detail_json, :total_value_gbp, :threshold_gbp, 'pending',
          current_timestamp(), :year, :month, :day
      )
      `,
      {
        approval_id: sql.string(approvalId),
        store_id: sql.string(body.store_id),
        store_name: sql.string(body.store_name),
        requested_by: sql.string(body.requested_by),
        action_type: sql.string(body.action_type),
        action_detail_json: sql.string(actionDetailJson),
        total_value_gbp: sql.double(body.total_value_gbp),
        threshold_gbp: sql.double(AUTO_EXECUTE_THRESHOLD_GBP),
        year: sql.int(now.getUTCFullYear()),
        month: sql.int(now.getUTCMonth() + 1),
        day: sql.int(now.getUTCDate()),
      },
      env
    )

    res.json({
      status: 'pending_approval',
      approval_id: approvalId,
      message:
        `Approval request submitted. Total: £${body.total_value_gbp.toFixed(2)} ` +
        `exceeds £${AUTO_EXECUTE_THRESHOLD_GBP.toFixed(2)} limit.`,
      total_value_gbp: body.total_value_gbp,
    })
  })
)

toolsRouter.post(
  '/send_loyalty_voucher',
  asyncHandler(async (req, res) => {
    const env = envFromHeader(req)
    const body = parseBody(SendVoucherBody, req)

    const approvalRows = await query(
      `SELECT * FROM ${APPROVAL_TABLE} WHERE approval_id = :id`,
      { id: sql.string(body.approval_id) },
      env
    )
    // ASSUMPTION: an approval_id that exists must be 'approved' to proceed.
    // An approval_id with no matching row is treated as an auto-execute
    // placeholder (total <= the auto-execute threshold, no approval needed)
    // per the agent's own instructions — adjust if a different sentinel is
    // actually used for that case.
    if (approvalRows.length && approvalRows[0].status !== 'approved') {
      throw new HttpError(
        409,
        `Approval ${body.approval_id} is not in an approved state ` +
          `(current status: ${approvalRows[0].status})`
      )
    }

    const now = new Date()
    for (const customerId of body.customer_ids) {
      const voucherId = `VCH-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`
      await execute(
        `
        INSERT INTO ${VOUCHER_TABLE} (
            voucher_id, approval_id, store_id, customer_id, voucher_value_gbp,
            voucher_type, approved_by, issued_at, year, month, day
        ) VALUES (
            :voucher_id, :approval_id, :store_id, :customer_id, :voucher_value_gbp,
            :voucher_type, :approved_by, current_timestamp(), :year, :month, :day
        )
        `,
        {
          voucher_id: sql.string(voucherId),
          approval_id: sql.string(body.approval_id),
          store_id: sql.string(body.store_id),
          customer_id: sql.string(customerId),
          voucher_value_gbp: sql.double(body.voucher_value_gbp),
          voucher_type: sql.string('win_back'),
          approved_by: sql.string(body.approved_by),
          year: sql.int(now.getUTCFullYear()),
          month: sql.int(now.getUTCMonth() + 1),
          day: sql.int(now.getUTCDate()),
        },
        env
      )
    }

    const rowsInserted = body.customer_ids.length
    res.json({
      status: 'sent',
      message: `${rowsInserted} voucher(s) issued for approval ${body.approval_id}.`,
      rows_inserted: String(rowsInserted),
      databricks_status: 'SUCCEEDED',
    })
  })
)
