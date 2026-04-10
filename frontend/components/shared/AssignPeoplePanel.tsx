"use client";
import { useEffect, useState } from "react";
import { Search, Check, Loader2, Users, MapPin, User, Lock } from "lucide-react";
import { listUsers, listLocations, type Location } from "@/services/users";
import { createClient } from "@/services/supabase/client";
import type { Profile } from "@/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import clsx from "clsx";

type AssignMode = "role" | "location" | "individual";

const ROLE_LABELS: Record<string, string> = {
  staff: "Staff",
  manager: "Manager",
  admin: "Admin",
};

const ROLES_TO_SHOW = ["staff", "manager", "admin"] as const;

export interface AssignPeoplePanelProps {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

export function AssignPeoplePanel({ selected, onChange }: AssignPeoplePanelProps) {
  const { user: currentUser } = useCurrentUser();
  const [users, setUsers]         = useState<Profile[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading]     = useState(true);
  const [mode, setMode]           = useState<AssignMode>("role");
  const [search, setSearch]       = useState("");
  const [isManager, setIsManager] = useState(false);
  const [scopeLabel, setScopeLabel] = useState("");   // e.g. "BGC Branch"

  useEffect(() => {
    if (!currentUser) return;
    const _user = currentUser;
    async function load() {
      try {
        const userId  = _user.id ?? "";
        const role    = _user.role ?? "staff";
        const managerMode = role === "manager";
        setIsManager(managerMode);

        if (managerMode) {
          // Get manager's own profile to find their location_id
          const supabase = createClient();
          const { data: myProfile } = await supabase
            .from("profiles")
            .select("location_id")
            .eq("id", userId)
            .single();

          const locationId = myProfile?.location_id as string | null;

          // Fetch users at manager's location only, then client-filter to direct reports
          const [usersRes, allLocs] = await Promise.all([
            locationId
              ? listUsers({ location_id: locationId, page_size: 200 })
              : listUsers({ page_size: 200 }),
            listLocations(),
          ]);

          const myTeam = (usersRes.items as Profile[]).filter(
            (u) => u.reports_to === userId && u.id !== userId
          );
          setUsers(myTeam);

          // Location tab shows only the manager's own location
          const myLoc = (allLocs as Location[]).find((l) => l.id === locationId);
          setLocations(myLoc ? [myLoc] : []);
          setScopeLabel(myLoc?.name ?? "your location");

        } else {
          // Admin / super_admin: full access
          const [s, m, a, locs] = await Promise.all([
            listUsers({ role: "staff",   page_size: 200 }),
            listUsers({ role: "manager", page_size: 200 }),
            listUsers({ role: "admin",   page_size: 200 }),
            listLocations(),
          ]);
          setUsers([
            ...(s as { items: Profile[] }).items,
            ...(m as { items: Profile[] }).items,
            ...(a as { items: Profile[] }).items,
          ]);
          setLocations(locs as Location[]);
        }
      } catch {
        // fail silently — empty list shown
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [currentUser]);

  // ── Selection helpers ────────────────────────────────────────────────────────

  function selectByRole(role: string) {
    const ids = users.filter(u => u.role === role).map(u => u.id);
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id));
    const next = new Set(selected);
    if (allSelected) ids.forEach(id => next.delete(id));
    else ids.forEach(id => next.add(id));
    onChange(next);
  }

  function selectByLocation(locationId: string) {
    const ids = users.filter(u => u.location_id === locationId).map(u => u.id);
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id));
    const next = new Set(selected);
    if (allSelected) ids.forEach(id => next.delete(id));
    else ids.forEach(id => next.add(id));
    onChange(next);
  }

  function toggleUser(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
  }

  // ── Derived lists ────────────────────────────────────────────────────────────

  const roleGroups = (ROLES_TO_SHOW as readonly string[]).map(role => {
    const members = users.filter(u => u.role === role);
    const selectedCount = members.filter(u => selected.has(u.id)).length;
    return { role, total: members.length, selectedCount };
  }).filter(g => g.total > 0);

  const locationGroups = locations.map(loc => {
    const members = users.filter(u => u.location_id === loc.id);
    const selectedCount = members.filter(u => selected.has(u.id)).length;
    return { id: loc.id, name: loc.name, total: members.length, selectedCount };
  }).filter(g => g.total > 0);

