"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, FileDown, AlertTriangle, PenLine, X, ClipboardList, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/services/api/client";
import { clsx } from "clsx";

interface AuditDetailModalProps {
  submissionId: string;
  onClose: () => void;
  onExportPdf: () => void;
}

interface AuditDetail {
  id: string;
  overall_score: number;
  passed: boolean;
  submitted_at: string;
  form_templates: { title: string };
  form_responses: { field_id: string; value: string; comment?: string }[];
  audit_signatures: { signed_by: string; signature_url: string; signed_at: string }[];
  corrective_actions: {
    id: string;
    description: string;
    status: string;
    assigned_to?: string;
    due_at?: string;
  }[];
  corrective_action_plans?: {
    id: string;
    status: string;
    cap_items?: { id: string; field_label: string; followup_type: string; followup_priority: string }[];
  }[];
}

export function AuditDetailModal({ submissionId, onClose, onExportPdf }: AuditDetailModalProps) {
  const router = useRouter();
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<AuditDetail>(`/api/v1/audits/submissions/${submissionId}`)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [submissionId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#E8EDF2]">
          <h2 className="text-lg font-bold text-dark">Audit Detail</h2>
          <div className="flex items-center gap-2">
            <button onClick={onExportPdf}
              className="flex items-center gap-1.5 text-sm font-medium text-sprout-cyan hover:underline">
              <FileDown className="w-4 h-4" /> Export PDF
            </button>
            <button onClick={onClose} className="text-dark/40 hover:text-dark p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-sprout-cyan/30 border-t-sprout-cyan rounded-full animate-spin" />
          </div>
        ) : !detail ? (
          <div className="text-center py-12 text-dark/40">Failed to load audit detail</div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Score summary */}
            <div className="flex items-center gap-4 p-4 rounded-xl bg-gray-50">
              <div className={clsx(
                "text-4xl font-bold",
                detail.passed ? "text-green-600" : "text-red-500"
              )}>
                {detail.overall_score?.toFixed(1)}%
              </div>
              <div>
                {detail.passed ? (
                  <div className="flex items-center gap-1.5 text-green-700 font-semibold">
                    <CheckCircle2 className="w-5 h-5" /> PASSED
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-red-600 font-semibold">
                    <XCircle className="w-5 h-5" /> FAILED
                  </div>
                )}
                <p className="text-sm text-dark/50 mt-0.5">
                  {detail.form_templates?.title} ·{" "}
                  {detail.submitted_at
                    ? new Date(detail.submitted_at).toLocaleDateString()
                    : ""}
                </p>
              </div>
            </div>

            {/* Corrective Action Plan link */}
            {(() => {
              const cap = detail.corrective_action_plans?.[0];
              if (!cap) return null;
              const itemCount = cap.cap_items?.length ?? 0;
              const statusLabel = cap.status === "confirmed" ? "Confirmed" : cap.status === "dismissed" ? "Dismissed" : "Pending Review";
              const statusColor = cap.status === "confirmed" ? "bg-sprout-green/10 text-sprout-green"
                : cap.status === "dismissed" ? "bg-gray-100 text-gray-500"
                : "bg-amber-100 text-amber-700";
              return (
                <button
                  onClick={() => { onClose(); router.push(`/dashboard/audits/caps/${cap.id}`); }}
                  className="w-full flex items-center justify-between gap-3 p-4 rounded-xl bg-amber-50 border border-amber-100 hover:bg-amber-100/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-dark">Corrective Action Plan</p>
                      <p className="text-xs text-dark-secondary mt-0.5">{itemCount} finding{itemCount !== 1 ? "s" : ""} requiring follow-up</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={clsx("text-xs font-medium px-2 py-0.5 rounded-full", statusColor)}>
                      {statusLabel}
                    </span>
                    <ArrowRight className="w-4 h-4 text-dark-secondary" />
                  </div>
                </button>
              );
            })()}

            {/* Responses */}
            {detail.form_responses?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-dark mb-3">Responses</h3>
                <div className="divide-y divide-[#E8EDF2] rounded-xl border border-[#E8EDF2] overflow-hidden">
                  {detail.form_responses.map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white">
                      <span className="text-sm text-dark/60 truncate">{r.field_id}</span>
                      <span className="text-sm font-medium text-dark">{r.value || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Signature */}
            {detail.audit_signatures?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-dark mb-3 flex items-center gap-2">
                  <PenLine className="w-4 h-4 text-sprout-cyan" />
                  Auditee Signature
                </h3>
                <div className="p-3 rounded-lg bg-gray-50 border border-[#E8EDF2]">
                  <p className="text-xs text-dark/50">
                    Signed at:{" "}
                    {detail.audit_signatures[0].signed_at
                      ? new Date(detail.audit_signatures[0].signed_at).toLocaleString()
                      : "—"}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
