"use client";

import { useEffect, useState, useCallback, Component, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useForm, useFieldArray, useWatch, Controller } from "react-hook-form";

// ── Error boundary to surface crash details ────────────────────────────────────
class ModalErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full flex flex-col gap-3">
            <p className="font-semibold text-red-600">Something went wrong</p>
            <p className="text-sm text-dark-secondary">An unexpected error occurred. Please close this and try again.</p>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 self-end"
            >
              Dismiss
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import clsx from "clsx";
import {
  ClipboardList, Plus, Trash2, ToggleLeft, ToggleRight,
  Sparkles, Loader2, X, Pencil, CheckCircle2, ChevronRight,
  Eye, UserPlus, Search, Inbox, CheckCheck, XCircle, ArrowLeft,
  MessageSquare, ChevronDown, Calendar, ShieldCheck, FileText, CheckSquare,
  ShieldAlert, RefreshCw, Filter, LayoutTemplate, Clock, PackageX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormStore } from "@/stores/useFormStore";
import { createTemplate, deleteTemplate, updateTemplate, generateTemplate, getTemplate, getMyAssignments, getAssignmentDraft, createAssignment, listSubmissions, getSubmission, reviewSubmission, getTemplateStats, type FormAssignment, type FormSubmissionListItem, type FormSubmissionDetail } from "@/services/forms";
import { getPackageTemplates } from "@/services/onboarding";
import { listCAPs } from "@/services/caps";
import type { CAP, CAPStatus } from "@/types";
import { apiFetch } from "@/services/api/client";
import { listUsers, listLocations, type Location } from "@/services/users";
import { AssignPeoplePanel } from "@/components/shared/AssignPeoplePanel";
import { createClient } from "@/services/supabase/client";
import type { FormTemplate, FormType, FormFieldType, FormField, FormSection, Profile } from "@/types";
import { friendlyError } from "@/lib/errors";

// ── Field type options ─────────────────────────────────────────────────────────
const FIELD_TYPES: { value: FormFieldType; label: string; auditOnly?: boolean }[] = [
  { value: "audit_item", label: "✦ Audit Item (C / NI / NC)", auditOnly: true },
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Checkbox" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multi_select", label: "Multi-select" },
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
  { value: "signature", label: "Signature" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
  { value: "datetime", label: "Date & Time" },
  { value: "gps", label: "GPS Location" },
  { value: "rating", label: "Rating (1–5)" },
  { value: "qr_code", label: "QR / Barcode" },
  { value: "yes_no", label: "Yes / No" },
  { value: "boolean", label: "Pass / Fail" },
  { value: "textarea", label: "Long Text" },
];

const inputCls = "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full";

// ── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-surface-border p-5 flex flex-col gap-3 animate-pulse">
      <div className="h-4 w-3/4 bg-gray-200 rounded" />
      <div className="h-3 w-1/2 bg-gray-100 rounded" />
      <div className="flex gap-2 mt-auto pt-2">
        <div className="h-6 w-16 bg-gray-100 rounded-full" />
        <div className="h-6 w-12 bg-gray-100 rounded-full" />
      </div>
    </div>
  );
}

// ── Type badge ────────────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: FormType }) {
  const label =
    type === "checklist" ? "Checklist"
    : type === "audit" ? "Audit"
    : type === "pull_out" ? "Pull-Out"
    : "Form";
  const color =
    type === "checklist" ? "bg-sprout-green"
    : type === "audit" ? "bg-amber-500"
    : type === "pull_out" ? "bg-orange-500"
    : "bg-sprout-purple";
  return (
    <span className={clsx("px-2 py-0.5 rounded-full text-xs font-semibold text-white", color)}>
      {label}
    </span>
  );
}

// ── Field type label ──────────────────────────────────────────────────────────
function FieldTypeLabel({ type }: { type: string }) {
  const found = FIELD_TYPES.find((t) => t.value === type);
  return (
    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-xs font-medium">
      {found?.label ?? type}
    </span>
  );
}

// ── Zod schema ────────────────────────────────────────────────────────────────
const fieldSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1, "Required"),
  field_type: z.enum(["text", "number", "checkbox", "dropdown", "multi_select", "photo", "video", "signature", "date", "time", "datetime", "gps", "rating", "qr_code", "yes_no", "boolean", "textarea", "audit_item"]),
  is_required: z.boolean(),
  is_critical: z.boolean().optional(),
  max_score: z.number().min(0).optional(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  conditional_logic: z.object({
    fieldId: z.string(),
    value: z.string(),
    action: z.enum(["show", "hide"]),
  }).nullable().optional(),
});

const sectionSchema = z.object({
  title: z.string().min(1, "Required"),
  weight: z.number().min(0).optional(),
  fields: z.array(fieldSchema).min(1, "Add at least one field"),
});

const templateSchema = z.object({
  title: z.string().min(2, "Title required"),
  description: z.string().optional(),
  type: z.enum(["checklist", "form", "audit", "pull_out"]),
  sections: z.array(sectionSchema).min(1, "Add at least one section"),
  passing_score: z.number().min(0).max(100).optional(),
});

type TemplateFormValues = z.infer<typeof templateSchema>;

