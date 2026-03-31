"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import {
  ArrowLeft, CheckCircle2, Loader2, ClipboardList, ChevronRight,
  X, ImagePlus, MessageSquare, Video, MapPin, Star, QrCode, Pen,
  RotateCcw, ShieldAlert,
} from "lucide-react";
import {
  getAssignmentTemplate,
  getAssignmentDraft,
  getSubmission,
  createSubmission,
  type FormAssignment,
} from "@/services/forms";
import { createClient } from "@/services/supabase/client";
import type { FormTemplate, FormField, FormSection, FormType } from "@/types";
import { friendlyError } from "@/lib/errors";

// ── Helpers ───────────────────────────────────────────────────────────────────

type ConditionalLogicShowHide = {
  type?: "show" | "hide";  // type field is optional for backwards compat
  fieldId: string;
  value: string;
  action: "show" | "hide";
};

type ConditionalLogicShowOptions = {
  type: "show_options";
  fieldId: string;
  optionsMap: Record<string, string[]>;
};

type ConditionalLogic = ConditionalLogicShowHide | ConditionalLogicShowOptions;

function isVisible(field: FormField, answers: Record<string, string>): boolean {
  const cl = field.conditional_logic as ConditionalLogic | null;
  if (!cl) return true;
  if ("type" in cl && cl.type === "show_options") return true; // always visible, options filtered separately
  const showHideCl = cl as ConditionalLogicShowHide;
  const match = answers[showHideCl.fieldId] === showHideCl.value;
  return showHideCl.action === "show" ? match : !match;
}

function getFieldOptions(field: FormField, answers: Record<string, string>): string[] {
  const cl = field.conditional_logic as ConditionalLogic | null;
  if (cl && "type" in cl && cl.type === "show_options") {
    const parentValue = answers[(cl as ConditionalLogicShowOptions).fieldId];
    if (parentValue) {
      return (cl as ConditionalLogicShowOptions).optionsMap[parentValue] ?? field.options ?? [];
    }
    return []; // no parent value selected yet — show empty until parent is chosen
  }
  return field.options ?? [];
}

function TypeBadge({ type }: { type: FormType }) {
  const label =
    type === "checklist" ? "Checklist"
    : type === "audit" ? "Audit"
    : type === "pull_out" ? "Pull-Out"
    : "Form";
  const color =
    type === "checklist" ? "bg-sprout-green"
    : type === "audit" ? "bg-amber-500"
    : type === "pull_out" ? "bg-orange-500"
    : "bg-sprout-purple";
  return (
    <span className={clsx("px-2 py-0.5 rounded-full text-xs font-semibold text-white", color)}>
      {label}
    </span>
  );
}

// ── Helpers for multi-media serialization ─────────────────────────────────────

const MAX_MEDIA = 5;

/** Parse a field value that may be a JSON array, a bare URL, or empty. */
function parseMediaUrls(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch { /* not JSON — treat as legacy single URL */ }
  return [raw];
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm|quicktime)/i.test(url.split("?")[0]);
}

// ── Unified media upload (photo + video, up to MAX_MEDIA) ─────────────────────