  const filteredUsers = search
    ? users.filter(u => u.full_name?.toLowerCase().includes(search.toLowerCase()))
    : users;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="border border-surface-border rounded-xl overflow-hidden">
      {/* Manager scope banner */}
      {isManager && (
        <div className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 border-b border-amber-100">
          <Lock className="w-3 h-3 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-700 font-medium">
            Showing your direct reports at {scopeLabel}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-surface-border bg-gray-50/50">
        {([
          ["role",       Users,   "By Role"],
          ["location",   MapPin,  "By Location"],
          ["individual", User,    "Individual"],
        ] as [AssignMode, React.ElementType, string][]).map(([m, Icon, label]) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={clsx(
              "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors",
              mode === m
                ? "text-sprout-purple border-b-2 border-sprout-purple bg-white"
                : "text-dark-secondary hover:text-dark"
            )}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 text-sprout-purple animate-spin" />
        </div>
      ) : (
        <div className="max-h-52 overflow-y-auto">

          {/* ── By Role ── */}
          {mode === "role" && (
            <div className="p-3 space-y-1.5">
              {roleGroups.length === 0 ? (
                <p className="text-sm text-dark-secondary text-center py-4">
                  {isManager ? "No direct reports found" : "No users found"}
                </p>
              ) : roleGroups.map(({ role, total, selectedCount }) => {
                const allSelected = total > 0 && selectedCount === total;
                const someSelected = selectedCount > 0 && !allSelected;
                return (
                  <button key={role} type="button" onClick={() => selectByRole(role)}
                    className={clsx(
                      "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                      allSelected
                        ? "border-sprout-purple/40 bg-sprout-purple/5"
                        : someSelected
                          ? "border-sprout-purple/20 bg-sprout-purple/3"
                          : "border-surface-border hover:bg-gray-50"
                    )}>
                    <div className={clsx(
                      "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
                      allSelected
                        ? "bg-sprout-purple border-sprout-purple"
                        : someSelected
                          ? "bg-sprout-purple/30 border-sprout-purple/50"
                          : "border-gray-300"
                    )}>
                      {(allSelected || someSelected) && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-dark capitalize">{ROLE_LABELS[role] ?? role}</p>
                      <p className="text-xs text-dark-secondary mt-0.5">{total} member{total !== 1 ? "s" : ""}</p>
                    </div>
                    {selectedCount > 0 && (
                      <span className="text-xs font-bold text-sprout-purple shrink-0">{selectedCount} selected</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* ── By Location ── */}
          {mode === "location" && (
            <div className="p-3 space-y-1.5">
              {locationGroups.length === 0 ? (
                <p className="text-sm text-dark-secondary text-center py-4">No locations found</p>
              ) : locationGroups.map(({ id, name, total, selectedCount }) => {
                const allSelected = total > 0 && selectedCount === total;
                const someSelected = selectedCount > 0 && !allSelected;
                return (
                  <button key={id} type="button" onClick={() => selectByLocation(id)}
                    className={clsx(
                      "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                      allSelected
                        ? "border-sprout-purple/40 bg-sprout-purple/5"
                        : someSelected
                          ? "border-sprout-purple/20 bg-sprout-purple/3"
                          : "border-surface-border hover:bg-gray-50"
                    )}>
                    <div className={clsx(
                      "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
                      allSelected
                        ? "bg-sprout-purple border-sprout-purple"
                        : someSelected
                          ? "bg-sprout-purple/30 border-sprout-purple/50"
                          : "border-gray-300"
                    )}>
                      {(allSelected || someSelected) && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-dark">{name}</p>
                      <p className="text-xs text-dark-secondary mt-0.5">{total} member{total !== 1 ? "s" : ""}</p>
                    </div>
                    {selectedCount > 0 && (
                      <span className="text-xs font-bold text-sprout-purple shrink-0">{selectedCount} selected</span>
                    )}
                    {isManager && (
                      <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Individual ── */}
          {mode === "individual" && (
            <>
              <div className="px-3 pt-2.5 pb-2 border-b border-surface-border">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark/30" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name…"
                    className="w-full pl-8 pr-3 py-1.5 border border-surface-border rounded-lg text-sm bg-white focus:outline-none focus:border-sprout-purple transition-colors"
                  />
                </div>
              </div>
              <div className="divide-y divide-surface-border">
                {filteredUsers.length === 0 ? (
                  <p className="py-6 text-center text-sm text-dark-secondary">
                    {isManager ? "No direct reports found" : "No staff found"}
                  </p>
                ) : filteredUsers.map(user => (
                  <label key={user.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(user.id)}
                      onChange={() => toggleUser(user.id)}
                      className="w-4 h-4 accent-sprout-purple rounded shrink-0"
                    />
                    <div className="w-7 h-7 rounded-full bg-sprout-purple/10 flex items-center justify-center text-xs font-bold text-sprout-purple shrink-0">
                      {(user.full_name ?? "?")[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-dark truncate">{user.full_name}</p>
                      <p className="text-xs text-dark-secondary capitalize">{ROLE_LABELS[user.role] ?? user.role}</p>
                    </div>
                    {selected.has(user.id) && <Check className="w-4 h-4 text-sprout-purple shrink-0" />}
                  </label>
                ))}
              </div>
            </>
          )}

        </div>
      )}
    </div>
  );
}
