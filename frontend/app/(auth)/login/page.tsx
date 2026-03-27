import { redirect } from "next/navigation";
import { createClient } from "@/services/supabase/server";
import { LoginForm } from "@/components/auth/LoginForm";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-surface-page flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-sprout-navy mb-4">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-sprout-green fill-current">
              <path d="M17 8C8 10 5.9 16.17 3.82 21 5.8 15 8 10.88 17 8z" />
              <path d="M21.71 8.29l-3-3a1 1 0 0 0-1.42 0C15.91 6.67 15 9.12 15 12c0 1.71.33 3.33.94 4.79L13.5 18.2A7.09 7.09 0 0 0 8 13.07c0 4.27 3.23 7.77 7.39 8A9 9 0 0 0 21.71 8.29z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-sprout-navy">Frontline</h1>
          <p className="text-dark-secondary text-sm mt-1">by Sprout Solutions</p>
        </div>

        {/* Login Card */}
        <div className="bg-surface-card rounded-2xl shadow-sm border border-surface-border p-6 md:p-8">
          <h2 className="text-xl font-semibold text-dark mb-1">Welcome back</h2>
          <p className="text-dark-secondary text-sm mb-6">Sign in to your account</p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
