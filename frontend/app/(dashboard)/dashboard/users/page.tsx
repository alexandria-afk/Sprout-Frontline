"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import clsx from "clsx";
import Link from "next/link";
import { Pencil, Trash2, UserPlus, Upload, Users, ChevronLeft, ChevronRight, Search, X, Download } from "lucide-react";
import { useUserStore } from "@/stores/useUserStore";
import { createUser, updateUser, deleteUser, bulkImportUsers, listLocations, listUsers, type Location } from "@/services/users";
import { PositionCombobox } from "@/components/shared/PositionCombobox";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/services/supabase/client";
import type { Profile, UserRole } from "@/types";

// ── Shared UI atoms ────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span className={clsx("px-2 py-0.5 rounded-full text-xs font-semibold text-white", {
      "bg-sprout-green": role === "super_admin" || role === "admin",
      "bg-sprout-purple": role === "manager",
      "bg-gray-400": role === "staff",
    })}>
      {{ super_admin: "Super Admin", admin: "Admin", manager: "Manager", staff: "Staff" }[role]}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <div className="w-8 h-8 rounded-full bg-sprout-green flex items-center justify-center text-white text-xs font-bold shrink-0">
      {initials}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr>{[1,2,3,4,5,6].map((i) => (
      <td key={i} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
    ))}</tr>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-dark">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

const inputCls = "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full";
const selectCls = `${inputCls} bg-white`;

// ── Zod schemas ────────────────────────────────────────────────────────────────
const roleEnum = z.enum(["super_admin", "admin", "manager", "staff"]);

const createSchema = z.object({
  full_name: z.string().min(2, "Name required"),
  email: z.string().email("Valid email required"),
  role: roleEnum,
  phone_number: z.string().optional(),
  location_id: z.string().min(1, "Location is required"),
  reports_to: z.string().optional(),
});

const editSchema = z.object({
  full_name: z.string().min(2, "Name required"),
  role: roleEnum,
  phone_number: z.string().optional(),
  is_active: z.boolean().optional(),
  location_id: z.string().min(1, "Location is required"),
  reports_to: z.string().optional(),
});

type CreateFormValues = z.infer<typeof createSchema>;
type EditFormValues = z.infer<typeof editSchema>;

