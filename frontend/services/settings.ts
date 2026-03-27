import { apiFetch } from "@/services/api/client";

// ── Audit Trail ───────────────────────────────────────────────────────────────

export interface AuditTrailEvent {
  id: string;
  event_type: string;
  entity_type: "task" | "issue" | "form" | "workflow" | "incident";
  entity_id: string;
  entity_title: string;
  actor_name: string;
  actor_id: string;
  description: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface AuditTrailResponse {
  data: AuditTrailEvent[];
  total: number;
  page: number;
  page_size: number;
}

export function getAuditTrail(params?: {
  page?: number;
  entity_type?: string;
}): Promise<AuditTrailResponse> {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.entity_type) q.set("entity_type", params.entity_type);
  return apiFetch(`/api/v1/settings/audit-trail${q.toString() ? `?${q}` : ""}`);
}
