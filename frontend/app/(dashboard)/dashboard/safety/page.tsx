"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Trophy, Info, ChevronRight } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { createClient } from "@/services/supabase/client";
import { friendlyError } from "@/lib/errors";
import {
  listLeaderboards,
  getLeaderboard,
  listMyBadges,
  getMyPoints,
  getOrgLeaderboard,
} from "@/services/gamification";
import type {
  LeaderboardConfig,
  LeaderboardEntry,
  BadgeAward,
  UserPoints,
} from "@/services/gamification";

// ── Helpers ───────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    super_admin: "bg-sprout-green text-white",
    admin: "bg-sprout-green text-white",
    manager: "bg-purple-500 text-white",
    staff: "bg-gray-400 text-white",
  };
  const labels: Record<string, string> = {
    super_admin: "Super Admin",
    admin: "Admin",
    manager: "Manager",
    staff: "Staff",
  };
  return (
    <span className={clsx("px-2 py-0.5 rounded-full text-xs font-semibold", map[role] ?? "bg-gray-200 text-gray-700")}>
      {labels[role] ?? role}
    </span>
  );
}

function RankIcon({ rank }: { rank: number }) {
  if (rank === 1)
    return <Trophy className="w-5 h-5 text-yellow-500 shrink-0" aria-label="Gold" />;
  if (rank === 2)
    return <Trophy className="w-5 h-5 text-gray-400 shrink-0" aria-label="Silver" />;
  if (rank === 3)
    return <Trophy className="w-5 h-5 text-amber-600 shrink-0" aria-label="Bronze" />;
  return <span className="w-5 text-center text-sm font-semibold text-dark-secondary">{rank}</span>;
}

function MetricBadge({ value }: { value: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
      {value.replace(/_/g, " ")}
    </span>
  );
}

function ScopeBadge({ value }: { value: string }) {
  return (
    <span className={clsx(
      "px-2 py-0.5 rounded-full text-xs font-semibold",
      value === "organisation" ? "bg-sprout-purple/10 text-sprout-purple" : "bg-amber-100 text-amber-700"
    )}>
      {value === "organisation" ? "Organisation" : "Location"}
    </span>
  );
}

function WindowBadge({ value }: { value: string }) {
  const labels: Record<string, string> = {
    weekly: "Weekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    all_time: "All Time",
  };
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
      {labels[value] ?? value}
    </span>
  );
}

// ── Per-metric "How to earn" help ─────────────────────────────────────────────

const METRIC_HELP: Record<string, { icon: string; label: string; sub: string }[]> = {
  issues_reported: [
    { icon: "🚨", label: "Report an issue", sub: "Points awarded on each submission" },
    { icon: "⚠️", label: "Critical/safety-flagged issue", sub: "Higher points for elevated severity" },
    { icon: "🔥", label: "Reporting streak", sub: "Bonus for reporting X days in a row" },
  ],
  issues_resolved: [
    { icon: "✅", label: "Resolve an issue", sub: "Points when you close an assigned issue" },
    { icon: "⚡", label: "Resolve within SLA", sub: "Bonus points for beating the deadline" },
  ],
  tasks_completed: [
    { icon: "☑️", label: "Complete a task", sub: "Points per task marked done" },
    { icon: "⚡", label: "Beat the deadline", sub: "Bonus points for early completion" },
  ],
  checklists_completed: [
    { icon: "📋", label: "Submit a checklist", sub: "Points per checklist completed" },
    { icon: "🔥", label: "Daily streak", sub: "Bonus for consecutive days" },
  ],
  checklist_streak_days: [
    { icon: "🔥", label: "Maintain your checklist streak", sub: "Keep submitting checklists every day" },
    { icon: "📋", label: "Miss a day", sub: "Streak resets to zero" },
  ],
  audit_perfect_scores: [
    { icon: "⭐", label: "Score 100% on an audit", sub: "Points for a no-findings result" },
  ],
  points_total: [
    { icon: "🚨", label: "Report issues", sub: "All issue activity adds to your total" },
    { icon: "✅", label: "Resolve issues", sub: "Points per resolution" },
    { icon: "📋", label: "Complete checklists", sub: "Points per checklist" },
    { icon: "☑️", label: "Complete tasks", sub: "Points per task" },
    { icon: "🏅", label: "Earn badges", sub: "Each badge award contributes to your total" },
  ],
};

