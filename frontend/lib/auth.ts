/**
 * Shared auth helpers for Keycloak JWT validation.
 * Used by middleware (Edge Runtime) and server components.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

// ── Constants ──────────────────────────────────────────────────────────────────
export const TOKEN_COOKIE = "kc_access_token";
export const REFRESH_COOKIE = "kc_refresh_token";

// ── JWKS (remote, cached by jose) ─────────────────────────────────────────────
// Lazily created once per process lifetime.
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!_jwks) {
    const url = process.env.KEYCLOAK_JWKS_URL!;
    _jwks = createRemoteJWKSet(new URL(url));
  }
  return _jwks;
}

// ── Types ──────────────────────────────────────────────────────────────────────
export interface AuthUser {
  /** Keycloak subject UUID */
  id: string;
  email: string;
  /** First role from the "role" claim (e.g. "admin", "manager", "staff") */
  role: string;
  /** Raw Keycloak JWT payload */
  rawPayload: JWTPayload;
  /**
   * Compatibility shim — keeps the same shape as Supabase's user.app_metadata
   * so downstream components that read app_metadata.role continue working.
   */
  app_metadata: {
    role: string;
    organisation_id?: string;
    location_id?: string;
    language?: string;
  };
}

// ── Verify token ──────────────────────────────────────────────────────────────
export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      // Keycloak uses the realm URL as issuer
      issuer: `${process.env.NEXT_PUBLIC_KEYCLOAK_URL}/realms/${process.env.NEXT_PUBLIC_KEYCLOAK_REALM}`,
    });

    const sub = payload.sub ?? "";
    const rawRole = (payload as JWTPayload & { role?: string | string[] }).role;
    const role = Array.isArray(rawRole)
      ? rawRole[0] ?? "staff"
      : rawRole ?? "staff";

    return {
      id: sub,
      email: (payload as JWTPayload & { email?: string }).email ?? "",
      role,
      rawPayload: payload,
      app_metadata: { role },
    };
  } catch {
    return null;
  }
}

/**
 * Client-side only: read the Keycloak access token from the browser cookie.
 * Use this anywhere you need to manually attach Authorization: Bearer headers.
 */
export function getClientToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${TOKEN_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(TOKEN_COOKIE.length + 1)) : null;
}
