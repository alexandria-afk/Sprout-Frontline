"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import {
  CalendarClock, ChevronLeft, ChevronRight, Plus, Clock,
  CheckCircle2, XCircle, AlertCircle, User, MapPin,
  Loader2, X, Sparkles, ToggleLeft, ToggleRight,
  Calendar, Coffee, ArrowRightLeft, FileText, CalendarCheck,
  ClipboardList, TimerReset, TrendingUp, BarChart3,
  RefreshCw, Check, Ban, Globe, Filter,
} from "lucide-react";
import { listUsers, listLocations, getMyOrganisation } from "@/services/users";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Location } from "@/services/users";
import { AssignPeoplePanel } from "@/components/shared/AssignPeoplePanel";
import { PositionCombobox } from "@/components/shared/PositionCombobox";
import {
  listShifts, createShift, updateShift, deleteShift, publishShifts, publishBulk,
  claimShift, listClaims, respondToClaim,
  listSwapRequests, createSwapRequest, respondToSwap,
  listLeaveRequests, createLeaveRequest, respondToLeave,
  getMyAvailability, setAvailability as saveAvailabilityAPI,
  clockIn, clockOut, listAttendance, getMyAttendance,
  getTimesheetSummary, getMyTimesheet,
  getAttendanceRules, updateAttendanceRules,
  listShiftTemplates, createShiftTemplate, deleteShiftTemplate, bulkGenerateShifts,
  assignBulk,
  generateAISchedule, startBreak, endBreak, getBreakStatus,
} from "@/services/shifts";
import type {
  Shift, ShiftTemplate, OpenShiftClaim, ShiftSwapRequest,
  LeaveRequest, StaffAvailability, AttendanceRecord,
  AttendanceRules, TimesheetSummaryRow,
  ShiftStatus, AttendanceStatus,
} from "@/types";
import type { Profile } from "@/types";
import { useTranslation } from "@/lib/i18n";

// ── Constants ──────────────────────────────────────────────────────────────────

const COMMON_ROLES = [
  "Cashier", "Floor Staff", "Stock Clerk", "Supervisor", "Team Leader",
  "Store Manager", "Assistant Manager", "Customer Service", "Barista",
  "Cook", "Prep Cook", "Server", "Security Guard", "Janitor",
  "Receiving Clerk", "Visual Merchandiser", "Sales Associate",
];

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const LEAVE_TYPES = ["annual", "sick", "emergency", "unpaid", "other"] as const;

const SHIFT_STATUS_CONFIG: Record<ShiftStatus, { labelKey: string; bg: string; text: string; dot: string }> = {
  draft:      { labelKey: "status.draft",          bg: "bg-gray-100",    text: "text-gray-600",   dot: "bg-gray-400"    },
  published:  { labelKey: "status.published",      bg: "bg-green-100",   text: "text-green-700",  dot: "bg-green-500"   },
  open:       { labelKey: "status.open",           bg: "bg-blue-100",    text: "text-blue-700",   dot: "bg-blue-500"    },
  claimed:    { labelKey: "shifts.status.claimed", bg: "bg-amber-100",   text: "text-amber-700",  dot: "bg-amber-500"   },
  cancelled:  { labelKey: "status.cancelled",      bg: "bg-red-100",     text: "text-red-600",    dot: "bg-red-400"     },
};

const ATTENDANCE_STATUS_CONFIG: Record<AttendanceStatus, { labelKey: string; bg: string; text: string }> = {
  present:          { labelKey: "attendance.present",            bg: "bg-green-100",  text: "text-green-700"  },
  late:             { labelKey: "shifts.status.late",            bg: "bg-amber-100",  text: "text-amber-700"  },
  early_departure:  { labelKey: "shifts.status.earlyDeparture",  bg: "bg-orange-100", text: "text-orange-700" },
  absent:           { labelKey: "attendance.absent",             bg: "bg-red-100",    text: "text-red-600"    },
  unverified:       { labelKey: "shifts.status.unverified",      bg: "bg-gray-100",   text: "text-gray-600"   },
};

const inputCls = "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full bg-white";
const btnPrimary = "flex items-center gap-2 px-4 py-2 rounded-lg bg-sprout-purple text-white text-sm font-medium hover:bg-sprout-purple/90 transition-colors disabled:opacity-50";
const btnSecondary = "flex items-center gap-2 px-4 py-2 rounded-lg border border-surface-border bg-white text-dark text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50";
const btnDanger = "flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50";

// ── Helpers ────────────────────────────────────────────────────────────────────

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(d.getDate() + n);
  return r;
}

