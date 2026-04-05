"""
Inbox API — /api/v1/inbox

Returns a unified, status-based list of actionable items for the current user:
tasks (not done), form assignments (incomplete), workflow steps (in_progress),
course enrollments (not_started), unacknowledged announcements, open assigned issues.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from dependencies import get_current_user
from services.supabase_client import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Response schema ────────────────────────────────────────────────────────────

class InboxItem(BaseModel):
    kind: Literal[
        "task", "form", "workflow", "course", "announcement", "issue",
        # Manager/admin/super_admin action items
        "shift_claim",    # open-shift claim awaiting approval
        "shift_swap",     # shift swap awaiting manager approval
        "leave_request",  # leave request awaiting approval
        "form_review",    # form submission submitted, awaiting manager review
        "cap",            # corrective action plan pending review
    ]
    id: str
    title: str
    description: Optional[str] = None
    priority: Optional[str] = None       # tasks / issues: "high", "medium", "low", "critical"
    form_type: Optional[str] = None      # forms: "checklist", "audit", "pull_out", "form"
    workflow_instance_id: Optional[str] = None  # workflow: parent instance ID for URL
    is_mandatory: bool = False           # courses
    due_at: Optional[str] = None
    is_overdue: bool = False
    created_at: str


class InboxResponse(BaseModel):
    items: list[InboxItem]
    total: int


# ── Helpers ────────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _is_overdue(due_at: Optional[str]) -> bool:
    if not due_at:
        return False
    try:
        dt = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt < _now_utc()
    except Exception:
        return False


def _trunc(s: Optional[str], n: int = 120) -> Optional[str]:
    if not s:
        return None
    return s[:n] if len(s) > n else s


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.get("", response_model=InboxResponse)
@router.get("/", response_model=InboxResponse)
async def get_inbox(current_user: dict = Depends(get_current_user)):
    """Return unified actionable items for the current user, sorted by urgency."""
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    sb = get_supabase()

    items: list[InboxItem] = []

    # ── User profile (for announcement visibility check) ──────────────────────
    user_role = "staff"
    user_location_id: Optional[str] = None
    try:
        profile_resp = (
            sb.table("profiles")
            .select("role,location_id")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        if profile_resp.data:
            user_role = profile_resp.data.get("role") or "staff"
            user_location_id = profile_resp.data.get("location_id")
    except Exception as e:
        logger.warning("inbox profile query failed: %s", e)

    # ── 1. Tasks assigned to user ─────────────────────────────────────────────
    try:
        ta_resp = (
            sb.table("task_assignees")
            .select(
                "tasks(id,title,description,priority,due_at,created_at,status,is_deleted,"
                "locations(name))"
            )
            .eq("user_id", user_id)
            .execute()
        )
        for row in (ta_resp.data or []):
            t = row.get("tasks")
            if not t:
                continue
            if t.get("is_deleted"):
                continue
            if t.get("status") in ("completed", "cancelled"):
                continue
            loc = t.get("locations")
            loc_name = loc.get("name") if isinstance(loc, dict) else None
            desc = loc_name or _trunc(t.get("description"))
            items.append(InboxItem(
                kind="task",
                id=t["id"],
                title=t.get("title") or "Task",
                description=desc,
                priority=t.get("priority"),
                due_at=t.get("due_at"),
                is_overdue=_is_overdue(t.get("due_at")),
                created_at=t.get("created_at") or "",
            ))
    except Exception as e:
        logger.warning("inbox tasks query failed: %s", e)

    # ── 2. Incomplete form assignments ────────────────────────────────────────
    try:
        fa_resp = (
            sb.table("form_assignments")
            .select(
                "id,due_at,created_at,is_deleted,"
                "form_templates(title,type,description)"
            )
            .eq("assigned_to_user_id", user_id)
            .eq("organisation_id", org_id)
            .eq("is_active", True)
            .eq("is_deleted", False)
            .execute()
        )
        assignment_ids = [fa["id"] for fa in (fa_resp.data or [])]
        submitted_ids: set = set()
        if assignment_ids:
            sub_resp = (
                sb.table("form_submissions")
                .select("assignment_id")
                .in_("assignment_id", assignment_ids)
                .in_("status", ["submitted", "approved"])
                .execute()
            )
            submitted_ids = {r["assignment_id"] for r in (sub_resp.data or [])}
        for fa in (fa_resp.data or []):
            if fa["id"] in submitted_ids:
                continue
            tmpl = fa.get("form_templates") or {}
            items.append(InboxItem(
                kind="form",
                id=fa["id"],
                title=tmpl.get("title") or "Form",
                description=_trunc(tmpl.get("description")),
                form_type=tmpl.get("type"),
                due_at=fa.get("due_at"),
                is_overdue=_is_overdue(fa.get("due_at")),
                created_at=fa.get("created_at") or "",
            ))
    except Exception as e:
        logger.warning("inbox forms query failed: %s", e)

    # ── 3. In-progress workflow stage instances ───────────────────────────────
    try:
        wsi_resp = (
            sb.table("workflow_stage_instances")
            .select(
                "id,workflow_instance_id,due_at,started_at,status,is_deleted,"
                "workflow_stages(name)"
            )
            .eq("assigned_to", user_id)
            .eq("status", "in_progress")
            .eq("is_deleted", False)
            .execute()
        )
        for wsi in (wsi_resp.data or []):
            stage = wsi.get("workflow_stages") or {}
            items.append(InboxItem(
                kind="workflow",
                id=wsi["id"],
                title=stage.get("name") or "Workflow step",
                workflow_instance_id=wsi.get("workflow_instance_id"),
                due_at=wsi.get("due_at"),
                is_overdue=_is_overdue(wsi.get("due_at")),
                created_at=wsi.get("started_at") or "",
            ))
    except Exception as e:
        logger.warning("inbox workflows query failed: %s", e)

    # ── 4. Not-started course enrollments ─────────────────────────────────────
    try:
        ce_resp = (
            sb.table("course_enrollments")
            .select(
                "id,created_at,status,is_deleted,"
                "courses(title,description,is_mandatory,estimated_duration_mins)"
            )
            .eq("user_id", user_id)
            .eq("organisation_id", org_id)
            .eq("status", "not_started")
            .eq("is_deleted", False)
            .execute()
        )
        for ce in (ce_resp.data or []):
            course = ce.get("courses") or {}
            items.append(InboxItem(
                kind="course",
                id=ce["id"],
                title=course.get("title") or "Training course",
                description=_trunc(course.get("description")),
                is_mandatory=bool(course.get("is_mandatory")),
                created_at=ce.get("created_at") or "",
            ))
    except Exception as e:
        logger.warning("inbox courses query failed: %s", e)

    # ── 5. Unacknowledged announcements ───────────────────────────────────────
    try:
        ann_resp = (
            sb.table("announcements")
            .select("id,title,body,target_roles,target_location_ids,created_at")
            .eq("organisation_id", org_id)
            .eq("requires_acknowledgement", True)
            .eq("is_deleted", False)
            .execute()
        )
        ack_resp = (
            sb.table("announcement_receipts")
            .select("announcement_id")
            .eq("user_id", user_id)
            .not_.is_("acknowledged_at", "null")
            .execute()
        )
        acked_ids = {a["announcement_id"] for a in (ack_resp.data or [])}

        for ann in (ann_resp.data or []):
            if ann["id"] in acked_ids:
                continue
            target_roles = ann.get("target_roles") or []
            target_locs = ann.get("target_location_ids") or []
            # Role filter: if restricted, user must be in the list
            if target_roles and user_role not in target_roles:
                continue
            # Location filter: if restricted and user has a location, must match
            if target_locs and user_location_id and user_location_id not in target_locs:
                continue
            items.append(InboxItem(
                kind="announcement",
                id=ann["id"],
                title=ann.get("title") or "Announcement",
                description=_trunc(ann.get("body"), 100),
                created_at=ann.get("created_at") or "",
            ))
    except Exception as e:
        logger.warning("inbox announcements query failed: %s", e)

    # ── 6. Open issues ────────────────────────────────────────────────────────
    # Staff:              only issues directly assigned to them
    # Manager:            assigned to me  OR  (unassigned AND at my location)
    # Admin/super_admin:  assigned to me  OR  any unassigned (org-wide)
    try:
        _iss_base = (
            sb.table("issues")
            .select(
                "id,title,description,priority,status,due_at,created_at,is_deleted,"
                "assigned_to,location_id,locations(name)"
            )
            .eq("organisation_id", org_id)
            .not_.in_("status", ["resolved", "verified_closed"])
            .eq("is_deleted", False)
        )

        if user_role in ("manager", "admin", "super_admin"):
            if user_role == "manager" and user_location_id:
                # Assigned to me  OR  (unassigned AND at my location)
                iss_resp = _iss_base.or_(
                    f"assigned_to.eq.{user_id},"
                    f"and(assigned_to.is.null,location_id.eq.{user_location_id})"
                ).execute()
            else:
                # admin / super_admin: assigned to me OR any unassigned (org-wide)
                iss_resp = _iss_base.or_(
                    f"assigned_to.eq.{user_id},assigned_to.is.null"
                ).execute()
        else:
            # Staff: only issues explicitly assigned to them
            iss_resp = _iss_base.eq("assigned_to", user_id).execute()

        seen_iss_ids: set = set()
        for iss in (iss_resp.data or []):
            if iss.get("is_deleted"):
                continue
            iss_id = iss["id"]
            if iss_id in seen_iss_ids:
                continue
            seen_iss_ids.add(iss_id)
            loc = iss.get("locations")
            loc_name = loc.get("name") if isinstance(loc, dict) else None
            desc = loc_name or _trunc(iss.get("description"))
            items.append(InboxItem(
                kind="issue",
                id=iss_id,
                title=iss.get("title") or "Issue",
                description=desc,
                priority=iss.get("priority"),
                due_at=iss.get("due_at"),
                is_overdue=_is_overdue(iss.get("due_at")),
                created_at=iss.get("created_at") or "",
            ))
    except Exception as e:
        logger.warning("inbox issues query failed: %s", e)

    # ── Manager / Admin / Super-Admin action items ─────────────────────────────
    # These only appear for users who have approval/review responsibility.
    is_manager_plus = user_role in ("manager", "admin", "super_admin")

    if is_manager_plus:
        # ── 7. Pending open-shift claims at this manager's location ───────────
        try:
            # open_shift_claims has no organisation_id — scope via shifts inner join
            sc_query = (
                sb.table("open_shift_claims")
                .select(
                    "id,claimed_at,status,"
                    "shifts!inner(id,start_at,organisation_id,location_id,locations(name)),"
                    "profiles!claimed_by(full_name)"
                )
                .eq("status", "pending")
                .eq("shifts.organisation_id", str(org_id))
            )
            if user_role == "manager" and user_location_id:
                sc_query = sc_query.eq("shifts.location_id", str(user_location_id))
            sc_resp = sc_query.execute()
            for sc in (sc_resp.data or []):
                shift = sc.get("shifts") or {}
                loc = shift.get("locations") or {}
                loc_name = loc.get("name") if isinstance(loc, dict) else None
                claimer = sc.get("profiles") or {}
                claimer_name = claimer.get("full_name") or "Staff member"
                start_str = shift.get("start_at")
                shift_date = ""
                if start_str:
                    try:
                        dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                        shift_date = dt.strftime("%-d %b, %-I:%M %p")
                    except Exception:
                        pass
                items.append(InboxItem(
                    kind="shift_claim",
                    id=sc["id"],
                    title=f"Shift claim: {claimer_name}",
                    description=f"{loc_name} · {shift_date}" if shift_date else loc_name,
                    created_at=sc.get("claimed_at") or "",
                ))
        except Exception as e:
            logger.warning("inbox shift_claims query failed: %s", e)

        # ── 8. Shift swaps awaiting manager approval ──────────────────────────
        try:
            ss_query = (
                sb.table("shift_swap_requests")
                .select(
                    "id,created_at,organisation_id,"
                    "shifts!shift_id(start_at,location_id,locations(name)),"
                    "profiles!requested_by(full_name)"
                )
                .eq("status", "pending_manager")
                .eq("organisation_id", str(org_id))
            )
            if user_role == "manager" and user_location_id:
                ss_query = ss_query.eq("shifts.location_id", str(user_location_id))
            ss_resp = ss_query.execute()
            for ss in (ss_resp.data or []):
                shift = ss.get("shifts") or {}
                loc = shift.get("locations") or {}
                loc_name = loc.get("name") if isinstance(loc, dict) else None
                requester = ss.get("profiles") or {}
                req_name = requester.get("full_name") or "Staff member"
                items.append(InboxItem(
                    kind="shift_swap",
                    id=ss["id"],
                    title="Shift swap request",
                    description=f"{loc_name} · from {req_name}" if loc_name else f"From {req_name}",
                    created_at=ss.get("created_at") or "",
                ))
        except Exception as e:
            logger.warning("inbox shift_swaps query failed: %s", e)

        # ── 9. Leave requests this manager needs to approve ───────────────────
        # For manager: requests from staff who report to this user (reports_to = user_id)
        # For admin / super_admin: all pending requests in the org
        try:
            if user_role == "manager":
                # Find direct reports
                reports_resp = (
                    sb.table("profiles")
                    .select("id")
                    .eq("reports_to", user_id)
                    .eq("is_deleted", False)
                    .execute()
                )
                report_ids = [r["id"] for r in (reports_resp.data or [])]
                if report_ids:
                    lr_resp = (
                        sb.table("leave_requests")
                        .select("id,leave_type,start_date,end_date,created_at,profiles!user_id(full_name)")
                        .eq("status", "pending")
                        .eq("organisation_id", str(org_id))
                        .in_("user_id", report_ids)
                        .execute()
                    )
                else:
                    lr_resp = type("R", (), {"data": []})()
            else:
                # admin / super_admin — all pending in org
                lr_resp = (
                    sb.table("leave_requests")
                    .select("id,leave_type,start_date,end_date,created_at,profiles!user_id(full_name)")
                    .eq("status", "pending")
                    .eq("organisation_id", str(org_id))
                    .execute()
                )
            for lr in (lr_resp.data or []):
                requester = lr.get("profiles") or {}
                req_name = requester.get("full_name") or "Staff member"
                leave_type = (lr.get("leave_type") or "leave").replace("_", " ").title()
                start = lr.get("start_date", "")
                items.append(InboxItem(
                    kind="leave_request",
                    id=lr["id"],
                    title=f"Leave request: {req_name}",
                    description=f"{leave_type} · from {start}" if start else leave_type,
                    created_at=lr.get("created_at") or "",
                ))
        except Exception as e:
            logger.warning("inbox leave_requests query failed: %s", e)

        # ── 10. Form submissions awaiting manager review ──────────────────────
        try:
            fs_query = (
                sb.table("form_submissions")
                .select(
                    "id,submitted_at,location_id,"
                    "form_templates!inner(title,type,organisation_id),"
                    "profiles!submitted_by(full_name)"
                )
                .eq("status", "submitted")
                .eq("form_templates.organisation_id", str(org_id))
            )
            if user_role == "manager" and user_location_id:
                fs_query = fs_query.eq("location_id", str(user_location_id))
            fs_resp = fs_query.execute()
            for fs in (fs_resp.data or []):
                tmpl = fs.get("form_templates") or {}
                submitter = fs.get("profiles") or {}
                sub_name = submitter.get("full_name") or "Staff member"
                items.append(InboxItem(
                    kind="form_review",
                    id=fs["id"],
                    title=tmpl.get("title") or "Form submission",
                    description=f"Submitted by {sub_name}",
                    form_type=tmpl.get("type"),
                    created_at=fs.get("submitted_at") or "",
                ))
        except Exception as e:
            logger.warning("inbox form_reviews query failed: %s", e)

        # ── 11. Corrective action plans pending review ────────────────────────
        try:
            cap_query = (
                sb.table("corrective_action_plans")
                .select(
                    "id,created_at,"
                    "form_submissions!inner(location_id,"
                    "form_templates!inner(title,organisation_id))"
                )
                .eq("status", "pending_review")
                .eq("form_submissions.form_templates.organisation_id", str(org_id))
            )
            if user_role == "manager" and user_location_id:
                cap_query = cap_query.eq("form_submissions.location_id", str(user_location_id))
            cap_resp = cap_query.execute()
            for cap in (cap_resp.data or []):
                sub = cap.get("form_submissions") or {}
                tmpl = sub.get("form_templates") or {}
                items.append(InboxItem(
                    kind="cap",
                    id=cap["id"],
                    title=f"CAP: {tmpl.get('title') or 'Audit'}",
                    description="Failed audit — review corrective action plan",
                    created_at=cap.get("created_at") or "",
                ))
        except Exception as e:
            logger.warning("inbox caps query failed: %s", e)

    # ── Sort: overdue ASC → upcoming ASC → no due date DESC ───────────────────
    overdue  = sorted([i for i in items if i.is_overdue],              key=lambda x: x.due_at or "")
    upcoming = sorted([i for i in items if not i.is_overdue and i.due_at], key=lambda x: x.due_at or "")
    no_due   = sorted([i for i in items if not i.due_at],              key=lambda x: x.created_at, reverse=True)

    sorted_items = overdue + upcoming + no_due
    return InboxResponse(items=sorted_items, total=len(sorted_items))
