import { type NextRequest, NextResponse } from "next/server";
import { TOKEN_COOKIE, REFRESH_COOKIE } from "@/lib/auth";

const KEYCLOAK_URL = process.env.KEYCLOAK_URL!;
const KEYCLOAK_REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM!;
const KEYCLOAK_CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID!;

export async function GET(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  // Revoke the Keycloak session (best-effort — don't block redirect on failure)
  if (refreshToken) {
    const logoutUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/logout`;
    await fetch(logoutUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: KEYCLOAK_CLIENT_ID,
        refresh_token: refreshToken,
      }),
    }).catch(() => {/* ignore */});
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  const response = NextResponse.redirect(url);

  // Clear both token cookies
  response.cookies.set(TOKEN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });

  return response;
}
