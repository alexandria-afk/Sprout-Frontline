import { apiFetch } from "@/services/api/client";
import type {
  Shift,
  ShiftTemplate,
  OpenShiftClaim,
  ShiftSwapRequest,
  LeaveRequest,
  StaffAvailability,
  AttendanceRecord,
  AttendanceRules,
  TimesheetSummaryRow,
  PaginatedResponse,
} from "@/types";

// ── Shift Templates ────────────────────────────────────────────────────────────

export function listShiftTemplates(params?: { location_id?: string }): Promise<ShiftTemplate[]> {
  const q = new URLSearchParams();
  if (params?.location_id) q.set("location_id", params.location_id);
  const qs = q.toString();
  return apiFetch(`/api/v1/shifts/templates${qs ? `?${qs}` : ""}`);
}

export function createShiftTemplate(body: {
  name: string;
  role?: string | null;
  start_time: string;
  end_time: string;
  days_of_week: number[];
  location_id?: string | null;  // null = org-wide (admin only)
  is_active?: boolean;
}): Promise<ShiftTemplate> {
  return apiFetch("/api/v1/shifts/templates", { method: "POST", body: JSON.stringify(body) });
}

export function updateShiftTemplate(
  id: string,
  body: Partial<{
    name: string;
    role: string | null;
    start_time: string;
    end_time: string;
    days_of_week: number[];
    location_id: string;
    is_active: boolean;
  }>
): Promise<ShiftTemplate> {
  return apiFetch(`/api/v1/shifts/templates/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteShiftTemplate(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/shifts/templates/${id}`, { method: "DELETE" });
}

export function bulkGenerateShifts(
  templateId: string,
  body: { date_from: string; date_to: string; location_id?: string }
): Promise<{ shifts_created: number }> {
  return apiFetch(`/api/v1/shifts/templates/${templateId}/generate`, {
    method: "POST",
    body: JSON.stringify({ template_id: templateId, ...body }),
  });
}

// ── Shifts ─────────────────────────────────────────────────────────────────────

