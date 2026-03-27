"use client";

import { useState, useEffect } from "react";
import { BarChart2, Download, TrendingUp, TrendingDown } from "lucide-react";
import { apiFetch } from "@/services/api/client";
import { clsx } from "clsx";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface TrendPoint {
  week: string;
  total_audits: number;
  passed: number;
  failed: number;
  pass_rate: number;
  avg_score: number;
}

interface ComplianceReport {
  from: string;
  to: string;
  trend: TrendPoint[];
  summary: {
    total_audits: number;
    overall_pass_rate: number;
  };
}

const DATE_RANGES = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
  { label: "Last 90 days", days: 90 },
];

export default function ComplianceReportPage() {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(30);

  async function load() {
    setLoading(true);
    try {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - rangeDays);

      const params = new URLSearchParams({
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      });

      const data = await apiFetch<ComplianceReport>(`/api/v1/reports/compliance?${params}`);
      setReport(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [rangeDays]);

  function exportCsv() {
    if (!report?.trend?.length) return;
    const headers = ["Week", "Total Audits", "Passed", "Failed", "Pass Rate (%)", "Avg Score (%)"];
    const rows = report.trend.map((t) => [
      t.week, t.total_audits, t.passed, t.failed, t.pass_rate, t.avg_score,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-report-${report.from}-${report.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const passRate = report?.summary.overall_pass_rate ?? 0;
  const passColor = passRate >= 80 ? "#22C55E" : passRate >= 60 ? "#F59E0B" : "#EF4444";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-dark flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-sprout-purple" />
            Compliance Report
          </h1>
          <p className="text-sm text-dark/50 mt-0.5">Audit score trends and pass rates over time</p>
        </div>
        <div className="flex items-center gap-2">
          {DATE_RANGES.map((r) => (
            <button key={r.days} onClick={() => setRangeDays(r.days)}
              className={clsx(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                rangeDays === r.days
                  ? "bg-sprout-navy text-white"
                  : "bg-gray-100 text-dark/60 hover:bg-gray-200"
              )}>
              {r.label}
            </button>
          ))}
          <button onClick={exportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-dark/60 hover:bg-gray-200 transition-colors">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : !report ? (
        <div className="text-center py-12 text-dark/40">Failed to load report</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-[#E8EDF2] p-5">
              <p className="text-2xl font-bold text-dark">{report.summary.total_audits}</p>
              <p className="text-sm text-dark/50 mt-0.5">Total Audits</p>
            </div>
            <div className="bg-white rounded-xl border border-[#E8EDF2] p-5">
              <p className="text-2xl font-bold" style={{ color: passColor }}>
                {report.summary.overall_pass_rate}%
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                {passRate >= 80
                  ? <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                  : <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
                <p className="text-sm text-dark/50">Pass Rate</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-[#E8EDF2] p-5">
              <p className="text-2xl font-bold text-dark">{report.trend.length}</p>
              <p className="text-sm text-dark/50 mt-0.5">Weeks with Data</p>
            </div>
          </div>

          {/* Chart */}
          {report.trend.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#E8EDF2] p-16 text-center text-dark/40">
              <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No audit data in this period</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-[#E8EDF2] p-6">
              <h3 className="text-sm font-semibold text-dark mb-6">Weekly Audit Score Trend</h3>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={report.trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    tickFormatter={(v) => {
                      const d = new Date(v);
                      return `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;
                    }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: "#94A3B8" }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      (name === "avg_score" || name === "pass_rate") && typeof value === "number"
                        ? `${value}%`
                        : value,
                      name === "avg_score" ? "Avg Score" : name === "pass_rate" ? "Pass Rate" : String(name),
                    ]}
                    labelFormatter={(label) => `Week of ${new Date(label).toLocaleDateString()}`}
                    contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(value) =>
                      value === "avg_score" ? "Avg Score" : value === "pass_rate" ? "Pass Rate" : value
                    }
                  />
                  {/* Passing threshold line */}
                  <ReferenceLine y={80} stroke="#E2E8F0" strokeDasharray="4 4"
                    label={{ value: "Pass threshold", position: "right", fontSize: 10, fill: "#94A3B8" }} />
                  <Line
                    type="monotone"
                    dataKey="avg_score"
                    stroke="#00B4D8"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "#00B4D8" }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="pass_rate"
                    stroke="#22C55E"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "#22C55E" }}
                    activeDot={{ r: 6 }}
                    strokeDasharray="5 5"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Data table */}
          {report.trend.length > 0 && (
            <div className="bg-white rounded-xl border border-[#E8EDF2] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E8EDF2] bg-gray-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50">Week</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-dark/50">Total</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-dark/50">Passed</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-dark/50">Failed</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-dark/50">Pass Rate</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-dark/50">Avg Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8EDF2]">
                    {report.trend.map((t) => (
                      <tr key={t.week} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 text-dark/60">
                          {new Date(t.week).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5 text-center text-dark">{t.total_audits}</td>
                        <td className="px-4 py-2.5 text-center text-green-600 font-medium">{t.passed}</td>
                        <td className="px-4 py-2.5 text-center text-red-500 font-medium">{t.failed}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={clsx(
                            "font-medium",
                            t.pass_rate >= 80 ? "text-green-600"
                              : t.pass_rate >= 60 ? "text-amber-500"
                              : "text-red-500"
                          )}>
                            {t.pass_rate}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center font-medium text-dark">{t.avg_score}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
