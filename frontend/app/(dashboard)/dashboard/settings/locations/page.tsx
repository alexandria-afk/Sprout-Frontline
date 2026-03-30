"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, Plus, Pencil, Trash2, ChevronLeft } from "lucide-react";
import { listLocations, createLocation, updateLocation, deleteLocation, type Location } from "@/services/users";
import { friendlyError } from "@/lib/errors";

const inputCls =
  "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full";

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-dark">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── Create / Edit modal ───────────────────────────────────────────────────────

function LocationModal({
  existing,
  onClose,
  onSuccess,
}: {
  existing?: Location | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [latitude, setLatitude] = useState(existing?.latitude != null ? String(existing.latitude) : "");
  const [longitude, setLongitude] = useState(existing?.longitude != null ? String(existing.longitude) : "");
  const [geoFence, setGeoFence] = useState(existing?.geo_fence_radius_meters != null ? String(existing.geo_fence_radius_meters) : "200");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("Location name is required."); return; }
    setError("");
    setLoading(true);
    const lat = latitude.trim() ? parseFloat(latitude) : null;
    const lng = longitude.trim() ? parseFloat(longitude) : null;
    const radius = geoFence.trim() ? parseInt(geoFence) : 200;
    try {
      if (existing) {
        await updateLocation(existing.id, { name: name.trim(), address: address.trim() || undefined, latitude: lat, longitude: lng, geo_fence_radius_meters: radius });
      } else {
        await createLocation({ name: name.trim(), address: address.trim() || undefined, latitude: lat, longitude: lng, geo_fence_radius_meters: radius });
      }
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
        <h2 className="text-lg font-semibold text-dark">
          {existing ? "Edit Location" : "New Location"}
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Location Name *">
            <input
              className={inputCls}
              placeholder="e.g. Eastwood Branch"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Address (optional)">
            <input
              className={inputCls}
              placeholder="e.g. 6/F Eastwood City Cyberpark, Quezon City"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude (optional)">
              <input
                className={inputCls}
                placeholder="e.g. 14.6053"
                type="number"
                step="any"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
              />
            </Field>
            <Field label="Longitude (optional)">
              <input
                className={inputCls}
                placeholder="e.g. 121.0794"
                type="number"
                step="any"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Geo-fence Radius (meters)">
            <input
              className={inputCls}
              placeholder="200"
              type="number"
              min="50"
              value={geoFence}
              onChange={(e) => setGeoFence(e.target.value)}
            />
          </Field>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60"
            >
              {loading ? "Saving…" : existing ? "Save Changes" : "Create Location"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editLocation, setEditLocation] = useState<Location | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    listLocations()
      .then(setLocations)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    setDeleteError("");
    try {
      await deleteLocation(deleteId);
      setDeleteId(null);
      load();
    } catch (e) {
      setDeleteError(friendlyError(e));
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4 md:gap-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-1 text-sm text-dark-secondary hover:text-dark transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Settings
        </Link>
        <span className="text-dark-secondary/40 text-sm">/</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sprout-purple/10 flex items-center justify-center">
            <MapPin className="w-5 h-5 text-sprout-purple" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Locations</h1>
            <p className="text-sm text-dark-secondary">
              {loading ? "Loading…" : `${locations.length} location${locations.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sprout-purple text-white text-sm font-medium hover:bg-sprout-purple/90"
        >
          <Plus className="w-4 h-4" />
          New Location
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-surface-border h-16 animate-pulse" />
          ))}
        </div>
      ) : locations.length === 0 ? (
        <div className="bg-white rounded-2xl border border-surface-border p-10 flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-sprout-purple/10 flex items-center justify-center">
            <MapPin className="w-6 h-6 text-sprout-purple" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-dark">No locations yet</p>
            <p className="text-sm text-dark-secondary mt-1">
              Add your first branch or site to get started.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sprout-purple text-white text-sm font-medium hover:bg-sprout-purple/90"
          >
            <Plus className="w-4 h-4" />
            New Location
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-surface-page">
                {["Location", "Address", "Actions"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-4 py-3 font-medium text-dark-secondary ${i === 2 ? "text-right" : "text-left"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {locations.map((loc) => (
                <tr key={loc.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-sprout-purple shrink-0" />
                      <span className="font-medium text-dark">{loc.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-dark-secondary text-xs">
                    {loc.address ?? <span className="italic opacity-50">No address</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => setEditLocation(loc)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-dark-secondary"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {deleteId === loc.id ? (
                        <div className="flex items-center gap-2 ml-1">
                          <span className="text-xs text-dark-secondary">Delete?</span>
                          <button
                            onClick={handleDelete}
                            disabled={deleteLoading}
                            className="text-xs text-red-600 font-medium hover:underline"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => { setDeleteId(null); setDeleteError(""); }}
                            className="text-xs text-dark-secondary hover:underline"
                          >
                            No
                          </button>
                          {deleteError && (
                            <span className="text-xs text-red-500 ml-1">{deleteError}</span>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteId(loc.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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
        <LocationModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); load(); }}
        />
      )}
      {editLocation && (
        <LocationModal
          existing={editLocation}
          onClose={() => setEditLocation(null)}
          onSuccess={() => { setEditLocation(null); load(); }}
        />
      )}
    </div>
  );
}
