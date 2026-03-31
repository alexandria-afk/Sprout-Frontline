"""
Reports Routes — Phase 2
GET /api/v1/reports/compliance
GET /api/v1/reports/checklist-completion
"""

import logging
from datetime import datetime, timezone, timedelta, date
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


_TASK_SLA_HOURS = {
    "critical": 4,
    "high": 24,
    "medium": 72,   # 3 days
    "low": 168,     # 7 days
}


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


# ── Aging Analytics ────────────────────────────────────────────────────────

@router.get("/aging/tasks")
def get_aging_tasks(
    location_id: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    """Task aging report: open age, SLA breach counts, aging buckets."""
    org_id = _get_org(current_user)
    sb = get_admin_client()
    from datetime import datetime as dt, timezone

    q = (
        sb.table("tasks")
        .select("id, title, priority, status, created_at, completed_at, location_id, locations(name)")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
    )
    if location_id:
        q = q.eq("location_id", location_id)
    if priority:
        q = q.eq("priority", priority)
    if status:
        q = q.eq("status", status)
    if date_from:
        q = q.gte("created_at", date_from)
    if date_to:
        q = q.lte("created_at", date_to + "T23:59:59")

    tasks = q.execute().data or []
    now = dt.now(timezone.utc)

    open_statuses = {"pending", "in_progress", "overdue"}
    closed_statuses = {"completed", "cancelled"}

    total_open = 0
    total_age_hours = 0.0
    sla_breach_count = 0
    by_priority: dict = {}
    by_location: dict = {}
    by_status: dict = {}
    buckets = {"< 4h": 0, "4-24h": 0, "1-3d": 0, "3-7d": 0, "> 7d": 0}

    for t in tasks:
        s = t.get("status", "pending")
        pri = t.get("priority", "medium")
        loc_id = t.get("location_id") or "unknown"
        loc_name = (t.get("locations") or {}).get("name", "Unknown")
        created = t.get("created_at", "")
        completed = t.get("completed_at")

        try:
            created_dt = dt.fromisoformat(created.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue

        if s in closed_statuses and completed:
            try:
                end_dt = dt.fromisoformat(str(completed).replace("Z", "+00:00"))
                age_h = (end_dt - created_dt).total_seconds() / 3600
            except (ValueError, AttributeError):
                age_h = (now - created_dt).total_seconds() / 3600
        else:
            age_h = (now - created_dt).total_seconds() / 3600

        sla_h = _TASK_SLA_HOURS.get(pri, 72)
        breached = age_h > sla_h

        # Open summary
        if s in open_statuses:
            total_open += 1
            total_age_hours += age_h
            if breached:
                sla_breach_count += 1

        # By priority
        if pri not in by_priority:
            by_priority[pri] = {"priority": pri, "open_count": 0, "total_age_h": 0.0,
                                 "sla_breach_count": 0, "oldest_age_h": 0.0}
        if s in open_statuses:
            by_priority[pri]["open_count"] += 1
            by_priority[pri]["total_age_h"] += age_h
            if breached:
                by_priority[pri]["sla_breach_count"] += 1
            if age_h > by_priority[pri]["oldest_age_h"]:
                by_priority[pri]["oldest_age_h"] = age_h

        # By location
        if loc_id not in by_location:
            by_location[loc_id] = {"location_id": loc_id, "location_name": loc_name,
                                    "open_count": 0, "total_age_h": 0.0, "sla_breach_count": 0}
        if s in open_statuses:
            by_location[loc_id]["open_count"] += 1
            by_location[loc_id]["total_age_h"] += age_h
            if breached:
                by_location[loc_id]["sla_breach_count"] += 1

        # By status
        if s not in by_status:
            by_status[s] = {"status": s, "count": 0, "total_age_h": 0.0}
        by_status[s]["count"] += 1
        by_status[s]["total_age_h"] += age_h

        # Aging buckets (open items only)
        if s in open_statuses:
            if age_h < 4:
                buckets["< 4h"] += 1
            elif age_h < 24:
                buckets["4-24h"] += 1
            elif age_h < 72:
                buckets["1-3d"] += 1
            elif age_h < 168:
                buckets["3-7d"] += 1
            else:
                buckets["> 7d"] += 1

    avg_age = round(total_age_hours / total_open, 1) if total_open else 0.0
    sla_pct = round(100 * sla_breach_count / total_open, 1) if total_open else 0.0

    pri_out = []
    for p in ["critical", "high", "medium", "low"]:
        if p in by_priority:
            d = by_priority[p]
            c = d["open_count"]
            pri_out.append({
                "priority": p,
                "open_count": c,
                "avg_age_hours": round(d["total_age_h"] / c, 1) if c else 0.0,
                "sla_breach_count": d["sla_breach_count"],
                "oldest_age_hours": round(d["oldest_age_h"], 1),
            })

    loc_out = sorted([
        {
            "location_id": v["location_id"],
            "location_name": v["location_name"],
            "open_count": v["open_count"],
            "avg_age_hours": round(v["total_age_h"] / v["open_count"], 1) if v["open_count"] else 0.0,
            "sla_breach_count": v["sla_breach_count"],
        }
        for v in by_location.values() if v["open_count"] > 0
    ], key=lambda x: -x["avg_age_hours"])

    status_out = [
        {
            "status": v["status"],
            "count": v["count"],
            "avg_age_hours": round(v["total_age_h"] / v["count"], 1) if v["count"] else 0.0,
        }
        for v in by_status.values()
    ]

    return {
        "summary": {
            "total_open": total_open,
            "avg_age_hours": avg_age,
            "sla_breach_count": sla_breach_count,
            "sla_breach_pct": sla_pct,
        },
        "by_priority": pri_out,
        "by_location": loc_out,
        "by_status": status_out,
        "aging_buckets": [{"bucket": k, "count": v} for k, v in buckets.items()],
    }


@router.get("/aging/issues")
def get_aging_issues(
    location_id: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    """Issue aging report: open age, SLA breach counts from category sla_hours."""
    org_id = _get_org(current_user)
    sb = get_admin_client()
    from datetime import datetime as dt, timezone

    q = (
        sb.table("issues")
        .select("id, title, priority, status, created_at, resolved_at, location_id, category_id, locations(name), issue_categories(name, sla_hours)")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
    )
    if location_id:
        q = q.eq("location_id", location_id)
    if category_id:
        q = q.eq("category_id", category_id)
    if priority:
        q = q.eq("priority", priority)
    if status:
        q = q.eq("status", status)
    if date_from:
        q = q.gte("created_at", date_from)
    if date_to:
        q = q.lte("created_at", date_to + "T23:59:59")

    issues = q.execute().data or []
    now = dt.now(timezone.utc)

    open_statuses = {"open", "in_progress", "pending_vendor"}
    closed_statuses = {"resolved", "closed"}

    total_open = 0
    total_age_hours = 0.0
    sla_breach_count = 0
    by_category: dict = {}
    by_location: dict = {}
    by_priority: dict = {}
    buckets = {"< 4h": 0, "4-24h": 0, "1-3d": 0, "3-7d": 0, "> 7d": 0}

    for issue in issues:
        s = issue.get("status", "open")
        pri = issue.get("priority", "medium")
        loc_id = issue.get("location_id") or "unknown"
        loc_name = (issue.get("locations") or {}).get("name", "Unknown")
        cat_id = issue.get("category_id") or "unknown"
        cat = issue.get("issue_categories") or {}
        cat_name = cat.get("name", "Unknown")
        sla_h = cat.get("sla_hours") or 24
        created = issue.get("created_at", "")
        resolved = issue.get("resolved_at")

        try:
            created_dt = dt.fromisoformat(created.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue

        if s in closed_statuses and resolved:
            try:
                end_dt = dt.fromisoformat(str(resolved).replace("Z", "+00:00"))
                age_h = (end_dt - created_dt).total_seconds() / 3600
            except (ValueError, AttributeError):
                age_h = (now - created_dt).total_seconds() / 3600
        else:
            age_h = (now - created_dt).total_seconds() / 3600

        breached = age_h > sla_h

        if s in open_statuses:
            total_open += 1
            total_age_hours += age_h
            if breached:
                sla_breach_count += 1

        # By category
        if cat_id not in by_category:
            by_category[cat_id] = {"category_id": cat_id, "category_name": cat_name,
                                    "open_count": 0, "total_age_h": 0.0,
                                    "sla_breach_count": 0, "sla_hours": sla_h}
        if s in open_statuses:
            by_category[cat_id]["open_count"] += 1
            by_category[cat_id]["total_age_h"] += age_h
            if breached:
                by_category[cat_id]["sla_breach_count"] += 1

        # By location
        if loc_id not in by_location:
            by_location[loc_id] = {"location_id": loc_id, "location_name": loc_name,
                                    "open_count": 0, "total_age_h": 0.0, "sla_breach_count": 0}
        if s in open_statuses:
            by_location[loc_id]["open_count"] += 1
            by_location[loc_id]["total_age_h"] += age_h
            if breached:
                by_location[loc_id]["sla_breach_count"] += 1

        # By priority
        if pri not in by_priority:
            by_priority[pri] = {"priority": pri, "open_count": 0, "total_age_h": 0.0, "sla_breach_count": 0}
        if s in open_statuses:
            by_priority[pri]["open_count"] += 1
            by_priority[pri]["total_age_h"] += age_h
            if breached:
                by_priority[pri]["sla_breach_count"] += 1

        # Aging buckets
        if s in open_statuses:
            if age_h < 4:
                buckets["< 4h"] += 1
            elif age_h < 24:
                buckets["4-24h"] += 1
            elif age_h < 72:
                buckets["1-3d"] += 1
            elif age_h < 168:
                buckets["3-7d"] += 1
            else:
                buckets["> 7d"] += 1

    avg_age = round(total_age_hours / total_open, 1) if total_open else 0.0
    sla_pct = round(100 * sla_breach_count / total_open, 1) if total_open else 0.0

    cat_out = sorted([
        {
            "category_id": v["category_id"],
            "category_name": v["category_name"],
            "open_count": v["open_count"],
            "avg_age_hours": round(v["total_age_h"] / v["open_count"], 1) if v["open_count"] else 0.0,
            "sla_breach_count": v["sla_breach_count"],
            "sla_hours": v["sla_hours"],
        }
        for v in by_category.values() if v["open_count"] > 0
    ], key=lambda x: -x["sla_breach_count"])

    loc_out = sorted([
        {
            "location_id": v["location_id"],
            "location_name": v["location_name"],
            "open_count": v["open_count"],
            "avg_age_hours": round(v["total_age_h"] / v["open_count"], 1) if v["open_count"] else 0.0,
            "sla_breach_count": v["sla_breach_count"],
        }
        for v in by_location.values() if v["open_count"] > 0
    ], key=lambda x: -x["avg_age_hours"])

    pri_out = [
        {
            "priority": v["priority"],
            "open_count": v["open_count"],
            "avg_age_hours": round(v["total_age_h"] / v["open_count"], 1) if v["open_count"] else 0.0,
            "sla_breach_count": v["sla_breach_count"],
        }
        for v in by_priority.values()
    ]

    return {
        "summary": {
            "total_open": total_open,
            "avg_age_hours": avg_age,
            "sla_breach_count": sla_breach_count,
            "sla_breach_pct": sla_pct,
        },
        "by_category": cat_out,
        "by_location": loc_out,
        "by_priority": pri_out,
        "aging_buckets": [{"bucket": k, "count": v} for k, v in buckets.items()],
    }


@router.get("/aging/resolution-time")
def get_resolution_time(
    location_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    entity_type: str = Query("issue"),  # "task" | "issue"
    current_user: dict = Depends(require_manager_or_above),
):
    """Average and median resolution time for completed tasks or resolved issues."""
    org_id = _get_org(current_user)
    sb = get_admin_client()
    from datetime import datetime as dt, timezone
    from collections import defaultdict
    import statistics

    if entity_type == "task":
        q = (
            sb.table("tasks")
            .select("created_at, completed_at, location_id, locations(name)")
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .in_("status", ["completed", "cancelled"])
        )
        end_col = "completed_at"
    else:
        q = (
            sb.table("issues")
            .select("created_at, resolved_at, location_id, locations(name)")
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .in_("status", ["resolved", "closed"])
        )
        end_col = "resolved_at"

    if location_id:
        q = q.eq("location_id", location_id)
    if date_from:
        q = q.gte("created_at", date_from)
    if date_to:
        q = q.lte("created_at", date_to + "T23:59:59")

    rows = q.execute().data or []

    resolution_hours: list = []
    period_map: dict = defaultdict(list)
    loc_map: dict = defaultdict(list)

    for row in rows:
        created = row.get("created_at")
        ended = row.get(end_col)
        if not created or not ended:
            continue
        try:
            c_dt = dt.fromisoformat(str(created).replace("Z", "+00:00"))
            e_dt = dt.fromisoformat(str(ended).replace("Z", "+00:00"))
            h = (e_dt - c_dt).total_seconds() / 3600
            if h < 0:
                continue
        except (ValueError, AttributeError):
            continue

        resolution_hours.append(h)
        period_key = c_dt.strftime("%Y-%m")
        period_map[period_key].append(h)

        loc_id = row.get("location_id") or "unknown"
        loc_name = (row.get("locations") or {}).get("name", "Unknown")
        loc_map[(loc_id, loc_name)].append(h)

    avg_h = round(sum(resolution_hours) / len(resolution_hours), 1) if resolution_hours else 0.0
    median_h = round(statistics.median(resolution_hours), 1) if resolution_hours else 0.0

    by_period = [
        {
            "period": period,
            "avg_resolution_hours": round(sum(hrs) / len(hrs), 1),
            "total_resolved": len(hrs),
        }
        for period, hrs in sorted(period_map.items())
    ]

    by_location = sorted([
        {
            "location_name": loc_name,
            "avg_resolution_hours": round(sum(hrs) / len(hrs), 1),
            "total_resolved": len(hrs),
        }
        for (loc_id, loc_name), hrs in loc_map.items()
    ], key=lambda x: x["avg_resolution_hours"])

    return {
        "avg_resolution_hours": avg_h,
        "median_resolution_hours": median_h,
        "by_period": by_period,
        "by_location": by_location,
    }


# ── Training / Certification Expiry ───────────────────────────────────────────

@router.get("/training/certification-expiry")
def get_certification_expiry(
    days_ahead: int = Query(30, ge=1, le=365),
    location_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    """Certification expiry report: per-enrollment validity, summary, by-location and by-course breakdowns."""
    org_id = _get_org(current_user)
    sb = get_admin_client()

    # Fetch all passed enrollments with cert_expires_at for this org
    res = (
        sb.table("course_enrollments")
        .select(
            "id, user_id, course_id, status, cert_issued_at, cert_expires_at, "
            "courses(title, cert_validity_days), profiles!user_id(full_name, location_id, role)"
        )
        .eq("organisation_id", org_id)
        .eq("status", "passed")
        .not_.is_("cert_expires_at", "null")
        .execute()
    )
    rows = res.data or []

    # Fetch location names
    loc_res = sb.table("locations").select("id, name").eq("organisation_id", org_id).execute()
    loc_map: dict = {l["id"]: l["name"] for l in (loc_res.data or [])}

    today = date.today()

    # Optionally filter by location in Python
    if location_id:
        rows = [r for r in rows if (r.get("profiles") or {}).get("location_id") == location_id]

    # Build per-enrollment data and aggregate
    enrollments_out = []
    by_location: dict = {}
    by_course: dict = {}

    total_certified = 0
    expiring_soon = 0
    expired = 0
    valid = 0

    for row in rows:
        profile = row.get("profiles") or {}
        course = row.get("courses") or {}

        full_name = profile.get("full_name") or "Unknown"
        user_loc_id = profile.get("location_id") or ""
        location_name = loc_map.get(user_loc_id, "Unknown") if user_loc_id else "Unknown"

        course_id = row.get("course_id") or ""
        course_title = course.get("title") or "Unknown Course"

        cert_expires_raw = row.get("cert_expires_at")
        cert_issued_raw = row.get("cert_issued_at")

        if not cert_expires_raw:
            continue

        try:
            cert_expires_date = date.fromisoformat(str(cert_expires_raw)[:10])
        except ValueError:
            continue

        days_until = (cert_expires_date - today).days

        if days_until < 0:
            status_label = "expired"
            expired += 1
        elif days_until <= days_ahead:
            status_label = "expiring_soon"
            expiring_soon += 1
        else:
            status_label = "valid"
            valid += 1

        total_certified += 1

        # By location aggregation
        if user_loc_id not in by_location:
            by_location[user_loc_id] = {
                "location_id": user_loc_id,
                "location_name": location_name,
                "valid": 0, "expiring_soon": 0, "expired": 0,
            }
        by_location[user_loc_id][status_label] += 1

        # By course aggregation
        if course_id not in by_course:
            by_course[course_id] = {
                "course_id": course_id,
                "course_title": course_title,
                "valid": 0, "expiring_soon": 0, "expired": 0,
            }
        by_course[course_id][status_label] += 1

        enrollments_out.append({
            "user_id": row.get("user_id") or "",
            "full_name": full_name,
            "location_id": user_loc_id,
            "location_name": location_name,
            "course_id": course_id,
            "course_title": course_title,
            "cert_issued_at": str(cert_issued_raw)[:10] if cert_issued_raw else None,
            "cert_expires_at": str(cert_expires_raw)[:10],
            "days_until_expiry": days_until,
            "expiry_status": status_label,
        })

    # Sort enrollments: expired first, then expiring_soon by days asc, then valid
    def _sort_key(e):
        s = e["expiry_status"]
        d = e["days_until_expiry"]
        if s == "expired":
            return (0, d)
        if s == "expiring_soon":
            return (1, d)
        return (2, d)

    enrollments_out.sort(key=_sort_key)

    return {
        "summary": {
            "total_certified": total_certified,
            "expiring_soon": expiring_soon,
            "expired": expired,
            "valid": valid,
        },
        "by_location": sorted(by_location.values(), key=lambda x: x["location_name"]),
        "by_course": sorted(by_course.values(), key=lambda x: -(x["expired"] + x["expiring_soon"])),
        "enrollments": enrollments_out,
    }
