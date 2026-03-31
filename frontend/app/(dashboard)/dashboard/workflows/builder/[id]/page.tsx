"use client";

import { useState, useEffect, useCallback, useRef, useImperativeHandle } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";
import {
  ArrowLeft,
  GripVertical,
  Plus,
  Trash2,
  Settings,
  ArrowDown,
  CheckCircle2,
  ClipboardList,
  ThumbsUp,
  PenLine,
  Bell,
  Timer,
  AlertTriangle,
  Siren,
  X,
  ChevronRight,
  Save,
  Zap,
  Lock,
  Sparkles,
  FileText,
  RefreshCw,
  Loader2,
  GraduationCap,
} from "lucide-react";
import { clsx } from "clsx";
import {
  getWorkflowDefinition,
  updateWorkflowDefinition,
  addStage,
  updateStage,
  deleteStage,
  reorderStages,
  addRoutingRule,
  updateRoutingRule,
  deleteRoutingRule,
  listInstances,
  publishWorkflow,
  PublishValidationError,
  WorkflowDefinition,
  WorkflowStage,
  RoutingRule,
} from "@/services/workflows";
import { listTemplates, generateTemplate, createTemplate } from "@/services/forms";
import { listManagedCourses } from "@/services/lms";
import { listIssueCategories } from "@/services/issues";
import { apiFetch } from "@/services/api/client";

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_TYPES = [
  { value: "fill_form",        label: "Fill Form",       icon: ClipboardList, color: "text-blue-600",   bg: "bg-blue-50" },
  { value: "approve",          label: "Approve",          icon: ThumbsUp,      color: "text-green-600",  bg: "bg-green-50" },
  { value: "sign",             label: "Sign",             icon: PenLine,       color: "text-indigo-600", bg: "bg-indigo-50" },
  { value: "review",           label: "Review",           icon: CheckCircle2,  color: "text-teal-600",   bg: "bg-teal-50" },
  { value: "create_task",      label: "Create Task",      icon: Plus,          color: "text-amber-600",  bg: "bg-amber-50" },
  { value: "create_issue",     label: "Create Issue",     icon: AlertTriangle, color: "text-orange-600", bg: "bg-orange-50" },
  { value: "create_incident",  label: "Create Incident",  icon: Siren,         color: "text-red-600",    bg: "bg-red-50" },
  { value: "notify",           label: "Notify",           icon: Bell,          color: "text-purple-600", bg: "bg-purple-50" },
  { value: "wait",             label: "Wait",             icon: Timer,         color: "text-slate-600",  bg: "bg-slate-50" },
  { value: "assign_training", label: "Assign Training", icon: GraduationCap, color: "text-emerald-600", bg: "bg-emerald-50" },
];

const TRIGGER_TYPES = [
  { value: "manual",           label: "Manual",           description: "User explicitly starts the workflow by filling a linked form" },
  { value: "form_submitted",   label: "Form Submitted",   description: "Auto-fires when a specific form is submitted" },
  { value: "issue_created",    label: "Issue Created",    description: "Auto-fires when an issue is filed in a specific category" },
  { value: "employee_created", label: "Employee Created", description: "Auto-fires when a new employee is added to the system" },
];

