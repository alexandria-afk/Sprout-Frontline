"use client";

import { useEffect, useState, useCallback } from "react";
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
  Bell,
  AlertCircle,
  ArrowRightLeft,
  Calendar,
  Clock,
  FileText,
  X,
  Check,
  MapPin,
  LogIn,
  LogOut,
  Coffee,
  Trophy,
  Medal,
  Users,
} from "lucide-react";
import { getDashboardSummary, type DashboardSummary, type AttendanceSummary, type AttendanceLocationRow } from "@/services/dashboard";
import { getMyAssignments, type FormAssignment } from "@/services/forms";
import { listAnnouncements } from "@/services/announcements";
import { listCAPs } from "@/services/caps";
import { myTasks, taskSummary } from "@/services/tasks";
import { getSafetyLeaderboard } from "@/services/safety";
import { getMyWorkflowTasks, type WorkflowStageInstance } from "@/services/workflows";
import { listIssues } from "@/services/issues";
import { getMyEnrollments, getLmsAnalytics, type CourseEnrollment, type LmsAnalytics } from "@/services/lms";
import { listShifts, clockIn, clockOut, startBreak, endBreak, getBreakStatus, getMyAttendance } from "@/services/shifts";
import { createClient } from "@/services/supabase/client";
import type { Announcement, Task, TaskSummary, Issue, Shift, AttendanceRecord, SafetyPoints } from "@/types";
import { AnnouncementCard, proxied } from "@/components/announcements/AnnouncementCard";
import { getDashboardInsights, type AiInsight } from "@/services/ai";
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

// ── Daily Brief by Sidekick (manager/admin only — API-driven) ─────────────────

const SEV_STYLES = {
  critical: { bar: "bg-red-400",   badge: "bg-red-50 text-red-600 border border-red-100",   label: "🔴 CRITICAL" },
  warning:  { bar: "bg-amber-400", badge: "bg-amber-50 text-amber-600 border border-amber-100", label: "⚠️ WARNING" },
  info:     { bar: "bg-blue-400",  badge: "bg-blue-50 text-blue-600 border border-blue-100",  label: "ℹ️ INFO" },
} as const;

