import { apiFetch } from "@/services/api/client";
import type {
  Issue,
  IssueCategory,
  IssueCustomField,
  EscalationRule,
  IssueComment,
  IssueDashboardSummary,
} from "@/types";

// ── Categories ────────────────────────────────────────────────────────────────

export function listIssueCategories(): Promise<{ data: IssueCategory[]; total: number }> {
  return apiFetch("/api/v1/issues/categories");
}

export function createIssueCategory(body: {
  name: string;
  default_priority: "low" | "medium" | "high" | "critical";
  description?: string;
  color?: string;
  icon?: string;
  sla_hours?: number;
}): Promise<IssueCategory> {
  return apiFetch("/api/v1/issues/categories", { method: "POST", body: JSON.stringify(body) });
}

export function updateIssueCategory(id: string, body: Partial<{
  name: string; default_priority: "low" | "medium" | "high" | "critical"; description: string; color: string; icon: string; sla_hours: number;
}>): Promise<IssueCategory> {
  return apiFetch(`/api/v1/issues/categories/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteIssueCategory(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/issues/categories/${id}`, { method: "DELETE" });
}

export function createCustomField(categoryId: string, body: {
  label: string; field_type: string; options?: string[]; is_required?: boolean; display_order?: number;
}): Promise<IssueCustomField> {
  return apiFetch(`/api/v1/issues/categories/${categoryId}/custom-fields`, { method: "POST", body: JSON.stringify(body) });
}

export function updateCustomField(categoryId: string, fieldId: string, body: Partial<{
  label: string; field_type: string; options: string[]; is_required: boolean; display_order: number;
}>): Promise<IssueCustomField> {
  return apiFetch(`/api/v1/issues/categories/${categoryId}/custom-fields/${fieldId}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteCustomField(categoryId: string, fieldId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/issues/categories/${categoryId}/custom-fields/${fieldId}`, { method: "DELETE" });
}

export function createEscalationRule(categoryId: string, body: {
  trigger_type: string;
  trigger_status?: string;
  escalate_to_role?: string;
  escalate_to_user_id?: string;
  notify_via_fcm?: boolean;
  notify_via_email?: boolean;
  sort_order?: number;
}): Promise<EscalationRule> {
  return apiFetch(`/api/v1/issues/categories/${categoryId}/escalation-rules`, { method: "POST", body: JSON.stringify(body) });
}

export function updateEscalationRule(categoryId: string, ruleId: string, body: Partial<{
  trigger_type: string;
  trigger_status: string;
  escalate_to_role: string;
  escalate_to_user_id: string;
  notify_via_fcm: boolean;
  notify_via_email: boolean;
  sort_order: number;
}>): Promise<EscalationRule> {
  return apiFetch(`/api/v1/issues/categories/${categoryId}/escalation-rules/${ruleId}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteEscalationRule(categoryId: string, ruleId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/issues/categories/${categoryId}/escalation-rules/${ruleId}`, { method: "DELETE" });
}

// ── Issues ────────────────────────────────────────────────────────────────────

export interface ListIssuesParams {
  status?: string;
  priority?: string;
  category_id?: string;
  location_id?: string;
  assigned_to?: string;
  recurring?: boolean;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
  my_issues?: boolean;
  my_team?: boolean;
}

export function listIssues(params: ListIssuesParams = {}): Promise<{ data: Issue[]; total: number }> {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") q.set(k, String(v)); });
  const qs = q.toString();
  return apiFetch(`/api/v1/issues${qs ? `?${qs}` : ""}`);
}

export function getIssue(id: string): Promise<Issue> {
  return apiFetch(`/api/v1/issues/${id}`).then((raw: unknown) => {
    const r = raw as Record<string, unknown>;
    return {
      ...r,
      attachments:    (r.issue_attachments    as Issue["attachments"])    ?? [],
      comments:       (r.issue_comments       as Issue["comments"])       ?? [],
      status_history: (r.issue_status_history as Issue["status_history"]) ?? [],
    } as Issue;
  });
}

export function createIssue(body: {
  title: string;
  description?: string;
  category_id?: string;
  priority?: string;
  location_description?: string;
  location_id?: string;
  asset_id?: string;
  assigned_to?: string;
  is_safety_risk?: boolean;
  custom_responses?: Array<{ custom_field_id: string; value: string }>;
}): Promise<Issue> {
  return apiFetch("/api/v1/issues/", { method: "POST", body: JSON.stringify(body) });
}

export function updateIssue(id: string, body: Partial<{
  title: string; description: string; priority: string;
  assigned_to: string | null; assigned_vendor_id: string | null;
  cost: number; resolution_note: string;
}>): Promise<Issue> {
  return apiFetch(`/api/v1/issues/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function updateIssueStatus(id: string, status: string, comment?: string): Promise<Issue> {
  return apiFetch(`/api/v1/issues/${id}/status`, { method: "PUT", body: JSON.stringify({ status, comment }) });
}

export function addIssueComment(id: string, body: string, isVendorVisible = true): Promise<IssueComment> {
  return apiFetch(`/api/v1/issues/${id}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, is_vendor_visible: isVendorVisible }),
  });
}

export function deleteIssueComment(issueId: string, commentId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/issues/${issueId}/comments/${commentId}`, { method: "DELETE" });
}

export function uploadIssueAttachments(issueId: string, files: File[]): Promise<{ data: unknown[] }> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  return apiFetch(`/api/v1/issues/${issueId}/attachments`, { method: "POST", body: form, rawBody: true });
}

export function exportIssue(issueId: string, emails?: string[]): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/issues/${issueId}/export`, {
    method: "GET",
    ...(emails?.length ? { body: JSON.stringify({ email_to: emails }) } : {}),
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function getIssueDashboardSummary(): Promise<IssueDashboardSummary> {
  return apiFetch("/api/v1/issues/dashboard/summary");
}

export function getIssueTrends(params: {
  location_id?: string; category_id?: string; from?: string; to?: string;
}): Promise<Array<{ date: string; count: number }>> {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  return apiFetch(`/api/v1/issues/dashboard/trends?${q.toString()}`);
}

export function getIssuesByAsset(): Promise<Array<{ asset_id: string; asset_name: string; issue_count: number; total_cost: number }>> {
  return apiFetch("/api/v1/issues/dashboard/by-asset");
}

export function getIssuesByLocation(): Promise<Array<{ location_id: string; location_name: string; count: number }>> {
  return apiFetch("/api/v1/issues/dashboard/by-location");
}

export function getRecurringIssues(page = 1, pageSize = 20): Promise<{ data: Issue[]; total: number }> {
  return apiFetch(`/api/v1/issues/dashboard/recurring?page=${page}&page_size=${pageSize}`);
}

// ── AI ────────────────────────────────────────────────────────────────────────

export function classifyIssue(body: {
  title: string;
  description: string;
  available_categories: { id: string; name: string }[];
}): Promise<{
  type: "issue" | "incident";
  category_id: string;
  priority: string;
  suggested_title: string;
  is_safety_risk: boolean;
  reasoning: string;
}> {
  return apiFetch("/api/v1/ai/classify-issue", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function analysePhoto(body: {
  image_url: string;
  description: string;
}): Promise<{
  safety_hazard_detected: boolean;
  hazard_description: string | null;
  suggested_priority: string;
  confidence: number;
  ai_description: string;
}> {
  return apiFetch("/api/v1/ai/analyse-photo", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
