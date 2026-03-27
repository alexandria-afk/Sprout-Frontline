"use client";

import { useEffect, useState, useCallback } from "react";
import clsx from "clsx";
import {
  TrendingUp, AlertTriangle, Loader2, RefreshCw,
  MapPin, Calendar, Tag, Flag, ShieldAlert,
} from "lucide-react";
import {
  getIssueDashboardSummary,
  getIssuesByLocation,
  getRecurringIssues,
  listIssues,
} from "@/services/issues";
import type {
  IssueDashboardSummary,
  Issue,
  IssuePriority,
  IssueStatus,
} from "@/types";
import { friendlyError } from "@/lib/errors";

// ── Constants ────────────────────────────────────────────────────────────────

const inputCls =
  "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full";

const PRIORITY_CONFIG: Record<IssuePriority, { label: string; color: string; Icon: React.ElementType }> = {
  low:      { label: "Low",      color: "bg-gray-100 text-gray-500",   Icon: Flag       },
  medium:   { label: "Medium",   color: "bg-blue-100 text-blue-600",   Icon: Flag       },
  high:     { label: "High",     color: "bg-amber-100 text-amber-700", Icon: Flag       },
  critical: { label: "Critical", color: "bg-red-100 text-red-600",     Icon: ShieldAlert},
};

const STATUS_COLOR: Record<IssueStatus, string> = {
  open:             "bg-gray-100 text-gray-600",
  in_progress:      "bg-blue-100 text-blue-700",
  pending_vendor:   "bg-amber-100 text-amber-700",
  resolved:         "bg-green-100 text-green-700",
  verified_closed:  "bg-gray-100 text-gray-400",
};

const STATUS_LABELS: Record<IssueStatus, string> = {
  open:             "Open",
  in_progress:      "In Progress",
  pending_vendor:   "Pending Vendor",
  resolved:         "Resolved",
  verified_closed:  "Verified Closed",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
  icon: Icon,
  loading,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ElementType;
  loading: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-surface-border p-4 flex items-center gap-3">
      <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-dark-secondary truncate">{label}</p>
        {loading ? (
          <div className="h-7 w-12 bg-gray-200 rounded animate-pulse mt-0.5" />
        ) : (
          <p className="text-2xl font-bold text-dark">{value}</p>
        )}
      </div>
    </div>
  );
}

// ── Bar Chart Row ─────────────────────────────────────────────────────────────

