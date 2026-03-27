import { createClient } from "@/services/supabase/client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function getAuthHeaders(): Promise<HeadersInit> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { rawBody?: boolean } = {}
): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const { rawBody, ...fetchOptions } = options;
  const headers: HeadersInit = rawBody
    ? { ...authHeaders, ...(options.headers ?? {}) }
    : { "Content-Type": "application/json", ...authHeaders, ...(options.headers ?? {}) };
  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail || body?.message || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}
