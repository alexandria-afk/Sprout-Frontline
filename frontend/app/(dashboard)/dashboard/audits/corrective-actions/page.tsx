"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, Filter, ChevronDown } from "lucide-react";
import { apiFetch } from "@/services/api/client";
import { clsx } from "clsx";

interface CAP {
  id: string;
  description: string;
  status: "open" | "in_progress" | "resolved";
  due_at?: string;
  resolved_at?: string;
  resolution_note?: string;
  assigned_to?: string;
  created_at: string;
  form_submissions?: { form_templates?: { title: string } };
  profiles?: { full_name: string; email: string };
}

const STATUS_OPTIONS = [
  { value: "open", label: "Open", color: "bg-amber-100 text-amber-700" },
  { value: "in_progress", label: "In Progress", color: "bg-blue-100 text-blue-700" },
  { value: "resolved", label: "Resolved", color: "bg-green-100 text-green-700" },
];

export default function CAPTrackerPage() {
  const [caps, setCaps] = useState<CAP[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const data = await apiFetch<CAP[]>(`/api/v1/corrective-actions/?${params}`);
      setCaps(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [statusFilter]);

  async function updateStatus(id: string, status: string) {
    setUpdating(id);
    try {
      await apiFetch(`/api/v1/corrective-actions/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setUpdating(null);
    }
  }

  async function saveResolution(id: string, resolution_note: string) {
    setUpdating(id);
    try {
      await apiFetch(`/api/v1/corrective-actions/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status: "resolved", resolution_note }),
      });
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setUpdating(null);
    }
  }

  const totalOpen = caps.filter((c) => c.status === "open").length;
  const totalInProgress = caps.filter((c) => c.status === "in_progress").length;
  const totalResolved = caps.filter((c) => c.status === "resolved").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-dark flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          Corrective Action Plans
        </h1>
        <p className="text-sm text-dark/50 mt-0.5">Track and resolve failed audit items</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Open", count: totalOpen, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "In Progress", count: totalInProgress, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Resolved", count: totalResolved, color: "text-green-600", bg: "bg-green-50" },
        ].map(({ label, count, color, bg }) => (
          <div key={label} className={clsx("rounded-xl p-4", bg)}>
            <p className={clsx("text-2xl font-bold", color)}>{count}</p>
            <p className="text-sm text-dark/60 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-dark/40" />
        {["all", "open", "in_progress", "resolved"].map((f) => (
          <button key={f} onClick={() => setStatusFilter(f)}
            className={clsx(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
              statusFilter === f
                ? "bg-sprout-navy text-white"
                : "bg-gray-100 text-dark/60 hover:bg-gray-200"
            )}>
            {f === "all" ? "All" : f.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : caps.length === 0 ? (
        <div className="text-center py-20 text-dark/40">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No corrective actions</p>
        </div>
      ) : (
        <div className="space-y-3">
          {caps.map((cap) => {
            const isExpanded = expandedId === cap.id;
            const statusOpt = STATUS_OPTIONS.find((s) => s.value === cap.status);
            const isOverdue = cap.due_at && cap.status !== "resolved" && new Date(cap.due_at) < new Date();

            return (
              <div key={cap.id} className={clsx(
                "bg-white rounded-xl border transition-all",
                isOverdue ? "border-red-200" : "border-[#E8EDF2]"
              )}>
                <div className="flex items-center gap-3 p-4 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : cap.id)}>
                  {/* Status badge */}
                  <span className={clsx("text-xs font-medium px-2.5 py-1 rounded-full shrink-0", statusOpt?.color)}>
                    {statusOpt?.label}
                  </span>

                  {/* Description */}
                  <p className="flex-1 text-sm text-dark font-medium line-clamp-1">{cap.description}</p>

                  {/* Meta */}
                  <div className="text-right shrink-0 hidden sm:block">
                    {cap.form_submissions?.form_templates?.title && (
                      <p className="text-xs text-dark/50">{cap.form_submissions.form_templates.title}</p>
                    )}
                    {cap.due_at && (
                      <p className={clsx("text-xs mt-0.5", isOverdue ? "text-red-500 font-medium" : "text-dark/30")}>
                        Due {new Date(cap.due_at).toLocaleDateString()}
                        {isOverdue && " ⚠️"}
                      </p>
                    )}
                  </div>
                  <ChevronDown className={clsx("w-4 h-4 text-dark/30 shrink-0 transition-transform", isExpanded && "rotate-180")} />
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-[#E8EDF2] p-4 space-y-4">
                    {/* Assignee */}
                    {cap.profiles && (
                      <div className="text-sm">
                        <span className="text-dark/50">Assigned to: </span>
                        <span className="font-medium text-dark">{cap.profiles.full_name}</span>
                      </div>
                    )}

                    {/* Status update */}
                    <div>
                      <label className="block text-xs font-semibold text-dark/60 mb-2">Update Status</label>
                      <div className="flex gap-2 flex-wrap">
                        {STATUS_OPTIONS.map((opt) => (
                          <button key={opt.value}
                            onClick={() => updateStatus(cap.id, opt.value)}
                            disabled={cap.status === opt.value || updating === cap.id}
                            className={clsx(
                              "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                              cap.status === opt.value ? opt.color : "bg-gray-100 text-dark/60 hover:bg-gray-200"
                            )}>
                            {updating === cap.id ? "Saving…" : opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Resolution note */}
                    {cap.status !== "resolved" && (
                      <ResolutionNoteForm
                        capId={cap.id}
                        currentNote={cap.resolution_note}
                        onSave={(note) => saveResolution(cap.id, note)}
                        saving={updating === cap.id}
                      />
                    )}
                    {cap.resolved_at && (
                      <div className="text-xs text-dark/40">
                        Resolved {new Date(cap.resolved_at).toLocaleString()}
                        {cap.resolution_note && ` — "${cap.resolution_note}"`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ResolutionNoteForm({ capId, currentNote, onSave, saving }: {
  capId: string;
  currentNote?: string;
  onSave: (note: string) => void;
  saving: boolean;
}) {
  const [note, setNote] = useState(currentNote ?? "");
  return (
    <div>
      <label className="block text-xs font-semibold text-dark/60 mb-1.5">Resolution Note</label>
      <div className="flex gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)}
          className="flex-1 border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
          placeholder="Describe how this was resolved…" />
        <button onClick={() => onSave(note)} disabled={saving || !note.trim()}
          className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
          {saving ? "…" : "Mark Resolved"}
        </button>
      </div>
    </div>
  );
}
