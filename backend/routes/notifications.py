"""
Notifications API — /api/v1/notifications
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from dependencies import get_current_user, paginate
from services.supabase_client import get_supabase

router = APIRouter()


class FCMTokenRequest(BaseModel):
    fcm_token: str


# ── FCM Token (kept for mobile) ────────────────────────────────────────────────

@router.put("/fcm-token")
async def register_fcm_token(
    body: FCMTokenRequest,
    current_user: dict = Depends(get_current_user),
):
    from fastapi import HTTPException
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


# ── Notifications CRUD ─────────────────────────────────────────────────────────

@router.get("")
@router.get("/")
async def list_notifications(
    is_read: Optional[bool] = Query(None),
    type: Optional[str] = Query(None),
    limit: int = Query(50, le=100),
    page: int = Query(1, ge=1),
    current_user: dict = Depends(get_current_user),
):
    """Return paginated notifications for the current user, newest first."""
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    q = (
        db.table("notifications")
        .select("*", count="exact")
        .eq("recipient_user_id", user_id)
        .eq("organisation_id", org_id)
        .eq("is_dismissed", False)
    )
    if is_read is not None:
        q = q.eq("is_read", is_read)
    if type:
        q = q.eq("type", type)

    offset = (page - 1) * limit
    resp = q.order("created_at", desc=True).range(offset, offset + limit - 1).execute()

    return {
        "items": resp.data or [],
        "total": resp.count or 0,
        "page": page,
        "limit": limit,
    }


@router.get("/unread-count")
async def unread_count(current_user: dict = Depends(get_current_user)):
    """Return count of unread, non-dismissed notifications for the current user."""
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    resp = (
        db.table("notifications")
        .select("id", count="exact")
        .eq("recipient_user_id", user_id)
        .eq("organisation_id", org_id)
        .eq("is_read", False)
        .eq("is_dismissed", False)
        .execute()
    )
    return {"count": resp.count or 0}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Mark a single notification as read."""
    from fastapi import HTTPException
    from datetime import datetime, timezone
    user_id = current_user["sub"]
    db = get_supabase()
    resp = (
        db.table("notifications")
        .update({"is_read": True, "read_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", str(notification_id))
        .eq("recipient_user_id", user_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(current_user: dict = Depends(get_current_user)):
    """Mark all unread notifications as read for the current user."""
    from datetime import datetime, timezone
    user_id = current_user["sub"]
    db = get_supabase()
    db.table("notifications").update({
        "is_read": True,
        "read_at": datetime.now(timezone.utc).isoformat(),
    }).eq("recipient_user_id", user_id).eq("is_read", False).execute()
    return {"ok": True}


@router.post("/{notification_id}/dismiss")
async def dismiss_notification(
    notification_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Hide a notification from the inbox (sets is_dismissed=true)."""
    from fastapi import HTTPException
    user_id = current_user["sub"]
    db = get_supabase()
    resp = (
        db.table("notifications")
        .update({"is_dismissed": True})
        .eq("id", str(notification_id))
        .eq("recipient_user_id", user_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}
