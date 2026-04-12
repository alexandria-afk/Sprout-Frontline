"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Award,
  Download,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { apiFetch } from "@/services/api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  total_certified: number;
  expiring_soon: number;
  expired: number;
  valid: number;
}

interface LocationRow {
  location_id: string;
  location_name: string;
  valid: number;
  expiring_soon: number;
  expired: number;
}

interface CourseRow {
  course_id: string;
  course_title: string;
  valid: number;
  expiring_soon: number;
  expired: number;
}

interface Enrollment {
  user_id: string;
  full_name: string;
  location_id: string;
  location_name: string;
  course_id: string;
  course_title: string;
  cert_issued_at: string | null;
  cert_expires_at: string;
  days_until_expiry: number;
  expiry_status: "expired" | "expiring_soon" | "valid";
}

interface ReportData {
  summary: Summary;
  by_location: LocationRow[];
  by_course: CourseRow[];
  enrollments: Enrollment[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS_OPTIONS = [
  { value: "14",  label: "14 days" },
  { value: "30",  label: "30 days" },
  { value: "60",  label: "60 days" },
  { value: "90",  label: "90 days" },
];

const COLOR_VALID    = "#10B981";
const COLOR_EXPIRING = "#F59E0B";
const COLOR_EXPIRED  = "#EF4444";

const TT_STYLE = {
  background: "#fff",
  border: "1px solid #E2E8F0",
  borderRadius: 10,
  boxShadow: "0 4px 16px rgba(0,0,0,.08)",
  fontSize: 12,
  color: "#1E293B",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function DaysRemaining({ enrollment }: { enrollment: Enrollment }) {
  const { days_until_expiry, expiry_status } = enrollment;
  if (expiry_status === "expired") {
    const ago = Math.abs(days_until_expiry);
    return (
      <span className="text-red-600 font-medium">
        Expired {ago} day{ago !== 1 ? "s" : ""} ago
      </span>
    );
  }
  if (expiry_status === "expiring_soon") {
    return (
      <span className="text-amber-600 font-medium">
        {days_until_expiry} day{days_until_expiry !== 1 ? "s" : ""}
      </span>
    );
  }
  return (
    <span className="text-green-600 font-medium">
      {days_until_expiry} day{days_until_expiry !== 1 ? "s" : ""}
    </span>
  );
}

function StatusBadge({ status }: { status: Enrollment["expiry_status"] }) {
  const map: Record<Enrollment["expiry_status"], string> = {
    expired:       "bg-red-50 text-red-600",
    expiring_soon: "bg-amber-50 text-amber-700",
    valid:         "bg-green-50 text-green-600",
  };
  const label: Record<Enrollment["expiry_status"], string> = {
    expired:       "Expired",
    expiring_soon: "Expiring Soon",
    valid:         "Valid",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${map[status]}`}>
      {label[status]}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CertificationExpiryPage() {
  const router = useRouter();

  const [daysAhead, setDaysAhead] = useState("30");
  const [data, setData]           = useState<ReportData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const loadReport = useCallback(async (days: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<ReportData>(
        `/api/v1/reports/training/certification-expiry?days_ahead=${days}`
      );
      setData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load report");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load on mount
  useEffect(() => {
    loadReport(daysAhead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLoadReport() {
    loadReport(daysAhead);
  }

  function exportCsv() {
    if (!data?.enrollments.length) return;
    const header = ["Staff Name", "Location", "Course", "Cert Issued", "Cert Expires", "Days Remaining", "Status"];
    const rows = data.enrollments.map((e) => [
      `"${e.full_name.replace(/"/g, '""')}"`,
      `"${e.location_name.replace(/"/g, '""')}"`,
      `"${e.course_title.replace(/"/g, '""')}"`,
      e.cert_issued_at ? fmtDate(e.cert_issued_at) : "",
      fmtDate(e.cert_expires_at),
      e.expiry_status === "expired"
        ? `Expired ${Math.abs(e.days_until_expiry)} days ago`
        : `${e.days_until_expiry} days`,
      e.expiry_status,
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `certification-expiry-${daysAhead}d.csv`;
    a.click();
  }

  // Top 8 courses for chart
  const topCourses = data ? data.by_course.slice(0, 8) : [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <button
            onClick={() => router.push("/dashboard/insights?tab=reports")}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-3 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Insights
          </button>

          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-teal-50 flex items-center justify-center flex-shrink-0">
                <Award className="w-6 h-6 text-teal-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Certification Expiry Report</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  Track staff certification validity and upcoming renewals
                </p>
              </div>
            </div>

            <button
              onClick={exportCsv}
              disabled={!data?.enrollments.length}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* ── Filter Bar ── */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Expiring within
            </label>
            <select
              value={daysAhead}
              onChange={(e) => setDaysAhead(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {DAYS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleLoadReport}
            disabled={loading}
            className="px-5 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-60 transition-colors"
          >
            {loading ? "Loading…" : "Load Report"}
          </button>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ── Loading skeleton ── */}
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse h-24" />
            ))}
          </div>
        )}

        {/* ── Summary Cards ── */}
        {!loading && data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Total Certified */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                Total Certified
              </p>
              <p className="text-3xl font-bold text-slate-900">{data.summary.total_certified}</p>
              <p className="text-xs text-slate-400 mt-1">active cert records</p>
            </div>

            {/* Expiring Soon */}
            <div className={`bg-white rounded-xl border p-5 ${data.summary.expiring_soon > 0 ? "border-amber-300" : "border-slate-200"}`}>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                Expiring Soon
              </p>
              <p className={`text-3xl font-bold ${data.summary.expiring_soon > 0 ? "text-amber-600" : "text-slate-900"}`}>
                {data.summary.expiring_soon}
              </p>
              <p className="text-xs text-slate-400 mt-1">within {daysAhead} days</p>
            </div>

            {/* Expired */}
            <div className={`bg-white rounded-xl border p-5 ${data.summary.expired > 0 ? "border-red-300" : "border-slate-200"}`}>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                Expired
              </p>
              <p className={`text-3xl font-bold ${data.summary.expired > 0 ? "text-red-600" : "text-slate-900"}`}>
                {data.summary.expired}
              </p>
              <p className="text-xs text-slate-400 mt-1">already expired</p>
            </div>

            {/* Valid */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                Valid
              </p>
              <p className="text-3xl font-bold text-green-600">{data.summary.valid}</p>
              <p className="text-xs text-slate-400 mt-1">current certifications</p>
            </div>
          </div>
        )}

        {/* ── Charts Row ── */}
        {!loading && data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1 — By Course */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">By Course</h2>
              {topCourses.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(220, topCourses.length * 44)}>
                  <BarChart
                    layout="vertical"
                    data={topCourses}
                    margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                    barSize={14}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F1F5F9" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#94A3B8" }} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="course_title"
                      tick={{ fontSize: 11, fill: "#64748B" }}
                      width={140}
                    />
                    <Tooltip contentStyle={TT_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="valid"         name="Valid"         stackId="a" fill={COLOR_VALID}    radius={[0, 0, 0, 0]} />
                    <Bar dataKey="expiring_soon" name="Expiring Soon" stackId="a" fill={COLOR_EXPIRING} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="expired"       name="Expired"       stackId="a" fill={COLOR_EXPIRED}  radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Chart 2 — By Location */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">By Location</h2>
              {data.by_location.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(220, data.by_location.length * 44)}>
                  <BarChart
                    layout="vertical"
                    data={data.by_location}
                    margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                    barSize={14}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F1F5F9" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#94A3B8" }} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="location_name"
                      tick={{ fontSize: 11, fill: "#64748B" }}
                      width={120}
                    />
                    <Tooltip contentStyle={TT_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="valid"         name="Valid"         stackId="a" fill={COLOR_VALID}    radius={[0, 0, 0, 0]} />
                    <Bar dataKey="expiring_soon" name="Expiring Soon" stackId="a" fill={COLOR_EXPIRING} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="expired"       name="Expired"       stackId="a" fill={COLOR_EXPIRED}  radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

        {/* ── Enrollments Table ── */}
        {!loading && data && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">
                Individual Enrollments
                <span className="ml-2 text-xs font-normal text-slate-400">
                  ({data.enrollments.length} records)
                </span>
              </h2>
            </div>

            {data.enrollments.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">
                No certified enrollments found for this organisation.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                    <tr>
                      {["Staff Name", "Location", "Course", "Cert Issued", "Expires", "Days Remaining", "Status"].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.enrollments.map((e, i) => (
                      <tr key={`${e.user_id}-${e.course_id}-${i}`} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{e.full_name}</td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{e.location_name}</td>
                        <td className="px-4 py-3 text-slate-600">{e.course_title}</td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(e.cert_issued_at)}</td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(e.cert_expires_at)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <DaysRemaining enrollment={e} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusBadge status={e.expiry_status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Empty state (loaded but no data) ── */}
        {!loading && !error && !data && (
          <div className="bg-white rounded-xl border border-slate-200 py-20 text-center">
            <Award className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No report loaded</p>
            <p className="text-sm text-slate-400 mt-1">Select a time window and click Load Report.</p>
          </div>
        )}
      </div>
    </div>
  );
}
