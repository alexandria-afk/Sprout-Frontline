"""
AI Insights routes — daily operational snapshot + Claude-powered insight generation.

Endpoints:
  GET /api/v1/ai/daily-snapshot        Pure SQL aggregation, cached per org per day
  GET /api/v1/ai/dashboard-insights    Calls snapshot → Claude → returns brief + insight cards
"""

import asyncio
import json
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Query

from config import settings
from dependencies import get_current_user, require_manager_or_above
from services.ai_logger import AITimer, log_ai_request
from services.industry_context import get_industry_context
from services.supabase_client import get_supabase

router = APIRouter()

# ── In-memory daily cache ─────────────────────────────────────────────────────
# Stores (date_str, data) so entries auto-expire when the date changes.

_snapshot_cache: dict[str, tuple[str, dict]] = {}
_insights_cache: dict[str, tuple[str, dict]] = {}


def _today() -> date:
    return date.today()


def _today_str() -> str:
    return _today().isoformat()


def _cache_get(store: dict, key: str) -> dict | None:
    entry = store.get(key)
    if not entry:
        return None
    stored_date, data = entry
    if stored_date != _today_str():
        store.pop(key, None)
        return None
    return data


def _cache_set(store: dict, key: str, data: dict) -> None:
    store[key] = (_today_str(), data)


# ── Shared Claude client ──────────────────────────────────────────────────────

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        api_key = settings.anthropic_api_key
        if not api_key:
            raise HTTPException(
                status_code=503,
                detail="ANTHROPIC_API_KEY is not configured.",
            )
        _client = anthropic.Anthropic(api_key=api_key)
    return _client


async def _call_claude(system_prompt: str, user_message: str, max_tokens: int = 2048) -> str:
    """Call Claude with retry. Returns stripped text."""
    client = _get_client()

    def _sync():
        return client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )

    for attempt in range(3):
        try:
            response = await asyncio.to_thread(_sync)
            break
        except anthropic.AuthenticationError:
            raise HTTPException(status_code=503, detail="Invalid ANTHROPIC_API_KEY.")
        except anthropic.RateLimitError:
            raise HTTPException(status_code=429, detail="AI rate limit reached.")
        except anthropic.APIStatusError as e:
            if e.status_code == 529 and attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            raise HTTPException(status_code=502, detail=f"AI service error: {e.message}")
        except anthropic.APIError as e:
            raise HTTPException(status_code=502, detail=f"AI service error: {e}")

    text = "".join(b.text for b in response.content if hasattr(b, "text")).strip()
    if not text:
        raise HTTPException(status_code=502, detail="AI returned an empty response.")

    # Strip accidental markdown fences
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        if "```" in text:
            text = text.rsplit("```", 1)[0]
        text = text.strip()

    return text


# ── Snapshot builder ──────────────────────────────────────────────────────────