export function listShifts(params?: {
  location_id?: string;
  user_id?: string;
  status?: string;
  from_date?: string;
  to_date?: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<Shift>> {
  const q = new URLSearchParams();
  if (params?.location_id) q.set("location_id", params.location_id);
  if (params?.user_id)     q.set("user_id", params.user_id);
  if (params?.status)      q.set("status", params.status);
  if (params?.from_date)   q.set("from_date", params.from_date);
  if (params?.to_date)     q.set("to_date", params.to_date);
  q.set("page", String(params?.page ?? 1));
  q.set("page_size", String(params?.page_size ?? 50));
  return apiFetch(`/api/v1/shifts/?${q}`);
}

export function getShift(id: string): Promise<Shift> {
  return apiFetch(`/api/v1/shifts/${id}`);
}

export function createShift(body: {
  location_id: string;
  role?: string | null;
  start_at: string;
  end_at: string;
  assigned_to_user_id?: string | null;
  template_id?: string | null;
  notes?: string | null;
  is_open_shift?: boolean;
  status?: string;
}): Promise<Shift> {
  return apiFetch("/api/v1/shifts/", { method: "POST", body: JSON.stringify(body) });
}

export function updateShift(
  id: string,
  body: Partial<{
    location_id: string;
    role: string | null;
    start_at: string;
    end_at: string;
    assigned_to_user_id: string | null;
    notes: string | null;
    is_open_shift: boolean;
    status: string;
    cancellation_reason: string | null;
  }>
): Promise<Shift> {
  return apiFetch(`/api/v1/shifts/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteShift(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/shifts/${id}`, { method: "DELETE" });
}

export function publishShifts(shiftIds: string[]): Promise<{ published: number }> {
  return apiFetch("/api/v1/shifts/publish", {
    method: "POST",
    body: JSON.stringify({ shift_ids: shiftIds }),
  });
}

export function publishBulk(body: {
  filter_type: "location" | "role" | "individual";
  location_id?: string | null;
  role?: string | null;
  user_id?: string | null;
  week_start?: string;
  week_end?: string;
}): Promise<{ published: number }> {
  return apiFetch("/api/v1/shifts/publish/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Open Shift Claims ─────────────────────────────────────────────────────────

export function claimShift(shiftId: string): Promise<OpenShiftClaim> {
  return apiFetch(`/api/v1/shifts/${shiftId}/claim`, { method: "POST" });
}

export function listClaims(params?: {
  shift_id?: string;
  status?: string;
}): Promise<OpenShiftClaim[]> {
  const q = new URLSearchParams();
  if (params?.shift_id) q.set("shift_id", params.shift_id);
  if (params?.status)   q.set("status", params.status);
  const qs = q.toString();
  return apiFetch(`/api/v1/shifts/claims${qs ? `?${qs}` : ""}`);
}

export function respondToClaim(
  claimId: string,
  body: { action: "approve" | "reject"; manager_note?: string }
): Promise<OpenShiftClaim> {
  return apiFetch(`/api/v1/shifts/claims/${claimId}/respond`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Swap Requests ─────────────────────────────────────────────────────────────

export function listSwapRequests(params?: { status?: string }): Promise<ShiftSwapRequest[]> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return apiFetch(`/api/v1/shifts/swaps${qs ? `?${qs}` : ""}`);
}

export function createSwapRequest(body: {
  shift_id: string;
  target_user_id?: string | null;
  target_shift_id?: string | null;
}): Promise<ShiftSwapRequest> {
  return apiFetch("/api/v1/shifts/swaps", { method: "POST", body: JSON.stringify(body) });
}

export function respondToSwap(
  swapId: string,
  body: { action: string; rejection_reason?: string }
): Promise<ShiftSwapRequest> {
  return apiFetch(`/api/v1/shifts/swaps/${swapId}/respond`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Leave Requests ────────────────────────────────────────────────────────────

export function listLeaveRequests(params?: {
  status?: string;
  user_id?: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<LeaveRequest>> {
  const q = new URLSearchParams();
  if (params?.status)  q.set("status", params.status);
  if (params?.user_id) q.set("user_id", params.user_id);
  q.set("page", String(params?.page ?? 1));
  q.set("page_size", String(params?.page_size ?? 20));
  return apiFetch(`/api/v1/shifts/leave?${q}`);
}

export function createLeaveRequest(body: {
  leave_type: string;
  start_date: string;
  end_date: string;
  reason?: string | null;
}): Promise<LeaveRequest> {
  return apiFetch("/api/v1/shifts/leave", { method: "POST", body: JSON.stringify(body) });
}

export function respondToLeave(
  leaveId: string,
  body: { action: "approve" | "reject" }
): Promise<LeaveRequest> {
  return apiFetch(`/api/v1/shifts/leave/${leaveId}/respond`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Availability ──────────────────────────────────────────────────────────────

export function getMyAvailability(params?: { user_id?: string }): Promise<StaffAvailability[]> {
  const q = new URLSearchParams();
  if (params?.user_id) q.set("user_id", params.user_id);
  const qs = q.toString();
  return apiFetch(`/api/v1/shifts/availability${qs ? `?${qs}` : ""}`);
}

export function setAvailability(body: {
  day_of_week: number;
  available_from: string;
  available_to: string;
  is_available?: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
}): Promise<StaffAvailability> {
  return apiFetch("/api/v1/shifts/availability", { method: "POST", body: JSON.stringify(body) });
}

// ── Attendance ────────────────────────────────────────────────────────────────

export function clockIn(body: {
  shift_id?: string | null;
  location_id: string;
  clock_in_method?: string;
  latitude?: number;
  longitude?: number;
}): Promise<AttendanceRecord> {
  return apiFetch("/api/v1/shifts/attendance/clock-in", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function clockOut(body: {
  attendance_id: string;
  latitude?: number;
  longitude?: number;
}): Promise<AttendanceRecord> {
  return apiFetch("/api/v1/shifts/attendance/clock-out", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listAttendance(params?: {
  user_id?: string;
  location_id?: string;
  from_date?: string;
  to_date?: string;
  status?: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<AttendanceRecord>> {
  const q = new URLSearchParams();
  if (params?.user_id)     q.set("user_id", params.user_id);
  if (params?.location_id) q.set("location_id", params.location_id);
  if (params?.from_date)   q.set("from_date", params.from_date);
  if (params?.to_date)     q.set("to_date", params.to_date);
  if (params?.status)      q.set("status", params.status);
  q.set("page", String(params?.page ?? 1));
  q.set("page_size", String(params?.page_size ?? 50));
  return apiFetch(`/api/v1/shifts/attendance?${q}`);
}

export function getMyAttendance(params?: {
  from_date?: string;
  to_date?: string;
}): Promise<AttendanceRecord[]> {
  const q = new URLSearchParams();
  if (params?.from_date) q.set("from_date", params.from_date);
  if (params?.to_date)   q.set("to_date", params.to_date);
  q.set("page_size", "200");
  return (apiFetch(`/api/v1/shifts/attendance?${q}`) as Promise<PaginatedResponse<AttendanceRecord>>).then(
    (r) => r.items
  );
}

export function managerOverride(body: {
  user_id: string;
  shift_id?: string | null;
  location_id: string;
  clock_in_at: string;
  clock_out_at?: string | null;
  note: string;
}): Promise<AttendanceRecord> {
  return apiFetch("/api/v1/shifts/attendance/override", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getTimesheetSummary(params?: {
  week_start?: string;
  location_id?: string;
  user_id?: string;
}): Promise<TimesheetSummaryRow[]> {
  const q = new URLSearchParams();
  if (params?.week_start)  q.set("week_start", params.week_start);
  if (params?.location_id) q.set("location_id", params.location_id);
  if (params?.user_id)     q.set("user_id", params.user_id);
  const qs = q.toString();
  return apiFetch(`/api/v1/shifts/attendance/timesheet${qs ? `?${qs}` : ""}`);
}

export function getMyTimesheet(params?: { week_start?: string }): Promise<{
  records: AttendanceRecord[];
  summary: { total_hours: number; break_hours: number; worked_hours: number; regular_hours: number; overtime_hours: number; late_count: number };
}> {
  const q = new URLSearchParams();
  if (params?.week_start) q.set("week_start", params.week_start);
  const qs = q.toString();
  return apiFetch(`/api/v1/shifts/attendance/my-timesheet${qs ? `?${qs}` : ""}`);
}

// ── Attendance Rules ──────────────────────────────────────────────────────────

export function getAttendanceRules(): Promise<AttendanceRules> {
  return apiFetch("/api/v1/shifts/rules");
}

export function updateAttendanceRules(body: Partial<{
  late_threshold_mins: number;
  early_departure_threshold_mins: number;
  overtime_threshold_hours: number;
  weekly_overtime_threshold_hours: number;
  break_duration_mins: number;
}>): Promise<AttendanceRules> {
  return apiFetch("/api/v1/shifts/rules", { method: "PUT", body: JSON.stringify(body) });
}

// ── Breaks ────────────────────────────────────────────────────────────────────

export function startBreak(body: {
  attendance_id: string;
  break_type?: "meal" | "rest" | "other";
}): Promise<{ id: string; break_start_at: string; break_type: string }> {
  return apiFetch("/api/v1/shifts/attendance/break/start", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function endBreak(body: {
  attendance_id: string;
}): Promise<{ id: string; break_end_at: string; duration_minutes: number }> {
  return apiFetch("/api/v1/shifts/attendance/break/end", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getBreakStatus(attendanceId: string): Promise<{
  on_break: boolean;
  active_break: { id: string; break_start_at: string; break_type: string } | null;
  breaks: Array<{ id: string; break_start_at: string; break_end_at: string | null; duration_minutes: number | null; break_type: string }>;
  total_break_minutes: number;
}> {
  return apiFetch(`/api/v1/shifts/attendance/break/status?attendance_id=${attendanceId}`);
}

// ── AI Schedule ───────────────────────────────────────────────────────────────

export function generateAISchedule(body: {
  location_id: string;
  week_start: string;
  notes?: string;
}): Promise<{ shifts_created: number; warnings: string[] }> {
  return apiFetch("/api/v1/shifts/ai/generate-schedule", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
