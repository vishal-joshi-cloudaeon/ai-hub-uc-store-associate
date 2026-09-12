"""
Endpoints the Foundry Loyalty-Agent calls directly as OpenAPI tools
(same pattern/routing as the existing `send_loyalty_voucher_v1` tool via
APIM's `loyalty-tools` API). Registering these as tools on the agent in the
Foundry portal is handled separately — this module only implements what
they call.

Environment (dev/prod) is read from the `X-Environment` header the Foundry
agent sends, defaulting to "dev" if absent/invalid — there's no dev/prod
toggle in the tool's own request body.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Header, HTTPException

from config import APPROVAL_TABLE, VOUCHER_TABLE
from database import execute, query
from models import (
    RequestApprovalBody,
    RequestApprovalResponse,
    SendVoucherBody,
    SendVoucherResponse,
)

router = APIRouter(prefix="/tools", tags=["tools"])

# The registered request_approval tool doesn't send this — it's this
# service's own business rule, not something the caller configures.
AUTO_EXECUTE_THRESHOLD_GBP = 50.0


def _resolve_env(x_environment: str) -> Literal["dev", "prod"]:
    return "prod" if x_environment.lower() == "prod" else "dev"


def _next_approval_id(env: str) -> str:
    # NOTE: MAX+1 as explicitly specified. Not perfectly race-safe under
    # concurrent inserts (no unique constraint enforced client-side here) —
    # acceptable for this use case's expected request volume.
    rows = query(f"SELECT MAX(approval_id) AS max_id FROM {APPROVAL_TABLE}", env=env)
    max_id = rows[0]["max_id"] if rows else None
    if not max_id:
        return "APR-0001"
    next_n = int(max_id.split("-")[1]) + 1
    return f"APR-{next_n:04d}"


@router.post("/request_approval", response_model=RequestApprovalResponse)
def request_approval(body: RequestApprovalBody, x_environment: str = Header(default="dev")):
    env = _resolve_env(x_environment)
    approval_id = _next_approval_id(env)
    now = datetime.now(timezone.utc)
    action_detail_json = json.dumps(
        {
            "customer_ids": body.customer_ids,
            "customer_count": len(body.customer_ids),
            "voucher_value_gbp": body.voucher_value_gbp,
        }
    )

    execute(
        f"""
        INSERT INTO {APPROVAL_TABLE} (
            approval_id, store_id, store_name, requested_by, action_type,
            action_detail_json, total_value_gbp, threshold_gbp, status,
            requested_at, year, month, day
        ) VALUES (
            %(approval_id)s, %(store_id)s, %(store_name)s, %(requested_by)s, %(action_type)s,
            %(action_detail_json)s, %(total_value_gbp)s, %(threshold_gbp)s, 'pending',
            current_timestamp(), %(year)s, %(month)s, %(day)s
        )
        """,
        {
            "approval_id": approval_id,
            "store_id": body.store_id,
            "store_name": body.store_name,
            "requested_by": body.requested_by,
            "action_type": body.action_type,
            "action_detail_json": action_detail_json,
            "total_value_gbp": body.total_value_gbp,
            "threshold_gbp": AUTO_EXECUTE_THRESHOLD_GBP,
            "year": now.year,
            "month": now.month,
            "day": now.day,
        },
        env=env,
    )

    return RequestApprovalResponse(
        approval_id=approval_id,
        message=(
            f"Approval request submitted. Total: £{body.total_value_gbp:.2f} "
            f"exceeds £{AUTO_EXECUTE_THRESHOLD_GBP:.2f} limit."
        ),
        total_value_gbp=body.total_value_gbp,
    )


@router.post("/send_loyalty_voucher", response_model=SendVoucherResponse)
def send_loyalty_voucher(body: SendVoucherBody, x_environment: str = Header(default="dev")):
    env = _resolve_env(x_environment)
    approval_rows = query(
        f"SELECT * FROM {APPROVAL_TABLE} WHERE approval_id = %(id)s", {"id": body.approval_id}, env=env
    )
    # ASSUMPTION: an approval_id that exists must be 'approved' to proceed.
    # An approval_id with no matching row is treated as an auto-execute
    # placeholder (total <= the auto-execute threshold, no approval needed)
    # per the agent's own instructions — adjust if a different sentinel is
    # actually used for that case.
    if approval_rows and approval_rows[0]["status"] != "approved":
        raise HTTPException(
            status_code=409,
            detail=f"Approval {body.approval_id} is not in an approved state "
            f"(current status: {approval_rows[0]['status']})",
        )

    now = datetime.now(timezone.utc)
    for customer_id in body.customer_ids:
        voucher_id = f"VCH-{uuid.uuid4().hex[:10].upper()}"
        execute(
            f"""
            INSERT INTO {VOUCHER_TABLE} (
                voucher_id, approval_id, store_id, customer_id, voucher_value_gbp,
                voucher_type, approved_by, issued_at, year, month, day
            ) VALUES (
                %(voucher_id)s, %(approval_id)s, %(store_id)s, %(customer_id)s, %(voucher_value_gbp)s,
                %(voucher_type)s, %(approved_by)s, current_timestamp(), %(year)s, %(month)s, %(day)s
            )
            """,
            {
                "voucher_id": voucher_id,
                "approval_id": body.approval_id,
                "store_id": body.store_id,
                "customer_id": customer_id,
                "voucher_value_gbp": body.voucher_value_gbp,
                "voucher_type": "win_back",
                "approved_by": body.approved_by,
                "year": now.year,
                "month": now.month,
                "day": now.day,
            },
            env=env,
        )

    rows_inserted = len(body.customer_ids)
    return SendVoucherResponse(
        message=f"{rows_inserted} voucher(s) issued for approval {body.approval_id}.",
        rows_inserted=str(rows_inserted),
        databricks_status="SUCCEEDED",
    )
