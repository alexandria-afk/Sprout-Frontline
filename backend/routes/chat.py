"""
Team Chat API — /api/v1/chat
One location-scoped chat room per branch. No DMs, no custom groups.
Access derived from profiles.location_id (no explicit membership table).
Real-time via client-side polling — clients poll /messages?after= every 3 s.
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel

from dependencies import get_current_user, get_db
from services.db import row, rows, execute, execute_returning

router = APIRouter()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _ensure_chats_exist(conn, org_id: str, location_ids: list[str]) -> None:
    """
    Auto-provision location_chats rows for any locations that don't have one.
    Called on first access so the system is self-healing — no manual migration step needed.
    """
    if not location_ids:
        return
    try:
        for loc_id in location_ids:
            execute_returning(
                conn,
                """
                INSERT INTO location_chats (organisation_id, location_id)
                VALUES (%s, %s::uuid)
                ON CONFLICT (location_id) DO NOTHING
                """,
                (org_id, loc_id),
            )
    except Exception:
        pass  # Table may not exist yet if migration hasn't run


def _accessible_chat_ids(conn, user_id: str, org_id: str, role: str, location_id: Optional[str]) -> list[str]:
    """
    Return chat UUIDs (as strings) this user may access.
    Auto-provisions missing location_chats rows on first call.
    """
    if role in ("admin", "super_admin"):
        # Ensure every active location has a chat room
        loc_rows = rows(
            conn,
            "SELECT id FROM locations WHERE organisation_id = %s AND is_deleted = false",
            (org_id,),
        )
        _ensure_chats_exist(conn, org_id, [str(r["id"]) for r in loc_rows])
        result = rows(conn, "SELECT id FROM location_chats WHERE organisation_id = %s", (org_id,))
    elif location_id:
        # Ensure this location has a chat room
        _ensure_chats_exist(conn, org_id, [location_id])
        result = rows(
            conn,
            "SELECT id FROM location_chats WHERE organisation_id = %s AND location_id = %s::uuid",
            (org_id, location_id),
        )
    else:
        result = []
    return [str(r["id"]) for r in result]


def _assert_access(conn, chat_id: str, user_id: str, org_id: str, role: str, location_id: Optional[str]) -> None:
    allowed = _accessible_chat_ids(conn, user_id, org_id, role, location_id)
    if chat_id not in allowed:
        raise HTTPException(status_code=403, detail="Access denied to this chat")


def _meta(current_user: dict) -> tuple[str, str, str, Optional[str]]:
    """Extract (org_id, user_id, role, location_id) from token claims."""
    app = current_user.get("app_metadata") or {}
    return (
        app.get("organisation_id"),
        current_user["sub"],
        app.get("role", "staff"),
        app.get("location_id"),
    )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/my")
async def list_my_chats(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """
    List chats the caller may access.
    Staff → 1 chat (their location). Manager → their location(s). Admin → all.
    Each entry includes unread_count and last_message preview.
    """
    org_id, user_id, role, location_id = _meta(current_user)
    chat_ids = _accessible_chat_ids(conn, user_id, org_id, role, location_id)
    if not chat_ids:
        return {"chats": []}

    chats = rows(
        conn,
        """
        SELECT
            lc.id,
            lc.location_id,
            l.name AS location_name,
            (
                SELECT cm.body
                FROM   chat_messages cm
                WHERE  cm.chat_id = lc.id AND cm.is_deleted = false
                ORDER  BY cm.created_at DESC
                LIMIT  1
            ) AS last_message,
            (
                SELECT cm.sender_id::text
                FROM   chat_messages cm
                WHERE  cm.chat_id = lc.id AND cm.is_deleted = false
                ORDER  BY cm.created_at DESC
                LIMIT  1
            ) AS last_message_sender_id,
            (
                SELECT p.full_name
                FROM   chat_messages cm
                JOIN   profiles p ON p.id = cm.sender_id
                WHERE  cm.chat_id = lc.id AND cm.is_deleted = false
                ORDER  BY cm.created_at DESC
                LIMIT  1
            ) AS last_message_sender_name,
            (
                SELECT cm.created_at
                FROM   chat_messages cm
                WHERE  cm.chat_id = lc.id AND cm.is_deleted = false
                ORDER  BY cm.created_at DESC
                LIMIT  1
            ) AS last_message_at,
            (
                SELECT COUNT(*)
                FROM   chat_messages cm
                WHERE  cm.chat_id    = lc.id
                  AND  cm.is_deleted = false
                  AND  cm.sender_id != %s::uuid
                  AND  cm.created_at > COALESCE(
                           (SELECT crc.last_read_at FROM chat_read_cursors crc
                            WHERE  crc.chat_id = lc.id AND crc.user_id = %s::uuid),
                           '1970-01-01'
                       )
            ) AS unread_count
        FROM  location_chats lc
        JOIN  locations l ON l.id = lc.location_id
        WHERE lc.id = ANY(%s::uuid[])
        ORDER BY last_message_at DESC NULLS LAST
        """,
        (user_id, user_id, chat_ids),
    )

    return {"chats": [dict(c) for c in chats]}


@router.get("/unread-total")
async def unread_total(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Total unread messages across all accessible chats — used for nav badge."""
    org_id, user_id, role, location_id = _meta(current_user)
    chat_ids = _accessible_chat_ids(conn, user_id, org_id, role, location_id)
    if not chat_ids:
        return {"total_unread": 0}

    result = row(
        conn,
        """
        SELECT COUNT(*) AS total
        FROM   chat_messages cm
        WHERE  cm.chat_id    = ANY(%s::uuid[])
          AND  cm.is_deleted = false
          AND  cm.sender_id != %s::uuid
          AND  cm.created_at > COALESCE(
                   (SELECT crc.last_read_at FROM chat_read_cursors crc
                    WHERE  crc.chat_id = cm.chat_id AND crc.user_id = %s::uuid),
                   '1970-01-01'
               )
        """,
        (chat_ids, user_id, user_id),
    )
    return {"total_unread": int(result["total"]) if result else 0}


