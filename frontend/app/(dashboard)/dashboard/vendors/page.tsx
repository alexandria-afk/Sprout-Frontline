"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Building2, Pencil, Trash2, Plus, X, ChevronDown, ChevronLeft } from "lucide-react";
import {
  listVendors,
  createVendor,
  updateVendor,
  deleteVendor,
  grantVendorCategoryAccess,
  revokeVendorCategoryAccess,
} from "@/services/vendors";
import { listIssueCategories } from "@/services/issues";
import { createClient } from "@/services/supabase/client";
import { friendlyError } from "@/lib/errors";
import type { Vendor, IssueCategory } from "@/types";

// ── Shared atoms ──────────────────────────────────────────────────────────────

const inputCls =
  "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-dark">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={clsx(
        "px-2 py-0.5 rounded-full text-xs font-semibold",
        active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
      )}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

// ── CreateVendorModal ─────────────────────────────────────────────────────────

function CreateVendorModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (id: string) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("Vendor name is required."); return; }
    setError("");
    setLoading(true);
    try {
      const created = await createVendor({
        name: form.name.trim(),
        contact_name: form.contact_name || undefined,
        contact_email: form.contact_email || undefined,
        contact_phone: form.contact_phone || undefined,
      });
      onSuccess(created.id);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-dark">Add Vendor</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Vendor Name *">
            <input className={inputCls} value={form.name} onChange={set("name")} placeholder="Acme Repairs" />
          </Field>
          <Field label="Contact Name">
            <input className={inputCls} value={form.contact_name} onChange={set("contact_name")} placeholder="Juan dela Cruz" />
          </Field>
          <Field label="Contact Email">
            <input className={inputCls} type="email" value={form.contact_email} onChange={set("contact_email")} placeholder="vendor@example.com" />
          </Field>
          <Field label="Contact Phone">
            <input className={inputCls} value={form.contact_phone} onChange={set("contact_phone")} placeholder="+63 900 000 0000" />
          </Field>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {loading ? "Creating…" : "Create Vendor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── EditVendorModal ───────────────────────────────────────────────────────────

function EditVendorModal({
  vendor,
  onClose,
  onSuccess,
}: {
  vendor: Vendor;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    name: vendor.name,
    contact_name: vendor.contact_name ?? "",
    contact_email: vendor.contact_email ?? "",
    contact_phone: vendor.contact_phone ?? "",
    is_active: vendor.is_active,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.name.trim()) { setError("Vendor name is required."); return; }
    setError("");
    setLoading(true);
    try {
      await updateVendor(vendor.id, {
        name: form.name.trim(),
        contact_name: form.contact_name || undefined,
        contact_email: form.contact_email || undefined,
        contact_phone: form.contact_phone || undefined,
        is_active: form.is_active,
      });
      onSuccess();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-dark">Edit Vendor</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Vendor Name *">
            <input className={inputCls} value={form.name} onChange={set("name")} />
          </Field>
          <Field label="Contact Name">
            <input className={inputCls} value={form.contact_name} onChange={set("contact_name")} />
          </Field>
          <Field label="Contact Email">
            <input className={inputCls} type="email" value={form.contact_email} onChange={set("contact_email")} />
          </Field>
          <Field label="Contact Phone">
            <input className={inputCls} value={form.contact_phone} onChange={set("contact_phone")} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-dark cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
              className="w-4 h-4 accent-sprout-purple"
            />
            Active
          </label>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {loading ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── CategoryAccessRow ─────────────────────────────────────────────────────────

function CategoryAccessRow({
  vendor,
  categories,
  onRefresh,
}: {
  vendor: Vendor;
  categories: IssueCategory[];
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const granted = vendor.category_access?.filter((ca) => !ca.is_deleted) ?? [];
  const grantedIds = new Set(granted.map((ca) => ca.category_id));
  const available = categories.filter((c) => !grantedIds.has(c.id));

  const revoke = async (categoryId: string) => {
    setActionLoading(categoryId);
    try {
      await revokeVendorCategoryAccess(vendor.id, categoryId);
      onRefresh();
    } catch {
      /* silent */
    } finally {
      setActionLoading(null);
    }
  };

  const grant = async (categoryId: string) => {
    setActionLoading(categoryId);
    setOpen(false);
    try {
      await grantVendorCategoryAccess(vendor.id, categoryId);
      onRefresh();
    } catch {
      /* silent */
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {granted.map((ca) => (
        <span
          key={ca.category_id}
          className="flex items-center gap-1 bg-sprout-purple/10 text-sprout-purple text-xs font-medium px-2 py-0.5 rounded-full"
        >
          {ca.issue_categories?.name ?? ca.category_id}
          <button
            onClick={() => revoke(ca.category_id)}
            disabled={actionLoading === ca.category_id}
            className="ml-0.5 hover:text-red-500 disabled:opacity-50"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      {available.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setOpen((p) => !p)}
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-dashed border-sprout-purple text-sprout-purple hover:bg-sprout-purple/10"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
          {open && (
            <div className="absolute top-7 left-0 z-20 bg-white border border-surface-border rounded-xl shadow-lg py-1 w-44 max-h-48 overflow-y-auto">
              {available.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => grant(cat.id)}
                  disabled={actionLoading === cat.id}
                  className="w-full text-left px-3 py-1.5 text-sm text-dark hover:bg-gray-50 disabled:opacity-50"
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<IssueCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [vRes, cRes] = await Promise.all([listVendors(), listIssueCategories()]);
      setVendors(vRes.data);
      setCategories(cRes.data);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        const role = data.session?.user?.app_metadata?.role as string | undefined;
        setIsAdmin(role === "admin" || role === "super_admin");
      });
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await deleteVendor(deleteId);
      setVendors((p) => p.filter((v) => v.id !== deleteId));
      setDeleteId(null);
    } catch {
      /* keep row */
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      <div className="flex items-center gap-2 mb-1">
        <Link href="/dashboard/settings" className="flex items-center gap-1 text-sm text-dark-secondary hover:text-dark transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Settings
        </Link>
        <span className="text-dark-secondary/40 text-sm">/</span>
      </div>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Building2 className="w-6 h-6 text-sprout-purple" />
          <div>
            <h1 className="text-2xl font-bold text-dark">Vendors</h1>
            <p className="text-sm text-dark-secondary">{vendors.length} total</p>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add Vendor
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-surface-border p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : vendors.length === 0 ? (
        <div className="bg-white rounded-2xl border border-surface-border p-10 flex flex-col items-center gap-6">
          <div className="text-center">
            <h3 className="text-base font-semibold text-dark">No vendors yet</h3>
            <p className="text-sm text-dark-secondary mt-1">Get started by adding your first vendor.</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex flex-col items-center text-center gap-3 p-5 rounded-2xl border-2 border-surface-border hover:border-sprout-purple hover:shadow-sm transition-all w-48">
              <div className="w-11 h-11 rounded-xl bg-sprout-purple/10 flex items-center justify-center">
                <Plus className="w-5 h-5 text-sprout-purple" />
              </div>
              <div>
                <p className="font-semibold text-dark text-sm">Add a Vendor</p>
                <p className="text-xs text-dark/50 mt-0.5 leading-snug">Enter vendor details manually</p>
              </div>
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-border overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-surface-border">
                {["Vendor", "Contact", "Status", "Category Access", "Actions"].map((h, i) => (
                  <th
                    key={h}
                    className={clsx(
                      "px-4 py-3 font-medium text-dark-secondary text-left",
                      i === 4 && "text-right"
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {vendors.map((vendor) => (
                <tr key={vendor.id} className={clsx("hover:bg-gray-50 transition-colors duration-700", justCreatedId === vendor.id && "bg-violet-50 ring-1 ring-violet-200")}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-dark">{vendor.name}</p>
                  </td>
                  <td className="px-4 py-3 text-dark-secondary">
                    {vendor.contact_name && <p className="text-dark">{vendor.contact_name}</p>}
                    {vendor.contact_email && <p className="text-xs">{vendor.contact_email}</p>}
                    {vendor.contact_phone && <p className="text-xs">{vendor.contact_phone}</p>}
                    {!vendor.contact_name && !vendor.contact_email && !vendor.contact_phone && "—"}
                  </td>
                  <td className="px-4 py-3">
                    <ActiveBadge active={vendor.is_active} />
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <CategoryAccessRow
                      vendor={vendor}
                      categories={categories}
                      onRefresh={load}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {deleteId === vendor.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-dark-secondary">Delete?</span>
                          <button
                            onClick={handleDelete}
                            disabled={deleteLoading}
                            className="text-xs text-red-600 font-medium hover:underline"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setDeleteId(null)}
                            className="text-xs text-dark-secondary hover:underline"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditVendor(vendor)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-dark-secondary"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => setDeleteId(vendor.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateVendorModal
          onClose={() => setShowCreate(false)}
          onSuccess={(id) => {
            setShowCreate(false);
            setJustCreatedId(id);
            setTimeout(() => setJustCreatedId(null), 4000);
            load();
          }}
        />
      )}
      {editVendor && (
        <EditVendorModal
          vendor={editVendor}
          onClose={() => setEditVendor(null)}
          onSuccess={() => {
            setEditVendor(null);
            load();
          }}
        />
      )}
    </div>
  );
}
