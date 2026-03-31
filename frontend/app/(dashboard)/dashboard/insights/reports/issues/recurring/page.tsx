"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Download } from "lucide-react";
import { clsx } from "clsx";
import { apiFetch } from "@/services/api/client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface RecurringIssue {
  id: string;
  title: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "open" | "in_progress" | "pending_vendor" | "resolved" | "closed";
  recurrence_count: number;
  category_id: string;
  location_id: string;
  issue_categories: { name: string } | null;
  locations: { name: string } | null;
  created_at: string;
}

interface RecurringResponse {
  data: RecurringIssue[];
  total: number;
}

interface IssueSummaryResponse {
  total_issues?: number;
  total?: number;
  [key: string]: unknown;
}

// ─── Style constants ────────────────────────────────────────────────────────────
const TT_STYLE = { borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 };
const BAR_COLORS = ["#00B4D8", "#7C3AED", "#10B981", "#F59E0B", "#F43F5E", "#6366F1", "#FB923C"];

// ─── Helpers ───────────────────────────────────────────────────────────────────
function toYMD(d: Date) {
  return d.toISOString().slice(0, 10);
}

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  return { from: toYMD(from), to: toYMD(to) };
}

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function priorityBadge(priority: RecurringIssue["priority"]) {
  const map: Record<RecurringIssue["priority"], string> = {
    critical: "bg-red-50 text-red-600",
    high: "bg-orange-50 text-orange-600",
    medium: "bg-amber-50 text-amber-600",
    low: "bg-gray-100 text-gray-500",
  };
  return map[priority] ?? "bg-gray-100 text-gray-500";
}

function statusBadge(status: RecurringIssue["status"]) {
  const map: Record<RecurringIssue["status"], string> = {
    open: "bg-blue-50 text-blue-600",
    in_progress: "bg-purple-50 text-purple-600",
    pending_vendor: "bg-yellow-50 text-yellow-600",
    resolved: "bg-green-50 text-green-600",
    closed: "bg-green-50 text-green-600",
  };
  return map[status] ?? "bg-gray-100 text-gray-500";
}

function statusLabel(status: RecurringIssue["status"]) {
  const map: Record<RecurringIssue["status"], string> = {
    open: "Open",
    in_progress: "In Progress",
    pending_vendor: "Pending Vendor",
    resolved: "Resolved",
    closed: "Closed",
  };
  return map[status] ?? status;
}

