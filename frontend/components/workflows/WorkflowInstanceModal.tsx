"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, Clock, ChevronRight, X, ThumbsUp, ThumbsDown } from "lucide-react";
import { apiFetch } from "@/services/api/client";
import { clsx } from "clsx";

interface StageInstance {
  id: string;
  status: string;
  started_at?: string;
  completed_at?: string;
  comment?: string;
  assigned_to?: string;
  workflow_stages?: {
    name: string;
    action_type: string;
    stage_order: number;
    is_final: boolean;
  };
}

interface WorkflowInstanceDetail {
  id: string;
  status: string;
  created_at: string;
  completed_at?: string;
  workflow_definitions?: { name: string };
  form_submissions?: { form_templates?: { title: string } };
  workflow_stage_instances?: StageInstance[];
}

interface WorkflowInstanceModalProps {
  instanceId: string;
  onClose: () => void;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="w-4 h-4 text-gray-400" />,
  in_progress: <Clock className="w-4 h-4 text-blue-500 animate-pulse" />,
  approved: <CheckCircle2 className="w-4 h-4 text-green-500" />,
  rejected: <XCircle className="w-4 h-4 text-red-500" />,
  skipped: <ChevronRight className="w-4 h-4 text-gray-400" />,
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  approved: "Approved",
  rejected: "Rejected",
  skipped: "Skipped",
};

export function WorkflowInstanceModal({ instanceId, onClose }: WorkflowInstanceModalProps) {
  const [detail, setDetail] = useState<WorkflowInstanceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionStageId, setActionStageId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  async function load() {
    try {
      const data = await apiFetch<WorkflowInstanceDetail>(`/api/v1/workflows/instances/${instanceId}`);
      setDetail(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [instanceId]);

  async function approveStage(stageInstanceId: string) {
    setSubmitting(true);
    setActionError("");
    try {
      await apiFetch(`/api/v1/workflows/instances/${instanceId}/stages/${stageInstanceId}/approve`, {
        method: "POST",
        body: JSON.stringify({ comment: comment || null }),
      });
      setComment("");
      setActionStageId(null);
      await load();
    } catch (e: any) {
      setActionError(e.message || "Failed to approve stage");
    } finally {
      setSubmitting(false);
    }
  }

  async function rejectStage(stageInstanceId: string) {
    if (!comment.trim()) { setActionError("A comment is required when rejecting"); return; }
    setSubmitting(true);
    setActionError("");
    try {
      await apiFetch(`/api/v1/workflows/instances/${instanceId}/stages/${stageInstanceId}/reject`, {
        method: "POST",
        body: JSON.stringify({ comment }),
      });
      setComment("");
      setActionStageId(null);
      await load();
    } catch (e: any) {
      setActionError(e.message || "Failed to reject stage");
    } finally {
      setSubmitting(false);
    }
  }

  const sortedStages = (detail?.workflow_stage_instances ?? [])
    .sort((a, b) => (a.workflow_stages?.stage_order ?? 0) - (b.workflow_stages?.stage_order ?? 0));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#E8EDF2]">
          <div>
            <h2 className="text-lg font-bold text-dark">
              {detail?.workflow_definitions?.name ?? "Workflow Instance"}
            </h2>
            {detail?.form_submissions?.form_templates?.title && (
              <p className="text-sm text-dark/50 mt-0.5">{detail.form_submissions.form_templates.title}</p>
            )}
          </div>
          <button onClick={onClose} className="text-dark/40 hover:text-dark p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-sprout-cyan/30 border-t-sprout-cyan rounded-full animate-spin" />
          </div>
        ) : !detail ? (
          <div className="text-center py-12 text-dark/40">Failed to load instance</div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Overall status */}
            <div className={clsx(
              "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium",
              detail.status === "completed" ? "bg-green-50 text-green-700"
                : detail.status === "cancelled" ? "bg-red-50 text-red-700"
                : "bg-blue-50 text-blue-700"
            )}>
              {detail.status === "completed" ? <CheckCircle2 className="w-4 h-4" />
                : detail.status === "cancelled" ? <XCircle className="w-4 h-4" />
                : <Clock className="w-4 h-4" />}
              Workflow {detail.status.replace("_", " ")}
            </div>

            {/* Stage timeline */}
            <div>
              <h3 className="text-sm font-semibold text-dark mb-4">Stage Timeline</h3>
              <div className="space-y-1">
                {sortedStages.map((stage, idx) => {
                  const isActive = stage.status === "in_progress";
                  const isLast = idx === sortedStages.length - 1;

                  return (
                    <div key={stage.id}>
                      <div className={clsx(
                        "flex items-start gap-3 p-3 rounded-xl transition-colors",
                        isActive ? "bg-blue-50 border border-blue-100" : "bg-gray-50"
                      )}>
                        <div className="mt-0.5 shrink-0">{STATUS_ICONS[stage.status] ?? STATUS_ICONS.pending}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-dark">
                              {stage.workflow_stages?.name ?? `Stage ${idx + 1}`}
                            </span>
                            <span className="text-xs text-dark/40">
                              {stage.workflow_stages?.action_type}
                            </span>
                            {stage.workflow_stages?.is_final && (
                              <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Final</span>
                            )}
                            <span className={clsx(
                              "text-xs px-1.5 py-0.5 rounded ml-auto",
                              stage.status === "approved" ? "bg-green-100 text-green-700"
                                : stage.status === "rejected" ? "bg-red-100 text-red-700"
                                : stage.status === "in_progress" ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-500"
                            )}>
                              {STATUS_LABELS[stage.status] ?? stage.status}
                            </span>
                          </div>
                          {stage.comment && (
                            <p className="text-xs text-dark/50 mt-1 italic">"{stage.comment}"</p>
                          )}
                          {stage.completed_at && (
                            <p className="text-xs text-dark/30 mt-0.5">
                              {new Date(stage.completed_at).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Approve/Reject actions for in_progress stages */}
                      {isActive && detail.status === "in_progress" && (
                        <div className="ml-10 mt-2 space-y-2">
                          {actionError && (
                            <p className="text-xs text-red-500">{actionError}</p>
                          )}
                          <textarea
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="Add a comment (required for rejection)…"
                            rows={2}
                            className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-cyan/30 resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => approveStage(stage.id)}
                              disabled={submitting}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                              <ThumbsUp className="w-3.5 h-3.5" />
                              {submitting ? "…" : "Approve"}
                            </button>
                            <button
                              onClick={() => rejectStage(stage.id)}
                              disabled={submitting}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                              <ThumbsDown className="w-3.5 h-3.5" />
                              {submitting ? "…" : "Reject"}
                            </button>
                          </div>
                        </div>
                      )}

                      {!isLast && (
                        <div className="ml-5 w-0.5 h-3 bg-gray-200" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