def _build_snapshot(org_id: str) -> dict:
    """Gather all operational data for the org. Runs synchronously."""
    sb = get_supabase()
    today = _today()
    today_dt = datetime.combine(today, datetime.min.time())

    # Week boundaries (Monday-based)
    week_day = today.weekday()  # Mon=0
    week_start = today - timedelta(days=week_day)
    last_week_start = week_start - timedelta(days=7)
    last_week_end = week_start - timedelta(days=1)
    four_weeks_ago = today - timedelta(days=28)
    thirty_days_ago = today - timedelta(days=30)
    seven_days_ago = today - timedelta(days=7)

    # Month boundaries
    month_start = today.replace(day=1)
    if month_start.month == 1:
        last_month_start = month_start.replace(year=month_start.year - 1, month=12)
    else:
        last_month_start = month_start.replace(month=month_start.month - 1)
    last_month_end = month_start - timedelta(days=1)

    # Date strings
    ws = week_start.isoformat()
    lws = last_week_start.isoformat()
    lwe = last_week_end.isoformat()
    fwa = four_weeks_ago.isoformat()
    tda = thirty_days_ago.isoformat()
    sda = seven_days_ago.isoformat()
    ms = month_start.isoformat()
    lms = last_month_start.isoformat()
    lme = last_month_end.isoformat()
    tod = today.isoformat()

    snapshot: dict = {"generated_at": datetime.now(timezone.utc).isoformat()}

    # ── Locations ─────────────────────────────────────────────────────────────
    try:
        loc_resp = (
            sb.table("locations")
            .select("id,name")
            .eq("organisation_id", org_id)
            .eq("is_active", True)
            .eq("is_deleted", False)
            .execute()
        )
        locations = loc_resp.data or []
        loc_map = {l["id"]: l["name"] for l in locations}
        snapshot["org"] = {
            "location_count": len(locations),
            "locations": [l["name"] for l in locations],
            "loc_id_to_name": loc_map,
        }
    except Exception:
        locations = []
        loc_map = {}
        snapshot["org"] = {"location_count": 0, "locations": [], "loc_id_to_name": {}}

    # ── Training & Certifications ─────────────────────────────────────────────
    try:
        # Certifications expiring soon — from course_enrollments.cert_expires_at
        enroll_resp = (
            sb.table("course_enrollments")
            .select("user_id,status,cert_expires_at,cert_issued_at,courses!inner(organisation_id,is_mandatory,title)")
            .eq("courses.organisation_id", org_id)
            .eq("status", "passed")
            .not_.is_("cert_expires_at", "null")
            .execute()
        )
        enrollments_cert = enroll_resp.data or []

        # Profile → location mapping
        all_user_ids_cert = list({e["user_id"] for e in enrollments_cert if e.get("user_id")})
        user_loc_map: dict[str, str] = {}
        if all_user_ids_cert:
            prof_resp = (
                sb.table("profiles")
                .select("id,location_id,created_at")
                .in_("id", all_user_ids_cert)
                .eq("organisation_id", org_id)
                .eq("is_deleted", False)
                .execute()
            )
            for p in (prof_resp.data or []):
                user_loc_map[p["id"]] = p.get("location_id") or ""

        exp_7: dict[str, int] = {}   # loc_id → count
        exp_14: dict[str, int] = {}
        exp_30: dict[str, int] = {}

        for e in enrollments_cert:
            exp_str = e.get("cert_expires_at", "")
            if not exp_str:
                continue
            try:
                exp_date = datetime.fromisoformat(exp_str.replace("Z", "+00:00")).date()
            except Exception:
                continue
            days_left = (exp_date - today).days
            if days_left < 0:
                continue
            lid = user_loc_map.get(e["user_id"], "")
            if days_left <= 7:
                exp_7[lid] = exp_7.get(lid, 0) + 1
            if days_left <= 14:
                exp_14[lid] = exp_14.get(lid, 0) + 1
            if days_left <= 30:
                exp_30[lid] = exp_30.get(lid, 0) + 1

        # All enrollments for completion rates
        all_enroll_resp = (
            sb.table("course_enrollments")
            .select("user_id,status,courses!inner(organisation_id,is_mandatory)")
            .eq("courses.organisation_id", org_id)
            .execute()
        )
        all_enrollments = all_enroll_resp.data or []

        # Overdue (not completed, has a deadline — using course deadline concept)
        # Since courses don't have explicit enrollment deadlines in schema,
        # we approximate: mandatory courses not started/in_progress for > 14 days
        overdue_enroll = sum(
            1 for e in all_enrollments
            if e.get("status") in ("not_started", "in_progress")
            and (e.get("courses") or {}).get("is_mandatory")
        )

        # Per-location completion (passed / total enrolled)
        loc_enroll: dict[str, dict] = {}
        for e in all_enrollments:
            uid = e.get("user_id", "")
            lid = user_loc_map.get(uid, "unknown")
            if lid not in loc_enroll:
                loc_enroll[lid] = {"total": 0, "passed": 0}
            loc_enroll[lid]["total"] += 1
            if e.get("status") == "passed":
                loc_enroll[lid]["passed"] += 1

        training_completion_by_loc = [
            {
                "location": loc_map.get(lid, lid),
                "completion_rate": round(v["passed"] / v["total"] * 100) if v["total"] else 0,
            }
            for lid, v in loc_enroll.items() if lid and lid != "unknown"
        ]

        # New hires with incomplete required training (joined in last 30 days)
        new_hire_ids: set[str] = set()
        if all_user_ids_cert:
            nh_resp = (
                sb.table("profiles")
                .select("id")
                .eq("organisation_id", org_id)
                .eq("is_deleted", False)
                .gte("created_at", f"{tda}T00:00:00")
                .execute()
            )
            new_hire_ids = {p["id"] for p in (nh_resp.data or [])}

        new_hire_incomplete = sum(
            1 for e in all_enrollments
            if e.get("user_id") in new_hire_ids
            and e.get("status") in ("not_started", "in_progress")
            and (e.get("courses") or {}).get("is_mandatory")
        )

        snapshot["certifications"] = {
            "expiring_7d_by_location": [
                {"location": loc_map.get(lid, lid), "count": cnt}
                for lid, cnt in exp_7.items()
            ],
            "expiring_14d_by_location": [
                {"location": loc_map.get(lid, lid), "count": cnt}
                for lid, cnt in exp_14.items()
            ],
            "expiring_30d_total": sum(exp_30.values()),
            "completion_by_location": training_completion_by_loc,
            "overdue_mandatory_enrollments": overdue_enroll,
            "new_hires_incomplete_required": new_hire_incomplete,
        }
    except Exception as ex:
        snapshot["certifications"] = {"error": str(ex)}

    # ── Issues ────────────────────────────────────────────────────────────────
    try:
        issues_resp = (
            sb.table("issues")
            .select("id,category_id,location_id,status,priority,created_at,resolved_at,cost,issue_categories(name,sla_hours,is_maintenance)")
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .gte("created_at", f"{fwa}T00:00:00")
            .execute()
        )
        issues_all = issues_resp.data or []

        # Resolution time per category (last 4 weeks, resolved only)
        cat_res: dict[str, list[float]] = {}
        cat_sla: dict[str, int] = {}
        weekly_sla_breaches: dict[str, list[bool]] = {}  # cat → [week0, week1, week2, week3]

        for issue in issues_all:
            cat = (issue.get("issue_categories") or {}).get("name", "Unknown")
            sla = (issue.get("issue_categories") or {}).get("sla_hours", 24) or 24
            cat_sla[cat] = sla

            if issue.get("resolved_at") and issue.get("created_at"):
                try:
                    c = datetime.fromisoformat(issue["created_at"].replace("Z", "+00:00"))
                    r = datetime.fromisoformat(issue["resolved_at"].replace("Z", "+00:00"))
                    hrs = (r - c).total_seconds() / 3600
                    cat_res.setdefault(cat, []).append(hrs)
                except Exception:
                    pass

        by_category_resolution = [
            {
                "category": cat,
                "avg_resolution_hours": round(sum(times) / len(times), 1),
                "sla_hours": cat_sla.get(cat, 24),
                "sla_ratio": round(sum(times) / len(times) / cat_sla.get(cat, 24), 2),
                "sample_count": len(times),
            }
            for cat, times in cat_res.items()
        ]

        # Chronic SLA breaches: cat where avg > 2x SLA for the full 4-week window
        chronic_sla = [
            row for row in by_category_resolution
            if row["sla_ratio"] >= 2.0 and row["sample_count"] >= 3
        ]

        # Recurring: same category+location appearing 3+ times in 30 days
        recurring_key: dict[tuple, int] = {}
        for issue in issues_all:
            cat = (issue.get("issue_categories") or {}).get("name", "Unknown")
            lid = issue.get("location_id", "")
            key = (cat, lid)
            recurring_key[key] = recurring_key.get(key, 0) + 1

        recurring = [
            {"category": k[0], "location": loc_map.get(k[1], k[1]), "count": v}
            for k, v in recurring_key.items() if v >= 3
        ]

        # SLA breach count this/last week
        def _issue_breached(issue: dict) -> bool:
            sla = (issue.get("issue_categories") or {}).get("sla_hours", 24) or 24
            ca = issue.get("created_at", "")
            ra = issue.get("resolved_at")
            if not ca:
                return False
            try:
                c = datetime.fromisoformat(ca.replace("Z", "+00:00"))
                end = datetime.fromisoformat(ra.replace("Z", "+00:00")) if ra else datetime.now(timezone.utc)
                return (end - c).total_seconds() / 3600 > sla
            except Exception:
                return False

        sla_breach_this_week = sum(
            1 for i in issues_all
            if i.get("created_at", "") >= f"{ws}T00:00:00" and _issue_breached(i)
        )
        sla_breach_last_week = sum(
            1 for i in issues_all
            if f"{lws}T00:00:00" <= i.get("created_at", "") < f"{ws}T00:00:00" and _issue_breached(i)
        )

        snapshot["issues"] = {
            "by_category_resolution": sorted(by_category_resolution, key=lambda x: -x["sla_ratio"]),
            "chronic_sla_categories": chronic_sla,
            "recurring_issues": recurring,
            "sla_breach_this_week": sla_breach_this_week,
            "sla_breach_last_week": sla_breach_last_week,
        }
    except Exception as ex:
        snapshot["issues"] = {"error": str(ex)}

    # ── Audits & CAPs ─────────────────────────────────────────────────────────
    try:
        audit_resp = (
            sb.table("form_submissions")
            .select("id,location_id,overall_score,passed,submitted_at,form_templates!inner(organisation_id,type)")
            .eq("form_templates.organisation_id", org_id)
            .eq("form_templates.type", "audit")
            .in_("status", ["submitted", "approved", "rejected"])
            .gte("submitted_at", f"{fwa}T00:00:00")
            .execute()
        )
        audits = audit_resp.data or []

        # Per-location weekly avg score (4 weeks)
        loc_weekly_scores: dict[str, dict[int, list[float]]] = {}
        for a in audits:
            lid = a.get("location_id", "")
            score = a.get("overall_score")
            if score is None:
                continue
            try:
                sub_date = datetime.fromisoformat(a["submitted_at"].replace("Z", "+00:00")).date()
                days_ago = (today - sub_date).days
                week_num = min(days_ago // 7, 3)  # 0=most recent, 3=oldest
            except Exception:
                continue
            loc_weekly_scores.setdefault(lid, {}).setdefault(week_num, []).append(float(score))

        audit_by_location_weekly = []
        for lid, weeks in loc_weekly_scores.items():
            weekly_avgs = [
                round(sum(weeks.get(w, [])) / len(weeks[w]), 1) if weeks.get(w) else None
                for w in range(4)
            ]
            # Declining: last 3 non-null weeks each lower than previous
            non_null = [(i, v) for i, v in enumerate(weekly_avgs) if v is not None]
            declining = (
                len(non_null) >= 3
                and all(non_null[i][1] < non_null[i - 1][1] for i in range(1, min(3, len(non_null))))
            )
            audit_by_location_weekly.append({
                "location": loc_map.get(lid, lid),
                "weekly_avg_scores": weekly_avgs,  # index 0 = most recent week
                "declining_3_consecutive_weeks": declining,
            })

        declining_audit_locations = [r["location"] for r in audit_by_location_weekly if r["declining_3_consecutive_weeks"]]

        # Failed audits this week
        failed_this_week = sum(
            1 for a in audits
            if a.get("submitted_at", "") >= f"{ws}T00:00:00" and a.get("passed") is False
        )

        # Pending CAPs
        caps_resp = (
            sb.table("corrective_action_plans")
            .select("id,created_at,organisation_id")
            .eq("organisation_id", org_id)
            .eq("status", "pending_review")
            .execute()
        )
        caps = caps_resp.data or []
        pending_caps = [
            {
                "age_days": (today - datetime.fromisoformat(c["created_at"].replace("Z", "+00:00")).date()).days
                if c.get("created_at") else 0
            }
            for c in caps
        ]

        snapshot["audits"] = {
            "by_location_weekly": audit_by_location_weekly,
            "declining_locations": declining_audit_locations,
            "unreviewed_caps_count": len(pending_caps),
            "unreviewed_caps_oldest_days": max((c["age_days"] for c in pending_caps), default=0),
            "failed_audits_this_week": failed_this_week,
        }
    except Exception as ex:
        snapshot["audits"] = {"error": str(ex)}

    # ── Checklists ────────────────────────────────────────────────────────────
    try:
        checklist_sub_resp = (
            sb.table("form_submissions")
            .select("location_id,submitted_at,form_templates!inner(organisation_id,type)")
            .eq("form_templates.organisation_id", org_id)
            .eq("form_templates.type", "checklist")
            .in_("status", ["submitted", "approved", "rejected"])
            .gte("submitted_at", f"{sda}T00:00:00")
            .execute()
        )
        checklist_subs = checklist_sub_resp.data or []

        # Assignments (total assigned, as denominator)
        checklist_assign_resp = (
            sb.table("form_assignments")
            .select("assigned_to_location_id,form_templates!inner(organisation_id,type)")
            .eq("organisation_id", org_id)
            .eq("form_templates.type", "checklist")
            .eq("is_active", True)
            .eq("is_deleted", False)
            .execute()
        )
        checklist_assigns = checklist_assign_resp.data or []
        assigned_per_loc: dict[str, int] = {}
        for a in checklist_assigns:
            lid = a.get("assigned_to_location_id", "")
            assigned_per_loc[lid] = assigned_per_loc.get(lid, 0) + 1

        # Daily completion per location (last 7 days)
        loc_daily: dict[str, dict[str, int]] = {}  # loc → {date_str → count}
        for s in checklist_subs:
            lid = s.get("location_id", "")
            try:
                d = datetime.fromisoformat(s["submitted_at"].replace("Z", "+00:00")).date().isoformat()
            except Exception:
                continue
            loc_daily.setdefault(lid, {})
            loc_daily[lid][d] = loc_daily[lid].get(d, 0) + 1

        by_location_daily = []
        below_80_consecutive: dict[str, int] = {}

        for lid, daily in loc_daily.items():
            assigned = assigned_per_loc.get(lid, 1) or 1
            rates = []
            consecutive = 0
            for offset in range(7):
                d = (today - timedelta(days=offset)).isoformat()
                count = daily.get(d, 0)
                rate = round(count / assigned * 100)
                rates.append({"date": d, "completion_rate": rate, "completed": count})
                if rate < 80:
                    consecutive += 1
                else:
                    break

            by_location_daily.append({
                "location": loc_map.get(lid, lid),
                "daily_rates": rates,
            })
            if consecutive >= 2:
                below_80_consecutive[lid] = consecutive

        # Template completion trend: this week vs last week
        this_week_subs_resp = (
            sb.table("form_submissions")
            .select("form_template_id,form_templates!inner(organisation_id,type,title)")
            .eq("form_templates.organisation_id", org_id)
            .eq("form_templates.type", "checklist")
            .in_("status", ["submitted", "approved", "rejected"])
            .gte("submitted_at", f"{ws}T00:00:00")
            .execute()
        )
        last_week_subs_resp = (
            sb.table("form_submissions")
            .select("form_template_id,form_templates!inner(organisation_id,type,title)")
            .eq("form_templates.organisation_id", org_id)
            .eq("form_templates.type", "checklist")
            .in_("status", ["submitted", "approved", "rejected"])
            .gte("submitted_at", f"{lws}T00:00:00")
            .lt("submitted_at", f"{ws}T00:00:00")
            .execute()
        )
        this_week_by_tpl: dict[str, int] = {}
        for s in (this_week_subs_resp.data or []):
            tid = s.get("form_template_id", "")
            this_week_by_tpl[tid] = this_week_by_tpl.get(tid, 0) + 1
        last_week_by_tpl: dict[str, int] = {}
        tpl_names: dict[str, str] = {}
        for s in (last_week_subs_resp.data or []):
            tid = s.get("form_template_id", "")
            last_week_by_tpl[tid] = last_week_by_tpl.get(tid, 0) + 1
            tpl_names[tid] = (s.get("form_templates") or {}).get("title", "Unknown")

        template_trend = [
            {
                "template": tpl_names.get(tid, tid),
                "this_week": this_week_by_tpl.get(tid, 0),
                "last_week": v,
                "change_pct": round((this_week_by_tpl.get(tid, 0) - v) / v * 100) if v else 0,
            }
            for tid, v in last_week_by_tpl.items()
        ]

        snapshot["checklists"] = {
            "by_location_daily": by_location_daily,
            "below_80pct_2plus_consecutive_days": [
                {"location": loc_map.get(lid, lid), "consecutive_days": d}
                for lid, d in below_80_consecutive.items()
            ],
            "template_trend": template_trend,
        }
    except Exception as ex:
        snapshot["checklists"] = {"error": str(ex)}

    # ── Pull-Outs & Waste ─────────────────────────────────────────────────────
    try:
        pullout_resp = (
            sb.table("form_submissions")
            .select("location_id,estimated_cost,submitted_at,form_templates!inner(organisation_id,type)")
            .eq("form_templates.organisation_id", org_id)
            .eq("form_templates.type", "pull_out")
            .in_("status", ["submitted", "approved", "rejected"])
            .gte("submitted_at", f"{fwa}T00:00:00")
            .execute()
        )
        pullouts = pullout_resp.data or []

        # Weekly cost per location (4 weeks)
        loc_weekly_cost: dict[str, list[float]] = {}  # loc_id → [w0, w1, w2, w3]
        for p in pullouts:
            cost = 0.0
            try:
                cost = float(p.get("estimated_cost") or 0)
            except Exception:
                pass
            lid = p.get("location_id", "")
            try:
                sub_date = datetime.fromisoformat(p["submitted_at"].replace("Z", "+00:00")).date()
                days_ago = (today - sub_date).days
                week_num = min(days_ago // 7, 3)
            except Exception:
                continue
            if lid not in loc_weekly_cost:
                loc_weekly_cost[lid] = [0.0, 0.0, 0.0, 0.0]
            loc_weekly_cost[lid][week_num] += cost

        # Anomalies: current week (w0) > 1.5x rolling 4-week average of w1-w3
        anomalies = []
        for lid, weekly in loc_weekly_cost.items():
            prev_weeks = [w for w in weekly[1:] if w > 0]
            if not prev_weeks:
                continue
            rolling_avg = sum(prev_weeks) / len(prev_weeks)
            if rolling_avg > 0 and weekly[0] > rolling_avg * 1.5:
                anomalies.append({
                    "location": loc_map.get(lid, lid),
                    "this_week_cost": round(weekly[0], 2),
                    "rolling_avg_cost": round(rolling_avg, 2),
                    "ratio": round(weekly[0] / rolling_avg, 2),
                })

        by_location_cost = [
            {
                "location": loc_map.get(lid, lid),
                "weekly_costs": [round(c, 2) for c in costs],  # w0=most recent
                "total_4w": round(sum(costs), 2),
            }
            for lid, costs in loc_weekly_cost.items()
        ]

        snapshot["pull_outs"] = {
            "by_location_weekly_cost": sorted(by_location_cost, key=lambda x: -x["total_4w"]),
            "anomalies": sorted(anomalies, key=lambda x: -x["ratio"]),
        }
    except Exception as ex:
        snapshot["pull_outs"] = {"error": str(ex)}

    # ── Shifts & Attendance ───────────────────────────────────────────────────
    try:
        # Shifts last 7 days
        shifts_resp = (
            sb.table("shifts")
            .select("id,location_id,assigned_to_user_id,start_at,end_at,status,is_open_shift")
            .eq("organisation_id", org_id)
            .eq("status", "published")
            .gte("start_at", f"{sda}T00:00:00")
            .lt("start_at", f"{tod}T23:59:59")
            .execute()
        )
        shifts_7d = shifts_resp.data or []

        # Open/unfilled shifts
        open_shifts_resp = (
            sb.table("shifts")
            .select("id", count="exact")
            .eq("organisation_id", org_id)
            .eq("is_open_shift", True)
            .in_("status", ["open", "published"])
            .execute()
        )
        open_shifts_count = open_shifts_resp.count or 0

        # Attendance records last 7 days
        att_resp = (
            sb.table("attendance_records")
            .select("user_id,shift_id,location_id,clock_in_at,clock_out_at,overtime_minutes,status")
            .eq("organisation_id", org_id)
            .gte("clock_in_at", f"{sda}T00:00:00")
            .execute()
        )
        att_7d = att_resp.data or []
        att_shift_ids = {a["shift_id"] for a in att_7d if a.get("shift_id")}

        # No-shows: shifts without attendance records
        no_show_this_week = sum(
            1 for s in shifts_7d
            if s["id"] not in att_shift_ids
            and s.get("start_at", "") >= f"{ws}T00:00:00"
            and s.get("assigned_to_user_id")
        )
        no_show_last_week = sum(
            1 for s in shifts_7d
            if s["id"] not in att_shift_ids
            and f"{lws}T00:00:00" <= s.get("start_at", "") < f"{ws}T00:00:00"
            and s.get("assigned_to_user_id")
        )

        # Overtime by location this week
        overtime_by_loc: dict[str, int] = {}
        for a in att_7d:
            if a.get("clock_in_at", "") < f"{ws}T00:00:00":
                continue
            lid = a.get("location_id", "")
            ot = a.get("overtime_minutes") or 0
            overtime_by_loc[lid] = overtime_by_loc.get(lid, 0) + ot

        # Rates per location (last 7 days)
        loc_sched: dict[str, int] = {}
        for s in shifts_7d:
            lid = s.get("location_id", "")
            loc_sched[lid] = loc_sched.get(lid, 0) + 1
        loc_att: dict[str, int] = {}
        for a in att_7d:
            lid = a.get("location_id", "")
            loc_att[lid] = loc_att.get(lid, 0) + 1

        attendance_rates_by_loc = [
            {
                "location": loc_map.get(lid, lid),
                "scheduled": sched,
                "clocked_in": loc_att.get(lid, 0),
                "present_rate": round(loc_att.get(lid, 0) / sched * 100) if sched else 0,
                "overtime_mins_this_week": overtime_by_loc.get(lid, 0),
            }
            for lid, sched in loc_sched.items()
        ]

        snapshot["attendance"] = {
            "rates_by_location": attendance_rates_by_loc,
            "no_show_this_week": no_show_this_week,
            "no_show_last_week": no_show_last_week,
            "open_unfilled_shifts": open_shifts_count,
        }
    except Exception as ex:
        snapshot["attendance"] = {"error": str(ex)}

    # ── Tasks ─────────────────────────────────────────────────────────────────
    try:
        tasks_resp = (
            sb.table("tasks")
            .select("id,location_id,status,priority,created_at,completed_at,title,due_at")
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .gte("created_at", f"{lws}T00:00:00")
            .execute()
        )
        tasks = tasks_resp.data or []

        # Completion this week vs last week by location
        loc_task_completion: dict[str, dict] = {}
        for t in tasks:
            lid = t.get("location_id", "")
            ca = t.get("created_at", "")
            this_wk = ca >= f"{ws}T00:00:00"
            last_wk = f"{lws}T00:00:00" <= ca < f"{ws}T00:00:00"
            if lid not in loc_task_completion:
                loc_task_completion[lid] = {"this_total": 0, "this_done": 0, "last_total": 0, "last_done": 0}
            lc = loc_task_completion[lid]
            if this_wk:
                lc["this_total"] += 1
                if t.get("status") == "completed":
                    lc["this_done"] += 1
            elif last_wk:
                lc["last_total"] += 1
                if t.get("status") == "completed":
                    lc["last_done"] += 1

        task_completion_by_loc = [
            {
                "location": loc_map.get(lid, lid),
                "this_week_rate": round(v["this_done"] / v["this_total"] * 100) if v["this_total"] else None,
                "last_week_rate": round(v["last_done"] / v["last_total"] * 100) if v["last_total"] else None,
            }
            for lid, v in loc_task_completion.items()
        ]

        # Open > 7 days
        open_over_7d_resp = (
            sb.table("tasks")
            .select("id,title,location_id,priority")
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .in_("status", ["pending", "in_progress", "overdue"])
            .lt("created_at", f"{sda}T00:00:00")
            .limit(20)
            .execute()
        )
        open_over_7d = open_over_7d_resp.data or []

        # Overdue trend
        overdue_this = sum(1 for t in tasks if t.get("status") == "overdue" and t.get("created_at", "") >= f"{ws}T00:00:00")
        overdue_last = sum(1 for t in tasks if t.get("status") == "overdue" and f"{lws}T00:00:00" <= t.get("created_at", "") < f"{ws}T00:00:00")

        snapshot["tasks"] = {
            "completion_by_location": task_completion_by_loc,
            "open_over_7d_count": len(open_over_7d),
            "open_over_7d_sample": [
                {"title": t["title"], "location": loc_map.get(t.get("location_id", ""), t.get("location_id", "")), "priority": t.get("priority")}
                for t in open_over_7d[:5]
            ],
            "overdue_this_week": overdue_this,
            "overdue_last_week": overdue_last,
        }
    except Exception as ex:
        snapshot["tasks"] = {"error": str(ex)}

    # ── Maintenance ───────────────────────────────────────────────────────────
    try:
        # Get maintenance category IDs
        maint_cats_resp = (
            sb.table("issue_categories")
            .select("id")
            .eq("organisation_id", org_id)
            .eq("is_maintenance", True)
            .eq("is_deleted", False)
            .execute()
        )
        maint_cat_ids = [c["id"] for c in (maint_cats_resp.data or [])]

        if maint_cat_ids:
            maint_open_resp = (
                sb.table("issues")
                .select("id", count="exact")
                .eq("organisation_id", org_id)
                .eq("is_deleted", False)
                .in_("category_id", maint_cat_ids)
                .in_("status", ["open", "in_progress", "pending_vendor"])
                .execute()
            )
            maint_open_count = maint_open_resp.count or 0

            # Cost this month / last month
            maint_cost_resp = (
                sb.table("issues")
                .select("cost,resolved_at")
                .eq("organisation_id", org_id)
                .eq("is_deleted", False)
                .in_("category_id", maint_cat_ids)
                .in_("status", ["resolved", "closed"])
                .gte("resolved_at", f"{lms}T00:00:00")
                .execute()
            )
            maint_issues = maint_cost_resp.data or []

            cost_this_month = sum(float(i.get("cost") or 0) for i in maint_issues if (i.get("resolved_at") or "") >= f"{ms}T00:00:00")
            cost_last_month = sum(float(i.get("cost") or 0) for i in maint_issues if f"{lms}T00:00:00" <= (i.get("resolved_at") or "") < f"{ms}T00:00:00")

            # Assets with 3+ issues in 30 days
            asset_issues_resp = (
                sb.table("issues")
                .select("asset_id")
                .eq("organisation_id", org_id)
                .eq("is_deleted", False)
                .in_("category_id", maint_cat_ids)
                .gte("created_at", f"{tda}T00:00:00")
                .not_.is_("asset_id", "null")
                .execute()
            )
            asset_counts: dict[str, int] = {}
            for i in (asset_issues_resp.data or []):
                aid = i.get("asset_id", "")
                asset_counts[aid] = asset_counts.get(aid, 0) + 1

            snapshot["maintenance"] = {
                "open_count": maint_open_count,
                "cost_this_month": round(cost_this_month, 2),
                "cost_last_month": round(cost_last_month, 2),
                "assets_with_3plus_issues_30d": sum(1 for v in asset_counts.values() if v >= 3),
            }
        else:
            snapshot["maintenance"] = {"open_count": 0, "cost_this_month": 0, "cost_last_month": 0, "assets_with_3plus_issues_30d": 0}
    except Exception as ex:
        snapshot["maintenance"] = {"error": str(ex)}

    # ── Incidents ─────────────────────────────────────────────────────────────
    try:
        inc_resp = (
            sb.table("incidents")
            .select("id,status,created_at,resolved_at")
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .gte("created_at", f"{lws}T00:00:00")
            .execute()
        )
        incidents = inc_resp.data or []
        inc_this_week = sum(1 for i in incidents if i.get("created_at", "") >= f"{ws}T00:00:00")
        inc_open = sum(1 for i in incidents if i.get("status") not in ("resolved", "closed"))

        snapshot["incidents"] = {
            "this_week_count": inc_this_week,
            "open_unresolved": inc_open,
        }
    except Exception as ex:
        snapshot["incidents"] = {"error": str(ex)}

    # ── Cross-module signals ───────────────────────────────────────────────────
    try:
        # Locations where low checklist completion AND rising issue counts
        low_cl_locs = {
            row["location"]
            for row in snapshot.get("checklists", {}).get("below_80pct_2plus_consecutive_days", [])
        }
        # Issue count per location this week vs last week
        issue_loc_this: dict[str, int] = {}
        issue_loc_last: dict[str, int] = {}
        for i in issues_all if "issues_all" in dir() else []:  # type: ignore
            lid = i.get("location_id", "")
            ca = i.get("created_at", "")
            if ca >= f"{ws}T00:00:00":
                issue_loc_this[lid] = issue_loc_this.get(lid, 0) + 1
            elif ca >= f"{lws}T00:00:00":
                issue_loc_last[lid] = issue_loc_last.get(lid, 0) + 1

        cross_low_cl_rising_issues = [
            {"location": name}
            for name in low_cl_locs
            if any(
                issue_loc_this.get(lid, 0) > issue_loc_last.get(lid, 0)
                for lid, n in loc_map.items() if n == name
            )
        ]

        snapshot["cross_module"] = {
            "low_checklist_rising_issues": cross_low_cl_rising_issues,
            "declining_audit_and_low_checklist": list(
                set(declining_audit_locations if "declining_audit_locations" in dir() else []) & low_cl_locs
            ),
        }
    except Exception:
        snapshot["cross_module"] = {}

    return snapshot


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/daily-snapshot")
async def daily_snapshot(
    refresh: bool = Query(False),
    current_user: dict = Depends(require_manager_or_above),
):
    """
    Returns rich operational data for the organisation.
    Cached per org per calendar day. Pass ?refresh=true to force regeneration.
    """
    meta = current_user.get("app_metadata") or {}
    org_id = meta.get("organisation_id")
    if not org_id:
        raise HTTPException(status_code=400, detail="No organisation_id in token.")

    cache_key = f"snapshot:{org_id}"
    if not refresh:
        cached = _cache_get(_snapshot_cache, cache_key)
        if cached:
            return cached

    data = await asyncio.to_thread(_build_snapshot, org_id)
    _cache_set(_snapshot_cache, cache_key, data)
    return data


# ── Insights system prompt ────────────────────────────────────────────────────

def _build_insights_system_prompt(org_id: str, location_count: int, role_level: str) -> str:
    industry = get_industry_context(org_id)
    role_desc = {
        "admin": "all locations and cross-location comparisons",
        "manager": "their location and team",
        "staff": "their personal tasks and assignments",
    }.get(role_level, "their location")
    return (
        f"{industry}"
        f"You are an operations intelligence analyst for a business with {location_count} location(s). "
        f"The current user is a {role_level} and can see {role_desc}.\n\n"
        "Analyze this operational data and surface ONLY what genuinely needs attention today. Maximum 3 insights.\n\n"
        "Rules:\n"
        "- If nothing is notably wrong, return 1 INFO insight about what's going well. Don't invent problems.\n"
        "- CRITICAL only if it requires action TODAY or there's a compliance/safety risk.\n"
        "- WARNING only if a trend has been wrong for 2+ weeks and nobody has acted on it.\n"
        "- Don't report on things that are slightly off. Only patterns that are meaningfully wrong or meaningfully good.\n"
        "- Each insight must be a PATTERN, not a count. Don't say '3 tasks are overdue.' Say 'Makati has had "
        "increasing overdue tasks for 3 weeks — correlates with 2 new hires who haven't completed training.'\n"
        "- Cross-reference multiple data points where possible.\n"
        "- Be specific: name locations, people counts, percentages, timeframes, trend directions.\n"
        "- End each insight with a concrete recommendation starting with →\n"
        "- If fewer than 3 real insights exist, return fewer. 0 insights is fine — return empty array.\n\n"
        "Always respond with ONLY valid JSON — no markdown fences, no explanation.\n\n"
        "Schema:\n"
        '{\n'
        '  "brief": "2-3 sentence executive summary of the most important finding",\n'
        '  "insights": [\n'
        '    {\n'
        '      "severity": "critical|warning|info",\n'
        '      "title": "Short headline under 15 words",\n'
        '      "body": "2-3 sentences with specific numbers and context",\n'
        '      "recommendation": "→ Concrete actionable next step"\n'
        '    }\n'
        '  ]\n'
        '}'
    )


def _filter_snapshot_by_role(snapshot: dict, role_level: str, user_location_id: str | None) -> dict:
    """For manager/staff, strip cross-location data to only their location."""
    import copy

    if role_level == "admin":
        return snapshot  # admin sees all

    if not user_location_id:
        return snapshot  # can't filter without location

    loc_id_to_name: dict = (snapshot.get("org") or {}).get("loc_id_to_name") or {}
    loc_name = loc_id_to_name.get(user_location_id)
    if not loc_name:
        return snapshot  # unknown location — fall back to full data

    filtered = copy.deepcopy(snapshot)

    # Narrow org section to 1 location
    filtered["org"]["location_count"] = 1
    filtered["org"]["locations"] = [loc_name]
    # Keep loc_id_to_name so subsequent calls can still resolve if needed
    filtered["org"]["loc_id_to_name"] = {user_location_id: loc_name}

    def _keep(row: dict) -> bool:
        return (row.get("location") == loc_name) if isinstance(row, dict) else True

    # ── certifications ──────────────────────────────────────────────────────
    certs = filtered.get("certifications") or {}
    if isinstance(certs, dict) and "error" not in certs:
        certs["expiring_7d_by_location"] = [r for r in certs.get("expiring_7d_by_location", []) if _keep(r)]
        certs["expiring_14d_by_location"] = [r for r in certs.get("expiring_14d_by_location", []) if _keep(r)]
        certs["completion_by_location"] = [r for r in certs.get("completion_by_location", []) if _keep(r)]

    # ── issues ──────────────────────────────────────────────────────────────
    iss = filtered.get("issues") or {}
    if isinstance(iss, dict) and "error" not in iss:
        iss["recurring_issues"] = [r for r in iss.get("recurring_issues", []) if _keep(r)]

    # ── audits ──────────────────────────────────────────────────────────────
    aud = filtered.get("audits") or {}
    if isinstance(aud, dict) and "error" not in aud:
        aud["by_location_weekly"] = [r for r in aud.get("by_location_weekly", []) if _keep(r)]
        aud["declining_locations"] = [n for n in aud.get("declining_locations", []) if n == loc_name]

    # ── checklists ──────────────────────────────────────────────────────────
    chk = filtered.get("checklists") or {}
    if isinstance(chk, dict) and "error" not in chk:
        chk["by_location_daily"] = [r for r in chk.get("by_location_daily", []) if _keep(r)]
        chk["below_80pct_2plus_consecutive_days"] = [
            r for r in chk.get("below_80pct_2plus_consecutive_days", []) if _keep(r)
        ]

    # ── pull_outs ────────────────────────────────────────────────────────────
    po = filtered.get("pull_outs") or {}
    if isinstance(po, dict) and "error" not in po:
        po["by_location_weekly_cost"] = [r for r in po.get("by_location_weekly_cost", []) if _keep(r)]
        po["anomalies"] = [r for r in po.get("anomalies", []) if _keep(r)]

    # ── attendance ───────────────────────────────────────────────────────────
    att = filtered.get("attendance") or {}
    if isinstance(att, dict) and "error" not in att:
        att["rates_by_location"] = [r for r in att.get("rates_by_location", []) if _keep(r)]

    # ── tasks ────────────────────────────────────────────────────────────────
    tsk = filtered.get("tasks") or {}
    if isinstance(tsk, dict) and "error" not in tsk:
        tsk["completion_by_location"] = [r for r in tsk.get("completion_by_location", []) if _keep(r)]
        tsk["open_over_7d_sample"] = [r for r in tsk.get("open_over_7d_sample", []) if _keep(r)]

    # ── cross_module ─────────────────────────────────────────────────────────
    xm = filtered.get("cross_module") or {}
    if isinstance(xm, dict):
        xm["low_checklist_rising_issues"] = [r for r in xm.get("low_checklist_rising_issues", []) if _keep(r)]
        xm["declining_audit_and_low_checklist"] = [n for n in xm.get("declining_audit_and_low_checklist", []) if n == loc_name]

    return filtered


@router.get("/dashboard-insights")
async def dashboard_insights(
    refresh: bool = Query(False),
    current_user: dict = Depends(get_current_user),
):
    """
    Returns AI-generated daily brief + insight cards.
    Calls daily-snapshot internally, filters by role, calls Claude.
    Cached per org + role_level per calendar day.
    """
    meta = current_user.get("app_metadata") or {}
    org_id = meta.get("organisation_id")
    role = meta.get("role", "staff")
    user_id = current_user.get("sub")
    user_location_id = meta.get("location_id")

    if not org_id:
        raise HTTPException(status_code=400, detail="No organisation_id in token.")

    # Role level: staff sees personal only, manager sees location, admin sees all
    role_level = "admin" if role in ("admin", "super_admin") else role  # staff|manager|admin

    # Scope cache by location for managers so they don't share a cached response
    loc_scope = user_location_id if role_level == "manager" and user_location_id else ""
    insights_key = f"insights:{org_id}:{role_level}:{loc_scope}"
    if not refresh:
        cached = _cache_get(_insights_cache, insights_key)
        if cached:
            return cached

    # Get snapshot (uses its own cache)
    snap_key = f"snapshot:{org_id}"
    snapshot = _cache_get(_snapshot_cache, snap_key)
    if not snapshot or refresh:
        snapshot = await asyncio.to_thread(_build_snapshot, org_id)
        _cache_set(_snapshot_cache, snap_key, snapshot)

    # Filter for role
    filtered = _filter_snapshot_by_role(snapshot, role_level, user_location_id)

    location_count = (filtered.get("org") or {}).get("location_count", 1)
    system_prompt = _build_insights_system_prompt(org_id, location_count, role_level)

    # Compact the snapshot for the Claude message (trim noise)
    user_message = f"Today's operational data:\n{json.dumps(filtered, separators=(',', ':'))}"

    with AITimer() as timer:
        try:
            text = await _call_claude(system_prompt, user_message, max_tokens=1024)
            success = True
            error_msg = None
        except HTTPException as e:
            log_ai_request(
                feature="dashboard_insights", model="claude-haiku-4-5",
                input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
                success=False, org_id=org_id, user_id=user_id, error_message=e.detail,
            )
            raise
        except Exception as e:
            error_msg = str(e)
            log_ai_request(
                feature="dashboard_insights", model="claude-haiku-4-5",
                input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
                success=False, org_id=org_id, user_id=user_id, error_message=error_msg,
            )
            raise HTTPException(status_code=502, detail=f"AI error: {e}")

    log_ai_request(
        feature="dashboard_insights", model="claude-haiku-4-5",
        input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
        success=True, org_id=org_id, user_id=user_id,
    )

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    result = {
        "brief": data.get("brief", ""),
        "insights": data.get("insights", []),
        "cached_at": datetime.now(timezone.utc).isoformat(),
        "role_level": role_level,
    }

    _cache_set(_insights_cache, insights_key, result)
    return result
