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


def _get_pullout_template_ids(sb, org_id: str) -> list:
    """Return IDs of all active pull_out form templates for the org."""
    res = (
        sb.table("form_templates")
        .select("id")
        .eq("organisation_id", org_id)
        .eq("type", "pull_out")
        .eq("is_deleted", False)
        .execute()
    )
    return [r["id"] for r in (res.data or [])]


# ── Pull-Out / Wastage Reports ─────────────────────────────────────────────

@router.get("/pull-outs/summary")
def get_pullout_summary(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    """Total pull-out count, total cost, and breakdown by reason and category."""
    org_id = _get_org(current_user)
    sb = get_admin_client()

    tpl_ids = _get_pullout_template_ids(sb, org_id)
    if not tpl_ids:
        return {"total_submissions": 0, "total_cost": 0, "by_reason": [], "by_category": []}

    q = (
        sb.table("form_submissions")
        .select("id, submitted_at, location_id, estimated_cost, form_responses(value, form_fields(label))")
        .eq("is_deleted", False)
        .eq("status", "submitted")
        .in_("form_template_id", tpl_ids)
    )
    if date_from:
        q = q.gte("submitted_at", date_from)
    if date_to:
        q = q.lte("submitted_at", date_to + "T23:59:59")
    if location_id:
        q = q.eq("location_id", location_id)

    submissions = q.execute().data or []

    total_cost = 0.0
    reason_counts: dict = {}
    category_counts: dict = {}

    for sub in submissions:
        ec = sub.get("estimated_cost")
        if ec is not None:
            try:
                total_cost += float(ec)
            except (ValueError, TypeError):
                pass
        responses = sub.get("form_responses") or []
        for r in responses:
            label = (r.get("form_fields") or {}).get("label", "").strip().lower()
            val = r.get("value") or ""
            if label == "reason":
                reason_counts[val] = reason_counts.get(val, 0) + 1
            elif label == "category":
                category_counts[val] = category_counts.get(val, 0) + 1

    return {
        "total_submissions": len(submissions),
        "total_cost": round(total_cost, 2),
        "by_reason": [{"reason": k, "count": v} for k, v in sorted(reason_counts.items(), key=lambda x: -x[1])],
        "by_category": [{"category": k, "count": v} for k, v in sorted(category_counts.items(), key=lambda x: -x[1])],
    }


@router.get("/pull-outs/trends")
def get_pullout_trends(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    granularity: str = Query("day"),
    current_user: dict = Depends(require_manager_or_above),
):
    """Daily/weekly/monthly pull-out counts and total cost."""
    org_id = _get_org(current_user)
    sb = get_admin_client()

    tpl_ids = _get_pullout_template_ids(sb, org_id)
    if not tpl_ids:
        return {"trends": []}

    q = (
        sb.table("form_submissions")
        .select("submitted_at, estimated_cost")
        .eq("is_deleted", False)
        .eq("status", "submitted")
        .in_("form_template_id", tpl_ids)
    )
    if date_from:
        q = q.gte("submitted_at", date_from)
    if date_to:
        q = q.lte("submitted_at", date_to + "T23:59:59")
    if location_id:
        q = q.eq("location_id", location_id)

    submissions = q.execute().data or []

    from collections import defaultdict
    from datetime import datetime as dt

    bucket_counts: dict = defaultdict(int)
    bucket_cost: dict = defaultdict(float)
    for sub in submissions:
        ts = sub.get("submitted_at", "")
        if not ts:
            continue
        try:
            d = dt.fromisoformat(ts.replace("Z", "+00:00"))
            if granularity == "month":
                key = d.strftime("%Y-%m")
            elif granularity == "week":
                key = d.strftime("%Y-W%W")
            else:
                key = d.strftime("%Y-%m-%d")
            bucket_counts[key] += 1
            ec = sub.get("estimated_cost")
            if ec is not None:
                try:
                    bucket_cost[key] += float(ec)
                except (ValueError, TypeError):
                    pass
        except ValueError:
            pass

    all_keys = sorted(set(list(bucket_counts.keys()) + list(bucket_cost.keys())))
    trends = [
        {"period": k, "count": bucket_counts.get(k, 0), "total_cost": round(bucket_cost.get(k, 0.0), 2)}
        for k in all_keys
    ]
    return {"trends": trends}


@router.get("/pull-outs/top-items")
def get_pullout_top_items(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    limit: int = Query(10),
    current_user: dict = Depends(require_manager_or_above),
):
    """Top pulled-out items by frequency and total cost."""
    org_id = _get_org(current_user)
    sb = get_admin_client()

    tpl_ids = _get_pullout_template_ids(sb, org_id)
    if not tpl_ids:
        return {"top_items": []}

    q = (
        sb.table("form_submissions")
        .select("estimated_cost, form_responses(value, form_fields(label))")
        .eq("is_deleted", False)
        .eq("status", "submitted")
        .in_("form_template_id", tpl_ids)
    )
    if date_from:
        q = q.gte("submitted_at", date_from)
    if date_to:
        q = q.lte("submitted_at", date_to + "T23:59:59")
    if location_id:
        q = q.eq("location_id", location_id)

    submissions = q.execute().data or []

    from collections import defaultdict
    item_counts: dict = defaultdict(int)
    item_cost: dict = defaultdict(float)

    for sub in submissions:
        responses = sub.get("form_responses") or []
        item_name = None
        for r in responses:
            label = (r.get("form_fields") or {}).get("label", "").strip().lower()
            if label == "item name":
                item_name = r.get("value") or "Unknown"
                break
        if item_name:
            item_counts[item_name] += 1
            ec = sub.get("estimated_cost")
            if ec is not None:
                try:
                    item_cost[item_name] += float(ec)
                except (ValueError, TypeError):
                    pass

    top = sorted(item_counts.items(), key=lambda x: -x[1])[:limit]
    return {
        "top_items": [
            {"item": k, "count": v, "total_cost": round(item_cost.get(k, 0.0), 2)}
            for k, v in top
        ]
    }


@router.get("/pull-outs/anomalies")
def get_pullout_anomalies(
    location_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    """
    Cost-based weekly anomaly detection per location.
    Compares current week's total estimated_cost against the 4-week rolling average.
    Flags locations where current week > 1.5× average.
    """
    org_id = _get_org(current_user)
    sb = get_admin_client()

    tpl_ids = _get_pullout_template_ids(sb, org_id)
    if not tpl_ids:
        return {"anomalies": [], "locations_checked": 0}

    from datetime import datetime as dt, timedelta, timezone
    now = dt.now(timezone.utc)
    # Start of current week (Monday)
    current_week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    # 4 weeks back
    four_weeks_ago = current_week_start - timedelta(weeks=4)

    q = (
        sb.table("form_submissions")
        .select("submitted_at, location_id, estimated_cost")
        .eq("is_deleted", False)
        .eq("status", "submitted")
        .in_("form_template_id", tpl_ids)
        .gte("submitted_at", four_weeks_ago.isoformat())
    )
    if location_id:
        q = q.eq("location_id", location_id)

    submissions = q.execute().data or []

    from collections import defaultdict
    # loc_id → list of (week_start_str, cost)
    loc_weekly: dict = defaultdict(lambda: defaultdict(float))

    for sub in submissions:
        ts = sub.get("submitted_at", "")
        loc = sub.get("location_id") or "unknown"
        ec = sub.get("estimated_cost") or 0
        if not ts:
            continue
        try:
            d = dt.fromisoformat(ts.replace("Z", "+00:00"))
            # Monday of this submission's week
            week_mon = d - timedelta(days=d.weekday())
            week_key = week_mon.strftime("%Y-%m-%d")
            loc_weekly[loc][week_key] += float(ec)
        except (ValueError, TypeError):
            pass

    current_week_key = current_week_start.strftime("%Y-%m-%d")
    anomalies = []

    for loc, weeks in loc_weekly.items():
        current_cost = weeks.get(current_week_key, 0.0)
        prior_costs = [v for k, v in weeks.items() if k != current_week_key]
        if not prior_costs:
            continue
        avg = sum(prior_costs) / len(prior_costs)
        if avg > 0 and current_cost > 1.5 * avg:
            anomalies.append({
                "location_id": loc,
                "current_week_cost": round(current_cost, 2),
                "four_week_avg_cost": round(avg, 2),
                "ratio": round(current_cost / avg, 2),
                "week_start": current_week_key,
            })

    anomalies.sort(key=lambda x: -x["ratio"])
    return {"anomalies": anomalies, "locations_checked": len(loc_weekly)}
