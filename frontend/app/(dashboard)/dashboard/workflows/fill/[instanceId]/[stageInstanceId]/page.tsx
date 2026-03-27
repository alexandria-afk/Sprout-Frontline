"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import clsx from "clsx";
import {
  ArrowLeft, CheckCircle2, Loader2, ClipboardList,
  X, ImagePlus, MessageSquare, Video, MapPin, Star, QrCode, Pen,
  RotateCcw, GitBranch, Clock, UserCheck,
} from "lucide-react";
import { getStageInstance, submitFormForStage, approveStage, rejectStage } from "@/services/workflows";
import { getTemplate, getSubmission, type FormSubmissionDetail } from "@/services/forms";
import { createClient } from "@/services/supabase/client";
import type { FormTemplate, FormField } from "@/types";
import { friendlyError } from "@/lib/errors";

// ── Helpers ───────────────────────────────────────────────────────────────────

type ConditionalLogic = { fieldId: string; value: string; action: "show" | "hide" };

function isVisible(field: FormField, answers: Record<string, string>): boolean {
  const cl = field.conditional_logic as ConditionalLogic | null;
  if (!cl) return true;
  const match = answers[cl.fieldId] === cl.value;
  return cl.action === "show" ? match : !match;
}

// ── Photo upload ──────────────────────────────────────────────────────────────

function PhotoInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const handleFile = async (file: File) => {
    setUploadError("");
    setUploading(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("form-photos").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadErr) throw uploadErr;
      const { data: signed, error: signErr } = await supabase.storage.from("form-photos").createSignedUrl(path, 315360000);
      if (signErr) throw signErr;
      onChange(signed.signedUrl);
    } catch (e) {
      setUploadError(friendlyError(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      {value ? (
        <div className="relative w-full max-w-xs">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Captured" className="w-full rounded-xl border border-surface-border object-cover max-h-48" />
          <button type="button" onClick={() => onChange("")} className="absolute top-2 right-2 bg-white/90 rounded-full p-1 shadow">
            <X className="w-3.5 h-3.5 text-red-500" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="flex items-center justify-center gap-2 border-2 border-dashed border-sprout-purple/30 bg-sprout-purple/5 hover:bg-sprout-purple/10 rounded-xl px-4 py-5 transition-colors cursor-pointer disabled:opacity-50">
          {uploading ? <Loader2 className="w-5 h-5 text-sprout-purple animate-spin" /> : <ImagePlus className="w-5 h-5 text-sprout-purple/60" />}
          <span className="text-sm font-medium text-sprout-purple">{uploading ? "Uploading…" : "Tap to add photo"}</span>
        </button>
      )}
      {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
    </div>
  );
}

// ── Video upload ──────────────────────────────────────────────────────────────

function VideoInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const handleFile = async (file: File) => {
    setUploadError("");
    setUploading(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const ext = file.name.split(".").pop() ?? "mp4";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("form-videos").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadErr) throw uploadErr;
      const { data: signed, error: signErr } = await supabase.storage.from("form-videos").createSignedUrl(path, 315360000);
      if (signErr) throw signErr;
      onChange(signed.signedUrl);
    } catch (e) {
      setUploadError(friendlyError(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      {value ? (
        <div className="relative w-full max-w-xs">
          <video src={value} controls className="w-full rounded-xl border border-surface-border max-h-48" />
          <button type="button" onClick={() => onChange("")} className="absolute top-2 right-2 bg-white/90 rounded-full p-1 shadow">
            <X className="w-3.5 h-3.5 text-red-500" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="flex items-center justify-center gap-2 border-2 border-dashed border-blue-300 bg-blue-50 hover:bg-blue-100 rounded-xl px-4 py-5 transition-colors cursor-pointer disabled:opacity-50">
          {uploading ? <Loader2 className="w-5 h-5 text-blue-600 animate-spin" /> : <Video className="w-5 h-5 text-blue-400" />}
          <span className="text-sm font-medium text-blue-600">{uploading ? "Uploading…" : "Tap to add video"}</span>
        </button>
      )}
      {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
    </div>
  );
}

// ── Signature ─────────────────────────────────────────────────────────────────

function SignatureInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    lastPos.current = getPos(e);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d")!;
    const pos = getPos(e);
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
        <canvas ref={canvasRef} width={600} height={180} className="w-full touch-none cursor-crosshair"
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
          onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
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
        <button type="button" onClick={clear} className="flex items-center gap-1.5 text-xs text-dark-secondary hover:text-red-500 transition-colors w-fit">
          <RotateCcw className="w-3.5 h-3.5" /> Clear signature
        </button>
      )}
    </div>
  );
}

