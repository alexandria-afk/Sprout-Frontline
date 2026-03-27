"""
Corrective Actions Routes — Phase 2
GET  /api/v1/corrective-actions
GET  /api/v1/corrective-actions/{id}
PUT  /api/v1/corrective-actions/{id}
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from dependencies import get_current_user, require_manager_or_above
from models.audits import UpdateCorrectiveActionRequest
from services.supabase_client import get_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_org(current_user: dict) -> str:
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation found for user")
    return org_id


@router.get("/")
async def list_corrective_actions(
    location_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    db = get_admin_client()
    offset = (page - 1) * page_size

    q = db.table("corrective_actions") \
        .select("""
            *,
            profiles!assigned_to(id, full_name, email),
            form_submissions(id, form_template_id, submitted_at,
                form_templates(title))
        """) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .order("created_at", desc=True)

    if location_id:
        q = q.eq("location_id", location_id)
    if status:
        q = q.eq("status", status)
    if assigned_to:
        q = q.eq("assigned_to", assigned_to)
    if from_date:
        q = q.gte("created_at", from_date)
    if to_date:
        q = q.lte("created_at", to_date)

    q = q.range(offset, offset + page_size - 1)
    res = q.execute()
    return res.data


@router.get("/{cap_id}")
async def get_corrective_action(
    cap_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    res = db.table("corrective_actions") \
        .select("""
            *,
            profiles!assigned_to(id, full_name, email),
            form_submissions(id, form_template_id, submitted_at,
                form_templates(title)),
            form_fields!field_id(label, field_type)
        """) \
        .eq("id", str(cap_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Corrective action not found")
    return res.data


@router.put("/{cap_id}")
async def update_corrective_action(
    cap_id: UUID,
    body: UpdateCorrectiveActionRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org(current_user)
    user_id = current_user["sub"]
    db = get_admin_client()

    existing = db.table("corrective_actions") \
        .select("id, assigned_to, status") \
        .eq("id", str(cap_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()

    if not existing.data:
        raise HTTPException(status_code=404, detail="Corrective action not found")

    cap = existing.data
    role = (current_user.get("app_metadata") or {}).get("role", "")
    is_manager = role in ("manager", "admin", "super_admin")

    # Only assigned user or managers can update
    if str(cap.get("assigned_to")) != str(user_id) and not is_manager:
        raise HTTPException(status_code=403, detail="Not authorised to update this corrective action")

    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}

    if body.status is not None:
        if body.status not in ("open", "in_progress", "resolved"):
            raise HTTPException(status_code=400, detail="Invalid status")
        updates["status"] = body.status
        if body.status == "resolved":
            updates["resolved_at"] = datetime.now(timezone.utc).isoformat()

    if body.assigned_to is not None and is_manager:
        updates["assigned_to"] = str(body.assigned_to)

    if body.due_at is not None and is_manager:
        updates["due_at"] = body.due_at.isoformat()

    if body.resolution_note is not None:
        updates["resolution_note"] = body.resolution_note

    db.table("corrective_actions").update(updates).eq("id", str(cap_id)).execute()
    return {"success": True}