// ── Leaderboard Card + Inline Expanded View ───────────────────────────────────

function LeaderboardCard({ config }: { config: LeaderboardConfig }) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleView = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (entries.length > 0) return;
    setLoading(true);
    try {
      const res = await getLeaderboard(config.id);
      setEntries(res.entries ?? []);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-dark text-sm">{config.name}</p>
            {config.description && (
              <p className="text-xs text-dark-secondary mt-0.5 line-clamp-2">{config.description}</p>
            )}
          </div>
          <button
            onClick={handleView}
            className="flex items-center gap-1 text-xs font-medium text-sprout-purple hover:underline shrink-0"
          >
            {expanded ? "Hide" : "View"}
            <ChevronRight className={clsx("w-3.5 h-3.5 transition-transform", expanded && "rotate-90")} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <MetricBadge value={config.metric_type} />
          <ScopeBadge value={config.scope} />
          <WindowBadge value={config.time_window} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-surface-border px-4 py-3">
          {loading && (
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          )}
          {error && (
            <p className="text-xs text-red-500 py-2">{error}</p>
          )}
          {!loading && !error && entries.length === 0 && (
            <p className="text-sm text-dark-secondary py-2 text-center">No entries yet.</p>
          )}
          {!loading && !error && entries.length > 0 && (
            <>
              <div className="flex flex-col divide-y divide-surface-border">
                {entries.map((entry) => (
                  <div key={entry.user_id} className="flex items-center gap-3 py-2.5">
                    <div className="flex justify-center w-6 shrink-0">
                      <RankIcon rank={entry.rank} />
                    </div>
                    <p className="flex-1 text-sm font-medium text-dark min-w-0 truncate">
                      {entry.full_name ?? "Unknown"}
                    </p>
                    {entry.role && <RoleBadge role={entry.role} />}
                    <span className="text-sm font-semibold text-sprout-purple shrink-0">
                      {entry.score.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
              {METRIC_HELP[config.metric_type] && (
                <details className="mt-3 border-t border-surface-border pt-3">
                  <summary className="flex items-center gap-1.5 text-xs font-medium text-dark-secondary cursor-pointer select-none list-none hover:text-dark">
                    <Info className="w-3.5 h-3.5" />
                    How to earn points on this leaderboard
                  </summary>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {METRIC_HELP[config.metric_type].map(({ icon, label, sub }) => (
                      <div key={label} className="flex items-start gap-2 p-2 bg-surface-page rounded-lg">
                        <span className="text-base leading-none mt-0.5">{icon}</span>
                        <div>
                          <p className="text-xs font-medium text-dark">{label}</p>
                          <p className="text-xs text-dark-secondary mt-0.5">{sub}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Overall Leaderboard (pinned, always expanded) ─────────────────────────────

function OverallLeaderboard({ currentUserId }: { currentUserId: string | null }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getOrgLeaderboard()
      .then(setEntries)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-sprout-purple/5 border border-sprout-purple/20 rounded-2xl overflow-hidden mb-4">
      <div className="px-5 py-4 border-b border-sprout-purple/15 flex items-center gap-2">
        <Trophy className="w-4 h-4 text-sprout-purple" />
        <div>
          <p className="text-sm font-semibold text-dark">Overall Rankings</p>
          <p className="text-xs text-dark-secondary">Total points across all activities</p>
        </div>
      </div>
      <div className="px-5 py-3">
        {loading && (
          <div className="flex flex-col gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-9 bg-sprout-purple/10 rounded-lg animate-pulse" />
            ))}
          </div>
        )}
        {error && <p className="text-xs text-red-500 py-2">{error}</p>}
        {!loading && !error && entries.length === 0 && (
          <p className="text-sm text-dark-secondary py-2 text-center">No activity yet. Start reporting issues to earn points!</p>
        )}
        {!loading && !error && entries.length > 0 && (
          <div className="flex flex-col divide-y divide-sprout-purple/10">
            {entries.slice(0, 10).map((entry) => {
              const isMe = currentUserId && entry.user_id === currentUserId;
              return (
                <div
                  key={entry.user_id}
                  className={clsx(
                    "flex items-center gap-3 py-2.5 -mx-1 px-1 rounded-lg transition-colors",
                    isMe && "bg-sprout-purple/10"
                  )}
                >
                  <div className="flex justify-center w-6 shrink-0">
                    <RankIcon rank={entry.rank} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={clsx("text-sm truncate", isMe ? "font-bold text-sprout-purple" : "font-medium text-dark")}>
                      {entry.full_name ?? "Unknown"}
                      {isMe && <span className="ml-1.5 text-xs font-normal">(you)</span>}
                    </p>
                    {entry.badges && entry.badges.length > 0 && (
                      <div className="flex items-center gap-0.5 mt-0.5">
                        {entry.badges.slice(0, 4).map((b, idx) => (
                          <span key={idx} title={b.name} className="text-xs leading-none">
                            {b.icon ?? "🏅"}
                          </span>
                        ))}
                        {entry.badges.length > 4 && (
                          <span className="text-[10px] text-dark-secondary leading-none ml-0.5">
                            +{entry.badges.length - 4}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {entry.role && <RoleBadge role={entry.role} />}
                  <span className={clsx("text-sm font-semibold shrink-0", isMe ? "text-sprout-purple" : "text-dark-secondary")}>
                    {entry.score.toLocaleString()} pts
                  </span>
                </div>
              );
            })}
            {entries.length > 10 && (
              <p className="text-xs text-dark-secondary text-center pt-2">
                +{entries.length - 10} more — keep earning points to climb the ranks
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Rankings Tab ──────────────────────────────────────────────────────────────

function RankingsTab({
  leaderboards,
  loading,
  currentUserId,
}: {
  leaderboards: LeaderboardConfig[];
  loading: boolean;
  currentUserId: string | null;
}) {
  return (
    <>
      <OverallLeaderboard currentUserId={currentUserId} />
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-surface-border p-4 animate-pulse h-28" />
          ))}
        </div>
      ) : leaderboards.length === 0 ? (
        <div className="bg-white rounded-2xl border border-surface-border p-8 text-center">
          <Info className="w-8 h-8 text-blue-300 mx-auto mb-2" />
          <p className="text-dark font-medium mb-1">No specific leaderboards configured yet.</p>
          <p className="text-sm text-dark-secondary">Admins can add leaderboards under Settings → Leaderboards & Badges.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {leaderboards.map((lb) => (
            <LeaderboardCard key={lb.id} config={lb} />
          ))}
        </div>
      )}
    </>
  );
}

// ── My Badges Tab ─────────────────────────────────────────────────────────────

function badgeTierStyle(pts: number) {
  if (pts >= 400) return { gradient: "from-amber-100 to-yellow-50",   ring: "ring-amber-300/50",  accent: "text-amber-600",  label: "Gold"   };
  if (pts >= 150) return { gradient: "from-slate-100 to-blue-50",     ring: "ring-slate-300/50",  accent: "text-slate-500",  label: "Silver" };
  if (pts >= 50)  return { gradient: "from-orange-100 to-amber-50",   ring: "ring-orange-300/50", accent: "text-orange-600", label: "Bronze" };
  return           { gradient: "from-violet-100 to-purple-50",  ring: "ring-violet-300/50", accent: "text-violet-600", label: ""       };
}

function MyBadgesTab({
  badges,
  loading,
}: {
  badges: BadgeAward[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-2xl border border-surface-border overflow-hidden animate-pulse">
            <div className="h-28 bg-gray-100" />
            <div className="p-3 space-y-2">
              <div className="h-3 bg-gray-100 rounded w-3/4 mx-auto" />
              <div className="h-2 bg-gray-100 rounded w-1/2 mx-auto" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (badges.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-surface-border p-12 text-center">
        <span className="text-5xl block mb-3">🏅</span>
        <p className="text-dark font-medium mb-1">No badges yet</p>
        <p className="text-sm text-dark-secondary max-w-xs mx-auto">
          Complete tasks and report issues to earn your first badge!
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {badges.map((award) => {
        const cfg = award.badge_configs;
        const { gradient, ring, accent, label } = badgeTierStyle(cfg?.points_awarded ?? 0);
        return (
          <div key={award.id} className="bg-white rounded-2xl border border-surface-border overflow-hidden flex flex-col shadow-sm">
            {/* Gradient header with medallion */}
            <div className={`bg-gradient-to-br ${gradient} pt-6 pb-5 flex flex-col items-center gap-2`}>
              {label && (
                <span className="text-[9px] font-bold uppercase tracking-widest text-white/80 bg-white/20 rounded-full px-2 py-0.5">
                  {label}
                </span>
              )}
              <div className={`w-16 h-16 rounded-full bg-white/20 ring-4 ${ring} flex items-center justify-center shadow-lg`}>
                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                  <span className="text-2xl leading-none">{cfg?.icon ?? "🏅"}</span>
                </div>
              </div>
            </div>
            {/* Body */}
            <div className="px-3 py-3 flex flex-col gap-1.5 flex-1 text-center">
              <p className="font-bold text-dark text-xs leading-snug">{cfg?.name ?? "Badge"}</p>
              {cfg?.description && (
                <p className="text-[10px] text-dark-secondary line-clamp-2">{cfg.description}</p>
              )}
              <div className="mt-auto pt-1.5 flex items-center justify-center gap-2 flex-wrap">
                {(cfg?.points_awarded ?? 0) > 0 && (
                  <span className={`text-[10px] font-bold ${accent}`}>
                    +{cfg!.points_awarded} pts
                  </span>
                )}
                <span className="text-[10px] text-dark-secondary">
                  {new Date(award.awarded_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "rankings" | "my_badges";

export default function SafetyPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("rankings");
  const [leaderboards, setLeaderboards] = useState<LeaderboardConfig[]>([]);
  const [myBadges, setMyBadges] = useState<BadgeAward[]>([]);
  const [myPoints, setMyPoints] = useState<UserPoints | null>(null);
  const [loadingLb, setLoadingLb] = useState(true);
  const [loadingBadges, setLoadingBadges] = useState(true);
  const [error, setError] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        setCurrentUserId(data.session?.user?.id ?? null);
      });

    // Load leaderboards
    setLoadingLb(true);
    listLeaderboards()
      .then(setLeaderboards)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoadingLb(false));

    // Load badges and points concurrently — each failure is independent
    setLoadingBadges(true);
    Promise.all([
      listMyBadges().catch(() => [] as BadgeAward[]),
      getMyPoints().catch(() => null),
    ])
      .then(([badges, points]) => {
        setMyBadges(badges);
        setMyPoints(points as UserPoints | null);
      })
      .finally(() => setLoadingBadges(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { key: Tab; label: string }[] = [
    { key: "rankings",  label: t("leaderboard.tabRankings")  },
    { key: "my_badges", label: t("leaderboard.tabMyBadges")  },
  ];

  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sprout-purple/10 flex items-center justify-center shrink-0">
            <Trophy className="w-5 h-5 text-sprout-purple" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark leading-tight">{t("leaderboard.pageTitle")}</h1>
            <p className="text-sm text-dark-secondary">{t("leaderboard.pageSubtitle")}</p>
          </div>
        </div>
        {myPoints != null && (
          <div className="flex items-center gap-1.5 bg-white border border-surface-border rounded-full px-3 py-1.5 text-sm font-semibold text-sprout-purple shadow-sm shrink-0">
            <Trophy className="w-3.5 h-3.5" />
            {myPoints.total_points.toLocaleString()} pts
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-surface-border mb-6">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
              tab === key
                ? "border-sprout-purple text-sprout-purple"
                : "border-transparent text-dark-secondary hover:text-dark"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "rankings" && (
        <RankingsTab leaderboards={leaderboards} loading={loadingLb} currentUserId={currentUserId} />
      )}
      {tab === "my_badges" && (
        <MyBadgesTab badges={myBadges} loading={loadingBadges} />
      )}

    </div>
  );
}
