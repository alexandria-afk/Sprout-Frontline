"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  LayoutDashboard,
  ClipboardCheck,
  Megaphone,
  LucideIcon,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  ShieldCheck,
  CheckSquare,
  AlertTriangle,
  ArrowRight,
  MessageSquare,
  Inbox,
  GitBranch,
  TriangleAlert,
  Sparkles,
  RefreshCw,
  GraduationCap,
} from "lucide-react";
import { getDashboardSummary, type DashboardSummary } from "@/services/dashboard";
import { getMyAssignments, type FormAssignment } from "@/services/forms";
import { listAnnouncements } from "@/services/announcements";
import { listCAPs } from "@/services/caps";
import { myTasks, taskSummary, getUnreadTaskCount } from "@/services/tasks";
import { listMyBadges, type BadgeAward } from "@/services/gamification";
import { getMyWorkflowTasks, type WorkflowStageInstance } from "@/services/workflows";
import { listIssues } from "@/services/issues";
import { getMyEnrollments, getLmsAnalytics, type CourseEnrollment, type LmsAnalytics } from "@/services/lms";
import { listShifts } from "@/services/shifts";
import { createClient } from "@/services/supabase/client";
import type { Announcement, Task, TaskSummary, Issue, Shift } from "@/types";
import { AnnouncementCard, proxied } from "@/components/announcements/AnnouncementCard";
import Link from "next/link";

