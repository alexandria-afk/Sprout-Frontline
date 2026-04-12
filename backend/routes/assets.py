"""
Assets API — /api/v1/assets
Asset register + repair guides.
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, require_manager_or_above, paginate, get_db
from services.db import row, rows, execute, execute_returning

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
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    role = (current_user.get("app_metadata") or {}).get("role", "")
    offset = pagination["offset"]
    page_size = pagination["page_size"]

    conditions = ["a.organisation_id = %s", "a.is_deleted = FALSE"]
    params: list = [org_id]

    # Non-managers only see assets at their location
    if role not in ("manager", "admin", "super_admin"):
        profile = row(conn, "SELECT location_id FROM profiles WHERE id = %s", (user_id,))
        user_location_id = profile.get("location_id") if profile else None

        if user_location_id:
            conditions.append("a.location_id = %s")
            params.append(user_location_id)
        else:
            # No location assigned — return empty
            return {"data": [], "total": 0}

    where = " AND ".join(conditions)

    count_result = row(conn, f"SELECT COUNT(*) AS total FROM assets a WHERE {where}", tuple(params))
    total = count_result["total"] if count_result else 0

    params.extend([page_size, offset])
    data = rows(
        conn,
        f"""
        SELECT a.*, json_build_object('name', l.name) AS locations
        FROM assets a
        LEFT JOIN locations l ON l.id = a.location_id
        WHERE {where}
        ORDER BY a.name
        LIMIT %s OFFSET %s
        """,
        tuple(params),
    )

    return {"data": data, "total": total}


@router.post("/")
async def create_asset(
    body: CreateAssetRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    fields = ["organisation_id", "name"]
    values: list = [org_id, body.name]

    for field in ["category", "serial_number", "model", "manufacturer", "location_id",
                  "installed_at", "next_maintenance_due_at", "warranty_expiry", "notes"]:
        val = getattr(body, field, None)
        if val is not None:
            fields.append(field)
            values.append(val)

    col_list = ", ".join(fields)
    placeholder_list = ", ".join(["%s"] * len(fields))
    result = execute_returning(
        conn,
        f"INSERT INTO assets ({col_list}) VALUES ({placeholder_list}) RETURNING *",
        tuple(values),
    )
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create asset")
    return dict(result)


@router.get("/{asset_id}")
async def get_asset(
    asset_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    asset = row(
        conn,
        """
        SELECT a.*, json_build_object('name', l.name) AS locations
        FROM assets a
        LEFT JOIN locations l ON l.id = a.location_id
        WHERE a.id = %s AND a.organisation_id = %s AND a.is_deleted = FALSE
        """,
        (str(asset_id), org_id),
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    asset = dict(asset)

    # Fetch repair history: issues linked to this asset in maintenance categories
    maint_cats = rows(
        conn,
        "SELECT id FROM issue_categories WHERE organisation_id = %s AND is_maintenance = TRUE AND is_deleted = FALSE",
        (org_id,),
    )
    maint_cat_ids = [r["id"] for r in maint_cats]

    if maint_cat_ids:
        placeholders = ", ".join(["%s"] * len(maint_cat_ids))
        repair_issues = rows(
            conn,
            f"""
            SELECT
                i.id, i.title, i.status, i.priority, i.cost,
                i.created_at, i.resolved_at, i.resolution_note,
                json_build_object('full_name', p.full_name) AS profiles
            FROM issues i
            LEFT JOIN profiles p ON p.id = i.assigned_to
            WHERE i.asset_id = %s AND i.is_deleted = FALSE AND i.category_id IN ({placeholders})
            ORDER BY i.created_at DESC
            """,
            tuple([str(asset_id)] + maint_cat_ids),
        )
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
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    params = list(updates.values()) + [str(asset_id), org_id]
    result = execute_returning(
        conn,
        f"UPDATE assets SET {set_clause} WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE RETURNING *",
        tuple(params),
    )
    if not result:
        raise HTTPException(status_code=404, detail="Asset not found")
    return dict(result)


@router.delete("/{asset_id}")
async def delete_asset(
    asset_id: UUID,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    execute(
        conn,
        "UPDATE assets SET is_deleted = TRUE, updated_at = %s WHERE id = %s AND organisation_id = %s",
        (datetime.now(timezone.utc).isoformat(), str(asset_id), org_id),
    )

    return {"ok": True}


# ── Repair Guides for Asset ────────────────────────────────────────────────────

@router.get("/{asset_id}/guides")
async def list_asset_guides(
    asset_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    # Verify asset exists in org
    asset_check = row(
        conn,
        "SELECT id FROM assets WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(asset_id), org_id),
    )
    if not asset_check:
        raise HTTPException(status_code=404, detail="Asset not found")

    guides = rows(
        conn,
        "SELECT * FROM repair_guides WHERE asset_id = %s AND is_deleted = FALSE ORDER BY created_at DESC",
        (str(asset_id),),
    )

    # signed_url generation requires storage access; storage_path is returned as-is
    # (Supabase Storage signing is not available via psycopg2 — callers should use
    # the storage service directly or a presigned URL endpoint)
    for guide in guides:
        guide = dict(guide)
        if not guide.get("signed_url"):
            guide["signed_url"] = guide.get("file_url")

    return {"data": guides, "total": len(guides)}


# ── Predictive Maintenance ─────────────────────────────────────────────────────

@router.post("/{asset_id}/predict")
async def predict_asset(
    asset_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    """
    Trigger on-demand failure prediction for an asset.
    Calls Claude with the asset's maintenance history and persists the result.
    """
    from services.asset_prediction_service import predict_asset_failure

    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    try:
        result = await predict_asset_failure(conn, str(asset_id), org_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Prediction failed: {e}")

    return result
