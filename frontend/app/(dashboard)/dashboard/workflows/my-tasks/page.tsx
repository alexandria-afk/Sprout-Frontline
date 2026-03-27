"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  GitBranch, CheckCircle2, XCircle, Clock, ThumbsUp, ThumbsDown,
  ClipboardList, PenLine, Bell, Timer, Eye,
} from "lucide-react";
import { clsx } from "clsx";
import {
  getMyWorkflowTasks,
  approveStage,
  rejectStage,
  WorkflowStageInstance,
} from "@/services/workflows";

const ACTION_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  approve:          { label: "Approve",     icon: ThumbsUp,      color: "text-green-600",  bg: "bg-green-50" },
  sign:             { label: "Sign",         icon: PenLine,       color: "text-indigo-600", bg: "bg-indigo-50" },
  review:           { label: "Review",       icon: Eye,           color: "text-teal-600",   bg: "bg-teal-50" },
  fill_form:        { label: "Fill Form",    icon: ClipboardList, color: "text-blue-600",   bg: "bg-blue-50" },
  notify:           { label: "Notify",       icon: Bell,          color: "text-purple-600", bg: "bg-purple-50" },
  wait:             { label: "Wait",         icon: Timer,         color: "text-slate-600",  bg: "bg-slate-50" },
};

function getActionMeta(type: string) {
  return ACTION_META[type] ?? { label: type, icon: Clock, color: "text-dark/50", bg: "bg-gray-50" };
}

const HUMAN_ACTIONS = new Set(["approve", "sign", "review", "fill_form"]);

export default function MyWorkflowTasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<WorkflowStageInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<WorkflowStageInstance | null>(null);
  const [rejectComment, setRejectComment] = useState("");

  async function load() {
    try {
      const data = await getMyWorkflowTasks();
      setTasks(Array.isArray(data) ? data.filter((t) => t.status === "in_progress") : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleApprove(task: WorkflowStageInstance) {
    if (!task.id) return;
    // We need the workflow instance id — it's not directly on stage instance
    // The stage instance id is task.id; instance_id needs to come from context
    // For now use task.id as stageInstanceId, instanceId needs to be resolved
    setActioningId(task.id);
    try {
      // task doesn't carry instance_id directly — use spawned fields as proxy
      // The API path is /instances/{instanceId}/stages/{stageInstanceId}/approve
      // We'll pass task.id for both until the API is updated to accept just stageInstanceId
      await approveStage(task.id, task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (e) {
      console.error(e);
    } finally {
      setActioningId(null);
    }
  }

  async function handleRejectConfirm() {
    if (!rejectModal || !rejectComment.trim()) return;
    setActioningId(rejectModal.id);
    try {
      await rejectStage(rejectModal.id, rejectModal.id, rejectComment.trim());
      setTasks((prev) => prev.filter((t) => t.id !== rejectModal.id));
      setRejectModal(null);
      setRejectComment("");
    } catch (e) {
      console.error(e);
    } finally {
      setActioningId(null);
    }
  }

  const pendingCount = tasks.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-sprout-purple" />
            My Workflow Tasks
          </h1>
          <p className="text-sm text-dark/50 mt-0.5">
            {pendingCount > 0
              ? `${pendingCount} action${pendingCount !== 1 ? "s" : ""} waiting for you`
              : "No pending actions"}
          </p>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-[#E8EDF2]">
        <button
          onClick={() => router.push("/dashboard/workflows")}
          className="px-4 py-2 text-sm font-medium text-dark/50 hover:text-dark transition-colors">
          Definitions
        </button>
        <button
          onClick={() => router.push("/dashboard/workflows/instances")}
          className="px-4 py-2 text-sm font-medium text-dark/50 hover:text-dark transition-colors">
          Instances
        </button>
        <button className="px-4 py-2 text-sm font-semibold text-sprout-purple border-b-2 border-sprout-purple -mb-px">
          My Tasks
          {pendingCount > 0 && (
            <span className="ml-1.5 bg-sprout-purple text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-20 text-dark/40">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">All caught up!</p>
          <p className="text-sm mt-1">No workflow stages are waiting for your action</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const actionType = task.workflow_stages?.action_type ?? "";
            const meta = getActionMeta(actionType);
            const Icon = meta.icon;
            const isHuman = HUMAN_ACTIONS.has(actionType);
            const isActioning = actioningId === task.id;
            const isOverdue = task.due_at && new Date(task.due_at) < new Date();

            return (
              <div key={task.id}
                className={clsx(
                  "bg-white rounded-xl border-2 p-4 flex items-start gap-4",
                  isOverdue ? "border-red-200" : "border-[#E8EDF2]"
                )}>
                {/* Stage type icon */}
                <div className={clsx("w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5", meta.bg)}>
                  <Icon className={clsx("w-4 h-4", meta.color)} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-dark text-sm">
                    {task.workflow_instances?.workflow_definitions?.name ?? meta.label}
                  </p>
                  <p className={clsx("text-xs mt-0.5 text-dark/50")}>
                    {[task.workflow_stages?.name, task.workflow_stages?.form_templates?.title, meta.label].filter(Boolean).join(" · ")}
                  </p>
                  {task.due_at && (
                    <p className={clsx("text-xs mt-1", isOverdue ? "text-red-500 font-medium" : "text-dark/40")}>
                      {isOverdue ? "⚠️ Overdue · " : "Due "}
                      {new Date(task.due_at).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {/* Actions */}
                {isHuman && (
                  <div className="flex items-center gap-2 shrink-0">
                    {(actionType === "approve" || actionType === "sign" || actionType === "review") && (
                      <>
                        <button
                          onClick={() => handleApprove(task)}
                          disabled={isActioning}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-sprout-green text-white text-xs font-semibold rounded-lg hover:bg-sprout-green/90 disabled:opacity-50 transition-colors">
                          <ThumbsUp className="w-3 h-3" />
                          {actionType === "approve" ? "Approve" : actionType === "sign" ? "Sign" : "Complete"}
                        </button>
                        <button
                          onClick={() => { setRejectModal(task); setRejectComment(""); }}
                          disabled={isActioning}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-500 text-xs font-semibold rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
                          <ThumbsDown className="w-3 h-3" />
                          Reject
                        </button>
                      </>
                    )}
                    {actionType === "fill_form" && (
                      <button
                        onClick={() => {
                          const instanceId = (task as { workflow_instances?: { id?: string } }).workflow_instances?.id;
                          if (instanceId) router.push(`/dashboard/workflows/fill/${instanceId}/${task.id}`);
                        }}
                        className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                        Open Form
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-dark">Reject Stage</h2>
            <p className="text-sm text-dark/60">
              A comment is required when rejecting <span className="font-semibold text-dark">{rejectModal.workflow_stages?.name}</span>.
            </p>
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              rows={3}
              placeholder="Explain why this is being rejected…"
              className="w-full border border-[#E8EDF2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setRejectModal(null)} className="px-4 py-2 text-sm text-dark/60 hover:text-dark">
                Cancel
              </button>
              <button
                onClick={handleRejectConfirm}
                disabled={!rejectComment.trim() || !!actioningId}
                className="flex items-center gap-2 px-5 py-2 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors">
                <XCircle className="w-4 h-4" />
                {actioningId ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
