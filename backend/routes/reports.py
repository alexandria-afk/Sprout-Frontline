"""
Reports Routes — Phase 2
GET /api/v1/reports/compliance
GET /api/v1/reports/checklist-completion
"""

import logging
import statistics
from collections import defaultdict
from datetime import datetime, timezone, timedelta, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from dependencies import get_db, require_manager_or_above
from services.db import row, rows, execute, execute_returning, execute_many

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
    conn=Depends(get_db),
):
    """
    Audit compliance trend by location and date range.
    Returns weekly buckets with avg_score, pass_rate, and total_audits.
    """
    org_id = _get_org(current_user)

    # Default: last 30 days
    if not to_date:
        to_date = datetime.now(timezone.utc).date().isoformat()
    if not from_date:
        from_dt = datetime.fromisoformat(to_date) - timedelta(days=30)
        from_date = from_dt.date().isoformat()

    params: list = [org_id, from_date, to_date + "T23:59:59Z"]
    location_clause = ""
    if location_id:
        location_clause = "AND fs.location_id = %s"
        params.append(location_id)

    sql = f"""
        SELECT fs.id, fs.submitted_at, fs.overall_score, fs.passed, fs.location_id
        FROM form_submissions fs
        JOIN form_templates ft ON ft.id = fs.form_template_id
        WHERE ft.organisation_id = %s
          AND ft.type = 'audit'
          AND fs.submitted_at >= %s
          AND fs.submitted_at <= %s
          {location_clause}
        ORDER BY fs.submitted_at
    """

    result_rows = rows(conn, sql, tuple(params))

    # Bucket by week
    buckets: dict[str, dict] = {}
    for r in result_rows:
        submitted_at = r["submitted_at"]
        if hasattr(submitted_at, "isoformat"):
            dt = submitted_at if submitted_at.tzinfo else submitted_at.replace(tzinfo=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(submitted_at).replace("Z", "+00:00"))
        # ISO week start (Monday)
        week_start = (dt - timedelta(days=dt.weekday())).date().isoformat()
        if week_start not in buckets:
            buckets[week_start] = {"week": week_start, "total": 0, "passed": 0, "score_sum": 0.0}
        b = buckets[week_start]
        b["total"] += 1
        if r.get("passed"):
            b["passed"] += 1
        b["score_sum"] += float(r.get("overall_score") or 0)

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
    conn=Depends(get_db),
):
    """Checklist completion rates by template + location."""
    org_id = _get_org(current_user)

    if not to_date:
        to_date = datetime.now(timezone.utc).date().isoformat()
    if not from_date:
        from_dt = datetime.fromisoformat(to_date) - timedelta(days=30)
        from_date = from_dt.date().isoformat()

    params: list = [org_id, from_date, to_date + "T23:59:59Z"]
    location_clause = ""
    if location_id:
        location_clause = "AND fs.location_id = %s"
        params.append(location_id)

    sql = f"""
        SELECT fs.id, fs.status, fs.location_id, fs.form_template_id, ft.title
        FROM form_submissions fs
        JOIN form_templates ft ON ft.id = fs.form_template_id
        WHERE ft.organisation_id = %s
          AND ft.type = 'checklist'
          AND fs.created_at >= %s
          AND fs.created_at <= %s
          {location_clause}
    """

    result_rows = rows(conn, sql, tuple(params))

    # Group by template
    by_template: dict[str, dict] = {}
    for r in result_rows:
        tid = r["form_template_id"]
        title = r.get("title") or str(tid)
        if tid not in by_template:
            by_template[tid] = {"template_id": tid, "title": title, "total": 0, "completed": 0}
        by_template[tid]["total"] += 1
        if r.get("status") == "submitted":
            by_template[tid]["completed"] += 1

    result = []
    for tid, b in by_template.items():
        result.append({
            **b,
            "completion_rate": round(b["completed"] / b["total"] * 100, 1) if b["total"] else 0,
        })

    return {"from": from_date, "to": to_date, "templates": result}


