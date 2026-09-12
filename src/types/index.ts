export type MessageState =
  | 'completed'
  | 'blocked'
  | 'awaiting_approval'
  | 'approved'
  | 'denied'
  | 'loading'
  | 'error'

export type ToolCall = {
  tool_name: string
  input_summary: string
  output_summary: string
}

export type Message = {
  id: string
  role: 'user' | 'agent'
  content: string
  state?: MessageState
  tool_calls?: ToolCall[]
  approval_id?: string
  timestamp: Date
}

export type Approval = {
  approval_id: string
  store_id: string
  store_name: string
  requested_by: string
  action_type: string
  action_detail_json: string
  total_value_gbp: number
  status: 'pending' | 'approved' | 'denied'
  reason_denied?: string
  requested_at: string
  resolved_at?: string
  resolved_by?: string
}

export type Store = {
  store_id: string
  store_name: string
}