function DailyBriefCard() {
  const [brief, setBrief]         = useState<string>("");
  const [insights, setInsights]   = useState<AiInsight[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [cachedAt, setCachedAt]   = useState("");

  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const data = await getDashboardInsights(refresh);
      setBrief(data.brief || "");
      setInsights(data.insights || []);
      if (data.cached_at) {
        try {
          const d = new Date(data.cached_at);
          setCachedAt(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        } catch { /* ignore */ }
      }
    } catch {
      if (!refresh) setBrief("Brief couldn't load — check your connection and try refreshing.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div
      className="rounded-2xl border-2 border-transparent"
      style={{ background: "linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box" }}
    >
      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-bold text-xs tracking-wide uppercase bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">
              Your Daily Brief by Sidekick
            </p>
            <p className="text-[11px] text-dark/30 shrink-0">{dateStr}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => load(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1 text-[11px] font-medium text-violet-500 hover:text-violet-700 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={clsx("w-3 h-3", refreshing && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={() => setCollapsed(c => !c)}
            className="p-1 text-dark/30 hover:text-dark/60 transition-colors"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            <ArrowRight className={clsx("w-3.5 h-3.5 transition-transform", collapsed ? "rotate-90" : "-rotate-90")} />
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="px-5 pb-5 flex flex-col gap-3">
          {/* Brief text */}
          {loading ? (
            <div className="space-y-1.5">
              <div className="h-3.5 w-full bg-gray-100 rounded animate-pulse" />
              <div className="h-3.5 w-4/5 bg-gray-100 rounded animate-pulse" />
            </div>
          ) : brief ? (
            <p className="text-sm text-dark/70 leading-relaxed">{brief}</p>
          ) : null}

          {/* Insight cards */}
          {!loading && insights.length > 0 && (
            <div className="flex flex-col gap-2">
              {insights.map((ins, i) => {
                const sev = SEV_STYLES[ins.severity] ?? SEV_STYLES.info;
                return (
                  <div key={i} className="bg-gray-50 rounded-xl border border-surface-border flex gap-3 p-3.5">
                    <div className={clsx("w-1 self-stretch rounded-full shrink-0", sev.bar)} />
                    <div className="flex-1 min-w-0">
                      <span className={clsx("text-[10px] font-bold px-1.5 py-0.5 rounded-full", sev.badge)}>{sev.label}</span>
                      <p className="text-sm font-semibold text-dark mt-1.5 leading-snug">{ins.title}</p>
                      <p className="text-xs text-dark-secondary mt-1 leading-relaxed">{ins.body}</p>
                      {ins.recommendation && (
                        <p className="text-xs text-sprout-purple mt-1.5 font-medium">{ins.recommendation}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {cachedAt && (
            <p className="text-[10px] text-dark/25">Generated at {cachedAt} · refreshes tomorrow</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Progress Ring (SVG) ───────────────────────────────────────────────────────
function ringColor(pct: number, greenThreshold: number, yellowThreshold: number): string {
  if (pct >= greenThreshold) return "#22C55E";  // sprout-green
  if (pct >= yellowThreshold) return "#F59E0B"; // amber
  return "#EF4444"; // red
}

function ProgressRing({
  pct, greenThreshold, yellowThreshold, label,
}: {
  pct: number;
  greenThreshold: number;
  yellowThreshold: number;
  label: string;
}) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const [offset, setOffset] = useState(circ);

  useEffect(() => {
    const id = setTimeout(() => {
      setOffset(circ * (1 - Math.min(Math.max(pct, 0), 100) / 100));
    }, 50);
    return () => clearTimeout(id);
  }, [pct, circ]);

  const stroke = ringColor(pct, greenThreshold, yellowThreshold);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="80" height="80">
        {/* Background track */}
        <circle cx="40" cy="40" r={r} fill="none" stroke="#F3F4F6" strokeWidth="6" />
        {/* Fill arc */}
        <circle
          cx="40" cy="40" r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 40 40)"
          style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
        />
        <text
          x="40" y="40"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={pct >= 100 ? "14" : "17"}
          fontWeight="700"
          fill="#111827"
        >
          {pct}%
        </text>
      </svg>
      <p className="text-[11px] font-semibold tracking-wide uppercase text-dark-secondary">{label}</p>
    </div>
  );
}

// ── Team / Workforce Attendance Card ─────────────────────────────────────────
const LOCATIONS_PAGE = 5;

function TeamAttendanceCard({
  role, attendance,
}: {
  role: string;
  attendance: AttendanceSummary | null | undefined;
}) {
  const isAdmin = ["super_admin", "admin"].includes(role);
  const title = isAdmin ? "ATTENDANCE TODAY" : "MY TEAM TODAY";
  const [locExpanded, setLocExpanded] = useState(false);

  if (!attendance) {
    return (
      <div className="bg-white rounded-xl border border-surface-border p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold tracking-wide uppercase text-dark-secondary flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" /> {title}
          </p>
          <Link href="/dashboard/shifts" className="flex items-center gap-1 text-xs text-sprout-green hover:underline font-medium">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <p className="text-xs text-dark-secondary">No shifts scheduled for today</p>
      </div>
    );
  }

  const { present_rate, on_time_rate, utilization_rate, by_location } = attendance;

  return (
    <div className="bg-white rounded-xl border border-surface-border p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <p className="text-xs font-semibold tracking-wide uppercase text-dark-secondary flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-600" /> {title}
        </p>
        <Link href="/dashboard/shifts" className="flex items-center gap-1 text-xs text-sprout-green hover:underline font-medium">
          View all <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Three progress rings */}
      <div className="flex items-start justify-around mb-5">
        <ProgressRing pct={present_rate}     greenThreshold={95} yellowThreshold={85} label="PRESENT" />
        <ProgressRing pct={on_time_rate}     greenThreshold={90} yellowThreshold={80} label="ON TIME" />
        <ProgressRing pct={utilization_rate} greenThreshold={95} yellowThreshold={85} label="UTIL" />
      </div>

      {/* Manager: not-clocked-in list */}
      {!isAdmin && (() => {
        const loc = by_location[0];
        const missing = loc?.not_clocked_in ?? [];
        if (missing.length === 0) return null;
        return (
          <div className="border-t border-surface-border pt-4">
            <p className="text-xs font-semibold text-red-600 mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Not clocked in
            </p>
            <div className="flex flex-col gap-1.5">
              {missing.map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-dark">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                  <span className="font-medium">{m.user_name}</span>
                  {m.shift_start && <span className="text-dark-secondary">· {m.shift_start}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Admin: per-location table */}
      {isAdmin && by_location.length > 0 && (() => {
        const shown = locExpanded ? by_location : by_location.slice(0, LOCATIONS_PAGE);
        const extra = by_location.length - LOCATIONS_PAGE;
        return (
          <div className="border-t border-surface-border pt-4">
            <div className="flex flex-col divide-y divide-surface-border">
              {shown.map((loc: AttendanceLocationRow) => {
                const pct = loc.present_rate;
                const color = pct >= 95 ? "text-sprout-green" : pct >= 85 ? "text-amber-600" : "text-red-500";
                const note = loc.clocked_in >= loc.scheduled
                  ? "✓"
                  : loc.late > 0 ? `${loc.late} late`
                  : `${loc.scheduled - loc.clocked_in} not in`;
                return (
                  <Link
                    key={loc.location_id}
                    href={`/dashboard/shifts?location_id=${loc.location_id}`}
                    className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded-lg px-1 -mx-1 transition-colors"
                  >
                    <span className="flex-1 text-sm font-medium text-dark truncate">{loc.location_name}</span>
                    <span className="text-xs text-dark-secondary tabular-nums">{loc.clocked_in}/{loc.scheduled}</span>
                    <span className={clsx("text-xs font-semibold tabular-nums w-10 text-right", color)}>{pct}%</span>
                    <span className={clsx("text-xs font-medium w-16 text-right", note === "✓" ? "text-sprout-green" : "text-amber-600")}>
                      {note}
                    </span>
                  </Link>
                );
              })}
            </div>
            {extra > 0 && (
              <button
                onClick={() => setLocExpanded((v) => !v)}
                className="w-full text-center text-xs text-sprout-purple hover:underline py-2 mt-1"
              >
                {locExpanded ? "Show less" : `Show ${extra} more location${extra !== 1 ? "s" : ""}`}
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Admin / Manager dashboard ─────────────────────────────────────────────────
function AdminDashboard({ role, locationId }: { role: string; locationId: string }) {
  const router = useRouter();
  const [todaySummary, setTodaySummary] = useState<DashboardSummary | null>(null);
  const [auditSummary, setAuditSummary] = useState<DashboardSummary | null>(null);
  const [trainingAnalytics, setTrainingAnalytics] = useState<LmsAnalytics | null>(null);
  const [todayShiftsCount, setTodayShiftsCount] = useState<number | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchAll = () => {
      const today = new Date().toISOString().slice(0, 10);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return Promise.all([
        getDashboardSummary({ from: today, to: today }).catch(() => null),
        getDashboardSummary({ from: thirtyDaysAgo }).catch(() => null),
        getLmsAnalytics().catch(() => null),
        listShifts({ from_date: `${today}T00:00:00`, to_date: `${today}T23:59:59`, status: "published", page_size: 1 }).catch(() => null),
        listAnnouncements().then((r) => r.items).catch(() => [] as Announcement[]),
      ]).then(([td, aud, lms, shiftsRes, ann]) => {
        setTodaySummary(td);
        setAuditSummary(aud);
        setTodayShiftsCount((shiftsRes as { total_count: number } | null)?.total_count ?? null);
        setTrainingAnalytics(lms as LmsAnalytics | null);
        setAnnouncements(ann as Announcement[]);
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

      {/* Team / Workforce Attendance */}
      <TeamAttendanceCard role={role} attendance={todaySummary?.attendance} />

      {/* My Shift */}
      <MyShiftCard />

      {/* Unified inbox for admin/manager */}
      <MyInbox isManager />

      {/* Leaderboard */}
      {/* Manager sees location leaderboard; admin sees org-wide */}
      <MiniLeaderboard locationId={["super_admin", "admin"].includes(role) ? undefined : locationId} />

      {/* Latest announcements */}
      {!loading && announcements.length > 0 && (
        <div className="bg-white rounded-xl border border-surface-border p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold tracking-wide uppercase text-dark-secondary flex items-center gap-2">
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
              const thumb = (a as { media_urls?: string[] }).media_urls?.[0] ?? a.media_url ?? null;
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

// ── Unified Inbox ──────────────────────────────────────────────────────────────
type InboxItem = {
  kind: "form" | "task" | "workflow" | "incident" | "issue" | "course" | "announcement";
  id: string;
  title: string;
  description: string;    // shown under title
  pill: string;           // first dynamic pill (form type, priority, audience, …)
  pillStyle: string;      // tailwind classes for the first dynamic pill
  pill2?: string;         // optional second dynamic pill (Required, Needs Acknowledgement, …)
  pillStyle2?: string;    // tailwind classes for the second dynamic pill
  due: Date | null;
  overdue: boolean;
  href: string;
  createdAt: Date;
};

const INBOX_META = {
  form:         { label: "Form",         icon: ClipboardList,  color: "text-amber-600",    bg: "bg-amber-50",         badge: "bg-amber-100 text-amber-700" },
  task:         { label: "Task",         icon: CheckSquare,    color: "text-sprout-green", bg: "bg-sprout-green/10",  badge: "bg-sprout-green/10 text-sprout-green" },
  workflow:     { label: "Workflow",     icon: GitBranch,      color: "text-sprout-purple",bg: "bg-sprout-purple/10", badge: "bg-sprout-purple/10 text-sprout-purple" },
  incident:     { label: "Incident",     icon: TriangleAlert,  color: "text-red-500",      bg: "bg-red-50",           badge: "bg-red-100 text-red-600" },
  issue:        { label: "Issue",        icon: AlertTriangle,  color: "text-orange-600",   bg: "bg-orange-50",        badge: "bg-orange-100 text-orange-700" },
  course:       { label: "Training",     icon: GraduationCap,  color: "text-blue-600",     bg: "bg-blue-50",          badge: "bg-blue-100 text-blue-700" },
  announcement: { label: "Announcement", icon: Megaphone,      color: "text-sprout-purple",bg: "bg-sprout-purple/10", badge: "bg-sprout-purple/10 text-sprout-purple" },
};

const INBOX_PAGE_SIZE = 8;

// ── Priority pill style ───────────────────────────────────────────────────────

const PRIORITY_PILL: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high:     "bg-orange-100 text-orange-700",
  medium:   "bg-amber-100 text-amber-700",
  low:      "bg-gray-100 text-gray-500",
};

// ── Form-type pill style ──────────────────────────────────────────────────────

const FORM_TYPE_PILL: Record<string, string> = {
  checklist: "bg-emerald-100 text-emerald-700",
  audit:     "bg-blue-100 text-blue-700",
  pull_out:  "bg-purple-100 text-purple-700",
  form:      "bg-slate-100 text-slate-600",
};

function formTypeLabel(raw: string): string {
  if (!raw) return "Form";
  if (raw === "pull_out") return "Pull Out";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// ── Due-date helper ───────────────────────────────────────────────────────────

function dueBadge(due: Date | null, overdue: boolean): string | null {
  if (!due) return null;
  const diffMs = Math.abs(due.getTime() - Date.now());
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays  = Math.floor(diffMs / 86_400_000);
  if (overdue) return diffHours < 24 ? "Due today" : `${diffDays}d overdue`;
  if (diffHours < 1)  return "Due in <1h";
  if (diffHours < 24) return `Due in ${diffHours}h`;
  if (diffDays === 1) return "Due tomorrow";
  return `Due in ${diffDays}d`;
}

// ── My Inbox ──────────────────────────────────────────────────────────────────

function MyInbox({ isManager = false }: { isManager?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const fetchItems = useCallback(async () => {
    setFetchError(null);
    setLoading(true);
    try {
      const now = new Date();
      const results: InboxItem[] = [];

      const [formsRes, tasksRes, workflowsRes, enrollmentsRes, announcementsRes, issuesRes] =
        await Promise.allSettled([
          getMyAssignments(),
          myTasks(),
          getMyWorkflowTasks(),
          getMyEnrollments(),
          listAnnouncements(),
          listIssues({ my_issues: true }),
        ]);

      // ── Form assignments ──────────────────────────────────────────────────
      if (formsRes.status === "fulfilled") {
        for (const fa of formsRes.value) {
          if (fa.completed) continue;
          const due     = fa.due_at ? new Date(fa.due_at) : null;
          const rawType = fa.form_templates?.type ?? "form";
          results.push({
            kind: "form",
            id: fa.id,
            title: fa.form_templates?.title ?? "Form",
            description: fa.form_templates?.description ?? "",
            pill:      formTypeLabel(rawType),
            pillStyle: FORM_TYPE_PILL[rawType] ?? "bg-slate-100 text-slate-600",
            due,
            overdue: due ? due < now : false,
            href: `/dashboard/forms/fill/${fa.id}`,
            createdAt: new Date(fa.created_at),
          });
        }
      }

      // ── Tasks (pending / in_progress only) ────────────────────────────────
      if (tasksRes.status === "fulfilled") {
        for (const t of tasksRes.value) {
          if (t.status === "completed" || t.status === "cancelled") continue;
          const due     = t.due_at ? new Date(t.due_at) : null;
          const priKey  = t.priority.toLowerCase();
          const priLabel = t.priority.charAt(0).toUpperCase() + t.priority.slice(1);
          results.push({
            kind: "task",
            id: t.id,
            title: t.title,
            description: t.description ?? t.locations?.name ?? "",
            pill:      priLabel,
            pillStyle: PRIORITY_PILL[priKey] ?? "bg-gray-100 text-gray-500",
            due,
            overdue: due ? due < now : false,
            href: `/dashboard/issues?tab=tasks&id=${t.id}`,
            createdAt: new Date(t.created_at),
          });
        }
      }

      // ── Workflow stage instances (in_progress only) ───────────────────────
      if (workflowsRes.status === "fulfilled") {
        for (const wsi of workflowsRes.value) {
          if (wsi.status !== "in_progress") continue;
          const due        = wsi.due_at ? new Date(wsi.due_at) : null;
          const instanceId = wsi.workflow_instance_id ?? wsi.workflow_instances?.id;
          const rawAction  = wsi.workflow_stages?.action_type ?? "";
          const actionLabel = rawAction
            ? rawAction.charAt(0).toUpperCase() + rawAction.slice(1).replace(/_/g, " ")
            : "Action required";
          results.push({
            kind: "workflow",
            id: wsi.id,
            title: wsi.workflow_stages?.name ?? "Workflow step",
            description: wsi.workflow_instances?.workflow_definitions?.name ?? "",
            pill:      actionLabel,
            pillStyle: "bg-violet-100 text-violet-700",
            due,
            overdue: due ? due < now : false,
            href: instanceId
              ? `/dashboard/workflows/fill/${instanceId}/${wsi.id}`
              : "/dashboard/workflows",
            createdAt: new Date(wsi.started_at ?? Date.now()),
          });
        }
      }

      // ── Course enrollments (not_started only — starting removes from inbox) ─
      if (enrollmentsRes.status === "fulfilled") {
        for (const ce of enrollmentsRes.value) {
          if (ce.status !== "not_started") continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const course = (ce as any).courses as {
            title?: string;
            description?: string | null;
            estimated_duration_mins?: number | null;
            is_mandatory?: boolean;
            course_modules?: { id: string }[];
          } | undefined;
          const moduleCount = course?.course_modules?.length ?? null;
          const modulePill  = moduleCount != null
            ? `${moduleCount} Module${moduleCount !== 1 ? "s" : ""}`
            : course?.estimated_duration_mins
              ? `${course.estimated_duration_mins} min`
              : null;
          results.push({
            kind: "course",
            id: ce.id,
            title: course?.title ?? "Training course",
            description: course?.description ?? "",
            pill:      modulePill ?? "Training",
            pillStyle: "bg-blue-100 text-blue-700",
            ...(course?.is_mandatory ? { pill2: "Required", pillStyle2: "bg-red-100 text-red-700" } : {}),
            due: null,
            overdue: false,
            href: `/dashboard/training/learn/${ce.id}`,
            createdAt: new Date(Date.now()),
          });
        }
      }

      // ── Announcements requiring acknowledgement ────────────────────────────
      if (announcementsRes.status === "fulfilled") {
        for (const ann of announcementsRes.value.items ?? []) {
          if (!ann.requires_acknowledgement || ann.my_acknowledged) continue;
          // Derive broadcast audience from target_roles
          const roles = ann.target_roles ?? [];
          let audience: string;
          if (!roles.length) {
            audience = "All Staff";
          } else if (roles.every((r) => ["super_admin", "admin"].includes(r))) {
            audience = "Admins";
          } else if (roles.every((r) => ["manager", "super_admin", "admin"].includes(r))) {
            audience = "Leadership";
          } else if (roles.includes("manager") && roles.includes("staff")) {
            audience = "All Staff";
          } else if (roles.includes("manager")) {
            audience = "Managers";
          } else {
            audience = "Staff";
          }
          results.push({
            kind: "announcement",
            id: ann.id,
            title: ann.title,
            description: (ann.body ?? "").slice(0, 100),
            pill:      audience,
            pillStyle: "bg-slate-100 text-slate-600",
            pill2:      "Needs Acknowledgement",
            pillStyle2: "bg-amber-100 text-amber-700",
            due: null,
            overdue: false,
            href: `/dashboard/announcements`,
            createdAt: new Date(ann.created_at),
          });
        }
      }

      // ── Assigned open issues ──────────────────────────────────────────────
      if (issuesRes.status === "fulfilled") {
        for (const issue of issuesRes.value.data) {
          if (issue.status === "resolved" || issue.status === "verified_closed") continue;
          const due    = issue.due_at ? new Date(issue.due_at) : null;
          const priKey = issue.priority.toLowerCase();
          const priLabel = issue.priority.charAt(0).toUpperCase() + issue.priority.slice(1);
          results.push({
            kind: "issue",
            id: issue.id,
            title: issue.title,
            description: issue.description ?? issue.locations?.name ?? "",
            pill:      priLabel,
            pillStyle: PRIORITY_PILL[priKey] ?? "bg-gray-100 text-gray-500",
            due,
            overdue: due ? due < now : false,
            href: `/dashboard/issues`,
            createdAt: new Date(issue.created_at),
          });
        }
      }

      // ── Sort: most overdue → upcoming → no due date (newest first) ────────
      results.sort((a, b) => {
        if (a.overdue && b.overdue) return a.due!.getTime() - b.due!.getTime();
        if (a.overdue) return -1;
        if (b.overdue) return 1;
        if (a.due && b.due) return a.due.getTime() - b.due.getTime();
        if (a.due) return -1;
        if (b.due) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      setItems(results);
    } catch (e) {
      setFetchError((e as Error).message || "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const displayed = showAll ? items : items.slice(0, INBOX_PAGE_SIZE);

  return (
    <div className="bg-white rounded-xl border border-surface-border p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold tracking-wide uppercase text-dark-secondary flex items-center gap-2">
          <Inbox className="w-4 h-4 text-sprout-purple" />
          My Inbox
          {items.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-sprout-purple text-white text-[10px] font-bold">
              {items.length}
            </span>
          )}
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : fetchError ? (
        <div className="flex items-center gap-2 text-sm text-red-500 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Could not load inbox.</span>
          <button onClick={fetchItems} className="ml-1 text-xs text-sprout-purple hover:underline">
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-sprout-green py-2">
          <CheckCircle2 className="w-4 h-4" /> You&apos;re all caught up!
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-surface-border">
          {displayed.map((item) => {
            const meta    = INBOX_META[item.kind];
            const Icon    = meta.icon;
            const dueText = dueBadge(item.due, item.overdue);
            return (
              <button
                key={`${item.kind}-${item.id}`}
                onClick={() => router.push(item.href)}
                className="py-3 flex items-start gap-3 w-full text-left hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
              >
                {/* Left: colored icon */}
                <div className={clsx("w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5", meta.bg)}>
                  <Icon className={clsx("w-3.5 h-3.5", meta.color)} />
                </div>

                {/* Centre: title + description */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-dark truncate">{item.title}</p>
                  {item.description && (
                    <p className="text-xs text-dark-secondary mt-0.5 line-clamp-2 leading-relaxed">
                      {item.description}
                    </p>
                  )}
                </div>

                {/* Right: type pill + dynamic pills + due date */}
                <div className="flex flex-col items-end gap-1 shrink-0 pt-0.5">
                  {/* Pills row */}
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    {item.kind !== "announcement" && item.kind !== "course" && (
                      <span className={clsx(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap",
                        meta.badge,
                      )}>
                        {meta.label}
                      </span>
                    )}
                    {item.pill && (
                      <span className={clsx(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap",
                        item.pillStyle,
                      )}>
                        {item.pill}
                      </span>
                    )}
                    {item.pill2 && (
                      <span className={clsx(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap",
                        item.pillStyle2,
                      )}>
                        {item.pill2}
                      </span>
                    )}
                  </div>
                  {/* Row 3: due date */}
                  {dueText && (
                    <span className={clsx(
                      "text-[10px] font-medium whitespace-nowrap",
                      item.overdue ? "text-red-500" : "text-dark/40",
                    )}>
                      {dueText}
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {items.length > INBOX_PAGE_SIZE && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full text-center text-xs text-sprout-purple hover:underline py-2"
            >
              {showAll ? "Show less" : `View all ${items.length} items`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── My Shift Card ─────────────────────────────────────────────────────────────
function MyShiftCard() {
  const [shift, setShift]           = useState<Shift | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null);
  const [onBreak, setOnBreak]       = useState(false);
  const [activeBreakId, setActiveBreakId] = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [userId, setUserId]         = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (!uid) { setLoading(false); return; }

      // Prefer app_metadata; fall back to profile row (JWT may lag after location assignment)
      let lid = (session?.user?.app_metadata?.location_id as string) ?? null;
      if (!lid) {
        const supabase2 = createClient();
        const { data: profile } = await supabase2
          .from("profiles")
          .select("location_id")
          .eq("id", uid)
          .maybeSingle();
        lid = profile?.location_id ?? null;
      }
      setLocationId(lid);

      const today = new Date().toISOString().slice(0, 10);
      const [shiftsRes, attRes] = await Promise.all([
        listShifts({ user_id: uid, from_date: `${today}T00:00:00`, to_date: `${today}T23:59:59`, page_size: 5 }).catch(() => ({ items: [] as Shift[], total_count: 0 })),
        getMyAttendance({ from_date: today, to_date: today }).catch(() => [] as AttendanceRecord[]),
      ]);

      const todayShift = (shiftsRes as { items: Shift[] }).items.find(s => s.assigned_to_user_id === uid) ?? null;
      setShift(todayShift);

      const openAtt = (attRes as AttendanceRecord[]).find(a => a.clock_in_at && !a.clock_out_at) ?? null;
      setAttendance(openAtt);

      if (openAtt) {
        const bs = await getBreakStatus(openAtt.id).catch(() => ({ on_break: false, active_break: null }));
        setOnBreak(bs.on_break);
        setActiveBreakId(bs.active_break?.id ?? null);
      }
      setLoading(false);
    }
    load();
  }, []);

  async function getCoords(): Promise<{ lat?: number; lng?: number }> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve({}); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve({}),
        { timeout: 5000 },
      );
    });
  }

  async function handleClockIn() {
    if (!locationId) return;
    setActionLoading(true);
    const { lat, lng } = await getCoords();
    const rec = await clockIn({ shift_id: shift?.id ?? null, location_id: locationId, clock_in_method: "gps", latitude: lat, longitude: lng }).catch(() => null);
    if (rec) setAttendance(rec);
    setActionLoading(false);
  }

  async function handleClockOut() {
    if (!attendance) return;
    setActionLoading(true);
    const { lat, lng } = await getCoords();
    const rec = await clockOut({ attendance_id: attendance.id, latitude: lat, longitude: lng }).catch(() => null);
    if (rec) { setAttendance(rec); setOnBreak(false); }
    setActionLoading(false);
  }

  async function handleBreakToggle() {
    if (!attendance) return;
    setActionLoading(true);
    if (onBreak) {
      await endBreak({ attendance_id: attendance.id }).catch(() => null);
      setOnBreak(false); setActiveBreakId(null);
    } else {
      const br = await startBreak({ attendance_id: attendance.id }).catch(() => null);
      if (br) { setOnBreak(true); setActiveBreakId(br.id); }
    }
    setActionLoading(false);
  }

  const fmt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const isClockedIn = !!(attendance?.clock_in_at && !attendance?.clock_out_at);

  if (loading) return (
    <div className="bg-white rounded-xl border border-surface-border p-4 animate-pulse">
      <div className="h-3 w-20 bg-gray-200 rounded mb-3" />
      <div className="h-5 w-48 bg-gray-100 rounded" />
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-surface-border p-4">
      <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wide mb-3 flex items-center gap-1.5">
        <CalendarClock className="w-3.5 h-3.5" /> My Shift
      </p>

      {!shift ? (
        <p className="text-sm text-dark-secondary">No shift today.</p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {isClockedIn ? (
              <p className="text-sm font-semibold text-dark">
                Clocked in at {fmt(attendance!.clock_in_at!)}
                {onBreak && <span className="ml-2 text-xs font-medium text-amber-600">· On break</span>}
              </p>
            ) : (
              <p className="text-sm font-semibold text-dark">{fmt(shift.start_at)} – {fmt(shift.end_at)}</p>
            )}
            {shift.locations?.name && (
              <p className="text-xs text-dark-secondary mt-0.5 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {shift.locations.name}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isClockedIn ? (
              <button onClick={handleClockIn} disabled={actionLoading || !locationId}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-sprout-green text-white hover:bg-sprout-green-dark disabled:opacity-40 transition-colors">
                <LogIn className="w-3.5 h-3.5" /> Clock In
              </button>
            ) : (
              <>
                <button onClick={handleBreakToggle} disabled={actionLoading}
                  className={clsx("flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors",
                    onBreak ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-gray-100 text-dark-secondary hover:bg-gray-200")}>
                  <Coffee className="w-3.5 h-3.5" /> {onBreak ? "End Break" : "Break"}
                </button>
                <button onClick={handleClockOut} disabled={actionLoading}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 transition-colors">
                  <LogOut className="w-3.5 h-3.5" /> Clock Out
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mini Leaderboard ──────────────────────────────────────────────────────────
function MiniLeaderboard({ locationId }: { locationId?: string }) {
  const [allEntries, setAllEntries] = useState<SafetyPoints[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      // Use passed locationId if provided; otherwise fall back to session location
      const lid = locationId ?? (session?.user?.app_metadata?.location_id as string) ?? undefined;
      setCurrentUserId(uid);
      const res = await getSafetyLeaderboard(lid).catch(() => ({ data: [] as SafetyPoints[], total: 0 }));
      const sorted = [...(res.data ?? [])].sort((a, b) => b.total_points - a.total_points);
      setAllEntries(sorted);
      setLoading(false);
    }
    load();
  }, []);

  function RankMark({ rank }: { rank: number }) {
    if (rank === 1) return <Trophy className="w-4 h-4 text-yellow-500 shrink-0" />;
    if (rank === 2) return <Trophy className="w-4 h-4 text-slate-400 shrink-0" />;
    if (rank === 3) return <Trophy className="w-4 h-4 text-amber-600 shrink-0" />;
    return <span className="w-4 text-center text-xs font-semibold text-dark-secondary">{rank}</span>;
  }

  const top5 = allEntries.slice(0, 5);
  const myRank = allEntries.findIndex(e => e.user_id === currentUserId);
  const myEntry = myRank >= 0 ? allEntries[myRank] : null;
  const myRankNumber = myRank + 1;
  const iMadeTop5 = myRank >= 0 && myRank < 5;

  function EntryRow({ entry, rank }: { entry: SafetyPoints; rank: number }) {
    const isMe = entry.user_id === currentUserId;
    return (
      <div className={clsx(
        "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors",
        isMe ? "bg-sprout-green/10 ring-1 ring-sprout-green/20" : "hover:bg-gray-50"
      )}>
        <div className="w-4 flex items-center justify-center shrink-0">
          <RankMark rank={rank} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={clsx("text-sm truncate", isMe ? "font-semibold text-dark" : "font-medium text-dark")}>
            {entry.profiles?.full_name ?? "—"}
            {isMe && <span className="ml-2 text-[10px] font-bold text-sprout-green uppercase tracking-wide">You</span>}
          </p>
          {entry.profiles?.role && (
            <p className="text-[10px] text-dark-secondary capitalize">{entry.profiles.role.replace("_", " ")}</p>
          )}
        </div>
        <p className={clsx("text-sm font-bold shrink-0 tabular-nums", isMe ? "text-sprout-green" : "text-dark-secondary")}>
          {entry.total_points.toLocaleString()}<span className="text-[10px] font-normal ml-0.5">pts</span>
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-surface-border p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold tracking-wide uppercase text-dark-secondary flex items-center gap-2">
          <Trophy className="w-4 h-4 text-yellow-500" /> Leaderboard
          <span className="text-[10px] font-normal normal-case">your branch</span>
        </p>
        <a href="/dashboard/safety" className="flex items-center gap-1 text-xs text-sprout-green hover:underline font-medium">
          View full <ArrowRight className="w-3 h-3" />
        </a>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : allEntries.length === 0 ? (
        <p className="text-sm text-dark-secondary">No leaderboard data yet.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {top5.map((entry, i) => (
            <EntryRow key={entry.user_id} entry={entry} rank={i + 1} />
          ))}

          {/* Show current user's position if they're outside top 5 */}
          {!iMadeTop5 && myEntry && (
            <>
              <div className="flex items-center gap-2 py-1 px-3">
                <div className="flex-1 h-px bg-surface-border" />
                <span className="text-[10px] text-dark-secondary">···</span>
                <div className="flex-1 h-px bg-surface-border" />
              </div>
              <EntryRow entry={myEntry} rank={myRankNumber} />
            </>
          )}

          {/* If user has no points yet */}
          {myRank < 0 && (
            <p className="text-xs text-dark-secondary text-center pt-2">
              Complete tasks and report issues to earn points!
            </p>
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
      taskSummary().catch(() => ({ overdue_count: 0 } as Partial<TaskSummary>)),
      listIssues({ status: "open" }).then((r) => r.total).catch(() => 0),
      getMyEnrollments().catch(() => [] as CourseEnrollment[]),
      listShifts({ from_date: `${weekStart}T00:00:00`, to_date: `${weekEnd}T23:59:59`, page_size: 100 }).catch(() => null),
    ]).then(([ann, tSum, issueTotal, enrollments, shiftsRes]) => {
      setAnnouncements(ann as Announcement[]);
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

      {/* My Shift */}
      <MyShiftCard />

      {/* Unified inbox */}
      {!loading && <MyInbox />}

      {/* Leaderboard */}
      {!loading && <MiniLeaderboard />}

      {/* Latest announcements — thumbnail preview cards */}
      {!loading && announcements.length > 0 && (
        <div className="bg-white rounded-xl border border-surface-border p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold tracking-wide uppercase text-dark-secondary flex items-center gap-2">
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
  const [locationId, setLocationId] = useState("");

  useEffect(() => {
    const supabase = createClient();
    // getSession reads from local cache — no network call, resolves immediately
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (user) {
        setRole((user.app_metadata?.role as string) ?? "staff");
        setOrgId((user.app_metadata?.organisation_id as string) ?? "");
        setLocationId((user.app_metadata?.location_id as string) ?? "");
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

      {!isStaff && <DailyBriefCard />}

      {isStaff ? (
        <StaffDashboard name={name} />
      ) : (
        <AdminDashboard role={role} locationId={locationId} />
      )}
    </div>
  );
}
