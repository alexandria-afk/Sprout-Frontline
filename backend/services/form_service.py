import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from services.audit_scoring_service import calculate_audit_score
from models.forms import (
    CreateFormTemplateRequest,
    UpdateFormTemplateRequest,
    FormTemplateResponse,
    FormSectionResponse,
    FormFieldResponse,
    CreateAssignmentRequest,
    FormSubmissionResponse,
    ReviewSubmissionRequest,
    CreateSubmissionRequest,
    TemplateStatsResponse,
)
from models.base import PaginatedResponse
from services.db import row, rows, execute, execute_returning, execute_many

_log = logging.getLogger(__name__)


class FormService:
    @staticmethod
    async def list_templates(
        conn,
        org_id: str,
        type_filter: Optional[str] = None,
        is_active: Optional[bool] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> PaginatedResponse[FormTemplateResponse]:
        offset = (page - 1) * page_size

        where = ["organisation_id = %s", "is_deleted = FALSE"]
        params: list = [str(org_id)]

        if type_filter:
            where.append("type = %s")
            params.append(type_filter)
        if is_active is not None:
            where.append("is_active = %s")
            params.append(is_active)

        where_sql = " AND ".join(where)

        try:
            count_r = row(
                conn,
                f"SELECT COUNT(*) AS cnt FROM form_templates WHERE {where_sql}",
                tuple(params),
            )
            total_count = count_r["cnt"] if count_r else 0

            template_rows = rows(
                conn,
                f"""
                SELECT *
                FROM form_templates
                WHERE {where_sql}
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [page_size, offset]),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        items = []
        for tmpl in template_rows:
            tmpl = dict(tmpl)
            tmpl_id = tmpl["id"]
            try:
                section_rows = rows(
                    conn,
                    """
                    SELECT * FROM form_sections
                    WHERE form_template_id = %s AND is_deleted = FALSE
                    ORDER BY display_order
                    """,
                    (str(tmpl_id),),
                )
                sections_out = []
                for sec in section_rows:
                    sec = dict(sec)
                    field_rows = rows(
                        conn,
                        """
                        SELECT * FROM form_fields
                        WHERE section_id = %s AND is_deleted = FALSE
                        ORDER BY display_order
                        """,
                        (str(sec["id"]),),
                    )
                    sec["fields"] = [FormFieldResponse(**dict(f)) for f in field_rows]
                    sections_out.append(FormSectionResponse(**sec))
                tmpl["sections"] = sections_out
            except Exception:
                tmpl["sections"] = []
            items.append(FormTemplateResponse(**tmpl))

        return PaginatedResponse(items=items, total_count=total_count, page=page, page_size=page_size)

    @staticmethod
    async def create_template(
        conn,
        body: CreateFormTemplateRequest,
        org_id: str,
        created_by: str,
    ) -> FormTemplateResponse:
        desc = body.description if body.description is not None else None

        try:
            tmpl = execute_returning(
                conn,
                """
                INSERT INTO form_templates
                    (organisation_id, created_by, title, type, description, is_active, is_deleted)
                VALUES (%s, %s, %s, %s, %s, TRUE, FALSE)
                RETURNING *
                """,
                (str(org_id), str(created_by), body.title, body.type, desc),
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        template_id = str(tmpl["id"])
        sections_out = []

        for section_body in body.sections:
            sec_id_override = str(section_body.id) if section_body.id is not None else None
            try:
                if sec_id_override:
                    sec = execute_returning(
                        conn,
                        """
                        INSERT INTO form_sections (id, form_template_id, title, display_order)
                        VALUES (%s, %s, %s, %s)
                        RETURNING *
                        """,
                        (sec_id_override, template_id, section_body.title, section_body.display_order),
                    )
                else:
                    sec = execute_returning(
                        conn,
                        """
                        INSERT INTO form_sections (form_template_id, title, display_order)
                        VALUES (%s, %s, %s)
                        RETURNING *
                        """,
                        (template_id, section_body.title, section_body.display_order),
                    )
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Section creation failed: {e}")

            section_id = str(sec["id"])
            fields_out = []

            for field_body in section_body.fields:
                fld_id_override = str(field_body.id) if field_body.id is not None else None
                options_json = json.dumps(field_body.options) if field_body.options is not None else None
                cond_json = json.dumps(field_body.conditional_logic) if field_body.conditional_logic is not None else None

                try:
                    if fld_id_override:
                        fld = execute_returning(
                            conn,
                            """
                            INSERT INTO form_fields
                                (id, section_id, label, field_type, is_required, display_order,
                                 is_critical, options, conditional_logic, placeholder)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            RETURNING *
                            """,
                            (
                                fld_id_override, section_id, field_body.label,
                                field_body.field_type, field_body.is_required,
                                field_body.display_order, field_body.is_critical,
                                options_json, cond_json, field_body.placeholder,
                            ),
                        )
                    else:
                        fld = execute_returning(
                            conn,
                            """
                            INSERT INTO form_fields
                                (section_id, label, field_type, is_required, display_order,
                                 is_critical, options, conditional_logic, placeholder)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                            RETURNING *
                            """,
                            (
                                section_id, field_body.label, field_body.field_type,
                                field_body.is_required, field_body.display_order,
                                field_body.is_critical, options_json, cond_json,
                                field_body.placeholder,
                            ),
                        )
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Field creation failed: {e}")

                fields_out.append(FormFieldResponse(**dict(fld)))

            sections_out.append(FormSectionResponse(**dict(sec), fields=fields_out))

        return FormTemplateResponse(**dict(tmpl), sections=sections_out)

    @staticmethod
    async def get_template(conn, template_id: str, org_id: str) -> FormTemplateResponse:
        try:
            tmpl = row(
                conn,
                """
                SELECT * FROM form_templates
                WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
                """,
                (str(template_id), str(org_id)),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not tmpl:
            raise HTTPException(status_code=404, detail="Template not found")

        try:
            section_rows = rows(
                conn,
                """
                SELECT * FROM form_sections
                WHERE form_template_id = %s AND is_deleted = FALSE
                ORDER BY display_order
                """,
                (str(template_id),),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        sections_out = []
        for sec in section_rows:
            sec = dict(sec)
            try:
                field_rows = rows(
                    conn,
                    """
                    SELECT * FROM form_fields
                    WHERE section_id = %s AND is_deleted = FALSE
                    ORDER BY display_order
                    """,
                    (str(sec["id"]),),
                )
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

            fields_out = [FormFieldResponse(**dict(f)) for f in field_rows]
            sections_out.append(FormSectionResponse(**sec, fields=fields_out))

        return FormTemplateResponse(**dict(tmpl), sections=sections_out)

    @staticmethod
    async def update_template(
        conn,
        template_id: str,
        org_id: str,
        body: UpdateFormTemplateRequest,
    ) -> FormTemplateResponse:
        updates = {}
        if body.title is not None:
            updates["title"] = body.title
        if body.description is not None:
            updates["description"] = body.description
        if body.type is not None:
            updates["type"] = body.type
        if body.is_active is not None:
            updates["is_active"] = body.is_active

        if updates:
            set_clause = ", ".join(f"{k} = %s" for k in updates)
            vals = list(updates.values()) + [str(template_id), str(org_id)]
            try:
                execute(
                    conn,
                    f"UPDATE form_templates SET {set_clause} WHERE id = %s AND organisation_id = %s",
                    tuple(vals),
                )
            except Exception as e:
                raise HTTPException(status_code=400, detail=str(e))

        if body.sections is not None:
            # Soft-delete existing fields then sections, then recreate
            try:
                existing_sections = rows(
                    conn,
                    "SELECT id FROM form_sections WHERE form_template_id = %s AND is_deleted = FALSE",
                    (str(template_id),),
                )
                section_ids = [str(s["id"]) for s in existing_sections]
                if section_ids:
                    for sid in section_ids:
                        execute(
                            conn,
                            "UPDATE form_fields SET is_deleted = TRUE WHERE section_id = %s",
                            (sid,),
                        )
                    execute(
                        conn,
                        "UPDATE form_sections SET is_deleted = TRUE WHERE form_template_id = %s",
                        (str(template_id),),
                    )
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Section cleanup failed: {e}")

            for section_body in body.sections:
                try:
                    sec = execute_returning(
                        conn,
                        """
                        INSERT INTO form_sections (form_template_id, title, display_order)
                        VALUES (%s, %s, %s)
                        RETURNING *
                        """,
                        (str(template_id), section_body.title, section_body.display_order),
                    )
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Section creation failed: {e}")

                section_id = str(sec["id"])

                for field_body in section_body.fields:
                    options_json = json.dumps(field_body.options) if field_body.options is not None else None
                    cond_json = json.dumps(field_body.conditional_logic) if field_body.conditional_logic is not None else None
                    try:
                        execute(
                            conn,
                            """
                            INSERT INTO form_fields
                                (section_id, label, field_type, is_required, display_order,
                                 is_critical, options, conditional_logic, placeholder)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                section_id, field_body.label, field_body.field_type,
                                field_body.is_required, field_body.display_order,
                                field_body.is_critical, options_json, cond_json,
                                field_body.placeholder,
                            ),
                        )
                    except Exception as e:
                        raise HTTPException(status_code=400, detail=f"Field creation failed: {e}")

        return await FormService.get_template(conn, template_id, org_id)

    @staticmethod
    async def delete_template(conn, template_id: str, org_id: str) -> dict:
        existing = row(
            conn,
            "SELECT id FROM form_templates WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
            (str(template_id), str(org_id)),
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Template not found")

        try:
            execute(
                conn,
                "UPDATE form_templates SET is_deleted = TRUE WHERE id = %s",
                (str(template_id),),
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        return {"success": True, "message": "Template deleted"}

    @staticmethod
    async def create_assignment(conn, body: CreateAssignmentRequest, org_id: str) -> dict:
        # Audit templates require a location.
        # The org_id filter ensures a manager cannot assign a template from another org.
        template_type_row = row(
            conn,
            "SELECT type FROM form_templates WHERE id = %s AND organisation_id = %s",
            (str(body.form_template_id), str(org_id)),
        )
        if template_type_row and template_type_row.get("type") == "audit":
            if not body.assigned_to_location_id:
                raise HTTPException(status_code=422, detail="A location is required when assigning an audit form.")

        assigned_to_user_id = str(body.assigned_to_user_id) if body.assigned_to_user_id is not None else None
        assigned_to_location_id = str(body.assigned_to_location_id) if body.assigned_to_location_id is not None else None
        cron_expression = body.cron_expression if body.cron_expression is not None else None

        try:
            assignment = execute_returning(
                conn,
                """
                INSERT INTO form_assignments
                    (form_template_id, organisation_id, recurrence, due_at,
                     assigned_to_user_id, assigned_to_location_id, cron_expression,
                     is_active, is_deleted)
                VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, FALSE)
                RETURNING *
                """,
                (
                    str(body.form_template_id), str(org_id), body.recurrence,
                    body.due_at.isoformat(), assigned_to_user_id,
                    assigned_to_location_id, cron_expression,
                ),
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        assignment = dict(assignment)

        # Notify the assigned user
        if body.assigned_to_user_id:
            try:
                tmpl_row = row(
                    conn,
                    "SELECT title FROM form_templates WHERE id = %s",
                    (str(body.form_template_id),),
                )
                tmpl_title = (tmpl_row or {}).get("title", "Form")
                loc_name = ""
                if body.assigned_to_location_id:
                    loc_row = row(
                        conn,
                        "SELECT name FROM locations WHERE id = %s",
                        (str(body.assigned_to_location_id),),
                    )
                    loc_name = (loc_row or {}).get("name", "")
                due_str = body.due_at.strftime("%b %-d") if body.due_at else ""
                notif_body_parts = [p for p in [loc_name, f"Due {due_str}" if due_str else ""] if p]
                notif_body = " \u00b7 ".join(notif_body_parts) or None
                import asyncio as _asyncio
                from services import notification_service as _ns
                _asyncio.create_task(_ns.notify(
                    org_id=str(org_id),
                    recipient_user_id=str(body.assigned_to_user_id),
                    type="form_assigned",
                    title=f"New assignment: {tmpl_title}",
                    body=notif_body,
                    entity_type="form_assignment",
                    entity_id=assignment["id"],
                    send_push=True,
                ))
            except Exception:
                pass

        return assignment

    @staticmethod
    async def my_assignments(conn, user_id: str, org_id: str) -> list:
        # Get user's location
        try:
            profile_r = row(
                conn,
                "SELECT location_id FROM profiles WHERE id = %s AND is_deleted = FALSE",
                (str(user_id),),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        location_id = (profile_r or {}).get("location_id")

        try:
            # Assignments directly to the user
            user_assignments = rows(
                conn,
                """
                SELECT fa.*,
                       row_to_json(ft) AS form_templates
                FROM form_assignments fa
                JOIN form_templates ft ON ft.id = fa.form_template_id
                WHERE fa.assigned_to_user_id = %s
                  AND fa.is_deleted = FALSE
                  AND fa.is_active = TRUE
                """,
                (str(user_id),),
            )
            assignments = [dict(a) for a in user_assignments]

            # Assignments to user's location
            if location_id:
                loc_assignments = rows(
                    conn,
                    """
                    SELECT fa.*,
                           row_to_json(ft) AS form_templates
                    FROM form_assignments fa
                    JOIN form_templates ft ON ft.id = fa.form_template_id
                    WHERE fa.assigned_to_location_id = %s
                      AND fa.is_deleted = FALSE
                      AND fa.is_active = TRUE
                    """,
                    (str(location_id),),
                )
                existing_ids = {a["id"] for a in assignments}
                for a in loc_assignments:
                    if a["id"] not in existing_ids:
                        assignments.append(dict(a))

            # Filter out assignments whose template has been deleted or deactivated
            def _template_ok(a):
                ft = a.get("form_templates")
                if isinstance(ft, str):
                    import json as _json
                    ft = _json.loads(ft)
                if not ft:
                    return False
                return not ft.get("is_deleted") and ft.get("is_active", True)

            assignments = [a for a in assignments if _template_ok(a)]
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        # Annotate each assignment with submission status for this user
        if assignments:
            assignment_ids = [a["id"] for a in assignments]
            try:
                sub_rows = rows(
                    conn,
                    """
                    SELECT assignment_id, id, status, submitted_at
                    FROM form_submissions
                    WHERE assignment_id = ANY(%s::uuid[])
                      AND submitted_by = %s
                      AND is_deleted = FALSE
                    """,
                    (list(assignment_ids), str(user_id)),
                )
                # Build map: assignment_id → best submission (submitted > draft)
                sub_map: dict = {}
                for s in sub_rows:
                    s = dict(s)
                    aid = str(s["assignment_id"])
                    existing = sub_map.get(aid)
                    if not existing or s["status"] == "submitted":
                        sub_map[aid] = s

                for a in assignments:
                    sub = sub_map.get(str(a["id"]))
                    a["completed"]     = bool(sub and sub["status"] == "submitted")
                    a["submitted_at"]  = sub["submitted_at"] if sub and sub["status"] == "submitted" else None
                    a["has_draft"]     = bool(sub and sub["status"] == "draft")
                    a["submission_id"] = sub["id"] if sub else None
            except Exception:
                # Non-fatal — degrade gracefully
                for a in assignments:
                    a["completed"] = False
                    a["submitted_at"] = None
                    a["has_draft"] = False
                    a["submission_id"] = None

        return assignments

    @staticmethod
    async def get_assignment_template(conn, assignment_id: str, user_id: str, org_id: str) -> dict:
        """Return the full template for an assignment, verifying the user is assigned to it."""
        try:
            assignment = row(
                conn,
                """
                SELECT * FROM form_assignments
                WHERE id = %s AND is_deleted = FALSE AND is_active = TRUE
                """,
                (str(assignment_id),),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")

        assignment = dict(assignment)

        # Verify access: user must be directly assigned OR their location must match
        profile_r = row(
            conn,
            "SELECT location_id FROM profiles WHERE id = %s",
            (str(user_id),),
        )
        location_id = (profile_r or {}).get("location_id")

        is_user_assigned = str(assignment.get("assigned_to_user_id") or "") == str(user_id)
        is_location_assigned = location_id and str(assignment.get("assigned_to_location_id") or "") == str(location_id)

        # Also allow managers/admins in the same org to access (for previewing)
        is_org_member = str(assignment.get("organisation_id") or "") == str(org_id)

        if not (is_user_assigned or is_location_assigned or is_org_member):
            raise HTTPException(status_code=403, detail="Not authorised to access this assignment")

        # Use the assignment's own organisation_id for the template lookup —
        # this avoids a crash when org_id is None (invite token before first refresh).
        template_id = assignment["form_template_id"]
        assignment_org_id = assignment["organisation_id"]
        return await FormService.get_template(conn, template_id, assignment_org_id)

    @staticmethod
    async def get_draft_for_assignment(conn, assignment_id: str, user_id: str) -> Optional[dict]:
        """Return the existing draft submission for an assignment, or None."""
        try:
            sub = row(
                conn,
                """
                SELECT fs.*, json_agg(fr.*) FILTER (WHERE fr.id IS NOT NULL) AS form_responses
                FROM form_submissions fs
                LEFT JOIN form_responses fr ON fr.submission_id = fs.id
                WHERE fs.assignment_id = %s
                  AND fs.submitted_by = %s
                  AND fs.status = 'draft'
                  AND fs.is_deleted = FALSE
                GROUP BY fs.id
                LIMIT 1
                """,
                (str(assignment_id), str(user_id)),
            )
            if sub:
                sub = dict(sub)
                # Normalise nested responses key to match Supabase shape
                sub["form_responses"] = sub.get("form_responses") or []
                return sub
            return None
        except Exception:
            return None

    @staticmethod
    async def create_submission(
        conn, body: CreateSubmissionRequest, user_id: str, org_id: Optional[str] = None
    ) -> dict:
        # ── Verify form template belongs to the org ──
        if org_id:
            tpl_check = row(
                conn,
                "SELECT id FROM form_templates WHERE id = %s AND organisation_id = %s",
                (str(body.form_template_id), str(org_id)),
            )
            if not tpl_check:
                raise HTTPException(status_code=404, detail="Form template not found")

        # ── Pull-out: validate estimated_cost is present and > 0 ──────────────
        if body.status == "submitted":
            try:
                tpl_type_row = row(
                    conn,
                    "SELECT type FROM form_templates WHERE id = %s",
                    (str(body.form_template_id),),
                )
                if tpl_type_row and tpl_type_row.get("type") == "pull_out":
                    # Find section IDs for this template
                    sec_ids = [
                        str(s["id"]) for s in rows(
                            conn,
                            "SELECT id FROM form_sections WHERE form_template_id = %s",
                            (str(body.form_template_id),),
                        )
                    ]
                    cost_field_ids: set = set()
                    if sec_ids:
                        cost_field_rows = rows(
                            conn,
                            """
                            SELECT id FROM form_fields
                            WHERE is_deleted = FALSE
                              AND LOWER(label) LIKE %s
                              AND section_id = ANY(%s::uuid[])
                            """,
                            ("%estimated cost%", sec_ids),
                        )
                        cost_field_ids = {str(r["id"]) for r in cost_field_rows}
                    if cost_field_ids:
                        cost_response = next(
                            (r for r in body.responses if str(r.field_id) in cost_field_ids),
                            None,
                        )
                        if not cost_response or not cost_response.value:
                            raise HTTPException(status_code=422, detail="Estimated cost is required for pull-out submissions.")
                        try:
                            cost_val = float(cost_response.value)
                        except (ValueError, TypeError):
                            raise HTTPException(status_code=422, detail="Estimated cost must be a number.")
                        if cost_val <= 0:
                            raise HTTPException(status_code=422, detail="Estimated cost must be greater than zero.")
            except HTTPException:
                raise
            except Exception:
                pass  # don't block submission on lookup errors

        # ── Upsert: if a draft already exists for this assignment, update it ──
        existing_id: Optional[str] = None
        if body.assignment_id:
            try:
                existing_r = row(
                    conn,
                    """
                    SELECT id FROM form_submissions
                    WHERE assignment_id = %s
                      AND submitted_by = %s
                      AND status = 'draft'
                      AND is_deleted = FALSE
                    LIMIT 1
                    """,
                    (str(body.assignment_id), str(user_id)),
                )
                if existing_r:
                    existing_id = str(existing_r["id"])
            except Exception:
                pass

        if existing_id:
            # Update the existing draft
            update_fields = {"status": body.status}
            if body.status == "submitted":
                update_fields["submitted_at"] = datetime.now(timezone.utc).isoformat()
            set_clause = ", ".join(f"{k} = %s" for k in update_fields)
            vals = list(update_fields.values()) + [existing_id]
            try:
                execute(
                    conn,
                    f"UPDATE form_submissions SET {set_clause} WHERE id = %s",
                    tuple(vals),
                )
            except Exception as e:
                raise HTTPException(status_code=400, detail=str(e))

            submission_id = existing_id
        else:
            # Insert a new submission
            submitted_at = datetime.now(timezone.utc).isoformat() if body.status == "submitted" else None

            try:
                sub = execute_returning(
                    conn,
                    """
                    INSERT INTO form_submissions
                        (assignment_id, form_template_id, submitted_by, status, submitted_at)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING *
                    """,
                    (
                        str(body.assignment_id) if body.assignment_id else None,
                        str(body.form_template_id),
                        str(user_id),
                        body.status,
                        submitted_at,
                    ),
                )
            except Exception as e:
                raise HTTPException(status_code=400, detail=str(e))

            submission_id = str(sub["id"])

        if body.responses:
            # When updating a draft, collect the IDs of the existing response
            # rows BEFORE inserting so we can delete them only after the
            # insert succeeds.  This prevents data loss if the insert fails.
            old_response_ids: list = []
            if existing_id:
                try:
                    old_rows = rows(
                        conn,
                        "SELECT id FROM form_responses WHERE submission_id = %s",
                        (existing_id,),
                    )
                    old_response_ids = [str(r["id"]) for r in old_rows]
                except Exception:
                    pass  # non-fatal; worst case old rows remain until next save

            response_params = [
                (
                    submission_id,
                    str(item.field_id),
                    item.value,
                    item.comment if item.comment else None,
                )
                for item in body.responses
            ]

            try:
                execute_many(
                    conn,
                    """
                    INSERT INTO form_responses (submission_id, field_id, value, comment)
                    VALUES (%s, %s, %s, %s)
                    """,
                    response_params,
                )
            except Exception as e:
                _log.error("Response insertion failed for submission %s: %s", submission_id, e)
                raise HTTPException(status_code=400, detail=f"Response insertion failed: {e}")

            # Insert succeeded — now safe to remove the previous response rows
            if old_response_ids:
                try:
                    execute(
                        conn,
                        "DELETE FROM form_responses WHERE id = ANY(%s::uuid[])",
                        (old_response_ids,),
                    )
                except Exception:
                    pass  # old rows orphaned but new data is safe

        # ── Pull-out: persist estimated_cost to form_submissions ─────────────
        if body.status == "submitted":
            try:
                tpl_type_po = row(
                    conn,
                    "SELECT type FROM form_templates WHERE id = %s",
                    (str(body.form_template_id),),
                )
                if tpl_type_po and tpl_type_po.get("type") == "pull_out":
                    sec_ids2 = [
                        str(s["id"]) for s in rows(
                            conn,
                            "SELECT id FROM form_sections WHERE form_template_id = %s",
                            (str(body.form_template_id),),
                        )
                    ]
                    cost_field_ids2: set = set()
                    if sec_ids2:
                        cost_field_rows2 = rows(
                            conn,
                            """
                            SELECT id FROM form_fields
                            WHERE is_deleted = FALSE
                              AND LOWER(label) LIKE %s
                              AND section_id = ANY(%s::uuid[])
                            """,
                            ("%estimated cost%", sec_ids2),
                        )
                        cost_field_ids2 = {str(r["id"]) for r in cost_field_rows2}
                    if cost_field_ids2:
                        cost_resp_item = next(
                            (r for r in body.responses if str(r.field_id) in cost_field_ids2),
                            None,
                        )
                        if cost_resp_item:
                            try:
                                execute(
                                    conn,
                                    "UPDATE form_submissions SET estimated_cost = %s WHERE id = %s",
                                    (float(cost_resp_item.value), submission_id),
                                )
                            except Exception:
                                pass
            except Exception:
                pass

        # ── Audit scoring: calculate and persist score on final submission ──
        if body.status == "submitted":
            try:
                tpl_scoring = row(
                    conn,
                    "SELECT type, organisation_id FROM form_templates WHERE id = %s",
                    (str(body.form_template_id),),
                )
                if tpl_scoring and tpl_scoring.get("type") == "audit":
                    responses_as_dicts = [
                        {"field_id": str(item.field_id), "value": item.value}
                        for item in body.responses
                    ]
                    score_result = await calculate_audit_score(
                        submission_id=submission_id,
                        form_template_id=str(body.form_template_id),
                        responses=responses_as_dicts,
                        org_id=tpl_scoring.get("organisation_id", ""),
                    )
                    execute(
                        conn,
                        "UPDATE form_submissions SET overall_score = %s, passed = %s WHERE id = %s",
                        (score_result.overall_score, score_result.passed, submission_id),
                    )
            except Exception as score_err:
                # Scoring failure should not block submission persistence
                _log.error("Audit scoring failed: %s", score_err)

        # Auto-trigger form_submitted / audit_submitted workflows
        if body.status == "submitted":
            try:
                from services.workflow_service import trigger_workflows_for_event
                tpl_wf = row(
                    conn,
                    "SELECT type, organisation_id FROM form_templates WHERE id = %s",
                    (str(body.form_template_id),),
                )
                if tpl_wf:
                    _tpl_org_id = tpl_wf.get("organisation_id", "")
                    tpl_type = tpl_wf.get("type", "")
                    await trigger_workflows_for_event(
                        event_type="form_submitted",
                        org_id=_tpl_org_id,
                        source_id=submission_id,
                        triggered_by=user_id,
                        template_id=str(body.form_template_id),
                    )
                    if tpl_type == "audit":
                        await trigger_workflows_for_event(
                            event_type="audit_submitted",
                            org_id=_tpl_org_id,
                            source_id=submission_id,
                            triggered_by=user_id,
                            template_id=str(body.form_template_id),
                        )
            except Exception as _wf_exc:
                _log.warning("Workflow trigger failed for submission %s: %s", submission_id, _wf_exc)

        # Notify the assigning manager when a form is submitted for review
        if body.status == "submitted":
            try:
                assign_r = row(
                    conn,
                    """
                    SELECT fa.assigned_by, fa.assigned_to_location_id,
                           ft.title AS template_title, fa.organisation_id
                    FROM form_assignments fa
                    JOIN form_templates ft ON ft.id = fa.form_template_id
                    WHERE fa.id = %s
                    """,
                    (str(body.assignment_id),),
                )
                assign_data = dict(assign_r) if assign_r else {}
                assigned_by = assign_data.get("assigned_by")
                tmpl_title = assign_data.get("template_title", "Form")
                if assigned_by:
                    submitter_r = row(
                        conn,
                        "SELECT full_name FROM profiles WHERE id = %s",
                        (str(user_id),),
                    )
                    submitter_name = (submitter_r or {}).get("full_name", "Someone")
                    loc_name = ""
                    loc_id = assign_data.get("assigned_to_location_id")
                    if loc_id:
                        loc_r = row(
                            conn,
                            "SELECT name FROM locations WHERE id = %s",
                            (str(loc_id),),
                        )
                        loc_name = (loc_r or {}).get("name", "")
                    import asyncio as _asyncio
                    from services import notification_service as _ns
                    _notify_org_id = org_id or assign_data.get("organisation_id", "")
                    _asyncio.create_task(_ns.notify(
                        org_id=str(_notify_org_id),
                        recipient_user_id=str(assigned_by),
                        type="form_submission_review",
                        title=f"Submission ready: {tmpl_title}",
                        body=f"By {submitter_name}" + (f" at {loc_name}" if loc_name else ""),
                        entity_type="form_submission",
                        entity_id=submission_id,
                    ))
            except Exception:
                pass

        # Fetch the freshly-created submission — no org filter needed here
        # because the row was just inserted by this user in this request.
        return await FormService.get_submission(conn, submission_id, user_id)

    @staticmethod
    async def get_submission(
        conn, submission_id: str, user_id: str, org_id: Optional[str] = None
    ) -> dict:
        try:
            extra_filter = "AND ft.organisation_id = %s" if org_id else ""
            params = (str(submission_id), str(org_id)) if org_id else (str(submission_id),)

            sub = row(
                conn,
                f"""
                SELECT fs.*,
                       p.full_name AS submitted_by_full_name,
                       row_to_json(ft) AS form_templates
                FROM form_submissions fs
                LEFT JOIN profiles p ON p.id = fs.submitted_by
                LEFT JOIN form_templates ft ON ft.id = fs.form_template_id
                WHERE fs.id = %s
                {extra_filter}
                """,
                params,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not sub:
            raise HTTPException(status_code=404, detail="Submission not found")

        sub = dict(sub)

        try:
            response_rows = rows(
                conn,
                "SELECT * FROM form_responses WHERE submission_id = %s",
                (str(submission_id),),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        sub["responses"] = [dict(r) for r in response_rows]
        return sub

    @staticmethod
    async def list_submissions(
        conn,
        org_id: str,
        template_id: Optional[str] = None,
        user_id_filter: Optional[str] = None,
        location_id: Optional[str] = None,
        status: Optional[str] = None,
        from_dt: Optional[datetime] = None,
        to_dt: Optional[datetime] = None,
        page: int = 1,
        page_size: int = 20,
        team_user_ids: Optional[list] = None,
    ) -> PaginatedResponse[dict]:
        offset = (page - 1) * page_size

        where = ["ft.organisation_id = %s", "fs.is_deleted = FALSE"]
        params: list = [str(org_id)]

        if template_id:
            where.append("fs.form_template_id = %s")
            params.append(str(template_id))
        if team_user_ids:
            where.append("fs.submitted_by = ANY(%s::uuid[])")
            params.append(list(team_user_ids))
        elif user_id_filter:
            where.append("fs.submitted_by = %s")
            params.append(str(user_id_filter))
        if location_id:
            where.append("p.location_id = %s")
            params.append(str(location_id))
        if status:
            where.append("fs.status = %s")
            params.append(status)
        if from_dt:
            where.append("fs.created_at >= %s")
            params.append(from_dt.isoformat())
        if to_dt:
            where.append("fs.created_at <= %s")
            params.append(to_dt.isoformat())

        where_sql = " AND ".join(where)

        try:
            count_r = row(
                conn,
                f"""
                SELECT COUNT(*) AS cnt
                FROM form_submissions fs
                JOIN form_templates ft ON ft.id = fs.form_template_id
                LEFT JOIN profiles p ON p.id = fs.submitted_by
                WHERE {where_sql}
                """,
                tuple(params),
            )
            total_count = count_r["cnt"] if count_r else 0

            data_rows = rows(
                conn,
                f"""
                SELECT fs.*,
                       p.full_name AS submitted_by_full_name,
                       row_to_json(ft) AS form_templates
                FROM form_submissions fs
                JOIN form_templates ft ON ft.id = fs.form_template_id
                LEFT JOIN profiles p ON p.id = fs.submitted_by
                WHERE {where_sql}
                ORDER BY fs.created_at DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [page_size, offset]),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        return PaginatedResponse(
            items=[dict(r) for r in data_rows],
            total_count=total_count,
            page=page,
            page_size=page_size,
        )

    @staticmethod
    async def get_template_stats(conn, template_id: str, org_id: str) -> TemplateStatsResponse:
        # Count active assignments for this template within the org
        try:
            assign_count_r = row(
                conn,
                """
                SELECT COUNT(*) AS cnt
                FROM form_assignments
                WHERE form_template_id = %s
                  AND organisation_id = %s
                  AND is_deleted = FALSE
                """,
                (str(template_id), str(org_id)),
            )
            assigned_count = assign_count_r["cnt"] if assign_count_r else 0
        except Exception:
            assigned_count = 0

        # Count submitted/approved submissions scoped to the org via assignments
        try:
            sub_rows = rows(
                conn,
                """
                SELECT fs.submitted_at
                FROM form_submissions fs
                JOIN form_assignments fa ON fa.id = fs.assignment_id
                WHERE fs.form_template_id = %s
                  AND fa.organisation_id = %s
                  AND fs.status IN ('submitted', 'approved')
                """,
                (str(template_id), str(org_id)),
            )
            completed_count = len(sub_rows)
            latest = None
            for r in sub_rows:
                sat = r.get("submitted_at")
                if sat and (latest is None or sat > latest):
                    latest = sat
        except Exception:
            completed_count = 0
            latest = None

        return TemplateStatsResponse(
            template_id=template_id,
            assigned_count=assigned_count,
            completed_count=completed_count,
            latest_response_at=latest,
        )

    @staticmethod
    async def review_submission(
        conn,
        submission_id: str,
        body: ReviewSubmissionRequest,
        reviewer_id: str,
        org_id: str,
    ) -> dict:
        # Fetch submission and verify it belongs to the reviewer's org via form template
        existing = row(
            conn,
            """
            SELECT fs.id, fs.passed, fs.form_template_id,
                   ft.organisation_id AS template_org_id
            FROM form_submissions fs
            JOIN form_templates ft ON ft.id = fs.form_template_id
            WHERE fs.id = %s
            """,
            (str(submission_id),),
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Submission not found")

        existing = dict(existing)
        if existing.get("template_org_id") != str(org_id):
            raise HTTPException(status_code=403, detail="Not authorised to review this submission")

        updates = {
            "status": body.status,
            "reviewed_by": str(reviewer_id),
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        }
        if body.manager_comment is not None:
            updates["manager_comment"] = body.manager_comment

        set_clause = ", ".join(f"{k} = %s" for k in updates)
        vals = list(updates.values()) + [str(submission_id)]

        try:
            updated = execute_returning(
                conn,
                f"UPDATE form_submissions SET {set_clause} WHERE id = %s RETURNING *",
                tuple(vals),
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        # ── CAP creation on approval of a failed audit ──────────────────────
        if body.status == "approved":
            passed = existing.get("passed")
            form_template_id = existing.get("form_template_id")
            # location_id requires separate lookup via the assignment
            location_id = None
            try:
                assign_loc = row(
                    conn,
                    """
                    SELECT fa.assigned_to_location_id
                    FROM form_assignments fa
                    JOIN form_submissions fs ON fs.assignment_id = fa.id
                    WHERE fs.id = %s
                    LIMIT 1
                    """,
                    (str(submission_id),),
                )
                if assign_loc:
                    location_id = assign_loc.get("assigned_to_location_id")
            except Exception:
                pass

            if passed is False and form_template_id and location_id:
                try:
                    from services.audit_scoring_service import calculate_audit_score, create_corrective_actions

                    resp_rows = rows(
                        conn,
                        "SELECT field_id, value FROM form_responses WHERE submission_id = %s",
                        (str(submission_id),),
                    )
                    responses_as_dicts = [
                        {"field_id": r["field_id"], "value": r["value"]}
                        for r in resp_rows
                    ]

                    score_result = await calculate_audit_score(
                        submission_id=submission_id,
                        form_template_id=str(form_template_id),
                        responses=responses_as_dicts,
                        org_id=str(org_id),
                    )

                    if score_result.failed_fields:
                        await create_corrective_actions(
                            submission_id=submission_id,
                            failed_fields=score_result.failed_fields,
                            org_id=str(org_id),
                            location_id=str(location_id),
                            form_template_id=str(form_template_id),
                            responses=responses_as_dicts,
                        )
                except Exception as cap_err:
                    _log.error("CAP creation failed on approval: %s", cap_err)

        return dict(updated)
