"""
Notifications API — /api/v1/notifications
FCM token registration + notification log.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, paginate
from services.supabase_client import get_supabase

router = APIRouter()


class FCMTokenRequest(BaseModel):
    fcm_token: str


# ── FCM Token ─────────────────────────────────────────────────────────────────

@router.put("/fcm-token")
async def register_fcm_token(
    body: FCMTokenRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["sub"]
    db = get_supabase()
    resp = (
        db.table("profiles")
        .update({"fcm_token": body.fcm_token})
        .eq("id", user_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"ok": True}


# ── Notification Log ───────────────────────────────────────────────────────────

@router.get("/log")
async def list_notification_log(
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    offset = pagination["offset"]
    page_size = pagination["page_size"]

    resp = (
        db.table("notification_log")
        .select("*", count="exact")
        .eq("organisation_id", org_id)
        .order("created_at", desc=True)
        .range(offset, offset + page_size - 1)
        .execute()
    )

    return {"data": resp.data or [], "total": resp.count or 0}
