import { apiFetch } from "@/services/api/client";

export interface AppNotification {
  id: string;
  organisation_id: string;
  recipient_user_id: string;
  type:
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
  title: string;
  body: string | null;
  entity_type:
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
    | "course_enrollment"
    | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  is_dismissed: boolean;
  push_sent: boolean;
  created_at: string;
}

export interface NotificationPage {
  items: AppNotification[];
  total: number;
  page: number;
  limit: number;
}

export function listNotifications(params?: {
  is_read?: boolean;
  type?: string;
  page?: number;
  limit?: number;
}): Promise<NotificationPage> {
  const q = new URLSearchParams();
  if (params?.is_read !== undefined) q.set("is_read", String(params.is_read));
  if (params?.type) q.set("type", params.type);
  q.set("page", String(params?.page ?? 1));
  q.set("limit", String(params?.limit ?? 50));
  return apiFetch(`/api/v1/notifications?${q}`);
}

export function getUnreadCount(): Promise<{ count: number }> {
  return apiFetch("/api/v1/notifications/unread-count");
}

export function markRead(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/notifications/${id}/read`, { method: "POST" });
}

export function markAllRead(): Promise<{ ok: boolean }> {
  return apiFetch("/api/v1/notifications/read-all", { method: "POST" });
}

export function dismissNotification(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/notifications/${id}/dismiss`, { method: "POST" });
}

/** Navigate path for each entity_type */
export function notificationHref(n: AppNotification): string {
  switch (n.entity_type) {
    case "task":
      return n.entity_id
        ? `/dashboard/issues?tab=tasks&id=${n.entity_id}`
        : "/dashboard/issues?tab=tasks";
    case "form_assignment":
      return n.entity_id
        ? `/dashboard/forms/fill/${n.entity_id}`
        : "/dashboard/forms";
    case "workflow_instance":
      return n.entity_id
        ? `/dashboard/workflows/instances/${n.entity_id}`
        : "/dashboard/workflows/instances";
    case "issue":
      return n.entity_id
        ? `/dashboard/issues?tab=issues&id=${n.entity_id}`
        : "/dashboard/issues";
    case "shift_claim":
      return "/dashboard/shifts";
    case "shift_swap":
      return "/dashboard/shifts";
    case "leave_request":
      return "/dashboard/shifts";
    case "form_submission":
      return n.entity_id
        ? `/dashboard/forms`
        : "/dashboard/forms";
    case "cap":
      return n.entity_id
        ? `/dashboard/audits/caps/${n.entity_id}`
        : "/dashboard/audits";
    case "announcement":
      return "/dashboard/announcements";
    case "course_enrollment":
      return n.entity_id
        ? `/dashboard/training/learn/${n.entity_id}`
        : "/dashboard/training";
    default:
      return "/dashboard";
  }
}
