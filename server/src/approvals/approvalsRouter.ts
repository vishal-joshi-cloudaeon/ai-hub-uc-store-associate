/**
 * The cluster-head approvals API — the TypeScript replacement for the old
 * Python service's `routers/approvals.py`, mounted at /api/approvals.
 *
 * This is now same-origin with the SPA it serves, so there is no shared
 * secret between browser and API any more (the browser could only ship one
 * in its own bundle). Access control is the Azure Web App's own
 * authentication — see the deployment section of the README.
 */
import { Router } from 'express'
import { APPROVAL_TABLE, resolveEnv } from './config.js'
import { execute, query, sql } from './databricks.js'
import { HttpError, asyncHandler, parseBody } from './http.js'
import { ResolveApprovalBody, rowToApproval } from './models.js'

export const approvalsRouter = Router()

approvalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const env = resolveEnv(req.query.env)
    const status = req.query.status
    if (status !== 'pending' && status !== 'resolved') {
      throw new HttpError(422, [
        { loc: ['query', 'status'], msg: "must be 'pending' or 'resolved'", type: 'enum' },
      ])
    }

    const rows =
      status === 'pending'
        ? await query(
            `SELECT * FROM ${APPROVAL_TABLE} WHERE status = :status ORDER BY requested_at DESC`,
            { status: sql.string('pending') },
            env
          )
        : await query(
            `SELECT * FROM ${APPROVAL_TABLE} WHERE status IN ('approved', 'denied') ORDER BY resolved_at DESC`,
            {},
            env
          )

    res.json(rows.map(rowToApproval))
  })
)

approvalsRouter.get(
  '/:approvalId',
  asyncHandler(async (req, res) => {
    const env = resolveEnv(req.query.env)
    const { approvalId } = req.params
    const rows = await query(
      `SELECT * FROM ${APPROVAL_TABLE} WHERE approval_id = :id`,
      { id: sql.string(approvalId) },
      env
    )
    if (!rows.length) throw new HttpError(404, `Approval ${approvalId} not found`)
    res.json(rowToApproval(rows[0]))
  })
)

approvalsRouter.patch(
  '/:approvalId',
  asyncHandler(async (req, res) => {
    const env = resolveEnv(req.query.env)
    const { approvalId } = req.params
    const body = parseBody(ResolveApprovalBody, req)

    const existing = await query(
      `SELECT * FROM ${APPROVAL_TABLE} WHERE approval_id = :id`,
      { id: sql.string(approvalId) },
      env
    )
    if (!existing.length) throw new HttpError(404, `Approval ${approvalId} not found`)
    if (existing[0].status !== 'pending') {
      throw new HttpError(409, `Approval ${approvalId} is already ${existing[0].status}`)
    }
    if (body.status === 'denied' && !body.reason_denied) {
      throw new HttpError(422, 'reason_denied is required when denying')
    }

    await execute(
      `
      UPDATE ${APPROVAL_TABLE}
      SET status = :status,
          resolved_by = :resolved_by,
          reason_denied = :reason_denied,
          resolved_at = current_timestamp()
      WHERE approval_id = :id
      `,
      {
        status: sql.string(body.status),
        resolved_by: sql.string(body.resolved_by),
        reason_denied: sql.string(body.reason_denied),
        id: sql.string(approvalId),
      },
      env
    )

    const updated = await query(
      `SELECT * FROM ${APPROVAL_TABLE} WHERE approval_id = :id`,
      { id: sql.string(approvalId) },
      env
    )
    res.json(rowToApproval(updated[0]))
  })
)
