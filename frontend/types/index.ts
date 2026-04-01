// Shared TypeScript types mirroring the database schema and API envelopes

export interface PaginatedResponse<T> {
  items: T[];
  total_count: number;
  page: number;
  page_size: number;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T | null;
}

export type UserRole = "super_admin" | "admin" | "manager" | "staff";

export interface Profile {
  id: string;
  organisation_id: string;
  location_id: string | null;
  full_name: string;
  phone_number: string | null;
  role: UserRole;
  position?: string | null;
  language: string;
  is_active: boolean;
  reports_to: string | null;
  reports_to_profile?: { id: string; full_name: string } | null;
  created_at: string;
  updated_at: string;
}

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: string;
  organisation_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geo_fence_radius_meters: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type FormType = "checklist" | "form" | "audit" | "pull_out";
export type FormFieldType =
  | "text"
  | "number"
  | "checkbox"
  | "dropdown"
  | "multi_select"
  | "photo"
  | "video"
  | "signature"
  | "date"
  | "time"
  | "datetime"
  | "gps"
  | "rating"
  | "qr_code"
  | "yes_no"
  | "boolean"
  | "textarea"
  | "audit_item";   // Three-tier: Compliant / Needs Improvement / Non-Compliant

export interface FormField {
  id: string;
  section_id: string;
  label: string;
  field_type: FormFieldType;
  is_required: boolean;
  is_critical: boolean;     // audit: auto-fails whole audit if non-compliant
  options: string[] | null;
  conditional_logic: Record<string, unknown> | null;
  display_order: number;
  placeholder: string | null;
}

export interface FormSection {
  id: string;
  form_template_id: string;
  title: string;
  display_order: number;
  fields: FormField[];
}

export interface FormTemplate {
  id: string;
  organisation_id: string;
  created_by: string;
  title: string;
  description: string | null;
  type: FormType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  sections: FormSection[];
}

export type SubmissionStatus = "draft" | "submitted" | "approved" | "rejected";

