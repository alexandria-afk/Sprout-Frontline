import { NextResponse } from "next/server";
import { getServerUser, getServerToken } from "@/services/server-auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/**
 * GET /api/auth/me
 * Returns the current authenticated user with full profile data (role, org, location).
 * Used by client components that previously called supabase.auth.getSession().
 *
 * Response shape is backwards-compatible with Supabase's user.app_metadata pattern:
 *   { id, email, role, app_metadata: { role, organisation_id, location_id } }
 */
export async function GET() {
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch full profile from backend to get org_id, location_id, etc.
  const token = await getServerToken();
  let profile: Record<string, unknown> = {};
  if (token) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
        // Short timeout — use JWT data as fallback if backend is slow
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        profile = await res.json();
      }
    } catch {
      // Fall back to JWT-only data
    }
  }

  const role = (profile.role as string) ?? user.role ?? "staff";
  const orgId = (profile.organisation_id as string) ?? user.app_metadata?.organisation_id ?? null;
  const locationId = (profile.location_id as string) ?? user.app_metadata?.location_id ?? null;
  const fullName = (profile.full_name as string) ?? user.email ?? "";

  return NextResponse.json({
    id: user.id,
    email: user.email,
    role,
    // Backwards-compatible with Supabase's user.app_metadata shape
    app_metadata: {
      role,
      organisation_id: orgId,
      location_id: locationId,
      full_name: fullName,
    },
  });
}
