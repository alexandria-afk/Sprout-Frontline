/**
 * Server-side auth helpers (App Router Server Components only).
 * Replaces `supabase.auth.getUser()` calls in Server Components and layouts.
 *
 * Usage:
 *   import { getServerUser } from "@/services/server-auth";
 *   const user = await getServerUser();
 *   if (!user) redirect("/login");
 */

import { cookies } from "next/headers";
import { verifyToken, TOKEN_COOKIE, type AuthUser } from "@/lib/auth";

/** Returns the authenticated user from the Keycloak token cookie, or null. */
export async function getServerUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/** Returns the raw access token string from the Keycloak cookie. */
export async function getServerToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(TOKEN_COOKIE)?.value ?? null;
}
