"""
Issues API — /api/v1/issues
Issue CRUD + status updates + comments + attachments + export.
"""
import os
import io
import random
import string
from datetime import datetime, timedelta
from typing import Optional, List
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, require_manager_or_above, paginate
from services.supabase_client import get_supabase

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
    supabase,
    trigger_status: Optional[str] = None,
):
    """Evaluate escalation rules for an issue and send FCM notifications as needed."""
    try:
        # Fetch the issue to get category_id and priority
        issue_resp = (
            supabase.table("issues")
            .select("id, category_id, priority, assigned_to, title")
            .eq("id", issue_id)
            .execute()
        )
        if not issue_resp.data:
            return
        issue = issue_resp.data[0]
        category_id = issue.get("category_id")
        if not category_id:
            return

        # Fetch matching escalation rules
        rules_query = (
            supabase.table("issue_escalation_rules")
            .select("*")
            .eq("category_id", category_id)
            .eq("is_deleted", False)
            .eq("trigger_type", trigger_type)
        )
        if trigger_type == "status_change" and trigger_status:
            rules_query = rules_query.eq("trigger_status", trigger_status)
        if trigger_type == "priority_critical":
            if issue.get("priority") != "critical":
                return

        rules_resp = rules_query.execute()
        rules = rules_resp.data or []
        if not rules:
            return

        # For each rule, collect FCM tokens of recipients
        for rule in rules:
            recipient_ids = []

            if rule.get("escalate_to_user_id"):
                recipient_ids.append(rule["escalate_to_user_id"])

            if rule.get("escalate_to_role"):
                role_resp = (
                    supabase.table("profiles")
                    .select("id")
                    .eq("organisation_id", org_id)
                    .eq("role", rule["escalate_to_role"])
                    .eq("is_deleted", False)
                    .execute()
                )
                for p in (role_resp.data or []):
                    recipient_ids.append(p["id"])

            if not recipient_ids:
                continue

            if rule.get("notify_via_fcm"):
                tokens_resp = (
                    supabase.table("profiles")
                    .select("fcm_token")
                    .in_("id", recipient_ids)
                    .eq("is_deleted", False)
                    .execute()
                )
                tokens = [
                    p["fcm_token"]
                    for p in (tokens_resp.data or [])
                    if p.get("fcm_token")
                ]
                if tokens:
                    await _send_fcm_notification(
                        tokens=tokens,
                        title=f"Issue escalated: {issue['title']}",
                        body=f"Trigger: {trigger_type}",
                        data={"issue_id": issue_id},
                    )

            # Log notifications
            for uid in recipient_ids:
                try:
                    supabase.table("notification_log").insert({
                        "organisation_id": org_id,
                        "user_id": uid,
                        "issue_id": issue_id,
                        "trigger_type": trigger_type,
                        "rule_id": rule["id"],
                    }).execute()
                except Exception:
                    pass

    except Exception:
        pass  # Escalation errors should not block the main request


async def _send_fcm_notification(
    tokens: List[str],
    title: str,
    body: str,
    data: Optional[dict] = None,
):
    """Call the Supabase Edge Function to send FCM push notifications."""
    supabase_url = os.environ.get("SUPABASE_URL", "")
    if not supabase_url:
        return

    edge_url = supabase_url.replace("/rest/v1", "").rstrip("/")
    edge_url = f"{edge_url}/functions/v1/send-fcm-notification"

    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    payload = {
        "tokens": tokens,
        "notification": {"title": title, "body": body},
        "data": data or {},
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                edge_url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {service_role_key}",
                    "Content-Type": "application/json",
                },
            )
    except Exception:
        pass  # FCM errors should not block the main request


def _random_suffix(length: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=length))


# ── Issues CRUD ────────────────────────────────────────────────────────────────

