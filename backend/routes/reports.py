"""
Reports Routes — Phase 2
GET /api/v1/reports/compliance
GET /api/v1/reports/checklist-completion
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from dependencies import require_manager_or_above
from services.supabase_client import get_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_org(current_user: dict) -> str:
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation found for user")
    return org_id


@router.get("/compliance")
async def compliance_trend(
    location_id: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    current_user: dict = Depends(require_manager_or_above),
):
    """
    Audit compliance trend by location and date range.
    Returns weekly buckets with avg_score, pass_rate, and total_audits.
    """
    org_id = _get_org(current_user)
    db = get_admin_client()

    # Default: last 30 days
    if not to_date:
        to_date = datetime.now(timezone.utc).date().isoformat()
    if not from_date:
        from_dt = datetime.fromisoformat(to_date) - timedelta(days=30)
        from_date = from_dt.date().isoformat()

    q = db.table("form_submissions") \
        .select("""
            id, submitted_at, overall_score, passed, location_id,
            form_templates!inner(organisation_id, type)
        """) \
        .eq("form_templates.organisation_id", org_id) \
        .eq("form_templates.type", "audit") \
        .gte("submitted_at", from_date) \
        .lte("submitted_at", to_date + "T23:59:59Z") \
        .order("submitted_at")

    if location_id:
        q = q.eq("location_id", location_id)

    res = q.execute()
    rows = res.data or []

    # Bucket by week
    buckets: dict[str, dict] = {}
    for row in rows:
        dt = datetime.fromisoformat(row["submitted_at"].replace("Z", "+00:00"))
        # ISO week start (Monday)
        week_start = (dt - timedelta(days=dt.weekday())).date().isoformat()
        if week_start not in buckets:
            buckets[week_start] = {"week": week_start, "total": 0, "passed": 0, "score_sum": 0.0}
        b = buckets[week_start]
        b["total"] += 1
        if row.get("passed"):
            b["passed"] += 1
        b["score_sum"] += float(row.get("overall_score") or 0)

    trend = []
    for week, b in sorted(buckets.items()):
        trend.append({
            "week": week,
            "total_audits": b["total"],
            "passed": b["passed"],
            "failed": b["total"] - b["passed"],
            "pass_rate": round(b["passed"] / b["total"] * 100, 1) if b["total"] else 0,
            "avg_score": round(b["score_sum"] / b["total"], 1) if b["total"] else 0,
        })

    return {
        "from": from_date,
        "to": to_date,
        "location_id": location_id,
        "trend": trend,
        "summary": {
            "total_audits": sum(b["total_audits"] for b in trend),
            "overall_pass_rate": round(
                sum(b["passed"] for b in trend)
                / max(sum(b["total_audits"] for b in trend), 1) * 100, 1
            ),
        },
    }


@router.get("/checklist-completion")
async def checklist_completion(
    location_id: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    current_user: dict = Depends(require_manager_or_above),
):
    """Checklist completion rates by template + location."""
    org_id = _get_org(current_user)
    db = get_admin_client()

    if not to_date:
        to_date = datetime.now(timezone.utc).date().isoformat()
    if not from_date:
        from_dt = datetime.fromisoformat(to_date) - timedelta(days=30)
        from_date = from_dt.date().isoformat()

    q = db.table("form_submissions") \
        .select("""
            id, status, location_id, form_template_id,
            form_templates!inner(title, type, organisation_id)
        """) \
        .eq("form_templates.organisation_id", org_id) \
        .eq("form_templates.type", "checklist") \
        .gte("created_at", from_date) \
        .lte("created_at", to_date + "T23:59:59Z")

    if location_id:
        q = q.eq("location_id", location_id)

    res = q.execute()
    rows = res.data or []

    # Group by template
    by_template: dict[str, dict] = {}
    for row in rows:
        tid = row["form_template_id"]
        title = (row.get("form_templates") or {}).get("title", tid)
        if tid not in by_template:
            by_template[tid] = {"template_id": tid, "title": title, "total": 0, "completed": 0}
        by_template[tid]["total"] += 1
        if row.get("status") == "submitted":
            by_template[tid]["completed"] += 1

    result = []
    for tid, b in by_template.items():
        result.append({
            **b,
            "completion_rate": round(b["completed"] / b["total"] * 100, 1) if b["total"] else 0,
        })

    return {"from": from_date, "to": to_date, "templates": result}