function MediaInput({
  value,
  onChange,
  accept,
  isVideo: isVideoMode,
}: {
  value: string;
  onChange: (v: string) => void;
  accept: string;
  isVideo: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [viewUrl, setViewUrl] = useState<string | null>(null);

  const urls = parseMediaUrls(value);
  const canAdd = urls.length < MAX_MEDIA;

  const uploadFile = async (file: File): Promise<string> => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    const ext = file.name.split(".").pop() ?? (isVideoMode ? "mp4" : "jpg");
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("form-photos")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadErr) throw uploadErr;
    const { data: signed, error: signErr } = await supabase.storage
      .from("form-photos")
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
    if (signErr) throw signErr;
    return signed.signedUrl;
  };

  const handleFiles = async (files: File[]) => {
    const remaining = MAX_MEDIA - urls.length;
    const toUpload = files.slice(0, remaining);
    if (!toUpload.length) return;
    setUploadError("");
    setUploading(true);
    try {
      const newUrls = await Promise.all(toUpload.map(uploadFile));
      const next = [...urls, ...newUrls];
      onChange(next.length === 1 ? next[0] : JSON.stringify(next));
    } catch (e) {
      setUploadError(friendlyError(e));
    } finally {
      setUploading(false);
    }
  };

  const removeUrl = (url: string) => {
    const next = urls.filter((u) => u !== url);
    onChange(next.length === 0 ? "" : next.length === 1 ? next[0] : JSON.stringify(next));
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Thumbnails grid */}
      {urls.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {urls.map((url) => (
            <div key={url} className="relative w-24 h-24 rounded-xl overflow-hidden border border-surface-border group cursor-pointer"
              onClick={() => setViewUrl(url)}>
              {isVideoUrl(url) ? (
                <div className="w-full h-full bg-gray-900 flex items-center justify-center">
                  <Video className="w-8 h-8 text-white/70" />
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="w-full h-full object-cover" />
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeUrl(url); }}
                className="absolute top-1 right-1 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
              >
                <X className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add button */}
      {canAdd && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={clsx(
            "flex items-center justify-center gap-2 border-2 border-dashed rounded-xl px-4 py-5 transition-colors",
            uploading
              ? "border-surface-border bg-gray-50 cursor-not-allowed"
              : "border-sprout-purple/30 bg-sprout-purple/5 hover:bg-sprout-purple/10 cursor-pointer"
          )}
        >
          {uploading ? (
            <><Loader2 className="w-5 h-5 text-sprout-purple animate-spin" /><span className="text-xs text-dark-secondary">Uploading…</span></>
          ) : (
            <>
              {isVideoMode ? <Video className="w-5 h-5 text-sprout-purple/60" /> : <ImagePlus className="w-5 h-5 text-sprout-purple/60" />}
              <span className="text-sm font-medium text-sprout-purple">
                {isVideoMode ? "Tap to add video" : "Tap to add photo"}
              </span>
              <span className="text-xs text-dark-secondary">
                {urls.length > 0 ? `${urls.length}/${MAX_MEDIA}` : isVideoMode ? "MP4, MOV, WebM" : "JPG, PNG, WebP"}
              </span>
            </>
          )}
        </button>
      )}
      {urls.length >= MAX_MEDIA && (
        <p className="text-xs text-dark-secondary">Maximum {MAX_MEDIA} files reached.</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) handleFiles(files);
        }}
      />
      {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}

      {/* Lightbox viewer */}
      {viewUrl && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setViewUrl(null)}>
          <button
            type="button"
            onClick={() => setViewUrl(null)}
            className="absolute top-4 right-4 w-9 h-9 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            {isVideoUrl(viewUrl) ? (
              <video src={viewUrl} controls autoPlay className="w-full rounded-xl bg-black max-h-[80vh]" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewUrl} alt="" className="w-full rounded-xl object-contain max-h-[80vh]" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Signature (draw) ───────────────────────────────────────────────────────────

function SignatureInput({
  value,
  onChange,
}: {
  value: string; // base64 PNG data URL or ""
  onChange: (v: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    lastPos.current = getPos(e, canvas);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e, canvas);
    if (lastPos.current) {
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = "#0D3B2E";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    lastPos.current = pos;
  };

  const endDraw = () => {
    if (!drawing.current) return;
    drawing.current = false;
    lastPos.current = null;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };

  // Restore saved signature on mount
  useEffect(() => {
    if (!value || !canvasRef.current) return;
    const img = new window.Image();
    img.onload = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx && canvasRef.current) ctx.drawImage(img, 0, 0);
    };
    img.src = value;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative border-2 border-dashed border-sprout-navy/20 rounded-xl overflow-hidden bg-gray-50">
        <canvas
          ref={canvasRef}
          width={600}
          height={180}
          className="w-full touch-none cursor-crosshair"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!value && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-1.5 text-gray-300">
              <Pen className="w-4 h-4" />
              <span className="text-sm">Sign here</span>
            </div>
          </div>
        )}
      </div>
      {value && (
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1.5 text-xs text-dark-secondary hover:text-red-500 transition-colors w-fit"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Clear signature
        </button>
      )}
    </div>
  );
}

// ── GPS location ───────────────────────────────────────────────────────────────

