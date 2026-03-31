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
from services.supabase_client import get_supabase


class FormService:
    @staticmethod
    async def list_templates(
        org_id: str,
        type_filter: Optional[str] = None,
        is_active: Optional[bool] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> PaginatedResponse[FormTemplateResponse]:
        supabase = get_supabase()
        offset = (page - 1) * page_size

        try:
            query = (
                supabase.table("form_templates")
                .select("*, form_sections(*, form_fields(*))", count="exact")
                .eq("organisation_id", str(org_id))
                .eq("is_deleted", False)
            )
            if type_filter:
                query = query.eq("type", type_filter)
            if is_active is not None:
                query = query.eq("is_active", is_active)

            response = query.order("created_at", desc=True).range(offset, offset + page_size - 1).execute()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        items = []
        for row in response.data:
            raw_sections = row.pop("form_sections", []) or []
            for section in raw_sections:
                section["fields"] = section.pop("form_fields", []) or []
            row["sections"] = raw_sections
            items.append(FormTemplateResponse(**row))
        total_count = response.count if response.count is not None else len(items)

        return PaginatedResponse(items=items, total_count=total_count, page=page, page_size=page_size)

    @staticmethod
    async def create_template(
        body: CreateFormTemplateRequest, org_id: str, created_by: str
    ) -> FormTemplateResponse:
        supabase = get_supabase()

        template_data = {
            "organisation_id": str(org_id),
            "created_by": str(created_by),
            "title": body.title,
            "type": body.type,
            "is_active": True,
            "is_deleted": False,
        }
        if body.description is not None:
            template_data["description"] = body.description

        try:
            tmpl_resp = supabase.table("form_templates").insert(template_data).execute()
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        template_id = tmpl_resp.data[0]["id"]
        sections_out = []

        for section_body in body.sections:
            section_data = {
                "form_template_id": template_id,
                "title": section_body.title,
                "display_order": section_body.display_order,
            }
            if section_body.id is not None:
                section_data["id"] = str(section_body.id)
            try:
                sec_resp = supabase.table("form_sections").insert(section_data).execute()
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Section creation failed: {e}")

            section_id = sec_resp.data[0]["id"]
            fields_out = []

            for field_body in section_body.fields:
                field_data = {
                    "section_id": section_id,
                    "label": field_body.label,
                    "field_type": field_body.field_type,
                    "is_required": field_body.is_required,
                    "display_order": field_body.display_order,
                    "is_critical": field_body.is_critical,
                }
                if field_body.id is not None:
                    field_data["id"] = str(field_body.id)
                if field_body.options is not None:
                    field_data["options"] = field_body.options
                if field_body.conditional_logic is not None:
                    field_data["conditional_logic"] = field_body.conditional_logic
                if field_body.placeholder is not None:
                    field_data["placeholder"] = field_body.placeholder

                try:
                    fld_resp = supabase.table("form_fields").insert(field_data).execute()
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Field creation failed: {e}")

                fields_out.append(FormFieldResponse(**fld_resp.data[0]))

            sections_out.append(
                FormSectionResponse(**sec_resp.data[0], fields=fields_out)
            )

        return FormTemplateResponse(**tmpl_resp.data[0], sections=sections_out)

    @staticmethod
    async def get_template(template_id: str, org_id: str) -> FormTemplateResponse:
        supabase = get_supabase()

        try:
            tmpl_resp = (
                supabase.table("form_templates")
                .select("*")
                .eq("id", str(template_id))
                .eq("organisation_id", str(org_id))
                .eq("is_deleted", False)
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not tmpl_resp.data:
            raise HTTPException(status_code=404, detail="Template not found")

        template = tmpl_resp.data[0]

        try:
            sec_resp = (
                supabase.table("form_sections")
                .select("*")
                .eq("form_template_id", str(template_id))
                .eq("is_deleted", False)
                .order("display_order")
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        sections_out = []
        for section in sec_resp.data:
            try:
                fld_resp = (
                    supabase.table("form_fields")
                    .select("*")
                    .eq("section_id", str(section["id"]))
                    .eq("is_deleted", False)
                    .order("display_order")
                    .execute()
                )
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

            fields_out = [FormFieldResponse(**f) for f in fld_resp.data]
            sections_out.append(FormSectionResponse(**section, fields=fields_out))

        return FormTemplateResponse(**template, sections=sections_out)

    @staticmethod
    async def update_template(
        template_id: str, org_id: str, body: UpdateFormTemplateRequest
    ) -> FormTemplateResponse:
        supabase = get_supabase()

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
            try:
                supabase.table("form_templates").update(updates).eq(
                    "id", str(template_id)
                ).eq("organisation_id", str(org_id)).execute()
            except Exception as e:
                raise HTTPException(status_code=400, detail=str(e))

        if body.sections is not None:
            # Delete existing fields then sections, then recreate
            try:
                existing_sections = (
                    supabase.table("form_sections")
                    .select("id")
                    .eq("form_template_id", str(template_id))
                    .eq("is_deleted", False)
                    .execute()
                )
                section_ids = [s["id"] for s in existing_sections.data]
                if section_ids:
                    for sid in section_ids:
                        supabase.table("form_fields").update({"is_deleted": True}).eq("section_id", sid).execute()
                    supabase.table("form_sections").update({"is_deleted": True}).eq("form_template_id", str(template_id)).execute()
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Section cleanup failed: {e}")

            for section_body in body.sections:
                section_data = {
                    "form_template_id": str(template_id),
                    "title": section_body.title,
                    "display_order": section_body.display_order,
                }
                try:
                    sec_resp = supabase.table("form_sections").insert(section_data).execute()
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Section creation failed: {e}")

                section_id = sec_resp.data[0]["id"]
                for field_body in section_body.fields:
                    field_data = {
                        "section_id": section_id,
                        "label": field_body.label,
                        "field_type": field_body.field_type,
                        "is_required": field_body.is_required,
                        "display_order": field_body.display_order,
                        "is_critical": field_body.is_critical,
                    }
                    if field_body.options is not None:
                        field_data["options"] = field_body.options
                    if field_body.conditional_logic is not None:
                        field_data["conditional_logic"] = field_body.conditional_logic
                    if field_body.placeholder is not None:
                        field_data["placeholder"] = field_body.placeholder
                    try:
                        supabase.table("form_fields").insert(field_data).execute()
                    except Exception as e:
                        raise HTTPException(status_code=400, detail=f"Field creation failed: {e}")

        return await FormService.get_template(template_id, org_id)

    @staticmethod
    async def delete_template(template_id: str, org_id: str) -> dict:
        supabase = get_supabase()

        existing = (
            supabase.table("form_templates")
            .select("id")
            .eq("id", str(template_id))
            .eq("organisation_id", str(org_id))
            .eq("is_deleted", False)
            .execute()
        )
        if not existing.data:
            raise HTTPException(status_code=404, detail="Template not found")

        try:
            supabase.table("form_templates").update({"is_deleted": True}).eq(
                "id", str(template_id)
            ).execute()
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        return {"success": True, "message": "Template deleted"}

    @staticmethod
    async def create_assignment(body: CreateAssignmentRequest, org_id: str) -> dict:
        supabase = get_supabase()

        # Audit templates require a location
        template_type_resp = (
            supabase.table("form_templates")
            .select("type")
            .eq("id", str(body.form_template_id))
            .maybe_single()
            .execute()
        )
        if template_type_resp.data and template_type_resp.data.get("type") == "audit":
            if not body.assigned_to_location_id:
                raise HTTPException(status_code=422, detail="A location is required when assigning an audit form.")

        assignment_data = {
            "form_template_id": str(body.form_template_id),
            "organisation_id": str(org_id),
            "recurrence": body.recurrence,
            "due_at": body.due_at.isoformat(),
            "is_active": True,
            "is_deleted": False,
        }
        if body.assigned_to_user_id is not None:
            assignment_data["assigned_to_user_id"] = str(body.assigned_to_user_id)
        if body.assigned_to_location_id is not None:
            assignment_data["assigned_to_location_id"] = str(body.assigned_to_location_id)
        if body.cron_expression is not None:
            assignment_data["cron_expression"] = body.cron_expression

        try:
            response = supabase.table("form_assignments").insert(assignment_data).execute()
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        return response.data[0]

    @staticmethod
    async def my_assignments(user_id: str, org_id: str) -> list:
        supabase = get_supabase()

        # Get user's location
        try:
            profile_resp = (
                supabase.table("profiles")
                .select("location_id")
                .eq("id", str(user_id))
                .eq("is_deleted", False)
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        location_id = None
        if profile_resp.data:
            location_id = profile_resp.data[0].get("location_id")

        try:
            ASSIGNMENT_SELECT = "*, form_templates(id, title, type, description, is_active, is_deleted)"

            # Assignments directly to the user
            user_query = (
                supabase.table("form_assignments")
                .select(ASSIGNMENT_SELECT)
                .eq("assigned_to_user_id", str(user_id))
                .eq("is_deleted", False)
                .eq("is_active", True)
                .execute()
            )
            assignments = list(user_query.data)

            # Assignments to user's location
            if location_id:
                loc_query = (
                    supabase.table("form_assignments")
                    .select(ASSIGNMENT_SELECT)
                    .eq("assigned_to_location_id", str(location_id))
                    .eq("is_deleted", False)
                    .eq("is_active", True)
                    .execute()
                )
                # Deduplicate
                existing_ids = {a["id"] for a in assignments}
                for a in loc_query.data:
                    if a["id"] not in existing_ids:
                        assignments.append(a)

            # Filter out assignments whose template has been deleted or deactivated
            assignments = [
                a for a in assignments
                if a.get("form_templates")
                and not a["form_templates"].get("is_deleted")
                and a["form_templates"].get("is_active", True)
            ]
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        # Annotate each assignment with submission status for this user
        if assignments:
            assignment_ids = [a["id"] for a in assignments]
            try:
                sub_resp = (
                    supabase.table("form_submissions")
                    .select("assignment_id, id, status, submitted_at")
                    .in_("assignment_id", assignment_ids)
                    .eq("submitted_by", str(user_id))
                    .eq("is_deleted", False)
                    .execute()
                )
                # Build map: assignment_id → best submission (submitted > draft)
                sub_map: dict = {}
                for s in (sub_resp.data or []):
                    aid = s["assignment_id"]
                    existing = sub_map.get(aid)
                    if not existing or s["status"] == "submitted":
                        sub_map[aid] = s

                for a in assignments:
                    sub = sub_map.get(a["id"])
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
    async def get_assignment_template(assignment_id: str, user_id: str, org_id: str) -> dict:
        """Return the full template for an assignment, verifying the user is assigned to it."""
        supabase = get_supabase()

        # Fetch the assignment
        try:
            resp = (
                supabase.table("form_assignments")
                .select("*")
                .eq("id", assignment_id)
                .eq("is_deleted", False)
                .eq("is_active", True)
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not resp.data:
            raise HTTPException(status_code=404, detail="Assignment not found")

        assignment = resp.data[0]

        # Verify access: user must be directly assigned OR their location must match
        profile_resp = (
            supabase.table("profiles")
            .select("location_id")
            .eq("id", user_id)
            .execute()
        )
        location_id = (profile_resp.data[0].get("location_id") if profile_resp.data else None)

        is_user_assigned = assignment.get("assigned_to_user_id") == user_id
        is_location_assigned = location_id and assignment.get("assigned_to_location_id") == location_id

        # Also allow managers/admins in the same org to access (for previewing)
        is_org_member = assignment.get("organisation_id") == org_id

        if not (is_user_assigned or is_location_assigned or is_org_member):
            raise HTTPException(status_code=403, detail="Not authorised to access this assignment")

        # Use the assignment's own organisation_id for the template lookup —
        # this avoids a crash when org_id is None (invite token before first refresh).
        template_id = assignment["form_template_id"]
        assignment_org_id = assignment["organisation_id"]
        return await FormService.get_template(template_id, assignment_org_id)

    @staticmethod
    async def get_draft_for_assignment(assignment_id: str, user_id: str) -> Optional[dict]:
        """Return the existing draft submission for an assignment, or None."""
        supabase = get_supabase()
        try:
            resp = (
                supabase.table("form_submissions")
                .select("*, form_responses(*)")
                .eq("assignment_id", assignment_id)
                .eq("submitted_by", user_id)
                .eq("status", "draft")
                .eq("is_deleted", False)
                .limit(1)
                .execute()
            )
            if resp.data:
                return resp.data[0]
            return None
        except Exception:
            return None

    @staticmethod
    async def create_submission(body: CreateSubmissionRequest, user_id: str, org_id: Optional[str] = None) -> dict:
        supabase = get_supabase()

        # ── Verify form template belongs to the org ──
        if org_id:
            tpl = supabase.table("form_templates").select("id").eq("id", str(body.form_template_id)).eq("organisation_id", org_id).maybe_single().execute()
            if not tpl.data:
                raise HTTPException(status_code=404, detail="Form template not found")

        # ── Upsert: if a draft already exists for this assignment, update it ──
        existing_id: Optional[str] = None
        if body.assignment_id:
            try:
                existing_resp = (
                    supabase.table("form_submissions")
                    .select("id")
                    .eq("assignment_id", str(body.assignment_id))
                    .eq("submitted_by", str(user_id))
                    .eq("status", "draft")
                    .eq("is_deleted", False)
                    .limit(1)
                    .execute()
                )
                if existing_resp.data:
                    existing_id = existing_resp.data[0]["id"]
            except Exception:
                pass

        if existing_id:
            # Update the existing draft
            update_data: dict = {"status": body.status}
            if body.status == "submitted":
                update_data["submitted_at"] = datetime.now(timezone.utc).isoformat()
            try:
                supabase.table("form_submissions").update(update_data).eq("id", existing_id).execute()
            except Exception as e:
                raise HTTPException(status_code=400, detail=str(e))

            # Replace responses: delete old ones, insert new
            try:
                supabase.table("form_responses").delete().eq("submission_id", existing_id).execute()
            except Exception:
                pass

            submission_id = existing_id
        else:
            # Insert a new submission
            submission_data = {
                "assignment_id": str(body.assignment_id),
                "form_template_id": str(body.form_template_id),
                "submitted_by": str(user_id),
                "status": body.status,
            }
            if body.status == "submitted":
                submission_data["submitted_at"] = datetime.now(timezone.utc).isoformat()

            try:
                sub_resp = supabase.table("form_submissions").insert(submission_data).execute()
            except Exception as e:
                raise HTTPException(status_code=400, detail=str(e))

            submission_id = sub_resp.data[0]["id"]

        if body.responses:
            response_rows = [
                {
                    "submission_id": submission_id,
                    "field_id": str(item.field_id),
                    "value": item.value,
                    **({"comment": item.comment} if item.comment else {}),
                }
                for item in body.responses
            ]
            try:
                supabase.table("form_responses").insert(response_rows).execute()
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Response insertion failed: {e}")

        # ── Audit scoring: calculate and persist score on final submission ──
        if body.status == "submitted":
            try:
                template_type_resp = (
                    supabase.table("form_templates")
                    .select("type, organisation_id")
                    .eq("id", str(body.form_template_id))
                    .execute()
                )
                if template_type_resp.data and template_type_resp.data[0].get("type") == "audit":
                    responses_as_dicts = [
                        {"field_id": str(item.field_id), "value": item.value}
                        for item in body.responses
                    ]
                    score_result = await calculate_audit_score(
                        submission_id=submission_id,
                        form_template_id=str(body.form_template_id),
                        responses=responses_as_dicts,
                        org_id=template_type_resp.data[0].get("organisation_id", ""),
                    )
                    supabase.table("form_submissions").update({
                        "overall_score": score_result.overall_score,
                        "passed": score_result.passed,
                    }).eq("id", submission_id).execute()
            except Exception as score_err:
                # Scoring failure should not block submission persistence
                import logging
                logging.getLogger(__name__).error("Audit scoring failed: %s", score_err)

        # Auto-trigger form_submitted / audit_submitted workflows
        if body.status == "submitted":
            try:
                from services.workflow_service import trigger_workflows_for_event
                tpl_resp = (
                    supabase.table("form_templates")
                    .select("type, organisation_id")
                    .eq("id", str(body.form_template_id))
                    .execute()
                )
                if tpl_resp.data:
                    org_id = tpl_resp.data[0].get("organisation_id", "")
                    tpl_type = tpl_resp.data[0].get("type", "")
                    # Trigger for all submitted forms
                    await trigger_workflows_for_event(
                        event_type="form_submitted",
                        org_id=org_id,
                        source_id=submission_id,
                        triggered_by=user_id,
                        template_id=str(body.form_template_id),
                    )
                    # Additionally trigger audit_submitted for audit-type forms
                    if tpl_type == "audit":
                        await trigger_workflows_for_event(
                            event_type="audit_submitted",
                            org_id=org_id,
                            source_id=submission_id,
                            triggered_by=user_id,
                            template_id=str(body.form_template_id),
                        )
            except Exception as _wf_exc:
                import logging
                logging.getLogger(__name__).warning(
                    "Workflow trigger failed for submission %s: %s", submission_id, _wf_exc
                )

        return await FormService.get_submission(submission_id, user_id, org_id=org_id)

    @staticmethod
    async def get_submission(submission_id: str, user_id: str, org_id: Optional[str] = None) -> dict:
        supabase = get_supabase()

        try:
            query = (
                supabase.table("form_submissions")
                .select("*, profiles!submitted_by(full_name), form_templates(title, type, organisation_id, audit_configs(passing_score))")
                .eq("id", str(submission_id))
            )
            if org_id:
                query = query.eq("organisation_id", org_id)
            sub_resp = query.execute()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not sub_resp.data:
            raise HTTPException(status_code=404, detail="Submission not found")

        submission = sub_resp.data[0]

        try:
            resp_resp = (
                supabase.table("form_responses")
                .select("*")
                .eq("submission_id", str(submission_id))
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        submission["responses"] = resp_resp.data
        return submission

    @staticmethod
    async def list_submissions(
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
        supabase = get_supabase()
        offset = (page - 1) * page_size

        try:
            query = (
                supabase.table("form_submissions")
                .select(
                    "*, profiles!submitted_by(full_name), form_templates!inner(title, type, organisation_id), "
                    "workflow_stage_instances!form_submission_id(workflow_instance_id, workflow_instances(workflow_definitions(name)))",
                    count="exact",
                )
                .eq("form_templates.organisation_id", str(org_id))
            )
            if template_id:
                query = query.eq("form_template_id", str(template_id))
            if team_user_ids:
                query = query.in_("submitted_by", team_user_ids)
            elif user_id_filter:
                query = query.eq("submitted_by", str(user_id_filter))
            if location_id:
                query = query.eq("profiles.location_id", str(location_id))
            if status:
                query = query.eq("status", status)
            if from_dt:
                query = query.gte("created_at", from_dt.isoformat())
            if to_dt:
                query = query.lte("created_at", to_dt.isoformat())

            response = query.range(offset, offset + page_size - 1).execute()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        total_count = response.count if response.count is not None else len(response.data)
        return PaginatedResponse(
            items=response.data,
            total_count=total_count,
            page=page,
            page_size=page_size,
        )

    @staticmethod
    async def get_template_stats(template_id: str, org_id: str) -> TemplateStatsResponse:
        supabase = get_supabase()
        # Count active assignments for this template within the org
        try:
            assign_resp = (
                supabase.table("form_assignments")
                .select("id", count="exact")
                .eq("form_template_id", template_id)
                .eq("organisation_id", str(org_id))
                .eq("is_deleted", False)
                .execute()
            )
            assigned_count = assign_resp.count if assign_resp.count is not None else 0
        except Exception:
            assigned_count = 0

        # Count submitted/approved submissions scoped to the org via assignments
        try:
            sub_resp = (
                supabase.table("form_submissions")
                .select(
                    "id, submitted_at, form_assignments!inner(organisation_id)",
                    count="exact",
                )
                .eq("form_template_id", template_id)
                .eq("form_assignments.organisation_id", str(org_id))
                .in_("status", ["submitted", "approved"])
                .execute()
            )
            completed_count = sub_resp.count if sub_resp.count is not None else 0
            # Get latest submitted_at
            latest = None
            for row in (sub_resp.data or []):
                sat = row.get("submitted_at")
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
        submission_id: str, body: ReviewSubmissionRequest, reviewer_id: str, org_id: str
    ) -> dict:
        supabase = get_supabase()

        # Fetch submission and verify it belongs to the reviewer's org via form template
        existing = (
            supabase.table("form_submissions")
            .select("id, passed, form_template_id, form_templates(organisation_id)")
            .eq("id", str(submission_id))
            .execute()
        )
        if not existing.data:
            raise HTTPException(status_code=404, detail="Submission not found")

        template_org = (existing.data[0].get("form_templates") or {}).get("organisation_id")
        if template_org != str(org_id):
            raise HTTPException(status_code=403, detail="Not authorised to review this submission")

        updates = {
            "status": body.status,
            "reviewed_by": str(reviewer_id),
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        }
        if body.manager_comment is not None:
            updates["manager_comment"] = body.manager_comment

        try:
            response = (
                supabase.table("form_submissions")
                .update(updates)
                .eq("id", str(submission_id))
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        # ── CAP creation on approval of a failed audit ──────────────────────
        if body.status == "approved":
            sub_data = existing.data[0]
            passed = sub_data.get("passed")
            form_template_id = sub_data.get("form_template_id")
            location_id = (sub_data.get("form_assignments") or {}).get("assigned_to_location_id")

            if passed is False and form_template_id and location_id:
                try:
                    from services.audit_scoring_service import calculate_audit_score, create_corrective_actions

                    resp_rows = (
                        supabase.table("form_responses")
                        .select("field_id, value")
                        .eq("submission_id", str(submission_id))
                        .execute()
                    )
                    responses_as_dicts = [
                        {"field_id": r["field_id"], "value": r["value"]}
                        for r in (resp_rows.data or [])
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
                    import logging
                    logging.getLogger(__name__).error("CAP creation failed on approval: %s", cap_err)

        return response.data[0]
