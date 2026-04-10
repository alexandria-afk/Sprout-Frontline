"""
Notifications API — /api/v1/notifications
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from dependencies import get_current_user, get_db
from services.db import row, rows, execute, execute_returning

router = APIRouter()


class FCMTokenRequest(BaseModel):
    fcm_token: str


# ── FCM Token (kept for mobile) ────────────────────────────────────────────────

@router.put("/fcm-token")
async def register_fcm_token(
    body: FCMTokenRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    user_id = current_user["sub"]
    updated = execute_returning(
        conn,
        "UPDATE profiles SET fcm_token = %s WHERE id = %s RETURNING id",
        (body.fcm_token, user_id),
    )
    if not updated:
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
    conn=Depends(get_db),
):
    """Return paginated notifications for the current user, newest first."""
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    offset = (page - 1) * limit

    conditions = [
        "recipient_user_id = %s",
        "organisation_id = %s",
        "is_dismissed = false",
    ]
    params: list = [user_id, org_id]

    if is_read is not None:
        conditions.append("is_read = %s")
        params.append(is_read)
    if type is not None:
        conditions.append("type = %s")
        params.append(type)

    where = " AND ".join(conditions)

    total_row = row(
        conn,
        f"SELECT COUNT(*) AS cnt FROM notifications WHERE {where}",
        tuple(params),
    )
    total = total_row["cnt"] if total_row else 0

    items = rows(
        conn,
        f"SELECT * FROM notifications WHERE {where} ORDER BY created_at DESC LIMIT %s OFFSET %s",
        tuple(params) + (limit, offset),
    )

    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.get("/unread-count")
async def unread_count(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Return count of unread, non-dismissed notifications for the current user."""
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    result = row(
        conn,
        """
        SELECT COUNT(*) AS cnt
        FROM notifications
        WHERE recipient_user_id = %s
          AND organisation_id = %s
          AND is_read = false
          AND is_dismissed = false
        """,
        (user_id, org_id),
    )
    return {"count": result["cnt"] if result else 0}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Mark a single notification as read."""
    user_id = current_user["sub"]
    updated = execute_returning(
        conn,
        """
        UPDATE notifications
        SET is_read = true, read_at = %s
        WHERE id = %s AND recipient_user_id = %s
        RETURNING id
        """,
        (datetime.now(timezone.utc).isoformat(), str(notification_id), user_id),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Mark all unread notifications as read for the current user."""
    user_id = current_user["sub"]
    execute(
        conn,
        """
        UPDATE notifications
        SET is_read = true, read_at = %s
        WHERE recipient_user_id = %s AND is_read = false
        """,
        (datetime.now(timezone.utc).isoformat(), user_id),
    )
    return {"ok": True}


@router.post("/{notification_id}/dismiss")
async def dismiss_notification(
    notification_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Hide a notification from the inbox (sets is_dismissed=true)."""
    user_id = current_user["sub"]
    updated = execute_returning(
        conn,
        """
        UPDATE notifications
        SET is_dismissed = true
        WHERE id = %s AND recipient_user_id = %s
        RETURNING id
        """,
        (str(notification_id), user_id),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}
