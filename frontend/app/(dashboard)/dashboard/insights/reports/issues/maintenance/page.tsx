"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wrench, Download, TrendingUp, DollarSign } from "lucide-react";
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

interface MaintenanceReportSummary {
  total_cost: number;
  open_count: number;
  resolved_count: number;
  avg_cost: number;
  total_count: number;
}

interface ByLocationRow {
  location_name: string;
  total_cost: number;
  count: number;
}

interface ByAssetRow {
  asset_id: string;
  asset_name: string;
  total_cost: number;
  issue_count: number;
}

interface ByMonthRow {
  month: string;
  total_cost: number;
  count: number;
}

interface IssueRow {
  id: string;
  title: string;
  priority: string;
  status: string;
  cost: number | null;
  created_at: string;
  resolved_at: string | null;
  location_name: string;
  asset_name: string;
  category_name: string;
}

interface MaintenanceReport {
  summary: MaintenanceReportSummary;
  by_location: ByLocationRow[];
  by_asset: ByAssetRow[];
  by_month: ByMonthRow[];
  issues: IssueRow[];
}

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

function formatCost(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("default", { month: "short", year: "2-digit" });
}

const TT_STYLE = { borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 };
const BAR_COLORS = ["#F59E0B", "#7C3AED", "#10B981", "#00B4D8", "#F43F5E", "#6366F1", "#FB923C"];

function priorityBadge(p: string) {
  if (p === "critical") return "bg-red-50 text-red-600";
  if (p === "high") return "bg-orange-50 text-orange-600";
  if (p === "medium") return "bg-amber-50 text-amber-600";
  return "bg-gray-100 text-gray-500";
}

function statusBadge(s: string) {
  if (s === "open") return "bg-blue-50 text-blue-600";
  if (s === "in_progress" || s === "pending_vendor") return "bg-purple-50 text-purple-600";
  if (s === "resolved" || s === "closed" || s === "verified_closed") return "bg-green-50 text-green-600";
  return "bg-gray-100 text-gray-500";
}

function humanStatus(s: string) {
  const map: Record<string, string> = {
    open: "Open",
    in_progress: "In Progress",
    pending_vendor: "Pending Vendor",
    resolved: "Resolved",
    closed: "Closed",
    verified_closed: "Verified Closed",
  };
  return map[s] ?? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Custom tooltip for Asset chart ────────────────────────────────────────────

interface AssetTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  assetData: Array<{ name: string; cost: number; issue_count: number }>;
}