def _get_pullout_template_ids(conn, org_id: str) -> list:
    """Return IDs of all active pull_out form templates for the org."""
    result = rows(conn, """
        SELECT id
        FROM form_templates
        WHERE organisation_id = %s
          AND type = 'pull_out'
          AND is_deleted = FALSE
    """, (org_id,))
    return [r["id"] for r in result]


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
    conn=Depends(get_db),
):
    """Total pull-out count, total cost, and breakdown by reason and category."""
    org_id = _get_org(current_user)

    tpl_ids = _get_pullout_template_ids(conn, org_id)
    if not tpl_ids:
        return {"total_submissions": 0, "total_cost": 0, "by_reason": [], "by_category": []}

    params: list = [list(tpl_ids)]
    date_clauses = ""
    if date_from:
        date_clauses += " AND fs.submitted_at >= %s"
        params.append(date_from)
    if date_to:
        date_clauses += " AND fs.submitted_at <= %s"
        params.append(date_to + "T23:59:59")
    if location_id:
        date_clauses += " AND fs.location_id = %s"
        params.append(location_id)

    sql = f"""
        SELECT fs.id, fs.submitted_at, fs.location_id, fs.estimated_cost,
               ff.label, fr.value
        FROM form_submissions fs
        LEFT JOIN form_responses fr ON fr.form_submission_id = fs.id
        LEFT JOIN form_fields ff ON ff.id = fr.form_field_id
        WHERE fs.is_deleted = FALSE
          AND fs.status = 'submitted'
          AND fs.form_template_id = ANY(%s::uuid[])
          {date_clauses}
    """

    result_rows = rows(conn, sql, tuple(params))

    # Group by submission id first to collect estimated_cost once per submission
    submission_costs: dict = {}
    reason_counts: dict = {}
    category_counts: dict = {}

    for r in result_rows:
        sid = r["id"]
        if sid not in submission_costs:
            ec = r.get("estimated_cost")
            submission_costs[sid] = ec
        label = (r.get("label") or "").strip().lower()
        val = r.get("value") or ""
        if label == "reason":
            reason_counts[val] = reason_counts.get(val, 0) + 1
        elif label == "category":
            category_counts[val] = category_counts.get(val, 0) + 1

    total_cost = 0.0
    for ec in submission_costs.values():
        if ec is not None:
            try:
                total_cost += float(ec)
            except (ValueError, TypeError):
                pass

    return {
        "total_submissions": len(submission_costs),
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
    conn=Depends(get_db),
):
    """Daily/weekly/monthly pull-out counts and total cost."""
    org_id = _get_org(current_user)

    tpl_ids = _get_pullout_template_ids(conn, org_id)
    if not tpl_ids:
        return {"trends": []}

    params: list = [list(tpl_ids)]
    date_clauses = ""
    if date_from:
        date_clauses += " AND submitted_at >= %s"
        params.append(date_from)
    if date_to:
        date_clauses += " AND submitted_at <= %s"
        params.append(date_to + "T23:59:59")
    if location_id:
        date_clauses += " AND location_id = %s"
        params.append(location_id)

    sql = f"""
        SELECT submitted_at, estimated_cost
        FROM form_submissions
        WHERE is_deleted = FALSE
          AND status = 'submitted'
          AND form_template_id = ANY(%s::uuid[])
          {date_clauses}
    """

    result_rows = rows(conn, sql, tuple(params))

    bucket_counts: dict = defaultdict(int)
    bucket_cost: dict = defaultdict(float)
    for r in result_rows:
        ts = r.get("submitted_at")
        if not ts:
            continue
        try:
            if hasattr(ts, "strftime"):
                d = ts if getattr(ts, "tzinfo", None) else ts.replace(tzinfo=timezone.utc)
            else:
                d = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if granularity == "month":
                key = d.strftime("%Y-%m")
            elif granularity == "week":
                key = d.strftime("%Y-W%W")
            else:
                key = d.strftime("%Y-%m-%d")
            bucket_counts[key] += 1
            ec = r.get("estimated_cost")
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
    conn=Depends(get_db),
):
    """Top pulled-out items by frequency and total cost."""
    org_id = _get_org(current_user)

    tpl_ids = _get_pullout_template_ids(conn, org_id)
    if not tpl_ids:
        return {"top_items": []}

    params: list = [list(tpl_ids)]
    date_clauses = ""
    if date_from:
        date_clauses += " AND fs.submitted_at >= %s"
        params.append(date_from)
    if date_to:
        date_clauses += " AND fs.submitted_at <= %s"
        params.append(date_to + "T23:59:59")
    if location_id:
        date_clauses += " AND fs.location_id = %s"
        params.append(location_id)

    sql = f"""
        SELECT fs.id, fs.estimated_cost, ff.label, fr.value
        FROM form_submissions fs
        LEFT JOIN form_responses fr ON fr.form_submission_id = fs.id
        LEFT JOIN form_fields ff ON ff.id = fr.form_field_id
        WHERE fs.is_deleted = FALSE
          AND fs.status = 'submitted'
          AND fs.form_template_id = ANY(%s::uuid[])
          {date_clauses}
    """

    result_rows = rows(conn, sql, tuple(params))

    # Collect item name and cost per submission
    submission_item: dict = {}
    submission_cost: dict = {}

    for r in result_rows:
        sid = r["id"]
        label = (r.get("label") or "").strip().lower()
        if label == "item name" and r.get("value"):
            submission_item[sid] = r["value"]
        if sid not in submission_cost:
            ec = r.get("estimated_cost")
            submission_cost[sid] = ec

    item_counts: dict = defaultdict(int)
    item_cost: dict = defaultdict(float)
    for sid, item_name in submission_item.items():
        item_counts[item_name] += 1
        ec = submission_cost.get(sid)
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
    conn=Depends(get_db),
):
    """
    Cost-based weekly anomaly detection per location.
    Compares current week's total estimated_cost against the 4-week rolling average.
    Flags locations where current week > 1.5× average.
    """
    org_id = _get_org(current_user)

    tpl_ids = _get_pullout_template_ids(conn, org_id)
    if not tpl_ids:
        return {"anomalies": [], "locations_checked": 0}

    now = datetime.now(timezone.utc)
    # Start of current week (Monday)
    current_week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    # 4 weeks back
    four_weeks_ago = current_week_start - timedelta(weeks=4)

    params: list = [list(tpl_ids), four_weeks_ago.isoformat()]
    location_clause = ""
    if location_id:
        location_clause = " AND location_id = %s"
        params.append(location_id)

    sql = f"""
        SELECT submitted_at, location_id, estimated_cost
        FROM form_submissions
        WHERE is_deleted = FALSE
          AND status = 'submitted'
          AND form_template_id = ANY(%s::uuid[])
          AND submitted_at >= %s
          {location_clause}
    """

    result_rows = rows(conn, sql, tuple(params))

    # loc_id → week_key → cumulative cost
    loc_weekly: dict = defaultdict(lambda: defaultdict(float))

    for r in result_rows:
        ts = r.get("submitted_at")
        loc = r.get("location_id") or "unknown"
        ec = r.get("estimated_cost") or 0
        if not ts:
            continue
        try:
            if hasattr(ts, "weekday"):
                d = ts if getattr(ts, "tzinfo", None) else ts.replace(tzinfo=timezone.utc)
            else:
                d = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
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


