import { apiFetch } from "@/services/api/client";
import { getClientToken } from "@/lib/auth";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowStage {
  id: string;
  workflow_definition_id: string;
  name: string;
  stage_order: number;
  action_type: string;
  assigned_role?: string | null;
  assigned_user_id?: string | null;
  form_template_id?: string | null;
  is_final: boolean;
  config?: Record<string, unknown> | null;
  sla_hours?: number | null;
  is_deleted?: boolean;
}

export interface RoutingRule {
  id: string;
  workflow_definition_id: string;
  from_stage_id: string;
  to_stage_id: string;
  condition_type: string;
  condition_field_id?: string | null;
  condition_value?: string | null;
  priority: number;
  label?: string | null;
  is_deleted?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  trigger_type: string;
  trigger_config?: Record<string, unknown> | null;
  form_template_id?: string | null;
  trigger_form_template_id?: string | null;
  trigger_issue_category_id?: string | null;
  trigger_conditions?: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  workflow_stages?: WorkflowStage[];
  workflow_routing_rules?: RoutingRule[];
}

export interface WorkflowStageInstance {
  id: string;
  stage_id: string;
  workflow_instance_id?: string | null;
  assigned_to?: string | null;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  due_at?: string | null;
  comment?: string | null;
  form_submission_id?: string | null;
  spawned_task_id?: string | null;
  spawned_issue_id?: string | null;
  spawned_incident_id?: string | null;
  workflow_stages?: {
    name: string;
    action_type: string;
    stage_order: number;
    is_final?: boolean;
    form_template_id?: string | null;
    config?: Record<string, unknown> | null;
    form_templates?: { title: string } | null;
  } | null;
  review_submission_id?: string | null;
  stage_history?: {
    id: string;
    stage_name: string | null;
    action_type: string | null;
    stage_order: number | null;
    status: string;
    completed_at: string | null;
    comment: string | null;
    completed_by: string | null;
    form_submission_id: string | null;
  }[] | null;
  workflow_instances?: {
    id: string;
    status: string;
    source_type?: string | null;
    source_id?: string | null;
    organisation_id: string;
    workflow_definitions?: {
      name: string;
    } | null;
  } | null;
}

export interface WorkflowInstance {
  id: string;
  workflow_definition_id: string;
  organisation_id: string;
  source_type?: string | null;
  source_id?: string | null;
  submission_id?: string | null;
  location_id?: string | null;
  triggered_by?: string | null;
  status: string;
  current_stage_id?: string | null;
  cancelled_reason?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  workflow_definitions?: { name: string; trigger_type: string } | null;
  workflow_stages?: { name: string; action_type: string } | null;
  workflow_stage_instances?: WorkflowStageInstance[];
}

// ─── Definitions ─────────────────────────────────────────────────────────────

export async function listWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
  return apiFetch("/api/v1/workflows/definitions");
}

export async function getWorkflowDefinition(id: string): Promise<WorkflowDefinition> {
  return apiFetch(`/api/v1/workflows/definitions/${id}`);
}

