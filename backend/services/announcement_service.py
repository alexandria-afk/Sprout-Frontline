import json
from datetime import datetime, timezone
from typing import Optional
from fastapi import HTTPException
from psycopg2.extensions import connection as PgConn
from models.announcements import (
    AnnouncementResponse,
    CreateAnnouncementRequest,
    UpdateAnnouncementRequest,
    ReceiptResponse,
    ReceiptStatsResponse,
)
from models.base import PaginatedResponse
from services.db import row, rows, execute, execute_returning


class AnnouncementService:
    @staticmethod
    async def create(
        body: CreateAnnouncementRequest, org_id: str, created_by: str, conn: PgConn
    ) -> AnnouncementResponse:
        columns = [
            "organisation_id", "created_by", "title", "body",
            "requires_acknowledgement", "is_deleted", "media_urls",
        ]
        values: list = [
            org_id, created_by, body.title, body.body,
            body.requires_acknowledgement, False,
            json.dumps(body.media_urls or []),
        ]

        if body.media_url is not None:
            columns.append("media_url")
            values.append(body.media_url)
        if body.publish_at is not None:
            columns.append("publish_at")
            values.append(body.publish_at.isoformat())
        if body.target_roles is not None:
            columns.append("target_roles")
            values.append(body.target_roles)
        if body.target_location_ids is not None:
            columns.append("target_location_ids")
            values.append([str(lid) for lid in body.target_location_ids])

        col_clause = ", ".join(columns)
        placeholder_clause = ", ".join(["%s"] * len(columns))

        try:
            result = execute_returning(
                conn,
                f"INSERT INTO announcements ({col_clause}) VALUES ({placeholder_clause}) RETURNING *",
                tuple(values),
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        return AnnouncementResponse(**result)

    @staticmethod
    async def list_for_user(
        user_id: str, org_id: str, conn: PgConn, page: int = 1, page_size: int = 20
    ) -> PaginatedResponse[AnnouncementResponse]:
        offset = (page - 1) * page_size
        now = datetime.now(timezone.utc).isoformat()

        try:
            result = rows(
                conn,
                """
                SELECT a.*, p.full_name AS creator_name,
                       COUNT(*) OVER () AS _total_count
                FROM announcements a
                LEFT JOIN profiles p ON p.id = a.created_by
                WHERE a.organisation_id = %s
                  AND a.is_deleted = false
                  AND (a.publish_at IS NULL OR a.publish_at <= %s)
                ORDER BY a.created_at DESC
                LIMIT %s OFFSET %s
                """,
                (org_id, now, page_size, offset),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        total_count = int(result[0]["_total_count"]) if result else 0
        items = []
        for r in result:
            r = dict(r)
            r.pop("_total_count", None)
            creator_name = r.pop("creator_name", None)
            items.append(AnnouncementResponse(**r, creator_name=creator_name))

        # Annotate each announcement with whether the current user has acknowledged it
        if items:
            try:
                receipts = rows(
                    conn,
                    "SELECT announcement_id, acknowledged_at FROM announcement_receipts WHERE user_id = %s",
                    (user_id,),
                )
                acked_ids = {
                    str(r["announcement_id"])
                    for r in receipts
                    if r.get("acknowledged_at")
                }
                for item in items:
                    item.my_acknowledged = str(item.id) in acked_ids
            except Exception:
                pass  # Default stays False (unacknowledged)

        return PaginatedResponse(items=items, total_count=total_count, page=page, page_size=page_size)

    @staticmethod
    async def get(announcement_id: str, org_id: str, conn: PgConn) -> AnnouncementResponse:
        try:
            result = row(
                conn,
                """
                SELECT a.*, p.full_name AS creator_name
                FROM announcements a
                LEFT JOIN profiles p ON p.id = a.created_by
                WHERE a.id = %s
                  AND a.organisation_id = %s
                  AND a.is_deleted = false
                """,
                (announcement_id, org_id),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if result is None:
            raise HTTPException(status_code=404, detail="Announcement not found")

        result = dict(result)
        creator_name = result.pop("creator_name", None)
        return AnnouncementResponse(**result, creator_name=creator_name)

    @staticmethod
    async def update(
        announcement_id: str, org_id: str, body: UpdateAnnouncementRequest, conn: PgConn
    ) -> AnnouncementResponse:
        updates = {}
        if body.title is not None:
            updates["title"] = body.title
        if body.body is not None:
            updates["body"] = body.body
        if body.media_url is not None:
            updates["media_url"] = body.media_url
        if body.media_urls is not None:
            updates["media_urls"] = body.media_urls
        if body.requires_acknowledgement is not None:
            updates["requires_acknowledgement"] = body.requires_acknowledgement
        if body.publish_at is not None:
            updates["publish_at"] = body.publish_at.isoformat()
        if body.target_roles is not None:
            updates["target_roles"] = body.target_roles
        if body.target_location_ids is not None:
            updates["target_location_ids"] = [str(lid) for lid in body.target_location_ids]

        if updates:
            set_clause = ", ".join(f"{col} = %s" for col in updates)
            params = tuple(updates.values()) + (announcement_id, org_id)
            try:
                execute(
                    conn,
                    f"UPDATE announcements SET {set_clause} WHERE id = %s AND organisation_id = %s",
                    params,
                )
            except Exception as e:
                raise HTTPException(status_code=400, detail=str(e))

        return await AnnouncementService.get(announcement_id, org_id, conn)

    @staticmethod
    async def mark_read(announcement_id: str, user_id: str, conn: PgConn) -> dict:
        now = datetime.now(timezone.utc).isoformat()

        try:
            existing = row(
                conn,
                "SELECT read_at FROM announcement_receipts WHERE announcement_id = %s AND user_id = %s",
                (announcement_id, user_id),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if existing is not None and existing.get("read_at") is not None:
            return {"success": True, "message": "Already marked as read"}

        try:
            execute(
                conn,
                """
                INSERT INTO announcement_receipts (announcement_id, user_id, read_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (announcement_id, user_id)
                DO UPDATE SET read_at = EXCLUDED.read_at
                WHERE announcement_receipts.read_at IS NULL
                """,
                (announcement_id, user_id, now),
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        return {"success": True, "message": "Marked as read"}

    @staticmethod
    async def acknowledge(announcement_id: str, user_id: str, conn: PgConn) -> dict:
        now = datetime.now(timezone.utc).isoformat()

        try:
            execute(
                conn,
                """
                INSERT INTO announcement_receipts (announcement_id, user_id, acknowledged_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (announcement_id, user_id)
                DO UPDATE SET acknowledged_at = EXCLUDED.acknowledged_at
                """,
                (announcement_id, user_id, now),
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        return {"success": True, "message": "Acknowledged"}

    @staticmethod
    async def get_receipts(announcement_id: str, org_id: str, conn: PgConn) -> ReceiptStatsResponse:
        # Verify announcement belongs to org
        announcement = await AnnouncementService.get(announcement_id, org_id, conn)

        try:
            total_targeted_row = row(
                conn,
                """
                SELECT COUNT(*) AS cnt
                FROM profiles
                WHERE organisation_id = %s
                  AND is_deleted = false
                  AND is_active = true
                """,
                (org_id,),
            )
            total_targeted = int(total_targeted_row["cnt"]) if total_targeted_row else 0

            receipts_data = rows(
                conn,
                "SELECT * FROM announcement_receipts WHERE announcement_id = %s",
                (announcement_id,),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        total_read = sum(1 for r in receipts_data if r.get("read_at") is not None)
        total_acknowledged = sum(1 for r in receipts_data if r.get("acknowledged_at") is not None)

        return ReceiptStatsResponse(
            total_targeted=total_targeted,
            total_read=total_read,
            total_acknowledged=total_acknowledged,
            receipts=[ReceiptResponse(**r) for r in receipts_data],
        )