export interface FormSubmission {
  id: string;
  form_template_id: string;
  assignment_id: string | null;
  submitted_by: string;
  submitted_at: string | null;
  status: SubmissionStatus;
  manager_comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface Announcement {
  id: string;
  organisation_id: string;
  created_by: string;
  creator_name?: string | null;
  title: string;
  body: string;
  media_url: string | null;
  media_urls: string[];
  requires_acknowledgement: boolean;
  my_acknowledged?: boolean;
  publish_at: string | null;
  target_roles: UserRole[] | null;
  target_location_ids: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementReceipt {
  id: string;
  announcement_id: string;
  user_id: string;
  read_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface UserSession {
  access_token: string;
  refresh_token: string;
  user_id: string;
  email: string;
  role: UserRole | null;
}

// ── Task Management ───────────────────────────────────────────────────────────

export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskStatus   = "pending" | "in_progress" | "completed" | "overdue" | "cancelled";
export type TaskSource   = "manual" | "audit" | "workflow";

export interface TaskAssignee {
  id: string;
  task_id: string;
  user_id: string | null;
  assign_role: string | null;
  assigned_at: string;
  is_deleted: boolean;
  profiles?: { id: string; full_name: string; avatar_url?: string | null };
}

export interface TaskMessage {
  id: string;
  task_id: string;
  user_id: string;
  body: string;
  created_at: string;
  is_deleted: boolean;
  profiles?: { full_name: string; avatar_url?: string | null };
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by: string;
  file_url: string;
  file_type: "image" | "video" | "document";
  annotated_url: string | null;
  created_at: string;
  is_deleted: boolean;
  profiles?: { full_name: string };
}

export interface TaskStatusHistory {
  id: string;
  task_id: string;
  changed_by: string;
  previous_status: string | null;
  new_status: string;
  changed_at: string;
  profiles?: { full_name: string };
}

export interface Task {
  id: string;
  organisation_id: string;
  location_id: string | null;
  created_by: string;
  template_id: string | null;
  source_type: TaskSource;
  source_submission_id: string | null;
  source_field_id: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_at: string | null;
  completed_at: string | null;
  recurrence: string;
  created_at: string;
  updated_at: string;
  // joined
  profiles?: { full_name: string; avatar_url?: string | null };
  locations?: { name: string } | null;
  task_assignees?: TaskAssignee[];
  task_messages?: TaskMessage[];
  task_attachments?: TaskAttachment[];
  task_status_history?: TaskStatusHistory[];
  cap_item_id?: string | null;
  // annotated server-side
  unread_message_count?: number;
}

export interface TaskTemplate {
  id: string;
  organisation_id: string;
  created_by: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  assign_to_role: string | null;
  recurrence: string;
  is_active: boolean;
  created_at: string;
  profiles?: { full_name: string };
}

export interface TaskSummary {
  total: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  overdue_count: number;
  overdue_tasks: Task[];
  completion_rate: number | null;
}

// ── Corrective Action Plans ───────────────────────────────────────────────────

export type CAPStatus = "pending_review" | "in_review" | "confirmed" | "dismissed";
export type FollowupType = "task" | "issue" | "incident" | "none";

export interface CAPItem {
  id: string;
  cap_id: string;
  field_id: string;
  field_label: string;
  response_value: string;
  score_awarded: number | null;
  max_score: number | null;
  is_critical: boolean;
  suggested_followup_type: FollowupType;
  suggested_title: string;
  suggested_description: string | null;
  suggested_priority: string;
  suggested_assignee_id: string | null;
  suggested_due_days: number | null;
  followup_type: FollowupType;
  followup_title: string | null;
  followup_description: string | null;
  followup_priority: string;
  followup_assignee_id: string | null;
  followup_due_at: string | null;
  spawned_task_id: string | null;
  spawned_issue_id: string | null;
  spawned_incident_id: string | null;
  // joined
  profiles?: { full_name: string } | null;
}

// ── Phase 3: Issues, Maintenance, Vendors, Safety ────────────────────────────

export type IssuePriority = "low" | "medium" | "high" | "critical";
export type IssueStatus = "open" | "in_progress" | "pending_vendor" | "resolved" | "verified_closed";

export interface IssueCategory {
  id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sla_hours: number;
  default_priority: "low" | "medium" | "high" | "critical";
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  is_maintenance?: boolean;
  custom_fields?: IssueCustomField[];
  escalation_rules?: EscalationRule[];
}

export interface IssueCustomField {
  id: string;
  category_id: string;
  label: string;
  field_type: "text" | "number" | "dropdown" | "checkbox" | "date";
  options: string[] | null;
  is_required: boolean;
  display_order: number;
}

export interface EscalationRule {
  id: string;
  category_id: string;
  organisation_id?: string;
  trigger_type: "on_create" | "sla_breach" | "priority_critical" | "status_change" | "unresolved_hours";
  trigger_status: string | null;
  escalate_to_role: string | null;
  escalate_to_user_id: string | null;
  notify_via_fcm: boolean;
  notify_via_email: boolean;
  sort_order: number;
  is_deleted?: boolean;
}

export interface IssueAttachment {
  id: string;
  issue_id: string;
  uploaded_by: string;
  file_url: string; // signed URL
  file_type: "image" | "video";
  created_at: string;
}

export interface IssueComment {
  id: string;
  issue_id: string;
  user_id: string | null;
  vendor_id: string | null;
  body: string;
  is_vendor_visible: boolean;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  profiles?: { full_name: string } | null;
}

export interface IssueStatusHistoryEntry {
  id: string;
  issue_id: string;
  changed_by: string | null;
  previous_status: string | null;
  new_status: string;
  comment: string | null;
  changed_at: string;
  profiles?: { full_name: string } | null;
}

export interface IssueCustomResponse {
  id: string;
  issue_id: string;
  custom_field_id: string;
  value: string | null;
  custom_field?: IssueCustomField;
}

export interface Issue {
  id: string;
  organisation_id: string;
  location_id: string;
  category_id: string | null;
  reported_by: string;
  assigned_to: string | null;
  assigned_vendor_id: string | null;
  title: string;
  description: string | null;
  priority: IssuePriority;
  status: IssueStatus;
  location_description: string | null;
  asset_id: string | null;
  recurrence_count: number;
  due_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  cost: number | null;
  created_at: string;
  updated_at: string;
  related_incident_id?: string | null;
  // joined
  issue_categories?: IssueCategory | null;
  locations?: { name: string } | null;
  reporter?: { full_name: string } | null;
  assignee?: { full_name: string } | null;
  vendor?: Vendor | null;
  attachments?: IssueAttachment[];
  comments?: IssueComment[];
  status_history?: IssueStatusHistoryEntry[];
  custom_responses?: IssueCustomResponse[];
}

export interface Vendor {
  id: string;
  organisation_id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  category_access?: VendorCategoryAccess[];
}

export interface VendorCategoryAccess {
  id: string;
  vendor_id: string;
  category_id: string;
  is_deleted: boolean;
  issue_categories?: { name: string };
}

export interface Asset {
  id: string;
  organisation_id: string;
  location_id: string;
  name: string;
  category: string;
  serial_number: string | null;
  model: string | null;
  manufacturer: string | null;
  installed_at: string | null;
  last_maintenance_at: string | null;
  next_maintenance_due_at: string | null;
  total_repair_cost: number;
  predicted_days_to_failure: number | null;
  failure_risk_score: number | null;
  created_at: string;
  updated_at: string;
  locations?: { name: string } | null;
}

export interface RepairGuide {
  id: string;
  organisation_id: string;
  asset_id: string | null;
  category_id: string | null;
  title: string;
  guide_type: "pdf" | "video" | "audio" | "text";
  file_url: string | null; // signed URL when fetched
  content: string | null;
  created_at: string;
  assets?: { name: string } | null;
  issue_categories?: { name: string } | null;
}


export interface SafetyBadge {
  id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  points: number;
  criteria_type: "issues_reported" | "issues_resolved" | "streak_days" | "manual";
  criteria_value: number | null;
  created_at: string;
}

export interface UserBadgeAward {
  id: string;
  user_id: string;
  badge_id: string;
  awarded_by: string | null;
  awarded_at: string;
  safety_badges?: SafetyBadge;
  profiles?: { full_name: string } | null;
}

export interface SafetyPoints {
  id: string;
  user_id: string;
  organisation_id: string;
  total_points: number;
  issues_reported: number;
  issues_resolved: number;
  updated_at: string;
  profiles?: { full_name: string; role: string } | null;
}

export interface IssueDashboardSummary {
  total_open: number;
  total_in_progress: number;
  total_resolved: number;
  total_closed: number;
  by_category: Array<{ category_id: string; category_name: string; count: number }>;
  by_location: Array<{ location_id: string; location_name: string; count: number }>;
}

// ── End Phase 3 ───────────────────────────────────────────────────────────────

export interface CAP {
  id: string;
  submission_id: string;
  organisation_id: string;
  location_id: string;
  status: CAPStatus;
  generated_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  dismissed_reason: string | null;
  created_at: string;
  item_count?: number;
  // joined
  form_submissions?: {
    submitted_at?: string;
    overall_score?: number;
    passed?: boolean;
    form_templates?: {
      title: string;
      form_sections?: {
        id: string;
        title: string;
        display_order?: number;
        form_fields?: { id: string; label: string; display_order?: number; section_id?: string }[];
      }[];
    };
  } | null;
  locations?: { name: string } | null;
  cap_items?: CAPItem[];
}

// ── Shifts & Attendance ───────────────────────────────────────────────────────
export type ShiftStatus = 'draft' | 'published' | 'open' | 'claimed' | 'cancelled';
export type ClaimStatus = 'pending' | 'approved' | 'rejected';
export type SwapStatus = 'pending_colleague' | 'pending_manager' | 'approved' | 'rejected' | 'cancelled';
export type LeaveType = 'annual' | 'sick' | 'emergency' | 'unpaid' | 'other';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';
export type AttendanceStatus = 'present' | 'late' | 'early_departure' | 'absent' | 'unverified';
export type ClockInMethod = 'gps' | 'selfie' | 'facial_recognition' | 'qr_code' | 'manager_override';

export interface ShiftTemplate {
  id: string; organisation_id: string; location_id: string | null;
  name: string; role: string | null;
  start_time: string; end_time: string;
  days_of_week: number[];
  is_active: boolean; created_at: string;
  locations?: { id: string; name: string } | null;
}

export interface Shift {
  id: string; organisation_id: string; location_id: string;
  template_id: string | null; assigned_to_user_id: string | null;
  created_by: string; role: string | null;
  start_at: string; end_at: string;
  status: ShiftStatus; is_open_shift: boolean;
  cancellation_reason: string | null; notes: string | null;
  ai_generated: boolean; created_at: string;
  // joined
  assigned_to?: { id: string; full_name: string; role: string } | null;
  locations?: { id: string; name: string } | null;
  open_shift_claims?: OpenShiftClaim[];
}

export interface OpenShiftClaim {
  id: string; shift_id: string; claimed_by: string;
  status: ClaimStatus; claimed_at: string;
  responded_at: string | null; manager_note: string | null;
  profiles?: { id: string; full_name: string } | null;
}

export interface ShiftSwapRequest {
  id: string; organisation_id: string;
  requested_by: string; shift_id: string;
  target_user_id: string | null; target_shift_id: string | null;
  status: SwapStatus;
  colleague_response_at: string | null; manager_response_at: string | null;
  approved_by: string | null; rejection_reason: string | null;
  created_at: string;
  requester?: { id: string; full_name: string } | null;
  shift?: Shift | null;
  target_shift?: Shift | null;
  target_user?: { id: string; full_name: string } | null;
}

export interface LeaveRequest {
  id: string; user_id: string; organisation_id: string;
  leave_type: LeaveType; start_date: string; end_date: string;
  reason: string | null; status: LeaveStatus;
  approved_by: string | null; responded_at: string | null;
  created_at: string;
  profiles?: { id: string; full_name: string } | null;
}

export interface StaffAvailability {
  id: string; user_id: string; organisation_id: string;
  day_of_week: number; available_from: string; available_to: string;
  is_available: boolean; effective_from: string | null; effective_to: string | null;
}

export interface AttendanceRecord {
  id: string; user_id: string; shift_id: string | null;
  location_id: string; organisation_id: string;
  clock_in_at: string | null; clock_in_method: ClockInMethod | null;
  clock_in_latitude: number | null; clock_in_longitude: number | null;
  clock_in_geo_valid: boolean | null;
  clock_out_at: string | null;
  total_minutes: number | null; overtime_minutes: number;
  break_minutes: number; worked_minutes: number | null; status: AttendanceStatus;
  manager_override_note: string | null; created_at: string;
  profiles?: { id: string; full_name: string } | null;
  shifts?: Pick<Shift, 'id' | 'start_at' | 'end_at' | 'role'> | null;
}

export interface BreakRecord {
  id: string;
  attendance_id: string;
  user_id: string;
  break_start_at: string;
  break_end_at: string | null;
  duration_minutes: number | null;
  break_type: "meal" | "rest" | "other";
  created_at: string;
}

export interface AttendanceRules {
  id: string; organisation_id: string;
  late_threshold_mins: number; early_departure_threshold_mins: number;
  overtime_threshold_hours: number; weekly_overtime_threshold_hours: number;
  break_duration_mins: number;
}

export interface TimesheetSummaryRow {
  user_id: string; full_name: string;
  total_hours: number; break_hours: number; worked_hours: number;
  regular_hours: number; overtime_hours: number;
  late_count: number; absent_count: number; shift_count: number;
}

// ── Notifications ──────────────────────────────────────────────────────────────

export type NotificationType =
  | "task_assigned"
  | "form_assigned"
  | "workflow_stage_assigned"
  | "issue_assigned"
  | "issue_comment"
  | "issue_status_changed"
  | "shift_claim_pending"
  | "shift_swap_pending"
  | "leave_request_pending"
  | "form_submission_review"
  | "cap_generated"
  | "announcement"
  | "course_enrolled"
  | "scheduled_reminder";

export type NotificationEntityType =
  | "task"
  | "form_assignment"
  | "workflow_instance"
  | "issue"
  | "shift_claim"
  | "shift_swap"
  | "leave_request"
  | "form_submission"
  | "cap"
  | "announcement"
  | "course_enrollment";

export interface AppNotification {
  id: string;
  organisation_id: string;
  recipient_user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  entity_type: NotificationEntityType | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  is_dismissed: boolean;
  push_sent: boolean;
  created_at: string;
}
