"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  GitBranch,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Play,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronUp,
  Zap,
  Sparkles,
  ChevronRight,
  ArrowLeft,
  Search,
  Lock,
  ShieldAlert,
  Siren,
  CheckCircle2,
  Activity,
} from "lucide-react";
import { clsx } from "clsx";
import {
  listWorkflowDefinitions,
  listInstances,
  createWorkflowDefinition,
  updateWorkflowDefinition,
  deleteWorkflowDefinition,
  duplicateWorkflowDefinition,
  triggerWorkflow,
  addStage,
  generateWorkflowWithAI,
  GeneratedWorkflow,
  WorkflowDefinition,
} from "@/services/workflows";
import { friendlyError } from "@/lib/errors";
import { listLocations, Location } from "@/services/users";
import { getPackageTemplates } from "@/services/onboarding";
import { createClient } from "@/services/supabase/client";

// ── Native (system) workflows — hard-coded, shown for visibility only ──────────
const NATIVE_WORKFLOWS = [
  {
    id: "__native_audit_cap__",
    name: "Audit CAP Workflow",
    description: "Automatically triggered when an audit submission falls below the passing threshold. Generates corrective action plans and assigns follow-up tasks.",
    trigger_type: "audit_submitted",
    icon: ShieldAlert,
    iconColor: "text-blue-600",
    iconBg:    "bg-blue-50",
    href: "/dashboard/forms?tab=audit_cap",
  },
  {
    id: "__native_incident__",
    name: "Incident Report Workflow",
    description: "Automatically triggered when an issue is escalated to an incident report. Manages investigation, status tracking, and resolution.",
    trigger_type: "incident_created",
    icon: Siren,
    iconColor: "text-red-600",
    iconBg:    "bg-red-50",
    href: "/dashboard/issues?tab=incidents",
  },
] as const;

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  manual:           "Manual",
  audit_submitted:  "Audit Submitted",
  issue_created:    "Issue Created",
  incident_created: "Incident Created",
  scheduled:        "Scheduled",
  form_submitted:   "Form Submitted",
};

const TRIGGER_TYPE_COLORS: Record<string, string> = {
  manual:           "bg-gray-100 text-gray-600",
  audit_submitted:  "bg-blue-50 text-blue-700",
  issue_created:    "bg-orange-50 text-orange-700",
  incident_created: "bg-red-50 text-red-700",
  scheduled:        "bg-purple-50 text-purple-700",
  form_submitted:   "bg-teal-50 text-teal-700",
};

