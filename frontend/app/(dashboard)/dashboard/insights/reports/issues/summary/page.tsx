"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, Download } from "lucide-react";
import { clsx } from "clsx";
import {
  listIssues,
  listIssueCategories,
  getIssueTrends,
} from "@/services/issues";
import { listLocations } from "@/services/users";
import type { Issue, IssueCategory } from "@/types";
import type { Location } from "@/services/users";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const DATE_RANGES = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
  { label: "Last 90 days", days: 90 },
];

const PRIORITY_COLOR: Record<string, string> = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-blue-50 text-blue-700",
  high: "bg-orange-50 text-orange-700",
  critical: "bg-red-50 text-red-700",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-red-50 text-red-600",
  in_progress: "bg-blue-50 text-blue-700",
  pending_vendor: "bg-yellow-50 text-yellow-700",
  resolved: "bg-green-50 text-green-700",
  verified_closed: "bg-gray-100 text-gray-500",
};

export default function IssueSummaryReportPage() {
  const router = useRouter();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(30);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [categories, setCategories] = useState<IssueCategory[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [trends, setTrends] = useState<{ date: string; count: number }[]>([]);

  useEffect(() => {
    listIssueCategories()
      .then((r) => setCategories(r.data ?? []))
      .catch(() => {});
    listLocations().then(setLocations).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - rangeDays);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    Promise.all([
      listIssues({
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        category_id: categoryFilter || undefined,
        location_id: locationFilter || undefined,
        from: fromStr,
        to: toStr,
        page_size: 200,
      }),
      getIssueTrends({
        category_id: categoryFilter || undefined,
        location_id: locationFilter || undefined,
        from: fromStr,
        to: toStr,
      }),
    ])
      .then(([issuesRes, trendsRes]) => {
        setIssues(issuesRes.data ?? []);
        setTrends(trendsRes ?? []);
      })
      .catch(() => {
        setIssues([]);
        setTrends([]);
      })
      .finally(() => setLoading(false));
  }, [rangeDays, statusFilter, priorityFilter, categoryFilter, locationFilter]);

  function exportCsv() {
    if (!issues.length) return;
    const rows = issues.map((i) => [
      `"${i.title.replace(/"/g, '""')}"`,
      i.priority,
      i.status,
      i.issue_categories?.name ?? "",
      i.locations?.name ?? "",
      i.resolved_at ? new Date(i.resolved_at).toLocaleDateString() : "",
      new Date(i.created_at).toLocaleDateString(),
    ]);
    const csv = [
      [
        "Title",
        "Priority",
        "Status",
        "Category",
        "Location",
        "Resolved",
        "Created",
      ],
      ...rows,
    ]
      .map((r) => r.join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "issues-summary.csv";
    a.click();
  }

  const total = issues.length;
  const open = issues.filter((i) => i.status === "open").length;
  const inProgress = issues.filter((i) => i.status === "in_progress").length;
  const resolved = issues.filter((i) =>
    ["resolved", "verified_closed"].includes(i.status)
  ).length;
  const critical = issues.filter((i) => i.priority === "critical").length;

  // Thin trend data to max 30 points for readability
  const trendData =
    trends.length > 30
      ? trends.filter((_, i) => i % Math.ceil(trends.length / 30) === 0)
      : trends;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => router.push("/dashboard/insights?tab=reports")}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark/50 hover:text-dark transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-dark">
              Issue Summary Report
            </h1>
            <p className="text-xs text-dark/50">
              Volume, status breakdown, and daily trends
            </p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-dark/60 hover:bg-gray-200 transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {DATE_RANGES.map((r) => (
          <button
            key={r.days}
            onClick={() => setRangeDays(r.days)}
            className={clsx(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              rangeDays === r.days
                ? "bg-sprout-purple text-white border-sprout-purple"
                : "border-surface-border text-dark-secondary hover:border-sprout-purple"
            )}
          >
            {r.label}
          </button>
        ))}

        <div className="h-4 w-px bg-surface-border mx-1 hidden sm:block" />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs border border-surface-border bg-white text-dark-secondary focus:outline-none"
        >
          <option value="">All statuses</option>
          {[
            "open",
            "in_progress",
            "pending_vendor",
            "resolved",
            "verified_closed",
          ].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs border border-surface-border bg-white text-dark-secondary focus:outline-none"
        >
          <option value="">All priorities</option>
          {["low", "medium", "high", "critical"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs border border-surface-border bg-white text-dark-secondary focus:outline-none"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {locations.length > 0 && (
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs border border-surface-border bg-white text-dark-secondary focus:outline-none"
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{total}</p>
              <p className="text-sm text-dark/50 mt-0.5">Total</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-red-500">{open}</p>
              <p className="text-sm text-dark/50 mt-0.5">Open</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-blue-600">{inProgress}</p>
              <p className="text-sm text-dark/50 mt-0.5">In Progress</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-green-600">{resolved}</p>
              <p className="text-sm text-dark/50 mt-0.5">Resolved</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-red-600">{critical}</p>
              <p className="text-sm text-dark/50 mt-0.5">Critical</p>
            </div>
          </div>

          {/* Daily trend chart */}
          {trendData.length > 0 && (
            <div className="bg-white rounded-xl border border-surface-border p-6">
              <h3 className="text-sm font-semibold text-dark mb-5">
                Daily Issue Volume
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={trendData}
                  margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                >
                  <defs>
                    <linearGradient
                      id="issueTrendGrad"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#F97316"
                        stopOpacity={0.9}
                      />
                      <stop
                        offset="100%"
                        stopColor="#FB923C"
                        stopOpacity={0.5}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    tickFormatter={(v) => {
                      const d = new Date(v);
                      return `${d.toLocaleString("default", {
                        month: "short",
                      })} ${d.getDate()}`;
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #E2E8F0",
                      fontSize: 12,
                    }}
                    formatter={(v) => [v ?? 0, "Issues"] as [number, string]}
                    labelFormatter={(l) => new Date(l).toLocaleDateString()}
                  />
                  <Bar
                    dataKey="count"
                    fill="url(#issueTrendGrad)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Data table */}
          {issues.length === 0 ? (
            <div className="bg-white rounded-xl border border-surface-border p-16 text-center text-dark/40">
              No issues in this period
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-border bg-gray-50">
                      {[
                        "Title",
                        "Priority",
                        "Status",
                        "Category",
                        "Location",
                        "Created",
                      ].map((h) => (
                        <th
                          key={h}
                          className={clsx(
                            "px-4 py-3 text-xs font-semibold text-dark/50",
                            ["Title", "Category", "Location"].includes(h)
                              ? "text-left"
                              : "text-center"
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {issues.map((i) => (
                      <tr key={i.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-medium text-dark max-w-[200px] truncate">
                          {i.title}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={clsx(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize",
                              PRIORITY_COLOR[i.priority] ??
                                "bg-gray-100 text-gray-600"
                            )}
                          >
                            {i.priority}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={clsx(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                              STATUS_COLOR[i.status] ??
                                "bg-gray-100 text-gray-600"
                            )}
                          >
                            {i.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-dark/50 text-xs">
                          {i.issue_categories?.name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-dark/50 text-xs">
                          {i.locations?.name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center text-dark/50 text-xs">
                          {new Date(i.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-surface-border bg-gray-50/50">
                <p className="text-xs text-dark/40">
                  Showing {issues.length} issue
                  {issues.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