// ── Skeleton ──────────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-surface-border p-6 flex flex-col gap-3 animate-pulse">
      <div className="w-10 h-10 rounded-full bg-gray-200" />
      <div className="h-8 w-20 bg-gray-200 rounded" />
      <div className="h-3 w-28 bg-gray-100 rounded" />
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, icon: Icon, iconBg, iconColor, sub, href,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  sub?: React.ReactNode;
  href?: string;
}) {
  const inner = (
    <div className={clsx(
      "bg-white rounded-xl border border-surface-border p-4 md:p-6 flex flex-col gap-2 md:gap-3",
      href && "hover:border-sprout-purple/40 hover:shadow-sm transition-all cursor-pointer",
    )}>
      <div className={clsx("w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center", iconBg)}>
        <Icon className={clsx("w-4 h-4 md:w-5 md:h-5", iconColor)} />
      </div>
      <p className="text-2xl md:text-3xl font-bold text-dark">{value}</p>
      <p className="text-xs md:text-sm text-dark-secondary">{label}</p>
      {sub}
    </div>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

// ── Priority / Status badge helpers ───────────────────────────────────────────
const PRIORITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high:     "bg-orange-100 text-orange-700",
  medium:   "bg-amber-100 text-amber-700",
  low:      "bg-gray-100 text-gray-600",
};

const STATUS_STYLES: Record<string, string> = {
  pending:     "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-100 text-blue-700",
  completed:   "bg-sprout-green/10 text-sprout-green",
  overdue:     "bg-red-100 text-red-600",
  cancelled:   "bg-gray-100 text-gray-400",
};

// ── Daily Brief by Sidekick ────────────────────────────────────────────────────

interface CachedBrief {
  summary: string;
  generatedAt: string;
}

function briefCacheKey(role: string, orgId: string) {
  return `sidekick_brief_${orgId}_${role}_${new Date().toISOString().slice(0, 10)}`;
}

function DailyBriefCard({ role, name, orgId }: { role: string; name: string; orgId: string }) {
  const [summary, setSummary]     = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [generatedAt, setAt]      = useState("");

  const isStaff   = role === "staff";
  const cacheKey  = briefCacheKey(role, orgId);
  const firstName = name.split(" ")[0] || "there";
  const dateStr   = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  async function generate(force = false) {
    setLoading(true);
    try {
      // ── Try cache first ──────────────────────────────────────────────────────
      if (!force) {
        try {
          const raw = localStorage.getItem(cacheKey);
          if (raw) {
            const cached: CachedBrief = JSON.parse(raw);
            if (typeof cached.summary === "string" && cached.summary.length > 0) {
              setSummary(cached.summary);
              setAt(cached.generatedAt);
              setLoading(false);
              return;
            }
            // Old or invalid cache shape — clear and regenerate
            localStorage.removeItem(cacheKey);
          }
        } catch { /* stale or corrupt — regenerate */ }
      } else {
        localStorage.removeItem(cacheKey);
      }

      // ── Build summary sentence(s) ────────────────────────────────────────────
      let text = "";

      if (isStaff) {
        const today = new Date().toISOString().slice(0, 10);
        const [tasks, assignments] = await Promise.all([
          myTasks().catch(() => [] as Task[]),
          getMyAssignments().catch(() => [] as FormAssignment[]),
        ]);

        const overdueCount  = (tasks as Task[]).filter((t) => t.status === "overdue").length;
        const dueTodayCount = (tasks as Task[]).filter(
          (t) => t.due_at?.startsWith(today) && t.status !== "completed" && t.status !== "cancelled" && t.status !== "overdue"
        ).length;
        const pendingCount  = (assignments as FormAssignment[]).filter((a) => a.is_active !== false).length;

        const parts: string[] = [];
        if (overdueCount > 0)  parts.push(`${overdueCount} overdue task${overdueCount !== 1 ? "s" : ""}`);
        if (dueTodayCount > 0) parts.push(`${dueTodayCount} task${dueTodayCount !== 1 ? "s" : ""} due today`);
        if (pendingCount > 0)  parts.push(`${pendingCount} pending checklist${pendingCount !== 1 ? "s" : ""}`);

        if (parts.length === 0) {
          text = `You're all caught up, ${firstName} — no overdue items or pending checklists. Great work today!`;
        } else {
          text = `You have ${parts.join(", ")} to complete.`;
          if (overdueCount > 0) text += " Prioritize overdue items first.";
        }

      } else {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const [issuesRes, taskSumRes, capsRes, dash30] = await Promise.all([
          listIssues({ status: "open", priority: "critical", page_size: 1 }).catch(() => ({ data: [], total: 0 })),
          taskSummary().catch(() => null),
          listCAPs({ status: "pending_review", page_size: 1 }).catch(() => ({ total_count: 0 })),
          getDashboardSummary({ from: thirtyDaysAgo }).catch(() => null),
        ]);

        const critCount    = (issuesRes as { total: number }).total ?? 0;
        const overdueCount = (taskSumRes as { overdue_count?: number } | null)?.overdue_count ?? 0;
        const capCount     = (capsRes as { total_count?: number }).total_count ?? 0;
        const auditRate    = dash30?.audit_compliance_rate != null
          ? Math.round(dash30.audit_compliance_rate * 100) : null;

        const flags: string[] = [];
        if (critCount > 0)    flags.push(`${critCount} critical open issue${critCount !== 1 ? "s" : ""}`);
        if (overdueCount > 0) flags.push(`${overdueCount} overdue task${overdueCount !== 1 ? "s" : ""}`);
        if (capCount > 0)     flags.push(`${capCount} CAP${capCount !== 1 ? "s" : ""} awaiting review`);

        // Sentence 1: operational state
        if (flags.length === 0) {
          text = "No critical issues, overdue tasks, or pending CAPs — your team is in good shape.";
        } else {
          text = `Your team has ${flags.join(", ")} that need attention.`;
        }

        // Sentence 2: audit compliance
        if (auditRate !== null) {
          const auditSentence =
            auditRate >= 90 ? ` Audit compliance is strong at ${auditRate}% over the last 30 days.` :
            auditRate >= 80 ? ` Audit compliance is on track at ${auditRate}%.` :
            auditRate >= 70 ? ` Audit compliance is at ${auditRate}% — slightly below the 80% target.` :
                              ` Audit compliance is at ${auditRate}%, below the minimum threshold — review recent failures.`;
          text += auditSentence;
        }
      }

      const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ summary: text, generatedAt: at } as CachedBrief));
      } catch { /* storage full — skip cache */ }
      setSummary(text);
      setAt(at);
    } catch {
      setSummary("Brief couldn't load — check your connection and try refreshing.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  return (
    <div
      className="rounded-2xl border-2 border-transparent"
      style={{ background: "linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box" }}
    >
      <div className="px-5 py-4 flex items-start gap-3">
        {/* Icon */}
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-4 h-4 text-violet-600" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="font-bold text-sm bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">
              Your Daily Brief by Sidekick
            </p>
            <p className="text-[11px] text-dark/30 shrink-0">{dateStr}</p>
          </div>

          {loading ? (
            <div className="space-y-1.5 mt-2">
              <div className="h-3.5 w-full bg-gray-100 rounded animate-pulse" />
              <div className="h-3.5 w-3/4 bg-gray-100 rounded animate-pulse" />
            </div>
          ) : (
            <p className="text-sm text-dark/70 leading-relaxed">{summary}</p>
          )}

          <div className="flex items-center justify-between mt-2.5">
            <p className="text-[11px] text-dark/30">
              {generatedAt ? `Generated at ${generatedAt} · refreshes tomorrow` : ""}
            </p>
            <button
              onClick={() => generate(true)}
              disabled={loading}
              className="flex items-center gap-1 text-[11px] font-medium text-violet-500 hover:text-violet-700 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className={clsx("w-3 h-3", loading && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Admin / Manager dashboard ─────────────────────────────────────────────────
function AdminDashboard() {
  const router = useRouter();
  const [todaySummary, setTodaySummary] = useState<DashboardSummary | null>(null);
  const [auditSummary, setAuditSummary] = useState<DashboardSummary | null>(null);
  const [taskSum, setTaskSum] = useState<TaskSummary | null>(null);
  const [unreadTasks, setUnreadTasks] = useState(0);
  const [myBadges, setMyBadges] = useState<BadgeAward[]>([]);
  const [trainingAnalytics, setTrainingAnalytics] = useState<LmsAnalytics | null>(null);
  const [todayShiftsCount, setTodayShiftsCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchAll = () => {
      const today = new Date().toISOString().slice(0, 10);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return Promise.all([
        getDashboardSummary({ from: today, to: today }).catch(() => null),
        getDashboardSummary({ from: thirtyDaysAgo }).catch(() => null),
        taskSummary().catch(() => null),
        getUnreadTaskCount().catch(() => ({ count: 0 })),
        listMyBadges().catch(() => [] as BadgeAward[]),
        getLmsAnalytics().catch(() => null),
        listShifts({ from_date: `${today}T00:00:00`, to_date: `${today}T23:59:59`, status: "published", page_size: 1 }).catch(() => null),
      ]).then(([td, aud, ts, u, mb, lms, shiftsRes]) => {
        setTodaySummary(td);
        setAuditSummary(aud);
        setTodayShiftsCount((shiftsRes as { total_count: number } | null)?.total_count ?? null);
        setTaskSum(ts);
        setUnreadTasks(u?.count ?? 0);
        setMyBadges(mb ?? []);
        setTrainingAnalytics(lms as LmsAnalytics | null);
      }).catch((e) => setError((e as Error).message))
        .finally(() => setLoading(false));
    };

    fetchAll();
    const interval = setInterval(fetchAll, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          Failed to load dashboard data: {error}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />) : (
          <>
            {/* Checklist Completion — today */}
            {(() => {
              const rate = todaySummary?.completion_rate ?? null;
              const pct = rate !== null ? Math.round(rate * 100) : null;
              return (
                <StatCard
                  label="Checklist Completion"
                  value={pct !== null ? `${pct}%` : "—"}
                  icon={ClipboardCheck}
                  iconBg={pct === null ? "bg-gray-100" : pct >= 80 ? "bg-sprout-green/10" : pct >= 40 ? "bg-amber-100" : "bg-red-50"}
                  iconColor={pct === null ? "text-gray-400" : pct >= 80 ? "text-sprout-green" : pct >= 40 ? "text-amber-600" : "text-red-500"}
                  href="/dashboard/forms"
                  sub={<p className="text-xs text-dark-secondary">Today</p>}
                />
              );
            })()}
            {/* Audit Compliance — rolling 30 days */}
            {(() => {
              const rate = auditSummary?.audit_compliance_rate ?? null;
              const pct = rate !== null ? Math.round(rate * 100) : null;
              return (
                <StatCard
                  label="Audit Compliance"
                  value={pct !== null ? `${pct}%` : "—"}
                  icon={ShieldCheck}
                  iconBg={pct === null ? "bg-gray-100" : pct >= 80 ? "bg-sprout-green/10" : pct >= 50 ? "bg-amber-100" : "bg-red-50"}
                  iconColor={pct === null ? "text-gray-400" : pct >= 80 ? "text-sprout-green" : pct >= 50 ? "text-amber-600" : "text-red-500"}
                  href="/dashboard/audits"
                  sub={<p className="text-xs text-dark-secondary">Rolling 30 days</p>}
                />
              );
            })()}
            {/* Training Completion */}
            {(() => {
              const pct = trainingAnalytics != null ? Math.round(trainingAnalytics.completion_rate) : null;
              return (
                <StatCard
                  label="Training Completion"
                  value={pct !== null ? `${pct}%` : "—"}
                  icon={GraduationCap}
                  iconBg={pct === null ? "bg-gray-100" : pct >= 80 ? "bg-teal-50" : pct >= 50 ? "bg-amber-100" : "bg-red-50"}
                  iconColor={pct === null ? "text-gray-400" : pct >= 80 ? "text-teal-600" : pct >= 50 ? "text-amber-600" : "text-red-500"}
                  href="/dashboard/insights/reports/training"
                  sub={<p className="text-xs text-dark-secondary">Course pass rate</p>}
                />
              );
            })()}
            {/* Shifts & Attendance */}
            <StatCard
              label="Shifts Today"
              value={todayShiftsCount !== null ? todayShiftsCount : "—"}
              icon={CalendarClock}
              iconBg="bg-blue-50"
              iconColor="text-blue-600"
              href="/dashboard/shifts"
              sub={<p className="text-xs text-dark-secondary">Published today</p>}
            />
          </>
        )}
      </div>

      {/* Task Summary Widget */}
      {!loading && taskSum && (
        <div className="bg-white rounded-xl border border-surface-border p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-dark flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-sprout-green" /> Tasks Overview
            </p>
            <button
              onClick={() => router.push("/dashboard/tasks")}
              className="flex items-center gap-1 text-xs text-sprout-green hover:underline font-medium"
            >
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {/* Status chips + unread badge */}
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(taskSum.by_status).map(([status, count]) => (
              <span key={status} className={clsx("text-xs font-medium px-2.5 py-1 rounded-full capitalize", STATUS_STYLES[status] ?? "bg-gray-100 text-gray-600")}>
                {status.replace("_", " ")}: {count}
              </span>
            ))}
            {unreadTasks > 0 && (
              <button
                onClick={() => router.push("/dashboard/tasks")}
                className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-sprout-purple/10 text-sprout-purple hover:bg-sprout-purple/20 transition-colors"
              >
                <MessageSquare className="w-3 h-3" />
                {unreadTasks} unread message{unreadTasks !== 1 ? "s" : ""}
                <span className="w-2 h-2 rounded-full bg-sprout-purple animate-pulse" />
              </button>
            )}
          </div>

          {/* Overdue tasks list */}
          {taskSum.overdue_count > 0 && (
            <>
              <p className="text-xs font-medium text-red-600 flex items-center gap-1 mb-2">
                <AlertTriangle className="w-3.5 h-3.5" /> {taskSum.overdue_count} overdue task{taskSum.overdue_count !== 1 ? "s" : ""}
              </p>
              <div className="flex flex-col divide-y divide-surface-border">
                {taskSum.overdue_tasks.slice(0, 5).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => router.push("/dashboard/tasks")}
                    className="py-2.5 flex items-start justify-between gap-3 w-full text-left hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-dark truncate">{t.title}</p>
                      {t.locations && (
                        <p className="text-xs text-dark-secondary mt-0.5">{(t.locations as { name: string }).name}</p>
                      )}
                    </div>
                    <span className={clsx("text-xs font-medium px-2 py-0.5 rounded-full shrink-0 capitalize", PRIORITY_STYLES[t.priority] ?? "bg-gray-100 text-gray-600")}>
                      {t.priority}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {taskSum.overdue_count === 0 && (
            <div className="flex items-center gap-2 text-sm text-sprout-green">
              <CheckCircle2 className="w-4 h-4" /> No overdue tasks — great work!
            </div>
          )}

          {taskSum.completion_rate !== null && (
            <div className="mt-3 pt-3 border-t border-surface-border">
              <div className="flex justify-between text-xs text-dark-secondary mb-1">
                <span>Task Completion Rate</span>
                <span>{Math.round(taskSum.completion_rate * 100)}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={clsx("h-2 rounded-full transition-all duration-500",
                    taskSum.completion_rate >= 0.8 ? "bg-sprout-green" : taskSum.completion_rate >= 0.4 ? "bg-amber-400" : "bg-red-500")}
                  style={{ width: `${Math.round(taskSum.completion_rate * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Unified inbox for admin/manager */}
      <MyInbox isManager />

      {/* My Achievements widget */}
      {!loading && (
        <div className="bg-white rounded-2xl border border-surface-border p-4 md:p-6">
          <p className="text-sm font-semibold text-dark mb-3 flex items-center gap-2">
            <span>🏆</span> My Achievements
          </p>
          {myBadges.length === 0 ? (
            <p className="text-sm text-dark-secondary">
              No badges yet — start reporting issues to earn points!
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {myBadges.map((award) => {
                const cfg = award.badge_configs;
                const pts = cfg?.points_awarded ?? 0;
                const [gradient, ringCls, accentText] =
                  pts >= 400 ? ["from-amber-100 to-yellow-50",   "ring-amber-300/50",  "text-amber-600" ] :
                  pts >= 150 ? ["from-slate-100 to-blue-50",     "ring-slate-300/50",  "text-slate-500" ] :
                  pts >= 50  ? ["from-orange-100 to-amber-50",   "ring-orange-300/50", "text-orange-600"] :
                               ["from-violet-100 to-purple-50",  "ring-violet-300/50", "text-violet-600"];
                return (
                  <div key={award.id} className="bg-white rounded-2xl overflow-hidden border border-surface-border shadow-sm">
                    <div className={`bg-gradient-to-br ${gradient} py-4 flex items-center justify-center`}>
                      <div className={`w-14 h-14 rounded-full bg-white/20 ring-4 ${ringCls} flex items-center justify-center shadow-lg`}>
                        <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                          <span className="text-2xl leading-none">{cfg?.icon ?? "🏅"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="px-2 py-2.5 text-center">
                      <p className="font-bold text-dark text-[11px] leading-snug line-clamp-1">{cfg?.name ?? "Badge"}</p>
                      {pts > 0 && (
                        <p className={`text-[10px] font-semibold mt-0.5 ${accentText}`}>+{pts} pts</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Unified Inbox ──────────────────────────────────────────────────────────────
type InboxItem =
  | { kind: "form";         id: string; title: string; sub: string; due: Date | null; overdue: boolean; href: string }
  | { kind: "task";         id: string; title: string; sub: string; due: Date | null; overdue: boolean; href: string }
  | { kind: "workflow";     id: string; title: string; sub: string; due: Date | null; overdue: boolean; href: string }
  | { kind: "incident";     id: string; title: string; sub: string; due: Date | null; overdue: boolean; href: string }
  | { kind: "issue";        id: string; title: string; sub: string; due: Date | null; overdue: boolean; href: string }
  | { kind: "course";       id: string; title: string; sub: string; due: Date | null; overdue: boolean; href: string }
  | { kind: "announcement"; id: string; title: string; sub: string; due: Date | null; overdue: boolean; href: string };

const INBOX_META = {
  form:         { label: "Form",         icon: ClipboardList,  color: "text-amber-600",    bg: "bg-amber-50",         badge: "bg-amber-100 text-amber-700" },
  task:         { label: "Task",         icon: CheckSquare,    color: "text-sprout-green", bg: "bg-sprout-green/10",  badge: "bg-sprout-green/10 text-sprout-green" },
  workflow:     { label: "Workflow",     icon: GitBranch,      color: "text-sprout-purple",bg: "bg-sprout-purple/10", badge: "bg-sprout-purple/10 text-sprout-purple" },
  incident:     { label: "Incident",     icon: TriangleAlert,  color: "text-red-500",      bg: "bg-red-50",           badge: "bg-red-100 text-red-600" },
  issue:        { label: "Issue",        icon: AlertTriangle,  color: "text-orange-600",   bg: "bg-orange-50",        badge: "bg-orange-100 text-orange-700" },
  course:       { label: "Training",     icon: GraduationCap,  color: "text-blue-600",     bg: "bg-blue-50",          badge: "bg-blue-100 text-blue-700" },
  announcement: { label: "Acknowledge",  icon: Megaphone,      color: "text-sprout-purple",bg: "bg-sprout-purple/10", badge: "bg-sprout-purple/10 text-sprout-purple" },
};

const INBOX_PAGE_SIZE = 8;

function MyInbox({ isManager = false }: { isManager?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const now = new Date();

    async function fetchIncidents(): Promise<{ id: string; title: string; status: string }[]> {
      if (!isManager) return [];
      try {
        const supabase = createClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
        const res = await fetch(`${apiBase}/api/v1/incidents`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return [];
        const json = await res.json();
        const arr = Array.isArray(json) ? json : (json.data ?? []);
        return arr.filter((i: { status: string }) => i.status !== "closed");
      } catch { return []; }
    }

    Promise.all([
      getMyAssignments().catch(() => [] as FormAssignment[]),
      myTasks().catch(() => [] as Task[]),
      getMyWorkflowTasks().catch(() => [] as WorkflowStageInstance[]),
      isManager ? listIssues({ status: "open" }).catch(() => ({ data: [] as Issue[], total: 0 })) : Promise.resolve({ data: [] as Issue[], total: 0 }),
      fetchIncidents(),
      getMyEnrollments().catch(() => [] as CourseEnrollment[]),
      listAnnouncements().then((r) => r.items).catch(() => [] as Announcement[]),
    ]).then(([forms, tasks, wfTasks, issuesRes, incidents, enrollments, announcements]) => {
      const built: InboxItem[] = [];

      // Form assignments
      for (const f of (forms as FormAssignment[])) {
        if (!f.is_active) continue;
        const due = f.due_at ? new Date(f.due_at) : null;
        built.push({ kind: "form", id: f.id, title: f.form_templates?.title ?? "Untitled Form", sub: f.form_templates?.type ?? "form", due, overdue: due ? due < now : false, href: `/dashboard/forms/fill/${f.id}` });
      }

      // Tasks
      for (const t of (tasks as Task[])) {
        if (t.status === "completed" || t.status === "cancelled") continue;
        const due = t.due_at ? new Date(t.due_at) : null;
        built.push({ kind: "task", id: t.id, title: t.title, sub: t.priority ?? "task", due, overdue: t.status === "overdue" || (due ? due < now : false), href: `/dashboard/issues?tab=tasks&id=${t.id}` });
      }

      // Workflow stage tasks
      for (const w of (wfTasks as WorkflowStageInstance[])) {
        if (w.status !== "pending" && w.status !== "in_progress") continue;
        const due = w.due_at ? new Date(w.due_at) : null;
        const actionType = w.workflow_stages?.action_type ?? "";
        const actionLabel = actionType === "approve" ? "Needs approval" : actionType === "sign" ? "Needs signature" : actionType === "fill_form" ? "Fill form" : actionType === "review" ? "Needs review" : "Workflow step";
        const wInstanceId = w.workflow_instances?.id;
        const href = wInstanceId
          ? `/dashboard/workflows/fill/${wInstanceId}/${w.id}`
          : "/dashboard/workflows/instances";
        const workflowName = w.workflow_instances?.workflow_definitions?.name ?? "Workflow Task";
        const stageName = w.workflow_stages?.name;
        const formTitle = w.workflow_stages?.form_templates?.title;
        const subParts = [stageName, formTitle, actionLabel].filter(Boolean);
        const subLabel = subParts.join(" · ");
        built.push({ kind: "workflow", id: w.id, title: workflowName, sub: subLabel, due, overdue: due ? due < now : false, href });
      }

      // Open issues (managers only)
      for (const i of ((issuesRes as { data: Issue[] }).data ?? [])) {
        built.push({ kind: "issue", id: i.id, title: i.title, sub: i.status?.replace("_", " ") ?? "open", due: null, overdue: false, href: `/dashboard/issues?tab=issues&id=${i.id}` });
      }

      // Open incidents (managers only)
      for (const i of (incidents as { id: string; title: string; status: string }[])) {
        built.push({ kind: "incident", id: i.id, title: i.title, sub: i.status?.replace("_", " ") ?? "reported", due: null, overdue: false, href: `/dashboard/issues?tab=incidents&id=${i.id}` });
      }

      // Course enrollments (not started / in progress)
      for (const e of (enrollments as CourseEnrollment[])) {
        if (e.status !== "not_started" && e.status !== "in_progress") continue;
        const courseTitle = e.courses?.title ?? "Training Course";
        const sub = e.status === "in_progress" ? "In progress" : "Not started";
        built.push({ kind: "course", id: e.id, title: courseTitle, sub, due: null, overdue: false, href: `/dashboard/training/learn/${e.id}` });
      }

      // Announcements that require acknowledgement and haven't been acknowledged yet
      for (const a of (announcements as Announcement[])) {
        if (!a.requires_acknowledgement) continue;
        if (a.my_acknowledged) continue;
        built.push({ kind: "announcement", id: a.id, title: a.title, sub: "Acknowledgement required", due: null, overdue: false, href: "/dashboard/announcements" });
      }

      // Sort: overdue first, then by due date ascending, then no-due last
      built.sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        if (a.due && b.due) return a.due.getTime() - b.due.getTime();
        if (a.due) return -1;
        if (b.due) return 1;
        return 0;
      });

      setItems(built);
    }).finally(() => setLoading(false));
  }, [isManager]);

  const overdueCount = items.filter((i) => i.overdue).length;

  return (
    <div className="bg-white rounded-xl border border-surface-border p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-dark flex items-center gap-2">
          <Inbox className="w-4 h-4 text-sprout-purple" />
          My Inbox
          {items.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-semibold">{items.length}</span>
          )}
          {overdueCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-semibold">{overdueCount} overdue</span>
          )}
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-sprout-green py-2">
          <CheckCircle2 className="w-4 h-4" /> You&apos;re all caught up!
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-surface-border">
          {(showAll ? items : items.slice(0, INBOX_PAGE_SIZE)).map((item) => {
            const meta = INBOX_META[item.kind];
            const Icon = meta.icon;
            return (
              <button
                key={`${item.kind}-${item.id}`}
                onClick={() => router.push(item.href)}
                className="py-3 flex items-center gap-3 w-full text-left hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
              >
                <div className={clsx("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", meta.bg)}>
                  <Icon className={clsx("w-3.5 h-3.5", meta.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-dark truncate">{item.title}</p>
                  <p className="text-xs text-dark-secondary mt-0.5 capitalize truncate">{item.sub}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={clsx("text-[10px] font-semibold px-2 py-0.5 rounded-full", meta.badge)}>
                    {meta.label}
                  </span>
                  {item.overdue ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">Overdue</span>
                  ) : item.due ? (
                    <span className="text-[10px] text-dark/40">
                      {item.due.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
          {items.length > INBOX_PAGE_SIZE && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="pt-3 text-xs text-sprout-purple hover:underline text-center w-full font-medium">
              {showAll ? "Show less" : `Show ${items.length - INBOX_PAGE_SIZE} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Staff dashboard ────────────────────────────────────────────────────────────
function StaffDashboard({ name }: { name: string }) {
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [myBadges, setMyBadges] = useState<BadgeAward[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [openIssuesCount, setOpenIssuesCount] = useState(0);
  const [coursesToComplete, setCoursesToComplete] = useState(0);
  const [myShiftsThisWeek, setMyShiftsThisWeek] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date();
    const day = today.getDay();
    const diffMon = day === 0 ? -6 : 1 - day;
    const weekMon = new Date(today); weekMon.setDate(today.getDate() + diffMon); weekMon.setHours(0,0,0,0);
    const weekSun = new Date(weekMon); weekSun.setDate(weekMon.getDate() + 6);
    const weekStart = weekMon.toISOString().slice(0, 10);
    const weekEnd = weekSun.toISOString().slice(0, 10);

    Promise.all([
      listAnnouncements().then((r) => r.items).catch(() => [] as Announcement[]),
      listMyBadges().catch(() => [] as BadgeAward[]),
      taskSummary().catch(() => ({ overdue_count: 0 } as Partial<TaskSummary>)),
      listIssues({ status: "open" }).then((r) => r.total).catch(() => 0),
      getMyEnrollments().catch(() => [] as CourseEnrollment[]),
      listShifts({ from_date: `${weekStart}T00:00:00`, to_date: `${weekEnd}T23:59:59`, page_size: 100 }).catch(() => null),
    ]).then(([ann, mb, tSum, issueTotal, enrollments, shiftsRes]) => {
      setAnnouncements(ann as Announcement[]);
      setMyBadges(mb ?? []);
      setOverdueCount((tSum as Partial<TaskSummary>).overdue_count ?? 0);
      setOpenIssuesCount(issueTotal as number);
      setCoursesToComplete(
        (enrollments as CourseEnrollment[]).filter(
          (e) => e.status === "not_started" || e.status === "in_progress"
        ).length
      );
      if (shiftsRes) {
        setMyShiftsThisWeek((shiftsRes as { items: Shift[] }).items?.length ?? 0);
      }
    }).finally(() => setLoading(false));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = name.split(" ")[0];

  return (
    <>
      {/* Greeting */}
      <div className="bg-white rounded-xl border border-surface-border px-6 py-5">
        <p className="text-xl font-bold text-dark">{greeting}, {firstName}! 👋</p>
        <p className="text-sm text-dark-secondary mt-1">Here&apos;s a summary of what needs your attention today.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />) : (
          <>
            <StatCard label="Overdue Items" value={overdueCount}
              icon={TriangleAlert}
              iconBg={overdueCount > 0 ? "bg-red-50" : "bg-gray-100"}
              iconColor={overdueCount > 0 ? "text-red-600" : "text-gray-400"}
              href="/dashboard/tasks" />
            <StatCard label="Open Issues" value={openIssuesCount}
              icon={AlertTriangle}
              iconBg={openIssuesCount > 0 ? "bg-orange-50" : "bg-gray-100"}
              iconColor={openIssuesCount > 0 ? "text-orange-600" : "text-gray-400"}
              href="/dashboard/issues" />
            <StatCard label="Courses to Complete" value={coursesToComplete}
              icon={GraduationCap}
              iconBg={coursesToComplete > 0 ? "bg-teal-50" : "bg-gray-100"}
              iconColor={coursesToComplete > 0 ? "text-teal-600" : "text-gray-400"}
              href="/dashboard/training" />
            {/* Shifts this week */}
            <StatCard
              label="Shifts This Week"
              value={myShiftsThisWeek !== null ? myShiftsThisWeek : "—"}
              icon={CalendarClock}
              iconBg="bg-blue-50"
              iconColor="text-blue-600"
              href="/dashboard/shifts"
            />
          </>
        )}
      </div>

      {/* Unified inbox */}
      {!loading && <MyInbox />}

      {/* My Achievements widget */}
      {!loading && (
        <div className="bg-white rounded-2xl border border-surface-border p-4 md:p-6">
          <p className="text-sm font-semibold text-dark mb-3 flex items-center gap-2">
            <span>🏆</span> My Achievements
          </p>
          {myBadges.length === 0 ? (
            <p className="text-sm text-dark-secondary">
              No badges yet — start reporting issues to earn points!
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {myBadges.map((award) => {
                const cfg = award.badge_configs;
                const pts = cfg?.points_awarded ?? 0;
                const [gradient, ringCls, accentText] =
                  pts >= 400 ? ["from-amber-100 to-yellow-50",   "ring-amber-300/50",  "text-amber-600" ] :
                  pts >= 150 ? ["from-slate-100 to-blue-50",     "ring-slate-300/50",  "text-slate-500" ] :
                  pts >= 50  ? ["from-orange-100 to-amber-50",   "ring-orange-300/50", "text-orange-600"] :
                               ["from-violet-100 to-purple-50",  "ring-violet-300/50", "text-violet-600"];
                return (
                  <div key={award.id} className="bg-white rounded-2xl overflow-hidden border border-surface-border shadow-sm">
                    <div className={`bg-gradient-to-br ${gradient} py-4 flex items-center justify-center`}>
                      <div className={`w-14 h-14 rounded-full bg-white/20 ring-4 ${ringCls} flex items-center justify-center shadow-lg`}>
                        <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                          <span className="text-2xl leading-none">{cfg?.icon ?? "🏅"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="px-2 py-2.5 text-center">
                      <p className="font-bold text-dark text-[11px] leading-snug line-clamp-1">{cfg?.name ?? "Badge"}</p>
                      {pts > 0 && (
                        <p className={`text-[10px] font-semibold mt-0.5 ${accentText}`}>+{pts} pts</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}


      {/* Latest announcements — thumbnail preview cards */}
      {!loading && announcements.length > 0 && (
        <div className="bg-white rounded-xl border border-surface-border p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-dark flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-sprout-purple" /> Latest Announcements
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-semibold">{announcements.length}</span>
            </p>
            <button
              onClick={() => router.push("/dashboard/announcements")}
              className="flex items-center gap-1 text-xs text-sprout-green hover:underline font-medium"
            >
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {announcements.slice(0, 6).map((a) => {
              const thumb = a.media_urls?.[0] ?? a.media_url ?? null;
              return (
                <button
                  key={a.id}
                  onClick={() => router.push("/dashboard/announcements")}
                  className="flex flex-col rounded-xl border border-surface-border overflow-hidden text-left hover:shadow-md transition-shadow"
                >
                  {thumb ? (
                    <div className="h-36 w-full bg-gray-100 overflow-hidden">
                      <img src={proxied(thumb)} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    </div>
                  ) : (
                    <div className="h-36 w-full bg-gradient-to-br from-sprout-purple/20 to-sprout-purple/20 flex items-center justify-center">
                      <Megaphone className="w-6 h-6 text-sprout-purple/60" />
                    </div>
                  )}
                  <div className="p-2.5 flex flex-col gap-1 flex-1">
                    <p className="text-xs font-semibold text-dark line-clamp-2 leading-snug">{a.title}</p>
                    <p className="text-[10px] text-dark-secondary line-clamp-2 leading-snug">{a.body}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// ── Onboarding Banner ─────────────────────────────────────────────────────────

const STEP_LABELS = ["Company", "Templates", "Team", "Preview", "Launch"];

function OnboardingBanner() {
  const [session, setSession] = useState<{ current_step: number; company_name?: string | null } | null>(null);

  useEffect(() => {
    fetch("http://localhost:8000/api/v1/onboarding/sessions/current", {
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        if (data.status === "in_progress") setSession(data);
      })
      .catch(() => {});

    // Also try via apiFetch token pattern
    import("@/services/api/client").then(({ apiFetch }) => {
      apiFetch<{ current_step: number; status: string; company_name?: string | null }>(
        "/api/v1/onboarding/sessions/current"
      )
        .then((data) => { if (data.status === "in_progress") setSession(data); })
        .catch(() => {});
    });
  }, []);

  if (!session) return null;

  const step = session.current_step;
  const pct = Math.round(((step - 1) / 5) * 100);

  return (
    <Link href="/onboarding" className="block">
      <div className="rounded-2xl border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
        <div className="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-green-900">
              {session.company_name ? `Setting up ${session.company_name}` : "Workspace setup in progress"}
            </span>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              Step {step} of 5 — {STEP_LABELS[step - 1]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-green-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-green-600 font-medium whitespace-nowrap">{pct}%</span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-green-700 text-sm font-semibold flex-shrink-0">
          Continue setup <ArrowRight size={15} />
        </div>
      </div>
    </Link>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [role, setRole] = useState("staff"); // default to most restrictive
  const [name, setName] = useState("there");
  const [orgId, setOrgId] = useState("");

  useEffect(() => {
    const supabase = createClient();
    // getSession reads from local cache — no network call, resolves immediately
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (user) {
        setRole((user.app_metadata?.role as string) ?? "staff");
        setOrgId((user.app_metadata?.organisation_id as string) ?? "");
        setName(
          (user.app_metadata?.full_name as string) ||
          (user.user_metadata?.full_name as string) ||
          user.email?.split("@")[0] ||
          "there"
        );
      }
    });
  }, []);

  const isStaff = role === "staff";
  const isAdmin = ["super_admin", "admin"].includes(role);

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4 md:gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-sprout-green/10 flex items-center justify-center">
          <LayoutDashboard className="w-5 h-5 text-sprout-green" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-dark">Dashboard</h1>
          <p className="text-sm text-dark-secondary">
            {isStaff ? "Your tasks and updates" : "Last 30 days"}
          </p>
        </div>
      </div>

      {/* Onboarding banner — only for admins with an active setup */}
      {isAdmin && <OnboardingBanner />}

      <DailyBriefCard role={role} name={name} orgId={orgId} />

      {isStaff ? (
        <StaffDashboard name={name} />
      ) : (
        <AdminDashboard />
      )}
    </div>
  );
}
