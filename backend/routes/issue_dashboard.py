"""
Issue Dashboard API — /api/v1/issue-dashboard
Dashboard analytics for managers+.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query

from dependencies import get_current_user, require_manager_or_above, paginate
from services.supabase_client import get_supabase

router = APIRouter()


# ── Summary ────────────────────────────────────────────────────────────────────

@router.get("/summary")
async def dashboard_summary(
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    resp = (
        db.table("issues")
        .select(
            "id, status, priority, category_id, location_id, "
            "issue_categories(name), locations(name)"
        )
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    issues = resp.data or []

    by_status: dict = {}
    by_location: dict = {}
    by_category: dict = {}

    for issue in issues:
        status = issue.get("status", "unknown")
        by_status[status] = by_status.get(status, 0) + 1

        location_id = issue.get("location_id")
        location_name = (issue.get("locations") or {}).get("name", "Unknown")
        loc_key = f"{location_id}:{location_name}" if location_id else f"none:{location_name}"
        if loc_key not in by_location:
            by_location[loc_key] = {"location_id": location_id, "location_name": location_name, "by_status": {}}
        by_location[loc_key]["by_status"][status] = by_location[loc_key]["by_status"].get(status, 0) + 1

        category_id = issue.get("category_id")
        category_name = (issue.get("issue_categories") or {}).get("name", "Unknown")
        cat_key = f"{category_id}:{category_name}" if category_id else f"none:{category_name}"
        if cat_key not in by_category:
            by_category[cat_key] = {"category_id": category_id, "category_name": category_name, "by_status": {}}
        by_category[cat_key]["by_status"][status] = by_category[cat_key]["by_status"].get(status, 0) + 1

    return {
        "total": len(issues),
        "by_status": by_status,
        "by_location": list(by_location.values()),
        "by_category": list(by_category.values()),
    }


# ── Trends ─────────────────────────────────────────────────────────────────────

@router.get("/trends")
async def dashboard_trends(
    location_id: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    # Default to last 30 days if not specified
    if not from_dt:
        from_dt = datetime.utcnow() - timedelta(days=30)
    if not to_dt:
        to_dt = datetime.utcnow()

    query = (
        db.table("issues")
        .select("id, created_at")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .gte("created_at", from_dt.isoformat())
        .lte("created_at", to_dt.isoformat())
    )

    if location_id:
        query = query.eq("location_id", location_id)
    if category_id:
        query = query.eq("category_id", category_id)

    resp = query.execute()
    issues = resp.data or []

    # Group by day
    by_day: dict = {}
    for issue in issues:
        created = issue.get("created_at", "")
        if created:
            day = created[:10]  # YYYY-MM-DD
            by_day[day] = by_day.get(day, 0) + 1

    # Build sorted list of day -> count
    trends = sorted(
        [{"date": day, "count": count} for day, count in by_day.items()],
        key=lambda x: x["date"],
    )

    return {"data": trends, "total": len(issues)}


# ── By Asset ───────────────────────────────────────────────────────────────────

@router.get("/by-asset")
async def dashboard_by_asset(
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    # Get maintenance category IDs
    cat_resp = db.table("issue_categories").select("id").eq("organisation_id", org_id).eq("is_maintenance", True).eq("is_deleted", False).execute()
    maint_cat_ids = [r["id"] for r in (cat_resp.data or [])]

    if not maint_cat_ids:
        return {"data": [], "total": 0}

    issues_resp = (
        db.table("issues")
        .select("id, asset_id, cost, assets(id, name, category)")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .in_("category_id", maint_cat_ids)
        .not_.is_("asset_id", "null")
        .execute()
    )
    issues = issues_resp.data or []

    asset_map: dict = {}
    for issue in issues:
        asset_id = issue.get("asset_id")
        if not asset_id:
            continue
        asset_info = issue.get("assets") or {}
        if asset_id not in asset_map:
            asset_map[asset_id] = {
                "asset_id": asset_id,
                "asset_name": asset_info.get("name", "Unknown"),
                "asset_type": asset_info.get("category", ""),
                "ticket_count": 0,
                "total_repair_cost": 0.0,
            }
        asset_map[asset_id]["ticket_count"] += 1
        asset_map[asset_id]["total_repair_cost"] += float(issue.get("cost") or 0)

    result = sorted(list(asset_map.values()), key=lambda x: x["total_repair_cost"], reverse=True)
    return {"data": result, "total": len(result)}


# ── By Location ────────────────────────────────────────────────────────────────

@router.get("/by-location")
async def dashboard_by_location(
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    resp = (
        db.table("issues")
        .select("id, location_id, locations(name)")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    issues = resp.data or []

    location_map: dict = {}
    for issue in issues:
        location_id = issue.get("location_id") or "none"
        location_name = (issue.get("locations") or {}).get("name", "Unknown / No Location")
        if location_id not in location_map:
            location_map[location_id] = {
                "location_id": location_id if location_id != "none" else None,
                "location_name": location_name,
                "issue_count": 0,
            }
        location_map[location_id]["issue_count"] += 1

    result = sorted(
        list(location_map.values()),
        key=lambda x: x["issue_count"],
        reverse=True,
    )

    return {"data": result, "total": len(result)}


# ── Recurring ──────────────────────────────────────────────────────────────────

@router.get("/recurring")
async def dashboard_recurring(
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    offset = pagination["offset"]
    page_size = pagination["page_size"]

    resp = (
        db.table("issues")
        .select(
            "*, profiles!reported_by(full_name), issue_categories(name), locations(name)",
            count="exact",
        )
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .gte("recurrence_count", 2)
        .order("recurrence_count", desc=True)
        .range(offset, offset + page_size - 1)
        .execute()
    )

    return {"data": resp.data or [], "total": resp.count or 0}
