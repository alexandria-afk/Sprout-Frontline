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
type TicketStatus = "open" | "in_progress" | "pending_parts" | "resolved" | "closed";
type TicketPriority = "low" | "medium" | "high" | "critical";

interface MaintenanceTicket {
  id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  cost: number | null;
  created_at: string;
  resolved_at: string | null;
  location_id: string | null;
  asset_id: string | null;
  assets: { name: string; asset_type: string } | null;
  locations: { name: string } | null;
  vendors: { name: string } | null;
  "profiles!assigned_to": { full_name: string } | null;
  "profiles!created_by": { full_name: string } | null;
}

interface MaintenanceListResponse {
  data: MaintenanceTicket[];
  total: number;
}

interface ByAssetRow {
  asset_id: string;
  asset_name: string;
  asset_type: string;
  ticket_count: number;
  total_repair_cost: number;
}

interface ByAssetResponse {
  data: ByAssetRow[];
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
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("default", { month: "short", year: "2-digit" });
}

const TT_STYLE = { borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 };
const BAR_COLORS = ["#F59E0B", "#7C3AED", "#10B981", "#00B4D8", "#F43F5E", "#6366F1", "#FB923C"];

const PRIORITY_BADGE: Record<TicketPriority, string> = {
  critical: "bg-red-50 text-red-600",
  high:     "bg-orange-50 text-orange-600",
  medium:   "bg-amber-50 text-amber-600",
  low:      "bg-gray-100 text-gray-500",
};

const STATUS_BADGE: Record<TicketStatus, string> = {
  open:          "bg-blue-50 text-blue-600",
  in_progress:   "bg-purple-50 text-purple-600",
  pending_parts: "bg-yellow-50 text-yellow-600",
  resolved:      "bg-green-50 text-green-600",
  closed:        "bg-green-50 text-green-600",
};

function isOpenStatus(s: TicketStatus) {
  return s === "open" || s === "in_progress" || s === "pending_parts";
}

function isResolvedStatus(s: TicketStatus) {
  return s === "resolved" || s === "closed";
}

function humanStatus(s: TicketStatus) {
  const map: Record<TicketStatus, string> = {
    open:          "Open",
    in_progress:   "In Progress",
    pending_parts: "Pending Parts",
    resolved:      "Resolved",
    closed:        "Closed",
  };
  return map[s] ?? s;
}

function humanPriority(p: TicketPriority) {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

// ─── Custom tooltip for Asset chart ────────────────────────────────────────────
interface AssetTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  assetData: Array<{ name: string; cost: number; tickets: number }>;
}

