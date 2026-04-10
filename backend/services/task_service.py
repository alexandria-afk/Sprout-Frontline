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
from services.db import row, rows, execute, execute_returning, execute_many


class TaskService:

    # ── Templates ──────────────────────────────────────────────────────────────

    @staticmethod
    async def list_templates(conn, org_id: str) -> list[dict]:
        return rows(
            conn,
            """
            SELECT tt.*, p.full_name AS created_by_full_name
            FROM task_templates tt
            LEFT JOIN profiles p ON p.id = tt.created_by
            WHERE tt.organisation_id = %s
              AND tt.is_deleted = FALSE
            ORDER BY tt.created_at DESC
            """,
            (org_id,),
        )

    @staticmethod
    async def create_template(conn, body: CreateTaskTemplateRequest, org_id: str, created_by: str) -> dict:
        result = execute_returning(
            conn,
            """
            INSERT INTO task_templates
                (organisation_id, created_by, title, description, priority,
                 assign_to_role, recurrence, cron_expression, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                org_id,
                created_by,
                body.title,
                body.description,
                body.priority,
                body.assign_to_role,
                body.recurrence,
                body.cron_expression,
                body.is_active,
            ),
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to create task template")
        return dict(result)

    @staticmethod
    async def update_template(conn, template_id: str, org_id: str, body: UpdateTaskTemplateRequest) -> dict:
        updates = body.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        updates["updated_at"] = datetime.now(timezone.utc)

        set_clauses = ", ".join(f"{k} = %s" for k in updates)
        values = list(updates.values()) + [template_id, org_id]
        result = execute_returning(
            conn,
            f"""
            UPDATE task_templates
            SET {set_clauses}
            WHERE id = %s
              AND organisation_id = %s
              AND is_deleted = FALSE
            RETURNING *
            """,
            tuple(values),
        )
        if not result:
            raise HTTPException(status_code=404, detail="Template not found")
        return dict(result)

    @staticmethod
    async def delete_template(conn, template_id: str, org_id: str) -> None:
        execute(
            conn,
            """
            UPDATE task_templates
            SET is_deleted = TRUE
            WHERE id = %s AND organisation_id = %s
            """,
            (template_id, org_id),
        )

    @staticmethod
    async def spawn_from_template(conn, template_id: str, org_id: str, created_by: str, body: SpawnTaskRequest) -> dict:
        t = row(
            conn,
            """
            SELECT * FROM task_templates
            WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
            """,
            (template_id, org_id),
        )
        if not t:
            raise HTTPException(status_code=404, detail="Template not found")

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
        return await TaskService.create_task(conn, create_body, org_id, created_by)

    # ── Tasks ──────────────────────────────────────────────────────────────────

    @staticmethod
    async def create_task(conn, body: CreateTaskRequest, org_id: str, created_by: str) -> dict:
        # Build dynamic insert
        cols = [
            "organisation_id", "created_by", "title", "priority",
            "source_type", "recurrence", "status",
        ]
        vals: list = [org_id, created_by, body.title, body.priority, body.source_type, body.recurrence, "pending"]

        if body.location_id:
            cols.append("location_id"); vals.append(body.location_id)
        if body.template_id:
            cols.append("template_id"); vals.append(body.template_id)
        if body.description:
            cols.append("description"); vals.append(body.description)
        if body.due_at:
            cols.append("due_at"); vals.append(body.due_at)
        if body.cron_expression:
            cols.append("cron_expression"); vals.append(body.cron_expression)
        if body.source_submission_id:
            cols.append("source_submission_id"); vals.append(body.source_submission_id)
        if body.source_field_id:
            cols.append("source_field_id"); vals.append(body.source_field_id)
        if body.cap_item_id:
            cols.append("cap_item_id"); vals.append(body.cap_item_id)

        col_sql = ", ".join(cols)
        placeholder_sql = ", ".join(["%s"] * len(cols))
        task = execute_returning(
            conn,
            f"INSERT INTO tasks ({col_sql}) VALUES ({placeholder_sql}) RETURNING *",
            tuple(vals),
        )
        if not task:
            raise HTTPException(status_code=500, detail="Failed to create task")
        task = dict(task)
        task_id = task["id"]

        # Insert assignees
        assignee_rows: list[tuple] = []
        for uid in body.assignee_user_ids:
            assignee_rows.append((task_id, uid, None))
        for role in body.assignee_roles:
            assignee_rows.append((task_id, None, role))
        if assignee_rows:
            execute_many(
                conn,
                "INSERT INTO task_assignees (task_id, user_id, assign_role) VALUES (%s, %s, %s)",
                assignee_rows,
            )

        # Notify each directly-assigned user
        try:
            user_assignee_ids = list(body.assignee_user_ids)
            if user_assignee_ids:
                import asyncio as _asyncio
                from services import notification_service as _ns
                loc_name = ""
                if body.location_id:
                    loc_row = row(
                        conn,
                        "SELECT name FROM locations WHERE id = %s",
                        (body.location_id,),
                    )
                    loc_name = (loc_row or {}).get("name", "")
                due_str = body.due_at.strftime("%b %-d") if body.due_at else ""
                notif_body_parts = [p for p in [loc_name, f"Due {due_str}" if due_str else ""] if p]
                notif_body = " \u00b7 ".join(notif_body_parts) or None
                for uid in user_assignee_ids:
                    _asyncio.create_task(_ns.notify(
                        org_id=org_id,
                        recipient_user_id=uid,
                        type="task_assigned",
                        title=f"New task: {task['title']}",
                        body=notif_body,
                        entity_type="task",
                        entity_id=task_id,
                        send_push=True,
                    ))
        except Exception:
            pass

        # Initial status history entry
        execute(
            conn,
            """
            INSERT INTO task_status_history
                (task_id, changed_by, previous_status, new_status)
            VALUES (%s, %s, NULL, 'pending')
            """,
            (task_id, created_by),
        )

        return task

    @staticmethod
    async def list_tasks(
        conn,
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

        # Resolve task_id filter from assignee tables when needed
        filter_task_ids: Optional[list] = None
        if team_user_ids:
            assignee_rows = rows(
                conn,
                "SELECT task_id FROM task_assignees WHERE user_id = ANY(%s) AND is_deleted = FALSE",
                (team_user_ids,),
            )
            filter_task_ids = list({r["task_id"] for r in assignee_rows})
            if not filter_task_ids:
                return {"items": [], "total_count": 0, "page": page, "page_size": page_size}
        elif assigned_to:
            assignee_rows = rows(
                conn,
                "SELECT task_id FROM task_assignees WHERE user_id = %s AND is_deleted = FALSE",
                (assigned_to,),
            )
            filter_task_ids = [r["task_id"] for r in assignee_rows]
            if not filter_task_ids:
                return {"items": [], "total_count": 0, "page": page, "page_size": page_size}

        # Build WHERE clauses
        conditions = ["t.organisation_id = %s", "t.is_deleted = FALSE"]
        params: list = [org_id]

        if filter_task_ids is not None:
            conditions.append("t.id = ANY(%s)")
            params.append(filter_task_ids)
        if status:
            conditions.append("t.status = %s")
            params.append(status)
        if priority:
            conditions.append("t.priority = %s")
            params.append(priority)
        if location_id:
            conditions.append("t.location_id = %s")
            params.append(location_id)
        if source_type:
            conditions.append("t.source_type = %s")
            params.append(source_type)
        if overdue:
            conditions.append("t.due_at < %s AND t.status NOT IN ('completed', 'cancelled')")
            params.append(datetime.now(timezone.utc))
        if from_dt:
            conditions.append("t.created_at >= %s")
            params.append(from_dt)
        if to_dt:
            conditions.append("t.created_at <= %s")
            params.append(to_dt)

        where_sql = " AND ".join(conditions)

        # Count query
        count_result = row(
            conn,
            f"SELECT COUNT(*) AS total FROM tasks t WHERE {where_sql}",
            tuple(params),
        )
        total_count = (count_result or {}).get("total", 0)

        offset = (page - 1) * page_size
        task_rows = rows(
            conn,
            f"""
            SELECT t.*,
                   p.full_name                          AS created_by_full_name,
                   l.name                               AS location_name
            FROM tasks t
            LEFT JOIN profiles p ON p.id = t.created_by
            LEFT JOIN locations l ON l.id = t.location_id
            WHERE {where_sql}
            ORDER BY t.created_at DESC
            LIMIT %s OFFSET %s
            """,
            tuple(params) + (page_size, offset),
        )

        if not task_rows:
            return {"items": [], "total_count": total_count, "page": page, "page_size": page_size}

        task_ids = [t["id"] for t in task_rows]

        # Fetch assignees for all tasks in one query
        all_assignees = rows(
            conn,
            """
            SELECT ta.id, ta.task_id, ta.user_id, ta.assign_role, ta.is_deleted,
                   pr.full_name AS assignee_full_name
            FROM task_assignees ta
            LEFT JOIN profiles pr ON pr.id = ta.user_id
            WHERE ta.task_id = ANY(%s)
            """,
            (task_ids,),
        )
        # Fetch messages (id, user_id, created_at, is_deleted) for unread counting
        all_messages = rows(
            conn,
            """
            SELECT id, task_id, user_id, created_at, is_deleted
            FROM task_messages
            WHERE task_id = ANY(%s)
            """,
            (task_ids,),
        )

        # Build lookup maps
        assignees_by_task: dict = {}
        for a in all_assignees:
            assignees_by_task.setdefault(a["task_id"], []).append(a)
        messages_by_task: dict = {}
        for m in all_messages:
            messages_by_task.setdefault(m["task_id"], []).append(m)

        # Fetch read receipts for current user
        reads_map: dict = {}
        if user_id:
            try:
                read_rows = rows(
                    conn,
                    "SELECT task_id, last_read_at FROM task_message_reads WHERE task_id = ANY(%s) AND user_id = %s",
                    (task_ids, user_id),
                )
                reads_map = {r["task_id"]: r["last_read_at"] for r in read_rows}
            except Exception as e:
                _log.warning("Failed to fetch unread counts for tasks: %s", e)

        items = []
        for t in task_rows:
            t = dict(t)
            tid = t["id"]
            t["task_assignees"] = [
                dict(a) for a in assignees_by_task.get(tid, []) if not a.get("is_deleted")
            ]
            task_msgs = [m for m in messages_by_task.get(tid, []) if not m.get("is_deleted")]
            t["task_messages"] = [dict(m) for m in task_msgs]

            if user_id:
                last_read = reads_map.get(tid)
                t["unread_message_count"] = sum(
                    1 for m in task_msgs
                    if m["user_id"] != user_id
                    and (last_read is None or m["created_at"] > last_read)
                )
            else:
                t["unread_message_count"] = 0
            items.append(t)

        return {"items": items, "total_count": total_count, "page": page, "page_size": page_size}

    @staticmethod
    async def get_task(conn, task_id: str, org_id: str) -> dict:
        task = row(
            conn,
            """
            SELECT t.*,
                   p.full_name  AS created_by_full_name,
                   l.name       AS location_name
            FROM tasks t
            LEFT JOIN profiles p ON p.id = t.created_by
            LEFT JOIN locations l ON l.id = t.location_id
            WHERE t.id = %s AND t.organisation_id = %s AND t.is_deleted = FALSE
            """,
            (task_id, org_id),
        )
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        task = dict(task)

        # Assignees
        task["task_assignees"] = [
            dict(a) for a in rows(
                conn,
                """
                SELECT ta.id, ta.user_id, ta.assign_role, ta.is_deleted,
                       pr.id AS profile_id, pr.full_name AS assignee_full_name
                FROM task_assignees ta
                LEFT JOIN profiles pr ON pr.id = ta.user_id
                WHERE ta.task_id = %s AND ta.is_deleted = FALSE
                """,
                (task_id,),
            )
        ]

        # Messages
        task["task_messages"] = [
            dict(m) for m in rows(
                conn,
                """
                SELECT tm.id, tm.user_id, tm.body, tm.created_at, tm.is_deleted,
                       pr.full_name AS sender_full_name
                FROM task_messages tm
                LEFT JOIN profiles pr ON pr.id = tm.user_id
                WHERE tm.task_id = %s AND tm.is_deleted = FALSE
                """,
                (task_id,),
            )
        ]

        # Attachments
        task["task_attachments"] = [
            dict(a) for a in rows(
                conn,
                """
                SELECT ta.id, ta.file_url, ta.file_type, ta.annotated_url,
                       ta.created_at, ta.is_deleted,
                       pr.full_name AS uploader_full_name
                FROM task_attachments ta
                LEFT JOIN profiles pr ON pr.id = ta.uploaded_by
                WHERE ta.task_id = %s AND ta.is_deleted = FALSE
                """,
                (task_id,),
            )
        ]

        # Status history
        task["task_status_history"] = [
            dict(h) for h in rows(
                conn,
                """
                SELECT tsh.id, tsh.changed_by, tsh.previous_status,
                       tsh.new_status, tsh.changed_at,
                       pr.full_name AS changer_full_name
                FROM task_status_history tsh
                LEFT JOIN profiles pr ON pr.id = tsh.changed_by
                WHERE tsh.task_id = %s
                ORDER BY tsh.changed_at ASC
                """,
                (task_id,),
            )
        ]

        return task

    @staticmethod
    async def update_task(conn, task_id: str, org_id: str, body: UpdateTaskRequest) -> dict:
        updates: dict = body.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        if "due_at" in updates and isinstance(updates["due_at"], datetime):
            updates["due_at"] = updates["due_at"]
        updates["updated_at"] = datetime.now(timezone.utc)

        set_clauses = ", ".join(f"{k} = %s" for k in updates)
        values = list(updates.values()) + [task_id, org_id]
        result = execute_returning(
            conn,
            f"""
            UPDATE tasks
            SET {set_clauses}
            WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
            RETURNING *
            """,
            tuple(values),
        )
        if not result:
            raise HTTPException(status_code=404, detail="Task not found")
        return dict(result)

    @staticmethod
    async def update_status(conn, task_id: str, org_id: str, body: UpdateTaskStatusRequest, user_id: str) -> dict:
        current = row(
            conn,
            "SELECT status FROM tasks WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
            (task_id, org_id),
        )
        if not current:
            raise HTTPException(status_code=404, detail="Task not found")
        previous_status = current["status"]

        extra_cols = ""
        extra_vals: list = []
        if body.status == "completed":
            extra_cols = ", completed_at = %s"
            extra_vals = [datetime.now(timezone.utc)]

        result = execute_returning(
            conn,
            f"""
            UPDATE tasks
            SET status = %s, updated_at = %s{extra_cols}
            WHERE id = %s AND organisation_id = %s
            RETURNING *
            """,
            tuple([body.status, datetime.now(timezone.utc)] + extra_vals + [task_id, org_id]),
        )

        execute(
            conn,
            """
            INSERT INTO task_status_history
                (task_id, changed_by, previous_status, new_status)
            VALUES (%s, %s, %s, %s)
            """,
            (task_id, user_id, previous_status, body.status),
        )

        if not result:
            raise HTTPException(status_code=404, detail="Task not found")
        return dict(result)

    @staticmethod
    async def add_assignee(conn, task_id: str, org_id: str, body: AddAssigneeRequest) -> dict:
        t = row(
            conn,
            "SELECT id FROM tasks WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
            (task_id, org_id),
        )
        if not t:
            raise HTTPException(status_code=404, detail="Task not found")

        if not body.user_id and not body.assign_role:
            raise HTTPException(status_code=400, detail="Provide user_id or assign_role")

        result = execute_returning(
            conn,
            """
            INSERT INTO task_assignees (task_id, user_id, assign_role)
            VALUES (%s, %s, %s)
            RETURNING *
            """,
            (task_id, body.user_id or None, body.assign_role or None),
        )

        # Notify the newly assigned user
        if body.user_id:
            try:
                task_data = row(
                    conn,
                    "SELECT title, location_id, due_at FROM tasks WHERE id = %s",
                    (task_id,),
                ) or {}
                import asyncio as _asyncio
                from services import notification_service as _ns
                _asyncio.create_task(_ns.notify(
                    org_id=org_id,
                    recipient_user_id=body.user_id,
                    type="task_assigned",
                    title=f"New task: {task_data.get('title', 'Task')}",
                    entity_type="task",
                    entity_id=task_id,
                    send_push=True,
                ))
            except Exception:
                pass

        return dict(result) if result else {}

    @staticmethod
    async def remove_assignee(conn, task_id: str, assignee_id: str, org_id: str) -> None:
        t = row(
            conn,
            "SELECT id FROM tasks WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
            (task_id, org_id),
        )
        if not t:
            raise HTTPException(status_code=404, detail="Task not found")
        execute(
            conn,
            "UPDATE task_assignees SET is_deleted = TRUE WHERE id = %s AND task_id = %s",
            (assignee_id, task_id),
        )

    @staticmethod
    async def post_message(conn, task_id: str, org_id: str, user_id: str, body: PostMessageRequest) -> dict:
        t = row(
            conn,
            "SELECT id FROM tasks WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
            (task_id, org_id),
        )
        if not t:
            raise HTTPException(status_code=404, detail="Task not found")
        result = execute_returning(
            conn,
            "INSERT INTO task_messages (task_id, user_id, body) VALUES (%s, %s, %s) RETURNING *",
            (task_id, user_id, body.body),
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to post message")
        return dict(result)

    @staticmethod
    async def add_attachment(conn, task_id: str, org_id: str, user_id: str, body: AddAttachmentRequest) -> dict:
        t = row(
            conn,
            "SELECT id FROM tasks WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
            (task_id, org_id),
        )
        if not t:
            raise HTTPException(status_code=404, detail="Task not found")
        result = execute_returning(
            conn,
            """
            INSERT INTO task_attachments (task_id, uploaded_by, file_url, file_type)
            VALUES (%s, %s, %s, %s)
            RETURNING *
            """,
            (task_id, user_id, body.file_url, body.file_type),
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to add attachment")
        return dict(result)

    @staticmethod
    async def annotate_attachment(conn, task_id: str, attachment_id: str, org_id: str, body: AnnotateAttachmentRequest) -> dict:
        t = row(
            conn,
            "SELECT id FROM tasks WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
            (task_id, org_id),
        )
        if not t:
            raise HTTPException(status_code=404, detail="Task not found")
        result = execute_returning(
            conn,
            """
            UPDATE task_attachments
            SET annotated_url = %s
            WHERE id = %s AND task_id = %s AND is_deleted = FALSE
            RETURNING *
            """,
            (body.annotated_url, attachment_id, task_id),
        )
        if not result:
            raise HTTPException(status_code=404, detail="Attachment not found")
        return dict(result)

    @staticmethod
    async def mark_task_read(conn, task_id: str, org_id: str, user_id: str) -> None:
        t = row(
            conn,
            "SELECT id FROM tasks WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
            (task_id, org_id),
        )
        if not t:
            raise HTTPException(status_code=404, detail="Task not found")
        execute(
            conn,
            """
            INSERT INTO task_message_reads (task_id, user_id, last_read_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (task_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at
            """,
            (task_id, user_id, datetime.now(timezone.utc)),
        )

    @staticmethod
    async def unread_task_count(conn, org_id: str, user_id: str) -> int:
        """Count tasks that have messages the current user hasn't read."""
        try:
            task_rows = rows(
                conn,
                """
                SELECT id FROM tasks
                WHERE organisation_id = %s
                  AND is_deleted = FALSE
                  AND status NOT IN ('completed', 'cancelled')
                """,
                (org_id,),
            )
            task_ids = [t["id"] for t in task_rows]
            if not task_ids:
                return 0

            msg_rows = rows(
                conn,
                """
                SELECT task_id, created_at FROM task_messages
                WHERE task_id = ANY(%s)
                  AND user_id != %s
                  AND is_deleted = FALSE
                """,
                (task_ids, user_id),
            )
            if not msg_rows:
                return 0

            read_rows = rows(
                conn,
                "SELECT task_id, last_read_at FROM task_message_reads WHERE task_id = ANY(%s) AND user_id = %s",
                (task_ids, user_id),
            )
            reads_map = {r["task_id"]: r["last_read_at"] for r in read_rows}

            tasks_with_unread: set = set()
            for m in msg_rows:
                tid = m["task_id"]
                last_read = reads_map.get(tid)
                if last_read is None or m["created_at"] > last_read:
                    tasks_with_unread.add(tid)

            return len(tasks_with_unread)
        except Exception:
            return 0

    @staticmethod
    async def my_tasks(conn, user_id: str, org_id: str) -> list[dict]:
        """Return the current user's pending + in_progress + overdue tasks."""
        assignee_rows = rows(
            conn,
            "SELECT task_id FROM task_assignees WHERE user_id = %s AND is_deleted = FALSE",
            (user_id,),
        )
        task_ids = [r["task_id"] for r in assignee_rows]
        if not task_ids:
            return []

        task_rows = rows(
            conn,
            """
            SELECT t.*,
                   l.name AS location_name
            FROM tasks t
            LEFT JOIN locations l ON l.id = t.location_id
            WHERE t.id = ANY(%s)
              AND t.organisation_id = %s
              AND t.is_deleted = FALSE
              AND t.status = ANY(%s)
            ORDER BY t.due_at ASC NULLS LAST
            """,
            (task_ids, org_id, ["pending", "in_progress", "overdue"]),
        )
        if not task_rows:
            return []

        tids = [t["id"] for t in task_rows]

        # Fetch assignees
        all_assignees = rows(
            conn,
            """
            SELECT ta.id, ta.task_id, ta.user_id, ta.assign_role,
                   pr.full_name AS assignee_full_name
            FROM task_assignees ta
            LEFT JOIN profiles pr ON pr.id = ta.user_id
            WHERE ta.task_id = ANY(%s) AND ta.is_deleted = FALSE
            """,
            (tids,),
        )
        assignees_by_task: dict = {}
        for a in all_assignees:
            assignees_by_task.setdefault(a["task_id"], []).append(a)

        # Fetch messages for unread counting
        all_messages = rows(
            conn,
            "SELECT id, task_id, user_id, created_at, is_deleted FROM task_messages WHERE task_id = ANY(%s)",
            (tids,),
        )
        messages_by_task: dict = {}
        for m in all_messages:
            messages_by_task.setdefault(m["task_id"], []).append(m)

        # Read receipts
        reads_map: dict = {}
        try:
            read_rows = rows(
                conn,
                "SELECT task_id, last_read_at FROM task_message_reads WHERE task_id = ANY(%s) AND user_id = %s",
                (tids, user_id),
            )
            reads_map = {r["task_id"]: r["last_read_at"] for r in read_rows}
        except Exception as e:
            _log.warning("Failed to fetch unread counts for tasks: %s", e)

        tasks = []
        for t in task_rows:
            t = dict(t)
            tid = t["id"]
            t["task_assignees"] = [dict(a) for a in assignees_by_task.get(tid, [])]
            task_msgs = [m for m in messages_by_task.get(tid, []) if not m.get("is_deleted")]
            t["task_messages"] = [dict(m) for m in task_msgs]
            last_read = reads_map.get(tid)
            t["unread_message_count"] = sum(
                1 for m in task_msgs
                if m["user_id"] != user_id
                and (last_read is None or m["created_at"] > last_read)
            )
            tasks.append(t)
        return tasks

    @staticmethod
    async def summary(conn, org_id: str, user_id: Optional[str] = None) -> dict:
        conditions = ["organisation_id = %s", "is_deleted = FALSE"]
        params: list = [org_id]

        if user_id:
            assignee_rows = rows(
                conn,
                "SELECT task_id FROM task_assignees WHERE user_id = %s AND is_deleted = FALSE",
                (user_id,),
            )
            task_ids = [r["task_id"] for r in assignee_rows]
            if not task_ids:
                return {"total": 0, "by_status": {}, "by_priority": {}, "overdue_count": 0, "overdue_tasks": [], "completion_rate": None}
            conditions.append("id = ANY(%s)")
            params.append(task_ids)

        where_sql = " AND ".join(conditions)
        task_rows = rows(
            conn,
            f"SELECT id, status, due_at, priority, title FROM tasks WHERE {where_sql}",
            tuple(params),
        )

        # Fetch location names for tasks that have one (used in overdue_tasks)
        if task_rows:
            tids = [t["id"] for t in task_rows]
            loc_rows = rows(
                conn,
                """
                SELECT t.id AS task_id, l.name AS location_name
                FROM tasks t
                JOIN locations l ON l.id = t.location_id
                WHERE t.id = ANY(%s)
                """,
                (tids,),
            )
            loc_map = {r["task_id"]: r["location_name"] for r in loc_rows}
        else:
            loc_map = {}

        now = datetime.now(timezone.utc)
        by_status: dict = {}
        by_priority: dict = {}
        overdue_tasks = []

        for t in task_rows:
            t = dict(t)
            s = t["status"]
            by_status[s] = by_status.get(s, 0) + 1
            p = t["priority"]
            by_priority[p] = by_priority.get(p, 0) + 1
            if t.get("due_at") and t["status"] not in ("completed", "cancelled"):
                due_val = t["due_at"]
                if isinstance(due_val, str):
                    due_val = datetime.fromisoformat(due_val.replace("Z", "+00:00"))
                if due_val < now:
                    t["locations"] = {"name": loc_map.get(t["id"])}
                    overdue_tasks.append(t)

        total = len(task_rows)
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
