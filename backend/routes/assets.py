"""
Assets API — /api/v1/assets
Asset register + repair guides.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, require_manager_or_above, paginate
from services.supabase_client import get_supabase

router = APIRouter()


# ── Request Models ─────────────────────────────────────────────────────────────

class CreateAssetRequest(BaseModel):
    name: str
    category: Optional[str] = None
    serial_number: Optional[str] = None
    model: Optional[str] = None
    manufacturer: Optional[str] = None
    location_id: Optional[str] = None
    installed_at: Optional[str] = None
    next_maintenance_due_at: Optional[str] = None
    warranty_expiry: Optional[str] = None
    notes: Optional[str] = None


class UpdateAssetRequest(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    serial_number: Optional[str] = None
    model: Optional[str] = None
    manufacturer: Optional[str] = None
    location_id: Optional[str] = None
    installed_at: Optional[str] = None
    next_maintenance_due_at: Optional[str] = None
    warranty_expiry: Optional[str] = None
    notes: Optional[str] = None


# ── Assets ─────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_assets(
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    role = (current_user.get("app_metadata") or {}).get("role", "")
    db = get_supabase()

    offset = pagination["offset"]
    page_size = pagination["page_size"]

    query = (
        db.table("assets")
        .select("*, locations(name)", count="exact")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
    )

    # Non-managers only see assets at their location
    if role not in ("manager", "admin", "super_admin"):
        # Fetch user's location_id from profile
        profile_resp = (
            db.table("profiles")
            .select("location_id")
            .eq("id", user_id)
            .execute()
        )
        user_location_id = None
        if profile_resp.data:
            user_location_id = profile_resp.data[0].get("location_id")

        if user_location_id:
            query = query.eq("location_id", user_location_id)
        else:
            # No location assigned — return empty
            return {"data": [], "total": 0}

    resp = query.order("name").range(offset, offset + page_size - 1).execute()

    return {"data": resp.data or [], "total": resp.count or 0}


@router.post("/")
async def create_asset(
    body: CreateAssetRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    data = {
        "organisation_id": org_id,
        "name": body.name,
    }
    for field in ["category", "serial_number", "model", "manufacturer", "location_id",
                  "installed_at", "next_maintenance_due_at", "warranty_expiry", "notes"]:
        val = getattr(body, field, None)
        if val is not None:
            data[field] = val

    resp = db.table("assets").insert(data).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create asset")
    return resp.data[0]


@router.get("/{asset_id}")
async def get_asset(
    asset_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    resp = (
        db.table("assets")
        .select("*, locations(name)")
        .eq("id", str(asset_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Asset not found")

    asset = resp.data[0]

    # Fetch repair history: issues linked to this asset in maintenance categories
    maint_cats = db.table("issue_categories").select("id").eq("organisation_id", org_id).eq("is_maintenance", True).eq("is_deleted", False).execute()
    maint_cat_ids = [r["id"] for r in (maint_cats.data or [])]

    if maint_cat_ids:
        repair_resp = (
            db.table("issues")
            .select("id, title, status, priority, cost, created_at, resolved_at, resolution_note, profiles!assigned_to(full_name)")
            .eq("asset_id", str(asset_id))
            .eq("is_deleted", False)
            .in_("category_id", maint_cat_ids)
            .order("created_at", desc=True)
            .execute()
        )
        repair_issues = repair_resp.data or []
    else:
        repair_issues = []

    total_cost = sum(float(i.get("cost") or 0) for i in repair_issues if i.get("cost") is not None)
    asset["repair_history"] = repair_issues
    asset["repair_total_cost"] = total_cost

    return asset


@router.put("/{asset_id}")
async def update_asset(
    asset_id: UUID,
    body: UpdateAssetRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = datetime.utcnow().isoformat()

    resp = (
        db.table("assets")
        .update(updates)
        .eq("id", str(asset_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    return resp.data[0]


@router.delete("/{asset_id}")
async def delete_asset(
    asset_id: UUID,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    db.table("assets").update({
        "is_deleted": True,
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", str(asset_id)).eq("organisation_id", org_id).execute()

    return {"ok": True}


# ── Repair Guides for Asset ────────────────────────────────────────────────────

@router.get("/{asset_id}/guides")
async def list_asset_guides(
    asset_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    # Verify asset exists in org
    asset_resp = (
        db.table("assets")
        .select("id")
        .eq("id", str(asset_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not asset_resp.data:
        raise HTTPException(status_code=404, detail="Asset not found")

    guides_resp = (
        db.table("repair_guides")
        .select("*")
        .eq("asset_id", str(asset_id))
        .eq("is_deleted", False)
        .order("created_at", desc=True)
        .execute()
    )

    guides = guides_resp.data or []

    # Generate signed URLs for guides that have a storage_path
    for guide in guides:
        storage_path = guide.get("storage_path")
        if storage_path:
            try:
                signed = db.storage.from_("repair-guides").create_signed_url(storage_path, 3600)
                guide["signed_url"] = signed.get("signedURL") or signed.get("signed_url") or storage_path
            except Exception:
                guide["signed_url"] = guide.get("file_url")

    return {"data": guides, "total": len(guides)}
