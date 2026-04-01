import { apiFetch } from "./api/client";

export interface AiInsight {
  severity: "critical" | "warning" | "info";
  title: string;
  body: string;
  recommendation: string;
}

export interface DashboardInsightsResponse {
  brief: string;
  insights: AiInsight[];
  cached_at: string;
  role_level: string;
}

export async function getDashboardInsights(refresh = false): Promise<DashboardInsightsResponse> {
  const qs = refresh ? "?refresh=true" : "";
  return apiFetch<DashboardInsightsResponse>(`/api/v1/ai/dashboard-insights${qs}`);
}

export async function getDailySnapshot(refresh = false): Promise<Record<string, unknown>> {
  const qs = refresh ? "?refresh=true" : "";
  return apiFetch<Record<string, unknown>>(`/api/v1/ai/daily-snapshot${qs}`);
}
