import { apiFetch } from "@/services/api/client";
import type { Asset, RepairGuide } from "@/types";

export interface RepairHistoryIssue {
  id: string;
  title: string;
  status: string;
  priority: string;
  cost: number | null;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  "profiles!assigned_to"?: { full_name: string } | null;
}

// ── Assets ────────────────────────────────────────────────────────────────────

export function listAssets(params: { location_id?: string } = {}): Promise<{ data: Asset[]; total: number }> {
  const q = new URLSearchParams();
  if (params.location_id) q.set("location_id", params.location_id);
  return apiFetch(`/api/v1/assets${q.toString() ? `?${q.toString()}` : ""}`);
}

export function getAsset(id: string): Promise<Asset & { repair_history?: RepairHistoryIssue[]; repair_total_cost?: number }> {
  return apiFetch(`/api/v1/assets/${id}`);
}

export function createAsset(body: {
  location_id: string;
  name: string;
  category: string;
  serial_number?: string;
  model?: string;
  manufacturer?: string;
  installed_at?: string;
  next_maintenance_due_at?: string;
}): Promise<Asset> {
  return apiFetch("/api/v1/assets", { method: "POST", body: JSON.stringify(body) });
}

export function updateAsset(id: string, body: Partial<{
  name: string; category: string; serial_number: string; model: string;
  manufacturer: string; installed_at: string; next_maintenance_due_at: string;
}>): Promise<Asset> {
  return apiFetch(`/api/v1/assets/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteAsset(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/assets/${id}`, { method: "DELETE" });
}

export function listAssetGuides(id: string): Promise<{ data: RepairGuide[]; total: number }> {
  return apiFetch(`/api/v1/assets/${id}/guides`);
}

// ── Repair Guides ─────────────────────────────────────────────────────────────

export function listRepairGuides(params: { asset_id?: string; category_id?: string } = {}): Promise<{ data: RepairGuide[]; total: number }> {
  const q = new URLSearchParams();
  if (params.asset_id) q.set("asset_id", params.asset_id);
  if (params.category_id) q.set("category_id", params.category_id);
  return apiFetch(`/api/v1/repair-guides${q.toString() ? `?${q.toString()}` : ""}`);
}

export function getRepairGuide(id: string): Promise<RepairGuide> {
  return apiFetch(`/api/v1/repair-guides/${id}`);
}

export function createRepairGuide(body: {
  title: string;
  guide_type: string;
  asset_id?: string;
  category_id?: string;
  content?: string;
  file?: File;
}): Promise<RepairGuide> {
  if (body.file) {
    const form = new FormData();
    form.append("title", body.title);
    form.append("guide_type", body.guide_type);
    if (body.asset_id) form.append("asset_id", body.asset_id);
    if (body.category_id) form.append("category_id", body.category_id);
    form.append("file", body.file);
    return apiFetch("/api/v1/repair-guides", { method: "POST", body: form, rawBody: true });
  }
  const { file: _f, ...rest } = body;
  return apiFetch("/api/v1/repair-guides", { method: "POST", body: JSON.stringify(rest) });
}

export function deleteRepairGuide(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/repair-guides/${id}`, { method: "DELETE" });
}