# ── Maintenance Issues Report ───────────────────────────────────────────────

@router.get("/maintenance-issues")
def get_maintenance_issues(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    """Maintenance costs report: issues where category.is_maintenance=true."""
    org_id = _get_org(current_user)

    # Get all maintenance category IDs for this org
    cat_rows = rows(conn, """
        SELECT id, name
        FROM issue_categories
        WHERE organisation_id = %s
          AND is_maintenance = TRUE
          AND is_deleted = FALSE
    """, (org_id,))

    maint_cat_ids = [r["id"] for r in cat_rows]
    cat_name_map = {r["id"]: r["name"] for r in cat_rows}

    if not maint_cat_ids:
        return {
            "summary": {"total_cost": 0, "open_count": 0, "resolved_count": 0, "avg_cost": 0, "total_count": 0},
            "by_location": [], "by_asset": [], "by_month": [], "issues": []
        }

    params: list = [org_id, list(maint_cat_ids)]
    extra_clauses = ""
    if location_id:
        extra_clauses += " AND i.location_id = %s"
        params.append(location_id)
    if date_from:
        extra_clauses += " AND i.created_at >= %s"
        params.append(date_from)
    if date_to:
        extra_clauses += " AND i.created_at <= %s"
        params.append(date_to + "T23:59:59")

    sql = f"""
        SELECT i.id, i.title, i.priority, i.status, i.cost,
               i.created_at, i.resolved_at, i.location_id, i.asset_id, i.category_id,
               l.name AS location_name,
               a.name AS asset_name
        FROM issues i
        LEFT JOIN locations l ON l.id = i.location_id
        LEFT JOIN assets a ON a.id = i.asset_id
        WHERE i.organisation_id = %s
          AND i.is_deleted = FALSE
          AND i.category_id = ANY(%s::uuid[])
          {extra_clauses}
        ORDER BY i.created_at DESC
    """

    issues = rows(conn, sql, tuple(params))

    # Summary
    total_cost = sum(float(i.get("cost") or 0) for i in issues if i.get("cost") is not None)
    open_statuses = {"open", "in_progress", "pending_vendor"}
    resolved_statuses = {"resolved", "closed", "verified_closed"}
    open_count = sum(1 for i in issues if i.get("status") in open_statuses)
    resolved_count = sum(1 for i in issues if i.get("status") in resolved_statuses)
    cost_issues = [i for i in issues if i.get("cost") is not None]
    avg_cost = round(total_cost / len(cost_issues), 2) if cost_issues else 0

    # By location
    loc_map: dict = {}
    for i in issues:
        loc_id = i.get("location_id") or "none"
        loc_name = i.get("location_name") or "Unknown"
        if loc_id not in loc_map:
            loc_map[loc_id] = {"location_name": loc_name, "total_cost": 0.0, "count": 0}
        loc_map[loc_id]["count"] += 1
        loc_map[loc_id]["total_cost"] += float(i.get("cost") or 0)
    by_location = sorted(loc_map.values(), key=lambda x: -x["total_cost"])

    # By asset
    asset_map: dict = {}
    for i in issues:
        asset_id = i.get("asset_id")
        if not asset_id:
            continue
        asset_name = i.get("asset_name") or "Unknown Asset"
        if asset_id not in asset_map:
            asset_map[asset_id] = {"asset_id": asset_id, "asset_name": asset_name, "total_cost": 0.0, "issue_count": 0}
        asset_map[asset_id]["issue_count"] += 1
        asset_map[asset_id]["total_cost"] += float(i.get("cost") or 0)
    by_asset = sorted(asset_map.values(), key=lambda x: -x["total_cost"])

    # By month
    month_map: dict = {}
    for i in issues:
        created_at = i.get("created_at")
        month = str(created_at)[:7] if created_at else ""  # YYYY-MM
        if not month:
            continue
        if month not in month_map:
            month_map[month] = {"month": month, "total_cost": 0.0, "count": 0}
        month_map[month]["count"] += 1
        month_map[month]["total_cost"] += float(i.get("cost") or 0)
    by_month = sorted(month_map.values(), key=lambda x: x["month"])

    # Issues list (flatten for table)
    issues_out = []
    for i in issues:
        issues_out.append({
            "id": i["id"],
            "title": i.get("title", ""),
            "priority": i.get("priority", ""),
            "status": i.get("status", ""),
            "cost": i.get("cost"),
            "created_at": str(i.get("created_at", "")),
            "resolved_at": str(i.get("resolved_at")) if i.get("resolved_at") else None,
            "location_name": i.get("location_name") or "",
            "asset_name": i.get("asset_name") or "",
            "category_name": cat_name_map.get(i.get("category_id", ""), ""),
        })

    return {
        "summary": {
            "total_cost": round(total_cost, 2),
            "open_count": open_count,
            "resolved_count": resolved_count,
            "avg_cost": avg_cost,
            "total_count": len(issues),
        },
        "by_location": by_location,
        "by_asset": by_asset,
        "by_month": by_month,
        "issues": issues_out,
    }


# ── Aging Analytics ────────────────────────────────────────────────────────

@router.get("/aging/tasks")
def get_aging_tasks(
    location_id: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    """Task aging report: open age, SLA breach counts, aging buckets."""
    org_id = _get_org(current_user)

    params: list = [org_id]
    extra_clauses = ""
    if location_id:
        extra_clauses += " AND t.location_id = %s"
        params.append(location_id)
    if priority:
        extra_clauses += " AND t.priority = %s"
        params.append(priority)
    if status:
        extra_clauses += " AND t.status = %s"
        params.append(status)
    if date_from:
        extra_clauses += " AND t.created_at >= %s"
        params.append(date_from)
    if date_to:
        extra_clauses += " AND t.created_at <= %s"
        params.append(date_to + "T23:59:59")

    sql = f"""
        SELECT t.id, t.title, t.priority, t.status,
               t.created_at, t.completed_at, t.location_id,
               l.name AS location_name
        FROM tasks t
        LEFT JOIN locations l ON l.id = t.location_id
        WHERE t.organisation_id = %s
          AND t.is_deleted = FALSE
          {extra_clauses}
    """

    tasks = rows(conn, sql, tuple(params))
    now = datetime.now(timezone.utc)

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
        loc_name = t.get("location_name") or "Unknown"
        created = t.get("created_at")
        completed = t.get("completed_at")

        try:
            if hasattr(created, "tzinfo"):
                created_dt = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
            else:
                created_dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue

        if s in closed_statuses and completed:
            try:
                if hasattr(completed, "tzinfo"):
                    end_dt = completed if completed.tzinfo else completed.replace(tzinfo=timezone.utc)
                else:
                    end_dt = datetime.fromisoformat(str(completed).replace("Z", "+00:00"))
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
    conn=Depends(get_db),
):
    """Issue aging report: open age, SLA breach counts from category sla_hours."""
    org_id = _get_org(current_user)

    params: list = [org_id]
    extra_clauses = ""
    if location_id:
        extra_clauses += " AND i.location_id = %s"
        params.append(location_id)
    if category_id:
        extra_clauses += " AND i.category_id = %s"
        params.append(category_id)
    if priority:
        extra_clauses += " AND i.priority = %s"
        params.append(priority)
    if status:
        extra_clauses += " AND i.status = %s"
        params.append(status)
    if date_from:
        extra_clauses += " AND i.created_at >= %s"
        params.append(date_from)
    if date_to:
        extra_clauses += " AND i.created_at <= %s"
        params.append(date_to + "T23:59:59")

    sql = f"""
        SELECT i.id, i.title, i.priority, i.status,
               i.created_at, i.resolved_at, i.location_id, i.category_id,
               l.name AS location_name,
               ic.name AS category_name,
               ic.sla_hours
        FROM issues i
        LEFT JOIN locations l ON l.id = i.location_id
        LEFT JOIN issue_categories ic ON ic.id = i.category_id
        WHERE i.organisation_id = %s
          AND i.is_deleted = FALSE
          {extra_clauses}
    """

    issues = rows(conn, sql, tuple(params))
    now = datetime.now(timezone.utc)

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
        loc_name = issue.get("location_name") or "Unknown"
        cat_id = issue.get("category_id") or "unknown"
        cat_name = issue.get("category_name") or "Unknown"
        sla_h = issue.get("sla_hours") or 24
        created = issue.get("created_at")
        resolved = issue.get("resolved_at")

        try:
            if hasattr(created, "tzinfo"):
                created_dt = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
            else:
                created_dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue

        if s in closed_statuses and resolved:
            try:
                if hasattr(resolved, "tzinfo"):
                    end_dt = resolved if resolved.tzinfo else resolved.replace(tzinfo=timezone.utc)
                else:
                    end_dt = datetime.fromisoformat(str(resolved).replace("Z", "+00:00"))
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
    conn=Depends(get_db),
):
    """Average and median resolution time for completed tasks or resolved issues."""
    org_id = _get_org(current_user)

    params: list = [org_id]
    extra_clauses = ""
    if location_id:
        extra_clauses += " AND t.location_id = %s"
        params.append(location_id)
    if date_from:
        extra_clauses += " AND t.created_at >= %s"
        params.append(date_from)
    if date_to:
        extra_clauses += " AND t.created_at <= %s"
        params.append(date_to + "T23:59:59")

    if entity_type == "task":
        sql = f"""
            SELECT t.created_at, t.completed_at AS end_at, t.location_id, l.name AS location_name
            FROM tasks t
            LEFT JOIN locations l ON l.id = t.location_id
            WHERE t.organisation_id = %s
              AND t.is_deleted = FALSE
              AND t.status IN ('completed', 'cancelled')
              {extra_clauses}
        """
    else:
        sql = f"""
            SELECT t.created_at, t.resolved_at AS end_at, t.location_id, l.name AS location_name
            FROM issues t
            LEFT JOIN locations l ON l.id = t.location_id
            WHERE t.organisation_id = %s
              AND t.is_deleted = FALSE
              AND t.status IN ('resolved', 'closed')
              AND t.resolved_at IS NOT NULL
              {extra_clauses}
        """

    result_rows = rows(conn, sql, tuple(params))

    resolution_hours: list = []
    period_map: dict = defaultdict(list)
    loc_map: dict = defaultdict(list)

    for r in result_rows:
        created = r.get("created_at")
        ended = r.get("end_at")
        if not created or not ended:
            continue
        try:
            if hasattr(created, "tzinfo"):
                c_dt = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
            else:
                c_dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
            if hasattr(ended, "tzinfo"):
                e_dt = ended if ended.tzinfo else ended.replace(tzinfo=timezone.utc)
            else:
                e_dt = datetime.fromisoformat(str(ended).replace("Z", "+00:00"))
            h = (e_dt - c_dt).total_seconds() / 3600
            if h < 0:
                continue
        except (ValueError, AttributeError):
            continue

        resolution_hours.append(h)
        period_key = c_dt.strftime("%Y-%m")
        period_map[period_key].append(h)

        loc_id = r.get("location_id") or "unknown"
        loc_name = r.get("location_name") or "Unknown"
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
    conn=Depends(get_db),
):
    """Certification expiry report: per-enrollment validity, summary, by-location and by-course breakdowns."""
    org_id = _get_org(current_user)

    location_clause = ""
    params: list = [org_id]
    if location_id:
        location_clause = " AND p.location_id = %s"
        params.append(location_id)

    sql = f"""
        SELECT ce.id, ce.user_id, ce.course_id, ce.status,
               ce.cert_issued_at, ce.cert_expires_at,
               c.title AS course_title,
               c.cert_validity_days,
               p.full_name, p.location_id AS user_location_id, p.role
        FROM course_enrollments ce
        JOIN courses c ON c.id = ce.course_id
        JOIN profiles p ON p.id = ce.user_id
        WHERE ce.organisation_id = %s
          AND ce.status = 'passed'
          AND ce.cert_expires_at IS NOT NULL
          {location_clause}
    """

    enrollment_rows = rows(conn, sql, tuple(params))

    # Fetch location names
    loc_name_rows = rows(conn, """
        SELECT id, name FROM locations WHERE organisation_id = %s
    """, (org_id,))
    loc_name_map: dict = {r["id"]: r["name"] for r in loc_name_rows}

    today = date.today()

    enrollments_out = []
    by_location: dict = {}
    by_course: dict = {}

    total_certified = 0
    expiring_soon = 0
    expired = 0
    valid = 0

    for r in enrollment_rows:
        full_name = r.get("full_name") or "Unknown"
        user_loc_id = r.get("user_location_id") or ""
        location_name = loc_name_map.get(user_loc_id, "Unknown") if user_loc_id else "Unknown"

        course_id = r.get("course_id") or ""
        course_title = r.get("course_title") or "Unknown Course"

        cert_expires_raw = r.get("cert_expires_at")
        cert_issued_raw = r.get("cert_issued_at")

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
            "user_id": r.get("user_id") or "",
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


