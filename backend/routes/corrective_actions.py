"""
Corrective Actions Routes — Phase 2
GET  /api/v1/corrective-actions
GET  /api/v1/corrective-actions/{id}
PUT  /api/v1/corrective-actions/{id}
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from dependencies import get_current_user, require_manager_or_above, get_db
from models.audits import UpdateCorrectiveActionRequest
from services.db import row, rows, execute

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_org(current_user: dict) -> str:
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation found for user")
    return org_id


@router.get("/")
async def list_corrective_actions(
    location_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = _get_org(current_user)
    offset = (page - 1) * page_size

    filters = ["ca.organisation_id = %s", "ca.is_deleted = FALSE"]
    params: list = [org_id]

    if location_id:
        filters.append("ca.location_id = %s")
        params.append(location_id)
    if status:
        filters.append("ca.status = %s")
        params.append(status)
    if assigned_to:
        filters.append("ca.assigned_to = %s")
        params.append(assigned_to)
    if from_date:
        filters.append("ca.created_at >= %s")
        params.append(from_date)
    if to_date:
        filters.append("ca.created_at <= %s")
        params.append(to_date)

    where = " AND ".join(filters)
    params.extend([page_size, offset])

    result_rows = rows(
        conn,
        f"""
        SELECT
            ca.*,
            p.id            AS assignee_id,
            p.full_name     AS assignee_full_name,
            p.email         AS assignee_email,
            sub.id          AS sub_id,
            sub.form_template_id,
            sub.submitted_at,
            ft.title        AS form_template_title
        FROM corrective_actions ca
        LEFT JOIN profiles p        ON p.id   = ca.assigned_to
        LEFT JOIN form_submissions sub ON sub.id = ca.form_submission_id
        LEFT JOIN form_templates ft ON ft.id  = sub.form_template_id
        WHERE {where}
        ORDER BY ca.created_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params),
    )

    records = []
    for r in result_rows:
        r = dict(r)
        r["profiles"] = {
            "id": r.pop("assignee_id", None),
            "full_name": r.pop("assignee_full_name", None),
            "email": r.pop("assignee_email", None),
        }
        r["form_submissions"] = {
            "id": r.pop("sub_id", None),
            "form_template_id": r.pop("form_template_id", None),
            "submitted_at": r.pop("submitted_at", None),
            "form_templates": {"title": r.pop("form_template_title", None)},
        }
        records.append(r)

    return records


@router.get("/{cap_id}")
async def get_corrective_action(
    cap_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = _get_org(current_user)

    result = row(
        conn,
        """
        SELECT
            ca.*,
            p.id            AS assignee_id,
            p.full_name     AS assignee_full_name,
            p.email         AS assignee_email,
            sub.id          AS sub_id,
            sub.form_template_id,
            sub.submitted_at,
            ft.title        AS form_template_title,
            ff.label        AS field_label,
            ff.field_type
        FROM corrective_actions ca
        LEFT JOIN profiles p            ON p.id   = ca.assigned_to
        LEFT JOIN form_submissions sub  ON sub.id = ca.form_submission_id
        LEFT JOIN form_templates ft     ON ft.id  = sub.form_template_id
        LEFT JOIN form_fields ff        ON ff.id  = ca.field_id
        WHERE ca.id = %s
          AND ca.organisation_id = %s
          AND ca.is_deleted = FALSE
        """,
        (str(cap_id), org_id),
    )

    if not result:
        raise HTTPException(status_code=404, detail="Corrective action not found")

    record = dict(result)
    record["profiles"] = {
        "id": record.pop("assignee_id", None),
        "full_name": record.pop("assignee_full_name", None),
        "email": record.pop("assignee_email", None),
    }
    record["form_submissions"] = {
        "id": record.pop("sub_id", None),
        "form_template_id": record.pop("form_template_id", None),
        "submitted_at": record.pop("submitted_at", None),
        "form_templates": {"title": record.pop("form_template_title", None)},
    }
    record["form_fields"] = {
        "label": record.pop("field_label", None),
        "field_type": record.pop("field_type", None),
    }
    return record


@router.put("/{cap_id}")
async def update_corrective_action(
    cap_id: UUID,
    body: UpdateCorrectiveActionRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = _get_org(current_user)
    user_id = current_user["sub"]

    existing = row(
        conn,
        """
        SELECT id, assigned_to, status
        FROM corrective_actions
        WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
        """,
        (str(cap_id), org_id),
    )

    if not existing:
        raise HTTPException(status_code=404, detail="Corrective action not found")

    cap = dict(existing)
    role = (current_user.get("app_metadata") or {}).get("role", "")
    is_manager = role in ("manager", "admin", "super_admin")

    # Only assigned user or managers can update
    if str(cap.get("assigned_to")) != str(user_id) and not is_manager:
        raise HTTPException(status_code=403, detail="Not authorised to update this corrective action")

    set_parts: list[str] = ["updated_at = %s"]
    params: list = [datetime.now(timezone.utc).isoformat()]

    if body.status is not None:
        if body.status not in ("open", "in_progress", "resolved"):
            raise HTTPException(status_code=400, detail="Invalid status")
        set_parts.append("status = %s")
        params.append(body.status)
        if body.status == "resolved":
            set_parts.append("resolved_at = %s")
            params.append(datetime.now(timezone.utc).isoformat())

    if body.assigned_to is not None and is_manager:
        set_parts.append("assigned_to = %s")
        params.append(str(body.assigned_to))

    if body.due_at is not None and is_manager:
        set_parts.append("due_at = %s")
        params.append(body.due_at.isoformat())

    if body.resolution_note is not None:
        set_parts.append("resolution_note = %s")
        params.append(body.resolution_note)

    params.append(str(cap_id))

    execute(
        conn,
        f"UPDATE corrective_actions SET {', '.join(set_parts)} WHERE id = %s",
        tuple(params),
    )
    return {"success": True}
