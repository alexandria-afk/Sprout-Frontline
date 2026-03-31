"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import {
  Medal,
  Plus,
  Trash2,
  ChevronLeft,
  Sparkles,
  Loader2,
  Layers,
  Gift,
  ArrowLeft,
  Pencil,
} from "lucide-react";
import {
  listBadgeConfigs,
  createBadgeConfig,
  updateBadgeConfig,
  deleteBadgeConfig,
  awardBadge,
  type BadgeConfig,
} from "@/services/gamification";
import { listUsers } from "@/services/users";
import { getPackageTemplates } from "@/services/onboarding";
import { createClient } from "@/services/supabase/client";
import { friendlyError } from "@/lib/errors";
import type { Profile } from "@/types";

// ── Template data ─────────────────────────────────────────────────────────────

type TemplateBadgeEntry = {
  name: string;
  icon: string;
  description: string;
  criteria_type: string;
  criteria_value: number;
  points_awarded: number;
};
type TemplateBadgeGroup = { group: string; badges: TemplateBadgeEntry[] };

const CRITERIA_ICON: Record<string, string> = {
  issues_reported:        "⚠️",
  issues_resolved:        "🔧",
  checklists_completed:   "✅",
  checklist_streak_days:  "🔥",
  audit_perfect_score:    "🏆",
  audit_score_improvement:"📈",
  training_completed:     "🎓",
  training_perfect_score: "⭐",
  attendance_streak_days: "📅",
  tasks_completed:        "📋",
  points_total:           "💎",
  manual:                 "🏅",
};

