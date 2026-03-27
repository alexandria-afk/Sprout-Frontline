import { apiFetch } from "@/services/api/client";
import type { Vendor } from "@/types";

export function listVendors(): Promise<{ data: Vendor[]; total: number }> {
  return apiFetch("/api/v1/vendors");
}

export function createVendor(body: {
  name: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
}): Promise<Vendor> {
  return apiFetch("/api/v1/vendors", { method: "POST", body: JSON.stringify(body) });
}

export function updateVendor(id: string, body: Partial<{
  name: string; contact_name: string; contact_email: string; contact_phone: string; is_active: boolean;
}>): Promise<Vendor> {
  return apiFetch(`/api/v1/vendors/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteVendor(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/vendors/${id}`, { method: "DELETE" });
}

export function grantVendorCategoryAccess(vendorId: string, categoryId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/vendors/${vendorId}/category-access`, {
    method: "POST",
    body: JSON.stringify({ category_id: categoryId }),
  });
}

export function revokeVendorCategoryAccess(vendorId: string, categoryId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/vendors/${vendorId}/category-access/${categoryId}`, { method: "DELETE" });
}
