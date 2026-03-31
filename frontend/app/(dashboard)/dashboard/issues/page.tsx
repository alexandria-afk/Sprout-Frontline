"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import {
  AlertTriangle, Plus, X, Search, Loader2, Filter, ChevronDown,
  MapPin, Clock, RefreshCw, User, MessageSquare, Flag, ShieldAlert,
  CheckCircle2, ChevronRight, Paperclip, Tag, Calendar,
  Send, ClipboardList, XCircle, Wrench, ImagePlus, Camera, Download, Circle,
  Sparkles, CheckCircle,
} from "lucide-react";
import {
  DragDropContext, Droppable, Draggable, type DropResult,
} from "@hello-pangea/dnd";
import {
  listIssues,
  listIssueCategories,
  getIssue,
  createIssue,
  updateIssue,
  updateIssueStatus,
  addIssueComment,
  uploadIssueAttachments,
  classifyIssue,
  analysePhoto,
} from "@/services/issues";
import { listUsers } from "@/services/users";
import { listAssets } from "@/services/maintenance";
import type { Asset } from "@/types";
import {
  listTasks, updateTaskStatus, addAssignee, removeAssignee,
  postMessage, getTask, markTaskRead, taskSummary,
} from "@/services/tasks";
import { createClient } from "@/services/supabase/client";
import { CreateTaskModal } from "@/components/tasks/CreateTaskModal";
import type {
  Issue,
  IssueAttachment,
  IssueCategory,
  IssuePriority,
  IssueStatus,
  Task,
  TaskPriority,
  TaskStatus,
  TaskSummary,
} from "@/types";
import { friendlyError } from "@/lib/errors";

// ── Constants & style helpers ─────────────────────────────────────────────────

const inputCls =
  "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full";

// ── Shared helpers ────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

// ── Issues constants ──────────────────────────────────────────────────────────

const KANBAN_COLUMNS: { key: IssueStatus; label: string; icon: React.ElementType; iconColor: string }[] = [
  { key: "open",            label: "Open",            icon: Circle,        iconColor: "text-amber-500"   },
  { key: "in_progress",     label: "In Progress",     icon: Clock,         iconColor: "text-blue-600"    },
  { key: "pending_vendor",  label: "Pending Vendor",  icon: Wrench,        iconColor: "text-amber-600"   },
  { key: "resolved",        label: "Resolved",        icon: CheckCircle2,  iconColor: "text-sprout-green"},
  { key: "verified_closed", label: "Verified Closed", icon: XCircle,       iconColor: "text-gray-400"    },
];

const ISSUE_PRIORITY_CONFIG: Record<IssuePriority, { label: string; color: string; Icon: React.ElementType }> = {
  low:      { label: "Low",      color: "bg-gray-100 text-gray-500",   Icon: Flag        },
  medium:   { label: "Medium",   color: "bg-blue-100 text-blue-600",   Icon: Flag        },
  high:     { label: "High",     color: "bg-amber-100 text-amber-700", Icon: Flag        },
  critical: { label: "Critical", color: "bg-red-100 text-red-600",     Icon: ShieldAlert },
};

const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open:             "Open",
  in_progress:      "In Progress",
  pending_vendor:   "Pending Vendor",
  resolved:         "Resolved",
  verified_closed:  "Verified Closed",
};

// ── Tasks constants ───────────────────────────────────────────────────────────

const TASK_PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; icon: React.ElementType }> = {
  low:      { label: "Low",      color: "bg-gray-100 text-gray-500",            icon: Flag        },
  medium:   { label: "Medium",   color: "bg-blue-100 text-blue-600",            icon: Flag        },
  high:     { label: "High",     color: "bg-amber-100 text-amber-700",          icon: Flag        },
  critical: { label: "Critical", color: "bg-red-100 text-red-600",              icon: ShieldAlert },
};

const TASK_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending:     { label: "Pending",     color: "bg-gray-100 text-gray-600",            icon: Clock        },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-700",            icon: RefreshCw    },
  completed:   { label: "Completed",   color: "bg-sprout-green/10 text-sprout-green", icon: CheckCircle2 },
  overdue:     { label: "Overdue",     color: "bg-red-100 text-red-600",              icon: AlertTriangle},
  cancelled:   { label: "Cancelled",   color: "bg-gray-100 text-gray-400",            icon: XCircle      },
};

const MANAGER_COLS: TaskStatus[] = ["pending", "in_progress", "completed", "cancelled"];
const MANAGER_DROPPABLE: TaskStatus[] = ["pending", "in_progress", "completed", "cancelled"];
const STAFF_COLS: TaskStatus[] = ["pending", "in_progress", "completed"];
const STAFF_DROPPABLE: TaskStatus[] = ["pending", "in_progress", "completed"];

// ── Incidents types & helpers ─────────────────────────────────────────────────

type IncidentSeverity = "low" | "medium" | "high" | "critical";
type IncidentStatus = "reported" | "investigating" | "closed";

interface IncidentComment {
  id: string;
  incident_id: string;
  user_id: string | null;
  body: string;
  created_at: string;
  profiles?: { full_name: string } | null;
}

interface Incident {
  id: string;
  organisation_id: string;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  incident_date: string;
  location_description: string | null;
  location_id: string | null;
  people_involved: string | null;
  regulatory_body: string | null;
  reported_by: string | null;
  related_issue_id: string | null;
  created_at: string;
  updated_at: string;
  reporter?: { full_name: string } | null;
  comments?: IncidentComment[];
}

const INCIDENT_SEVERITY_CONFIG: Record<IncidentSeverity, { label: string; color: string }> = {
  low:      { label: "Low",      color: "bg-gray-100 text-gray-500"   },
  medium:   { label: "Medium",   color: "bg-blue-100 text-blue-600"   },
  high:     { label: "High",     color: "bg-amber-100 text-amber-700" },
  critical: { label: "Critical", color: "bg-red-100 text-red-600"     },
};

const INCIDENT_STATUS_CONFIG: Record<IncidentStatus, { label: string; color: string }> = {
  reported:      { label: "Report Generated", color: "bg-purple-100 text-purple-700"  },
  investigating: { label: "Investigating",    color: "bg-blue-100 text-blue-600"      },
  closed:        { label: "Closed",           color: "bg-green-100 text-green-700"    },
};


async function listIncidents(params: { my_team?: boolean } = {}): Promise<{ data: Incident[] }> {
  try {
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
    const q = new URLSearchParams();
    if (params.my_team) q.set("my_team", "true");
    const qs = q.toString();
    const res = await fetch(`${apiBase}/api/v1/incidents${qs ? `?${qs}` : ""}`, {
      headers: token
        ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
        : { "Content-Type": "application/json" },
    });
    if (!res.ok) return { data: [] };
    const json = await res.json();
    // Accept both { data: [...] } and plain array responses
    if (Array.isArray(json)) return { data: json };
    if (Array.isArray(json.data)) return { data: json.data };
    return { data: [] };
  } catch {
    return { data: [] };
  }
}


