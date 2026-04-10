"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, CheckCircle2, XCircle, Clock, Eye, AlertTriangle, Search, Filter, ChevronDown, X, Users } from "lucide-react";
import { clsx } from "clsx";
import {
  listInstances,
  WorkflowInstance,
} from "@/services/workflows";
import { WorkflowInstanceModal } from "@/components/workflows/WorkflowInstanceModal";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const STATUS_OPTIONS = [
  { value: "in_progress", label: "In Progress" },
  { value: "stalled",     label: "Stalled" },
  { value: "completed",   label: "Completed" },
  { value: "cancelled",   label: "Cancelled" },
  { value: "all",         label: "All" },
];

const ACTION_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  fill_form:       { label: "Form",     color: "bg-blue-50 text-blue-700"    },
  approve:         { label: "Approve",  color: "bg-green-50 text-green-700"  },
  sign:            { label: "Sign",     color: "bg-purple-50 text-purple-700"},
  review:          { label: "Review",   color: "bg-indigo-50 text-indigo-700"},
  notify:          { label: "Notify",   color: "bg-yellow-50 text-yellow-700"},
  wait:            { label: "Wait",     color: "bg-gray-100 text-gray-500"   },
  create_task:     { label: "Task",     color: "bg-orange-50 text-orange-700"},
  create_issue:    { label: "Issue",    color: "bg-red-50 text-red-700"      },
  create_incident: { label: "Incident", color: "bg-red-50 text-red-700"      },
};

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  manual:           "Manual",
  audit_submitted:  "Audit",
  issue_created:    "Issue",
  incident_created: "Incident",
  scheduled:        "Scheduled",
  form_submitted:   "Form",
};

function getStatusStyle(status: string) {
  if (status === "completed") return "bg-green-50 text-green-700";
  if (status === "cancelled") return "bg-red-50 text-red-700";
  if (status === "stalled") return "bg-orange-50 text-orange-700";
  return "bg-blue-50 text-blue-700";
}

function getStatusIcon(status: string) {
  if (status === "completed") return <CheckCircle2 className="w-3.5 h-3.5" />;
  if (status === "cancelled") return <XCircle className="w-3.5 h-3.5" />;
  if (status === "stalled") return <AlertTriangle className="w-3.5 h-3.5" />;
  return <Clock className="w-3.5 h-3.5" />;
}

function getTriggerBadgeStyle(triggerType?: string | null) {
  if (triggerType === "issue_created") return "bg-orange-50 text-orange-700";
  if (triggerType === "incident_created") return "bg-red-50 text-red-700";
  if (triggerType === "audit_submitted" || triggerType === "form_submitted") return "bg-blue-50 text-blue-700";
  if (triggerType === "scheduled") return "bg-purple-50 text-purple-700";
  return "bg-gray-100 text-gray-500";
}

