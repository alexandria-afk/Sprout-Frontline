"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import clsx from "clsx";
import { BookOpen, Plus, Trash2, ExternalLink, FileText, ChevronLeft, Sparkles, Loader2 } from "lucide-react";
import {
  listRepairGuides,
  getRepairGuide,
  createRepairGuide,
  deleteRepairGuide,
  listAssets,
} from "@/services/maintenance";
import { listIssueCategories } from "@/services/issues";
import { createClient } from "@/services/supabase/client";
import { friendlyError } from "@/lib/errors";
import type { RepairGuide, Asset, IssueCategory } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls =
  "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-dark">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

type GuideType = "pdf" | "video" | "audio" | "text";

function GuideTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    pdf: "bg-red-100 text-red-700",
    video: "bg-purple-100 text-purple-700",
    audio: "bg-blue-100 text-blue-700",
    text: "bg-green-100 text-green-700",
  };
  return (
    <span className={clsx("px-2 py-0.5 rounded-full text-xs font-semibold uppercase", map[type] ?? "bg-gray-100 text-gray-600")}>
      {type}
    </span>
  );
}

// ── TextViewModal ─────────────────────────────────────────────────────────────

function TextViewModal({
  guide,
  onClose,
}: {
  guide: RepairGuide;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(guide.content ?? null);
  const [loading, setLoading] = useState(!guide.content);

  useEffect(() => {
    if (!guide.content) {
      getRepairGuide(guide.id)
        .then((g) => setContent(g.content))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [guide]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 flex flex-col gap-4 max-h-[80vh]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-dark">{guide.title}</h2>
          <button onClick={onClose} className="text-dark-secondary hover:text-dark text-sm px-3 py-1 rounded-lg border border-surface-border hover:bg-gray-50">
            Close
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="h-32 bg-gray-100 rounded animate-pulse" />
          ) : content ? (
            <pre className="text-sm text-dark whitespace-pre-wrap font-sans leading-relaxed">{content}</pre>
          ) : (
            <p className="text-dark-secondary text-sm">No content available.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── UploadGuideModal ──────────────────────────────────────────────────────────

function UploadGuideModal({
  assets,
  categories,
  onClose,
  onSuccess,
  initialTitle,
  initialContent,
}: {
  assets: Asset[];
  categories: IssueCategory[];
  onClose: () => void;
  onSuccess: (guide: RepairGuide) => void;
  initialTitle?: string;
  initialContent?: string;
}) {
  const [form, setForm] = useState({
    title: initialTitle ?? "",
    guide_type: "text" as GuideType,
    asset_id: "",
    category_id: "",
    content: initialContent ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (form.guide_type !== "text" && !file) { setError("Please select a file."); return; }
    setError("");
    setLoading(true);
    try {
      const created = await createRepairGuide({
        title: form.title.trim(),
        guide_type: form.guide_type,
        asset_id: form.asset_id || undefined,
        category_id: form.category_id || undefined,
        content: form.guide_type === "text" ? form.content || undefined : undefined,
        file: form.guide_type !== "text" && file ? file : undefined,
      });
      onSuccess(created);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-dark">Upload Guide</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Title *">
            <input className={inputCls} value={form.title} onChange={set("title")} placeholder="How to reset HVAC unit" />
          </Field>
          <Field label="Guide Type">
            <select
              className={clsx(inputCls, "bg-white")}
              value={form.guide_type}
              onChange={(e) => setForm((p) => ({ ...p, guide_type: e.target.value as GuideType }))}
            >
              <option value="text">Text</option>
              <option value="pdf">PDF</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
            </select>
          </Field>
          <Field label="Asset (optional)">
            <select className={clsx(inputCls, "bg-white")} value={form.asset_id} onChange={set("asset_id")}>
              <option value="">— None —</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Category (optional)">
            <select className={clsx(inputCls, "bg-white")} value={form.category_id} onChange={set("category_id")}>
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          {form.guide_type === "text" ? (
            <Field label="Content">
              <textarea
                className={clsx(inputCls, "resize-none")}
                rows={6}
                value={form.content}
                onChange={set("content")}
                placeholder="Step-by-step instructions..."
              />
            </Field>
          ) : (
            <Field label="File *">
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept={
                    form.guide_type === "pdf"
                      ? ".pdf"
                      : form.guide_type === "video"
                      ? "video/*"
                      : "audio/*"
                  }
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="px-3 py-2 text-sm border border-surface-border rounded-lg hover:bg-gray-50 text-dark"
                >
                  {file ? file.name : "Choose file…"}
                </button>
                {file && (
                  <button
                    type="button"
                    onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                    className="text-xs text-dark-secondary hover:text-red-500"
                  >
                    Remove
                  </button>
                )}
              </div>
            </Field>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {loading ? "Uploading…" : "Upload Guide"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── GenerateGuideModal ────────────────────────────────────────────────────────

function GenerateGuideModal({
  onClose,
  onGenerated,
}: {
  onClose: () => void;
  onGenerated: (title: string, content: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) { setError("Please describe the issue or asset."); return; }
    setError("");
    setLoading(true);
    try {
      const { apiFetch } = await import("@/services/api/client");
      const result = await apiFetch<{ title: string; content: string }>("/api/v1/ai/generate-repair-guide", {
        method: "POST",
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      onGenerated(result.title, result.content);
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

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-sprout-purple" />
          <h2 className="text-lg font-semibold bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate Repair Guide with Sidekick</h2>
        </div>
        <p className="text-sm text-dark-secondary">
          Describe the issue or asset and Claude will generate a step-by-step repair guide in markdown.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-dark">Describe the issue or asset *</label>
          <textarea
            className={clsx(inputCls, "resize-none")}
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Air conditioning unit in the stockroom is leaking water"
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
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function GuidesPage() {
  const [guides, setGuides] = useState<RepairGuide[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<IssueCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [generatePrefill, setGeneratePrefill] = useState<{ title: string; content: string } | undefined>(undefined);
  const [viewGuide, setViewGuide] = useState<RepairGuide | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [filterAsset, setFilterAsset] = useState("");
  const [filterType, setFilterType] = useState("");
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listRepairGuides({
        asset_id: filterAsset || undefined,
      });
      const filtered = filterType
        ? res.data.filter((g) => g.guide_type === filterType)
        : res.data;
      setGuides(filtered);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        const role = data.session?.user?.app_metadata?.role as string | undefined;
        setIsAdmin(role === "admin" || role === "super_admin");
      });
    Promise.all([listAssets(), listIssueCategories()])
      .then(([aRes, cRes]) => {
        setAssets(aRes.data);
        setCategories(cRes.data);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [filterAsset, filterType]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleView = async (guide: RepairGuide) => {
    if (guide.guide_type === "text") {
      setViewGuide(guide);
      return;
    }
    // For file-based guides, fetch to get signed URL then open in new tab
    try {
      const full = await getRepairGuide(guide.id);
      if (full.file_url) window.open(full.file_url, "_blank", "noopener");
    } catch {
      /* no-op */
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await deleteRepairGuide(deleteId);
      setGuides((p) => p.filter((g) => g.id !== deleteId));
      setDeleteId(null);
    } catch {
      /* keep */
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      <div className="max-w-[1600px] mx-auto w-full flex flex-col gap-4 md:gap-6">
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
          <BookOpen className="w-6 h-6 text-sprout-purple" />
          <div>
            <h1 className="text-2xl font-bold text-dark">Repair Guides</h1>
            <p className="text-sm text-dark-secondary">{guides.length} guides</p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGenerate(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-transparent text-sm font-medium hover:shadow-sm transition-all"
              style={{ background: 'linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box', color: '#7C3AED' }}
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate with Sidekick</span>
            </button>
            <button
              onClick={() => setShowUpload(true)}
              className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Upload Guide
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          className="border border-surface-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sprout-purple/40"
          value={filterAsset}
          onChange={(e) => setFilterAsset(e.target.value)}
        >
          <option value="">All Assets</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select
          className="border border-surface-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sprout-purple/40"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">All Types</option>
          <option value="pdf">PDF</option>
          <option value="video">Video</option>
          <option value="audio">Audio</option>
          <option value="text">Text</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-surface-border p-4 animate-pulse h-32" />
          ))}
        </div>
      ) : guides.length === 0 ? (
        <div className="bg-white rounded-2xl border border-surface-border p-10 flex flex-col items-center gap-6">
          <div className="text-center">
            <h3 className="text-base font-semibold text-dark">No repair guides yet</h3>
            <p className="text-sm text-dark-secondary mt-1">How would you like to create your first guide?</p>
          </div>
          {isAdmin && (
            <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
              <button
                onClick={() => setShowGenerate(true)}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-transparent hover:shadow-sm transition-all"
                style={{ background: 'linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box' }}>
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-sprout-purple" />
                </div>
                <div>
                  <p className="font-semibold text-xs bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate with Sidekick</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">Describe the issue, Sidekick writes the guide</p>
                </div>
              </button>
              <button
                onClick={() => setShowUpload(true)}
                className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl border-2 border-surface-border hover:border-sprout-purple hover:shadow-sm transition-all">
                <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-dark text-xs">Upload a File</p>
                  <p className="text-[11px] text-dark/50 mt-0.5 leading-snug">PDF, Word, or Markdown file</p>
                </div>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {guides.map((guide) => (
            <div key={guide.id} className={clsx("bg-white rounded-2xl border p-4 flex flex-col gap-3 transition-colors duration-700", justCreatedId === guide.id ? "border-violet-200 bg-violet-50" : "border-surface-border")}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-dark text-sm truncate">{guide.title}</p>
                  <p className="text-xs text-dark-secondary mt-0.5">
                    {guide.assets?.name ?? guide.issue_categories?.name ?? "General"}
                  </p>
                </div>
                <GuideTypeBadge type={guide.guide_type} />
              </div>
              <div className="flex items-center gap-2 mt-auto pt-1">
                <button
                  onClick={() => handleView(guide)}
                  className="flex items-center gap-1.5 bg-sprout-purple text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-sprout-purple/90 flex-1 justify-center"
                >
                  {guide.guide_type === "text" ? (
                    <>
                      <FileText className="w-3.5 h-3.5" /> View Guide
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-3.5 h-3.5" /> View Guide
                    </>
                  )}
                </button>
                {isAdmin && (
                  <>
                    {deleteId === guide.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleDelete}
                          disabled={deleteLoading}
                          className="text-xs text-red-600 font-medium hover:underline px-1"
                        >
                          Delete?
                        </button>
                        <button
                          onClick={() => setDeleteId(null)}
                          className="text-xs text-dark-secondary hover:underline px-1"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteId(guide.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showGenerate && (
        <GenerateGuideModal
          onClose={() => setShowGenerate(false)}
          onGenerated={(title, content) => {
            setShowGenerate(false);
            setGeneratePrefill({ title, content });
            setShowUpload(true);
          }}
        />
      )}
      {showUpload && (
        <UploadGuideModal
          assets={assets}
          categories={categories}
          onClose={() => { setShowUpload(false); setGeneratePrefill(undefined); }}
          onSuccess={(guide) => {
            setShowUpload(false);
            setGeneratePrefill(undefined);
            setJustCreatedId(guide.id);
            setTimeout(() => setJustCreatedId(null), 4000);
            load();
          }}
          initialTitle={generatePrefill?.title}
          initialContent={generatePrefill?.content}
        />
      )}
      {viewGuide && (
        <TextViewModal
          guide={viewGuide}
          onClose={() => setViewGuide(null)}
        />
      )}
      </div>
    </div>
  );
}
