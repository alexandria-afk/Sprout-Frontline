"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  GraduationCap,
  Download,
  TrendingUp,
} from "lucide-react";
import { clsx } from "clsx";
import { getLmsAnalytics, listEnrollments } from "@/services/lms";

type CourseEnrollment = {
  id: string;
  course_id: string;
  user_id: string;
  status: string;
  score: number | null;
  attempt_count: number;
  started_at: string | null;
  completed_at: string | null;
  courses?: { title: string; [key: string]: unknown };
};

type LmsAnalytics = {
  total_enrollments: number;
  passed: number;
  in_progress: number;
  not_started: number;
  failed: number;
  completion_rate: number;
};

const STATUS_COLOR: Record<string, string> = {
  not_started: "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-50 text-blue-700",
  passed: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
];

export default function TrainingReportPage() {
  const router = useRouter();
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([]);
  const [analytics, setAnalytics] = useState<LmsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getLmsAnalytics(),
      listEnrollments({ status: statusFilter || undefined, page_size: 200 }),
    ])
      .then(([analyticsData, enrollmentsData]) => {
        setAnalytics(analyticsData);
        setEnrollments(enrollmentsData.items ?? []);
      })
      .catch(() => {
        setAnalytics(null);
        setEnrollments([]);
      })
      .finally(() => setLoading(false));
  }, [statusFilter]);

  function exportCsv() {
    if (!enrollments.length) return;
    const rows = enrollments.map((e) => [
      `"${(e.courses?.title ?? e.course_id).replace(/"/g, '""')}"`,
      e.status.replace(/_/g, " "),
      e.score !== null ? e.score : "",
      e.started_at ? new Date(e.started_at).toLocaleDateString() : "",
      e.completed_at ? new Date(e.completed_at).toLocaleDateString() : "",
      e.attempt_count,
    ]);
    const csv = [
      ["Course", "Status", "Score", "Started", "Completed", "Attempts"],
      ...rows,
    ]
      .map((r) => r.join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "training-report.csv";
    a.click();
  }

  const completionPct = analytics
    ? Math.round(analytics.completion_rate * 100)
    : 0;
  const rateColor =
    completionPct >= 80
      ? "#22C55E"
      : completionPct >= 60
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
            <GraduationCap className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-dark">
              Training Completion Report
            </h1>
            <p className="text-xs text-dark/50">
              Enrollment status, pass rates, and completion tracking
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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs border border-surface-border bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
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
              <p className="text-2xl font-bold text-dark">
                {analytics?.total_enrollments ?? 0}
              </p>
              <p className="text-sm text-dark/50 mt-0.5">Total Enrollments</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-green-600">
                {analytics?.passed ?? 0}
              </p>
              <p className="text-sm text-dark/50 mt-0.5">Passed</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-blue-600">
                {analytics?.in_progress ?? 0}
              </p>
              <p className="text-sm text-dark/50 mt-0.5">In Progress</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold" style={{ color: rateColor }}>
                {completionPct}%
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                <p className="text-sm text-dark/50">Completion Rate</p>
              </div>
            </div>
          </div>

          {/* Status breakdown */}
          {analytics && analytics.total_enrollments > 0 && (
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-xs font-semibold text-dark/50 mb-3">
                Status Breakdown
              </p>
              <div className="flex gap-4 flex-wrap">
                {(
                  [
                    "not_started",
                    "in_progress",
                    "passed",
                    "failed",
                  ] as const
                ).map((s) => {
                  const count =
                    s === "not_started"
                      ? analytics.not_started
                      : s === "in_progress"
                      ? analytics.in_progress
                      : s === "passed"
                      ? analytics.passed
                      : analytics.failed;
                  const pct =
                    analytics.total_enrollments > 0
                      ? Math.round((count / analytics.total_enrollments) * 100)
                      : 0;
                  return (
                    <div
                      key={s}
                      className="flex items-center gap-2 min-w-[120px]"
                    >
                      <span
                        className={clsx(
                          "text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize",
                          STATUS_COLOR[s]
                        )}
                      >
                        {s.replace(/_/g, " ")}
                      </span>
                      <span className="text-sm font-bold text-dark">
                        {count}
                      </span>
                      <span className="text-xs text-dark/40">({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Data table */}
          {enrollments.length === 0 ? (
            <div className="bg-white rounded-xl border border-surface-border p-16 text-center text-dark/40">
              No enrollment data found
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-border bg-gray-50">
                      {[
                        "Course",
                        "Status",
                        "Score",
                        "Started",
                        "Completed",
                        "Attempts",
                      ].map((h) => (
                        <th
                          key={h}
                          className={clsx(
                            "px-4 py-3 text-xs font-semibold text-dark/50",
                            h === "Course" ? "text-left" : "text-center"
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {enrollments.map((e) => (
                      <tr key={e.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-medium text-dark max-w-[220px] truncate">
                          {e.courses?.title ?? e.course_id}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={clsx(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize",
                              STATUS_COLOR[e.status] ??
                                "bg-gray-100 text-gray-600"
                            )}
                          >
                            {e.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-dark/60 text-xs">
                          {e.score !== null ? e.score : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center text-dark/60 text-xs">
                          {e.started_at
                            ? new Date(e.started_at).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center text-dark/60 text-xs">
                          {e.completed_at
                            ? new Date(e.completed_at).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center text-dark/50 text-xs">
                          {e.attempt_count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-surface-border bg-gray-50/50">
                <p className="text-xs text-dark/40">
                  Showing {enrollments.length} enrollment
                  {enrollments.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