export async function createWorkflowDefinition(body: {
  name: string;
  trigger_type: string;
  form_template_id?: string | null;
  trigger_config?: Record<string, unknown> | null;
  is_active?: boolean;
  stages?: Partial<WorkflowStage>[];
}): Promise<WorkflowDefinition> {
  return apiFetch("/api/v1/workflows/definitions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateWorkflowDefinition(
  id: string,
  body: Partial<Pick<WorkflowDefinition, "name" | "is_active" | "trigger_type" | "trigger_config">>
): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/workflows/definitions/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteWorkflowDefinition(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/workflows/definitions/${id}`, { method: "DELETE" });
}

export async function duplicateWorkflowDefinition(id: string): Promise<WorkflowDefinition> {
  return apiFetch(`/api/v1/workflows/definitions/${id}/duplicate`, { method: "POST" });
}

// ─── Stages ───────────────────────────────────────────────────────────────────

export async function addStage(
  definitionId: string,
  body: Partial<WorkflowStage>
): Promise<WorkflowStage> {
  return apiFetch(`/api/v1/workflows/definitions/${definitionId}/stages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateStage(
  definitionId: string,
  stageId: string,
  body: Partial<WorkflowStage>
): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/workflows/definitions/${definitionId}/stages/${stageId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteStage(
  definitionId: string,
  stageId: string
): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/workflows/definitions/${definitionId}/stages/${stageId}`, {
    method: "DELETE",
  });
}

export async function reorderStages(
  definitionId: string,
  stages: { id: string; stage_order: number }[]
): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/workflows/definitions/${definitionId}/stages/reorder`, {
    method: "PUT",
    body: JSON.stringify({ stages }),
  });
}

// ─── Routing Rules ────────────────────────────────────────────────────────────

export async function addRoutingRule(
  definitionId: string,
  body: Omit<RoutingRule, "id" | "workflow_definition_id">
): Promise<RoutingRule> {
  return apiFetch(`/api/v1/workflows/definitions/${definitionId}/routing-rules`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateRoutingRule(
  definitionId: string,
  ruleId: string,
  body: Partial<Pick<RoutingRule, "condition_type" | "condition_value" | "priority" | "label">>
): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/workflows/definitions/${definitionId}/rules/${ruleId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteRoutingRule(
  definitionId: string,
  ruleId: string
): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/workflows/definitions/${definitionId}/rules/${ruleId}`, {
    method: "DELETE",
  });
}

// ─── Instances ────────────────────────────────────────────────────────────────

export async function listInstances(filters?: {
  status?: string;
  location_id?: string;
  definition_id?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
  my_team?: boolean;
}): Promise<WorkflowInstance[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.location_id) params.set("location_id", filters.location_id);
  if (filters?.definition_id) params.set("definition_id", filters.definition_id);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.page_size) params.set("page_size", String(filters.page_size));
  if (filters?.my_team) params.set("my_team", "true");
  return apiFetch(`/api/v1/workflows/instances?${params}`);
}

export async function getInstanceDetail(id: string): Promise<WorkflowInstance> {
  return apiFetch(`/api/v1/workflows/instances/${id}`);
}

export async function triggerWorkflow(body: {
  definition_id: string;
  source_type?: string;
  source_id?: string;
  location_id?: string;
}): Promise<WorkflowInstance> {
  return apiFetch("/api/v1/workflows/instances", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function cancelInstance(id: string, reason: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/workflows/instances/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function approveStage(
  instanceId: string,
  stageInstanceId: string,
  comment?: string
): Promise<{ status: string }> {
  return apiFetch(`/api/v1/workflows/instances/${instanceId}/stages/${stageInstanceId}/approve`, {
    method: "POST",
    body: JSON.stringify({ comment }),
  });
}

export async function rejectStage(
  instanceId: string,
  stageInstanceId: string,
  comment: string
): Promise<{ status: string }> {
  return apiFetch(`/api/v1/workflows/instances/${instanceId}/stages/${stageInstanceId}/reject`, {
    method: "POST",
    body: JSON.stringify({ comment }),
  });
}

export async function getMyWorkflowTasks(): Promise<WorkflowStageInstance[]> {
  return apiFetch("/api/v1/workflows/instances/my-tasks");
}

export async function getStageInstance(
  instanceId: string,
  stageInstanceId: string
): Promise<WorkflowStageInstance> {
  return apiFetch(`/api/v1/workflows/instances/${instanceId}/stages/${stageInstanceId}`);
}

export async function submitFormForStage(
  instanceId: string,
  stageInstanceId: string,
  responses: { field_id: string; value: string; comment?: string }[]
): Promise<{ success: boolean; form_submission_id: string }> {
  return apiFetch(`/api/v1/workflows/instances/${instanceId}/stages/${stageInstanceId}/submit-form`, {
    method: "POST",
    body: JSON.stringify({ responses }),
  });
}

// ─── AI Generation ────────────────────────────────────────────────────────────

export interface GeneratedWorkflowStage {
  name: string;
  action_type: string;
  assigned_role?: string | null;
  sla_hours?: number | null;
  is_final: boolean;
  config?: Record<string, unknown> | null;
}

export interface GeneratedWorkflow {
  name: string;
  trigger_type: string;
  stages: GeneratedWorkflowStage[];
}

export class PublishValidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super("Publish validation failed");
    this.errors = errors;
  }
}

export async function publishWorkflow(id: string): Promise<{ success: boolean }> {
  // Can't use apiFetch directly — need to inspect 422 body for validation errors
  const token = getClientToken();
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

  const res = await fetch(`${API_BASE}/api/v1/workflows/definitions/${id}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

  if (res.status === 422) {
    const body = await res.json().catch(() => ({}));
    const errors: string[] = body?.detail?.errors ?? [body?.detail ?? "Validation failed"];
    throw new PublishValidationError(errors);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function generateWorkflowWithAI(prompt: string): Promise<GeneratedWorkflow> {
  return apiFetch("/api/v1/ai/generate-workflow", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}
