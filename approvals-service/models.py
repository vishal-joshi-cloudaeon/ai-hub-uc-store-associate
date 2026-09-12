from typing import Literal, Optional

from pydantic import BaseModel, Field


class Approval(BaseModel):
    approval_id: str
    store_id: str
    store_name: str
    requested_by: str
    action_type: str
    action_detail_json: str
    total_value_gbp: float
    threshold_gbp: Optional[float] = None
    status: Literal["pending", "approved", "denied"]
    reason_denied: Optional[str] = None
    requested_at: str
    resolved_at: Optional[str] = None
    resolved_by: Optional[str] = None
    workflow_run_id: Optional[str] = None


class ResolveApprovalBody(BaseModel):
    status: Literal["approved", "denied"]
    resolved_by: str
    reason_denied: Optional[str] = None


class RequestApprovalBody(BaseModel):
    """Body the Foundry Loyalty-Agent's `request_approval` tool call sends.

    Matches the OpenAPI schema actually registered on the agent (confirmed
    live via the agent's own tool list) — customer_ids/voucher_value_gbp as
    separate fields, no action_detail_json or threshold_gbp from the caller.
    """

    store_id: str
    store_name: str
    requested_by: str
    action_type: str = "loyalty_voucher_batch"
    customer_ids: list[str] = Field(min_length=1)
    voucher_value_gbp: float
    total_value_gbp: float


class RequestApprovalResponse(BaseModel):
    status: Literal["pending_approval"] = "pending_approval"
    approval_id: str
    message: str
    total_value_gbp: float


class SendVoucherBody(BaseModel):
    """Body the Foundry Loyalty-Agent's `send_loyalty_voucher` tool call sends."""

    store_id: str
    customer_ids: list[str] = Field(min_length=1)
    voucher_value_gbp: float
    approval_id: str
    approved_by: str


class SendVoucherResponse(BaseModel):
    status: Literal["sent"] = "sent"
    message: str
    rows_inserted: str
    databricks_status: str
