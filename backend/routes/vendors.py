"""
Vendors API — /api/v1/vendors
Vendor management + category access.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, paginate, get_db
from services.db import row, rows, execute, execute_returning

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
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    offset = pagination["offset"]
    page_size = pagination["page_size"]

    # Fetch vendors with their non-deleted category access entries + category names
    vendor_rows = rows(
        conn,
        """
        SELECT v.*,
               vca.id        AS vca_id,
               vca.category_id AS vca_category_id,
               vca.is_deleted  AS vca_is_deleted,
               ic.name         AS vca_category_name
        FROM vendors v
        LEFT JOIN vendor_category_access vca
               ON vca.vendor_id = v.id AND vca.is_deleted = false
        LEFT JOIN issue_categories ic
               ON ic.id = vca.category_id
        WHERE v.organisation_id = %s
          AND v.is_deleted = false
        ORDER BY v.name
        LIMIT %s OFFSET %s
        """,
        (org_id, page_size, offset),
    )

    # Count total vendors (separate query so LIMIT/OFFSET don't affect it)
    total_row = row(
        conn,
        "SELECT COUNT(*) AS cnt FROM vendors WHERE organisation_id = %s AND is_deleted = false",
        (org_id,),
    )
    total = total_row["cnt"] if total_row else 0

    # Re-assemble into vendor dicts with nested vendor_category_access list
    vendor_map: dict = {}
    for r in vendor_rows:
        vid = r["id"]
        if vid not in vendor_map:
            vendor_map[vid] = {
                k: v for k, v in r.items()
                if not k.startswith("vca_")
            }
            vendor_map[vid]["vendor_category_access"] = []
        if r["vca_id"] is not None:
            vendor_map[vid]["vendor_category_access"].append({
                "id": r["vca_id"],
                "category_id": r["vca_category_id"],
                "is_deleted": r["vca_is_deleted"],
                "issue_categories": {"name": r["vca_category_name"]},
            })

    return {"data": list(vendor_map.values()), "total": total}


@router.post("/")
async def create_vendor(
    body: CreateVendorRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    cols = ["organisation_id", "name"]
    vals: list = [org_id, body.name]

    optional_fields = ["contact_name", "contact_email", "contact_phone", "address", "notes"]
    for field in optional_fields:
        val = getattr(body, field)
        if val is not None:
            cols.append(field)
            vals.append(val)

    placeholders = ", ".join(["%s"] * len(cols))
    col_list = ", ".join(cols)

    vendor = execute_returning(
        conn,
        f"INSERT INTO vendors ({col_list}) VALUES ({placeholders}) RETURNING *",
        tuple(vals),
    )
    if not vendor:
        raise HTTPException(status_code=500, detail="Failed to create vendor")
    return vendor


@router.put("/{vendor_id}")
async def update_vendor(
    vendor_id: UUID,
    body: UpdateVendorRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = datetime.utcnow().isoformat()

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    vals = list(updates.values()) + [str(vendor_id), org_id]

    vendor = execute_returning(
        conn,
        f"""
        UPDATE vendors
        SET {set_clause}
        WHERE id = %s AND organisation_id = %s AND is_deleted = false
        RETURNING *
        """,
        tuple(vals),
    )
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor


@router.delete("/{vendor_id}")
async def delete_vendor(
    vendor_id: UUID,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    execute(
        conn,
        """
        UPDATE vendors
        SET is_deleted = true, updated_at = %s
        WHERE id = %s AND organisation_id = %s
        """,
        (datetime.utcnow().isoformat(), str(vendor_id), org_id),
    )
    return {"ok": True}


# ── Category Access ────────────────────────────────────────────────────────────

@router.post("/{vendor_id}/category-access")
async def grant_category_access(
    vendor_id: UUID,
    body: GrantCategoryAccessRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    # Verify vendor belongs to org
    vendor = row(
        conn,
        "SELECT id FROM vendors WHERE id = %s AND organisation_id = %s AND is_deleted = false",
        (str(vendor_id), org_id),
    )
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    # Verify category belongs to org
    category = row(
        conn,
        "SELECT id FROM issue_categories WHERE id = %s AND organisation_id = %s AND is_deleted = false",
        (body.category_id, org_id),
    )
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    # Upsert — if a soft-deleted record exists, restore it
    existing = row(
        conn,
        "SELECT id, is_deleted FROM vendor_category_access WHERE vendor_id = %s AND category_id = %s",
        (str(vendor_id), body.category_id),
    )
    if existing:
        if not existing["is_deleted"]:
            return existing
        # Restore soft-deleted record
        restored = execute_returning(
            conn,
            """
            UPDATE vendor_category_access
            SET is_deleted = false, updated_at = %s
            WHERE id = %s
            RETURNING *
            """,
            (datetime.utcnow().isoformat(), existing["id"]),
        )
        return restored if restored else existing

    access = execute_returning(
        conn,
        """
        INSERT INTO vendor_category_access (vendor_id, category_id)
        VALUES (%s, %s)
        RETURNING *
        """,
        (str(vendor_id), body.category_id),
    )
    if not access:
        raise HTTPException(status_code=500, detail="Failed to grant category access")
    return access


@router.delete("/{vendor_id}/category-access/{category_id}")
async def revoke_category_access(
    vendor_id: UUID,
    category_id: UUID,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    vendor = row(
        conn,
        "SELECT id FROM vendors WHERE id = %s AND organisation_id = %s AND is_deleted = false",
        (str(vendor_id), org_id),
    )
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    execute(
        conn,
        """
        UPDATE vendor_category_access
        SET is_deleted = true, updated_at = %s
        WHERE vendor_id = %s AND category_id = %s
        """,
        (datetime.utcnow().isoformat(), str(vendor_id), str(category_id)),
    )
    return {"ok": True}
