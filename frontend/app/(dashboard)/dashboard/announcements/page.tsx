"use client";

import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import clsx from "clsx";
import { Megaphone, Plus, X, ImagePlus, Loader2, Video, Search, MapPin, Users, Globe2, Lock, CheckCircle2, Bell, Film } from "lucide-react";
import { useAnnouncementStore } from "@/stores/useAnnouncementStore";
import { createAnnouncement, deleteAnnouncement } from "@/services/announcements";
import { createClient } from "@/services/supabase/client";
import { listLocations, type Location } from "@/services/users";
import type { Announcement } from "@/types";
import { AnnouncementCard, isVideo, proxied } from "@/components/announcements/AnnouncementCard";
import { friendlyError } from "@/lib/errors";

// ── Shared ──────────────────────────────────────────────────────────────────
const inputCls = "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full";

// ── Skeleton ────────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-surface-border p-4 flex flex-col gap-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" />
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="h-3.5 w-32 bg-gray-200 rounded" />
          <div className="h-3 w-20 bg-gray-100 rounded" />
        </div>
      </div>
      <div className="h-3 w-full bg-gray-100 rounded" />
      <div className="h-3 w-2/3 bg-gray-100 rounded" />
    </div>
  );
}

// ── Media uploader ──────────────────────────────────────────────────────────
function MediaUploader({
  mediaUrls,
  onAdd,
  onRemove,
}: {
  mediaUrls: string[];
  onAdd: (url: string) => void;
  onRemove: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const handleFiles = async (files: File[]) => {
    setUploadError("");
    setUploading(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setUploadError("Not signed in — please refresh and try again.");
      setUploading(false);
      return;
    }
    const userId = session.user.id;
    for (const file of files) {
      const ext = file.name.split(".").pop() ?? "bin";
      const mimeType = file.type || "application/octet-stream";
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      try {
        const { error: uploadErr } = await supabase.storage
          .from("announcement-media")
          .upload(path, file, { contentType: mimeType, upsert: false });
        if (uploadErr) { console.error("Upload error:", uploadErr); throw new Error(uploadErr.message); }
        const { data: pub } = supabase.storage.from("announcement-media").getPublicUrl(path);
        onAdd(pub.publicUrl);
      } catch (e) {
        setUploadError(`Upload failed: ${friendlyError(e)}`);
      }
    }
    setUploading(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-dark">Photos / Videos</label>
      {mediaUrls.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {mediaUrls.map((url) => (
            <div key={url} className="relative w-20 h-20 rounded-lg overflow-hidden border border-surface-border">
              {isVideo(url) ? (
                <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                  <Video className="w-6 h-6 text-gray-400" />
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={proxied(url)} alt="" className="w-full h-full object-cover"
                  onError={() => console.error("Thumbnail load failed:", url)} />
              )}
              <button type="button" onClick={() => onRemove(url)}
                className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center hover:bg-black/80">
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}
      <label className={clsx(
        "flex items-center gap-2 px-3 py-2 border-2 border-dashed rounded-xl text-sm transition-colors",
        uploading
          ? "border-surface-border text-dark-secondary cursor-not-allowed bg-gray-50"
          : "border-sprout-purple/40 text-sprout-purple hover:bg-sprout-purple/5 cursor-pointer"
      )}>
        {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
          : <><ImagePlus className="w-4 h-4" /> Add photos or videos</>}
        <input type="file" accept="image/*,video/mp4,video/quicktime,video/webm" multiple
          disabled={uploading} className="sr-only"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) handleFiles(f); }} />
      </label>
      {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
    </div>
  );
}

// ── CreateAnnouncementModal ─────────────────────────────────────────────────
const announcementSchema = z.object({
  title: z.string().min(2, "Title required"),
  body: z.string().min(5, "Body required"),
  requires_acknowledgement: z.boolean(),
  publish_at: z.string().optional(),
  target_roles: z.array(z.string()),
});
type AnnouncementFormValues = z.infer<typeof announcementSchema>;
const ROLES = ["admin", "manager", "staff"] as const;

type AudienceMode = "role" | "location" | "everyone";

function CreateAnnouncementModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (a: Announcement) => void }) {
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<AnnouncementFormValues>({
      resolver: zodResolver(announcementSchema),
      defaultValues: { title: "", body: "", requires_acknowledgement: false, publish_at: "", target_roles: [] },
    });
  const [apiError, setApiError] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("role");
  // Manager scope — locked to their own location
  const [managerLocationId, setManagerLocationId] = useState<string | null>(null);
  const [managerLocationName, setManagerLocationName] = useState<string>("");
  const selectedRoles = watch("target_roles") ?? [];

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const role = (session?.user?.app_metadata?.role as string) ?? "staff";
      const userId = session?.user?.id ?? "";

      const allLocs = await listLocations().catch(() => [] as Location[]);
      setLocations(allLocs);

      if (role === "manager") {
        const { data: myProfile } = await supabase
          .from("profiles")
          .select("location_id")
          .eq("id", userId)
          .single();
        const locId = myProfile?.location_id as string | null;
        if (locId) {
          setManagerLocationId(locId);
          const locName = allLocs.find((l) => l.id === locId)?.name ?? "your location";
          setManagerLocationName(locName);
          // Pre-lock the location selection
          setSelectedLocationIds([locId]);
          setAudienceMode("location");
        }
      }
    }
    init();
  }, []);

  const toggleRole = (role: string) => {
    const current = selectedRoles;
    setValue("target_roles", current.includes(role) ? current.filter((r) => r !== role) : [...current, role]);
  };

  const switchAudienceMode = (mode: AudienceMode) => {
    setAudienceMode(mode);
    if (mode !== "role") setValue("target_roles", []);
    // Managers always keep their location locked; others clear on tab switch
    if (mode !== "location") {
      setSelectedLocationIds(managerLocationId ? [managerLocationId] : []);
    }
  };

  const onSubmit = async (values: AnnouncementFormValues) => {
    setApiError("");
    try {
      // Managers are always scoped to their location
      const effectiveLocationIds = managerLocationId
        ? [managerLocationId]
        : (audienceMode === "location" && selectedLocationIds.length ? selectedLocationIds : undefined);

      const res = await createAnnouncement({
        title: values.title, body: values.body,
        requires_acknowledgement: values.requires_acknowledgement,
        publish_at: values.publish_at || undefined,
        target_roles: audienceMode === "role" && values.target_roles.length ? values.target_roles : undefined,
        target_location_ids: effectiveLocationIds,
        media_urls: mediaUrls,
      });
      onSuccess(res);
    } catch (e) { setApiError(friendlyError(e)); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-4 p-4 md:p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-dark">New Announcement</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Title *</label>
            <input className={inputCls} placeholder="Announcement title" {...register("title")} />
            {errors.title && <p className="text-xs text-red-500">{errors.title.message}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Body *</label>
            <textarea className={`${inputCls} resize-none`} rows={4} placeholder="Write your announcement…" {...register("body")} />
            {errors.body && <p className="text-xs text-red-500">{errors.body.message}</p>}
          </div>
          <MediaUploader mediaUrls={mediaUrls}
            onAdd={(url) => setMediaUrls((p) => [...p, url])}
            onRemove={(url) => setMediaUrls((p) => p.filter((u) => u !== url))} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-dark">Publish at (optional)</label>
            <input type="datetime-local" className={inputCls} {...register("publish_at")} />
            <p className="text-xs text-dark-secondary">Leave empty to publish immediately.</p>
          </div>

          {/* Audience — 3-tab */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-dark flex items-center gap-2">
              Audience
              {managerLocationId && (
                <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  <Lock className="w-3 h-3" /> {managerLocationName} only
                </span>
              )}
            </label>
            <div className="border border-surface-border rounded-xl overflow-hidden">
              {/* Tabs */}
              <div className="flex border-b border-surface-border bg-gray-50/50">
                {([
                  ["role",     Users,   "By Role"],
                  ["location", MapPin,  "By Location"],
                  ["everyone", Globe2,  "Everyone"],
                ] as [AudienceMode, React.ElementType, string][]).map(([m, Icon, label]) => (
                  <button key={m} type="button" onClick={() => switchAudienceMode(m)}
                    className={clsx(
                      "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors",
                      audienceMode === m
                        ? "text-sprout-purple border-b-2 border-sprout-purple bg-white"
                        : "text-dark-secondary hover:text-dark"
                    )}>
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-3">
                {audienceMode === "role" && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-dark-secondary">Select which roles receive this announcement. Leave all unselected to include all roles.</p>
                    <div className="flex gap-2 flex-wrap">
                      {ROLES.map((role) => (
                        <button key={role} type="button" onClick={() => toggleRole(role)}
                          className={clsx("px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors capitalize",
                            selectedRoles.includes(role)
                              ? "bg-sprout-purple text-white border-sprout-purple"
                              : "border-surface-border text-dark-secondary hover:border-sprout-purple hover:text-sprout-purple")}>
                          {role}
                        </button>
                      ))}
                    </div>
                    {selectedRoles.length === 0 && (
                      <p className="text-xs text-amber-600">No roles selected — all roles will receive this.</p>
                    )}
                  </div>
                )}

                {audienceMode === "location" && (
                  <div className="flex flex-col gap-2">
                    {managerLocationId ? (
                      <div className="flex items-center gap-2 py-1">
                        <div className="w-7 h-7 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                          <MapPin className="w-3.5 h-3.5 text-amber-500" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-dark">{managerLocationName}</p>
                          <p className="text-xs text-dark-secondary">Scoped to your assigned location</p>
                        </div>
                        <Lock className="w-3.5 h-3.5 text-amber-400 ml-auto shrink-0" />
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-dark-secondary">Select which locations receive this. Leave all unselected to broadcast to all locations.</p>
                        {locations.length === 0 ? (
                          <p className="text-xs text-dark-secondary italic">No locations found.</p>
                        ) : (
                          <div className="flex gap-2 flex-wrap">
                            {locations.map((loc) => (
                              <button key={loc.id} type="button"
                                onClick={() => setSelectedLocationIds((prev) =>
                                  prev.includes(loc.id) ? prev.filter((id) => id !== loc.id) : [...prev, loc.id]
                                )}
                                className={clsx("px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                                  selectedLocationIds.includes(loc.id)
                                    ? "bg-sprout-purple text-white border-sprout-purple"
                                    : "border-surface-border text-dark-secondary hover:border-sprout-purple hover:text-sprout-purple")}>
                                {loc.name}
                              </button>
                            ))}
                          </div>
                        )}
                        {selectedLocationIds.length === 0 && locations.length > 0 && (
                          <p className="text-xs text-amber-600">No locations selected — all locations will receive this.</p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {audienceMode === "everyone" && (
                  <div className="flex items-center gap-2.5 py-1">
                    <div className="w-8 h-8 rounded-full bg-sprout-purple/10 flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4 text-sprout-purple" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-dark">
                        {managerLocationId ? `Everyone at ${managerLocationName}` : "All staff"}
                      </p>
                      <p className="text-xs text-dark-secondary">
                        {managerLocationId
                          ? "Sent to all staff at your assigned location."
                          : "This announcement will be sent to every member of your organisation."}
                      </p>
                    </div>
                    {managerLocationId && <Lock className="w-3.5 h-3.5 text-amber-400 ml-auto shrink-0" />}
                  </div>
                )}
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-dark cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-sprout-purple" {...register("requires_acknowledgement")} />
            Requires acknowledgement
          </label>
          {apiError && <p className="text-xs text-red-500">{apiError}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-surface-border hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={isSubmitting}
              className="px-4 py-2 text-sm rounded-lg bg-sprout-purple text-white font-medium hover:bg-sprout-purple/90 disabled:opacity-60">
              {isSubmitting ? "Posting…" : "Post Announcement"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function AnnouncementsPage() {
  const { announcements, total, loading, error, fetchAnnouncements, addAnnouncement, removeAnnouncement } =
    useAnnouncementStore();
  const [showCreate, setShowCreate] = useState(false);
  const [role, setRole] = useState("staff");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  useEffect(() => { fetchAnnouncements(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      setRole((data.session?.user?.app_metadata?.role as string) ?? "staff");
    });
  }, []);

  const isStaff = role === "staff";
  const visibleAnnouncements = search
    ? announcements.filter((a) =>
        a.title.toLowerCase().includes(search.toLowerCase()) ||
        (a.body ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : announcements;
  const handleDelete = async (id: string) => {
    try { await deleteAnnouncement(id); removeAnnouncement(id); } catch { /* ignore */ } finally { setDeletingId(null); }
  };

  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      <div className="flex flex-col gap-4 md:gap-6 max-w-2xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sprout-purple/10 flex items-center justify-center">
              <Megaphone className="w-5 h-5 text-sprout-purple" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-dark">Announcements</h1>
              <p className="text-sm text-dark-secondary">{total} total</p>
            </div>
          </div>
          {!isStaff && (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sprout-purple text-white text-sm font-medium hover:bg-sprout-purple/90">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Announcement</span>
              <span className="sm:hidden">New</span>
            </button>
          )}
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>}

        {/* Stat cards */}
        {!loading && (() => {
          const withMedia = announcements.filter(a => (a.media_urls?.length ?? 0) > 0).length;
          const needsAck = announcements.filter(a => a.requires_acknowledgement).length;
          const unacked = announcements.filter(a => a.requires_acknowledgement && !a.my_acknowledged).length;
          const targeted = announcements.filter(a => (a.target_roles?.length ?? 0) > 0 || (a.target_location_ids?.length ?? 0) > 0).length;

          const staffCards = [
            { label: "Total",                value: total,    icon: Megaphone,     bg: "bg-sprout-purple/10", color: "text-sprout-purple" },
            { label: "Need Acknowledgement", value: unacked,  icon: CheckCircle2,  bg: "bg-amber-50",         color: "text-amber-500"    },
          ];
          const managerCards = [
            { label: "Total",               value: total,     icon: Megaphone,     bg: "bg-sprout-purple/10", color: "text-sprout-purple" },
            { label: "Require Ack",         value: needsAck,  icon: Bell,          bg: "bg-amber-50",         color: "text-amber-500"    },
            { label: "Targeted",            value: targeted,  icon: Users,         bg: "bg-blue-50",          color: "text-blue-600"     },
            { label: "With Media",          value: withMedia, icon: Film,          bg: "bg-sprout-green/10",  color: "text-sprout-green" },
          ];
          const cards = isStaff ? staffCards : managerCards;
          return (
            <div className={clsx("grid gap-3", isStaff ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
              {cards.map(({ label, value, icon: Icon, bg, color }) => (
                <div key={label} className="bg-white rounded-xl border border-surface-border p-4 flex flex-col gap-2 hover:border-sprout-purple/30 hover:shadow-sm transition-all">
                  <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center", bg)}>
                    <Icon className={clsx("w-4 h-4", color)} />
                  </div>
                  <p className="text-xl font-bold text-dark">{value}</p>
                  <p className="text-xs text-dark-secondary">{label}</p>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-dark-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            className="border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40"
            placeholder="Search announcements…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-4">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
          ) : visibleAnnouncements.length === 0 ? (
            <div className="py-16 text-center">
              <Megaphone className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-dark-secondary text-sm">{search ? "No announcements match your search." : "No announcements yet."}</p>
            </div>
          ) : (
            visibleAnnouncements.map((a) => (
              <div key={a.id} className="relative">
                <AnnouncementCard a={a}
                  onDelete={() => setDeletingId(a.id)}
                  canManage={!isStaff}
                  highlighted={justCreatedId === a.id} />
                {deletingId === a.id && (
                  <div className="absolute inset-0 bg-white/95 rounded-2xl border border-red-200 flex flex-col items-center justify-center gap-3 z-10 p-4">
                    <p className="text-sm font-medium text-dark text-center">Delete this announcement?</p>
                    <div className="flex gap-2">
                      <button onClick={() => setDeletingId(null)}
                        className="px-4 py-1.5 text-sm rounded-lg border border-surface-border hover:bg-gray-50">
                        Cancel
                      </button>
                      <button onClick={() => handleDelete(a.id)}
                        className="px-4 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600">
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {showCreate && (
          <CreateAnnouncementModal
            onClose={() => setShowCreate(false)}
            onSuccess={(a) => { addAnnouncement(a); setShowCreate(false); setJustCreatedId(a.id); setTimeout(() => setJustCreatedId(null), 4000); }} />
        )}
      </div>
    </div>
  );
}
