import axios from 'axios'
import type { Approval } from '../types'
import { getEnvConfig, type EnvName } from '../config/environments'

function client(env: EnvName) {
  return axios.create({
    baseURL: getEnvConfig(env).approvalsApiUrl,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function listApprovals(status: 'pending' | 'resolved', env: EnvName): Promise<Approval[]> {
  const { data } = await client(env).get<Approval[]>('/api/approvals', { params: { status, env } })
  return data
}

export async function getApproval(approvalId: string, env: EnvName): Promise<Approval> {
  const { data } = await client(env).get<Approval>(`/api/approvals/${approvalId}`, { params: { env } })
  return data
}

export type ResolveApprovalPayload =
  | { status: 'approved'; resolved_by: string }
  | { status: 'denied'; resolved_by: string; reason_denied: string }

export async function resolveApproval(
  approvalId: string,
  payload: ResolveApprovalPayload,
  env: EnvName
): Promise<Approval> {
  const { data } = await client(env).patch<Approval>(`/api/approvals/${approvalId}`, payload, {
    params: { env },
  })
  return data
}