function fmtDate(d: Date): string {
  // Use local date parts — shift times are stored as "naive local" (local time written
  // with +00:00 suffix), so comparisons must use the local calendar date, not UTC.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

/** Display a shift wall-clock time without timezone conversion.
 *  Shifts are stored as UTC but represent local business hours (e.g. "T08:00"
 *  means 8 AM at the store). Reading the ISO chars directly avoids the browser
 *  adding a UTC→local offset that would show "4 PM" instead of "8 AM". */
function fmtWallTime(iso: string): string {
  // Extract "HH:MM" from "YYYY-MM-DDTHH:MM:SS..." regardless of TZ suffix
  const timePart = iso.slice(11, 16);
  if (!timePart || timePart.length < 5) return iso;
  const [hStr, mStr] = timePart.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return iso;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function fmtShortDate(iso: string): string {
  // Read the date portion directly from the ISO string to avoid UTC→local offset.
  const [, mo, day] = iso.slice(0, 10).split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[mo - 1]} ${day}`;
}

function fmtDuration(minutes: number | null): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Banner ────────────────────────────────────────────────────────────────────

function Banner({ type, message, onDismiss }: { type: "success" | "error"; message: string; onDismiss: () => void }) {
  return (
    <div className={clsx(
      "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium",
      type === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
    )}>
      {type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss}><X className="w-4 h-4 opacity-60 hover:opacity-100" /></button>
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function ShiftBadge({ status, isOpenShift, testId }: { status: ShiftStatus; isOpenShift?: boolean; testId?: string }) {
  const { t } = useTranslation();
  const effectiveStatus: ShiftStatus = isOpenShift && status !== "cancelled" && status !== "draft" ? "open" : status;
  const cfg = SHIFT_STATUS_CONFIG[effectiveStatus];
  return (
    <span
      data-testid={testId}
      className={clsx("text-xs font-medium px-2 py-0.5 rounded-full", cfg.bg, cfg.text)}
    >
      {t(cfg.labelKey)}
    </span>
  );
}

function AttBadge({ status }: { status: AttendanceStatus }) {
  const { t } = useTranslation();
  const cfg = ATTENDANCE_STATUS_CONFIG[status];
  return (
    <span className={clsx("text-xs font-medium px-2 py-0.5 rounded-full", cfg.bg, cfg.text)}>
      {t(cfg.labelKey)}
    </span>
  );
}

// ── Modal Wrapper ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <h3 className="font-semibold text-dark">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-dark/60" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Week Navigator ────────────────────────────────────────────────────────────

function WeekNav({ weekStart, onChange, onToday, todayActive }: {
  weekStart: Date;
  onChange: (d: Date) => void;
  onToday?: () => void;
  todayActive?: boolean;
}) {
  const weekEnd = addDays(weekStart, 6);
  return (
    <div className="flex items-center gap-3">
      <button onClick={() => onChange(addDays(weekStart, -7))} className={btnSecondary} style={{ padding: "6px 10px" }}>
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm font-medium text-dark min-w-[160px] text-center">
        {fmtShortDate(weekStart.toISOString())} – {fmtShortDate(weekEnd.toISOString())}
      </span>
      <button onClick={() => onChange(addDays(weekStart, 7))} className={btnSecondary} style={{ padding: "6px 10px" }}>
        <ChevronRight className="w-4 h-4" />
      </button>
      <button
        onClick={() => { onChange(getMondayOfWeek(new Date())); onToday?.(); }}
        className={clsx(btnSecondary, "text-xs", todayActive && "bg-sprout-purple/10 border-sprout-purple/40 text-sprout-purple font-semibold")}
      >
        Today
      </button>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, iconBg, iconColor, sub }: {
  label: string; value: string | number;
  icon: React.ElementType; iconBg: string; iconColor: string; sub?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-surface-border p-4 flex flex-col gap-2">
      <div className={clsx("w-9 h-9 rounded-full flex items-center justify-center", iconBg)}>
        <Icon className={clsx("w-4 h-4", iconColor)} />
      </div>
      <p className="text-2xl font-bold text-dark">{value}</p>
      <p className="text-xs text-dark-secondary">{label}</p>
      {sub && <p className="text-xs text-dark-secondary/60">{sub}</p>}
    </div>
  );
}

function RoleInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  return <PositionCombobox id={id} value={value} onChange={onChange} placeholder="e.g. Cashier, Floor Staff" />;
}

// ── Shift Pill (Roster Grid) ──────────────────────────────────────────────────

function ShiftPill({ shift, onClick }: { shift: Shift; onClick: () => void }) {
  const effectiveStatus: ShiftStatus = shift.is_open_shift && shift.status !== "cancelled" && shift.status !== "draft" ? "open" : shift.status;
  const cfg = SHIFT_STATUS_CONFIG[effectiveStatus];
  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full text-left px-2 py-1 rounded-lg text-xs font-medium mb-1 last:mb-0 transition-colors hover:opacity-80 border",
        cfg.bg, cfg.text,
        shift.status === "draft" ? "border-gray-200" : "border-transparent"
      )}
    >
      <div className="flex items-center gap-1">
        <span className={clsx("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
        <span className="truncate">
          {fmtWallTime(shift.start_at)}
          {shift.assigned_to_user_id
            ? ` · ${(shift as Shift & { assigned_to?: { full_name: string } | null }).assigned_to?.full_name ?? "Staff"}`
            : " · Open"}
        </span>
      </div>
      {shift.role && <div className="ml-2.5 text-[10px] opacity-70 truncate">{shift.role}</div>}
    </button>
  );
}

// ── Roster Grid ───────────────────────────────────────────────────────────────

function RosterGrid({
  weekStart, shifts, onAddShift, onShiftClick,
}: {
  weekStart: Date;
  shifts: Shift[];
  onAddShift: (date: Date) => void;
  onShiftClick: (shift: Shift) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="grid grid-cols-7 gap-1 min-w-[700px]">
      {/* Headers */}
      {days.map((day, i) => (
        <div key={i} className="text-center pb-2">
          <p className="text-xs font-semibold text-dark-secondary">{DAY_NAMES[i]}</p>
          <p className={clsx(
            "text-sm font-bold mt-0.5",
            fmtDate(day) === fmtDate(new Date()) ? "text-sprout-purple" : "text-dark"
          )}>
            {day.getDate()}
          </p>
        </div>
      ))}

      {/* Cells */}
      {days.map((day, i) => {
        const dateStr = fmtDate(day);
        const dayShifts = shifts.filter(s => s.start_at.slice(0, 10) === dateStr);
        return (
          <div key={i} className="bg-gray-50 rounded-xl p-2 min-h-[120px] border border-surface-border">
            <div className="flex-1">
              {dayShifts.map(shift => (
                <ShiftPill key={shift.id} shift={shift} onClick={() => onShiftClick(shift)} />
              ))}
              {dayShifts.length === 0 && (
                <p className="text-[10px] text-dark/30 text-center mt-4">No shifts</p>
              )}
            </div>
            <button
              onClick={() => onAddShift(day)}
              className="w-full mt-2 flex items-center justify-center gap-1 text-[10px] text-dark/40 hover:text-sprout-purple hover:bg-sprout-purple/5 rounded-lg py-1 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Create Shift Modal ────────────────────────────────────────────────────────

function CreateShiftModal({
  initialDate,
  users,
  locationId,
  isAdmin = false,
  locations = [],
  onClose,
  onCreated,
}: {
  initialDate: Date;
  users: Profile[];
  locationId: string;
  isAdmin?: boolean;
  locations?: Location[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [role, setRole] = useState("");
  const [date, setDate] = useState(fmtDate(initialDate));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  // Manager: single dropdown assignment
  const [assignedTo, setAssignedTo] = useState("");
  // Admin: multi-select via AssignPeoplePanel
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [shiftLocationId, setShiftLocationId] = useState(locationId);
  const [isOpen, setIsOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [publishNow, setPublishNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const common = {
        role: role || null,
        start_at: `${date}T${startTime}:00+00:00`,
        end_at: `${date}T${endTime}:00+00:00`,
        is_open_shift: isOpen,
        status: publishNow ? "published" as const : "draft" as const,
        notes: notes || null,
      };
      if (isAdmin) {
        const locId = shiftLocationId || locationId;
        if (isOpen || selectedUsers.size === 0) {
          await createShift({ location_id: locId, ...common, assigned_to_user_id: null });
        } else {
          await Promise.all(
            Array.from(selectedUsers).map(uid =>
              createShift({ location_id: locId, ...common, assigned_to_user_id: uid })
            )
          );
        }
      } else {
        await createShift({
          location_id: locationId,
          ...common,
          assigned_to_user_id: isOpen ? null : assignedTo || null,
        });
      }
      onCreated();
      onClose();
    } catch (e) {
      setError((e as Error).message || "Failed to create shift");
    } finally {
      setSaving(false);
    }
  }

  const adminCreateCount = isOpen ? 1 : selectedUsers.size;

  return (
    <Modal title="Create Shift" onClose={onClose}>
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
      <div className="space-y-4">

        {/* Admin: location picker */}
        {isAdmin && (
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">Location</label>
            <select className={inputCls} value={shiftLocationId} onChange={e => setShiftLocationId(e.target.value)}>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-dark-secondary mb-1">Role / Position</label>
          <RoleInput id="role-create-shift" value={role} onChange={setRole} />
        </div>
        <div>
          <label className="block text-xs font-medium text-dark-secondary mb-1">Date</label>
          <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">Start Time</label>
            <input type="time" className={inputCls} value={startTime} onChange={e => setStartTime(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">End Time</label>
            <input type="time" className={inputCls} value={endTime} onChange={e => setEndTime(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isOpen} onChange={e => setIsOpen(e.target.checked)} className="rounded" />
            <span className="text-sm text-dark">Post as Open Shift (anyone can claim)</span>
          </label>
        </div>

        {!isOpen && (
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">
              Assign to{isAdmin && selectedUsers.size > 0 && (
                <span className="ml-1.5 text-sprout-purple font-bold">{selectedUsers.size} selected</span>
              )}
            </label>
            {isAdmin ? (
              <AssignPeoplePanel selected={selectedUsers} onChange={setSelectedUsers} />
            ) : (
              <select className={inputCls} value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                <option value="">— Unassigned —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-dark-secondary mb-1">Notes</label>
          <textarea className={clsx(inputCls, "resize-none")} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={publishNow} onChange={e => setPublishNow(e.target.checked)} className="rounded" />
            <span className="text-sm text-dark">Publish immediately</span>
          </label>
        </div>

        <div className="flex gap-3 pt-2">
          <button className={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button className={btnPrimary} onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {publishNow
              ? `Save & Publish${isAdmin && adminCreateCount > 1 ? ` (${adminCreateCount})` : ""}`
              : `Save as Draft${isAdmin && adminCreateCount > 1 ? ` (${adminCreateCount})` : ""}`
            }
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Shift Detail Modal ────────────────────────────────────────────────────────

function ShiftDetailModal({
  shift, isManager, onClose, onUpdated,
}: {
  shift: Shift; isManager: boolean;
  onClose: () => void; onUpdated: () => void;
}) {
  const [claims, setClaims] = useState<OpenShiftClaim[]>(shift.open_shift_claims || []);
  const [notes, setNotes] = useState(shift.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [respondingClaim, setRespondingClaim] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);

  async function handleSaveNotes() {
    setSavingNotes(true);
    try {
      await updateShift(shift.id, { notes: notes || null });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
      onUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingNotes(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      await updateShift(shift.id, { status: "published" });
      onUpdated(); onClose();
    } catch (e) {
      setError((e as Error).message); setPublishing(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      await updateShift(shift.id, { status: "cancelled", cancellation_reason: "Cancelled by manager" });
      onUpdated(); onClose();
    } catch (e) {
      setError((e as Error).message); setCancelling(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Permanently delete this cancelled shift? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await deleteShift(shift.id);
      onUpdated(); onClose();
    } catch (e) {
      setError((e as Error).message); setDeleting(false);
    }
  }

  async function handleClaim(claimId: string, action: "approve" | "reject") {
    setRespondingClaim(claimId);
    try {
      await respondToClaim(claimId, { action });
      const fresh = await listClaims({ shift_id: shift.id });
      setClaims(fresh);
      onUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRespondingClaim(null);
    }
  }

  return (
    <Modal title="Shift Details" onClose={onClose}>
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-dark">{shift.role || "Unspecified role"}</p>
            <p className="text-sm text-dark-secondary mt-0.5">
              {fmtShortDate(shift.start_at)} · {fmtWallTime(shift.start_at)} – {fmtWallTime(shift.end_at)}
            </p>
          </div>
          <ShiftBadge status={shift.status} isOpenShift={shift.is_open_shift} testId="shift-status-badge" />
        </div>

        <div className="text-sm text-dark-secondary flex items-center gap-2">
          <User className="w-4 h-4 shrink-0" />
          {shift.assigned_to_user_id
            ? (shift as Shift & { assigned_to?: { full_name: string } | null }).assigned_to?.full_name ?? "Staff"
            : "Open — not assigned"}
        </div>

        {/* Notes — editable for managers */}
        <div>
          <label className="block text-xs font-medium text-dark-secondary mb-1">Shift Notes</label>
          {isManager ? (
            <div className="space-y-2">
              <textarea
                aria-label="Shift notes"
                className={clsx(inputCls, "resize-none")}
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add notes for this shift…"
              />
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className={clsx(btnSecondary, "text-xs py-1.5")}
              >
                {savingNotes
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : noteSaved
                    ? <><Check className="w-3.5 h-3.5 text-green-600" /> Saved</>
                    : <><FileText className="w-3.5 h-3.5" /> Save Notes</>
                }
              </button>
            </div>
          ) : (
            notes
              ? <p className="text-sm text-dark-secondary bg-gray-50 rounded-lg p-3">{notes}</p>
              : <p className="text-sm text-dark-secondary italic">No notes</p>
          )}
        </div>

        {/* Claims */}
        {shift.is_open_shift && claims.length > 0 && (
          <div className="border-t border-surface-border pt-3">
            <p className="text-sm font-medium text-dark mb-2">Claims ({claims.length})</p>
            <div className="space-y-2">
              {claims.map(claim => (
                <div key={claim.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                  <div>
                    <p className="text-sm font-medium text-dark">
                      {claim.profiles?.full_name ?? "Staff member"}
                    </p>
                    <p className="text-xs text-dark-secondary">
                      {new Date(claim.claimed_at).toLocaleDateString()} · {claim.status}
                    </p>
                  </div>
                  {isManager && claim.status === "pending" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleClaim(claim.id, "approve")}
                        disabled={respondingClaim === claim.id}
                        className="p-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                        title="Approve"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleClaim(claim.id, "reject")}
                        disabled={respondingClaim === claim.id}
                        className="p-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                        title="Reject"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {isManager && (
          <div className="pt-3 border-t border-surface-border flex flex-wrap gap-3">
            {shift.status === "draft" && (
              <button onClick={handlePublish} disabled={publishing || cancelling} className={btnPrimary}>
                {publishing && <Loader2 className="w-4 h-4 animate-spin" />}
                <Check className="w-4 h-4" /> Publish Shift
              </button>
            )}
            {shift.status !== "cancelled" && (
              <button onClick={handleCancel} disabled={cancelling || publishing || deleting} className={btnDanger}>
                {cancelling && <Loader2 className="w-4 h-4 animate-spin" />}
                <Ban className="w-4 h-4" /> Cancel Shift
              </button>
            )}
            {shift.status === "cancelled" && (
              <button onClick={handleDelete} disabled={deleting} className={btnDanger}>
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                Delete Permanently
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── AI Schedule Modal ──────────────────────────────────────────────────────────

function AIScheduleModal({
  locationId, weekStart, onClose, onGenerated,
}: {
  locationId: string; weekStart: Date;
  onClose: () => void; onGenerated: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ shifts_created: number; warnings: string[] } | null>(null);
  const [error, setError] = useState("");

  async function handleGenerate() {
    setLoading(true); setError("");
    try {
      const res = await generateAISchedule({
        location_id: locationId,
        week_start: fmtDate(weekStart),
        notes: notes || undefined,
      });
      setResult(res);
      onGenerated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Generate Schedule with AI" onClose={onClose}>
      {result ? (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
            <Sparkles className="w-8 h-8 text-sprout-purple mx-auto mb-2" />
            <p className="font-semibold text-dark">{result.shifts_created} draft shift{result.shifts_created !== 1 ? "s" : ""} created!</p>
            <p className="text-sm text-dark-secondary mt-1">Review them in the Roster tab and publish when ready.</p>
          </div>
          {result.warnings.length > 0 && (
            <div className="bg-amber-50 rounded-xl p-3 space-y-1">
              <p className="text-xs font-medium text-amber-800 mb-1">Warnings:</p>
              {result.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700">• {w}</p>
              ))}
            </div>
          )}
          <button onClick={onClose} className={clsx(btnPrimary, "w-full justify-center")}>Done</button>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
          <p className="text-sm text-dark-secondary">
            Claude will analyze staff availability and existing shifts to generate a balanced schedule as draft shifts.
          </p>
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">Week</label>
            <p className="text-sm font-medium text-dark">
              {fmtShortDate(weekStart.toISOString())} – {fmtShortDate(addDays(weekStart, 6).toISOString())}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">Additional notes (optional)</label>
            <textarea
              className={clsx(inputCls, "resize-none")}
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. need extra staff on Friday, avoid double shifts..."
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className={btnSecondary} disabled={loading}>Cancel</button>
            <button onClick={handleGenerate} className={btnPrimary} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Generate Schedule
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Create Leave Modal ────────────────────────────────────────────────────────

function CreateLeaveModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<string>("annual");
  const [startDate, setStartDate] = useState(fmtDate(new Date()));
  const [endDate, setEndDate] = useState(fmtDate(new Date()));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true); setError("");
    try {
      await createLeaveRequest({ leave_type: type, start_date: startDate, end_date: endDate, reason: reason || null });
      onCreated(); onClose();
    } catch (e) {
      setError((e as Error).message); setSaving(false);
    }
  }

  return (
    <Modal title="Request Leave" onClose={onClose}>
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-dark-secondary mb-1">Leave Type</label>
          <select className={inputCls} value={type} onChange={e => setType(e.target.value)}>
            {LEAVE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">From</label>
            <input type="date" className={inputCls} value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">To</label>
            <input type="date" className={inputCls} value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-dark-secondary mb-1">Reason (optional)</label>
          <textarea className={clsx(inputCls, "resize-none")} rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Brief reason..." />
        </div>
        <div className="flex gap-3 pt-2">
          <button className={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button className={btnPrimary} onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Submit Request
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Bulk Publish Modal (admin only) ───────────────────────────────────────────

type BulkPublishTab = "location" | "role" | "individual";

function BulkPublishModal({
  locations, users, onClose, onPublished,
}: {
  locations: Location[];
  users: Profile[];
  onClose: () => void;
  onPublished: (count: number) => void;
}) {
  const weekMon = getMondayOfWeek(new Date());
  const [tab, setTab] = useState<BulkPublishTab>("location");
  const [locId, setLocId] = useState(locations[0]?.id ?? "");
  const [role, setRole] = useState("");
  const [userId, setUserId] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [weekStart, setWeekStart] = useState(fmtDate(weekMon));
  const [weekEnd, setWeekEnd] = useState(fmtDate(addDays(weekMon, 6)));
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  const filteredUsers = users.filter(u =>
    u.full_name?.toLowerCase().includes(userSearch.toLowerCase())
  );

  const TABS: [BulkPublishTab, React.ElementType, string][] = [
    ["location",   MapPin, "By Location"],
    ["role",       User,   "By Role"],
    ["individual", User,   "By Individual"],
  ];

  async function handlePublish() {
    setError("");
    if (tab === "location" && !locId) { setError("Select a location"); return; }
    if (tab === "role" && !role.trim()) { setError("Enter a role name"); return; }
    if (tab === "individual" && !userId) { setError("Select a staff member"); return; }
    setPublishing(true);
    try {
      const r = await publishBulk({
        filter_type: tab,
        location_id: tab === "location" ? locId : null,
        role: tab === "role" ? role.trim() : null,
        user_id: tab === "individual" ? userId : null,
        week_start: weekStart,
        week_end: weekEnd,
      });
      onPublished(r.published);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Modal title="Publish Shifts" onClose={onClose}>
      {/* Tab bar */}
      <div className="flex border-b border-surface-border bg-gray-50/50 -mx-6 px-0 mb-4">
        {TABS.map(([id, Icon, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={clsx(
              "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors",
              tab === id
                ? "text-sprout-purple border-b-2 border-sprout-purple bg-white"
                : "text-dark-secondary hover:text-dark"
            )}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {/* Tab content */}
        {tab === "location" && (
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">Location</label>
            <select className={inputCls} value={locId} onChange={e => setLocId(e.target.value)}>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
        {tab === "role" && (
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">Role name</label>
            <RoleInput id="role-template" value={role} onChange={setRole} />
          </div>
        )}
        {tab === "individual" && (
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">Staff member</label>
            <input className={clsx(inputCls, "mb-2")} value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search by name…" />
            <div className="max-h-40 overflow-y-auto border border-surface-border rounded-lg divide-y divide-surface-border">
              {filteredUsers.length === 0 && (
                <p className="text-xs text-dark-secondary px-3 py-2">No staff found</p>
              )}
              {filteredUsers.map(u => (
                <button key={u.id} onClick={() => setUserId(u.id)}
                  className={clsx(
                    "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
                    userId === u.id ? "bg-sprout-purple/10 text-sprout-purple font-medium" : "hover:bg-gray-50"
                  )}>
                  <div className="w-6 h-6 rounded-full bg-sprout-purple/20 text-sprout-purple text-[10px] font-bold flex items-center justify-center shrink-0">
                    {u.full_name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <span className="flex-1 truncate">{u.full_name}</span>
                  {userId === u.id && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Date range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">From</label>
            <input type="date" className={inputCls} value={weekStart} onChange={e => setWeekStart(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">To</label>
            <input type="date" className={inputCls} value={weekEnd} onChange={e => setWeekEnd(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button className={btnSecondary} onClick={onClose} disabled={publishing}>Cancel</button>
          <button className={btnPrimary} onClick={handlePublish} disabled={publishing}>
            {publishing && <Loader2 className="w-4 h-4 animate-spin" />}
            Publish Drafts
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Create Template Modal ─────────────────────────────────────────────────────

function CreateTemplateModal({
  locationId, isAdmin, locations, onClose, onCreated,
}: {
  locationId: string;
  isAdmin: boolean;
  locations: Location[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  // Admin: "" = org-wide (null), or a specific location id
  const [selectedLocId, setSelectedLocId] = useState(isAdmin ? "" : locationId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleDay(d: number) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }

  async function handleSave() {
    if (!name) { setError("Name is required"); return; }
    setSaving(true); setError("");
    try {
      await createShiftTemplate({
        name,
        role: role || null,
        start_time: startTime,
        end_time: endTime,
        days_of_week: days,
        location_id: isAdmin ? (selectedLocId || null) : locationId,
      });
      onCreated(); onClose();
    } catch (e) {
      setError((e as Error).message); setSaving(false);
    }
  }

  return (
    <Modal title="Create Shift Template" onClose={onClose}>
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-dark-secondary mb-1">Template Name</label>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Morning Shift" />
        </div>
        <div>
          <label className="block text-xs font-medium text-dark-secondary mb-1">Role</label>
          <RoleInput id="role-edit-shift" value={role} onChange={setRole} />
        </div>

        {/* Location scope */}
        <div>
          <label className="block text-xs font-medium text-dark-secondary mb-1">Scope</label>
          {isAdmin ? (
            <div className="border border-surface-border rounded-xl overflow-hidden">
              {/* Tab bar */}
              <div className="flex border-b border-surface-border bg-gray-50/50">
                {([
                  ["org",      Globe,  "Org-wide"],
                  ["location", MapPin, "By Location"],
                ] as ["org" | "location", React.ElementType, string][]).map(([m, Icon, label]) => (
                  <button key={m} type="button"
                    onClick={() => { setSelectedLocId(m === "org" ? "" : (locations[0]?.id ?? "")); }}
                    className={clsx(
                      "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors",
                      (m === "org" ? selectedLocId === "" : selectedLocId !== "")
                        ? "text-sprout-purple border-b-2 border-sprout-purple bg-white"
                        : "text-dark-secondary hover:text-dark"
                    )}>
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
              </div>
              {/* Tab content */}
              <div className="p-3">
                {selectedLocId === "" ? (
                  <div className="flex items-center gap-2 text-sm text-dark-secondary py-1">
                    <Globe className="w-4 h-4 text-sprout-purple shrink-0" />
                    <span>Visible to all locations in your organisation</span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {locations.map(l => (
                      <button key={l.id} type="button" onClick={() => setSelectedLocId(l.id)}
                        className={clsx(
                          "w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all",
                          selectedLocId === l.id
                            ? "border-sprout-purple/40 bg-sprout-purple/5"
                            : "border-surface-border hover:bg-gray-50"
                        )}>
                        <div className={clsx(
                          "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                          selectedLocId === l.id ? "border-sprout-purple" : "border-gray-300"
                        )}>
                          {selectedLocId === l.id && <div className="w-2 h-2 rounded-full bg-sprout-purple" />}
                        </div>
                        <span className="text-sm font-medium text-dark">{l.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-dark-secondary border border-surface-border rounded-lg px-3 py-2 bg-gray-50">This location only</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">Start</label>
            <input type="time" className={inputCls} value={startTime} onChange={e => setStartTime(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-dark-secondary mb-1">End</label>
            <input type="time" className={inputCls} value={endTime} onChange={e => setEndTime(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-dark-secondary mb-2">Days of Week</label>
          <div className="flex gap-1.5 flex-wrap">
            {DAY_NAMES.map((d, i) => (
              <button
                key={i}
                onClick={() => toggleDay(i)}
                className={clsx(
                  "w-10 h-10 rounded-lg text-xs font-medium border transition-colors",
                  days.includes(i)
                    ? "bg-sprout-purple text-white border-sprout-purple"
                    : "bg-white text-dark border-surface-border hover:border-sprout-purple/40"
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button className={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button className={btnPrimary} onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Template
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Manager Tabs ──────────────────────────────────────────────────────────────

type ManagerTab = "roster" | "open" | "swaps" | "timesheets" | "leave" | "templates";
type StaffTab = "schedule" | "open_shifts" | "swaps" | "clockin" | "timesheet" | "leave" | "availability";

// ── Manager: Roster ───────────────────────────────────────────────────────────

function ManagerRoster({
  locationId, users, isAdmin, locations,
}: {
  locationId: string;
  users: Profile[];
  isAdmin: boolean;
  locations: Location[];
}) {
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [addShiftDate, setAddShiftDate] = useState<Date | null>(null);
  const [detailShift, setDetailShift] = useState<Shift | null>(null);
  const [showAI, setShowAI] = useState(false);
  const [showBulkPublish, setShowBulkPublish] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  // Admin filters
  const [filterLocation, setFilterLocation] = useState<string>("");   // "" = all
  const [filterRole, setFilterRole] = useState<string>("");

  const effectiveLocationId = isAdmin ? filterLocation : locationId;

  const fetchShifts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listShifts({
        location_id: effectiveLocationId || undefined,
        from_date: `${fmtDate(weekStart)}T00:00:00`,
        to_date: `${fmtDate(addDays(weekStart, 6))}T23:59:59`,
        page_size: 200,
      });
      setShifts(res.items);
    } catch {
      setShifts([]);
    } finally {
      setLoading(false);
    }
  }, [weekStart, effectiveLocationId]);

  useEffect(() => { fetchShifts(); }, [fetchShifts]);

  async function handlePublishAll() {
    const draftIds = shifts.filter(s => s.status === "draft").map(s => s.id);
    if (!draftIds.length) return;
    setPublishing(true);
    try {
      const r = await publishShifts(draftIds);
      setBanner({ type: "success", msg: `${r.published} shift${r.published !== 1 ? "s" : ""} published.` });
      await fetchShifts();
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message });
    } finally {
      setPublishing(false);
    }
  }

  const draftCount = shifts.filter(s => s.status === "draft").length;

  // Client-side role filter
  const visibleShifts = filterRole
    ? shifts.filter(s => s.role?.toLowerCase().includes(filterRole.toLowerCase()))
    : shifts;

  return (
    <div className="space-y-4">
      {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}

      {/* Admin filter bar */}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 rounded-xl border border-surface-border">
          <Filter className="w-4 h-4 text-dark-secondary shrink-0" />
          <select
            className="text-sm border border-surface-border rounded-lg px-3 py-1.5 bg-white text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
            value={filterLocation}
            onChange={e => setFilterLocation(e.target.value)}
          >
            <option value="">All Locations</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select
            className="text-sm border border-surface-border rounded-lg px-3 py-1.5 bg-white text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
            value={filterRole}
            onChange={e => setFilterRole(e.target.value)}
          >
            <option value="">All Roles</option>
            {COMMON_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {(filterLocation || filterRole) && (
            <button
              onClick={() => { setFilterLocation(""); setFilterRole(""); }}
              className="text-xs text-dark-secondary hover:text-dark underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <WeekNav weekStart={weekStart} onChange={setWeekStart} />
        <div className="flex gap-2 ml-auto">
          {/* Admin: bulk publish modal; Manager: simple one-click publish for current week/location */}
          {isAdmin ? (
            <button className={btnSecondary} onClick={() => setShowBulkPublish(true)}>
              <Check className="w-4 h-4" /> Publish Drafts
            </button>
          ) : (
            draftCount > 0 && (
              <button className={btnSecondary} onClick={handlePublishAll} disabled={publishing}>
                {publishing && <Loader2 className="w-4 h-4 animate-spin" />}
                Publish {draftCount} Draft{draftCount !== 1 ? "s" : ""}
              </button>
            )
          )}
          <button className={clsx(btnSecondary, "text-sprout-purple border-sprout-purple/30 bg-sprout-purple/5 hover:bg-sprout-purple/10")} onClick={() => setShowAI(true)}>
            <Sparkles className="w-4 h-4" /> Generate with AI
          </button>
          <button className={btnPrimary} onClick={() => setAddShiftDate(new Date())}>
            <Plus className="w-4 h-4" /> Add Shift
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-sprout-purple" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <RosterGrid
            weekStart={weekStart}
            shifts={visibleShifts}
            onAddShift={d => setAddShiftDate(d)}
            onShiftClick={s => setDetailShift(s)}
          />
        </div>
      )}

      {addShiftDate && (
        <CreateShiftModal
          initialDate={addShiftDate}
          users={users}
          locationId={effectiveLocationId || locationId}
          isAdmin={isAdmin}
          locations={locations}
          onClose={() => setAddShiftDate(null)}
          onCreated={() => { fetchShifts(); setBanner({ type: "success", msg: "Shift created." }); }}
        />
      )}
      {detailShift && (
        <ShiftDetailModal
          shift={detailShift}
          isManager
          onClose={() => setDetailShift(null)}
          onUpdated={fetchShifts}
        />
      )}
      {showAI && (
        <AIScheduleModal
          locationId={locationId}
          weekStart={weekStart}
          onClose={() => setShowAI(false)}
          onGenerated={fetchShifts}
        />
      )}
      {showBulkPublish && (
        <BulkPublishModal
          locations={locations}
          users={users}
          onClose={() => setShowBulkPublish(false)}
          onPublished={(count) => {
            setBanner({ type: "success", msg: `${count} shift${count !== 1 ? "s" : ""} published.` });
            fetchShifts();
          }}
        />
      )}
    </div>
  );
}

// ── Manager: Open Shifts ──────────────────────────────────────────────────────

function ManagerOpenShifts({ locationId }: { locationId: string }) {
  const [claims, setClaims] = useState<OpenShiftClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const fetchClaims = useCallback(async () => {
    setLoading(true);
    try {
      const all = await listClaims({ status: "pending" });
      setClaims(all);
    } catch { setClaims([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchClaims(); }, [fetchClaims]);

  async function handleRespond(id: string, action: "approve" | "reject") {
    setResponding(id);
    try {
      await respondToClaim(id, { action });
      setBanner({ type: "success", msg: `Claim ${action}d.` });
      await fetchClaims();
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message });
    } finally { setResponding(null); }
  }

  return (
    <div className="space-y-4">
      {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-purple" /></div>
      ) : claims.length === 0 ? (
        <div className="text-center py-12 text-dark-secondary text-sm">No pending open shift claims</div>
      ) : (
        <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-surface-border">
              <tr>
                {["Staff", "Shift Date", "Time", "Role", "Claimed At", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {claims.map(claim => {
                const s = (claim as OpenShiftClaim & { shifts?: Shift | null }).shifts;
                return (
                  <tr key={claim.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-dark">{claim.profiles?.full_name ?? "Staff"}</td>
                    <td className="px-4 py-3 text-dark-secondary">{s ? fmtShortDate(s.start_at) : "—"}</td>
                    <td className="px-4 py-3 text-dark-secondary">{s ? `${fmtWallTime(s.start_at)} – ${fmtWallTime(s.end_at)}` : "—"}</td>
                    <td className="px-4 py-3 text-dark-secondary">{s?.role ?? "—"}</td>
                    <td className="px-4 py-3 text-dark-secondary">{new Date(claim.claimed_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRespond(claim.id, "approve")}
                          disabled={responding === claim.id}
                          className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-medium"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRespond(claim.id, "reject")}
                          disabled={responding === claim.id}
                          className="px-3 py-1 text-xs bg-red-100 text-red-600 rounded-lg hover:bg-red-200 font-medium"
                        >
                          Reject
                        </button>
                      </div>
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

// ── Manager: Swaps ────────────────────────────────────────────────────────────

function ManagerSwaps() {
  const [swaps, setSwaps] = useState<ShiftSwapRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const fetchSwaps = useCallback(async () => {
    setLoading(true);
    try { setSwaps(await listSwapRequests()); } catch { setSwaps([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSwaps(); }, [fetchSwaps]);

  async function handleRespond(id: string, action: "approve" | "reject") {
    setResponding(id);
    try {
      await respondToSwap(id, { action });
      setBanner({ type: "success", msg: `Swap ${action}d.` });
      await fetchSwaps();
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message });
    } finally { setResponding(null); }
  }

  return (
    <div className="space-y-4">
      {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-purple" /></div>
      ) : swaps.length === 0 ? (
        <div className="text-center py-12 text-dark-secondary text-sm">No swap requests</div>
      ) : (
        <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-surface-border">
              <tr>
                {["Requester", "Their Shift", "Target", "Status", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {swaps.map(swap => (
                <tr key={swap.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-dark">
                    {(swap as ShiftSwapRequest & { profiles?: { full_name: string } | null }).profiles?.full_name ?? "Staff"}
                  </td>
                  <td className="px-4 py-3 text-dark-secondary">
                    {swap.shift ? `${fmtShortDate(swap.shift.start_at)} ${fmtWallTime(swap.shift.start_at)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-dark-secondary">
                    {swap.target_user?.full_name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx(
                      "text-xs font-medium px-2 py-0.5 rounded-full",
                      swap.status === "approved" ? "bg-green-100 text-green-700" :
                      swap.status === "rejected" ? "bg-red-100 text-red-600" :
                      swap.status === "pending_manager" ? "bg-amber-100 text-amber-700" :
                      "bg-gray-100 text-gray-600"
                    )}>
                      {swap.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {swap.status === "pending_manager" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRespond(swap.id, "approve")}
                          disabled={responding === swap.id}
                          className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-medium"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRespond(swap.id, "reject")}
                          disabled={responding === swap.id}
                          className="px-3 py-1 text-xs bg-red-100 text-red-600 rounded-lg hover:bg-red-200 font-medium"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Manager: Timesheets ───────────────────────────────────────────────────────

function ManagerTimesheets() {
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [rows, setRows] = useState<TimesheetSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getTimesheetSummary({ week_start: fmtDate(weekStart) })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [weekStart]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <WeekNav weekStart={weekStart} onChange={setWeekStart} />
        <button className={clsx(btnSecondary, "ml-auto text-xs opacity-50 cursor-not-allowed")} disabled>
          Export (coming soon)
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-purple" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-dark-secondary text-sm">No attendance data for this week</div>
      ) : (
        <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-surface-border">
              <tr>
                {["Staff", "Shifts", "Total", "Break", "Worked", "Regular", "Overtime", "Late", "Absent"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.map(row => (
                <tr key={row.user_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-dark">{row.full_name}</td>
                  <td className="px-4 py-3 text-dark-secondary">{row.shift_count}</td>
                  <td className="px-4 py-3 text-dark-secondary">{row.total_hours}h</td>
                  <td className="px-4 py-3 text-dark-secondary">{(row.break_hours ?? 0) > 0 ? `${row.break_hours}h` : "—"}</td>
                  <td className="px-4 py-3 text-dark-secondary font-medium">{row.worked_hours ?? row.total_hours}h</td>
                  <td className="px-4 py-3 text-dark-secondary">{row.regular_hours}h</td>
                  <td className="px-4 py-3">
                    <span className={row.overtime_hours > 0 ? "text-amber-600 font-medium" : "text-dark-secondary"}>
                      {row.overtime_hours > 0 ? `+${row.overtime_hours}h` : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={row.late_count > 0 ? "text-amber-600 font-medium" : "text-dark-secondary"}>
                      {row.late_count > 0 ? row.late_count : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={row.absent_count > 0 ? "text-red-600 font-medium" : "text-dark-secondary"}>
                      {row.absent_count > 0 ? row.absent_count : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Manager: Leave ────────────────────────────────────────────────────────────

function ManagerLeave() {
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const fetchLeaves = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listLeaveRequests({ page_size: 50 });
      setLeaves(r.items);
    } catch { setLeaves([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchLeaves(); }, [fetchLeaves]);

  async function handleRespond(id: string, action: "approve" | "reject") {
    setResponding(id);
    try {
      await respondToLeave(id, { action });
      setBanner({ type: "success", msg: `Leave ${action}d.` });
      await fetchLeaves();
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message });
    } finally { setResponding(null); }
  }

  return (
    <div className="space-y-4">
      {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-purple" /></div>
      ) : leaves.length === 0 ? (
        <div className="text-center py-12 text-dark-secondary text-sm">No leave requests</div>
      ) : (
        <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-surface-border">
              <tr>
                {["Staff", "Type", "Dates", "Reason", "Status", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {leaves.map(lr => (
                <tr key={lr.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-dark">{lr.profiles?.full_name ?? "Staff"}</td>
                  <td className="px-4 py-3 capitalize text-dark-secondary">{lr.leave_type}</td>
                  <td className="px-4 py-3 text-dark-secondary text-xs">{lr.start_date} – {lr.end_date}</td>
                  <td className="px-4 py-3 text-dark-secondary max-w-[140px] truncate">{lr.reason ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={clsx(
                      "text-xs font-medium px-2 py-0.5 rounded-full",
                      lr.status === "approved" ? "bg-green-100 text-green-700" :
                      lr.status === "rejected" ? "bg-red-100 text-red-600" :
                      "bg-amber-100 text-amber-700"
                    )}>
                      {lr.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {lr.status === "pending" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRespond(lr.id, "approve")}
                          disabled={responding === lr.id}
                          className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-medium"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRespond(lr.id, "reject")}
                          disabled={responding === lr.id}
                          className="px-3 py-1 text-xs bg-red-100 text-red-600 rounded-lg hover:bg-red-200 font-medium"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Manager: Templates ────────────────────────────────────────────────────────

type GeneratedShift = { id: string; start_at: string; end_at: string; role: string | null; location_id: string };
type AssignmentEntry = { userId: string; isOpenShift: boolean };

function ManagerTemplates({
  locationId, isAdmin, locations,
}: {
  locationId: string;
  isAdmin: boolean;
  locations: Location[];
}) {
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [genDateFrom, setGenDateFrom] = useState(fmtDate(getMondayOfWeek(new Date())));
  const [genDateTo, setGenDateTo] = useState(fmtDate(addDays(getMondayOfWeek(new Date()), 6)));
  const [genLocationId, setGenLocationId] = useState("");
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Assignment phase state
  const [assigningPhase, setAssigningPhase] = useState(false);
  const [generatedShifts, setGeneratedShifts] = useState<GeneratedShift[]>([]);
  const [assignmentMap, setAssignmentMap] = useState<Record<string, AssignmentEntry>>({});
  const [staffForLocation, setStaffForLocation] = useState<Profile[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [bulkAssignUserId, setBulkAssignUserId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await listShiftTemplates(isAdmin ? undefined : { location_id: locationId || undefined }));
    }
    catch { setTemplates([]); } finally { setLoading(false); }
  }, [locationId, isAdmin]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  function resetGenerateState() {
    setGeneratingFor(null);
    setGenLocationId("");
    setAssigningPhase(false);
    setGeneratedShifts([]);
    setAssignmentMap({});
    setStaffForLocation([]);
    setBulkAssignUserId("");
  }

  async function handleGenerate(templateId: string, templateLocationId: string | null) {
    setGenerating(true);
    try {
      const body: { date_from: string; date_to: string; location_id?: string } = {
        date_from: genDateFrom,
        date_to: genDateTo,
      };
      if (!templateLocationId && genLocationId) body.location_id = genLocationId;
      const r = await bulkGenerateShifts(templateId, body);

      if (r.shifts_created === 0) {
        setBanner({ type: "success", msg: "No matching days in the selected date range." });
        resetGenerateState();
        return;
      }

      // Transition to assignment phase
      setGeneratedShifts(r.shifts);
      const initMap: Record<string, AssignmentEntry> = {};
      r.shifts.forEach(s => { initMap[s.id] = { userId: "", isOpenShift: false }; });
      setAssignmentMap(initMap);
      setAssigningPhase(true);

      // Load staff for the resolved location
      const locId = templateLocationId || genLocationId;
      if (locId) {
        setLoadingStaff(true);
        try {
          const staffResp = await listUsers({ location_id: locId, page_size: 200 });
          setStaffForLocation(staffResp.items.filter(u => u.role === "staff" || u.role === "manager"));
        } catch { setStaffForLocation([]); } finally { setLoadingStaff(false); }
      }
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message || "Failed to generate shifts. Please try again." });
    } finally {
      setGenerating(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      const assignments = generatedShifts.map(s => ({
        shift_id: s.id,
        user_id: assignmentMap[s.id]?.isOpenShift ? null : (assignmentMap[s.id]?.userId || null),
        is_open_shift: assignmentMap[s.id]?.isOpenShift || false,
      }));
      await assignBulk(assignments);
      const shiftIds = generatedShifts.map(s => s.id);
      const result = await publishShifts(shiftIds);
      setBanner({ type: "success", msg: `${result.published} shift${result.published !== 1 ? "s" : ""} published successfully!` });
      resetGenerateState();
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message || "Failed to publish shifts. Please check assignments and try again." });
    } finally {
      setPublishing(false);
    }
  }

  function applyBulkAssign(userId: string) {
    setAssignmentMap(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(id => { next[id] = { userId, isOpenShift: false }; });
      return next;
    });
    setBulkAssignUserId(userId);
  }

  function applyMarkAllOpen() {
    setAssignmentMap(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(id => { next[id] = { userId: "", isOpenShift: true }; });
      return next;
    });
    setBulkAssignUserId("");
  }

  async function handleDelete(id: string) {
    try {
      await deleteShiftTemplate(id);
      setBanner({ type: "success", msg: "Template deleted." });
      await fetchTemplates();
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message });
    }
  }

  // ── Assignment Phase UI ──────────────────────────────────────────────────────

  if (assigningPhase) {
    const unassignedCount = generatedShifts.filter(s =>
      !assignmentMap[s.id]?.isOpenShift && !assignmentMap[s.id]?.userId
    ).length;

    return (
      <div className="space-y-4">
        {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-dark text-base">
              Assign Staff — {generatedShifts.length} shift{generatedShifts.length !== 1 ? "s" : ""} generated
            </h3>
            <p className="text-xs text-dark-secondary mt-0.5">
              Assign staff or mark as open shifts, then click Publish.
            </p>
          </div>
          <button
            onClick={resetGenerateState}
            className="p-1.5 text-dark-secondary hover:text-dark hover:bg-gray-100 rounded-lg transition-colors"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Bulk actions bar */}
        <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 rounded-lg border border-surface-border">
          <span className="text-xs text-dark-secondary font-medium">Bulk assign:</span>
          {loadingStaff ? (
            <Loader2 className="w-4 h-4 animate-spin text-dark-secondary" />
          ) : (
            <select
              value={bulkAssignUserId}
              onChange={e => applyBulkAssign(e.target.value)}
              className={clsx(inputCls, "text-xs py-1 min-w-[160px]")}
            >
              <option value="">Select staff…</option>
              {staffForLocation.map(u => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
          )}
          <span className="text-xs text-dark-secondary">or</span>
          <button
            onClick={applyMarkAllOpen}
            className={clsx(btnSecondary, "text-xs py-1")}
          >
            <Globe className="w-3.5 h-3.5" /> Mark all as Open Shifts
          </button>
          {unassignedCount > 0 && (
            <span className="ml-auto text-xs text-amber-600 font-medium flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              {unassignedCount} unassigned
            </span>
          )}
        </div>

        {/* Shifts table */}
        <div className="overflow-x-auto rounded-lg border border-surface-border">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-dark-secondary">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Day</th>
                <th className="px-3 py-2 text-left font-medium">Start</th>
                <th className="px-3 py-2 text-left font-medium">End</th>
                <th className="px-3 py-2 text-left font-medium">Role</th>
                <th className="px-3 py-2 text-left font-medium">Assign To</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border bg-white">
              {generatedShifts.map(s => {
                const startDt = new Date(s.start_at);
                const endDt = new Date(s.end_at);
                const entry = assignmentMap[s.id] ?? { userId: "", isOpenShift: false };
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {startDt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-dark-secondary">
                      {DAY_NAMES_FULL[startDt.getDay() === 0 ? 6 : startDt.getDay() - 1]}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {startDt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {endDt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-dark-secondary">
                      {s.role ?? <span className="italic text-gray-400">Any</span>}
                    </td>
                    <td className="px-3 py-2">
                      {entry.isOpenShift ? (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                            <Globe className="w-3 h-3" /> Open Shift
                          </span>
                          <button
                            onClick={() => setAssignmentMap(prev => ({ ...prev, [s.id]: { userId: "", isOpenShift: false } }))}
                            className="text-dark-secondary hover:text-dark"
                            title="Unmark"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <select
                            value={entry.userId}
                            onChange={e => setAssignmentMap(prev => ({ ...prev, [s.id]: { userId: e.target.value, isOpenShift: false } }))}
                            className={clsx(inputCls, "text-xs py-0.5 min-w-[140px]")}
                          >
                            <option value="">Assign staff…</option>
                            {staffForLocation.map(u => (
                              <option key={u.id} value={u.id}>{u.full_name}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => setAssignmentMap(prev => ({ ...prev, [s.id]: { userId: "", isOpenShift: true } }))}
                            className={clsx(btnSecondary, "text-[10px] px-1.5 py-0.5 whitespace-nowrap")}
                            title="Mark as open shift"
                          >
                            <Globe className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between pt-1">
          <button
            className={clsx(btnSecondary, "text-xs")}
            onClick={() => setAssigningPhase(false)}
            disabled={publishing}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Back to settings
          </button>
          <button
            className={clsx(btnPrimary, "text-xs")}
            onClick={handlePublish}
            disabled={publishing || unassignedCount > 0}
            title={unassignedCount > 0 ? "All shifts must be assigned or marked as open before publishing" : undefined}
          >
            {publishing ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing…</>
            ) : (
              <><Check className="w-3.5 h-3.5" /> Publish {generatedShifts.length} Shift{generatedShifts.length !== 1 ? "s" : ""}</>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Default: Template Grid ───────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}
      <div className="flex justify-end">
        <button className={btnPrimary} onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> New Template
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-purple" /></div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 text-dark-secondary text-sm">No shift templates yet</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-surface-border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-dark truncate">{t.name}</p>
                  {t.role && <p className="text-xs text-dark-secondary mt-0.5">{t.role}</p>}
                  <span className={clsx(
                    "inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-medium",
                    !t.location_id
                      ? "bg-sprout-purple/10 text-sprout-purple"
                      : "bg-blue-50 text-blue-600"
                  )}>
                    {!t.location_id
                      ? "Org-wide"
                      : (locations.find(l => l.id === t.location_id)?.name ?? "This location")}
                  </span>
                </div>
                <span className={clsx("text-xs px-2 py-0.5 rounded-full shrink-0", t.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                  {t.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-dark-secondary">
                <Clock className="w-3.5 h-3.5" />
                {t.start_time} – {t.end_time}
              </div>
              <div className="mt-1.5 flex gap-1">
                {t.days_of_week.sort().map(d => (
                  <span key={d} className="text-[10px] px-1.5 py-0.5 rounded bg-sprout-purple/10 text-sprout-purple font-medium">
                    {DAY_NAMES[d]}
                  </span>
                ))}
              </div>

              {/* Generate shifts from this template */}
              {generatingFor === t.id ? (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-2">
                  <p className="text-xs font-medium text-dark">Generate shifts for date range</p>
                  {!t.location_id && (
                    <select
                      value={genLocationId}
                      onChange={e => setGenLocationId(e.target.value)}
                      className={clsx(inputCls, "text-xs")}
                    >
                      <option value="">Select location…</option>
                      {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" className={clsx(inputCls, "text-xs")} value={genDateFrom} onChange={e => setGenDateFrom(e.target.value)} />
                    <input type="date" className={clsx(inputCls, "text-xs")} value={genDateTo} onChange={e => setGenDateTo(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <button className={clsx(btnSecondary, "text-xs")} onClick={() => { setGeneratingFor(null); setGenLocationId(""); }} disabled={generating}>Cancel</button>
                    <button
                      className={clsx(btnPrimary, "text-xs")}
                      onClick={() => handleGenerate(t.id, t.location_id)}
                      disabled={generating || (!t.location_id && !genLocationId)}
                    >
                      {generating ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</> : "Generate"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setGeneratingFor(t.id)}
                    className={clsx(btnSecondary, "text-xs flex-1 justify-center")}
                  >
                    <Calendar className="w-3.5 h-3.5" /> Generate Shifts
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {showCreate && (
        <CreateTemplateModal
          locationId={locationId}
          isAdmin={isAdmin}
          locations={locations}
          onClose={() => setShowCreate(false)}
          onCreated={fetchTemplates}
        />
      )}
    </div>
  );
}

// ── Manager: Settings ─────────────────────────────────────────────────────────

function ManagerSettings() {
  const [rules, setRules] = useState<Partial<AttendanceRules>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    getAttendanceRules().then(setRules).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const toNum = (v: unknown) => {
        if (v === "" || v === null || v === undefined) return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
      };
      await updateAttendanceRules({
        late_threshold_mins: toNum(rules.late_threshold_mins) ?? undefined,
        early_departure_threshold_mins: toNum(rules.early_departure_threshold_mins) ?? undefined,
        overtime_threshold_hours: toNum(rules.overtime_threshold_hours) ?? undefined,
        weekly_overtime_threshold_hours: toNum(rules.weekly_overtime_threshold_hours) as number | undefined,
        break_duration_mins: toNum(rules.break_duration_mins) ?? undefined,
      });
      setBanner({ type: "success", msg: "Attendance rules saved." });
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message });
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-purple" /></div>;

  const row = (label: string, key: keyof AttendanceRules, unit: string, optional = false) => (
    <div className="grid grid-cols-2 items-center gap-4">
      <label className="text-sm text-dark">
        {label}
        {optional && <span className="ml-1 text-xs text-dark-secondary">(optional)</span>}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className={clsx(inputCls, "w-24")}
          value={rules[key] as number ?? ""}
          placeholder={optional ? "—" : undefined}
          onChange={e => setRules(prev => ({
            ...prev,
            [key]: e.target.value === "" ? null : Number(e.target.value),
          }))}
        />
        <span className="text-sm text-dark-secondary">{unit}</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}
      <div className="bg-white rounded-xl border border-surface-border p-6">
        <h3 className="font-semibold text-dark mb-4">Attendance Rules</h3>
        <div className="space-y-4 max-w-lg">
          {row("Late Threshold", "late_threshold_mins", "minutes")}
          {row("Early Departure Threshold", "early_departure_threshold_mins", "minutes")}
          {row("Daily Overtime After", "overtime_threshold_hours", "hours")}
          {row("Weekly Overtime After", "weekly_overtime_threshold_hours", "hours", true)}
          {row("Break Duration", "break_duration_mins", "minutes")}
        </div>
        <div className="mt-6">
          <button className={btnPrimary} onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Staff: My Schedule ────────────────────────────────────────────────────────

function StaffSchedule({ userId }: { userId: string }) {
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [showTodayOnly, setShowTodayOnly] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  function handleWeekChange(d: Date) {
    setWeekStart(d);
    setShowTodayOnly(false);
  }

  useEffect(() => {
    setLoading(true);
    listShifts({
      from_date: `${fmtDate(weekStart)}T00:00:00`,
      to_date: `${fmtDate(addDays(weekStart, 6))}T23:59:59`,
      page_size: 100,
    })
      .then(r => setShifts(r.items))
      .catch(() => setShifts([]))
      .finally(() => setLoading(false));
  }, [weekStart]);

  async function handleClaim(shiftId: string) {
    setClaimingId(shiftId);
    try {
      await claimShift(shiftId);
      setBanner({ type: "success", msg: "Shift claimed! Awaiting manager approval." });
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message });
    } finally { setClaimingId(null); }
  }

  // Staff only sees published (not draft) shifts assigned to them
  const myShifts = shifts.filter(s => s.assigned_to_user_id === userId && s.status !== "draft");
  const openShifts = shifts.filter(s => s.is_open_shift && !s.assigned_to_user_id && s.status === "open");
  const todayStr = fmtDate(new Date());
  const allDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const days = showTodayOnly ? allDays.filter(d => fmtDate(d) === todayStr) : allDays;

  return (
    <div className="space-y-4" data-testid="my-schedule-view">
      {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}
      <WeekNav
        weekStart={weekStart}
        onChange={handleWeekChange}
        onToday={() => setShowTodayOnly(true)}
        todayActive={showTodayOnly}
      />

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-purple" /></div>
      ) : (
        <div className="space-y-3">
          {days.map((day, i) => {
            const dateStr = fmtDate(day);
            const dayMyShifts = myShifts.filter(s => s.start_at.slice(0, 10) === dateStr);
            const dayOpenShifts = openShifts.filter(s => s.start_at.slice(0, 10) === dateStr);
            if (dayMyShifts.length === 0 && dayOpenShifts.length === 0) return null;

            return (
              <div key={i}>
                <p className="text-xs font-semibold text-dark-secondary mb-2 uppercase tracking-wide">
                  {DAY_NAMES_FULL[i]} {day.getDate()}
                </p>
                {dayMyShifts.map(shift => (
                  <div key={shift.id} data-testid="shift-card" className="bg-white rounded-xl border border-surface-border p-4 mb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-dark">{shift.role ?? "Shift"}</p>
                        <p className="text-sm text-dark-secondary mt-0.5">
                          {fmtWallTime(shift.start_at)} – {fmtWallTime(shift.end_at)}
                        </p>
                      </div>
                      <ShiftBadge status={shift.status} isOpenShift={shift.is_open_shift} />
                    </div>
                    {shift.notes && <p className="text-xs text-dark-secondary mt-2">{shift.notes}</p>}
                  </div>
                ))}
                {dayOpenShifts.map(shift => (
                  <div key={shift.id} className="bg-blue-50 rounded-xl border border-blue-200 p-4 mb-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-blue-800">{shift.role ?? "Open Shift"}</p>
                        <p className="text-sm text-blue-600 mt-0.5">{fmtWallTime(shift.start_at)} – {fmtWallTime(shift.end_at)}</p>
                      </div>
                      <button
                        onClick={() => handleClaim(shift.id)}
                        disabled={claimingId === shift.id}
                        className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                      >
                        {claimingId === shift.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Claim
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          {days.length === 0 || (myShifts.length === 0 && openShifts.length === 0) && (
            <div className="text-center py-12 text-dark-secondary text-sm">
              {showTodayOnly ? "No shifts today" : "No shifts this week"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Staff: Clock In/Out ───────────────────────────────────────────────────────

function StaffClockIn({ locationId }: { locationId: string }) {
  const [activeRecord, setActiveRecord] = useState<AttendanceRecord | null>(null);
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [elapsed, setElapsed] = useState("");
  const [breakElapsed, setBreakElapsed] = useState("");
  const [onBreak, setOnBreak] = useState(false);
  const [breakStartAt, setBreakStartAt] = useState<string | null>(null);
  const [breakCount, setBreakCount] = useState(0);
  const [totalBreakMins, setTotalBreakMins] = useState(0);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [breakTypeModal, setBreakTypeModal] = useState(false);

  const fetchAttendance = useCallback(async () => {
    const today = fmtDate(new Date());
    try {
      const r = await listAttendance({
        from_date: `${today}T00:00:00`,
        to_date: `${today}T23:59:59`,
        page_size: 20,
      });
      const records = r.items;
      setTodayRecords(records);
      const active = records.find(r => r.clock_in_at && !r.clock_out_at) ?? null;
      setActiveRecord(active);
      if (active) {
        // Fetch break status
        try {
          const bs = await getBreakStatus(active.id);
          setOnBreak(bs.on_break);
          setBreakStartAt(bs.active_break?.break_start_at ?? null);
          setBreakCount(bs.breaks.length);
          setTotalBreakMins(bs.total_break_minutes);
        } catch { }
      } else {
        setOnBreak(false);
        setBreakStartAt(null);
      }
    } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAttendance(); }, [fetchAttendance]);

  // Shift elapsed timer
  useEffect(() => {
    if (!activeRecord?.clock_in_at) { setElapsed(""); return; }
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - new Date(activeRecord.clock_in_at!).getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeRecord]);

  // Break elapsed timer
  useEffect(() => {
    if (!onBreak || !breakStartAt) { setBreakElapsed(""); return; }
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - new Date(breakStartAt).getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setBreakElapsed(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [onBreak, breakStartAt]);

  async function handleClockIn() {
    setWorking(true); setBanner(null);
    try {
      let lat: number | undefined, lng: number | undefined;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
          );
          lat = pos.coords.latitude; lng = pos.coords.longitude;
        } catch { }
      }
      await clockIn({ location_id: locationId, clock_in_method: lat !== undefined ? "gps" : "manual", latitude: lat, longitude: lng });
      setBanner({ type: "success", msg: "Clocked in successfully!" });
      await fetchAttendance();
    } catch (e) { setBanner({ type: "error", msg: (e as Error).message }); }
    finally { setWorking(false); }
  }

  async function handleStartBreak(breakType: "meal" | "rest" | "other") {
    if (!activeRecord) return;
    setWorking(true); setBanner(null); setBreakTypeModal(false);
    try {
      await startBreak({ attendance_id: activeRecord.id, break_type: breakType });
      setBanner({ type: "success", msg: "Break started." });
      await fetchAttendance();
    } catch (e) { setBanner({ type: "error", msg: (e as Error).message }); }
    finally { setWorking(false); }
  }

  async function handleEndBreak() {
    if (!activeRecord) return;
    setWorking(true); setBanner(null);
    try {
      await endBreak({ attendance_id: activeRecord.id });
      setBanner({ type: "success", msg: "Break ended. Welcome back!" });
      await fetchAttendance();
    } catch (e) { setBanner({ type: "error", msg: (e as Error).message }); }
    finally { setWorking(false); }
  }

  async function handleClockOut() {
    if (!activeRecord) return;
    if (onBreak) { setBanner({ type: "error", msg: "End your break before clocking out." }); return; }
    setWorking(true); setBanner(null);
    try {
      let lat: number | undefined, lng: number | undefined;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
          );
          lat = pos.coords.latitude; lng = pos.coords.longitude;
        } catch { }
      }
      await clockOut({ attendance_id: activeRecord.id, latitude: lat, longitude: lng });
      setBanner({ type: "success", msg: "Clocked out. Great work!" });
      await fetchAttendance();
    } catch (e) { setBanner({ type: "error", msg: (e as Error).message }); }
    finally { setWorking(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-purple" /></div>;

  return (
    <div className="space-y-4">
      {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}

      {/* Break type picker modal */}
      {breakTypeModal && (
        <Modal title="Start Break" onClose={() => setBreakTypeModal(false)}>
          <p className="text-sm text-dark-secondary mb-4">What kind of break?</p>
          <div className="grid grid-cols-3 gap-3">
            {(["meal", "rest", "other"] as const).map(t => (
              <button key={t} onClick={() => handleStartBreak(t)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-surface-border hover:border-sprout-purple hover:bg-sprout-purple/5 transition-colors capitalize text-sm font-medium text-dark">
                <Coffee className="w-5 h-5 text-sprout-purple" />
                {t}
              </button>
            ))}
          </div>
        </Modal>
      )}

      <div className="bg-white rounded-2xl border border-surface-border p-8 text-center">
        {activeRecord ? (
          <>
            {/* Status icon */}
            <div className={clsx("w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4",
              onBreak ? "bg-amber-100" : "bg-green-100"
            )}>
              {onBreak
                ? <Coffee className="w-8 h-8 text-amber-600" />
                : <Clock className="w-8 h-8 text-green-600" />
              }
            </div>

            <p className="text-lg font-bold text-dark mb-1">
              {onBreak ? "On Break" : "You are clocked in"}
            </p>

            {/* Main timer */}
            <p className={clsx("text-4xl font-mono font-bold mt-2 mb-1",
              onBreak ? "text-amber-500" : "text-sprout-purple"
            )}>
              {onBreak ? breakElapsed || "00:00:00" : elapsed}
            </p>

            {onBreak ? (
              <p className="text-sm text-dark-secondary mb-1">Break in progress</p>
            ) : (
              <p className="text-sm text-dark-secondary mb-1">Since {fmtTime(activeRecord.clock_in_at!)}</p>
            )}

            <AttBadge status={activeRecord.status} />

            {/* Break stats row */}
            {(breakCount > 0 || totalBreakMins > 0) && (
              <div className="flex items-center justify-center gap-4 mt-3 text-xs text-dark-secondary">
                <span>{breakCount} break{breakCount !== 1 ? "s" : ""}</span>
                <span className="w-1 h-1 rounded-full bg-gray-300" />
                <span>{totalBreakMins}m total break time</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-center gap-3 mt-6">
              {onBreak ? (
                <button onClick={handleEndBreak} disabled={working}
                  className={clsx(btnPrimary, "justify-center px-6 py-2.5")}>
                  {working ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  End Break
                </button>
              ) : (
                <button onClick={() => setBreakTypeModal(true)} disabled={working}
                  className={clsx(btnSecondary, "justify-center px-6 py-2.5")}>
                  <Coffee className="w-4 h-4" />
                  Start Break
                </button>
              )}
              <button onClick={handleClockOut} disabled={working || onBreak}
                title={onBreak ? "End your break first" : undefined}
                className={clsx(btnDanger, "justify-center px-6 py-2.5", onBreak && "opacity-40 cursor-not-allowed")}>
                {working && !onBreak ? <Loader2 className="w-4 h-4 animate-spin" /> : <TimerReset className="w-4 h-4" />}
                Clock Out
              </button>
            </div>
            {onBreak && (
              <p className="text-xs text-dark-secondary mt-2">End your break before clocking out</p>
            )}
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <Clock className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-lg font-bold text-dark mb-1">Not clocked in</p>
            <p className="text-sm text-dark-secondary mb-6">
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <button onClick={handleClockIn} disabled={working}
              className={clsx(btnPrimary, "mx-auto justify-center px-8 py-3 text-base")}>
              {working ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
              Clock In
            </button>
          </>
        )}
      </div>

      {todayRecords.length > 0 && (
        <div className="bg-white rounded-xl border border-surface-border p-4">
          <p className="text-sm font-semibold text-dark mb-3">Today&apos;s Attendance</p>
          <div className="space-y-2">
            {todayRecords.map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <AttBadge status={r.status} />
                  <span className="text-dark-secondary">
                    {r.clock_in_at ? fmtTime(r.clock_in_at) : "—"}
                    {" – "}
                    {r.clock_out_at ? fmtTime(r.clock_out_at) : "active"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-dark-secondary">{fmtDuration(r.total_minutes)}</span>
                  {(r.break_minutes ?? 0) > 0 && (
                    <span className="text-xs text-dark-secondary ml-2">({r.break_minutes}m break)</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Staff: My Timesheet ───────────────────────────────────────────────────────

function StaffTimesheet() {
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [data, setData] = useState<{ records: AttendanceRecord[]; summary: { total_hours: number; break_hours: number; worked_hours: number; regular_hours: number; overtime_hours: number; late_count: number } } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getMyTimesheet({ week_start: fmtDate(weekStart) })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [weekStart]);

  return (
    <div className="space-y-4">
      <WeekNav weekStart={weekStart} onChange={setWeekStart} />

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-purple" /></div>
      ) : !data ? (
        <div className="text-center py-12 text-dark-secondary text-sm">No timesheet data</div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total Hours" value={`${data.summary.total_hours}h`} icon={Clock} iconBg="bg-blue-50" iconColor="text-blue-600" />
            <StatCard label="Break Hours" value={(data.summary.break_hours ?? 0) > 0 ? `${data.summary.break_hours}h` : "—"} icon={Coffee} iconBg="bg-gray-100" iconColor="text-gray-500" />
            <StatCard label="Worked Hours" value={`${data.summary.worked_hours ?? data.summary.total_hours}h`} icon={CheckCircle2} iconBg="bg-green-50" iconColor="text-green-600" />
            <StatCard label="Overtime" value={data.summary.overtime_hours > 0 ? `+${data.summary.overtime_hours}h` : "—"} icon={TrendingUp} iconBg="bg-amber-50" iconColor="text-amber-600" />
          </div>

          {/* Records */}
          {data.records.length === 0 ? (
            <div className="text-center py-8 text-dark-secondary text-sm">No attendance records this week</div>
          ) : (
            <div className="space-y-2">
              {data.records.map(r => (
                <div key={r.id} className="bg-white rounded-xl border border-surface-border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-dark">
                        {r.clock_in_at ? new Date(r.clock_in_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "—"}
                      </p>
                      <p className="text-sm text-dark-secondary mt-0.5">
                        {r.clock_in_at ? fmtTime(r.clock_in_at) : "—"}
                        {" – "}
                        {r.clock_out_at ? fmtTime(r.clock_out_at) : "Active"}
                      </p>
                    </div>
                    <div className="text-right">
                      <AttBadge status={r.status} />
                      <p className="text-sm font-medium text-dark mt-1">{fmtDuration(r.total_minutes)}</p>
                      {(r.break_minutes ?? 0) > 0 && (
                        <p className="text-xs text-dark-secondary">{r.break_minutes}m break</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Staff: Open Shifts ────────────────────────────────────────────────────────

function StaffOpenShifts() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listShifts({ status: "open", page_size: 100 });
      setShifts(r.items.filter(s => s.is_open_shift && !s.assigned_to_user_id));
    } catch { setShifts([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleClaim(shiftId: string) {
    setClaimingId(shiftId);
    try {
      await claimShift(shiftId);
      setBanner({ type: "success", msg: "Shift claimed! Awaiting manager approval." });
      load();
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message });
    } finally { setClaimingId(null); }
  }

  const byDate = shifts.reduce<Record<string, Shift[]>>((acc, s) => {
    const d = s.start_at.slice(0, 10);
    (acc[d] ??= []).push(s);
    return acc;
  }, {});
  const sortedDates = Object.keys(byDate).sort();

  return (
    <div className="space-y-4">
      {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-sprout-purple" />
        </div>
      ) : sortedDates.length === 0 ? (
        <div className="text-center py-12 text-dark-secondary text-sm">No open shifts available right now</div>
      ) : (
        <div className="space-y-3">
          {sortedDates.map(date => (
            <div key={date}>
              <p className="text-xs font-semibold text-dark-secondary mb-2 uppercase tracking-wide">
                {new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
              </p>
              {byDate[date].map(shift => (
                <div key={shift.id} className="bg-blue-50 rounded-xl border border-blue-200 p-4 mb-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-blue-800">{shift.role ?? "Open Shift"}</p>
                      <p className="text-sm text-blue-600 mt-0.5">
                        {fmtWallTime(shift.start_at)} – {fmtWallTime(shift.end_at)}
                      </p>
                      {shift.notes && <p className="text-xs text-blue-500 mt-1">{shift.notes}</p>}
                    </div>
                    <button
                      onClick={() => handleClaim(shift.id)}
                      disabled={claimingId === shift.id}
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1 shrink-0"
                    >
                      {claimingId === shift.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Check className="w-3 h-3" />}
                      Claim
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Staff: Shift Swap ─────────────────────────────────────────────────────────

function StaffSwaps({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [swaps, setSwaps] = useState<ShiftSwapRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSwaps(await listSwapRequests()); }
    catch { setSwaps([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openCreate() {
    const r = await listShifts({ page_size: 50 });
    setMyShifts(r.items.filter(s => s.assigned_to_user_id === userId && s.status !== "draft"));
    setSelectedShiftId("");
    setShowCreate(true);
  }

  async function handleSubmit() {
    if (!selectedShiftId) return;
    setSubmitting(true);
    try {
      await createSwapRequest({ shift_id: selectedShiftId });
      setBanner({ type: "success", msg: "Swap request submitted! Awaiting manager approval." });
      setShowCreate(false);
      load();
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message });
    } finally { setSubmitting(false); }
  }

  const STATUS_LABEL: Record<string, { labelKey: string; cls: string }> = {
    pending_peer:    { labelKey: "shifts.status.awaitingPeer",     cls: "bg-amber-100 text-amber-700" },
    pending_manager: { labelKey: "shifts.status.awaitingApproval", cls: "bg-amber-100 text-amber-700" },
    approved:        { labelKey: "status.approved",                 cls: "bg-green-100 text-green-700" },
    rejected:        { labelKey: "shifts.status.declined",          cls: "bg-red-100 text-red-600"    },
    cancelled:       { labelKey: "status.cancelled",                cls: "bg-gray-100 text-gray-500"  },
  };

  return (
    <div className="space-y-4">
      {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}
      <div className="flex justify-end">
        <button className={btnPrimary} onClick={openCreate}>
          <Plus className="w-4 h-4" /> Request Swap
        </button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl border border-surface-border p-4 space-y-3">
          <p className="font-medium text-dark text-sm">Select a shift to swap</p>
          {myShifts.length === 0 ? (
            <p className="text-sm text-dark-secondary">No upcoming shifts to swap.</p>
          ) : (
            <select
              value={selectedShiftId}
              onChange={e => setSelectedShiftId(e.target.value)}
              className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">— Choose a shift —</option>
              {myShifts.map(s => (
                <option key={s.id} value={s.id}>
                  {new Date(s.start_at + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  {" · "}{fmtWallTime(s.start_at)} – {fmtWallTime(s.end_at)}
                  {s.role ? ` · ${s.role}` : ""}
                </option>
              ))}
            </select>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className={btnSecondary}>Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={!selectedShiftId || submitting}
              className={btnPrimary}
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Submit Request
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-sprout-purple" />
        </div>
      ) : swaps.length === 0 ? (
        <div className="text-center py-12 text-dark-secondary text-sm">No swap requests yet</div>
      ) : (
        <div className="space-y-2">
          {swaps.map(sw => {
            const meta = STATUS_LABEL[sw.status] ?? { label: sw.status, cls: "bg-gray-100 text-gray-500" };
            return (
              <div key={sw.id} className="bg-white rounded-xl border border-surface-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-dark text-sm">Shift swap request</p>
                    {sw.shift && (
                      <p className="text-xs text-dark-secondary mt-0.5">
                        {new Date(sw.shift.start_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                        {" · "}{fmtWallTime(sw.shift.start_at)} – {fmtWallTime(sw.shift.end_at)}
                      </p>
                    )}
                    <p className="text-xs text-dark-secondary mt-0.5">
                      {new Date(sw.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={clsx("text-xs font-medium px-2 py-0.5 rounded-full shrink-0", meta.cls)}>
                    {t(meta.labelKey)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Staff: Leave ──────────────────────────────────────────────────────────────

function StaffLeave() {
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const fetchLeaves = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listLeaveRequests({ page_size: 50 });
      setLeaves(r.items);
    } catch { setLeaves([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchLeaves(); }, [fetchLeaves]);

  return (
    <div className="space-y-4">
      {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}
      <div className="flex justify-end">
        <button className={btnPrimary} onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> Request Leave
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-purple" /></div>
      ) : leaves.length === 0 ? (
        <div className="text-center py-12 text-dark-secondary text-sm">No leave requests yet</div>
      ) : (
        <div className="space-y-2">
          {leaves.map(lr => (
            <div key={lr.id} className="bg-white rounded-xl border border-surface-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-dark capitalize">{lr.leave_type} Leave</p>
                  <p className="text-sm text-dark-secondary mt-0.5">{lr.start_date} – {lr.end_date}</p>
                  {lr.reason && <p className="text-xs text-dark-secondary mt-1">{lr.reason}</p>}
                </div>
                <span className={clsx(
                  "text-xs font-medium px-2 py-0.5 rounded-full shrink-0",
                  lr.status === "approved" ? "bg-green-100 text-green-700" :
                  lr.status === "rejected" ? "bg-red-100 text-red-600" :
                  "bg-amber-100 text-amber-700"
                )}>
                  {lr.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {showCreate && (
        <CreateLeaveModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { fetchLeaves(); setBanner({ type: "success", msg: "Leave request submitted." }); }}
        />
      )}
    </div>
  );
}

// ── Staff: Availability ───────────────────────────────────────────────────────

function StaffAvailabilityTab() {
  const [availability, setAvailability] = useState<(Partial<StaffAvailability> & { day_of_week: number })[]>(
    Array.from({ length: 7 }, (_, i) => ({
      day_of_week: i,
      is_available: true,
      available_from: "09:00",
      available_to: "17:00",
    }))
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    getMyAvailability()
      .then(data => {
        if (data.length > 0) {
          setAvailability(prev => prev.map((p) => {
            const found = data.find(d => d.day_of_week === p.day_of_week);
            return found ? { ...found } : p;
          }));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function update(dayOfWeek: number, field: string, value: string | boolean) {
    setAvailability(prev => prev.map(a =>
      a.day_of_week === dayOfWeek ? { ...a, [field]: value } : a
    ));
  }

  async function handleSave() {
    setSaving(true);
    setBanner(null);
    try {
      for (const a of availability) {
        await saveAvailabilityAPI({
          day_of_week: a.day_of_week,
          available_from: a.available_from ?? "09:00",
          available_to: a.available_to ?? "17:00",
          is_available: a.is_available !== false,
        });
      }
      setBanner({ type: "success", msg: "Availability saved." });
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message });
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-sprout-purple" /></div>;

  return (
    <div className="space-y-4">
      {banner && <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />}
      <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-surface-border">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary">Day</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary">Available</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary">From</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-dark-secondary">To</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {availability.map(a => (
              <tr key={a.day_of_week} className={clsx(!a.is_available && "opacity-50")}>
                <td className="px-4 py-3 font-medium text-dark">{DAY_NAMES_FULL[a.day_of_week]}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => update(a.day_of_week, "is_available", !a.is_available)}
                    className="text-sprout-purple hover:opacity-80"
                  >
                    {a.is_available !== false
                      ? <ToggleRight className="w-6 h-6" />
                      : <ToggleLeft className="w-6 h-6 text-gray-400" />}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="time"
                    disabled={!a.is_available}
                    className={clsx(inputCls, "w-28")}
                    value={a.available_from ?? "09:00"}
                    onChange={e => update(a.day_of_week, "available_from", e.target.value)}
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="time"
                    disabled={!a.is_available}
                    className={clsx(inputCls, "w-28")}
                    value={a.available_to ?? "17:00"}
                    onChange={e => update(a.day_of_week, "available_to", e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <button className={btnPrimary} onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Availability
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ShiftsPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useCurrentUser();
  const [role, setRole] = useState<string>("staff");
  const [userId, setUserId] = useState<string>("");
  const [locationId, setLocationId] = useState<string>("");
  const [users, setUsers] = useState<Profile[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [staffAvailabilityEnabled, setStaffAvailabilityEnabled] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);

  // Stats
  const [todayShifts, setTodayShifts] = useState(0);
  const [openShiftsCount, setOpenShiftsCount] = useState(0);
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);
  const [approvedLeaveCount, setApprovedLeaveCount] = useState(0);
  const [hoursThisWeek, setHoursThisWeek] = useState<number | null>(null);
  const [myShiftsCount, setMyShiftsCount] = useState(0);

  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as ManagerTab) ?? "roster";
  const [managerTab, setManagerTab] = useState<ManagerTab>(initialTab);
  const [staffTab, setStaffTab] = useState<StaffTab>("schedule");

  const isManager = ["super_admin", "admin", "manager"].includes(role);
  const isAdmin = ["super_admin", "admin"].includes(role);

  useEffect(() => {
    if (!currentUser) return;
    const _user = currentUser;
    async function init() {
      const r = _user.role ?? "staff";
      const uid = _user.id ?? "";
      const locId = _user.app_metadata?.location_id ?? "";
      setRole(r);
      setUserId(uid);
      setLocationId(locId);

      // Load org feature flags (determines which optional tabs to show)
      getMyOrganisation()
        .then(org => setStaffAvailabilityEnabled(org.feature_flags?.staff_availability_enabled === true))
        .catch(() => {});

      // Fetch users for manager shift creation — no location filter so managers
      // can assign shifts to any staff in the org, not just their home location
      if (["super_admin", "admin", "manager"].includes(r)) {
        listUsers({ page_size: 200 })
          .then(res => setUsers(res.items))
          .catch(() => {});
        // Admin needs all locations for bulk publish + template scope
        if (["super_admin", "admin"].includes(r)) {
          listLocations().then(setLocations).catch(() => {});
        }
      }

      // Fetch stats
      const today = fmtDate(new Date());
      const weekMon = getMondayOfWeek(new Date());
      const weekSun = addDays(weekMon, 6);

      Promise.all([
        listShifts({ from_date: `${today}T00:00:00`, to_date: `${today}T23:59:59`, status: "published", page_size: 1 }).catch(() => ({ total_count: 0 })),
        listShifts({ status: "open", page_size: 1 }).catch(() => ({ total_count: 0 })),
        listLeaveRequests({ status: "pending", page_size: 1 }).catch(() => ({ total_count: 0 })),
        ["super_admin", "admin", "manager"].includes(r)
          ? getTimesheetSummary({ week_start: fmtDate(weekMon) }).catch(() => [])
          : getMyTimesheet({ week_start: fmtDate(weekMon) }).catch(() => null),
        listShifts({ from_date: `${fmtDate(weekMon)}T00:00:00`, to_date: `${fmtDate(weekSun)}T23:59:59`, page_size: 100 }).catch(() => ({ items: [] })),
        // For staff: count approved leave requests this year
        !["super_admin", "admin", "manager"].includes(r)
          ? listLeaveRequests({ status: "approved", page_size: 1 }).catch(() => ({ total_count: 0 }))
          : Promise.resolve({ total_count: 0 }),
      ]).then(([todayRes, openRes, leaveRes, timesheetRes, weekShiftsRes, approvedLeaveRes]) => {
        setTodayShifts((todayRes as { total_count: number }).total_count ?? 0);
        setOpenShiftsCount((openRes as { total_count: number }).total_count ?? 0);
        setPendingLeaveCount((leaveRes as { total_count: number }).total_count ?? 0);
        setApprovedLeaveCount((approvedLeaveRes as { total_count: number }).total_count ?? 0);

        if (["super_admin", "admin", "manager"].includes(r) && Array.isArray(timesheetRes)) {
          const total = (timesheetRes as TimesheetSummaryRow[]).reduce((sum, row) => sum + row.total_hours, 0);
          setHoursThisWeek(Math.round(total * 10) / 10);
        } else if (timesheetRes && typeof timesheetRes === "object" && "summary" in timesheetRes) {
          setHoursThisWeek((timesheetRes as { summary: { total_hours: number } }).summary.total_hours);
        }

        const weekShifts = (weekShiftsRes as { items: Shift[] }).items ?? [];
        // Stat card only counts published shifts for staff
        setMyShiftsCount(weekShifts.filter(s => s.assigned_to_user_id === uid && s.status !== "draft").length);
      }).catch(() => {})
        .finally(() => setSessionLoading(false));
    }
    init();
  }, [currentUser]);

  const MANAGER_TABS: { id: ManagerTab; label: string; icon: React.ElementType }[] = [
    { id: "roster",     label: t("shifts.roster"),     icon: Calendar      },
    { id: "open",       label: t("shifts.openShifts"), icon: BarChart3      },
    { id: "swaps",      label: t("shifts.swaps"),      icon: ArrowRightLeft },
    { id: "timesheets", label: t("shifts.timesheets"), icon: Clock          },
    { id: "leave",      label: t("shifts.leave"),      icon: Coffee         },
    { id: "templates",  label: t("shifts.templates"),  icon: ClipboardList  },
  ];

  const STAFF_TABS: { id: StaffTab; label: string; icon: React.ElementType }[] = [
    { id: "schedule",    label: t("shifts.mySchedule"),  icon: Calendar      },
    { id: "open_shifts", label: t("shifts.openShifts"),  icon: CalendarCheck },
    { id: "swaps",       label: t("shifts.shiftSwap"),   icon: ArrowRightLeft},
    { id: "clockin",     label: t("shifts.clockInOut"),  icon: Clock         },
    { id: "timesheet",   label: t("shifts.myTimesheet"), icon: BarChart3     },
    { id: "leave",       label: t("shifts.leave"),       icon: Coffee        },
    ...(staffAvailabilityEnabled
      ? [{ id: "availability" as StaffTab, label: t("shifts.availability"), icon: CalendarClock }]
      : []),
  ];

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-sprout-purple" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-sprout-purple/10 flex items-center justify-center">
          <CalendarClock className="w-5 h-5 text-sprout-purple" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-dark">{t("shifts.pageTitle")}</h1>
          <p className="text-sm text-dark-secondary">
            {isManager ? t("shifts.pageSubtitleManager") : t("shifts.pageSubtitleStaff")}
          </p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {isManager ? (
          <>
            <StatCard
              label={t("shifts.statTodaysShifts")}
              value={todayShifts}
              icon={Calendar}
              iconBg="bg-blue-50"
              iconColor="text-blue-600"
              sub={t("shifts.statPublished")}
            />
            <StatCard
              label={t("shifts.statOpenShifts")}
              value={openShiftsCount}
              icon={User}
              iconBg={openShiftsCount > 0 ? "bg-amber-50" : "bg-gray-100"}
              iconColor={openShiftsCount > 0 ? "text-amber-600" : "text-gray-400"}
              sub={t("shifts.statAwaitingStaff")}
            />
            <StatCard
              label={t("shifts.statPendingLeave")}
              value={pendingLeaveCount}
              icon={Coffee}
              iconBg={pendingLeaveCount > 0 ? "bg-orange-50" : "bg-gray-100"}
              iconColor={pendingLeaveCount > 0 ? "text-orange-600" : "text-gray-400"}
              sub={t("shifts.statNeedsReview")}
            />
            <StatCard
              label={t("shifts.statTeamHours")}
              value={hoursThisWeek !== null ? `${hoursThisWeek}h` : "—"}
              icon={Clock}
              iconBg="bg-green-50"
              iconColor="text-green-600"
            />
          </>
        ) : (
          <>
            <StatCard
              label={t("shifts.statMyShifts")}
              value={myShiftsCount}
              icon={Calendar}
              iconBg="bg-blue-50"
              iconColor="text-blue-600"
            />
            <StatCard
              label={t("shifts.statHoursThisWeek")}
              value={hoursThisWeek !== null ? `${hoursThisWeek}h` : "—"}
              icon={Clock}
              iconBg="bg-green-50"
              iconColor="text-green-600"
            />
            <StatCard
              label={t("shifts.statPendingLeave")}
              value={pendingLeaveCount}
              icon={Coffee}
              iconBg={pendingLeaveCount > 0 ? "bg-amber-50" : "bg-gray-100"}
              iconColor={pendingLeaveCount > 0 ? "text-amber-600" : "text-gray-400"}
            />
            <StatCard
              label={t("shifts.statApprovedLeave")}
              value={approvedLeaveCount}
              icon={FileText}
              iconBg={approvedLeaveCount > 0 ? "bg-teal-50" : "bg-gray-100"}
              iconColor={approvedLeaveCount > 0 ? "text-teal-600" : "text-gray-400"}
              sub={t("shifts.statDaysApproved")}
            />
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
        {/* Tab bar */}
        <div className="flex overflow-x-auto border-b border-surface-border">
          {(isManager ? MANAGER_TABS : STAFF_TABS).map(tab => (
            <button
              key={tab.id}
              onClick={() => isManager ? setManagerTab(tab.id as ManagerTab) : setStaffTab(tab.id as StaffTab)}
              className={clsx(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                (isManager ? managerTab : staffTab) === tab.id
                  ? "border-sprout-purple text-sprout-purple"
                  : "border-transparent text-dark-secondary hover:text-dark"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-4 md:p-6">
          {isManager ? (
            <>
              {managerTab === "roster"     && <ManagerRoster locationId={locationId} users={users} isAdmin={isAdmin} locations={locations} />}
              {managerTab === "open"       && <ManagerOpenShifts locationId={locationId} />}
              {managerTab === "swaps"      && <ManagerSwaps />}
              {managerTab === "timesheets" && <ManagerTimesheets />}
              {managerTab === "leave"      && <ManagerLeave />}
              {managerTab === "templates"  && <ManagerTemplates locationId={locationId} isAdmin={isAdmin} locations={locations} />}
            </>
          ) : (
            <>
              {staffTab === "schedule"     && <StaffSchedule userId={userId} />}
              {staffTab === "open_shifts"  && <StaffOpenShifts />}
              {staffTab === "swaps"        && <StaffSwaps userId={userId} />}
              {staffTab === "clockin"      && <StaffClockIn locationId={locationId} />}
              {staffTab === "timesheet"    && <StaffTimesheet />}
              {staffTab === "leave"        && <StaffLeave />}
              {staffTab === "availability" && staffAvailabilityEnabled && <StaffAvailabilityTab />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
