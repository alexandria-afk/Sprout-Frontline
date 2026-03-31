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


# ── Pull-Out / Wastage Reports ─────────────────────────────────────────────

@router.get("/pull-outs/summary")
def get_pullout_summary(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    """Total pull-out count, total quantity, and breakdown by reason."""
    org_id = _get_org(current_user)
    db = get_admin_client()

    q = (
        db.table("form_submissions")
        .select("id, submitted_at, location_id, form_data")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
    )
    # join on form_templates type = pull_out via form_template_id
    # We filter by form type by checking the template; use a subquery approach:
    # First get pull_out template ids for this org
    tpl_res = (
        db.table("form_templates")
        .select("id")
        .eq("organisation_id", org_id)
        .eq("type", "pull_out")
        .eq("is_deleted", False)
        .execute()
    )
    tpl_ids = [r["id"] for r in (tpl_res.data or [])]
    if not tpl_ids:
        return {"total_submissions": 0, "total_quantity": 0, "by_reason": [], "by_category": []}

    q = q.in_("form_template_id", tpl_ids)
    if date_from:
        q = q.gte("submitted_at", date_from)
    if date_to:
        q = q.lte("submitted_at", date_to + "T23:59:59")
    if location_id:
        q = q.eq("location_id", location_id)

    res = q.execute()
    submissions = res.data or []

    total_qty = 0
    reason_counts: dict = {}
    category_counts: dict = {}

    for sub in submissions:
        fd = sub.get("form_data") or {}
        # form_data is a dict of field_id -> value
        # We look for fields by scanning values heuristically
        # Fields: f5=quantity, f7=reason, f3=category
        qty = fd.get("f5") or fd.get("quantity") or 0
        try:
            total_qty += float(qty)
        except (ValueError, TypeError):
            pass
        reason = fd.get("f7") or fd.get("reason") or "Unknown"
        reason_counts[reason] = reason_counts.get(reason, 0) + 1
        category = fd.get("f3") or fd.get("category") or "Unknown"
        category_counts[category] = category_counts.get(category, 0) + 1

    return {
        "total_submissions": len(submissions),
        "total_quantity": round(total_qty, 2),
        "by_reason": [{"reason": k, "count": v} for k, v in sorted(reason_counts.items(), key=lambda x: -x[1])],
        "by_category": [{"category": k, "count": v} for k, v in sorted(category_counts.items(), key=lambda x: -x[1])],
    }


@router.get("/pull-outs/trends")
def get_pullout_trends(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    granularity: str = Query("day"),  # "day" | "week" | "month"
    current_user: dict = Depends(require_manager_or_above),
):
    """Daily/weekly/monthly pull-out submission counts."""
    org_id = _get_org(current_user)
    db = get_admin_client()

    tpl_res = (
        db.table("form_templates")
        .select("id")
        .eq("organisation_id", org_id)
        .eq("type", "pull_out")
        .eq("is_deleted", False)
        .execute()
    )
    tpl_ids = [r["id"] for r in (tpl_res.data or [])]
    if not tpl_ids:
        return {"trends": []}

    q = (
        db.table("form_submissions")
        .select("submitted_at")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .in_("form_template_id", tpl_ids)
    )
    if date_from:
        q = q.gte("submitted_at", date_from)
    if date_to:
        q = q.lte("submitted_at", date_to + "T23:59:59")
    if location_id:
        q = q.eq("location_id", location_id)

    res = q.execute()
    submissions = res.data or []

    from collections import defaultdict

    bucket_counts: dict = defaultdict(int)
    for sub in submissions:
        ts = sub.get("submitted_at", "")
        if not ts:
            continue
        try:
            d = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            if granularity == "month":
                key = d.strftime("%Y-%m")
            elif granularity == "week":
                key = d.strftime("%Y-W%W")
            else:
                key = d.strftime("%Y-%m-%d")
            bucket_counts[key] += 1
        except ValueError:
            pass

    trends = [{"period": k, "count": v} for k, v in sorted(bucket_counts.items())]
    return {"trends": trends}


@router.get("/pull-outs/top-items")
def get_pullout_top_items(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    limit: int = Query(10),
    current_user: dict = Depends(require_manager_or_above),
):
    """Top pulled-out items by frequency."""
    org_id = _get_org(current_user)
    db = get_admin_client()

    tpl_res = (
        db.table("form_templates")
        .select("id")
        .eq("organisation_id", org_id)
        .eq("type", "pull_out")
        .eq("is_deleted", False)
        .execute()
    )
    tpl_ids = [r["id"] for r in (tpl_res.data or [])]
    if not tpl_ids:
        return {"top_items": []}

    q = (
        db.table("form_submissions")
        .select("form_data")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .in_("form_template_id", tpl_ids)
    )
    if date_from:
        q = q.gte("submitted_at", date_from)
    if date_to:
        q = q.lte("submitted_at", date_to + "T23:59:59")
    if location_id:
        q = q.eq("location_id", location_id)

    res = q.execute()
    submissions = res.data or []

    from collections import defaultdict

    item_counts: dict = defaultdict(int)
    item_qty: dict = defaultdict(float)

    for sub in submissions:
        fd = sub.get("form_data") or {}
        item = fd.get("f4") or fd.get("item_name") or "Unknown"
        qty = fd.get("f5") or fd.get("quantity") or 0
        item_counts[item] += 1
        try:
            item_qty[item] += float(qty)
        except (ValueError, TypeError):
            pass

    top = sorted(item_counts.items(), key=lambda x: -x[1])[:limit]
    return {
        "top_items": [
            {"item": k, "count": v, "total_quantity": round(item_qty[k], 2)}
            for k, v in top
        ]
    }


@router.get("/pull-outs/anomalies")
def get_pullout_anomalies(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    """Flag days where pull-out count exceeds 2x the rolling average (simple spike detection)."""
    org_id = _get_org(current_user)
    db = get_admin_client()

    tpl_res = (
        db.table("form_templates")
        .select("id")
        .eq("organisation_id", org_id)
        .eq("type", "pull_out")
        .eq("is_deleted", False)
        .execute()
    )
    tpl_ids = [r["id"] for r in (tpl_res.data or [])]
    if not tpl_ids:
        return {"anomalies": []}

    q = (
        db.table("form_submissions")
        .select("submitted_at, form_data")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .in_("form_template_id", tpl_ids)
    )
    if date_from:
        q = q.gte("submitted_at", date_from)
    if date_to:
        q = q.lte("submitted_at", date_to + "T23:59:59")
    if location_id:
        q = q.eq("location_id", location_id)

    res = q.execute()
    submissions = res.data or []

    from collections import defaultdict, Counter

    day_counts: dict = defaultdict(int)
    day_items: dict = defaultdict(list)

    for sub in submissions:
        ts = sub.get("submitted_at", "")
        if not ts:
            continue
        try:
            d = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            key = d.strftime("%Y-%m-%d")
            day_counts[key] += 1
            fd = sub.get("form_data") or {}
            item = fd.get("f4") or fd.get("item_name") or "Unknown"
            day_items[key].append(item)
        except ValueError:
            pass

    if not day_counts:
        return {"anomalies": [], "average_daily": 0}

    counts = list(day_counts.values())
    avg = sum(counts) / len(counts)
    threshold = avg * 2 if avg > 0 else 1

    anomalies = []
    for day, cnt in sorted(day_counts.items()):
        if cnt >= threshold:
            top_items = [item for item, _ in Counter(day_items[day]).most_common(3)]
            anomalies.append({
                "date": day,
                "count": cnt,
                "average": round(avg, 1),
                "top_items": top_items,
            })

    return {"anomalies": anomalies, "average_daily": round(avg, 1)}
