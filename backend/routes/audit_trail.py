"""
Audit Trail API — /api/v1/settings/audit-trail
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from dependencies import get_db, require_manager_or_above
from services.db import rows

router = APIRouter()


def _safe_str(val) -> str:
    return str(val) if val is not None else ""


@router.get("/audit-trail")
async def get_audit_trail(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=200, description="Results per page"),
    entity_type: Optional[str] = Query(
        None,
        description=(
            "Filter by entity type: task, issue, form, workflow, "
            "shift, training, announcement, badge, incident"
        ),
    ),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    events: list[dict] = []

    # ── 1. Task status history ────────────────────────────────────────────────
    if entity_type is None or entity_type == "task":
        try:
            result = rows(
                conn,
                """
                SELECT
                    tsh.id,
                    tsh.task_id,
                    tsh.old_status,
                    tsh.new_status,
                    tsh.changed_at,
                    tsh.changed_by,
                    t.title       AS task_title,
                    p.full_name   AS actor_name
                FROM task_status_history tsh
                JOIN tasks t ON t.id = tsh.task_id
                LEFT JOIN profiles p ON p.id = tsh.changed_by
                WHERE t.organisation_id = %s
                """,
                (org_id,),
            )
            for r in result:
                old_s = r.get("old_status") or "unknown"
                new_s = r.get("new_status") or "unknown"
                events.append({
                    "id": _safe_str(r.get("id")),
                    "event_type": "task_status_changed",
                    "entity_type": "task",
                    "entity_id": _safe_str(r.get("task_id")),
                    "entity_title": r.get("task_title") or "Untitled Task",
                    "actor_name": r.get("actor_name") or "Unknown",
                    "actor_id": _safe_str(r.get("changed_by")),
                    "description": f"Status changed from {old_s} to {new_s}",
                    "timestamp": _safe_str(r.get("changed_at")),
                    "metadata": {"old_status": old_s, "new_status": new_s},
                })
        except Exception:
            pass  # Table may not exist yet; skip gracefully

    # ── 2. Issue status history ───────────────────────────────────────────────
    if entity_type is None or entity_type == "issue":
        try:
            result = rows(
                conn,
                """
                SELECT
                    ish.id,
                    ish.issue_id,
                    ish.old_status,
                    ish.new_status,
                    ish.changed_at,
                    ish.changed_by,
                    i.title       AS issue_title,
                    p.full_name   AS actor_name
                FROM issue_status_history ish
                JOIN issues i ON i.id = ish.issue_id
                LEFT JOIN profiles p ON p.id = ish.changed_by
                WHERE i.organisation_id = %s
                """,
                (org_id,),
            )
            for r in result:
                old_s = r.get("old_status") or "unknown"
                new_s = r.get("new_status") or "unknown"
                events.append({
                    "id": _safe_str(r.get("id")),
                    "event_type": "issue_status_changed",
                    "entity_type": "issue",
                    "entity_id": _safe_str(r.get("issue_id")),
                    "entity_title": r.get("issue_title") or "Untitled Issue",
                    "actor_name": r.get("actor_name") or "Unknown",
                    "actor_id": _safe_str(r.get("changed_by")),
                    "description": f"Status changed from {old_s} to {new_s}",
                    "timestamp": _safe_str(r.get("changed_at")),
                    "metadata": {"old_status": old_s, "new_status": new_s},
                })
        except Exception:
            pass

    # ── 3. Form submissions ───────────────────────────────────────────────────
    if entity_type is None or entity_type == "form":
        try:
            result = rows(
                conn,
                """
                SELECT
                    fs.id,
                    fs.form_template_id,
                    fs.submitted_at,
                    fs.submitted_by,
                    ft.title      AS template_title,
                    p.full_name   AS actor_name
                FROM form_submissions fs
                JOIN form_templates ft ON ft.id = fs.form_template_id
                LEFT JOIN profiles p ON p.id = fs.submitted_by
                WHERE ft.organisation_id = %s
                """,
                (org_id,),
            )
            for r in result:
                title = r.get("template_title") or "Untitled Form"
                events.append({
                    "id": _safe_str(r.get("id")),
                    "event_type": "form_submitted",
                    "entity_type": "form",
                    "entity_id": _safe_str(r.get("form_template_id")),
                    "entity_title": title,
                    "actor_name": r.get("actor_name") or "Unknown",
                    "actor_id": _safe_str(r.get("submitted_by")),
                    "description": f"Form submitted: {title}",
                    "timestamp": _safe_str(r.get("submitted_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 4. Workflow instances ─────────────────────────────────────────────────
    if entity_type is None or entity_type == "workflow":
        try:
            result = rows(
                conn,
                """
                SELECT
                    wi.id,
                    wi.definition_id,
                    wi.triggered_at,
                    wi.triggered_by,
                    wd.name       AS workflow_name,
                    p.full_name   AS actor_name
                FROM workflow_instances wi
                JOIN workflow_definitions wd ON wd.id = wi.definition_id
                LEFT JOIN profiles p ON p.id = wi.triggered_by
                WHERE wi.organisation_id = %s
                """,
                (org_id,),
            )
            for r in result:
                name = r.get("workflow_name") or "Untitled Workflow"
                events.append({
                    "id": _safe_str(r.get("id")),
                    "event_type": "workflow_triggered",
                    "entity_type": "workflow",
                    "entity_id": _safe_str(r.get("definition_id")),
                    "entity_title": name,
                    "actor_name": r.get("actor_name") or "Unknown",
                    "actor_id": _safe_str(r.get("triggered_by")),
                    "description": f"Workflow triggered: {name}",
                    "timestamp": _safe_str(r.get("triggered_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 5. Workflow definitions (created — includes provisioned workflows) ────
    if entity_type is None or entity_type == "workflow":
        try:
            result = rows(
                conn,
                """
                SELECT id, name, created_at, created_by
                FROM workflow_definitions
                WHERE organisation_id = %s
                """,
                (org_id,),
            )
            for r in result:
                name = r.get("name") or "Untitled Workflow"
                events.append({
                    "id": f"wfdef-{_safe_str(r.get('id'))}",
                    "event_type": "workflow_created",
                    "entity_type": "workflow",
                    "entity_id": _safe_str(r.get("id")),
                    "entity_title": name,
                    "actor_name": "System",
                    "actor_id": _safe_str(r.get("created_by")),
                    "description": f"Workflow created: {name}",
                    "timestamp": _safe_str(r.get("created_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 6. Form templates (created — includes provisioned forms) ─────────────
    if entity_type is None or entity_type == "form":
        try:
            result = rows(
                conn,
                """
                SELECT id, title, created_at, created_by
                FROM form_templates
                WHERE organisation_id = %s
                """,
                (org_id,),
            )
            for r in result:
                title = r.get("title") or "Untitled Form"
                events.append({
                    "id": f"fmtpl-{_safe_str(r.get('id'))}",
                    "event_type": "form_created",
                    "entity_type": "form",
                    "entity_id": _safe_str(r.get("id")),
                    "entity_title": title,
                    "actor_name": "System",
                    "actor_id": _safe_str(r.get("created_by")),
                    "description": f"Form created: {title}",
                    "timestamp": _safe_str(r.get("created_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 7. Published shifts ───────────────────────────────────────────────────
    if entity_type is None or entity_type == "shift":
        try:
            result = rows(
                conn,
                """
                SELECT
                    s.id,
                    s.role,
                    s.start_at,
                    s.location_id,
                    s.status,
                    s.created_at,
                    s.created_by,
                    p.full_name   AS actor_name
                FROM shifts s
                LEFT JOIN profiles p ON p.id = s.created_by
                WHERE s.organisation_id = %s
                  AND s.status = 'published'
                ORDER BY s.created_at DESC
                LIMIT 200
                """,
                (org_id,),
            )
            for r in result:
                role = r.get("role") or "Shift"
                start = (str(r.get("start_at") or ""))[:10]
                events.append({
                    "id": f"shift-{_safe_str(r.get('id'))}",
                    "event_type": "shift_published",
                    "entity_type": "shift",
                    "entity_id": _safe_str(r.get("id")),
                    "entity_title": f"{role} — {start}",
                    "actor_name": r.get("actor_name") or "Manager",
                    "actor_id": _safe_str(r.get("created_by")),
                    "description": f"Shift published: {role} on {start}",
                    "timestamp": _safe_str(r.get("created_at")),
                    "metadata": {"status": "published"},
                })
        except Exception:
            pass

    # ── 8. Training completions ───────────────────────────────────────────────
    if entity_type is None or entity_type == "training":
        try:
            result = rows(
                conn,
                """
                SELECT
                    ce.id,
                    ce.course_id,
                    ce.completed_at,
                    ce.user_id,
                    c.title       AS course_title,
                    p.full_name   AS actor_name
                FROM course_enrollments ce
                JOIN courses c ON c.id = ce.course_id
                LEFT JOIN profiles p ON p.id = ce.user_id
                WHERE c.organisation_id = %s
                  AND ce.completed_at IS NOT NULL
                """,
                (org_id,),
            )
            for r in result:
                title = r.get("course_title") or "Course"
                events.append({
                    "id": f"enroll-{_safe_str(r.get('id'))}",
                    "event_type": "training_completed",
                    "entity_type": "training",
                    "entity_id": _safe_str(r.get("course_id")),
                    "entity_title": title,
                    "actor_name": r.get("actor_name") or "Staff",
                    "actor_id": _safe_str(r.get("user_id")),
                    "description": f"Training completed: {title}",
                    "timestamp": _safe_str(r.get("completed_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 9. Announcements ─────────────────────────────────────────────────────
    if entity_type is None or entity_type == "announcement":
        try:
            result = rows(
                conn,
                """
                SELECT
                    a.id,
                    a.title,
                    a.created_at,
                    a.created_by,
                    p.full_name   AS actor_name
                FROM announcements a
                LEFT JOIN profiles p ON p.id = a.created_by
                WHERE a.organisation_id = %s
                """,
                (org_id,),
            )
            for r in result:
                title = r.get("title") or "Announcement"
                events.append({
                    "id": f"ann-{_safe_str(r.get('id'))}",
                    "event_type": "announcement_created",
                    "entity_type": "announcement",
                    "entity_id": _safe_str(r.get("id")),
                    "entity_title": title,
                    "actor_name": r.get("actor_name") or "Manager",
                    "actor_id": _safe_str(r.get("created_by")),
                    "description": f"Announcement posted: {title}",
                    "timestamp": _safe_str(r.get("created_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 10. Badge awards ──────────────────────────────────────────────────────
    if entity_type is None or entity_type == "badge":
        try:
            result = rows(
                conn,
                """
                SELECT
                    ub.id,
                    ub.badge_config_id,
                    ub.awarded_at,
                    ub.user_id,
                    bc.name       AS badge_name,
                    p.full_name   AS actor_name
                FROM user_badges ub
                JOIN badge_configs bc ON bc.id = ub.badge_config_id
                LEFT JOIN profiles p ON p.id = ub.user_id
                WHERE bc.organisation_id = %s
                """,
                (org_id,),
            )
            for r in result:
                name = r.get("badge_name") or "Badge"
                events.append({
                    "id": f"badge-{_safe_str(r.get('id'))}",
                    "event_type": "badge_awarded",
                    "entity_type": "badge",
                    "entity_id": _safe_str(r.get("badge_config_id")),
                    "entity_title": name,
                    "actor_name": r.get("actor_name") or "Staff",
                    "actor_id": _safe_str(r.get("user_id")),
                    "description": f"Badge awarded: {name}",
                    "timestamp": _safe_str(r.get("awarded_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 11. Onboarding provisioning events ───────────────────────────────────
    if entity_type is None:
        try:
            result = rows(
                conn,
                """
                SELECT id, completed_at, launch_progress, company_name, industry_code
                FROM onboarding_sessions
                WHERE organisation_id = %s
                  AND status = 'completed'
                """,
                (org_id,),
            )
            for r in result:
                progress = r.get("launch_progress") or {}
                steps = progress.get("steps_completed") or []
                company = r.get("company_name") or "your company"
                description = (
                    f"Workspace provisioned for {company}: {', '.join(steps[:5])}"
                    if steps
                    else f"Workspace provisioned for {company}"
                )
                events.append({
                    "id": _safe_str(r.get("id")),
                    "event_type": "workspace_provisioned",
                    "entity_type": "onboarding",
                    "entity_id": _safe_str(r.get("id")),
                    "entity_title": f"Workspace — {company}",
                    "actor_name": "Onboarding Wizard",
                    "actor_id": "",
                    "description": description,
                    "timestamp": _safe_str(r.get("completed_at")),
                    "metadata": {"steps_completed": steps},
                })
        except Exception:
            pass

    # ── Merge, sort, paginate ─────────────────────────────────────────────────
    events.sort(key=lambda e: e["timestamp"] or "", reverse=True)

    total = len(events)
    offset = (page - 1) * page_size
    paginated = events[offset : offset + page_size]

    return {
        "data": paginated,
        "total": total,
        "page": page,
        "page_size": page_size,
    }
