"""
Issue Dashboard API — /api/v1/issue-dashboard
Dashboard analytics for managers+.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from dependencies import get_current_user, require_manager_or_above, paginate, get_db
from services.db import row, rows, execute

router = APIRouter()


# ── Summary ────────────────────────────────────────────────────────────────────

@router.get("/summary")
async def dashboard_summary(
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    issues = rows(
        conn,
        """
        SELECT
            i.id,
            i.status,
            i.priority,
            i.category_id,
            i.location_id,
            ic.name  AS category_name,
            l.name   AS location_name
        FROM issues i
        LEFT JOIN issue_categories ic ON ic.id = i.category_id
        LEFT JOIN locations         l  ON l.id  = i.location_id
        WHERE i.organisation_id = %s
          AND i.is_deleted = FALSE
        """,
        (org_id,),
    )

    by_status: dict = {}
    by_location: dict = {}
    by_category: dict = {}

    for issue in issues:
        status = issue.get("status", "unknown")
        by_status[status] = by_status.get(status, 0) + 1

        location_id   = issue.get("location_id")
        location_name = issue.get("location_name") or "Unknown"
        loc_key = f"{location_id}:{location_name}" if location_id else f"none:{location_name}"
        if loc_key not in by_location:
            by_location[loc_key] = {
                "location_id": location_id,
                "location_name": location_name,
                "by_status": {},
            }
        by_location[loc_key]["by_status"][status] = (
            by_location[loc_key]["by_status"].get(status, 0) + 1
        )

        category_id   = issue.get("category_id")
        category_name = issue.get("category_name") or "Unknown"
        cat_key = f"{category_id}:{category_name}" if category_id else f"none:{category_name}"
        if cat_key not in by_category:
            by_category[cat_key] = {
                "category_id": category_id,
                "category_name": category_name,
                "by_status": {},
            }
        by_category[cat_key]["by_status"][status] = (
            by_category[cat_key]["by_status"].get(status, 0) + 1
        )

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
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    # Default to last 30 days if not specified
    if not from_dt:
        from_dt = datetime.now(timezone.utc) - timedelta(days=30)
    if not to_dt:
        to_dt = datetime.now(timezone.utc)

    sql = """
        SELECT id, created_at
        FROM issues
        WHERE organisation_id = %s
          AND is_deleted = FALSE
          AND created_at >= %s
          AND created_at <= %s
    """
    params: list = [org_id, from_dt, to_dt]

    if location_id:
        sql += " AND location_id = %s"
        params.append(location_id)
    if category_id:
        sql += " AND category_id = %s"
        params.append(category_id)

    issues = rows(conn, sql, tuple(params))

    # Group by day
    by_day: dict = {}
    for issue in issues:
        created = issue.get("created_at")
        if created:
            # created_at may be a datetime object or an ISO string
            day = (
                created.strftime("%Y-%m-%d")
                if hasattr(created, "strftime")
                else str(created)[:10]
            )
            by_day[day] = by_day.get(day, 0) + 1

    trends = sorted(
        [{"date": day, "count": count} for day, count in by_day.items()],
        key=lambda x: x["date"],
    )

    return {"data": trends, "total": len(issues)}


# ── By Asset ───────────────────────────────────────────────────────────────────

@router.get("/by-asset")
async def dashboard_by_asset(
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    # Single query: join maintenance categories, filter non-null asset_id
    issues = rows(
        conn,
        """
        SELECT
            i.id,
            i.asset_id,
            i.cost,
            a.id   AS asset_id_ref,
            a.name AS asset_name,
            a.category AS asset_type
        FROM issues i
        JOIN issue_categories ic ON ic.id = i.category_id
        LEFT JOIN assets       a  ON a.id  = i.asset_id
        WHERE i.organisation_id = %s
          AND i.is_deleted = FALSE
          AND ic.is_maintenance = TRUE
          AND ic.is_deleted = FALSE
          AND i.asset_id IS NOT NULL
        """,
        (org_id,),
    )

    if not issues:
        return {"data": [], "total": 0}

    asset_map: dict = {}
    for issue in issues:
        asset_id = issue.get("asset_id")
        if not asset_id:
            continue
        if asset_id not in asset_map:
            asset_map[asset_id] = {
                "asset_id": asset_id,
                "asset_name": issue.get("asset_name") or "Unknown",
                "asset_type": issue.get("asset_type") or "",
                "ticket_count": 0,
                "total_repair_cost": 0.0,
            }
        asset_map[asset_id]["ticket_count"] += 1
        asset_map[asset_id]["total_repair_cost"] += float(issue.get("cost") or 0)

    result = sorted(
        list(asset_map.values()),
        key=lambda x: x["total_repair_cost"],
        reverse=True,
    )
    return {"data": result, "total": len(result)}


# ── By Location ────────────────────────────────────────────────────────────────

@router.get("/by-location")
async def dashboard_by_location(
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    issues = rows(
        conn,
        """
        SELECT i.id, i.location_id, l.name AS location_name
        FROM issues i
        LEFT JOIN locations l ON l.id = i.location_id
        WHERE i.organisation_id = %s
          AND i.is_deleted = FALSE
        """,
        (org_id,),
    )

    location_map: dict = {}
    for issue in issues:
        location_id   = issue.get("location_id") or "none"
        location_name = issue.get("location_name") or "Unknown / No Location"
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
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    offset    = pagination["offset"]
    page_size = pagination["page_size"]

    # Total count
    count_row = row(
        conn,
        """
        SELECT COUNT(*) AS total
        FROM issues
        WHERE organisation_id = %s
          AND is_deleted = FALSE
          AND recurrence_count >= 2
        """,
        (org_id,),
    )
    total = count_row["total"] if count_row else 0

    # Paginated rows with joins
    data = rows(
        conn,
        """
        SELECT
            i.*,
            p.full_name  AS reporter_full_name,
            ic.name      AS category_name,
            l.name       AS location_name
        FROM issues i
        LEFT JOIN profiles         p  ON p.id  = i.reported_by
        LEFT JOIN issue_categories ic ON ic.id = i.category_id
        LEFT JOIN locations        l  ON l.id  = i.location_id
        WHERE i.organisation_id = %s
          AND i.is_deleted = FALSE
          AND i.recurrence_count >= 2
        ORDER BY i.recurrence_count DESC
        LIMIT %s OFFSET %s
        """,
        (org_id, page_size, offset),
    )

    return {"data": [dict(r) for r in data], "total": total}
