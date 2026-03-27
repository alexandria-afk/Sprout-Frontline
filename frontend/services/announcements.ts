import { apiFetch } from "./api/client";
import type {
  Announcement,
  PaginatedResponse,
  ApiResponse,
} from "@/types";

export interface CreateAnnouncementPayload {
  title: string;
  body: string;
  media_url?: string;
  media_urls?: string[];
  requires_acknowledgement?: boolean;
  publish_at?: string;
  target_roles?: string[];
  target_location_ids?: string[];
}

export interface ReceiptStats {
  total_targeted: number;
  total_read: number;
  total_acknowledged: number;
  receipts: { id: string; user_id: string; read_at: string | null; acknowledged_at: string | null }[];
}

export async function listAnnouncements(params?: {
  page?: number;
}): Promise<PaginatedResponse<Announcement>> {
  const query = new URLSearchParams();
  if (params?.page !== undefined) query.set("page", String(params.page));
  const qs = query.toString();
  return apiFetch<PaginatedResponse<Announcement>>(`/api/v1/announcements${qs ? `?${qs}` : ""}`);
}

export async function createAnnouncement(
  payload: CreateAnnouncementPayload
): Promise<Announcement> {
  return apiFetch<Announcement>("/api/v1/announcements", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAnnouncement(
  id: string,
  payload: Partial<CreateAnnouncementPayload>
): Promise<Announcement> {
  return apiFetch<Announcement>(`/api/v1/announcements/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteAnnouncement(id: string): Promise<ApiResponse<null>> {
  return apiFetch<ApiResponse<null>>(`/api/v1/announcements/${id}`, {
    method: "DELETE",
  });
}

export async function getReceiptStats(id: string): Promise<ReceiptStats> {
  return apiFetch<ReceiptStats>(`/api/v1/announcements/${id}/receipts`);
}

export async function markRead(id: string): Promise<void> {
  await apiFetch(`/api/v1/announcements/${id}/read`, { method: "POST" });
}

export async function acknowledgeAnnouncement(id: string): Promise<void> {
  await apiFetch(`/api/v1/announcements/${id}/acknowledge`, { method: "POST" });
}
