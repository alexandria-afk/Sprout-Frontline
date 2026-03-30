"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, GripVertical, ChevronRight,
  Save, Send, Sparkles, BookOpen, HelpCircle, Video, FileText,
  Check, X, ChevronUp, ChevronDown, Loader2, Settings,
  LayoutList, EyeOff, AlertTriangle, Lock, Copy, Upload,
} from "lucide-react";
import {
  DragDropContext, Droppable, Draggable, DropResult,
} from "@hello-pangea/dnd";
import {
  getCourse, updateCourse, publishCourse, unpublishCourse, getEnrollmentStats,
  saveCourseStructure, duplicateCourse, generateQuiz,
  type Course, type CourseModule, type CourseSlide, type QuizQuestion, type QuizOption,
} from "@/services/lms";
import { apiFetch } from "@/services/api/client";
import { EnrollStaffModal } from "../_components/EnrollStaffModal";
import clsx from "clsx";

// ── Types for local builder state ─────────────────────────────────────────────

interface LocalSlide {
  _id: string;       // temp client-side id
  title: string;
  body: string;
  image_url: string;
  display_order: number;
}

interface LocalOption {
  id: string;
  text: string;
  is_correct: boolean;
}

interface LocalQuestion {
  _id: string;
  question: string;
  question_type: "multiple_choice" | "true_false" | "image_based";
  options: LocalOption[];
  explanation: string;
  display_order: number;
}