const ROLES = [
  { value: "staff",       label: "Staff" },
  { value: "manager",     label: "Manager" },
  { value: "admin",       label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
  { value: "vendor",      label: "Vendor" },
];

const CONDITION_TYPES = [
  { value: "always",            label: "Always (fallback)" },
  { value: "approved",          label: "Stage approved" },
  { value: "rejected",          label: "Stage rejected" },
  { value: "score_below",       label: "Score below threshold" },
  { value: "score_above",       label: "Score above threshold" },
  { value: "field_value_equals",label: "Field equals value" },
  { value: "field_failed",      label: "Field failed" },
  { value: "priority_equals",   label: "Priority equals" },
  { value: "role_equals",       label: "Role equals" },
  { value: "sla_breached",      label: "SLA breached" },
];

const SYSTEM_TYPES = new Set(["create_task", "create_issue", "create_incident", "notify", "wait", "assign_training"]);

function getStageType(value: string) {
  return STAGE_TYPES.find((t) => t.value === value) ?? STAGE_TYPES[0];
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [stages, setStages] = useState<WorkflowStage[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Header editable state
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("manual");
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({});
  const [isActive, setIsActive] = useState(true);
  const [activeInstanceCount, setActiveInstanceCount] = useState(0);
  const [publishErrors, setPublishErrors] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [showGenerateFormModal, setShowGenerateFormModal] = useState(false);
  const pendingUpdates = useRef(0);
  const drawerRef = useRef<{ saveNow: () => Promise<void> }>(null);
  const [triggerTemplates, setTriggerTemplates] = useState<{ id: string; title: string; type: string }[]>([]);
  const [triggerIssueCategories, setTriggerIssueCategories] = useState<{id:string; name:string}[]>([]);

  // Drawer / modal state
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [ruleModal, setRuleModal] = useState<{
    fromStageId: string;
    toStageId: string;
    editingRuleId?: string;
  } | null>(null);

  async function load(signal: { cancelled: boolean }) {
    try {
      const def = await getWorkflowDefinition(id);
      if (signal.cancelled) return;
      setDefinition(def);
      setName(def.name);
      setTriggerType(def.trigger_type ?? "manual");
      setIsActive(def.is_active);
      const sorted = [...(def.workflow_stages ?? [])].sort((a, b) => a.stage_order - b.stage_order);
      setTriggerConfig((def.trigger_config as Record<string, unknown>) ?? {});
      // Auto-create starting fill_form stage if empty — guard cancellation to avoid
      // React StrictMode double-invocation creating duplicate stages
      let finalStages = sorted;
      if (sorted.length === 0) {
        try {
          if (signal.cancelled) return;
          const firstStage = await addStage(def.id, {
            name: "Trigger",
            action_type: "fill_form",
            stage_order: 1,
            is_final: true,
          });
          if (signal.cancelled) {
            // Clean up the stage we just created in the cancelled invocation
            return;
          }
          finalStages = [firstStage];
          setSelectedStageId(firstStage.id);
        } catch { /* ignore */ }
      }
      if (signal.cancelled) return;
      setStages(finalStages);
      setRules((def.workflow_routing_rules ?? []).filter((r) => !r.is_deleted));
      // Count active instances to determine live-lock state
      try {
        const activeInstances = await listInstances({ definition_id: id, status: "in_progress" });
        if (!signal.cancelled) {
          setActiveInstanceCount(Array.isArray(activeInstances) ? activeInstances.length : 0);
        }
      } catch {
        if (!signal.cancelled) setActiveInstanceCount(0);
      }
    } catch (e) {
      if (!signal.cancelled) console.error(e);
    } finally {
      if (!signal.cancelled) setLoading(false);
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };
    load(signal);
    return () => { signal.cancelled = true; };
  }, [id]);

  // Load form templates for trigger config picker whenever a relevant trigger is selected
  const loadTriggerTemplates = useCallback(() => {
    listTemplates().then((r) => {
      setTriggerTemplates((r?.items ?? []) as { id: string; title: string; type: string }[]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const needsPicker = ["manual", "form_submitted"].includes(triggerType);
    if (!needsPicker) return;
    loadTriggerTemplates();
  }, [triggerType, loadTriggerTemplates]);

  useEffect(() => {
    if (triggerType !== "issue_created") return;
    listIssueCategories().then((res) => setTriggerIssueCategories(res.data)).catch(() => {});
  }, [triggerType]);

  // Track dirty state whenever name or trigger changes
  useEffect(() => {
    if (!definition) return;
    const dirty = name !== (definition?.name ?? "") || triggerType !== (definition?.trigger_type ?? "manual");
    setIsDirty(dirty);
    if (dirty) setSaved(false);
  }, [name, triggerType, definition]);

  // Save name + trigger in place — does NOT navigate or touch is_active
  async function saveHeader() {
    setSaving(true);
    try {
      await updateWorkflowDefinition(id, { name, trigger_type: triggerType, trigger_config: triggerConfig });
      setSaved(true);
      setIsDirty(false);
    } finally {
      setSaving(false);
    }
  }

  // Drag and drop reorder
  const onDragEnd = useCallback(async (result: DropResult) => {
    if (!result.destination || result.destination.index === result.source.index) return;

    const reordered = Array.from(stages);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    const withOrder = reordered.map((s, i) => ({ ...s, stage_order: i + 1 }));
    setStages(withOrder);

    await reorderStages(id, withOrder.map((s) => ({ id: s.id, stage_order: s.stage_order })));
  }, [stages, id]);

  // Add stage from palette
  async function handleAddStage(actionType: string) {
    const newOrder = stages.length + 1;
    try {
      // If the current last stage is marked final, un-mark it (a new stage is being added after it)
      const prevFinal = stages.find((s) => s.is_final);
      if (prevFinal) {
        await updateStage(id, prevFinal.id, { is_final: false });
        setStages((prev) => prev.map((s) => s.id === prevFinal.id ? { ...s, is_final: false } : s));
      }
      const stage = await addStage(id, {
        name: getStageType(actionType).label,
        action_type: actionType,
        stage_order: newOrder,
        is_final: true,
      });
      setStages((prev) => [...prev, stage]);
      setSelectedStageId(stage.id);
    } catch (e) {
      console.error(e);
    }
  }

  // Delete stage
  async function handleDeleteStage(stageId: string) {
    if (!confirm("Remove this stage?")) return;
    await deleteStage(id, stageId);
    setStages((prev) => prev.filter((s) => s.id !== stageId));
    setRules((prev) => prev.filter((r) => r.from_stage_id !== stageId && r.to_stage_id !== stageId));
    if (selectedStageId === stageId) setSelectedStageId(null);
  }

  // Update stage from drawer
  async function handleUpdateStage(stageId: string, patch: Partial<WorkflowStage>) {
    pendingUpdates.current += 1;
    try {
      // Enforce single final stage: clear is_final on all others when one is set
      if (patch.is_final === true) {
        const others = stages.filter((s) => s.id !== stageId && s.is_final);
        await Promise.all(others.map((s) => updateStage(id, s.id, { is_final: false })));
        setStages((prev) => prev.map((s) => s.id !== stageId && s.is_final ? { ...s, is_final: false } : s));
      }
      await updateStage(id, stageId, patch);
      setStages((prev) => prev.map((s) => s.id === stageId ? { ...s, ...patch } : s));
    } finally {
      pendingUpdates.current -= 1;
    }
  }

  // Rules CRUD
  async function handleSaveRule(rule: Omit<RoutingRule, "id" | "workflow_definition_id">, editingId?: string) {
    if (editingId) {
      await updateRoutingRule(id, editingId, rule);
      setRules((prev) => prev.map((r) => r.id === editingId ? { ...r, ...rule } : r));
    } else {
      const saved = await addRoutingRule(id, rule);
      setRules((prev) => [...prev, saved]);
    }
    setRuleModal(null);
  }

  async function handleDeleteRule(ruleId: string) {
    await deleteRoutingRule(id, ruleId);
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
  }

  const selectedStage = stages.find((s) => s.id === selectedStageId) ?? null;
  const isLive = isActive && activeInstanceCount > 0;

  // Trigger config validation — determines whether publish/save should be disabled
  const triggerConfigValid: boolean = (() => {
    if (triggerType === "manual" || triggerType === "form_submitted") {
      return !!(triggerConfig.form_template_id);
    }
    if (triggerType === "issue_created") {
      // issue_category_id is required for issue_created
      return !!(triggerConfig.issue_category_id);
    }
    // employee_created has no required fields
    return true;
  })();

  const triggerConfigWarning: string | null = (() => {
    if (triggerType === "manual" && !triggerConfig.form_template_id) {
      return "A Starting Form is required for Manual triggers.";
    }
    if (triggerType === "form_submitted" && !triggerConfig.form_template_id) {
      return "A Trigger Form is required for Form Submitted triggers.";
    }
    if (triggerType === "issue_created" && !triggerConfig.issue_category_id) {
      return "An Issue Category is required for Issue Created triggers.";
    }
    return null;
  })();

  // Extract the stage name from a publish error string like `Stage "Foo" has no assignee.`
  function errorToStageId(msg: string): string | null {
    const match = msg.match(/Stage "([^"]+)"/);
    if (!match) return null;
    const stageName = match[1];
    return stages.find((s) => s.name === stageName)?.id ?? null;
  }

  function handleErrorClick(msg: string) {
    const stageId = errorToStageId(msg);
    if (stageId) {
      setSelectedStageId(stageId);
      // Scroll the stage card into view
      setTimeout(() => {
        document.getElementById(`stage-card-${stageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-[#E8EDF2] bg-white shrink-0">
        <button
          onClick={() => setShowUnsavedConfirm(true)}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark/50 hover:text-dark transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="font-bold text-dark text-base border-0 outline-none bg-transparent min-w-0 flex-1"
            placeholder="Workflow name"
          />
          {/* Read-only status badge */}
          <span className={clsx(
            "shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full",
            isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          )}>
            {isActive ? "Active" : "Draft"}
          </span>
        </div>

        {/* Action buttons — vary by active state */}
        {isActive ? (
          <>
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  await updateWorkflowDefinition(id, { name, trigger_type: triggerType, is_active: false });
                  setIsActive(false);
                } finally { setSaving(false); }
              }}
              disabled={saving}
              className="text-xs font-medium text-dark/50 hover:text-red-500 border border-[#E8EDF2] hover:border-red-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40">
              Deactivate
            </button>
            <button onClick={saveHeader} disabled={saving}
              className="flex items-center gap-1.5 bg-sprout-green text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-sprout-green/90 disabled:opacity-50 transition-colors">
              <Save className="w-3.5 h-3.5" />
              {saving ? "Saving…" : saved && !isDirty ? "Saved ✓" : "Save"}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={saveHeader}
              disabled={saving || !triggerConfigValid}
              title={!triggerConfigValid ? (triggerConfigWarning ?? undefined) : undefined}
              className="text-xs font-medium text-dark/50 hover:text-dark border border-[#E8EDF2] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40">
              {saving ? "Saving…" : saved && !isDirty ? "Saved ✓" : "Save"}
            </button>
            <button
              onClick={async () => {
                setSaving(true);
                setPublishErrors(null);
                try {
                  // 1. Flush any unsaved drawer state first
                  if (drawerRef.current) {
                    await drawerRef.current.saveNow();
                  }
                  // 2. Wait for any other in-flight stage saves
                  let waited = 0;
                  while (pendingUpdates.current > 0 && waited < 3000) {
                    await new Promise((r) => setTimeout(r, 50));
                    waited += 50;
                  }
                  // 3. Fix stale is_final: ensure only one stage is marked final
                  const finalStages = stages.filter((s) => s.is_final);
                  if (finalStages.length > 1) {
                    const keepFinal = finalStages.reduce((a, b) => a.stage_order > b.stage_order ? a : b);
                    await Promise.all(
                      finalStages
                        .filter((s) => s.id !== keepFinal.id)
                        .map((s) => updateStage(id, s.id, { is_final: false }))
                    );
                    setStages((prev) => prev.map((s) =>
                      s.is_final && s.id !== keepFinal.id ? { ...s, is_final: false } : s
                    ));
                  }
                  // 4. Save workflow definition + activate
                  await updateWorkflowDefinition(id, { name, trigger_type: triggerType });
                  await publishWorkflow(id);
                  setIsActive(true);
                  setSaved(true);
                  setIsDirty(false);
                  router.push("/dashboard/workflows");
                } catch (e: unknown) {
                  if (e instanceof PublishValidationError) {
                    setPublishErrors(e.errors);
                  }
                } finally { setSaving(false); }
              }}
              disabled={saving || !triggerConfigValid}
              title={!triggerConfigValid ? (triggerConfigWarning ?? undefined) : undefined}
              className="flex items-center gap-1.5 bg-sprout-green text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-sprout-green/90 disabled:opacity-50 transition-colors">
              <Save className="w-3.5 h-3.5" />
              {saving ? "Activating…" : "Save & Activate"}
            </button>
          </>
        )}
      </div>

      {/* Live-lock banner */}
      {isLive && (
        <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-xs text-amber-700 shrink-0">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span className="font-semibold">{activeInstanceCount} instance{activeInstanceCount !== 1 ? "s" : ""} currently running</span>
          <span className="text-amber-500">— trigger is locked while the workflow is active. Deactivate to change it.</span>
        </div>
      )}

      {/* Publish errors panel */}
      {publishErrors && publishErrors.length > 0 && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200 shrink-0">
          <p className="text-xs font-semibold text-red-700 mb-1.5">
            Cannot publish — {publishErrors.length} issue{publishErrors.length !== 1 ? "s" : ""} found:
          </p>
          <ul className="space-y-1">
            {publishErrors.map((err, i) => {
              const stageId = errorToStageId(err);
              return (
                <li key={i}>
                  <button
                    onClick={() => handleErrorClick(err)}
                    className={clsx(
                      "text-xs text-red-600 text-left hover:underline flex items-start gap-1.5",
                      stageId ? "cursor-pointer" : "cursor-default"
                    )}>
                    <span className="shrink-0 mt-px">❌</span>
                    <span>{err}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-[10px] text-red-400 mt-2">Fix these issues before publishing. Click an error to jump to that stage.</p>
        </div>
      )}

      {/* Trigger config warning banner */}
      {!isActive && triggerConfigWarning && (
        <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-xs text-amber-700 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{triggerConfigWarning}</span>
          <span className="text-amber-500 ml-1">— set this in the Trigger panel on the left.</span>
        </div>
      )}

      {/* Body: palette | canvas | drawer */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Stage Palette */}
        <div className="w-48 shrink-0 border-r border-[#E8EDF2] bg-gray-50 p-3 overflow-y-auto">
          <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider mb-3">Stage Types</p>
          <div className="space-y-1.5">
            {STAGE_TYPES.map((st) => {
              const Icon = st.icon;
              return (
                <button key={st.value} onClick={() => handleAddStage(st.value)}
                  className={clsx(
                    "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors hover:scale-[1.02] active:scale-[0.98]",
                    st.bg, st.color, "hover:opacity-90"
                  )}>
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {st.label}
                </button>
              );
            })}
          </div>
          {/* Trigger type — locked whenever workflow is active */}
          <div className="mt-4 pt-4 border-t border-[#E8EDF2]">
            <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider mb-2">Trigger</p>
            {isActive ? (
              <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-gray-50 border border-[#E8EDF2]">
                <Lock className="w-3 h-3 text-dark/30 shrink-0" />
                <span className="text-xs text-dark/50 font-medium truncate">
                  {TRIGGER_TYPES.find((t) => t.value === triggerType)?.label ?? triggerType}
                </span>
              </div>
            ) : (
              <select
                value={triggerType}
                onChange={(e) => { setTriggerType(e.target.value); setTriggerConfig({}); }}
                className="w-full border border-[#E8EDF2] rounded-lg px-2.5 py-2 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/30 bg-white">
                {TRIGGER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            )}
            {isActive && (
              <p className="text-[10px] text-dark/40 mt-1 leading-snug">Deactivate to change the trigger.</p>
            )}

            {/* Trigger config */}
            {["manual", "form_submitted"].includes(triggerType) && (
              <div className="mt-2">
                <label className="block text-[10px] text-dark/50 font-semibold mb-1">
                  {triggerType === "manual"
                    ? <>Starting Form <span className="text-red-500">*</span></>
                    : <>Trigger Form <span className="text-red-500">*</span></>}
                </label>
                {isActive ? (
                  <div className="px-2 py-1.5 rounded-lg bg-gray-50 border border-[#E8EDF2] text-xs text-dark/50 truncate">
                    {triggerTemplates.find((t) => t.id === triggerConfig.form_template_id)?.title ?? "—"}
                  </div>
                ) : (
                  <>
                    <select
                      value={(triggerConfig.form_template_id as string) ?? ""}
                      onChange={(e) => {
                        const newCfg = { ...triggerConfig, form_template_id: e.target.value || null };
                        setTriggerConfig(newCfg);
                        updateWorkflowDefinition(id, { trigger_config: newCfg }).catch(console.error);
                      }}
                      className="w-full border border-[#E8EDF2] rounded-lg px-2 py-1.5 text-xs text-dark focus:outline-none bg-white">
                      <option value="">— None —</option>
                      {triggerTemplates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                    </select>
                    <div className="mt-1.5 space-y-1">
                      {triggerTemplates.length === 0 && (
                        <p className="text-[10px] text-dark/40">No form templates yet. Create one:</p>
                      )}
                      <button
                        onClick={() => setShowGenerateFormModal(true)}
                        className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg bg-violet-50 text-violet-600 text-[10px] font-semibold hover:bg-violet-100 transition-colors">
                        <Sparkles className="w-3 h-3 shrink-0" /> Generate with Sidekick
                      </button>
                      <a
                        href="/dashboard/forms?tab=templates&action=create"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg bg-gray-50 border border-[#E8EDF2] text-dark/60 text-[10px] font-medium hover:bg-gray-100 transition-colors">
                        <FileText className="w-3 h-3 shrink-0" /> Create Blank Form
                      </a>
                      <button
                        onClick={loadTriggerTemplates}
                        className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-dark/40 text-[10px] hover:text-dark transition-colors">
                        <RefreshCw className="w-3 h-3 shrink-0" /> Refresh
                      </button>
                    </div>
                  </>
                )}
                <p className="text-[10px] text-dark/30 mt-1 leading-snug">
                  {triggerType === "manual"
                    ? "Users must fill this form to start the workflow"
                    : "Workflow fires automatically when this form is submitted"}
                </p>
              </div>
            )}

            {triggerType === "issue_created" && (
              <div className="mt-2">
                <label className="block text-[10px] text-dark/50 font-semibold mb-1">Issue Category</label>
                {isActive ? (
                  <div className="px-2 py-1.5 rounded-lg bg-gray-50 border border-[#E8EDF2] text-xs text-dark/50 truncate">
                    {triggerIssueCategories.find((c) => c.id === triggerConfig.issue_category_id)?.name ?? "Any category"}
                  </div>
                ) : (
                  <select
                    value={(triggerConfig.issue_category_id as string) ?? ""}
                    onChange={(e) => {
                      const newCfg = { ...triggerConfig, issue_category_id: e.target.value || null };
                      setTriggerConfig(newCfg);
                      updateWorkflowDefinition(id, { trigger_config: newCfg }).catch(console.error);
                    }}
                    className="w-full border border-[#E8EDF2] rounded-lg px-2 py-1.5 text-xs text-dark focus:outline-none bg-white">
                    <option value="">— Any category —</option>
                    {triggerIssueCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
            )}

            {triggerType === "employee_created" && (
              <div className="mt-2 space-y-2">
                <label className="block text-[10px] text-dark/50 font-semibold">Trigger for roles</label>
                <div className="space-y-1">
                  {["staff", "manager", "admin"].map((r) => {
                    const cond = (triggerConfig.conditions as Record<string, unknown>) ?? {};
                    const roles = (cond.roles as string[]) ?? [];
                    return (
                      <label key={r} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={isActive}
                          checked={roles.includes(r)}
                          onChange={(e) => {
                            const currentCond = (triggerConfig.conditions as Record<string, unknown>) ?? {};
                            const currentRoles = (currentCond.roles as string[]) ?? [];
                            const newRoles = e.target.checked ? [...currentRoles, r] : currentRoles.filter((x) => x !== r);
                            const newConditions = { ...currentCond, roles: newRoles };
                            const newCfg = { ...triggerConfig, conditions: newConditions };
                            setTriggerConfig(newCfg);
                            updateWorkflowDefinition(id, { trigger_config: newCfg }).catch(console.error);
                          }}
                          className="rounded"
                        />
                        <span className="text-xs text-dark capitalize">{r}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center: Canvas */}
        <div className="flex-1 overflow-y-auto p-6">
          {stages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-dark/30">
              <Zap className="w-10 h-10 mb-3 opacity-40" />
              <p className="font-medium text-sm">Setting up…</p>
              <p className="text-xs mt-1">Creating starting stage</p>
            </div>
          ) : (
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="stages">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="flex flex-col items-center gap-0 max-w-sm mx-auto">
                    {stages.map((stage, idx) => {
                      const stageRules = rules.filter((r) => r.from_stage_id === stage.id);
                      const isSelected = selectedStageId === stage.id;
                      const st = getStageType(stage.action_type);
                      const Icon = st.icon;
                      const isSystem = SYSTEM_TYPES.has(stage.action_type);
                      const isStartingStage = idx === 0;

                      return (
                        <Draggable key={stage.id} draggableId={stage.id} index={idx} isDragDisabled={isStartingStage}>
                          {(drag, snapshot) => (
                            <div className="flex flex-col items-center w-full">
                              <div
                                id={`stage-card-${stage.id}`}
                                ref={drag.innerRef}
                                {...drag.draggableProps}
                                className={clsx(
                                  "w-full border-2 rounded-xl shadow-sm transition-all cursor-pointer",
                                  isStartingStage
                                    ? "bg-blue-50/40"
                                    : "bg-white",
                                  isSelected
                                    ? "border-sprout-purple shadow-md"
                                    : isStartingStage
                                      ? "border-blue-200 hover:border-sprout-purple/40"
                                      : "border-[#E8EDF2] hover:border-sprout-purple/40",
                                  publishErrors?.some(e => errorToStageId(e) === stage.id) && !isSelected && "border-red-300 bg-red-50/30",
                                  snapshot.isDragging && "shadow-lg rotate-1"
                                )}
                                onClick={() => setSelectedStageId(isSelected ? null : stage.id)}
                              >
                                {isStartingStage && (
                                  <div className="px-3 pt-2 pb-0.5 flex items-center justify-between gap-2">
                                    <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wider shrink-0">Trigger</span>
                                    {["manual", "form_submitted"].includes(triggerType) && (
                                      triggerConfig.form_template_id
                                        ? <span className="text-[9px] text-dark/50 truncate font-medium">
                                            {triggerTemplates.find(t => t.id === triggerConfig.form_template_id)?.title ?? ""}
                                          </span>
                                        : <span className="text-[9px] text-amber-500 font-semibold shrink-0">No template</span>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-2 px-3 py-2.5">
                                  {isStartingStage ? (
                                    <Lock className="w-3.5 h-3.5 text-dark/20 shrink-0" />
                                  ) : (
                                    <div {...drag.dragHandleProps} className="text-dark/20 hover:text-dark/50 cursor-grab active:cursor-grabbing" onClick={(e) => e.stopPropagation()}>
                                      <GripVertical className="w-4 h-4" />
                                    </div>
                                  )}
                                  <div className={clsx("w-6 h-6 rounded-md flex items-center justify-center shrink-0", st.bg)}>
                                    <Icon className={clsx("w-3.5 h-3.5", st.color)} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-dark truncate">{stage.name}</p>
                                    <p className="text-[10px] text-dark/40">
                                      <span className={clsx("font-medium", st.color)}>{st.label}</span>
                                      <span className="mx-1">·</span>
                                      {isSystem ? "auto" : (stage.assigned_role ?? "No role")}
                                      {stage.sla_hours ? ` · ${stage.sla_hours}h SLA` : ""}
                                    </p>
                                  </div>
                                  {stage.is_final && (
                                    <span className="text-[9px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full shrink-0">FINAL</span>
                                  )}
                                  {!isStartingStage && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleDeleteStage(stage.id); }}
                                      className="p-1 rounded hover:bg-red-50 text-dark/20 hover:text-red-500 transition-colors shrink-0">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setSelectedStageId(stage.id); }}
                                    className="p-1 rounded hover:bg-gray-100 text-dark/30 hover:text-sprout-purple transition-colors shrink-0">
                                    <Settings className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Connector + rules */}
                              {idx < stages.length - 1 && (() => {
                                const conditionalRules = stageRules.filter(r => r.condition_type !== "always");
                                const alwaysRule = stageRules.find(r => r.condition_type === "always");
                                const nextStage = stages[idx + 1];
                                return (
                                  <div className="flex flex-col items-center py-1 w-full">
                                    <div className="w-px h-3 bg-gray-300" />

                                    {/* Conditional rules (non-always) */}
                                    {conditionalRules.map((rule) => (
                                      <div key={rule.id} className="flex items-center gap-1 group">
                                        <button
                                          onClick={() => setRuleModal({ fromStageId: rule.from_stage_id, toStageId: rule.to_stage_id, editingRuleId: rule.id })}
                                          className="text-[10px] font-medium bg-white border border-[#E8EDF2] rounded-full px-2.5 py-0.5 text-dark/60 hover:text-sprout-purple hover:border-sprout-purple/40 transition-colors my-0.5">
                                          {rule.label || CONDITION_TYPES.find(c => c.value === rule.condition_type)?.label || rule.condition_type}
                                          {rule.condition_value ? ` "${rule.condition_value}"` : ""}
                                        </button>
                                        <button onClick={() => handleDeleteRule(rule.id)}
                                          className="text-dark/20 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                          <X className="w-3 h-3" />
                                        </button>
                                      </div>
                                    ))}

                                    {/* Always (fallback) — shown as explicit rule if saved, or as static grey placeholder */}
                                    {alwaysRule ? (
                                      <div className="flex items-center gap-1 group">
                                        <button
                                          onClick={() => setRuleModal({ fromStageId: alwaysRule.from_stage_id, toStageId: alwaysRule.to_stage_id, editingRuleId: alwaysRule.id })}
                                          className="text-[10px] italic text-dark/30 border border-dashed border-gray-200 rounded-full px-2.5 py-0.5 hover:text-dark/50 hover:border-gray-300 transition-colors my-0.5">
                                          {alwaysRule.label || "always"}
                                        </button>
                                        <button onClick={() => handleDeleteRule(alwaysRule.id)}
                                          className="text-dark/20 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                          <X className="w-3 h-3" />
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-[10px] italic text-dark/25 my-0.5 select-none">always</span>
                                    )}

                                    {/* Add conditional rule */}
                                    <button
                                      onClick={() => { if (nextStage) setRuleModal({ fromStageId: stage.id, toStageId: nextStage.id }); }}
                                      className="text-[10px] text-dark/30 hover:text-sprout-purple hover:underline transition-colors mt-0.5">
                                      + condition
                                    </button>

                                    <ArrowDown className="w-3.5 h-3.5 text-gray-300 mt-1" />
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}
        </div>

        {/* Right: Config Drawer */}
        {selectedStage && (
          <StageConfigDrawer
            key={selectedStage.id}
            saveRef={drawerRef}
            stage={selectedStage}
            rules={rules}
            isLastStage={selectedStage.id === stages[stages.length - 1]?.id}
            isFirstStage={selectedStage.id === stages[0]?.id}
            triggerType={triggerType}
            triggerConfig={triggerConfig}
            isActive={isActive}
            onUpdate={(patch) => handleUpdateStage(selectedStage.id, patch)}
            onClose={() => setSelectedStageId(null)}
          />
        )}
      </div>

      {/* Routing Rule Modal */}
      {ruleModal && (
        <RoutingRuleModal
          stages={stages}
          fromStageId={ruleModal.fromStageId}
          toStageId={ruleModal.toStageId}
          editingRule={ruleModal.editingRuleId ? rules.find((r) => r.id === ruleModal.editingRuleId) : undefined}
          onSave={(rule) => handleSaveRule(rule, ruleModal.editingRuleId)}
          onClose={() => setRuleModal(null)}
        />
      )}

      {/* Unsaved changes confirmation */}
      {showUnsavedConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-dark">Leave workflow builder?</h2>
            <p className="text-sm text-dark-secondary">Any unsaved name or trigger changes will be lost.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowUnsavedConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => { setShowUnsavedConfirm(false); router.push("/dashboard/workflows"); }}
                className="px-4 py-2 text-sm rounded-lg text-dark-secondary border border-surface-border hover:bg-gray-100">
                Discard
              </button>
              <button
                onClick={async () => { await saveHeader(); setShowUnsavedConfirm(false); router.push("/dashboard/workflows"); }}
                className="px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90">
                Save & Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {showGenerateFormModal && (
        <GenerateFormInlineModal
          workflowName={name}
          triggerType={triggerType}
          onClose={() => setShowGenerateFormModal(false)}
          onCreated={async (newTemplate) => {
            setShowGenerateFormModal(false);
            await loadTriggerTemplates();
            const newCfg = { ...triggerConfig, form_template_id: newTemplate.id };
            setTriggerConfig(newCfg);
            updateWorkflowDefinition(id, { trigger_config: newCfg }).catch(console.error);
          }}
        />
      )}
    </div>
  );
}


// ─── Generate Form Inline Modal ────────────────────────────────────────────────

function GenerateFormInlineModal({
  workflowName,
  triggerType,
  onClose,
  onCreated,
}: {
  workflowName: string;
  triggerType: string;
  onClose: () => void;
  onCreated: (template: { id: string; title: string }) => void;
}) {
  const defaultType = "form";
  const [extraDetails, setExtraDetails] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    setLoading(true);
    setError("");
    try {
      const description = extraDetails.trim()
        ? `${workflowName} — ${extraDetails.trim()}`
        : workflowName;
      const generated = await generateTemplate({ description, type: defaultType });
      const created = await createTemplate({
        title: generated.title,
        description: (generated as unknown as { description?: string }).description ?? "",
        type: defaultType,
        sections: generated.sections,
      });
      // Open the form template detail panel in the Forms page (new tab)
      window.open(`/dashboard/forms?tab=templates&open=${created.id}`, "_blank");
      onCreated({ id: created.id, title: created.title });
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("overloaded") || msg.includes("529")) {
        setError("The AI service is temporarily busy. Wait a few seconds and try again.");
      } else {
        setError(msg || "Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-sprout-purple" />
          <h2 className="text-base font-semibold bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">
            Generate Form with Sidekick
          </h2>
        </div>
        <p className="text-sm text-dark/60 leading-snug">
          Sidekick will create a{" "}
          <span className="font-semibold text-dark/80">{defaultType}</span>{" "}
          template based on your workflow:
        </p>
        <div className="px-3 py-2 rounded-lg bg-violet-50 border border-violet-100">
          <p className="text-sm font-semibold text-violet-700">{workflowName}</p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-dark/50 font-medium">
            Add details <span className="text-dark/30">(optional)</span>
          </label>
          <textarea
            className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30 resize-none"
            rows={2}
            placeholder="e.g. Include supplier info, product categories, compliance checkboxes"
            value={extraDetails}
            onChange={(e) => setExtraDetails(e.target.value)}
            disabled={loading}
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg border border-[#E8EDF2] hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
              : <><Sparkles className="w-4 h-4" /> Generate Now</>}
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Stage Config Drawer ──────────────────────────────────────────────────────

function StageConfigDrawer({
  stage,
  rules,
  isLastStage,
  isFirstStage,
  triggerType,
  triggerConfig,
  isActive,
  onUpdate,
  onClose,
  saveRef,
}: {
  stage: WorkflowStage;
  rules: RoutingRule[];
  isLastStage: boolean;
  isFirstStage: boolean;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  isActive: boolean;
  onUpdate: (patch: Partial<WorkflowStage>) => Promise<void>;
  onClose: () => void;
  saveRef?: React.MutableRefObject<{ saveNow: () => Promise<void> } | null>;
}) {
  const DEFAULT_NAMES: Record<string, string> = {
    fill_form: "Fill Form", approve: "Approval", sign: "Sign Off",
    review: "Review", create_task: "Create Task", create_issue: "Create Issue",
    create_incident: "Create Incident", notify: "Notify", wait: "Wait",
    assign_training: "Assign Training",
  };

  const [name, setName] = useState(stage.name);
  const [nameEdited, setNameEdited] = useState(
    stage.name !== DEFAULT_NAMES[stage.action_type] && stage.name !== ""
  );
  const [role, setRole] = useState(stage.assigned_role ?? "");
  const [isFinal, setIsFinal] = useState(stage.is_final);
  const [slaHours, setSlaHours] = useState<string>(stage.sla_hours ? String(stage.sla_hours) : "");
  const [config, setConfig] = useState<Record<string, string>>(
    (stage.config as Record<string, string>) ?? {}
  );
  const [formTemplates, setFormTemplates] = useState<{ id: string; title: string; type: string; is_active: boolean }[]>([]);
  const [saveError, setSaveError] = useState("");
  const [stageSaving, setStageSaving] = useState(false);
  const [stageSaved, setStageSaved] = useState(false);
  const prevHasOutgoing = useRef<boolean | null>(null);

  // Expose saveNow() via saveRef so "Save & Publish" can flush all current state
  useImperativeHandle(saveRef, () => ({ saveNow: saveAll }));

  // Does this stage have any outgoing routing rules, or is it not the last stage?
  const hasOutgoing = !isLastStage || rules.some((r) => r.from_stage_id === stage.id);

  // When a routing rule is added to this stage (hasOutgoing flips true), clear is_final.
  // Skip on initial mount to avoid overwriting DB values with stale rule state.
  useEffect(() => {
    if (prevHasOutgoing.current === null) {
      prevHasOutgoing.current = hasOutgoing;
      return;
    }
    if (hasOutgoing && !prevHasOutgoing.current && isFinal) {
      prevHasOutgoing.current = hasOutgoing;
      setIsFinal(false);
      onUpdate({ is_final: false }).catch(() => {});
    } else {
      prevHasOutgoing.current = hasOutgoing;
    }
  }, [hasOutgoing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load form templates for fill_form
  const loadTemplates = useCallback(() => {
    listTemplates().then((r) => {
      setFormTemplates((r?.items ?? []) as { id: string; title: string; type: string; is_active: boolean }[]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (stage.action_type !== "fill_form") return;
    loadTemplates();
  }, [stage.action_type, loadTemplates]);

  // Returns the auto-filled name (or current name if user has manually edited)
  function autoName(next: string): string {
    if (!nameEdited) { setName(next); return next; }
    return name;
  }

  // Called by "Save Stage" button and by "Save & Publish" via saveRef
  async function saveAll() {
    setStageSaving(true);
    setSaveError("");
    try {
      await onUpdate({
        name,
        assigned_role: role || null,
        config,
        form_template_id: (config.form_template_id as string) || null,
        sla_hours: slaHours ? parseInt(slaHours) : null,
        is_final: isFinal,
      });
      setStageSaved(true);
      setTimeout(() => setStageSaved(false), 2000);
    } catch (e: unknown) {
      setSaveError((e as Error)?.message ?? "Failed to save — please try again.");
    } finally {
      setStageSaving(false);
    }
  }

  function handleNameChange(val: string) {
    setName(val);
    setNameEdited(true);
    setStageSaved(false);
  }

  function handleFormTemplateChange(templateId: string) {
    const newConfig = { ...config, form_template_id: templateId };
    setConfig(newConfig);
    const tpl = formTemplates.find((t) => t.id === templateId);
    autoName(tpl ? tpl.title : DEFAULT_NAMES.fill_form);
    onUpdate({ config: newConfig, form_template_id: templateId || null }).catch(() => {});
  }

  function handleRoleChange(newRole: string) {
    setRole(newRole);
    if (stage.action_type === "approve") {
      const label = ROLES.find((r) => r.value === newRole)?.label;
      autoName(label ? `${label} Approval` : DEFAULT_NAMES.approve);
    } else if (stage.action_type === "notify") {
      const label = ROLES.find((r) => r.value === newRole)?.label;
      autoName(label ? `Notify ${label}` : DEFAULT_NAMES.notify);
    }
    onUpdate({ assigned_role: newRole || null }).catch(() => {});
  }

  function handleConfigChange(key: string, value: string) {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    setStageSaved(false);
    if (stage.action_type === "create_task" && key === "title") {
      autoName(value ? `Create Task — ${value}` : DEFAULT_NAMES.create_task);
    } else if (stage.action_type === "create_issue" && key === "title") {
      autoName(value ? `Create Issue — ${value}` : DEFAULT_NAMES.create_issue);
    } else if (stage.action_type === "wait" && (key === "hours" || key === "days")) {
      const unit = newConfig.unit === "days" || key === "days" ? "days" : "hours";
      autoName(value ? `Wait ${value} ${unit}` : DEFAULT_NAMES.wait);
    }
    setStageSaved(false);
  }

  function handleSlaChange(val: string) {
    setSlaHours(val);
    setStageSaved(false);
  }

  const isSystem = SYSTEM_TYPES.has(stage.action_type);
  const st = getStageType(stage.action_type);
  const Icon = st.icon;

  return (
    <div className="w-72 shrink-0 border-l border-[#E8EDF2] bg-white overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8EDF2]">
        <div className="flex items-center gap-2">
          <div className={clsx("w-6 h-6 rounded-md flex items-center justify-center", st.bg)}>
            <Icon className={clsx("w-3.5 h-3.5", st.color)} />
          </div>
          <span className="text-sm font-semibold text-dark">Stage Config</span>
        </div>
        <button onClick={onClose} className="text-dark/40 hover:text-dark text-xl leading-none">&times;</button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-dark/60 mb-1.5">Stage Name</label>
          <input
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder={DEFAULT_NAMES[stage.action_type] ?? stage.action_type}
            className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
          />
        </div>

        {stage.action_type === "fill_form" && (
          <div>
            {isFirstStage && triggerType === "form_submitted" ? (
              /* Read-only review — template is locked to the trigger's template */
              <div>
                <label className="block text-xs font-semibold text-dark/60 mb-1.5">Linked Template</label>
                {triggerConfig.form_template_id ? (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-[#E8EDF2]">
                      <Lock className="w-3 h-3 text-dark/30 shrink-0" />
                      <span className="text-sm text-dark/60 truncate">
                        {formTemplates.find((t) => t.id === triggerConfig.form_template_id)?.title ?? "Loading…"}
                      </span>
                    </div>
                    <p className="text-[10px] text-blue-500 mt-1.5 leading-snug">
                      Read-only review — this form was already submitted when the workflow was triggered.
                    </p>
                  </>
                ) : (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 space-y-1">
                    <p className="text-xs font-semibold text-amber-700">No form template configured</p>
                    <p className="text-[10px] text-amber-600 leading-snug">
                      Set the <span className="font-semibold">Form Template</span> in the <span className="font-semibold">Trigger</span> section on the left panel. This stage will display that form for review.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* Editable template picker */
              <div>
                <label className="block text-xs font-semibold text-dark/60 mb-1.5">
                  Link Form Template <span className="text-red-500">*</span>
                </label>
                {isFirstStage && triggerType === "issue_created" && (
                  <p className="text-[10px] text-dark/40 mb-1.5">This form captures investigation details for the created issue.</p>
                )}
                <select
                  value={config.form_template_id ?? ""}
                  onChange={(e) => handleFormTemplateChange(e.target.value)}
                  className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30">
                  <option value="">— None —</option>
                  {formTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.title} ({t.type})</option>
                  ))}
                </select>
                {config.form_template_id &&
                  formTemplates.find((t) => t.id === config.form_template_id)?.is_active === false && (
                  <p className="text-[10px] text-amber-600 mt-1 flex items-start gap-1">
                    <span>⚠️</span>
                    <span>This template is deactivated. New workflow instances cannot use it.</span>
                  </p>
                )}
                {formTemplates.length === 0 && (
                  <div className="mt-1.5 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5 space-y-1.5">
                    <p className="text-xs text-dark/60">No form templates in your organisation yet.</p>
                    <div className="flex items-center gap-3">
                      <a href="/dashboard/forms" target="_blank" rel="noreferrer"
                        className="text-xs font-semibold text-sprout-purple hover:underline">
                        Create a template →
                      </a>
                      <button onClick={loadTemplates}
                        className="text-xs text-dark/40 hover:text-dark transition-colors">
                        Refresh ↺
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!isSystem && (
          <>
            <div>
              <label className="block text-xs font-semibold text-dark/60 mb-1.5">
                Assignee Role{["fill_form","approve","sign"].includes(stage.action_type) && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <select value={role} onChange={(e) => handleRoleChange(e.target.value)}
                className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none">
                <option value="">— Unassigned —</option>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-dark/60 mb-1.5">SLA Hours</label>
              <input type="number" min="0" value={slaHours}
                onChange={(e) => handleSlaChange(e.target.value)}
                placeholder="e.g. 2"
                className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30" />
              <p className="text-[10px] text-dark/40 mt-1">Leave blank for no SLA limit</p>
            </div>

            {/* Final stage — only shown when stage has no outgoing routing rules */}
            {!hasOutgoing && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isFinal}
                  onChange={(e) => {
                    setIsFinal(e.target.checked);
                    onUpdate({ is_final: e.target.checked }).catch(() => {});
                    setStageSaved(false);
                  }}
                  className="rounded" />
                <span className="text-sm text-dark font-medium">Final stage</span>
              </label>
            )}
          </>
        )}

        {(stage.action_type === "create_task" || stage.action_type === "create_issue" || stage.action_type === "create_incident") && (
          <div>
            <label className="block text-xs font-semibold text-dark/60 mb-1.5">Title</label>
            <input value={config.title ?? ""} onChange={(e) => handleConfigChange("title", e.target.value)}
              placeholder="e.g. Fix refrigeration issue"
              className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30" />
          </div>
        )}

        {(stage.action_type === "create_task" || stage.action_type === "create_issue") && (
          <div>
            <label className="block text-xs font-semibold text-dark/60 mb-1.5">Priority</label>
            <select value={config.priority ?? "medium"}
              onChange={(e) => {
                const newConfig = { ...config, priority: e.target.value };
                setConfig(newConfig);
                setStageSaved(false);
              }}
              className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none">
              {["low","medium","high","critical"].map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
            </select>
          </div>
        )}

        {stage.action_type === "create_task" && (
          <div>
            <label className="block text-xs font-semibold text-dark/60 mb-1.5">Assign To Role</label>
            <select value={config.assign_role ?? ""}
              onChange={(e) => {
                const newConfig = { ...config, assign_role: e.target.value };
                setConfig(newConfig);
                setStageSaved(false);
              }}
              className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="">— Unassigned —</option>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        )}

        {stage.action_type === "notify" && (
          <div>
            <label className="block text-xs font-semibold text-dark/60 mb-1.5">Message</label>
            <textarea value={config.message ?? ""}
              onChange={(e) => {
                const newConfig = { ...config, message: e.target.value };
                setConfig(newConfig);
                setStageSaved(false);
              }}
              rows={3} placeholder="Notification message"
              className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none resize-none focus:ring-2 focus:ring-sprout-purple/30" />
          </div>
        )}

        {stage.action_type === "wait" && (
          <div>
            <label className="block text-xs font-semibold text-dark/60 mb-1.5">
              Wait Duration (hours) <span className="text-red-500">*</span>
            </label>
            <input type="number" min="1" value={config.hours ?? ""}
              onChange={(e) => handleConfigChange("hours", e.target.value)}
              placeholder="e.g. 24"
              className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30" />
          </div>
        )}

        {stage.action_type === "assign_training" && (
          <AssignTrainingConfig config={config} isActive={isActive} onChange={(newConfig) => { setConfig(newConfig as Record<string, string>); setStageSaved(false); }} />
        )}

        {saveError && (
          <p className="text-[10px] text-red-500 text-center">⚠️ {saveError}</p>
        )}
        <button
          onClick={saveAll}
          disabled={stageSaving}
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-colors bg-sprout-purple text-white hover:bg-sprout-purple/90 disabled:opacity-50"
        >
          {stageSaving ? "Saving…" : stageSaved ? "Saved ✓" : "Save Stage"}
        </button>
      </div>
    </div>
  );
}


// ─── Assign Training Config ───────────────────────────────────────────────────

function AssignTrainingConfig({
  config,
  isActive,
  onChange,
}: {
  config: Record<string, string>;
  isActive: boolean;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const [courses, setCourses] = useState<{id: string; title: string}[]>([]);

  useEffect(() => {
    listManagedCourses().then((r) => setCourses(r.items)).catch(() => {});
  }, []);

  const selectedIds: string[] = (() => {
    try { return JSON.parse(config.course_ids ?? "[]"); } catch { return []; }
  })();

  function toggleCourse(courseId: string) {
    const next = selectedIds.includes(courseId)
      ? selectedIds.filter((x) => x !== courseId)
      : [...selectedIds, courseId];
    onChange({ ...config, course_ids: JSON.stringify(next) });
  }

  return (
    <>
      <div>
        <label className="block text-xs font-semibold text-dark/60 mb-1.5">Courses to assign <span className="text-red-500">*</span></label>
        {courses.length === 0 ? (
          <p className="text-xs text-dark/40">No published courses found.</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto border border-[#E8EDF2] rounded-lg p-2">
            {courses.map((c) => (
              <label key={c.id} className={clsx("flex items-center gap-2 cursor-pointer", isActive && "opacity-50 pointer-events-none")}>
                <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleCourse(c.id)} className="rounded" />
                <span className="text-xs text-dark">{c.title}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="block text-xs font-semibold text-dark/60 mb-1.5">Deadline (days)</label>
        <input
          type="number" min="1"
          value={config.deadline_days ?? ""}
          disabled={isActive}
          onChange={(e) => onChange({ ...config, deadline_days: e.target.value })}
          placeholder="e.g. 30"
          className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30 disabled:opacity-50"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-dark/60 mb-1.5">On deadline missed</label>
        <select
          value={config.on_deadline_missed ?? "notify_manager"}
          disabled={isActive}
          onChange={(e) => onChange({ ...config, on_deadline_missed: e.target.value })}
          className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none disabled:opacity-50">
          <option value="notify_manager">Notify manager</option>
          <option value="escalate">Escalate</option>
        </select>
      </div>
    </>
  );
}


// ─── Routing Rule Modal ───────────────────────────────────────────────────────

function RoutingRuleModal({
  stages,
  fromStageId,
  toStageId,
  editingRule,
  onSave,
  onClose,
}: {
  stages: WorkflowStage[];
  fromStageId: string;
  toStageId: string;
  editingRule?: RoutingRule;
  onSave: (rule: Omit<RoutingRule, "id" | "workflow_definition_id">) => Promise<void>;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(editingRule?.from_stage_id ?? fromStageId);
  const [to, setTo] = useState(editingRule?.to_stage_id ?? toStageId);
  const [condType, setCondType] = useState(editingRule?.condition_type ?? "always");
  const [condValue, setCondValue] = useState(editingRule?.condition_value ?? "");
  const [priority, setPriority] = useState<number>(editingRule?.priority ?? 0);
  const [label, setLabel] = useState(editingRule?.label ?? "");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const needsValue = ["score_below","score_above","field_value_equals","priority_equals","role_equals"].includes(condType);

  async function handleSave() {
    const errs: string[] = [];
    if (from === to) errs.push("From and To stages must be different.");
    if (needsValue && !condValue.trim()) errs.push("A value is required for this condition type.");
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    setSaving(true);
    try {
      await onSave({
        from_stage_id: from,
        to_stage_id: to,
        condition_type: condType,
        condition_value: condValue || null,
        priority,
        label: label || null,
        is_deleted: false,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-[#E8EDF2]">
          <h2 className="text-base font-bold text-dark">
            {editingRule ? "Edit Routing Rule" : "Add Routing Rule"}
          </h2>
          <button onClick={onClose} className="text-dark/40 hover:text-dark text-2xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {/* From → To */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-dark/60 mb-1">
                From Stage <span className="text-red-500">*</span>
              </label>
              <select value={from} onChange={(e) => { setFrom(e.target.value); setErrors([]); }}
                className={clsx("w-full border rounded-lg px-2.5 py-2 text-sm focus:outline-none",
                  errors.some(e => e.includes("From and To")) ? "border-red-300" : "border-[#E8EDF2]")}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <ChevronRight className="w-4 h-4 text-dark/30 mt-4 shrink-0" />
            <div className="flex-1">
              <label className="block text-xs font-semibold text-dark/60 mb-1">
                To Stage <span className="text-red-500">*</span>
              </label>
              <select value={to} onChange={(e) => { setTo(e.target.value); setErrors([]); }}
                className={clsx("w-full border rounded-lg px-2.5 py-2 text-sm focus:outline-none",
                  errors.some(e => e.includes("From and To")) ? "border-red-300" : "border-[#E8EDF2]")}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-dark/60 mb-1">
              Condition <span className="text-red-500">*</span>
            </label>
            <select value={condType} onChange={(e) => { setCondType(e.target.value); setErrors([]); }}
              className="w-full border border-[#E8EDF2] rounded-lg px-2.5 py-2 text-sm focus:outline-none">
              {CONDITION_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {needsValue && (
            <div>
              <label className="block text-xs font-semibold text-dark/60 mb-1">
                Value <span className="text-red-500">*</span>
              </label>
              <input value={condValue} onChange={(e) => { setCondValue(e.target.value); setErrors([]); }}
                placeholder={condType === "score_below" || condType === "score_above" ? "e.g. 60" : "e.g. critical"}
                className={clsx("w-full border rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30",
                  errors.some(e => e.includes("value")) ? "border-red-300" : "border-[#E8EDF2]")} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-dark/60 mb-1">Label (optional)</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. If score &lt; 60%"
                className="w-full border border-[#E8EDF2] rounded-lg px-2.5 py-2 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-dark/60 mb-1">Priority</label>
              <input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                className="w-full border border-[#E8EDF2] rounded-lg px-2.5 py-2 text-sm focus:outline-none" />
            </div>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="mx-5 mb-1 rounded-lg bg-red-50 border border-red-200 px-3 py-2 space-y-0.5">
            {errors.map((e, i) => (
              <p key={i} className="text-xs text-red-600 flex items-start gap-1.5">
                <span className="shrink-0">⚠️</span>{e}
              </p>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-[#E8EDF2]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-dark/60 hover:text-dark">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-sprout-purple text-white text-sm font-semibold rounded-lg hover:bg-sprout-purple/90 disabled:opacity-50 transition-colors">
            {saving ? "Saving…" : editingRule ? "Update Rule" : "Add Rule"}
          </button>
        </div>
      </div>
    </div>
  );
}
