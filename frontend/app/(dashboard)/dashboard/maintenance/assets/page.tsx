"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Package, Plus, Pencil, Trash2, ChevronDown, ChevronUp, ChevronLeft } from "lucide-react";
import {
  listAssets,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset,
} from "@/services/maintenance";
import { listLocations, type Location } from "@/services/users";
import { createClient } from "@/services/supabase/client";
import { friendlyError } from "@/lib/errors";
import type { Asset, MaintenanceTicket, RepairGuide } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls =
  "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full";

function fmt(date: string | null | undefined) {
  if (!date) return "Never";
  return new Date(date).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function currency(n: number) {
  return `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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

function RiskDot({ score }: { score: number | null }) {
  if (score === null) return <span className="text-dark-secondary text-sm">—</span>;
  const color =
    score < 0.3 ? "bg-green-500" : score < 0.7 ? "bg-amber-400" : "bg-red-500";
  const label = score < 0.3 ? "Low" : score < 0.7 ? "Medium" : "High";
  return (
    <div className="flex items-center gap-1.5">
      <span className={clsx("w-2.5 h-2.5 rounded-full inline-block", color)} />
      <span className="text-xs text-dark-secondary">{label}</span>
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-sprout-navy/10 text-sprout-navy capitalize">
      {category}
    </span>
  );
}

// ── Asset form shared fields ──────────────────────────────────────────────────

interface AssetFormState {
  location_id: string;
  name: string;
  category: string;
  serial_number: string;
  model: string;
  manufacturer: string;
  installed_at: string;
  next_maintenance_due_at: string;
}

const defaultForm: AssetFormState = {
  location_id: "",
  name: "",
  category: "",
  serial_number: "",
  model: "",
  manufacturer: "",
  installed_at: "",
  next_maintenance_due_at: "",
};

function AssetFormFields({
  form,
  setForm,
  locations,
}: {
  form: AssetFormState;
  setForm: React.Dispatch<React.SetStateAction<AssetFormState>>;
  locations: Location[];
}) {
  const set =
    (k: keyof AssetFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <>
      <Field label="Location *">
        <select className={clsx(inputCls, "bg-white")} value={form.location_id} onChange={set("location_id")}>
          <option value="">— Select location —</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Asset Name *">
        <input className={inputCls} value={form.name} onChange={set("name")} placeholder="HVAC Unit 1" />
      </Field>
      <Field label="Category *">
        <input className={inputCls} value={form.category} onChange={set("category")} placeholder="e.g. HVAC, Electrical, Plumbing" />
      </Field>
      <Field label="Serial Number">
        <input className={inputCls} value={form.serial_number} onChange={set("serial_number")} placeholder="SN-00001" />
      </Field>
      <Field label="Model">
        <input className={inputCls} value={form.model} onChange={set("model")} placeholder="Model X200" />
      </Field>
      <Field label="Manufacturer">
        <input className={inputCls} value={form.manufacturer} onChange={set("manufacturer")} placeholder="Carrier" />
      </Field>
      <Field label="Installed At">
        <input className={inputCls} type="date" value={form.installed_at} onChange={set("installed_at")} />
      </Field>
      <Field label="Next Maintenance Due">
        <input className={inputCls} type="date" value={form.next_maintenance_due_at} onChange={set("next_maintenance_due_at")} />
      </Field>
    </>
  );
}

// ── CreateAssetModal ──────────────────────────────────────────────────────────

function CreateAssetModal({
  locations,
  onClose,
  onSuccess,
}: {
  locations: Location[];
  onClose: () => void;
  onSuccess: (id: string) => void;
}) {
  const [form, setForm] = useState<AssetFormState>(defaultForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.location_id) { setError("Location is required."); return; }
    if (!form.name.trim()) { setError("Asset name is required."); return; }
    if (!form.category.trim()) { setError("Category is required."); return; }
    setError("");
    setLoading(true);
    try {
      const created = await createAsset({
        location_id: form.location_id,
        name: form.name.trim(),
        category: form.category.trim(),
        serial_number: form.serial_number || undefined,
        model: form.model || undefined,
        manufacturer: form.manufacturer || undefined,
        installed_at: form.installed_at || undefined,
        next_maintenance_due_at: form.next_maintenance_due_at || undefined,
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-dark">Add Asset</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <AssetFormFields form={form} setForm={setForm} locations={locations} />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {loading ? "Creating…" : "Save Asset"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── EditAssetModal ────────────────────────────────────────────────────────────

function EditAssetModal({
  asset,
  locations,
  onClose,
  onSuccess,
}: {
  asset: Asset;
  locations: Location[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<AssetFormState>({
    location_id: asset.location_id ?? "",
    name: asset.name,
    category: asset.category,
    serial_number: asset.serial_number ?? "",
    model: asset.model ?? "",
    manufacturer: asset.manufacturer ?? "",
    installed_at: asset.installed_at ? asset.installed_at.split("T")[0] : "",
    next_maintenance_due_at: asset.next_maintenance_due_at
      ? asset.next_maintenance_due_at.split("T")[0]
      : "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.name.trim()) { setError("Asset name is required."); return; }
    if (!form.category.trim()) { setError("Category is required."); return; }
    setError("");
    setLoading(true);
    try {
      await updateAsset(asset.id, {
        name: form.name.trim(),
        category: form.category.trim(),
        serial_number: form.serial_number || undefined,
        model: form.model || undefined,
        manufacturer: form.manufacturer || undefined,
        installed_at: form.installed_at || undefined,
        next_maintenance_due_at: form.next_maintenance_due_at || undefined,
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-dark">Edit Asset</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <AssetFormFields form={form} setForm={setForm} locations={locations} />
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

// ── AssetDetailSheet ──────────────────────────────────────────────────────────

function AssetDetailSheet({ assetId }: { assetId: string }) {
  const [data, setData] = useState<(Asset & { maintenance_tickets?: MaintenanceTicket[] }) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAsset(assetId)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [assetId]);

  if (loading)
    return (
      <tr>
        <td colSpan={8} className="px-4 py-4">
          <div className="h-16 bg-gray-100 rounded animate-pulse" />
        </td>
      </tr>
    );
  if (!data) return null;

  const tickets = data.maintenance_tickets ?? [];
  const ticketCount = tickets.length;
  const totalCost = tickets.reduce((sum, t) => sum + (t.cost ?? 0), 0);

  return (
    <tr>
      <td colSpan={8} className="bg-gray-50 px-4 py-4 border-t border-surface-border">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs font-medium text-dark-secondary mb-1">Asset Details</p>
            <p className="text-dark"><span className="text-dark-secondary">Model:</span> {data.model ?? "—"}</p>
            <p className="text-dark"><span className="text-dark-secondary">Manufacturer:</span> {data.manufacturer ?? "—"}</p>
            <p className="text-dark"><span className="text-dark-secondary">Installed:</span> {fmt(data.installed_at)}</p>
            <p className="text-dark"><span className="text-dark-secondary">Next Service:</span> {fmt(data.next_maintenance_due_at)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-dark-secondary mb-1">Maintenance Summary</p>
            <p className="text-dark">{ticketCount} linked ticket{ticketCount !== 1 ? "s" : ""}</p>
            <p className="text-dark">Total cost: {currency(totalCost)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-dark-secondary mb-1">Risk Info</p>
            <p className="text-dark">
              <span className="text-dark-secondary">Failure risk:</span>{" "}
              {data.failure_risk_score != null
                ? `${(data.failure_risk_score * 100).toFixed(0)}%`
                : "—"}
            </p>
            <p className="text-dark">
              <span className="text-dark-secondary">Days to failure:</span>{" "}
              {data.predicted_days_to_failure ?? "—"}
            </p>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listAssets();
      setAssets(res.data);
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
    listLocations().then(setLocations).catch(() => {});
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await deleteAsset(deleteId);
      setAssets((p) => p.filter((a) => a.id !== deleteId));
      setDeleteId(null);
    } catch {
      /* keep row */
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      <div className="max-w-[1600px] mx-auto w-full flex flex-col gap-4 md:gap-6">
      <div className="flex items-center gap-2 mb-1">
        <Link href="/dashboard/settings" className="flex items-center gap-1 text-sm text-dark-secondary hover:text-dark transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Settings
        </Link>
        <span className="text-dark-secondary/40 text-sm">/</span>
      </div>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Package className="w-6 h-6 text-sprout-purple" />
          <div>
            <h1 className="text-2xl font-bold text-dark">Assets</h1>
            <p className="text-sm text-dark-secondary">{assets.length} registered</p>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-sprout-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-sprout-purple/90 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add Asset
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
            <div key={i} className="bg-white rounded-2xl border border-surface-border p-4 animate-pulse h-16" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-surface-border p-10 flex flex-col items-center gap-6">
          <div className="text-center">
            <h3 className="text-base font-semibold text-dark">No assets registered</h3>
            <p className="text-sm text-dark-secondary mt-1">Get started by registering your first asset.</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex flex-col items-center text-center gap-3 p-5 rounded-2xl border-2 border-surface-border hover:border-sprout-purple hover:shadow-sm transition-all w-48">
              <div className="w-11 h-11 rounded-xl bg-sprout-purple/10 flex items-center justify-center">
                <Plus className="w-5 h-5 text-sprout-purple" />
              </div>
              <div>
                <p className="font-semibold text-dark text-sm">Add an Asset</p>
                <p className="text-xs text-dark/50 mt-0.5 leading-snug">Register equipment or machinery</p>
              </div>
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-border overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-surface-border">
                {[
                  "Name",
                  "Category",
                  "Location",
                  "Serial No.",
                  "Manufacturer",
                  "Last Maintenance",
                  "Total Repair Cost",
                  "Risk",
                  "",
                ].map((h, i) => (
                  <th
                    key={i}
                    className="px-4 py-3 font-medium text-dark-secondary text-left whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {assets.map((asset) => (
                <>
                  <tr
                    key={asset.id}
                    className={clsx(
                      "hover:bg-gray-50 transition-colors duration-700 cursor-pointer",
                      expandedId === asset.id && "bg-gray-50",
                      justCreatedId === asset.id && "bg-violet-50 ring-1 ring-violet-200"
                    )}
                    onClick={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
                  >
                    <td className="px-4 py-3 font-medium text-dark">{asset.name}</td>
                    <td className="px-4 py-3">
                      <CategoryBadge category={asset.category} />
                    </td>
                    <td className="px-4 py-3 text-dark-secondary">
                      {asset.locations?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-dark-secondary">
                      {asset.serial_number ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-dark-secondary">
                      {asset.manufacturer ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-dark-secondary">
                      {fmt(asset.last_maintenance_at)}
                    </td>
                    <td className="px-4 py-3 text-dark">
                      {currency(asset.total_repair_cost)}
                    </td>
                    <td className="px-4 py-3">
                      <RiskDot score={asset.failure_risk_score} />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => setEditAsset(asset)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark-secondary"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {isAdmin && (
                          <>
                            {deleteId === asset.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={handleDelete}
                                  disabled={deleteLoading}
                                  className="text-xs text-red-600 font-medium hover:underline px-1"
                                >
                                  Yes
                                </button>
                                <button
                                  onClick={() => setDeleteId(null)}
                                  className="text-xs text-dark-secondary hover:underline px-1"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteId(asset.id)}
                                className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )}
                        {expandedId === asset.id ? (
                          <ChevronUp className="w-4 h-4 text-dark-secondary ml-1" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-dark-secondary ml-1" />
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === asset.id && <AssetDetailSheet key={`detail-${asset.id}`} assetId={asset.id} />}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateAssetModal
          locations={locations}
          onClose={() => setShowCreate(false)}
          onSuccess={(id) => {
            setShowCreate(false);
            setJustCreatedId(id);
            setTimeout(() => setJustCreatedId(null), 4000);
            load();
          }}
        />
      )}
      {editAsset && (
        <EditAssetModal
          asset={editAsset}
          locations={locations}
          onClose={() => setEditAsset(null)}
          onSuccess={() => {
            setEditAsset(null);
            load();
          }}
        />
      )}
      </div>
    </div>
  );
}