// ── CreateUserModal ────────────────────────────────────────────────────────────
// ── ReportsToCombobox ─────────────────────────────────────────────────────────
function ReportsToCombobox({
  value, onChange, error, excludeId,
}: {
  value: string;
  onChange: (id: string, name: string) => void;
  error?: string;
  excludeId?: string;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Preload name if value already set (edit mode)
  useEffect(() => {
    if (value && !selectedName) {
      listUsers({ page_size: 200 }).then((r) => {
        const found = r.items.find((u) => u.id === value);
        if (found) setSelectedName(found.full_name);
      }).catch(() => {});
    }
  }, [value, selectedName]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!open) return;
      listUsers({ search: search || undefined, page_size: 10 })
        .then((r) => setResults(r.items.filter((u) => u.id !== excludeId)))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [search, open, excludeId]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (u: Profile) => {
    onChange(u.id, u.full_name);
    setSelectedName(u.full_name);
    setSearch("");
    setOpen(false);
  };

  const handleClear = () => {
    onChange("", "");
    setSelectedName("");
    setSearch("");
  };

  return (
    <div ref={ref} className="relative">
      {value && selectedName ? (
        <div className="flex items-center justify-between px-3 py-2 rounded-lg border-2 border-sprout-green bg-sprout-green/5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-sprout-green/20 flex items-center justify-center text-xs font-bold text-sprout-green shrink-0">
              {selectedName.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm font-medium text-dark">{selectedName}</span>
          </div>
          <button type="button" onClick={handleClear} className="p-0.5 hover:bg-white/60 rounded">
            <X className="w-3.5 h-3.5 text-dark/40" />
          </button>
        </div>
      ) : (
        <div className="border border-surface-border rounded-lg overflow-hidden focus-within:border-sprout-green/50 focus-within:ring-2 focus-within:ring-sprout-green/20 transition-all">
          <div className="flex items-center px-3 py-2 gap-2">
            <Search className="w-4 h-4 text-dark-secondary shrink-0" />
            <input
              className="flex-1 text-sm text-dark placeholder:text-dark-secondary focus:outline-none bg-transparent"
              placeholder="Search by name…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
            />
          </div>
          {open && results.length > 0 && (
            <div className="border-t border-surface-border max-h-48 overflow-y-auto divide-y divide-surface-border">
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => handleSelect(u)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 text-left"
                >
                  <div className="w-7 h-7 rounded-full bg-sprout-green/10 flex items-center justify-center text-xs font-bold text-sprout-green shrink-0">
                    {u.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-dark truncate">{u.full_name}</p>
                    <p className="text-xs text-dark-secondary capitalize">{u.role.replace("_", " ")}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {open && results.length === 0 && search.length > 0 && (
            <div className="border-t border-surface-border px-3 py-2 text-xs text-dark-secondary">No users found</div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

// ── CreateUserModal ────────────────────────────────────────────────────────────
function CreateUserModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (id: string) => void }) {
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
  });
  const [apiError, setApiError] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [position, setPosition] = useState("");
  useEffect(() => { listLocations().then(setLocations).catch(() => {}); }, []);

  const reportsToValue = watch("reports_to") ?? "";

  const onSubmit = async (values: CreateFormValues) => {
    setApiError("");
    try {
      const created = await createUser({
        ...values,
        position: position || null,
        reports_to: values.reports_to || undefined,
      });
      onSuccess(created.id);
    } catch (e) { setApiError(friendlyError(e)); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-4 p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-dark">Add User</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
          <Field label="Full Name *" error={errors.full_name?.message}>
            <input className={inputCls} placeholder="Jane Doe" {...register("full_name")} />
          </Field>
          <Field label="Email *" error={errors.email?.message}>
            <input className={inputCls} type="email" placeholder="jane@example.com" {...register("email")} />
          </Field>
          <Field label="Role *" error={errors.role?.message}>
            <select className={selectCls} {...register("role")}>
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </Field>
          <Field label="Position (optional)">
            <PositionCombobox value={position} onChange={setPosition} />
          </Field>
          <Field label="Location *" error={errors.location_id?.message}>
            <select className={selectCls} {...register("location_id")}>
              <option value="">— Select location —</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Reports To" error={errors.reports_to?.message}>
            <ReportsToCombobox
              value={reportsToValue}
              onChange={(id) => setValue("reports_to", id, { shouldValidate: true })}
            />
          </Field>
          <Field label="Phone (optional)" error={errors.phone_number?.message}>
            <input className={inputCls} placeholder="+63 900 000 0000" {...register("phone_number")} />
          </Field>
          {apiError && <p className="text-xs text-red-500">{apiError}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm rounded-lg bg-sprout-green text-white font-medium hover:bg-sprout-green/90 disabled:opacity-60">
              {isSubmitting ? "Sending…" : "Send Invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── EditUserModal ──────────────────────────────────────────────────────────────
function EditUserModal({ user, onClose, onSuccess }: { user: Profile; onClose: () => void; onSuccess: () => void }) {
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      full_name: user.full_name,
      role: user.role,
      phone_number: user.phone_number ?? "",
      is_active: user.is_active,
      location_id: user.location_id ?? "",
      reports_to: user.reports_to ?? "",
    },
  });
  const [apiError, setApiError] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [position, setPosition] = useState(user.position ?? "");
  useEffect(() => { listLocations().then(setLocations).catch(() => {}); }, []);

  const reportsToValue = watch("reports_to") ?? "";

  const onSubmit = async (values: EditFormValues) => {
    setApiError("");
    try {
      await updateUser(user.id, {
        ...values,
        position: position || null,
        reports_to: values.reports_to || null,
      });
      onSuccess();
    } catch (e) { setApiError(friendlyError(e)); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-4 p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-dark">Edit User</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
          <Field label="Full Name *" error={errors.full_name?.message}>
            <input className={inputCls} {...register("full_name")} />
          </Field>
          <Field label="Role *" error={errors.role?.message}>
            <select className={selectCls} {...register("role")}>
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </Field>
          <Field label="Position (optional)">
            <PositionCombobox value={position} onChange={setPosition} />
          </Field>
          <Field label="Location *" error={errors.location_id?.message}>
            <select className={selectCls} {...register("location_id")}>
              <option value="">— Select location —</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Reports To" error={errors.reports_to?.message}>
            <ReportsToCombobox
              value={reportsToValue}
              onChange={(id) => setValue("reports_to", id, { shouldValidate: true })}
              excludeId={user.id}
            />
          </Field>
          <Field label="Phone (optional)" error={errors.phone_number?.message}>
            <input className={inputCls} {...register("phone_number")} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-dark cursor-pointer">
            <input type="checkbox" {...register("is_active")} className="w-4 h-4 accent-sprout-green" />
            Active
          </label>
          {apiError && <p className="text-xs text-red-500">{apiError}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm rounded-lg bg-sprout-green text-white font-medium hover:bg-sprout-green/90 disabled:opacity-60">
              {isSubmitting ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

export default function UsersPage() {
  const router = useRouter();
  const { users, total, loading, error, page, search, fetchUsers, setSearch, setPage, setRole, setLocationId, removeUser } = useUserStore();
  const [showCreate, setShowCreate] = useState(false);
  const [activeRole, setActiveRole] = useState("");
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<{ created: number; failed: number; failures: { row: number; email: string; error: string }[] } | null>(null);
  const [locationMap, setLocationMap] = useState<Record<string, string>>({});
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      const r = data.session?.user?.app_metadata?.role as string | undefined;
      if (r !== "admin" && r !== "super_admin") router.replace("/dashboard");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchUsers(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    listLocations().then((locs) => {
      const map: Record<string, string> = {};
      locs.forEach((l) => { map[l.id] = l.name; });
      setLocationMap(map);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchUsers(), 400);
  }, [setSearch, fetchUsers]);

  const handleRoleFilter = (val: string) => { setActiveRole(val); setRole(val); setTimeout(() => fetchUsers(), 0); };
  const handleLocationFilter = (val: string) => { setLocationId(val); setTimeout(() => fetchUsers(), 0); };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    try { await deleteUser(deleteId); removeUser(deleteId); setDeleteId(null); }
    catch { /* keep row */ }
    finally { setDeleteLoading(false); }
  };

  const handleDownloadTemplate = () => {
    const hint = "# role options: staff | manager | admin | super_admin  |  phone_number and position are optional";
    const header = "full_name,email,role,phone_number,position,location_id";
    const locationRows = Object.entries(locationMap).map(([id, name]) =>
      `Example Staff,staff_${name.toLowerCase().replace(/\s+/g, "")}@example.com,staff,,Staff,${id}`
    );
    const rows = [hint, header, ...locationRows].join("\n");
    const blob = new Blob([rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "users_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError("");
    setImportResult(null);
    try {
      const res = await bulkImportUsers(file);
      const result = res.data;
      const created = result?.successes?.length ?? 0;
      const failures = result?.failures ?? [];
      setImportResult({ created, failed: failures.length, failures });
      fetchUsers();
    }
    catch (err) { setImportError((err as Error).message); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4 md:gap-6">
      <div className="flex items-center gap-2 mb-1">
        <Link href="/dashboard/settings" className="flex items-center gap-1 text-sm text-dark-secondary hover:text-dark transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Settings
        </Link>
        <span className="text-dark-secondary/40 text-sm">/</span>
      </div>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-dark">Users</h1>
          <p className="text-sm text-dark-secondary">{total} total members</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          <button
            onClick={handleDownloadTemplate}
            title="Download CSV template with correct location IDs"
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-border text-sm text-dark hover:bg-gray-50"
          >
            <Download className="w-4 h-4" /><span className="hidden sm:inline"> Template</span>
          </button>
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-border text-sm text-dark hover:bg-gray-50">
            <Upload className="w-4 h-4" /><span className="hidden sm:inline"> Import CSV</span>
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sprout-green text-white text-sm font-medium hover:bg-sprout-green/90">
            <UserPlus className="w-4 h-4" /><span className="hidden sm:inline"> Add User</span>
          </button>
        </div>
      </div>

      {importError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">
          {importError}
        </div>
      )}

      {importResult && (
        <div className={`border rounded-lg px-4 py-3 text-sm flex flex-col gap-1 ${importResult.failed === 0 ? "bg-green-50 border-green-200 text-green-800" : importResult.created === 0 ? "bg-red-50 border-red-200 text-red-700" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">
              {importResult.created > 0 && `${importResult.created} user${importResult.created !== 1 ? "s" : ""} imported`}
              {importResult.created > 0 && importResult.failed > 0 && " · "}
              {importResult.failed > 0 && `${importResult.failed} failed`}
              {importResult.created === 0 && importResult.failed === 0 && "No users imported"}
            </span>
            <button onClick={() => setImportResult(null)} className="text-xs underline opacity-70 hover:opacity-100">Dismiss</button>
          </div>
          {importResult.failures.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs opacity-90">
              {importResult.failures.map((f) => (
                <li key={f.row}>Row {f.row}: <span className="font-medium">{f.email}</span> — {f.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-2">
        {/* Row 1: search + location select */}
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="w-4 h-4 text-dark-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              placeholder="Search by name…"
              defaultValue={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40"
            />
          </div>
          <select onChange={(e) => handleLocationFilter(e.target.value)} className="border border-surface-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40 max-w-[200px]">
            <option value="">All Locations</option>
            {Object.entries(locationMap).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
        {/* Row 2: role chips */}
        <div className="flex gap-1.5 flex-wrap">
          {([["", "All Roles"], ["super_admin", "Super Admin"], ["admin", "Admin"], ["manager", "Manager"], ["staff", "Staff"]] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => handleRoleFilter(val)}
              className={clsx(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                activeRole === val
                  ? "bg-sprout-cyan text-white border-sprout-cyan"
                  : "bg-white text-dark-secondary border-surface-border hover:border-sprout-cyan hover:text-sprout-cyan"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>}

      {/* Table — desktop */}
      <div className="hidden sm:block bg-white rounded-xl border border-surface-border overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="border-b border-surface-border bg-surface-page">
              {["User","Role","Location","Reports To","Status","Actions"].map((h, i) => (
                <th key={h} className={clsx("px-4 py-3 font-medium text-dark-secondary", i === 5 ? "text-right" : "text-left")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
            ) : users.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-16 text-center">
                <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-dark-secondary">No users found.</p>
              </td></tr>
            ) : users.map((user) => (
              <tr key={user.id} className={clsx("hover:bg-surface-page transition-colors duration-700", justCreatedId === user.id && "bg-violet-50 ring-1 ring-violet-200")}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={user.full_name} />
                    <div>
                      <span className="font-medium text-dark">{user.full_name}</span>
                      {user.position && (
                        <p className="text-xs text-dark-secondary mt-0.5">{user.position}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                <td className="px-4 py-3 text-dark-secondary text-xs max-w-[160px]">
                  <span className="block truncate" title={user.location_id ? locationMap[user.location_id] : undefined}>
                    {user.location_id ? locationMap[user.location_id] ?? "—" : (
                      <span className="text-amber-600 font-medium">No location</span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-dark-secondary text-xs">
                  {user.reports_to_profile?.full_name ?? (
                    user.reports_to ? <span className="text-dark-secondary">—</span> : <span className="text-amber-600 font-medium">Not set</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={clsx("px-2 py-0.5 rounded-full text-xs font-semibold", user.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                    {user.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {deleteId === user.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-dark-secondary">Delete?</span>
                        <button onClick={handleDelete} disabled={deleteLoading} className="text-xs text-red-600 font-medium hover:underline">Yes</button>
                        <button onClick={() => setDeleteId(null)} className="text-xs text-dark-secondary hover:underline">No</button>
                      </div>
                    ) : (
                      <>
                        <button onClick={() => setEditUser(user)} className="p-1.5 rounded-lg hover:bg-gray-100 text-dark-secondary"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setDeleteId(user.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"><Trash2 className="w-4 h-4" /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Card list — mobile */}
      <div className="sm:hidden flex flex-col gap-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-surface-border p-4 animate-pulse flex gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-200 shrink-0" />
              <div className="flex-1 flex flex-col gap-2">
                <div className="h-4 w-1/2 bg-gray-200 rounded" />
                <div className="h-3 w-1/3 bg-gray-100 rounded" />
              </div>
            </div>
          ))
        ) : users.length === 0 ? (
          <div className="py-12 text-center">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-dark-secondary text-sm">No users found.</p>
          </div>
        ) : users.map((user) => (
          <div key={user.id} className="bg-white rounded-xl border border-surface-border p-4 flex items-center gap-3">
            <Avatar name={user.full_name} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-dark text-sm truncate">{user.full_name}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <RoleBadge role={user.role} />
                <span className={clsx("px-2 py-0.5 rounded-full text-xs font-semibold", user.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                  {user.is_active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {deleteId === user.id ? (
                <div className="flex items-center gap-1">
                  <button onClick={handleDelete} disabled={deleteLoading} className="text-xs text-red-600 font-medium px-2 py-1 rounded hover:bg-red-50">Yes</button>
                  <button onClick={() => setDeleteId(null)} className="text-xs text-dark-secondary px-2 py-1 rounded hover:bg-gray-50">No</button>
                </div>
              ) : (
                <>
                  <button onClick={() => setEditUser(user)} className="p-2 rounded-lg hover:bg-gray-100 text-dark-secondary"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setDeleteId(user.id)} className="p-2 rounded-lg hover:bg-red-50 text-red-400"><Trash2 className="w-4 h-4" /></button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-dark-secondary">
        <span>Page {page} of {totalPages}</span>
        <div className="flex gap-2">
          <button onClick={() => { setPage(page - 1); fetchUsers(); }} disabled={page <= 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-surface-border hover:bg-gray-50 disabled:opacity-40">
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          <button onClick={() => { setPage(page + 1); fetchUsers(); }} disabled={page >= totalPages}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-surface-border hover:bg-gray-50 disabled:opacity-40">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onSuccess={(id) => { setShowCreate(false); setJustCreatedId(id); setTimeout(() => setJustCreatedId(null), 4000); fetchUsers(); }} />}
      {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSuccess={() => { setEditUser(null); fetchUsers(); }} />}
    </div>
  );
}
