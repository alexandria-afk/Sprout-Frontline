"""
Repair Guides API — /api/v1/repair-guides
Repair guide library.
"""
import base64
import random
import string
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, paginate
from services.supabase_client import get_supabase

router = APIRouter()


# ── Request Models ─────────────────────────────────────────────────────────────

class CreateRepairGuideRequest(BaseModel):
    title: str
    guide_type: str = "text"  # pdf, video, audio, text
    asset_id: Optional[str] = None
    category_id: Optional[str] = None
    content: Optional[str] = None  # Markdown or plain text content
    file_name: Optional[str] = None  # Original file name for storage
    file_content_base64: Optional[str] = None  # Base64-encoded file content
    file_content_type: Optional[str] = None  # MIME type of the file


def _random_suffix(length: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=length))


# ── Guides ─────────────────────────────────────────────────────────────────────

@router.post("/")
async def create_guide(
    body: CreateRepairGuideRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    file_url = None

    # Derive guide_type from file content type if uploading
    guide_type = body.guide_type or "text"

    # Upload file to Supabase Storage if base64 content provided
    if body.file_content_base64:
        try:
            file_bytes = base64.b64decode(body.file_content_base64)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid base64 file content")

        suffix = _random_suffix()
        original_name = body.file_name or "guide-file"
        ext = ""
        if "." in original_name:
            ext = original_name.rsplit(".", 1)[-1].lower()

        storage_path = (
            f"{org_id}/{suffix}-{original_name}"
            if not ext
            else f"{org_id}/{suffix}.{ext}"
        )

        content_type = body.file_content_type or "application/octet-stream"

        # Infer guide_type from MIME if not explicitly set
        if body.guide_type == "text":
            if "pdf" in content_type:
                guide_type = "pdf"
            elif content_type.startswith("video/"):
                guide_type = "video"
            elif content_type.startswith("audio/"):
                guide_type = "audio"

        try:
            db.storage.from_("repair-guides").upload(
                storage_path,
                file_bytes,
                {"content-type": content_type},
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to upload file: {e}")

        try:
            public_url_resp = db.storage.from_("repair-guides").get_public_url(storage_path)
            file_url = public_url_resp if isinstance(public_url_resp, str) else storage_path
        except Exception:
            file_url = storage_path

    data = {
        "organisation_id": org_id,
        "title": body.title,
        "guide_type": guide_type,
    }
    if body.asset_id is not None:
        data["asset_id"] = body.asset_id
    if body.category_id is not None:
        data["category_id"] = body.category_id
    if body.content is not None:
        data["content"] = body.content
    if file_url is not None:
        data["file_url"] = file_url

    resp = db.table("repair_guides").insert(data).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create repair guide")
    return resp.data[0]


@router.get("/")
async def list_guides(
    asset_id: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    offset = pagination["offset"]
    page_size = pagination["page_size"]

    query = (
        db.table("repair_guides")
        .select("id, title, guide_type, asset_id, category_id, content, file_url, created_at, "
                "assets(name), issue_categories(name)", count="exact")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
    )

    if asset_id:
        query = query.eq("asset_id", asset_id)
    if category_id:
        query = query.eq("category_id", category_id)

    resp = query.order("created_at", desc=True).range(offset, offset + page_size - 1).execute()

    return {"data": resp.data or [], "total": resp.count or 0}


@router.get("/{guide_id}")
async def get_guide(
    guide_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    resp = (
        db.table("repair_guides")
        .select("*, assets(name), issue_categories(name)")
        .eq("id", str(guide_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Repair guide not found")

    return resp.data[0]


@router.delete("/{guide_id}")
async def delete_guide(
    guide_id: UUID,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    db.table("repair_guides").update({
        "is_deleted": True,
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", str(guide_id)).eq("organisation_id", org_id).execute()

    return {"ok": True}
