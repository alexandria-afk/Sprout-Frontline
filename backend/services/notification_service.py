"""
Centralized Notification Service
All notification creation goes through this module.
No scattered FCM code anywhere else.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from services.db import _get_pool, row as db_row, rows as db_rows, execute_returning

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
    pool = _get_pool()
    conn = pool.getconn()
    try:
        notif = execute_returning(
            conn,
            """
            INSERT INTO notifications
                (organisation_id, recipient_user_id, type, title, body, entity_type, entity_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                org_id,
                recipient_user_id,
                type,
                title,
                body,
                entity_type,
                entity_id,
            ),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to insert notification: {e}")
        pool.putconn(conn)
        return None

    if send_push and notif:
        try:
            profile = db_row(
                conn,
                """
                SELECT fcm_token
                FROM profiles
                WHERE id = %s
                """,
                (recipient_user_id,),
            )
            fcm_token = (profile or {}).get("fcm_token")
            if fcm_token:
                push_data: dict = {"type": type}
                if entity_type:
                    push_data["entity_type"] = entity_type
                if entity_id:
                    push_data["entity_id"] = entity_id
                _send_push(fcm_token, title, body or "", push_data)
                execute_returning(
                    conn,
                    """
                    UPDATE notifications
                    SET push_sent = TRUE,
                        push_sent_at = %s
                    WHERE id = %s
                    RETURNING id
                    """,
                    (
                        datetime.now(timezone.utc),
                        notif["id"],
                    ),
                )
                conn.commit()
        except Exception as e:
            conn.rollback()
            logger.warning(f"Push failed for user {recipient_user_id}: {e}")

    pool.putconn(conn)
    return dict(notif) if notif else None


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
    pool = _get_pool()
    conn = pool.getconn()
    try:
        if location_id:
            users = db_rows(
                conn,
                """
                SELECT id
                FROM profiles
                WHERE organisation_id = %s
                  AND role = %s
                  AND location_id = %s
                  AND is_deleted = FALSE
                  AND is_active = TRUE
                """,
                (org_id, role, location_id),
            )
        else:
            users = db_rows(
                conn,
                """
                SELECT id
                FROM profiles
                WHERE organisation_id = %s
                  AND role = %s
                  AND is_deleted = FALSE
                  AND is_active = TRUE
                """,
                (org_id, role),
            )
    except Exception as e:
        logger.error(f"notify_role: failed to fetch users: {e}")
        pool.putconn(conn)
        return 0
    finally:
        pool.putconn(conn)

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
    pool = _get_pool()
    conn = pool.getconn()
    try:
        profile = db_row(
            conn,
            """
            SELECT reports_to, location_id
            FROM profiles
            WHERE id = %s
              AND is_deleted = FALSE
            """,
            (user_id,),
        )
        reports_to = (profile or {}).get("reports_to")
        location_id = (profile or {}).get("location_id")
    except Exception as e:
        logger.error(f"notify_user_manager: fetch profile failed: {e}")
        pool.putconn(conn)
        return None
    finally:
        pool.putconn(conn)

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