function BarRow({
  label,
  count,
  maxCount,
  color,
}: {
  label: string;
  count: number;
  maxCount: number;
  color: string;
}) {
  const pct = maxCount > 0 ? Math.max(2, Math.round((count / maxCount) * 100)) : 2;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-dark w-32 truncate shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2.5">
        <div
          className={clsx("h-2.5 rounded-full transition-all duration-500", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-dark w-6 text-right shrink-0">{count}</span>
    </div>
  );
}

// ── Skeleton Bar ──────────────────────────────────────────────────────────────

function SkeletonBar() {
  return (
    <div className="flex items-center gap-3 animate-pulse">
      <div className="h-3 w-28 bg-gray-200 rounded shrink-0" />
      <div className="flex-1 bg-gray-100 rounded-full h-2.5" />
      <div className="h-3 w-5 bg-gray-100 rounded shrink-0" />
    </div>
  );
}

// ── Priority Badge ────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: IssuePriority }) {
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.medium;
  const Icon = cfg.Icon;
  return (
    <span className={clsx("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold", cfg.color)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ── Skeleton Table Row ────────────────────────────────────────────────────────

function SkeletonTableRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-4 py-3"><div className="h-3.5 w-40 bg-gray-200 rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-24 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3"><div className="h-5 w-8 bg-gray-100 rounded-full" /></td>
      <td className="px-4 py-3"><div className="h-5 w-14 bg-gray-100 rounded-full" /></td>
      <td className="px-4 py-3"><div className="h-5 w-14 bg-gray-100 rounded-full" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function IssueDashboardPage() {
  const [summary, setSummary]         = useState<IssueDashboardSummary | null>(null);
  const [locationData, setLocationData] = useState<Array<{ location_id: string; location_name: string; count: number }>>([]);
  const [recurringIssues, setRecurringIssues] = useState<Issue[]>([]);
  const [resolvedToday, setResolvedToday] = useState(0);
  const [recurringCount, setRecurringCount] = useState(0);

  const [loadingSummary,  setLoadingSummary]  = useState(true);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [loadingRecurring, setLoadingRecurring] = useState(true);

  const [error, setError] = useState("");

  // Date range
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo,   setDateTo]   = useState(today);

  const loadAll = useCallback(async () => {
    setError("");
    setLoadingSummary(true);
    setLoadingLocation(true);
    setLoadingRecurring(true);

    // Summary + location + recurring in parallel
    const [summaryRes, locationRes, recurringRes, resolvedRes] = await Promise.allSettled([
      getIssueDashboardSummary(),
      getIssuesByLocation(),
      getRecurringIssues(1, 50),
      listIssues({ status: "resolved", from: today, to: today, page_size: 200 }),
    ]);

    if (summaryRes.status === "fulfilled") {
      setSummary(summaryRes.value);
    } else {
      setError(friendlyError(summaryRes.reason));
    }
    setLoadingSummary(false);

    if (locationRes.status === "fulfilled") {
      setLocationData(locationRes.value);
    }
    setLoadingLocation(false);

    if (recurringRes.status === "fulfilled") {
      setRecurringIssues(recurringRes.value.data);
      setRecurringCount(recurringRes.value.total);
    }
    setLoadingRecurring(false);

    if (resolvedRes.status === "fulfilled") {
      setResolvedToday(resolvedRes.value.total);
    }
  }, [today]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const categoryData = summary?.by_category ?? [];
  const maxCategory  = categoryData.reduce((m, c) => Math.max(m, c.count), 0);
  const maxLocation  = locationData.reduce((m, l) => Math.max(m, l.count), 0);

  const filteredRecurring = recurringIssues.filter((i) => {
    if (dateFrom && i.created_at < dateFrom) return false;
    if (dateTo   && i.created_at > dateTo + "T23:59:59") return false;
    return true;
  });

  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      <div className="flex flex-col gap-5 md:gap-6 max-w-5xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sprout-green/10 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-sprout-green" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-dark">Issue Dashboard</h1>
              <p className="text-sm text-dark-secondary">Overview and analytics</p>
            </div>
          </div>

          {/* Date range */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-dark-secondary shrink-0" />
              <input
                type="date"
                className="border border-surface-border rounded-lg px-3 py-1.5 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <span className="text-xs text-dark-secondary">to</span>
            <input
              type="date"
              className="border border-surface-border rounded-lg px-3 py-1.5 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard
            label="Total Open"
            value={summary?.total_open ?? 0}
            color="bg-blue-100 text-blue-600"
            icon={AlertTriangle}
            loading={loadingSummary}
          />
          <StatCard
            label="In Progress"
            value={summary?.total_in_progress ?? 0}
            color="bg-amber-100 text-amber-600"
            icon={RefreshCw}
            loading={loadingSummary}
          />
          <StatCard
            label="Resolved Today"
            value={resolvedToday}
            color="bg-green-100 text-green-600"
            icon={TrendingUp}
            loading={loadingSummary}
          />
          <StatCard
            label="Recurring Issues"
            value={recurringCount}
            color="bg-orange-100 text-orange-600"
            icon={RefreshCw}
            loading={loadingRecurring}
          />
        </div>

        {/* Charts row */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* By category */}
          <div className="bg-white rounded-2xl border border-surface-border p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-dark-secondary" />
              <h2 className="text-sm font-semibold text-dark">Issues by Category</h2>
            </div>
            <div className="flex flex-col gap-3">
              {loadingSummary ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonBar key={i} />)
              ) : categoryData.length === 0 ? (
                <p className="text-xs text-dark-secondary py-4 text-center">No data available.</p>
              ) : (
                categoryData
                  .sort((a, b) => b.count - a.count)
                  .map((item) => (
                    <BarRow
                      key={item.category_id}
                      label={item.category_name}
                      count={item.count}
                      maxCount={maxCategory}
                      color="bg-sprout-purple"
                    />
                  ))
              )}
            </div>
          </div>

          {/* By location */}
          <div className="bg-white rounded-2xl border border-surface-border p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-dark-secondary" />
              <h2 className="text-sm font-semibold text-dark">Issues by Location</h2>
            </div>
            <div className="flex flex-col gap-3">
              {loadingLocation ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonBar key={i} />)
              ) : locationData.length === 0 ? (
                <p className="text-xs text-dark-secondary py-4 text-center">No data available.</p>
              ) : (
                locationData
                  .sort((a, b) => b.count - a.count)
                  .map((item) => (
                    <BarRow
                      key={item.location_id}
                      label={item.location_name}
                      count={item.count}
                      maxCount={maxLocation}
                      color="bg-sprout-green"
                    />
                  ))
              )}
            </div>
          </div>
        </div>

        {/* Recurring issues table */}
        <div className="bg-white rounded-2xl border border-surface-border flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-surface-border">
            <RefreshCw className="w-4 h-4 text-orange-500" />
            <h2 className="text-sm font-semibold text-dark">Recurring Issues</h2>
            {!loadingRecurring && (
              <span className="ml-auto text-xs text-dark-secondary bg-orange-50 text-orange-600 rounded-full px-2 py-0.5 font-medium">
                {filteredRecurring.length} shown
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-gray-50">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-secondary">Title</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-secondary">Location</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-secondary">Category</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-secondary">Count</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-secondary">Priority</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-secondary">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-dark-secondary">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {loadingRecurring ? (
                  Array.from({ length: 5 }).map((_, i) => <SkeletonTableRow key={i} />)
                ) : filteredRecurring.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <RefreshCw className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-xs text-dark-secondary">No recurring issues found.</p>
                    </td>
                  </tr>
                ) : (
                  filteredRecurring.map((issue) => (
                    <tr key={issue.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-dark line-clamp-1 max-w-[200px]">{issue.title}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 text-xs text-dark-secondary">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate max-w-[100px]">
                            {issue.location_description ?? issue.locations?.name ?? "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {issue.issue_categories ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: issue.issue_categories.color ?? "#6B7280" }}
                            />
                            <span className="text-xs text-dark truncate max-w-[100px]">
                              {issue.issue_categories.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-dark-secondary">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-600">
                          ×{issue.recurrence_count}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <PriorityBadge priority={issue.priority} />
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold", STATUS_COLOR[issue.status])}>
                          {STATUS_LABELS[issue.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-dark-secondary whitespace-nowrap">{formatDate(issue.created_at)}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
