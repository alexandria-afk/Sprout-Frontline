"use client";

import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, ShieldCheck, ToggleLeft, ToggleRight, ChevronDown, ChevronUp } from "lucide-react";
import { apiFetch } from "@/services/api/client";
import { clsx } from "clsx";

interface AuditTemplate {
  id: string;
  title: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  audit_configs?: { passing_score: number }[];
  form_sections?: AuditSection[];
}

interface AuditSection {
  id: string;
  title: string;
  display_order: number;
  audit_section_weights?: { weight: number }[];
  form_fields?: AuditField[];
}

interface AuditField {
  id: string;
  label: string;
  field_type: string;
  is_required: boolean;
  display_order: number;
  audit_field_scores?: { max_score: number }[];
}

const FIELD_TYPES = [
  { value: "yes_no", label: "Yes / No" },
  { value: "boolean", label: "Pass / Fail" },
  { value: "number", label: "Number" },
  { value: "rating", label: "Rating (1–5)" },
  { value: "select", label: "Select" },
  { value: "text", label: "Text" },
  { value: "photo", label: "Photo (evidence)" },
];

export default function AuditTemplatesPage() {
  const [templates, setTemplates] = useState<AuditTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<AuditTemplate | null>(null);

  async function load() {
    try {
      const data = await apiFetch<AuditTemplate[]>("/api/v1/audits/templates");
      setTemplates(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggleActive(t: AuditTemplate) {
    try {
      await apiFetch(`/api/v1/audits/templates/${t.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: !t.is_active }),
      });
      load();
    } catch (e) { console.error(e); }
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this audit template?")) return;
    try {
      await apiFetch(`/api/v1/audits/templates/${id}`, { method: "DELETE" });
      load();
    } catch (e) { console.error(e); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-sprout-purple" />
            Audit Templates
          </h1>
          <p className="text-sm text-dark/50 mt-0.5">Create scored audit templates with section weights and field scores</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowModal(true); }}
          className="flex items-center gap-2 bg-sprout-green text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-sprout-green/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Audit Template
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-20 text-dark/40">
          <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No audit templates yet</p>
          <p className="text-sm mt-1">Create your first audit template to get started</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {templates.map((t) => {
            const passingScore = t.audit_configs?.[0]?.passing_score ?? 80;
            return (
              <div key={t.id} className="bg-white rounded-xl border border-[#E8EDF2] p-5 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-dark truncate">{t.title}</span>
                    <span className={clsx(
                      "text-xs px-2 py-0.5 rounded-full font-medium",
                      t.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                    )}>
                      {t.is_active ? "Active" : "Inactive"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                      Pass ≥ {passingScore}%
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-sm text-dark/50 mt-1 truncate">{t.description}</p>
                  )}
                  <p className="text-xs text-dark/30 mt-1">
                    {t.form_sections?.length ?? 0} sections
                    &nbsp;·&nbsp;
                    {new Date(t.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => toggleActive(t)} className="p-2 rounded-lg hover:bg-gray-50 text-dark/40 hover:text-sprout-green transition-colors">
                    {t.is_active ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                  </button>
                  <button onClick={() => { setEditTarget(t); setShowModal(true); }}
                    className="p-2 rounded-lg hover:bg-gray-50 text-dark/40 hover:text-sprout-purple transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => deleteTemplate(t.id)}
                    className="p-2 rounded-lg hover:bg-red-50 text-dark/40 hover:text-red-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <AuditTemplateModal
          template={editTarget}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Audit Template Modal (Create / Edit)
// ─────────────────────────────────────────────────────────────────────────────

interface SectionDraft {
  id?: string;
  title: string;
  weight: number;
  fields: FieldDraft[];
  collapsed: boolean;
}

interface FieldDraft {
  id?: string;
  label: string;
  field_type: string;
  is_required: boolean;
  max_score: number;
  display_order: number;
}

function AuditTemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: AuditTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [passingScore, setPassingScore] = useState(template?.audit_configs?.[0]?.passing_score ?? 80);
  const [sections, setSections] = useState<SectionDraft[]>(() => {
    if (!template?.form_sections) return [{ title: "Section 1", weight: 1.0, fields: [], collapsed: false }];
    return template.form_sections.map((s) => ({
      id: s.id,
      title: s.title,
      weight: s.audit_section_weights?.[0]?.weight ?? 1.0,
      collapsed: false,
      fields: (s.form_fields ?? []).map((f, i) => ({
        id: f.id,
        label: f.label,
        field_type: f.field_type,
        is_required: f.is_required,
        max_score: f.audit_field_scores?.[0]?.max_score ?? 1.0,
        display_order: i,
      })),
    }));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function addSection() {
    setSections((prev) => [...prev, {
      title: `Section ${prev.length + 1}`,
      weight: 1.0,
      fields: [],
      collapsed: false,
    }]);
  }

  function removeSection(idx: number) {
    setSections((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateSection(idx: number, patch: Partial<SectionDraft>) {
    setSections((prev) => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }

  function addField(sectionIdx: number) {
    setSections((prev) => prev.map((s, i) =>
      i === sectionIdx
        ? { ...s, fields: [...s.fields, { label: "", field_type: "yes_no", is_required: true, max_score: 1.0, display_order: s.fields.length }] }
        : s
    ));
  }

  function updateField(sectionIdx: number, fieldIdx: number, patch: Partial<FieldDraft>) {
    setSections((prev) => prev.map((s, si) =>
      si === sectionIdx
        ? { ...s, fields: s.fields.map((f, fi) => fi === fieldIdx ? { ...f, ...patch } : f) }
        : s
    ));
  }

  function removeField(sectionIdx: number, fieldIdx: number) {
    setSections((prev) => prev.map((s, si) =>
      si === sectionIdx ? { ...s, fields: s.fields.filter((_, fi) => fi !== fieldIdx) } : s
    ));
  }

  async function handleSave() {
    if (!title.trim()) { setError("Template title is required"); return; }
    setSaving(true);
    setError("");

    const body = {
      title,
      description: description || null,
      passing_score: passingScore,
      sections: sections.map((s, si) => ({
        ...(s.id ? { id: s.id } : {}),
        title: s.title,
        display_order: si,
        fields: s.fields.map((f, fi) => ({
          ...(f.id ? { id: f.id } : {}),
          label: f.label,
          field_type: f.field_type,
          is_required: f.is_required,
          display_order: fi,
        })),
      })),
      section_weights: sections
        .filter((s) => s.id)
        .map((s) => ({ section_id: s.id, weight: s.weight })),
      field_scores: sections.flatMap((s) =>
        s.fields
          .filter((f) => f.id)
          .map((f) => ({ field_id: f.id, max_score: f.max_score }))
      ),
    };

    try {
      if (template) {
        await apiFetch(`/api/v1/audits/templates/${template.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch("/api/v1/audits/templates", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      onSaved();
    } catch (e: any) {
      setError(e.message || "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#E8EDF2]">
          <h2 className="text-lg font-bold text-dark">
            {template ? "Edit Audit Template" : "New Audit Template"}
          </h2>
          <button onClick={onClose} className="text-dark/40 hover:text-dark text-2xl leading-none">&times;</button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
          )}

          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-dark/60 mb-1.5">Template Title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
                placeholder="e.g. Food Safety Inspection" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-dark/60 mb-1.5">Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
                placeholder="Optional description" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-dark/60 mb-1.5">Passing Score (%)</label>
              <input type="number" min={0} max={100} value={passingScore}
                onChange={(e) => setPassingScore(parseFloat(e.target.value) || 80)}
                className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30" />
            </div>
          </div>

          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-dark">Sections</h3>
              <button onClick={addSection}
                className="text-xs text-sprout-purple font-medium flex items-center gap-1 hover:underline">
                <Plus className="w-3.5 h-3.5" /> Add Section
              </button>
            </div>
            <div className="space-y-3">
              {sections.map((section, si) => (
                <div key={si} className="border border-[#E8EDF2] rounded-xl overflow-hidden">
                  {/* Section header */}
                  <div className="flex items-center gap-3 px-4 py-3 bg-gray-50">
                    <input value={section.title} onChange={(e) => updateSection(si, { title: e.target.value })}
                      className="flex-1 bg-transparent text-sm font-medium text-dark focus:outline-none" />
                    <div className="flex items-center gap-1.5 text-xs text-dark/50">
                      <span>Weight:</span>
                      <input type="number" step="0.1" min="0.1" value={section.weight}
                        onChange={(e) => updateSection(si, { weight: parseFloat(e.target.value) || 1.0 })}
                        className="w-16 border border-[#E8EDF2] rounded px-2 py-1 text-xs focus:outline-none" />
                    </div>
                    <button onClick={() => updateSection(si, { collapsed: !section.collapsed })}
                      className="text-dark/40 hover:text-dark">
                      {section.collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </button>
                    {sections.length > 1 && (
                      <button onClick={() => removeSection(si)} className="text-red-400 hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Fields */}
                  {!section.collapsed && (
                    <div className="p-4 space-y-2">
                      {section.fields.map((field, fi) => (
                        <div key={fi} className="flex items-center gap-2">
                          <input value={field.label} onChange={(e) => updateField(si, fi, { label: e.target.value })}
                            className="flex-1 border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
                            placeholder="Field label" />
                          <select value={field.field_type} onChange={(e) => updateField(si, fi, { field_type: e.target.value })}
                            className="border border-[#E8EDF2] rounded-lg px-2 py-2 text-xs focus:outline-none">
                            {FIELD_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                          {field.field_type !== "photo" && field.field_type !== "text" && (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-dark/40">Max:</span>
                              <input type="number" step="0.5" min="0" value={field.max_score}
                                onChange={(e) => updateField(si, fi, { max_score: parseFloat(e.target.value) || 1.0 })}
                                className="w-14 border border-[#E8EDF2] rounded px-2 py-1.5 text-xs focus:outline-none" />
                            </div>
                          )}
                          <label className="flex items-center gap-1 text-xs text-dark/50 cursor-pointer">
                            <input type="checkbox" checked={field.is_required}
                              onChange={(e) => updateField(si, fi, { is_required: e.target.checked })}
                              className="rounded" />
                            Req
                          </label>
                          <button onClick={() => removeField(si, fi)} className="text-red-400 hover:text-red-600 p-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <button onClick={() => addField(si)}
                        className="text-xs text-sprout-purple font-medium flex items-center gap-1 mt-2 hover:underline">
                        <Plus className="w-3.5 h-3.5" /> Add Field
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#E8EDF2]">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-dark/60 hover:text-dark transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-sprout-green text-white text-sm font-medium rounded-lg hover:bg-sprout-green/90 disabled:opacity-50 transition-colors">
            {saving ? "Saving…" : template ? "Save Changes" : "Create Template"}
          </button>
        </div>
      </div>
    </div>
  );
}
