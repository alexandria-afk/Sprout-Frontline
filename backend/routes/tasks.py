"""
Tasks API — /api/v1/tasks
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from dependencies import get_current_user, require_manager_or_above, paginate, get_db
from services.db import rows as db_rows
from models.tasks import (
    CreateTaskRequest,
    UpdateTaskRequest,
    UpdateTaskStatusRequest,
    AddAssigneeRequest,
    PostMessageRequest,
    AddAttachmentRequest,
    AnnotateAttachmentRequest,
    CreateTaskTemplateRequest,
    UpdateTaskTemplateRequest,
    SpawnTaskRequest,
)
from services.task_service import TaskService

router = APIRouter()


# ── Templates ─────────────────────────────────────────────────────────────────

@router.get("/templates")
async def list_templates(
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await TaskService.list_templates(conn, org_id)


@router.post("/templates")
async def create_template(
    body: CreateTaskTemplateRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    created_by = current_user["sub"]
    return await TaskService.create_template(conn, body, org_id, created_by)


@router.put("/templates/{template_id}")
async def update_template(
    template_id: UUID,
    body: UpdateTaskTemplateRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await TaskService.update_template(conn, str(template_id), org_id, body)


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    await TaskService.delete_template(conn, str(template_id), org_id)
    return {"ok": True}


@router.post("/templates/{template_id}/spawn")
async def spawn_task(
    template_id: UUID,
    body: SpawnTaskRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    created_by = current_user["sub"]
    return await TaskService.spawn_from_template(conn, str(template_id), org_id, created_by, body)


# ── My Tasks ──────────────────────────────────────────────────────────────────

@router.get("/my")
async def my_tasks(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await TaskService.my_tasks(conn, user_id, org_id)


# ── Summary ───────────────────────────────────────────────────────────────────

@router.get("/summary")
async def task_summary(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    role = (current_user.get("app_metadata") or {}).get("role", "staff")
    is_manager = role in ("super_admin", "admin", "manager")
    scoped_user_id = None if is_manager else current_user["sub"]
    return await TaskService.summary(conn, org_id, user_id=scoped_user_id)


# ── Tasks CRUD ────────────────────────────────────────────────────────────────

@router.post("/")
async def create_task(
    body: CreateTaskRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    created_by = current_user["sub"]
    return await TaskService.create_task(conn, body, org_id, created_by)


@router.get("")
@router.get("/")
async def list_tasks(
    pagination: dict = Depends(paginate),
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None),
    overdue: Optional[bool] = Query(None),
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    my_team: Optional[bool] = Query(None),
    my_tasks: Optional[bool] = Query(None),
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]

    role = (current_user.get("app_metadata") or {}).get("role", "staff")
    manager_location_id = (current_user.get("app_metadata") or {}).get("location_id")

    # Resolve team member IDs for manager view
    team_user_ids: Optional[list] = None
    if my_team:
        profile_rows = db_rows(
            conn,
            "SELECT id FROM profiles WHERE reports_to = %s AND is_deleted = FALSE",
            (user_id,),
        )
        team_user_ids = [r["id"] for r in profile_rows] + [user_id]
    elif role == "manager" and manager_location_id and not assigned_to and not location_id:
        # Auto-scope: show tasks assigned to any staff at manager's location.
        profile_rows = db_rows(
            conn,
            "SELECT id FROM profiles WHERE location_id = %s AND is_deleted = FALSE",
            (str(manager_location_id),),
        )
        team_user_ids = [r["id"] for r in profile_rows]

    # For staff: only tasks assigned to them
    if my_tasks and not assigned_to:
        assigned_to = user_id

    return await TaskService.list_tasks(
        conn=conn,
        org_id=org_id,
        user_id=user_id,
        status=status,
        priority=priority,
        assigned_to=assigned_to,
        location_id=location_id,
        source_type=source_type,
        overdue=overdue,
        from_dt=from_dt,
        to_dt=to_dt,
        page=pagination["page"],
        page_size=pagination["page_size"],
        team_user_ids=team_user_ids,
    )


@router.get("/unread-count")
async def unread_count(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    count = await TaskService.unread_task_count(conn, org_id, user_id)
    return {"count": count}


@router.get("/{task_id}")
async def get_task(
    task_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await TaskService.get_task(conn, str(task_id), org_id)


@router.put("/{task_id}")
async def update_task(
    task_id: UUID,
    body: UpdateTaskRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await TaskService.update_task(conn, str(task_id), org_id, body)


@router.put("/{task_id}/status")
async def update_task_status(
    task_id: UUID,
    body: UpdateTaskStatusRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await TaskService.update_status(conn, str(task_id), org_id, body, user_id)


# ── Assignees ─────────────────────────────────────────────────────────────────

@router.post("/{task_id}/assignees")
async def add_assignee(
    task_id: UUID,
    body: AddAssigneeRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await TaskService.add_assignee(conn, str(task_id), org_id, body)


@router.delete("/{task_id}/assignees/{assignee_id}")
async def remove_assignee(
    task_id: UUID,
    assignee_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    await TaskService.remove_assignee(conn, str(task_id), str(assignee_id), org_id)
    return {"ok": True}


# ── Messages ──────────────────────────────────────────────────────────────────

@router.post("/{task_id}/messages")
async def post_message(
    task_id: UUID,
    body: PostMessageRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await TaskService.post_message(conn, str(task_id), org_id, user_id, body)


@router.post("/{task_id}/read")
async def mark_task_read(
    task_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    await TaskService.mark_task_read(conn, str(task_id), org_id, user_id)
    return {"ok": True}


# ── Attachments ───────────────────────────────────────────────────────────────

@router.post("/{task_id}/attachments")
async def add_attachment(
    task_id: UUID,
    body: AddAttachmentRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await TaskService.add_attachment(conn, str(task_id), org_id, user_id, body)


@router.put("/{task_id}/attachments/{attachment_id}/annotate")
async def annotate_attachment(
    task_id: UUID,
    attachment_id: UUID,
    body: AnnotateAttachmentRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await TaskService.annotate_attachment(conn, str(task_id), str(attachment_id), org_id, body)
