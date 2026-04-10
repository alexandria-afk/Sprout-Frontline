"""
Issues API — /api/v1/issues
Issue CRUD + status updates + comments + attachments + export.
"""
import io
import json
import random
import string
from datetime import datetime, timedelta
from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, require_manager_or_above, paginate, get_db
from services.db import row, rows, execute, execute_returning

router = APIRouter()


# ── Request Models ─────────────────────────────────────────────────────────────

class CustomResponseItem(BaseModel):
    custom_field_id: str
    value: str


class CreateIssueRequest(BaseModel):
    title: str
    description: Optional[str] = None
    category_id: str
    priority: str = "medium"  # low, medium, high, critical
    location_description: Optional[str] = None
    location_id: Optional[str] = None
    asset_id: Optional[str] = None
    assigned_to: Optional[str] = None
    is_safety_risk: Optional[bool] = False
    custom_responses: Optional[List[CustomResponseItem]] = None


class UpdateIssueRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    cost: Optional[float] = None
    resolution_note: Optional[str] = None


class UpdateIssueStatusRequest(BaseModel):
    status: str
    note: Optional[str] = None


class AddCommentRequest(BaseModel):
    body: str
    is_vendor_visible: Optional[bool] = False


class ExportIssueRequest(BaseModel):
    email_to: Optional[List[str]] = None


# ── Escalation Helper ─────────────────────────────────────────────────────────

async def evaluate_escalation_rules(
    issue_id: str,
    trigger_type: str,
    org_id: str,
    conn,
    trigger_status: Optional[str] = None,
):
    """Evaluate escalation rules for an issue and send FCM notifications as needed."""
    try:
        issue = row(
            conn,
            "SELECT id, category_id, priority, assigned_to, title FROM issues WHERE id = %s",
            (issue_id,),
        )
        if not issue:
            return
        category_id = issue.get("category_id")
        if not category_id:
            return

        sql = (
            "SELECT * FROM issue_escalation_rules "
            "WHERE category_id = %s AND is_deleted = FALSE AND trigger_type = %s"
        )
        params: list = [category_id, trigger_type]
        if trigger_type == "status_change" and trigger_status:
            sql += " AND trigger_status = %s"
            params.append(trigger_status)
        if trigger_type == "priority_critical":
            if issue.get("priority") != "critical":
                return

        rules = rows(conn, sql, tuple(params))
        if not rules:
            return

        for rule in rules:
            recipient_ids = []

            if rule.get("escalate_to_user_id"):
                recipient_ids.append(rule["escalate_to_user_id"])

            if rule.get("escalate_to_role"):
                role_profiles = rows(
                    conn,
                    "SELECT id FROM profiles WHERE organisation_id = %s AND role = %s AND is_deleted = FALSE",
                    (org_id, rule["escalate_to_role"]),
                )
                for p in role_profiles:
                    recipient_ids.append(p["id"])

            if not recipient_ids:
                continue

            if rule.get("notify_via_fcm"):
                try:
                    import asyncio as _asyncio
                    from services import notification_service as _ns
                    for uid in recipient_ids:
                        _asyncio.create_task(_ns.notify(
                            org_id=org_id,
                            recipient_user_id=uid,
                            type="issue_assigned",
                            title=f"Issue escalated: {issue['title']}",
                            body=f"Trigger: {trigger_type}",
                            entity_type="issue",
                            entity_id=issue_id,
                            send_push=True,
                        ))
                except Exception:
                    pass

    except Exception:
        pass  # Escalation errors should not block the main request


def _random_suffix(length: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=length))


# ── Issues CRUD ────────────────────────────────────────────────────────────────