function GPSInput({
  value,
  onChange,
}: {
  value: string; // "lat,lng" or ""
  onChange: (v: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const capture = () => {
    if (!navigator.geolocation) {
      setError("GPS not supported on this device.");
      return;
    }
    setError("");
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        onChange(`${latitude.toFixed(6)},${longitude.toFixed(6)}`);
        setLoading(false);
        setError(`Accuracy: ±${Math.round(accuracy)}m`);
      },
      (err) => {
        setError(err.message || "Could not get location.");
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const [lat, lng] = value ? value.split(",") : ["", ""];

  return (
    <div className="flex flex-col gap-2">
      {value ? (
        <div className="flex items-center gap-3 bg-sprout-green/5 border border-sprout-green/20 rounded-xl px-4 py-3">
          <MapPin className="w-5 h-5 text-sprout-green shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-dark">Location captured</p>
            <p className="text-xs text-dark-secondary mt-0.5 font-mono">{lat}, {lng}</p>
            {error && <p className="text-xs text-dark-secondary mt-0.5">{error}</p>}
          </div>
          <button
            type="button"
            onClick={() => { onChange(""); setError(""); }}
            className="text-gray-400 hover:text-red-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={capture}
          disabled={loading}
          className={clsx(
            "flex items-center justify-center gap-2 border-2 border-dashed rounded-xl px-4 py-5 transition-colors",
            loading
              ? "border-surface-border bg-gray-50 cursor-not-allowed"
              : "border-sprout-green/30 bg-sprout-green/5 hover:bg-sprout-green/10 cursor-pointer"
          )}
        >
          {loading ? (
            <><Loader2 className="w-5 h-5 text-sprout-green animate-spin" /><span className="text-sm text-dark-secondary">Getting location…</span></>
          ) : (
            <><MapPin className="w-5 h-5 text-sprout-green/60" /><span className="text-sm font-medium text-sprout-green">Tap to capture GPS location</span></>
          )}
        </button>
      )}
      {!value && error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── Rating (1–5 stars) ─────────────────────────────────────────────────────────

function RatingInput({
  value,
  onChange,
}: {
  value: string; // "1"–"5" or ""
  onChange: (v: string) => void;
}) {
  const [hovered, setHovered] = useState(0);
  const selected = parseInt(value, 10) || 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => onChange(selected === n ? "" : String(n))}
            className="transition-transform active:scale-90"
            aria-label={`Rate ${n}`}
          >
            <Star
              className={clsx(
                "w-8 h-8 transition-colors",
                (hovered || selected) >= n
                  ? "text-amber-400 fill-amber-400"
                  : "text-gray-300 fill-gray-100"
              )}
            />
          </button>
        ))}
        {selected > 0 && (
          <span className="text-sm text-dark-secondary ml-1">{selected} / 5</span>
        )}
      </div>
    </div>
  );
}

// ── QR / Barcode scanner ───────────────────────────────────────────────────────

function QRInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  const stopScan = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  const startScan = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detector = new (window as any).BarcodeDetector({
        formats: ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"],
      });

      const scan = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          rafRef.current = requestAnimationFrame(scan);
          return;
        }
        try {
          const results = await detector.detect(videoRef.current);
          if (results.length > 0) {
            onChange(results[0].rawValue);
            stopScan();
            return;
          }
        } catch {
          // ignore frame errors
        }
        rafRef.current = requestAnimationFrame(scan);
      };
      rafRef.current = requestAnimationFrame(scan);
    } catch (e) {
      setError(friendlyError(e) || "Camera access denied.");
    }
  };

  useEffect(() => () => stopScan(), [stopScan]);

  const inputCls =
    "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full bg-white";

  if (!supported) {
    return (
      <div className="flex flex-col gap-2">
        <input
          type="text"
          className={inputCls}
          value={value}
          placeholder="Enter QR / barcode value manually"
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="text-xs text-dark-secondary">Camera scanning not supported on this browser.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {scanning ? (
        <div className="flex flex-col gap-2">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 border-2 border-white/60 rounded-lg" />
            </div>
          </div>
          <button
            type="button"
            onClick={stopScan}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-surface-border text-sm text-dark-secondary hover:bg-gray-50"
          >
            <X className="w-4 h-4" /> Cancel
          </button>
        </div>
      ) : value ? (
        <div className="flex items-center gap-3 bg-sprout-purple/5 border border-sprout-purple/20 rounded-xl px-4 py-3">
          <QrCode className="w-5 h-5 text-sprout-purple shrink-0" />
          <p className="flex-1 text-sm font-medium text-dark font-mono truncate">{value}</p>
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-gray-400 hover:text-red-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startScan}
          className="flex items-center justify-center gap-2 border-2 border-dashed border-sprout-purple/30 bg-sprout-purple/5 hover:bg-sprout-purple/10 rounded-xl px-4 py-5 transition-colors cursor-pointer"
        >
          <QrCode className="w-5 h-5 text-sprout-purple/60" />
          <span className="text-sm font-medium text-sprout-purple">Scan QR / Barcode</span>
        </button>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── Audit item (three-tier) ────────────────────────────────────────────────────

const AUDIT_TIERS = [
  {
    value: "compliant",
    label: "Compliant",
    short: "C",
    activeClass: "bg-sprout-green border-sprout-green text-white",
    inactiveClass: "border-gray-200 text-gray-500 hover:border-sprout-green/50 hover:bg-sprout-green/5",
  },
  {
    value: "needs_improvement",
    label: "Needs Improvement",
    short: "NI",
    activeClass: "bg-amber-400 border-amber-400 text-white",
    inactiveClass: "border-gray-200 text-gray-500 hover:border-amber-300 hover:bg-amber-50",
  },
  {
    value: "non_compliant",
    label: "Non-Compliant",
    short: "NC",
    activeClass: "bg-red-500 border-red-500 text-white",
    inactiveClass: "border-gray-200 text-gray-500 hover:border-red-300 hover:bg-red-50",
  },
] as const;

function AuditItemInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {AUDIT_TIERS.map((tier) => {
        const isActive = value === tier.value;
        return (
          <button
            key={tier.value}
            type="button"
            onClick={() => onChange(isActive ? "" : tier.value)}
            className={clsx(
              "flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-xl border-2 text-xs font-semibold transition-all",
              isActive ? tier.activeClass : tier.inactiveClass
            )}
          >
            <span className="text-sm font-bold">{tier.short}</span>
            <span className="text-center leading-tight">{tier.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Field input ────────────────────────────────────────────────────────────────

function FieldInput({
  field,
  value,
  onChange,
  answers,
  allFields,
}: {
  field: FormField;
  value: string;
  onChange: (v: string) => void;
  answers: Record<string, string>;
  allFields: FormField[];
}) {
  const inputCls =
    "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full bg-white";

  switch (field.field_type) {
    case "text":
      return (
        <input
          type="text"
          className={inputCls}
          value={value}
          placeholder={field.placeholder ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "number":
      return (
        <input
          type="number"
          className={inputCls}
          value={value}
          placeholder={field.placeholder ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "yes_no":
    case "boolean": {
      const opts = field.field_type === "boolean"
        ? [{ label: "Pass", val: "true" }, { label: "Fail", val: "false" }]
        : [{ label: "Yes", val: "true" }, { label: "No", val: "false" }];
      return (
        <div className="flex items-center gap-2">
          {opts.map(({ label: opt, val: optVal }) => {
            const active = value === optVal;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange(optVal)}
                className={clsx(
                  "px-5 py-2 rounded-lg text-sm font-medium border transition-colors",
                  active
                    ? optVal === "true"
                      ? "bg-sprout-green text-white border-sprout-green"
                      : "bg-red-500 text-white border-red-500"
                    : "bg-white text-dark-secondary border-surface-border hover:border-sprout-purple/30"
                )}
              >
                {opt}
              </button>
            );
          })}
        </div>
      );
    }

    case "checkbox":
      return (
        <div
          className="flex items-center gap-3 cursor-pointer select-none w-fit"
          onClick={() => onChange(value === "true" ? "false" : "true")}
        >
          <div
            className={clsx(
              "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
              value === "true"
                ? "bg-sprout-purple border-sprout-purple"
                : "border-surface-border bg-white"
            )}
          >
            {value === "true" && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                <path
                  d="M2 6l3 3 5-5"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
          <span className="text-sm text-dark-secondary">
            {value === "true" ? "Checked" : "Tap to check"}
          </span>
        </div>
      );

    case "dropdown": {
      const dropdownOptions = getFieldOptions(field, answers);
      const cl = field.conditional_logic as ConditionalLogic | null;
      const isShowOptions = cl && "type" in cl && cl.type === "show_options";
      const parentFieldLabel = isShowOptions
        ? (allFields.find((f) => f.id === (cl as ConditionalLogicShowOptions).fieldId)?.label ?? "parent field")
        : null;
      return (
        <select
          className={clsx(inputCls, "bg-white")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {isShowOptions && dropdownOptions.length === 0 ? (
            <option value="" disabled>Select {parentFieldLabel} first…</option>
          ) : (
            <option value="">— Select an option —</option>
          )}
          {dropdownOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    case "multi_select": {
      const selected = value ? value.split(",").filter(Boolean) : [];
      return (
        <div className="flex flex-col gap-2">
          {(field.options ?? []).map((opt) => {
            const checked = selected.includes(opt);
            return (
              <label key={opt} className="flex items-center gap-2.5 cursor-pointer select-none">
                <div
                  className={clsx(
                    "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors shrink-0",
                    checked
                      ? "bg-sprout-purple border-sprout-purple"
                      : "border-surface-border bg-white"
                  )}
                  onClick={() => {
                    const next = checked
                      ? selected.filter((s) => s !== opt)
                      : [...selected, opt];
                    onChange(next.join(","));
                  }}
                >
                  {checked && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-dark">{opt}</span>
              </label>
            );
          })}
        </div>
      );
    }

    case "date":
      return (
        <input
          type="date"
          className={inputCls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "time":
      return (
        <input
          type="time"
          className={inputCls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "datetime":
      return (
        <input
          type="datetime-local"
          className={inputCls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "photo":
      return <MediaInput value={value} onChange={onChange} accept="image/jpeg,image/jpg,image/png,image/webp,image/heic" isVideo={false} />;

    case "video":
      return <MediaInput value={value} onChange={onChange} accept="video/mp4,video/quicktime,video/webm,video/*" isVideo={true} />;

    case "signature":
      return <SignatureInput value={value} onChange={onChange} />;

    case "gps":
      return <GPSInput value={value} onChange={onChange} />;

    case "rating":
      return <RatingInput value={value} onChange={onChange} />;

    case "qr_code":
      return <QRInput value={value} onChange={onChange} />;

    case "audit_item":
      return <AuditItemInput value={value} onChange={onChange} />;

    case "textarea":
      return (
        <textarea
          className={clsx(inputCls, "min-h-[80px] resize-y")}
          value={value}
          placeholder={field.placeholder ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    default:
      return (
        <input
          type="text"
          className={inputCls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

// ── Main Page ──────────────────────────────────────────────────────────────────

function FormFillPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const assignmentId = params.id as string;
  const submissionId = searchParams.get("sid");
  const readOnly = !!submissionId;

  const [assignment, setAssignment] = useState<FormAssignment | null>(null);
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  // Load assignment + template + (submission or draft)
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (readOnly && submissionId) {
          // View-only: load submitted answers from the submission record
          const [tmpl, sub] = await Promise.all([
            getAssignmentTemplate(assignmentId),
            getSubmission(submissionId),
          ]);
          setTemplate(tmpl);
          setAssignment({ id: assignmentId, form_template_id: tmpl.id } as FormAssignment);
          setSubmittedAt(sub.submitted_at);
          const restoredAnswers: Record<string, string> = {};
          const restoredComments: Record<string, string> = {};
          for (const r of sub.responses) {
            restoredAnswers[r.field_id] = r.value;
            if (r.comment) restoredComments[r.field_id] = r.comment;
          }
          setAnswers(restoredAnswers);
          setComments(restoredComments);
        } else {
          const [tmpl, draft] = await Promise.all([
            getAssignmentTemplate(assignmentId),
            getAssignmentDraft(assignmentId),
          ]);
          setTemplate(tmpl);
          setAssignment({ id: assignmentId, form_template_id: tmpl.id } as FormAssignment);

          // Restore draft answers + comments if a draft exists
          if (draft && draft.form_responses?.length) {
            const restoredAnswers: Record<string, string> = {};
            const restoredComments: Record<string, string> = {};
            for (const r of draft.form_responses) {
              restoredAnswers[r.field_id] = r.value;
              if (r.comment) restoredComments[r.field_id] = r.comment;
            }
            setAnswers(restoredAnswers);
            setComments(restoredComments);
          }
        }
      } catch (e) {
        setLoadError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [assignmentId, submissionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a field becomes hidden, clear its answer
  useEffect(() => {
    if (!template) return;
    const allFields = (template.sections ?? []).flatMap((s) => s.fields ?? []);
    const hidden = allFields.filter((f) => !isVisible(f, answers));
    const toRemove = hidden.map((f) => f.id);
    if (toRemove.length === 0) return;
    setAnswers((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const id of toRemove) {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [answers, template]);

  const setAnswer = useCallback((fieldId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
    setValidationErrors((prev) => {
      if (prev[fieldId]) {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      }
      return prev;
    });
  }, []);

  const setComment = useCallback((fieldId: string, value: string) => {
    setComments((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const toggleComment = useCallback((fieldId: string) => {
    setOpenComments((prev) => ({ ...prev, [fieldId]: !prev[fieldId] }));
  }, []);

  // All fields (for conditional logic lookups)
  const allFields = (template?.sections ?? []).flatMap((s) => s.fields ?? []);

  // Progress calculation
  const allVisibleFields = (template?.sections ?? []).flatMap((s) =>
    (s.fields ?? []).filter((f) => isVisible(f, answers))
  );
  const answeredCount = allVisibleFields.filter((f) => {
    const v = answers[f.id];
    return v !== undefined && v !== "" && v !== null;
  }).length;
  const totalVisible = allVisibleFields.length;
  const progressPct = totalVisible > 0 ? Math.round((answeredCount / totalVisible) * 100) : 0;

  const handleSubmit = async (status: "draft" | "submitted") => {
    if (!assignment || !template) return;

    // Validate required fields if submitting
    if (status === "submitted") {
      const errors: Record<string, string> = {};
      for (const field of allVisibleFields) {
        if (field.is_required) {
          const v = answers[field.id];
          if (!v || v.trim() === "") {
            errors[field.id] = "This field is required.";
          }
        }
      }
      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        setSubmitError("Please fill in all required fields before submitting.");
        return;
      }
    }

    setSubmitError("");
    setSubmitting(true);
    try {
      const responses = allVisibleFields
        .filter((f) => {
          const v = answers[f.id];
          return v !== undefined && v !== "" && v !== null;
        })
        .map((f) => ({
          field_id: f.id,
          value: answers[f.id],
          ...(comments[f.id]?.trim() ? { comment: comments[f.id].trim() } : {}),
        }));

      await createSubmission({
        assignment_id: assignment.id,
        form_template_id: assignment.form_template_id,
        status,
        responses,
      });

      if (status === "submitted") {
        setSuccess(true);
      } else {
        // Draft saved — go back to the assignments list
        router.push("/dashboard/forms");
      }
    } catch (e) {
      setSubmitError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading / error states ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 text-sprout-purple animate-spin" />
      </div>
    );
  }

  if (loadError || !template || !assignment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6">
        <p className="text-dark-secondary text-sm">{loadError || "Could not load form."}</p>
        <button
          onClick={() => router.push("/dashboard/forms")}
          className="flex items-center gap-2 text-sm text-sprout-purple font-medium hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> Back to My Forms
        </button>
      </div>
    );
  }

  // ── Success screen ───────────────────────────────────────────────────────────

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-5 p-6">
        <div className="w-16 h-16 rounded-full bg-sprout-green/10 flex items-center justify-center">
          <CheckCircle2 className="w-9 h-9 text-sprout-green" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-dark">Submitted!</h2>
          <p className="text-sm text-dark-secondary mt-1">
            Your response has been recorded.
          </p>
        </div>
        <button
          onClick={() => router.push("/dashboard/forms")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sprout-green text-white text-sm font-semibold hover:bg-sprout-green/90"
        >
          <ArrowLeft className="w-4 h-4" /> Back to My Forms
        </button>
      </div>
    );
  }

  // ── Form fill UI ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-screen bg-surface-page">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-white border-b border-surface-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard/forms")}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0"
            title="Back to My Forms"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-semibold text-dark text-sm leading-tight truncate">
                {template.title}
              </h1>
              <TypeBadge type={template.type} />
              {readOnly && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-sprout-green/10 text-sprout-green">
                  <CheckCircle2 className="w-3 h-3" /> Submitted
                </span>
              )}
            </div>
            {readOnly ? (
              submittedAt && (
                <p className="text-xs text-dark-secondary mt-0.5">
                  {new Date(submittedAt).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                </p>
              )
            ) : (
              /* Progress bar */
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-sprout-purple transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="text-xs text-dark-secondary shrink-0">
                  {answeredCount}/{totalVisible}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto pb-32">
        <div className={clsx("max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6", readOnly && "pointer-events-none select-none")}>
          {template.description && (
            <p className="text-sm text-dark-secondary bg-white rounded-xl border border-surface-border px-4 py-3">
              {template.description}
            </p>
          )}

          {(template.sections ?? []).map((section: FormSection) => {
            const visibleFields = (section.fields ?? []).filter((f) =>
              isVisible(f, answers)
            );
            return (
              <div
                key={section.id}
                className="bg-white rounded-xl border border-surface-border overflow-hidden"
              >
                {/* Section header */}
                <div className="bg-surface-page px-4 py-3 flex items-center gap-2 border-b border-surface-border">
                  <ChevronRight className="w-4 h-4 text-dark-secondary" />
                  <p className="text-sm font-semibold text-dark">{section.title}</p>
                </div>

                {/* Fields */}
                <div className="flex flex-col divide-y divide-surface-border">
                  {(section.fields ?? []).map((field: FormField) => {
                    const visible = isVisible(field, answers);
                    return (
                      <div
                        key={field.id}
                        className={clsx(
                          "transition-all duration-200 overflow-hidden",
                          visible ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
                        )}
                      >
                        <div className="px-4 py-4 flex flex-col gap-2">
                          <div className="flex items-start gap-2">
                            <label className="text-sm font-medium text-dark flex-1">
                              {field.label}
                              {field.is_required && (
                                <span className="text-red-500 ml-0.5">*</span>
                              )}
                            </label>
                            {field.is_critical && (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-xs font-semibold shrink-0">
                                <ShieldAlert className="w-3 h-3" />
                                Critical
                              </span>
                            )}
                          </div>
                          {field.placeholder && field.field_type !== "text" && field.field_type !== "number" && (
                            <p className="text-xs text-dark-secondary -mt-1">{field.placeholder}</p>
                          )}
                          <FieldInput
                            field={field}
                            value={answers[field.id] ?? ""}
                            onChange={(v) => setAnswer(field.id, v)}
                            answers={answers}
                            allFields={allFields}
                          />
                          {validationErrors[field.id] && (
                            <p className="text-xs text-red-500">{validationErrors[field.id]}</p>
                          )}
                          {/* Per-field comment */}
                          <div className="mt-0.5">
                            {openComments[field.id] ? (
                              <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-dark-secondary font-medium">Note</span>
                                  <button
                                    type="button"
                                    onClick={() => toggleComment(field.id)}
                                    className="text-xs text-dark-secondary hover:text-dark"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <textarea
                                  rows={2}
                                  className="border border-surface-border rounded-lg px-3 py-2 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full bg-white resize-none"
                                  placeholder="Add a note about this field…"
                                  value={comments[field.id] ?? ""}
                                  onChange={(e) => setComment(field.id, e.target.value)}
                                />
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleComment(field.id)}
                                className="flex items-center gap-1 text-xs text-dark-secondary hover:text-sprout-purple transition-colors"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                {comments[field.id]?.trim()
                                  ? <span className="text-sprout-purple font-medium">Note added</span>
                                  : "Add note"}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {visibleFields.length === 0 && (
                    <p className="px-4 py-4 text-sm text-gray-400 italic">
                      No visible fields in this section.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-surface-border">
        <div className="max-w-2xl mx-auto px-4 pt-3 pb-16 md:pb-3 flex flex-col gap-2">
          {readOnly ? (
            <button
              onClick={() => router.push("/dashboard/forms")}
              className="w-full py-2.5 rounded-xl border border-surface-border text-sm font-medium text-dark-secondary hover:bg-gray-50 flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back to My Forms
            </button>
          ) : (
            <>
              {submitError && (
                <p className="text-xs text-red-500 text-center">{submitError}</p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => handleSubmit("draft")}
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl border border-surface-border text-sm font-medium text-dark-secondary hover:bg-gray-50 disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Save Draft"}
                </button>
                <button
                  onClick={() => handleSubmit("submitted")}
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl bg-sprout-purple text-white text-sm font-semibold hover:bg-sprout-purple/90 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <ClipboardList className="w-4 h-4" /> Submit
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
}

export default function FormFillPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 text-sprout-purple animate-spin" /></div>}>
      <FormFillPageInner />
    </Suspense>
  );
}
