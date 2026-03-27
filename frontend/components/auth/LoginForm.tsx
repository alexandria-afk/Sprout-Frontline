"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Zap } from "lucide-react";
import { createClient } from "@/services/supabase/client";

const DEV_USERS = [
  { label: "Super Admin", email: "admin@renegade.com",       role: "super_admin", color: "bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200" },
  { label: "Admin",       email: "branchadmin@renegade.com", role: "admin",       color: "bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200" },
  { label: "Manager",     email: "manager@renegade.com",     role: "manager",     color: "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200" },
  { label: "Staff",       email: "staff@renegade.com",       role: "staff",       color: "bg-green-100 text-green-700 border-green-200 hover:bg-green-200" },
] as const;

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [quickLoginLoading, setQuickLoginLoading] = useState<string | null>(null);

  const isDev = true;

  // On mobile (LAN IP), Supabase isn't directly reachable so we route through
  // the Next.js server which can always hit localhost:54321.
  const isLanAccess =
    typeof window !== "undefined" &&
    !["localhost", "127.0.0.1"].includes(window.location.hostname);

  async function doSignIn(email: string, password: string): Promise<string | null> {
    if (isLanAccess) {
      // Proxy through Next.js server action
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) return json.error ?? "Sign-in failed";
      return null;
    } else {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return error ? (error.message === "Invalid login credentials" ? "Incorrect email or password." : error.message) : null;
    }
  }

  async function quickLogin(email: string) {
    setQuickLoginLoading(email);
    setServerError(null);
    try {
      const err = await doSignIn(email, "Test1234!");
      if (err) { setServerError(err); setQuickLoginLoading(null); return; }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setServerError("Unable to connect.");
      setQuickLoginLoading(null);
    }
  }

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(values: LoginFormValues) {
    setServerError(null);
    try {
      const err = await doSignIn(values.email, values.password);
      if (err) { setServerError(err); return; }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setServerError("Unable to connect. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {/* Email */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-dark mb-1.5">
          Email address
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className={`w-full px-3.5 py-2.5 rounded-lg border text-sm transition-colors
            focus:outline-none focus:ring-2 focus:ring-sprout-green focus:border-transparent
            ${errors.email ? "border-red-400 bg-red-50" : "border-surface-border bg-white"}`}
          placeholder="you@sprout.ph"
          {...register("email")}
        />
        {errors.email && (
          <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
        )}
      </div>

      {/* Password */}
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-dark mb-1.5">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className={`w-full px-3.5 py-2.5 pr-10 rounded-lg border text-sm transition-colors
              focus:outline-none focus:ring-2 focus:ring-sprout-green focus:border-transparent
              ${errors.password ? "border-red-400 bg-red-50" : "border-surface-border bg-white"}`}
            placeholder="••••••••"
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-secondary hover:text-dark transition-colors"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {errors.password && (
          <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
        )}
      </div>

      {/* Server error */}
      {serverError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {serverError}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full py-2.5 px-4 rounded-lg font-semibold text-white text-sm
          bg-sprout-cta hover:bg-sprout-cta-hover
          disabled:opacity-60 disabled:cursor-not-allowed
          transition-all duration-150 flex items-center justify-center gap-2"
      >
        {isSubmitting && <Loader2 size={16} className="animate-spin" />}
        {isSubmitting ? "Signing in…" : "Sign in"}
      </button>

      {/* Dev quick-login */}
      {isDev && (
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 h-px bg-surface-border" />
            <span className="flex items-center gap-1 text-xs text-dark-secondary font-medium px-1">
              <Zap size={11} className="text-amber-400" />
              Dev quick login
            </span>
            <div className="flex-1 h-px bg-surface-border" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DEV_USERS.map((u) => (
              <button
                key={u.email}
                type="button"
                disabled={!!quickLoginLoading}
                onClick={() => quickLogin(u.email)}
                className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors
                  flex items-center justify-center gap-1.5 disabled:opacity-50
                  ${u.color}`}
              >
                {quickLoginLoading === u.email
                  ? <Loader2 size={12} className="animate-spin" />
                  : null}
                {u.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
