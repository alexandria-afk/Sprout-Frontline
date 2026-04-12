import { NextRequest, NextResponse } from "next/server";
import { TOKEN_COOKIE, REFRESH_COOKIE } from "@/lib/auth";

const KEYCLOAK_URL = process.env.KEYCLOAK_URL!;
const KEYCLOAK_REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM!;
const KEYCLOAK_CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID!;

/**
 * POST /api/auth/refresh
 * Uses the HttpOnly refresh token cookie to obtain a new access token from Keycloak.
 * Called automatically by apiFetch when a 401 is received.
 */
export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  }

  const tokenUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

  try {
    const kcRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: KEYCLOAK_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!kcRes.ok) {
      // Refresh token is invalid/expired — force re-login
      return NextResponse.json({ error: "Refresh failed" }, { status: 401 });
    }

    const tokens = await kcRes.json();
    const accessToken: string = tokens.access_token;
    const newRefreshToken: string = tokens.refresh_token;
    const expiresIn: number = tokens.expires_in ?? 300;

    const response = NextResponse.json({ ok: true });

    // Reissue access token cookie (not HttpOnly so client JS can read it)
    response.cookies.set(TOKEN_COOKIE, accessToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: expiresIn,
    });

    // Reissue refresh token cookie (HttpOnly)
    response.cookies.set(REFRESH_COOKIE, newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
