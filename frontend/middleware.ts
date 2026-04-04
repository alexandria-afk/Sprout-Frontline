import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL_INTERNAL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — critical for keeping tokens alive
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isDashboardRoute = path.startsWith("/dashboard");
  const isLoginRoute = path === "/login" || path === "/";
  const isSetPasswordRoute = path === "/set-password";
  const isAuthCallbackRoute = path === "/auth/callback";

  // Always allow /set-password and /auth/callback through — no redirects
  if (isSetPasswordRoute || isAuthCallbackRoute) {
    return supabaseResponse;
  }

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
    const role = (user.app_metadata?.role as string) ?? "staff";
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

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Match everything except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
