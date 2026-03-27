import { apiFetch } from "./api/client";
import type { CAP, PaginatedResponse } from "@/types";

export function listCAPs(params?: {
  status?: string;
  location_id?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<CAP>> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.location_id) query.set("location_id", params.location_id);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  if (params?.page !== undefined) query.set("page", String(params.page));
  if (params?.page_size !== undefined) query.set("page_size", String(params.page_size));
  const qs = query.toString();
  return apiFetch<PaginatedResponse<CAP>>(`/api/v1/caps${qs ? `?${qs}` : ""}`);
}

export function getCAP(id: string): Promise<CAP> {
  return apiFetch<CAP>(`/api/v1/caps/${id}`);
}

export function getCAPBySubmission(submissionId: string): Promise<CAP | { cap: null }> {
  return apiFetch(`/api/v1/caps/submission/${submissionId}`);
}

export function updateCAPItem(
  capId: string,
  itemId: string,
  body: {
    followup_type?: string;
    followup_title?: string;
    followup_description?: string;
    followup_priority?: string;
    followup_assignee_id?: string;
    followup_due_at?: string;
  }
): Promise<unknown> {
  return apiFetch(`/api/v1/caps/${capId}/items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function confirmCAP(capId: string): Promise<{ cap_id: string; status: string; tasks_created: number; items_skipped: number }> {
  return apiFetch(`/api/v1/caps/${capId}/confirm`, { method: "POST" });
}

export function dismissCAP(capId: string, reason: string): Promise<{ cap_id: string; status: string }> {
  return apiFetch(`/api/v1/caps/${capId}/dismiss`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
