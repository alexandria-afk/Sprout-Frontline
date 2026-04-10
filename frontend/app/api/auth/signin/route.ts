import { NextRequest, NextResponse } from "next/server";
import { TOKEN_COOKIE, REFRESH_COOKIE } from "@/lib/auth";

const KEYCLOAK_URL = process.env.KEYCLOAK_URL!;
const KEYCLOAK_REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM!;
const KEYCLOAK_CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID!;

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    // Exchange email/password for Keycloak tokens via Resource Owner Password flow
    const tokenUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
    const kcRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: KEYCLOAK_CLIENT_ID,
        username: email,
        password,
        grant_type: "password",
        scope: "openid profile email",
      }),
    });

    if (!kcRes.ok) {
      const err = await kcRes.json().catch(() => ({}));
      const msg =
        err.error_description === "Invalid user credentials"
          ? "Incorrect email or password."
          : err.error_description ?? "Sign-in failed";
      return NextResponse.json({ error: msg }, { status: 401 });
    }

    const tokens = await kcRes.json();
    const accessToken: string = tokens.access_token;
    const refreshToken: string = tokens.refresh_token;
    const expiresIn: number = tokens.expires_in ?? 300; // seconds

    const response = NextResponse.json({ ok: true });

    // Access token — NOT httpOnly so client-side apiFetch can read it for API calls.
    // It expires in ~5 minutes (Keycloak default), limiting XSS exposure window.
    response.cookies.set(TOKEN_COOKIE, accessToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: expiresIn,
    });

    // Refresh token — HttpOnly so it can't be read by JS (longer-lived, higher risk)
    response.cookies.set(REFRESH_COOKIE, refreshToken, {
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
