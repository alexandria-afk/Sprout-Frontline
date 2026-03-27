"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Upload, FileText, ArrowLeft, Loader2, CheckCircle2, X } from "lucide-react";
import { generateCourse, getGenerationJob, createCourse, uploadTrainingFile } from "@/services/lms";
import clsx from "clsx";

type Mode = "hub" | "sidekick" | "upload" | "blank";
type SidekickInput = "topic" | "url";

export default function NewCoursePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("hub");

  useEffect(() => {
    const m = searchParams.get("mode");
    if (m === "sidekick" || m === "upload" || m === "blank") setMode(m);
  }, [searchParams]);
  const [sidekickInput, setSidekickInput] = useState<SidekickInput>("topic");
  const [inputValue, setInputValue] = useState("");
  const [targetRole, setTargetRole] = useState("staff");
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<string[]>([]);
  const [error, setError] = useState("");

  // Upload mode state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTargetRole, setUploadTargetRole] = useState("staff");

  // Blank form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleGenerate() {
    if (!inputValue.trim()) return;
    setGenerating(true);
    setError("");
    setGenStatus(["Analysing your input…"]);
    try {
      const job = await generateCourse({
        input_type: sidekickInput,
        input_data: inputValue.trim(),
        target_role: targetRole,
      });
      setGenStatus(prev => [...prev, "Course job queued — processing…"]);
      // Poll for completion
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const status = await getGenerationJob(job.id);
          if (status.status === "completed" && status.result_course_id) {
            clearInterval(poll);
            setGenStatus(prev => [...prev, "Course ready! Redirecting…"]);
            try { sessionStorage.setItem("justCreatedCourseId", status.result_course_id); } catch { /* ignore */ }
            setTimeout(() => router.push(`/dashboard/training/courses/${status.result_course_id}`), 1000);
          } else if (status.status === "failed") {
            clearInterval(poll);
            setError(status.error_message ?? "Generation failed. Try again.");
            setGenerating(false);
          } else if (attempts > 30) {
            clearInterval(poll);
            setError("Generation timed out. Try again.");
            setGenerating(false);
          }
        } catch { /* continue polling */ }
      }, 2000);
    } catch (e) {
      setError((e as Error).message || "Failed to start generation.");
      setGenerating(false);
    }
  }

  async function handleUploadGenerate() {
    if (!uploadFile) return;
    setGenerating(true);
    setError("");
    setGenStatus(["Uploading file…"]);
    try {
      const { url } = await uploadTrainingFile(uploadFile);
      setGenStatus(prev => [...prev, "Analysing document with Sidekick…"]);
      const isVideo = uploadFile.type.startsWith("video/");
      const job = await generateCourse({
        input_type: isVideo ? "video" : "document",
        input_file_url: url,
        input_data: uploadFile.name.replace(/\.[^.]+$/, ""),
        target_role: uploadTargetRole,
      });
      setGenStatus(prev => [...prev, "Building course structure…"]);
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const status = await getGenerationJob(job.id);
          if (status.status === "completed" && status.result_course_id) {
            clearInterval(poll);
            setGenStatus(prev => [...prev, "Course ready! Redirecting…"]);
            try { sessionStorage.setItem("justCreatedCourseId", status.result_course_id); } catch { /* ignore */ }
            setTimeout(() => router.push(`/dashboard/training/courses/${status.result_course_id}`), 1000);
          } else if (status.status === "failed") {
            clearInterval(poll);
            setError(status.error_message ?? "Generation failed. Try again.");
            setGenerating(false);
          } else if (attempts > 40) {
            clearInterval(poll);
            setError("Generation timed out. Try again.");
            setGenerating(false);
          }
        } catch { /* continue polling */ }
      }, 2000);
    } catch (e) {
      setError((e as Error).message || "Failed to generate course.");
      setGenerating(false);
    }
  }

  async function handleCreateBlank() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const course = await createCourse({ title: title.trim(), description: description.trim() || undefined });
      try { sessionStorage.setItem("justCreatedCourseId", course.id); } catch { /* ignore */ }
      router.push(`/dashboard/training/courses/${course.id}?new=1`);
    } catch (e) {
      setError((e as Error).message || "Failed to create course.");
      setSaving(false);
    }
  }

  if (mode === "hub") {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-dark-secondary hover:text-dark mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-2xl font-bold text-dark mb-2">Create New Course</h1>
        <p className="text-sm text-dark-secondary mb-8">How would you like to build your course?</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Generate with Sidekick */}
          <button
            onClick={() => setMode("sidekick")}
            className="flex flex-col gap-3 p-5 rounded-2xl border-2 border-transparent text-left transition-all hover:shadow-md"
            style={{ background: "linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box" }}
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <p className="font-bold text-sm bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate with Sidekick</p>
              <p className="text-xs text-dark-secondary mt-1">Type a topic, paste a URL — Sidekick builds the full course</p>
            </div>
          </button>

          {/* Upload Content */}
          <button
            onClick={() => setMode("upload")}
            className="flex flex-col gap-3 p-5 rounded-2xl border-2 border-surface-border text-left hover:border-sprout-purple/40 hover:shadow-sm transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <Upload className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="font-bold text-sm text-dark">Upload Content</p>
              <p className="text-xs text-dark-secondary mt-1">Upload a PDF, doc, or video — AI turns it into a course</p>
            </div>
          </button>

          {/* Start Blank */}
          <button
            onClick={() => setMode("blank")}
            className="flex flex-col gap-3 p-5 rounded-2xl border-2 border-surface-border text-left hover:border-sprout-purple/40 hover:shadow-sm transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <p className="font-bold text-sm text-dark">Start Blank</p>
              <p className="text-xs text-dark-secondary mt-1">Build from scratch — add modules, slides, and quizzes manually</p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  if (mode === "upload") {
    return (
      <div className="p-4 md:p-6 max-w-xl mx-auto">
        <button onClick={() => { setMode("hub"); setUploadFile(null); setGenerating(false); setGenStatus([]); setError(""); }}
          className="flex items-center gap-2 text-sm text-dark-secondary hover:text-dark mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-2xl font-bold text-dark mb-2">Upload Content</h1>
        <p className="text-sm text-dark-secondary mb-6">Upload a PDF or video — Sidekick reads it and builds the full course automatically.</p>

        {!generating ? (
          <div className="space-y-4">
            {/* Drop zone */}
            <label className="block cursor-pointer">
              <div className={clsx(
                "rounded-xl border-2 border-dashed p-8 text-center transition-colors",
                uploadFile ? "border-amber-400 bg-amber-50" : "border-surface-border hover:border-amber-400 hover:bg-amber-50/40"
              )}>
                {uploadFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="w-6 h-6 text-amber-600 shrink-0" />
                    <span className="text-sm font-medium text-dark truncate max-w-[220px]">{uploadFile.name}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setUploadFile(null); }}
                      className="ml-auto p-1 rounded-lg hover:bg-amber-100 text-amber-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
                      <Upload className="w-6 h-6 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-dark">Click to choose a file</p>
                      <p className="text-xs text-dark-secondary mt-1">PDF, DOCX, MP4, MOV — up to 100 MB</p>
                    </div>
                  </div>
                )}
              </div>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.mp4,.mov,.avi,.webm"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setUploadFile(f); }}
              />
            </label>

            {/* Target role */}
            <div>
              <label className="text-xs font-medium text-dark-secondary mb-1.5 block">Target Role</label>
              <select value={uploadTargetRole} onChange={e => setUploadTargetRole(e.target.value)}
                className="w-full px-4 py-2.5 border border-surface-border rounded-xl text-sm bg-white focus:outline-none focus:border-amber-400 transition-colors">
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
                <option value="all">All Roles</option>
              </select>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

            <button
              onClick={handleUploadGenerate}
              disabled={!uploadFile}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)" }}
            >
              <Sparkles className="w-4 h-4" /> Upload & Generate Course
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-surface-border p-6 space-y-3">
            {genStatus.map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                {i === genStatus.length - 1 && !genStatus[genStatus.length - 1].includes("ready")
                  ? <Loader2 className="w-4 h-4 text-amber-500 animate-spin shrink-0" />
                  : <CheckCircle2 className="w-4 h-4 text-sprout-green shrink-0" />}
                <span className={i === genStatus.length - 1 ? "text-dark font-medium" : "text-dark-secondary"}>{s}</span>
              </div>
            ))}
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 mt-2">{error}</p>}
          </div>
        )}
      </div>
    );
  }

  if (mode === "sidekick") {
    return (
      <div className="p-4 md:p-6 max-w-xl mx-auto">
        <button onClick={() => { setMode("hub"); setGenerating(false); setGenStatus([]); setError(""); }}
          className="flex items-center gap-2 text-sm text-dark-secondary hover:text-dark mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="rounded-2xl border-2 border-transparent p-6"
          style={{ background: "linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box" }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-violet-600" />
            </div>
            <p className="font-bold text-lg bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate with Sidekick</p>
          </div>

          {!generating ? (
            <div className="space-y-4">
              {/* Input type toggle */}
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
                {(["topic", "url"] as const).map(t => (
                  <button key={t} onClick={() => setSidekickInput(t)}
                    className={clsx("px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize",
                      sidekickInput === t ? "bg-white text-dark shadow-sm" : "text-dark-secondary hover:text-dark")}>
                    {t === "topic" ? "Topic" : "Paste URL"}
                  </button>
                ))}
              </div>

              {/* Input */}
              {sidekickInput === "topic" ? (
                <textarea
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  placeholder="e.g. Food safety and proper handwashing for kitchen staff"
                  className="w-full px-4 py-3 border border-surface-border rounded-xl text-sm bg-white focus:outline-none focus:border-violet-400 transition-colors resize-none"
                  rows={3}
                />
              ) : (
                <input
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  placeholder="https://example.com/your-content"
                  type="url"
                  className="w-full px-4 py-3 border border-surface-border rounded-xl text-sm bg-white focus:outline-none focus:border-violet-400 transition-colors"
                />
              )}

              {/* Target role */}
              <div>
                <label className="text-xs font-medium text-dark-secondary mb-1.5 block">Target Role</label>
                <select value={targetRole} onChange={e => setTargetRole(e.target.value)}
                  className="w-full px-4 py-2.5 border border-surface-border rounded-xl text-sm bg-white focus:outline-none focus:border-violet-400 transition-colors">
                  <option value="staff">Staff</option>
                  <option value="manager">Manager</option>
                  <option value="all">All Roles</option>
                </select>
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

              <button
                onClick={handleGenerate}
                disabled={!inputValue.trim()}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
                style={{ background: "linear-gradient(135deg, #9333EA 0%, #6366F1 100%)" }}
              >
                Generate Course
              </button>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              {genStatus.map((s, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  {i === genStatus.length - 1 && !genStatus[genStatus.length - 1].includes("ready")
                    ? <Loader2 className="w-4 h-4 text-violet-500 animate-spin shrink-0" />
                    : <CheckCircle2 className="w-4 h-4 text-sprout-green shrink-0" />}
                  <span className={i === genStatus.length - 1 ? "text-dark font-medium" : "text-dark-secondary"}>{s}</span>
                </div>
              ))}
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 mt-2">{error}</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Blank mode
  return (
    <div className="p-4 md:p-6 max-w-xl mx-auto">
      <button onClick={() => setMode("hub")} className="flex items-center gap-2 text-sm text-dark-secondary hover:text-dark mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-bold text-dark mb-6">New Course</h1>
      <div className="bg-white rounded-xl border border-surface-border p-5 space-y-4">
        <div>
          <label className="text-xs font-semibold text-dark-secondary uppercase tracking-wide mb-1.5 block">Course Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Food Safety Fundamentals"
            className="w-full px-4 py-2.5 border border-surface-border rounded-xl text-sm focus:outline-none focus:border-sprout-green transition-colors" />
        </div>
        <div>
          <label className="text-xs font-semibold text-dark-secondary uppercase tracking-wide mb-1.5 block">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What will staff learn from this course?"
            className="w-full px-4 py-3 border border-surface-border rounded-xl text-sm focus:outline-none focus:border-sprout-green transition-colors resize-none" rows={3} />
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>}
        <button onClick={handleCreateBlank} disabled={!title.trim() || saving}
          className="w-full py-3 bg-sprout-green text-white rounded-xl text-sm font-semibold hover:bg-sprout-green/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : "Create Course"}
        </button>
      </div>
    </div>
  );
}
