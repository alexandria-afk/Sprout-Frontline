"""
Centralized Notification Service
All notification creation goes through this module.
No scattered FCM code anywhere else.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from services.supabase_client import get_supabase

logger = logging.getLogger(__name__)


# ── FCM via firebase-admin ─────────────────────────────────────────────────────

_firebase_initialized = False


def _init_firebase() -> bool:
    global _firebase_initialized
    if _firebase_initialized:
        return True
    try:
        import os
        import json
        import firebase_admin
        from firebase_admin import credentials

        cred_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        if not cred_json:
            return False
        cred = credentials.Certificate(json.loads(cred_json))
        firebase_admin.initialize_app(cred)
        _firebase_initialized = True
        return True
    except Exception as e:
        logger.warning(f"Firebase init failed (push disabled): {e}")
        return False


def _send_push(token: str, title: str, body: str, data: dict) -> None:
    """Send FCM push via firebase-admin SDK. Silently fails if not configured."""
    try:
        if not _init_firebase():
            return
        from firebase_admin import messaging
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body or ""),
            data={k: str(v) for k, v in (data or {}).items()},
            token=token,
        )
        messaging.send(message)
    except Exception as e:
        logger.warning(f"FCM push failed: {e}")


# ── Core Notify ────────────────────────────────────────────────────────────────

async def notify(
    *,
    org_id: str,
    recipient_user_id: str,
    type: str,
    title: str,
    body: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    send_push: bool = False,
) -> Optional[dict]:
    """
    Create a notification for a single user.
    If send_push=True, also attempts FCM push if the user has an fcm_token.
    """
    db = get_supabase()
    row: dict = {
        "organisation_id": org_id,
        "recipient_user_id": recipient_user_id,
        "type": type,
        "title": title,
    }
    if body:
        row["body"] = body
    if entity_type:
        row["entity_type"] = entity_type
    if entity_id:
        row["entity_id"] = entity_id

    try:
        resp = db.table("notifications").insert(row).execute()
        notif = resp.data[0] if resp.data else None
    except Exception as e:
        logger.error(f"Failed to insert notification: {e}")
        return None

    if send_push and notif:
        try:
            profile_resp = (
                db.table("profiles")
                .select("fcm_token")
                .eq("id", recipient_user_id)
                .maybe_single()
                .execute()
            )
            fcm_token = (profile_resp.data or {}).get("fcm_token")
            if fcm_token:
                push_data: dict = {"type": type}
                if entity_type:
                    push_data["entity_type"] = entity_type
                if entity_id:
                    push_data["entity_id"] = entity_id
                _send_push(fcm_token, title, body or "", push_data)
                db.table("notifications").update({
                    "push_sent": True,
                    "push_sent_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", notif["id"]).execute()
        except Exception as e:
            logger.warning(f"Push failed for user {recipient_user_id}: {e}")

    return notif


async def notify_role(
    *,
    org_id: str,
    role: str,
    location_id: Optional[str] = None,
    type: str,
    title: str,
    body: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    send_push: bool = False,
) -> int:
    """
    Notify all active users with a given role, optionally scoped to a location.
    Returns count of notifications created.
    """
    db = get_supabase()
    try:
        q = (
            db.table("profiles")
            .select("id")
            .eq("organisation_id", org_id)
            .eq("role", role)
            .eq("is_deleted", False)
            .eq("is_active", True)
        )
        if location_id:
            q = q.eq("location_id", location_id)
        users_resp = q.execute()
        users = users_resp.data or []
    except Exception as e:
        logger.error(f"notify_role: failed to fetch users: {e}")
        return 0

    count = 0
    for user in users:
        result = await notify(
            org_id=org_id,
            recipient_user_id=user["id"],
            type=type,
            title=title,
            body=body,
            entity_type=entity_type,
            entity_id=entity_id,
            send_push=send_push,
        )
        if result:
            count += 1
    return count


async def notify_user_manager(
    *,
    org_id: str,
    user_id: str,
    type: str,
    title: str,
    body: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    send_push: bool = False,
) -> Optional[dict]:
    """
    Notify the user's direct manager (reports_to).
    Falls back to notifying any manager at the user's location if reports_to is unset.
    """
    db = get_supabase()
    try:
        profile_resp = (
            db.table("profiles")
            .select("reports_to, location_id")
            .eq("id", user_id)
            .eq("is_deleted", False)
            .maybe_single()
            .execute()
        )
        profile = profile_resp.data or {}
        reports_to = profile.get("reports_to")
        location_id = profile.get("location_id")
    except Exception as e:
        logger.error(f"notify_user_manager: fetch profile failed: {e}")
        return None

    if reports_to:
        return await notify(
            org_id=org_id,
            recipient_user_id=reports_to,
            type=type,
            title=title,
            body=body,
            entity_type=entity_type,
            entity_id=entity_id,
            send_push=send_push,
        )

    # Fallback: notify managers at the user's location
    if location_id:
        await notify_role(
            org_id=org_id,
            role="manager",
            location_id=location_id,
            type=type,
            title=title,
            body=body,
            entity_type=entity_type,
            entity_id=entity_id,
            send_push=send_push,
        )
    return None