export default function WorkflowInstancesPage() {
  const router = useRouter();
  const { user: currentUser } = useCurrentUser();
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [instanceSearch, setInstanceSearch] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [role, setRole] = useState<string>("admin");
  const [dateRange, setDateRange] = useState("month");

  // Resolve viewer role from currentUser
  useEffect(() => {
    if (!currentUser) return;
    setRole(currentUser.role ?? "admin");
  }, [currentUser]);

  const isManager = role === "manager";

  function getDateParams(): { from?: string; to?: string } {
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (dateRange === "today") return { from: fmt(now), to: fmt(now) };
    if (dateRange === "week") {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      return { from: fmt(d), to: fmt(now) };
    }
    if (dateRange === "month") {
      const d = new Date(now); d.setMonth(d.getMonth() - 1);
      return { from: fmt(d), to: fmt(now) };
    }
    if (dateRange === "3m") {
      const d = new Date(now); d.setMonth(d.getMonth() - 3);
      return { from: fmt(d), to: fmt(now) };
    }
    return {};
  }

  async function load() {
    setLoading(true);
    try {
      const inst = await listInstances({
        status: statusFilter !== "all" ? statusFilter : undefined,
        ...getDateParams(),
        ...(isManager ? { my_team: true } : {}),
      });
      setInstances(inst);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [statusFilter, dateRange, isManager]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-dark flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-sprout-purple" />
            Workflow Instances
          </h1>
          <p className="text-sm text-dark/50 mt-0.5">Monitor live workflow progress and approvals</p>
        </div>
      </div>

      {/* Manager scope notice */}
      {isManager && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-700">
          <Users className="w-3.5 h-3.5 shrink-0" />
          Showing instances assigned to you or your team members.
        </div>
      )}

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-[#E8EDF2]">
        <button
          onClick={() => router.push("/dashboard/workflows")}
          className="px-4 py-2 text-sm font-medium text-dark/50 hover:text-dark transition-colors">
          Definitions
        </button>
        <button className="px-4 py-2 text-sm font-semibold text-sprout-purple border-b-2 border-sprout-purple -mb-px">
          Instances
        </button>
      </div>

      {/* Date range pills */}
      <div className="flex gap-1.5 flex-wrap">
        {[
          { value: "today", label: "Today" },
          { value: "week",  label: "Last 7 days" },
          { value: "month", label: "Last 30 days" },
          { value: "3m",    label: "Last 3 months" },
          { value: "all",   label: "All time" },
        ].map((opt) => (
          <button key={opt.value} onClick={() => setDateRange(opt.value)}
            className={clsx(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              dateRange === opt.value
                ? "bg-sprout-purple text-white border-sprout-purple"
                : "bg-white border-surface-border text-dark-secondary hover:border-sprout-purple hover:text-sprout-purple"
            )}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Search + filter */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-dark-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            className="border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40"
            placeholder="Search by workflow name…"
            value={instanceSearch}
            onChange={(e) => setInstanceSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-1.5 flex-wrap">
            {STATUS_OPTIONS.map((opt) => (
              <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
                className={clsx(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                  statusFilter === opt.value
                    ? "bg-sprout-cyan text-white border-sprout-cyan"
                    : "bg-white border-surface-border text-dark-secondary hover:border-sprout-cyan hover:text-sprout-cyan"
                )}>
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              triggerFilter
                ? "border-sprout-purple text-sprout-purple bg-sprout-purple/5"
                : "border-surface-border text-dark-secondary hover:bg-gray-50"
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {triggerFilter && (
              <span className="w-4 h-4 rounded-full bg-sprout-purple text-white text-[10px] font-bold flex items-center justify-center">1</span>
            )}
          </button>
        </div>

        {/* Collapsible: trigger type */}
        {showFilters && (
          <div className="bg-gray-50 border border-surface-border rounded-xl p-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <select value={triggerFilter} onChange={(e) => setTriggerFilter(e.target.value)}
                  className="appearance-none pl-3 pr-7 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40">
                  <option value="">All triggers</option>
                  {Object.entries(TRIGGER_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-dark-secondary" />
              </div>
            </div>
            {triggerFilter && (
              <button onClick={() => setTriggerFilter("")}
                className="text-xs text-dark-secondary hover:text-dark flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 self-start">
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : (() => {
        const displayedInstances = instances.filter((i) => {
          if (instanceSearch && !(i.workflow_definitions?.name ?? "").toLowerCase().includes(instanceSearch.toLowerCase())) return false;
          if (triggerFilter && i.workflow_definitions?.trigger_type !== triggerFilter) return false;
          return true;
        });
        if (displayedInstances.length === 0) return (
          <div className="text-center py-20 text-dark/40">
            <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No workflow instances</p>
            <p className="text-sm mt-1">
              {instanceSearch ? "No instances match your search." : statusFilter === "stalled" ? "No stalled workflows" : "Instances are created when workflows are triggered"}
            </p>
          </div>
        );
        return (
        <div className="bg-white rounded-xl border border-[#E8EDF2] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E8EDF2] bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50">Workflow</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50">Trigger</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50">Current Stage</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-dark/50">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50">Started</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-dark/50">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8EDF2]">
                {displayedInstances.map((inst) => (
                  <tr key={inst.id}
                    className={clsx(
                      "hover:bg-gray-50/50 transition-colors",
                      inst.status === "stalled" && "bg-orange-50/30"
                    )}>
                    <td className="px-4 py-3 font-medium text-dark truncate max-w-[160px]">
                      {inst.workflow_definitions?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                        getTriggerBadgeStyle(inst.workflow_definitions?.trigger_type)
                      )}>
                        {TRIGGER_TYPE_LABELS[inst.workflow_definitions?.trigger_type ?? ""] ?? inst.source_type ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-dark/60">
                      <div className="flex flex-col gap-0.5">
                        <span>{inst.workflow_stages?.name ?? "—"}</span>
                        {inst.workflow_stages?.action_type && (() => {
                          const cfg = ACTION_TYPE_LABELS[inst.workflow_stages.action_type];
                          return cfg ? (
                            <span className={clsx("text-[10px] font-semibold px-1.5 py-0.5 rounded-full w-fit", cfg.color)}>
                              {cfg.label}
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={clsx(
                        "inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full",
                        getStatusStyle(inst.status)
                      )}>
                        {getStatusIcon(inst.status)}
                        {inst.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-dark/50 text-xs">
                      {new Date(inst.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setSelectedId(inst.id)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-dark/40 hover:text-sprout-purple transition-colors">
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        );
      })()}

      {selectedId && (
        <WorkflowInstanceModal
          instanceId={selectedId}
          onClose={() => { setSelectedId(null); load(); }}
        />
      )}

    </div>
  );
}
