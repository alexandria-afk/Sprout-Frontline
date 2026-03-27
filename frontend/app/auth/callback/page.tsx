"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/services/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // Supabase local uses the implicit flow: tokens arrive in the URL hash.
    // @supabase/ssr's createBrowserClient uses PKCE and ignores hash tokens,
    // so we parse them manually and call setSession() directly.
    const hash = window.location.hash.slice(1);

    if (!hash) {
      router.replace("/login?error=invalid_link");
      return;
    }

    const params = new URLSearchParams(hash);

    // Handle errors returned by GoTrue (e.g. expired link)
    if (params.has("error")) {
      const desc = params.get("error_description") ?? params.get("error") ?? "Invalid link";
      router.replace(`/login?error=${encodeURIComponent(desc)}`);
      return;
    }

    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");

    if (!access_token || !refresh_token) {
      router.replace("/login?error=invalid_link");
      return;
    }

    // Set the session in @supabase/ssr's cookie-based storage so the
    // middleware and server components can read it immediately.
    const supabase = createClient();
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) {
        router.replace(`/login?error=${encodeURIComponent(error.message)}`);
        return;
      }
      router.replace("/set-password");
    });
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-page">
      <div className="w-6 h-6 rounded-full border-2 border-sprout-green border-t-transparent animate-spin" />
    </div>
  );
}
