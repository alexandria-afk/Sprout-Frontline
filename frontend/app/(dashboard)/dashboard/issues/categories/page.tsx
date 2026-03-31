"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Settings, Plus, X, Pencil, Trash2, ChevronDown, ChevronRight,
  Loader2, Tag, Zap, ToggleLeft, ToggleRight, ChevronLeft, Sparkles, ArrowLeft,
} from "lucide-react";
import {
  listIssueCategories,
  createIssueCategory,
  updateIssueCategory,
  deleteIssueCategory,
  createCustomField,
  deleteCustomField,
  createEscalationRule,
  deleteEscalationRule,
} from "@/services/issues";
import type { IssueCategory, IssueCustomField, EscalationRule } from "@/types";
import { friendlyError } from "@/lib/errors";

// ── Constants ────────────────────────────────────────────────────────────────

const inputCls =
  "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full";

const PRESET_COLORS = [
  "#3B82F6",
  "#EF4444",
  "#F59E0B",
  "#10B981",
  "#8B5CF6",
  "#EC4899",
];

const FIELD_TYPE_LABELS: Record<string, string> = {
  text:     "Text",
  number:   "Number",
  dropdown: "Dropdown",
  checkbox: "Checkbox",
  date:     "Date",
};

const ESCALATION_TRIGGER_LABELS: Record<string, string> = {
  on_create:        "On Create",
  sla_breach:       "SLA Breach",
  priority_critical:"Critical Priority",
  status_change:    "Status Change",
  unresolved_hours: "Unresolved Hours",
};

const NOTIFY_ROLES = ["admin", "manager", "staff"];

// ── Color Picker ──────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className={clsx(
            "w-7 h-7 rounded-full border-2 transition-transform hover:scale-110",
            value === color ? "border-dark scale-110" : "border-transparent"
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

// ── Create / Edit Category Modal ──────────────────────────────────────────────

interface CategoryFormState {
  name: string;
  default_priority: string;
  description: string;
  color: string;
  sla_hours: string;
}

function CategoryModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: IssueCategory;
  onClose: () => void;
  onSave: (cat: IssueCategory) => void;
}) {
  const [form, setForm] = useState<CategoryFormState>({
    name:             initial?.name             ?? "",
    default_priority: initial?.default_priority ?? "medium",
    description:      initial?.description      ?? "",
    color:            initial?.color            ?? PRESET_COLORS[0],
    sla_hours:        String(initial?.sla_hours ?? 24),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<CategoryFormState>>({});

  const validate = () => {
    const errs: Partial<CategoryFormState> = {};
    if (!form.name.trim()) errs.name = "Name is required.";
    if (!form.default_priority) errs.default_priority = "Priority is required.";
    const sla = Number(form.sla_hours);
    if (isNaN(sla) || sla <= 0) errs.sla_hours = "Must be a positive number.";
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }
    setFieldErrors({});
    setError("");
    setSubmitting(true);
    try {
      const payload = {
        name:             form.name.trim(),
        default_priority: form.default_priority as "low" | "medium" | "high" | "critical",
        description:      form.description.trim() || undefined,
        color:            form.color,
        sla_hours:        Number(form.sla_hours),
      };
      const cat = initial
        ? await updateIssueCategory(initial.id, payload)
        : await createIssueCategory(payload);
      onSave(cat);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const set = (key: keyof CategoryFormState) => (val: string) =>
    setForm((p) => ({ ...p, [key]: val }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-dark">{initial ? "Edit Category" : "New Category"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-dark-secondary" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Name *</label>
            <input className={inputCls} placeholder="Category name" value={form.name} onChange={(e) => set("name")(e.target.value)} />
            {fieldErrors.name && <p className="text-xs text-red-500">{fieldErrors.name}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Default Priority <span className="text-red-500">*</span></label>
            <select
              className={inputCls}
              value={form.default_priority}
              onChange={(e) => set("default_priority")(e.target.value)}
            >
              <option value="">— Select priority —</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            {fieldErrors.default_priority && <p className="text-xs text-red-500">{fieldErrors.default_priority}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Description</label>
            <textarea className={clsx(inputCls, "resize-none")} rows={2} placeholder="Optional description" value={form.description} onChange={(e) => set("description")(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-dark">Color</label>
            <ColorPicker value={form.color} onChange={set("color")} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">SLA Hours</label>
            <input
              className={inputCls}
              type="number"
              min={1}
              placeholder="24"
              value={form.sla_hours}
              onChange={(e) => set("sla_hours")(e.target.value)}
            />
            {fieldErrors.sla_hours && <p className="text-xs text-red-500">{fieldErrors.sla_hours}</p>}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {submitting ? "Saving…" : initial ? "Save Changes" : "Create Category"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Custom Field Modal ────────────────────────────────────────────────────

function AddFieldModal({
  categoryId,
  onClose,
  onAdded,
}: {
  categoryId: string;
  onClose: () => void;
  onAdded: (field: IssueCustomField) => void;
}) {
  const [label, setLabel]           = useState("");
  const [fieldType, setFieldType]   = useState("text");
  const [isRequired, setIsRequired] = useState(false);
  const [optionsText, setOptionsText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState("");
  const [labelError, setLabelError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) { setLabelError("Label is required."); return; }
    setLabelError("");
    setError("");
    setSubmitting(true);
    try {
      const options = fieldType === "dropdown"
        ? optionsText.split("\n").map((l) => l.trim()).filter(Boolean)
        : undefined;
      const field = await createCustomField(categoryId, {
        label:      label.trim(),
        field_type: fieldType,
        is_required: isRequired,
        options,
      });
      onAdded(field);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-dark">Add Custom Field</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-dark-secondary" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Label *</label>
            <input className={inputCls} placeholder="Field label" value={label} onChange={(e) => setLabel(e.target.value)} />
            {labelError && <p className="text-xs text-red-500">{labelError}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Type</label>
            <select className={inputCls} value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
              {Object.entries(FIELD_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {fieldType === "dropdown" && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-dark">Options (one per line)</label>
              <textarea
                className={clsx(inputCls, "resize-none")}
                rows={4}
                placeholder={"Option 1\nOption 2\nOption 3"}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsRequired((p) => !p)}
            className="flex items-center gap-2 text-sm text-dark"
          >
            {isRequired
              ? <ToggleRight className="w-5 h-5 text-sprout-purple" />
              : <ToggleLeft className="w-5 h-5 text-gray-300" />}
            Required field
          </button>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={submitting} className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {submitting ? "Adding…" : "Add Field"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Escalation Rule Modal ─────────────────────────────────────────────────

function AddRuleModal({
  categoryId,
  onClose,
  onAdded,
}: {
  categoryId: string;
  onClose: () => void;
  onAdded: (rule: EscalationRule) => void;
}) {
  const [triggerType, setTriggerType]         = useState("on_create");
  const [triggerStatus, setTriggerStatus]     = useState("");
  const [escalateToRole, setEscalateToRole]   = useState("manager");
  const [submitting, setSubmitting]           = useState(false);
  const [error, setError]                     = useState("");

  const showTriggerStatus = triggerType === "status_change";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const rule = await createEscalationRule(categoryId, {
        trigger_type:     triggerType,
        trigger_status:   showTriggerStatus && triggerStatus ? triggerStatus : undefined,
        escalate_to_role: escalateToRole || undefined,
      });
      onAdded(rule);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-dark">Add Escalation Rule</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-dark-secondary" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Trigger</label>
            <select className={inputCls} value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>
              {Object.entries(ESCALATION_TRIGGER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {showTriggerStatus && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-dark">Target Status</label>
              <input
                className={inputCls}
                placeholder="e.g. in_progress"
                value={triggerStatus}
                onChange={(e) => setTriggerStatus(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Escalate To Role</label>
            <select className={inputCls} value={escalateToRole} onChange={(e) => setEscalateToRole(e.target.value)}>
              <option value="">— None —</option>
              {NOTIFY_ROLES.map((r) => (
                <option key={r} value={r} className="capitalize">{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={submitting} className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {submitting ? "Adding…" : "Add Rule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Category Card ─────────────────────────────────────────────────────────────

function CategoryCard({
  category,
  onEdit,
  onDelete,
  onFieldAdded,
  onFieldDeleted,
  onRuleAdded,
  onRuleDeleted,
}: {
  category: IssueCategory;
  onEdit: () => void;
  onDelete: () => void;
  onFieldAdded: (catId: string, field: IssueCustomField) => void;
  onFieldDeleted: (catId: string, fieldId: string) => void;
  onRuleAdded: (catId: string, rule: EscalationRule) => void;
  onRuleDeleted: (catId: string, ruleId: string) => void;
}) {
  const [fieldsOpen, setFieldsOpen]   = useState(false);
  const [rulesOpen, setRulesOpen]     = useState(false);
  const [showAddField, setShowAddField] = useState(false);
  const [showAddRule, setShowAddRule]   = useState(false);
  const [deletingFieldId, setDeletingFieldId] = useState<string | null>(null);
  const [deletingRuleId,  setDeletingRuleId]  = useState<string | null>(null);
  const [deletingField,   setDeletingField]   = useState(false);
  const [deletingRule,    setDeletingRule]     = useState(false);

  const fields = category.custom_fields ?? [];
  const rules  = category.escalation_rules ?? [];

  const handleDeleteField = async (fieldId: string) => {
    setDeletingField(true);
    try {
      await deleteCustomField(category.id, fieldId);
      onFieldDeleted(category.id, fieldId);
    } catch { /* ignore */ }
    finally { setDeletingField(false); setDeletingFieldId(null); }
  };

  const handleDeleteRule = async (ruleId: string) => {
    setDeletingRule(true);
    try {
      await deleteEscalationRule(category.id, ruleId);
      onRuleDeleted(category.id, ruleId);
    } catch { /* ignore */ }
    finally { setDeletingRule(false); setDeletingRuleId(null); }
  };

  return (
    <div className="bg-white rounded-2xl border border-surface-border flex flex-col overflow-hidden">
      {/* Main row */}
      <div className="flex items-start gap-3 p-4">
        <span
          className="w-3 h-3 rounded-full shrink-0 mt-1"
          style={{ backgroundColor: category.color ?? "#6B7280" }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-dark">{category.name}</h3>
            <span className="text-xs text-dark-secondary bg-gray-100 rounded-full px-2 py-0.5">
              SLA {category.sla_hours}h
            </span>
          </div>
          {category.description && (
            <p className="text-xs text-dark-secondary mt-0.5 line-clamp-2">{category.description}</p>
          )}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-dark-secondary">
            <span className="flex items-center gap-1">
              <Tag className="w-3 h-3" />
              {fields.length} custom field{fields.length !== 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {rules.length} escalation rule{rules.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-gray-100 text-dark-secondary hover:text-dark transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-dark-secondary hover:text-red-500 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Custom fields section */}
      <div className="border-t border-surface-border">
        <button
          onClick={() => setFieldsOpen((p) => !p)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-dark-secondary hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5" />
            Custom Fields ({fields.length})
          </span>
          {fieldsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {fieldsOpen && (
          <div className="px-4 pb-3 flex flex-col gap-2">
            {fields.length === 0 ? (
              <p className="text-xs text-dark-secondary py-2">No custom fields defined.</p>
            ) : (
              fields.map((field) => (
                <div key={field.id} className="relative flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium text-dark truncate">{field.label}</span>
                    <span className="text-xs bg-white border border-surface-border rounded px-1.5 py-0.5 text-dark-secondary shrink-0">
                      {FIELD_TYPE_LABELS[field.field_type] ?? field.field_type}
                    </span>
                    {field.is_required && (
                      <span className="text-xs text-red-500 font-medium shrink-0">required</span>
                    )}
                  </div>
                  <button
                    onClick={() => setDeletingFieldId(field.id)}
                    className="p-1 rounded hover:bg-red-50 text-dark-secondary hover:text-red-500 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  {deletingFieldId === field.id && (
                    <div className="absolute inset-0 bg-white/95 rounded-lg flex items-center justify-center gap-2 z-10">
                      <span className="text-xs text-dark">Delete this field?</span>
                      <button
                        onClick={() => setDeletingFieldId(null)}
                        className="text-xs px-2 py-1 rounded border border-surface-border hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleDeleteField(field.id)}
                        disabled={deletingField}
                        className="text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
                      >
                        {deletingField ? <Loader2 className="w-3 h-3 animate-spin" /> : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
            <button
              onClick={() => setShowAddField(true)}
              className="flex items-center gap-1.5 text-xs text-sprout-purple hover:text-sprout-purple/80 font-medium mt-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Field
            </button>
          </div>
        )}
      </div>

      {/* Escalation rules section */}
      <div className="border-t border-surface-border">
        <button
          onClick={() => setRulesOpen((p) => !p)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-dark-secondary hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />
            Escalation Rules ({rules.length})
          </span>
          {rulesOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {rulesOpen && (
          <div className="px-4 pb-3 flex flex-col gap-2">
            {rules.length === 0 ? (
              <p className="text-xs text-dark-secondary py-2">No escalation rules defined.</p>
            ) : (
              rules.map((rule) => (
                <div key={rule.id} className="relative flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-xs bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-medium shrink-0">
                      {ESCALATION_TRIGGER_LABELS[rule.trigger_type] ?? rule.trigger_type}
                    </span>
                    {rule.trigger_status && (
                      <span className="text-xs text-dark-secondary shrink-0">on &ldquo;{rule.trigger_status}&rdquo;</span>
                    )}
                    {rule.escalate_to_role && (
                      <span className="text-xs text-dark-secondary shrink-0 capitalize">→ {rule.escalate_to_role}</span>
                    )}
                  </div>
                  <button
                    onClick={() => setDeletingRuleId(rule.id)}
                    className="p-1 rounded hover:bg-red-50 text-dark-secondary hover:text-red-500 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  {deletingRuleId === rule.id && (
                    <div className="absolute inset-0 bg-white/95 rounded-lg flex items-center justify-center gap-2 z-10">
                      <span className="text-xs text-dark">Delete this rule?</span>
                      <button
                        onClick={() => setDeletingRuleId(null)}
                        className="text-xs px-2 py-1 rounded border border-surface-border hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        disabled={deletingRule}
                        className="text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
                      >
                        {deletingRule ? <Loader2 className="w-3 h-3 animate-spin" /> : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
            <button
              onClick={() => setShowAddRule(true)}
              className="flex items-center gap-1.5 text-xs text-sprout-purple hover:text-sprout-purple/80 font-medium mt-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Rule
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddField && (
        <AddFieldModal
          categoryId={category.id}
          onClose={() => setShowAddField(false)}
          onAdded={(field) => { onFieldAdded(category.id, field); setShowAddField(false); }}
        />
      )}
      {showAddRule && (
        <AddRuleModal
          categoryId={category.id}
          onClose={() => setShowAddRule(false)}
          onAdded={(rule) => { onRuleAdded(category.id, rule); setShowAddRule(false); }}
        />
      )}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCategoryCard() {
  return (
    <div className="bg-white rounded-2xl border border-surface-border p-4 flex flex-col gap-3 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-3 h-3 rounded-full bg-gray-200 mt-1 shrink-0" />
        <div className="flex-1 flex flex-col gap-1.5">
          <div className="h-4 w-32 bg-gray-200 rounded" />
          <div className="h-3 w-48 bg-gray-100 rounded" />
        </div>
      </div>
    </div>
  );
}

// ── GenerateCategoriesModal ───────────────────────────────────────────────────

interface GeneratedCategory {
  name: string;
  description: string;
  color: string;
  sla_hours: number;
}

function GenerateCategoriesModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<GeneratedCategory[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) { setError("Please describe your business or issue types."); return; }
    setError("");
    setLoading(true);
    try {
      const { apiFetch } = await import("@/services/api/client");
      const result = await apiFetch<{ categories: GeneratedCategory[] }>("/api/v1/ai/generate-issue-categories", {
        method: "POST",
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      setSuggestions(result.categories);
      setSelected(new Set(result.categories.map((_, i) => i)));
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("overloaded") || msg.includes("529") || msg.includes("temporarily")) {
        setError("The AI service is temporarily busy. Wait a few seconds and try again.");
      } else if (msg.includes("rate limit") || msg.includes("429")) {
        setError("AI rate limit reached. Please wait a moment and try again.");
      } else {
        setError(friendlyError(e));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSelected = async () => {
    if (!suggestions) return;
    setCreateError("");
    setCreating(true);
    try {
      for (const idx of Array.from(selected)) {
        const cat = suggestions[idx];
        await createIssueCategory({
          name: cat.name,
          description: cat.description || undefined,
          color: cat.color,
          sla_hours: cat.sla_hours,
          default_priority: "medium",
        });
      }
      onCreated();
    } catch (e) {
      setCreateError(friendlyError(e));
    } finally {
      setCreating(false);
    }
  };

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-sprout-purple" />
          <h2 className="text-lg font-semibold bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate Issue Categories with Sidekick</h2>
        </div>

        {!suggestions ? (
          <>
            <p className="text-sm text-dark-secondary">
              Describe your business or the types of issues you want to track and Claude will suggest categories.
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-dark">Describe your business or issue types *</label>
              <textarea
                className={clsx(inputCls, "resize-none")}
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. A fast food chain with 20 branches — we deal with equipment breakdowns, cleanliness issues, and customer complaints"
                disabled={loading}
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={onClose} disabled={loading}
                className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={handleGenerate} disabled={loading || !prompt.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> Generate</>}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-dark-secondary">
              Select the categories you want to create, then click &ldquo;Create Selected&rdquo;.
            </p>
            <div className="flex flex-col gap-2">
              {suggestions.map((cat, idx) => (
                <label key={idx} className={clsx(
                  "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
                  selected.has(idx) ? "border-sprout-purple bg-sprout-purple/5" : "border-surface-border hover:bg-gray-50"
                )}>
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-sprout-purple"
                    checked={selected.has(idx)}
                    onChange={() => toggleSelect(idx)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                      <span className="text-sm font-medium text-dark">{cat.name}</span>
                      <span className="text-xs text-dark-secondary ml-auto shrink-0">SLA: {cat.sla_hours}h</span>
                    </div>
                    {cat.description && (
                      <p className="text-xs text-dark-secondary mt-1">{cat.description}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
            {createError && <p className="text-xs text-red-500">{createError}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={onClose} disabled={creating}
                className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={handleCreateSelected} disabled={creating || selected.size === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
                {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : `Create Selected (${selected.size})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function IssueCategoriesPage() {
  const [categories, setCategories] = useState<IssueCategory[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [showNewModal, setShowNewModal] = useState(false);
  const [newModalMode, setNewModalMode] = useState<"select" | "template" | "ai" | "blank">("select");
  const [editingCat, setEditingCat] = useState<IssueCategory | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting,   setDeleting]   = useState(false);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listIssueCategories();
      setCategories(res.data);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const handleSaved = (cat: IssueCategory) => {
    setCategories((prev) => {
      const idx = prev.findIndex((c) => c.id === cat.id);
      if (idx >= 0) {
        const next = [...prev];
        // Preserve sub-relations that the update endpoint may not return
        next[idx] = {
          custom_fields:     prev[idx].custom_fields,
          escalation_rules:  prev[idx].escalation_rules,
          ...cat,
        };
        return next;
      }
      return [{ ...cat, custom_fields: [], escalation_rules: [] }, ...prev];
    });
    const isExisting = categories.some((c) => c.id === cat.id);
    if (!isExisting) {
      setJustCreatedId(cat.id);
      setTimeout(() => setJustCreatedId(null), 4000);
    }
    setShowNewModal(false);
    setEditingCat(null);
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await deleteIssueCategory(id);
      setCategories((prev) => prev.filter((c) => c.id !== id));
    } catch { /* ignore */ }
    finally { setDeleting(false); setDeletingId(null); }
  };

  const handleFieldAdded = (catId: string, field: IssueCustomField) => {
    setCategories((prev) => prev.map((c) =>
      c.id === catId ? { ...c, custom_fields: [...(c.custom_fields ?? []), field] } : c
    ));
  };

  const handleFieldDeleted = (catId: string, fieldId: string) => {
    setCategories((prev) => prev.map((c) =>
      c.id === catId ? { ...c, custom_fields: (c.custom_fields ?? []).filter((f) => f.id !== fieldId) } : c
    ));
  };

  const handleRuleAdded = (catId: string, rule: EscalationRule) => {
    setCategories((prev) => prev.map((c) =>
      c.id === catId ? { ...c, escalation_rules: [...(c.escalation_rules ?? []), rule] } : c
    ));
  };

  const handleRuleDeleted = (catId: string, ruleId: string) => {
    setCategories((prev) => prev.map((c) =>
      c.id === catId ? { ...c, escalation_rules: (c.escalation_rules ?? []).filter((r) => r.id !== ruleId) } : c
    ));
  };

  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      <div className="flex flex-col gap-4 md:gap-6 max-w-3xl mx-auto w-full">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard/settings" className="flex items-center gap-1 text-sm text-dark-secondary hover:text-dark transition-colors">
            <ChevronLeft className="w-4 h-4" />
            Settings
          </Link>
          <span className="text-dark-secondary/40 text-sm">/</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sprout-purple/10 flex items-center justify-center">
              <Settings className="w-5 h-5 text-sprout-purple" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-dark">Issue Categories</h1>
              <p className="text-sm text-dark-secondary">{categories.length} categories</p>
            </div>
          </div>
          <button
            onClick={() => { setNewModalMode("select"); setShowNewModal(true); }}
            className="flex items-center gap-2 bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90"
          >
            <Plus className="w-4 h-4" />
            New Category
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>
        )}

        {/* Category list */}
        <div className="flex flex-col gap-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCategoryCard key={i} />)
          ) : categories.length === 0 ? (
            <div className="bg-white rounded-2xl border border-surface-border p-8 flex flex-col items-center gap-6">
              <div className="text-center">
                <h3 className="text-base font-semibold text-dark">No categories yet</h3>
                <p className="text-sm text-dark-secondary mt-1">How would you like to add categories?</p>
              </div>
              <div className="grid grid-cols-3 gap-3 w-full max-w-md">
                {([
                  { mode: "template" as const, icon: "📦", bg: "bg-blue-50", label: "From a Pack", sub: "Add a preset category bundle" },
                  { mode: "ai" as const, icon: null, bg: "bg-gradient-to-br from-violet-100 to-purple-100", label: "Generate with Sidekick", sub: "Describe your business type" },
                  { mode: "blank" as const, icon: "➕", bg: "bg-green-50", label: "Create Manually", sub: "Set every field yourself" },
                ] as const).map(({ mode, icon, bg, label, sub }) => (
                  <button
                    key={mode}
                    onClick={() => { setNewModalMode(mode); setShowNewModal(true); }}
                    className={`flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 hover:shadow-sm transition-all ${mode === "ai" ? "border-transparent" : "border-surface-border hover:border-sprout-purple"}`}
                    style={mode === "ai" ? { background: 'linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box' } : undefined}
                  >
                    <div className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center`}>
                      {icon ? <span className="text-2xl">{icon}</span> : <Sparkles className="w-5 h-5 text-sprout-purple" />}
                    </div>
                    <div>
                      <p className={`font-semibold text-xs ${mode === "ai" ? "bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent" : "text-dark"}`}>{label}</p>
                      <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">{sub}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            categories.map((cat) => (
              <div key={cat.id} className={clsx("relative rounded-2xl transition-colors duration-700", justCreatedId === cat.id && "bg-violet-50 ring-1 ring-violet-200")}>
                <CategoryCard
                  category={cat}
                  onEdit={() => setEditingCat(cat)}
                  onDelete={() => setDeletingId(cat.id)}
                  onFieldAdded={handleFieldAdded}
                  onFieldDeleted={handleFieldDeleted}
                  onRuleAdded={handleRuleAdded}
                  onRuleDeleted={handleRuleDeleted}
                />
                {deletingId === cat.id && (
                  <div className="absolute inset-0 bg-white/95 rounded-2xl border border-red-200 flex flex-col items-center justify-center gap-3 z-10 p-4">
                    <p className="text-sm font-medium text-dark text-center">
                      Delete <span className="text-red-600">&quot;{cat.name}&quot;</span>?
                      <br />
                      <span className="text-xs text-dark-secondary font-normal">This cannot be undone.</span>
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setDeletingId(null)}
                        className="px-4 py-1.5 text-sm rounded-lg border border-surface-border hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleDelete(cat.id)}
                        disabled={deleting}
                        className="px-4 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
                      >
                        {deleting ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modals */}
      {showNewModal && (
        <NewCategoryModal
          initialMode={newModalMode}
          onClose={() => setShowNewModal(false)}
          onSave={(cat) => { setShowNewModal(false); handleSaved(cat); }}
          onCreatedMultiple={() => { setShowNewModal(false); loadCategories(); }}
        />
      )}
      {editingCat && (
        <CategoryModal initial={editingCat} onClose={() => setEditingCat(null)} onSave={handleSaved} />
      )}
    </div>
  );
}

// ── Preset category packs ────────────────────────────────────────────────────

const CATEGORY_PACKS = [
  {
    id: "retail",
    icon: "🏪",
    name: "Retail Store Pack",
    color: "bg-blue-50 border-blue-200",
    categories: [
      { name: "Maintenance", description: "Equipment and facility repairs", color: "#3B82F6", sla_hours: 24 },
      { name: "Customer Service", description: "Customer complaints and feedback", color: "#8B5CF6", sla_hours: 4 },
      { name: "Safety", description: "Safety hazards and near-misses", color: "#EF4444", sla_hours: 2 },
      { name: "Loss Prevention", description: "Theft and inventory discrepancies", color: "#F59E0B", sla_hours: 4 },
    ],
  },
  {
    id: "fnb",
    icon: "🍔",
    name: "F&B / Restaurant Pack",
    color: "bg-orange-50 border-orange-200",
    categories: [
      { name: "Food Safety", description: "Temperature and hygiene issues", color: "#EF4444", sla_hours: 2 },
      { name: "Equipment", description: "Kitchen equipment failures", color: "#F59E0B", sla_hours: 4 },
      { name: "Service Quality", description: "Guest experience issues", color: "#8B5CF6", sla_hours: 4 },
      { name: "Cleanliness", description: "Sanitation and cleaning issues", color: "#10B981", sla_hours: 8 },
    ],
  },
  {
    id: "hospitality",
    icon: "🏨",
    name: "Hospitality Pack",
    color: "bg-purple-50 border-purple-200",
    categories: [
      { name: "Housekeeping", description: "Room and common area issues", color: "#10B981", sla_hours: 4 },
      { name: "Maintenance", description: "Facility repairs and upkeep", color: "#3B82F6", sla_hours: 24 },
      { name: "Guest Relations", description: "Guest complaints and requests", color: "#8B5CF6", sla_hours: 2 },
      { name: "Security", description: "Security incidents and concerns", color: "#EF4444", sla_hours: 1 },
    ],
  },
  {
    id: "safety",
    icon: "⚠️",
    name: "Safety-First Pack",
    color: "bg-red-50 border-red-200",
    categories: [
      { name: "Near Miss", description: "Close-call incidents", color: "#F59E0B", sla_hours: 4 },
      { name: "Injury", description: "Workplace injuries", color: "#EF4444", sla_hours: 1 },
      { name: "Fire Hazard", description: "Fire safety concerns", color: "#EF4444", sla_hours: 1 },
      { name: "Compliance", description: "Regulatory non-compliance", color: "#3B82F6", sla_hours: 24 },
    ],
  },
];

// ── NewCategoryModal ─────────────────────────────────────────────────────────

function NewCategoryModal({
  onClose,
  onSave,
  onCreatedMultiple,
  initialMode = "select",
}: {
  onClose: () => void;
  onSave: (cat: IssueCategory) => void;
  onCreatedMultiple: () => void;
  initialMode?: "select" | "template" | "ai" | "blank";
}) {
  const [mode, setMode] = useState<"select" | "template" | "ai" | "blank">(initialMode);
  function goBack() { setMode("select"); }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-surface-border sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            {mode !== "select" && (
              <button onClick={goBack} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <ArrowLeft className="w-4 h-4 text-dark/60" />
              </button>
            )}
            <h2 className="text-base font-bold text-dark">New Category</h2>
          </div>
          <button onClick={onClose} className="text-dark/40 hover:text-dark text-2xl leading-none">&times;</button>
        </div>

        {mode === "select" && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-dark/60">How would you like to add categories?</p>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => setMode("template")}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-surface-border hover:border-sprout-purple hover:shadow-sm transition-all">
                <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-2xl">📦</div>
                <div>
                  <p className="font-semibold text-dark text-xs">From a Pack</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Add a preset category bundle</p>
                </div>
              </button>
              <button onClick={() => setMode("ai")}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-transparent hover:shadow-sm transition-all"
                style={{ background: 'linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box' }}>
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-sprout-purple" />
                </div>
                <div>
                  <p className="font-semibold text-xs bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate with Sidekick</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Describe your business type</p>
                </div>
              </button>
              <button onClick={() => setMode("blank")}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-surface-border hover:border-sprout-purple hover:shadow-sm transition-all">
                <div className="w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center text-2xl">➕</div>
                <div>
                  <p className="font-semibold text-dark text-xs">Create Manually</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Set every field yourself</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {mode === "template" && <CategoryPackSubView onCreated={onCreatedMultiple} />}
        {mode === "ai" && <CategoryAiSubView onCreated={onCreatedMultiple} />}
        {mode === "blank" && <CategoryModal onClose={onClose} onSave={onSave} />}
      </div>
    </div>
  );
}

function CategoryPackSubView({ onCreated }: { onCreated: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const pack = CATEGORY_PACKS.find((p) => p.id === selected);

  const handleCreate = async () => {
    if (!pack) return;
    setError(""); setCreating(true);
    try {
      for (const cat of pack.categories) {
        await createIssueCategory({ name: cat.name, description: cat.description, color: cat.color, sla_hours: cat.sla_hours, default_priority: "medium" });
      }
      onCreated();
    } catch (e) { setError(friendlyError(e)); }
    finally { setCreating(false); }
  };

  return (
    <div className="p-5 flex flex-col gap-4">
      <p className="text-sm text-dark-secondary">Choose a pack to add multiple categories at once.</p>
      <div className="grid grid-cols-2 gap-3">
        {CATEGORY_PACKS.map((p) => (
          <button key={p.id} onClick={() => setSelected(selected === p.id ? null : p.id)}
            className={`text-left p-3 rounded-xl border-2 transition-all ${selected === p.id ? "border-sprout-purple shadow-sm" : `${p.color} hover:border-sprout-purple/40`}`}>
            <div className="text-xl mb-1.5">{p.icon}</div>
            <p className="text-xs font-semibold text-dark">{p.name}</p>
            <p className="text-[11px] text-dark/50 mt-0.5">{p.categories.length} categories</p>
            {selected === p.id && (
              <div className="mt-2 space-y-0.5">
                {p.categories.map((c) => (
                  <div key={c.name} className="flex items-center gap-1.5 text-[11px] text-dark/60">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                    {c.name}
                  </div>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {pack && (
        <div className="flex justify-end pt-1 border-t border-surface-border">
          <button onClick={handleCreate} disabled={creating}
            className="flex items-center gap-2 px-5 py-2 bg-sprout-purple text-white text-sm font-medium rounded-lg hover:bg-sprout-purple/90 disabled:opacity-60">
            {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : `Add ${pack.categories.length} Categories`}
          </button>
        </div>
      )}
    </div>
  );
}

function CategoryAiSubView({ onCreated }: { onCreated: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<GeneratedCategory[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) { setError("Please describe your business or issue types."); return; }
    setError(""); setLoading(true);
    try {
      const { apiFetch } = await import("@/services/api/client");
      const result = await apiFetch<{ categories: GeneratedCategory[] }>("/api/v1/ai/generate-issue-categories", { method: "POST", body: JSON.stringify({ prompt: prompt.trim() }) });
      setSuggestions(result.categories);
      setSelected(new Set(result.categories.map((_, i) => i)));
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    if (!suggestions) return;
    setCreateError(""); setCreating(true);
    try {
      for (const idx of Array.from(selected)) {
        const cat = suggestions[idx];
        await createIssueCategory({ name: cat.name, description: cat.description || undefined, color: cat.color, sla_hours: cat.sla_hours, default_priority: "medium" });
      }
      onCreated();
    } catch (e) { setCreateError(friendlyError(e)); }
    finally { setCreating(false); }
  };

  const toggle = (i: number) => setSelected((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <div className="p-5 flex flex-col gap-4">
      {!suggestions ? (
        <>
          <p className="text-sm text-dark-secondary">Describe your business or the types of issues you want to track and Claude will suggest categories.</p>
          <textarea className={`${inputCls} resize-none`} rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. A fast food chain with 20 branches — we deal with equipment breakdowns, cleanliness issues, and customer complaints"
            disabled={loading} />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end">
            <button onClick={handleGenerate} disabled={loading || !prompt.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> Generate</>}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-dark-secondary">Select the categories you want to create.</p>
          <div className="flex flex-col gap-2">
            {suggestions.map((cat, idx) => (
              <label key={idx} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${selected.has(idx) ? "border-sprout-purple bg-sprout-purple/5" : "border-surface-border hover:bg-gray-50"}`}>
                <input type="checkbox" className="mt-0.5 accent-sprout-purple" checked={selected.has(idx)} onChange={() => toggle(idx)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-sm font-medium text-dark">{cat.name}</span>
                    <span className="text-xs text-dark-secondary ml-auto shrink-0">SLA: {cat.sla_hours}h</span>
                  </div>
                  {cat.description && <p className="text-xs text-dark-secondary mt-1">{cat.description}</p>}
                </div>
              </label>
            ))}
          </div>
          {createError && <p className="text-xs text-red-500">{createError}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setSuggestions(null)} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">Regenerate</button>
            <button onClick={handleCreate} disabled={creating || !selected.size}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : `Create Selected (${selected.size})`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