export default function WorkflowsPage() {
  const router = useRouter();
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [defSearch, setDefSearch] = useState("");
  const [role, setRole] = useState<string>("");

  // Resolve viewer role from session
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const r = (data.session?.user?.app_metadata?.role as string) ?? "";
      setRole(r);
    });
  }, []);

  // Managers can view and trigger — only admins/super_admins can create, edit, delete
  const canManage = role === "admin" || role === "super_admin";
  const [showNewModal, setShowNewModal] = useState(false);
  const [newModalInitialMode, setNewModalInitialMode] = useState<"select" | "blank" | "template" | "ai">("select");
  const [triggerModal, setTriggerModal] = useState<WorkflowDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    try {
      const [defs, instancesRes] = await Promise.all([
        listWorkflowDefinitions(),
        listInstances({ status: "in_progress" }),
      ]);
      setDefinitions(defs);
      setRunningIds(new Set((instancesRes ?? []).map((i) => i.workflow_definition_id).filter(Boolean) as string[]));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleToggleActive(def: WorkflowDefinition) {
    try {
      await updateWorkflowDefinition(def.id, { is_active: !def.is_active });
      setDefinitions((prev) => prev.map((d) => d.id === def.id ? { ...d, is_active: !def.is_active } : d));
    } catch (e) {
      console.error("[Workflows] Toggle active failed:", e);
    }
  }

  function handleDelete(def: WorkflowDefinition) {
    setDeleteTarget(def);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteWorkflowDefinition(deleteTarget.id);
      setDefinitions((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(friendlyError(e));
    } finally {
      setDeleting(false);
    }
  }

  async function handleDuplicate(def: WorkflowDefinition) {
    try {
      const copy = await duplicateWorkflowDefinition(def.id);
      setDefinitions((prev) => [copy, ...prev]);
    } catch (e) {
      console.error("[Workflows] Duplicate failed:", e);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-sprout-purple" />
            Workflows
          </h1>
          <p className="text-sm text-dark/50 mt-0.5">Configure automated multi-stage approval chains</p>
        </div>
        {canManage && (
          <button
            onClick={() => { setNewModalInitialMode("select"); setShowNewModal(true); }}
            className="flex items-center gap-2 bg-sprout-purple text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-sprout-purple/90 transition-colors">
            <Plus className="w-4 h-4" /> New Workflow
          </button>
        )}
      </div>

      {/* Stat cards */}
      {!loading && (() => {
        const totalCount   = NATIVE_WORKFLOWS.length + definitions.length;
        const activeCount  = NATIVE_WORKFLOWS.length + definitions.filter(d => d.is_active).length;
        const runningCount = runningIds.size;
        const cards = [
          { label: "Total Workflows", value: totalCount,   icon: GitBranch,    bg: "bg-sprout-purple/10", color: "text-sprout-purple", onClick: () => {} },
          { label: "Active",          value: activeCount,  icon: CheckCircle2, bg: "bg-sprout-green/10",  color: "text-sprout-green",  onClick: () => {} },
          { label: "Running Now",     value: runningCount, icon: Activity,     bg: "bg-blue-50",          color: "text-blue-600",      onClick: () => router.push("/dashboard/workflows/instances") },
        ];
        return (
          <div className="grid grid-cols-3 gap-3">
            {cards.map(({ label, value, icon: Icon, bg, color, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                className="bg-white rounded-xl border border-surface-border p-4 flex flex-col gap-2 text-left hover:border-sprout-purple/30 hover:shadow-sm transition-all"
              >
                <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center", bg)}>
                  <Icon className={clsx("w-4 h-4", color)} />
                </div>
                <p className="text-xl md:text-2xl font-bold text-dark">{value}</p>
                <p className="text-xs text-dark-secondary">{label}</p>
              </button>
            ))}
          </div>
        );
      })()}

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-[#E8EDF2]">
        <button className="px-4 py-2 text-sm font-semibold text-sprout-purple border-b-2 border-sprout-purple -mb-px">
          Definitions
        </button>
        <button
          onClick={() => router.push("/dashboard/workflows/instances")}
          className="px-4 py-2 text-sm font-medium text-dark/50 hover:text-dark transition-colors">
          Instances
        </button>
      </div>

      {/* Search */}
      {!loading && definitions.length > 0 && (
        <div className="relative">
          <Search className="w-4 h-4 text-dark-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            className="border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40"
            placeholder="Search workflows…"
            value={defSearch}
            onChange={(e) => setDefSearch(e.target.value)}
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : definitions.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-6">
          <div className="text-center">
            <Zap className="w-10 h-10 mx-auto mb-2 text-sprout-purple/30" />
            <p className="font-semibold text-dark">No workflows yet</p>
            <p className="text-sm text-dark/50 mt-0.5">{canManage ? "How would you like to create your first workflow?" : "No custom workflows have been created yet."}</p>
          </div>
          {canManage && <div className="grid grid-cols-3 gap-4 w-full max-w-lg">
            <button
              onClick={() => { setNewModalInitialMode("template"); setShowNewModal(true); }}
              className="flex flex-col items-center text-center gap-3 p-5 rounded-2xl border-2 border-[#E8EDF2] hover:border-sprout-purple hover:shadow-md transition-all bg-white">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-2xl">📋</div>
              <div>
                <p className="font-semibold text-dark text-sm">From a Template</p>
                <p className="text-xs text-dark/50 mt-0.5 leading-snug">Start with pre-built stages</p>
              </div>
            </button>
            <button
              onClick={() => { setNewModalInitialMode("ai"); setShowNewModal(true); }}
              className="flex flex-col items-center text-center gap-3 p-5 rounded-2xl border-2 border-transparent hover:shadow-md transition-all"
              style={{ background: 'linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box' }}>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-sprout-purple" />
              </div>
              <div>
                <p className="font-semibold text-sm bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate with Sidekick</p>
                <p className="text-xs text-dark/50 mt-0.5 leading-snug">Describe it, Sidekick designs the stages</p>
              </div>
            </button>
            <button
              onClick={() => { setNewModalInitialMode("blank"); setShowNewModal(true); }}
              className="flex flex-col items-center text-center gap-3 p-5 rounded-2xl border-2 border-[#E8EDF2] hover:border-sprout-purple hover:shadow-md transition-all bg-white">
              <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center">
                <Plus className="w-6 h-6 text-dark/40" />
              </div>
              <div>
                <p className="font-semibold text-dark text-sm">Start Blank</p>
                <p className="text-xs text-dark/50 mt-0.5 leading-snug">Build from scratch in the canvas</p>
              </div>
            </button>
          </div>}
        </div>
      ) : (() => {
        const q = defSearch.toLowerCase();
        const filteredDefs = defSearch
          ? definitions.filter((d) => d.name.toLowerCase().includes(q))
          : definitions;
        const filteredNative = defSearch
          ? NATIVE_WORKFLOWS.filter((n) => n.name.toLowerCase().includes(q))
          : NATIVE_WORKFLOWS;
        const noResults = filteredDefs.length === 0 && filteredNative.length === 0;
        return (
        <div className="bg-white rounded-xl border border-[#E8EDF2] overflow-hidden">
          {noResults ? (
            <div className="py-16 text-center text-dark/40">
              <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No workflows match your search.</p>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E8EDF2] bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50">Trigger</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-dark/50">Stages</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-dark/50">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-dark/50">Actions</th>
                </tr>
              </thead>

              {/* ── Native (built-in) workflows ── */}
              {filteredNative.length > 0 && (
                <tbody className="divide-y divide-[#E8EDF2]">
                  <tr className="bg-gray-50/60">
                    <td colSpan={5} className="px-4 py-1.5">
                      <span className="text-[10px] font-bold text-dark/35 uppercase tracking-widest flex items-center gap-1.5">
                        <Lock className="w-3 h-3" /> Built-in
                      </span>
                    </td>
                  </tr>
                  {filteredNative.map((native) => {
                    const NativeIcon = native.icon;
                    return (
                      <tr key={native.id} className="bg-gray-50/30 opacity-90">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className={clsx("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", native.iconBg)}>
                              <NativeIcon className={clsx("w-3.5 h-3.5", native.iconColor)} />
                            </div>
                            <div>
                              <p className="font-semibold text-dark leading-tight">{native.name}</p>
                              <p className="text-[11px] text-dark/40 mt-0.5 leading-snug max-w-xs">{native.description}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx(
                            "text-xs font-medium px-2 py-0.5 rounded-full",
                            TRIGGER_TYPE_COLORS[native.trigger_type] ?? "bg-gray-100 text-gray-600"
                          )}>
                            {TRIGGER_TYPE_LABELS[native.trigger_type] ?? native.trigger_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs text-dark/30 font-medium">Auto</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                            Always On
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end">
                            <span title="Built-in workflows are managed by the system and cannot be edited"
                              className="p-1.5 text-dark/20 cursor-default">
                              <Lock className="w-3.5 h-3.5" />
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              )}

              {/* ── User-created workflows ── */}
              <tbody className="divide-y divide-[#E8EDF2]">
                {filteredDefs.length > 0 && (
                  <tr className={clsx("bg-gray-50/60", filteredNative.length > 0 && "border-t border-[#E8EDF2]")}>
                    <td colSpan={5} className="px-4 py-1.5">
                      <span className="text-[10px] font-bold text-dark/35 uppercase tracking-widest">
                        Custom
                      </span>
                    </td>
                  </tr>
                )}
                {filteredDefs.map((def) => (
                  <tr
                    key={def.id}
                    onClick={() => canManage ? router.push(`/dashboard/workflows/builder/${def.id}`) : undefined}
                    className={clsx("transition-colors", canManage ? "hover:bg-gray-50/50 cursor-pointer" : "cursor-default")}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-dark">{def.name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx(
                        "text-xs font-medium px-2 py-0.5 rounded-full",
                        TRIGGER_TYPE_COLORS[def.trigger_type] ?? "bg-gray-100 text-gray-600"
                      )}>
                        {TRIGGER_TYPE_LABELS[def.trigger_type] ?? def.trigger_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs font-semibold text-dark bg-gray-100 px-2 py-0.5 rounded-full">
                        {def.workflow_stages?.length ?? 0}
                      </span>
                    </td>
                    {/* Status — admins can toggle; managers see read-only badge */}
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      {canManage ? (
                        <button onClick={() => handleToggleActive(def)}
                          className={clsx(
                            "text-xs font-medium px-2 py-0.5 rounded-full transition-colors",
                            def.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
                          )}>
                          {def.is_active ? "Active" : "Inactive"}
                        </button>
                      ) : (
                        <span className={clsx(
                          "text-xs font-medium px-2 py-0.5 rounded-full",
                          def.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
                        )}>
                          {def.is_active ? "Active" : "Inactive"}
                        </span>
                      )}
                    </td>
                    {/* Actions — stop propagation so buttons don't also navigate */}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {def.trigger_type === "manual" && def.is_active && !runningIds.has(def.id) && (
                          <button
                            onClick={() => setTriggerModal(def)}
                            title="Trigger now"
                            className="p-1.5 rounded-lg hover:bg-green-50 text-dark/30 hover:text-green-600 transition-colors">
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canManage && (
                          <>
                            <button
                              onClick={() => router.push(`/dashboard/workflows/builder/${def.id}`)}
                              title="Edit workflow"
                              className="p-1.5 rounded-lg hover:bg-blue-50 text-dark/30 hover:text-blue-600 transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDuplicate(def)}
                              title="Duplicate"
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-dark/30 hover:text-dark/70 transition-colors">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(def)}
                              title="Delete"
                              className="p-1.5 rounded-lg hover:bg-red-50 text-dark/30 hover:text-red-500 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
        );
      })()}

      {showNewModal && (
        <NewWorkflowModal
          initialMode={newModalInitialMode}
          onClose={() => setShowNewModal(false)}
          onCreated={(def) => {
            setShowNewModal(false);
            router.push(`/dashboard/workflows/builder/${def.id}`);
          }}
        />
      )}

      {triggerModal && (
        <TriggerWorkflowModal
          definition={triggerModal}
          onClose={() => setTriggerModal(null)}
          onTriggered={() => {
            setTriggerModal(null);
            router.push("/dashboard/workflows/instances");
          }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h2 className="text-base font-bold text-dark">Delete workflow?</h2>
                <p className="text-sm text-dark-secondary mt-1">
                  <span className="font-medium text-dark">&ldquo;{deleteTarget.name}&rdquo;</span> will be permanently deleted.
                  {runningIds.has(deleteTarget.id) && (
                    <span className="block mt-1 text-amber-600 font-medium">⚠ This workflow has running instances that will also be deleted.</span>
                  )}
                  {deleteTarget.is_active && (
                    <span className="block mt-1 text-amber-600 font-medium">⚠ This workflow is currently active.</span>
                  )}
                </p>
              </div>
            </div>
            {deleteError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {deleteError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-xl border border-surface-border text-sm font-medium text-dark hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── New Workflow Modal ───────────────────────────────────────────────────────

const TRIGGER_OPTIONS = [
  { value: "manual",           label: "Manual — started by a manager" },
  { value: "audit_submitted",  label: "Audit Submitted" },
  { value: "issue_created",    label: "Issue Created" },
  { value: "incident_created", label: "Incident Created" },
  { value: "scheduled",        label: "Scheduled" },
  { value: "form_submitted",   label: "Form Submitted" },
];

interface TemplateStage {
  name: string;
  action_type: string;
  assigned_role?: string;
  sla_hours?: number;
  is_final?: boolean;
  config?: Record<string, unknown>;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  trigger_type: string;
  icon: string;
  color: string;
  stages: TemplateStage[];
}

const TRIGGER_ICON: Record<string, string> = {
  issue_created:    "⚠️",
  audit_submitted:  "📋",
  form_submitted:   "📝",
  incident_created: "🚨",
  manual:           "▶️",
  scheduled:        "⏰",
};
const TRIGGER_COLOR: Record<string, string> = {
  issue_created:    "bg-orange-50 border-orange-200",
  audit_submitted:  "bg-green-50 border-green-200",
  form_submitted:   "bg-yellow-50 border-yellow-200",
  incident_created: "bg-red-50 border-red-200",
  manual:           "bg-purple-50 border-purple-200",
  scheduled:        "bg-blue-50 border-blue-200",
};

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "store_opening",
    name: "Store Opening",
    description: "Daily scheduled checklist — staff completes the opening form, manager signs off",
    trigger_type: "scheduled",
    icon: "🏪",
    color: "bg-blue-50 border-blue-200",
    stages: [
      // Stage 1 — Starting Form: link the opening checklist template in builder
      { name: "Complete Opening Checklist", action_type: "fill_form", assigned_role: "staff", sla_hours: 1 },
      { name: "Manager Sign-Off", action_type: "approve", assigned_role: "manager", sla_hours: 1, is_final: true },
    ],
  },
  {
    id: "food_safety_audit",
    name: "Food Safety Audit Response",
    description: "Triggered when an audit is submitted — review findings, log issues, approve corrective action",
    trigger_type: "audit_submitted",
    icon: "🍽️",
    color: "bg-green-50 border-green-200",
    stages: [
      // Stage 1 — Starting Form: read-only review of the submitted audit (linked via trigger config)
      { name: "Review Audit Submission", action_type: "fill_form", assigned_role: "manager", sla_hours: 4 },
      { name: "Log Corrective Issues", action_type: "create_issue", config: { title: "Food Safety Corrective Action", priority: "high" } },
      { name: "Approve Corrective Action Plan", action_type: "approve", assigned_role: "manager", sla_hours: 48, is_final: true },
    ],
  },
  {
    id: "equipment_repair",
    name: "Equipment Repair",
    description: "Triggered when an equipment issue is created — document, approve repair, assign to technician",
    trigger_type: "issue_created",
    icon: "🔧",
    color: "bg-orange-50 border-orange-200",
    stages: [
      // Stage 1 — Starting Form: fill an investigation/details form (link template in builder)
      { name: "Equipment Issue Report", action_type: "fill_form", assigned_role: "manager", sla_hours: 2 },
      { name: "Manager Approval", action_type: "approve", assigned_role: "manager", sla_hours: 4 },
      { name: "Create Repair Task", action_type: "create_task", config: { title: "Equipment Repair", priority: "medium" }, is_final: true },
    ],
  },
  {
    id: "incident_response",
    name: "Incident Response",
    description: "Triggered when an incident is created — document, notify management, investigate, and close",
    trigger_type: "incident_created",
    icon: "🚨",
    color: "bg-red-50 border-red-200",
    stages: [
      // Stage 1 — Starting Form: fill an incident investigation form (link template in builder)
      { name: "Incident Details Form", action_type: "fill_form", assigned_role: "manager", sla_hours: 1 },
      { name: "Notify Management", action_type: "notify", config: { message: "A new incident has been reported and requires immediate attention." } },
      { name: "Investigation Review", action_type: "review", assigned_role: "manager", sla_hours: 24 },
      { name: "Close Incident", action_type: "approve", assigned_role: "manager", sla_hours: 72, is_final: true },
    ],
  },
  {
    id: "staff_onboarding",
    name: "Staff Onboarding",
    description: "New hire completes onboarding forms, signs acknowledgments, HR final approval",
    trigger_type: "manual",
    icon: "👤",
    color: "bg-purple-50 border-purple-200",
    stages: [
      // Stage 1 — Starting Form: link the onboarding form template in builder
      { name: "Complete Onboarding Forms", action_type: "fill_form", assigned_role: "staff", sla_hours: 48 },
      { name: "Sign Acknowledgments", action_type: "sign", assigned_role: "staff", sla_hours: 24 },
      { name: "HR Final Approval", action_type: "approve", assigned_role: "manager", sla_hours: 24, is_final: true },
    ],
  },
  {
    id: "customer_complaint",
    name: "Customer Complaint",
    description: "Triggered when a complaint form is submitted — review submission, assign follow-up, approve resolution",
    trigger_type: "form_submitted",
    icon: "💬",
    color: "bg-yellow-50 border-yellow-200",
    stages: [
      // Stage 1 — Starting Form: read-only review of the submitted complaint (linked via trigger config)
      { name: "Review Complaint Submission", action_type: "fill_form", assigned_role: "manager", sla_hours: 4 },
      { name: "Assign Follow-Up Task", action_type: "create_task", config: { title: "Customer Complaint Follow-Up", priority: "medium" } },
      { name: "Approve Resolution", action_type: "approve", assigned_role: "manager", sla_hours: 48, is_final: true },
    ],
  },
];

const ACTION_TYPE_LABELS: Record<string, string> = {
  fill_form:        "Fill Form",
  approve:          "Approve",
  sign:             "Sign",
  review:           "Review",
  create_task:      "Create Task",
  create_issue:     "Create Issue",
  create_incident:  "Create Incident",
  notify:           "Notify",
  wait:             "Wait",
};

const ACTION_TYPE_ICONS: Record<string, string> = {
  fill_form: "📋", approve: "👍", sign: "✍️", review: "✅",
  create_task: "➕", create_issue: "⚠️", create_incident: "🚨",
  notify: "🔔", wait: "⏱️",
};

function NewWorkflowModal({
  onClose,
  onCreated,
  initialMode = "select",
}: {
  onClose: () => void;
  onCreated: (def: WorkflowDefinition) => void;
  initialMode?: "select" | "blank" | "template" | "ai";
}) {
  const [mode, setMode] = useState<"select" | "blank" | "template" | "ai">(initialMode);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("manual");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Industry-specific workflow templates (fetched from API; falls back to generic)
  const [pkgTemplates, setPkgTemplates] = useState<WorkflowTemplate[]>(WORKFLOW_TEMPLATES);
  useEffect(() => {
    getPackageTemplates("workflow").then((res) => {
      if (!res.items.length) return;
      const mapped: WorkflowTemplate[] = res.items.map((item) => {
        const c = item.content as Record<string, unknown>;
        const trigger = (c.trigger as Record<string, unknown>) ?? {};
        const rawStages = (c.stages as Record<string, unknown>[]) ?? [];
        const stages: TemplateStage[] = rawStages.map((s) => {
          const { type, name: sName, assigned_role, sla_hours, is_final, ...rest } = s as Record<string, unknown>;
          return {
            name: (sName as string) ?? "",
            action_type: (type as string) ?? "review",
            assigned_role: assigned_role as string | undefined,
            sla_hours: sla_hours as number | undefined,
            is_final: is_final as boolean | undefined,
            config: Object.keys(rest).length > 0 ? rest : undefined,
          };
        });
        const triggerType = (trigger.type as string) ?? "manual";
        return {
          id: item.id,
          name: item.name,
          description: item.description,
          trigger_type: triggerType,
          icon: TRIGGER_ICON[triggerType] ?? "▶️",
          color: TRIGGER_COLOR[triggerType] ?? "bg-gray-50 border-gray-200",
          stages,
        };
      });
      setPkgTemplates(mapped);
    }).catch(() => {});
  }, []);

  // AI tab state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<GeneratedWorkflow | null>(null);

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true);
    setAiResult(null);
    setError("");
    try {
      const result = await generateWorkflowWithAI(aiPrompt.trim());
      setAiResult(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "AI generation failed");
    } finally {
      setAiGenerating(false);
    }
  }

  async function handleUseAiResult() {
    if (!aiResult) return;
    setSaving(true);
    setError("");
    try {
      const def = await createWorkflowDefinition({
        name: aiResult.name,
        trigger_type: aiResult.trigger_type,
        is_active: false,  // draft — admin must link form templates then publish
      });
      for (let i = 0; i < aiResult.stages.length; i++) {
        const s = aiResult.stages[i];
        await addStage(def.id, {
          name: s.name,
          action_type: s.action_type,
          stage_order: i + 1,
          assigned_role: s.assigned_role ?? null,
          sla_hours: s.sla_hours ?? null,
          is_final: s.is_final ?? false,
          config: s.config ?? null,
        });
      }
      onCreated(def);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create workflow");
      setSaving(false);
    }
  }

  async function handleCreate() {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      const def = await createWorkflowDefinition({
        name: name.trim(),
        trigger_type: triggerType,
        is_active: false,  // draft — publish via Save & Publish in the builder
      });
      onCreated(def);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create workflow");
    } finally {
      setSaving(false);
    }
  }

  async function handleUseTemplate(tpl: WorkflowTemplate) {
    setSaving(true);
    setError("");
    try {
      const def = await createWorkflowDefinition({
        name: tpl.name,
        trigger_type: tpl.trigger_type,
        is_active: false,  // draft — admin must link form templates then publish
      });
      // Add stages sequentially to preserve order
      for (let i = 0; i < tpl.stages.length; i++) {
        const s = tpl.stages[i];
        await addStage(def.id, {
          name: s.name,
          action_type: s.action_type,
          stage_order: i + 1,
          assigned_role: s.assigned_role ?? null,
          sla_hours: s.sla_hours ?? null,
          is_final: s.is_final ?? false,
          config: s.config ?? null,
        });
      }
      onCreated(def);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create from template");
      setSaving(false);
    }
  }

  function goBack() {
    setMode("select");
    setAiResult(null);
    setError("");
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#E8EDF2]">
          <div className="flex items-center gap-2">
            {mode !== "select" && (
              <button onClick={goBack} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <ArrowLeft className="w-4 h-4 text-dark/60" />
              </button>
            )}
            <h2 className="text-base font-bold text-dark">New Workflow</h2>
          </div>
          <button onClick={onClose} className="text-dark/40 hover:text-dark text-2xl leading-none">&times;</button>
        </div>

        {error && <div className="mx-5 mt-4 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">{error}</div>}

        {/* Option cards */}
        {mode === "select" && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-dark/60">How would you like to start?</p>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setMode("template")}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-[#E8EDF2] hover:border-sprout-purple hover:shadow-sm transition-all">
                <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-2xl">📋</div>
                <div>
                  <p className="font-semibold text-dark text-xs">From a Template</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Start with pre-built stages</p>
                </div>
              </button>
              <button
                onClick={() => setMode("ai")}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-transparent hover:shadow-sm transition-all"
                style={{ background: 'linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box' }}>
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-sprout-purple" />
                </div>
                <div>
                  <p className="font-semibold text-xs bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate with Sidekick</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Describe it, Sidekick designs the stages</p>
                </div>
              </button>
              <button
                onClick={() => setMode("blank")}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-[#E8EDF2] hover:border-sprout-purple hover:shadow-sm transition-all">
                <div className="w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center text-2xl">➕</div>
                <div>
                  <p className="font-semibold text-dark text-xs">Start Blank</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Build from scratch in the canvas</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Template sub-view */}
        {mode === "template" && (
          <div className="p-5">
            <p className="text-xs text-dark/50 mb-4">Choose a template to pre-fill stages. You can customise everything in the builder.</p>
            <div className="grid grid-cols-2 gap-3">
              {pkgTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => !saving && handleUseTemplate(tpl)}
                  disabled={saving}
                  className={clsx(
                    "text-left p-3 rounded-xl border-2 hover:border-sprout-purple/50 hover:shadow-sm transition-all disabled:opacity-50",
                    tpl.color
                  )}>
                  <div className="text-xl mb-1.5">{tpl.icon}</div>
                  <p className="text-xs font-semibold text-dark">{tpl.name}</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">{tpl.description}</p>
                  <p className="text-[10px] font-medium text-dark/40 mt-1.5">
                    {tpl.stages.length} stages · {TRIGGER_TYPE_LABELS[tpl.trigger_type] ?? tpl.trigger_type}
                  </p>
                </button>
              ))}
            </div>
            {saving && (
              <div className="flex items-center justify-center gap-2 mt-4 text-sm text-dark/50">
                <div className="w-4 h-4 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
                Creating workflow…
              </div>
            )}
          </div>
        )}

        {/* AI sub-view */}
        {mode === "ai" && (
          <div className="p-5 space-y-4">
            {!aiResult ? (
              <>
                <p className="text-xs text-dark/50">Describe what you need and Sidekick will design the workflow stages for you.</p>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={4}
                  placeholder="e.g. A workflow for handling customer complaints — first a staff member logs the details, then a manager reviews and approves a resolution within 48 hours"
                  className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30 resize-none"
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleAiGenerate}
                    disabled={!aiPrompt.trim() || aiGenerating}
                    className="flex items-center gap-2 px-5 py-2 bg-sprout-purple text-white text-sm font-semibold rounded-lg hover:bg-sprout-purple/90 disabled:opacity-50 transition-colors">
                    {aiGenerating ? (
                      <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Generating…</>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5" /> Generate Workflow</>
                    )}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-sprout-purple/5 border border-sprout-purple/20 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-dark text-sm">{aiResult.name}</p>
                      <p className="text-xs text-dark/50 mt-0.5">
                        Trigger: {TRIGGER_TYPE_LABELS[aiResult.trigger_type] ?? aiResult.trigger_type}
                        {" · "}{aiResult.stages.length} stages
                      </p>
                    </div>
                    <button onClick={() => { setAiResult(null); setError(""); }}
                      className="text-xs text-dark/40 hover:text-dark shrink-0">
                      Regenerate
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {aiResult.stages.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-dark/70">
                        <span className="text-base leading-none">{ACTION_TYPE_ICONS[s.action_type] ?? "▸"}</span>
                        <span className="font-medium">{s.name}</span>
                        {s.assigned_role && <span className="text-dark/40">· {s.assigned_role}</span>}
                        {s.sla_hours && <span className="text-dark/40">· {s.sla_hours}h SLA</span>}
                        {s.is_final && <span className="text-[10px] font-semibold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">FINAL</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={handleUseAiResult}
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2 bg-sprout-green text-white text-sm font-semibold rounded-lg hover:bg-sprout-green/90 disabled:opacity-50 transition-colors">
                    {saving ? (
                      <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating…</>
                    ) : (
                      <>Use this Workflow <ChevronRight className="w-3.5 h-3.5" /></>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Blank sub-view */}
        {mode === "blank" && (
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-dark/60 mb-1.5">Workflow Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Incident Response Workflow"
                className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-dark/60 mb-1.5">Trigger Type</label>
              <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)}
                className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none">
                {TRIGGER_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <p className="text-xs text-dark/40">You&apos;ll configure stages and routing rules in the builder after creating.</p>
            <div className="flex justify-end pt-1">
              <button onClick={handleCreate} disabled={saving}
                className="px-5 py-2 bg-sprout-green text-white text-sm font-semibold rounded-lg hover:bg-sprout-green/90 disabled:opacity-50 transition-colors">
                {saving ? "Creating…" : "Create & Open Builder"}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}


// ─── Manual Trigger Modal ─────────────────────────────────────────────────────

function TriggerWorkflowModal({
  definition,
  onClose,
  onTriggered,
}: {
  definition: WorkflowDefinition;
  onClose: () => void;
  onTriggered: () => void;
}) {
  const [triggering, setTriggering] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    listLocations().then(setLocations).catch(() => {});
  }, []);

  async function handleTrigger() {
    setTriggering(true);
    try {
      await triggerWorkflow({
        definition_id: definition.id,
        source_type: "manual",
        ...(locationId ? { location_id: locationId } : {}),
      });
      onTriggered();
    } catch (e) {
      console.error(e);
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-base font-bold text-dark">Trigger Workflow</h2>
        <p className="text-sm text-dark/60">
          Manually start <span className="font-semibold text-dark">{definition.name}</span>.
          A new instance will be created and the first stage will be activated.
        </p>

        {locations.length > 0 && (
          <div>
            <label className="block text-xs font-semibold text-dark/60 mb-1.5">
              Location <span className="font-normal text-dark/40">(optional)</span>
            </label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30">
              <option value="">— Company-wide (no specific location) —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            {!locationId && (
              <p className="text-[10px] text-amber-600 mt-1.5 leading-snug">
                ⚠️ Without a location, role-based stages may have no assignee and won&apos;t appear in anyone&apos;s inbox.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-dark/60 hover:text-dark">Cancel</button>
          <button onClick={handleTrigger} disabled={triggering}
            className="flex items-center gap-2 px-5 py-2 bg-sprout-green text-white text-sm font-semibold rounded-lg hover:bg-sprout-green/90 disabled:opacity-50 transition-colors">
            <Play className="w-3.5 h-3.5" />
            {triggering ? "Starting…" : "Start Workflow"}
          </button>
        </div>
      </div>
    </div>
  );
}