function barColor(count: number) {
  if (count >= 10) return "#F43F5E"; // red
  if (count >= 5) return "#F59E0B";  // amber
  return "#FB923C";                  // orange
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function RecurringIssuesReportPage() {
  const router = useRouter();

  const [dateFrom, setDateFrom] = useState(defaultRange().from);
  const [dateTo, setDateTo] = useState(defaultRange().to);

  const [issues, setIssues] = useState<RecurringIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [recurring] = await Promise.all([
        apiFetch<RecurringResponse>("/api/v1/issues/dashboard/recurring"),
        // summary fetch — used only for future context, fetched in parallel
        apiFetch<IssueSummaryResponse>("/api/v1/issues/dashboard/summary").catch(() => null),
      ]);
      const raw = Array.isArray(recurring?.data) ? recurring.data : [];
      setIssues(raw);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Derived data ────────────────────────────────────────────────────────────
  const recurringIssues = issues.filter((i) => i.recurrence_count >= 2);
  const sortedByCount = [...recurringIssues].sort((a, b) => b.recurrence_count - a.recurrence_count);

  const maxRecurrence = recurringIssues.length > 0
    ? Math.max(...recurringIssues.map((i) => i.recurrence_count))
    : 0;

  // Most affected location
  const locationCounts: Record<string, number> = {};
  for (const i of recurringIssues) {
    const name = i.locations?.name ?? "Unknown";
    locationCounts[name] = (locationCounts[name] ?? 0) + 1;
  }
  const mostAffectedLocation = Object.entries(locationCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  // Most affected category
  const categoryCounts: Record<string, number> = {};
  for (const i of recurringIssues) {
    const name = i.issue_categories?.name ?? "Unknown";
    categoryCounts[name] = (categoryCounts[name] ?? 0) + 1;
  }
  const mostAffectedCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  // Top 10 for horizontal bar chart
  const top10 = sortedByCount.slice(0, 10).map((i) => ({
    title: truncate(i.title, 25),
    count: i.recurrence_count,
  }));

  // By category: sum recurrence_count, top 8
  const catSums: Record<string, number> = {};
  for (const i of recurringIssues) {
    const name = i.issue_categories?.name ?? "Unknown";
    catSums[name] = (catSums[name] ?? 0) + i.recurrence_count;
  }
  const categoryChartData = Object.entries(catSums)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, total]) => ({ name, total }));

  // ─── CSV export ──────────────────────────────────────────────────────────────
  function exportCsv() {
    if (!sortedByCount.length) return;
    const header = ["Issue", "Category", "Location", "Priority", "Status", "Recurrences"];
    const rows = sortedByCount.map((i) => [
      `"${i.title.replace(/"/g, '""')}"`,
      i.issue_categories?.name ?? "",
      i.locations?.name ?? "",
      i.priority,
      i.status,
      i.recurrence_count,
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `recurring-issues-${dateFrom}-${dateTo}.csv`;
    a.click();
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => router.push("/dashboard/insights?tab=reports")}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark/50 hover:text-dark transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
            <RefreshCw className="w-4 h-4 text-orange-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-dark">Recurring Issues Report</h1>
            <p className="text-xs text-dark/50">Issues reported multiple times across locations and categories</p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-dark/60 hover:bg-gray-200 transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white rounded-xl border border-surface-border p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-dark/50">Date From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-surface-border rounded-lg px-3 py-1.5 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-dark/50">Date To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-surface-border rounded-lg px-3 py-1.5 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
          />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-1.5 rounded-lg bg-sprout-purple text-white text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-50 transition-colors"
        >
          Load Report
        </button>
      </div>

      {/* ── Loading ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-12 text-dark/40 text-sm">
          Failed to load recurring issues report. Please try again.
        </div>
      ) : (
        <>
          {/* ── Summary cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{recurringIssues.length}</p>
              <p className="text-sm text-dark/50 mt-0.5">Total Recurring</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{maxRecurrence || "—"}</p>
              <p className="text-sm text-dark/50 mt-0.5">Highest Recurrence</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-xl font-bold text-dark truncate" title={mostAffectedLocation}>
                {mostAffectedLocation}
              </p>
              <p className="text-sm text-dark/50 mt-0.5">Most Affected Location</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-xl font-bold text-dark truncate" title={mostAffectedCategory}>
                {mostAffectedCategory}
              </p>
              <p className="text-sm text-dark/50 mt-0.5">Most Affected Category</p>
            </div>
          </div>

          {/* ── Chart 1: Top Recurring Issues (horizontal bar) ── */}
          <div className="bg-white rounded-xl border border-surface-border p-6">
            <h3 className="text-sm font-semibold text-dark mb-5">Top Recurring Issues</h3>
            {top10.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">No recurring issues found</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(240, top10.length * 38)}>
                <BarChart
                  data={top10}
                  layout="vertical"
                  margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="title"
                    width={170}
                    tick={{ fontSize: 11, fill: "#64748B" }}
                  />
                  <Tooltip
                    contentStyle={TT_STYLE}
                    formatter={(v) => [v, "Recurrences"]}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {top10.map((entry, i) => (
                      <Cell key={i} fill={barColor(entry.count)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Chart 2: By Category (vertical bar) ── */}
          <div className="bg-white rounded-xl border border-surface-border p-6">
            <h3 className="text-sm font-semibold text-dark mb-5">Recurrences by Category</h3>
            {categoryChartData.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">No category data available</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={categoryChartData}
                  margin={{ top: 5, right: 20, left: 0, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    angle={-30}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={TT_STYLE}
                    formatter={(v) => [v, "Total Recurrences"]}
                  />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                    {categoryChartData.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Table: Full Recurring Issues List ── */}
          <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-dark">Full Recurring Issues List</h3>
              <p className="text-xs text-dark/40 mt-0.5">{sortedByCount.length} issue{sortedByCount.length !== 1 ? "s" : ""} with 2+ recurrences</p>
            </div>
            {sortedByCount.length === 0 ? (
              <div className="py-12 text-center text-dark/40 text-sm">No recurring issues found</div>
            ) : (
              <div className="overflow-x-auto">
                <div className="max-h-[480px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 z-10">
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 uppercase tracking-wide whitespace-nowrap">Issue</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 uppercase tracking-wide whitespace-nowrap">Category</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 uppercase tracking-wide whitespace-nowrap">Location</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 uppercase tracking-wide whitespace-nowrap">Priority</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 uppercase tracking-wide whitespace-nowrap">Status</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-dark/50 uppercase tracking-wide whitespace-nowrap">Recurrences</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border">
                      {sortedByCount.map((issue) => (
                        <tr key={issue.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3 text-dark max-w-[240px]">
                            <span className="line-clamp-2 text-sm leading-snug">{issue.title}</span>
                          </td>
                          <td className="px-4 py-3 text-dark/60 whitespace-nowrap">
                            {issue.issue_categories?.name ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-dark/60 whitespace-nowrap">
                            {issue.locations?.name ?? "—"}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={clsx(
                                "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                                priorityBadge(issue.priority)
                              )}
                            >
                              {issue.priority}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={clsx(
                                "rounded-full px-2 py-0.5 text-xs font-medium",
                                statusBadge(issue.status)
                              )}
                            >
                              {statusLabel(issue.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <span className="font-bold text-dark">
                              {issue.recurrence_count}
                            </span>
                            {issue.recurrence_count >= 10 && (
                              <span className="ml-1" title="High recurrence">🔥</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
