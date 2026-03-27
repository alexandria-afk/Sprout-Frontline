"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckSquare,
  Download,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { clsx } from "clsx";
import { listTasks } from "@/services/tasks";
import { listLocations } from "@/services/users";
import type { Task } from "@/types";
import type { Location } from "@/services/users";

const DATE_RANGES = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
  { label: "Last 90 days", days: 90 },
];

const PRIORITY_COLOR: Record<string, string> = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-blue-50 text-blue-700",
  high: "bg-orange-50 text-orange-700",
  critical: "bg-red-50 text-red-700",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-50 text-blue-700",
  completed: "bg-green-50 text-green-700",
  overdue: "bg-red-50 text-red-700",
  cancelled: "bg-gray-100 text-gray-400",
};

export default function TaskReportPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(30);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
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
    listTasks({
      status: statusFilter || undefined,
      priority: priorityFilter || undefined,
      location_id: locationFilter || undefined,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      page_size: 200,
    })
      .then((r) => setTasks(r.items ?? []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [rangeDays, statusFilter, priorityFilter, locationFilter]);

  function exportCsv() {
    if (!tasks.length) return;
    const rows = tasks.map((t) => [
      `"${t.title.replace(/"/g, '""')}"`,
      t.priority,
      t.status,
      t.due_at ? new Date(t.due_at).toLocaleDateString() : "",
      t.source_type,
      t.locations?.name ?? "",
      new Date(t.created_at).toLocaleDateString(),
    ]);
    const csv = [
      ["Title", "Priority", "Status", "Due", "Source", "Location", "Created"],
      ...rows,
    ]
      .map((r) => r.join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "tasks-report.csv";
    a.click();
  }

  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const overdue = tasks.filter((t) => t.status === "overdue").length;
  const completionRate =
    total > 0 ? Math.round((completed / total) * 100) : 0;
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
          <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
            <CheckSquare className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-dark">
              Task Completion Report
            </h1>
            <p className="text-xs text-dark/50">
              Status breakdown, overdue tracking, and completion rates
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
          className="px-3 py-1.5 rounded-lg text-xs border border-surface-border bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
        >
          <option value="">All statuses</option>
          {[
            "pending",
            "in_progress",
            "completed",
            "overdue",
            "cancelled",
          ].map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs border border-surface-border bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
        >
          <option value="">All priorities</option>
          {["low", "medium", "high", "critical"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        {locations.length > 0 && (
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs border border-surface-border bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
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
              <p className="text-sm text-dark/50 mt-0.5">Total Tasks</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-green-600">{completed}</p>
              <p className="text-sm text-dark/50 mt-0.5">Completed</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-red-500">{overdue}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <p className="text-sm text-dark/50">Overdue</p>
              </div>
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

          {/* Priority breakdown */}
          {total > 0 && (
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-xs font-semibold text-dark/50 mb-3">
                Priority Breakdown
              </p>
              <div className="flex gap-4 flex-wrap">
                {(["critical", "high", "medium", "low"] as const).map((p) => {
                  const count = tasks.filter((t) => t.priority === p).length;
                  const pct =
                    total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div
                      key={p}
                      className="flex items-center gap-2 min-w-[100px]"
                    >
                      <span
                        className={clsx(
                          "text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize",
                          PRIORITY_COLOR[p]
                        )}
                      >
                        {p}
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
          {tasks.length === 0 ? (
            <div className="bg-white rounded-xl border border-surface-border p-16 text-center text-dark/40">
              No tasks in this period
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-border bg-gray-50">
                      {[
                        "Task",
                        "Priority",
                        "Status",
                        "Due Date",
                        "Source",
                        "Location",
                      ].map((h) => (
                        <th
                          key={h}
                          className={clsx(
                            "px-4 py-3 text-xs font-semibold text-dark/50",
                            h === "Task" || h === "Location"
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
                    {tasks.map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-medium text-dark max-w-[200px] truncate">
                          {t.title}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={clsx(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize",
                              PRIORITY_COLOR[t.priority] ??
                                "bg-gray-100 text-gray-600"
                            )}
                          >
                            {t.priority}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={clsx(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                              STATUS_COLOR[t.status] ??
                                "bg-gray-100 text-gray-600"
                            )}
                          >
                            {t.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-dark/60 text-xs">
                          {t.due_at
                            ? new Date(t.due_at).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center text-dark/50 text-xs capitalize">
                          {t.source_type}
                        </td>
                        <td className="px-4 py-2.5 text-dark/50 text-xs">
                          {t.locations?.name ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-surface-border bg-gray-50/50">
                <p className="text-xs text-dark/40">
                  Showing {tasks.length} task{tasks.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
