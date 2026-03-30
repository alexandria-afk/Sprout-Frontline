import { apiFetch } from "@/services/api/client";
import type { Task, TaskTemplate, TaskSummary, PaginatedResponse } from "@/types";

// ── Task Templates ────────────────────────────────────────────────────────────

export function listTaskTemplates(): Promise<TaskTemplate[]> {
  return apiFetch("/api/v1/tasks/templates");
}

export function createTaskTemplate(body: {
  title: string;
  description?: string;
  priority?: string;
  assign_to_role?: string | null;
  recurrence?: string;
  is_active?: boolean;
}): Promise<TaskTemplate> {
  return apiFetch("/api/v1/tasks/templates", { method: "POST", body: JSON.stringify(body) });
}

export function updateTaskTemplate(id: string, body: Partial<{
  title: string;
  description: string;
  priority: string;
  assign_to_role: string | null;
  recurrence: string;
  is_active: boolean;
}>): Promise<TaskTemplate> {
  return apiFetch(`/api/v1/tasks/templates/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteTaskTemplate(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/tasks/templates/${id}`, { method: "DELETE" });
}

export function spawnFromTemplate(templateId: string, body: {
  location_id: string;
  due_at?: string;
  assignee_user_ids?: string[];
}): Promise<Task> {
  return apiFetch(`/api/v1/tasks/templates/${templateId}/spawn`, { method: "POST", body: JSON.stringify(body) });
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export interface ListTasksParams {
  status?: string;
  priority?: string;
  assigned_to?: string;
  location_id?: string;
  source_type?: string;
  overdue?: boolean;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
  my_team?: boolean;
  my_tasks?: boolean;
}

export function listTasks(params: ListTasksParams = {}): Promise<PaginatedResponse<Task>> {
  const q = new URLSearchParams();
  if (params.status)      q.set("status", params.status);
  if (params.priority)    q.set("priority", params.priority);
  if (params.assigned_to) q.set("assigned_to", params.assigned_to);
  if (params.location_id) q.set("location_id", params.location_id);
  if (params.source_type) q.set("source_type", params.source_type);
  if (params.overdue)     q.set("overdue", "true");
  if (params.from)        q.set("from", params.from);
  if (params.to)          q.set("to", params.to);
  if (params.my_team)     q.set("my_team", "true");
  if (params.my_tasks)    q.set("my_tasks", "true");
  q.set("page", String(params.page ?? 1));
  q.set("page_size", String(params.page_size ?? 50));
  return apiFetch(`/api/v1/tasks?${q}`);
}

export function getTask(id: string): Promise<Task> {
  return apiFetch(`/api/v1/tasks/${id}`);
}

export function createTask(body: {
  title: string;
  description?: string;
  priority?: string;
  due_at?: string | null;
  location_id?: string | null;
  source_type?: string;
  source_submission_id?: string | null;
  source_field_id?: string | null;
  assignee_user_ids?: string[];
  assignee_roles?: string[];
}): Promise<Task> {
  return apiFetch("/api/v1/tasks/", { method: "POST", body: JSON.stringify(body) });
}

export function updateTask(id: string, body: Partial<{
  title: string;
  description: string | null;
  priority: string;
  due_at: string | null;
}>): Promise<Task> {
  return apiFetch(`/api/v1/tasks/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function updateTaskStatus(id: string, status: string): Promise<Task> {
  return apiFetch(`/api/v1/tasks/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function addAssignee(taskId: string, body: { user_id?: string; assign_role?: string }): Promise<unknown> {
  return apiFetch(`/api/v1/tasks/${taskId}/assignees`, { method: "POST", body: JSON.stringify(body) });
}

export function removeAssignee(taskId: string, assigneeId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/tasks/${taskId}/assignees/${assigneeId}`, { method: "DELETE" });
}

export function postMessage(taskId: string, body: string): Promise<unknown> {
  return apiFetch(`/api/v1/tasks/${taskId}/messages`, { method: "POST", body: JSON.stringify({ body }) });
}

export function markTaskRead(taskId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/tasks/${taskId}/read`, { method: "POST" });
}

export function getUnreadTaskCount(): Promise<{ count: number }> {
  return apiFetch("/api/v1/tasks/unread-count");
}

export function addAttachment(taskId: string, payload: { file_url: string; file_type: string }): Promise<unknown> {
  return apiFetch(`/api/v1/tasks/${taskId}/attachments`, { method: "POST", body: JSON.stringify(payload) });
}

export function myTasks(): Promise<Task[]> {
  return apiFetch("/api/v1/tasks/my");
}

export function taskSummary(): Promise<TaskSummary> {
  return apiFetch("/api/v1/tasks/summary");
}

// ── AI ────────────────────────────────────────────────────────────────────────

export function suggestTaskPriority(body: {
  title: string;
  description?: string;
  context?: string;
}): Promise<{ priority: string; reasoning: string }> {
  return apiFetch("/api/v1/ai/suggest-task-priority", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
