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
    kind: Literal["task", "form", "workflow", "course", "announcement", "issue"]
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
                "id,due_at,created_at,completed,is_deleted,"
                "form_templates(title,type,description)"
            )
            .eq("user_id", user_id)
            .eq("organisation_id", org_id)
            .eq("completed", False)
            .eq("is_deleted", False)
            .execute()
        )
        for fa in (fa_resp.data or []):
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
            sb.table("announcement_acknowledgements")
            .select("announcement_id")
            .eq("user_id", user_id)
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

    # ── 6. Open issues assigned to user ───────────────────────────────────────
    try:
        iss_resp = (
            sb.table("issues")
            .select(
                "id,title,description,priority,status,due_at,created_at,is_deleted,"
                "locations(name)"
            )
            .eq("assigned_to", user_id)
            .eq("organisation_id", org_id)
            .not_.in_("status", ["resolved", "verified_closed"])
            .eq("is_deleted", False)
            .execute()
        )
        for iss in (iss_resp.data or []):
            loc = iss.get("locations")
            loc_name = loc.get("name") if isinstance(loc, dict) else None
            desc = loc_name or _trunc(iss.get("description"))
            items.append(InboxItem(
                kind="issue",
                id=iss["id"],
                title=iss.get("title") or "Issue",
                description=desc,
                priority=iss.get("priority"),
                due_at=iss.get("due_at"),
                is_overdue=_is_overdue(iss.get("due_at")),
                created_at=iss.get("created_at") or "",
            ))
    except Exception as e:
        logger.warning("inbox issues query failed: %s", e)

    # ── Sort: overdue ASC → upcoming ASC → no due date DESC ───────────────────
    overdue  = sorted([i for i in items if i.is_overdue],              key=lambda x: x.due_at or "")
    upcoming = sorted([i for i in items if not i.is_overdue and i.due_at], key=lambda x: x.due_at or "")
    no_due   = sorted([i for i in items if not i.due_at],              key=lambda x: x.created_at, reverse=True)

    sorted_items = overdue + upcoming + no_due
    return InboxResponse(items=sorted_items, total=len(sorted_items))
