"use client";

import { useEffect, useState, useCallback } from "react";
import clsx from "clsx";
import { Trash2, BarChart2, X, CheckCircle2 } from "lucide-react";
import { markRead, acknowledgeAnnouncement, getReceiptStats, type ReceiptStats } from "@/services/announcements";
import type { Announcement } from "@/types";

// ── Avatar initials ─────────────────────────────────────────────────────────
export function Avatar({ name, size = "md" }: { name?: string | null; size?: "sm" | "md" }) {
  const initials = (name ?? "?")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className={clsx(
      "rounded-full bg-sprout-purple/10 flex items-center justify-center font-semibold text-sprout-purple shrink-0",
      size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm"
    )}>
      {initials}
    </div>
  );
}

// ── Media helpers ────────────────────────────────────────────────────────────
export function isVideo(url: string) {
  return /\.(mp4|mov|webm|avi|m4v)(\?|$)/i.test(url);
}

export function proxied(url: string) {
  if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) {
    return `/api/media?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function MediaItem({ url, className, onClick }: { url: string; className?: string; onClick?: () => void }) {
  const src = proxied(url);
  if (isVideo(url)) {
    return (
      <video src={src} controls className={clsx("w-full object-cover bg-black", className)}
        onError={() => console.error("Video load failed:", url)} />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="Photo" className={clsx("w-full object-cover", onClick && "cursor-zoom-in", className)}
      onClick={onClick}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
  );
}

export function MediaGrid({ urls, onItemClick }: { urls: string[]; onItemClick?: (url: string) => void }) {
  if (!urls.length) return null;
  if (urls.length === 1) {
    return (
      <div className="overflow-hidden bg-gray-100">
        <MediaItem url={urls[0]} className="max-h-[500px] w-full object-contain" onClick={!isVideo(urls[0]) ? () => onItemClick?.(urls[0]) : undefined} />
      </div>
    );
  }
  if (urls.length === 2) {
    return (
      <div className="grid grid-cols-2 gap-0.5 bg-gray-200 overflow-hidden">
        <MediaItem url={urls[0]} className="h-60 w-full object-cover" onClick={!isVideo(urls[0]) ? () => onItemClick?.(urls[0]) : undefined} />
        <MediaItem url={urls[1]} className="h-60 w-full object-cover" onClick={!isVideo(urls[1]) ? () => onItemClick?.(urls[1]) : undefined} />
      </div>
    );
  }
  if (urls.length === 3) {
    return (
      <div className="grid grid-cols-2 gap-0.5 bg-gray-200 overflow-hidden">
        <MediaItem url={urls[0]} className="h-64 row-span-2 w-full object-cover" onClick={!isVideo(urls[0]) ? () => onItemClick?.(urls[0]) : undefined} />
        <MediaItem url={urls[1]} className="h-[7.75rem] w-full object-cover" onClick={!isVideo(urls[1]) ? () => onItemClick?.(urls[1]) : undefined} />
        <MediaItem url={urls[2]} className="h-[7.75rem] w-full object-cover" onClick={!isVideo(urls[2]) ? () => onItemClick?.(urls[2]) : undefined} />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-0.5 bg-gray-200 overflow-hidden">
      {urls.slice(0, 4).map((url, i) => (
        <div key={url} className="relative">
          <MediaItem url={url} className="h-48 w-full object-cover" onClick={!isVideo(url) ? () => onItemClick?.(url) : undefined} />
          {i === 3 && urls.length > 4 && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-none">
              <span className="text-white font-bold text-2xl">+{urls.length - 4}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Receipt stats panel ──────────────────────────────────────────────────────
function StatsPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [stats, setStats] = useState<ReceiptStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    getReceiptStats(id)
      .then((r) => setStats(r))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="bg-surface-page border border-surface-border rounded-xl p-4 text-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold text-dark text-xs uppercase tracking-wide">Receipt Stats</p>
        <button onClick={onClose} className="text-gray-400 hover:text-dark"><X className="w-4 h-4" /></button>
      </div>
      {loading && <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />}
      {err && <p className="text-red-500 text-xs">{err}</p>}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: "Targeted", value: stats.total_targeted },
            { label: "Read", value: `${stats.total_read} (${stats.total_targeted ? Math.round(stats.total_read / stats.total_targeted * 100) : 0}%)` },
            { label: "Acknowledged", value: `${stats.total_acknowledged} (${stats.total_targeted ? Math.round(stats.total_acknowledged / stats.total_targeted * 100) : 0}%)` },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-lg border border-surface-border p-3 text-center">
              <p className="text-lg font-bold text-dark">{s.value}</p>
              <p className="text-xs text-dark-secondary">{s.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AnnouncementCard ─────────────────────────────────────────────────────────
export function AnnouncementCard({ a, onDelete, canManage, highlighted }: {
  a: Announcement;
  onDelete?: () => void;
  canManage: boolean;
  highlighted?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [acking, setAcking] = useState(false);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const handleMediaClick = useCallback((url: string) => setViewUrl(url), []);

  useEffect(() => { markRead(a.id).catch(() => {}); }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAcknowledge = async () => {
    setAcking(true);
    try { await acknowledgeAnnouncement(a.id); setAcknowledged(true); }
    catch { /* ignore */ } finally { setAcking(false); }
  };

  const timeAgo = (() => {
    const date = a.publish_at ? new Date(a.publish_at) : new Date(a.created_at);
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  })();

  const mediaUrls = a.media_urls ?? [];

  return (
    <div className={clsx("rounded-xl shadow-sm overflow-hidden", highlighted ? "bg-violet-50" : "bg-white")}>
      {/* Post header */}
      <div className="px-4 pt-4 pb-2 flex items-start gap-3">
        <Avatar name={a.creator_name} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-dark text-sm leading-tight">{a.creator_name ?? "Admin"}</p>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-xs text-dark-secondary">{timeAgo}</span>
            {a.target_roles?.map((r) => (
              <span key={r} className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[11px] capitalize">{r}</span>
            ))}
          </div>
        </div>
        {canManage && onDelete && (
          confirm ? (
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={onDelete} className="text-xs text-red-600 font-semibold hover:underline">Delete</button>
              <button onClick={() => setConfirm(false)} className="text-xs text-dark-secondary hover:underline">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirm(true)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-400 shrink-0 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          )
        )}
      </div>

      {/* Post body */}
      <div className="px-4 pb-3">
        <p className="font-semibold text-dark text-[15px] leading-snug mb-1">{a.title}</p>
        <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{a.body}</p>
      </div>

      {/* Media — full bleed */}
      {mediaUrls.length > 0 && (
        <div className="overflow-hidden">
          <MediaGrid urls={mediaUrls} onItemClick={handleMediaClick} />
        </div>
      )}

      {/* Media lightbox */}
      {viewUrl && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setViewUrl(null)}>
          <button type="button" onClick={() => setViewUrl(null)}
            className="absolute top-4 right-4 w-9 h-9 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proxied(viewUrl)} alt="" className="w-full rounded-xl object-contain max-h-[80vh]" />
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-stretch border-t border-gray-100">
        {a.requires_acknowledgement && (
          acknowledged ? (
            <div className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-green-600 select-none">
              <CheckCircle2 className="w-4 h-4" /> Acknowledged
            </div>
          ) : (
            <button onClick={handleAcknowledge} disabled={acking}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-dark-secondary hover:bg-gray-50 disabled:opacity-50 transition-colors">
              <CheckCircle2 className="w-4 h-4" />
              {acking ? "Acknowledging…" : "Acknowledge"}
            </button>
          )
        )}
        {canManage && (
          <button onClick={() => setShowStats((v) => !v)}
            className={clsx(
              "flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50",
              a.requires_acknowledgement ? "border-l border-gray-100" : "flex-1",
              showStats ? "text-sprout-cyan" : "text-dark-secondary"
            )}>
            <BarChart2 className="w-4 h-4" />
            <span className="hidden sm:inline">Stats</span>
          </button>
        )}
        {!a.requires_acknowledgement && !canManage && <div className="flex-1 py-2.5" />}
      </div>

      {/* Stats panel */}
      {showStats && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
          <StatsPanel id={a.id} onClose={() => setShowStats(false)} />
        </div>
      )}
    </div>
  );
}
