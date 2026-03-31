"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Loader2 } from "lucide-react";
import { getAttendanceRules, updateAttendanceRules } from "@/services/shifts";
import type { AttendanceRules } from "@/types";

// ── Styles ────────────────────────────────────────────────────────────────────

const inputCls =
  "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 bg-white";

const btnPrimary =
  "flex items-center gap-2 px-4 py-2 rounded-lg bg-sprout-purple text-white text-sm font-medium hover:bg-sprout-purple/90 transition-colors disabled:opacity-50";

// ── Banner ────────────────────────────────────────────────────────────────────

function Banner({
  type,
  message,
  onDismiss,
}: {
  type: "success" | "error";
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium ${
        type === "success"
          ? "bg-green-50 text-green-800 border border-green-200"
          : "bg-red-50 text-red-800 border border-red-200"
      }`}
    >
      <span>{message}</span>
      <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
        ✕
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ShiftSettingsPage() {
  const [rules, setRules] = useState<Partial<AttendanceRules>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    getAttendanceRules()
      .then(setRules)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const toNum = (v: unknown) => {
        if (v === "" || v === null || v === undefined) return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
      };
      await updateAttendanceRules({
        late_threshold_mins: toNum(rules.late_threshold_mins) ?? undefined,
        early_departure_threshold_mins: toNum(rules.early_departure_threshold_mins) ?? undefined,
        overtime_threshold_hours: toNum(rules.overtime_threshold_hours) ?? undefined,
        weekly_overtime_threshold_hours: toNum(rules.weekly_overtime_threshold_hours) as number | undefined,
        break_duration_mins: toNum(rules.break_duration_mins) ?? undefined,
      });
      setBanner({ type: "success", msg: "Attendance rules saved." });
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const row = (label: string, key: keyof AttendanceRules, unit: string, optional = false) => (
    <div key={key} className="grid grid-cols-2 items-center gap-4">
      <label className="text-sm text-dark">
        {label}
        {optional && <span className="ml-1 text-xs text-dark-secondary">(optional)</span>}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className={`${inputCls} w-24`}
          value={(rules[key] as number) ?? ""}
          placeholder={optional ? "—" : undefined}
          onChange={(e) =>
            setRules((prev) => ({
              ...prev,
              [key]: e.target.value === "" ? null : Number(e.target.value),
            }))
          }
        />
        <span className="text-sm text-dark-secondary">{unit}</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="p-1.5 rounded-lg hover:bg-white/60 text-dark/50 hover:text-dark transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-sprout-purple/10 flex items-center justify-center shrink-0">
            <CalendarClock className="w-5 h-5 text-sprout-purple" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Shift Settings</h1>
            <p className="text-sm text-dark-secondary">
              Configure attendance rules — late thresholds, overtime limits, and break durations for your organisation.
            </p>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-sprout-purple" />
          </div>
        ) : (
          <div className="space-y-4">
            {banner && (
              <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />
            )}
            <div className="bg-white rounded-xl border border-surface-border p-6">
              <h3 className="font-semibold text-dark mb-4">Attendance Rules</h3>
              <div className="space-y-4 max-w-lg">
                {row("Late Threshold", "late_threshold_mins", "minutes")}
                {row("Early Departure Threshold", "early_departure_threshold_mins", "minutes")}
                {row("Daily Overtime After", "overtime_threshold_hours", "hours")}
                {row("Weekly Overtime After", "weekly_overtime_threshold_hours", "hours", true)}
                {row("Break Duration", "break_duration_mins", "minutes")}
              </div>
              <div className="mt-6">
                <button className={btnPrimary} onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