@router.post("")
@router.post("/")
async def create_issue(
    body: CreateIssueRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]

    # Resolve location_id: use provided value, else fall back to user's profile location
    location_id = body.location_id
    if not location_id:
        try:
            profile = row(conn, "SELECT location_id FROM profiles WHERE id = %s", (user_id,))
            location_id = (profile or {}).get("location_id")
        except Exception:
            pass

    if not location_id:
        raise HTTPException(status_code=422, detail="No location found. Please assign a location to your profile or provide one explicitly.")

    issue = execute_returning(
        conn,
        """
        INSERT INTO issues
            (organisation_id, reported_by, location_id, title, category_id, priority, status,
             description, location_description, asset_id, assigned_to)
        VALUES (%s, %s, %s, %s, %s, %s, 'open', %s, %s, %s, %s)
        RETURNING *
        """,
        (
            org_id, user_id, location_id, body.title, body.category_id, body.priority,
            body.description, body.location_description, body.asset_id, body.assigned_to,
        ),
    )
    if not issue:
        raise HTTPException(status_code=500, detail="Failed to create issue")
    issue_id = issue["id"]

    # Re-fetch with joins so the response includes category, location, and reporter
    issue = row(
        conn,
        """
        SELECT i.*,
               p.full_name AS reporter_full_name,
               ic.name     AS category_name,
               ic.color    AS category_color,
               l.name      AS location_name
        FROM issues i
        LEFT JOIN profiles p ON p.id = i.reported_by
        LEFT JOIN issue_categories ic ON ic.id = i.category_id
        LEFT JOIN locations l ON l.id = i.location_id
        WHERE i.id = %s
        """,
        (issue_id,),
    ) or issue

    # Insert custom responses
    if body.custom_responses:
        for cr in body.custom_responses:
            execute(
                conn,
                "INSERT INTO issue_custom_responses (issue_id, custom_field_id, value) VALUES (%s, %s, %s)",
                (issue_id, cr.custom_field_id, cr.value),
            )

    # Check recurrence: count similar issues at same location+category in last 30 days
    try:
        thirty_days_ago = (datetime.utcnow() - timedelta(days=30)).isoformat()
        rec_sql = (
            "SELECT COUNT(*) AS cnt FROM issues "
            "WHERE organisation_id = %s AND category_id = %s AND is_deleted = FALSE "
            "AND id != %s AND created_at >= %s"
        )
        rec_params: list = [org_id, body.category_id, issue_id, thirty_days_ago]
        if body.location_id:
            rec_sql += " AND location_id = %s"
            rec_params.append(body.location_id)
        elif body.location_description:
            rec_sql += " AND location_description = %s"
            rec_params.append(body.location_description)

        rec_row = row(conn, rec_sql, tuple(rec_params))
        similar_count = (rec_row or {}).get("cnt", 0)

        if similar_count >= 2:
            execute(
                conn,
                "UPDATE issues SET recurrence_count = %s, updated_at = NOW() WHERE id = %s",
                (similar_count, issue_id),
            )
            issue["recurrence_count"] = similar_count
    except Exception:
        pass

    # Evaluate on_create escalation rules
    await evaluate_escalation_rules(issue_id, "on_create", org_id, conn)

    # Evaluate priority_critical escalation rules if applicable
    if body.priority == "critical":
        await evaluate_escalation_rules(issue_id, "priority_critical", org_id, conn)

    # Auto-trigger any issue_created workflows
    try:
        from services.workflow_service import trigger_workflows_for_event
        await trigger_workflows_for_event(
            event_type="issue_created",
            org_id=org_id,
            source_id=issue_id,
            triggered_by=user_id,
            location_id=body.location_id,
            category_id=body.category_id,
        )
    except Exception as _wf_exc:
        import logging
        logging.getLogger(__name__).warning(f"Workflow trigger failed for issue {issue_id}: {_wf_exc}")

    # Notify the assigned user if set on creation
    if body.assigned_to:
        try:
            import asyncio as _asyncio
            from services import notification_service as _ns
            priority_str = body.priority or "medium"
            loc = row(conn, "SELECT name FROM locations WHERE id = %s", (location_id,))
            loc_name = (loc or {}).get("name", "")
            _asyncio.create_task(_ns.notify(
                org_id=org_id,
                recipient_user_id=str(body.assigned_to),
                type="issue_assigned",
                title=f"Issue assigned: {body.title}",
                body=f"{priority_str} \u00b7 {loc_name}".strip(" \u00b7"),
                entity_type="issue",
                entity_id=str(issue_id),
            ))
        except Exception:
            pass

    # ── Auto-spawn incident report if safety risk was flagged ──────────────────
    if body.is_safety_risk:
        try:
            _severity_map = {"low": "low", "medium": "medium", "high": "high", "critical": "critical"}
            execute(
                conn,
                """
                INSERT INTO incidents
                    (org_id, reported_by, title, description, severity, status,
                     incident_date, related_issue_id, location_id, location_description)
                VALUES (%s, %s, %s, %s, %s, 'reported', %s, %s, %s, %s)
                """,
                (
                    org_id, user_id, body.title, body.description,
                    _severity_map.get(body.priority, "medium"),
                    datetime.utcnow().isoformat(), issue_id,
                    location_id, body.location_description,
                ),
            )
        except Exception as _inc_exc:
            import logging
            logging.getLogger(__name__).warning(f"Incident auto-spawn failed for issue {issue_id}: {_inc_exc}")

    return issue


