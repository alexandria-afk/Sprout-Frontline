"""
Vendors API — /api/v1/vendors
Vendor management + category access.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, paginate
from services.supabase_client import get_supabase

router = APIRouter()


# ── Request Models ─────────────────────────────────────────────────────────────

class CreateVendorRequest(BaseModel):
    name: str
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class UpdateVendorRequest(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class GrantCategoryAccessRequest(BaseModel):
    category_id: str


# ── Vendors ────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_vendors(
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    offset = pagination["offset"]
    page_size = pagination["page_size"]

    resp = (
        db.table("vendors")
        .select("*, vendor_category_access!left(id, category_id, is_deleted, issue_categories(name))", count="exact")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .order("name")
        .range(offset, offset + page_size - 1)
        .execute()
    )

    vendors = []
    for v in (resp.data or []):
        v["vendor_category_access"] = [
            a for a in (v.get("vendor_category_access") or []) if not a.get("is_deleted")
        ]
        vendors.append(v)

    return {"data": vendors, "total": resp.count or 0}


@router.post("/")
async def create_vendor(
    body: CreateVendorRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    data = {
        "organisation_id": org_id,
        "name": body.name,
    }
    if body.contact_name is not None:
        data["contact_name"] = body.contact_name
    if body.contact_email is not None:
        data["contact_email"] = body.contact_email
    if body.contact_phone is not None:
        data["contact_phone"] = body.contact_phone
    if body.address is not None:
        data["address"] = body.address
    if body.notes is not None:
        data["notes"] = body.notes

    resp = db.table("vendors").insert(data).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create vendor")
    return resp.data[0]


@router.put("/{vendor_id}")
async def update_vendor(
    vendor_id: UUID,
    body: UpdateVendorRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = datetime.utcnow().isoformat()

    resp = (
        db.table("vendors")
        .update(updates)
        .eq("id", str(vendor_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return resp.data[0]


@router.delete("/{vendor_id}")
async def delete_vendor(
    vendor_id: UUID,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    db.table("vendors").update({
        "is_deleted": True,
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", str(vendor_id)).eq("organisation_id", org_id).execute()

    return {"ok": True}


# ── Category Access ────────────────────────────────────────────────────────────

@router.post("/{vendor_id}/category-access")
async def grant_category_access(
    vendor_id: UUID,
    body: GrantCategoryAccessRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    # Verify vendor belongs to org
    vendor = (
        db.table("vendors")
        .select("id")
        .eq("id", str(vendor_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not vendor.data:
        raise HTTPException(status_code=404, detail="Vendor not found")

    # Verify category belongs to org
    category = (
        db.table("issue_categories")
        .select("id")
        .eq("id", body.category_id)
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not category.data:
        raise HTTPException(status_code=404, detail="Category not found")

    # Upsert — if a soft-deleted record exists, restore it
    existing = (
        db.table("vendor_category_access")
        .select("id, is_deleted")
        .eq("vendor_id", str(vendor_id))
        .eq("category_id", body.category_id)
        .execute()
    )
    if existing.data:
        record = existing.data[0]
        if not record.get("is_deleted"):
            return record
        # Restore
        resp = (
            db.table("vendor_category_access")
            .update({"is_deleted": False, "updated_at": datetime.utcnow().isoformat()})
            .eq("id", record["id"])
            .execute()
        )
        return resp.data[0] if resp.data else record

    resp = db.table("vendor_category_access").insert({
        "vendor_id": str(vendor_id),
        "category_id": body.category_id,
    }).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to grant category access")
    return resp.data[0]


@router.delete("/{vendor_id}/category-access/{category_id}")
async def revoke_category_access(
    vendor_id: UUID,
    category_id: UUID,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    vendor = (
        db.table("vendors")
        .select("id")
        .eq("id", str(vendor_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not vendor.data:
        raise HTTPException(status_code=404, detail="Vendor not found")

    db.table("vendor_category_access").update({
        "is_deleted": True,
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("vendor_id", str(vendor_id)).eq("category_id", str(category_id)).execute()

    return {"ok": True}
