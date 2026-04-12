"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  ShieldAlert, Clock, CheckCircle2, XCircle, Eye, Loader2,
  RefreshCw, ClipboardList, AlertTriangle,
} from "lucide-react";
import { listCAPs } from "@/services/caps";
import type { CAP, CAPStatus } from "@/types";

const STATUS_CONFIG: Record<CAPStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending_review: { label: "Pending Review", color: "bg-amber-100 text-amber-700", icon: Clock },
  in_review: { label: "In Review", color: "bg-blue-100 text-blue-700", icon: Eye },
  confirmed: { label: "Confirmed", color: "bg-sprout-green/10 text-sprout-green", icon: CheckCircle2 },
  dismissed: { label: "Dismissed", color: "bg-gray-100 text-gray-500", icon: XCircle },
};

function StatusBadge({ status }: { status: CAPStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending_review;
  const Icon = cfg.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium", cfg.color)}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

function ScoreBadge({ score, passed }: { score: number | null | undefined; passed: boolean | null | undefined }) {
  if (score == null) return null;
  const pct = Math.round(score);
  return (
    <span className={clsx(
      "text-xs font-bold px-2 py-0.5 rounded-full",
      passed ? "bg-sprout-green/10 text-sprout-green" : "bg-red-50 text-red-600"
    )}>
      {pct}%
    </span>
  );
}

export default function CAPListPage() {
  const router = useRouter();
  const [caps, setCaps] = useState<CAP[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<CAPStatus | "all">("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listCAPs({
        status: statusFilter === "all" ? undefined : statusFilter,
        page,
        page_size: 20,
      });
      setCaps(res.items);
      setTotalCount(res.total_count);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => { load(); }, [load]);

  // Count by status
  const counts: Record<string, number> = {};
  for (const c of caps) counts[c.status] = (counts[c.status] || 0) + 1;

  return (
    <div className="p-4 md:p-8 flex flex-col gap-6 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
          <ShieldAlert className="w-6 h-6 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-dark">Corrective Action Plans</h1>
          <p className="text-sm text-dark-secondary">Review and confirm follow-up actions from failed audits</p>
        </div>
        <button onClick={load} className="ml-auto p-2 border border-surface-border rounded-lg hover:bg-gray-50 text-dark-secondary" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "pending_review", "in_review", "confirmed", "dismissed"] as const).map((s) => {
          const active = statusFilter === s;
          const label = s === "all" ? "All" : STATUS_CONFIG[s].label;
          return (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={clsx(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                active
                  ? "bg-sprout-cyan text-white border-sprout-cyan"
                  : "bg-white text-dark-secondary border-surface-border hover:border-sprout-cyan hover:text-sprout-cyan"
              )}
            >
              {label} {s !== "all" && caps.length > 0 ? `(${counts[s] || 0})` : ""}
            </button>
          );
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-sprout-purple animate-spin" />
        </div>
      ) : caps.length === 0 ? (
        <div className="text-center py-20">
          <CheckCircle2 className="w-10 h-10 text-sprout-green mx-auto mb-2" />
          <p className="text-dark-secondary text-sm">No corrective action plans found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-surface-border text-dark-secondary text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium">Audit</th>
                  <th className="text-left px-4 py-3 font-medium">Location</th>
                  <th className="text-center px-4 py-3 font-medium">Score</th>
                  <th className="text-center px-4 py-3 font-medium">Items</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {caps.map((cap) => {
                  const sub = cap.form_submissions;
                  return (
                    <tr key={cap.id} className="hover:bg-gray-50/50 cursor-pointer" onClick={() => router.push(`/dashboard/audits/caps/${cap.id}`)}>
                      <td className="px-4 py-3 font-medium text-dark">
                        {sub?.form_templates?.title ?? "Untitled Audit"}
                      </td>
                      <td className="px-4 py-3 text-dark-secondary">
                        {cap.locations?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ScoreBadge score={sub?.overall_score} passed={sub?.passed} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-dark-secondary">
                          <ClipboardList className="w-3 h-3" />
                          {cap.item_count ?? 0}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={cap.status} />
                      </td>
                      <td className="px-4 py-3 text-dark-secondary">
                        {new Date(cap.generated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/audits/caps/${cap.id}`); }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-sprout-purple bg-sprout-purple/5 rounded-lg hover:bg-sprout-purple/10 transition-colors"
                        >
                          <Eye className="w-3 h-3" />
                          {cap.status === "pending_review" || cap.status === "in_review" ? "Review" : "View"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalCount > 20 && (
        <div className="flex justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 text-xs border border-surface-border rounded-lg disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1.5 text-xs text-dark-secondary">
            Page {page} of {Math.ceil(totalCount / 20)}
          </span>
          <button
            disabled={page * 20 >= totalCount}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 text-xs border border-surface-border rounded-lg disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