interface LocalModule {
  _id: string;
  title: string;
  module_type: "slides" | "video" | "pdf" | "quiz";
  content_url: string;
  is_required: boolean;
  estimated_duration_mins: string;
  display_order: number;
  slides: LocalSlide[];
  questions: LocalQuestion[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function moduleToLocal(m: CourseModule): LocalModule {
  return {
    _id: m.id ?? uid(),
    title: m.title,
    module_type: m.module_type,
    content_url: m.content_url ?? "",
    is_required: m.is_required,
    estimated_duration_mins: String(m.estimated_duration_mins ?? ""),
    display_order: m.display_order,
    slides: (m.course_slides ?? [])
      .sort((a, b) => a.display_order - b.display_order)
      .map(s => ({
        _id: s.id ?? uid(),
        title: s.title ?? "",
        body: s.body ?? "",
        image_url: s.image_url ?? "",
        display_order: s.display_order,
      })),
    questions: (m.quiz_questions ?? [])
      .sort((a, b) => a.display_order - b.display_order)
      .map(q => ({
        _id: q.id ?? uid(),
        question: q.question,
        question_type: q.question_type,
        options: q.options.length > 0 ? q.options.map(o => ({ id: o.id, text: o.text, is_correct: o.is_correct })) : defaultOptions(q.question_type),
        explanation: q.explanation ?? "",
        display_order: q.display_order,
      })),
  };
}

function defaultOptions(type: string): LocalOption[] {
  if (type === "true_false") return [
    { id: "true", text: "True", is_correct: true },
    { id: "false", text: "False", is_correct: false },
  ];
  return [
    { id: "a", text: "", is_correct: true },
    { id: "b", text: "", is_correct: false },
    { id: "c", text: "", is_correct: false },
    { id: "d", text: "", is_correct: false },
  ];
}

function blankModule(type: LocalModule["module_type"], order: number): LocalModule {
  return {
    _id: uid(),
    title: type === "slides" ? "New Lesson" : type === "quiz" ? "Knowledge Check" : type === "video" ? "Video Lesson" : "PDF Document",
    module_type: type,
    content_url: "",
    is_required: true,
    estimated_duration_mins: "",
    display_order: order,
    slides: type === "slides" ? [{ _id: uid(), title: "", body: "", image_url: "", display_order: 0 }] : [],
    questions: type === "quiz" ? [{
      _id: uid(),
      question: "",
      question_type: "multiple_choice",
      options: defaultOptions("multiple_choice"),
      explanation: "",
      display_order: 0,
    }] : [],
  };
}

const MODULE_META = {
  slides: { icon: BookOpen, label: "Lesson",  color: "text-sprout-green",  bg: "bg-sprout-green/10" },
  quiz:   { icon: HelpCircle, label: "Quiz",  color: "text-amber-600",     bg: "bg-amber-50" },
  video:  { icon: Video,    label: "Video",   color: "text-blue-600",      bg: "bg-blue-50" },
  pdf:    { icon: FileText, label: "PDF",     color: "text-red-500",       bg: "bg-red-50" },
};

// ── Slide Editor ──────────────────────────────────────────────────────────────

function SlideEditor({
  slide, index, total,
  onChange, onDelete, onMoveUp, onMoveDown,
}: {
  slide: LocalSlide;
  index: number;
  total: number;
  onChange: (s: LocalSlide) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="border border-surface-border rounded-xl overflow-hidden bg-white">
      {/* Slide header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50/80 border-b border-surface-border">
        <span className="text-xs font-semibold text-dark-secondary">Slide {index + 1}</span>
        <div className="flex-1" />
        <button onClick={onMoveUp} disabled={index === 0} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 transition-colors">
          <ChevronUp className="w-3.5 h-3.5 text-dark-secondary" />
        </button>
        <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 transition-colors">
          <ChevronDown className="w-3.5 h-3.5 text-dark-secondary" />
        </button>
        <button onClick={onDelete} className="p-1 rounded hover:bg-red-50 text-red-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-4 space-y-3">
        <input
          value={slide.title}
          onChange={e => onChange({ ...slide, title: e.target.value })}
          placeholder="Slide title (optional)"
          className="w-full px-3 py-2 border border-surface-border rounded-lg text-sm font-medium focus:outline-none focus:border-sprout-green transition-colors"
        />
        <textarea
          value={slide.body}
          onChange={e => onChange({ ...slide, body: e.target.value })}
          placeholder="Slide content — keep it short and clear. 2–4 sentences max."
          className="w-full px-3 py-2.5 border border-surface-border rounded-lg text-sm focus:outline-none focus:border-sprout-green transition-colors resize-none"
          rows={4}
        />
      </div>
    </div>
  );
}

// ── Question Editor ────────────────────────────────────────────────────────────

function QuestionEditor({
  question, index, total,
  onChange, onDelete, onMoveUp, onMoveDown,
}: {
  question: LocalQuestion;
  index: number;
  total: number;
  onChange: (q: LocalQuestion) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  function setCorrect(optId: string) {
    onChange({
      ...question,
      options: question.options.map(o => ({ ...o, is_correct: o.id === optId })),
    });
  }

  function updateOptionText(optId: string, text: string) {
    onChange({ ...question, options: question.options.map(o => o.id === optId ? { ...o, text } : o) });
  }

  function changeType(type: LocalQuestion["question_type"]) {
    onChange({ ...question, question_type: type, options: defaultOptions(type) });
  }

  return (
    <div className="border border-surface-border rounded-xl overflow-hidden bg-white">
      {/* Question header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50/80 border-b border-surface-border">
        <span className="text-xs font-semibold text-dark-secondary">Q{index + 1}</span>
        {/* Type selector */}
        <div className="flex gap-1 ml-2">
          {(["multiple_choice", "true_false"] as const).map(t => (
            <button key={t} onClick={() => changeType(t)}
              className={clsx("px-2 py-0.5 rounded text-[10px] font-medium transition-colors capitalize",
                question.question_type === t ? "bg-amber-500 text-white" : "bg-gray-100 text-dark-secondary hover:bg-gray-200")}>
              {t === "multiple_choice" ? "Multiple Choice" : "True / False"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={onMoveUp} disabled={index === 0} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 transition-colors">
          <ChevronUp className="w-3.5 h-3.5 text-dark-secondary" />
        </button>
        <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 transition-colors">
          <ChevronDown className="w-3.5 h-3.5 text-dark-secondary" />
        </button>
        <button onClick={onDelete} className="p-1 rounded hover:bg-red-50 text-red-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* Question text */}
        <textarea
          value={question.question}
          onChange={e => onChange({ ...question, question: e.target.value })}
          placeholder="Enter your question…"
          className="w-full px-3 py-2.5 border border-surface-border rounded-lg text-sm font-medium focus:outline-none focus:border-amber-400 transition-colors resize-none"
          rows={2}
        />

        {/* Options */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-dark-secondary uppercase tracking-wide">Answer Options — click ✓ to mark correct</p>
          {question.options.map(opt => (
            <div key={opt.id} className="flex items-center gap-2">
              <button
                onClick={() => setCorrect(opt.id)}
                className={clsx(
                  "w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all border-2",
                  opt.is_correct
                    ? "bg-sprout-green border-sprout-green text-white"
                    : "border-surface-border text-transparent hover:border-sprout-green/50"
                )}
              >
                <Check className="w-3 h-3" />
              </button>
              {question.question_type === "true_false" ? (
                <span className="flex-1 px-3 py-2 border border-surface-border rounded-lg text-sm bg-gray-50 text-dark font-medium">
                  {opt.text}
                </span>
              ) : (
                <input
                  value={opt.text}
                  onChange={e => updateOptionText(opt.id, e.target.value)}
                  placeholder={`Option ${opt.id.toUpperCase()}`}
                  className={clsx(
                    "flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none transition-colors",
                    opt.is_correct ? "border-sprout-green/50 bg-sprout-green/5" : "border-surface-border focus:border-sprout-green"
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* Explanation */}
        <div>
          <p className="text-[11px] font-semibold text-dark-secondary uppercase tracking-wide mb-1">Explanation (shown after answer)</p>
          <textarea
            value={question.explanation}
            onChange={e => onChange({ ...question, explanation: e.target.value })}
            placeholder="Why is this the correct answer? Help the learner understand."
            className="w-full px-3 py-2 border border-surface-border rounded-lg text-xs text-dark-secondary focus:outline-none focus:border-sprout-green transition-colors resize-none"
            rows={2}
          />
        </div>
      </div>
    </div>
  );
}

// ── AI Quiz Generation Modal ───────────────────────────────────────────────────

function AiQuizModal({
  onClose,
  onAccept,
  courseId,
  slidesContent,
}: {
  onClose: () => void;
  onAccept: (questions: LocalQuestion[]) => void;
  courseId: string;
  slidesContent: string[];
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [questions, setQuestions] = useState<Array<{
    question: string;
    options: string[];
    correct_index: number;
    explanation: string;
  }>>([]);

  useEffect(() => {
    generateQuiz({ course_id: courseId, slides_content: slidesContent, num_questions: 5 })
      .then(res => setQuestions(res.questions))
      .catch(e => setError((e as Error).message || "Failed to generate questions."))
      .finally(() => setLoading(false));
  }, []);

  function handleAccept() {
    const converted: LocalQuestion[] = questions.map((q, i) => ({
      _id: uid(),
      question: q.question,
      question_type: "multiple_choice",
      options: q.options.map((text, idx) => ({
        id: String.fromCharCode(97 + idx), // a, b, c, d
        text,
        is_correct: idx === q.correct_index,
      })),
      explanation: q.explanation ?? "",
      display_order: i,
    }));
    onAccept(converted);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-violet-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-dark">AI-Generated Quiz Questions</p>
            <p className="text-xs text-dark-secondary">Based on your course slide content</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-dark-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
              <p className="text-sm text-dark-secondary">Generating questions from your slides…</p>
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          ) : questions.length === 0 ? (
            <p className="text-sm text-dark-secondary text-center py-8">No questions generated. Try adding more slide content.</p>
          ) : (
            questions.map((q, i) => (
              <div key={i} className="border border-surface-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gradient-to-r from-violet-50/60 to-purple-50/60 border-b border-surface-border">
                  <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wide">Question {i + 1}</span>
                </div>
                <div className="p-4 space-y-2.5">
                  <p className="text-sm font-medium text-dark">{q.question}</p>
                  <div className="space-y-1.5">
                    {q.options.map((opt, oi) => (
                      <div key={oi} className={clsx(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
                        oi === q.correct_index
                          ? "bg-sprout-green/5 border border-sprout-green/30 text-dark"
                          : "bg-gray-50 text-dark-secondary"
                      )}>
                        {oi === q.correct_index
                          ? <Check className="w-3.5 h-3.5 text-sprout-green shrink-0" />
                          : <span className="w-3.5 h-3.5 shrink-0" />}
                        {opt}
                      </div>
                    ))}
                  </div>
                  {q.explanation && (
                    <p className="text-[11px] text-dark-secondary bg-gray-50 rounded-lg px-3 py-2 leading-relaxed">
                      <span className="font-semibold text-dark">Explanation: </span>{q.explanation}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {!loading && !error && questions.length > 0 && (
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-surface-border shrink-0">
            <button onClick={onClose}
              className="px-4 py-2 border border-surface-border rounded-xl text-sm font-medium text-dark hover:bg-gray-50 transition-colors">
              Dismiss
            </button>
            <button onClick={handleAccept}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors"
              style={{ background: "linear-gradient(135deg, #9333EA 0%, #6366F1 100%)" }}>
              <Check className="w-3.5 h-3.5" />
              Add all {questions.length} questions
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Module Editor (right panel) ────────────────────────────────────────────────

function ModuleEditorPanel({
  module: mod,
  onChange,
  courseId,
  allModules,
}: {
  module: LocalModule;
  onChange: (m: LocalModule) => void;
  courseId: string;
  allModules: LocalModule[];
}) {
  const meta = MODULE_META[mod.module_type];
  const Icon = meta.icon;

  const [uploadingModuleId, setUploadingModuleId] = useState<string | null>(null);
  const [showAiQuizModal, setShowAiQuizModal] = useState(false);

  async function handleModuleFileUpload(
    moduleId: string,
    file: File | null,
    onUrlChange: (url: string) => void,
  ) {
    if (!file) return;
    setUploadingModuleId(moduleId);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiFetch<{ url: string }>("/api/v1/lms/upload", { method: "POST", body: form, rawBody: true });
      onUrlChange(result.url);
    } catch (e) {
      alert("Upload failed: " + (e as Error).message);
    } finally {
      setUploadingModuleId(null);
    }
  }

  // ── Slides module ──────────────────────────────────────────────────────────
  if (mod.module_type === "slides") {
    const addSlide = () => {
      onChange({ ...mod, slides: [...mod.slides, { _id: uid(), title: "", body: "", image_url: "", display_order: mod.slides.length }] });
    };
    const updateSlide = (idx: number, s: LocalSlide) => {
      const updated = [...mod.slides];
      updated[idx] = s;
      onChange({ ...mod, slides: updated });
    };
    const deleteSlide = (idx: number) => {
      onChange({ ...mod, slides: mod.slides.filter((_, i) => i !== idx).map((s, i) => ({ ...s, display_order: i })) });
    };
    const moveSlide = (idx: number, dir: -1 | 1) => {
      const arr = [...mod.slides];
      const swap = idx + dir;
      if (swap < 0 || swap >= arr.length) return;
      [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
      onChange({ ...mod, slides: arr.map((s, i) => ({ ...s, display_order: i })) });
    };

    return (
      <div className="space-y-4">
        {/* Module title */}
        <div>
          <label className="text-[11px] font-semibold text-dark-secondary uppercase tracking-wide mb-1 block">Module Title</label>
          <input value={mod.title} onChange={e => onChange({ ...mod, title: e.target.value })}
            className="w-full px-3 py-2 border border-surface-border rounded-xl text-sm font-semibold focus:outline-none focus:border-sprout-green transition-colors" />
        </div>

        {/* Slides */}
        <div className="space-y-3">
          {mod.slides.map((slide, i) => (
            <SlideEditor key={slide._id} slide={slide} index={i} total={mod.slides.length}
              onChange={s => updateSlide(i, s)}
              onDelete={() => deleteSlide(i)}
              onMoveUp={() => moveSlide(i, -1)}
              onMoveDown={() => moveSlide(i, 1)}
            />
          ))}
          <button onClick={addSlide}
            className="w-full py-2.5 border-2 border-dashed border-surface-border rounded-xl text-sm font-medium text-dark-secondary hover:border-sprout-green hover:text-sprout-green transition-colors flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> Add Slide
          </button>
        </div>
      </div>
    );
  }

  // ── Quiz module ────────────────────────────────────────────────────────────
  if (mod.module_type === "quiz") {
    const addQuestion = () => {
      onChange({
        ...mod, questions: [...mod.questions, {
          _id: uid(), question: "", question_type: "multiple_choice",
          options: defaultOptions("multiple_choice"), explanation: "", display_order: mod.questions.length,
        }]
      });
    };
    const updateQuestion = (idx: number, q: LocalQuestion) => {
      const updated = [...mod.questions]; updated[idx] = q;
      onChange({ ...mod, questions: updated });
    };
    const deleteQuestion = (idx: number) => {
      onChange({ ...mod, questions: mod.questions.filter((_, i) => i !== idx).map((q, i) => ({ ...q, display_order: i })) });
    };
    const moveQuestion = (idx: number, dir: -1 | 1) => {
      const arr = [...mod.questions]; const swap = idx + dir;
      if (swap < 0 || swap >= arr.length) return;
      [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
      onChange({ ...mod, questions: arr.map((q, i) => ({ ...q, display_order: i })) });
    };

    // Collect all slide bodies from all slide-type modules for AI generation
    const allSlideBodies = allModules
      .filter(m => m.module_type === "slides")
      .flatMap(m => m.slides.map(s => [s.title, s.body].filter(Boolean).join(" — ")))
      .filter(Boolean);

    return (
      <div className="space-y-4">
        <div>
          <label className="text-[11px] font-semibold text-dark-secondary uppercase tracking-wide mb-1 block">Module Title</label>
          <input value={mod.title} onChange={e => onChange({ ...mod, title: e.target.value })}
            className="w-full px-3 py-2 border border-surface-border rounded-xl text-sm font-semibold focus:outline-none focus:border-amber-400 transition-colors" />
        </div>
        <div className="space-y-3">
          {mod.questions.map((q, i) => (
            <QuestionEditor key={q._id} question={q} index={i} total={mod.questions.length}
              onChange={updated => updateQuestion(i, updated)}
              onDelete={() => deleteQuestion(i)}
              onMoveUp={() => moveQuestion(i, -1)}
              onMoveDown={() => moveQuestion(i, 1)}
            />
          ))}
          <div className="flex gap-2">
            <button onClick={addQuestion}
              className="flex-1 py-2.5 border-2 border-dashed border-surface-border rounded-xl text-sm font-medium text-dark-secondary hover:border-amber-400 hover:text-amber-600 transition-colors flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" /> Add Question
            </button>
            <button
              onClick={() => setShowAiQuizModal(true)}
              disabled={allSlideBodies.length === 0}
              title={allSlideBodies.length === 0 ? "Add slide content first to generate questions" : "Generate questions with AI"}
              className="flex items-center gap-1.5 px-4 py-2.5 border-2 border-transparent rounded-xl text-sm font-semibold text-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-sm"
              style={{ background: "linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box" }}
            >
              <Sparkles className="w-3.5 h-3.5 text-violet-600" />
              Generate with AI
            </button>
          </div>
        </div>

        {showAiQuizModal && (
          <AiQuizModal
            courseId={courseId}
            slidesContent={allSlideBodies}
            onClose={() => setShowAiQuizModal(false)}
            onAccept={generated => {
              const startOrder = mod.questions.length;
              onChange({
                ...mod,
                questions: [
                  ...mod.questions,
                  ...generated.map((q, i) => ({ ...q, display_order: startOrder + i })),
                ],
              });
            }}
          />
        )}
      </div>
    );
  }

  // ── Video / PDF module ─────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div>
        <label className="text-[11px] font-semibold text-dark-secondary uppercase tracking-wide mb-1 block">Module Title</label>
        <input value={mod.title} onChange={e => onChange({ ...mod, title: e.target.value })}
          className="w-full px-3 py-2 border border-surface-border rounded-xl text-sm font-semibold focus:outline-none focus:border-sprout-green transition-colors" />
      </div>
      <div>
        <label className="text-[11px] font-semibold text-dark-secondary uppercase tracking-wide mb-1 block">
          {mod.module_type === "video" ? "Video URL" : "PDF URL"}
        </label>
        <input value={mod.content_url} onChange={e => onChange({ ...mod, content_url: e.target.value })}
          placeholder={mod.module_type === "video" ? "https://…/video.mp4" : "https://…/document.pdf"}
          className="w-full px-3 py-2 border border-surface-border rounded-xl text-sm focus:outline-none focus:border-sprout-green transition-colors" />
        <div className="flex items-center gap-2 mt-1.5">
          <label className="flex items-center gap-1.5 cursor-pointer px-3 py-1.5 text-xs font-medium text-sprout-purple bg-violet-50 rounded-lg hover:bg-violet-100 transition-colors">
            <Upload className="w-3.5 h-3.5" />
            {uploadingModuleId === mod._id ? "Uploading…" : "Upload File"}
            <input
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.mp4,.mov,.webm,.avi"
              disabled={uploadingModuleId === mod._id}
              onChange={(e) => handleModuleFileUpload(mod._id, e.target.files?.[0] ?? null, (url) => onChange({ ...mod, content_url: url }))}
            />
          </label>
          <span className="text-[10px] text-dark/40">or paste a URL above</span>
        </div>
      </div>
    </div>
  );
}

// ── Settings Panel ─────────────────────────────────────────────────────────────

function SettingsPanel({
  course, onChange,
}: {
  course: LocalCourseSettings;
  onChange: (s: LocalCourseSettings) => void;
}) {
  return (
    <div className="space-y-4 p-1">
      <div>
        <label className="text-[11px] font-semibold text-dark-secondary uppercase tracking-wide mb-1 block">Course Title</label>
        <input value={course.title} onChange={e => onChange({ ...course, title: e.target.value })}
          className="w-full px-3 py-2 border border-surface-border rounded-xl text-sm font-semibold focus:outline-none focus:border-sprout-green transition-colors" />
      </div>
      <div>
        <label className="text-[11px] font-semibold text-dark-secondary uppercase tracking-wide mb-1 block">Description</label>
        <textarea value={course.description} onChange={e => onChange({ ...course, description: e.target.value })}
          placeholder="What will staff learn from this course?"
          className="w-full px-3 py-2 border border-surface-border rounded-xl text-sm focus:outline-none focus:border-sprout-green transition-colors resize-none"
          rows={3} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-semibold text-dark-secondary uppercase tracking-wide mb-1 block">Passing Score (%)</label>
          <input type="number" min={0} max={100} value={course.passing_score}
            onChange={e => onChange({ ...course, passing_score: Number(e.target.value) })}
            className="w-full px-3 py-2 border border-surface-border rounded-xl text-sm focus:outline-none focus:border-sprout-green transition-colors" />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-dark-secondary uppercase tracking-wide mb-1 block">Max Retakes</label>
          <input type="number" min={0} value={course.max_retakes ?? ""}
            onChange={e => onChange({ ...course, max_retakes: e.target.value ? Number(e.target.value) : null })}
            placeholder="Unlimited"
            className="w-full px-3 py-2 border border-surface-border rounded-xl text-sm focus:outline-none focus:border-sprout-green transition-colors" />
        </div>
      </div>
      <div>
        <label className="text-[11px] font-semibold text-dark-secondary uppercase tracking-wide mb-1 block">Cert Validity (days)</label>
        <input type="number" min={0} value={course.cert_validity_days ?? ""}
          onChange={e => onChange({ ...course, cert_validity_days: e.target.value ? Number(e.target.value) : null })}
          placeholder="No expiry"
          className="w-full px-3 py-2 border border-surface-border rounded-xl text-sm focus:outline-none focus:border-sprout-green transition-colors" />
      </div>
    </div>
  );
}

// ── Local settings type ────────────────────────────────────────────────────────

interface LocalCourseSettings {
  title: string;
  description: string;
  passing_score: number;
  max_retakes: number | null;
  cert_validity_days: number | null;
}

// ── Main Builder Page ──────────────────────────────────────────────────────────

export default function CourseBuilderPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const courseId = params.id as string;
  const isNew = searchParams.get("new") === "1";

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<LocalModule[]>([]);
  const [settings, setSettings] = useState<LocalCourseSettings>({
    title: "", description: "", passing_score: 80, max_retakes: 3, cert_validity_days: null,
  });
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<"modules" | "settings">(isNew ? "settings" : "modules");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showAddModule, setShowAddModule] = useState(false);
  const [error, setError] = useState("");

  // Enroll modal (auto-opens after save on new courses)
  const [showEnroll, setShowEnroll] = useState(false);

  // Publish-lock modal
  const [showLockedModal, setShowLockedModal] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  // Unpublish modal
  const [showUnpublish, setShowUnpublish] = useState(false);
  const [unpublishStats, setUnpublishStats] = useState<{ active_count: number; completed_count: number } | null>(null);
  const [unpublishPending, setUnpublishPending] = useState<"keep" | "cancel">("keep");
  const [unpublishing, setUnpublishing] = useState(false);

  // Load course
  useEffect(() => {
    getCourse(courseId).then(c => {
      if (!c) { router.push("/dashboard/training/courses"); return; }
      setCourse(c);
      const localMods = (c.course_modules ?? [])
        .sort((a, b) => a.display_order - b.display_order)
        .map(moduleToLocal);
      setModules(localMods);
      setSettings({
        title: c.title,
        description: c.description ?? "",
        passing_score: c.passing_score,
        max_retakes: c.max_retakes,
        cert_validity_days: c.cert_validity_days,
      });
      if (localMods.length > 0) setSelectedModuleId(localMods[0]._id);
    }).catch(() => router.push("/dashboard/training/courses"))
      .finally(() => setLoading(false));
  }, [courseId]);

  function markDirty() { setDirty(true); setSaveSuccess(false); }

  function updateModule(modId: string, updated: LocalModule) {
    setModules(prev => prev.map(m => m._id === modId ? updated : m));
    markDirty();
  }

  function deleteModule(modId: string) {
    if (guardLocked()) return;
    setModules(prev => {
      const filtered = prev.filter(m => m._id !== modId).map((m, i) => ({ ...m, display_order: i }));
      if (selectedModuleId === modId) setSelectedModuleId(filtered[0]?._id ?? null);
      return filtered;
    });
    markDirty();
  }

  function addModule(type: LocalModule["module_type"]) {
    if (guardLocked()) return;
    const mod = blankModule(type, modules.length);
    setModules(prev => [...prev, mod]);
    setSelectedModuleId(mod._id);
    setShowAddModule(false);
    markDirty();
  }

  function onDragEnd(result: DropResult) {
    if (!result.destination) return;
    if (guardLocked()) return;
    const arr = [...modules];
    const [moved] = arr.splice(result.source.index, 1);
    arr.splice(result.destination.index, 0, moved);
    setModules(arr.map((m, i) => ({ ...m, display_order: i })));
    markDirty();
  }

  function validateModules(): string | null {
    if (modules.length === 0) return "Add at least one module before saving.";
    for (const m of modules) {
      if (!m.title.trim()) return `A module has no title — please fill it in.`;
      if (m.module_type === "slides") {
        if (m.slides.length === 0) return `"${m.title}" needs at least one slide.`;
      } else if (m.module_type === "quiz") {
        if (m.questions.length === 0) return `"${m.title}" needs at least one question.`;
      } else if (m.module_type === "video" || m.module_type === "pdf") {
        if (!m.content_url.trim()) return `"${m.title}" needs a ${m.module_type === "video" ? "video" : "PDF"} URL.`;
      }
    }
    return null;
  }

  async function handleSave(): Promise<boolean> {
    if (!course) return false;
    setSaving(true);
    setError("");
    try {
      // Always save settings
      await updateCourse(courseId, {
        title: settings.title,
        description: settings.description || undefined,
        passing_score: settings.passing_score,
        max_retakes: settings.max_retakes ?? undefined,
        cert_validity_days: settings.cert_validity_days ?? undefined,
      });

      // Save module structure only if there are modules and course is not published
      if (modules.length > 0 && !course.is_published) {
        const validationError = validateModules();
        if (validationError) { setError(validationError); return false; }
        const saved = await saveCourseStructure(courseId, modules.map((m, i) => ({
          title: m.title,
          module_type: m.module_type,
          content_url: m.content_url || undefined,
          display_order: i,
          is_required: m.is_required,
          estimated_duration_mins: m.estimated_duration_mins ? Number(m.estimated_duration_mins) : undefined,
          slides: m.slides.map((s, j) => ({ title: s.title || undefined, body: s.body || undefined, image_url: s.image_url || undefined, display_order: j })),
          questions: m.questions.map((q, j) => ({
            question: q.question,
            question_type: q.question_type,
            options: q.options,
            explanation: q.explanation || undefined,
            display_order: j,
          })),
        })));
        // Sync local module state from server response to ensure IDs & slides are up-to-date
        if (saved?.course_modules) {
          const synced = (saved.course_modules)
            .sort((a, b) => a.display_order - b.display_order)
            .map(moduleToLocal);
          setModules(synced);
          // Keep selection on the same display_order position as before
          const currentMod = modules.find(m => m._id === selectedModuleId);
          const targetOrder = currentMod?.display_order ?? 0;
          const newSelected = synced.find(m => m.display_order === targetOrder) ?? synced[0];
          if (newSelected) setSelectedModuleId(newSelected._id);
        }
      }

      setDirty(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      // After first save on a new course, open the enroll modal
      if (isNew) setShowEnroll(true);
      return true;
    } catch (e) {
      setError((e as Error).message || "Failed to save. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAndPublish() {
    if (!course) return;
    // Require at least one module before publishing
    const validationError = validateModules();
    if (validationError) { setError(validationError); return; }
    const saved = await handleSave();
    if (!saved) return;
    setPublishing(true);
    try {
      await publishCourse(courseId);
      setCourse(prev => prev ? { ...prev, is_published: true, was_published: true } : prev);
      if (isNew) setShowEnroll(true);
    } catch (e) {
      setError((e as Error).message || "Failed to publish.");
    } finally {
      setPublishing(false);
    }
  }

  async function handlePublish() {
    if (!course) return;
    setPublishing(true);
    try {
      await publishCourse(courseId);
      setCourse(prev => prev ? { ...prev, is_published: true, was_published: true } : prev);
    } catch (e) {
      setError((e as Error).message || "Failed to publish.");
    } finally {
      setPublishing(false);
    }
  }

  async function openUnpublishModal() {
    setUnpublishStats(null);
    setUnpublishPending("keep");
    setShowUnpublish(true);
    try {
      const stats = await getEnrollmentStats(courseId);
      setUnpublishStats(stats);
    } catch {
      setUnpublishStats({ active_count: 0, completed_count: 0 });
    }
  }

  async function handleUnpublish() {
    setUnpublishing(true);
    try {
      await unpublishCourse(courseId, unpublishPending === "cancel");
      setCourse(prev => prev ? { ...prev, is_published: false, was_published: true } : prev);
      setShowUnpublish(false);
    } catch (e) {
      setError((e as Error).message || "Failed to unpublish.");
      setShowUnpublish(false);
    } finally {
      setUnpublishing(false);
    }
  }

  const isPublished = course?.is_published ?? false;

  function guardLocked(): boolean {
    if (!isPublished) return false;
    setShowLockedModal(true);
    return true;
  }

  async function handleDuplicate() {
    setDuplicating(true);
    try {
      const { id } = await duplicateCourse(courseId);
      setShowLockedModal(false);
      router.push(`/dashboard/training/courses/${id}`);
    } catch (e) {
      setError((e as Error).message || "Failed to duplicate.");
    } finally {
      setDuplicating(false);
    }
  }

  const selectedModule = modules.find(m => m._id === selectedModuleId) ?? null;

  if (loading) return (
    <div className="h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-sprout-green animate-spin" />
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] overflow-hidden">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-surface-border shrink-0">
        <button onClick={() => router.push("/dashboard/training/courses")}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark-secondary transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-dark truncate">{settings.title || "Untitled Course"}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={clsx("text-[10px] font-bold px-1.5 py-0.5 rounded-full",
              course?.is_published
                ? "bg-sprout-green/10 text-sprout-green"
                : course?.was_published
                  ? "bg-amber-100 text-amber-600"
                  : "bg-gray-100 text-gray-500")}>
              {course?.is_published ? "Published" : course?.was_published ? "Unpublished" : "Draft"}
            </span>
            {course?.ai_generated && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-violet-100 to-purple-100 text-violet-600">✨ Sidekick</span>
            )}
            {dirty && <span className="text-[10px] text-amber-500 font-medium">Unsaved changes</span>}
            {saveSuccess && <span className="text-[10px] text-sprout-green font-medium">Saved ✓</span>}
          </div>
        </div>
        {error && <p className="text-xs text-red-500 max-w-xs truncate">{error}</p>}
        <button onClick={handleSave} disabled={saving || publishing}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm font-medium transition-all",
            saveSuccess
              ? "border-sprout-green/40 bg-sprout-green/5 text-sprout-green"
              : "border-surface-border text-dark hover:bg-gray-50 disabled:opacity-40"
          )}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saveSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving…" : saveSuccess ? "Saved" : "Save"}
        </button>
        {course?.is_published ? (
          <button onClick={openUnpublishModal}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-amber-300 bg-amber-50 text-amber-700 rounded-lg text-sm font-semibold hover:bg-amber-100 transition-colors">
            <EyeOff className="w-3.5 h-3.5" />
            Unpublish
          </button>
        ) : (
          <button onClick={handleSaveAndPublish} disabled={saving || publishing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sprout-green text-white rounded-lg text-sm font-semibold hover:bg-sprout-green/90 disabled:opacity-50 transition-colors">
            {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {course?.was_published ? "Re-publish" : "Save & Publish"}
          </button>
        )}
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left panel: Module list + Settings ─────────────────────────── */}
        <div className="w-72 shrink-0 border-r border-surface-border bg-gray-50/50 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-surface-border shrink-0">
            {([["modules", LayoutList, "Modules"], ["settings", Settings, "Settings"]] as const).map(([tab, Icon, label]) => (
              <button key={tab} onClick={() => setLeftTab(tab)}
                className={clsx("flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors",
                  leftTab === tab ? "text-sprout-green border-b-2 border-sprout-green bg-white" : "text-dark-secondary hover:text-dark")}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {/* Modules tab */}
          {leftTab === "modules" && (
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="modules">
                  {provided => (
                    <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1.5">
                      {modules.map((mod, idx) => {
                        const meta = MODULE_META[mod.module_type];
                        const ModIcon = meta.icon;
                        const isSelected = mod._id === selectedModuleId;
                        return (
                          <Draggable key={mod._id} draggableId={mod._id} index={idx}>
                            {(drag, snapshot) => (
                              <div
                                ref={drag.innerRef}
                                {...drag.draggableProps}
                                onClick={() => setSelectedModuleId(mod._id)}
                                className={clsx(
                                  "flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all group",
                                  isSelected ? "bg-white border border-sprout-green/30 shadow-sm" : "bg-white/50 border border-transparent hover:bg-white hover:border-surface-border",
                                  snapshot.isDragging && "shadow-lg rotate-1"
                                )}
                              >
                                <span {...(isPublished ? {} : drag.dragHandleProps)} className={clsx("text-dark/20 shrink-0", isPublished ? "cursor-default" : "hover:text-dark/50 cursor-grab active:cursor-grabbing")}>
                                  <GripVertical className="w-3.5 h-3.5" />
                                </span>
                                <div className={clsx("w-6 h-6 rounded-md flex items-center justify-center shrink-0", meta.bg)}>
                                  <ModIcon className={clsx("w-3 h-3", meta.color)} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-dark truncate">{mod.title}</p>
                                  <p className={clsx("text-[10px] font-medium capitalize", meta.color)}>{meta.label}</p>
                                </div>
                                {!isPublished && (
                                  <button
                                    onClick={e => { e.stopPropagation(); deleteModule(mod._id); }}
                                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-red-400 transition-all shrink-0">
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>

              {/* Add module (hidden when published) */}
              {!isPublished && (showAddModule ? (
                <div className="bg-white border border-surface-border rounded-xl p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-dark-secondary uppercase tracking-wide mb-2">Add Module</p>
                  {(Object.entries(MODULE_META) as [LocalModule["module_type"], typeof MODULE_META["slides"]][]).map(([type, meta]) => {
                    const Icon = meta.icon;
                    return (
                      <button key={type} onClick={() => addModule(type)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left">
                        <div className={clsx("w-6 h-6 rounded-md flex items-center justify-center", meta.bg)}>
                          <Icon className={clsx("w-3 h-3", meta.color)} />
                        </div>
                        <span className="text-xs font-medium text-dark capitalize">{meta.label}</span>
                      </button>
                    );
                  })}
                  <button onClick={() => setShowAddModule(false)} className="w-full text-center text-xs text-dark-secondary hover:text-dark py-1 transition-colors">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setShowAddModule(true)}
                  className="w-full py-2 border-2 border-dashed border-surface-border rounded-xl text-xs font-medium text-dark-secondary hover:border-sprout-green hover:text-sprout-green transition-colors flex items-center justify-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Add Module
                </button>
              ))}
              {isPublished && (
                <button onClick={() => setShowLockedModal(true)}
                  className="w-full py-2 border border-surface-border rounded-xl text-xs font-medium text-dark/30 flex items-center justify-center gap-1 cursor-pointer hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 transition-colors">
                  <Lock className="w-3 h-3" /> Locked — course is published
                </button>
              )}
            </div>
          )}

          {/* Settings tab */}
          {leftTab === "settings" && (
            <div className="flex-1 overflow-y-auto p-3">
              <SettingsPanel course={settings} onChange={s => { setSettings(s); markDirty(); }} />
            </div>
          )}
        </div>

        {/* ── Right panel: Module editor ───────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-surface-page">
          {selectedModule ? (
            <div className="max-w-2xl mx-auto p-6 relative">
              {/* Lock overlay when published — blocks all module editing */}
              {isPublished && (
                <button
                  onClick={() => setShowLockedModal(true)}
                  className="absolute inset-0 z-10 cursor-pointer group"
                  title="This course is published — click to learn how to make changes"
                >
                  <div className="absolute top-0 right-0 flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 m-2 text-xs font-semibold text-amber-700 group-hover:bg-amber-100 transition-colors">
                    <Lock className="w-3 h-3" /> Locked — course is published
                  </div>
                </button>
              )}
              {/* Module type badge */}
              {(() => {
                const meta = MODULE_META[selectedModule.module_type];
                const Icon = meta.icon;
                return (
                  <div className="flex items-center gap-2 mb-5">
                    <div className={clsx("w-7 h-7 rounded-lg flex items-center justify-center", meta.bg)}>
                      <Icon className={clsx("w-3.5 h-3.5", meta.color)} />
                    </div>
                    <span className={clsx("text-xs font-bold uppercase tracking-wide", meta.color)}>{meta.label}</span>
                  </div>
                );
              })()}

              <ModuleEditorPanel
                module={selectedModule}
                onChange={updated => updateModule(selectedModule._id, updated)}
                courseId={courseId}
                allModules={modules}
              />
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center px-8">
              <LayoutList className="w-10 h-10 text-gray-300 mb-3" />
              <p className="text-sm font-semibold text-dark-secondary">No module selected</p>
              <p className="text-xs text-dark/30 mt-1">
                {isPublished ? "Modules are locked while the course is published" : "Add a module from the left panel to start building"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Enroll Staff modal ──────────────────────────────────────────────── */}
      {showEnroll && course && (
        <EnrollStaffModal
          course={course}
          onClose={() => setShowEnroll(false)}
          onSuccess={() => router.push("/dashboard/training/courses")}
        />
      )}

      {/* ── Unpublish confirmation modal ────────────────────────────────────── */}
      {showUnpublish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-dark">Unpublish Course</h2>
                <p className="text-sm text-dark-secondary mt-0.5">Are you sure you want to unpublish this course?</p>
              </div>
            </div>

            <ul className="space-y-1.5 text-sm text-dark-secondary">
              <li className="flex items-start gap-2">
                <span className="text-dark/30 mt-0.5">•</span>
                Staff can no longer find or enroll in this course
              </li>
              {unpublishStats === null ? (
                <li className="flex items-center gap-2 text-dark/40">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading enrollment data…
                </li>
              ) : unpublishStats.active_count > 0 ? (
                <li className="flex items-start gap-2">
                  <span className="text-dark/30 mt-0.5">•</span>
                  <span>
                    <strong className="text-dark">{unpublishStats.active_count} staff member{unpublishStats.active_count !== 1 ? "s" : ""}</strong> currently in progress — they can still complete it
                  </span>
                </li>
              ) : null}
              {unpublishStats !== null && unpublishStats.completed_count > 0 && (
                <li className="flex items-start gap-2">
                  <span className="text-dark/30 mt-0.5">•</span>
                  <span>
                    <strong className="text-dark">{unpublishStats.completed_count} completion{unpublishStats.completed_count !== 1 ? "s" : ""}</strong> and certificates already issued — these are preserved
                  </span>
                </li>
              )}
            </ul>

            {unpublishStats !== null && unpublishStats.active_count > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wide">What happens to pending enrollments?</p>
                <label className={clsx(
                  "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
                  unpublishPending === "keep" ? "border-sprout-green/40 bg-sprout-green/5" : "border-surface-border hover:bg-gray-50"
                )}>
                  <input type="radio" name="unpublish-pending" value="keep" checked={unpublishPending === "keep"}
                    onChange={() => setUnpublishPending("keep")} className="mt-0.5 accent-sprout-green" />
                  <div>
                    <p className="text-sm font-medium text-dark">Let them finish <span className="text-xs font-normal text-sprout-green">(recommended)</span></p>
                    <p className="text-xs text-dark-secondary mt-0.5">In-progress learners can still complete the course</p>
                  </div>
                </label>
                <label className={clsx(
                  "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
                  unpublishPending === "cancel" ? "border-red-300 bg-red-50" : "border-surface-border hover:bg-gray-50"
                )}>
                  <input type="radio" name="unpublish-pending" value="cancel" checked={unpublishPending === "cancel"}
                    onChange={() => setUnpublishPending("cancel")} className="mt-0.5 accent-red-500" />
                  <div>
                    <p className="text-sm font-medium text-dark">Cancel all pending enrollments</p>
                    <p className="text-xs text-dark-secondary mt-0.5">Removes all in-progress and not-started enrollments</p>
                  </div>
                </label>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button onClick={() => setShowUnpublish(false)}
                className="px-4 py-2 border border-surface-border rounded-xl text-sm font-medium text-dark hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleUnpublish} disabled={unpublishing || unpublishStats === null}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-xl text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors">
                {unpublishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <EyeOff className="w-3.5 h-3.5" />}
                Unpublish Course
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Publish-lock modal ───────────────────────────────────────────────── */}
      {showLockedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-dark">🔒 This course is published</h2>
                <p className="text-sm text-dark-secondary mt-1 leading-relaxed">
                  To make structural changes, duplicate the course and edit the copy.
                  Publish the copy when ready — it will replace this version for new enrollments.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-1">
              <button onClick={() => setShowLockedModal(false)}
                className="px-4 py-2 border border-surface-border rounded-xl text-sm font-medium text-dark hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleDuplicate} disabled={duplicating}
                className="flex items-center gap-2 px-4 py-2 bg-sprout-purple text-white rounded-xl text-sm font-semibold hover:bg-sprout-purple/90 disabled:opacity-50 transition-colors">
                {duplicating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                Duplicate Course
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
