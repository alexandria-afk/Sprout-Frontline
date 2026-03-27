"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ListChecks, Download, TrendingUp } from "lucide-react";
import { clsx } from "clsx";
import { listSubmissions } from "@/services/forms";
import { listLocations } from "@/services/users";
import type { FormSubmissionListItem } from "@/services/forms";
import type { Location } from "@/services/users";

const DATE_RANGES = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
  { label: "Last 90 days", days: 90 },
];

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-500",
  submitted: "bg-blue-50 text-blue-700",
  approved: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-600",
};

export default function ChecklistReportPage() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<FormSubmissionListItem[]>([]);
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
    listSubmissions({
      status: statusFilter || undefined,
      location_id: locationFilter || undefined,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    })
      .then((r) => {
        // Filter client-side to checklist type
        const items = (r.items ?? []).filter(
          (s) =>
            !s.form_templates || s.form_templates.type === "checklist"
        );
        setSubmissions(items);
      })
      .catch(() => setSubmissions([]))
      .finally(() => setLoading(false));
  }, [rangeDays, statusFilter, locationFilter]);

  function exportCsv() {
    if (!submissions.length) return;
    const rows = submissions.map((s) => [
      `"${(s.form_templates?.title ?? "").replace(/"/g, '""')}"`,
      `"${(s.profiles?.full_name ?? "").replace(/"/g, '""')}"`,
      s.status,
      s.overall_score != null ? `${s.overall_score}%` : "",
      s.passed != null ? (s.passed ? "Pass" : "Fail") : "",
      s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : "",
      new Date(s.created_at).toLocaleDateString(),
    ]);
    const csv = [
      [
        "Form",
        "Submitted By",
        "Status",
        "Score",
        "Result",
        "Submitted At",
        "Created",
      ],
      ...rows,
    ]
      .map((r) => r.join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "checklists-report.csv";
    a.click();
  }

  const total = submissions.length;
  const submitted = submissions.filter((s) =>
    ["submitted", "approved"].includes(s.status)
  ).length;
  const approved = submissions.filter((s) => s.status === "approved").length;
  const completionRate =
    total > 0 ? Math.round((submitted / total) * 100) : 0;
  const rateColor =
    completionRate >= 80
      ? "#22C55E"
      : completionRate >= 60
      ? "#F59E0B"
      : "#EF4444";

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
          <div className="w-9 h-9 rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
            <ListChecks className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-dark">
              Checklist Completion Report
            </h1>
            <p className="text-xs text-dark/50">
              Submission rates and status across all checklists
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
          {["draft", "submitted", "approved", "rejected"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{total}</p>
              <p className="text-sm text-dark/50 mt-0.5">Total</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-blue-600">{submitted}</p>
              <p className="text-sm text-dark/50 mt-0.5">Submitted</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-green-600">{approved}</p>
              <p className="text-sm text-dark/50 mt-0.5">Approved</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold" style={{ color: rateColor }}>
                {completionRate}%
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                <p className="text-sm text-dark/50">Completion Rate</p>
              </div>
            </div>
          </div>

          {/* Status breakdown */}
          {total > 0 && (
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-xs font-semibold text-dark/50 mb-3">
                Status Breakdown
              </p>
              <div className="flex gap-4 flex-wrap">
                {(["submitted", "approved", "rejected", "draft"] as const).map(
                  (s) => {
                    const count = submissions.filter(
                      (sub) => sub.status === s
                    ).length;
                    const pct =
                      total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div
                        key={s}
                        className="flex items-center gap-2 min-w-[100px]"
                      >
                        <span
                          className={clsx(
                            "text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize",
                            STATUS_STYLE[s]
                          )}
                        >
                          {s}
                        </span>
                        <span className="text-sm font-bold text-dark">
                          {count}
                        </span>
                        <span className="text-xs text-dark/40">({pct}%)</span>
                      </div>
                    );
                  }
                )}
              </div>
            </div>
          )}

          {/* Data table */}
          {submissions.length === 0 ? (
            <div className="bg-white rounded-xl border border-surface-border p-16 text-center text-dark/40">
              No checklist submissions in this period
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-border bg-gray-50">
                      {[
                        "Checklist",
                        "Submitted By",
                        "Status",
                        "Score",
                        "Submitted At",
                      ].map((h) => (
                        <th
                          key={h}
                          className={clsx(
                            "px-4 py-3 text-xs font-semibold text-dark/50",
                            ["Checklist", "Submitted By"].includes(h)
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
                    {submissions.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-medium text-dark max-w-[200px] truncate text-xs">
                          {s.form_templates?.title ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-dark/60 text-xs">
                          {s.profiles?.full_name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={clsx(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize",
                              STATUS_STYLE[s.status] ??
                                "bg-gray-100 text-gray-600"
                            )}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs">
                          {s.overall_score != null ? (
                            <span
                              className={clsx(
                                "font-medium",
                                s.passed
                                  ? "text-green-600"
                                  : s.passed === false
                                  ? "text-red-500"
                                  : "text-dark"
                              )}
                            >
                              {s.overall_score}%
                            </span>
                          ) : (
                            <span className="text-dark/30">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center text-dark/50 text-xs">
                          {s.submitted_at
                            ? new Date(s.submitted_at).toLocaleDateString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-surface-border bg-gray-50/50">
                <p className="text-xs text-dark/40">
                  Showing {submissions.length} submission
                  {submissions.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