// ── Section builder ────────────────────────────────────────────────────────────
function FieldConditionEditor({ sectionIndex, fi, control, priorFields }: {
  sectionIndex: number;
  fi: number;
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  priorFields: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const condPath = `sections.${sectionIndex}.fields.${fi}.conditional_logic` as const;
  const cond = useWatch({ control, name: condPath });

  const hasCondition = cond != null;

  return (
    <div className="flex flex-col gap-1.5">
      {!open && !hasCondition && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-sprout-purple/70 hover:text-sprout-purple underline self-start"
        >
          + Add condition
        </button>
      )}
      {(open || hasCondition) && (
        <Controller
          control={control}
          name={condPath}
          render={({ field }) => {
            const val = field.value ?? { action: "show", fieldId: priorFields[0]?.id ?? "", value: "" };
            return (
              <div className="flex flex-wrap gap-1.5 items-center bg-sprout-purple/5 border border-sprout-purple/20 rounded-lg px-3 py-2">
                <select
                  className="border border-surface-border rounded px-1.5 py-1 text-xs bg-white focus:outline-none"
                  value={val.action}
                  onChange={(e) => field.onChange({ ...val, action: e.target.value as "show" | "hide" })}
                >
                  <option value="show">Show this field</option>
                  <option value="hide">Hide this field</option>
                </select>
                <span className="text-xs text-dark-secondary">when</span>
                <select
                  className="border border-surface-border rounded px-1.5 py-1 text-xs bg-white focus:outline-none max-w-[140px]"
                  value={val.fieldId}
                  onChange={(e) => field.onChange({ ...val, fieldId: e.target.value })}
                >
                  {priorFields.length === 0 && <option value="">No prior fields</option>}
                  {priorFields.map((pf) => (
                    <option key={pf.id} value={pf.id}>{pf.label || "(unlabeled)"}</option>
                  ))}
                </select>
                <span className="text-xs text-dark-secondary">equals</span>
                <input
                  className="border border-surface-border rounded px-1.5 py-1 text-xs w-24 focus:outline-none"
                  placeholder="value"
                  value={val.value}
                  onChange={(e) => field.onChange({ ...val, value: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => { field.onChange(null); setOpen(false); }}
                  className="ml-auto text-gray-400 hover:text-red-500"
                  title="Remove condition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}

// ── Options editor (for dropdown / multi_select) ───────────────────────────────
function OptionsEditor({ sectionIndex, fi, control }: {
  sectionIndex: number;
  fi: number;
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
}) {
  const [draft, setDraft] = useState("");
  return (
    <Controller
      control={control}
      name={`sections.${sectionIndex}.fields.${fi}.options`}
      render={({ field }) => {
        const opts: string[] = field.value ?? [];
        const add = () => {
          const trimmed = draft.trim();
          if (!trimmed || opts.includes(trimmed)) return;
          field.onChange([...opts, trimmed]);
          setDraft("");
        };
        return (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-dark-secondary">Options</p>
            {opts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {opts.map((o, oi) => (
                  <span key={oi} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sprout-purple/10 text-sprout-purple text-xs font-medium">
                    {o}
                    <button type="button" onClick={() => field.onChange(opts.filter((_, i) => i !== oi))}
                      className="hover:text-red-500 leading-none">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <input
                className="border border-surface-border rounded-lg px-2 py-1 text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-sprout-purple/40"
                placeholder="Type an option and press Enter"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              />
              <button type="button" onClick={add}
                className="px-2 py-1 rounded-lg bg-sprout-purple/10 text-sprout-purple text-xs font-medium hover:bg-sprout-purple hover:text-white transition-colors">
                + Add
              </button>
            </div>
          </div>
        );
      }}
    />
  );
}

function SectionBuilder({ sectionIndex, control, register, errors, priorFields, templateType }: {
  sectionIndex: number;
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  register: ReturnType<typeof useForm<TemplateFormValues>>["register"];
  errors: ReturnType<typeof useForm<TemplateFormValues>>["formState"]["errors"];
  priorFields: { id: string; label: string }[];
  templateType?: string;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: `sections.${sectionIndex}.fields` });
  const sectionErrors = errors.sections?.[sectionIndex];

  // Watch labels for fields in this section so priorFields for each field is accurate
  const sectionFieldLabels = useWatch({ control, name: `sections.${sectionIndex}.fields` }) as { id?: string; label: string; field_type?: string }[] | undefined;

  return (
    <div className="border border-surface-border rounded-xl overflow-hidden flex flex-col bg-surface-page">
      {/* Section header bar */}
      <div className="bg-[#F1F5F9] border-b border-surface-border px-4 py-3 flex items-center gap-3">
        <span className="shrink-0 w-6 h-6 rounded-full bg-sprout-purple text-white text-xs font-bold flex items-center justify-center leading-none">
          {sectionIndex + 1}
        </span>
        <div className="flex-1 min-w-0">
          <input
            className="w-full bg-transparent text-sm font-semibold text-dark placeholder:text-gray-400 placeholder:font-normal focus:outline-none"
            placeholder="Section title — e.g. Kitchen, Front of House, Equipment"
            {...register(`sections.${sectionIndex}.title`)}
          />
          {sectionErrors?.title && <p className="text-xs text-red-500 mt-0.5">{sectionErrors.title.message}</p>}
        </div>
        {templateType === "audit" && (
          <div
            className="flex items-center gap-1.5 shrink-0"
            title="Relative importance of this section. 2.0 = twice as important as 1.0. Does not need to total 100."
          >
            <span className="text-xs text-amber-700 font-medium whitespace-nowrap">Weight</span>
            <input
              type="number" min={0} step={0.1}
              className="border border-amber-300 bg-white rounded-md px-2 py-1 text-sm w-16 text-center focus:outline-none focus:ring-2 focus:ring-amber-300"
              placeholder="1.0"
              {...register(`sections.${sectionIndex}.weight`, { setValueAs: (v) => v === "" || v === null || v === undefined ? undefined : Number(v) })}
            />
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col gap-3">

      {fields.map((field, fi) => {
        // Prior fields for THIS field = all priorFields from parent + fields 0..fi-1 in this section
        const localPrior = (sectionFieldLabels ?? []).slice(0, fi).map((lf, idx) => ({
          id: lf.id ?? fields[idx]?.id ?? "",
          label: lf.label,
        }));
        const allPriorForField = [...priorFields, ...localPrior].filter((pf) => pf.id);
        const fieldType = (sectionFieldLabels ?? [])[fi]?.field_type ?? field.field_type;
        const needsOptions = fieldType === "dropdown" || fieldType === "multi_select";

        return (
          <div key={field.id} className="flex gap-2 items-start bg-white border border-surface-border rounded-lg p-3">
            <div className="flex-1 flex flex-col gap-2">
              <input className={inputCls} placeholder="e.g. Is the walk-in cooler temperature below 4°C?"
                {...register(`sections.${sectionIndex}.fields.${fi}.label`)} />
              <input
                className={`${inputCls} text-gray-500 placeholder:text-gray-300`}
                placeholder="e.g. Check all exits are unlocked and unobstructed"
                {...register(`sections.${sectionIndex}.fields.${fi}.placeholder`)}
              />
              <div className="flex gap-2 flex-wrap items-center">
                <select className="border border-surface-border rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none"
                  {...register(`sections.${sectionIndex}.fields.${fi}.field_type`)}>
                  {FIELD_TYPES.filter((t) => !t.auditOnly || templateType === "audit").map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-dark-secondary cursor-pointer">
                  <input type="checkbox" className="w-3.5 h-3.5 accent-sprout-purple"
                    {...register(`sections.${sectionIndex}.fields.${fi}.is_required`)} />
                  Required
                </label>
                {templateType === "audit" && (
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-red-600 cursor-pointer font-medium">
                      <input type="checkbox" className="w-3.5 h-3.5 accent-red-500"
                        {...register(`sections.${sectionIndex}.fields.${fi}.is_critical`)} />
                      Critical
                    </label>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-amber-700 font-medium">Max pts</span>
                      <input
                        type="number" min={0} step={0.5}
                        className="border border-amber-200 bg-amber-50 rounded px-1.5 py-1 text-xs w-14 text-center focus:outline-none focus:ring-1 focus:ring-amber-300"
                        placeholder="1"
                        {...register(`sections.${sectionIndex}.fields.${fi}.max_score`, { setValueAs: (v) => v === "" || v === null || v === undefined ? undefined : Number(v) })}
                      />
                    </div>
                  </>
                )}
              </div>
              {needsOptions && (
                <OptionsEditor sectionIndex={sectionIndex} fi={fi} control={control} />
              )}
              {allPriorForField.length > 0 && (
                <FieldConditionEditor
                  sectionIndex={sectionIndex}
                  fi={fi}
                  control={control}
                  priorFields={allPriorForField}
                />
              )}
            </div>
            <button type="button" onClick={() => remove(fi)} className="p-1 hover:text-red-500 text-gray-400 mt-0.5">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}

      {sectionErrors?.fields && typeof sectionErrors.fields.message === "string" && (
        <p className="text-xs text-red-500">{sectionErrors.fields.message}</p>
      )}

      <button type="button"
        onClick={() => append({ id: crypto.randomUUID(), label: "", field_type: templateType === "audit" ? "audit_item" : "text", is_required: false, is_critical: false, placeholder: "", conditional_logic: null })}
        className="flex items-center gap-1 text-xs text-sprout-purple font-medium hover:underline self-start">
        <Plus className="w-3.5 h-3.5" /> Add Field
      </button>
      </div>
    </div>
  );
}

// ── View / Edit Modal ─────────────────────────────────────────────────────────
function ViewEditModal({
  template,
  onClose,
  onUpdated,
  onDelete,
}: {
  template: FormTemplate;
  onClose: () => void;
  onUpdated: () => void;
  onDelete: () => void;
}) {
  const [fullTemplate, setFullTemplate] = useState<FormTemplate | null>(null);
  const [fetching, setFetching] = useState(true);
  const [editing, setEditing] = useState(false);
  const [isActive, setIsActive] = useState(template.is_active);
  const [toggling, setToggling] = useState(false);
  const [apiError, setApiError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { control, register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      title: template.title,
      description: template.description ?? "",
      type: template.type as "checklist" | "form" | "audit",
      passing_score: 80,
      sections: [{ title: "", fields: [{ id: crypto.randomUUID(), label: "", field_type: "text", is_required: false, placeholder: "", conditional_logic: null }] }],
    },
  });
  const { fields: sections, append: addSection, remove: removeSection } = useFieldArray({ control, name: "sections" });
  const watchedSections = useWatch({ control, name: "sections" });
  const watchedType = watch("type");

  useEffect(() => {
    setFetching(true);
    getTemplate(template.id)
      .then(async (t) => {
        setFullTemplate(t);
        setIsActive(t.is_active);

        // For audit templates, fetch full scoring config (weights, scores, passing_score)
        type AuditSectionData = { id: string; audit_section_weights?: { weight: number }[]; form_fields?: (AuditFieldData & { audit_field_scores?: { max_score: number }[] })[] };
        type AuditFieldData = { id: string; is_critical?: boolean };
        type AuditTemplateData = { audit_configs?: { passing_score: number }[]; form_sections?: AuditSectionData[] };

        let passingScore = 80;
        let auditSectionMap: Record<string, number> = {};   // section_id → weight
        let auditFieldMap: Record<string, number> = {};      // field_id → max_score
        let auditCriticalMap: Record<string, boolean> = {}; // field_id → is_critical

        if (t.type === "audit") {
          try {
            const auditData = await apiFetch<AuditTemplateData>(`/api/v1/audits/templates/${t.id}`);
            passingScore = auditData?.audit_configs?.[0]?.passing_score ?? 80;
            for (const sec of auditData?.form_sections ?? []) {
              auditSectionMap[sec.id] = sec.audit_section_weights?.[0]?.weight ?? 1.0;
              for (const f of sec.form_fields ?? []) {
                auditFieldMap[f.id] = f.audit_field_scores?.[0]?.max_score ?? 1.0;
                auditCriticalMap[f.id] = f.is_critical ?? false;
              }
            }
          } catch { /* use defaults */ }
        }

        reset({
          title: t.title,
          description: t.description ?? "",
          type: t.type as "checklist" | "form" | "audit" | "pull_out",
          passing_score: passingScore,
          sections: (t.sections ?? []).map((s) => ({
            title: s.title,
            weight: auditSectionMap[s.id] ?? 1.0,
            fields: (s.fields ?? []).map((f) => ({
              id: f.id as string,
              label: f.label,
              field_type: f.field_type as FormFieldType,
              is_required: f.is_required,
              is_critical: auditCriticalMap[f.id] ?? (f as FormField).is_critical ?? false,
              max_score: auditFieldMap[f.id] ?? 1.0,
              placeholder: f.placeholder ?? "",
              options: (f.options ?? []) as string[],
              conditional_logic: (f.conditional_logic as { fieldId: string; value: string; action: "show" | "hide" } | null) ?? null,
            })),
          })),
        });
      })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [template.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleActive = async () => {
    setToggling(true);
    try {
      await updateTemplate(template.id, { is_active: !isActive });
      setIsActive((v) => !v);
      onUpdated();
    } catch { /* ignore */ } finally { setToggling(false); }
  };

  const onSave = async (values: TemplateFormValues) => {
    setApiError("");
    try {
      const updated = await updateTemplate(template.id, {
        title: values.title,
        description: values.description || undefined,
        type: values.type,
        sections: values.sections.map((s, si) => ({
          title: s.title,
          display_order: si,
          fields: s.fields.map((f, fi) => ({
            id: f.id ?? crypto.randomUUID(),
            label: f.label,
            field_type: f.field_type,
            is_required: f.is_required,
            is_critical: f.is_critical ?? false,
            display_order: fi,
            ...(f.placeholder ? { placeholder: f.placeholder } : {}),
            ...(f.options?.length ? { options: f.options } : {}),
            ...(f.conditional_logic ? { conditional_logic: f.conditional_logic } : { conditional_logic: null }),
          })),
        })),
      });
      // For audit templates, also persist passing_score + section weights + field scores
      if (values.type === "audit") {
        const auditPayload: Record<string, unknown> = {};
        if (values.passing_score !== undefined) auditPayload.passing_score = values.passing_score;

        // Map section/field weights/scores using the IDs from the updated template
        const updatedSections = (updated as FormTemplate).sections ?? [];
        const section_weights = values.sections
          .map((s, si) => ({ section_id: updatedSections[si]?.id, weight: s.weight ?? 1.0 }))
          .filter((sw) => sw.section_id);
        const field_scores = values.sections.flatMap((s, si) =>
          (s.fields ?? []).map((f, fi) => ({
            field_id: updatedSections[si]?.fields?.[fi]?.id,
            max_score: f.max_score ?? 1.0,
          }))
        ).filter((fs) => fs.field_id);

        if (section_weights.length) auditPayload.section_weights = section_weights;
        if (field_scores.length) auditPayload.field_scores = field_scores;

        await apiFetch(`/api/v1/audits/templates/${template.id}`, {
          method: "PUT",
          body: JSON.stringify(auditPayload),
        });
      }

      setFullTemplate(updated);
      setEditing(false);
      onUpdated();
    } catch (e) {
      setApiError(friendlyError(e));
    }
  };

  const displayTemplate = fullTemplate ?? template;
  const totalFields = (displayTemplate.sections ?? []).reduce((acc, s) => acc + (s.fields?.length ?? 0), 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-surface-border shrink-0">
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="flex flex-col gap-1">
                <input className={inputCls + " text-base font-semibold"} {...register("title")} autoFocus />
                {errors.title && <p className="text-xs text-red-500">{errors.title.message}</p>}
              </div>
            ) : (
              <h2 className="text-lg font-semibold text-dark truncate">{displayTemplate.title}</h2>
            )}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <TypeBadge type={displayTemplate.type} />
              <span className="text-xs text-dark-secondary">
                {(displayTemplate.sections ?? []).length} sections · {totalFields} fields
              </span>
              <span className={clsx("px-2 py-0.5 rounded-full text-xs font-semibold",
                isActive ? "bg-green-50 text-sprout-green" : "bg-gray-100 text-gray-400")}>
                {isActive ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-5">
          {fetching ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 text-sprout-purple animate-spin" />
            </div>
          ) : editing ? (
            /* ── Edit form ── */
            <form id="edit-form" onSubmit={handleSubmit(onSave)} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Description</label>
                <textarea className={`${inputCls} resize-none`} rows={2}
                  placeholder="What is this template for? When should staff use it?"
                  {...register("description")} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Type</label>
                <select className={`${inputCls} bg-white`} {...register("type")}>
                  <option value="checklist">Checklist</option>
                  <option value="form">Form</option>
                  <option value="audit">Audit</option>
                </select>
              </div>
              {watchedType === "audit" && (
                <div className="flex flex-col gap-1 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <label className="text-xs font-medium text-amber-800 uppercase tracking-wide">Passing Score (%)</label>
                  <p className="text-xs text-amber-600 mb-1">Submissions scoring below this threshold will automatically generate corrective action plans.</p>
                  <input
                    type="number" min={0} max={100} step={1}
                    className={`${inputCls} max-w-[120px]`}
                    {...register("passing_score", { setValueAs: (v) => v === "" || v === null || v === undefined ? undefined : Number(v) })}
                  />
                </div>
              )}
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Sections</p>
                {sections.map((sec, si) => {
                  const priorFields = (watchedSections ?? []).slice(0, si).flatMap((ws) =>
                    (ws.fields ?? []).map((wf) => ({ id: wf.id ?? "", label: wf.label }))
                  ).filter((pf) => pf.id);
                  return (
                    <div key={sec.id} className="relative">
                      <SectionBuilder sectionIndex={si} control={control} register={register} errors={errors} priorFields={priorFields} templateType={watchedType} />
                      {sections.length > 1 && (
                        <button type="button" onClick={() => removeSection(si)}
                          className="absolute top-3 right-3 p-1 hover:text-red-500 text-gray-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {errors.sections && typeof errors.sections.message === "string" && (
                  <p className="text-xs text-red-500">{errors.sections.message}</p>
                )}
                <button type="button"
                  onClick={() => addSection({ title: "", fields: [{ id: crypto.randomUUID(), label: "", field_type: "text", is_required: false, placeholder: "", conditional_logic: null }] })}
                  className="flex items-center gap-1 text-sm text-sprout-purple font-medium hover:underline self-start">
                  <Plus className="w-4 h-4" /> Add Section
                </button>
              </div>
              {apiError && <p className="text-xs text-red-500">{apiError}</p>}
            </form>
          ) : (
            /* ── View mode ── */
            <>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Description</p>
                <p className="text-sm text-dark">
                  {displayTemplate.description || <span className="text-gray-400 italic">No description</span>}
                </p>
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between bg-surface-page rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-dark">Template Active</p>
                  <p className="text-xs text-dark-secondary mt-0.5">
                    When active, this template can be assigned to staff.
                  </p>
                </div>
                <button onClick={handleToggleActive} disabled={toggling}
                  title={isActive ? "Deactivate template" : "Activate template"}
                  className="ml-4 shrink-0 disabled:opacity-50">
                  {isActive
                    ? <ToggleRight className="w-8 h-8 text-sprout-green" />
                    : <ToggleLeft className="w-8 h-8 text-gray-400" />}
                </button>
              </div>

              {/* Sections read-only */}
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Sections &amp; Fields</p>
                {(displayTemplate.sections ?? []).length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No sections defined.</p>
                ) : (
                  (displayTemplate.sections ?? []).map((section: FormSection) => (
                    <div key={section.id} className="border border-surface-border rounded-xl overflow-hidden">
                      <div className="bg-surface-page px-4 py-2.5 flex items-center gap-2">
                        <ChevronRight className="w-3.5 h-3.5 text-dark-secondary" />
                        <p className="text-sm font-semibold text-dark">{section.title}</p>
                        <span className="ml-auto text-xs text-dark-secondary">{section.fields?.length ?? 0} fields</span>
                      </div>
                      <div className="divide-y divide-surface-border">
                        {(section.fields ?? []).map((f) => (
                          <div key={f.id} className="px-4 py-2.5 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-dark">{f.label}</span>
                                {f.is_required && <span className="text-xs text-red-400 font-medium">Required</span>}
                              </div>
                              {f.placeholder && <p className="text-xs text-gray-400 mt-0.5 italic">{f.placeholder}</p>}
                            </div>
                            <FieldTypeLabel type={f.field_type} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-surface-border flex items-center gap-2 shrink-0">
          {confirmDelete ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-dark-secondary">Delete this template?</span>
              <button onClick={onDelete} className="text-red-600 font-medium hover:underline">Yes, delete</button>
              <button onClick={() => setConfirmDelete(false)} className="text-dark-secondary hover:underline">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg text-red-500 hover:bg-red-50 border border-red-100">
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          )}
          <div className="flex-1" />
          {editing ? (
            <>
              <button type="button" onClick={() => { setEditing(false); setApiError(""); }}
                className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">
                Discard
              </button>
              <button type="submit" form="edit-form" disabled={isSubmitting}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
                {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><CheckCircle2 className="w-4 h-4" /> Save Changes</>}
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} disabled={fetching}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              <Pencil className="w-4 h-4" /> Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CreateTemplateModal ────────────────────────────────────────────────────────
function CreateTemplateModal({ onClose, onSuccess, prefill }: {
  onClose: () => void;
  onSuccess: (template: FormTemplate) => void;
  prefill?: TemplateFormValues;
}) {
  const { control, register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: prefill ?? {
      title: "",
      description: "",
      type: "checklist",
      passing_score: 80,
      sections: [{ title: "", fields: [{ id: crypto.randomUUID(), label: "", field_type: "text", is_required: false, placeholder: "", conditional_logic: null }] }],
    },
  });
  const { fields: sections, append: addSection, remove: removeSection } = useFieldArray({ control, name: "sections" });
  const watchedSections = useWatch({ control, name: "sections" });
  const watchedType = watch("type");
  const [apiError, setApiError] = useState("");

  // Auto-inject "Estimated Cost" field when pull_out is selected
  useEffect(() => {
    if (watchedType === "pull_out") {
      const current = control._formValues as TemplateFormValues;
      const allFields = (current.sections ?? []).flatMap((s) => s.fields ?? []);
      const alreadyHas = allFields.some((f) => f.label?.toLowerCase() === "estimated cost");
      if (!alreadyHas) {
        const firstSection = current.sections?.[0];
        if (firstSection) {
          const updatedFields = [
            ...(firstSection.fields ?? []),
            { id: crypto.randomUUID(), label: "Estimated Cost", field_type: "number" as const, is_required: true, placeholder: "e.g. 150.00", options: [], conditional_logic: null },
          ];
          setValue("sections.0.fields", updatedFields, { shouldValidate: false });
        }
      }
    }
  }, [watchedType]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (values: TemplateFormValues) => {
    setApiError("");
    try {
      // Pre-assign section and field IDs so we can reference them in section_weights / field_scores
      const sectionIds = values.sections.map(() => crypto.randomUUID());
      const fieldIdMap: string[][] = values.sections.map((s) =>
        (s.fields ?? []).map((f) => f.id ?? crypto.randomUUID())
      );

      const sections = values.sections.map((s, si) => ({
        id: sectionIds[si],
        title: s.title,
        display_order: si,
        fields: s.fields.map((f, fi) => ({
          id: fieldIdMap[si][fi],
          label: f.label,
          field_type: f.field_type,
          is_required: f.is_required,
          is_critical: f.is_critical ?? false,
          display_order: fi,
          ...(f.placeholder ? { placeholder: f.placeholder } : {}),
          ...(f.options?.length ? { options: f.options } : {}),
          ...(f.conditional_logic ? { conditional_logic: f.conditional_logic } : { conditional_logic: null }),
        })),
      }));

      let createdTemplate: FormTemplate;
      if (values.type === "audit") {
        const section_weights = values.sections.map((s, si) => ({
          section_id: sectionIds[si],
          weight: s.weight ?? 1.0,
        }));
        const field_scores = values.sections.flatMap((s, si) =>
          (s.fields ?? []).map((f, fi) => ({
            field_id: fieldIdMap[si][fi],
            max_score: f.max_score ?? 1.0,
          }))
        );

        createdTemplate = await apiFetch<FormTemplate>("/api/v1/audits/templates", {
          method: "POST",
          body: JSON.stringify({
            title: values.title,
            description: values.description,
            passing_score: values.passing_score ?? 80,
            sections,
            section_weights,
            field_scores,
          }),
        });
      } else {
        createdTemplate = await createTemplate({ title: values.title, description: values.description, type: values.type, sections });
      }
      onSuccess(createdTemplate);
    } catch (e) {
      setApiError(friendlyError(e));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl p-4 md:p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-dark">
          {prefill ? "Review Sidekick-Generated Template" : "New Template"}
        </h2>
        {prefill && (
          <p className="text-xs text-dark-secondary bg-sprout-purple/5 border border-sprout-purple/20 rounded-lg px-3 py-2">
            ✨ Generated by Sidekick — review and edit before saving.
          </p>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Title *</label>
            <input className={inputCls} placeholder="e.g. Opening Checklist, Food Safety Audit" {...register("title")} />
            {errors.title && <p className="text-xs text-red-500">{errors.title.message}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Description (optional)</label>
            <textarea className={`${inputCls} resize-none`} rows={2} placeholder="What is this template for? When should staff use it?" {...register("description")} />
          </div>
          {!prefill && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-dark">Type</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([
                  { value: "checklist", icon: CheckCheck,  label: "Checklist", desc: "Step-by-step tasks staff complete in order" },
                  { value: "form",      icon: FileText,     label: "Form",      desc: "Collect data, inputs, and responses" },
                  { value: "audit",     icon: ShieldCheck,  label: "Audit",     desc: "Scored inspections with pass/fail criteria" },
                  { value: "pull_out",  icon: PackageX,     label: "Pull-Out",  desc: "Log wasted or pulled items with reasons" },
                ] as const).map(({ value, icon: Icon, label, desc }) => (
                  <button key={value} type="button"
                    onClick={() => setValue("type", value, { shouldValidate: true })}
                    className={clsx(
                      "flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-all",
                      watchedType === value
                        ? "border-sprout-purple bg-sprout-purple/5 text-sprout-purple"
                        : "border-surface-border hover:border-sprout-purple/40 text-dark-secondary hover:text-dark"
                    )}>
                    <Icon className={clsx("w-5 h-5", watchedType === value ? "text-sprout-purple" : "text-dark-secondary")} />
                    <span className="text-xs font-semibold">{label}</span>
                    <span className="text-[10px] leading-snug opacity-70">{desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {watchedType === "audit" && (
            <div className="flex flex-col gap-1 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <label className="text-sm font-medium text-amber-800">Passing Score (%)</label>
              <p className="text-xs text-amber-600 mb-1">Submissions scoring below this threshold will automatically generate corrective action plans.</p>
              <input
                type="number" min={0} max={100} step={1}
                className={`${inputCls} max-w-[120px]`}
                {...register("passing_score", { setValueAs: (v) => v === "" || v === null || v === undefined ? undefined : Number(v) })}
              />
            </div>
          )}

          {watchedType === "pull_out" && (
            <div className="flex flex-col gap-1.5 p-3 bg-orange-50 border border-orange-200 rounded-xl">
              <label className="text-sm font-medium text-orange-800">Estimated Cost (required field)</label>
              <p className="text-xs text-orange-700">Every pull-out submission must include an <strong>Estimated Cost</strong> greater than zero. This field is automatically added to your template — the backend will reject any submission without it.</p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-dark">Sections</p>
            {sections.map((sec, si) => {
              const priorFields = (watchedSections ?? []).slice(0, si).flatMap((ws) =>
                (ws.fields ?? []).map((wf) => ({ id: wf.id ?? "", label: wf.label }))
              ).filter((pf) => pf.id);
              return (
                <div key={sec.id} className="relative">
                  <SectionBuilder sectionIndex={si} control={control} register={register} errors={errors} priorFields={priorFields} templateType={watchedType} />
                  {sections.length > 1 && (
                    <button type="button" onClick={() => removeSection(si)}
                      className="absolute top-3 right-3 p-1 hover:text-red-500 text-gray-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
            {errors.sections && typeof errors.sections.message === "string" && (
              <p className="text-xs text-red-500">{errors.sections.message}</p>
            )}
            <button type="button"
              onClick={() => addSection({ title: "", fields: [{ id: crypto.randomUUID(), label: "", field_type: "text", is_required: false, placeholder: "", conditional_logic: null }] })}
              className="flex items-center gap-1 text-sm text-sprout-purple font-medium hover:underline self-start">
              <Plus className="w-4 h-4" /> Add Section
            </button>
          </div>

          {apiError && <p className="text-xs text-red-500">{apiError}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting}
              className="px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {isSubmitting ? "Creating…" : "Create Template"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── GenerateModal ──────────────────────────────────────────────────────────────
function GenerateModal({ onClose, onGenerated }: {
  onClose: () => void;
  onGenerated: (values: TemplateFormValues) => void;
}) {
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"checklist" | "form" | "audit" | "pull_out">("checklist");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    if (!description.trim()) { setError("Please describe the template you need."); return; }
    setError("");
    setLoading(true);
    try {
      const result = await generateTemplate({ description: description.trim(), type });
      const mappedSections = result.sections.map((s) => ({
        title: s.title,
        fields: s.fields.map((f) => ({
          label: f.label,
          field_type: f.field_type as FormFieldType,
          is_required: f.is_required,
          placeholder: f.placeholder ?? "",
          options: f.options ?? [],
        })),
      }));
      // Ensure pull_out templates always include Estimated Cost
      if (type === "pull_out" && mappedSections.length > 0) {
        const allLabels = mappedSections.flatMap((s) => s.fields.map((f) => f.label?.toLowerCase()));
        if (!allLabels.includes("estimated cost")) {
          mappedSections[mappedSections.length - 1].fields.push({
            label: "Estimated Cost", field_type: "number", is_required: true, placeholder: "e.g. 150.00", options: [],
          });
        }
      }
      const prefill: TemplateFormValues = {
        title: result.title,
        description: result.description ?? "",
        type,
        passing_score: type === "audit" ? 80 : undefined,
        sections: mappedSections,
      };
      onGenerated(prefill);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("overloaded") || msg.includes("529") || msg.includes("temporarily")) {
        setError("The AI service is temporarily busy. Wait a few seconds and try again.");
      } else if (msg.includes("rate limit") || msg.includes("429")) {
        setError("Too many requests. Please wait a moment and try again.");
      } else {
        setError(msg || "Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-sprout-purple" />
          <h2 className="text-lg font-semibold bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate with Sidekick</h2>
        </div>
        <p className="text-sm text-dark-secondary">
          Describe the template you need in plain English. Claude will generate sections, fields, and placeholder hints.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-dark">Description</label>
          <textarea className={`${inputCls} resize-none`} rows={4}
            placeholder="e.g. Opening checklist for a food & beverage store covering kitchen prep, front-of-house setup, equipment checks, and staff attendance"
            value={description} onChange={(e) => setDescription(e.target.value)} disabled={loading} />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-dark">Type</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([
              { value: "checklist", icon: CheckCheck,  label: "Checklist", desc: "Step-by-step tasks staff complete in order" },
              { value: "form",      icon: FileText,     label: "Form",      desc: "Collect data, inputs, and responses" },
              { value: "audit",     icon: ShieldCheck,  label: "Audit",     desc: "Scored inspections with pass/fail criteria" },
              { value: "pull_out",  icon: PackageX,     label: "Pull-Out",  desc: "Log wasted or pulled items with reasons" },
            ] as const).map(({ value, icon: Icon, label, desc }) => (
              <button key={value} type="button" disabled={loading}
                onClick={() => setType(value)}
                className={clsx(
                  "flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-all",
                  type === value
                    ? "border-sprout-purple bg-sprout-purple/5 text-sprout-purple"
                    : "border-surface-border hover:border-sprout-purple/40 text-dark-secondary hover:text-dark",
                  loading && "opacity-50 cursor-not-allowed"
                )}>
                <Icon className={clsx("w-5 h-5", type === value ? "text-sprout-purple" : "text-dark-secondary")} />
                <span className="text-xs font-semibold">{label}</span>
                <span className="text-[10px] leading-snug opacity-70">{desc}</span>
              </button>
            ))}
          </div>
        </div>
        {type === "pull_out" && (
          <div className="flex flex-col gap-1 p-3 bg-orange-50 border border-orange-200 rounded-xl">
            <p className="text-sm font-medium text-orange-800">Estimated Cost (required field)</p>
            <p className="text-xs text-orange-700">Every pull-out submission must include an <strong>Estimated Cost</strong> greater than zero. Sidekick will include this field automatically.</p>
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose} disabled={loading}
            className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={handleGenerate} disabled={loading || !description.trim()}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 text-sm rounded-lg font-medium transition-all disabled:opacity-60",
              loading
                ? "bg-sprout-purple text-white"
                : "ai-sparkle-btn shadow-md shadow-purple-200"
            )}>
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> Generate</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Template Card ─────────────────────────────────────────────────────────────
// ── Assign Modal ──────────────────────────────────────────────────────────────
const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function AssignModal({ template, onClose }: { template: FormTemplate; onClose: () => void }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [recurrence, setRecurrence] = useState<"once" | "daily" | "weekly">("once");
  const [onceDate, setOnceDate] = useState(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  });
  const [dailyTime, setDailyTime] = useState("09:00");
  const [weeklyDay, setWeeklyDay] = useState(1);
  const [weeklyTime, setWeeklyTime] = useState("09:00");
  const [submitting, setSubmitting] = useState(false);
  const [assignedCount, setAssignedCount] = useState(0);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const isAudit = template.type === "audit";
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");

  useEffect(() => {
    if (isAudit) listLocations().then(setLocations).catch(() => {});
  }, [isAudit]);

  const buildDueAt = (): string => {
    if (recurrence === "once") return new Date(onceDate).toISOString();
    if (recurrence === "daily") {
      const [h, m] = dailyTime.split(":").map(Number);
      const d = new Date(); d.setHours(h, m, 0, 0);
      if (d <= new Date()) d.setDate(d.getDate() + 1);
      return d.toISOString();
    }
    const [h, m] = weeklyTime.split(":").map(Number);
    const now = new Date(); const d = new Date(); d.setHours(h, m, 0, 0);
    const daysUntil = (weeklyDay - now.getDay() + 7) % 7 || 7;
    d.setDate(now.getDate() + daysUntil);
    return d.toISOString();
  };

  const isDueValid = () => {
    if (recurrence === "once") return !!onceDate;
    if (recurrence === "daily") return !!dailyTime;
    return !!weeklyTime;
  };

  const dueLabel = () => {
    if (recurrence === "once") return onceDate ? new Date(onceDate).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "";
    if (recurrence === "daily") return dailyTime ? `Every day by ${dailyTime}` : "";
    return weeklyTime ? `Every ${DAYS_OF_WEEK[weeklyDay]} by ${weeklyTime}` : "";
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) { setError("Select at least one team member."); return; }
    if (isAudit && !selectedLocationId) { setError("Select a location for this audit."); return; }
    if (!isDueValid()) { setError("Set a due date."); return; }
    setError("");
    setSubmitting(true);
    let count = 0;
    try {
      const dueAt = buildDueAt();
      for (const userId of Array.from(selectedIds)) {
        try {
          await createAssignment({
            form_template_id: template.id,
            assigned_to_user_id: userId,
            ...(isAudit && { assigned_to_location_id: selectedLocationId }),
            recurrence,
            due_at: dueAt,
          });
          count++;
        } catch { /* skip failed individual */ }
      }
      setAssignedCount(count);
      setSuccess(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-sprout-purple" />
            <span className="font-semibold text-dark text-sm">Assign Form</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-12 px-6">
            <CheckCircle2 className="w-10 h-10 text-sprout-green" />
            <p className="font-semibold text-dark">{assignedCount} member{assignedCount !== 1 ? "s" : ""} assigned!</p>
            <p className="text-sm text-dark-secondary text-center">
              <span className="font-medium">{template.title}</span> has been assigned to {assignedCount} team member{assignedCount !== 1 ? "s" : ""}.
            </p>
            <button onClick={onClose} className="mt-2 px-4 py-2 rounded-lg bg-sprout-purple text-white text-sm font-medium">Done</button>
          </div>
        ) : (
          <div className="flex flex-col gap-5 p-6 overflow-y-auto">
            {/* Template info */}
            <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center gap-3">
              <ClipboardList className="w-4 h-4 text-sprout-purple shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-dark truncate">{template.title}</p>
                <p className="text-xs text-dark-secondary capitalize">{template.type}</p>
              </div>
            </div>

            {/* Team member selection — 3-tab panel */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-dark flex items-center justify-between">
                <span>Assign to</span>
                {selectedIds.size > 0 && (
                  <span className="text-xs font-semibold text-sprout-purple">{selectedIds.size} selected</span>
                )}
              </label>
              <AssignPeoplePanel
                selected={selectedIds}
                onChange={setSelectedIds}
              />
            </div>

            {/* Location (audit only) */}
            {isAudit && (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-dark">
                  Location <span className="text-red-500">*</span>
                </label>
                <select
                  className="border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
                  value={selectedLocationId}
                  onChange={(e) => setSelectedLocationId(e.target.value)}
                >
                  <option value="">Select a location…</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Recurrence */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-dark">Recurrence</label>
              <div className="flex gap-2">
                {(["once", "daily", "weekly"] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setRecurrence(r)}
                    className={clsx(
                      "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize",
                      recurrence === r
                        ? "bg-sprout-purple text-white border-sprout-purple"
                        : "border-surface-border text-dark-secondary hover:bg-gray-50"
                    )}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Due date */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-dark">
                {recurrence === "once" ? "Due date & time" : recurrence === "daily" ? "Daily deadline time" : "Weekly deadline"}
              </label>
              {recurrence === "once" && (
                <input type="datetime-local"
                  className="border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
                  value={onceDate} onChange={(e) => setOnceDate(e.target.value)} />
              )}
              {recurrence === "daily" && (
                <div className="flex flex-col gap-1.5">
                  <input type="time"
                    className="border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
                    value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} />
                  <p className="text-xs text-dark-secondary">Staff must complete this form by this time every day.</p>
                </div>
              )}
              {recurrence === "weekly" && (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-1 flex-wrap">
                    {DAYS_OF_WEEK.map((day, idx) => (
                      <button key={day} type="button" onClick={() => setWeeklyDay(idx)}
                        className={clsx(
                          "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
                          weeklyDay === idx
                            ? "bg-sprout-purple text-white border-sprout-purple"
                            : "border-surface-border text-dark-secondary hover:bg-gray-50"
                        )}>
                        {day.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                  <input type="time"
                    className="border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
                    value={weeklyTime} onChange={(e) => setWeeklyTime(e.target.value)} />
                  <p className="text-xs text-dark-secondary">Staff must complete this form by this time every {DAYS_OF_WEEK[weeklyDay]}.</p>
                </div>
              )}
              {isDueValid() && (
                <p className="text-xs font-medium text-sprout-purple">📅 {dueLabel()}</p>
              )}
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || selectedIds.size === 0}
              className="w-full py-2.5 rounded-lg bg-sprout-purple text-white font-semibold text-sm hover:bg-sprout-purple/90 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {submitting ? "Assigning…" : selectedIds.size > 0 ? `Assign ${selectedIds.size} Member${selectedIds.size !== 1 ? "s" : ""}` : "Assign"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Template Card ─────────────────────────────────────────────────────────────
function TemplateCard({ template, onView, onAssign }: {
  template: FormTemplate;
  onView: () => void;
  onAssign: () => void;
}) {
  const fieldCount = (template.sections ?? []).reduce((acc, s) => acc + (s.fields?.length ?? 0), 0);
  const [stats, setStats] = useState<{ assigned_count: number; completed_count: number; latest_response_at: string | null } | null>(null);

  useEffect(() => {
    getTemplateStats(template.id)
      .then(setStats)
      .catch(() => setStats(null));
  }, [template.id]);

  return (
    <div className="bg-white rounded-xl border border-surface-border p-5 flex flex-col gap-3 hover:border-sprout-purple/40 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-dark text-sm leading-snug">{template.title}</p>
      </div>
      {template.description && (
        <p className="text-xs text-dark-secondary line-clamp-2">{template.description}</p>
      )}
      <div className="flex gap-2 flex-wrap mt-auto">
        <TypeBadge type={template.type} />
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-dark-secondary">
          {fieldCount} fields
        </span>
        {!template.is_active && (
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-400">Inactive</span>
        )}
      </div>
      {/* Assignment stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-surface-border">
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-dark-secondary">Assigned</p>
            <p className="text-sm font-semibold text-dark">{stats.assigned_count}</p>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-dark-secondary">Completed</p>
            <p className="text-sm font-semibold text-sprout-green">{stats.completed_count}</p>
          </div>
          {stats.latest_response_at && (
            <div className="col-span-2 flex flex-col gap-0.5">
              <p className="text-xs text-dark-secondary">Latest response</p>
              <p className="text-xs font-medium text-dark">
                {new Date(stats.latest_response_at).toLocaleString("en-PH", {
                  month: "short", day: "numeric", year: "numeric",
                  hour: "numeric", minute: "2-digit",
                })}
              </p>
            </div>
          )}
        </div>
      )}
      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-surface-border">
        <button
          onClick={onView}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium border border-surface-border text-dark-secondary hover:bg-gray-50 hover:text-sprout-purple hover:border-sprout-purple/40 transition-colors"
        >
          <Eye className="w-3.5 h-3.5" /> View / Edit
        </button>
        <button
          onClick={onAssign}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium bg-sprout-purple/10 text-sprout-purple hover:bg-sprout-purple hover:text-white transition-colors"
        >
          <UserPlus className="w-3.5 h-3.5" /> Assign
        </button>
      </div>
    </div>
  );
}

// ── Submission status badge ────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    submitted: "bg-amber-100 text-amber-700",
    approved: "bg-sprout-green/10 text-sprout-green",
    rejected: "bg-red-100 text-red-600",
    draft: "bg-gray-100 text-gray-500",
  };
  return (
    <span className={clsx("px-2 py-0.5 rounded-full text-xs font-semibold capitalize", map[status] ?? "bg-gray-100 text-gray-500")}>
      {status}
    </span>
  );
}

// ── Submission detail / review modal ──────────────────────────────────────────
function SubmissionDetailModal({
  submissionId,
  onClose,
  onReviewed,
}: {
  submissionId: string;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const [detail, setDetail] = useState<FormSubmissionDetail | null>(null);
  const [template, setTemplate] = useState<import("@/types").FormTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [comment, setComment] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [viewMediaUrl, setViewMediaUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const sub = await getSubmission(submissionId);
        setDetail(sub);
        setComment(sub.manager_comment ?? "");
        const tmpl = await getTemplate(sub.form_template_id);
        setTemplate(tmpl);
      } catch (e) {
        setLoadError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [submissionId]);

  const handleReview = async (status: "approved" | "rejected") => {
    setReviewError("");
    setReviewing(true);
    try {
      await reviewSubmission(submissionId, { status, manager_comment: comment || undefined });
      onReviewed();
      onClose();
    } catch (e) {
      setReviewError(friendlyError(e));
    } finally {
      setReviewing(false);
    }
  };

  // Build a field-label lookup from the template
  const fieldLabels: Record<string, { label: string; type: string }> = {};
  for (const section of template?.sections ?? []) {
    for (const field of section.fields ?? []) {
      fieldLabels[field.id] = { label: field.label, type: field.field_type };
    }
  }

  const responses = detail?.responses ?? [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-end z-50">
      <div className="bg-white h-full w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border shrink-0">
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-dark text-sm truncate">
              {detail?.form_templates?.title ?? "Submission"}
            </p>
            <p className="text-xs text-dark-secondary mt-0.5">
              {detail?.profiles?.full_name ?? "Unknown user"}
              {detail?.submitted_at && ` · ${new Date(detail.submitted_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}`}
            </p>
          </div>
          {detail && <StatusBadge status={detail.status} />}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-sprout-purple" />
            </div>
          ) : loadError ? (
            <p className="text-sm text-red-500 p-5">{loadError}</p>
          ) : (
            <div className="p-5 flex flex-col gap-5">
              {/* Audit score banner */}
              {detail?.form_templates?.type === "audit" && detail.overall_score !== null && (
                (() => {
                  const score = detail.overall_score ?? 0;
                  const passing = detail.form_templates?.audit_configs?.[0]?.passing_score ?? 80;
                  const passed = detail.passed;
                  return (
                    <div className={clsx(
                      "rounded-xl border p-4 flex flex-col gap-3",
                      passed ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                    )}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-dark">Audit Score</span>
                        <span className={clsx(
                          "px-2.5 py-1 rounded-full text-xs font-bold",
                          passed ? "bg-sprout-green text-white" : "bg-red-500 text-white"
                        )}>
                          {passed ? "PASSED" : "FAILED"}
                        </span>
                      </div>
                      <div className="flex items-end gap-2">
                        <span className={clsx("text-4xl font-bold", passed ? "text-sprout-green" : "text-red-500")}>
                          {Math.round(score)}%
                        </span>
                        <span className="text-sm text-dark-secondary mb-1">/ 100</span>
                      </div>
                      {/* Score bar */}
                      <div className="relative h-2.5 rounded-full bg-white/70 overflow-visible">
                        <div
                          className={clsx("h-full rounded-full transition-all", passed ? "bg-sprout-green" : "bg-red-400")}
                          style={{ width: `${Math.min(score, 100)}%` }}
                        />
                        {/* Passing threshold marker */}
                        <div
                          className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-dark/40 rounded-full"
                          style={{ left: `${passing}%` }}
                        />
                      </div>
                      <p className="text-xs text-dark-secondary">
                        Passing threshold: <span className="font-semibold">{passing}%</span>
                        {!passed && <span className="text-red-500 ml-1">— {Math.round(passing - score)}% below passing</span>}
                      </p>
                    </div>
                  );
                })()
              )}

              {/* Responses grouped by section */}
              {template?.sections?.map((section) => {
                const sectionResponses = (section.fields ?? []).map((field) => {
                  const resp = responses.find((r) => r.field_id === field.id);
                  return { field, value: resp?.value ?? null, fieldComment: resp?.comment ?? null };
                });
                const hasAny = sectionResponses.some((r) => r.value !== null);
                if (!hasAny) return null;
                return (
                  <div key={section.id} className="flex flex-col gap-3">
                    <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wider">
                      {section.title}
                    </p>
                    {sectionResponses.map(({ field, value, fieldComment }) => {
                      if (value === null) return null;
                      return (
                        <div key={field.id} className="bg-gray-50 rounded-xl px-4 py-3 flex flex-col gap-1.5">
                          <p className="text-xs text-dark-secondary font-medium">{field.label}</p>
                          {(field.field_type === "photo" || field.field_type === "video") ? (() => {
                            const mediaUrls = (() => {
                              if (!value) return [];
                              try { const p = JSON.parse(value); if (Array.isArray(p)) return p.filter(Boolean); } catch { /* noop */ }
                              return [value];
                            })();
                            const isVid = (u: string) => /\.(mp4|mov|webm)/i.test(u.split("?")[0]);
                            return (
                              <div className="flex flex-wrap gap-2 mt-1">
                                {mediaUrls.map((u: string) => (
                                  isVid(u) ? (
                                    <video key={u} src={u} controls className="rounded-lg max-h-48 w-full bg-black" />
                                  ) : (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img key={u} src={u} alt={field.label}
                                      className="rounded-lg max-h-48 object-cover cursor-zoom-in hover:opacity-90 transition"
                                      onClick={() => setViewMediaUrl(u)} />
                                  )
                                ))}
                              </div>
                            );
                          })() : (field.field_type === "checkbox" || field.field_type === "yes_no") ? (
                            <p className="text-sm text-dark flex items-center gap-1.5">
                              {value === "true"
                                ? <><CheckCheck className="w-4 h-4 text-sprout-green" /> Yes</>
                                : <><XCircle className="w-4 h-4 text-gray-400" /> No</>}
                            </p>
                          ) : field.field_type === "boolean" ? (
                            <p className="text-sm text-dark flex items-center gap-1.5">
                              {value === "true"
                                ? <><CheckCheck className="w-4 h-4 text-sprout-green" /> Pass</>
                                : <><XCircle className="w-4 h-4 text-red-500" /> Fail</>}
                            </p>
                          ) : (
                            <p className="text-sm text-dark whitespace-pre-wrap break-words">{value}</p>
                          )}
                          {fieldComment && (
                            <div className="flex items-start gap-1.5 mt-0.5 pt-1.5 border-t border-gray-200">
                              <MessageSquare className="w-3 h-3 text-dark-secondary shrink-0 mt-0.5" />
                              <p className="text-xs text-dark-secondary italic">{fieldComment}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* If template didn't load, show raw responses */}
              {!template && responses.map((r) => (
                <div key={r.id} className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-xs text-dark-secondary font-mono">{r.field_id}</p>
                  <p className="text-sm text-dark mt-0.5">{r.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Review footer — only shown for "submitted" status */}
        {detail?.status === "submitted" && (
          <div className="border-t border-surface-border p-4 flex flex-col gap-3 shrink-0">
            <textarea
              className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sprout-purple/40"
              rows={2}
              placeholder="Add a comment (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            {reviewError && <p className="text-xs text-red-500">{reviewError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => handleReview("rejected")}
                disabled={reviewing}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-60"
              >
                {reviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><XCircle className="w-4 h-4" /> Reject</>}
              </button>
              <button
                onClick={() => handleReview("approved")}
                disabled={reviewing}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-sprout-green text-white text-sm font-medium hover:bg-sprout-green/90 disabled:opacity-60"
              >
                {reviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCheck className="w-4 h-4" /> Approve</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Media lightbox */}
      {viewMediaUrl && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"
          onClick={() => setViewMediaUrl(null)}>
          <button type="button" onClick={() => setViewMediaUrl(null)}
            className="absolute top-4 right-4 w-9 h-9 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewMediaUrl} alt="" className="w-full rounded-xl object-contain max-h-[80vh]" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Audit CAP tab ──────────────────────────────────────────────────────────────

const CAP_STATUS_CONFIG: Record<CAPStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending_review: { label: "Pending Review", color: "bg-amber-100 text-amber-700",       icon: Calendar },
  in_review:      { label: "In Review",      color: "bg-blue-100 text-blue-700",         icon: Eye },
  confirmed:      { label: "Confirmed",       color: "bg-sprout-green/10 text-sprout-green", icon: CheckCircle2 },
  dismissed:      { label: "Dismissed",       color: "bg-gray-100 text-gray-500",         icon: XCircle },
};

function AuditCAPTab() {
  const router = useRouter();
  const [caps, setCaps] = useState<CAP[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<CAPStatus | "all">("all");
  const [capSearch, setCapSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listCAPs({ status: statusFilter === "all" ? undefined : statusFilter, page, page_size: 20 });
      setCaps(res.items);
      setTotalCount(res.total_count);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [statusFilter, page]);

  useEffect(() => { load(); }, [load]);

  const counts: Record<string, number> = {};
  for (const c of caps) counts[c.status] = (counts[c.status] || 0) + 1;

  const capFilterCount = [fromDate, toDate].filter(Boolean).length;
  const displayedCaps = caps.filter((c) => {
    if (capSearch) {
      const q = capSearch.toLowerCase();
      if (!(c.form_submissions?.form_templates?.title ?? "").toLowerCase().includes(q) &&
          !(c.locations?.name ?? "").toLowerCase().includes(q)) return false;
    }
    if (fromDate && new Date(c.generated_at) < new Date(fromDate)) return false;
    if (toDate && new Date(c.generated_at) > new Date(toDate + "T23:59:59")) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-dark-secondary">
          {loading ? "Loading…" : `${totalCount} corrective action plan${totalCount !== 1 ? "s" : ""}`}
        </p>
        <p className="text-xs text-dark-secondary italic">Audit Corrective Action Plans are automatically generated when an audit submission falls below the passing threshold.</p>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-dark-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          className="border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40"
          placeholder="Search by audit name or location…"
          value={capSearch}
          onChange={(e) => setCapSearch(e.target.value)}
        />
      </div>

      {/* Status chips + Filters button */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "pending_review", "in_review", "confirmed", "dismissed"] as const).map((s) => {
            const active = statusFilter === s;
            const label = s === "all" ? "All" : CAP_STATUS_CONFIG[s].label;
            return (
              <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
                className={clsx("px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                  active
                    ? "bg-sprout-cyan text-white border-sprout-cyan"
                    : "bg-white text-dark-secondary border-surface-border hover:border-sprout-cyan hover:text-sprout-cyan"
                )}>
                {label}{s !== "all" && caps.length > 0 ? ` (${counts[s] || 0})` : ""}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              capFilterCount > 0
                ? "border-sprout-purple text-sprout-purple bg-sprout-purple/5"
                : "border-surface-border text-dark-secondary hover:bg-gray-50"
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {capFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-sprout-purple text-white text-[10px] font-bold flex items-center justify-center">{capFilterCount}</span>
            )}
          </button>
          <button onClick={load} className="p-1.5 border border-surface-border rounded-lg hover:bg-gray-50 text-dark-secondary" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Collapsible: date range */}
      {showFilters && (
        <div className="bg-gray-50 border border-surface-border rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-3.5 h-3.5 text-dark-secondary shrink-0" />
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40"
              title="From date" />
            <span className="text-dark-secondary text-xs">–</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40"
              title="To date" />
            {capFilterCount > 0 && (
              <button onClick={() => { setFromDate(""); setToDate(""); }}
                className="text-xs text-dark-secondary hover:text-dark flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 ml-auto">
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-sprout-purple animate-spin" />
        </div>
      ) : displayedCaps.length === 0 ? (
        <div className="text-center py-20">
          <CheckCircle2 className="w-10 h-10 text-sprout-green mx-auto mb-2" />
          <p className="text-dark-secondary text-sm">
            {capSearch ? "No audit CAPs match your search." : "No corrective action plans found."}
          </p>
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
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {displayedCaps.map((cap) => {
                  const sub = cap.form_submissions;
                  const cfg = CAP_STATUS_CONFIG[cap.status] ?? CAP_STATUS_CONFIG.pending_review;
                  const score = sub?.overall_score != null ? Math.round(sub.overall_score) : null;
                  return (
                    <tr key={cap.id} className="hover:bg-gray-50/50 cursor-pointer"
                      onClick={() => router.push(`/dashboard/audits/caps/${cap.id}`)}>
                      <td className="px-4 py-3 font-medium text-dark">
                        {sub?.form_templates?.title ?? "Untitled Audit"}
                      </td>
                      <td className="px-4 py-3 text-dark-secondary">{cap.locations?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-center">
                        {score != null && (
                          <span className={clsx("text-xs font-bold px-2 py-0.5 rounded-full",
                            sub?.passed ? "bg-sprout-green/10 text-sprout-green" : "bg-red-50 text-red-600")}>
                            {score}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium", cfg.color)}>
                          <cfg.icon className="w-3 h-3" />{cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-dark-secondary">
                        {new Date(cap.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/audits/caps/${cap.id}`); }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-sprout-purple bg-sprout-purple/5 rounded-lg hover:bg-sprout-purple/10 transition-colors">
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

      {totalCount > 20 && (
        <div className="flex justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 text-xs border border-surface-border rounded-lg disabled:opacity-50">Previous</button>
          <span className="px-3 py-1.5 text-xs text-dark-secondary">Page {page} of {Math.ceil(totalCount / 20)}</span>
          <button disabled={page * 20 >= totalCount} onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 text-xs border border-surface-border rounded-lg disabled:opacity-50">Next</button>
        </div>
      )}
    </div>
  );
}

// ── Submissions tab ────────────────────────────────────────────────────────────
function groupByDate(items: FormSubmissionListItem[]): { label: string; items: FormSubmissionListItem[] }[] {
  const now = new Date();
  const todayStr = now.toDateString();
  const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);

  const groups: Record<string, FormSubmissionListItem[]> = { Today: [], "This week": [], Earlier: [] };
  for (const item of items) {
    const d = new Date(item.submitted_at ?? item.created_at);
    if (d.toDateString() === todayStr) groups["Today"].push(item);
    else if (d >= weekAgo) groups["This week"].push(item);
    else groups["Earlier"].push(item);
  }
  return Object.entries(groups)
    .filter(([, g]) => g.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function SubmissionsTab({ initialSelectedId }: { initialSelectedId?: string | null }) {
  const [items, setItems] = useState<FormSubmissionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);

  useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId);
  }, [initialSelectedId]);

  // Primary filter pills
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [submissionSearch, setSubmissionSearch] = useState("");

  // Advanced filters (collapsed by default)
  const [showFilters, setShowFilters] = useState(false);
  const [templateFilter, setTemplateFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Dropdown options
  const [templateOptions, setTemplateOptions] = useState<{ id: string; title: string; type: string }[]>([]);
  const [userOptions, setUserOptions] = useState<Profile[]>([]);
  const [locationOptions, setLocationOptions] = useState<Location[]>([]);

  useEffect(() => {
    const { templates: tmplList } = useFormStore.getState();
    setTemplateOptions(tmplList.map((t) => ({ id: t.id, title: t.title, type: t.type })));
    listUsers({ page_size: 200 }).then((r) => setUserOptions(r.items)).catch(() => {});
    listLocations().then(setLocationOptions).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    listSubmissions({
      status: statusFilter || undefined,
      template_id: templateFilter || undefined,
      user_id: userFilter || undefined,
      location_id: locationFilter || undefined,
      from: fromDate || undefined,
      to: toDate || undefined,
    })
      .then((r) => {
        // Client-side type filter (backend doesn't have type param for submissions)
        const filtered = typeFilter
          ? r.items.filter((i) => i.form_templates?.type === typeFilter)
          : r.items;
        setItems(filtered);
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [statusFilter, typeFilter, templateFilter, userFilter, locationFilter, fromDate, toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const advancedFilterCount = [templateFilter, userFilter, locationFilter, fromDate, toDate].filter(Boolean).length;
  const clearAdvanced = () => { setTypeFilter(""); setTemplateFilter(""); setUserFilter(""); setLocationFilter(""); setFromDate(""); setToDate(""); };

  // Filter the template dropdown by type when type filter is active
  const filteredTemplateOptions = typeFilter
    ? templateOptions.filter((t) => t.type === typeFilter)
    : templateOptions;

  const searchedItems = submissionSearch
    ? items.filter((i) =>
        (i.form_templates?.title ?? "").toLowerCase().includes(submissionSearch.toLowerCase()) ||
        (i.profiles?.full_name ?? "").toLowerCase().includes(submissionSearch.toLowerCase())
      )
    : items;
  const groups = groupByDate(searchedItems);

  const statusOptions = [
    { value: "", label: "All" },
    { value: "submitted", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "draft", label: "Drafts" },
  ];

  const typeOptions = [
    { value: "", label: "All types" },
    { value: "checklist", label: "Checklist" },
    { value: "form", label: "Form" },
    { value: "audit", label: "Audit" },
    { value: "pull_out", label: "Pull-Out" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-dark-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          className="border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40"
          placeholder="Search by form or staff name…"
          value={submissionSearch}
          onChange={(e) => setSubmissionSearch(e.target.value)}
        />
      </div>

      {/* Status chips + Filters button */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {statusOptions.map(({ value, label }) => (
            <button key={value} onClick={() => setStatusFilter(value)}
              className={clsx("px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                statusFilter === value
                  ? "bg-sprout-cyan text-white border-sprout-cyan"
                  : "border-surface-border text-dark-secondary hover:border-sprout-cyan hover:text-sprout-cyan")}>
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
            advancedFilterCount > 0 || typeFilter
              ? "border-sprout-purple text-sprout-purple bg-sprout-purple/5"
              : "border-surface-border text-dark-secondary hover:bg-gray-50"
          )}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {(advancedFilterCount + (typeFilter ? 1 : 0)) > 0 && (
            <span className="w-4 h-4 rounded-full bg-sprout-purple text-white text-[10px] font-bold flex items-center justify-center">
              {advancedFilterCount + (typeFilter ? 1 : 0)}
            </span>
          )}
        </button>
      </div>

      {/* Collapsible advanced filters (includes type) */}
      {showFilters && (
        <div className="bg-gray-50 border border-surface-border rounded-xl p-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {/* Form type */}
            <div className="relative">
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40">
                {typeOptions.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-dark-secondary" />
            </div>

            {/* Template */}
            <div className="relative">
              <select value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40">
                <option value="">All templates</option>
                {filteredTemplateOptions.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-dark-secondary" />
            </div>

            {/* Staff */}
            <div className="relative">
              <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40">
                <option value="">All staff</option>
                {userOptions.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-dark-secondary" />
            </div>

            {/* Location */}
            {locationOptions.length > 0 && (
              <div className="relative">
                <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}
                  className="appearance-none pl-3 pr-7 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40">
                  <option value="">All locations</option>
                  {locationOptions.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-dark-secondary" />
              </div>
            )}
          </div>

          {/* Date range */}
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-3.5 h-3.5 text-dark-secondary shrink-0" />
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
              title="From date" />
            <span className="text-dark-secondary text-xs">–</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
              title="To date" />
            {(advancedFilterCount > 0 || typeFilter) && (
              <button onClick={clearAdvanced}
                className="text-xs text-dark-secondary hover:text-dark flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 ml-auto">
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>}

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-surface-border p-4 flex gap-3 animate-pulse">
              <div className="flex-1 flex flex-col gap-2">
                <div className="h-3.5 w-1/2 bg-gray-200 rounded" />
                <div className="h-3 w-1/3 bg-gray-100 rounded" />
              </div>
              <div className="h-5 w-16 bg-gray-100 rounded-full self-center" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="py-20 text-center">
          <Inbox className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-dark-secondary text-sm">
            {submissionSearch ? "No submissions match your search." : "No submissions found."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(({ label, items: groupItems }) => (
            <div key={label} className="flex flex-col gap-2">
              {/* Date group header */}
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wider">{label}</p>
                <div className="flex-1 h-px bg-surface-border" />
                <p className="text-xs text-dark-secondary">{groupItems.length}</p>
              </div>
              {/* Cards */}
              {groupItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className="bg-white rounded-xl border border-surface-border px-4 py-3.5 flex items-center gap-3 text-left hover:border-sprout-purple/40 hover:shadow-sm transition-all w-full"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-dark truncate">
                      {item.form_templates?.title ?? "Untitled Form"}
                    </p>
                    <p className="text-xs text-dark-secondary mt-0.5">
                      {item.profiles?.full_name ?? "Unknown user"}
                      {item.submitted_at && (
                        <> · {new Date(item.submitted_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</>
                      )}
                    </p>
                    {(() => {
                      const wfName = item.workflow_stage_instances?.[0]?.workflow_instances?.workflow_definitions?.name;
                      return wfName ? (
                        <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-sprout-purple/10 text-sprout-purple">
                          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>
                          {wfName}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.form_templates?.type && <TypeBadge type={item.form_templates.type as import("@/types").FormType} />}
                    {item.form_templates?.type === "audit" && item.overall_score !== null && (
                      <span className={clsx(
                        "px-2 py-0.5 rounded-full text-xs font-bold",
                        item.passed ? "bg-green-100 text-sprout-green" : "bg-red-100 text-red-500"
                      )}>
                        {Math.round(item.overall_score ?? 0)}%
                      </span>
                    )}
                    <StatusBadge status={item.status} />
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {selectedId && (
        <SubmissionDetailModal
          submissionId={selectedId}
          onClose={() => setSelectedId(null)}
          onReviewed={() => { setSelectedId(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Staff: My Assignments View ─────────────────────────────────────────────────
function MyAssignmentsView() {
  const router = useRouter();
  const [assignments, setAssignments] = useState<FormAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"todo" | "completed">("todo");
  const [search, setSearch] = useState("");

  useEffect(() => {
    getMyAssignments()
      .then(setAssignments)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const todoList      = assignments.filter((a) => !a.completed);
  const completedList = assignments.filter((a) => a.completed);
  const baseList      = tab === "todo" ? todoList : completedList;
  const visibleList   = search
    ? baseList.filter((a) => (a.form_templates?.title ?? "").toLowerCase().includes(search.toLowerCase()))
    : baseList;

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4 md:gap-6">
      {/* Stat cards */}
      {!loading && (
        <div className="grid grid-cols-3 gap-3">
          {([
            { label: "Assigned",  value: assignments.length,  onClick: () => setTab("todo"),      icon: ClipboardList, bg: "bg-sprout-purple/10", color: "text-sprout-purple", active: false        },
            { label: "To Do",     value: todoList.length,     onClick: () => setTab("todo"),      icon: Clock,         bg: "bg-amber-50",         color: "text-amber-500",    active: tab === "todo"       },
            { label: "Completed", value: completedList.length, onClick: () => setTab("completed"), icon: CheckCircle2,  bg: "bg-sprout-green/10",  color: "text-sprout-green", active: tab === "completed"  },
          ]).map(({ label, value, onClick, icon: Icon, bg, color, active }) => (
            <button
              key={label}
              onClick={onClick}
              className={clsx(
                "rounded-xl border p-4 flex flex-col gap-2 text-left transition-all hover:shadow-sm",
                active ? "bg-white border-sprout-purple/50 shadow-sm" : "bg-white border-surface-border hover:border-sprout-purple/30"
              )}
            >
              <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center", bg)}>
                <Icon className={clsx("w-4 h-4", color)} />
              </div>
              <p className="text-xl font-bold text-dark">{value}</p>
              <p className="text-xs text-dark-secondary">{label}</p>
            </button>
          ))}
        </div>
      )}

      {/* Search bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-dark-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          className="border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40"
          placeholder="Search forms…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Tab toggle */}

      {!loading && (
        <div className="flex gap-2">
          <button
            onClick={() => setTab("todo")}
            className={clsx(
              "px-4 py-1.5 rounded-full text-sm font-medium border transition-colors",
              tab === "todo"
                ? "bg-sprout-cyan text-white border-sprout-cyan"
                : "bg-white border-surface-border text-dark-secondary hover:border-sprout-cyan hover:text-sprout-cyan"
            )}
          >
            To Do
            {todoList.length > 0 && (
              <span className={clsx("ml-1.5 text-xs", tab === "todo" ? "opacity-80" : "")}>
                {todoList.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("completed")}
            className={clsx(
              "px-4 py-1.5 rounded-full text-sm font-medium border transition-colors",
              tab === "completed"
                ? "bg-sprout-cyan text-white border-sprout-cyan"
                : "bg-white border-surface-border text-dark-secondary hover:border-sprout-cyan hover:text-sprout-cyan"
            )}
          >
            Completed
            {completedList.length > 0 && (
              <span className={clsx("ml-1.5 text-xs", tab === "completed" ? "opacity-80" : "")}>
                {completedList.length}
              </span>
            )}
          </button>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : visibleList.length === 0 ? (
        <div className="py-16 text-center">
          <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-dark-secondary text-sm">
            {tab === "todo"
              ? assignments.length === 0 ? "No forms assigned to you yet." : "All forms completed — great work!"
              : "No completed forms yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleList.map((a) => {
            const due = new Date(a.due_at);
            const isOverdue = due < now && !a.completed;
            const template = a.form_templates;
            const hasDraft = !!a.has_draft;
            const isCompleted = !!a.completed;

            return (
              <div key={a.id} className={clsx(
                "bg-white rounded-xl border p-5 flex flex-col gap-3 transition-all",
                isCompleted
                  ? "border-sprout-green/30 bg-sprout-green/5"
                  : hasDraft
                    ? "border-sprout-purple/30 shadow-sm"
                    : "border-surface-border"
              )}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-dark text-sm leading-snug">
                      {template?.title ?? "Untitled Form"}
                    </p>
                    {template?.description && (
                      <p className="text-xs text-dark-secondary line-clamp-2 mt-1">{template.description}</p>
                    )}
                  </div>
                  {isCompleted ? (
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold bg-sprout-green/10 text-sprout-green flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Completed
                    </span>
                  ) : hasDraft ? (
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold bg-sprout-purple/10 text-sprout-purple">
                      In Progress
                    </span>
                  ) : null}
                </div>

                <div className="flex gap-2 flex-wrap mt-auto">
                  <TypeBadge type={(template?.type ?? "form") as FormType} />
                  {isCompleted && a.submitted_at ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-sprout-green/10 text-sprout-green">
                      Submitted {new Date(a.submitted_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                    </span>
                  ) : (
                    <span className={clsx(
                      "px-2 py-0.5 rounded-full text-xs font-semibold",
                      isOverdue ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"
                    )}>
                      {isOverdue
                        ? `Overdue — ${due.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`
                        : `Due ${due.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`}
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-dark-secondary capitalize">{a.recurrence}</span>
                </div>

                <button
                  className={clsx(
                    "w-full py-2 rounded-lg text-sm font-medium mt-1 transition-colors",
                    isCompleted
                      ? "border-2 border-sprout-green text-sprout-green hover:bg-sprout-green/5"
                      : hasDraft
                        ? "border-2 border-sprout-purple text-sprout-purple hover:bg-sprout-purple/5"
                        : "bg-sprout-purple text-white hover:bg-sprout-purple/90"
                  )}
                  onClick={() => router.push(
                    isCompleted && a.submission_id
                      ? `/dashboard/forms/fill/${a.id}?sid=${a.submission_id}`
                      : `/dashboard/forms/fill/${a.id}`
                  )}
                >
                  {isCompleted ? "View Submission" : hasDraft ? "Continue" : "Start"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function FormsPage() {
  const searchParams = useSearchParams();
  const { templates, loading, error, typeFilter, fetchTemplates, addTemplate, removeTemplate, setTypeFilter } = useFormStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [prefill, setPrefill] = useState<TemplateFormValues | undefined>(undefined);
  const [selectedTemplate, setSelectedTemplate] = useState<FormTemplate | null>(null);
  const [assignTemplate, setAssignTemplate] = useState<FormTemplate | null>(null);
  const [role, setRole] = useState("staff"); // default to most restrictive
  const [activeTab, setActiveTab] = useState<"my_assignments" | "templates" | "submissions" | "audit_cap">("my_assignments");
  const [templateSearch, setTemplateSearch] = useState("");
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [submissionTotal, setSubmissionTotal] = useState<number | null>(null);
  const [capTotal, setCapTotal] = useState<number | null>(null);

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      const r = data.session?.user?.app_metadata?.role as string | undefined;
      setRole(r ?? "staff");
    });
  }, []);

  useEffect(() => {
    if (role !== "staff") {
      listSubmissions().then(res => setSubmissionTotal(res.total_count)).catch(() => {});
      listCAPs({ page_size: 1 }).then(res => setCapTotal(res.total_count)).catch(() => {});
    }
  }, [role]);

  // Handle deep-links: ?tab=submissions&id=<id>  or  ?tab=my_assignments  or  ?action=create|generate
  useEffect(() => {
    const tab = searchParams.get("tab");
    const id = searchParams.get("id");
    const action = searchParams.get("action");
    const open = searchParams.get("open");
    if (tab === "submissions") {
      setActiveTab("submissions");
      if (id) setDeepLinkSubmissionId(id);
    } else if (tab === "my_assignments") {
      setActiveTab("my_assignments");
    } else if (tab === "audit_cap") {
      setActiveTab("audit_cap");
    } else if (tab === "templates") {
      setActiveTab("templates");
    }
    if (action === "create") {
      setActiveTab("templates");
      setShowCreate(true);
    } else if (action === "generate") {
      setActiveTab("templates");
      setShowGenerate(true);
    }
    if (open) {
      setActiveTab("templates");
      getTemplate(open).then(setSelectedTemplate).catch(console.error);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const [deepLinkSubmissionId, setDeepLinkSubmissionId] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "staff") fetchTemplates();
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Staff see their assignment list instead of the template builder
  if (role === "staff") return <MyAssignmentsView />;

  const handleAiGenerated = (values: TemplateFormValues) => {
    setShowGenerate(false);
    setPrefill(values);
    setShowCreate(true);
  };

  const handleCreateSuccess = (template: FormTemplate) => {
    setShowCreate(false);
    setPrefill(undefined);
    addTemplate(template);   // immediately prepend to list
    fetchTemplates();        // then sync full list from server
    setAssignTemplate(template);
    setJustCreatedId(template.id);
    setTimeout(() => setJustCreatedId(null), 4000);
  };

  const handleUpdated = () => {
    fetchTemplates();
  };

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4 md:gap-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sprout-purple/10 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-sprout-purple" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Forms &amp; Submissions</h1>
            <p className="text-sm text-dark-secondary">Templates, assignments &amp; submissions</p>
          </div>
        </div>
        {activeTab === "templates" && (
          <button onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sprout-purple text-white text-sm font-medium hover:bg-sprout-purple/90">
            <Plus className="w-4 h-4" /><span className="hidden sm:inline"> New Template</span>
          </button>
        )}
      </div>

      {/* Stat cards — each navigates to its tab */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { label: "Templates",   value: templates.length,                          tab: "templates"      as const, icon: LayoutTemplate, bg: "bg-sprout-purple/10", color: "text-sprout-purple" },
          { label: "Active",      value: templates.filter(t => t.is_active).length, tab: "templates"      as const, icon: CheckCircle2,   bg: "bg-sprout-green/10",  color: "text-sprout-green" },
          { label: "Submissions", value: submissionTotal ?? "—",                     tab: "submissions"    as const, icon: Inbox,          bg: "bg-blue-50",          color: "text-blue-600"     },
          { label: "Audit CAP",   value: capTotal ?? "—",                            tab: "audit_cap"      as const, icon: ShieldAlert,    bg: "bg-amber-50",         color: "text-amber-500"    },
        ]).map(({ label, value, tab, icon: Icon, bg, color }) => (
          <button
            key={label}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              "bg-white rounded-xl border p-4 flex flex-col gap-2 text-left transition-all hover:shadow-sm",
              activeTab === tab ? "border-sprout-purple/50 shadow-sm" : "border-surface-border hover:border-sprout-purple/30"
            )}
          >
            <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center", bg)}>
              <Icon className={clsx("w-4 h-4", color)} />
            </div>
            <p className="text-xl md:text-2xl font-bold text-dark">{value}</p>
            <p className="text-xs text-dark-secondary">{label}</p>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-border">
        {([
          { key: "my_assignments", label: "My Assignments", icon: CheckSquare },
          { key: "templates",      label: "Templates",      icon: ClipboardList },
          { key: "submissions",    label: "Submissions",    icon: Inbox },
          { key: "audit_cap",      label: "Audit CAP",      icon: ShieldAlert },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={clsx(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
              activeTab === key
                ? "border-sprout-purple text-sprout-purple"
                : "border-transparent text-dark-secondary hover:text-dark"
            )}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {activeTab === "my_assignments" ? (
        <MyAssignmentsView />
      ) : activeTab === "submissions" ? (
        <SubmissionsTab initialSelectedId={deepLinkSubmissionId} />
      ) : activeTab === "audit_cap" ? (
        <AuditCAPTab />
      ) : (
        <>
          {/* Search bar */}
          <div className="relative max-w-xs">
            <Search className="w-4 h-4 text-dark-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              className="border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40"
              placeholder="Search templates…"
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
            />
          </div>

          {/* Type filter chips */}
          <div className="flex gap-2 flex-wrap">
            {(["", "checklist", "form", "audit", "pull_out"] as const).map((val) => (
              <button key={val} onClick={() => setTypeFilter(val)}
                className={clsx("px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                  typeFilter === val
                    ? "bg-sprout-cyan text-white border-sprout-cyan"
                    : "border-surface-border text-dark-secondary hover:border-sprout-cyan hover:text-sprout-cyan")}>
                {val === "" ? "All" : val === "checklist" ? "Checklist" : val === "audit" ? "Audit" : val === "pull_out" ? "Pull-Out" : "Form"}
              </button>
            ))}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>
          )}

          {/* Grid */}
          {(() => {
            const filteredTemplates = templateSearch
              ? templates.filter((t) => t.title.toLowerCase().includes(templateSearch.toLowerCase()))
              : templates;
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
                ) : filteredTemplates.length === 0 ? (
                  <div className="col-span-full py-16 text-center">
                    <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p className="text-dark-secondary text-sm">
                      {templateSearch ? "No templates match your search." : "No templates yet. Create your first one!"}
                    </p>
                  </div>
                ) : filteredTemplates.map((t) => (
                  <div key={t.id} className={clsx("transition-colors duration-700 rounded-xl", justCreatedId === t.id && "bg-violet-50 ring-1 ring-violet-200")}>
                    <TemplateCard
                      template={t}
                      onView={() => setSelectedTemplate(t)}
                      onAssign={() => setAssignTemplate(t)}
                    />
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      )}

      {/* Modals */}
      {showNewModal && (
        <NewTemplateModal
          onClose={() => setShowNewModal(false)}
          onSelectBlank={() => { setShowNewModal(false); setPrefill(undefined); setShowCreate(true); }}
          onSelectAi={() => { setShowNewModal(false); setShowGenerate(true); }}
          onSelectStarter={(prefillValues) => { setShowNewModal(false); setPrefill(prefillValues); setShowCreate(true); }}
        />
      )}

      {showGenerate && (
        <GenerateModal onClose={() => setShowGenerate(false)} onGenerated={handleAiGenerated} />
      )}

      {showCreate && (
        <CreateTemplateModal
          onClose={() => { setShowCreate(false); setPrefill(undefined); }}
          onSuccess={handleCreateSuccess}
          prefill={prefill}
        />
      )}

      {selectedTemplate && (
        <ModalErrorBoundary>
          <ViewEditModal
            template={selectedTemplate}
            onClose={() => setSelectedTemplate(null)}
            onUpdated={handleUpdated}
            onDelete={async () => {
              try { await deleteTemplate(selectedTemplate.id); removeTemplate(selectedTemplate.id); setSelectedTemplate(null); }
              catch { /* ignore */ }
            }}
          />
        </ModalErrorBoundary>
      )}

      {assignTemplate && (
        <AssignModal
          template={assignTemplate}
          onClose={() => setAssignTemplate(null)}
        />
      )}
    </div>
  );
}


// ── NewTemplateModal ──────────────────────────────────────────────────────────

type FormStarterItem = {
  icon: string;
  name: string;
  type: "form" | "checklist" | "audit" | "pull_out";
  description: string;
  color: string;
  prefillSections?: TemplateFormValues["sections"];
};

const FORM_STARTERS: FormStarterItem[] = [
  { icon: "📋", name: "Daily Store Opening", type: "checklist", description: "Standard opening checklist for staff", color: "bg-blue-50 border-blue-200" },
  { icon: "🍽️", name: "Food Safety Audit", type: "audit", description: "Temperature logs and hygiene checks", color: "bg-green-50 border-green-200" },
  { icon: "🔧", name: "Maintenance Request", type: "form", description: "Equipment issue reporting form", color: "bg-orange-50 border-orange-200" },
  { icon: "👋", name: "Customer Incident Report", type: "form", description: "Customer complaint or incident form", color: "bg-red-50 border-red-200" },
  { icon: "📦", name: "Inventory Count Sheet", type: "checklist", description: "Stock count per product category", color: "bg-purple-50 border-purple-200" },
  { icon: "🆕", name: "Staff Onboarding", type: "checklist", description: "New hire orientation steps", color: "bg-teal-50 border-teal-200" },
];

const FORM_TYPE_ICON: Record<string, string> = {
  form: "📝",
  checklist: "✅",
  audit: "🔍",
  pull_out: "📦",
};
const FORM_TYPE_COLOR: Record<string, string> = {
  form: "bg-purple-50 border-purple-200",
  checklist: "bg-blue-50 border-blue-200",
  audit: "bg-green-50 border-green-200",
  pull_out: "bg-orange-50 border-orange-200",
};

function NewTemplateModal({
  onClose,
  onSelectBlank,
  onSelectAi,
  onSelectStarter,
}: {
  onClose: () => void;
  onSelectBlank: () => void;
  onSelectAi: () => void;
  onSelectStarter: (prefill: TemplateFormValues) => void;
}) {
  const [mode, setMode] = useState<"select" | "template">("select");
  const [starters, setStarters] = useState<FormStarterItem[]>(FORM_STARTERS);

  // Fetch industry-specific form/checklist templates; fall back to generic starters
  useEffect(() => {
    Promise.all([
      getPackageTemplates("form"),
      getPackageTemplates("checklist"),
      getPackageTemplates("pull_out"),
    ]).then(([formsRes, checklistsRes, pullOutsRes]) => {
      const combined = [...formsRes.items, ...checklistsRes.items, ...pullOutsRes.items];
      if (!combined.length) return;
      const mapped: FormStarterItem[] = combined.map((item) => {
        const c = item.content as Record<string, unknown>;
        const formType = ((c.type as string) || item.category) as "form" | "checklist" | "audit" | "pull_out";
        const rawSections = (c.sections as Record<string, unknown>[]) ?? [];
        const prefillSections: TemplateFormValues["sections"] = rawSections.map((sec) => ({
          title: (sec.title as string) ?? "Section",
          fields: ((sec.fields as Record<string, unknown>[]) ?? []).map((f) => ({
            label: (f.label as string) ?? "",
            field_type: ((f.type as string) ?? "text") as FormFieldType,
            is_required: (f.required as boolean) ?? false,
            placeholder: (f.placeholder as string) ?? "",
            options: (f.options as string[]) ?? undefined,
          })),
        })).filter((s) => s.fields.length > 0);
        return {
          icon: FORM_TYPE_ICON[formType] ?? "📄",
          name: item.name,
          type: formType,
          description: item.description,
          color: FORM_TYPE_COLOR[formType] ?? "bg-gray-50 border-gray-200",
          prefillSections: prefillSections.length > 0 ? prefillSections : undefined,
        };
      });
      setStarters(mapped);
    }).catch(() => {});
  }, []);

  const handleStarterClick = (starter: FormStarterItem) => {
    onSelectStarter({
      title: starter.name,
      description: "",
      type: starter.type,
      passing_score: 80,
      sections: starter.prefillSections ?? [],
    } as TemplateFormValues);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-surface-border sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            {mode === "template" && (
              <button onClick={() => setMode("select")} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <ArrowLeft className="w-4 h-4 text-dark/60" />
              </button>
            )}
            <h2 className="text-base font-bold text-dark">New Template</h2>
          </div>
          <button onClick={onClose} className="text-dark/40 hover:text-dark text-2xl leading-none">&times;</button>
        </div>

        {mode === "select" && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-dark/60">How would you like to start?</p>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => setMode("template")}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-surface-border hover:border-sprout-purple hover:shadow-sm transition-all">
                <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-2xl">📋</div>
                <div>
                  <p className="font-semibold text-dark text-xs">From a Starter</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Common retail form starters</p>
                </div>
              </button>
              <button onClick={onSelectAi}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-transparent hover:shadow-sm transition-all"
                style={{ background: 'linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box' }}>
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-sprout-purple" />
                </div>
                <div>
                  <p className="font-semibold text-xs bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate with Sidekick</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Describe it, Sidekick builds the fields</p>
                </div>
              </button>
              <button onClick={onSelectBlank}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-surface-border hover:border-sprout-purple hover:shadow-sm transition-all">
                <div className="w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center text-2xl">➕</div>
                <div>
                  <p className="font-semibold text-dark text-xs">Start Blank</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Build every field yourself</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {mode === "template" && (
          <div className="p-5">
            <p className="text-xs text-dark/50 mb-4">Choose a starter to pre-fill the title and type. You can add all fields in the builder.</p>
            <div className="grid grid-cols-2 gap-3">
              {starters.map((s) => (
                <button key={s.name} onClick={() => handleStarterClick(s)}
                  className={`text-left p-3 rounded-xl border-2 hover:border-sprout-purple/50 hover:shadow-sm transition-all ${s.color}`}>
                  <div className="text-xl mb-1.5">{s.icon}</div>
                  <p className="text-xs font-semibold text-dark">{s.name}</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">{s.description}</p>
                  <p className="text-[10px] font-medium text-dark/40 mt-1.5 capitalize">{s.type}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