@router.get("")
@router.get("/")
async def list_issues(
    pagination: dict = Depends(paginate),
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    recurring: Optional[bool] = Query(None),
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    my_issues: Optional[bool] = Query(None),
    my_team: Optional[bool] = Query(None),
    is_maintenance: Optional[bool] = Query(None),
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]

    role = (current_user.get("app_metadata") or {}).get("role", "staff")
    manager_location_id = (current_user.get("app_metadata") or {}).get("location_id")
    if role == "manager" and not location_id and manager_location_id:
        location_id = manager_location_id

    offset = pagination["offset"]
    page_size = pagination["page_size"]

    conditions = [
        "i.organisation_id = %s",
        "i.is_deleted = FALSE",
    ]
    params: list = [org_id]

    if my_issues:
        conditions.append(f"(i.reported_by = %s OR i.assigned_to = %s)")
        params.extend([user_id, user_id])

    if my_team:
        direct_report_rows = rows(
            conn,
            "SELECT id FROM profiles WHERE reports_to = %s AND is_deleted = FALSE",
            (user_id,),
        )
        report_ids = [r["id"] for r in direct_report_rows]
        all_ids = list(set(report_ids + [user_id]))
        placeholders = ", ".join(["%s"] * len(all_ids))
        conditions.append(
            f"(i.reported_by IN ({placeholders}) OR i.assigned_to IN ({placeholders}))"
        )
        params.extend(all_ids)
        params.extend(all_ids)

    if status:
        conditions.append("i.status = %s")
        params.append(status)
    if priority:
        conditions.append("i.priority = %s")
        params.append(priority)
    if category_id:
        conditions.append("i.category_id = %s")
        params.append(category_id)
    if location_id:
        conditions.append("i.location_id = %s")
        params.append(location_id)
    if assigned_to:
        conditions.append("i.assigned_to = %s")
        params.append(assigned_to)
    if recurring is True:
        conditions.append("i.recurrence_count >= 2")
    if is_maintenance is True:
        maint_cats = rows(
            conn,
            "SELECT id FROM issue_categories WHERE organisation_id = %s AND is_maintenance = TRUE AND is_deleted = FALSE",
            (org_id,),
        )
        maint_ids = [r["id"] for r in maint_cats]
        if not maint_ids:
            return {"data": [], "total": 0}
        placeholders = ", ".join(["%s"] * len(maint_ids))
        conditions.append(f"i.category_id IN ({placeholders})")
        params.extend(maint_ids)
    if from_dt:
        conditions.append("i.created_at >= %s")
        params.append(from_dt.isoformat())
    if to_dt:
        conditions.append("i.created_at <= %s")
        params.append(to_dt.isoformat())

    where_clause = " AND ".join(conditions)

    count_row = row(
        conn,
        f"SELECT COUNT(*) AS total FROM issues i WHERE {where_clause}",
        tuple(params),
    )
    total = (count_row or {}).get("total", 0)

    data = rows(
        conn,
        f"""
        SELECT i.*,
               p.full_name  AS reporter_full_name,
               ic.name      AS category_name,
               ic.color     AS category_color,
               ic.sla_hours AS category_sla_hours,
               ic.is_maintenance AS category_is_maintenance,
               l.name       AS location_name
        FROM issues i
        LEFT JOIN profiles p ON p.id = i.reported_by
        LEFT JOIN issue_categories ic ON ic.id = i.category_id
        LEFT JOIN locations l ON l.id = i.location_id
        WHERE {where_clause}
        ORDER BY i.created_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params) + (page_size, offset),
    )

    return {"data": data, "total": total}


@router.get("/{issue_id}")
async def get_issue(
    issue_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    issue = row(
        conn,
        """
        SELECT i.*,
               p.full_name       AS reporter_full_name,
               ic.name           AS category_name,
               ic.color          AS category_color,
               ic.sla_hours      AS category_sla_hours,
               ic.is_maintenance AS category_is_maintenance,
               l.name            AS location_name
        FROM issues i
        LEFT JOIN profiles p ON p.id = i.reported_by
        LEFT JOIN issue_categories ic ON ic.id = i.category_id
        LEFT JOIN locations l ON l.id = i.location_id
        WHERE i.id = %s AND i.organisation_id = %s AND i.is_deleted = FALSE
        """,
        (str(issue_id), org_id),
    )
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    issue = dict(issue)

    attachments = rows(
        conn,
        """
        SELECT a.*, p.full_name AS uploader_full_name
        FROM issue_attachments a
        LEFT JOIN profiles p ON p.id = a.uploaded_by
        WHERE a.issue_id = %s AND a.is_deleted = FALSE
        """,
        (str(issue_id),),
    )
    issue["issue_attachments"] = attachments

    comments = rows(
        conn,
        """
        SELECT c.*, p.full_name AS commenter_full_name
        FROM issue_comments c
        LEFT JOIN profiles p ON p.id = c.user_id
        WHERE c.issue_id = %s AND c.is_deleted = FALSE
        """,
        (str(issue_id),),
    )
    issue["issue_comments"] = comments

    status_history = rows(
        conn,
        """
        SELECT h.*, p.full_name AS changer_full_name
        FROM issue_status_history h
        LEFT JOIN profiles p ON p.id = h.changed_by
        WHERE h.issue_id = %s
        """,
        (str(issue_id),),
    )
    issue["issue_status_history"] = status_history

    custom_responses = rows(
        conn,
        """
        SELECT r.*, f.label AS field_label, f.field_type AS field_type
        FROM issue_custom_responses r
        LEFT JOIN issue_custom_fields f ON f.id = r.custom_field_id
        WHERE r.issue_id = %s
        """,
        (str(issue_id),),
    )
    issue["issue_custom_responses"] = custom_responses

    return issue


@router.put("/{issue_id}")
async def update_issue(
    issue_id: UUID,
    body: UpdateIssueRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    role = (current_user.get("app_metadata") or {}).get("role", "")

    current_issue = row(
        conn,
        "SELECT id, reported_by, assigned_to FROM issues WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(issue_id), org_id),
    )
    if not current_issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    is_reporter = current_issue.get("reported_by") == user_id
    is_assignee = current_issue.get("assigned_to") == user_id
    is_manager_plus = role in ("manager", "admin", "super_admin")

    if not (is_reporter or is_assignee or is_manager_plus):
        raise HTTPException(status_code=403, detail="Not authorized to update this issue")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    set_parts = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [str(issue_id), org_id]

    updated = execute_returning(
        conn,
        f"UPDATE issues SET {set_parts}, updated_at = NOW() WHERE id = %s AND organisation_id = %s RETURNING *",
        tuple(values),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Issue not found")
    return updated


@router.put("/{issue_id}/status")
async def update_issue_status(
    issue_id: UUID,
    body: UpdateIssueStatusRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    role = (current_user.get("app_metadata") or {}).get("role", "")

    # Only managers and above can set verified_closed
    if body.status == "verified_closed" and role not in ("manager", "admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Only managers and above can verify-close an issue")

    current_issue = row(
        conn,
        "SELECT id, status, assigned_to FROM issues WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(issue_id), org_id),
    )
    if not current_issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    previous_status = current_issue["status"]

    if body.status == "resolved":
        updated = execute_returning(
            conn,
            "UPDATE issues SET status = %s, resolved_at = NOW(), updated_at = NOW() WHERE id = %s AND organisation_id = %s RETURNING *",
            (body.status, str(issue_id), org_id),
        )
    else:
        updated = execute_returning(
            conn,
            "UPDATE issues SET status = %s, updated_at = NOW() WHERE id = %s AND organisation_id = %s RETURNING *",
            (body.status, str(issue_id), org_id),
        )
    if not updated:
        raise HTTPException(status_code=404, detail="Issue not found")

    # Insert status history record
    execute(
        conn,
        """
        INSERT INTO issue_status_history (issue_id, changed_by, previous_status, new_status, note)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (str(issue_id), user_id, previous_status, body.status, body.note),
    )

    # Evaluate status_change escalation rules
    await evaluate_escalation_rules(
        str(issue_id), "status_change", org_id, conn, trigger_status=body.status
    )

    # Notify the reporter that the issue status changed
    try:
        issue_data = row(conn, "SELECT title, reported_by FROM issues WHERE id = %s", (str(issue_id),)) or {}
        reported_by = issue_data.get("reported_by")
        issue_title = issue_data.get("title", "Issue")
        status_label = body.status.replace("_", " ").title()
        if reported_by:
            import asyncio as _asyncio
            from services import notification_service as _ns
            _asyncio.create_task(_ns.notify(
                org_id=org_id,
                recipient_user_id=reported_by,
                type="issue_status_changed",
                title=f"{issue_title} \u2192 {status_label}",
                entity_type="issue",
                entity_id=str(issue_id),
            ))
    except Exception:
        pass

    return updated


