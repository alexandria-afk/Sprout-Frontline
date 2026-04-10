"use client";

import { useState, useEffect } from "react";
import { ShieldCheck, CheckCircle2, XCircle, FileDown, Eye, ClipboardList } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/services/api/client";
import { getClientToken } from "@/lib/auth";
import { clsx } from "clsx";
import { AuditDetailModal } from "@/components/audits/AuditDetailModal";

interface AuditSubmission {
  id: string;
  form_template_id: string;
  location_id: string;
  submitted_by: string;
  submitted_at: string;
  overall_score: number;
  passed: boolean;
  form_templates?: { title: string };
}

export default function AuditsPage() {
  const [submissions, setSubmissions] = useState<AuditSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [passedFilter, setPassedFilter] = useState<"all" | "passed" | "failed">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (passedFilter === "passed") params.set("passed", "true");
      if (passedFilter === "failed") params.set("passed", "false");
      const data = await apiFetch<AuditSubmission[]>(`/api/v1/audits/submissions?${params}`);
      setSubmissions(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [passedFilter]);

  async function exportPdf(id: string) {
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
    const token = getClientToken();

    const res = await fetch(`${API_BASE}/api/v1/audits/submissions/${id}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { alert("PDF export failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${id.slice(0, 8)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-dark flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-sprout-purple" />
            Audit Submissions
          </h1>
          <p className="text-sm text-dark/50 mt-0.5">Review scored audit results and corrective actions</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/dashboard/audits/caps"
            className="flex items-center gap-1.5 text-sm text-amber-600 font-medium hover:underline">
            <ClipboardList className="w-4 h-4" /> Corrective Action Plans
          </Link>
          <Link href="/dashboard/audits/templates"
            className="text-sm text-sprout-purple font-medium hover:underline">
            Manage Templates →
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "passed", "failed"] as const).map((f) => (
          <button key={f} onClick={() => setPassedFilter(f)}
            className={clsx(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              passedFilter === f
                ? "bg-sprout-cyan text-white border-sprout-cyan"
                : "bg-white text-dark-secondary border-surface-border hover:border-sprout-cyan hover:text-sprout-cyan"
            )}>
            {f === "all" ? "All" : f === "passed" ? "Passed" : "Failed"}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : submissions.length === 0 ? (
        <div className="text-center py-20 text-dark/40">
          <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No audit submissions</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#E8EDF2] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E8EDF2] bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50">Template</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50">Submitted</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-dark/50">Score</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-dark/50">Result</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-dark/50">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8EDF2]">
                {submissions.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-dark truncate max-w-[180px]">
                      {s.form_templates?.title ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-dark/50">
                      {s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={clsx(
                        "font-bold text-base",
                        s.passed ? "text-green-600" : "text-red-500"
                      )}>
                        {s.overall_score?.toFixed(1) ?? "—"}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {s.passed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Passed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2.5 py-1 rounded-full">
                          <XCircle className="w-3.5 h-3.5" /> Failed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setSelectedId(s.id)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark/40 hover:text-sprout-purple transition-colors">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => exportPdf(s.id)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark/40 hover:text-sprout-purple transition-colors">
                          <FileDown className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedId && (
        <AuditDetailModal
          submissionId={selectedId}
          onClose={() => setSelectedId(null)}
          onExportPdf={() => exportPdf(selectedId)}
        />
      )}
    </div>
  );
}
