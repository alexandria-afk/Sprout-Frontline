"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ClipboardCheck,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { clsx } from "clsx";
import { listCAPs } from "@/services/caps";
import { listLocations } from "@/services/users";
import type { CAP } from "@/types";
import type { Location } from "@/services/users";

const DATE_RANGES = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
  { label: "Last 90 days", days: 90 },
];

const STATUS_STYLE: Record<string, string> = {
  pending_review: "bg-yellow-50 text-yellow-700",
  in_review: "bg-blue-50 text-blue-700",
  confirmed: "bg-green-50 text-green-700",
  dismissed: "bg-gray-100 text-gray-500",
};

export default function CAPReportPage() {
  const router = useRouter();
  const [caps, setCAPs] = useState<CAP[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(30);
  const [statusFilter, setStatusFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    listLocations().then(setLocations).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - rangeDays);
    listCAPs({
      status: statusFilter || undefined,
      location_id: locationFilter || undefined,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      page_size: 200,
    })
      .then((r) => setCAPs(r.items ?? []))
      .catch(() => setCAPs([]))
      .finally(() => setLoading(false));
  }, [rangeDays, statusFilter, locationFilter]);

  function exportCsv() {
    if (!caps.length) return;
    const rows = caps.map((c) => [
      c.id.slice(0, 8),
      c.status.replace(/_/g, " "),
      `"${(c.form_submissions?.form_templates?.title ?? "").replace(/"/g, '""')}"`,
      c.locations?.name ?? "",
      c.item_count ?? 0,
      new Date(c.generated_at).toLocaleDateString(),
      c.reviewed_at ? new Date(c.reviewed_at).toLocaleDateString() : "",
    ]);
    const csv = [
      [
        "ID",
        "Status",
        "Form",
        "Location",
        "Items",
        "Generated",
        "Reviewed",
      ],
      ...rows,
    ]
      .map((r) => r.join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "caps-report.csv";
    a.click();
  }

  const total = caps.length;
  const pending = caps.filter((c) => c.status === "pending_review").length;
  const inReview = caps.filter((c) => c.status === "in_review").length;
  const confirmed = caps.filter((c) => c.status === "confirmed").length;
  const dismissed = caps.filter((c) => c.status === "dismissed").length;
  const reviewedCount = confirmed + dismissed;
  const confirmRate =
    total > 0 ? Math.round((reviewedCount / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => router.push("/dashboard/insights?tab=reports")}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark/50 hover:text-dark transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
            <ClipboardCheck className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-dark">CAP Status Report</h1>
            <p className="text-xs text-dark/50">
              Corrective action plans generated from audit failures
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

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {DATE_RANGES.map((r) => (
          <button
            key={r.days}
            onClick={() => setRangeDays(r.days)}
            className={clsx(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              rangeDays === r.days
                ? "bg-sprout-purple text-white border-sprout-purple"
                : "border-surface-border text-dark-secondary hover:border-sprout-purple"
            )}
          >
            {r.label}
          </button>
        ))}

        <div className="h-4 w-px bg-surface-border mx-1 hidden sm:block" />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs border border-surface-border bg-white text-dark-secondary focus:outline-none"
        >
          <option value="">All statuses</option>
          {["pending_review", "in_review", "confirmed", "dismissed"].map(
            (s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            )
          )}
        </select>

        {locations.length > 0 && (
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs border border-surface-border bg-white text-dark-secondary focus:outline-none"
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{total}</p>
              <p className="text-sm text-dark/50 mt-0.5">Total CAPs</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-yellow-500">{pending}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <Clock className="w-3.5 h-3.5 text-yellow-400" />
                <p className="text-sm text-dark/50">Pending</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-blue-600">{inReview}</p>
              <p className="text-sm text-dark/50 mt-0.5">In Review</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-green-600">{confirmed}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                <p className="text-sm text-dark/50">Confirmed</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-gray-400">{dismissed}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <XCircle className="w-3.5 h-3.5 text-gray-400" />
                <p className="text-sm text-dark/50">Dismissed</p>
              </div>
            </div>
          </div>

          {/* Review completion rate bar */}
          {total > 0 && (
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-dark/50">
                  Review Completion Rate
                </p>
                <p className="text-sm font-bold text-dark">{confirmRate}%</p>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${confirmRate}%`,
                    background:
                      confirmRate >= 80
                        ? "linear-gradient(90deg, #22C55E, #4ADE80)"
                        : confirmRate >= 50
                        ? "linear-gradient(90deg, #F59E0B, #FCD34D)"
                        : "linear-gradient(90deg, #EF4444, #F87171)",
                  }}
                />
              </div>
              <p className="text-[11px] text-dark/40 mt-1.5">
                {reviewedCount} of {total} CAPs reviewed (confirmed or
                dismissed)
              </p>
            </div>
          )}

          {/* Data table */}
          {caps.length === 0 ? (
            <div className="bg-white rounded-xl border border-surface-border p-16 text-center text-dark/40">
              No CAPs in this period
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-border bg-gray-50">
                      {[
                        "Form",
                        "Status",
                        "Location",
                        "Items",
                        "Generated",
                        "Reviewed",
                      ].map((h) => (
                        <th
                          key={h}
                          className={clsx(
                            "px-4 py-3 text-xs font-semibold text-dark/50",
                            ["Form", "Location"].includes(h)
                              ? "text-left"
                              : "text-center"
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {caps.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-medium text-dark text-xs max-w-[180px] truncate">
                          {c.form_submissions?.form_templates?.title ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={clsx(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize",
                              STATUS_STYLE[c.status] ??
                                "bg-gray-100 text-gray-500"
                            )}
                          >
                            {c.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-dark/50 text-xs">
                          {c.locations?.name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center font-medium text-dark">
                          {c.item_count ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center text-dark/50 text-xs">
                          {new Date(c.generated_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5 text-center text-dark/50 text-xs">
                          {c.reviewed_at
                            ? new Date(c.reviewed_at).toLocaleDateString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-surface-border bg-gray-50/50">
                <p className="text-xs text-dark/40">
                  Showing {caps.length} CAP{caps.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
