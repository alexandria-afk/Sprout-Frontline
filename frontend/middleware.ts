import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, TOKEN_COOKIE } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  const isDashboardRoute = path.startsWith("/dashboard");
  const isLoginRoute = path === "/login" || path === "/";
  const isSetPasswordRoute = path === "/set-password";
  const isAuthCallbackRoute = path === "/auth/callback";
  const isApiAuthRoute = path.startsWith("/api/auth/");

  // Always allow API auth routes and special pages through — no redirects
  if (isSetPasswordRoute || isAuthCallbackRoute || isApiAuthRoute) {
    return NextResponse.next();
  }

  // Verify Keycloak token from cookie
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  const user = token ? await verifyToken(token) : null;

  // Unauthenticated user trying to access dashboard → send to login
  if (!user && isDashboardRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated user hitting login or root → send to dashboard
  if (user && isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Role-based page guards for authenticated users
  if (user && isDashboardRoute) {
    const role = user.role ?? "staff";

    const redirect = (to: string) => {
      const url = request.nextUrl.clone();
      url.pathname = to;
      return NextResponse.redirect(url);
    };

    // Staff — block admin/manager-only areas
    if (role === "staff") {
      const staffBlocked = [
        "/dashboard/users",
        "/dashboard/settings",
        "/dashboard/insights",
        "/dashboard/issues/categories",
      ];
      if (staffBlocked.some((p) => path.startsWith(p))) {
        return redirect("/dashboard");
      }
    }

    // Manager — block admin-only areas
    if (role === "manager") {
      const managerBlocked = [
        "/dashboard/users",
        "/dashboard/settings/roles",
      ];
      if (managerBlocked.some((p) => path.startsWith(p))) {
        return redirect("/dashboard");
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match everything except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
