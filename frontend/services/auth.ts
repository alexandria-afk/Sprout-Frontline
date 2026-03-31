import { apiFetch } from "./api/client";

export function deleteDemoWorkspace(orgId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/auth/demo/${orgId}`, { method: "DELETE" });
}
