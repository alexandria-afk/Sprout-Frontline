"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import clsx from "clsx";
import {
  ArrowLeft, ShieldAlert, CheckCircle2, XCircle, Clock, Loader2,
  AlertTriangle, ChevronDown, ChevronRight, Flag, User, Calendar,
  X, ClipboardList, ExternalLink, Download,
} from "lucide-react";
import { getCAP, updateCAPItem, confirmCAP, dismissCAP } from "@/services/caps";
import { listUsers } from "@/services/users";
import { friendlyError } from "@/lib/errors";
import type { CAP, CAPItem, CAPStatus, FollowupType, Profile } from "@/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<CAPStatus, string> = {
  pending_review: "Pending Review",
  in_review: "In Review",
  confirmed: "Confirmed",
  dismissed: "Dismissed",
};

const STATUS_COLORS: Record<CAPStatus, string> = {
  pending_review: "bg-amber-100 text-amber-700",
  in_review: "bg-blue-100 text-blue-700",
  confirmed: "bg-sprout-green/10 text-sprout-green",
  dismissed: "bg-gray-100 text-gray-500",
};

const PRIORITY_OPTIONS = ["low", "medium", "high", "critical"] as const;
const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const TYPE_OPTIONS: { value: FollowupType; label: string; enabled: boolean }[] = [
  { value: "task", label: "Task", enabled: true },
  { value: "issue", label: "Issue (coming soon)", enabled: false },
  { value: "incident", label: "Incident (coming soon)", enabled: false },
  { value: "none", label: "Skip", enabled: true },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatResponseValue(val: string) {
  if (val === "false") return "No";
  if (val === "true") return "Yes";
  return val.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Item Card ────────────────────────────────────────────────────────────────

function CAPItemCard({
  item, capId, editable, users, onUpdated,
}: {
  item: CAPItem;
  capId: string;
  editable: boolean;
  users: Profile[];
  onUpdated: () => void;
}) {
  const [type, setType] = useState<FollowupType>(item.followup_type ?? item.suggested_followup_type);
  const [title, setTitle] = useState(item.followup_title ?? item.suggested_title ?? "");
  const [desc, setDesc] = useState(item.followup_description ?? item.suggested_description ?? "");
  const [priority, setPriority] = useState(item.followup_priority ?? item.suggested_priority ?? "medium");
  const [assignee, setAssignee] = useState(item.followup_assignee_id ?? item.suggested_assignee_id ?? "");
  const [dueAt, setDueAt] = useState(item.followup_due_at?.slice(0, 10) ?? "");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const skipped = type === "none";

  const save = useCallback(async (updates: Record<string, unknown>) => {
    setSaving(true);
    try {
      await updateCAPItem(capId, item.id, updates as any);
      onUpdated();
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }, [capId, item.id, onUpdated]);

  return (
    <div className={clsx(
      "border rounded-xl p-4 transition-all",
      skipped ? "border-gray-200 bg-gray-50 opacity-60" : item.is_critical ? "border-red-200 bg-red-50/30" : "border-surface-border bg-white"
    )}>
      {/* Header row */}
      <div className="flex items-start gap-3">
        <button onClick={() => setExpanded(!expanded)} className="mt-0.5 text-dark-secondary">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm text-dark">{item.field_label}</p>
            {item.is_critical && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-xs font-semibold">
                <ShieldAlert className="w-3 h-3" /> Critical
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-dark-secondary">
            <span className="font-medium text-red-600">{formatResponseValue(item.response_value)}</span>
            {item.score_awarded != null && item.max_score != null && (
              <span>Score: {item.score_awarded}/{item.max_score}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={clsx("text-xs font-medium px-2 py-0.5 rounded-full", PRIORITY_COLORS[priority] ?? "bg-gray-100 text-gray-600")}>
            {priority}
          </span>
          {saving && <Loader2 className="w-3 h-3 animate-spin text-sprout-purple" />}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-3 pl-7 flex flex-col gap-3">
          {/* Spawned task link (if confirmed) */}
          {item.spawned_task_id && (
            <a
              href={`/dashboard/tasks`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-sprout-green bg-sprout-green/5 px-3 py-1.5 rounded-lg hover:bg-sprout-green/10 w-fit"
            >
              <ExternalLink className="w-3 h-3" /> View auto-created task
            </a>
          )}

          {editable ? (
            <>
              {/* Type selector */}
              <div>
                <label className="text-xs font-medium text-dark-secondary mb-1 block">Follow-up Type</label>
                <div className="flex gap-2 flex-wrap">
                  {TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      disabled={!opt.enabled}
                      onClick={() => { setType(opt.value); save({ followup_type: opt.value }); }}
                      className={clsx(
                        "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                        type === opt.value
                          ? opt.value === "none"
                            ? "bg-gray-200 text-gray-600 border-gray-300"
                            : "bg-sprout-purple text-white border-sprout-purple"
                          : opt.enabled
                            ? "bg-white text-dark-secondary border-surface-border hover:border-sprout-purple/30"
                            : "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {!skipped && (
                <>
                  {/* Title */}
                  <div>
                    <label className="text-xs font-medium text-dark-secondary mb-1 block">Title</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onBlur={() => save({ followup_title: title })}
                      className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/40"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-xs font-medium text-dark-secondary mb-1 block">Description</label>
                    <textarea
                      rows={2}
                      value={desc}
                      onChange={(e) => setDesc(e.target.value)}
                      onBlur={() => save({ followup_description: desc })}
                      className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Priority */}
                    <div>
                      <label className="text-xs font-medium text-dark-secondary mb-1 block">Priority</label>
                      <select
                        value={priority}
                        onChange={(e) => { setPriority(e.target.value); save({ followup_priority: e.target.value }); }}
                        className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 bg-white"
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                        ))}
                      </select>
                    </div>

                    {/* Assignee */}
                    <div>
                      <label className="text-xs font-medium text-dark-secondary mb-1 block">Assignee</label>
                      <select
                        value={assignee}
                        onChange={(e) => { setAssignee(e.target.value); save({ followup_assignee_id: e.target.value || undefined }); }}
                        className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 bg-white"
                      >
                        <option value="">Unassigned</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>{u.full_name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Due date */}
                    <div>
                      <label className="text-xs font-medium text-dark-secondary mb-1 block">Due Date</label>
                      <input
                        type="date"
                        value={dueAt}
                        onChange={(e) => { setDueAt(e.target.value); save({ followup_due_at: e.target.value ? new Date(e.target.value).toISOString() : undefined }); }}
                        className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 bg-white"
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            /* Read-only view */
            <div className="flex flex-wrap gap-3 text-xs text-dark-secondary">
              {!skipped && (
                <>
                  <span className="flex items-center gap-1"><ClipboardList className="w-3 h-3" />{type}</span>
                  <span className="flex items-center gap-1"><Flag className="w-3 h-3" />{priority}</span>
                  {dueAt && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(dueAt)}</span>}
                </>
              )}
              {skipped && <span className="italic">Skipped</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Dismiss Modal ────────────────────────────────────────────────────────────

function DismissModal({ onDismiss, onClose }: { onDismiss: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-dark">Dismiss CAP</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-dark-secondary" /></button>
        </div>
        <p className="text-sm text-dark-secondary mb-3">Provide a reason for dismissing this corrective action plan.</p>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for dismissal…"
          className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 resize-none mb-4"
        />
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-dark-secondary border border-surface-border rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => reason.trim() && onDismiss(reason.trim())}
            disabled={!reason.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function CAPDetailPage() {
  const params = useParams();
  const router = useRouter();
  const capId = params.id as string;

  const [cap, setCap] = useState<CAP | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<Profile[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [showDismiss, setShowDismiss] = useState(false);
  const [result, setResult] = useState<{ tasks_created: number; items_skipped: number } | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [c, u] = await Promise.all([
        getCAP(capId),
        listUsers().then((r) => r.items ?? r).catch(() => []),
      ]);
      setCap(c);
      setUsers(u as Profile[]);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [capId]);

  useEffect(() => { load(); }, [load]);

  const editable = cap?.status === "pending_review" || cap?.status === "in_review";

  // Group items by section (using field info from template)
  const groupedItems = (() => {
    if (!cap?.cap_items) return [];
    const sections = cap.form_submissions?.form_templates?.form_sections ?? [];
    const fieldToSection: Record<string, { section_id: string; title: string; order: number }> = {};
    for (const s of sections as any[]) {
      for (const f of (s.form_fields ?? [])) {
        fieldToSection[f.id] = { section_id: s.id, title: s.title, order: s.display_order ?? 0 };
      }
    }
    const groups: Record<string, { title: string; order: number; items: CAPItem[] }> = {};
    for (const item of cap.cap_items) {
      const sec = fieldToSection[item.field_id];
      const key = sec?.section_id ?? "unknown";
      if (!groups[key]) groups[key] = { title: sec?.title ?? "General", order: sec?.order ?? 999, items: [] };
      groups[key].items.push(item);
    }
    return Object.values(groups).sort((a, b) => a.order - b.order);
  })();

  const handleConfirm = async () => {
    if (!cap) return;
    setConfirming(true);
    try {
      const res = await confirmCAP(cap.id);
      setResult(res);
      await load();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setConfirming(false);
    }
  };

  const handleDismiss = async (reason: string) => {
    if (!cap) return;
    setShowDismiss(false);
    try {
      await dismissCAP(cap.id, reason);
      await load();
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  const handleDownloadPdf = async () => {
    if (!cap) return;
    setDownloadingPdf(true);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
      const { createClient } = await import("@/services/supabase/client");
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`${API_BASE}/api/v1/caps/${cap.id}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { alert("PDF export failed"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cap-${cap.id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("PDF export failed");
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-6 h-6 text-sprout-purple animate-spin" />
      </div>
    );
  }

  if (error || !cap) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-2" />
        <p className="text-dark-secondary text-sm">{error || "CAP not found"}</p>
        <button onClick={() => router.back()} className="mt-4 text-sm text-sprout-purple hover:underline">Go back</button>
      </div>
    );
  }

  const sub = cap.form_submissions;
  const scorePct = sub?.overall_score != null ? Math.round(sub.overall_score) : null;

  return (
    <div className="p-4 md:p-8 flex flex-col gap-6 max-w-3xl mx-auto w-full pb-32">
      {/* Back + Header */}
      <button onClick={() => router.push("/dashboard/audits/caps")} className="flex items-center gap-1 text-sm text-dark-secondary hover:text-dark w-fit">
        <ArrowLeft className="w-4 h-4" /> Back to CAPs
      </button>

      <div className="bg-white rounded-xl border border-surface-border p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-dark">{sub?.form_templates?.title ?? "Audit"}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-dark-secondary flex-wrap">
              {cap.locations?.name && <span>{cap.locations.name}</span>}
              {sub?.submitted_at && <span>Submitted {formatDate(sub.submitted_at)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {scorePct != null && (
              <span className={clsx(
                "text-lg font-bold px-3 py-1 rounded-lg",
                sub?.passed ? "bg-sprout-green/10 text-sprout-green" : "bg-red-50 text-red-600"
              )}>
                {scorePct}%
              </span>
            )}
            <span className={clsx("px-2.5 py-1 rounded-full text-xs font-medium", STATUS_COLORS[cap.status])}>
              {STATUS_LABELS[cap.status]}
            </span>
            <button
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-dark-secondary border border-surface-border rounded-lg hover:bg-gray-50 disabled:opacity-60 transition-colors"
            >
              {downloadingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Download PDF
            </button>
          </div>
        </div>
        {cap.dismissed_reason && (
          <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-dark-secondary">
            <span className="font-medium">Dismissed:</span> {cap.dismissed_reason}
          </div>
        )}
      </div>

      {/* Success result */}
      {result && (
        <div className="bg-sprout-green/10 border border-sprout-green/20 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-sprout-green shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-dark">CAP confirmed</p>
            <p className="text-xs text-dark-secondary mt-1">
              {result.tasks_created} task{result.tasks_created !== 1 ? "s" : ""} created.
              {result.items_skipped > 0 && ` ${result.items_skipped} item${result.items_skipped !== 1 ? "s" : ""} skipped.`}
            </p>
          </div>
        </div>
      )}

      {/* Items grouped by section */}
      {groupedItems.map((group) => (
        <div key={group.title}>
          <h2 className="text-sm font-semibold text-dark mb-3 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-sprout-purple" />
            {group.title}
            <span className="text-xs text-dark-secondary font-normal">({group.items.length} item{group.items.length !== 1 ? "s" : ""})</span>
          </h2>
          <div className="flex flex-col gap-3">
            {group.items.map((item) => (
              <CAPItemCard
                key={item.id}
                item={item}
                capId={cap.id}
                editable={editable}
                users={users}
                onUpdated={load}
              />
            ))}
          </div>
        </div>
      ))}

      {cap.cap_items?.length === 0 && (
        <p className="text-center text-sm text-dark-secondary py-10">No items in this CAP.</p>
      )}

      {/* Bottom sticky bar */}
      {editable && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-surface-border">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <button
              onClick={() => setShowDismiss(true)}
              className="px-4 py-2.5 text-sm font-medium text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition-colors"
            >
              Dismiss
            </button>
            <button
              onClick={handleConfirm}
              disabled={confirming}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-sprout-purple rounded-xl hover:bg-sprout-purple/90 disabled:opacity-60 flex items-center gap-2"
            >
              {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirm All
            </button>
          </div>
        </div>
      )}

      {showDismiss && (
        <DismissModal onDismiss={handleDismiss} onClose={() => setShowDismiss(false)} />
      )}
    </div>
  );
}