@router.post("/")
async def create_issue(
    body: CreateIssueRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    db = get_supabase()

    # Resolve location_id: use provided value, else fall back to user's profile location
    location_id = body.location_id
    if not location_id:
        try:
            profile_resp = db.table("profiles").select("location_id").eq("id", user_id).single().execute()
            location_id = (profile_resp.data or {}).get("location_id")
        except Exception:
            pass

    if not location_id:
        raise HTTPException(status_code=422, detail="No location found. Please assign a location to your profile or provide one explicitly.")

    data = {
        "organisation_id": org_id,
        "reported_by": user_id,
        "location_id": location_id,
        "title": body.title,
        "category_id": body.category_id,
        "priority": body.priority,
        "status": "open",
    }
    if body.description is not None:
        data["description"] = body.description
    if body.location_description is not None:
        data["location_description"] = body.location_description
    if body.asset_id is not None:
        data["asset_id"] = body.asset_id
    if body.assigned_to is not None:
        data["assigned_to"] = body.assigned_to

    resp = db.table("issues").insert(data).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create issue")
    issue_id = resp.data[0]["id"]

    # Re-fetch with joins so the response includes category, location, and reporter
    fetch_resp = (
        db.table("issues")
        .select("*, profiles!reported_by(full_name), issue_categories(name, color), locations(name)")
        .eq("id", issue_id)
        .single()
        .execute()
    )
    issue = fetch_resp.data if fetch_resp.data else resp.data[0]

    # Insert custom responses
    if body.custom_responses:
        custom_rows = [
            {
                "issue_id": issue_id,
                "custom_field_id": cr.custom_field_id,
                "value": cr.value,
            }
            for cr in body.custom_responses
        ]
        db.table("issue_custom_responses").insert(custom_rows).execute()

    # Check recurrence: count similar issues at same location+category in last 30 days
    try:
        thirty_days_ago = (datetime.utcnow() - timedelta(days=30)).isoformat()
        recurrence_query = (
            db.table("issues")
            .select("id", count="exact")
            .eq("organisation_id", org_id)
            .eq("category_id", body.category_id)
            .eq("is_deleted", False)
            .neq("id", issue_id)
            .gte("created_at", thirty_days_ago)
        )
        if body.location_id:
            recurrence_query = recurrence_query.eq("location_id", body.location_id)
        elif body.location_description:
            recurrence_query = recurrence_query.eq("location_description", body.location_description)

        recurrence_resp = recurrence_query.execute()
        similar_count = recurrence_resp.count or 0

        if similar_count >= 2:
            db.table("issues").update({
                "recurrence_count": similar_count,
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", issue_id).execute()
            issue["recurrence_count"] = similar_count
    except Exception:
        pass

    # Evaluate on_create escalation rules
    await evaluate_escalation_rules(issue_id, "on_create", org_id, db)

    # Evaluate priority_critical escalation rules if applicable
    if body.priority == "critical":
        await evaluate_escalation_rules(issue_id, "priority_critical", org_id, db)

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

    # ── Auto-spawn incident report if safety risk was flagged ──────────────────
    if body.description and "⚠️ Safety risk reported." in body.description:
        try:
            _severity_map = {"low": "low", "medium": "medium", "high": "high", "critical": "critical"}
            _incident_data: dict = {
                "org_id": org_id,
                "reported_by": user_id,
                "title": body.title,
                "description": body.description,
                "severity": _severity_map.get(body.priority, "medium"),
                "status": "reported",
                "incident_date": datetime.utcnow().isoformat(),
                "related_issue_id": issue_id,
            }
            if location_id:
                _incident_data["location_id"] = location_id
            if body.location_description:
                _incident_data["location_description"] = body.location_description
            db.table("incidents").insert(_incident_data).execute()
        except Exception as _inc_exc:
            import logging
            logging.getLogger(__name__).warning(f"Incident auto-spawn failed for issue {issue_id}: {_inc_exc}")

    return issue


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
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    db = get_supabase()

    offset = pagination["offset"]
    page_size = pagination["page_size"]

    query = (
        db.table("issues")
        .select(
            "*, profiles!reported_by(full_name), issue_categories(name, color), locations(name)",
            count="exact",
        )
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
    )

    # Staff view: only issues they reported OR are assigned to
    if my_issues:
        query = query.or_(f"reported_by.eq.{user_id},assigned_to.eq.{user_id}")

    # Manager view: issues reported by or assigned to anyone who reports to them
    if my_team:
        direct_reports = (
            db.table("profiles")
            .select("id")
            .eq("reports_to", user_id)
            .eq("is_deleted", False)
            .execute()
        )
        report_ids = [r["id"] for r in (direct_reports.data or [])]
        # Include the manager's own issues too
        all_ids = list(set(report_ids + [user_id]))
        id_list = ",".join(f"reported_by.eq.{uid}" for uid in all_ids)
        assign_list = ",".join(f"assigned_to.eq.{uid}" for uid in all_ids)
        query = query.or_(f"{id_list},{assign_list}")

    if status:
        query = query.eq("status", status)
    if priority:
        query = query.eq("priority", priority)
    if category_id:
        query = query.eq("category_id", category_id)
    if location_id:
        query = query.eq("location_id", location_id)
    if assigned_to:
        query = query.eq("assigned_to", assigned_to)
    if recurring is True:
        query = query.gte("recurrence_count", 2)
    if from_dt:
        query = query.gte("created_at", from_dt.isoformat())
    if to_dt:
        query = query.lte("created_at", to_dt.isoformat())

    resp = query.order("created_at", desc=True).range(offset, offset + page_size - 1).execute()

    return {"data": resp.data or [], "total": resp.count or 0}


@router.get("/{issue_id}")
async def get_issue(
    issue_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    resp = (
        db.table("issues")
        .select(
            "*, profiles!reported_by(full_name), issue_categories(name, color, sla_hours), "
            "locations(name), "
            "issue_attachments!left(id, file_url, file_type, uploaded_by, created_at, is_deleted, profiles!uploaded_by(full_name)), "
            "issue_comments!left(id, body, is_vendor_visible, user_id, created_at, is_deleted, profiles!user_id(full_name)), "
            "issue_status_history!left(id, previous_status, new_status, comment, changed_by, changed_at, profiles!changed_by(full_name)), "
            "issue_custom_responses!left(id, custom_field_id, value, issue_custom_fields(label, field_type))"
        )
        .eq("id", str(issue_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Issue not found")

    issue = resp.data[0]
    issue["issue_attachments"] = [
        a for a in (issue.get("issue_attachments") or []) if not a.get("is_deleted")
    ]
    issue["issue_comments"] = [
        c for c in (issue.get("issue_comments") or []) if not c.get("is_deleted")
    ]
    return issue


@router.put("/{issue_id}")
async def update_issue(
    issue_id: UUID,
    body: UpdateIssueRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    role = (current_user.get("app_metadata") or {}).get("role", "")
    db = get_supabase()

    # Fetch current issue to check permissions
    current_resp = (
        db.table("issues")
        .select("id, reported_by, assigned_to")
        .eq("id", str(issue_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not current_resp.data:
        raise HTTPException(status_code=404, detail="Issue not found")

    issue = current_resp.data[0]
    is_reporter = issue.get("reported_by") == user_id
    is_assignee = issue.get("assigned_to") == user_id
    is_manager_plus = role in ("manager", "admin", "super_admin")

    if not (is_reporter or is_assignee or is_manager_plus):
        raise HTTPException(status_code=403, detail="Not authorized to update this issue")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = datetime.utcnow().isoformat()

    resp = (
        db.table("issues")
        .update(updates)
        .eq("id", str(issue_id))
        .eq("organisation_id", org_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Issue not found")
    return resp.data[0]


@router.put("/{issue_id}/status")
async def update_issue_status(
    issue_id: UUID,
    body: UpdateIssueStatusRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    role = (current_user.get("app_metadata") or {}).get("role", "")
    db = get_supabase()

    # Only managers and above can set verified_closed
    if body.status == "verified_closed" and role not in ("manager", "admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Only managers and above can verify-close an issue")

    current_resp = (
        db.table("issues")
        .select("id, status, assigned_to")
        .eq("id", str(issue_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not current_resp.data:
        raise HTTPException(status_code=404, detail="Issue not found")

    issue = current_resp.data[0]
    previous_status = issue["status"]

    updates = {
        "status": body.status,
        "updated_at": datetime.utcnow().isoformat(),
    }
    if body.status == "resolved":
        updates["resolved_at"] = datetime.utcnow().isoformat()

    resp = (
        db.table("issues")
        .update(updates)
        .eq("id", str(issue_id))
        .eq("organisation_id", org_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Issue not found")

    # Insert status history record
    history_data = {
        "issue_id": str(issue_id),
        "changed_by": user_id,
        "previous_status": previous_status,
        "new_status": body.status,
    }
    if body.note:
        history_data["note"] = body.note
    db.table("issue_status_history").insert(history_data).execute()

    # Evaluate status_change escalation rules
    await evaluate_escalation_rules(
        str(issue_id), "status_change", org_id, db, trigger_status=body.status
    )

    # Send FCM to assignee if exists
    assigned_to = issue.get("assigned_to")
    if assigned_to:
        try:
            profile_resp = (
                db.table("profiles")
                .select("fcm_token")
                .eq("id", assigned_to)
                .execute()
            )
            if profile_resp.data and profile_resp.data[0].get("fcm_token"):
                await _send_fcm_notification(
                    tokens=[profile_resp.data[0]["fcm_token"]],
                    title="Issue status updated",
                    body=f"Status changed from {previous_status} to {body.status}",
                    data={"issue_id": str(issue_id)},
                )
        except Exception:
            pass

    return resp.data[0]


# ── Comments ───────────────────────────────────────────────────────────────────

@router.post("/{issue_id}/comments")
async def add_comment(
    issue_id: UUID,
    body: AddCommentRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    db = get_supabase()

    issue = (
        db.table("issues")
        .select("id")
        .eq("id", str(issue_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not issue.data:
        raise HTTPException(status_code=404, detail="Issue not found")

    resp = db.table("issue_comments").insert({
        "issue_id": str(issue_id),
        "user_id": user_id,
        "body": body.body,
        "is_vendor_visible": body.is_vendor_visible or False,
    }).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to add comment")
    return resp.data[0]


@router.delete("/{issue_id}/comments/{comment_id}")
async def delete_comment(
    issue_id: UUID,
    comment_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    db = get_supabase()

    issue = (
        db.table("issues")
        .select("id")
        .eq("id", str(issue_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not issue.data:
        raise HTTPException(status_code=404, detail="Issue not found")

    # Only soft-delete own comment
    comment_resp = (
        db.table("issue_comments")
        .select("id, user_id")
        .eq("id", str(comment_id))
        .eq("issue_id", str(issue_id))
        .eq("is_deleted", False)
        .execute()
    )
    if not comment_resp.data:
        raise HTTPException(status_code=404, detail="Comment not found")

    if comment_resp.data[0]["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Cannot delete another user's comment")

    db.table("issue_comments").update({
        "is_deleted": True,
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", str(comment_id)).execute()

    return {"ok": True}


# ── Attachments ────────────────────────────────────────────────────────────────

@router.post("/{issue_id}/attachments")
async def upload_attachments(
    issue_id: UUID,
    files: List[UploadFile] = File(...),
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    db = get_supabase()

    issue = (
        db.table("issues")
        .select("id")
        .eq("id", str(issue_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not issue.data:
        raise HTTPException(status_code=404, detail="Issue not found")

    if len(files) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 files per upload")

    MAX_SIZE = 50 * 1024 * 1024  # 50MB

    uploaded = []
    bucket = "issue-media"
    timestamp = int(datetime.utcnow().timestamp())

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
            db.storage.from_(bucket).upload(
                storage_path,
                content,
                {"content-type": f.content_type or "application/octet-stream"},
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to upload file: {e}")

        public_url_resp = db.storage.from_(bucket).get_public_url(storage_path)
        file_url = public_url_resp if isinstance(public_url_resp, str) else storage_path

        mime = f.content_type or "application/octet-stream"
        if mime.startswith("image/"):
            normalized_type = "image"
        elif mime.startswith("video/"):
            normalized_type = "video"
        else:
            normalized_type = "document"

        att_resp = db.table("issue_attachments").insert({
            "issue_id": str(issue_id),
            "uploaded_by": user_id,
            "file_url": file_url,
            "file_type": normalized_type,
            "storage_path": storage_path,
        }).execute()
        if att_resp.data:
            uploaded.append(att_resp.data[0])

    return {"data": uploaded, "total": len(uploaded)}


# ── Export ─────────────────────────────────────────────────────────────────────

@router.get("/{issue_id}/export")
async def export_issue(
    issue_id: UUID,
    email_to: Optional[str] = Query(None, description="Comma-separated email addresses"),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    resp = (
        db.table("issues")
        .select(
            "*, profiles!reported_by(full_name, email), issue_categories(name), "
            "locations(name), "
            "issue_comments!left(body, created_at, is_deleted, profiles!user_id(full_name)), "
            "issue_status_history!left(previous_status, new_status, changed_at, profiles!changed_by(full_name))"
        )
        .eq("id", str(issue_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Issue not found")

    issue = resp.data[0]
    comments = [c for c in (issue.get("issue_comments") or []) if not c.get("is_deleted")]
    history = issue.get("issue_status_history") or []

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
            ["Category", (issue.get("issue_categories") or {}).get("name", "")],
            ["Location", (issue.get("locations") or {}).get("name", issue.get("location_description", ""))],
            ["Reported By", (issue.get("profiles") or {}).get("full_name", "")],
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
                    f"(by {(h.get('profiles') or {}).get('full_name', 'unknown')})",
                    styles["Normal"],
                ))
            story.append(Spacer(1, 12))

        if comments:
            story.append(Paragraph("Comments", styles["Heading2"]))
            for c in comments:
                story.append(Paragraph(
                    f"[{c.get('created_at', '')}] {(c.get('profiles') or {}).get('full_name', 'unknown')}: {c.get('body', '')}",
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
            f"Category: {(issue.get('issue_categories') or {}).get('name', '')}",
            f"Location: {(issue.get('locations') or {}).get('name', issue.get('location_description', ''))}",
            f"Reported By: {(issue.get('profiles') or {}).get('full_name', '')}",
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
                f"(by {(h.get('profiles') or {}).get('full_name', 'unknown')})"
            )
        lines.append("")
        lines.append("Comments:")
        for c in comments:
            lines.append(
                f"  [{c.get('created_at', '')}] {(c.get('profiles') or {}).get('full_name', 'unknown')}: {c.get('body', '')}"
            )

        return PlainTextResponse("\n".join(lines), headers={
            "Content-Disposition": f"attachment; filename=issue-{issue_id}.txt"
        })
