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

from dependencies import get_current_user, get_db, require_admin, paginate
from services.blob_storage import upload_blob, get_public_url
from services.db import execute, execute_returning, row, rows

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
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    file_url = None

    # Derive guide_type from file content type if uploading
    guide_type = body.guide_type or "text"

    # Phase 5: replace with Azure Blob
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
            upload_blob("repair-guides", storage_path, file_bytes, content_type)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to upload file: {e}")

        file_url = get_public_url("repair-guides", storage_path)

    # Build dynamic INSERT based on which optional fields are present
    columns = ["organisation_id", "title", "guide_type"]
    placeholders = ["%s", "%s", "%s"]
    values: list = [org_id, body.title, guide_type]

    if body.asset_id is not None:
        columns.append("asset_id")
        placeholders.append("%s")
        values.append(body.asset_id)
    if body.category_id is not None:
        columns.append("category_id")
        placeholders.append("%s")
        values.append(body.category_id)
    if body.content is not None:
        columns.append("content")
        placeholders.append("%s")
        values.append(body.content)
    if file_url is not None:
        columns.append("file_url")
        placeholders.append("%s")
        values.append(file_url)

    sql = (
        f"INSERT INTO repair_guides ({', '.join(columns)}) "
        f"VALUES ({', '.join(placeholders)}) "
        f"RETURNING *"
    )
    result = execute_returning(conn, sql, tuple(values))
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create repair guide")
    return dict(result)


@router.get("/")
async def list_guides(
    asset_id: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    offset = pagination["offset"]
    page_size = pagination["page_size"]

    filters = ["rg.organisation_id = %s", "rg.is_deleted = FALSE"]
    params: list = [org_id]

    if asset_id:
        filters.append("rg.asset_id = %s")
        params.append(asset_id)
    if category_id:
        filters.append("rg.category_id = %s")
        params.append(category_id)

    where = " AND ".join(filters)

    # Total count
    count_sql = f"SELECT COUNT(*) AS total FROM repair_guides rg WHERE {where}"
    count_row = row(conn, count_sql, tuple(params))
    total = count_row["total"] if count_row else 0

    # Paginated data with joined asset and category names
    data_sql = f"""
        SELECT
            rg.id, rg.title, rg.guide_type, rg.asset_id, rg.category_id,
            rg.content, rg.file_url, rg.created_at,
            a.name AS asset_name,
            ic.name AS category_name
        FROM repair_guides rg
        LEFT JOIN assets a ON a.id = rg.asset_id
        LEFT JOIN issue_categories ic ON ic.id = rg.category_id
        WHERE {where}
        ORDER BY rg.created_at DESC
        LIMIT %s OFFSET %s
    """
    params.extend([page_size, offset])
    data = rows(conn, data_sql, tuple(params))

    # Reshape to match Supabase nested shape: assets(name), issue_categories(name)
    for r_ in data:
        r_["assets"] = {"name": r_.pop("asset_name")} if r_.get("asset_name") else None
        r_["issue_categories"] = {"name": r_.pop("category_name")} if r_.get("category_name") else None

    return {"data": [dict(r_) for r_ in data], "total": total}


@router.get("/{guide_id}")
async def get_guide(
    guide_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    result = row(
        conn,
        """
        SELECT
            rg.*,
            a.name AS asset_name,
            ic.name AS category_name
        FROM repair_guides rg
        LEFT JOIN assets a ON a.id = rg.asset_id
        LEFT JOIN issue_categories ic ON ic.id = rg.category_id
        WHERE rg.id = %s
          AND rg.organisation_id = %s
          AND rg.is_deleted = FALSE
        """,
        (str(guide_id), org_id),
    )
    if not result:
        raise HTTPException(status_code=404, detail="Repair guide not found")

    result = dict(result)
    result["assets"] = {"name": result.pop("asset_name")} if result.get("asset_name") else None
    result["issue_categories"] = {"name": result.pop("category_name")} if result.get("category_name") else None
    return result


@router.delete("/{guide_id}")
async def delete_guide(
    guide_id: UUID,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    execute(
        conn,
        """
        UPDATE repair_guides
           SET is_deleted = TRUE,
               updated_at = NOW()
         WHERE id = %s
           AND organisation_id = %s
        """,
        (str(guide_id), org_id),
    )
    return {"ok": True}
