import { apiFetch } from "./api/client";
import type {
  FormTemplate,
  FormSection,
  FormFieldType,
  FormType,
  FormSubmission,
  PaginatedResponse,
  ApiResponse,
} from "@/types";

export interface CreateFieldPayload {
  id?: string;
  label: string;
  field_type: FormFieldType;
  is_required: boolean;
  is_critical?: boolean;
  options?: string[];
  display_order?: number;
  placeholder?: string;
  conditional_logic?: { fieldId: string; value: string; action: "show" | "hide" } | null;
}

export interface CreateSectionPayload {
  id?: string;
  title: string;
  display_order?: number;
  fields: CreateFieldPayload[];
}

export interface CreateTemplatePayload {
  title: string;
  description?: string;
  type: FormType;
  sections: CreateSectionPayload[];
}

export async function listTemplates(params?: {
  type?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<FormTemplate>> {
  const query = new URLSearchParams();
  if (params?.type) query.set("type", params.type);
  if (params?.is_active !== undefined) query.set("is_active", String(params.is_active));
  if (params?.page !== undefined) query.set("page", String(params.page));
  if (params?.page_size !== undefined) query.set("page_size", String(params.page_size));
  const qs = query.toString();
  return apiFetch<PaginatedResponse<FormTemplate>>(`/api/v1/forms/templates${qs ? `?${qs}` : ""}`);
}

export async function getTemplate(id: string): Promise<FormTemplate> {
  return apiFetch<FormTemplate>(`/api/v1/forms/templates/${id}`);
}

export async function createTemplate(
  payload: CreateTemplatePayload
): Promise<FormTemplate> {
  return apiFetch<FormTemplate>("/api/v1/forms/templates", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface UpdateTemplatePayload extends Partial<CreateTemplatePayload> {
  is_active?: boolean;
}

export async function updateTemplate(
  id: string,
  payload: UpdateTemplatePayload
): Promise<FormTemplate> {
  return apiFetch<FormTemplate>(`/api/v1/forms/templates/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteTemplate(id: string): Promise<ApiResponse<null>> {
  return apiFetch<ApiResponse<null>>(`/api/v1/forms/templates/${id}`, { method: "DELETE" });
}

export async function generateTemplate(payload: {
  description: string;
  type: "form" | "checklist" | "audit" | "pull_out";
}): Promise<CreateTemplatePayload> {
  return apiFetch<CreateTemplatePayload>("/api/v1/forms/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface FormAssignment {
  id: string;
  form_template_id: string;
  organisation_id: string;
  assigned_to_user_id: string | null;
  assigned_to_location_id: string | null;
  recurrence: string;
  due_at: string;
  is_active: boolean;
  created_at: string;
  form_templates: {
    id: string;
    title: string;
    type: string;
    description: string | null;
  } | null;
  // Annotated server-side with submission status for the current user
  completed?: boolean;
  submitted_at?: string | null;
  has_draft?: boolean;
  submission_id?: string | null;
}

export async function getMyAssignments(): Promise<FormAssignment[]> {
  return apiFetch<FormAssignment[]>("/api/v1/forms/assignments/my");
}

export async function getAssignmentTemplate(assignmentId: string): Promise<FormTemplate> {
  return apiFetch<FormTemplate>(`/api/v1/forms/assignments/${assignmentId}/template`);
}

export interface DraftSubmission {
  id: string;
  status: string;
  form_responses: { field_id: string; value: string; comment?: string }[];
}

export async function getAssignmentDraft(assignmentId: string): Promise<DraftSubmission | null> {
  const data = await apiFetch<DraftSubmission | Record<string, never>>(`/api/v1/forms/assignments/${assignmentId}/draft`);
  return data && "id" in data ? (data as DraftSubmission) : null;
}

export interface CreateAssignmentPayload {
  form_template_id: string;
  assigned_to_user_id?: string;
  assigned_to_location_id?: string;
  recurrence: "once" | "daily" | "weekly";
  due_at: string; // ISO datetime string
}

export async function createAssignment(payload: CreateAssignmentPayload): Promise<FormAssignment> {
  return apiFetch<FormAssignment>("/api/v1/forms/assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listSubmissions(params?: {
  template_id?: string;
  user_id?: string;
  location_id?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
}): Promise<PaginatedResponse<FormSubmissionListItem>> {
  const query = new URLSearchParams();
  if (params?.template_id) query.set("template_id", params.template_id);
  if (params?.user_id) query.set("user_id", params.user_id);
  if (params?.location_id) query.set("location_id", params.location_id);
  if (params?.status) query.set("status", params.status);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  if (params?.page !== undefined) query.set("page", String(params.page));
  const qs = query.toString();
  return apiFetch<PaginatedResponse<FormSubmissionListItem>>(`/api/v1/forms/submissions${qs ? `?${qs}` : ""}`);
}

export interface SubmissionResponse {
  field_id: string;
  value: string;
  comment?: string;
}

export interface CreateSubmissionPayload {
  assignment_id: string;
  form_template_id: string;
  status: "draft" | "submitted";
  responses: SubmissionResponse[];
}

export async function createSubmission(payload: CreateSubmissionPayload): Promise<{ id: string; status: string }> {
  return apiFetch("/api/v1/forms/submissions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface SubmissionResponse2 {
  id: string;
  field_id: string;
  value: string;
  comment?: string;
}

export interface FormSubmissionDetail {
  id: string;
  form_template_id: string;
  assignment_id: string;
  submitted_by: string;
  submitted_at: string | null;
  status: string;
  manager_comment: string | null;
  overall_score: number | null;
  passed: boolean | null;
  created_at: string;
  profiles: { full_name: string } | null;
  form_templates: { title: string; type: string; audit_configs?: { passing_score: number }[] } | null;
  responses: SubmissionResponse2[];
}

export interface FormSubmissionListItem {
  id: string;
  form_template_id: string;
  assignment_id: string;
  submitted_by: string;
  submitted_at: string | null;
  status: string;
  manager_comment: string | null;
  overall_score: number | null;
  passed: boolean | null;
  created_at: string;
  profiles: { full_name: string } | null;
  form_templates: { title: string; type: string } | null;
  workflow_stage_instances?: { workflow_instances?: { workflow_definitions?: { name: string } | null } | null }[] | null;
}

export async function getSubmission(id: string): Promise<FormSubmissionDetail> {
  return apiFetch<FormSubmissionDetail>(`/api/v1/forms/submissions/${id}`);
}

export async function reviewSubmission(
  id: string,
  payload: { status: "approved" | "rejected"; manager_comment?: string }
): Promise<FormSubmissionDetail> {
  return apiFetch<FormSubmissionDetail>(`/api/v1/forms/submissions/${id}/review`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export interface TemplateStats {
  template_id: string;
  assigned_count: number;
  completed_count: number;
  latest_response_at: string | null;
}

export async function getTemplateStats(templateId: string): Promise<TemplateStats> {
  return apiFetch<TemplateStats>(`/api/v1/forms/templates/${templateId}/stats`);
}
