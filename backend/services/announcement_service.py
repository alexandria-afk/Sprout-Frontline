from datetime import datetime, timezone
from typing import Optional
from fastapi import HTTPException
from models.announcements import (
    AnnouncementResponse,
    CreateAnnouncementRequest,
    UpdateAnnouncementRequest,
    ReceiptResponse,
    ReceiptStatsResponse,
)
from models.base import PaginatedResponse
from services.supabase_client import get_supabase


class AnnouncementService:
    @staticmethod
    async def create(
        body: CreateAnnouncementRequest, org_id: str, created_by: str
    ) -> AnnouncementResponse:
        supabase = get_supabase()

        announcement_data = {
            "organisation_id": str(org_id),
            "created_by": str(created_by),
            "title": body.title,
            "body": body.body,
            "requires_acknowledgement": body.requires_acknowledgement,
            "is_deleted": False,
        }
        if body.media_url is not None:
            announcement_data["media_url"] = body.media_url
        announcement_data["media_urls"] = body.media_urls or []
        if body.publish_at is not None:
            announcement_data["publish_at"] = body.publish_at.isoformat()
        if body.target_roles is not None:
            announcement_data["target_roles"] = body.target_roles
        if body.target_location_ids is not None:
            announcement_data["target_location_ids"] = [
                str(lid) for lid in body.target_location_ids
            ]

        try:
            response = supabase.table("announcements").insert(announcement_data).execute()
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        return AnnouncementResponse(**response.data[0])

    @staticmethod
    async def list_for_user(
        user_id: str, org_id: str, page: int = 1, page_size: int = 20
    ) -> PaginatedResponse[AnnouncementResponse]:
        supabase = get_supabase()
        offset = (page - 1) * page_size
        now = datetime.now(timezone.utc).isoformat()

        try:
            query = (
                supabase.table("announcements")
                .select("*, profiles!created_by(full_name)", count="exact")
                .eq("organisation_id", str(org_id))
                .eq("is_deleted", False)
                .or_(f"publish_at.is.null,publish_at.lte.{now}")
                .order("created_at", desc=True)
                .range(offset, offset + page_size - 1)
            )
            response = query.execute()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        items = []
        for row in response.data:
            profile = row.pop("profiles", None)
            creator_name = (profile.get("full_name") if isinstance(profile, dict) else None)
            items.append(AnnouncementResponse(**row, creator_name=creator_name))
        total_count = response.count if response.count is not None else len(items)

        # Annotate each announcement with whether the current user has acknowledged it
        if items:
            try:
                receipts_resp = (
                    supabase.table("announcement_receipts")
                    .select("announcement_id, acknowledged_at")
                    .eq("user_id", user_id)
                    .execute()
                )
                acked_ids = {
                    str(r["announcement_id"])
                    for r in (receipts_resp.data or [])
                    if r.get("acknowledged_at")
                }
                for item in items:
                    item.my_acknowledged = str(item.id) in acked_ids
            except Exception:
                pass  # Default stays False (unacknowledged)

        return PaginatedResponse(items=items, total_count=total_count, page=page, page_size=page_size)

    @staticmethod
    async def get(announcement_id: str, org_id: str) -> AnnouncementResponse:
        supabase = get_supabase()
        try:
            response = (
                supabase.table("announcements")
                .select("*, profiles!created_by(full_name)")
                .eq("id", str(announcement_id))
                .eq("organisation_id", str(org_id))
                .eq("is_deleted", False)
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not response.data:
            raise HTTPException(status_code=404, detail="Announcement not found")

        row = response.data[0]
        profile = row.pop("profiles", None)
        creator_name = (profile.get("full_name") if isinstance(profile, dict) else None)
        return AnnouncementResponse(**row, creator_name=creator_name)

    @staticmethod
    async def update(
        announcement_id: str, org_id: str, body: UpdateAnnouncementRequest
    ) -> AnnouncementResponse:
        supabase = get_supabase()

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
            try:
                supabase.table("announcements").update(updates).eq(
                    "id", str(announcement_id)
                ).eq("organisation_id", str(org_id)).execute()
            except Exception as e:
                raise HTTPException(status_code=400, detail=str(e))

        return await AnnouncementService.get(announcement_id, org_id)

    @staticmethod
    async def mark_read(announcement_id: str, user_id: str) -> dict:
        supabase = get_supabase()
        now = datetime.now(timezone.utc).isoformat()

        try:
            existing = (
                supabase.table("announcement_receipts")
                .select("*")
                .eq("announcement_id", str(announcement_id))
                .eq("user_id", str(user_id))
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        try:
            if not existing.data:
                response = supabase.table("announcement_receipts").insert(
                    {
                        "announcement_id": str(announcement_id),
                        "user_id": str(user_id),
                        "read_at": now,
                    }
                ).execute()
            elif existing.data[0].get("read_at") is None:
                response = (
                    supabase.table("announcement_receipts")
                    .update({"read_at": now})
                    .eq("announcement_id", str(announcement_id))
                    .eq("user_id", str(user_id))
                    .execute()
                )
            else:
                return {"success": True, "message": "Already marked as read"}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        return {"success": True, "message": "Marked as read"}

    @staticmethod
    async def acknowledge(announcement_id: str, user_id: str) -> dict:
        supabase = get_supabase()
        now = datetime.now(timezone.utc).isoformat()

        try:
            existing = (
                supabase.table("announcement_receipts")
                .select("*")
                .eq("announcement_id", str(announcement_id))
                .eq("user_id", str(user_id))
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        try:
            if not existing.data:
                supabase.table("announcement_receipts").insert(
                    {
                        "announcement_id": str(announcement_id),
                        "user_id": str(user_id),
                        "acknowledged_at": now,
                    }
                ).execute()
            else:
                supabase.table("announcement_receipts").update(
                    {"acknowledged_at": now}
                ).eq("announcement_id", str(announcement_id)).eq(
                    "user_id", str(user_id)
                ).execute()
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        return {"success": True, "message": "Acknowledged"}

    @staticmethod
    async def get_receipts(announcement_id: str, org_id: str) -> ReceiptStatsResponse:
        supabase = get_supabase()

        # Verify announcement belongs to org
        announcement = await AnnouncementService.get(announcement_id, org_id)

        try:
            # Total profiles in org
            profiles_resp = (
                supabase.table("profiles")
                .select("id", count="exact")
                .eq("organisation_id", str(org_id))
                .eq("is_deleted", False)
                .eq("is_active", True)
                .execute()
            )
            total_targeted = profiles_resp.count if profiles_resp.count is not None else 0

            # All receipts for announcement
            receipts_resp = (
                supabase.table("announcement_receipts")
                .select("*")
                .eq("announcement_id", str(announcement_id))
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        receipts = receipts_resp.data
        total_read = sum(1 for r in receipts if r.get("read_at") is not None)
        total_acknowledged = sum(1 for r in receipts if r.get("acknowledged_at") is not None)

        return ReceiptStatsResponse(
            total_targeted=total_targeted,
            total_read=total_read,
            total_acknowledged=total_acknowledged,
            receipts=[ReceiptResponse(**r) for r in receipts],
        )
