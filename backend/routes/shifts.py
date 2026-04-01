"""
Shifts & Attendance API — /api/v1/shifts
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from dependencies import get_current_user, require_manager_or_above, require_admin, paginate
from models.shifts import (
    CreateShiftTemplateRequest,
    UpdateShiftTemplateRequest,
    BulkGenerateShiftsRequest,
    BulkAssignRequest,
    CreateShiftRequest,
    UpdateShiftRequest,
    PublishShiftsRequest,
    BulkPublishRequest,
    RespondToClaimRequest,
    CreateSwapRequest,
    RespondToSwapRequest,
    CreateLeaveRequest,
    RespondToLeaveRequest,
    SetAvailabilityRequest,
    ClockInRequest,
    ClockOutRequest,
    ManagerOverrideRequest,
    UpdateAttendanceRulesRequest,
    GenerateScheduleRequest,
    StartBreakRequest,
    EndBreakRequest,
)
from services.shift_service import ShiftService

router = APIRouter()


# ── Shift Templates ────────────────────────────────────────────────────────────

@router.get("/templates")
async def list_templates(
    location_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    role = (current_user.get("app_metadata") or {}).get("role", "manager")
    is_admin = role in ("super_admin", "admin")
    return await ShiftService.list_templates(org_id, location_id=location_id, is_admin=is_admin)


@router.post("/templates")
async def create_template(
    body: CreateShiftTemplateRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.create_template(body, org_id, user_id)


@router.put("/templates/{template_id}")
async def update_template(
    template_id: UUID,
    body: UpdateShiftTemplateRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await ShiftService.update_template(str(template_id), org_id, body)


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    await ShiftService.delete_template(str(template_id), org_id)
    return {"ok": True}


@router.post("/templates/{template_id}/generate")
async def bulk_generate_shifts(
    template_id: UUID,
    body: BulkGenerateShiftsRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    # Override template_id from path
    body.template_id = str(template_id)
    return await ShiftService.bulk_generate(body, org_id, user_id)


# ── Shifts CRUD ────────────────────────────────────────────────────────────────

@router.get("/")
async def list_shifts(
    location_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    role = (current_user.get("app_metadata") or {}).get("role", "staff")
    current_uid = current_user["sub"]

    # Staff can only see their own + open shifts (enforced additionally here)
    if role == "staff":
        user_id = current_uid

    return await ShiftService.list_shifts(
        org_id=org_id,
        location_id=location_id,
        user_id=user_id,
        status=status,
        from_date=from_date,
        to_date=to_date,
        page=pagination["page"],
        page_size=pagination["page_size"],
    )


@router.post("/")
async def create_shift(
    body: CreateShiftRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.create_shift(body, org_id, user_id)


@router.put("/assign-bulk")
async def assign_bulk(
    body: BulkAssignRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    """Bulk-assign staff to draft shifts (or mark as open shifts)."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await ShiftService.assign_bulk(body.assignments, org_id)