function AssetTooltip({ active, payload, label, assetData }: AssetTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = assetData.find((r) => r.name === label);
  return (
    <div
      style={TT_STYLE}
      className="bg-white px-3 py-2 shadow-sm"
    >
      <p className="font-semibold text-dark text-xs mb-1">{label}</p>
      <p className="text-xs text-dark/60">
        Cost:{" "}
        <span className="font-medium text-dark">₱{formatCost(payload[0]?.value ?? 0)}</span>
      </p>
      {row && (
        <p className="text-xs text-dark/60">
          Tickets: <span className="font-medium text-dark">{row.tickets}</span>
        </p>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function MaintenanceCostsReportPage() {
  const router = useRouter();

  const [dateFrom, setDateFrom] = useState(defaultRange().from);
  const [dateTo,   setDateTo]   = useState(defaultRange().to);

  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [byAsset, setByAsset] = useState<ByAssetRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  // ── Fetch all pages ──────────────────────────────────────────────────────────
  async function fetchAllTickets(): Promise<MaintenanceTicket[]> {
    const PAGE_SIZE = 200;
    let page = 1;
    const all: MaintenanceTicket[] = [];
    while (true) {
      const res = await apiFetch<MaintenanceListResponse>(
        `/api/v1/maintenance/?page=${page}&page_size=${PAGE_SIZE}`
      );
      const rows = Array.isArray(res.data) ? res.data : [];
      all.push(...rows);
      if (all.length >= res.total || rows.length < PAGE_SIZE) break;
      page++;
    }
    return all;
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [allTickets, assetRes] = await Promise.all([
        fetchAllTickets(),
        apiFetch<ByAssetResponse>("/api/v1/issues/dashboard/by-asset"),
      ]);
      setTickets(allTickets);
      setByAsset(Array.isArray(assetRes.data) ? assetRes.data : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Client-side date filter ──────────────────────────────────────────────────
  const filtered = tickets.filter((t) => {
    const d = t.created_at.slice(0, 10);
    return d >= dateFrom && d <= dateTo;
  });

  // ── Summary stats ────────────────────────────────────────────────────────────
  const totalCost     = filtered.reduce((s, t) => s + (t.cost ?? 0), 0);
  const openCount     = filtered.filter((t) => isOpenStatus(t.status)).length;
  const resolvedCount = filtered.filter((t) => isResolvedStatus(t.status)).length;
  const avgCost       = filtered.length > 0 ? totalCost / filtered.length : 0;

  // ── Chart 1 — Cost by Location ───────────────────────────────────────────────
  const locationMap: Record<string, number> = {};
  for (const t of filtered) {
    const name = t.locations?.name ?? "Unknown";
    locationMap[name] = (locationMap[name] ?? 0) + (t.cost ?? 0);
  }
  const locationData = Object.entries(locationMap)
    .map(([name, cost]) => ({ name, cost }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  // ── Chart 2 — Cost by Asset (from endpoint) ──────────────────────────────────
  const assetData = [...byAsset]
    .sort((a, b) => b.total_repair_cost - a.total_repair_cost)
    .slice(0, 10)
    .map((r) => ({ name: r.asset_name, cost: r.total_repair_cost, tickets: r.ticket_count }));

  // ── Chart 3 — Monthly Cost Trend ─────────────────────────────────────────────
  const monthMap: Record<string, number> = {};
  for (const t of filtered) {
    const ym = t.created_at.slice(0, 7);
    monthMap[ym] = (monthMap[ym] ?? 0) + (t.cost ?? 0);
  }
  const monthData = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, cost]) => ({ month: ym, label: fmtMonth(ym), cost }));

  // ── Table — sorted by cost desc ──────────────────────────────────────────────
  const tableRows = [...filtered].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));

  // ── CSV export ───────────────────────────────────────────────────────────────
  function exportCsv() {
    if (!filtered.length) return;
    const header = ["Title", "Asset", "Location", "Priority", "Status", "Cost", "Date"];
    const rows = tableRows.map((t) => [
      `"${t.title.replace(/"/g, '""')}"`,
      `"${(t.assets?.name ?? "").replace(/"/g, '""')}"`,
      `"${(t.locations?.name ?? "").replace(/"/g, '""')}"`,
      t.priority,
      t.status,
      (t.cost ?? 0).toFixed(2),
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
            <p className="text-xs text-dark/50">Repair costs by asset, location, and status</p>
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
              <p className="text-xl font-bold text-dark">₱{formatCost(totalCost)}</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{openCount}</p>
              <p className="text-sm text-dark/50 mt-0.5">Open Tickets</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-xl font-bold text-dark truncate">₱{formatCost(avgCost)}</p>
              <p className="text-sm text-dark/50 mt-0.5">Avg Cost / Ticket</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{resolvedCount}</p>
              <p className="text-sm text-dark/50 mt-0.5">Resolved Tickets</p>
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
                    tickFormatter={(v: number) => `₱${v.toLocaleString("en-PH")}`}
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
                    tickFormatter={(v: number) => `₱${v.toLocaleString("en-PH")}`}
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
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    tickFormatter={(v: number) => `₱${v.toLocaleString("en-PH")}`}
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

          {/* ── Ticket Table ── */}
          <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-dark">Ticket List</h3>
              <span className="text-xs text-dark/40">
                {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>
            {tableRows.length === 0 ? (
              <div className="py-10 text-center text-dark/40 text-sm">No tickets in this period</div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 border-b border-surface-border z-10">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold text-dark/50">Title</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-dark/50">Asset</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-dark/50">Location</th>
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
                          {t.assets?.name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-dark/60 whitespace-nowrap">
                          {t.locations?.name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={clsx(
                              "px-2 py-0.5 rounded-full font-medium capitalize whitespace-nowrap",
                              PRIORITY_BADGE[t.priority] ?? "bg-gray-100 text-gray-500"
                            )}
                          >
                            {humanPriority(t.priority)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={clsx(
                              "px-2 py-0.5 rounded-full font-medium whitespace-nowrap",
                              STATUS_BADGE[t.status] ?? "bg-gray-100 text-gray-500"
                            )}
                          >
                            {humanStatus(t.status)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-dark whitespace-nowrap">
                          ₱{formatCost(t.cost ?? 0)}
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