# ── Comments ───────────────────────────────────────────────────────────────────

@router.post("/{issue_id}/comments")
async def add_comment(
    issue_id: UUID,
    body: AddCommentRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]

    issue_check = row(
        conn,
        "SELECT id FROM issues WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(issue_id), org_id),
    )
    if not issue_check:
        raise HTTPException(status_code=404, detail="Issue not found")

    comment = execute_returning(
        conn,
        """
        INSERT INTO issue_comments (issue_id, user_id, body, is_vendor_visible)
        VALUES (%s, %s, %s, %s)
        RETURNING *
        """,
        (str(issue_id), user_id, body.body, body.is_vendor_visible or False),
    )
    if not comment:
        raise HTTPException(status_code=500, detail="Failed to add comment")

    # Notify issue participants (assigned_to and reported_by, excluding commenter)
    try:
        issue_data = row(
            conn,
            "SELECT title, assigned_to, reported_by FROM issues WHERE id = %s",
            (str(issue_id),),
        ) or {}
        issue_title = issue_data.get("title", "Issue")
        recipients = set()
        if issue_data.get("assigned_to") and issue_data["assigned_to"] != user_id:
            recipients.add(issue_data["assigned_to"])
        if issue_data.get("reported_by") and issue_data["reported_by"] != user_id:
            recipients.add(issue_data["reported_by"])
        comment_preview = (body.body or "")[:100]
        import asyncio as _asyncio
        from services import notification_service as _ns
        for recipient_id in recipients:
            _asyncio.create_task(_ns.notify(
                org_id=org_id,
                recipient_user_id=recipient_id,
                type="issue_comment",
                title=f"New comment on: {issue_title}",
                body=comment_preview,
                entity_type="issue",
                entity_id=str(issue_id),
            ))
    except Exception:
        pass

    return comment