# ── Issues by Category ────────────────────────────────────────────────────────

@router.get("/issues/by-category")
def get_issues_by_category(
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    location_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    """Issue volume grouped by category for the given date range."""
    org_id = _get_org(current_user)

    if not to_date:
        to_date = datetime.now(timezone.utc).date().isoformat()
    if not from_date:
        from_date = (datetime.fromisoformat(to_date) - timedelta(days=30)).date().isoformat()

    params: list = [org_id, from_date, to_date + "T23:59:59Z"]
    location_clause = ""
    if location_id:
        location_clause = " AND i.location_id = %s"
        params.append(location_id)

    sql = f"""
        SELECT i.id, i.category_id, ic.name AS category_name
        FROM issues i
        LEFT JOIN issue_categories ic ON ic.id = i.category_id
        WHERE i.organisation_id = %s
          AND i.is_deleted = FALSE
          AND i.created_at >= %s
          AND i.created_at <= %s
          {location_clause}
    """

    result_rows = rows(conn, sql, tuple(params))

    counts: dict[str, int] = {}
    for r in result_rows:
        name = r.get("category_name") or "Uncategorised"
        counts[name] = counts.get(name, 0) + 1

    return sorted(
        [{"category": k, "count": v} for k, v in counts.items()],
        key=lambda x: -x["count"],
    )


# ── Issue Resolution Time by Category ────────────────────────────────────────

@router.get("/issues/resolution-time")
def get_issue_resolution_time(
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    location_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    """Average resolution time vs SLA per issue category."""
    org_id = _get_org(current_user)

    if not to_date:
        to_date = datetime.now(timezone.utc).date().isoformat()
    if not from_date:
        from_date = (datetime.fromisoformat(to_date) - timedelta(days=90)).date().isoformat()

    params: list = [org_id, from_date, to_date + "T23:59:59Z"]
    location_clause = ""
    if location_id:
        location_clause = " AND i.location_id = %s"
        params.append(location_id)

    sql = f"""
        SELECT i.created_at, i.resolved_at, i.category_id,
               ic.name AS category_name, ic.sla_hours
        FROM issues i
        LEFT JOIN issue_categories ic ON ic.id = i.category_id
        WHERE i.organisation_id = %s
          AND i.is_deleted = FALSE
          AND i.status IN ('resolved', 'verified_closed')
          AND i.resolved_at IS NOT NULL
          AND i.created_at >= %s
          AND i.created_at <= %s
          {location_clause}
    """

    result_rows = rows(conn, sql, tuple(params))

    cat_data: dict[str, dict] = {}
    for r in result_rows:
        name = r.get("category_name") or "Uncategorised"
        sla = r.get("sla_hours") or 24
        created = r.get("created_at")
        resolved = r.get("resolved_at")
        try:
            if hasattr(created, "tzinfo"):
                c = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
            else:
                c = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
            if hasattr(resolved, "tzinfo"):
                res = resolved if resolved.tzinfo else resolved.replace(tzinfo=timezone.utc)
            else:
                res = datetime.fromisoformat(str(resolved).replace("Z", "+00:00"))
            hrs = (res - c).total_seconds() / 3600
        except Exception:
            continue
        if name not in cat_data:
            cat_data[name] = {"total_hrs": 0.0, "count": 0, "sla_hrs": sla}
        cat_data[name]["total_hrs"] += hrs
        cat_data[name]["count"] += 1

    return sorted(
        [
            {
                "category": name,
                "actual_hrs": round(d["total_hrs"] / d["count"], 1),
                "sla_hrs": d["sla_hrs"],
                "sample_count": d["count"],
            }
            for name, d in cat_data.items()
        ],
        key=lambda x: -x["actual_hrs"],
    )[:8]


# ── Location Composite Scorecard ──────────────────────────────────────────────

@router.get("/locations/scorecard")
def get_location_scorecard(
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    """Composite score per location: 50% audit avg score + 30% checklist completion + 20% issue resolution rate."""
    org_id = _get_org(current_user)

    if not to_date:
        to_date = datetime.now(timezone.utc).date().isoformat()
    if not from_date:
        from_date = (datetime.fromisoformat(to_date) - timedelta(days=30)).date().isoformat()

    loc_rows = rows(conn, """
        SELECT id, name
        FROM locations
        WHERE organisation_id = %s
          AND is_active = TRUE
          AND is_deleted = FALSE
    """, (org_id,))

    if not loc_rows:
        return []
    loc_map = {r["id"]: r["name"] for r in loc_rows}

    # ── Audit avg score per location ─────────────────────────────────────────
    audit_rows = rows(conn, """
        SELECT fs.location_id, fs.overall_score
        FROM form_submissions fs
        JOIN form_templates ft ON ft.id = fs.form_template_id
        WHERE ft.organisation_id = %s
          AND ft.type = 'audit'
          AND fs.submitted_at >= %s
          AND fs.submitted_at <= %s
    """, (org_id, from_date, to_date + "T23:59:59Z"))

    audit_scores: dict[str, list] = {}
    for r in audit_rows:
        lid = r.get("location_id") or ""
        if r.get("overall_score") is not None:
            audit_scores.setdefault(lid, []).append(float(r["overall_score"]))

    # ── Checklist completion rate per location ────────────────────────────────
    cl_done_rows = rows(conn, """
        SELECT fs.location_id
        FROM form_submissions fs
        JOIN form_templates ft ON ft.id = fs.form_template_id
        WHERE ft.organisation_id = %s
          AND ft.type = 'checklist'
          AND fs.status IN ('submitted', 'approved', 'rejected')
          AND fs.submitted_at >= %s
          AND fs.submitted_at <= %s
    """, (org_id, from_date, to_date + "T23:59:59Z"))

    assign_rows = rows(conn, """
        SELECT assigned_to_location_id
        FROM form_assignments
        WHERE organisation_id = %s
          AND is_active = TRUE
          AND is_deleted = FALSE
    """, (org_id,))

    cl_done: dict[str, int] = {}
    for r in cl_done_rows:
        lid = r.get("location_id") or ""
        cl_done[lid] = cl_done.get(lid, 0) + 1
    cl_assigned: dict[str, int] = {}
    for r in assign_rows:
        lid = r.get("assigned_to_location_id") or ""
        cl_assigned[lid] = cl_assigned.get(lid, 0) + 1

    # ── Issue resolution rate per location ────────────────────────────────────
    iss_rows = rows(conn, """
        SELECT location_id, status
        FROM issues
        WHERE organisation_id = %s
          AND is_deleted = FALSE
          AND created_at >= %s
          AND created_at <= %s
    """, (org_id, from_date, to_date + "T23:59:59Z"))

    iss_total: dict[str, int] = {}
    iss_resolved: dict[str, int] = {}
    for r in iss_rows:
        lid = r.get("location_id") or ""
        iss_total[lid] = iss_total.get(lid, 0) + 1
        if r.get("status") in ("resolved", "verified_closed"):
            iss_resolved[lid] = iss_resolved.get(lid, 0) + 1

    # ── Composite ─────────────────────────────────────────────────────────────
    results = []
    for lid, name in loc_map.items():
        audit_avg = (sum(audit_scores.get(lid, [])) / len(audit_scores[lid])) if audit_scores.get(lid) else None
        cl_rate = (cl_done.get(lid, 0) / cl_assigned[lid] * 100) if cl_assigned.get(lid) else None
        iss_rate = (iss_resolved.get(lid, 0) / iss_total[lid] * 100) if iss_total.get(lid) else None

        components = [(v, w) for v, w in [(audit_avg, 0.5), (cl_rate, 0.3), (iss_rate, 0.2)] if v is not None]
        if not components:
            continue
        weight_sum = sum(w for _, w in components)
        composite = sum(v * w for v, w in components) / weight_sum
        results.append({"location": name, "composite_score": round(composite)})

    return sorted(results, key=lambda x: -x["composite_score"])
