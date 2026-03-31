"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Siren, Download, AlertTriangle, TrendingUp, MapPin } from "lucide-react";
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
interface Incident {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  location_id: string | null;
  reported_by: string;
  resolved_at: string | null;
  is_deleted: boolean;
  created_at: string;
  locations?: { name: string } | null;
  profiles?: { full_name: string } | null;
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
  from.setDate(from.getDate() - 90);
  return { from: toYMD(from), to: toYMD(to) };
}

function resolutionTime(created: string, resolved: string | null): string {
  if (!resolved) return "—";
  const diffMs = new Date(resolved).getTime() - new Date(created).getTime();
  if (diffMs <= 0) return "—";
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  return `${hours}h`;
}

const TT_STYLE = { borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 };
const BAR_COLORS = ["#EF4444", "#F97316", "#F59E0B", "#94A3B8", "#10B981", "#6366F1", "#00B4D8"];

const SEV_COLORS: Record<string, string> = {
  critical: "#EF4444",
  high: "#F97316",
  medium: "#F59E0B",
  low: "#94A3B8",
};

function sevBadge(severity: string) {
  switch (severity) {
    case "critical": return "bg-red-50 text-red-600";
    case "high":     return "bg-orange-50 text-orange-600";
    case "medium":   return "bg-amber-50 text-amber-600";
    default:         return "bg-gray-100 text-gray-500";
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "open":          return "bg-blue-50 text-blue-600";
    case "investigating": return "bg-purple-50 text-purple-600";
    case "resolved":
    case "closed":        return "bg-green-50 text-green-600";
    default:              return "bg-gray-100 text-gray-500";
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function IncidentReportsPage() {
  const router = useRouter();

  const [dateFrom, setDateFrom] = useState(defaultRange().from);
  const [dateTo, setDateTo] = useState(defaultRange().to);

  const [allIncidents, setAllIncidents] = useState<Incident[]>([]);
  const [filtered, setFiltered] = useState<Incident[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Fetch all incidents once (limit=500), then filter client-side
  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(false);
    try {
      const data = await apiFetch<Incident[]>("/api/v1/incidents?limit=500");
      const incidents = Array.isArray(data) ? data.filter((i) => !i.is_deleted) : [];
      setAllIncidents(incidents);
      applyFilter(incidents, from, to);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  function applyFilter(incidents: Incident[], from: string, to: string) {
    const fromDate = new Date(from);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    setFiltered(
      incidents.filter((i) => {
        const d = new Date(i.created_at);
        return d >= fromDate && d <= toDate;
      })
    );
  }

  useEffect(() => {
    load(dateFrom, dateTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLoadReport() {
    if (allIncidents.length > 0) {
      applyFilter(allIncidents, dateFrom, dateTo);
    } else {
      load(dateFrom, dateTo);
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const totalCount = filtered.length;
  const openCount = filtered.filter((i) => i.status === "open" || i.status === "investigating").length;
  const critHighCount = filtered.filter((i) => i.severity === "critical" || i.severity === "high").length;
  const resolvedCount = filtered.filter((i) => i.status === "resolved" || i.status === "closed").length;

  // Severity bar chart
  const SEV_ORDER = ["critical", "high", "medium", "low"];
  const sevMap: Record<string, number> = {};
  filtered.forEach((i) => {
    sevMap[i.severity] = (sevMap[i.severity] ?? 0) + 1;
  });
  const sevChartData = SEV_ORDER.filter((s) => sevMap[s] !== undefined).map((s) => ({
    severity: capitalize(s),
    _key: s,
    count: sevMap[s],
  }));

  // Time line chart — group by day
  const dayMap: Record<string, number> = {};
  filtered.forEach((i) => {
    const day = i.created_at.slice(0, 10);
    dayMap[day] = (dayMap[day] ?? 0) + 1;
  });
  const timeChartData = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  // Location bar chart — top 8
  const locMap: Record<string, number> = {};
  filtered.forEach((i) => {
    const name = i.locations?.name ?? null;
    if (name) locMap[name] = (locMap[name] ?? 0) + 1;
  });
  const locChartData = Object.entries(locMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  // Table — sorted newest first
  const tableRows = [...filtered].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // ── CSV export ────────────────────────────────────────────────────────────
  function exportCsv() {
    if (!filtered.length) return;
    const rows = filtered.map((i) => [
      `"${i.title.replace(/"/g, '""')}"`,
      `"${(i.locations?.name ?? "").replace(/"/g, '""')}"`,
      i.severity,
      i.status,
      `"${(i.profiles?.full_name ?? i.reported_by).replace(/"/g, '""')}"`,
      i.created_at,
      i.resolved_at ?? "",
    ]);
    const csv = [
      ["Title", "Location", "Severity", "Status", "Reporter", "Created At", "Resolved At"],
      ...rows,
    ]
      .map((r) => r.join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `incident-reports-${dateFrom}-${dateTo}.csv`;
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
          <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
            <Siren className="w-4.5 h-4.5 text-red-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-dark">Incident Reports</h1>
            <p className="text-xs text-dark/50">
              Incident log with severity, status, and resolution timeline
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

      {/* ── Date range filter ── */}
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
          onClick={handleLoadReport}
          disabled={loading}
          className="px-4 py-1.5 rounded-lg bg-sprout-purple text-white text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-50 transition-colors"
        >
          Load Report
        </button>
      </div>

      {/* ── Loading / Error ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-12 text-dark/40 text-sm">
          Failed to load incident data. Please try again.
        </div>
      ) : (
        <>
          {/* ── Summary cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{totalCount}</p>
              <p className="text-sm text-dark/50 mt-0.5">Total Incidents</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-blue-600">{openCount}</p>
              <p className="text-sm text-dark/50 mt-0.5">Open / Investigating</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-red-600">{critHighCount}</p>
              <p className="text-sm text-dark/50 mt-0.5">Critical / High</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-green-600">{resolvedCount}</p>
              <p className="text-sm text-dark/50 mt-0.5">Resolved</p>
            </div>
          </div>

          {/* ── Chart 1 — Incidents by Severity ── */}
          <div className="bg-white rounded-xl border border-surface-border p-6">
            <div className="flex items-center gap-2 mb-5">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-dark">Incidents by Severity</h3>
            </div>
            {sevChartData.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">
                No incidents in this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={sevChartData}
                  margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis
                    dataKey="severity"
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={TT_STYLE}
                    formatter={(v) => [v, "Incidents"]}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {sevChartData.map((entry, i) => (
                      <Cell key={i} fill={SEV_COLORS[entry._key] ?? BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Chart 2 — Incidents Over Time ── */}
          <div className="bg-white rounded-xl border border-surface-border p-6">
            <div className="flex items-center gap-2 mb-5">
              <TrendingUp className="w-4 h-4 text-red-400" />
              <h3 className="text-sm font-semibold text-dark">Incidents Over Time</h3>
            </div>
            {timeChartData.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">
                No trend data in this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart
                  data={timeChartData}
                  margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    tickFormatter={fmt}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={TT_STYLE}
                    labelFormatter={(l) => fmt(String(l))}
                    formatter={(v) => [v, "Incidents"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#EF4444"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Chart 3 — By Location ── */}
          <div className="bg-white rounded-xl border border-surface-border p-6">
            <div className="flex items-center gap-2 mb-5">
              <MapPin className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-dark">Incidents by Location</h3>
              <span className="ml-auto text-xs text-dark/40">Top 8</span>
            </div>
            {locChartData.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">
                No location data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, locChartData.length * 40)}>
                <BarChart
                  data={locChartData}
                  layout="vertical"
                  margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={TT_STYLE}
                    formatter={(v) => [v, "Incidents"]}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {locChartData.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Table — Incident List ── */}
          <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-border flex items-center gap-2">
              <h3 className="text-sm font-semibold text-dark">Incident List</h3>
              <span className="ml-auto text-xs text-dark/40">{tableRows.length} records</span>
            </div>
            {tableRows.length === 0 ? (
              <div className="py-12 text-center text-dark/40 text-sm">
                No incidents found in this date range
              </div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white border-b border-surface-border z-10">
                    <tr>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-dark/50 whitespace-nowrap">
                        Incident
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 whitespace-nowrap">
                        Location
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 whitespace-nowrap">
                        Severity
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 whitespace-nowrap">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 whitespace-nowrap">
                        Reporter
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 whitespace-nowrap">
                        Date
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 whitespace-nowrap">
                        Resolution Time
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {tableRows.map((incident) => (
                      <tr key={incident.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-3">
                          <p className="font-medium text-dark text-xs leading-snug max-w-[200px] truncate">
                            {incident.title}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-xs text-dark/60 whitespace-nowrap">
                          {incident.locations?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={clsx(
                              "px-2 py-0.5 rounded-full text-xs font-medium",
                              sevBadge(incident.severity)
                            )}
                          >
                            {capitalize(incident.severity)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={clsx(
                              "px-2 py-0.5 rounded-full text-xs font-medium",
                              statusBadge(incident.status)
                            )}
                          >
                            {capitalize(incident.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-dark/60 whitespace-nowrap">
                          {incident.profiles?.full_name ?? incident.reported_by}
                        </td>
                        <td className="px-4 py-3 text-xs text-dark/60 whitespace-nowrap">
                          {fmt(incident.created_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-dark/60 whitespace-nowrap">
                          {resolutionTime(incident.created_at, incident.resolved_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