@router.delete("/{issue_id}/comments/{comment_id}")
async def delete_comment(
    issue_id: UUID,
    comment_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]

    issue_check = row(
        conn,
        "SELECT id FROM issues WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(issue_id), org_id),
    )
    if not issue_check:
        raise HTTPException(status_code=404, detail="Issue not found")

    comment_record = row(
        conn,
        "SELECT id, user_id FROM issue_comments WHERE id = %s AND issue_id = %s AND is_deleted = FALSE",
        (str(comment_id), str(issue_id)),
    )
    if not comment_record:
        raise HTTPException(status_code=404, detail="Comment not found")

    if comment_record["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Cannot delete another user's comment")

    execute(
        conn,
        "UPDATE issue_comments SET is_deleted = TRUE, updated_at = NOW() WHERE id = %s",
        (str(comment_id),),
    )

    return {"ok": True}


# ── Attachments ────────────────────────────────────────────────────────────────

@router.post("/{issue_id}/attachments")
async def upload_attachments(
    issue_id: UUID,
    files: List[UploadFile] = File(...),
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]

    issue_check = row(
        conn,
        "SELECT id FROM issues WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(issue_id), org_id),
    )
    if not issue_check:
        raise HTTPException(status_code=404, detail="Issue not found")

    if len(files) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 files per upload")

    MAX_SIZE = 50 * 1024 * 1024  # 50MB

    uploaded = []
    bucket = "issue-media"
    timestamp = int(datetime.utcnow().timestamp())

    # Phase 5: replace with Azure Blob
    from services.supabase_client import get_supabase
    _storage_client = get_supabase()

    for f in files:
        content = await f.read()
        if len(content) > MAX_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File {f.filename} exceeds the 50MB limit",
            )

        ext = ""
        if f.filename and "." in f.filename:
            ext = f.filename.rsplit(".", 1)[-1].lower()

        suffix = _random_suffix()
        storage_path = f"{user_id}/{str(issue_id)}/{timestamp}-{suffix}.{ext}" if ext else f"{user_id}/{str(issue_id)}/{timestamp}-{suffix}"

        try:
            # Phase 5: replace with Azure Blob
            _storage_client.storage.from_(bucket).upload(
                storage_path,
                content,
                {"content-type": f.content_type or "application/octet-stream"},
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to upload file: {e}")

        # Phase 5: replace with Azure Blob
        public_url_resp = _storage_client.storage.from_(bucket).get_public_url(storage_path)
        file_url = public_url_resp if isinstance(public_url_resp, str) else storage_path

        mime = f.content_type or "application/octet-stream"
        if mime.startswith("image/"):
            normalized_type = "image"
        elif mime.startswith("video/"):
            normalized_type = "video"
        else:
            normalized_type = "document"

        attachment = execute_returning(
            conn,
            """
            INSERT INTO issue_attachments (issue_id, uploaded_by, file_url, file_type, storage_path)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
            """,
            (str(issue_id), user_id, file_url, normalized_type, storage_path),
        )
        if attachment:
            uploaded.append(attachment)

    return {"data": uploaded, "total": len(uploaded)}


# ── Export ─────────────────────────────────────────────────────────────────────

@router.get("/{issue_id}/export")
async def export_issue(
    issue_id: UUID,
    email_to: Optional[str] = Query(None, description="Comma-separated email addresses"),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    issue = row(
        conn,
        """
        SELECT i.*,
               p.full_name AS reporter_full_name,
               p.email     AS reporter_email,
               ic.name     AS category_name,
               l.name      AS location_name
        FROM issues i
        LEFT JOIN profiles p ON p.id = i.reported_by
        LEFT JOIN issue_categories ic ON ic.id = i.category_id
        LEFT JOIN locations l ON l.id = i.location_id
        WHERE i.id = %s AND i.organisation_id = %s AND i.is_deleted = FALSE
        """,
        (str(issue_id), org_id),
    )
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    issue = dict(issue)

    comments = rows(
        conn,
        """
        SELECT c.body, c.created_at, p.full_name AS commenter_full_name
        FROM issue_comments c
        LEFT JOIN profiles p ON p.id = c.user_id
        WHERE c.issue_id = %s AND c.is_deleted = FALSE
        """,
        (str(issue_id),),
    )

    history = rows(
        conn,
        """
        SELECT h.previous_status, h.new_status, h.changed_at, p.full_name AS changer_full_name
        FROM issue_status_history h
        LEFT JOIN profiles p ON p.id = h.changed_by
        WHERE h.issue_id = %s
        """,
        (str(issue_id),),
    )

    # Attempt PDF generation with reportlab; fall back to plain text
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib.styles import getSampleStyleSheet
        from fastapi.responses import StreamingResponse

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        styles = getSampleStyleSheet()
        story = []

        story.append(Paragraph(f"Issue Report: {issue['title']}", styles["Title"]))
        story.append(Spacer(1, 12))

        meta = [
            ["ID", str(issue["id"])],
            ["Status", issue.get("status", "")],
            ["Priority", issue.get("priority", "")],
            ["Category", issue.get("category_name", "")],
            ["Location", issue.get("location_name") or issue.get("location_description", "")],
            ["Reported By", issue.get("reporter_full_name", "")],
            ["Created At", str(issue.get("created_at", ""))],
        ]
        t = Table(meta, colWidths=[120, 360])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.lightgrey),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
        ]))
        story.append(t)
        story.append(Spacer(1, 12))

        if issue.get("description"):
            story.append(Paragraph("Description", styles["Heading2"]))
            story.append(Paragraph(issue["description"], styles["Normal"]))
            story.append(Spacer(1, 12))

        if history:
            story.append(Paragraph("Status History", styles["Heading2"]))
            for h in history:
                story.append(Paragraph(
                    f"{h.get('changed_at', '')} — {h.get('previous_status', '')} → {h.get('new_status', '')} "
                    f"(by {h.get('changer_full_name', 'unknown')})",
                    styles["Normal"],
                ))
            story.append(Spacer(1, 12))

        if comments:
            story.append(Paragraph("Comments", styles["Heading2"]))
            for c in comments:
                story.append(Paragraph(
                    f"[{c.get('created_at', '')}] {c.get('commenter_full_name', 'unknown')}: {c.get('body', '')}",
                    styles["Normal"],
                ))
            story.append(Spacer(1, 6))

        doc.build(story)
        buffer.seek(0)

        return StreamingResponse(
            buffer,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=issue-{issue_id}.pdf"},
        )

    except ImportError:
        # Fallback: plain text report
        from fastapi.responses import PlainTextResponse

        lines = [
            f"ISSUE REPORT",
            f"============",
            f"ID: {issue['id']}",
            f"Title: {issue['title']}",
            f"Status: {issue.get('status', '')}",
            f"Priority: {issue.get('priority', '')}",
            f"Category: {issue.get('category_name', '')}",
            f"Location: {issue.get('location_name') or issue.get('location_description', '')}",
            f"Reported By: {issue.get('reporter_full_name', '')}",
            f"Created At: {issue.get('created_at', '')}",
            f"",
            f"Description:",
            issue.get("description", "(none)"),
            f"",
            f"Status History:",
        ]
        for h in history:
            lines.append(
                f"  {h.get('changed_at', '')} — {h.get('previous_status', '')} → {h.get('new_status', '')} "
                f"(by {h.get('changer_full_name', 'unknown')})"
            )
        lines.append("")
        lines.append("Comments:")
        for c in comments:
            lines.append(
                f"  [{c.get('created_at', '')}] {c.get('commenter_full_name', 'unknown')}: {c.get('body', '')}"
            )

        return PlainTextResponse("\n".join(lines), headers={
            "Content-Disposition": f"attachment; filename=issue-{issue_id}.txt"
        })
