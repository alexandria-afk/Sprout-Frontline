"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { createClient } from "@/services/supabase/client";

const schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, {
  message: "Passwords don't match",
  path: ["confirm"],
});

type FormValues = z.infer<typeof schema>;

const inputCls = "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-green/40 w-full";

export default function SetPasswordPage() {
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [apiError, setApiError] = useState("");
  const [checking, setChecking] = useState(true);

  // If no session exists, redirect to login (link expired / already used)
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login?error=invalid_link");
      } else {
        setChecking(false);
      }
    });
  }, [router]);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: FormValues) => {
    setApiError("");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      // "same password" means this account already has this exact password set.
      // Since they're already signed in via the invite link, just take them to the dashboard.
      if (
        error.message.toLowerCase().includes("same") ||
        error.message.toLowerCase().includes("different from the old")
      ) {
        router.replace("/dashboard");
        return;
      }
      setApiError(error.message);
      return;
    }
    router.replace("/dashboard");
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-page">
        <div className="w-6 h-6 rounded-full border-2 border-sprout-green border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-page p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-sprout-green/10 flex items-center justify-center">
            <KeyRound className="w-6 h-6 text-sprout-green" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-dark">Set your password</h1>
            <p className="text-sm text-dark-secondary mt-1">
              Choose a secure password to complete your account setup.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {/* Password */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">New Password</label>
            <div className="relative">
              <input
                className={inputCls + " pr-10"}
                type={showPw ? "text" : "password"}
                placeholder="Minimum 8 characters"
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-dark"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
          </div>

          {/* Confirm */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Confirm Password</label>
            <input
              className={inputCls}
              type={showPw ? "text" : "password"}
              placeholder="Re-enter your password"
              {...register("confirm")}
            />
            {errors.confirm && <p className="text-xs text-red-500">{errors.confirm.message}</p>}
          </div>

          {apiError && <p className="text-xs text-red-500">{apiError}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 rounded-lg bg-sprout-green text-white font-semibold text-sm hover:bg-sprout-green/90 disabled:opacity-60 mt-1"
          >
            {isSubmitting ? "Setting password…" : "Set Password & Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
