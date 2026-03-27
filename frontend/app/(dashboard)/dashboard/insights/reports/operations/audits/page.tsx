"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Shield, Download, TrendingUp, TrendingDown } from "lucide-react";
import { clsx } from "clsx";
import { apiFetch } from "@/services/api/client";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
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
  from: string; to: string;
  trend: TrendPoint[];
  summary: { total_audits: number; overall_pass_rate: number };
}

const DATE_RANGES = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
  { label: "Last 90 days", days: 90 },
];

export default function AuditComplianceReportPage() {
  const router = useRouter();
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    const to   = new Date();
    const from = new Date(); from.setDate(from.getDate() - rangeDays);
    const p = new URLSearchParams({ from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10) });
    apiFetch<ComplianceReport>(`/api/v1/reports/compliance?${p}`)
      .then(setReport).catch(() => setReport(null)).finally(() => setLoading(false));
  }, [rangeDays]);

  function exportCsv() {
    if (!report?.trend?.length) return;
    const rows = report.trend.map((t) => [t.week, t.total_audits, t.passed, t.failed, t.pass_rate, t.avg_score]);
    const csv = [["Week","Total","Passed","Failed","Pass Rate %","Avg Score %"], ...rows].map((r) => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    a.download = `audit-compliance-${report.from}-${report.to}.csv`; a.click();
  }

  const passRate   = report?.summary.overall_pass_rate ?? 0;
  const passColor  = passRate >= 80 ? "#22C55E" : passRate >= 60 ? "#F59E0B" : "#EF4444";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push("/dashboard/insights?tab=reports")}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark/50 hover:text-dark transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2.5 flex-1">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
            <Shield className="w-4.5 h-4.5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-dark">Audit Compliance Report</h1>
            <p className="text-xs text-dark/50">Audit score trends and pass rates over time</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {DATE_RANGES.map((r) => (
            <button key={r.days} onClick={() => setRangeDays(r.days)}
              className={clsx("px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                rangeDays === r.days ? "bg-sprout-purple text-white border-sprout-purple" : "border-surface-border text-dark-secondary hover:border-sprout-purple")}>
              {r.label}
            </button>
          ))}
          <button onClick={exportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-dark/60 hover:bg-gray-200 transition-colors">
            <Download className="w-3.5 h-3.5" /> CSV
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
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{report.summary.total_audits}</p>
              <p className="text-sm text-dark/50 mt-0.5">Total Audits</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold" style={{ color: passColor }}>{report.summary.overall_pass_rate}%</p>
              <div className="flex items-center gap-1 mt-0.5">
                {passRate >= 80 ? <TrendingUp className="w-3.5 h-3.5 text-green-500" /> : <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
                <p className="text-sm text-dark/50">Pass Rate</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{report.trend.length}</p>
              <p className="text-sm text-dark/50 mt-0.5">Weeks with Data</p>
            </div>
          </div>

          {report.trend.length === 0 ? (
            <div className="bg-white rounded-xl border border-surface-border p-16 text-center text-dark/40">
              No audit data in this period
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-surface-border p-6">
              <h3 className="text-sm font-semibold text-dark mb-5">Weekly Audit Score Trend</h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={report.trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="gPR" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#00B4D8" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#00B4D8" stopOpacity={0}   />
                    </linearGradient>
                    <linearGradient id="gAS" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#22C55E" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#22C55E" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#94A3B8" }} tickFormatter={(v) => { const d=new Date(v); return `${d.toLocaleString("default",{month:"short"})} ${d.getDate()}`; }} />
                  <YAxis domain={[0,100]} tick={{ fontSize: 11, fill: "#94A3B8" }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={{ borderRadius:8, border:"1px solid #E2E8F0", fontSize:12 }}
                    formatter={(v, n) => [`${v ?? 0}%`, n==="pass_rate"?"Pass Rate":"Avg Score"] as [string, string]}
                    labelFormatter={(l) => `Week of ${new Date(l).toLocaleDateString()}`} />
                  <ReferenceLine y={80} stroke="#E2E8F0" strokeDasharray="4 4" label={{ value:"Pass threshold", position:"right", fontSize:10, fill:"#94A3B8" }} />
                  <Area type="monotone" dataKey="pass_rate" stroke="#00B4D8" strokeWidth={2} fill="url(#gPR)" dot={false} />
                  <Area type="monotone" dataKey="avg_score" stroke="#22C55E" strokeWidth={2} fill="url(#gAS)" dot={false} strokeDasharray="5 5" />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => v==="pass_rate"?"Pass Rate":"Avg Score"} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {report.trend.length > 0 && (
            <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-border bg-gray-50">
                      {["Week","Total","Passed","Failed","Pass Rate","Avg Score"].map((h) => (
                        <th key={h} className={clsx("px-4 py-3 text-xs font-semibold text-dark/50", h==="Week"?"text-left":"text-center")}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {report.trend.map((t) => (
                      <tr key={t.week} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 text-dark/60">{new Date(t.week).toLocaleDateString()}</td>
                        <td className="px-4 py-2.5 text-center text-dark">{t.total_audits}</td>
                        <td className="px-4 py-2.5 text-center text-green-600 font-medium">{t.passed}</td>
                        <td className="px-4 py-2.5 text-center text-red-500 font-medium">{t.failed}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={clsx("font-medium", t.pass_rate>=80?"text-green-600":t.pass_rate>=60?"text-amber-500":"text-red-500")}>{t.pass_rate}%</span>
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