@router.get("/{chat_id}/messages")
async def list_messages(
    chat_id: UUID,
    before: Optional[str] = Query(None, description="ISO timestamp cursor — return messages older than this"),
    after:  Optional[str] = Query(None, description="ISO timestamp cursor — return messages newer than this (for polling)"),
    limit:  int           = Query(50, le=100),
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """
    Fetch messages for a chat. Two modes:
    - Paginated history: use `before` cursor, newest-first.
    - Poll for new messages: use `after` cursor, oldest-first.
    Always marks the chat as read for the caller.
    """
    org_id, user_id, role, location_id = _meta(current_user)
    _assert_access(conn, str(chat_id), user_id, org_id, role, location_id)

    params: list = [str(chat_id)]
    cursor_clause = ""
    order = "DESC"

    if before:
        cursor_clause = "AND cm.created_at < %s"
        params.append(before)
    elif after:
        cursor_clause = "AND cm.created_at > %s"
        params.append(after)
        order = "ASC"

    params.append(limit)

    msgs = rows(
        conn,
        f"""
        SELECT
            cm.id,
            cm.chat_id,
            cm.sender_id,
            cm.body,
            cm.media_url,
            cm.media_type,
            cm.is_deleted,
            cm.created_at,
            COALESCE(p.full_name, cm.sender_id::text) AS sender_name,
            NULL::text                                 AS sender_avatar
        FROM   chat_messages cm
        LEFT JOIN profiles p ON p.id = cm.sender_id
        WHERE  cm.chat_id = %s::uuid
          {cursor_clause}
        ORDER  BY cm.created_at {order}
        LIMIT  %s
        """,
        tuple(params),
    )

    # Update read cursor so unread count resets
    # Wrapped in try/except: if user_id isn't in profiles yet (first login race),
    # the FK violation should not break message delivery.
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        execute(
            conn,
            """
            INSERT INTO chat_read_cursors (chat_id, user_id, last_read_at)
            VALUES (%s::uuid, %s::uuid, %s)
            ON CONFLICT (chat_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at
            """,
            (str(chat_id), user_id, now_iso),
        )
    except Exception:
        conn.rollback()  # Reset aborted-transaction state so the response can still be sent

    return {"messages": [dict(m) for m in msgs]}


class SendMessageRequest(BaseModel):
    body: str
    media_url: Optional[str] = None
    media_type: Optional[str] = None


@router.post("/{chat_id}/messages")
async def send_message(
    chat_id: UUID,
    body: SendMessageRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Send a message to a chat room."""
    org_id, user_id, role, location_id = _meta(current_user)
    _assert_access(conn, str(chat_id), user_id, org_id, role, location_id)

    text = (body.body or "").strip()
    if not text and not body.media_url:
        raise HTTPException(status_code=400, detail="Message body cannot be empty")
    if len(text) > 2000:
        raise HTTPException(status_code=400, detail="Message too long (max 2000 characters)")
    if body.media_type and body.media_type not in ("image", "video"):
        raise HTTPException(status_code=400, detail="media_type must be 'image' or 'video'")

    result = execute_returning(
        conn,
        """
        INSERT INTO chat_messages (chat_id, sender_id, body, media_url, media_type)
        VALUES (%s::uuid, %s::uuid, %s, %s, %s)
        RETURNING *
        """,
        (str(chat_id), user_id, text, body.media_url, body.media_type),
    )
    if not result:
        raise HTTPException(status_code=500, detail="Failed to send message")
    return dict(result)


@router.post("/{chat_id}/media")
async def upload_media(
    chat_id: UUID,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Upload a photo or video to Azure Blob Storage. Returns media_url + media_type."""
    import uuid as _uuid
    from services.blob_storage import upload_blob, get_public_url

    org_id, user_id, role, location_id = _meta(current_user)
    _assert_access(conn, str(chat_id), user_id, org_id, role, location_id)

    content_type = file.content_type or ""
    if content_type.startswith("image/"):
        media_type = "image"
    elif content_type.startswith("video/"):
        media_type = "video"
    else:
        raise HTTPException(status_code=400, detail="Only image and video files are supported")

    ext = ""
    if file.filename and "." in file.filename:
        ext = "." + file.filename.rsplit(".", 1)[-1].lower()
    blob_name = f"chat/{chat_id}/{_uuid.uuid4()}{ext}"
    data = await file.read()

    try:
        upload_blob("chat-media", blob_name, data, content_type=content_type)
        media_url = get_public_url("chat-media", blob_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Media upload failed: {e}")

    return {"media_url": media_url, "media_type": media_type}


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """
    Soft-delete a message. Sender can delete own messages.
    Manager+ can delete any message in their accessible chats.
    """
    org_id, user_id, role, location_id = _meta(current_user)

    msg = row(
        conn,
        "SELECT id, sender_id, chat_id FROM chat_messages WHERE id = %s AND is_deleted = false",
        (str(message_id),),
    )
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    is_sender = str(msg["sender_id"]) == user_id
    is_manager_plus = role in ("manager", "admin", "super_admin")

    if not is_sender and not is_manager_plus:
        raise HTTPException(status_code=403, detail="Cannot delete this message")

    # Manager must also have access to the chat
    if not is_sender and is_manager_plus:
        _assert_access(conn, str(msg["chat_id"]), user_id, org_id, role, location_id)

    execute(
        conn,
        "UPDATE chat_messages SET is_deleted = true WHERE id = %s",
        (str(message_id),),
    )
    return {"ok": True}
