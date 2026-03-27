import { apiFetch } from "./api/client";

export interface DashboardSummary {
  total_assignments: number;
  total_submitted: number;
  completion_rate: number;
  pending_count: number;
  total_announcements: number;
  total_receipts: number;
  read_receipts: number;
  engagement_rate: number;
  total_audit_submissions: number;
  passed_audit_submissions: number;
  audit_compliance_rate: number | null;
}

export async function getDashboardSummary(params?: {
  location_id?: string;
  from?: string;
  to?: string;
}): Promise<DashboardSummary> {
  const query = new URLSearchParams();
  if (params?.location_id) query.set("location_id", params.location_id);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  const qs = query.toString();
  return apiFetch<DashboardSummary>(`/api/v1/dashboard/summary${qs ? `?${qs}` : ""}`);
}
