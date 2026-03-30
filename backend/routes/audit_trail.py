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
    entity_type: Optional[str] = Query(None, description="Filter by entity type: task, issue, form, workflow, incident"),
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

    # ── 5. Onboarding provisioning events ────────────────────────────────────
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