async function updateIncidentPatch(id: string, body: { severity?: IncidentSeverity }): Promise<Incident> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  const res = await fetch(`${apiBase}/api/v1/incidents/${id}`, {
    method: "PATCH",
    headers: token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail || err?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function updateIncidentStatus(id: string, status: IncidentStatus): Promise<Incident> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  const res = await fetch(`${apiBase}/api/v1/incidents/${id}/status`, {
    method: "PUT",
    headers: token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail || err?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function addIncidentComment(id: string, body: string): Promise<IncidentComment> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  const res = await fetch(`${apiBase}/api/v1/incidents/${id}/comments`, {
    method: "POST",
    headers: token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail || err?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Shared badge components ───────────────────────────────────────────────────

function IssuePriorityBadge({ priority }: { priority: IssuePriority }) {
  const cfg = ISSUE_PRIORITY_CONFIG[priority] ?? ISSUE_PRIORITY_CONFIG.medium;
  const Icon = cfg.Icon;
  return (
    <span className={clsx("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold", cfg.color)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

const ISSUE_STATUS_BADGE_COLOR: Record<IssueStatus, string> = {
  open:             "bg-gray-100 text-gray-600",
  in_progress:      "bg-blue-100 text-blue-700",
  pending_vendor:   "bg-amber-100 text-amber-700",
  resolved:         "bg-green-100 text-green-700",
  verified_closed:  "bg-gray-100 text-gray-500",
};

function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return (
    <span className={clsx("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold", ISSUE_STATUS_BADGE_COLOR[status] ?? "bg-gray-100 text-gray-500")}>
      {ISSUE_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const cfg = TASK_PRIORITY_CONFIG[priority] ?? TASK_PRIORITY_CONFIG.medium;
  const Icon = cfg.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold", cfg.color)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function TaskStatusBadge({ status }: { status: string }) {
  const cfg = TASK_STATUS_CONFIG[status] ?? TASK_STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold", cfg.color)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ── INCIDENTS TAB ─────────────────────────────────────────────────────────────

// Linked Issue Block — shows full issue report data inside an incident pane
function LinkedIssueBlock({ issue }: { issue: Issue }) {
  const [viewUrl, setViewUrl] = useState<string | null>(null);

  function parseDescription(desc: string | null) {
    if (!desc) return { clean: "", safetyRisk: false, unlistedEquipment: null as string | null };
    let clean = desc;
    let safetyRisk = false;
    let unlistedEquipment: string | null = null;
    if (clean.includes("⚠️ Safety risk reported.")) {
      safetyRisk = true;
      clean = clean.replace(/\n*⚠️ Safety risk reported\./, "");
    }
    const equipMatch = clean.match(/\n*\[Unlisted equipment: ([^\]]+)\]/);
    if (equipMatch) {
      unlistedEquipment = equipMatch[1];
      clean = clean.replace(/\n*\[Unlisted equipment: [^\]]+\]/, "");
    }
    return { clean: clean.trim(), safetyRisk, unlistedEquipment };
  }

  const { clean: cleanDesc, safetyRisk: hasSafetyRisk, unlistedEquipment } = parseDescription(issue.description);
  const images = (issue.attachments ?? []).filter((a) => a.file_type === "image");

  return (
    <div className="flex flex-col gap-3 bg-gray-50/60 rounded-xl border border-surface-border p-4">
      {/* Title + category + priority */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-dark leading-snug">{issue.title}</p>
          {issue.issue_categories && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: issue.issue_categories.color ?? "#6B7280" }} />
              <span className="text-xs text-dark-secondary">{issue.issue_categories.name}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <IssuePriorityBadge priority={issue.priority} />
          <IssueStatusBadge status={issue.status} />
        </div>
      </div>

      {/* Description */}
      {cleanDesc && (
        <p className="text-sm text-dark whitespace-pre-wrap leading-relaxed">{cleanDesc}</p>
      )}

      {/* Detail grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
        {issue.locations?.name && (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-dark-secondary uppercase tracking-wide">Location</span>
            <span className="flex items-center gap-1 text-dark">
              <MapPin className="w-3 h-3 text-dark-secondary shrink-0" />{issue.locations.name}
            </span>
          </div>
        )}
        {issue.location_description && (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-dark-secondary uppercase tracking-wide">Where exactly</span>
            <span className="text-dark">{issue.location_description}</span>
          </div>
        )}
        {(issue.asset_id || unlistedEquipment) && (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-dark-secondary uppercase tracking-wide">Equipment</span>
            <span className="flex items-center gap-1 text-dark">
              <Wrench className="w-3 h-3 text-dark-secondary shrink-0" />{unlistedEquipment ?? issue.asset_id}
            </span>
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-dark-secondary uppercase tracking-wide">Safety risk / injury</span>
          {hasSafetyRisk ? (
            <span className="flex items-center gap-1 text-amber-600 font-medium">
              <ShieldAlert className="w-3 h-3 shrink-0" /> Yes
            </span>
          ) : (
            <span className="text-dark-secondary">No</span>
          )}
        </div>
        {issue.reporter && (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-dark-secondary uppercase tracking-wide">Reported by</span>
            <span className="flex items-center gap-1 text-dark">
              <User className="w-3 h-3 text-dark-secondary shrink-0" />{issue.reporter.full_name}
            </span>
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-dark-secondary uppercase tracking-wide">Reported at</span>
          <span className="flex items-center gap-1 text-dark">
            <Clock className="w-3 h-3 text-dark-secondary shrink-0" />{formatDateTime(issue.created_at)}
          </span>
        </div>
      </div>

      {/* Photos */}
      {images.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-1 border-t border-surface-border">
          <span className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Photos</span>
          <div className="flex flex-wrap gap-2">
            {images.map((att) => (
              <button key={att.id} type="button" onClick={() => setViewUrl(att.file_url)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={att.file_url}
                  alt="Attachment"
                  className="w-20 h-20 object-cover rounded-lg border border-surface-border hover:opacity-90 transition cursor-zoom-in"
                />
              </button>
            ))}
          </div>
        </div>
      )}
      {viewUrl && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setViewUrl(null)}>
          <button type="button" onClick={() => setViewUrl(null)}
            className="absolute top-4 right-4 w-9 h-9 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewUrl} alt="Attachment" className="w-full rounded-xl object-contain max-h-[80vh]" />
          </div>
        </div>
      )}
    </div>
  );
}

// Incident Detail Pane — inline CAP-style full view (no modal)
function IncidentDetailPane({
  incident: initialIncident,
  onBack,
  onUpdated,
  isManager,
}: {
  incident: Incident;
  onBack: () => void;
  onUpdated: (updated: Incident) => void;
  isManager: boolean;
}) {
  const [incident, setIncident]               = useState<Incident>(initialIncident);
  const [commentBody, setCommentBody]         = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentError, setCommentError]       = useState("");
  const [statusChanging, setStatusChanging]   = useState<IncidentStatus | null>(null);
  const [statusError, setStatusError]         = useState("");
  const [downloadingPdf, setDownloadingPdf]   = useState(false);

  // Linked issue — fetch full data when related_issue_id is present
  const [linkedIssue, setLinkedIssue]         = useState<Issue | null>(null);
  const [loadingLinked, setLoadingLinked]     = useState(false);
  const [showIssueModal, setShowIssueModal]   = useState(false);

  useEffect(() => {
    if (!incident.related_issue_id) return;
    setLoadingLinked(true);
    getIssue(incident.related_issue_id)
      .then(setLinkedIssue)
      .catch(() => {})
      .finally(() => setLoadingLinked(false));
  }, [incident.related_issue_id]);

  const sevCfg = INCIDENT_SEVERITY_CONFIG[incident.severity] ?? INCIDENT_SEVERITY_CONFIG.medium;
  const stCfg  = INCIDENT_STATUS_CONFIG[incident.status]     ?? INCIDENT_STATUS_CONFIG.reported;

  const handleStatusChange = async (newStatus: IncidentStatus) => {
    if (newStatus === incident.status) return;
    setStatusChanging(newStatus);
    setStatusError("");
    try {
      const updated = await updateIncidentStatus(incident.id, newStatus);
      setIncident(updated);
      onUpdated(updated);
    } catch (e) {
      setStatusError(friendlyError(e));
    } finally {
      setStatusChanging(null);
    }
  };

  const handleAddComment = async () => {
    const body = commentBody.trim();
    if (!body) return;
    setSubmittingComment(true);
    setCommentError("");
    try {
      const comment = await addIncidentComment(incident.id, body);
      setIncident((prev) => ({ ...prev, comments: [...(prev.comments ?? []), comment] }));
      setCommentBody("");
    } catch (e) {
      setCommentError(friendlyError(e));
    } finally {
      setSubmittingComment(false);
    }
  };

  const issueHistory = [...(linkedIssue?.status_history ?? [])].sort(
    (a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime()
  );

  // Parse safety risk flag from incident description
  const hasSafetyRisk = !!(incident.description?.includes("⚠️ Safety risk reported."));

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`${API_BASE}/api/v1/incidents/${incident.id}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { alert("PDF export failed"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `incident-${incident.id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("PDF export failed");
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 max-w-3xl w-full mx-auto pb-10">

      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-dark-secondary hover:text-dark w-fit"
      >
        <ChevronRight className="w-4 h-4 rotate-180" /> Back to Incident Reports
      </button>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-surface-border p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-dark leading-tight">{incident.title}</h1>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-dark-secondary flex-wrap">
              {incident.reporter && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />{incident.reporter.full_name}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />{formatDateTime(incident.incident_date)}
              </span>
            </div>
          </div>
          <button
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-dark-secondary border border-surface-border rounded-lg hover:bg-gray-50 disabled:opacity-60 transition-colors shrink-0"
          >
            {downloadingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Download PDF
          </button>
        </div>
      </div>

      {/* Incident Report Details card */}
      <div className="bg-white rounded-xl border border-surface-border p-5 flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-dark flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-sprout-purple" />
          Incident Report Details
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Date Generated</span>
            <span className="text-sm text-dark">{formatDateTime(incident.incident_date)}</span>
          </div>
          {incident.people_involved && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-dark-secondary uppercase tracking-wide">People Involved</span>
              <span className="text-sm text-dark">{incident.people_involved}</span>
            </div>
          )}
          {incident.regulatory_body && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Regulatory Body</span>
              <span className="text-sm text-dark">{incident.regulatory_body}</span>
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Safety Risk / Injury</span>
            {hasSafetyRisk ? (
              <span className="flex items-center gap-1 text-amber-600 font-medium text-sm">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> Yes — safety risk reported
              </span>
            ) : (
              <span className="text-sm text-dark-secondary">No</span>
            )}
          </div>
        </div>
      </div>

      {/* Originating Issue Report card — includes assigned to, issue data, history, and thread */}
      {incident.related_issue_id && (
        <div className="bg-white rounded-xl border border-surface-border p-5 flex flex-col gap-5">
          {/* Card header */}
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-dark flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-sprout-purple" />
              Originating Issue Report
            </h2>
            {linkedIssue && (
              <button
                onClick={() => setShowIssueModal(true)}
                className="flex items-center gap-1 text-xs text-sprout-purple hover:underline font-medium"
              >
                View full issue <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {loadingLinked ? (
            <div className="flex flex-col gap-2 animate-pulse">
              <div className="h-4 w-1/2 bg-gray-200 rounded" />
              <div className="h-3 w-3/4 bg-gray-100 rounded" />
            </div>
          ) : linkedIssue ? (
            <>
              {/* Priority + status badges */}
              <div className="flex flex-wrap items-center gap-2">
                <IssuePriorityBadge priority={linkedIssue.priority} />
                <IssueStatusBadge status={linkedIssue.status} />
              </div>

              {/* Assigned to */}
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Assigned to</span>
                {linkedIssue.assignee ? (
                  <span className="flex items-center gap-2 text-sm text-dark">
                    <div className="w-6 h-6 rounded-full bg-sprout-purple/10 flex items-center justify-center shrink-0">
                      <User className="w-3.5 h-3.5 text-sprout-purple" />
                    </div>
                    {linkedIssue.assignee.full_name}
                  </span>
                ) : (
                  <span className="text-sm text-dark-secondary italic">Unassigned</span>
                )}
              </div>

              {/* Issue data block — clickable */}
              <button
                onClick={() => setShowIssueModal(true)}
                className="text-left w-full rounded-xl hover:shadow-md transition-all"
              >
                <LinkedIssueBlock issue={linkedIssue} />
              </button>

              {/* Issue History */}
              {issueHistory.length > 0 && (
                <div className="flex flex-col gap-2 pt-1 border-t border-surface-border">
                  <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wide flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Issue History
                  </p>
                  <div className="flex flex-col gap-2">
                    {issueHistory.map((entry) => (
                      <div key={entry.id} className="flex items-start gap-2.5 text-xs">
                        <div className="w-5 h-5 rounded-full bg-sprout-purple/10 flex items-center justify-center shrink-0 mt-0.5">
                          <User className="w-3 h-3 text-sprout-purple" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-dark">{entry.profiles?.full_name ?? "System"}</span>
                          <span className="text-dark-secondary"> changed status </span>
                          {entry.previous_status && (
                            <>
                              <IssueStatusBadge status={entry.previous_status as IssueStatus} />
                              <span className="text-dark-secondary mx-1">→</span>
                            </>
                          )}
                          <IssueStatusBadge status={entry.new_status as IssueStatus} />
                          {entry.comment && (
                            <p className="text-dark-secondary mt-0.5 italic">{entry.comment}</p>
                          )}
                        </div>
                        <span className="text-dark-secondary shrink-0 whitespace-nowrap">{timeAgo(entry.changed_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Thread — incident comments */}
              <div className="flex flex-col gap-3 pt-1 border-t border-surface-border">
                <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wide flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> Thread
                  <span className="font-normal normal-case">({incident.comments?.length ?? 0})</span>
                </p>

                {incident.comments && incident.comments.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {incident.comments.map((comment) => (
                      <div key={comment.id} className="flex gap-2.5">
                        <div className="w-6 h-6 rounded-full bg-sprout-purple/10 flex items-center justify-center shrink-0 mt-0.5">
                          <User className="w-3 h-3 text-sprout-purple" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-semibold text-dark">{comment.profiles?.full_name ?? "Unknown"}</span>
                            <span className="text-xs text-dark-secondary">{timeAgo(comment.created_at)}</span>
                          </div>
                          <p className="text-sm text-dark leading-relaxed">{comment.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-dark-secondary">No messages yet.</p>
                )}

                <div className="flex gap-2">
                  <input
                    className={clsx(inputCls, "flex-1")}
                    placeholder="Add a message…"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                    disabled={submittingComment}
                  />
                  <button
                    onClick={handleAddComment}
                    disabled={submittingComment || !commentBody.trim()}
                    className="bg-sprout-purple text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-60 shrink-0 flex items-center gap-1.5"
                  >
                    {submittingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Send
                  </button>
                </div>
                {commentError && <p className="text-xs text-red-500">{commentError}</p>}
              </div>
            </>
          ) : (
            <span className="text-sm text-dark-secondary italic">Issue data unavailable</span>
          )}
        </div>
      )}

      {/* Manage Incident — status update (last section) */}
      <div className="bg-white rounded-xl border border-surface-border p-5 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-dark flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-sprout-purple" />
          Manage Incident
        </h2>
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Update Status</p>
          <div className="flex gap-2 flex-wrap">
            {(["reported", "investigating", "closed"] as IncidentStatus[]).map((s) => {
              const cfg = INCIDENT_STATUS_CONFIG[s];
              const isActive = incident.status === s;
              const isSaving = statusChanging === s;
              return (
                <button
                  key={s}
                  onClick={() => isManager && handleStatusChange(s)}
                  disabled={!isManager || statusChanging !== null}
                  title={!isManager ? "Only managers can update status" : undefined}
                  className={clsx(
                    "flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border transition-all",
                    isActive
                      ? clsx(cfg.color, "ring-2 ring-offset-1 ring-current")
                      : isManager
                        ? "bg-white border-surface-border text-dark-secondary hover:border-sprout-purple/50 hover:text-dark"
                        : "bg-white border-surface-border text-dark-secondary opacity-50 cursor-default"
                  )}
                >
                  {isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                  {cfg.label}
                </button>
              );
            })}
          </div>
          {statusError && <p className="text-xs text-red-500">{statusError}</p>}
          {!isManager && (
            <p className="text-xs text-dark-secondary italic">Only managers and above can update the incident status.</p>
          )}
        </div>
      </div>

      {/* IssueDetailModal — opens when user clicks "View full issue" */}
      {showIssueModal && linkedIssue && (
        <IssueDetailModal
          issue={linkedIssue}
          onClose={() => setShowIssueModal(false)}
          onUpdated={(updated) => setLinkedIssue(updated)}
          isManager={isManager}
        />
      )}
    </div>
  );
}

// Incidents Tab — read-only list of auto-spawned incident reports
function IncidentsTab({ isManager, role, openId }: { isManager: boolean; role: string; openId?: string | null }) {
  const [incidents, setIncidents]         = useState<Incident[]>([]);
  const [loading, setLoading]             = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [search, setSearch]               = useState("");
  const [statusFilter, setStatusFilter]   = useState<IncidentStatus | "all">("all");
  const [severityFilter, setSeverityFilter] = useState("");
  const [fromDate, setFromDate]           = useState("");
  const [toDate, setToDate]               = useState("");
  const [showFilters, setShowFilters]     = useState(false);

  const loadIncidents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listIncidents({
        ...(role === "manager" && { my_team: true }),
      });
      const sorted = [...res.data].sort(
        (a, b) => new Date(b.incident_date).getTime() - new Date(a.incident_date).getTime()
      );
      setIncidents(sorted);
    } catch {
      setIncidents([]);
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => { loadIncidents(); }, [loadIncidents]);

  // Auto-open from inbox deep-link
  useEffect(() => {
    if (!openId || incidents.length === 0) return;
    const found = incidents.find((i) => i.id === openId);
    if (found) setSelectedIncident(found);
  }, [openId, incidents]);

  const handleUpdated = (updated: Incident) => {
    setIncidents((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    if (selectedIncident?.id === updated.id) setSelectedIncident(updated);
  };

  const filtered = incidents.filter((i) => {
    if (statusFilter !== "all" && i.status !== statusFilter) return false;
    if (severityFilter && i.severity !== severityFilter) return false;
    if (fromDate && new Date(i.incident_date) < new Date(fromDate)) return false;
    if (toDate && new Date(i.incident_date) > new Date(toDate + "T23:59:59")) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!i.title.toLowerCase().includes(q) && !(i.location_description ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const incidentFilterCount = [severityFilter, fromDate, toDate].filter(Boolean).length;
  const clearIncidentFilters = () => { setSeverityFilter(""); setFromDate(""); setToDate(""); };

  // Show detail pane when an incident is selected
  if (selectedIncident) {
    return (
      <IncidentDetailPane
        incident={selectedIncident}
        onBack={() => setSelectedIncident(null)}
        onUpdated={handleUpdated}
        isManager={isManager}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-dark-secondary">
          {loading ? "Loading…" : `${incidents.length} incident report${incidents.length !== 1 ? "s" : ""}`}
        </p>
        <p className="text-xs text-dark-secondary italic">Incident reports are automatically generated when a reported issue flags a safety risk or injury.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2">
        {/* Search bar — full width */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-secondary pointer-events-none" />
          <input
            className="border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40 w-full"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {/* Status chips + Filters button — All last */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-1.5 flex-wrap">
            {(["reported", "investigating", "closed", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={clsx(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                  statusFilter === s
                    ? "bg-sprout-cyan text-white border-sprout-cyan"
                    : "bg-white border-surface-border text-dark-secondary hover:border-sprout-cyan hover:text-sprout-cyan"
                )}
              >
                {s === "all" ? "All" : INCIDENT_STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              incidentFilterCount > 0
                ? "border-sprout-purple text-sprout-purple bg-sprout-purple/5"
                : "border-surface-border text-dark-secondary hover:bg-gray-50"
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {incidentFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-sprout-purple text-white text-[10px] font-bold flex items-center justify-center">{incidentFilterCount}</span>
            )}
          </button>
        </div>

        {/* Collapsible advanced filters */}
        {showFilters && (
          <div className="bg-gray-50 border border-surface-border rounded-xl p-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {/* Severity */}
              <div className="relative">
                <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}
                  className="appearance-none pl-3 pr-7 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40">
                  <option value="">All severity</option>
                  {(["low", "medium", "high", "critical"] as const).map((s) => (
                    <option key={s} value={s}>{INCIDENT_SEVERITY_CONFIG[s].label}</option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-dark-secondary" />
              </div>
            </div>
            {/* Date range */}
            <div className="flex items-center gap-2 flex-wrap">
              <Calendar className="w-3.5 h-3.5 text-dark-secondary shrink-0" />
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40"
                title="From date" />
              <span className="text-dark-secondary text-xs">–</span>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40"
                title="To date" />
              {incidentFilterCount > 0 && (
                <button onClick={clearIncidentFilters}
                  className="text-xs text-dark-secondary hover:text-dark flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 ml-auto">
                  <X className="w-3 h-3" /> Clear all
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-surface-border p-4 animate-pulse flex items-center gap-4">
              <div className="h-5 w-16 bg-gray-200 rounded-full" />
              <div className="flex-1 h-4 w-1/2 bg-gray-200 rounded" />
              <div className="h-4 w-20 bg-gray-100 rounded" />
              <div className="h-4 w-16 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center bg-white rounded-2xl border border-surface-border">
          <ShieldAlert className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-dark-secondary text-sm font-medium">
            {incidents.length === 0 ? "No incident reports yet" : "No results match your filters"}
          </p>
          <p className="text-dark-secondary text-xs mt-1">
            {incidents.length === 0
              ? "Reports appear here automatically when an issue flags a safety risk or injury."
              : "Try adjusting your search or status filter."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-gray-50/60">
                <th className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary uppercase tracking-wide">Severity</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary uppercase tracking-wide">Title</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary uppercase tracking-wide hidden sm:table-cell">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary uppercase tracking-wide hidden md:table-cell">Issue reported by</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary uppercase tracking-wide hidden lg:table-cell">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary uppercase tracking-wide">Linked issue</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((incident, idx) => {
                const sevCfg = INCIDENT_SEVERITY_CONFIG[incident.severity] ?? INCIDENT_SEVERITY_CONFIG.medium;
                const stCfg  = INCIDENT_STATUS_CONFIG[incident.status]   ?? INCIDENT_STATUS_CONFIG.reported;
                return (
                  <tr
                    key={incident.id}
                    onClick={() => setSelectedIncident(incident)}
                    className={clsx(
                      "cursor-pointer hover:bg-sprout-purple/5 transition-colors",
                      idx !== filtered.length - 1 ? "border-b border-surface-border" : ""
                    )}
                  >
                    <td className="px-4 py-3">
                      <span className={clsx("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold", sevCfg.color)}>
                        {sevCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-dark truncate max-w-[260px]">{incident.title}</p>
                      {incident.location_description && (
                        <p className="text-xs text-dark-secondary flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 shrink-0" />{incident.location_description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className={clsx("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold", stCfg.color)}>
                        {stCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-dark-secondary text-xs">
                      {incident.reporter?.full_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-dark-secondary text-xs whitespace-nowrap">
                      {formatDateTime(incident.incident_date)}
                    </td>
                    <td className="px-4 py-3">
                      {incident.related_issue_id ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                          <ClipboardList className="w-3 h-3" />
                          View issue
                        </span>
                      ) : (
                        <span className="text-xs text-dark-secondary">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}

// ── ISSUES TAB ────────────────────────────────────────────────────────────────

// Skeleton card
function SkeletonIssueCard() {
  return (
    <div className="bg-white rounded-xl border border-surface-border p-3 flex flex-col gap-2 animate-pulse">
      <div className="h-3.5 w-3/4 bg-gray-200 rounded" />
      <div className="h-3 w-1/2 bg-gray-100 rounded" />
      <div className="flex gap-1.5 mt-1">
        <div className="h-5 w-14 bg-gray-100 rounded-full" />
        <div className="h-5 w-16 bg-gray-100 rounded-full" />
      </div>
    </div>
  );
}

// Issue Kanban Card
function IssueCard({ issue, onClick, highlighted }: { issue: Issue; onClick: () => void; highlighted?: boolean }) {
  const isRecurring = issue.recurrence_count >= 2;
  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full text-left rounded-xl border p-3.5 flex flex-col gap-2 hover:shadow-md transition-all group",
        highlighted
          ? "bg-violet-50 border-violet-200 shadow-sm"
          : "bg-white border-surface-border hover:border-sprout-purple/30"
      )}
    >
      {/* Title */}
      <p className="text-sm font-semibold text-dark line-clamp-2 group-hover:text-sprout-purple transition-colors leading-snug">
        {issue.title}
      </p>

      {/* Priority + Recurring + System-generated badge */}
      <div className="flex flex-wrap gap-1">
        <IssuePriorityBadge priority={issue.priority} />
        {isRecurring && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-600">
            <RefreshCw className="w-3 h-3" />
            Recurring
          </span>
        )}
        {issue.related_incident_id && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
            <AlertTriangle className="w-3 h-3" />
            From Incident
          </span>
        )}
      </div>

      {/* Category */}
      {issue.issue_categories && (
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: issue.issue_categories.color ?? "#6B7280" }}
          />
          <span className="text-xs text-dark-secondary truncate">{issue.issue_categories.name}</span>
        </div>
      )}

      {/* Location — combine location name + where exactly */}
      {(issue.locations?.name || issue.location_description) && (
        <div className="flex items-center gap-1.5 text-xs text-dark-secondary">
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate">
            {[issue.locations?.name, issue.location_description].filter(Boolean).join(" – ")}
          </span>
        </div>
      )}

      {/* Time ago */}
      <div className="flex items-center gap-1.5 text-xs text-dark-secondary">
        <Clock className="w-3 h-3 shrink-0" />
        {timeAgo(issue.created_at)}
      </div>
    </button>
  );
}

// Issue Detail Modal
function IssueDetailModal({
  issue: initialIssue,
  onClose,
  onUpdated,
  isManager,
}: {
  issue: Issue;
  onClose: () => void;
  onUpdated: (updated: Issue) => void;
  isManager: boolean;
}) {
  const [issue, setIssue]                   = useState<Issue>(initialIssue);
  const [commentBody, setCommentBody]       = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentError, setCommentError]     = useState("");
  const [statusChanging, setStatusChanging] = useState(false);
  const [statusError, setStatusError]       = useState("");

  // Priority override
  const [prioritySaving, setPrioritySaving] = useState(false);
  const [priorityError, setPriorityError]   = useState("");

  // Assign-to combobox
  const [assignSearch, setAssignSearch]     = useState("");
  const [assignResults, setAssignResults]   = useState<import("@/types").Profile[]>([]);
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [assignSaving, setAssignSaving]     = useState(false);
  const [assignError, setAssignError]       = useState("");

  const [loadingFull, setLoadingFull] = useState(true);
  const [viewAttachmentUrl, setViewAttachmentUrl] = useState<string | null>(null);

  // Load full issue data (attachments, comments, history)
  useEffect(() => {
    setLoadingFull(true);
    getIssue(initialIssue.id)
      .then((full) => {
        // Defensive merge: if the re-fetch returns no attachments but we already
        // have them (e.g. freshly uploaded), keep the ones we have.
        setIssue((prev) => ({
          ...full,
          attachments: (full.attachments ?? []).length > 0
            ? full.attachments
            : (prev.attachments ?? []),
        }));
      })
      .catch((e) => console.error("[IssueDetailModal] Failed to load issue details:", e))
      .finally(() => setLoadingFull(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIssue.id]);

  // User search for assign-to
  useEffect(() => {
    if (!assignSearch.trim()) { setAssignResults([]); return; }
    const t = setTimeout(() => {
      listUsers({ search: assignSearch, page_size: 8 })
        .then((r) => setAssignResults(r.items))
        .catch(() => setAssignResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [assignSearch]);

  const handleStatusChange = async (newStatus: string) => {
    setStatusChanging(true);
    setStatusError("");
    try {
      const updated = await updateIssueStatus(issue.id, newStatus);
      setIssue(updated);
      onUpdated(updated);
    } catch (e) {
      setStatusError(friendlyError(e));
    } finally {
      setStatusChanging(false);
    }
  };

  const handlePriorityChange = async (newPriority: IssuePriority) => {
    setPrioritySaving(true);
    setPriorityError("");
    try {
      const updated = await updateIssue(issue.id, { priority: newPriority });
      setIssue(updated);
      onUpdated(updated);
    } catch (e) {
      setPriorityError(friendlyError(e));
    } finally {
      setPrioritySaving(false);
    }
  };

  const handleAssign = async (userId: string, fullName: string) => {
    setAssignSaving(true);
    setAssignError("");
    setShowAssignPicker(false);
    setAssignSearch("");
    try {
      const updated = await updateIssue(issue.id, { assigned_to: userId });
      setIssue({ ...updated, assignee: { full_name: fullName } });
      onUpdated({ ...updated, assignee: { full_name: fullName } });
    } catch (e) {
      setAssignError(friendlyError(e));
    } finally {
      setAssignSaving(false);
    }
  };

  const handleUnassign = async () => {
    setAssignSaving(true);
    setAssignError("");
    try {
      const updated = await updateIssue(issue.id, { assigned_to: null });
      setIssue({ ...updated, assignee: null });
      onUpdated({ ...updated, assignee: null });
    } catch (e) {
      setAssignError(friendlyError(e));
    } finally {
      setAssignSaving(false);
    }
  };

  const handleAddComment = async () => {
    const body = commentBody.trim();
    if (!body) return;
    setSubmittingComment(true);
    setCommentError("");
    try {
      const comment = await addIssueComment(issue.id, body);
      setIssue((prev) => ({
        ...prev,
        comments: [...(prev.comments ?? []), comment],
      }));
      setCommentBody("");
    } catch (e) {
      setCommentError(friendlyError(e));
    } finally {
      setSubmittingComment(false);
    }
  };

  // Parse embedded notes out of description
  function parseDescription(desc: string | null) {
    if (!desc) return { clean: "", safetyRisk: false, unlistedEquipment: null as string | null };
    let clean = desc;
    let safetyRisk = false;
    let unlistedEquipment: string | null = null;
    if (clean.includes("⚠️ Safety risk reported.")) {
      safetyRisk = true;
      clean = clean.replace(/\n*⚠️ Safety risk reported\./, "");
    }
    const equipMatch = clean.match(/\n*\[Unlisted equipment: ([^\]]+)\]/);
    if (equipMatch) {
      unlistedEquipment = equipMatch[1];
      clean = clean.replace(/\n*\[Unlisted equipment: [^\]]+\]/, "");
    }
    return { clean: clean.trim(), safetyRisk, unlistedEquipment };
  }

  const { clean: cleanDesc, safetyRisk: hasSafetyRisk, unlistedEquipment } = parseDescription(issue.description);
  const comments = (issue.comments ?? [])
    .filter((c) => !c.is_deleted)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const history = [...(issue.status_history ?? [])]
    .sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());

  const STAFF_STATUSES: IssueStatus[]   = ["open", "in_progress", "resolved"];
  const MANAGER_STATUSES: IssueStatus[] = ["open", "in_progress", "pending_vendor", "resolved", "verified_closed"];
  const availableStatuses = isManager ? MANAGER_STATUSES : STAFF_STATUSES;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl flex flex-col max-h-[95vh] sm:max-h-[88vh] min-h-[480px]">

        {/* ── Header ── */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-surface-border shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <IssuePriorityBadge priority={issue.priority} />
              <IssueStatusBadge status={issue.status} />
              {issue.recurrence_count >= 2 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-600">
                  <RefreshCw className="w-3 h-3" /> Recurring ×{issue.recurrence_count}
                </span>
              )}
            </div>
            <h2 className="text-base font-semibold text-dark mt-1.5 leading-snug">{issue.title}</h2>
            <p className="text-xs text-dark-secondary mt-0.5 flex items-center gap-3 flex-wrap">
              {issue.reporter?.full_name && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3 shrink-0" />{issue.reporter.full_name}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 shrink-0" />{timeAgo(issue.created_at)}
              </span>
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto flex flex-col divide-y divide-surface-border">

          {/* Category + Description */}
          <div className="px-5 py-4 flex flex-col gap-2.5">
            {issue.issue_categories && (
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: issue.issue_categories.color ?? "#6B7280" }}
                />
                <span className="text-sm font-medium text-dark">{issue.issue_categories.name}</span>
              </div>
            )}
            {cleanDesc && (
              <p className="text-sm text-dark-secondary whitespace-pre-wrap">{cleanDesc}</p>
            )}
          </div>

          {/* Location & Context */}
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide mb-3">Details</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {issue.locations?.name && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-dark-secondary">Location</span>
                  <div className="flex items-center gap-1.5 text-sm text-dark">
                    <MapPin className="w-3.5 h-3.5 text-dark-secondary shrink-0" />
                    <span>{issue.locations.name}</span>
                  </div>
                </div>
              )}
              {issue.location_description && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-dark-secondary">Where Exactly</span>
                  <p className="text-sm text-dark">{issue.location_description}</p>
                </div>
              )}
              {(issue.asset_id || unlistedEquipment) && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-dark-secondary">Equipment</span>
                  <div className="flex items-center gap-1.5 text-sm text-dark">
                    <Wrench className="w-3.5 h-3.5 text-dark-secondary shrink-0" />
                    <span className="truncate">{unlistedEquipment ?? issue.asset_id}</span>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-dark-secondary">Anyone Hurt / Safety Risk</span>
                {hasSafetyRisk ? (
                  <div className="flex items-center gap-1.5 text-sm font-medium text-amber-600">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> Yes — Safety risk
                  </div>
                ) : (
                  <span className="text-sm text-dark-secondary">No</span>
                )}
              </div>
            </div>
          </div>

          {/* Photo attachments — always rendered so state is visible */}
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide mb-3">Photo</p>
            {loadingFull ? (
              <div className="flex gap-2">
                <div className="w-24 h-24 rounded-xl bg-gray-100 animate-pulse" />
              </div>
            ) : (issue.attachments ?? []).filter((a) => a.file_type === "image").length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(issue.attachments ?? []).filter((a) => a.file_type === "image").map((att) => (
                  <button key={att.id} type="button" onClick={() => setViewAttachmentUrl(att.file_url)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={att.file_url}
                      alt="Attachment"
                      className="w-24 h-24 object-cover rounded-xl border border-surface-border hover:opacity-90 transition cursor-zoom-in"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-dark-secondary italic">No photo attached</p>
            )}
          </div>

          {/* Attachment lightbox */}
          {viewAttachmentUrl && (
            <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"
              onClick={() => setViewAttachmentUrl(null)}>
              <button type="button" onClick={() => setViewAttachmentUrl(null)}
                className="absolute top-4 right-4 w-9 h-9 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors">
                <X className="w-5 h-5 text-white" />
              </button>
              <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={viewAttachmentUrl} alt="Attachment" className="w-full rounded-xl object-contain max-h-[80vh]" />
              </div>
            </div>
          )}

          {/* ── Manager controls ── */}
          {isManager && (
            <div className="px-5 py-4 flex flex-col gap-4 bg-surface-page/40">
              <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide">Manage Issue</p>

              {/* Priority override */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-dark-secondary flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5" /> Override Priority
                </label>
                <div className="flex items-center gap-2">
                  <select
                    className={clsx(inputCls, "flex-1")}
                    value={issue.priority}
                    onChange={(e) => handlePriorityChange(e.target.value as IssuePriority)}
                    disabled={prioritySaving}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                  {prioritySaving && <Loader2 className="w-4 h-4 animate-spin text-sprout-purple shrink-0" />}
                </div>
                {priorityError && <p className="text-xs text-red-500">{priorityError}</p>}
              </div>

              {/* Assign to */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-dark-secondary flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Assigned To
                  <span className="text-amber-500 text-[10px] font-medium">· required to update status</span>
                </label>
                {issue.assignee ? (
                  <div className="flex items-center justify-between px-3 py-2 rounded-xl border-2 border-sprout-purple bg-sprout-purple/5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-sprout-purple/10 flex items-center justify-center text-xs font-bold text-sprout-purple shrink-0">
                        {issue.assignee.full_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-dark">{issue.assignee.full_name}</span>
                    </div>
                    <button type="button" onClick={handleUnassign} disabled={assignSaving} className="p-1 hover:bg-white/60 rounded-lg">
                      {assignSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5 text-dark/40" />}
                    </button>
                  </div>
                ) : (
                  <div className="border border-surface-border rounded-xl overflow-hidden focus-within:border-sprout-purple/50 focus-within:ring-2 focus-within:ring-sprout-purple/20 transition-all bg-white">
                    <div className="flex items-center px-3 py-2 gap-2">
                      <Search className="w-4 h-4 text-dark-secondary shrink-0" />
                      <input
                        className="flex-1 text-sm text-dark placeholder:text-dark-secondary focus:outline-none bg-transparent"
                        placeholder="Search users to assign…"
                        value={assignSearch}
                        onChange={(e) => { setAssignSearch(e.target.value); setShowAssignPicker(true); }}
                        onFocus={() => setShowAssignPicker(true)}
                      />
                      {assignSaving && <Loader2 className="w-3.5 h-3.5 animate-spin text-sprout-purple shrink-0" />}
                    </div>
                    {showAssignPicker && assignResults.length > 0 && (
                      <div className="border-t border-surface-border max-h-44 overflow-y-auto divide-y divide-surface-border">
                        {assignResults.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => handleAssign(u.id, u.full_name)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
                          >
                            <div className="w-7 h-7 rounded-full bg-sprout-purple/10 flex items-center justify-center shrink-0 text-xs font-bold text-sprout-purple">
                              {u.full_name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-dark truncate">{u.full_name}</p>
                              <p className="text-xs text-dark-secondary truncate capitalize">{u.role}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {assignError && <p className="text-xs text-red-500">{assignError}</p>}
              </div>

              {/* Status chips — manager */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-dark-secondary uppercase tracking-wide">Update Status</label>
                {!issue.assignee && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" /> Assign to someone first
                  </p>
                )}
                {statusError && <p className="text-xs text-red-500">{statusError}</p>}
                <div className="flex flex-wrap gap-2">
                  {availableStatuses.filter((s) => s !== issue.status).map((s) => {
                    const col = KANBAN_COLUMNS.find((c) => c.key === s)!;
                    const isDisabled = statusChanging || !issue.assignee;
                    return (
                      <button
                        key={s}
                        disabled={isDisabled}
                        onClick={() => handleStatusChange(s)}
                        className={clsx(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                          "border-surface-border text-dark-secondary hover:border-sprout-purple hover:text-sprout-purple hover:bg-sprout-purple/5",
                          isDisabled && "opacity-40 cursor-not-allowed"
                        )}
                      >
                        {statusChanging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : col.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Staff status chips ── */}
          {!isManager && (
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide mb-3">Update Status</p>
              {statusError && <p className="text-xs text-red-500 mb-2">{statusError}</p>}
              <div className="flex flex-wrap gap-2">
                {availableStatuses.filter((s) => s !== issue.status).map((s) => {
                  const col = KANBAN_COLUMNS.find((c) => c.key === s)!;
                  return (
                    <button
                      key={s}
                      disabled={statusChanging}
                      onClick={() => handleStatusChange(s)}
                      className={clsx(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                        "border-surface-border text-dark-secondary hover:border-sprout-purple hover:text-sprout-purple hover:bg-sprout-purple/5",
                        statusChanging && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {statusChanging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : col.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── History ── */}
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> History
            </p>
            {loadingFull ? (
              <div className="flex flex-col gap-2 animate-pulse">
                <div className="h-3 w-2/3 bg-gray-100 rounded" />
                <div className="h-3 w-1/2 bg-gray-100 rounded" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-xs text-dark-secondary italic">No status changes yet.</p>
            ) : (
              <div className="flex flex-col gap-0 divide-y divide-surface-border">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 py-2 text-xs flex-wrap">
                    <div className="w-5 h-5 rounded-full bg-sprout-purple/10 flex items-center justify-center shrink-0">
                      <User className="w-3 h-3 text-sprout-purple" />
                    </div>
                    <span className="font-medium text-dark">{h.profiles?.full_name ?? "Unknown"}</span>
                    <span className="text-dark-secondary">changed status</span>
                    {h.previous_status && (
                      <>
                        <IssueStatusBadge status={h.previous_status as IssueStatus} />
                        <ChevronRight className="w-3 h-3 text-dark-secondary shrink-0" />
                      </>
                    )}
                    <IssueStatusBadge status={h.new_status as IssueStatus} />
                    {h.comment && (
                      <span className="text-dark-secondary italic">"{h.comment}"</span>
                    )}
                    <span className="ml-auto text-dark-secondary">{timeAgo(h.changed_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Thread / Comments (all roles) ── */}
          <div className="px-5 py-4 flex flex-col gap-3">
            <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> Thread
              {comments.length > 0 && (
                <span className="bg-sprout-purple text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {comments.length}
                </span>
              )}
            </p>
            {comments.length === 0 && (
              <p className="text-xs text-gray-400 italic">No comments yet — be the first.</p>
            )}
            <div className="flex flex-col gap-3">
              {comments.map((c) => (
                <div key={c.id} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-dark">{c.profiles?.full_name ?? "Unknown"}</span>
                    <span className="text-xs text-dark-secondary">{timeAgo(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-dark bg-surface-page rounded-xl px-3 py-2 border border-surface-border whitespace-pre-wrap">
                    {c.body}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-1">
              <input
                className="flex-1 border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/40"
                placeholder="Write a comment…"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                disabled={submittingComment}
              />
              <button
                onClick={handleAddComment}
                disabled={submittingComment || !commentBody.trim()}
                className="p-2 bg-sprout-purple text-white rounded-lg hover:bg-sprout-purple/90 disabled:opacity-50"
              >
                {submittingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            {commentError && <p className="text-xs text-red-500">{commentError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Report Issue Modal
// ── Staff "Report a Problem" modal ────────────────────────────────────────────

// Category → emoji icon mapping (fallback to 🔧)
const CATEGORY_ICON_MAP: Record<string, string> = {
  equipment: "🔧", electrical: "⚡", plumbing: "🚿", safety: "🦺",
  cleanliness: "🧹", pest: "🐛", structural: "🏗️", it: "🖥️",
  refrigeration: "❄️", fire: "🔥", hvac: "🌡️", default: "⚠️",
};
function categoryIcon(cat: IssueCategory): string {
  if (cat.icon) return cat.icon;
  const name = cat.name.toLowerCase();
  for (const [key, icon] of Object.entries(CATEGORY_ICON_MAP)) {
    if (name.includes(key)) return icon;
  }
  return CATEGORY_ICON_MAP.default;
}

// Asset category → emoji
function assetIcon(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("refriger") || c.includes("cooler") || c.includes("freezer")) return "❄️";
  if (c.includes("pos") || c.includes("computer") || c.includes("terminal")) return "🖥️";
  if (c.includes("fryer") || c.includes("grill") || c.includes("oven") || c.includes("kitchen")) return "🍳";
  if (c.includes("hvac") || c.includes("air") || c.includes("heat")) return "🌡️";
  if (c.includes("electric") || c.includes("power")) return "⚡";
  return "🔧";
}

function ReportProblemModal({
  categories,
  onClose,
  onSuccess,
}: {
  categories: IssueCategory[];
  onClose: () => void;
  onSuccess: (issue: Issue) => void;
}) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [description, setDescription] = useState("");
  const [locationDesc, setLocationDesc] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [safetyRisk, setSafetyRisk] = useState<"yes" | "no" | "">("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [unlisted, setUnlisted] = useState("");

  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [incidentBanner, setIncidentBanner] = useState<Issue | null>(null);
  const [error, setError] = useState("");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // AI state
  const [aiClassifying, setAiClassifying] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{
    category_id: string; priority: string; suggested_title: string;
    is_safety_risk: boolean; reasoning: string;
  } | null>(null);
  const [aiError, setAiError] = useState("");
  const [aiPhotoAnalysing, setAiPhotoAnalysing] = useState(false);
  const [aiPhotoResult, setAiPhotoResult] = useState<{
    safety_hazard_detected: boolean; hazard_description: string | null;
    suggested_priority: string; ai_description: string;
  } | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);

  // Load assets at user's location
  useEffect(() => {
    setAssetsLoading(true);
    createClient().auth.getSession().then(({ data }) => {
      const locationId = data.session?.user?.app_metadata?.location_id as string | undefined;
      listAssets(locationId ? { location_id: locationId } : {})
        .then((r) => setAssets(r.data ?? []))
        .catch(() => setAssets([]))
        .finally(() => setAssetsLoading(false));
    });
  }, []);

  const filteredAssets = assetSearch.trim()
    ? assets.filter((a) => a.name.toLowerCase().includes(assetSearch.toLowerCase()))
    : assets;

  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;
  const filteredCategories = categorySearch.trim()
    ? categories.filter((c) => c.name.toLowerCase().includes(categorySearch.toLowerCase()))
    : categories;

  function handlePhotoChange(file: File) {
    setPhotoFile(file);
    setAiPhotoResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setPhotoPreview(dataUrl);
      // Auto-analyse photo with AI
      setAiPhotoAnalysing(true);
      analysePhoto({ image_url: dataUrl, description: description })
        .then((res) => setAiPhotoResult(res))
        .catch(() => {/* non-fatal */})
        .finally(() => setAiPhotoAnalysing(false));
    };
    reader.readAsDataURL(file);
  }

  async function handleAiClassify() {
    if (!title.trim() || !description.trim()) return;
    setAiClassifying(true);
    setAiError("");
    setAiSuggestion(null);
    try {
      const result = await classifyIssue({
        title: title.trim(),
        description: description.trim(),
        available_categories: categories.map((c) => ({ id: c.id, name: c.name })),
      });
      setAiSuggestion(result);
    } catch {
      setAiError("AI classification failed. Please try again.");
    } finally {
      setAiClassifying(false);
    }
  }

  function acceptAiSuggestion() {
    if (!aiSuggestion) return;
    if (aiSuggestion.category_id) setCategoryId(aiSuggestion.category_id);
    if (aiSuggestion.is_safety_risk) setSafetyRisk("yes");
    setAiSuggestion(null);
  }

  // Determine priority: use category default, escalate to "high" if safety risk
  function buildPriority(): IssuePriority {
    const base: IssuePriority = selectedCategory?.default_priority ?? "medium";
    if (safetyRisk === "yes" && (base === "low" || base === "medium")) return "high";
    return base;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = "Please enter a title.";
    if (!categoryId) errs.category = "Please select a category.";
    if (!description.trim()) errs.description = "Please describe the problem.";
    if (!safetyRisk) errs.safetyRisk = "Please indicate if anyone was hurt or there was a safety risk.";
    if (Object.keys(errs).length > 0) { setValidationErrors(errs); return; }
    setValidationErrors({});
    setError("");
    setSubmitting(true);
    try {
      const session = await createClient().auth.getSession();
      const locationId = session.data.session?.user?.app_metadata?.location_id as string | undefined;

      const assetNote = unlisted ? `\n\n[Unlisted equipment: ${unlisted}]` : "";
      const safetyNote = safetyRisk === "yes" ? "\n\n⚠️ Safety risk reported." : "";

      let issue = await createIssue({
        title: title.trim(),
        description: description.trim() + assetNote + safetyNote,
        category_id: categoryId,
        priority: buildPriority(),
        location_description: locationDesc.trim() || undefined,
        location_id: locationId || undefined,
        asset_id: selectedAsset?.id || undefined,
        is_safety_risk: safetyRisk === "yes",
      });

      // Upload photo if provided — merge returned attachment into issue so
      // the card shows the photo immediately without waiting for a detail re-fetch
      if (photoFile) {
        try {
          const uploadResult = await uploadIssueAttachments(issue.id, [photoFile]);
          if (uploadResult.data && uploadResult.data.length > 0) {
            issue = { ...issue, attachments: uploadResult.data as IssueAttachment[] };
          }
        } catch {
          // Non-fatal — issue is created, photo just didn't attach
        }
      }

      if (safetyRisk === "yes") {
        // Show incident banner before closing — auto-dismiss after 4 s
        setIncidentBanner(issue);
        setTimeout(() => onSuccess(issue), 4000);
      } else {
        onSuccess(issue);
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  // Incident banner — shown after a safety-risk submission
  if (incidentBanner) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
            <ShieldAlert className="w-7 h-7 text-red-500" />
          </div>
          <div>
            <p className="text-base font-bold text-dark mb-1">Problem reported</p>
            <p className="text-sm text-dark-secondary leading-relaxed">
              Because you flagged a safety risk, an incident report has been automatically generated and is now with your manager and admin for review.
            </p>
          </div>
          <button
            onClick={() => onSuccess(incidentBanner)}
            className="mt-1 px-5 py-2 rounded-lg bg-sprout-purple text-white text-sm font-medium hover:bg-sprout-purple/90 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-surface-border">
          <h2 className="text-base font-bold text-dark">Report a Problem</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-dark-secondary" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">

          {/* Title */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Title <span className="text-red-500">*</span></label>
            <input
              className={inputCls}
              placeholder="e.g. Broken fryer in main kitchen"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            {validationErrors.title && <p className="text-xs text-red-500">{validationErrors.title}</p>}
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">What&apos;s the problem? <span className="text-red-500">*</span></label>
            <textarea
              className={clsx(inputCls, "resize-none")}
              rows={3}
              placeholder="Describe what you see…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {validationErrors.description && <p className="text-xs text-red-500">{validationErrors.description}</p>}
          </div>

          {/* AI Classify button — shown once title + description are filled */}
          {title.trim() && description.trim() && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleAiClassify}
                disabled={aiClassifying}
                className={clsx(
                  "flex items-center gap-2 self-start px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-60",
                  aiClassifying
                    ? "border border-sprout-purple/40 bg-sprout-purple/5 text-sprout-purple"
                    : "ai-sparkle-btn shadow-sm shadow-purple-200"
                )}
              >
                {aiClassifying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {aiClassifying ? "Analysing…" : "Analyse with AI"}
              </button>

              {aiError && (
                <p className="text-xs text-red-500">{aiError}</p>
              )}

              {aiSuggestion && (
                <div className="rounded-xl border border-sprout-purple/30 bg-sprout-purple/5 px-4 py-3 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-sprout-purple">
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      AI suggestion
                    </div>
                    <button type="button" onClick={() => setAiSuggestion(null)} className="text-dark/30 hover:text-dark/60">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-dark-secondary leading-relaxed">
                    {[
                      categories.find((c) => c.id === aiSuggestion.category_id)?.name
                        ? `Category: ${categories.find((c) => c.id === aiSuggestion.category_id)!.name}`
                        : null,
                      aiSuggestion.priority ? `Priority: ${aiSuggestion.priority.charAt(0).toUpperCase() + aiSuggestion.priority.slice(1)}` : null,
                      aiSuggestion.is_safety_risk ? "Safety risk detected ⚠️" : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                  {aiSuggestion.is_safety_risk && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-700 font-medium">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                      AI flagged this as a potential safety risk
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={acceptAiSuggestion}
                    className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sprout-purple text-white text-xs font-medium hover:bg-sprout-purple/90 transition-colors"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Accept suggestions
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Category */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Category <span className="text-red-500">*</span></label>
            {selectedCategory ? (
              <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border-2 border-sprout-purple bg-sprout-purple/5">
                <div className="flex items-center gap-2">
                  <span className="text-lg leading-none">{categoryIcon(selectedCategory)}</span>
                  <span className="text-sm font-medium text-dark">{selectedCategory.name}</span>
                </div>
                <button type="button" onClick={() => { setCategoryId(""); setCategorySearch(""); }} className="p-1 hover:bg-white/60 rounded-lg">
                  <X className="w-3.5 h-3.5 text-dark/40" />
                </button>
              </div>
            ) : (
              <div className="border border-surface-border rounded-xl overflow-hidden focus-within:border-sprout-purple/50 focus-within:ring-2 focus-within:ring-sprout-purple/20 transition-all">
                <div className="flex items-center px-3 py-2.5 gap-2">
                  <Search className="w-4 h-4 text-dark-secondary shrink-0" />
                  <input
                    className="flex-1 text-sm text-dark placeholder:text-dark-secondary focus:outline-none bg-transparent"
                    placeholder="Search categories…"
                    value={categorySearch}
                    onChange={(e) => { setCategorySearch(e.target.value); setShowCategoryPicker(true); }}
                    onFocus={() => setShowCategoryPicker(true)}
                  />
                  {categorySearch && (
                    <button type="button" onClick={() => { setCategorySearch(""); setShowCategoryPicker(false); }}>
                      <X className="w-3.5 h-3.5 text-dark/30 hover:text-dark/60" />
                    </button>
                  )}
                </div>
                {showCategoryPicker && (
                  <div className="border-t border-surface-border max-h-52 overflow-y-auto divide-y divide-surface-border">
                    {filteredCategories.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-dark-secondary text-center">No categories found</p>
                    ) : filteredCategories.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => { setCategoryId(cat.id); setShowCategoryPicker(false); setCategorySearch(""); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
                      >
                        <span className="text-lg leading-none shrink-0">{categoryIcon(cat)}</span>
                        <span className="text-sm font-medium text-dark truncate">{cat.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {validationErrors.category && <p className="text-xs text-red-500">{validationErrors.category}</p>}
          </div>

          {/* Priority preview — appears once category is chosen */}
          {selectedCategory && (
            <div className="rounded-xl border border-surface-border bg-gray-50 px-4 py-3 flex items-center gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-dark-secondary uppercase tracking-wide font-medium">Priority</span>
                <IssuePriorityBadge priority={buildPriority()} />
              </div>
              {safetyRisk === "yes" && (
                <div className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  Escalated due to safety risk
                </div>
              )}
            </div>
          )}

          {/* Location */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Where exactly?</label>
            <input
              className={inputCls}
              placeholder="Near the fryer / Front entrance / Storage room…"
              value={locationDesc}
              onChange={(e) => setLocationDesc(e.target.value)}
            />
          </div>

          {/* Equipment picker */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark flex items-center gap-1.5">
              Which equipment?
              <span className="text-xs text-dark-secondary font-normal">(optional)</span>
            </label>

            {selectedAsset ? (
              <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border-2 border-sprout-purple bg-sprout-purple/5">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{assetIcon(selectedAsset.category)}</span>
                  <div>
                    <p className="text-sm font-medium text-dark">{selectedAsset.name}</p>
                    <p className="text-xs text-dark-secondary">{selectedAsset.category}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setSelectedAsset(null)} className="p-1 hover:bg-white/60 rounded-lg">
                  <X className="w-3.5 h-3.5 text-dark/40" />
                </button>
              </div>
            ) : (
              <div className="border border-surface-border rounded-xl overflow-hidden focus-within:border-sprout-purple/50 focus-within:ring-2 focus-within:ring-sprout-purple/20 transition-all">
                <div className="flex items-center px-3 py-2.5 gap-2">
                  <Search className="w-4 h-4 text-dark-secondary shrink-0" />
                  <input
                    className="flex-1 text-sm text-dark placeholder:text-dark-secondary focus:outline-none bg-transparent"
                    placeholder={assetsLoading ? "Loading equipment…" : "Search equipment…"}
                    value={assetSearch}
                    onChange={(e) => { setAssetSearch(e.target.value); setShowAssetPicker(true); }}
                    onFocus={() => setShowAssetPicker(true)}
                    disabled={assetsLoading}
                  />
                  {assetSearch && (
                    <button type="button" onClick={() => { setAssetSearch(""); setShowAssetPicker(false); }}>
                      <X className="w-3.5 h-3.5 text-dark/30 hover:text-dark/60" />
                    </button>
                  )}
                </div>
                {showAssetPicker && (
                  <div className="border-t border-surface-border">
                    <div className="max-h-44 overflow-y-auto divide-y divide-surface-border">
                      {filteredAssets.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-dark-secondary text-center">No equipment found</p>
                      ) : filteredAssets.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => { setSelectedAsset(asset); setShowAssetPicker(false); setAssetSearch(""); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
                        >
                          <span className="text-lg leading-none shrink-0">{assetIcon(asset.category)}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-dark truncate">{asset.name}</p>
                            <p className="text-xs text-dark-secondary truncate">{asset.category}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-surface-border">
                      <button
                        type="button"
                        onClick={() => { setShowAssetPicker(false); setUnlisted(unlisted || " "); }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 text-sm text-sprout-purple font-medium transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Report unlisted equipment
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Unlisted equipment text field */}
            {!selectedAsset && unlisted !== "" && (
              <input
                className={inputCls}
                placeholder="Describe the equipment…"
                value={unlisted}
                onChange={(e) => setUnlisted(e.target.value)}
              />
            )}
          </div>

          {/* Safety risk — required */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-dark">
              Was anyone hurt or was there a safety risk?{" "}
              <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-4">
              {(["yes", "no"] as const).map((val) => (
                <label key={val} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="safetyRisk"
                    value={val}
                    checked={safetyRisk === val}
                    onChange={() => setSafetyRisk(val)}
                    className="accent-sprout-purple"
                  />
                  <span className="text-sm text-dark capitalize">{val === "yes" ? "Yes" : "No"}</span>
                </label>
              ))}
            </div>
            {validationErrors.safetyRisk && (
              <p className="text-xs text-red-500">{validationErrors.safetyRisk}</p>
            )}
          </div>

          {/* Photo */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-dark flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-dark-secondary" />
              Add photo
              <span className="text-xs text-dark-secondary font-normal">(optional)</span>
            </label>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoChange(f); }}
            />
            {photoPreview ? (
              <div className="relative w-full max-w-[200px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoPreview} alt="Preview" className="w-full rounded-xl border border-surface-border object-cover max-h-32" />
                <button type="button" onClick={() => { setPhotoFile(null); setPhotoPreview(null); setAiPhotoResult(null); }}
                  className="absolute top-1 right-1 bg-white/90 rounded-full p-0.5 shadow">
                  <X className="w-3 h-3 text-red-500" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="flex items-center gap-2 border-2 border-dashed border-sprout-purple/30 bg-sprout-purple/5 hover:bg-sprout-purple/10 rounded-xl px-4 py-3 text-sm text-sprout-purple font-medium transition-colors"
              >
                <ImagePlus className="w-4 h-4" />
                Tap to add photo
              </button>
            )}

            {/* AI photo hazard analysis */}
            {aiPhotoAnalysing && (
              <div className="flex items-center gap-2 text-xs text-dark-secondary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Analysing photo for hazards…
              </div>
            )}
            {!aiPhotoAnalysing && aiPhotoResult && (
              aiPhotoResult.safety_hazard_detected ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <p className="text-xs font-medium text-red-700">
                      AI detected a potential safety hazard: {aiPhotoResult.hazard_description ?? aiPhotoResult.ai_description}
                    </p>
                    {safetyRisk !== "yes" && (
                      <button
                        type="button"
                        onClick={() => setSafetyRisk("yes")}
                        className="self-start text-xs text-red-600 underline hover:no-underline"
                      >
                        Flag as safety risk
                      </button>
                    )}
                  </div>
                  <button type="button" onClick={() => setAiPhotoResult(null)} className="text-red-400 hover:text-red-600 shrink-0">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                  <CheckCircle className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  <p className="text-xs text-green-700 flex-1">No obvious hazard detected</p>
                  <button type="button" onClick={() => setAiPhotoResult(null)} className="text-green-400 hover:text-green-600 shrink-0">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-surface-border hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="flex-1 bg-sprout-purple text-white rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-sprout-purple/90 disabled:opacity-60">
              {submitting ? "Submitting…" : "Submit Report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// ── Manager "Report Issue / Create Issue" modal ────────────────────────────────

function ReportIssueModal({
  categories,
  onClose,
  onSuccess,
}: {
  categories: IssueCategory[];
  onClose: () => void;
  onSuccess: (issue: Issue) => void;
}) {
  const [categoryId, setCategoryId]           = useState("");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [categorySearch, setCategorySearch]   = useState("");
  const [description, setDescription]         = useState("");
  const [priority, setPriority]               = useState<IssuePriority>("medium");
  const [locationDesc, setLocationDesc]       = useState("");
  const [selectedAsset, setSelectedAsset]     = useState<Asset | null>(null);
  const [assetSearch, setAssetSearch]         = useState("");
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [assets, setAssets]                   = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading]     = useState(false);
  const [unlisted, setUnlisted]               = useState("");
  const [assignedTo, setAssignedTo]           = useState("");
  const [safetyRisk, setSafetyRisk]           = useState<"yes" | "no" | "">("");
  const [titleOverride, setTitleOverride]     = useState("");
  const [customizeTitle, setCustomizeTitle]   = useState(false);
  const [submitting, setSubmitting]           = useState(false);
  const [error, setError]                     = useState("");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // AI state
  const [aiClassifying, setAiClassifying]     = useState(false);
  const [aiSuggestion, setAiSuggestion]       = useState<{
    category_id: string; priority: string; suggested_title: string;
    is_safety_risk: boolean; reasoning: string;
  } | null>(null);
  const [aiError, setAiError]                 = useState("");

  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;
  const filteredCategories = categorySearch.trim()
    ? categories.filter((c) => c.name.toLowerCase().includes(categorySearch.toLowerCase()))
    : categories;

  // Auto-set priority from category's default when category changes
  useEffect(() => {
    if (selectedCategory?.default_priority) {
      setPriority(selectedCategory.default_priority);
    }
  }, [categoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAssetsLoading(true);
    listAssets({})
      .then((r) => setAssets(r.data ?? []))
      .catch(() => setAssets([]))
      .finally(() => setAssetsLoading(false));
  }, []);

  const filteredAssets = assetSearch.trim()
    ? assets.filter((a) => a.name.toLowerCase().includes(assetSearch.toLowerCase()))
    : assets;

  async function handleAiClassifyMgr() {
    const titleForAi = effectiveTitle.trim() || buildAutoTitle().trim();
    if (!titleForAi && !description.trim()) return;
    setAiClassifying(true);
    setAiError("");
    setAiSuggestion(null);
    try {
      const result = await classifyIssue({
        title: titleForAi || description.trim().slice(0, 80),
        description: description.trim() || titleForAi,
        available_categories: categories.map((c) => ({ id: c.id, name: c.name })),
      });
      setAiSuggestion(result);
    } catch {
      setAiError("AI classification failed. Please try again.");
    } finally {
      setAiClassifying(false);
    }
  }

  function acceptAiSuggestionMgr() {
    if (!aiSuggestion) return;
    if (aiSuggestion.category_id) setCategoryId(aiSuggestion.category_id);
    if (aiSuggestion.priority) setPriority(aiSuggestion.priority as IssuePriority);
    if (aiSuggestion.suggested_title) { setCustomizeTitle(true); setTitleOverride(aiSuggestion.suggested_title); }
    if (aiSuggestion.is_safety_risk) setSafetyRisk("yes");
    setAiSuggestion(null);
  }

  // Auto-generate title from category + asset
  function buildAutoTitle(): string {
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return "";
    const assetPart = selectedAsset ? ` — ${selectedAsset.name}` : unlisted.trim() ? ` — ${unlisted.trim()}` : "";
    return `${cat.name}${assetPart}`;
  }

  const autoTitle = buildAutoTitle();
  const effectiveTitle = customizeTitle ? titleOverride : autoTitle;

  // Auto-bump priority to high on safety risk
  const effectivePriority: IssuePriority =
    safetyRisk === "yes" && (priority === "low" || priority === "medium") ? "high" : priority;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!categoryId) errs.category = "Category is required.";
    if (!effectiveTitle.trim()) errs.title = "Title cannot be empty. Select a category first.";
    if (Object.keys(errs).length > 0) { setValidationErrors(errs); return; }
    setValidationErrors({});
    setError("");
    setSubmitting(true);
    try {
      const session = await createClient().auth.getSession();
      const locationId = session.data.session?.user?.app_metadata?.location_id as string | undefined;
      const assetNote = unlisted.trim() ? `\n\n[Unlisted equipment: ${unlisted.trim()}]` : "";
      const safetyNote = safetyRisk === "yes" ? "\n\n⚠️ Safety risk reported." : "";
      const issue = await createIssue({
        title: effectiveTitle.trim(),
        description: (description.trim() + assetNote + safetyNote) || undefined,
        category_id: categoryId,
        priority: effectivePriority,
        location_description: locationDesc.trim() || undefined,
        location_id: locationId || undefined,
        asset_id: selectedAsset?.id || undefined,
        assigned_to: assignedTo.trim() || undefined,
      });
      onSuccess(issue);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-4 flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-surface-border">
          <h2 className="text-base font-bold text-dark">Create Issue</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-dark-secondary" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">

          {/* Category — searchable combobox */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Category <span className="text-red-500">*</span></label>
            {selectedCategory ? (
              <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border-2 border-sprout-purple bg-sprout-purple/5">
                <div className="flex items-center gap-2">
                  <span className="text-lg leading-none">{categoryIcon(selectedCategory)}</span>
                  <span className="text-sm font-medium text-dark">{selectedCategory.name}</span>
                </div>
                <button type="button" onClick={() => { setCategoryId(""); setCategorySearch(""); setCustomizeTitle(false); setTitleOverride(""); }} className="p-1 hover:bg-white/60 rounded-lg">
                  <X className="w-3.5 h-3.5 text-dark/40" />
                </button>
              </div>
            ) : (
              <div className="border border-surface-border rounded-xl overflow-hidden focus-within:border-sprout-purple/50 focus-within:ring-2 focus-within:ring-sprout-purple/20 transition-all">
                <div className="flex items-center px-3 py-2.5 gap-2">
                  <Search className="w-4 h-4 text-dark-secondary shrink-0" />
                  <input
                    className="flex-1 text-sm text-dark placeholder:text-dark-secondary focus:outline-none bg-transparent"
                    placeholder="Search categories…"
                    value={categorySearch}
                    onChange={(e) => { setCategorySearch(e.target.value); setShowCategoryPicker(true); }}
                    onFocus={() => setShowCategoryPicker(true)}
                  />
                  {categorySearch && (
                    <button type="button" onClick={() => { setCategorySearch(""); setShowCategoryPicker(false); }}>
                      <X className="w-3.5 h-3.5 text-dark/30 hover:text-dark/60" />
                    </button>
                  )}
                </div>
                {showCategoryPicker && (
                  <div className="border-t border-surface-border max-h-52 overflow-y-auto divide-y divide-surface-border">
                    {filteredCategories.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-dark-secondary text-center">No categories found</p>
                    ) : filteredCategories.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => { setCategoryId(cat.id); setShowCategoryPicker(false); setCategorySearch(""); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
                      >
                        <span className="text-lg leading-none shrink-0">{categoryIcon(cat)}</span>
                        <span className="text-sm font-medium text-dark truncate">{cat.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {validationErrors.category && <p className="text-xs text-red-500">{validationErrors.category}</p>}
          </div>

          {/* Equipment picker — unified combobox */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark flex items-center gap-1.5">
              Which equipment? <span className="text-xs text-dark-secondary font-normal">(optional)</span>
            </label>
            {selectedAsset ? (
              <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border-2 border-sprout-purple bg-sprout-purple/5">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{assetIcon(selectedAsset.category)}</span>
                  <div>
                    <p className="text-sm font-medium text-dark">{selectedAsset.name}</p>
                    <p className="text-xs text-dark-secondary">{selectedAsset.category}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setSelectedAsset(null)} className="p-1 hover:bg-white/60 rounded-lg">
                  <X className="w-3.5 h-3.5 text-dark/40" />
                </button>
              </div>
            ) : (
              <div className="border border-surface-border rounded-xl overflow-hidden focus-within:border-sprout-purple/50 focus-within:ring-2 focus-within:ring-sprout-purple/20 transition-all">
                <div className="flex items-center px-3 py-2.5 gap-2">
                  <Search className="w-4 h-4 text-dark-secondary shrink-0" />
                  <input
                    className="flex-1 text-sm text-dark placeholder:text-dark-secondary focus:outline-none bg-transparent"
                    placeholder={assetsLoading ? "Loading equipment…" : "Search equipment…"}
                    value={assetSearch}
                    onChange={(e) => { setAssetSearch(e.target.value); setShowAssetPicker(true); }}
                    onFocus={() => setShowAssetPicker(true)}
                    disabled={assetsLoading}
                  />
                  {assetSearch && (
                    <button type="button" onClick={() => { setAssetSearch(""); setShowAssetPicker(false); }}>
                      <X className="w-3.5 h-3.5 text-dark/30 hover:text-dark/60" />
                    </button>
                  )}
                </div>
                {showAssetPicker && (
                  <div className="border-t border-surface-border">
                    <div className="max-h-44 overflow-y-auto divide-y divide-surface-border">
                      {filteredAssets.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-dark-secondary text-center">No equipment found</p>
                      ) : filteredAssets.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => { setSelectedAsset(asset); setShowAssetPicker(false); setAssetSearch(""); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
                        >
                          <span className="text-lg leading-none shrink-0">{assetIcon(asset.category)}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-dark truncate">{asset.name}</p>
                            <p className="text-xs text-dark-secondary truncate">{asset.category}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-surface-border">
                      <button
                        type="button"
                        onClick={() => { setShowAssetPicker(false); setUnlisted(unlisted || " "); }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 text-sm text-sprout-purple font-medium transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Report unlisted equipment
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {!selectedAsset && unlisted !== "" && (
              <input
                className={inputCls}
                placeholder="Describe the equipment…"
                value={unlisted}
                onChange={(e) => setUnlisted(e.target.value)}
              />
            )}
          </div>

          {/* Title — auto-generated, optionally customizable */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-dark">Title</label>
              {autoTitle && (
                <button
                  type="button"
                  onClick={() => { setCustomizeTitle((v) => !v); if (!customizeTitle) setTitleOverride(autoTitle); }}
                  className="text-xs text-sprout-purple hover:underline"
                >
                  {customizeTitle ? "Use auto-title" : "Customize"}
                </button>
              )}
            </div>
            {customizeTitle ? (
              <input
                className={inputCls}
                value={titleOverride}
                onChange={(e) => setTitleOverride(e.target.value)}
                placeholder="Enter a custom title…"
              />
            ) : (
              <div className={clsx(
                "px-3 py-2.5 rounded-lg border text-sm",
                autoTitle ? "border-surface-border text-dark bg-gray-50" : "border-dashed border-surface-border text-dark-secondary italic"
              )}>
                {autoTitle || "Auto-generated once you select a category"}
              </div>
            )}
            {validationErrors.title && <p className="text-xs text-red-500">{validationErrors.title}</p>}
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Description</label>
            <textarea className={clsx(inputCls, "resize-none")} rows={3}
              placeholder="Provide more details…" value={description}
              onChange={(e) => setDescription(e.target.value)} />
          </div>

          {/* AI Classify button — shown once there is a title or description */}
          {(effectiveTitle.trim() || description.trim()) && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleAiClassifyMgr}
                disabled={aiClassifying}
                className="flex items-center gap-2 self-start px-3 py-1.5 rounded-lg border border-sprout-purple/40 bg-sprout-purple/5 hover:bg-sprout-purple/10 text-sprout-purple text-xs font-medium transition-colors disabled:opacity-60"
              >
                {aiClassifying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {aiClassifying ? "Analysing…" : "Analyse with AI"}
              </button>

              {aiError && <p className="text-xs text-red-500">{aiError}</p>}

              {aiSuggestion && (
                <div className="rounded-xl border border-sprout-purple/30 bg-sprout-purple/5 px-4 py-3 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-sprout-purple">
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      AI suggestion
                    </div>
                    <button type="button" onClick={() => setAiSuggestion(null)} className="text-dark/30 hover:text-dark/60">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-dark-secondary leading-relaxed">
                    {[
                      categories.find((c) => c.id === aiSuggestion.category_id)?.name
                        ? `Category: ${categories.find((c) => c.id === aiSuggestion.category_id)!.name}`
                        : null,
                      aiSuggestion.priority ? `Priority: ${aiSuggestion.priority.charAt(0).toUpperCase() + aiSuggestion.priority.slice(1)}` : null,
                      aiSuggestion.suggested_title ? `Title: "${aiSuggestion.suggested_title}"` : null,
                      aiSuggestion.is_safety_risk ? "Safety risk detected ⚠️" : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                  {aiSuggestion.is_safety_risk && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-700 font-medium">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                      AI flagged this as a potential safety risk
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={acceptAiSuggestionMgr}
                    className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sprout-purple text-white text-xs font-medium hover:bg-sprout-purple/90 transition-colors"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Accept suggestions
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Safety risk */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-dark">Was anyone hurt or was there a safety risk?</label>
            <div className="flex gap-4">
              {(["yes", "no"] as const).map((val) => (
                <label key={val} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="safetyRiskMgr" value={val} checked={safetyRisk === val}
                    onChange={() => setSafetyRisk(val)} className="accent-sprout-purple" />
                  <span className="text-sm text-dark">{val === "yes" ? "Yes" : "No"}</span>
                </label>
              ))}
            </div>
            {safetyRisk === "yes" && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 font-medium">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                Priority will be escalated to High
              </div>
            )}
          </div>

          {/* Priority override */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">
              Priority
              {safetyRisk === "yes" && <span className="ml-1.5 text-xs text-amber-600 font-normal">(overridden to High)</span>}
            </label>
            <select
              className={clsx(inputCls, safetyRisk === "yes" && "opacity-60 cursor-not-allowed")}
              value={effectivePriority}
              disabled={safetyRisk === "yes"}
              onChange={(e) => setPriority(e.target.value as IssuePriority)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          {/* Location description */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Where exactly?</label>
            <input className={inputCls} placeholder="e.g. 2nd floor break room, near the east exit"
              value={locationDesc} onChange={(e) => setLocationDesc(e.target.value)} />
          </div>

          {/* Direct assignment */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark flex items-center gap-1.5">
              Assign to
              <span className="text-xs text-dark-secondary font-normal">(optional)</span>
            </label>
            <input className={inputCls} placeholder="Enter assignee's name, email, or user ID"
              value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-surface-border hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="flex-1 bg-sprout-purple text-white rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-sprout-purple/90 disabled:opacity-60">
              {submitting ? "Creating…" : "Create Issue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Issues Tab
function IssuesTab({ isManager, role, openId }: { isManager: boolean; role: string; openId?: string | null }) {
  const [issues, setIssues]           = useState<Issue[]>([]);
  const [categories, setCategories]   = useState<IssueCategory[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");

  const [statusFilter, setStatusFilter]   = useState<"all" | IssueStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [search, setSearch]               = useState("");
  const [showFilters, setShowFilters]     = useState(false);

  const [showReport, setShowReport]         = useState(false);
  const [selectedIssue, setSelectedIssue]   = useState<Issue | null>(null);
  const [justCreatedId, setJustCreatedId]   = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [issuesRes, catsRes] = await Promise.all([
        listIssues({
          page_size: 200,
          ...(role === "staff"   && { my_issues: true }),
          ...(role === "manager" && { my_team: true }),
          // admin / super_admin: no filter — see everything
        }),
        listIssueCategories(),
      ]);
      setIssues(issuesRes.data);
      setCategories(catsRes.data);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-open from inbox deep-link
  useEffect(() => {
    if (!openId || issues.length === 0) return;
    const found = issues.find((i) => i.id === openId);
    if (found) setSelectedIssue(found);
  }, [openId, issues]);

  const filteredIssues = issues.filter((issue) => {
    if (statusFilter !== "all" && issue.status !== statusFilter) return false;
    if (priorityFilter && issue.priority !== priorityFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !issue.title.toLowerCase().includes(q) &&
        !(issue.description ?? "").toLowerCase().includes(q) &&
        !(issue.location_description ?? "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const isFiltered = statusFilter !== "all" || !!priorityFilter || !!search;
  const issuesByStatus = (status: IssueStatus) => filteredIssues.filter((i) => i.status === status);

  const handleIssueCreated = (issue: Issue) => {
    setIssues((prev) => [issue, ...prev]);
    setShowReport(false);
    setJustCreatedId(issue.id);
    setTimeout(() => setJustCreatedId(null), 4000);
  };

  const handleIssueUpdated = (updated: Issue) => {
    setIssues((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    if (selectedIssue?.id === updated.id) setSelectedIssue(updated);
  };

  const handleIssueDragEnd = useCallback(
    async (result: DropResult) => {
      const { draggableId: issueId, source, destination } = result;
      if (!destination) return;
      const newStatus = destination.droppableId as IssueStatus;
      if (newStatus === source.droppableId) return;
      const prevIssues = issues;
      setIssues((prev) => prev.map((i) => (i.id === issueId ? { ...i, status: newStatus } : i)));
      try {
        await updateIssueStatus(issueId, newStatus);
        loadData();
      } catch {
        setIssues(prevIssues);
      }
    },
    [issues, loadData]
  );

  const STATUS_FILTER_PILLS: { key: "all" | IssueStatus; label: string }[] = [
    { key: "open",        label: "Open"        },
    { key: "in_progress", label: "In Progress" },
    { key: "resolved",    label: "Resolved"    },
    { key: "all",         label: "All"         },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-dark-secondary">{issues.length} total</p>
        <button
          onClick={() => setShowReport(true)}
          className="flex items-center gap-2 bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90"
        >
          <Plus className="w-4 h-4" />
          Report a Problem
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>
      )}

      {/* Filter bar */}
      <div className="flex flex-col gap-2">
        {/* Search — full width */}
        <div className="relative">
          <Search className="w-4 h-4 text-dark-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            className="bg-white border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40 w-full"
            placeholder="Search issues…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Status chips + Filters button */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-1.5 flex-wrap">
            {STATUS_FILTER_PILLS.map((pill) => (
              <button
                key={pill.key}
                onClick={() => setStatusFilter(pill.key)}
                className={clsx(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                  statusFilter === pill.key
                    ? "bg-sprout-cyan text-white border-sprout-cyan"
                    : "bg-white text-dark-secondary border-surface-border hover:border-sprout-cyan hover:text-sprout-cyan"
                )}
              >
                {pill.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              priorityFilter
                ? "border-sprout-purple text-sprout-purple bg-sprout-purple/5"
                : "border-surface-border text-dark-secondary hover:bg-gray-50"
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {priorityFilter && (
              <span className="w-4 h-4 rounded-full bg-sprout-purple text-white text-[10px] font-bold flex items-center justify-center">1</span>
            )}
          </button>
        </div>

        {/* Collapsible: priority */}
        {showFilters && (
          <div className="bg-gray-50 border border-surface-border rounded-xl p-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}
                  className="appearance-none pl-3 pr-7 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40">
                  <option value="">All priority</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-dark-secondary" />
              </div>
            </div>
            {priorityFilter && (
              <button onClick={() => setPriorityFilter("")}
                className="text-xs text-dark-secondary hover:text-dark flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 self-start">
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {KANBAN_COLUMNS.map((col) => (
            <div key={col.key} className="flex flex-col gap-3 min-w-[240px] w-[240px] shrink-0">
              <div className="flex items-center gap-2">
                <col.icon className={clsx("w-4 h-4", col.iconColor)} />
                <span className="text-sm font-semibold text-dark">{col.label}</span>
                <span className="ml-auto text-xs text-dark-secondary bg-surface-page border border-surface-border rounded-full px-2 py-0.5">0</span>
              </div>
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonIssueCard key={i} />
              ))}
            </div>
          ))}
        </div>
      ) : isFiltered ? (
        <div className="flex flex-col gap-3">
          {filteredIssues.length === 0 ? (
            <div className="py-16 text-center bg-white rounded-2xl border border-surface-border">
              <AlertTriangle className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-dark-secondary text-sm">No issues match your filters.</p>
            </div>
          ) : (
            filteredIssues.map((issue) => (
              <button
                key={issue.id}
                onClick={() => setSelectedIssue(issue)}
                className="w-full text-left bg-white rounded-xl border border-surface-border p-4 flex flex-col gap-2 hover:shadow-md hover:border-sprout-purple/30 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-dark">{issue.title}</p>
                  <IssueStatusBadge status={issue.status} />
                </div>
                <div className="flex flex-wrap gap-1.5 items-center">
                  <IssuePriorityBadge priority={issue.priority} />
                  {issue.recurrence_count >= 2 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-600">
                      <RefreshCw className="w-3 h-3" />
                      Recurring
                    </span>
                  )}
                  {issue.issue_categories && (
                    <span className="text-xs text-dark-secondary">{issue.issue_categories.name}</span>
                  )}
                  {issue.asset_id && (
                    <span className="inline-flex items-center gap-1 text-xs text-dark-secondary">
                      <Wrench className="w-3 h-3" /> Asset
                    </span>
                  )}
                </div>
                {(issue.location_description || issue.reporter) && (
                  <div className="flex items-center gap-3 text-xs text-dark-secondary">
                    {issue.location_description && (
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{issue.location_description}</span>
                    )}
                    {issue.reporter && (
                      <span className="flex items-center gap-1"><User className="w-3 h-3" />{issue.reporter.full_name}</span>
                    )}
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(issue.created_at)}</span>
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      ) : (
        <DragDropContext onDragEnd={handleIssueDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {KANBAN_COLUMNS.map((col) => {
              const colIssues = issuesByStatus(col.key);
              const isDroppable = isManager;
              return (
                <div key={col.key} className="flex flex-col gap-3 min-w-[240px] w-[240px] shrink-0">
                  <div className="flex items-center gap-2">
                    <col.icon className={clsx("w-4 h-4", col.iconColor)} />
                    <span className="text-sm font-semibold text-dark">{col.label}</span>
                    <span className="ml-auto text-xs text-dark-secondary bg-surface-page border border-surface-border rounded-full px-2 py-0.5">
                      {colIssues.length}
                    </span>
                  </div>
                  <Droppable droppableId={col.key} isDropDisabled={!isDroppable}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={clsx(
                          "flex flex-col gap-2 min-h-[60px] rounded-xl transition-colors p-1 -m-1",
                          snapshot.isDraggingOver && isDroppable ? "bg-sprout-purple/5 ring-2 ring-sprout-purple/20" : ""
                        )}
                      >
                        {colIssues.length === 0 && !snapshot.isDraggingOver ? (
                          <div className="rounded-xl border-2 border-dashed border-surface-border px-3 py-6 text-center">
                            <p className="text-xs text-dark-secondary">No issues</p>
                          </div>
                        ) : (
                          colIssues.map((issue, index) => (
                            <Draggable key={issue.id} draggableId={issue.id} index={index} isDragDisabled={!isManager}>
                              {(dragProvided, dragSnapshot) => (
                                <div
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  className={clsx(
                                    "rounded-xl transition-all duration-700",
                                    dragSnapshot.isDragging ? "shadow-lg ring-2 ring-sprout-purple/30 rotate-1" : "",
                                  )}
                                >
                                  <IssueCard issue={issue} onClick={() => setSelectedIssue(issue)} highlighted={justCreatedId === issue.id} />
                                </div>
                              )}
                            </Draggable>
                          ))
                        )}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      )}

      {/* Modals */}
      {showReport && (
        <ReportProblemModal categories={categories} onClose={() => setShowReport(false)} onSuccess={handleIssueCreated} />
      )}
      {selectedIssue && (
        <IssueDetailModal
          issue={selectedIssue}
          onClose={() => setSelectedIssue(null)}
          onUpdated={handleIssueUpdated}
          isManager={isManager}
        />
      )}
    </div>
  );
}

// ── TASKS TAB ─────────────────────────────────────────────────────────────────

// Task Detail Modal
function TaskDetailModal({
  taskId, onClose, onUpdated, onRead, isManager,
}: {
  taskId: string;
  onClose: () => void;
  onUpdated: () => void;
  onRead?: (taskId: string) => void;
  isManager: boolean;
}) {
  const [task, setTask]               = useState<Task | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [messageText, setMessageText] = useState("");
  const [posting, setPosting]         = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const t = await getTask(taskId);
      setTask(t);
      markTaskRead(taskId).then(() => onReadRef.current?.(taskId)).catch(() => {});
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (status: string) => {
    if (!task) return;
    setStatusUpdating(true);
    try {
      await updateTaskStatus(task.id, status);
      await load();
      onUpdated();
    } catch {/* ignore */} finally {
      setStatusUpdating(false);
    }
  };

  const handlePostMessage = async () => {
    if (!task || !messageText.trim()) return;
    setPosting(true);
    try {
      await postMessage(task.id, messageText.trim());
      setMessageText("");
      await load();
    } catch {/* ignore */} finally {
      setPosting(false);
    }
  };

  const STATUSES: TaskStatus[] = ["pending", "in_progress", "completed", "cancelled"];
  const messages = (task?.task_messages ?? []).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const assignees = task?.task_assignees ?? [];
  const history = [...(task?.task_status_history ?? [])].sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl flex flex-col max-h-[95vh] sm:max-h-[88vh] min-h-[480px]">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-surface-border shrink-0">
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="flex flex-col gap-2 py-0.5">
                <div className="flex gap-2">
                  <div className="h-5 w-16 bg-gray-200 rounded-full animate-pulse" />
                  <div className="h-5 w-20 bg-gray-200 rounded-full animate-pulse" />
                </div>
                <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse" />
                <div className="h-3 w-1/3 bg-gray-100 rounded animate-pulse" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  {task && <TaskPriorityBadge priority={task.priority} />}
                  {task && <TaskStatusBadge status={task.status} />}
                  {task?.source_type === "audit" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                      <ShieldAlert className="w-3 h-3" /> From Audit
                    </span>
                  )}
                </div>
                <h2 className="text-base font-semibold text-dark mt-1.5 leading-snug">{task?.title}</h2>
                <p className="text-xs text-dark-secondary mt-0.5">
                  {task?.locations?.name && <span className="mr-2">📍 {task.locations.name}</span>}
                  {task?.due_at && (
                    <span className={clsx(new Date(task.due_at) < new Date() && task.status !== "completed" ? "text-red-500 font-medium" : "")}>
                      Due {formatDate(task.due_at)}
                    </span>
                  )}
                </p>
              </>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <p className="text-xs text-red-500 px-5 py-2">{error}</p>}

        <div className="flex-1 overflow-y-auto flex flex-col divide-y divide-surface-border">
          {loading ? (
            <div className="flex items-center justify-center flex-1">
              <Loader2 className="w-6 h-6 text-sprout-purple animate-spin" />
            </div>
          ) : task ? (
            <>
              {task.description && (
                <div className="px-5 py-4">
                  <p className="text-sm text-dark-secondary whitespace-pre-wrap">{task.description}</p>
                </div>
              )}

              {/* Status actions */}
              <div className="px-5 py-4">
                <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide mb-3">Update Status</p>
                <div className="flex flex-wrap gap-2">
                  {STATUSES.filter((s) => s !== task.status).map((s) => {
                    const cfg = TASK_STATUS_CONFIG[s];
                    const Icon = cfg.icon;
                    return (
                      <button
                        key={s}
                        disabled={statusUpdating}
                        onClick={() => handleStatusChange(s)}
                        className={clsx(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                          "border-surface-border text-dark-secondary hover:border-sprout-purple hover:text-sprout-purple hover:bg-sprout-purple/5",
                          statusUpdating && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" /> {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Assignees */}
              <div className="px-5 py-4">
                <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide mb-2">Assignees</p>
                {assignees.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No assignees</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {assignees.map((a) => (
                      <div key={a.id} className="flex items-center gap-1.5 bg-surface-page border border-surface-border rounded-full pl-2 pr-1 py-0.5">
                        <div className="w-5 h-5 rounded-full bg-sprout-purple/10 flex items-center justify-center">
                          <User className="w-3 h-3 text-sprout-purple" />
                        </div>
                        <span className="text-xs text-dark">{a.profiles?.full_name ?? a.assign_role ?? "Unknown"}</span>
                        {isManager && (
                          <button
                            onClick={async () => { await removeAssignee(task.id, a.id); await load(); onUpdated(); }}
                            className="p-0.5 text-gray-400 hover:text-red-500"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Status history */}
              {history.length > 0 && (
                <div className="px-5 py-4">
                  <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide mb-2">Status History</p>
                  <div className="flex flex-col gap-1.5">
                    {history.map((h) => (
                      <div key={h.id} className="flex items-center gap-2 text-xs text-dark-secondary">
                        <span className="font-medium text-dark">{h.profiles?.full_name ?? "Unknown"}</span>
                        <ChevronRight className="w-3 h-3" />
                        {h.previous_status && <><TaskStatusBadge status={h.previous_status} /><ChevronRight className="w-3 h-3" /></>}
                        <TaskStatusBadge status={h.new_status} />
                        <span className="ml-auto">{timeAgo(h.changed_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Message thread */}
              <div className="px-5 py-4 flex flex-col gap-3">
                <p className="text-xs font-medium text-dark-secondary uppercase tracking-wide flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> Thread
                  {messages.length > 0 && (
                    <span className="bg-sprout-purple text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                      {messages.length}
                    </span>
                  )}
                </p>
                {messages.length === 0 && (
                  <p className="text-xs text-gray-400 italic">No messages yet — start the conversation.</p>
                )}
                <div className="flex flex-col gap-3">
                  {messages.map((m) => (
                    <div key={m.id} className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-dark">{m.profiles?.full_name ?? "Unknown"}</span>
                        <span className="text-xs text-dark-secondary">{timeAgo(m.created_at)}</span>
                      </div>
                      <p className="text-sm text-dark bg-surface-page rounded-xl px-3 py-2 border border-surface-border whitespace-pre-wrap">
                        {m.body}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-1">
                  <input
                    className="flex-1 border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sprout-purple/40"
                    placeholder="Write a message…"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handlePostMessage()}
                  />
                  <button
                    onClick={handlePostMessage}
                    disabled={posting || !messageText.trim()}
                    className="p-2 bg-sprout-purple text-white rounded-lg hover:bg-sprout-purple/90 disabled:opacity-50"
                  >
                    {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Task Card
function TaskCard({ task, onClick, highlighted }: { task: Task; onClick: () => void; highlighted?: boolean }) {
  const isOverdue = task.due_at && new Date(task.due_at) < new Date() && task.status !== "completed" && task.status !== "cancelled";
  const unreadCount = task.unread_message_count ?? 0;
  const msgCount = task.task_messages?.length ?? 0;
  const attCount = task.task_attachments?.length ?? 0;
  const assignees = task.task_assignees ?? [];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className={clsx(
        "w-full text-left rounded-xl border p-4 flex flex-col gap-3 hover:shadow-md transition-all cursor-pointer",
        highlighted
          ? "bg-violet-50 border-violet-200 shadow-sm"
          : isOverdue
            ? "bg-white border-red-200 hover:border-red-300"
            : "bg-white border-surface-border hover:border-sprout-purple/30"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-dark leading-snug line-clamp-2 flex-1">{task.title}</p>
        <TaskPriorityBadge priority={task.priority} />
      </div>

      {task.description && (
        <p className="text-xs text-dark-secondary line-clamp-2">{task.description}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap text-xs text-dark-secondary">
        {task.locations?.name && (
          <span className="flex items-center gap-1"><Tag className="w-3 h-3" />{task.locations.name}</span>
        )}
        {task.due_at && (
          <span className={clsx("flex items-center gap-1", isOverdue ? "text-red-500 font-medium" : "")}>
            <Calendar className="w-3 h-3" />
            {isOverdue ? "Overdue " : "Due "}{formatDate(task.due_at)}
          </span>
        )}
        {task.source_type === "audit" && (
          <span className="flex items-center gap-1 text-amber-600">
            <ShieldAlert className="w-3 h-3" /> Audit finding
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-surface-border pt-2 mt-auto">
        <div className="flex items-center gap-2">
          {assignees.slice(0, 3).map((a) => (
            <div
              key={a.id}
              title={a.profiles?.full_name ?? a.assign_role ?? ""}
              className="w-6 h-6 rounded-full bg-sprout-purple/10 border-2 border-white flex items-center justify-center -ml-1 first:ml-0"
            >
              <User className="w-3 h-3 text-sprout-purple" />
            </div>
          ))}
          {assignees.length > 3 && <span className="text-xs text-dark-secondary">+{assignees.length - 3}</span>}
          {assignees.length === 0 && <span className="text-xs text-gray-400 italic">Unassigned</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-dark-secondary">
          {unreadCount > 0 ? (
            <span className="flex items-center gap-1 text-sprout-purple font-semibold">
              <MessageSquare className="w-3 h-3" />
              {unreadCount}
              <span className="w-2 h-2 rounded-full bg-sprout-purple animate-pulse" />
            </span>
          ) : msgCount > 0 ? (
            <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{msgCount}</span>
          ) : null}
          {attCount > 0 && <span className="flex items-center gap-1"><Paperclip className="w-3 h-3" />{attCount}</span>}
        </div>
      </div>
    </div>
  );
}

// Kanban Board (shared between manager and staff)
function KanbanBoard({
  tasks,
  setTasks,
  columns,
  droppableColumns,
  isManager,
  onCardClick,
  onRefresh,
  loading,
  error,
  toolbar,
  justCreatedId,
}: {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  columns: TaskStatus[];
  droppableColumns: TaskStatus[];
  isManager: boolean;
  onCardClick: (id: string) => void;
  onRefresh: () => void;
  loading: boolean;
  error: string;
  toolbar?: React.ReactNode;
  justCreatedId?: string | null;
}) {
  const handleDragEnd = useCallback(
    async (result: DropResult) => {
      const { draggableId: taskId, source, destination } = result;
      if (!destination) return;
      const newStatus = destination.droppableId as TaskStatus;
      if (newStatus === source.droppableId) return;
      if (!droppableColumns.includes(newStatus)) return;

      const prevTasks = tasks;
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));

      try {
        await updateTaskStatus(taskId, newStatus);
        onRefresh();
      } catch {
        setTasks(prevTasks);
      }
    },
    [tasks, setTasks, droppableColumns, onRefresh]
  );

  // isManager is kept for potential future column-specific rendering; suppress lint
  void isManager;

  const grouped = columns.map((s) => ({
    status: s,
    items: tasks.filter((t) => t.status === s),
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-sprout-purple animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {toolbar}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>}

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 md:-mx-0 px-4 md:px-0 md:grid md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-4">
          {grouped.map(({ status, items }) => {
            const cfg = TASK_STATUS_CONFIG[status];
            const Icon = cfg.icon;
            const isDroppable = droppableColumns.includes(status);

            return (
              <div key={status} className="flex flex-col gap-3 min-w-[260px] md:min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className={clsx("w-4 h-4", {
                    "text-gray-500":     status === "pending" || status === "cancelled",
                    "text-blue-600":     status === "in_progress",
                    "text-sprout-green": status === "completed",
                  })} />
                  <span className="text-sm font-semibold text-dark">{cfg.label}</span>
                  {!isDroppable && (
                    <span className="text-[10px] text-gray-400 italic">(auto)</span>
                  )}
                  <span className="ml-auto text-xs text-dark-secondary bg-surface-page border border-surface-border rounded-full px-2 py-0.5">
                    {items.length}
                  </span>
                </div>

                <Droppable droppableId={status} isDropDisabled={!isDroppable}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={clsx(
                        "flex flex-col gap-2 min-h-[80px] rounded-xl transition-colors p-1 -m-1",
                        snapshot.isDraggingOver && isDroppable
                          ? "bg-sprout-green/5 ring-2 ring-sprout-green/30"
                          : ""
                      )}
                    >
                      {items.length === 0 && !snapshot.isDraggingOver ? (
                        <div className="bg-surface-page border border-dashed border-surface-border rounded-xl p-4 text-center">
                          <p className="text-xs text-gray-400">
                            {isDroppable ? `Drop tasks here` : `No ${cfg.label.toLowerCase()} tasks`}
                          </p>
                        </div>
                      ) : (
                        items.map((task, index) => (
                          <Draggable key={task.id} draggableId={task.id} index={index}>
                            {(dragProvided, dragSnapshot) => (
                              <div
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                className={clsx(
                                  "rounded-xl transition-all duration-700",
                                  dragSnapshot.isDragging ? "shadow-lg ring-2 ring-sprout-purple/30 rotate-1" : "",
                                )}
                              >
                                <TaskCard task={task} onClick={() => onCardClick(task.id)} highlighted={justCreatedId === task.id} />
                              </div>
                            )}
                          </Draggable>
                        ))
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}

// Manager Board
function ManagerBoard({ isManager, role, openId }: { isManager: boolean; role: string; openId?: string | null }) {
  const [tasks, setTasks]                 = useState<Task[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreate, setShowCreate]       = useState(false);
  const [statusFilter, setStatusFilter]   = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [taskSearch, setTaskSearch]       = useState<string>("");
  const [showFilters, setShowFilters]     = useState(false);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTasks({
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        page_size: 100,
        ...(role === "manager" && { my_team: true }),
        // admin / super_admin: no filter — see everything
      });
      setTasks(res.items);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter, role]);

  useEffect(() => { load(); }, [load]);

  // Auto-open from inbox deep-link
  useEffect(() => {
    if (openId && !loading) setSelectedTaskId(openId);
  }, [openId, loading]);

  const displayedTasks = taskSearch
    ? tasks.filter((t) => t.title.toLowerCase().includes(taskSearch.toLowerCase()))
    : tasks;

  const visibleCols = (statusFilter
    ? MANAGER_COLS.filter((c) => c === statusFilter)
    : MANAGER_COLS) as TaskStatus[];

  const TASK_STATUS_CHIPS = [
    ...MANAGER_COLS.map((s) => ({ value: s, label: TASK_STATUS_CONFIG[s].label })),
    { value: "", label: "All" },
  ];

  const TASK_PRIORITY_CHIPS = [
    ...["low", "medium", "high", "critical"].map((p) => ({ value: p, label: TASK_PRIORITY_CONFIG[p as TaskPriority].label })),
    { value: "", label: "All" },
  ];

  const toolbar = (
    <div className="flex flex-col gap-2">
      {/* Row 1: search + action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-4 h-4 text-dark-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            className="bg-white border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40 w-full"
            placeholder="Search tasks…"
            value={taskSearch}
            onChange={(e) => setTaskSearch(e.target.value)}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="p-2 border border-surface-border rounded-lg hover:bg-gray-50 text-dark-secondary" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          {isManager && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sprout-purple text-white text-sm font-medium hover:bg-sprout-purple/90"
            >
              <Plus className="w-4 h-4" /> New Task
            </button>
          )}
        </div>
      </div>
      {/* Row 2: status chips + Filters button */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {TASK_STATUS_CHIPS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={clsx(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                statusFilter === value
                  ? "bg-sprout-cyan text-white border-sprout-cyan"
                  : "bg-white text-dark-secondary border-surface-border hover:border-sprout-cyan hover:text-sprout-cyan"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
            priorityFilter
              ? "border-sprout-purple text-sprout-purple bg-sprout-purple/5"
              : "border-surface-border text-dark-secondary hover:bg-gray-50"
          )}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {priorityFilter && (
            <span className="w-4 h-4 rounded-full bg-sprout-purple text-white text-[10px] font-bold flex items-center justify-center">1</span>
          )}
        </button>
      </div>
      {/* Collapsible: priority */}
      {showFilters && (
        <div className="bg-gray-50 border border-surface-border rounded-xl p-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 rounded-lg border border-surface-border text-sm bg-white text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40">
                <option value="">All priority</option>
                {TASK_PRIORITY_CHIPS.filter((c) => c.value !== "").map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-dark-secondary" />
            </div>
          </div>
          {priorityFilter && (
            <button onClick={() => setPriorityFilter("")}
              className="text-xs text-dark-secondary hover:text-dark flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 self-start">
              <X className="w-3 h-3" /> Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <KanbanBoard
        tasks={displayedTasks}
        setTasks={setTasks}
        columns={visibleCols}
        droppableColumns={MANAGER_DROPPABLE}
        isManager={isManager}
        onCardClick={setSelectedTaskId}
        onRefresh={load}
        loading={loading}
        error={error}
        toolbar={toolbar}
        justCreatedId={justCreatedId}
      />

      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreated={(task) => {
            setShowCreate(false);
            setJustCreatedId(task.id);
            setTimeout(() => setJustCreatedId(null), 4000);
            load();
          }}
        />
      )}
      {selectedTaskId && (
        <TaskDetailModal
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={load}
          onRead={(id) => setTasks((prev) => prev.map((t) => t.id === id ? { ...t, unread_message_count: 0 } : t))}
          isManager={isManager}
        />
      )}
    </>
  );
}

// Staff Tasks View
function StaffTasksView({ openId }: { openId?: string | null }) {
  const [tasks, setTasks]                 = useState<Task[]>([]);
  const [loading, setLoading]             = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTasks({ my_tasks: true, page_size: 100 });
      setTasks(res.items);
    } catch {/* ignore */} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-open from inbox deep-link
  useEffect(() => {
    if (openId && !loading) setSelectedTaskId(openId);
  }, [openId, loading]);

  if (!loading && tasks.length === 0) {
    return (
      <div className="py-20 text-center">
        <CheckCircle2 className="w-10 h-10 text-sprout-green mx-auto mb-2" />
        <p className="text-dark-secondary text-sm">You&#39;re all caught up! No pending tasks.</p>
      </div>
    );
  }

  return (
    <>
      <KanbanBoard
        tasks={tasks}
        setTasks={setTasks}
        columns={STAFF_COLS}
        droppableColumns={STAFF_DROPPABLE}
        isManager={false}
        onCardClick={setSelectedTaskId}
        onRefresh={load}
        loading={loading}
        error=""
        toolbar={
          <div className="flex justify-end">
            <button onClick={load} className="p-2 border border-surface-border rounded-lg hover:bg-gray-50 text-dark-secondary" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        }
      />
      {selectedTaskId && (
        <TaskDetailModal
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={load}
          onRead={(id) => setTasks((prev) => prev.map((t) => t.id === id ? { ...t, unread_message_count: 0 } : t))}
          isManager={false}
        />
      )}
    </>
  );
}

// Tasks Tab
function TasksTab({ isManager, role, openId }: { isManager: boolean; role: string; openId?: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-dark-secondary">
        {isManager ? "Assign and track tasks across your team" : "Your assigned tasks"}
      </p>
      {isManager ? <ManagerBoard isManager={isManager} role={role} openId={openId} /> : <StaffTasksView openId={openId} />}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function IssuesHubPageInner() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as "incidents" | "issues" | "tasks" | null;
  const idParam = searchParams.get("id");

  const [activeTab, setActiveTab] = useState<"incidents" | "issues" | "tasks">(tabParam ?? "tasks");
  const [role, setRole] = useState<string | null>(null); // null = not yet resolved
  const [openIssues, setOpenIssues] = useState(0);
  const [inProgressIssues, setInProgressIssues] = useState(0);
  const [taskSum, setTaskSum] = useState<TaskSummary | null>(null);

  // Sync tab when URL param changes (e.g. navigating from inbox)
  useEffect(() => {
    if (tabParam) setActiveTab(tabParam);
  }, [tabParam]);

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      const r = data.session?.user?.app_metadata?.role as string | undefined;
      setRole(r ?? "staff");
    });
  }, []);

  useEffect(() => {
    listIssues({ status: "open",        page_size: 1 }).then(r => setOpenIssues(r.total)).catch(() => {});
    listIssues({ status: "in_progress", page_size: 1 }).then(r => setInProgressIssues(r.total)).catch(() => {});
    taskSummary().then(setTaskSum).catch(() => {});
  }, []);

  const isManager = ["super_admin", "admin", "manager"].includes(role ?? "");

  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      <div className="flex flex-col gap-4 md:gap-6 max-w-full">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-sprout-purple" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Tasks &amp; Issues</h1>
            <p className="text-sm text-dark-secondary">{isManager ? "Track issues, tasks, and incident reports across your organisation" : "Report problems and track your assigned tasks"}</p>
          </div>
        </div>

        {/* Stat cards */}
        {role !== null && (() => {
          type TabKey = "incidents" | "issues" | "tasks";
          const managerCards: { label: string; value: number | string; icon: React.ElementType; bg: string; color: string; tab: TabKey }[] = [
            { label: "Open Issues",   value: openIssues,                    tab: "issues", icon: AlertTriangle, bg: "bg-red-50",           color: "text-red-500"      },
            { label: "In Progress",   value: inProgressIssues,              tab: "issues", icon: RefreshCw,     bg: "bg-blue-50",          color: "text-blue-600"     },
            { label: "Total Tasks",   value: taskSum?.total ?? "—",          tab: "tasks",  icon: ClipboardList, bg: "bg-sprout-purple/10", color: "text-sprout-purple" },
            { label: "Overdue Tasks", value: taskSum?.overdue_count ?? "—",  tab: "tasks",  icon: AlertTriangle, bg: "bg-red-50",           color: "text-red-500"      },
          ];
          const staffCards: typeof managerCards = [
            { label: "Open Issues", value: openIssues,                      tab: "issues", icon: AlertTriangle, bg: "bg-red-50",           color: "text-red-500"      },
            { label: "Tasks",       value: taskSum?.total ?? "—",            tab: "tasks",  icon: ClipboardList, bg: "bg-sprout-purple/10", color: "text-sprout-purple" },
            { label: "Overdue Tasks", value: taskSum?.overdue_count ?? "—",  tab: "tasks",  icon: AlertTriangle, bg: "bg-red-50",           color: "text-red-500"      },
          ];
          const cards = isManager ? managerCards : staffCards;
          return (
            <div className={clsx("grid gap-3", isManager ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
              {cards.map(({ label, value, icon: Icon, bg, color, tab }) => (
                <button
                  key={label}
                  onClick={() => setActiveTab(tab)}
                  className="bg-white rounded-xl border border-surface-border p-4 flex flex-col gap-2 text-left hover:border-sprout-purple/40 hover:shadow-sm transition-all cursor-pointer"
                >
                  <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center", bg)}>
                    <Icon className={clsx("w-4 h-4", color)} />
                  </div>
                  <p className="text-xl md:text-2xl font-bold text-dark">{value}</p>
                  <p className="text-xs text-dark-secondary">{label}</p>
                </button>
              ))}
            </div>
          );
        })()}

        {/* Tab bar — staff sees Issues + Tasks only; managers see all three */}
        {(() => {
          type TabKey = "incidents" | "issues" | "tasks";
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type TabIcon = React.ElementType<{ className?: string }> | undefined;
          const allTabs: { key: TabKey; label: string; icon: TabIcon }[] = [
            { key: "tasks",     label: "Tasks",            icon: ClipboardList },
            { key: "issues",    label: "Issues",           icon: undefined     },
            { key: "incidents", label: "Incident Reports", icon: ShieldAlert   },
          ];
          const visibleTabs = isManager ? allTabs : allTabs.filter((t) => t.key !== "incidents");
          return (
            <div className="flex border-b border-surface-border">
              {visibleTabs.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key as TabKey)}
                  className={clsx(
                    "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                    activeTab === key
                      ? "border-sprout-purple text-sprout-purple"
                      : "border-transparent text-dark-secondary hover:text-dark"
                  )}
                >
                  {Icon && <Icon className="w-4 h-4" />} {label}
                </button>
              ))}
            </div>
          );
        })()}

        {/* Tab content — wait until role is resolved so only one fetch fires with correct isManager */}
        {role === null ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-sprout-purple" />
          </div>
        ) : (
          <>
            {activeTab === "incidents" && isManager && <IncidentsTab isManager={isManager} role={role} openId={activeTab === "incidents" ? idParam : null} />}
            {activeTab === "issues" && <IssuesTab isManager={isManager} role={role} openId={activeTab === "issues" ? idParam : null} />}
            {activeTab === "tasks" && <TasksTab isManager={isManager} role={role} openId={activeTab === "tasks" ? idParam : null} />}
          </>
        )}
      </div>
    </div>
  );
}

export default function IssuesHubPage() {
  return (
    <Suspense>
      <IssuesHubPageInner />
    </Suspense>
  );
}
