import { apiFetch } from "./api/client";
import { createClient } from "@/services/supabase/client";
import { getClientToken } from "@/lib/auth";
import type { Profile, PaginatedResponse, ApiResponse } from "@/types";

export interface CreateUserPayload {
  email: string;
  full_name: string;
  role: string;
  position?: string | null;
  location_id?: string;
  phone_number?: string;
  reports_to?: string;
}

export interface UpdateUserPayload {
  full_name?: string;
  role?: string;
  position?: string | null;
  location_id?: string;
  phone_number?: string;
  is_active?: boolean;
  reports_to?: string | null;
  language?: string;
}

export interface BulkImportResult {
  successes: Profile[];
  failures: { row: number; email: string; error: string }[];
}

export async function listUsers(params?: {
  location_id?: string;
  role?: string;
  search?: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<Profile>> {
  const query = new URLSearchParams();
  if (params?.location_id) query.set("location_id", params.location_id);
  if (params?.role) query.set("role", params.role);
  if (params?.search) query.set("search", params.search);
  if (params?.page !== undefined) query.set("page", String(params.page));
  if (params?.page_size !== undefined) query.set("page_size", String(params.page_size));
  const qs = query.toString();
  return apiFetch<PaginatedResponse<Profile>>(`/api/v1/users${qs ? `?${qs}` : ""}`);
}

export async function createUser(
  payload: CreateUserPayload
): Promise<Profile> {
  return apiFetch<Profile>("/api/v1/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateUser(
  id: string,
  payload: UpdateUserPayload
): Promise<Profile> {
  return apiFetch<Profile>(`/api/v1/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteUser(id: string): Promise<ApiResponse<null>> {
  return apiFetch<ApiResponse<null>>(`/api/v1/users/${id}`, { method: "DELETE" });
}

export async function getMe(): Promise<ApiResponse<Profile>> {
  return apiFetch<ApiResponse<Profile>>("/users/me");
}

export interface Location {
  id: string;
  name: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  geo_fence_radius_meters?: number;
}

export async function listLocations(): Promise<Location[]> {
  // Phase 4: replace with psycopg2
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const orgId = data.session?.user?.app_metadata?.organisation_id as string | undefined;
  if (!orgId) return [];
  return apiFetch<Location[]>(`/api/v1/organisations/${orgId}/locations`);
}

async function getOrgId(): Promise<string | undefined> {
  // Phase 4: replace with psycopg2
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.app_metadata?.organisation_id as string | undefined;
}

export async function createLocation(payload: { name: string; address?: string; latitude?: number | null; longitude?: number | null; geo_fence_radius_meters?: number }): Promise<Location> {
  const orgId = await getOrgId();
  if (!orgId) throw new Error("Not authenticated");
  return apiFetch<Location>(`/api/v1/organisations/${orgId}/locations`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateLocation(id: string, payload: { name?: string; address?: string; latitude?: number | null; longitude?: number | null; geo_fence_radius_meters?: number }): Promise<Location> {
  const orgId = await getOrgId();
  if (!orgId) throw new Error("Not authenticated");
  return apiFetch<Location>(`/api/v1/organisations/${orgId}/locations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteLocation(id: string): Promise<void> {
  const orgId = await getOrgId();
  if (!orgId) throw new Error("Not authenticated");
  await apiFetch(`/api/v1/organisations/${orgId}/locations/${id}`, { method: "DELETE" });
}

// ── Organisation & Feature Flags ──────────────────────────────────────────────

export interface OrgFeatureFlags {
  staff_availability_enabled?: boolean;
  [key: string]: boolean | undefined;
}

export interface OrganisationDetails {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_active: boolean;
  feature_flags: OrgFeatureFlags;
}

export function getMyOrganisation(): Promise<OrganisationDetails> {
  return apiFetch<OrganisationDetails>("/api/v1/organisations/my");
}

export function updateOrgFeatureFlags(orgId: string, featureFlags: OrgFeatureFlags): Promise<OrganisationDetails> {
  return apiFetch<OrganisationDetails>(`/api/v1/organisations/${orgId}/feature-flags`, {
    method: "PATCH",
    body: JSON.stringify({ feature_flags: featureFlags }),
  });
}

export async function listPositions(search = ""): Promise<{ position: string; count: number }[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return apiFetch<{ position: string; count: number }[]>(`/api/v1/users/positions${qs}`);
}

export async function bulkImportUsers(file: File): Promise<ApiResponse<BulkImportResult>> {
  const token = getClientToken();

  const formData = new FormData();
  formData.append("file", file);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  const res = await fetch(`${API_BASE}/api/v1/users/bulk-import`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  return res.json() as Promise<ApiResponse<BulkImportResult>>;
}
