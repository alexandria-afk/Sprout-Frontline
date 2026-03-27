import { apiFetch } from "@/services/api/client";
import type { Asset, RepairGuide, MaintenanceTicket } from "@/types";

// ── Assets ────────────────────────────────────────────────────────────────────

export function listAssets(params: { location_id?: string } = {}): Promise<{ data: Asset[]; total: number }> {
  const q = new URLSearchParams();
  if (params.location_id) q.set("location_id", params.location_id);
  return apiFetch(`/api/v1/assets${q.toString() ? `?${q.toString()}` : ""}`);
}

export function getAsset(id: string): Promise<Asset & { maintenance_tickets?: MaintenanceTicket[] }> {
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

// ── Maintenance Tickets ───────────────────────────────────────────────────────

export interface ListTicketsParams {
  asset_id?: string;
  status?: string;
  priority?: string;
  assigned_to?: string;
  vendor_id?: string;
  location_id?: string;
  page?: number;
  page_size?: number;
}

export function listTickets(params: ListTicketsParams = {}): Promise<{ data: MaintenanceTicket[]; total: number }> {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") q.set(k, String(v)); });
  const qs = q.toString();
  return apiFetch(`/api/v1/maintenance${qs ? `?${qs}` : ""}`);
}

export function getTicket(id: string): Promise<MaintenanceTicket> {
  return apiFetch(`/api/v1/maintenance/${id}`);
}

export function createTicket(body: {
  asset_id: string;
  title: string;
  ticket_type?: string;
  description?: string;
  priority?: string;
  issue_id?: string;
  sla_hours?: number;
  due_at?: string;
}): Promise<MaintenanceTicket> {
  return apiFetch("/api/v1/maintenance", { method: "POST", body: JSON.stringify(body) });
}

export function updateTicketStatus(id: string, status: string, resolution_note?: string): Promise<MaintenanceTicket> {
  return apiFetch(`/api/v1/maintenance/${id}/status`, {
    method: "PUT",
    body: JSON.stringify({ status, resolution_note }),
  });
}

export function assignTicket(id: string, body: {
  assigned_to?: string | null;
  assigned_vendor_id?: string | null;
}): Promise<MaintenanceTicket> {
  return apiFetch(`/api/v1/maintenance/${id}/assign`, { method: "PUT", body: JSON.stringify(body) });
}

export function updateTicketCost(id: string, cost: number): Promise<MaintenanceTicket> {
  return apiFetch(`/api/v1/maintenance/${id}/cost`, { method: "PUT", body: JSON.stringify({ cost }) });
}
