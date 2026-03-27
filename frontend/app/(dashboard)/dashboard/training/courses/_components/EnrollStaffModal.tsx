"use client";
import { useEffect, useState } from "react";
import { Search, X, Check, Loader2, UserPlus, Users, MapPin, User, Zap, ChevronDown } from "lucide-react";
import {
  listEnrollableUsers, listOrgLocations, enrollUsers, updateCourse,
  type Course, type EnrollableUser, type OrgLocation,
} from "@/services/lms";
import clsx from "clsx";

const ROLE_LABELS: Record<string, string> = {
  staff: "Staff",
  manager: "Manager",
  admin: "Admin",
  super_admin: "Super Admin",
};

const ENROLL_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Not started", cls: "bg-gray-100 text-gray-500" },
  in_progress:  { label: "In progress",  cls: "bg-blue-100 text-blue-600" },
  passed:       { label: "Passed",        cls: "bg-sprout-green/10 text-sprout-green" },
  failed:       { label: "Failed",        cls: "bg-red-100 text-red-500" },
};

const AUTO_ENROLL_ROLES = ["staff", "manager", "admin"] as const;

type AssignMode = "role" | "location" | "individual";

export function EnrollStaffModal({
  course,
  onClose,
  onDone,
  onSuccess,
}: {
  course: Course;
  onClose: () => void;
  onDone?: () => void;
  onSuccess?: () => void;
}) {
  const [users, setUsers] = useState<EnrollableUser[]>([]);
  const [locations, setLocations] = useState<OrgLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<AssignMode>("role");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isMandatory, setIsMandatory] = useState(course.is_mandatory ?? false);

  // Auto-enroll config — pre-populated from course settings
  const [autoEnroll, setAutoEnroll] = useState((course.target_roles ?? []).length > 0);
  const [autoEnrollRoles, setAutoEnrollRoles] = useState<Set<string>>(
    new Set(course.target_roles ?? [])
  );

  const [enrolling, setEnrolling] = useState(false);
  const [done, setDone] = useState<{ enrolled: number; skipped: number } | null>(null);
  const [showEnrolled, setShowEnrolled] = useState(false);

  useEffect(() => {
    Promise.all([
      listEnrollableUsers(course.id),
      listOrgLocations(),
    ]).then(([u, l]) => {
      setUsers(u);
      setLocations(l);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [course.id]);

  // ── Selection helpers ──────────────────────────────────────────────────────

  const unenrolled = users.filter(u => u.enrollment_status === null);

  function selectByRole(role: string) {
    const ids = unenrolled.filter(u => u.role === role).map(u => u.id);
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  function selectByLocation(locationId: string) {
    const ids = unenrolled.filter(u => u.location_id === locationId).map(u => u.id);
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  function toggleUser(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAutoRole(role: string) {
    setAutoEnrollRoles(prev => {
      const next = new Set(prev);
      next.has(role) ? next.delete(role) : next.add(role);
      return next;
    });
  }

  // ── Enroll ─────────────────────────────────────────────────────────────────

  const enrolledUsers = users.filter(u => u.enrollment_status !== null);
  const autoEnrollValid = !autoEnroll || autoEnrollRoles.size > 0;
  const canAssign = autoEnrollValid && (selected.size > 0 || (autoEnroll && autoEnrollRoles.size > 0));

  async function handleEnroll() {
    if (!canAssign) return;
    setEnrolling(true);
    try {
      let enrollResult = { enrolled: 0, skipped: 0 };
      if (selected.size > 0) {
        enrollResult = await enrollUsers(course.id, Array.from(selected), isMandatory);
      }
      if (autoEnroll && autoEnrollRoles.size > 0) {
        await updateCourse(course.id, {
          target_roles: Array.from(autoEnrollRoles),
          is_mandatory: isMandatory,
        });
      }
      setDone(enrollResult);
      onDone?.();
    } catch { /* ignore */ }
    finally { setEnrolling(false); }
  }

  // ── Role mode data ─────────────────────────────────────────────────────────

  const roleGroups = (["staff", "manager", "admin", "super_admin"] as const).map(role => {
    const members = users.filter(u => u.role === role);
    const unenrolledMembers = members.filter(u => u.enrollment_status === null);
    const selectedCount = unenrolledMembers.filter(u => selected.has(u.id)).length;
    return { role, total: members.length, unenrolled: unenrolledMembers.length, selectedCount };
  }).filter(g => g.total > 0);

  // ── Location mode data ─────────────────────────────────────────────────────

  const locationGroups = locations.map(loc => {
    const members = users.filter(u => u.location_id === loc.id);
    const unenrolledMembers = members.filter(u => u.enrollment_status === null);
    const selectedCount = unenrolledMembers.filter(u => selected.has(u.id)).length;
    return { ...loc, total: members.length, unenrolled: unenrolledMembers.length, selectedCount };
  }).filter(g => g.total > 0);

  const unassignedUsers = users.filter(u => u.location_id === null);

  // ── Individual mode data ───────────────────────────────────────────────────

  const filteredUsers = search
    ? users.filter(u => u.full_name.toLowerCase().includes(search.toLowerCase()))
    : users;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-surface-border shrink-0">
          <div>
            <h2 className="text-base font-bold text-dark">Assign Course</h2>
            <p className="text-sm text-dark-secondary mt-0.5 truncate max-w-xs">{course.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-dark-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          /* ── Success screen ── */
          <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4 text-center">
            <div className="w-12 h-12 rounded-full bg-sprout-green/10 flex items-center justify-center">
              <Check className="w-6 h-6 text-sprout-green" />
            </div>
            <div>
              {done.enrolled > 0 ? (
                <p className="font-semibold text-dark">{done.enrolled} staff enrolled{isMandatory ? " (Mandatory)" : ""}</p>
              ) : (
                <p className="font-semibold text-dark">Settings saved</p>
              )}
              {done.enrolled > 0 && done.skipped > 0 && (
                <p className="text-sm text-dark-secondary mt-1">{done.skipped} already enrolled — skipped</p>
              )}
              {autoEnroll && autoEnrollRoles.size > 0 && (
                <p className="text-sm text-dark-secondary mt-1">
                  Auto-enroll on for: {Array.from(autoEnrollRoles).map(r => ROLE_LABELS[r] ?? r).join(", ")}
                </p>
              )}
            </div>
            <button onClick={() => onSuccess ? onSuccess() : onClose()}
              className="px-5 py-2 bg-sprout-green text-white rounded-xl text-sm font-semibold hover:bg-sprout-green/90 transition-colors">
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Mode tabs */}
            <div className="flex border-b border-surface-border shrink-0">
              {([
                ["role",       Users,   "By Role"],
                ["location",   MapPin,  "By Location"],
                ["individual", User,    "Individual"],
              ] as [AssignMode, React.ElementType, string][]).map(([m, Icon, label]) => (
                <button key={m} onClick={() => setMode(m)}
                  className={clsx(
                    "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors",
                    mode === m ? "text-sprout-green border-b-2 border-sprout-green bg-white" : "text-dark-secondary hover:text-dark"
                  )}>
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex-1 flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 text-sprout-green animate-spin" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">

                {/* ── By Role ── */}
                {mode === "role" && (
                  <div className="p-4 space-y-2">
                    {roleGroups.length === 0 ? (
                      <p className="text-sm text-dark-secondary text-center py-8">No users found</p>
                    ) : roleGroups.map(({ role, total, unenrolled: unEnrolled, selectedCount }) => {
                      const allEnrolled = unEnrolled === 0;
                      const allSelected = unEnrolled > 0 && selectedCount === unEnrolled;
                      const someSelected = selectedCount > 0 && !allSelected;
                      return (
                        <button key={role} onClick={() => !allEnrolled && selectByRole(role)}
                          disabled={allEnrolled}
                          className={clsx(
                            "w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left",
                            allEnrolled
                              ? "border-blue-100 bg-blue-50/60 cursor-default"
                              : allSelected
                                ? "border-sprout-green/40 bg-sprout-green/5"
                                : someSelected
                                  ? "border-sprout-green/20 bg-sprout-green/3"
                                  : "border-surface-border hover:bg-gray-50"
                          )}>
                          <div className={clsx(
                            "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
                            allEnrolled
                              ? "bg-blue-400 border-blue-400"
                              : allSelected
                                ? "bg-sprout-green border-sprout-green"
                                : someSelected
                                  ? "bg-sprout-green/30 border-sprout-green/50"
                                  : "border-gray-300"
                          )}>
                            {(allEnrolled || allSelected || someSelected) && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={clsx("text-sm font-semibold capitalize", allEnrolled ? "text-dark/60" : "text-dark")}>{ROLE_LABELS[role] ?? role}</p>
                            <p className="text-xs text-dark-secondary mt-0.5">
                              {total} member{total !== 1 ? "s" : ""}
                              {unEnrolled < total && !allEnrolled && ` · ${total - unEnrolled} already enrolled`}
                            </p>
                          </div>
                          {selectedCount > 0 && !allEnrolled && (
                            <span className="text-xs font-bold text-sprout-green shrink-0">{selectedCount} selected</span>
                          )}
                          {allEnrolled && (
                            <span className="text-xs font-semibold text-blue-500 shrink-0">All enrolled</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* ── By Location ── */}
                {mode === "location" && (
                  <div className="p-4 space-y-2">
                    {locationGroups.length === 0 && unassignedUsers.length === 0 ? (
                      <p className="text-sm text-dark-secondary text-center py-8">No locations found</p>
                    ) : (
                      <>
                        {locationGroups.map(({ id, name, total, unenrolled: unEnrolled, selectedCount }) => {
                          const allEnrolled = unEnrolled === 0;
                          const allSelected = unEnrolled > 0 && selectedCount === unEnrolled;
                          const someSelected = selectedCount > 0 && !allSelected;
                          return (
                            <button key={id} onClick={() => !allEnrolled && selectByLocation(id)}
                              disabled={allEnrolled}
                              className={clsx(
                                "w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left",
                                allEnrolled
                                  ? "border-blue-100 bg-blue-50/60 cursor-default"
                                  : allSelected
                                    ? "border-sprout-green/40 bg-sprout-green/5"
                                    : someSelected
                                      ? "border-sprout-green/20 bg-sprout-green/3"
                                      : "border-surface-border hover:bg-gray-50"
                              )}>
                              <div className={clsx(
                                "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
                                allEnrolled
                                  ? "bg-blue-400 border-blue-400"
                                  : allSelected
                                    ? "bg-sprout-green border-sprout-green"
                                    : someSelected
                                      ? "bg-sprout-green/30 border-sprout-green/50"
                                      : "border-gray-300"
                              )}>
                                {(allEnrolled || allSelected || someSelected) && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={clsx("text-sm font-semibold", allEnrolled ? "text-dark/60" : "text-dark")}>{name}</p>
                                <p className="text-xs text-dark-secondary mt-0.5">
                                  {total} member{total !== 1 ? "s" : ""}
                                  {unEnrolled < total && !allEnrolled && ` · ${total - unEnrolled} already enrolled`}
                                </p>
                              </div>
                              {selectedCount > 0 && !allEnrolled && (
                                <span className="text-xs font-bold text-sprout-green shrink-0">{selectedCount} selected</span>
                              )}
                              {allEnrolled && (
                                <span className="text-xs font-semibold text-blue-500 shrink-0">All enrolled</span>
                              )}
                            </button>
                          );
                        })}
                        {unassignedUsers.filter(u => u.enrollment_status === null).length > 0 && (
                          <p className="text-xs text-dark/30 text-center pt-2">
                            {unassignedUsers.filter(u => u.enrollment_status === null).length} staff not assigned to a location
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* ── Individual ── */}
                {mode === "individual" && (
                  <>
                    <div className="px-4 pt-3 pb-2 border-b border-surface-border">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark/30" />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name…"
                          className="w-full pl-8 pr-3 py-1.5 border border-surface-border rounded-lg text-sm bg-white focus:outline-none focus:border-sprout-green transition-colors" />
                      </div>
                    </div>
                    <div className="divide-y divide-surface-border">
                      {filteredUsers.length === 0 ? (
                        <p className="py-8 text-center text-sm text-dark-secondary">No staff found</p>
                      ) : filteredUsers.map(user => {
                        const isEnrolled = user.enrollment_status !== null;
                        const statusInfo = user.enrollment_status ? ENROLL_STATUS_BADGE[user.enrollment_status] : null;
                        return (
                          <label key={user.id} className={clsx(
                            "flex items-center gap-3 px-4 py-3 transition-colors",
                            isEnrolled ? "opacity-60 cursor-default" : "hover:bg-gray-50 cursor-pointer"
                          )}>
                            <input type="checkbox" checked={selected.has(user.id)} disabled={isEnrolled}
                              onChange={() => !isEnrolled && toggleUser(user.id)}
                              className="w-4 h-4 accent-sprout-green rounded shrink-0" />
                            <div className="w-8 h-8 rounded-full bg-sprout-green/10 flex items-center justify-center text-xs font-bold text-sprout-green shrink-0">
                              {user.full_name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-dark truncate">{user.full_name}</p>
                              <p className="text-xs text-dark-secondary capitalize">{ROLE_LABELS[user.role] ?? user.role}</p>
                            </div>
                            {statusInfo && (
                              <span className={clsx("text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0", statusInfo.cls)}>
                                {statusInfo.label}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Already Enrolled summary */}
            {enrolledUsers.length > 0 && (
              <div className="border-t border-surface-border shrink-0">
                <button
                  onClick={() => setShowEnrolled(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-3 text-xs font-semibold text-dark/60 hover:bg-gray-50 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5" />
                    {enrolledUsers.length} already enrolled
                  </span>
                  <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform", showEnrolled && "rotate-180")} />
                </button>
                {showEnrolled && (
                  <div className="max-h-40 overflow-y-auto divide-y divide-surface-border border-t border-surface-border">
                    {enrolledUsers.map(user => {
                      const statusInfo = user.enrollment_status ? ENROLL_STATUS_BADGE[user.enrollment_status] : null;
                      return (
                        <div key={user.id} className="flex items-center gap-3 px-5 py-2.5">
                          <div className="w-7 h-7 rounded-full bg-sprout-green/10 flex items-center justify-center text-xs font-bold text-sprout-green shrink-0">
                            {user.full_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-dark truncate">{user.full_name}</p>
                            <p className="text-[10px] text-dark-secondary capitalize">{ROLE_LABELS[user.role] ?? user.role}</p>
                          </div>
                          {statusInfo && (
                            <span className={clsx("text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0", statusInfo.cls)}>
                              {statusInfo.label}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="px-5 py-4 border-t border-surface-border shrink-0 space-y-3">
              {/* Mandatory toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-dark">Mark as Mandatory</p>
                  <p className="text-xs text-dark-secondary">Staff must complete this course</p>
                </div>
                <button onClick={() => setIsMandatory(v => !v)}
                  className={clsx("w-11 h-6 rounded-full transition-colors relative shrink-0", isMandatory ? "bg-sprout-green" : "bg-gray-200")}>
                  <span className={clsx("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform", isMandatory ? "translate-x-5" : "translate-x-0.5")} />
                </button>
              </div>

              {/* Auto-enroll toggle */}
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    <div>
                      <p className="text-sm font-medium text-dark">Auto-enroll by role</p>
                      <p className="text-xs text-dark-secondary">New staff with selected roles enroll automatically</p>
                    </div>
                  </div>
                  <button onClick={() => setAutoEnroll(v => !v)}
                    className={clsx("w-11 h-6 rounded-full transition-colors relative shrink-0", autoEnroll ? "bg-amber-500" : "bg-gray-200")}>
                    <span className={clsx("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform", autoEnroll ? "translate-x-5" : "translate-x-0.5")} />
                  </button>
                </div>
                {autoEnroll && (
                  <div className="mt-2 pl-5 space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {AUTO_ENROLL_ROLES.map(role => {
                        const active = autoEnrollRoles.has(role);
                        return (
                          <button key={role} onClick={() => toggleAutoRole(role)}
                            className={clsx(
                              "px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors",
                              active
                                ? "border-amber-400 bg-amber-50 text-amber-700"
                                : "border-surface-border text-dark-secondary hover:bg-gray-50"
                            )}>
                            {ROLE_LABELS[role]}
                          </button>
                        );
                      })}
                    </div>
                    {autoEnrollRoles.size === 0 && (
                      <p className="text-xs text-amber-600">Select at least one role to enable auto-enroll</p>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-dark-secondary">
                  {selected.size > 0
                    ? <><strong className="text-dark">{selected.size}</strong> selected</>
                    : "No staff selected"}
                </p>
                <div className="flex gap-2">
                  <button onClick={onClose}
                    className="px-4 py-2 border border-surface-border rounded-xl text-sm font-medium text-dark hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleEnroll} disabled={!canAssign || enrolling}
                    className="flex items-center gap-2 px-4 py-2 bg-sprout-green text-white rounded-xl text-sm font-semibold hover:bg-sprout-green/90 disabled:opacity-50 transition-colors">
                    {enrolling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                    {selected.size > 0 ? `Enroll ${selected.size} Staff` : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
