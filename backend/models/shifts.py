from __future__ import annotations

from datetime import date, time
from typing import Optional
from pydantic import BaseModel


# ── Shift Templates ────────────────────────────────────────────────────────────

class CreateShiftTemplateRequest(BaseModel):
    name: str
    role: Optional[str] = None
    start_time: str          # "HH:MM"
    end_time: str            # "HH:MM"
    days_of_week: list[int]  # 0=Mon … 6=Sun
    location_id: Optional[str] = None   # None = org-wide (admin only)
    is_active: bool = True


class UpdateShiftTemplateRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    days_of_week: Optional[list[int]] = None
    location_id: Optional[str] = None
    is_active: Optional[bool] = None


# ── Shifts ─────────────────────────────────────────────────────────────────────

class CreateShiftRequest(BaseModel):
    location_id: str
    role: Optional[str] = None
    start_at: str                       # ISO datetime string
    end_at: str                         # ISO datetime string
    assigned_to_user_id: Optional[str] = None
    template_id: Optional[str] = None
    notes: Optional[str] = None
    is_open_shift: bool = False
    status: str = "draft"


class UpdateShiftRequest(BaseModel):
    location_id: Optional[str] = None
    role: Optional[str] = None
    start_at: Optional[str] = None
    end_at: Optional[str] = None
    assigned_to_user_id: Optional[str] = None
    notes: Optional[str] = None
    is_open_shift: Optional[bool] = None
    status: Optional[str] = None
    cancellation_reason: Optional[str] = None


class BulkGenerateShiftsRequest(BaseModel):
    template_id: str
    date_from: date
    date_to: date
    location_id: Optional[str] = None  # required when template is org-wide (no location_id)


class ShiftAssignment(BaseModel):
    shift_id: str
    user_id: Optional[str] = None
    is_open_shift: bool = False


class BulkAssignRequest(BaseModel):
    assignments: list[ShiftAssignment]


class PublishShiftsRequest(BaseModel):
    shift_ids: list[str]


class BulkPublishRequest(BaseModel):
    filter_type: str                    # "location" | "role" | "individual"
    location_id: Optional[str] = None  # for filter_type="location"
    role: Optional[str] = None         # for filter_type="role"
    user_id: Optional[str] = None      # for filter_type="individual"
    week_start: Optional[str] = None   # ISO date "YYYY-MM-DD"
    week_end: Optional[str] = None     # ISO date "YYYY-MM-DD"


# ── Open Shifts ────────────────────────────────────────────────────────────────

class ClaimShiftRequest(BaseModel):
    shift_id: str


class RespondToClaimRequest(BaseModel):
    action: str   # 'approve' | 'reject'
    manager_note: Optional[str] = None


# ── Swap Requests ──────────────────────────────────────────────────────────────

class CreateSwapRequest(BaseModel):
    shift_id: str
    target_user_id: Optional[str] = None
    target_shift_id: Optional[str] = None


class RespondToSwapRequest(BaseModel):
    action: str                         # 'accept' | 'decline' | 'approve' | 'reject'
    rejection_reason: Optional[str] = None


# ── Leave ──────────────────────────────────────────────────────────────────────

class CreateLeaveRequest(BaseModel):
    leave_type: str   # 'annual' | 'sick' | 'emergency' | 'unpaid' | 'other'
    start_date: date
    end_date: date
    reason: Optional[str] = None


class RespondToLeaveRequest(BaseModel):
    action: str   # 'approve' | 'reject'


# ── Availability ───────────────────────────────────────────────────────────────

class SetAvailabilityRequest(BaseModel):
    day_of_week: int        # 0=Mon … 6=Sun
    available_from: str     # "HH:MM"
    available_to: str       # "HH:MM"
    is_available: bool = True
    effective_from: Optional[str] = None   # date string "YYYY-MM-DD"
    effective_to: Optional[str] = None     # date string "YYYY-MM-DD"


# ── Attendance ─────────────────────────────────────────────────────────────────

class ClockInRequest(BaseModel):
    shift_id: Optional[str] = None
    location_id: str
    clock_in_method: str = "gps"
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ClockOutRequest(BaseModel):
    attendance_id: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ManagerOverrideRequest(BaseModel):
    user_id: str
    shift_id: Optional[str] = None
    location_id: str
    clock_in_at: str   # ISO datetime string
    clock_out_at: Optional[str] = None
    note: str


# ── Attendance Rules ───────────────────────────────────────────────────────────

class UpdateAttendanceRulesRequest(BaseModel):
    late_threshold_mins: Optional[int] = None
    early_departure_threshold_mins: Optional[int] = None
    overtime_threshold_hours: Optional[float] = None
    weekly_overtime_threshold_hours: Optional[float] = None
    break_duration_mins: Optional[int] = None


# ── Breaks ─────────────────────────────────────────────────────────────────────

class StartBreakRequest(BaseModel):
    attendance_id: str
    break_type: str = "rest"   # "meal" | "rest" | "other"


class EndBreakRequest(BaseModel):
    attendance_id: str


# ── AI Schedule ────────────────────────────────────────────────────────────────

class GenerateScheduleRequest(BaseModel):
    location_id: str
    week_start: date
    notes: Optional[str] = None