const TEMPLATE_BADGE_GROUPS: TemplateBadgeGroup[] = [
  {
    group: "Safety & Issues",
    badges: [
      { name: "First Responder",  icon: "🚨", description: "First issue reported",           criteria_type: "issues_reported",        criteria_value: 1,  points_awarded: 50  },
      { name: "Safety Spotter",   icon: "👀", description: "10 issues reported",             criteria_type: "issues_reported",        criteria_value: 10, points_awarded: 100 },
      { name: "Safety Champion",  icon: "⭐", description: "50 issues reported",             criteria_type: "issues_reported",        criteria_value: 50, points_awarded: 500 },
      { name: "Problem Solver",   icon: "🔧", description: "10 issues resolved",             criteria_type: "issues_resolved",        criteria_value: 10, points_awarded: 250 },
      { name: "Quick Fix",        icon: "⚡", description: "25 issues resolved",             criteria_type: "issues_resolved",        criteria_value: 25, points_awarded: 400 },
    ],
  },
  {
    group: "Checklists",
    badges: [
      { name: "On It",            icon: "✅", description: "First checklist completed",      criteria_type: "checklists_completed",   criteria_value: 1,   points_awarded: 25  },
      { name: "Consistent",       icon: "🔥", description: "7-day checklist streak",         criteria_type: "checklist_streak_days",  criteria_value: 7,   points_awarded: 150 },
      { name: "Reliable",         icon: "💪", description: "30-day checklist streak",        criteria_type: "checklist_streak_days",  criteria_value: 30,  points_awarded: 500 },
      { name: "Operations Star",  icon: "🌟", description: "100 checklists completed",       criteria_type: "checklists_completed",   criteria_value: 100, points_awarded: 300 },
    ],
  },
  {
    group: "Audits",
    badges: [
      { name: "Perfect Score",    icon: "🏆", description: "First perfect audit score",      criteria_type: "audit_perfect_score",    criteria_value: 1, points_awarded: 300 },
      { name: "No Findings",      icon: "🎯", description: "5 perfect audit scores",         criteria_type: "audit_perfect_score",    criteria_value: 5, points_awarded: 600 },
    ],
  },
  {
    group: "Tasks",
    badges: [
      { name: "Gets Things Done", icon: "📋", description: "10 tasks completed",             criteria_type: "tasks_completed",        criteria_value: 10, points_awarded: 150 },
      { name: "Task Master",      icon: "🎯", description: "50 tasks completed",             criteria_type: "tasks_completed",        criteria_value: 50, points_awarded: 400 },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls =
  "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full";

const CRITERIA_TYPES = [
  { value: "issues_reported",        label: "Issues Reported" },
  { value: "issues_resolved",        label: "Issues Resolved" },
  { value: "checklist_streak_days",  label: "Checklist Streak Days" },
  { value: "checklists_completed",   label: "Checklists Completed" },
  { value: "audit_perfect_score",    label: "Audit Perfect Score" },
  { value: "audit_score_improvement",label: "Audit Score Improvement" },
  { value: "training_completed",     label: "Training Completed" },
  { value: "training_perfect_score", label: "Training Perfect Score" },
  { value: "attendance_streak_days", label: "Attendance Streak Days" },
  { value: "tasks_completed",        label: "Tasks Completed" },
  { value: "points_total",           label: "Points Total" },
  { value: "manual",                 label: "Manual (award only)" },
];

const CRITERIA_WINDOWS = [
  { value: "all_time",         label: "All time" },
  { value: "rolling_30_days",  label: "Rolling 30 days" },
  { value: "rolling_7_days",   label: "Rolling 7 days" },
];

// Maps each criteria_type to the same category labels used in TEMPLATE_BADGE_GROUPS
const CRITERIA_CATEGORY: Record<string, string> = {
  issues_reported:        "Safety & Issues",
  issues_resolved:        "Safety & Issues",
  checklists_completed:   "Checklists",
  checklist_streak_days:  "Checklists",
  audit_perfect_score:    "Audits",
  audit_score_improvement:"Audits",
  training_completed:     "Training",
  training_perfect_score: "Training",
  attendance_streak_days: "Attendance",
  attendance_punctuality: "Attendance",
  tasks_completed:        "Tasks",
  points_total:           "Tasks",
  manual:                 "Manual",
};

// Ordered category list so groups always appear in a consistent sequence
const CATEGORY_ORDER = [
  "Safety & Issues",
  "Checklists",
  "Audits",
  "Training",
  "Attendance",
  "Tasks",
  "Manual",
];

function criteriaLabel(type: string, value?: number, window?: string): string {
  const labels: Record<string, string> = {
    issues_reported:         `Report ${value ?? "?"} issue${value !== 1 ? "s" : ""}`,
    issues_resolved:         `Resolve ${value ?? "?"} issue${value !== 1 ? "s" : ""}`,
    checklist_streak_days:   `${value ?? "?"}-day checklist streak`,
    checklists_completed:    `Complete ${value ?? "?"} checklist${value !== 1 ? "s" : ""}`,
    audit_perfect_score:     `${value ?? "?"} perfect audit score${value !== 1 ? "s" : ""}`,
    audit_score_improvement: `Improve audit score ${value ?? "?"} times`,
    training_completed:      `Complete ${value ?? "?"} training${value !== 1 ? "s" : ""}`,
    training_perfect_score:  `${value ?? "?"} perfect training score${value !== 1 ? "s" : ""}`,
    attendance_streak_days:  `${value ?? "?"}-day attendance streak`,
    tasks_completed:         `Complete ${value ?? "?"} task${value !== 1 ? "s" : ""}`,
    points_total:            `Reach ${value ?? "?"} total points`,
    manual:                  "Manual award only",
  };
  const base = labels[type] ?? type;
  if (window && window !== "all_time")
    return `${base} (${window.replace("rolling_", "").replace("_", " ")})`;
  return base;
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-dark">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── CreateBadgeModal ──────────────────────────────────────────────────────────

function CreateBadgeModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    icon: "",
    points_awarded: "0",
    criteria_type: "issues_reported",
    criteria_value: "",
    criteria_window: "all_time",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.name.trim()) {
      setError("Badge name is required.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await createBadgeConfig({
        name: form.name.trim(),
        description: form.description || undefined,
        icon: form.icon || undefined,
        points_awarded: Number(form.points_awarded) || 0,
        criteria_type: form.criteria_type,
        criteria_value:
          form.criteria_type !== "manual" && form.criteria_value
            ? Number(form.criteria_value)
            : undefined,
        criteria_window: form.criteria_window,
      });
      onSuccess();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-dark">Create Badge</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Badge Name *">
            <input
              className={inputCls}
              value={form.name}
              onChange={set("name")}
              placeholder="Safety Champion"
            />
          </Field>
          <Field label="Icon (emoji)">
            <input
              className={inputCls}
              value={form.icon}
              onChange={set("icon")}
              placeholder="🏆"
            />
          </Field>
          <Field label="Description">
            <textarea
              className={clsx(inputCls, "resize-none")}
              rows={2}
              value={form.description}
              onChange={set("description")}
              placeholder="Awarded to staff who…"
            />
          </Field>
          <Field label="Criteria Type">
            <select
              className={clsx(inputCls, "bg-white")}
              value={form.criteria_type}
              onChange={set("criteria_type")}
            >
              {CRITERIA_TYPES.map((ct) => (
                <option key={ct.value} value={ct.value}>
                  {ct.label}
                </option>
              ))}
            </select>
          </Field>
          {form.criteria_type !== "manual" && (
            <Field label="Criteria Value">
              <input
                className={inputCls}
                type="number"
                min={1}
                value={form.criteria_value}
                onChange={set("criteria_value")}
                placeholder="e.g. 10"
              />
            </Field>
          )}
          <Field label="Criteria Window">
            <select
              className={clsx(inputCls, "bg-white")}
              value={form.criteria_window}
              onChange={set("criteria_window")}
            >
              {CRITERIA_WINDOWS.map((cw) => (
                <option key={cw.value} value={cw.value}>
                  {cw.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Points Awarded">
            <input
              className={inputCls}
              type="number"
              min={0}
              value={form.points_awarded}
              onChange={set("points_awarded")}
            />
          </Field>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-60"
            >
              {loading ? "Creating…" : "Create Badge"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── AwardBadgeModal ───────────────────────────────────────────────────────────

function AwardBadgeModal({
  badge,
  onClose,
  onSuccess,
}: {
  badge: BadgeConfig;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listUsers({ page_size: 200 })
      .then((res) => setUsers(res.items ?? []))
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, []);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!selectedUserId) {
      setError("Please select a user.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await awardBadge(badge.id, selectedUserId);
      onSuccess();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{badge.icon ?? "🏅"}</span>
          <div>
            <h2 className="text-lg font-semibold text-dark">Award Badge</h2>
            <p className="text-sm text-dark-secondary">{badge.name}</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Award to *">
            {usersLoading ? (
              <div className="flex items-center gap-2 text-sm text-dark-secondary py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading users…
              </div>
            ) : (
              <select
                className={clsx(inputCls, "bg-white")}
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                <option value="">Select a user…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Note (optional)">
            <textarea
              className={clsx(inputCls, "resize-none")}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Great work on…"
            />
          </Field>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || usersLoading || !selectedUserId}
              className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-60 flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Awarding…
                </>
              ) : (
                <>
                  <Gift className="w-4 h-4" /> Award Badge
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── GenerateBadgesModal ───────────────────────────────────────────────────────

interface GeneratedBadge {
  name: string;
  icon: string;
  description: string;
  criteria_type: string;
  criteria_value: number;
  criteria_window?: string;
  points_awarded: number;
}

function GenerateBadgesModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<GeneratedBadge[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError("Please describe the behaviours or achievements you want to reward.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const { apiFetch } = await import("@/services/api/client");
      const result = await apiFetch<{ badges: GeneratedBadge[] }>(
        "/api/v1/ai/generate-badges",
        { method: "POST", body: JSON.stringify({ prompt: prompt.trim() }) }
      );
      setSuggestions(result.badges);
      setSelected(new Set(result.badges.map((_, i) => i)));
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("overloaded") || msg.includes("529") || msg.includes("temporarily")) {
        setError("The AI service is temporarily busy. Wait a few seconds and try again.");
      } else if (msg.includes("rate limit") || msg.includes("429")) {
        setError("AI rate limit reached. Please wait a moment and try again.");
      } else {
        setError(friendlyError(e));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSelected = async () => {
    if (!suggestions) return;
    setCreateError("");
    setCreating(true);
    try {
      for (const idx of Array.from(selected)) {
        const badge = suggestions[idx];
        await createBadgeConfig({
          name: badge.name,
          icon: badge.icon || undefined,
          description: badge.description || undefined,
          criteria_type: badge.criteria_type,
          criteria_value:
            badge.criteria_type !== "manual" ? badge.criteria_value : undefined,
          criteria_window: badge.criteria_window ?? "all_time",
          points_awarded: badge.points_awarded,
        });
      }
      onCreated();
    } catch (e) {
      setCreateError(friendlyError(e));
    } finally {
      setCreating(false);
    }
  };

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-sprout-purple" />
          <h2 className="text-lg font-semibold bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate Badges with Sidekick</h2>
        </div>

        {!suggestions ? (
          <>
            <p className="text-sm text-dark-secondary">
              Describe the behaviours or achievements you want to reward and Claude will suggest badges.
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-dark">
                Describe behaviours or achievements to reward *
              </label>
              <textarea
                className={clsx(inputCls, "resize-none")}
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. We want to reward staff who report safety hazards, resolve issues quickly, and maintain long incident-free streaks"
                disabled={loading}
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading || !prompt.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" /> Generate
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-dark-secondary">
              Select the badges you want to create, then click &ldquo;Create Selected&rdquo;.
            </p>
            <div className="flex flex-col gap-2">
              {suggestions.map((badge, idx) => (
                <label
                  key={idx}
                  className={clsx(
                    "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
                    selected.has(idx)
                      ? "border-sprout-purple bg-sprout-purple/5"
                      : "border-surface-border hover:bg-gray-50"
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-sprout-purple"
                    checked={selected.has(idx)}
                    onChange={() => toggleSelect(idx)}
                  />
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="text-xl shrink-0">{badge.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-dark">{badge.name}</span>
                        <span className="text-xs bg-sprout-green/10 text-sprout-green rounded-full px-2 py-0.5 font-semibold shrink-0">
                          {badge.points_awarded} pts
                        </span>
                      </div>
                      {badge.description && (
                        <p className="text-xs text-dark-secondary mt-0.5">{badge.description}</p>
                      )}
                      <p className="text-xs text-dark-secondary/70 mt-0.5">
                        {criteriaLabel(
                          badge.criteria_type,
                          badge.criteria_value,
                          badge.criteria_window
                        )}
                      </p>
                    </div>
                  </div>
                </label>
              ))}
            </div>
            {createError && <p className="text-xs text-red-500">{createError}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={creating}
                className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateSelected}
                disabled={creating || selected.size === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Creating…
                  </>
                ) : (
                  `Create Selected (${selected.size})`
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── LoadTemplateModal ─────────────────────────────────────────────────────────

type TemplateBadge = (typeof TEMPLATE_BADGE_GROUPS)[number]["badges"][number];

function LoadTemplateModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  // Build a flat key "group::name" for each template badge
  const allKeys = TEMPLATE_BADGE_GROUPS.flatMap((g) =>
    g.badges.map((b) => `${g.group}::${b.name}`)
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(allKeys));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggleBadge = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (group: string, badges: readonly TemplateBadge[]) => {
    const groupKeys = badges.map((b) => `${group}::${b.name}`);
    const allSelected = groupKeys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        groupKeys.forEach((k) => next.delete(k));
      } else {
        groupKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const handleLoad = async () => {
    if (selected.size === 0) return;
    setError("");
    setLoading(true);
    const toCreate: TemplateBadge[] = TEMPLATE_BADGE_GROUPS.flatMap((g) =>
      g.badges.filter((b) => selected.has(`${g.group}::${b.name}`))
    );
    for (const badge of toCreate) {
      try {
        await createBadgeConfig({
          name: badge.name,
          icon: badge.icon,
          description: badge.description,
          criteria_type: badge.criteria_type,
          criteria_value: badge.criteria_value,
          criteria_window: "all_time",
          points_awarded: badge.points_awarded,
        });
      } catch {
        // skip badges that already exist or fail, continue with others
      }
    }
    setLoading(false);
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-sprout-purple" />
          <h2 className="text-lg font-semibold text-dark">Load Badge Templates</h2>
        </div>
        <p className="text-sm text-dark-secondary">
          Select the templates you want to create. Badges with the same name that already exist will be skipped.
        </p>

        <div className="flex flex-col gap-4">
          {TEMPLATE_BADGE_GROUPS.map((group) => {
            const groupKeys = group.badges.map((b) => `${group.group}::${b.name}`);
            const allGroupSelected = groupKeys.every((k) => selected.has(k));
            const someGroupSelected = groupKeys.some((k) => selected.has(k));
            return (
              <div key={group.group}>
                {/* Group header with select-all checkbox */}
                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-sprout-purple"
                    checked={allGroupSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someGroupSelected && !allGroupSelected;
                    }}
                    onChange={() => toggleGroup(group.group, group.badges)}
                  />
                  <span className="text-xs font-semibold text-dark-secondary uppercase tracking-wide">
                    {group.group}
                  </span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-1">
                  {group.badges.map((badge) => {
                    const key = `${group.group}::${badge.name}`;
                    const isSelected = selected.has(key);
                    const colors = CAT_COLORS[group.group] ?? CAT_COLORS["Manual"];
                    return (
                      <label
                        key={key}
                        className={clsx(
                          "relative flex flex-col rounded-xl border cursor-pointer transition-all overflow-hidden",
                          isSelected
                            ? "border-sprout-purple shadow-sm shadow-sprout-purple/10"
                            : "border-surface-border hover:border-gray-300"
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={isSelected}
                          onChange={() => toggleBadge(key)}
                        />
                        {/* Mini colour header */}
                        <div className={clsx("px-3 py-2.5 flex items-center justify-between", colors.header)}>
                          <span className="text-2xl leading-none select-none">{badge.icon}</span>
                          <span className={clsx("text-[10px] font-bold rounded-full px-2 py-0.5 bg-white/80", colors.pillText)}>
                            +{badge.points_awarded} pts
                          </span>
                        </div>
                        {/* Body */}
                        <div className={clsx(
                          "px-3 py-2 flex-1 transition-colors",
                          isSelected ? "bg-sprout-purple/5" : "bg-white"
                        )}>
                          <p className="text-xs font-semibold text-dark leading-snug">{badge.name}</p>
                          <p className="text-[10px] text-dark-secondary mt-0.5 line-clamp-1">{badge.description}</p>
                          <p className="text-[10px] text-dark-secondary/60 mt-0.5">
                            {criteriaLabel(badge.criteria_type, badge.criteria_value)}
                          </p>
                        </div>
                        {/* Selected check mark */}
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-sprout-purple flex items-center justify-center">
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex items-center justify-between pt-2 border-t border-surface-border">
          <p className="text-xs text-dark-secondary">{selected.size} of {allKeys.length} selected</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLoad}
              disabled={loading || selected.size === 0}
              className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-60 flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </>
              ) : (
                `Load Selected (${selected.size})`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Category accent colours ───────────────────────────────────────────────────

const CAT_COLORS: Record<string, { header: string; pill: string; pillText: string }> = {
  "Safety & Issues": { header: "bg-red-50",    pill: "bg-red-100 text-red-700",    pillText: "text-red-600"   },
  "Checklists":      { header: "bg-green-50",  pill: "bg-green-100 text-green-700",pillText: "text-green-600" },
  "Audits":          { header: "bg-blue-50",   pill: "bg-blue-100 text-blue-700",  pillText: "text-blue-600"  },
  "Tasks":           { header: "bg-amber-50",  pill: "bg-amber-100 text-amber-700",pillText: "text-amber-600" },
  "Training":        { header: "bg-violet-50", pill: "bg-violet-100 text-violet-700", pillText: "text-violet-600" },
  "Attendance":      { header: "bg-teal-50",   pill: "bg-teal-100 text-teal-700",  pillText: "text-teal-600"  },
  "Manual":          { header: "bg-gray-50",   pill: "bg-gray-100 text-gray-600",  pillText: "text-gray-500"  },
};

// ── BadgeCard ─────────────────────────────────────────────────────────────────

function BadgeCard({
  badge,
  isAdmin,
  isManager,
  deletingId,
  deleteError,
  onDeleteStart,
  onDeleteConfirm,
  onDeleteCancel,
  onAward,
  onEdit,
  highlighted,
}: {
  badge: BadgeConfig;
  isAdmin: boolean;
  isManager: boolean;
  deletingId: string | null;
  deleteError: Record<string, string>;
  onDeleteStart: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: (id: string) => void;
  onAward: (badge: BadgeConfig) => void;
  onEdit?: (badge: BadgeConfig) => void;
  highlighted?: boolean;
}) {
  const cat = CRITERIA_CATEGORY[badge.criteria_type] ?? "Manual";
  const colors = CAT_COLORS[cat] ?? CAT_COLORS["Manual"];

  return (
    <div className={clsx("rounded-2xl border overflow-hidden flex flex-col transition-colors duration-700", highlighted ? "bg-violet-50 border-violet-200 shadow-sm" : "bg-white border-surface-border")}>
      {/* Coloured header — icon + pts */}
      <div className={clsx("px-4 py-5 flex items-start justify-between gap-3", colors.header)}>
        <span className="text-4xl leading-none select-none drop-shadow-sm">{badge.icon ?? "🏅"}</span>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {badge.is_template && (
            <span className="text-[10px] font-semibold uppercase tracking-widest text-dark-secondary/60 bg-white/70 rounded-full px-2 py-0.5">
              Template
            </span>
          )}
          <span className={clsx("text-xs font-bold rounded-full px-2.5 py-1 bg-white/80", colors.pillText)}>
            +{badge.points_awarded} pts
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div>
          <p className="font-semibold text-dark text-sm leading-snug">{badge.name}</p>
          {badge.description && (
            <p className="text-xs text-dark-secondary mt-1 line-clamp-2">{badge.description}</p>
          )}
        </div>

        {/* Category + criteria */}
        <div className="flex flex-col gap-1">
          <span className={clsx("self-start text-[10px] font-semibold rounded-full px-2 py-0.5", colors.pill)}>
            {cat}
          </span>
          <p className="text-[11px] text-dark-secondary">
            {criteriaLabel(badge.criteria_type, badge.criteria_value, badge.criteria_window)}
          </p>
        </div>

        {/* Actions */}
        {(isAdmin || (isManager && !isAdmin)) && (
          <div className="mt-auto pt-1 flex flex-col gap-1.5">
            {isAdmin && onEdit && deletingId !== badge.id && (
              <button
                onClick={() => onEdit(badge)}
                className="flex items-center gap-1.5 text-xs font-medium text-dark/60 hover:text-dark border border-surface-border rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors w-full justify-center"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            {isAdmin && (
              deletingId === badge.id ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-dark-secondary">Delete this badge?</p>
                  {deleteError[badge.id] && (
                    <p className="text-xs text-red-500">{deleteError[badge.id]}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => onDeleteConfirm(badge.id)}
                      className="flex-1 text-xs font-medium bg-red-500 text-white rounded-lg px-3 py-1.5 hover:bg-red-600"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => onDeleteCancel(badge.id)}
                      className="flex-1 text-xs font-medium border border-surface-border rounded-lg px-3 py-1.5 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => onDeleteStart(badge.id)}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50 transition-colors w-full justify-center"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )
            )}
            {isManager && !isAdmin && (
              <button
                onClick={() => onAward(badge)}
                className="flex items-center gap-1.5 text-xs font-semibold text-sprout-purple border border-sprout-purple/30 rounded-lg px-3 py-1.5 hover:bg-sprout-purple/5 transition-colors w-full justify-center"
              >
                <Gift className="w-3.5 h-3.5" /> Award Badge
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BadgesSettingsPage() {
  const router = useRouter();
  const [badges, setBadges] = useState<BadgeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [badgeModalMode, setBadgeModalMode] = useState<"select" | "template" | "ai" | "blank">("select");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [awardingBadge, setAwardingBadge] = useState<BadgeConfig | null>(null);
  const [editingBadge, setEditingBadge] = useState<BadgeConfig | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  const loadBadges = async () => {
    setLoading(true);
    try {
      const res = await listBadgeConfigs();
      setBadges(res);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        const role = data.session?.user?.app_metadata?.role as string | undefined;
        const admin = role === "admin" || role === "super_admin";
        const manager = role === "manager";
        setIsAdmin(admin);
        setIsManager(manager);
        if (!admin && !manager) {
          router.replace("/dashboard");
        }
      });
    loadBadges();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (badgeId: string) => {
    setDeleteError((prev) => ({ ...prev, [badgeId]: "" }));
    try {
      await deleteBadgeConfig(badgeId);
      setDeletingId(null);
      loadBadges();
    } catch (e) {
      setDeleteError((prev) => ({ ...prev, [badgeId]: friendlyError(e) }));
    }
  };

  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <Link
            href="/dashboard/settings"
            className="flex items-center gap-1 text-sm text-dark-secondary hover:text-dark transition-colors mb-2"
          >
            <ChevronLeft className="w-4 h-4" /> Settings
          </Link>
          <div className="flex items-center gap-3">
            <Medal className="w-6 h-6 text-sprout-purple" />
            <div>
              <h1 className="text-2xl font-bold text-dark">Badges</h1>
              <p className="text-sm text-dark-secondary mt-0.5">
                {loading ? "Loading…" : `${badges.length} badge${badges.length !== 1 ? "s" : ""} configured`}
              </p>
            </div>
          </div>
        </div>

        {isAdmin && (
          <button
            onClick={() => { setBadgeModalMode("select"); setShowNewModal(true); }}
            className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Badge</span>
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Badge grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-surface-border p-4 animate-pulse h-40" />
          ))}
        </div>
      ) : badges.length === 0 ? (
        <div className="bg-white rounded-2xl border border-surface-border p-10 flex flex-col items-center gap-6">
          <div className="text-center">
            <h3 className="text-base font-semibold text-dark">No badges configured yet</h3>
            <p className="text-sm text-dark-secondary mt-1">How would you like to add badges?</p>
          </div>
          {isAdmin && (
            <div className="grid grid-cols-3 gap-3 w-full max-w-md">
              {([
                { mode: "template" as const, icon: <Layers className="w-5 h-5 text-blue-600" />, bg: "bg-blue-50", label: "From a Template", sub: "Pick from preset badge packs" },
                { mode: "ai" as const,       icon: <Sparkles className="w-5 h-5 text-sprout-purple" />, bg: "bg-gradient-to-br from-violet-100 to-purple-100", label: "Generate with Sidekick", sub: "Describe behaviours to reward" },
                { mode: "blank" as const,    icon: <Plus className="w-5 h-5 text-green-600" />, bg: "bg-green-50", label: "Create Manually", sub: "Set every field yourself" },
              ]).map(({ mode, icon, bg, label, sub }) => (
                <button key={mode}
                  onClick={() => { setBadgeModalMode(mode); setShowNewModal(true); }}
                  className={`flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 hover:shadow-sm transition-all ${mode === "ai" ? "border-transparent" : "border-surface-border hover:border-sprout-purple"}`}
                  style={mode === "ai" ? { background: 'linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box' } : undefined}>
                  <div className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center`}>{icon}</div>
                  <div>
                    <p className={`font-semibold text-xs ${mode === "ai" ? "bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent" : "text-dark"}`}>{label}</p>
                    <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">{sub}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {CATEGORY_ORDER.filter((cat) =>
            badges.some((b) => (CRITERIA_CATEGORY[b.criteria_type] ?? "Manual") === cat)
          ).map((cat) => {
            const catBadges = badges.filter(
              (b) => (CRITERIA_CATEGORY[b.criteria_type] ?? "Manual") === cat,
            );
            return (
              <div key={cat}>
                <h3 className="text-xs font-semibold text-dark-secondary uppercase tracking-wide mb-3">
                  {cat}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {catBadges.map((badge) => (
                    <BadgeCard
                      key={badge.id}
                      badge={badge}
                      isAdmin={isAdmin}
                      isManager={isManager}
                      deletingId={deletingId}
                      deleteError={deleteError}
                      onDeleteStart={setDeletingId}
                      onDeleteConfirm={handleDelete}
                      onDeleteCancel={(id) => {
                        setDeletingId(null);
                        setDeleteError((prev) => ({ ...prev, [id]: "" }));
                      }}
                      onAward={setAwardingBadge}
                      onEdit={setEditingBadge}
                      highlighted={justCreatedId === badge.id}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {showNewModal && (
        <NewBadgeModal
          initialMode={badgeModalMode}
          onClose={() => setShowNewModal(false)}
          onSuccess={(id) => { setShowNewModal(false); if (id) { setJustCreatedId(id); setTimeout(() => setJustCreatedId(null), 4000); } loadBadges(); }}
        />
      )}
      {awardingBadge && (
        <AwardBadgeModal
          badge={awardingBadge}
          onClose={() => setAwardingBadge(null)}
          onSuccess={() => {
            setAwardingBadge(null);
          }}
        />
      )}
      {editingBadge && (
        <EditBadgeModal
          badge={editingBadge}
          onClose={() => setEditingBadge(null)}
          onSuccess={() => { setEditingBadge(null); loadBadges(); }}
        />
      )}
    </div>
  );
}

// ── NewBadgeModal ─────────────────────────────────────────────────────────────

function NewBadgeModal({ onClose, onSuccess, initialMode = "select" }: { onClose: () => void; onSuccess: (id?: string) => void; initialMode?: "select" | "template" | "ai" | "blank" }) {
  const [mode, setMode] = useState<"select" | "template" | "ai" | "blank">(initialMode);

  function goBack() { setMode("select"); }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-border sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            {mode !== "select" && (
              <button onClick={goBack} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <ArrowLeft className="w-4 h-4 text-dark/60" />
              </button>
            )}
            <h2 className="text-base font-bold text-dark">New Badge</h2>
          </div>
          <button onClick={onClose} className="text-dark/40 hover:text-dark text-2xl leading-none">&times;</button>
        </div>

        {/* Selection cards */}
        {mode === "select" && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-dark/60">How would you like to add badges?</p>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setMode("template")}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-surface-border hover:border-sprout-purple hover:shadow-sm transition-all">
                <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Layers className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-dark text-xs">From a Template</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Pick from preset badge packs</p>
                </div>
              </button>
              <button
                onClick={() => setMode("ai")}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-transparent hover:shadow-sm transition-all"
                style={{ background: 'linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box' }}>
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-sprout-purple" />
                </div>
                <div>
                  <p className="font-semibold text-xs bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate with Sidekick</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Describe behaviours to reward</p>
                </div>
              </button>
              <button
                onClick={() => setMode("blank")}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-surface-border hover:border-sprout-purple hover:shadow-sm transition-all">
                <div className="w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center text-2xl">➕</div>
                <div>
                  <p className="font-semibold text-dark text-xs">Create Manually</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Set every field yourself</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {mode === "template" && <BadgeTemplateSubView onSuccess={() => onSuccess()} />}
        {mode === "ai" && <BadgeAiSubView onSuccess={() => onSuccess()} />}
        {mode === "blank" && <BadgeBlankSubView onSuccess={onSuccess} />}
      </div>
    </div>
  );
}

function BadgeTemplateSubView({ onSuccess }: { onSuccess: () => void }) {
  const [groups, setGroups] = useState<TemplateBadgeGroup[]>(TEMPLATE_BADGE_GROUPS);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(TEMPLATE_BADGE_GROUPS.flatMap((g) => g.badges.map((b) => `${g.group}::${b.name}`)))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch industry-specific badge templates; fall back to generic if none
  useEffect(() => {
    getPackageTemplates("badge").then((res) => {
      if (!res.items.length) return;
      const apiGroups: TemplateBadgeGroup[] = [
        {
          group: "Industry Badges",
          badges: res.items.map((item) => {
            const c = item.content as Record<string, unknown>;
            return {
              name: item.name,
              icon: CRITERIA_ICON[(c.criteria_type as string) ?? ""] ?? "🏅",
              description: (c.description as string) || item.description,
              criteria_type: (c.criteria_type as string) ?? "manual",
              criteria_value: (c.threshold as number) ?? 1,
              points_awarded: (c.points_awarded as number) ?? 0,
            };
          }),
        },
      ];
      setGroups(apiGroups);
      setSelected(new Set(apiGroups[0].badges.map((b) => `Industry Badges::${b.name}`)));
    }).catch(() => {});
  }, []);

  const allKeys = groups.flatMap((g) => g.badges.map((b) => `${g.group}::${b.name}`));

  const toggleBadge = (key: string) =>
    setSelected((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  const toggleGroup = (group: string, badges: TemplateBadgeEntry[]) => {
    const keys = badges.map((b) => `${group}::${b.name}`);
    const allSel = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => allSel ? next.delete(k) : next.add(k));
      return next;
    });
  };

  const handleLoad = async () => {
    if (!selected.size) return;
    setError(""); setLoading(true);
    const toCreate = groups.flatMap((g) => g.badges.filter((b) => selected.has(`${g.group}::${b.name}`)));
    for (const badge of toCreate) {
      try { await createBadgeConfig({ name: badge.name, icon: badge.icon, description: badge.description, criteria_type: badge.criteria_type, criteria_value: badge.criteria_value, criteria_window: "all_time", points_awarded: badge.points_awarded }); }
      catch { /* skip duplicates */ }
    }
    setLoading(false);
    onSuccess();
  };

  return (
    <div className="p-5 flex flex-col gap-4">
      <p className="text-sm text-dark-secondary">Select the badges you want to create. Badges that already exist will be skipped.</p>
      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          const groupKeys = group.badges.map((b) => `${group.group}::${b.name}`);
          const allGroupSel = groupKeys.every((k) => selected.has(k));
          const someGroupSel = groupKeys.some((k) => selected.has(k));
          return (
            <div key={group.group}>
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input type="checkbox" className="accent-sprout-purple" checked={allGroupSel}
                  ref={(el) => { if (el) el.indeterminate = someGroupSel && !allGroupSel; }}
                  onChange={() => toggleGroup(group.group, group.badges)} />
                <span className="text-xs font-semibold text-dark-secondary uppercase tracking-wide">{group.group}</span>
              </label>
              <div className="grid grid-cols-2 gap-2 pl-1">
                {group.badges.map((badge) => {
                  const key = `${group.group}::${badge.name}`;
                  const isSel = selected.has(key);
                  const colors = CAT_COLORS[group.group] ?? CAT_COLORS["Manual"];
                  return (
                    <label key={key} className={`relative flex flex-col rounded-xl border cursor-pointer transition-all overflow-hidden ${isSel ? "border-sprout-purple shadow-sm" : "border-surface-border hover:border-gray-300"}`}>
                      <input type="checkbox" className="sr-only" checked={isSel} onChange={() => toggleBadge(key)} />
                      <div className={`px-3 py-2.5 flex items-center justify-between ${colors.header}`}>
                        <span className="text-2xl leading-none">{badge.icon}</span>
                        <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 bg-white/80 ${colors.pillText}`}>+{badge.points_awarded} pts</span>
                      </div>
                      <div className={`px-3 py-2 flex-1 ${isSel ? "bg-sprout-purple/5" : "bg-white"}`}>
                        <p className="text-xs font-semibold text-dark">{badge.name}</p>
                        <p className="text-[10px] text-dark-secondary mt-0.5 line-clamp-1">{badge.description}</p>
                      </div>
                      {isSel && (
                        <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-sprout-purple flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center justify-between pt-2 border-t border-surface-border">
        <p className="text-xs text-dark-secondary">{selected.size} of {allKeys.length} selected</p>
        <button onClick={handleLoad} disabled={loading || !selected.size}
          className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-60 flex items-center gap-2">
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</> : `Load Selected (${selected.size})`}
        </button>
      </div>
    </div>
  );
}

function BadgeAiSubView({ onSuccess }: { onSuccess: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<GeneratedBadge[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) { setError("Please describe the behaviours or achievements you want to reward."); return; }
    setError(""); setLoading(true);
    try {
      const { apiFetch } = await import("@/services/api/client");
      const result = await apiFetch<{ badges: GeneratedBadge[] }>("/api/v1/ai/generate-badges", { method: "POST", body: JSON.stringify({ prompt: prompt.trim() }) });
      setSuggestions(result.badges);
      setSelected(new Set(result.badges.map((_, i) => i)));
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    if (!suggestions) return;
    setCreateError(""); setCreating(true);
    try {
      for (const idx of Array.from(selected)) {
        const b = suggestions[idx];
        await createBadgeConfig({ name: b.name, icon: b.icon || undefined, description: b.description || undefined, criteria_type: b.criteria_type, criteria_value: b.criteria_type !== "manual" ? b.criteria_value : undefined, criteria_window: b.criteria_window ?? "all_time", points_awarded: b.points_awarded });
      }
      onSuccess();
    } catch (e) { setCreateError(friendlyError(e)); }
    finally { setCreating(false); }
  };

  const toggle = (i: number) => setSelected((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <div className="p-5 flex flex-col gap-4">
      {!suggestions ? (
        <>
          <p className="text-sm text-dark-secondary">Describe the behaviours or achievements you want to reward and Claude will suggest badges.</p>
          <textarea className={`${inputCls} resize-none`} rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. We want to reward staff who report safety hazards, resolve issues quickly, and maintain long incident-free streaks" disabled={loading} />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end">
            <button onClick={handleGenerate} disabled={loading || !prompt.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> Generate</>}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-dark-secondary">Select the badges you want to create.</p>
          <div className="flex flex-col gap-2">
            {suggestions.map((badge, idx) => (
              <label key={idx} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${selected.has(idx) ? "border-sprout-purple bg-sprout-purple/5" : "border-surface-border hover:bg-gray-50"}`}>
                <input type="checkbox" className="mt-0.5 accent-sprout-purple" checked={selected.has(idx)} onChange={() => toggle(idx)} />
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="text-xl shrink-0">{badge.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-dark">{badge.name}</span>
                      <span className="text-xs bg-sprout-green/10 text-sprout-green rounded-full px-2 py-0.5 font-semibold">{badge.points_awarded} pts</span>
                    </div>
                    {badge.description && <p className="text-xs text-dark-secondary mt-0.5">{badge.description}</p>}
                    <p className="text-xs text-dark-secondary/70 mt-0.5">{criteriaLabel(badge.criteria_type, badge.criteria_value, badge.criteria_window)}</p>
                  </div>
                </div>
              </label>
            ))}
          </div>
          {createError && <p className="text-xs text-red-500">{createError}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setSuggestions(null)} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">Regenerate</button>
            <button onClick={handleCreate} disabled={creating || !selected.size}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : `Create Selected (${selected.size})`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function BadgeBlankSubView({ onSuccess }: { onSuccess: (id?: string) => void }) {
  const [form, setForm] = useState({ name: "", description: "", icon: "", points_awarded: "0", criteria_type: "issues_reported", criteria_value: "", criteria_window: "all_time" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.name.trim()) { setError("Badge name is required."); return; }
    setError(""); setLoading(true);
    try {
      const created = await createBadgeConfig({ name: form.name.trim(), description: form.description || undefined, icon: form.icon || undefined, criteria_type: form.criteria_type, criteria_value: form.criteria_type !== "manual" && form.criteria_value ? Number(form.criteria_value) : undefined, criteria_window: form.criteria_window, points_awarded: Number(form.points_awarded) || 0 });
      onSuccess(created.id);
    } catch (e) { setError(friendlyError(e)); setLoading(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
      {error && <p className="text-xs text-red-500">{error}</p>}
      <Field label="Badge Name *"><input className={inputCls} value={form.name} onChange={set("name")} placeholder="e.g. Safety Champion" /></Field>
      <Field label="Icon (emoji)"><input className={inputCls} value={form.icon} onChange={set("icon")} placeholder="e.g. 🏆" /></Field>
      <Field label="Description"><input className={inputCls} value={form.description} onChange={set("description")} placeholder="Short description" /></Field>
      <Field label="Criteria Type *">
        <select className={inputCls} value={form.criteria_type} onChange={set("criteria_type")}>
          {CRITERIA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      {form.criteria_type !== "manual" && (
        <Field label="Criteria Value *"><input type="number" className={inputCls} value={form.criteria_value} onChange={set("criteria_value")} placeholder="e.g. 10" min={1} /></Field>
      )}
      <Field label="Criteria Window *">
        <select className={inputCls} value={form.criteria_window} onChange={set("criteria_window")}>
          {CRITERIA_WINDOWS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
        </select>
      </Field>
      <Field label="Points Awarded *"><input type="number" className={inputCls} value={form.points_awarded} onChange={set("points_awarded")} min={0} /></Field>
      <div className="flex justify-end pt-1">
        <button type="submit" disabled={loading}
          className="flex items-center gap-2 px-5 py-2 bg-sprout-purple text-white text-sm font-medium rounded-lg hover:bg-sprout-purple/90 disabled:opacity-60">
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : "Create Badge"}
        </button>
      </div>
    </form>
  );
}

// ── EditBadgeModal ─────────────────────────────────────────────────────────────

function EditBadgeModal({ badge, onClose, onSuccess }: { badge: BadgeConfig; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    name: badge.name,
    description: badge.description ?? "",
    icon: badge.icon ?? "",
    points_awarded: String(badge.points_awarded),
    criteria_type: badge.criteria_type,
    criteria_value: badge.criteria_value != null ? String(badge.criteria_value) : "",
    criteria_window: badge.criteria_window,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.name.trim()) { setError("Badge name is required."); return; }
    setError(""); setLoading(true);
    try {
      await updateBadgeConfig(badge.id, {
        name: form.name.trim(),
        description: form.description || undefined,
        icon: form.icon || undefined,
        criteria_type: form.criteria_type,
        criteria_value: form.criteria_type !== "manual" && form.criteria_value ? Number(form.criteria_value) : undefined,
        criteria_window: form.criteria_window,
        points_awarded: Number(form.points_awarded) || 0,
      });
      onSuccess();
    } catch (e) { setError(friendlyError(e)); setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-surface-border sticky top-0 bg-white z-10">
          <h2 className="text-base font-bold text-dark flex items-center gap-2">
            <Pencil className="w-4 h-4 text-dark/50" /> Edit Badge
          </h2>
          <button onClick={onClose} className="text-dark/40 hover:text-dark text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          {error && <p className="text-xs text-red-500">{error}</p>}
          <Field label="Badge Name *"><input className={inputCls} value={form.name} onChange={set("name")} placeholder="e.g. Safety Champion" /></Field>
          <Field label="Icon (emoji)"><input className={inputCls} value={form.icon} onChange={set("icon")} placeholder="e.g. 🏆" /></Field>
          <Field label="Description"><input className={inputCls} value={form.description} onChange={set("description")} placeholder="Short description" /></Field>
          <Field label="Criteria Type *">
            <select className={inputCls} value={form.criteria_type} onChange={set("criteria_type")}>
              {CRITERIA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          {form.criteria_type !== "manual" && (
            <Field label="Criteria Value *"><input type="number" className={inputCls} value={form.criteria_value} onChange={set("criteria_value")} placeholder="e.g. 10" min={1} /></Field>
          )}
          <Field label="Criteria Window *">
            <select className={inputCls} value={form.criteria_window} onChange={set("criteria_window")}>
              {CRITERIA_WINDOWS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          </Field>
          <Field label="Points Awarded *"><input type="number" className={inputCls} value={form.points_awarded} onChange={set("points_awarded")} min={0} /></Field>
          <div className="flex justify-end pt-1">
            <button type="submit" disabled={loading}
              className="flex items-center gap-2 px-5 py-2 bg-sprout-purple text-white text-sm font-medium rounded-lg hover:bg-sprout-purple/90 disabled:opacity-60">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