@router.post("/publish")
async def publish_shifts(
    body: PublishShiftsRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await ShiftService.publish_shifts(body.shift_ids, org_id)


@router.post("/publish/bulk")
async def publish_shifts_bulk(
    body: BulkPublishRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    meta = current_user.get("app_metadata") or {}
    org_id = meta.get("organisation_id")
    role = meta.get("role", "manager")
    # Managers are restricted to their own location regardless of what was sent
    if role not in ("super_admin", "admin"):
        body.location_id = meta.get("location_id")
        if body.filter_type != "individual":
            body.filter_type = "location"
    return await ShiftService.publish_bulk(
        org_id=org_id,
        filter_type=body.filter_type,
        location_id=body.location_id,
        role=body.role,
        user_id=body.user_id,
        week_start=body.week_start,
        week_end=body.week_end,
    )


@router.get("/my")
async def my_shifts(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """Current user's published shifts for schedule view."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.list_shifts(
        org_id, user_id=user_id,
        status="published",
        from_date=from_date, to_date=to_date,
        page=1, page_size=200,
    )


@router.get("/open")
async def list_open_shifts(
    location_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """Open shifts at current user's location."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await ShiftService.list_shifts(
        org_id, location_id=location_id,
        status="open",
        page=1, page_size=100,
    )


@router.get("/claims")
async def list_claims(
    shift_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await ShiftService.list_claims(org_id, shift_id=shift_id, status=status)


@router.get("/swaps")
async def list_swaps(
    status: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    role = (current_user.get("app_metadata") or {}).get("role", "staff")
    current_uid = current_user["sub"]
    # Staff see only their own swaps; managers see all
    filter_user = current_uid if role == "staff" else None
    return await ShiftService.list_swap_requests(org_id, user_id=filter_user, status=status)


@router.post("/swaps")
async def create_swap(
    body: CreateSwapRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.create_swap_request(body, user_id, org_id)


@router.post("/swaps/{swap_id}/respond")
async def respond_to_swap(
    swap_id: UUID,
    body: RespondToSwapRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.respond_to_swap(
        str(swap_id), body.action, user_id, org_id, reason=body.rejection_reason
    )


@router.put("/swaps/{swap_id}/colleague-response")
async def swap_colleague_response(
    swap_id: UUID,
    body: RespondToSwapRequest,
    current_user: dict = Depends(get_current_user),
):
    """Colleague accepts or declines a swap request (action: 'accept' | 'decline')."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.respond_to_swap(
        str(swap_id), body.action, user_id, org_id, reason=body.rejection_reason
    )


@router.put("/swaps/{swap_id}/manager-response")
async def swap_manager_response(
    swap_id: UUID,
    body: RespondToSwapRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    """Manager approves or rejects a confirmed swap (action: 'approve' | 'reject')."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.respond_to_swap(
        str(swap_id), body.action, user_id, org_id, reason=body.rejection_reason
    )


@router.post("/swaps/{swap_id}/cancel")
async def cancel_swap(
    swap_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Requester cancels their own pending swap request."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.respond_to_swap(
        str(swap_id), "cancel", user_id, org_id
    )


@router.get("/leave")
async def list_leave(
    status: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    role = (current_user.get("app_metadata") or {}).get("role", "staff")
    current_uid = current_user["sub"]
    # Staff see only their own leave
    if role == "staff":
        user_id = current_uid
    return await ShiftService.list_leave_requests(
        org_id, user_id=user_id, status=status,
        page=pagination["page"], page_size=pagination["page_size"]
    )


@router.post("/leave")
async def create_leave(
    body: CreateLeaveRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.create_leave_request(body, user_id, org_id)


@router.post("/leave/{leave_id}/respond")
async def respond_to_leave(
    leave_id: UUID,
    body: RespondToLeaveRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    manager_id = current_user["sub"]
    return await ShiftService.respond_to_leave(str(leave_id), body.action, manager_id, org_id)


@router.get("/availability")
async def get_availability(
    user_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    role = (current_user.get("app_metadata") or {}).get("role", "staff")
    current_uid = current_user["sub"]
    # Staff always see own; managers can query specific user
    target_uid = user_id if (user_id and role in ("manager", "admin", "super_admin")) else current_uid
    return await ShiftService.get_availability(target_uid, org_id)


@router.post("/availability")
async def set_availability(
    body: SetAvailabilityRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.set_availability(body, user_id, org_id)


@router.post("/attendance/clock-in")
async def clock_in(
    body: ClockInRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.clock_in(body, user_id, org_id)


@router.post("/attendance/clock-out")
async def clock_out(
    body: ClockOutRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.clock_out(body, user_id, org_id)


@router.get("/attendance")
async def list_attendance(
    user_id: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    role = (current_user.get("app_metadata") or {}).get("role", "staff")
    current_uid = current_user["sub"]
    # Staff see only their own records
    if role == "staff":
        user_id = current_uid
    return await ShiftService.list_attendance(
        org_id,
        user_id=user_id,
        location_id=location_id,
        from_date=from_date,
        to_date=to_date,
        status=status,
        page=pagination["page"],
        page_size=pagination["page_size"],
    )


@router.post("/attendance/override")
async def manager_override(
    body: ManagerOverrideRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    manager_id = current_user["sub"]
    return await ShiftService.manager_override(body, org_id, manager_id)


@router.get("/attendance/timesheet")
async def get_timesheet(
    week_start: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await ShiftService.get_timesheet_summary(org_id, user_id=user_id, week_start=week_start)


@router.get("/attendance/my-timesheet")
async def get_my_timesheet(
    week_start: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.get_my_timesheet(user_id, org_id, week_start=week_start)


@router.get("/rules")
async def get_rules(current_user: dict = Depends(get_current_user)):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await ShiftService.get_attendance_rules(org_id)


@router.put("/rules")
async def update_rules(
    body: UpdateAttendanceRulesRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await ShiftService.update_attendance_rules(body, org_id)


@router.post("/attendance/break/start")
async def start_break(
    body: StartBreakRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.start_break(body, user_id, org_id)


@router.post("/attendance/break/end")
async def end_break(
    body: EndBreakRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.end_break(body, user_id, org_id)


@router.get("/attendance/break/status")
async def get_break_status(
    attendance_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.get_break_status(attendance_id, user_id, org_id)


@router.post("/ai/generate-schedule")
async def generate_schedule(
    body: GenerateScheduleRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.generate_schedule(body, org_id, user_id)


@router.post("/claims/{claim_id}/respond")
async def respond_to_claim(
    claim_id: UUID,
    body: RespondToClaimRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    manager_id = current_user["sub"]
    return await ShiftService.respond_to_claim(
        str(claim_id), body.action, body.manager_note, org_id, manager_id
    )


# ── Shift-specific routes (must come after named routes to avoid conflicts) ────

@router.get("/{shift_id}")
async def get_shift(
    shift_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await ShiftService.get_shift(str(shift_id), org_id)


@router.put("/{shift_id}")
async def update_shift(
    shift_id: UUID,
    body: UpdateShiftRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await ShiftService.update_shift(str(shift_id), org_id, body)


@router.delete("/{shift_id}")
async def delete_shift(
    shift_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    await ShiftService.delete_shift(str(shift_id), org_id)
    return {"ok": True}


@router.post("/{shift_id}/publish")
async def publish_single_shift(
    shift_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    """Publish a single draft shift."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await ShiftService.publish_shifts([str(shift_id)], org_id)


@router.post("/{shift_id}/post-open")
async def post_shift_as_open(
    shift_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    """Post an existing published shift as an open shift for staff to claim."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    from models.shifts import UpdateShiftRequest
    body = UpdateShiftRequest(is_open_shift=True, status="open", assigned_to_user_id=None)
    return await ShiftService.update_shift(str(shift_id), org_id, body)


@router.post("/{shift_id}/claim")
async def claim_shift(
    shift_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await ShiftService.claim_shift(str(shift_id), user_id, org_id)


@router.get("/{shift_id}/claims")
async def list_shift_claims(
    shift_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    """List all claims for a specific shift."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await ShiftService.list_claims(org_id, shift_id=str(shift_id))


@router.put("/{shift_id}/claims/{claim_id}/approve")
async def approve_claim(
    shift_id: UUID,
    claim_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    manager_id = current_user["sub"]
    return await ShiftService.respond_to_claim(str(claim_id), "approve", None, org_id, manager_id)


@router.put("/{shift_id}/claims/{claim_id}/reject")
async def reject_claim(
    shift_id: UUID,
    claim_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    manager_id = current_user["sub"]
    return await ShiftService.respond_to_claim(str(claim_id), "reject", None, org_id, manager_id)
