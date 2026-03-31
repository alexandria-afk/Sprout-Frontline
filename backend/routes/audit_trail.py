"""
Audit Trail API — /api/v1/settings/audit-trail
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from dependencies import require_manager_or_above
from services.supabase_client import get_supabase

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
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()
    events: list[dict] = []

    # ── 1. Task status history ────────────────────────────────────────────────
    if entity_type is None or entity_type == "task":
        try:
            res = (
                db.table("task_status_history")
                .select(
                    "id, task_id, old_status, new_status, changed_at, changed_by, "
                    "tasks!inner(title, organisation_id), "
                    "profiles!task_status_history_changed_by_fkey(full_name)"
                )
                .eq("tasks.organisation_id", org_id)
                .execute()
            )
            for row in res.data or []:
                task = row.get("tasks") or {}
                profile = row.get("profiles") or {}
                old_s = row.get("old_status") or "unknown"
                new_s = row.get("new_status") or "unknown"
                events.append({
                    "id": _safe_str(row.get("id")),
                    "event_type": "task_status_changed",
                    "entity_type": "task",
                    "entity_id": _safe_str(row.get("task_id")),
                    "entity_title": task.get("title") or "Untitled Task",
                    "actor_name": profile.get("full_name") or "Unknown",
                    "actor_id": _safe_str(row.get("changed_by")),
                    "description": f"Status changed from {old_s} to {new_s}",
                    "timestamp": _safe_str(row.get("changed_at")),
                    "metadata": {"old_status": old_s, "new_status": new_s},
                })
        except Exception:
            pass  # Table may not exist yet; skip gracefully

    # ── 2. Issue status history ───────────────────────────────────────────────
    if entity_type is None or entity_type == "issue":
        try:
            res = (
                db.table("issue_status_history")
                .select(
                    "id, issue_id, old_status, new_status, changed_at, changed_by, "
                    "issues!inner(title, organisation_id), "
                    "profiles!issue_status_history_changed_by_fkey(full_name)"
                )
                .eq("issues.organisation_id", org_id)
                .execute()
            )
            for row in res.data or []:
                issue = row.get("issues") or {}
                profile = row.get("profiles") or {}
                old_s = row.get("old_status") or "unknown"
                new_s = row.get("new_status") or "unknown"
                events.append({
                    "id": _safe_str(row.get("id")),
                    "event_type": "issue_status_changed",
                    "entity_type": "issue",
                    "entity_id": _safe_str(row.get("issue_id")),
                    "entity_title": issue.get("title") or "Untitled Issue",
                    "actor_name": profile.get("full_name") or "Unknown",
                    "actor_id": _safe_str(row.get("changed_by")),
                    "description": f"Status changed from {old_s} to {new_s}",
                    "timestamp": _safe_str(row.get("changed_at")),
                    "metadata": {"old_status": old_s, "new_status": new_s},
                })
        except Exception:
            pass

    # ── 3. Form submissions ───────────────────────────────────────────────────
    if entity_type is None or entity_type == "form":
        try:
            res = (
                db.table("form_submissions")
                .select(
                    "id, form_template_id, submitted_at, submitted_by, "
                    "form_templates!inner(title, organisation_id), "
                    "profiles!form_submissions_submitted_by_fkey(full_name)"
                )
                .eq("form_templates.organisation_id", org_id)
                .execute()
            )
            for row in res.data or []:
                template = row.get("form_templates") or {}
                profile = row.get("profiles") or {}
                title = template.get("title") or "Untitled Form"
                events.append({
                    "id": _safe_str(row.get("id")),
                    "event_type": "form_submitted",
                    "entity_type": "form",
                    "entity_id": _safe_str(row.get("form_template_id")),
                    "entity_title": title,
                    "actor_name": profile.get("full_name") or "Unknown",
                    "actor_id": _safe_str(row.get("submitted_by")),
                    "description": f"Form submitted: {title}",
                    "timestamp": _safe_str(row.get("submitted_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 4. Workflow instances ─────────────────────────────────────────────────
    if entity_type is None or entity_type == "workflow":
        try:
            res = (
                db.table("workflow_instances")
                .select(
                    "id, definition_id, triggered_at, triggered_by, organisation_id, "
                    "workflow_definitions!inner(name, organisation_id), "
                    "profiles!workflow_instances_triggered_by_fkey(full_name)"
                )
                .eq("organisation_id", org_id)
                .execute()
            )
            for row in res.data or []:
                definition = row.get("workflow_definitions") or {}
                profile = row.get("profiles") or {}
                name = definition.get("name") or "Untitled Workflow"
                events.append({
                    "id": _safe_str(row.get("id")),
                    "event_type": "workflow_triggered",
                    "entity_type": "workflow",
                    "entity_id": _safe_str(row.get("definition_id")),
                    "entity_title": name,
                    "actor_name": profile.get("full_name") or "Unknown",
                    "actor_id": _safe_str(row.get("triggered_by")),
                    "description": f"Workflow triggered: {name}",
                    "timestamp": _safe_str(row.get("triggered_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 5. Workflow definitions (created — includes provisioned workflows) ────
    if entity_type is None or entity_type == "workflow":
        try:
            res = (
                db.table("workflow_definitions")
                .select("id, name, created_at, created_by, organisation_id")
                .eq("organisation_id", org_id)
                .execute()
            )
            # Build a set of definition_ids that already appear as triggered instances
            # so we can label the event correctly without duplicating the card.
            for row in res.data or []:
                name = row.get("name") or "Untitled Workflow"
                events.append({
                    "id": f"wfdef-{_safe_str(row.get('id'))}",
                    "event_type": "workflow_created",
                    "entity_type": "workflow",
                    "entity_id": _safe_str(row.get("id")),
                    "entity_title": name,
                    "actor_name": "System",
                    "actor_id": _safe_str(row.get("created_by")),
                    "description": f"Workflow created: {name}",
                    "timestamp": _safe_str(row.get("created_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 6. Form templates (created — includes provisioned forms) ─────────────
    if entity_type is None or entity_type == "form":
        try:
            res = (
                db.table("form_templates")
                .select("id, title, created_at, created_by, organisation_id")
                .eq("organisation_id", org_id)
                .execute()
            )
            for row in res.data or []:
                title = row.get("title") or "Untitled Form"
                events.append({
                    "id": f"fmtpl-{_safe_str(row.get('id'))}",
                    "event_type": "form_created",
                    "entity_type": "form",
                    "entity_id": _safe_str(row.get("id")),
                    "entity_title": title,
                    "actor_name": "System",
                    "actor_id": _safe_str(row.get("created_by")),
                    "description": f"Form created: {title}",
                    "timestamp": _safe_str(row.get("created_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 7. Published shifts ───────────────────────────────────────────────────
    if entity_type is None or entity_type == "shift":
        try:
            res = (
                db.table("shifts")
                .select(
                    "id, role, start_at, location_id, status, created_at, created_by, "
                    "profiles!shifts_created_by_fkey(full_name)"
                )
                .eq("organisation_id", org_id)
                .eq("status", "published")
                .order("created_at", desc=True)
                .limit(200)
                .execute()
            )
            for row in res.data or []:
                profile = row.get("profiles") or {}
                role = row.get("role") or "Shift"
                start = (row.get("start_at") or "")[:10]
                events.append({
                    "id": f"shift-{_safe_str(row.get('id'))}",
                    "event_type": "shift_published",
                    "entity_type": "shift",
                    "entity_id": _safe_str(row.get("id")),
                    "entity_title": f"{role} — {start}",
                    "actor_name": profile.get("full_name") or "Manager",
                    "actor_id": _safe_str(row.get("created_by")),
                    "description": f"Shift published: {role} on {start}",
                    "timestamp": _safe_str(row.get("created_at")),
                    "metadata": {"status": "published"},
                })
        except Exception:
            pass

    # ── 8. Training completions ───────────────────────────────────────────────
    if entity_type is None or entity_type == "training":
        try:
            res = (
                db.table("course_enrollments")
                .select(
                    "id, course_id, completed_at, user_id, "
                    "courses!inner(title, organisation_id), "
                    "profiles!course_enrollments_user_id_fkey(full_name)"
                )
                .eq("courses.organisation_id", org_id)
                .not_.is_("completed_at", "null")
                .execute()
            )
            for row in res.data or []:
                course = row.get("courses") or {}
                profile = row.get("profiles") or {}
                title = course.get("title") or "Course"
                events.append({
                    "id": f"enroll-{_safe_str(row.get('id'))}",
                    "event_type": "training_completed",
                    "entity_type": "training",
                    "entity_id": _safe_str(row.get("course_id")),
                    "entity_title": title,
                    "actor_name": profile.get("full_name") or "Staff",
                    "actor_id": _safe_str(row.get("user_id")),
                    "description": f"Training completed: {title}",
                    "timestamp": _safe_str(row.get("completed_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 9. Announcements ─────────────────────────────────────────────────────
    if entity_type is None or entity_type == "announcement":
        try:
            res = (
                db.table("announcements")
                .select(
                    "id, title, created_at, created_by, organisation_id, "
                    "profiles!announcements_created_by_fkey(full_name)"
                )
                .eq("organisation_id", org_id)
                .execute()
            )
            for row in res.data or []:
                profile = row.get("profiles") or {}
                title = row.get("title") or "Announcement"
                events.append({
                    "id": f"ann-{_safe_str(row.get('id'))}",
                    "event_type": "announcement_created",
                    "entity_type": "announcement",
                    "entity_id": _safe_str(row.get("id")),
                    "entity_title": title,
                    "actor_name": profile.get("full_name") or "Manager",
                    "actor_id": _safe_str(row.get("created_by")),
                    "description": f"Announcement posted: {title}",
                    "timestamp": _safe_str(row.get("created_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 10. Badge awards ──────────────────────────────────────────────────────
    if entity_type is None or entity_type == "badge":
        try:
            res = (
                db.table("user_badges")
                .select(
                    "id, badge_config_id, awarded_at, user_id, "
                    "badge_configs!inner(name, organisation_id), "
                    "profiles!user_badges_user_id_fkey(full_name)"
                )
                .eq("badge_configs.organisation_id", org_id)
                .execute()
            )
            for row in res.data or []:
                badge = row.get("badge_configs") or {}
                profile = row.get("profiles") or {}
                name = badge.get("name") or "Badge"
                events.append({
                    "id": f"badge-{_safe_str(row.get('id'))}",
                    "event_type": "badge_awarded",
                    "entity_type": "badge",
                    "entity_id": _safe_str(row.get("badge_config_id")),
                    "entity_title": name,
                    "actor_name": profile.get("full_name") or "Staff",
                    "actor_id": _safe_str(row.get("user_id")),
                    "description": f"Badge awarded: {name}",
                    "timestamp": _safe_str(row.get("awarded_at")),
                    "metadata": {},
                })
        except Exception:
            pass

    # ── 11. Onboarding provisioning events ───────────────────────────────────
    if entity_type is None:
        try:
            res = (
                db.table("onboarding_sessions")
                .select("id, completed_at, launch_progress, company_name, industry_code")
                .eq("organisation_id", org_id)
                .eq("status", "completed")
                .execute()
            )
            for row in res.data or []:
                progress = row.get("launch_progress") or {}
                steps = progress.get("steps_completed") or []
                company = row.get("company_name") or "your company"
                description = f"Workspace provisioned for {company}: {', '.join(steps[:5])}" if steps else f"Workspace provisioned for {company}"
                events.append({
                    "id": _safe_str(row.get("id")),
                    "event_type": "workspace_provisioned",
                    "entity_type": "onboarding",
                    "entity_id": _safe_str(row.get("id")),
                    "entity_title": f"Workspace — {company}",
                    "actor_name": "Onboarding Wizard",
                    "actor_id": "",
                    "description": description,
                    "timestamp": _safe_str(row.get("completed_at")),
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
