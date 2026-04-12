import { TOKEN_COOKIE } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/** Read the Keycloak access token from the browser cookie (client-side only). */
function getTokenFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${TOKEN_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(TOKEN_COOKIE.length + 1)) : null;
}

/** In-flight refresh promise — prevents concurrent refresh storms */
let _refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = fetch("/api/auth/refresh", { method: "POST" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = getTokenFromCookie();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { rawBody?: boolean } = {},
  _retry = true,
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

  // Silently refresh and retry once on 401 (expired access token)
  if (res.status === 401 && _retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetch<T>(path, options, false /* no more retries */);
    }
    // Refresh failed — session is dead, redirect to login
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Session expired");
  }

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.detail || body?.message || `HTTP ${res.status}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as unknown as T;
  }

  return res.json() as Promise<T>;
}
