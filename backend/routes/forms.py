from uuid import UUID
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from dependencies import get_current_user, require_manager_or_above, paginate
from models.forms import (
    CreateFormTemplateRequest,
    UpdateFormTemplateRequest,
    CreateAssignmentRequest,
    CreateSubmissionRequest,
    ReviewSubmissionRequest,
    GenerateTemplateRequest,
    TemplateStatsResponse,
)
from services.form_service import FormService
from services.ai_service import generate_template

router = APIRouter()


@router.post("/generate")
async def generate_form_template(
    body: GenerateTemplateRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    """Use AI to generate a form template from a plain-text description."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await generate_template(body, org_id=org_id)


@router.get("/templates")
async def list_templates(
    pagination: dict = Depends(paginate),
    type: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await FormService.list_templates(
        org_id=org_id,
        type_filter=type,
        is_active=is_active,
        page=pagination["page"],
        page_size=pagination["page_size"],
    )


@router.post("/templates")
async def create_template(
    body: CreateFormTemplateRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    created_by = current_user["sub"]
    return await FormService.create_template(body, org_id, created_by)


@router.get("/templates/{template_id}")
async def get_template(
    template_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await FormService.get_template(str(template_id), org_id)


@router.put("/templates/{template_id}")
async def update_template(
    template_id: UUID,
    body: UpdateFormTemplateRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await FormService.update_template(str(template_id), org_id, body)


@router.get("/templates/{template_id}/stats")
async def get_template_stats(
    template_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await FormService.get_template_stats(str(template_id), org_id)


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await FormService.delete_template(str(template_id), org_id)


@router.post("/assignments")
async def create_assignment(
    body: CreateAssignmentRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await FormService.create_assignment(body, org_id)


@router.get("/assignments/my")
async def my_assignments(current_user: dict = Depends(get_current_user)):
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await FormService.my_assignments(user_id, org_id)


@router.get("/assignments/{assignment_id}/template")
async def get_assignment_template(
    assignment_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Return the full template for an assignment the current user is assigned to."""
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await FormService.get_assignment_template(str(assignment_id), user_id, org_id)


@router.get("/assignments/{assignment_id}/draft")
async def get_assignment_draft(
    assignment_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Return the current user's draft submission for an assignment, or null."""
    user_id = current_user["sub"]
    draft = await FormService.get_draft_for_assignment(str(assignment_id), user_id)
    return draft or {}


@router.post("/submissions")
async def create_submission(
    body: CreateSubmissionRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await FormService.create_submission(body, user_id, org_id=org_id)


@router.get("/submissions")
async def list_submissions(
    pagination: dict = Depends(paginate),
    template_id: Optional[UUID] = Query(None),
    user_id: Optional[UUID] = Query(None),
    location_id: Optional[UUID] = Query(None),
    status: Optional[str] = Query(None),
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    my_team: Optional[bool] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    caller_id = current_user["sub"]

    # Resolve team member IDs for manager-scoped view
    team_user_ids: Optional[list] = None
    if my_team and not user_id:
        from services.supabase_client import get_supabase
        db = get_supabase()
        dr = db.table("profiles").select("id").eq("reports_to", caller_id).eq("is_deleted", False).execute()
        team_user_ids = [r["id"] for r in (dr.data or [])] + [caller_id]

    return await FormService.list_submissions(
        org_id=org_id,
        template_id=str(template_id) if template_id else None,
        user_id_filter=str(user_id) if user_id else None,
        location_id=str(location_id) if location_id else None,
        status=status,
        from_dt=from_dt,
        to_dt=to_dt,
        page=pagination["page"],
        page_size=pagination["page_size"],
        team_user_ids=team_user_ids,
    )


@router.get("/submissions/{submission_id}")
async def get_submission(
    submission_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await FormService.get_submission(str(submission_id), user_id, org_id=org_id)


@router.put("/submissions/{submission_id}/review")
async def review_submission(
    submission_id: UUID,
    body: ReviewSubmissionRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    reviewer_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await FormService.review_submission(str(submission_id), body, reviewer_id, org_id)
