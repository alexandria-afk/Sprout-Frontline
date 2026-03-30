"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { X, Loader2, ShieldAlert, Sparkles, CheckCircle } from "lucide-react";
import { createTask } from "@/services/tasks";
import { suggestTaskPriority } from "@/services/tasks";
import { listLocations, type Location as ServiceLocation } from "@/services/users";
import type { Task, TaskPriority } from "@/types";
import { AssignPeoplePanel } from "@/components/shared/AssignPeoplePanel";

interface CreateTaskModalProps {
  onClose: () => void;
  onCreated: (task: Task) => void;
  prefill?: Partial<Task> & {
    source_type?: string;
    source_submission_id?: string;
    source_field_id?: string;
  };
}

export function CreateTaskModal({ onClose, onCreated, prefill }: CreateTaskModalProps) {
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(prefill?.priority ?? "medium");
  const [dueAt, setDueAt] = useState("");
  const [locationId, setLocationId] = useState(prefill?.location_id ?? "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [locations, setLocations] = useState<ServiceLocation[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // AI priority suggestion state
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiPrioritySuggestion, setAiPrioritySuggestion] = useState<{
    priority: string;
    reasoning: string;
  } | null>(null);
  const [aiError, setAiError] = useState("");
  const [showAiTooltip, setShowAiTooltip] = useState(false);

  useEffect(() => {
    listLocations().then(setLocations).catch(() => {});
  }, []);

  const assigneeSet = new Set(assigneeIds);

  async function handleAiSuggestPriority() {
    if (!title.trim()) return;
    setAiSuggesting(true);
    setAiError("");
    setAiPrioritySuggestion(null);
    try {
      const result = await suggestTaskPriority({
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setAiPrioritySuggestion(result);
    } catch {
      setAiError("AI suggestion failed. Please try again.");
    } finally {
      setAiSuggesting(false);
    }
  }

  function acceptAiPriority() {
    if (!aiPrioritySuggestion) return;
    setPriority(aiPrioritySuggestion.priority as TaskPriority);
    setAiPrioritySuggestion(null);
    setShowAiTooltip(false);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required."); return; }
    setError("");
    setSubmitting(true);
    try {
      const created = await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        due_at: dueAt || null,
        location_id: locationId || null,
        source_type: prefill?.source_type ?? "manual",
        source_submission_id: prefill?.source_submission_id ?? null,
        source_field_id: prefill?.source_field_id ?? null,
        assignee_user_ids: assigneeIds,
      });
      onCreated(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full bg-white";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
          <h2 className="text-lg font-semibold text-dark">New Task</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 flex flex-col gap-4">
          {prefill?.source_type === "audit" && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              Created from audit finding — linked to original submission
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-dark-secondary uppercase tracking-wide">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Description</label>
            <textarea
              className={clsx(inputCls, "resize-none")}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Priority</label>
                {/* AI suggest button — only shown when there is a title */}
                {title.trim() && (
                  <button
                    type="button"
                    onClick={handleAiSuggestPriority}
                    disabled={aiSuggesting}
                    className={clsx(
                      "flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-all disabled:opacity-60",
                      aiSuggesting
                        ? "border border-sprout-purple/40 bg-sprout-purple/5 text-sprout-purple"
                        : "ai-sparkle-btn shadow-sm shadow-purple-200"
                    )}
                    title="Get AI priority suggestion"
                  >
                    {aiSuggesting ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    AI
                  </button>
                )}
              </div>
              <select
                className={clsx(inputCls, "bg-white")}
                value={priority}
                onChange={(e) => { setPriority(e.target.value as TaskPriority); setAiPrioritySuggestion(null); }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>

              {/* AI suggestion pill */}
              {aiError && <p className="text-xs text-red-500">{aiError}</p>}
              {aiPrioritySuggestion && (
                <div className="flex flex-col gap-1.5 mt-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="relative">
                      <button
                        type="button"
                        onMouseEnter={() => setShowAiTooltip(true)}
                        onMouseLeave={() => setShowAiTooltip(false)}
                        onFocus={() => setShowAiTooltip(true)}
                        onBlur={() => setShowAiTooltip(false)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sprout-purple/10 border border-sprout-purple/30 text-sprout-purple text-xs font-medium cursor-default"
                      >
                        <Sparkles className="w-3 h-3" />
                        {aiPrioritySuggestion.priority.charAt(0).toUpperCase() + aiPrioritySuggestion.priority.slice(1)}
                      </button>
                      {showAiTooltip && (
                        <div className="absolute bottom-full left-0 mb-1.5 w-48 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 z-10 shadow-lg leading-relaxed">
                          {aiPrioritySuggestion.reasoning}
                          <div className="absolute top-full left-3 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={acceptAiPriority}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sprout-purple text-white text-xs font-medium hover:bg-sprout-purple/90 transition-colors"
                    >
                      <CheckCircle className="w-3 h-3" />
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiPrioritySuggestion(null)}
                      className="text-dark/30 hover:text-dark/60"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Due Date</label>
              <input
                type="datetime-local"
                className={inputCls}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Location</label>
            <select
              className={clsx(inputCls, "bg-white")}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">No location</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-dark-secondary uppercase tracking-wide">
              Assign To
              {assigneeIds.length > 0 && (
                <span className="ml-2 normal-case text-sprout-purple font-semibold">{assigneeIds.length} selected</span>
              )}
            </label>
            <AssignPeoplePanel
              selected={assigneeSet}
              onChange={(next) => setAssigneeIds(Array.from(next))}
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 justify-end pt-2 border-t border-surface-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin inline mr-1.5" />Creating…</>
              ) : (
                "Create Task"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
