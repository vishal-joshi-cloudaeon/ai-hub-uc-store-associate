import os
from datetime import timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from config import APPROVAL_TABLE
from database import execute, query
from models import Approval, ResolveApprovalBody

# Shared secret with the UI app's server-side proxy (server/src/approvalsProxy.ts) —
# this app has no browser-facing CORS origin in the Azure deployment, so this
# is the only thing stopping an arbitrary caller who finds this Web App's URL
# from reading/resolving approvals. Not required for /tools/*, which Foundry
# calls directly via its own separately-secured path.
APPROVALS_API_KEY = os.environ.get("APPROVALS_API_KEY", "")


def _check_api_key(x_api_key: str = Header(default="")) -> None:
    if APPROVALS_API_KEY and x_api_key != APPROVALS_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Api-Key")


router = APIRouter(prefix="/api/approvals", tags=["approvals"], dependencies=[Depends(_check_api_key)])


def _iso(value: Any) -> str | None:
    """Databricks TIMESTAMP columns come back as naive datetimes representing
    UTC wall-clock time. `.isoformat()` on a naive datetime omits any offset,
    which browsers then parse as *local* time — silently shifting every
    timestamp by the viewer's UTC offset. Mark it UTC explicitly so the
    frontend gets an unambiguous timestamp."""
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        if getattr(value, "tzinfo", None) is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value)


def _row_to_approval(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "approval_id": row["approval_id"],
        "store_id": row["store_id"],
        "store_name": row["store_name"],
        "requested_by": row["requested_by"],
        "action_type": row["action_type"],
        "action_detail_json": row["action_detail_json"],
        "total_value_gbp": float(row["total_value_gbp"]),
        "threshold_gbp": float(row["threshold_gbp"]) if row.get("threshold_gbp") is not None else None,
        "status": row["status"],
        "reason_denied": row.get("reason_denied"),
        "requested_at": _iso(row.get("requested_at")),
        "resolved_at": _iso(row.get("resolved_at")),
        "resolved_by": row.get("resolved_by"),
        "workflow_run_id": row.get("workflow_run_id"),
    }


@router.get("", response_model=list[Approval])
def list_approvals(status: Literal["pending", "resolved"], env: Literal["dev", "prod"] = Query("dev")):
    if status == "pending":
        rows = query(
            f"SELECT * FROM {APPROVAL_TABLE} WHERE status = %(status)s ORDER BY requested_at DESC",
            {"status": "pending"},
            env=env,
        )
    else:
        rows = query(
            f"SELECT * FROM {APPROVAL_TABLE} WHERE status IN ('approved', 'denied') ORDER BY resolved_at DESC",
            env=env,
        )
    return [_row_to_approval(r) for r in rows]


@router.get("/{approval_id}", response_model=Approval)
def get_approval(approval_id: str, env: Literal["dev", "prod"] = Query("dev")):
    rows = query(f"SELECT * FROM {APPROVAL_TABLE} WHERE approval_id = %(id)s", {"id": approval_id}, env=env)
    if not rows:
        raise HTTPException(status_code=404, detail=f"Approval {approval_id} not found")
    return _row_to_approval(rows[0])


@router.patch("/{approval_id}", response_model=Approval)
def resolve_approval(
    approval_id: str, body: ResolveApprovalBody, env: Literal["dev", "prod"] = Query("dev")
):
    existing = query(
        f"SELECT * FROM {APPROVAL_TABLE} WHERE approval_id = %(id)s", {"id": approval_id}, env=env
    )
    if not existing:
        raise HTTPException(status_code=404, detail=f"Approval {approval_id} not found")
    if existing[0]["status"] != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Approval {approval_id} is already {existing[0]['status']}",
        )
    if body.status == "denied" and not body.reason_denied:
        raise HTTPException(status_code=422, detail="reason_denied is required when denying")

    execute(
        f"""
        UPDATE {APPROVAL_TABLE}
        SET status = %(status)s,
            resolved_by = %(resolved_by)s,
            reason_denied = %(reason_denied)s,
            resolved_at = current_timestamp()
        WHERE approval_id = %(id)s
        """,
        {
            "status": body.status,
            "resolved_by": body.resolved_by,
            "reason_denied": body.reason_denied,
            "id": approval_id,
        },
        env=env,
    )

    updated = query(f"SELECT * FROM {APPROVAL_TABLE} WHERE approval_id = %(id)s", {"id": approval_id}, env=env)
    return _row_to_approval(updated[0])
