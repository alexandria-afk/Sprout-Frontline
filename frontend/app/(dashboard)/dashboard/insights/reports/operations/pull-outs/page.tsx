"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  PackageX,
  Download,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { clsx } from "clsx";
import { apiFetch } from "@/services/api/client";
import {
  LineChart,
  Line,
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
interface PullOutSummary {
  total_submissions: number;
  total_quantity: number;
  top_category: string | null;
  top_reason: string | null;
}

interface TrendPoint {
  date: string;
  count: number;
}

interface TopItem {
  item_name: string;
  total_quantity: number;
  submission_count: number;
}

interface AnomalyDay {
  date: string;
  count: number;
  average: number;
  deviation: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmt(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString("default", { month: "short", day: "numeric" });
}

function toYMD(d: Date) {
  return d.toISOString().slice(0, 10);
}

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: toYMD(from), to: toYMD(to) };
}

const BAR_COLORS = [
  "#00B4D8","#7C3AED","#10B981","#F59E0B","#F43F5E","#6366F1","#FB923C",
];

const TT_STYLE = {
  borderRadius: 8,
  border: "1px solid #E2E8F0",
  fontSize: 12,
};

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function PullOutsReportPage() {
  const router = useRouter();

  const [dateFrom, setDateFrom] = useState(defaultRange().from);
  const [dateTo,   setDateTo]   = useState(defaultRange().to);

  const [summary,   setSummary]   = useState<PullOutSummary | null>(null);
  const [trends,    setTrends]    = useState<TrendPoint[]>([]);
  const [topItems,  setTopItems]  = useState<TopItem[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyDay[]>([]);

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(false);
    const p = new URLSearchParams({ date_from: from, date_to: to });
    try {
      const [sum, tre, top, ano] = await Promise.all([
        apiFetch<PullOutSummary>(`/api/v1/reports/pull-outs/summary?${p}`),
        apiFetch<TrendPoint[]>(`/api/v1/reports/pull-outs/trends?${p}`),
        apiFetch<TopItem[]>(`/api/v1/reports/pull-outs/top-items?${p}`),
        apiFetch<AnomalyDay[]>(`/api/v1/reports/pull-outs/anomalies?${p}`),
      ]);
      setSummary(sum);
      setTrends(Array.isArray(tre) ? tre : []);
      setTopItems(Array.isArray(top) ? top : []);
      setAnomalies(Array.isArray(ano) ? ano : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load on mount with default range
  useEffect(() => {
    load(dateFrom, dateTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLoadReport() {
    load(dateFrom, dateTo);
  }

  function exportCsv() {
    if (!topItems.length) return;
    const rows = topItems.map((t) => [t.item_name, t.total_quantity, t.submission_count]);
    const csv = [["Item", "Total Qty", "Submissions"], ...rows]
      .map((r) => r.join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `pull-outs-${dateFrom}-${dateTo}.csv`;
    a.click();
  }

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
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            <PackageX className="w-4.5 h-4.5 text-blue-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-dark">Pull-Out &amp; Wastage Report</h1>
            <p className="text-xs text-dark/50">Track wastage by item, reason, and trend</p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-dark/60 hover:bg-gray-200 transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
      </div>

      {/* ── Date range filter ── */}
      <div className="bg-white rounded-xl border border-surface-border p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-dark/50">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-surface-border rounded-lg px-3 py-1.5 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-dark/50">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-surface-border rounded-lg px-3 py-1.5 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
          />
        </div>
        <button
          onClick={handleLoadReport}
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
          Failed to load pull-out report. Please try again.
        </div>
      ) : (
        <>
          {/* ── 1. Summary cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{summary?.total_submissions ?? 0}</p>
              <p className="text-sm text-dark/50 mt-0.5">Total Submissions</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{summary?.total_quantity ?? 0}</p>
              <p className="text-sm text-dark/50 mt-0.5">Total Quantity</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-xl font-bold text-dark truncate">{summary?.top_category ?? "—"}</p>
              <p className="text-sm text-dark/50 mt-0.5">Top Category</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-xl font-bold text-dark truncate">{summary?.top_reason ?? "—"}</p>
              <p className="text-sm text-dark/50 mt-0.5">Top Reason</p>
            </div>
          </div>

          {/* ── 2. Trends chart ── */}
          <div className="bg-white rounded-xl border border-surface-border p-6">
            <div className="flex items-center gap-2 mb-5">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <h3 className="text-sm font-semibold text-dark">Pull-Out Count Over Time</h3>
            </div>
            {trends.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">No trend data in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trends} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    tickFormatter={fmt}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={TT_STYLE}
                    labelFormatter={(l) => fmt(String(l))}
                    formatter={(v) => [v, "Pull-outs"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#00B4D8"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── 3. Top Items ── */}
          <div className="bg-white rounded-xl border border-surface-border p-6">
            <h3 className="text-sm font-semibold text-dark mb-5">Top Pulled-Out Items</h3>
            {topItems.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">No items in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, topItems.length * 36)}>
                <BarChart
                  data={topItems}
                  layout="vertical"
                  margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#94A3B8" }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="item_name"
                    width={130}
                    tick={{ fontSize: 11, fill: "#64748B" }}
                  />
                  <Tooltip
                    contentStyle={TT_STYLE}
                    formatter={(v, n) => [v, n === "total_quantity" ? "Qty" : "Submissions"]}
                  />
                  <Bar dataKey="total_quantity" name="total_quantity" radius={[0, 4, 4, 0]}>
                    {topItems.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── 4. Anomaly Alerts ── */}
          <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-border flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-dark">Anomaly Alerts</h3>
              <span className="ml-auto text-xs text-dark/40">Days with unusually high pull-outs</span>
            </div>
            {anomalies.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">No anomalies detected in this period</div>
            ) : (
              <div className="divide-y divide-surface-border">
                {anomalies.map((a) => {
                  const pct = a.average > 0 ? Math.round(((a.count - a.average) / a.average) * 100) : 0;
                  const severity = pct >= 100 ? "critical" : pct >= 50 ? "warning" : "info";
                  return (
                    <div key={a.date} className="flex items-center gap-4 px-6 py-3 hover:bg-gray-50/50">
                      <div className="w-24 shrink-0">
                        <p className="text-xs font-medium text-dark">{fmt(a.date)}</p>
                        <p className="text-xs text-dark/40">{a.date}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={clsx(
                              "text-xl font-bold",
                              severity === "critical" ? "text-red-500" :
                              severity === "warning"  ? "text-amber-500" :
                              "text-blue-500"
                            )}
                          >
                            {a.count}
                          </span>
                          <span className="text-xs text-dark/40">pull-outs</span>
                          <span
                            className={clsx(
                              "ml-auto px-2 py-0.5 rounded-full text-xs font-semibold",
                              severity === "critical" ? "bg-red-50 text-red-600" :
                              severity === "warning"  ? "bg-amber-50 text-amber-600" :
                              "bg-blue-50 text-blue-600"
                            )}
                          >
                            +{pct}% vs avg
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={clsx(
                              "h-full rounded-full",
                              severity === "critical" ? "bg-red-400" :
                              severity === "warning"  ? "bg-amber-400" :
                              "bg-blue-400"
                            )}
                            style={{ width: `${Math.min(100, (a.count / (a.average * 2)) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-dark/40">avg {a.average.toFixed(1)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
