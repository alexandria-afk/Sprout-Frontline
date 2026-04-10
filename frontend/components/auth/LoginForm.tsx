"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Zap, Sparkles, Building2, Trash2, LogIn } from "lucide-react";
import { deleteDemoWorkspace } from "@/services/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const DEMO_WORKSPACES_KEY = "sprout_demo_workspaces";

interface DemoWorkspace {
  company_name: string;
  email: string;
  password: string;
  org_id: string;
  created_at: string;
}

function loadDemoWorkspaces(): DemoWorkspace[] {
  try {
    return JSON.parse(localStorage.getItem(DEMO_WORKSPACES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveDemoWorkspace(ws: DemoWorkspace) {
  const existing = loadDemoWorkspaces();
  localStorage.setItem(DEMO_WORKSPACES_KEY, JSON.stringify([ws, ...existing]));
}

function removeDemoWorkspace(org_id: string) {
  const existing = loadDemoWorkspaces().filter((w) => w.org_id !== org_id);
  localStorage.setItem(DEMO_WORKSPACES_KEY, JSON.stringify(existing));
}

const DEV_USERS = [
  { label: "Super Admin", email: "admin@renegade.com",       color: "bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200" },
  { label: "Admin",       email: "branchadmin@renegade.com", color: "bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200" },
  { label: "Manager",     email: "manager@renegade.com",     color: "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200" },
  { label: "Staff",       email: "staff@renegade.com",       color: "bg-green-100 text-green-700 border-green-200 hover:bg-green-200" },
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
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [demoWorkspaces, setDemoWorkspaces] = useState<DemoWorkspace[]>([]);
  const [deletingWorkspace, setDeletingWorkspace] = useState<string | null>(null);

  // Load from localStorage after mount (client-only)
  useEffect(() => {
    setDemoWorkspaces(loadDemoWorkspaces());
  }, []);

  const isDev = true;

  const isLanAccess =
    typeof window !== "undefined" &&
    !["localhost", "127.0.0.1"].includes(window.location.hostname);

  async function doSignIn(email: string, password: string): Promise<string | null> {
    // All sign-in goes through the server route which calls Keycloak and sets
    // HttpOnly token cookies — no direct Supabase client calls.
    const res = await fetch("/api/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok) return json.error ?? "Sign-in failed";
    return null;
  }

  async function startOnboarding() {
    setOnboardingLoading(true);
    setServerError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/demo-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_name: companyName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "Failed to create demo account.");

      const ws: DemoWorkspace = {
        company_name: companyName.trim() || data.email.split("@")[0],
        email: data.email,
        password: data.password,
        org_id: data.org_id,
        created_at: new Date().toISOString(),
      };
      saveDemoWorkspace(ws);
      setDemoWorkspaces(loadDemoWorkspaces());
      setCompanyName("");

      const err = await doSignIn(data.email, data.password);
      if (err) throw new Error(err);

      router.push("/onboarding");
      router.refresh();
    } catch (e: unknown) {
      setServerError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setOnboardingLoading(false);
    }
  }

  async function loginToWorkspace(ws: DemoWorkspace) {
    setQuickLoginLoading(ws.org_id);
    setServerError(null);
    try {
      const err = await doSignIn(ws.email, ws.password);
      if (err) { setServerError(err); return; }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setServerError("Unable to connect.");
    } finally {
      setQuickLoginLoading(null);
    }
  }

  async function deleteWorkspace(ws: DemoWorkspace) {
    setDeletingWorkspace(ws.org_id);
    try {
      // Sign in as that workspace's admin
      const signInErr = await doSignIn(ws.email, ws.password ?? "Test1234!");
      if (signInErr) {
        // Can't auth — just remove from local list
        removeDemoWorkspace(ws.org_id);
        setDemoWorkspaces(loadDemoWorkspaces());
        return;
      }
      // Wipe from DB
      await deleteDemoWorkspace(ws.org_id);
      // Clear the session
      await fetch("/api/auth/signout");
    } catch {
      // Best effort — still remove from local list
    } finally {
      removeDemoWorkspace(ws.org_id);
      setDemoWorkspaces(loadDemoWorkspaces());
      setDeletingWorkspace(null);
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

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormValues>({
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
        {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
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
        {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
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

      {/* ── Demo Workspaces ──────────────────────────────────────────────────── */}
      <div className="pt-2">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-px bg-surface-border" />
          <span className="text-xs text-dark-secondary font-medium px-1">or</span>
          <div className="flex-1 h-px bg-surface-border" />
        </div>

        <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-green-600" />
              <span className="text-sm font-semibold text-green-800">Demo Workspaces</span>
            </div>
            {demoWorkspaces.length > 0 && (
              <span className="text-xs text-green-600 font-medium">{demoWorkspaces.length} instance{demoWorkspaces.length !== 1 ? "s" : ""}</span>
            )}
          </div>

          {/* Existing workspace list */}
          {demoWorkspaces.length > 0 && (
            <div className="space-y-2">
              {demoWorkspaces.map((ws) => (
                <div
                  key={ws.org_id}
                  className="flex items-center gap-2 bg-white rounded-lg border border-green-100 px-3 py-2.5"
                >
                  <div className="w-7 h-7 rounded-md bg-green-100 flex items-center justify-center flex-shrink-0">
                    <Building2 size={13} className="text-green-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-800 truncate">{ws.company_name}</div>
                    <div className="text-xs text-slate-400 truncate font-mono">{ws.email}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => loginToWorkspace(ws)}
                    disabled={quickLoginLoading === ws.org_id}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-green-600 text-white rounded-md text-xs font-semibold hover:bg-green-700 disabled:opacity-50 flex-shrink-0"
                  >
                    {quickLoginLoading === ws.org_id
                      ? <Loader2 size={11} className="animate-spin" />
                      : <LogIn size={11} />}
                    Enter
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteWorkspace(ws)}
                    disabled={deletingWorkspace === ws.org_id}
                    className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Delete workspace"
                  >
                    {deletingWorkspace === ws.org_id
                      ? <Loader2 size={13} className="animate-spin text-red-400" />
                      : <Trash2 size={13} />}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Create new workspace */}
          <div className="flex gap-2">
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), startOnboarding())}
              placeholder="New company name…"
              className="flex-1 px-3 py-2 rounded-lg border border-green-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              type="button"
              onClick={startOnboarding}
              disabled={onboardingLoading}
              className="px-3 py-2 rounded-lg font-semibold text-white text-sm
                bg-green-600 hover:bg-green-700
                disabled:opacity-60 disabled:cursor-not-allowed
                transition-all flex items-center gap-1.5 flex-shrink-0"
            >
              {onboardingLoading
                ? <Loader2 size={14} className="animate-spin" />
                : <Sparkles size={14} />}
              {onboardingLoading ? "Creating…" : "Create"}
            </button>
          </div>
          <p className="text-xs text-green-700">
            Creates a fresh multi-tenant instance and launches the AI onboarding wizard.
          </p>
        </div>
      </div>

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
                {quickLoginLoading === u.email ? <Loader2 size={12} className="animate-spin" /> : null}
                {u.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
