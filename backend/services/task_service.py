from __future__ import annotations

import logging as _logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

_log = _logging.getLogger(__name__)

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
from services.supabase_client import get_supabase


class TaskService:

    # ── Templates ──────────────────────────────────────────────────────────────

    @staticmethod
    async def list_templates(org_id: str) -> list[dict]:
        db = get_supabase()
        resp = (
            db.table("task_templates")
            .select("*, profiles!created_by(full_name)")
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .order("created_at", desc=True)
            .execute()
        )
        return resp.data or []

    @staticmethod
    async def create_template(body: CreateTaskTemplateRequest, org_id: str, created_by: str) -> dict:
        db = get_supabase()
        data = {
            "organisation_id": org_id,
            "created_by": created_by,
            "title": body.title,
            "description": body.description,
            "priority": body.priority,
            "assign_to_role": body.assign_to_role,
            "recurrence": body.recurrence,
            "cron_expression": body.cron_expression,
            "is_active": body.is_active,
        }
        resp = db.table("task_templates").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to create task template")
        return resp.data[0]

    @staticmethod
    async def update_template(template_id: str, org_id: str, body: UpdateTaskTemplateRequest) -> dict:
        db = get_supabase()
        updates = body.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        resp = (
            db.table("task_templates")
            .update(updates)
            .eq("id", template_id)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Template not found")
        return resp.data[0]

    @staticmethod
    async def delete_template(template_id: str, org_id: str) -> None:
        db = get_supabase()
        db.table("task_templates").update({"is_deleted": True}).eq("id", template_id).eq("organisation_id", org_id).execute()

    @staticmethod
    async def spawn_from_template(template_id: str, org_id: str, created_by: str, body: SpawnTaskRequest) -> dict:
        db = get_supabase()
        tmpl_resp = db.table("task_templates").select("*").eq("id", template_id).eq("organisation_id", org_id).eq("is_deleted", False).execute()
        if not tmpl_resp.data:
            raise HTTPException(status_code=404, detail="Template not found")
        t = tmpl_resp.data[0]

        create_body = CreateTaskRequest(
            location_id=body.location_id,
            template_id=template_id,
            title=t["title"],
            description=t.get("description"),
            priority=t.get("priority", "medium"),
            due_at=body.due_at,
            recurrence=t.get("recurrence", "none"),
            assignee_user_ids=body.assignee_user_ids,
            assignee_roles=[t["assign_to_role"]] if t.get("assign_to_role") else [],
        )
        return await TaskService.create_task(create_body, org_id, created_by)

    # ── Tasks ──────────────────────────────────────────────────────────────────

    @staticmethod
    async def create_task(body: CreateTaskRequest, org_id: str, created_by: str) -> dict:
        db = get_supabase()

        task_data: dict = {
            "organisation_id": org_id,
            "created_by": created_by,
            "title": body.title,
            "priority": body.priority,
            "source_type": body.source_type,
            "recurrence": body.recurrence,
            "status": "pending",
        }
        if body.location_id:
            task_data["location_id"] = body.location_id
        if body.template_id:
            task_data["template_id"] = body.template_id
        if body.description:
            task_data["description"] = body.description
        if body.due_at:
            task_data["due_at"] = body.due_at.isoformat()
        if body.cron_expression:
            task_data["cron_expression"] = body.cron_expression
        if body.source_submission_id:
            task_data["source_submission_id"] = body.source_submission_id
        if body.source_field_id:
            task_data["source_field_id"] = body.source_field_id
        if body.cap_item_id:
            task_data["cap_item_id"] = body.cap_item_id

        resp = db.table("tasks").insert(task_data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to create task")
        task = resp.data[0]
        task_id = task["id"]

        # Insert assignees
        assignee_rows = []
        for uid in body.assignee_user_ids:
            assignee_rows.append({"task_id": task_id, "user_id": uid})
        for role in body.assignee_roles:
            assignee_rows.append({"task_id": task_id, "assign_role": role})
        if assignee_rows:
            db.table("task_assignees").insert(assignee_rows).execute()

        # Initial status history entry
        db.table("task_status_history").insert({
            "task_id": task_id,
            "changed_by": created_by,
            "previous_status": None,
            "new_status": "pending",
        }).execute()

        return task

    @staticmethod
    async def list_tasks(
        org_id: str,
        user_id: Optional[str] = None,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        assigned_to: Optional[str] = None,
        location_id: Optional[str] = None,
        source_type: Optional[str] = None,
        overdue: Optional[bool] = None,
        from_dt: Optional[datetime] = None,
        to_dt: Optional[datetime] = None,
        page: int = 1,
        page_size: int = 20,
        team_user_ids: Optional[list] = None,
    ) -> dict:
        db = get_supabase()

        query = (
            db.table("tasks")
            .select(
                "*, profiles!created_by(full_name), locations(name), "
                "task_assignees!left(id,user_id,assign_role,is_deleted,profiles(full_name)), "
                "task_messages!left(id,user_id,created_at,is_deleted)",
                count="exact",
            )
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
        )

        if status:
            query = query.eq("status", status)
        if priority:
            query = query.eq("priority", priority)
        if location_id:
            query = query.eq("location_id", location_id)
        if source_type:
            query = query.eq("source_type", source_type)
        if overdue:
            query = query.lt("due_at", datetime.now(timezone.utc).isoformat()).neq("status", "completed").neq("status", "cancelled")
        if from_dt:
            query = query.gte("created_at", from_dt.isoformat())
        if to_dt:
            query = query.lte("created_at", to_dt.isoformat())

        # Manager team view: tasks assigned to any direct report
        if team_user_ids:
            ta_resp = db.table("task_assignees").select("task_id").in_("user_id", team_user_ids).eq("is_deleted", False).execute()
            task_ids = list({r["task_id"] for r in (ta_resp.data or [])})
            if not task_ids:
                return {"items": [], "total_count": 0, "page": page, "page_size": page_size}
            query = query.in_("id", task_ids)
        elif assigned_to:
            # Filter by assigned user — need a subquery approach
            ta_resp = db.table("task_assignees").select("task_id").eq("user_id", assigned_to).eq("is_deleted", False).execute()
            task_ids = [r["task_id"] for r in (ta_resp.data or [])]
            if not task_ids:
                return {"items": [], "total_count": 0, "page": page, "page_size": page_size}
            query = query.in_("id", task_ids)

        offset = (page - 1) * page_size
        resp = query.order("created_at", desc=True).range(offset, offset + page_size - 1).execute()

        # Filter out deleted assignees/messages client-side (PostgREST can't filter nested rows)
        items = []
        for t in (resp.data or []):
            t["task_assignees"] = [a for a in (t.get("task_assignees") or []) if not a.get("is_deleted")]
            t["task_messages"] = [m for m in (t.get("task_messages") or []) if not m.get("is_deleted")]
            items.append(t)

        # Annotate unread_message_count per task for current user
        if user_id and items:
            task_ids = [t["id"] for t in items]
            try:
                reads_resp = (
                    db.table("task_message_reads")
                    .select("task_id, last_read_at")
                    .in_("task_id", task_ids)
                    .eq("user_id", user_id)
                    .execute()
                )
                reads_map = {r["task_id"]: r["last_read_at"] for r in (reads_resp.data or [])}
                for t in items:
                    last_read = reads_map.get(t["id"])
                    t["unread_message_count"] = sum(
                        1 for m in t["task_messages"]
                        if m["user_id"] != user_id
                        and (last_read is None or m["created_at"] > last_read)
                    )
            except Exception as e:
                _log.warning("Failed to fetch unread counts for tasks: %s", e)
                for t in items:
                    t["unread_message_count"] = 0
        else:
            for t in items:
                t["unread_message_count"] = 0

        return {"items": items, "total_count": resp.count or 0, "page": page, "page_size": page_size}

    @staticmethod
    async def get_task(task_id: str, org_id: str) -> dict:
        db = get_supabase()
        resp = (
            db.table("tasks")
            .select(
                "*, profiles!created_by(full_name), locations(name), "
                "task_assignees(id,user_id,assign_role,is_deleted,profiles(id,full_name)), "
                "task_messages(id,user_id,body,created_at,is_deleted,profiles(full_name)), "
                "task_attachments(id,file_url,file_type,annotated_url,created_at,is_deleted,profiles!uploaded_by(full_name)), "
                "task_status_history(id,changed_by,previous_status,new_status,changed_at,profiles!changed_by(full_name))"
            )
            .eq("id", task_id)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Task not found")
        task = resp.data[0]
        # Filter out soft-deleted nested items
        task["task_assignees"] = [a for a in (task.get("task_assignees") or []) if not a.get("is_deleted")]
        task["task_messages"] = [m for m in (task.get("task_messages") or []) if not m.get("is_deleted")]
        task["task_attachments"] = [a for a in (task.get("task_attachments") or []) if not a.get("is_deleted")]
        return task

    @staticmethod
    async def update_task(task_id: str, org_id: str, body: UpdateTaskRequest) -> dict:
        db = get_supabase()
        updates: dict = body.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        if "due_at" in updates and isinstance(updates["due_at"], datetime):
            updates["due_at"] = updates["due_at"].isoformat()
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        resp = (
            db.table("tasks")
            .update(updates)
            .eq("id", task_id)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Task not found")
        return resp.data[0]

    @staticmethod
    async def update_status(task_id: str, org_id: str, body: UpdateTaskStatusRequest, user_id: str) -> dict:
        db = get_supabase()

        # Fetch current status
        current_resp = db.table("tasks").select("status").eq("id", task_id).eq("organisation_id", org_id).eq("is_deleted", False).execute()
        if not current_resp.data:
            raise HTTPException(status_code=404, detail="Task not found")
        previous_status = current_resp.data[0]["status"]

        updates: dict = {"status": body.status, "updated_at": datetime.now(timezone.utc).isoformat()}
        if body.status == "completed":
            updates["completed_at"] = datetime.now(timezone.utc).isoformat()

        # Update task and insert history atomically (best-effort; PostgREST doesn't support true txns via client)
        task_resp = db.table("tasks").update(updates).eq("id", task_id).eq("organisation_id", org_id).execute()
        db.table("task_status_history").insert({
            "task_id": task_id,
            "changed_by": user_id,
            "previous_status": previous_status,
            "new_status": body.status,
        }).execute()

        if not task_resp.data:
            raise HTTPException(status_code=404, detail="Task not found")
        return task_resp.data[0]

    @staticmethod
    async def add_assignee(task_id: str, org_id: str, body: AddAssigneeRequest) -> dict:
        db = get_supabase()
        # Verify task belongs to org
        t = db.table("tasks").select("id").eq("id", task_id).eq("organisation_id", org_id).eq("is_deleted", False).execute()
        if not t.data:
            raise HTTPException(status_code=404, detail="Task not found")

        row: dict = {"task_id": task_id}
        if body.user_id:
            row["user_id"] = body.user_id
        if body.assign_role:
            row["assign_role"] = body.assign_role
        if not row.get("user_id") and not row.get("assign_role"):
            raise HTTPException(status_code=400, detail="Provide user_id or assign_role")

        resp = db.table("task_assignees").insert(row).execute()
        return resp.data[0] if resp.data else {}

    @staticmethod
    async def remove_assignee(task_id: str, assignee_id: str, org_id: str) -> None:
        db = get_supabase()
        # Verify task belongs to org
        t = db.table("tasks").select("id").eq("id", task_id).eq("organisation_id", org_id).eq("is_deleted", False).execute()
        if not t.data:
            raise HTTPException(status_code=404, detail="Task not found")
        db.table("task_assignees").update({"is_deleted": True}).eq("id", assignee_id).eq("task_id", task_id).execute()

    @staticmethod
    async def post_message(task_id: str, org_id: str, user_id: str, body: PostMessageRequest) -> dict:
        db = get_supabase()
        t = db.table("tasks").select("id").eq("id", task_id).eq("organisation_id", org_id).eq("is_deleted", False).execute()
        if not t.data:
            raise HTTPException(status_code=404, detail="Task not found")
        resp = db.table("task_messages").insert({
            "task_id": task_id,
            "user_id": user_id,
            "body": body.body,
        }).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to post message")
        return resp.data[0]

    @staticmethod
    async def add_attachment(task_id: str, org_id: str, user_id: str, body: AddAttachmentRequest) -> dict:
        db = get_supabase()
        t = db.table("tasks").select("id").eq("id", task_id).eq("organisation_id", org_id).eq("is_deleted", False).execute()
        if not t.data:
            raise HTTPException(status_code=404, detail="Task not found")
        resp = db.table("task_attachments").insert({
            "task_id": task_id,
            "uploaded_by": user_id,
            "file_url": body.file_url,
            "file_type": body.file_type,
        }).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to add attachment")
        return resp.data[0]

    @staticmethod
    async def annotate_attachment(task_id: str, attachment_id: str, org_id: str, body: AnnotateAttachmentRequest) -> dict:
        db = get_supabase()
        t = db.table("tasks").select("id").eq("id", task_id).eq("organisation_id", org_id).eq("is_deleted", False).execute()
        if not t.data:
            raise HTTPException(status_code=404, detail="Task not found")
        resp = (
            db.table("task_attachments")
            .update({"annotated_url": body.annotated_url})
            .eq("id", attachment_id)
            .eq("task_id", task_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Attachment not found")
        return resp.data[0]

    @staticmethod
    async def mark_task_read(task_id: str, org_id: str, user_id: str) -> None:
        db = get_supabase()
        t = db.table("tasks").select("id").eq("id", task_id).eq("organisation_id", org_id).eq("is_deleted", False).execute()
        if not t.data:
            raise HTTPException(status_code=404, detail="Task not found")
        db.table("task_message_reads").upsert(
            {"task_id": task_id, "user_id": user_id, "last_read_at": datetime.now(timezone.utc).isoformat()},
            on_conflict="task_id,user_id",
        ).execute()

    @staticmethod
    async def unread_task_count(org_id: str, user_id: str) -> int:
        """Count tasks that have messages the current user hasn't read."""
        db = get_supabase()
        try:
            # Get all task IDs in org
            tasks_resp = (
                db.table("tasks")
                .select("id")
                .eq("organisation_id", org_id)
                .eq("is_deleted", False)
                .neq("status", "completed")
                .neq("status", "cancelled")
                .execute()
            )
            task_ids = [t["id"] for t in (tasks_resp.data or [])]
            if not task_ids:
                return 0

            # Get messages not sent by this user
            msgs_resp = (
                db.table("task_messages")
                .select("task_id, created_at")
                .in_("task_id", task_ids)
                .neq("user_id", user_id)
                .eq("is_deleted", False)
                .execute()
            )
            if not msgs_resp.data:
                return 0

            # Get user's read receipts
            reads_resp = (
                db.table("task_message_reads")
                .select("task_id, last_read_at")
                .in_("task_id", task_ids)
                .eq("user_id", user_id)
                .execute()
            )
            reads_map = {r["task_id"]: r["last_read_at"] for r in (reads_resp.data or [])}

            # Group messages by task
            tasks_with_unread: set = set()
            for m in msgs_resp.data:
                tid = m["task_id"]
                last_read = reads_map.get(tid)
                if last_read is None or m["created_at"] > last_read:
                    tasks_with_unread.add(tid)

            return len(tasks_with_unread)
        except Exception:
            return 0

    @staticmethod
    async def my_tasks(user_id: str, org_id: str) -> list[dict]:
        """Return the current user's pending + in_progress + overdue tasks."""
        db = get_supabase()
        # Tasks where user is an assignee
        ta_resp = db.table("task_assignees").select("task_id").eq("user_id", user_id).eq("is_deleted", False).execute()
        task_ids = [r["task_id"] for r in (ta_resp.data or [])]
        if not task_ids:
            return []
        resp = (
            db.table("tasks")
            .select(
                "*, locations(name), task_assignees(id,user_id,assign_role,profiles(full_name)), "
                "task_messages!left(id,user_id,created_at,is_deleted)"
            )
            .in_("id", task_ids)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .in_("status", ["pending", "in_progress", "overdue"])
            .order("due_at", desc=False, nullsfirst=False)
            .execute()
        )
        tasks = resp.data or []
        for t in tasks:
            t["task_messages"] = [m for m in (t.get("task_messages") or []) if not m.get("is_deleted")]

        # Annotate unread_message_count
        if tasks:
            try:
                tids = [t["id"] for t in tasks]
                reads_resp = (
                    db.table("task_message_reads")
                    .select("task_id, last_read_at")
                    .in_("task_id", tids)
                    .eq("user_id", user_id)
                    .execute()
                )
                reads_map = {r["task_id"]: r["last_read_at"] for r in (reads_resp.data or [])}
                for t in tasks:
                    last_read = reads_map.get(t["id"])
                    t["unread_message_count"] = sum(
                        1 for m in t["task_messages"]
                        if m["user_id"] != user_id
                        and (last_read is None or m["created_at"] > last_read)
                    )
            except Exception as e:
                _log.warning("Failed to fetch unread counts for tasks: %s", e)
                for t in tasks:
                    t["unread_message_count"] = 0
        return tasks

    @staticmethod
    async def summary(org_id: str, user_id: Optional[str] = None) -> dict:
        db = get_supabase()
        query = (
            db.table("tasks")
            .select("id,status,due_at,priority,title,locations(name)", count="exact")
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
        )
        if user_id:
            # Scope to tasks assigned to this user
            ta = db.table("task_assignees").select("task_id").eq("user_id", user_id).eq("is_deleted", False).execute()
            task_ids = [r["task_id"] for r in (ta.data or [])]
            if not task_ids:
                return {"total": 0, "by_status": {}, "by_priority": {}, "overdue_count": 0, "overdue_tasks": [], "completion_rate": None}
            query = query.in_("id", task_ids)
        resp = query.execute()
        tasks = resp.data or []
        now = datetime.now(timezone.utc)

        by_status: dict = {}
        by_priority: dict = {}
        overdue_tasks = []

        for t in tasks:
            s = t["status"]
            by_status[s] = by_status.get(s, 0) + 1
            p = t["priority"]
            by_priority[p] = by_priority.get(p, 0) + 1
            if t.get("due_at") and t["status"] not in ("completed", "cancelled"):
                if datetime.fromisoformat(t["due_at"].replace("Z", "+00:00")) < now:
                    overdue_tasks.append(t)

        total = len(tasks)
        completed = by_status.get("completed", 0)
        completion_rate = round(completed / total, 4) if total > 0 else None

        return {
            "total": total,
            "by_status": by_status,
            "by_priority": by_priority,
            "overdue_count": len(overdue_tasks),
            "overdue_tasks": overdue_tasks[:10],
            "completion_rate": completion_rate,
        }