function AssetTooltip({ active, payload, label, assetData }: AssetTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = assetData.find((r) => r.name === label);
  return (
    <div style={TT_STYLE} className="bg-white px-3 py-2 shadow-sm">
      <p className="font-semibold text-dark text-xs mb-1">{label}</p>
      <p className="text-xs text-dark/60">
        Cost: <span className="font-medium text-dark">₱{formatCost(payload[0]?.value ?? 0)}</span>
      </p>
      {row && (
        <p className="text-xs text-dark/60">
          Issues: <span className="font-medium text-dark">{row.issue_count}</span>
        </p>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function MaintenanceCostsReportPage() {
  const router = useRouter();

  const [dateFrom, setDateFrom] = useState(defaultRange().from);
  const [dateTo, setDateTo] = useState(defaultRange().to);

  const [report, setReport] = useState<MaintenanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const data = await apiFetch<MaintenanceReport>(`/api/v1/reports/maintenance-issues?${q.toString()}`);
      setReport(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived chart data ────────────────────────────────────────────────────────

  const locationData = report
    ? [...report.by_location]
        .sort((a, b) => b.total_cost - a.total_cost)
        .slice(0, 8)
        .map((r) => ({ name: r.location_name, cost: r.total_cost, count: r.count }))
    : [];

  const assetData = report
    ? [...report.by_asset]
        .sort((a, b) => b.total_cost - a.total_cost)
        .slice(0, 10)
        .map((r) => ({ name: r.asset_name, cost: r.total_cost, issue_count: r.issue_count }))
    : [];

  const monthData = report
    ? [...report.by_month]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((r) => ({ month: r.month, label: fmtMonth(r.month), cost: r.total_cost }))
    : [];

  const tableRows = report
    ? [...report.issues].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
    : [];

  const summary = report?.summary ?? { total_cost: 0, open_count: 0, resolved_count: 0, avg_cost: 0, total_count: 0 };

  // ── CSV export ────────────────────────────────────────────────────────────────

  function exportCsv() {
    if (!tableRows.length) return;
    const header = ["Title", "Asset", "Location", "Category", "Priority", "Status", "Cost", "Date"];
    const rows = tableRows.map((t) => [
      `"${t.title.replace(/"/g, '""')}"`,
      `"${t.asset_name.replace(/"/g, '""')}"`,
      `"${t.location_name.replace(/"/g, '""')}"`,
      `"${t.category_name.replace(/"/g, '""')}"`,
      t.priority,
      t.status,
      t.cost != null ? t.cost.toFixed(2) : "",
      t.created_at.slice(0, 10),
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `maintenance-costs-${dateFrom}-${dateTo}.csv`;
    a.click();
  }

  // ─────────────────────────────────────────────────────────────────────────────

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
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
            <Wrench className="w-5 h-5 text-amber-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-dark">Maintenance Costs Report</h1>
            <p className="text-xs text-dark/50">Repair and maintenance costs by asset, location, and trend</p>
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

      {/* ── Loading / Error ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-12 text-dark/40 text-sm">
          Failed to load maintenance report. Please try again.
        </div>
      ) : (
        <>
          {/* ── Summary cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <div className="flex items-center gap-1.5 mb-1">
                <DollarSign className="w-4 h-4 text-amber-500" />
                <p className="text-xs text-dark/50 font-medium">Total Cost</p>
              </div>
              <p className="text-xl font-bold text-dark">₱{formatCost(summary.total_cost)}</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{summary.open_count}</p>
              <p className="text-sm text-dark/50 mt-0.5">Open Issues</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-xl font-bold text-dark truncate">₱{formatCost(summary.avg_cost)}</p>
              <p className="text-sm text-dark/50 mt-0.5">Avg Cost per Issue</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{summary.resolved_count}</p>
              <p className="text-sm text-dark/50 mt-0.5">Resolved</p>
            </div>
          </div>

          {/* ── Chart 1 — Cost by Location ── */}
          <div className="bg-white rounded-xl border border-surface-border p-6">
            <h3 className="text-sm font-semibold text-dark mb-5">Cost by Location</h3>
            {locationData.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">No data in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, locationData.length * 40)}>
                <BarChart
                  data={locationData}
                  layout="vertical"
                  margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    tickFormatter={(v: number) => `₱${v.toLocaleString(undefined)}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fontSize: 11, fill: "#64748B" }}
                  />
                  <Tooltip
                    contentStyle={TT_STYLE}
                    formatter={(v: unknown) => [`₱${formatCost(v as number)}`, "Cost"]}
                  />
                  <Bar dataKey="cost" name="Cost" radius={[0, 4, 4, 0]}>
                    {locationData.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Chart 2 — Cost by Asset ── */}
          <div className="bg-white rounded-xl border border-surface-border p-6">
            <h3 className="text-sm font-semibold text-dark mb-5">Cost by Asset (Top 10)</h3>
            {assetData.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">No asset data available</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(220, assetData.length * 40)}>
                <BarChart
                  data={assetData}
                  layout="vertical"
                  margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    tickFormatter={(v: number) => `₱${v.toLocaleString(undefined)}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fontSize: 11, fill: "#64748B" }}
                  />
                  <Tooltip
                    contentStyle={TT_STYLE}
                    content={(props) => (
                      <AssetTooltip
                        active={props.active}
                        payload={props.payload as Array<{ value: number }> | undefined}
                        label={props.label as string | undefined}
                        assetData={assetData}
                      />
                    )}
                  />
                  <Bar dataKey="cost" name="cost" radius={[0, 4, 4, 0]}>
                    {assetData.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Chart 3 — Monthly Cost Trend ── */}
          <div className="bg-white rounded-xl border border-surface-border p-6">
            <div className="flex items-center gap-2 mb-5">
              <TrendingUp className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-dark">Monthly Cost Trend</h3>
            </div>
            {monthData.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">No trend data in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={monthData} margin={{ top: 5, right: 24, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94A3B8" }} />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    tickFormatter={(v: number) => `₱${v.toLocaleString(undefined)}`}
                    width={80}
                  />
                  <Tooltip
                    contentStyle={TT_STYLE}
                    formatter={(v: unknown) => [`₱${formatCost(v as number)}`, "Cost"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke="#F59E0B"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#F59E0B" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Issue Table ── */}
          <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-dark">Issue List</h3>
              <span className="text-xs text-dark/40">
                {tableRows.length} issue{tableRows.length !== 1 ? "s" : ""}
              </span>
            </div>
            {tableRows.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">No issues in this period</div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 border-b border-surface-border z-10">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold text-dark/50">Title</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-dark/50">Asset</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-dark/50">Location</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-dark/50">Category</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-dark/50">Priority</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-dark/50">Status</th>
                      <th className="text-right px-4 py-2.5 font-semibold text-dark/50">Cost</th>
                      <th className="text-right px-4 py-2.5 font-semibold text-dark/50">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {tableRows.map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-4 py-2.5 max-w-[200px]">
                          <p className="font-medium text-dark truncate">{t.title}</p>
                        </td>
                        <td className="px-4 py-2.5 text-dark/60 whitespace-nowrap">
                          {t.asset_name || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-dark/60 whitespace-nowrap">
                          {t.location_name || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-dark/60 whitespace-nowrap">
                          {t.category_name || "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={clsx(
                              "px-2 py-0.5 rounded-full font-medium capitalize whitespace-nowrap",
                              priorityBadge(t.priority)
                            )}
                          >
                            {t.priority.charAt(0).toUpperCase() + t.priority.slice(1)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={clsx(
                              "px-2 py-0.5 rounded-full font-medium whitespace-nowrap",
                              statusBadge(t.status)
                            )}
                          >
                            {humanStatus(t.status)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-dark whitespace-nowrap">
                          {t.cost != null ? `₱${formatCost(t.cost)}` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-dark/50 whitespace-nowrap">
                          {t.created_at.slice(0, 10)}
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
