"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Timer, AlertTriangle, Clock, TrendingDown, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { apiFetch } from "@/services/api/client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend, Cell,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AgingSummary {
  total_open: number;
  avg_age_hours: number;
  sla_breach_count: number;
  sla_breach_pct: number;
}
interface AgingBucket { bucket: string; count: number; }
interface ByLocation { location_id: string; location_name: string; open_count: number; avg_age_hours: number; sla_breach_count: number; }
interface ByPriority { priority: string; open_count: number; avg_age_hours: number; sla_breach_count: number; oldest_age_hours?: number; }
interface ByCategory { category_id: string; category_name: string; open_count: number; avg_age_hours: number; sla_breach_count: number; sla_hours: number; }
interface ResolutionPeriod { period: string; avg_resolution_hours: number; total_resolved: number; }
interface ResolutionLocation { location_name: string; avg_resolution_hours: number; total_resolved: number; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatHours(h: number): string {
  if (h < 1) return "< 1h";
  if (h < 24) return `${Math.round(h)}h`;
  const d = Math.floor(h / 24);
  if (d <= 7) return `${d}d`;
  const w = Math.floor(d / 7);
  const r = d % 7;
  return r > 0 ? `${w}w ${r}d` : `${w}w`;
}

function today(): string { return new Date().toISOString().slice(0, 10); }
function thirtyDaysAgo(): string {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

const BUCKET_COLORS = ["#10B981","#00B4D8","#F59E0B","#FB923C","#EF4444"];
const inputCls = "border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30";

// ── Component ─────────────────────────────────────────────────────────────────
export default function AgingReportPage() {
  const [entity, setEntity] = useState<"tasks" | "issues">("issues");
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo());
  const [dateTo, setDateTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [summary, setSummary] = useState<AgingSummary | null>(null);
  const [buckets, setBuckets] = useState<AgingBucket[]>([]);
  const [byLocation, setByLocation] = useState<ByLocation[]>([]);
  const [byBreakdown, setByBreakdown] = useState<(ByPriority | ByCategory)[]>([]);
  const [resolution, setResolution] = useState<{ avg: number; median: number; by_period: ResolutionPeriod[]; by_location: ResolutionLocation[] } | null>(null);
  const [oldest, setOldest] = useState<{ id: string; title: string; age_hours: number; priority: string; status: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = `date_from=${dateFrom}&date_to=${dateTo}`;
    try {
      const [aging, res] = await Promise.all([
        apiFetch<Record<string, unknown>>(`/api/v1/reports/aging/${entity}?${params}`),
        apiFetch<Record<string, unknown>>(`/api/v1/reports/aging/resolution-time?entity_type=${entity}&${params}`),
      ]);
      setSummary(aging.summary as AgingSummary);
      setBuckets(aging.aging_buckets as AgingBucket[]);
      setByLocation(aging.by_location as ByLocation[]);
      if (entity === "issues") {
        setByBreakdown(aging.by_category as ByCategory[]);
      } else {
        setByBreakdown(aging.by_priority as ByPriority[]);
      }
      setResolution({
        avg: res.avg_resolution_hours as number,
        median: res.median_resolution_hours as number,
        by_period: res.by_period as ResolutionPeriod[],
        by_location: res.by_location as ResolutionLocation[],
      });
    } catch (e) {
      setError((e as Error).message || "Failed to load aging data");
    } finally {
      setLoading(false);
    }
  }, [entity, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const TT_STYLE = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12 };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard/insights?tab=reports" className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4 text-dark/60" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-dark flex items-center gap-2">
            <Timer className="w-5 h-5 text-red-500" /> Aging & SLA Report
          </h1>
          <p className="text-sm text-dark/50 mt-0.5">Open item age, SLA breach rates, and resolution trends</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center bg-white border border-surface-border rounded-xl p-4">
        {/* Entity toggle */}
        <div className="flex rounded-lg overflow-hidden border border-surface-border">
          {(["issues", "tasks"] as const).map((e) => (
            <button key={e} onClick={() => setEntity(e)}
              className={clsx("px-4 py-1.5 text-sm font-medium capitalize transition-colors",
                entity === e ? "bg-sprout-purple text-white" : "bg-white text-dark-secondary hover:bg-gray-50")}>
              {e === "issues" ? "Issues" : "Tasks"}
            </button>
          ))}
        </div>
        <input type="date" className={inputCls} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <span className="text-sm text-dark/40">to</span>
        <input type="date" className={inputCls} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-sprout-purple text-white hover:bg-sprout-purple/90 disabled:opacity-50">
          <RefreshCw className={clsx("w-3.5 h-3.5", loading && "animate-spin")} />
          {loading ? "Loading…" : "Load"}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Open", value: summary.total_open, icon: Clock, color: "text-blue-600", bg: "bg-blue-50" },
            { label: "Avg Age", value: formatHours(summary.avg_age_hours), icon: Timer, color: "text-purple-600", bg: "bg-purple-50" },
            { label: "SLA Breaches", value: summary.sla_breach_count, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
            { label: "Breach Rate", value: `${summary.sla_breach_pct}%`, icon: TrendingDown, color: "text-orange-600", bg: "bg-orange-50" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="bg-white border border-surface-border rounded-xl p-4 flex items-center gap-3">
              <div className={clsx("w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0", bg)}>
                <Icon className={clsx("w-5 h-5", color)} />
              </div>
              <div>
                <p className="text-xs text-dark/50">{label}</p>
                <p className="text-lg font-bold text-dark">{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Aging bucket bar chart */}
        <div className="bg-white border border-surface-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-dark mb-4">Aging Distribution</h2>
          {buckets.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={buckets} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#94A3B8" }} />
                <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} />
                <Tooltip contentStyle={TT_STYLE} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {buckets.map((_, i) => <Cell key={i} fill={BUCKET_COLORS[i] ?? "#6366F1"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-dark/40 py-8 text-center">No open items</p>}
        </div>

        {/* Resolution time trend */}
        <div className="bg-white border border-surface-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-dark mb-1">Avg Resolution Time</h2>
          {resolution && (
            <p className="text-xs text-dark/50 mb-3">
              Overall avg: <strong>{formatHours(resolution.avg)}</strong> · Median: <strong>{formatHours(resolution.median)}</strong>
            </p>
          )}
          {resolution && resolution.by_period.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={resolution.by_period} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#94A3B8" }} />
                <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: number) => formatHours(v)} />
                <Line type="monotone" dataKey="avg_resolution_hours" stroke="#7C3AED" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-dark/40 py-8 text-center">No resolved items in range</p>}
        </div>
      </div>

      {/* Tables row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By location */}
        <div className="bg-white border border-surface-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-dark mb-4">By Location</h2>
          {byLocation.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-dark/50 border-b border-surface-border">
                  <th className="pb-2 font-medium">Location</th>
                  <th className="pb-2 font-medium text-right">Open</th>
                  <th className="pb-2 font-medium text-right">Avg Age</th>
                  <th className="pb-2 font-medium text-right">Breaches</th>
                </tr>
              </thead>
              <tbody>
                {byLocation.slice(0, 10).map((row) => (
                  <tr key={row.location_id} className="border-b border-surface-border/50 last:border-0">
                    <td className="py-1.5 text-dark font-medium">{row.location_name}</td>
                    <td className="py-1.5 text-right text-dark/70">{row.open_count}</td>
                    <td className="py-1.5 text-right text-dark/70">{formatHours(row.avg_age_hours)}</td>
                    <td className="py-1.5 text-right">
                      {row.sla_breach_count > 0
                        ? <span className="text-red-600 font-semibold">{row.sla_breach_count}</span>
                        : <span className="text-green-600">0</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-dark/40 py-4 text-center">No data</p>}
        </div>

        {/* By category (issues) or by priority (tasks) */}
        <div className="bg-white border border-surface-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-dark mb-4">
            {entity === "issues" ? "By Category" : "By Priority"}
          </h2>
          {byBreakdown.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-dark/50 border-b border-surface-border">
                  <th className="pb-2 font-medium">{entity === "issues" ? "Category" : "Priority"}</th>
                  <th className="pb-2 font-medium text-right">Open</th>
                  <th className="pb-2 font-medium text-right">Avg Age</th>
                  <th className="pb-2 font-medium text-right">Breaches</th>
                </tr>
              </thead>
              <tbody>
                {byBreakdown.slice(0, 10).map((row, i) => {
                  const label = "category_name" in row ? row.category_name : row.priority;
                  return (
                    <tr key={i} className="border-b border-surface-border/50 last:border-0">
                      <td className="py-1.5 text-dark font-medium capitalize">{label}</td>
                      <td className="py-1.5 text-right text-dark/70">{row.open_count}</td>
                      <td className="py-1.5 text-right text-dark/70">{formatHours(row.avg_age_hours)}</td>
                      <td className="py-1.5 text-right">
                        {row.sla_breach_count > 0
                          ? <span className="text-red-600 font-semibold">{row.sla_breach_count}</span>
                          : <span className="text-green-600">0</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <p className="text-sm text-dark/40 py-4 text-center">No data</p>}
        </div>
      </div>
    </div>
  );
}