// ── GPS ───────────────────────────────────────────────────────────────────────

function GPSInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const capture = () => {
    if (!navigator.geolocation) { setError("GPS not supported on this device."); return; }
    setError("");
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { onChange(`${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`); setLoading(false); },
      () => { setError("Could not get location."); setLoading(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {value ? (
        <div className="flex items-center gap-3 bg-sprout-green/5 border border-sprout-green/20 rounded-xl px-4 py-3">
          <MapPin className="w-5 h-5 text-sprout-green shrink-0" />
          <p className="flex-1 text-sm font-medium text-dark font-mono">{value}</p>
          <button type="button" onClick={() => onChange("")} className="text-gray-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <button type="button" onClick={capture} disabled={loading}
          className={clsx("flex items-center justify-center gap-2 rounded-xl px-4 py-5 transition-colors border-2 border-dashed",
            loading ? "border-sprout-green/20 bg-sprout-green/5 cursor-wait" : "border-sprout-green/30 bg-sprout-green/5 hover:bg-sprout-green/10 cursor-pointer")}>
          {loading ? <><Loader2 className="w-5 h-5 text-sprout-green animate-spin" /><span className="text-sm text-dark-secondary">Getting location…</span></> : <><MapPin className="w-5 h-5 text-sprout-green/60" /><span className="text-sm font-medium text-sprout-green">Tap to capture GPS location</span></>}
        </button>
      )}
      {!value && error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── Rating ────────────────────────────────────────────────────────────────────

function RatingInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [hovered, setHovered] = useState(0);
  const selected = parseInt(value, 10) || 0;
  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onMouseEnter={() => setHovered(n)} onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(selected === n ? "" : String(n))} className="transition-transform active:scale-90" aria-label={`Rate ${n}`}>
          <Star className={clsx("w-8 h-8 transition-colors", (hovered || selected) >= n ? "text-amber-400 fill-amber-400" : "text-gray-300 fill-gray-100")} />
        </button>
      ))}
      {selected > 0 && <span className="text-sm text-dark-secondary ml-1">{selected} / 5</span>}
    </div>
  );
}

// ── QR scanner ────────────────────────────────────────────────────────────────

function QRInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  const stopScan = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setScanning(false);
  }, []);

  const startScan = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setScanning(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detector = new (window as any).BarcodeDetector({ formats: ["qr_code", "ean_13", "ean_8", "code_128", "code_39"] });
      const scan = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) { rafRef.current = requestAnimationFrame(scan); return; }
        try {
          const results = await detector.detect(videoRef.current);
          if (results.length > 0) { onChange(results[0].rawValue); stopScan(); return; }
        } catch { /* ignore */ }
        rafRef.current = requestAnimationFrame(scan);
      };
      rafRef.current = requestAnimationFrame(scan);
    } catch (e) { setError(friendlyError(e)); }
  };

  useEffect(() => () => stopScan(), [stopScan]);

  return (
    <div className="flex flex-col gap-2">
      {scanning ? (
        <div className="relative rounded-xl overflow-hidden bg-black aspect-video max-w-xs">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline />
          <button type="button" onClick={stopScan} className="absolute top-2 right-2 bg-white/80 rounded-full p-1"><X className="w-4 h-4 text-dark" /></button>
        </div>
      ) : value ? (
        <div className="flex items-center gap-3 bg-sprout-purple/5 border border-sprout-purple/20 rounded-xl px-4 py-3">
          <QrCode className="w-5 h-5 text-sprout-purple shrink-0" />
          <p className="flex-1 text-sm font-medium text-dark font-mono truncate">{value}</p>
          <button type="button" onClick={() => onChange("")} className="text-gray-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <button type="button" onClick={startScan} disabled={!supported}
          className="flex items-center justify-center gap-2 border-2 border-dashed border-sprout-purple/30 bg-sprout-purple/5 hover:bg-sprout-purple/10 rounded-xl px-4 py-5 transition-colors cursor-pointer disabled:opacity-40">
          <QrCode className="w-5 h-5 text-sprout-purple/60" />
          <span className="text-sm font-medium text-sprout-purple">{supported ? "Scan QR / Barcode" : "QR scanning not supported"}</span>
        </button>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── Audit item ────────────────────────────────────────────────────────────────

const AUDIT_TIERS = [
  { value: "compliant",         label: "Compliant",         short: "C",  activeClass: "bg-sprout-green border-sprout-green text-white",  inactiveClass: "border-gray-200 text-gray-500 hover:border-sprout-green/50 hover:bg-sprout-green/5" },
  { value: "needs_improvement", label: "Needs Improvement", short: "NI", activeClass: "bg-amber-400 border-amber-400 text-white",         inactiveClass: "border-gray-200 text-gray-500 hover:border-amber-300 hover:bg-amber-50" },
  { value: "non_compliant",     label: "Non-Compliant",     short: "NC", activeClass: "bg-red-500 border-red-500 text-white",             inactiveClass: "border-gray-200 text-gray-500 hover:border-red-300 hover:bg-red-50" },
] as const;

function AuditItemInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {AUDIT_TIERS.map((tier) => {
        const isActive = value === tier.value;
        return (
          <button key={tier.value} type="button" onClick={() => onChange(isActive ? "" : tier.value)}
            className={clsx("flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-xl border-2 text-xs font-semibold transition-all", isActive ? tier.activeClass : tier.inactiveClass)}>
            <span className="text-sm font-bold">{tier.short}</span>
            <span className="text-center leading-tight">{tier.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Field input ───────────────────────────────────────────────────────────────

function FieldInput({ field, value, onChange }: { field: FormField; value: string; onChange: (v: string) => void }) {
  const inputCls = "border border-surface-border rounded-lg px-3 py-2 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/40 w-full bg-white";

  switch (field.field_type) {
    case "text":
      return <input type="text" className={inputCls} value={value} placeholder={field.placeholder ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <input type="number" className={inputCls} value={value} placeholder={field.placeholder ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "yes_no":
    case "boolean": {
      const opts = field.field_type === "boolean" ? [{ label: "Pass", val: "true" }, { label: "Fail", val: "false" }] : [{ label: "Yes", val: "true" }, { label: "No", val: "false" }];
      return (
        <div className="flex items-center gap-2">
          {opts.map(({ label: opt, val: optVal }) => (
            <button key={opt} type="button" onClick={() => onChange(optVal)}
              className={clsx("px-5 py-2 rounded-lg text-sm font-medium border transition-colors", value === optVal
                ? optVal === "true" ? "bg-sprout-green text-white border-sprout-green" : "bg-red-500 text-white border-red-500"
                : "bg-white text-dark-secondary border-surface-border hover:border-sprout-purple/30")}>
              {opt}
            </button>
          ))}
        </div>
      );
    }
    case "checkbox":
      return (
        <div className="flex items-center gap-3 cursor-pointer select-none w-fit" onClick={() => onChange(value === "true" ? "false" : "true")}>
          <div className={clsx("w-5 h-5 rounded border-2 flex items-center justify-center transition-colors", value === "true" ? "bg-sprout-green border-sprout-green" : "border-gray-300")}>
            {value === "true" && <svg viewBox="0 0 12 12" className="w-3 h-3 fill-white"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>}
          </div>
          <span className="text-sm text-dark">Check</span>
        </div>
      );
    case "dropdown": {
      const opts = (field.options ?? []) as string[];
      return (
        <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Select —</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    case "multi_select": {
      const opts = (field.options ?? []) as string[];
      const selected = value ? value.split(",") : [];
      return (
        <div className="flex flex-wrap gap-2">
          {opts.map((o) => {
            const active = selected.includes(o);
            return (
              <button key={o} type="button" onClick={() => {
                const next = active ? selected.filter((s) => s !== o) : [...selected, o];
                onChange(next.join(","));
              }} className={clsx("px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors", active ? "bg-sprout-purple text-white border-sprout-purple" : "bg-white text-dark-secondary border-surface-border hover:border-sprout-purple/40")}>
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case "date":
      return <input type="date" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />;
    case "time":
      return <input type="time" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />;
    case "datetime":
      return <input type="datetime-local" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />;
    case "photo":
      return <PhotoInput value={value} onChange={onChange} />;
    case "video":
      return <VideoInput value={value} onChange={onChange} />;
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
      return <textarea className={clsx(inputCls, "min-h-[80px] resize-y")} value={value} placeholder={field.placeholder ?? ""} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input type="text" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WorkflowFillFormPage() {
  const params = useParams();
  const router = useRouter();
  const instanceId = params.instanceId as string;
  const stageInstanceId = params.stageInstanceId as string;

  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [stageName, setStageName] = useState("");
  const [workflowName, setWorkflowName] = useState("");
  const [actionType, setActionType] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  // For approve/review/sign stages
  const [stageHistory, setStageHistory] = useState<{ id: string; stage_name: string | null; action_type: string | null; stage_order: number | null; status: string; completed_at: string | null; comment: string | null; completed_by: string | null; form_submission_id: string | null; }[]>([]);
  const [reviewSub, setReviewSub] = useState<FormSubmissionDetail | null>(null);
  const [approveComment, setApproveComment] = useState("");
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [approveSuccess, setApproveSuccess] = useState<"approved" | "rejected" | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const si = await getStageInstance(instanceId, stageInstanceId);
        setStageName(si.workflow_stages?.name ?? "Stage");
        setWorkflowName(si.workflow_instances?.workflow_definitions?.name ?? "");
        const aType = si.workflow_stages?.action_type ?? "";
        setActionType(aType);
        setStageHistory(si.stage_history ?? []);

        if (aType === "approve" || aType === "review" || aType === "sign") {
          const submissionId = si.review_submission_id;
          if (submissionId) {
            const sub = await getSubmission(submissionId);
            setReviewSub(sub);
            const tmpl = await getTemplate(sub.form_template_id);
            setTemplate(tmpl);
          }
          // sign/approve with no linked submission: still show the decision UI
        } else if (aType === "notify" || aType === "wait" || aType === "create_task" || aType === "create_issue" || aType === "create_incident") {
          // System stages — auto-complete on activation; no user action needed
          // (handled by the system stage UI block below)
        } else {
          const formTemplateId = si.workflow_stages?.form_template_id;
          if (!formTemplateId) throw new Error("No form template linked to this stage.");
          const tmpl = await getTemplate(formTemplateId);
          setTemplate(tmpl);
        }
      } catch (e) {
        setLoadError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [instanceId, stageInstanceId]);

  // Clear hidden fields
  useEffect(() => {
    if (!template) return;
    const allFields = (template.sections ?? []).flatMap((s) => s.fields ?? []);
    const hidden = allFields.filter((f) => !isVisible(f, answers));
    const toRemove = hidden.map((f) => f.id);
    if (toRemove.length === 0) return;
    setAnswers((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const id of toRemove) { if (id in next) { delete next[id]; changed = true; } }
      return changed ? next : prev;
    });
  }, [answers, template]);

  const setAnswer = useCallback((fieldId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
    setValidationErrors((prev) => { if (prev[fieldId]) { const next = { ...prev }; delete next[fieldId]; return next; } return prev; });
  }, []);

  const setComment = useCallback((fieldId: string, value: string) => {
    setComments((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const toggleComment = useCallback((fieldId: string) => {
    setOpenComments((prev) => ({ ...prev, [fieldId]: !prev[fieldId] }));
  }, []);

  const allVisibleFields = (template?.sections ?? []).flatMap((s) => (s.fields ?? []).filter((f) => isVisible(f, answers)));
  const answeredCount = allVisibleFields.filter((f) => { const v = answers[f.id]; return v !== undefined && v !== "" && v !== null; }).length;
  const totalVisible = allVisibleFields.length;
  const progressPct = totalVisible > 0 ? Math.round((answeredCount / totalVisible) * 100) : 0;

  const handleApprove = async () => {
    setApproveError("");
    setApproving(true);
    try {
      await approveStage(instanceId, stageInstanceId, approveComment);
      setApproveSuccess("approved");
    } catch (e) {
      setApproveError(friendlyError(e));
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!approveComment.trim()) {
      setApproveError("Please provide a reason for rejection.");
      return;
    }
    setApproveError("");
    setRejecting(true);
    try {
      await rejectStage(instanceId, stageInstanceId, approveComment);
      setApproveSuccess("rejected");
    } catch (e) {
      setApproveError(friendlyError(e));
    } finally {
      setRejecting(false);
    }
  };

  const handleSubmit = async () => {
    if (!template) return;

    const errors: Record<string, string> = {};
    for (const field of allVisibleFields) {
      if (field.is_required) {
        const v = answers[field.id];
        if (!v || v.trim() === "") errors[field.id] = "This field is required.";
      }
    }
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      setSubmitError("Please fill in all required fields before submitting.");
      return;
    }

    setSubmitError("");
    setSubmitting(true);
    try {
      const responses = allVisibleFields
        .filter((f) => { const v = answers[f.id]; return v !== undefined && v !== "" && v !== null; })
        .map((f) => ({
          field_id: f.id,
          value: answers[f.id],
          ...(comments[f.id]?.trim() ? { comment: comments[f.id].trim() } : {}),
        }));

      await submitFormForStage(instanceId, stageInstanceId, responses);
      setSuccess(true);
    } catch (e) {
      setSubmitError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 text-sprout-purple animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6">
        <p className="text-dark-secondary text-sm">{loadError}</p>
        <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-sprout-purple font-medium hover:underline">
          <ArrowLeft className="w-4 h-4" /> Go back
        </button>
      </div>
    );
  }

  if (!template && actionType === "fill_form") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6">
        <p className="text-dark-secondary text-sm">Could not load form.</p>
        <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-sprout-purple font-medium hover:underline">
          <ArrowLeft className="w-4 h-4" /> Go back
        </button>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-5 p-6">
        <div className="w-16 h-16 rounded-full bg-sprout-green/10 flex items-center justify-center">
          <CheckCircle2 className="w-9 h-9 text-sprout-green" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-dark">Submitted!</h2>
          <p className="text-sm text-dark-secondary mt-1">Your response has been recorded and the workflow has advanced.</p>
        </div>
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sprout-green text-white text-sm font-semibold hover:bg-sprout-green/90">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>
      </div>
    );
  }

  // System stage: auto-completes on activation; user should not normally land here
  if (actionType === "notify" || actionType === "wait" || actionType === "create_task" || actionType === "create_issue" || actionType === "create_incident") {
    const labelMap: Record<string, string> = {
      notify: "Notification", wait: "Wait", create_task: "Create Task",
      create_issue: "Create Issue", create_incident: "Create Incident",
    };
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-5 p-6">
        <div className="w-16 h-16 rounded-full bg-sprout-purple/10 flex items-center justify-center">
          <CheckCircle2 className="w-9 h-9 text-sprout-purple" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-dark">{labelMap[actionType] ?? actionType}</h2>
          <p className="text-sm text-dark-secondary mt-1">This stage is handled automatically by the system.</p>
        </div>
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sprout-purple text-white text-sm font-semibold hover:bg-sprout-purple/90">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>
      </div>
    );
  }

  // Approve/review/sign stage: show submission read-only + action buttons
  if (actionType === "approve" || actionType === "review" || actionType === "sign") {
    const allFields = template ? (template.sections ?? []).flatMap((s) => s.fields ?? []) : [];
    const responseMap = reviewSub ? Object.fromEntries(reviewSub.responses.map((r) => [r.field_id, r.value])) : {};
    const submitterName = reviewSub?.profiles?.full_name ?? null;
    const isSign = actionType === "sign";
    const isReview = actionType === "review";

    if (approveSuccess) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-5 p-6">
          <div className={clsx("w-16 h-16 rounded-full flex items-center justify-center", approveSuccess === "approved" ? "bg-sprout-green/10" : "bg-red-50")}>
            <CheckCircle2 className={clsx("w-9 h-9", approveSuccess === "approved" ? "text-sprout-green" : "text-red-500")} />
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold text-dark capitalize">{approveSuccess}!</h2>
            <p className="text-sm text-dark-secondary mt-1">The workflow has {approveSuccess === "approved" ? "advanced to the next step" : "been rejected"}.</p>
          </div>
          <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sprout-green text-white text-sm font-semibold hover:bg-sprout-green/90">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col min-h-screen bg-surface-page">
        <div className="sticky top-0 z-20 bg-white border-b border-surface-border">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
            <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors shrink-0">
              <ArrowLeft className="w-5 h-5 text-dark" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-dark-secondary mb-0.5">
                <GitBranch className="w-3 h-3 text-sprout-purple" />
                <span className="truncate">{workflowName || "Workflow"}</span>
              </div>
              <h1 className="text-sm font-bold text-dark truncate">{stageName}</h1>
            </div>
          </div>
        </div>

        <div className="max-w-2xl mx-auto w-full px-4 py-6 flex flex-col gap-4">

          {/* Workflow stage timeline */}
          {stageHistory.length > 0 && (
            <div className="bg-white rounded-2xl border border-surface-border p-4">
              <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wide mb-3">Workflow Progress</p>
              <div className="flex flex-col gap-0">
                {stageHistory.map((item, idx) => {
                  const isCompleted = item.status === "approved" || item.status === "completed" || item.status === "auto_completed";
                  const isCurrent = item.id === stageInstanceId;
                  const isLast = idx === stageHistory.length - 1;
                  const actionLabel = item.action_type === "fill_form" ? "Submitted" : item.action_type === "approve" ? "Approved" : item.action_type === "sign" ? "Signed" : item.action_type === "review" ? "Reviewed" : "Completed";
                  return (
                    <div key={item.id} className="flex gap-3">
                      {/* Timeline spine */}
                      <div className="flex flex-col items-center shrink-0">
                        <div className={clsx("w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0", isCompleted ? "bg-sprout-green border-sprout-green" : isCurrent ? "bg-sprout-purple border-sprout-purple" : "bg-white border-gray-300")}>
                          {isCompleted ? (
                            <svg viewBox="0 0 12 12" className="w-3 h-3 fill-white"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                          ) : isCurrent ? (
                            <div className="w-2 h-2 rounded-full bg-white" />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-gray-300" />
                          )}
                        </div>
                        {!isLast && <div className={clsx("w-0.5 flex-1 my-1", isCompleted ? "bg-sprout-green/30" : "bg-gray-200")} style={{ minHeight: 16 }} />}
                      </div>
                      {/* Content */}
                      <div className={clsx("pb-4 flex-1 min-w-0", isLast && "pb-0")}>
                        <p className={clsx("text-sm font-semibold", isCurrent ? "text-sprout-purple" : "text-dark")}>{item.stage_name ?? `Stage ${(item.stage_order ?? 0) + 1}`}</p>
                        {isCompleted && (
                          <div className="flex flex-col gap-0.5 mt-0.5">
                            {item.completed_by && (
                              <div className="flex items-center gap-1 text-xs text-dark-secondary">
                                <UserCheck className="w-3 h-3 text-sprout-green shrink-0" />
                                <span>{actionLabel} by <span className="font-medium text-dark">{item.completed_by}</span></span>
                              </div>
                            )}
                            {item.completed_at && (
                              <div className="flex items-center gap-1 text-xs text-dark-secondary">
                                <Clock className="w-3 h-3 shrink-0" />
                                <span>{new Date(item.completed_at).toLocaleString()}</span>
                              </div>
                            )}
                            {item.comment && (
                              <p className="text-xs text-dark-secondary italic mt-0.5">"{item.comment}"</p>
                            )}
                          </div>
                        )}
                        {!isCompleted && !isCurrent && (
                          <p className="text-xs text-dark-secondary mt-0.5">Pending</p>
                        )}
                        {isCurrent && (
                          <p className="text-xs text-sprout-purple mt-0.5">Your turn</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Form submission content */}
          {submitterName && (
            <div className="bg-white rounded-2xl border border-surface-border p-4">
              <p className="text-xs text-dark-secondary mb-1">Submitted by</p>
              <p className="text-sm font-semibold text-dark">{submitterName}</p>
              <p className="text-xs text-dark-secondary mt-0.5">{reviewSub?.form_templates?.title ?? "Form"}</p>
            </div>
          )}

          {allFields.map((field) => {
            const val = responseMap[field.id];
            if (val === undefined || val === "") return null;
            return (
              <div key={field.id} className="bg-white rounded-2xl border border-surface-border p-4">
                <p className="text-xs font-medium text-dark-secondary mb-1">{field.label}</p>
                <p className="text-sm text-dark whitespace-pre-wrap">{val}</p>
              </div>
            );
          })}

          <div className="bg-white rounded-2xl border border-surface-border p-4 flex flex-col gap-3">
            <p className="text-sm font-semibold text-dark">{isSign ? "Sign off" : isReview ? "Review" : "Decision"}</p>
            <textarea
              placeholder={isSign || isReview ? "Comment (optional)" : "Comment (required for rejection, optional for approval)"}
              value={approveComment}
              onChange={(e) => setApproveComment(e.target.value)}
              rows={3}
              className="w-full border border-[#E8EDF2] rounded-xl px-3 py-2 text-sm text-dark resize-none focus:outline-none focus:ring-2 focus:ring-sprout-purple/30"
            />
            {approveError && <p className="text-xs text-red-500">{approveError}</p>}
            <div className="flex gap-3">
              {!isSign && !isReview && (
                <button
                  onClick={handleReject}
                  disabled={approving || rejecting}
                  className="flex-1 py-2.5 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  {rejecting ? "Rejecting…" : "Reject"}
                </button>
              )}
              <button
                onClick={handleApprove}
                disabled={approving || rejecting}
                className="flex-1 py-2.5 rounded-xl bg-sprout-green text-white text-sm font-semibold hover:bg-sprout-green/90 disabled:opacity-50 transition-colors"
              >
                {approving ? (isSign ? "Signing…" : isReview ? "Confirming…" : "Approving…") : (isSign ? "Sign" : isReview ? "Mark Reviewed" : "Approve")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-surface-page">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-white border-b border-surface-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors shrink-0">
            <ArrowLeft className="w-5 h-5 text-dark" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-dark-secondary mb-0.5">
              <GitBranch className="w-3 h-3 text-sprout-purple" />
              <span className="truncate">{workflowName || "Workflow"}</span>
            </div>
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-blue-600 shrink-0" />
              <h1 className="text-sm font-bold text-dark truncate">{stageName}</h1>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-semibold text-sprout-purple">{progressPct}%</p>
            <p className="text-[10px] text-dark-secondary">{answeredCount}/{totalVisible}</p>
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div className="h-full bg-sprout-purple transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {/* Form body */}
      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 space-y-6">
        {/* Template title */}
        <div>
          <h2 className="text-lg font-bold text-dark">{template!.title}</h2>
          {template!.description && <p className="text-sm text-dark-secondary mt-1">{template!.description}</p>}
        </div>

        {/* Sections */}
        {(template!.sections ?? []).map((section) => {
          const visibleFields = (section.fields ?? []).filter((f) => isVisible(f, answers));
          if (visibleFields.length === 0) return null;
          return (
            <div key={section.id} className="bg-white rounded-2xl border border-surface-border overflow-hidden">
              {section.title && (
                <div className="px-4 py-3 border-b border-surface-border bg-gray-50/50">
                  <h3 className="text-sm font-semibold text-dark">{section.title}</h3>
                </div>
              )}
              <div className="divide-y divide-surface-border">
                {visibleFields.map((field) => {
                  const hasError = !!validationErrors[field.id];
                  return (
                    <div key={field.id} className="px-4 py-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <label className="text-sm font-medium text-dark leading-snug">
                          {field.label}
                          {field.is_required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        <button type="button" onClick={() => toggleComment(field.id)} className="shrink-0 p-1 rounded hover:bg-gray-100 transition-colors" title="Add comment">
                          <MessageSquare className={clsx("w-3.5 h-3.5", openComments[field.id] || comments[field.id] ? "text-sprout-purple" : "text-gray-300")} />
                        </button>
                      </div>
                      <FieldInput field={field} value={answers[field.id] ?? ""} onChange={(v) => setAnswer(field.id, v)} />
                      {hasError && <p className="text-xs text-red-500">{validationErrors[field.id]}</p>}
                      {(openComments[field.id] || comments[field.id]) && (
                        <textarea
                          value={comments[field.id] ?? ""}
                          onChange={(e) => setComment(field.id, e.target.value)}
                          placeholder="Add a comment…"
                          rows={2}
                          className="w-full border border-surface-border rounded-lg px-3 py-2 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/30 resize-none mt-1"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Submit error */}
        {submitError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{submitError}</div>
        )}

        {/* Submit button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3.5 bg-sprout-purple text-white text-sm font-semibold rounded-xl hover:bg-sprout-purple/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : "Submit Form"}
        </button>

        <div className="pb-8" />
      </div>
    </div>
  );
}
