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

from dependencies import get_current_user, get_db
from services.db import row, rows

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
        dt = datetime.fromisoformat(str(due_at).replace("Z", "+00:00"))
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
async def get_inbox(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Return unified actionable items for the current user, sorted by urgency."""
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    items: list[InboxItem] = []

    # ── User profile (for announcement visibility check) ──────────────────────
    user_role = "staff"
    user_location_id: Optional[str] = None
    try:
        profile = row(
            conn,
            "SELECT role, location_id FROM profiles WHERE id = %s",
            (user_id,),
        )
        if profile:
            user_role = profile.get("role") or "staff"
            user_location_id = profile.get("location_id")
    except Exception as e:
        logger.warning("inbox profile query failed: %s", e)

    # ── 1. Tasks assigned to user ─────────────────────────────────────────────
    try:
        task_rows = rows(
            conn,
            """
            SELECT
                t.id,
                t.title,
                t.description,
                t.priority,
                t.due_at,
                t.created_at,
                t.status,
                t.is_deleted,
                l.name AS location_name
            FROM task_assignees ta
            JOIN tasks t ON t.id = ta.task_id
            LEFT JOIN locations l ON l.id = t.location_id
            WHERE ta.user_id = %s
              AND t.is_deleted = FALSE
              AND t.status NOT IN ('completed', 'cancelled')
            """,
            (user_id,),
        )
        for t in task_rows:
            desc = t.get("location_name") or _trunc(t.get("description"))
            items.append(InboxItem(
                kind="task",
                id=str(t["id"]),
                title=t.get("title") or "Task",
                description=desc,
                priority=t.get("priority"),
                due_at=str(t["due_at"]) if t.get("due_at") else None,
                is_overdue=_is_overdue(str(t["due_at"]) if t.get("due_at") else None),
                created_at=str(t.get("created_at") or ""),
            ))
    except Exception as e:
        logger.warning("inbox tasks query failed: %s", e)

    # ── 2. Incomplete form assignments ────────────────────────────────────────
    try:
        fa_rows = rows(
            conn,
            """
            SELECT
                fa.id,
                fa.due_at,
                fa.created_at,
                fa.is_deleted,
                ft.title        AS template_title,
                ft.type         AS template_type,
                ft.description  AS template_description
            FROM form_assignments fa
            LEFT JOIN form_templates ft ON ft.id = fa.form_template_id
            WHERE fa.assigned_to_user_id = %s
              AND fa.organisation_id = %s
              AND fa.is_active = TRUE
              AND fa.is_deleted = FALSE
            """,
            (user_id, org_id),
        )
        assignment_ids = [str(fa["id"]) for fa in fa_rows]
        submitted_ids: set = set()
        if assignment_ids:
            sub_rows = rows(
                conn,
                """
                SELECT assignment_id
                FROM form_submissions
                WHERE assignment_id = ANY(%s::uuid[])
                  AND status IN ('submitted', 'approved')
                """,
                (assignment_ids,),
            )
            submitted_ids = {str(r["assignment_id"]) for r in sub_rows}
        for fa in fa_rows:
            if str(fa["id"]) in submitted_ids:
                continue
            items.append(InboxItem(
                kind="form",
                id=str(fa["id"]),
                title=fa.get("template_title") or "Form",
                description=_trunc(fa.get("template_description")),
                form_type=fa.get("template_type"),
                due_at=str(fa["due_at"]) if fa.get("due_at") else None,
                is_overdue=_is_overdue(str(fa["due_at"]) if fa.get("due_at") else None),
                created_at=str(fa.get("created_at") or ""),
            ))
    except Exception as e:
        logger.warning("inbox forms query failed: %s", e)

    # ── 3. In-progress workflow stage instances ───────────────────────────────
    try:
        wsi_rows = rows(
            conn,
            """
            SELECT
                wsi.id,
                wsi.workflow_instance_id,
                wsi.due_at,
                wsi.started_at,
                wsi.status,
                ws.name AS stage_name
            FROM workflow_stage_instances wsi
            LEFT JOIN workflow_stages ws ON ws.id = wsi.stage_id
            WHERE wsi.assigned_to = %s
              AND wsi.status = 'in_progress'
              AND wsi.is_deleted = FALSE
            """,
            (user_id,),
        )
        for wsi in wsi_rows:
            items.append(InboxItem(
                kind="workflow",
                id=str(wsi["id"]),
                title=wsi.get("stage_name") or "Workflow step",
                workflow_instance_id=str(wsi["workflow_instance_id"]) if wsi.get("workflow_instance_id") else None,
                due_at=str(wsi["due_at"]) if wsi.get("due_at") else None,
                is_overdue=_is_overdue(str(wsi["due_at"]) if wsi.get("due_at") else None),
                created_at=str(wsi.get("started_at") or ""),
            ))
    except Exception as e:
        logger.warning("inbox workflows query failed: %s", e)

    # ── 4. Not-started course enrollments ─────────────────────────────────────
    try:
        ce_rows = rows(
            conn,
            """
            SELECT
                ce.id,
                ce.created_at,
                ce.status,
                c.title                     AS course_title,
                c.description               AS course_description,
                c.is_mandatory,
                c.estimated_duration_mins
            FROM course_enrollments ce
            LEFT JOIN courses c ON c.id = ce.course_id
            WHERE ce.user_id = %s
              AND ce.organisation_id = %s
              AND ce.status = 'not_started'
              AND ce.is_deleted = FALSE
            """,
            (user_id, org_id),
        )
        for ce in ce_rows:
            items.append(InboxItem(
                kind="course",
                id=str(ce["id"]),
                title=ce.get("course_title") or "Training course",
                description=_trunc(ce.get("course_description")),
                is_mandatory=bool(ce.get("is_mandatory")),
                created_at=str(ce.get("created_at") or ""),
            ))
    except Exception as e:
        logger.warning("inbox courses query failed: %s", e)

    # ── 5. Unacknowledged announcements ───────────────────────────────────────
    try:
        ann_rows = rows(
            conn,
            """
            SELECT id, title, body, target_roles, target_location_ids, created_at
            FROM announcements
            WHERE organisation_id = %s
              AND requires_acknowledgement = TRUE
              AND is_deleted = FALSE
            """,
            (org_id,),
        )
        ack_rows = rows(
            conn,
            """
            SELECT announcement_id
            FROM announcement_receipts
            WHERE user_id = %s
              AND acknowledged_at IS NOT NULL
            """,
            (user_id,),
        )
        acked_ids = {str(a["announcement_id"]) for a in ack_rows}

        for ann in ann_rows:
            if str(ann["id"]) in acked_ids:
                continue
            target_roles = ann.get("target_roles") or []
            target_locs = ann.get("target_location_ids") or []
            # Role filter: if restricted, user must be in the list
            if target_roles and user_role not in target_roles:
                continue
            # Location filter: if restricted and user has a location, must match
            if target_locs and user_location_id and str(user_location_id) not in [str(x) for x in target_locs]:
                continue
            items.append(InboxItem(
                kind="announcement",
                id=str(ann["id"]),
                title=ann.get("title") or "Announcement",
                description=_trunc(ann.get("body"), 100),
                created_at=str(ann.get("created_at") or ""),
            ))
    except Exception as e:
        logger.warning("inbox announcements query failed: %s", e)

    # ── 6. Open issues ────────────────────────────────────────────────────────
    # Staff:              only issues directly assigned to them
    # Manager:            assigned to me  OR  (unassigned AND at my location)
    # Admin/super_admin:  assigned to me  OR  any unassigned (org-wide)
    try:
        base_params: list = [org_id]

        if user_role in ("manager", "admin", "super_admin"):
            if user_role == "manager" and user_location_id:
                # Assigned to me  OR  (unassigned AND at my location)
                iss_sql = """
                    SELECT
                        i.id,
                        i.title,
                        i.description,
                        i.priority,
                        i.status,
                        i.due_at,
                        i.created_at,
                        i.is_deleted,
                        i.assigned_to,
                        i.location_id,
                        l.name AS location_name
                    FROM issues i
                    LEFT JOIN locations l ON l.id = i.location_id
                    WHERE i.organisation_id = %s
                      AND i.status NOT IN ('resolved', 'verified_closed')
                      AND i.is_deleted = FALSE
                      AND (
                            i.assigned_to = %s
                            OR (i.assigned_to IS NULL AND i.location_id = %s)
                          )
                """
                base_params.extend([user_id, user_location_id])
            else:
                # admin / super_admin: assigned to me OR any unassigned (org-wide)
                iss_sql = """
                    SELECT
                        i.id,
                        i.title,
                        i.description,
                        i.priority,
                        i.status,
                        i.due_at,
                        i.created_at,
                        i.is_deleted,
                        i.assigned_to,
                        i.location_id,
                        l.name AS location_name
                    FROM issues i
                    LEFT JOIN locations l ON l.id = i.location_id
                    WHERE i.organisation_id = %s
                      AND i.status NOT IN ('resolved', 'verified_closed')
                      AND i.is_deleted = FALSE
                      AND (i.assigned_to = %s OR i.assigned_to IS NULL)
                """
                base_params.append(user_id)
        else:
            # Staff: only issues explicitly assigned to them
            iss_sql = """
                SELECT
                    i.id,
                    i.title,
                    i.description,
                    i.priority,
                    i.status,
                    i.due_at,
                    i.created_at,
                    i.is_deleted,
                    i.assigned_to,
                    i.location_id,
                    l.name AS location_name
                FROM issues i
                LEFT JOIN locations l ON l.id = i.location_id
                WHERE i.organisation_id = %s
                  AND i.status NOT IN ('resolved', 'verified_closed')
                  AND i.is_deleted = FALSE
                  AND i.assigned_to = %s
            """
            base_params.append(user_id)

        iss_rows = rows(conn, iss_sql, tuple(base_params))
        seen_iss_ids: set = set()
        for iss in iss_rows:
            if iss.get("is_deleted"):
                continue
            iss_id = str(iss["id"])
            if iss_id in seen_iss_ids:
                continue
            seen_iss_ids.add(iss_id)
            desc = iss.get("location_name") or _trunc(iss.get("description"))
            items.append(InboxItem(
                kind="issue",
                id=iss_id,
                title=iss.get("title") or "Issue",
                description=desc,
                priority=iss.get("priority"),
                due_at=str(iss["due_at"]) if iss.get("due_at") else None,
                is_overdue=_is_overdue(str(iss["due_at"]) if iss.get("due_at") else None),
                created_at=str(iss.get("created_at") or ""),
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
            sc_params: list = [org_id]
            sc_location_filter = ""
            if user_role == "manager" and user_location_id:
                sc_location_filter = "AND s.location_id = %s"
                sc_params.append(user_location_id)

            sc_rows = rows(
                conn,
                f"""
                SELECT
                    osc.id,
                    osc.claimed_at,
                    osc.status,
                    s.id            AS shift_id,
                    s.start_at      AS shift_start_at,
                    s.location_id   AS shift_location_id,
                    l.name          AS location_name,
                    p.full_name     AS claimer_name
                FROM open_shift_claims osc
                JOIN shifts s ON s.id = osc.shift_id
                LEFT JOIN locations l ON l.id = s.location_id
                LEFT JOIN profiles p ON p.id = osc.claimed_by
                WHERE osc.status = 'pending'
                  AND s.organisation_id = %s
                  {sc_location_filter}
                """,
                tuple(sc_params),
            )
            for sc in sc_rows:
                loc_name = sc.get("location_name")
                claimer_name = sc.get("claimer_name") or "Staff member"
                start_str = sc.get("shift_start_at")
                shift_date = ""
                if start_str:
                    try:
                        dt = datetime.fromisoformat(str(start_str).replace("Z", "+00:00"))
                        shift_date = dt.strftime("%-d %b, %-I:%M %p")
                    except Exception:
                        pass
                items.append(InboxItem(
                    kind="shift_claim",
                    id=str(sc["id"]),
                    title=f"Shift claim: {claimer_name}",
                    description=f"{loc_name} · {shift_date}" if shift_date else loc_name,
                    created_at=str(sc.get("claimed_at") or ""),
                ))
        except Exception as e:
            logger.warning("inbox shift_claims query failed: %s", e)

        # ── 8. Shift swaps awaiting manager approval ──────────────────────────
        try:
            ss_params: list = [org_id]
            ss_location_filter = ""
            if user_role == "manager" and user_location_id:
                ss_location_filter = "AND s.location_id = %s"
                ss_params.append(user_location_id)

            ss_rows = rows(
                conn,
                f"""
                SELECT
                    ssr.id,
                    ssr.created_at,
                    s.start_at      AS shift_start_at,
                    s.location_id   AS shift_location_id,
                    l.name          AS location_name,
                    p.full_name     AS requester_name
                FROM shift_swap_requests ssr
                JOIN shifts s ON s.id = ssr.shift_id
                LEFT JOIN locations l ON l.id = s.location_id
                LEFT JOIN profiles p ON p.id = ssr.requested_by
                WHERE ssr.status = 'pending_manager'
                  AND ssr.organisation_id = %s
                  {ss_location_filter}
                """,
                tuple(ss_params),
            )
            for ss in ss_rows:
                loc_name = ss.get("location_name")
                req_name = ss.get("requester_name") or "Staff member"
                items.append(InboxItem(
                    kind="shift_swap",
                    id=str(ss["id"]),
                    title="Shift swap request",
                    description=f"{loc_name} · from {req_name}" if loc_name else f"From {req_name}",
                    created_at=str(ss.get("created_at") or ""),
                ))
        except Exception as e:
            logger.warning("inbox shift_swaps query failed: %s", e)

        # ── 9. Leave requests this manager needs to approve ───────────────────
        # For manager: requests from staff who report to this user (reports_to = user_id)
        # For admin / super_admin: all pending requests in the org
        try:
            if user_role == "manager":
                # Find direct reports first
                report_rows = rows(
                    conn,
                    """
                    SELECT id FROM profiles
                    WHERE reports_to = %s AND is_deleted = FALSE
                    """,
                    (user_id,),
                )
                report_ids = [str(r["id"]) for r in report_rows]
                if report_ids:
                    lr_rows = rows(
                        conn,
                        """
                        SELECT
                            lr.id,
                            lr.leave_type,
                            lr.start_date,
                            lr.end_date,
                            lr.created_at,
                            p.full_name AS requester_name
                        FROM leave_requests lr
                        LEFT JOIN profiles p ON p.id = lr.user_id
                        WHERE lr.status = 'pending'
                          AND lr.organisation_id = %s
                          AND lr.user_id = ANY(%s::uuid[])
                        """,
                        (org_id, report_ids),
                    )
                else:
                    lr_rows = []
            else:
                # admin / super_admin — all pending in org
                lr_rows = rows(
                    conn,
                    """
                    SELECT
                        lr.id,
                        lr.leave_type,
                        lr.start_date,
                        lr.end_date,
                        lr.created_at,
                        p.full_name AS requester_name
                    FROM leave_requests lr
                    LEFT JOIN profiles p ON p.id = lr.user_id
                    WHERE lr.status = 'pending'
                      AND lr.organisation_id = %s
                    """,
                    (org_id,),
                )
            for lr in lr_rows:
                req_name = lr.get("requester_name") or "Staff member"
                leave_type = (lr.get("leave_type") or "leave").replace("_", " ").title()
                start = str(lr.get("start_date") or "")
                items.append(InboxItem(
                    kind="leave_request",
                    id=str(lr["id"]),
                    title=f"Leave request: {req_name}",
                    description=f"{leave_type} · from {start}" if start else leave_type,
                    created_at=str(lr.get("created_at") or ""),
                ))
        except Exception as e:
            logger.warning("inbox leave_requests query failed: %s", e)

        # ── 10. Form submissions awaiting manager review ──────────────────────
        try:
            fs_params: list = [org_id]
            fs_location_filter = ""
            if user_role == "manager" and user_location_id:
                fs_location_filter = "AND fs.location_id = %s"
                fs_params.append(user_location_id)

            fs_rows = rows(
                conn,
                f"""
                SELECT
                    fs.id,
                    fs.submitted_at,
                    fs.location_id,
                    ft.title        AS template_title,
                    ft.type         AS template_type,
                    p.full_name     AS submitter_name
                FROM form_submissions fs
                JOIN form_templates ft ON ft.id = fs.form_template_id
                LEFT JOIN profiles p ON p.id = fs.submitted_by
                WHERE fs.status = 'submitted'
                  AND ft.organisation_id = %s
                  {fs_location_filter}
                """,
                tuple(fs_params),
            )
            for fs in fs_rows:
                sub_name = fs.get("submitter_name") or "Staff member"
                items.append(InboxItem(
                    kind="form_review",
                    id=str(fs["id"]),
                    title=fs.get("template_title") or "Form submission",
                    description=f"Submitted by {sub_name}",
                    form_type=fs.get("template_type"),
                    created_at=str(fs.get("submitted_at") or ""),
                ))
        except Exception as e:
            logger.warning("inbox form_reviews query failed: %s", e)

        # ── 11. Corrective action plans pending review ────────────────────────
        try:
            cap_params: list = [org_id]
            cap_location_filter = ""
            if user_role == "manager" and user_location_id:
                cap_location_filter = "AND fs.location_id = %s"
                cap_params.append(user_location_id)

            cap_rows = rows(
                conn,
                f"""
                SELECT
                    cap.id,
                    cap.created_at,
                    ft.title AS template_title
                FROM corrective_action_plans cap
                JOIN form_submissions fs ON fs.id = cap.form_submission_id
                JOIN form_templates ft ON ft.id = fs.form_template_id
                WHERE cap.status = 'pending_review'
                  AND ft.organisation_id = %s
                  {cap_location_filter}
                """,
                tuple(cap_params),
            )
            for cap in cap_rows:
                items.append(InboxItem(
                    kind="cap",
                    id=str(cap["id"]),
                    title=f"CAP: {cap.get('template_title') or 'Audit'}",
                    description="Failed audit — review corrective action plan",
                    created_at=str(cap.get("created_at") or ""),
                ))
        except Exception as e:
            logger.warning("inbox caps query failed: %s", e)

    # ── Sort: overdue ASC → upcoming ASC → no due date DESC ───────────────────
    overdue  = sorted([i for i in items if i.is_overdue],               key=lambda x: x.due_at or "")
    upcoming = sorted([i for i in items if not i.is_overdue and i.due_at], key=lambda x: x.due_at or "")
    no_due   = sorted([i for i in items if not i.due_at],               key=lambda x: x.created_at, reverse=True)

    sorted_items = overdue + upcoming + no_due
    return InboxResponse(items=sorted_items, total=len(sorted_items))
