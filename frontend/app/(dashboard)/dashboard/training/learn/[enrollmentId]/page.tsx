"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft, ChevronLeft, ChevronRight, CheckCircle2,
  XCircle, GraduationCap, Clock, BookOpen, HelpCircle,
  Video, FileText, Trophy, RotateCcw, Award, Loader2,
  Play, Check,
} from "lucide-react";
import {
  getEnrollmentWithProgress, updateProgress, submitQuiz,
  type Course, type CourseModule, type CourseSlide,
  type QuizQuestion, type CourseEnrollment, type ModuleProgress,
} from "@/services/lms";
import clsx from "clsx";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnrollmentData {
  enrollment: CourseEnrollment;
  course: Course;
  module_progress: ModuleProgress[];
}

type Screen = "loading" | "overview" | "slides" | "quiz" | "video" | "pdf" | "quiz_results" | "complete";

interface QuizAnswer { question_id: string; selected_option: string; }
interface QuizResult { score: number; passed: boolean; correct: number; total: number; attempt_number: number; }

// ── Helpers ───────────────────────────────────────────────────────────────────

const MODULE_META = {
  slides: { icon: BookOpen,   label: "Lesson",  color: "text-sprout-green", bg: "bg-sprout-green/10" },
  quiz:   { icon: HelpCircle, label: "Quiz",    color: "text-amber-600",    bg: "bg-amber-50" },
  video:  { icon: Video,      label: "Video",   color: "text-blue-600",     bg: "bg-blue-50" },
  pdf:    { icon: FileText,   label: "PDF",     color: "text-red-500",      bg: "bg-red-50" },
};

function sortedModules(course: Course): CourseModule[] {
  return [...(course.course_modules ?? [])].sort((a, b) => a.display_order - b.display_order);
}

function getModuleStatus(moduleId: string, progress: ModuleProgress[]): "not_started" | "in_progress" | "completed" {
  const p = progress.find(p => p.module_id === moduleId);
  return p?.status ?? "not_started";
}

// ── Slides Player ─────────────────────────────────────────────────────────────

function SlidesPlayer({
  module: mod,
  onComplete,
}: {
  module: CourseModule;
  onComplete: () => void;
}) {
  const slides = [...(mod.course_slides ?? [])].sort((a, b) => a.display_order - b.display_order);
  const [idx, setIdx] = useState(0);
  const current = slides[idx];
  const isLast = idx === slides.length - 1;

  if (slides.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <BookOpen className="w-10 h-10 text-gray-300" />
        <p className="text-sm text-dark-secondary">No slides in this module.</p>
        <button onClick={onComplete} className="px-6 py-2.5 bg-sprout-green text-white rounded-xl text-sm font-semibold">
          Mark Complete
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Progress bar */}
      <div className="px-4 pt-3 pb-1 shrink-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] text-dark-secondary font-medium">Slide {idx + 1} of {slides.length}</span>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-sprout-green rounded-full transition-all duration-300"
              style={{ width: `${((idx + 1) / slides.length) * 100}%` }}
            />
          </div>
        </div>
        {/* Slide dots */}
        <div className="flex gap-1 justify-center">
          {slides.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)}
              className={clsx("rounded-full transition-all", i === idx ? "w-4 h-1.5 bg-sprout-green" : "w-1.5 h-1.5 bg-gray-200 hover:bg-gray-300")} />
          ))}
        </div>
      </div>

      {/* Slide card */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="min-h-full bg-white rounded-2xl border border-surface-border overflow-hidden flex flex-col">
          {/* Image area */}
          {current?.image_url ? (
            <div className="h-48 md:h-64 bg-gray-100 overflow-hidden shrink-0">
              <img src={current.image_url} alt="" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="h-32 bg-gradient-to-br from-sprout-green/10 to-sprout-purple/10 flex items-center justify-center shrink-0">
              <BookOpen className="w-8 h-8 text-sprout-green/30" />
            </div>
          )}
          {/* Text */}
          <div className="p-6 flex-1">
            {current?.title && (
              <h2 className="text-xl font-bold text-dark mb-3 leading-snug">{current.title}</h2>
            )}
            {current?.body && (
              <p className="text-base text-dark/80 leading-relaxed whitespace-pre-wrap">{current.body}</p>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="px-4 pb-6 pt-3 flex items-center gap-3 shrink-0">
        <button
          onClick={() => setIdx(i => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="flex items-center gap-1.5 px-4 py-2.5 border border-surface-border rounded-xl text-sm font-medium text-dark-secondary disabled:opacity-30 hover:bg-gray-50 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Prev
        </button>
        <div className="flex-1" />
        {isLast ? (
          <button
            onClick={onComplete}
            className="flex items-center gap-2 px-6 py-2.5 bg-sprout-green text-white rounded-xl text-sm font-semibold hover:bg-sprout-green/90 transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" /> Complete Lesson
          </button>
        ) : (
          <button
            onClick={() => setIdx(i => Math.min(slides.length - 1, i + 1))}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-sprout-green text-white rounded-xl text-sm font-semibold hover:bg-sprout-green/90 transition-colors"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Quiz Player ────────────────────────────────────────────────────────────────

function QuizPlayer({
  module: mod,
  enrollmentId,
  passingScore,
  maxRetakes,
  attemptCount,
  onComplete,
  onFail,
}: {
  module: CourseModule;
  enrollmentId: string;
  passingScore: number;
  maxRetakes: number | null;
  attemptCount: number;
  onComplete: (result: QuizResult) => void;
  onFail: (result: QuizResult) => void;
}) {
  const questions = [...(mod.quiz_questions ?? [])].sort((a, b) => a.display_order - b.display_order);
  const [qIdx, setQIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const current = questions[qIdx];
  const isLast = qIdx === questions.length - 1;

  function getCorrectId(q: QuizQuestion) {
    return q.options.find(o => o.is_correct)?.id ?? "";
  }

  function handleSelect(optId: string) {
    if (revealed) return;
    setSelected(optId);
  }

  function handleConfirm() {
    if (!selected || !current) return;
    setRevealed(true);
  }

  async function handleNext() {
    if (!selected || !current) return;
    const updated = [...answers, { question_id: current.id, selected_option: selected }];

    if (isLast) {
      // Submit quiz
      setSubmitting(true);
      try {
        const result = await submitQuiz(enrollmentId, mod.id, updated);
        if (result.passed) onComplete(result);
        else onFail(result);
      } catch {
        onFail({ score: 0, passed: false, correct: 0, total: questions.length, attempt_number: attemptCount + 1 });
      } finally {
        setSubmitting(false);
      }
    } else {
      setAnswers(updated);
      setSelected(null);
      setRevealed(false);
      setQIdx(i => i + 1);
    }
  }

  if (questions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
        <p className="text-sm text-dark-secondary">No questions in this quiz.</p>
        <button onClick={() => onComplete({ score: 100, passed: true, correct: 0, total: 0, attempt_number: 1 })}
          className="px-6 py-2.5 bg-sprout-green text-white rounded-xl text-sm font-semibold">
          Continue
        </button>
      </div>
    );
  }

  const correctId = revealed && current ? getCorrectId(current) : null;
  const isCorrect = revealed && selected === correctId;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Progress */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-dark-secondary">Question {qIdx + 1} of {questions.length}</span>
          <span className="text-xs text-dark-secondary">Pass: {passingScore}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-amber-400 rounded-full transition-all duration-300"
            style={{ width: `${((qIdx) / questions.length) * 100}%` }} />
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {current?.image_url && (
          <div className="h-36 rounded-xl overflow-hidden bg-gray-100">
            <img src={current.image_url} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <p className="text-lg font-bold text-dark leading-snug">{current?.question}</p>

        {/* Options */}
        <div className="space-y-2.5">
          {(current?.options ?? []).map(opt => {
            const isSelected = selected === opt.id;
            const isThisCorrect = correctId === opt.id;
            let bg = "bg-white border-surface-border hover:border-sprout-green/50";
            let textColor = "text-dark";
            if (revealed) {
              if (isThisCorrect) { bg = "bg-sprout-green/10 border-sprout-green"; textColor = "text-sprout-green font-semibold"; }
              else if (isSelected && !isThisCorrect) { bg = "bg-red-50 border-red-300"; textColor = "text-red-600"; }
              else { bg = "bg-gray-50 border-surface-border"; textColor = "text-dark/50"; }
            } else if (isSelected) {
              bg = "bg-sprout-purple/5 border-sprout-purple";
            }
            return (
              <button
                key={opt.id}
                onClick={() => handleSelect(opt.id)}
                disabled={revealed}
                className={clsx("w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 text-left transition-all", bg)}
              >
                <span className={clsx(
                  "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 text-xs font-bold transition-all",
                  revealed && isThisCorrect ? "bg-sprout-green border-sprout-green text-white" :
                  revealed && isSelected && !isThisCorrect ? "bg-red-400 border-red-400 text-white" :
                  isSelected ? "bg-sprout-purple border-sprout-purple text-white" :
                  "border-surface-border text-dark-secondary"
                )}>
                  {revealed && isThisCorrect ? <Check className="w-3 h-3" /> :
                   revealed && isSelected && !isThisCorrect ? <XCircle className="w-3 h-3" /> :
                   opt.id.toUpperCase()}
                </span>
                <span className={clsx("text-sm", textColor)}>{opt.text}</span>
              </button>
            );
          })}
        </div>

        {/* Feedback */}
        {revealed && current && (
          <div className={clsx("rounded-xl px-4 py-3.5 flex gap-3", isCorrect ? "bg-sprout-green/10" : "bg-red-50")}>
            {isCorrect
              ? <CheckCircle2 className="w-5 h-5 text-sprout-green shrink-0 mt-0.5" />
              : <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />}
            <div>
              <p className={clsx("text-sm font-bold mb-0.5", isCorrect ? "text-sprout-green" : "text-red-600")}>
                {isCorrect ? "Correct!" : "Not quite"}
              </p>
              {current.explanation && (
                <p className="text-sm text-dark/70 leading-relaxed">{current.explanation}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Action button */}
      <div className="px-4 pb-6 pt-3 shrink-0">
        {!revealed ? (
          <button onClick={handleConfirm} disabled={!selected}
            className="w-full py-3 bg-amber-500 text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-amber-600 transition-colors">
            Submit Answer
          </button>
        ) : (
          <button onClick={handleNext} disabled={submitting}
            className="w-full py-3 bg-sprout-green text-white rounded-xl text-sm font-semibold hover:bg-sprout-green/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isLast ? (submitting ? "Submitting…" : "Submit Quiz") : "Next Question"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Video Player ───────────────────────────────────────────────────────────────

function VideoPlayerModule({ module: mod, onComplete }: { module: CourseModule; onComplete: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [watchPct, setWatchPct] = useState(0);
  const [canComplete, setCanComplete] = useState(false);

  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const pct = (v.currentTime / v.duration) * 100;
    setWatchPct(Math.round(pct));
    if (pct >= 80) setCanComplete(true);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {mod.content_url ? (
          <video
            ref={videoRef}
            src={mod.content_url}
            controls
            onTimeUpdate={handleTimeUpdate}
            className="w-full rounded-xl bg-black"
          />
        ) : (
          <div className="h-48 bg-gray-100 rounded-xl flex items-center justify-center">
            <p className="text-sm text-dark-secondary">No video URL configured.</p>
          </div>
        )}
        {!canComplete && (
          <p className="text-xs text-dark-secondary text-center">
            Watch {80 - watchPct}% more to complete this module ({watchPct}% watched)
          </p>
        )}
      </div>
      <div className="px-4 pb-6 pt-3 shrink-0">
        <button onClick={onComplete} disabled={!canComplete}
          className="w-full py-3 bg-sprout-green text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-sprout-green/90 transition-colors flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {canComplete ? "Complete Module" : `Watch ${80 - watchPct}% more…`}
        </button>
      </div>
    </div>
  );
}

// ── PDF Player ─────────────────────────────────────────────────────────────────

function PdfPlayerModule({ module: mod, onComplete }: { module: CourseModule; onComplete: () => void }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden p-4">
        {mod.content_url ? (
          <iframe src={mod.content_url} className="w-full h-full rounded-xl border border-surface-border" title={mod.title} />
        ) : (
          <div className="h-full bg-gray-100 rounded-xl flex items-center justify-center">
            <p className="text-sm text-dark-secondary">No PDF URL configured.</p>
          </div>
        )}
      </div>
      <div className="px-4 pb-6 pt-3 shrink-0">
        <button onClick={onComplete}
          className="w-full py-3 bg-sprout-green text-white rounded-xl text-sm font-semibold hover:bg-sprout-green/90 transition-colors flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Mark as Read
        </button>
      </div>
    </div>
  );
}

// ── Quiz Results Screen ────────────────────────────────────────────────────────

function QuizResultsScreen({
  result, passingScore, maxRetakes, attemptCount,
  onRetry, onNext, hasNext,
}: {
  result: QuizResult;
  passingScore: number;
  maxRetakes: number | null;
  attemptCount: number;
  onRetry: () => void;
  onNext: () => void;
  hasNext: boolean;
}) {
  const canRetry = !result.passed && (maxRetakes === null || attemptCount < maxRetakes);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center gap-6">
      {/* Score circle */}
      <div className={clsx(
        "w-28 h-28 rounded-full flex flex-col items-center justify-center border-4",
        result.passed ? "border-sprout-green bg-sprout-green/10" : "border-red-400 bg-red-50"
      )}>
        <p className={clsx("text-3xl font-black", result.passed ? "text-sprout-green" : "text-red-500")}>
          {result.score}%
        </p>
        <p className="text-[11px] font-semibold text-dark-secondary">Score</p>
      </div>

      {/* Pass / Fail */}
      {result.passed ? (
        <div>
          <p className="text-2xl font-black text-dark">You passed! 🎉</p>
          <p className="text-sm text-dark-secondary mt-1">{result.correct} of {result.total} correct · above {passingScore}% passing score</p>
        </div>
      ) : (
        <div>
          <p className="text-2xl font-black text-dark">Not quite</p>
          <p className="text-sm text-dark-secondary mt-1">{result.correct} of {result.total} correct · need {passingScore}% to pass</p>
          {!canRetry && <p className="text-sm text-red-500 mt-2 font-medium">No retakes remaining. Contact your manager.</p>}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3 w-full max-w-xs">
        {result.passed && hasNext && (
          <button onClick={onNext}
            className="w-full py-3 bg-sprout-green text-white rounded-xl text-sm font-semibold hover:bg-sprout-green/90 transition-colors flex items-center justify-center gap-2">
            Next Module <ChevronRight className="w-4 h-4" />
          </button>
        )}
        {result.passed && !hasNext && (
          <button onClick={onNext}
            className="w-full py-3 bg-sprout-green text-white rounded-xl text-sm font-semibold hover:bg-sprout-green/90 transition-colors flex items-center justify-center gap-2">
            <Trophy className="w-4 h-4" /> View Results
          </button>
        )}
        {canRetry && (
          <button onClick={onRetry}
            className="w-full py-3 border border-surface-border text-dark rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
            <RotateCcw className="w-4 h-4" /> Try Again ({maxRetakes === null ? "∞" : maxRetakes - attemptCount} left)
          </button>
        )}
      </div>
    </div>
  );
}

// ── Course Complete Screen ─────────────────────────────────────────────────────

function CourseCompleteScreen({
  course, enrollment, onBack,
}: {
  course: Course;
  enrollment: CourseEnrollment;
  onBack: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center gap-6">
      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-100 to-yellow-50 border-4 border-amber-300/50 flex items-center justify-center">
        <span className="text-4xl">🎓</span>
      </div>
      <div>
        <p className="text-2xl font-black text-dark">Course Complete!</p>
        <p className="text-base text-dark-secondary mt-2">{course.title}</p>
        {enrollment.score !== null && (
          <p className="text-sm font-semibold text-sprout-green mt-1">{enrollment.score}% final score</p>
        )}
      </div>

      {enrollment.cert_url && (
        <a
          href={enrollment.cert_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-6 py-3 bg-amber-500 text-white rounded-xl text-sm font-semibold hover:bg-amber-600 transition-colors"
        >
          <Award className="w-4 h-4" /> Download Certificate
        </a>
      )}

      <button onClick={onBack}
        className="px-6 py-2.5 border border-surface-border text-dark rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
        Back to My Training
      </button>
    </div>
  );
}

// ── Course Overview Screen ─────────────────────────────────────────────────────

function CourseOverview({
  data, onStartModule,
}: {
  data: EnrollmentData;
  onStartModule: (mod: CourseModule) => void;
}) {
  const { enrollment, course, module_progress } = data;
  const modules = sortedModules(course);
  const completedCount = modules.filter(m => getModuleStatus(m.id, module_progress) === "completed").length;
  const progressPct = modules.length > 0 ? Math.round((completedCount / modules.length) * 100) : 0;
  const totalMins = course.estimated_duration_mins ?? modules.reduce((s, m) => s + (m.estimated_duration_mins ?? 0), 0);

  // Find first incomplete module
  const nextModule = modules.find(m => getModuleStatus(m.id, module_progress) !== "completed");

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Course header */}
      <div className="relative h-40 md:h-52 bg-gradient-to-br from-sprout-green/20 to-sprout-purple/15 flex items-end overflow-hidden">
        {course.thumbnail_url && (
          <img src={course.thumbnail_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
        )}
        <div className="relative px-5 pb-5 w-full">
          <div className="flex items-center gap-2 mb-2">
            {course.is_mandatory && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/90 text-white">Required</span>
            )}
            {course.ai_generated && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/90 text-white">✨ Sidekick</span>
            )}
          </div>
          <h1 className="text-xl font-black text-dark leading-snug">{course.title}</h1>
          <div className="flex items-center gap-3 mt-1 text-xs text-dark/60">
            {totalMins > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{totalMins} min</span>}
            <span>{modules.length} module{modules.length !== 1 ? "s" : ""}</span>
            <span className="font-semibold text-sprout-green">{progressPct}% complete</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-5 py-3 bg-white border-b border-surface-border">
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-sprout-green rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }} />
        </div>
        <p className="text-[11px] text-dark-secondary mt-1">{completedCount} of {modules.length} modules completed</p>
      </div>

      {/* Description */}
      {course.description && (
        <div className="px-5 py-4 bg-white border-b border-surface-border">
          <p className="text-sm text-dark/70 leading-relaxed">{course.description}</p>
        </div>
      )}

      {/* Module list */}
      <div className="px-4 py-4 space-y-2">
        <p className="text-xs font-bold text-dark-secondary uppercase tracking-wide px-1 mb-3">Modules</p>
        {modules.map((mod, idx) => {
          const status = getModuleStatus(mod.id, module_progress);
          const meta = MODULE_META[mod.module_type];
          const Icon = meta.icon;
          const isCompleted = status === "completed";
          const isNext = mod.id === nextModule?.id;
          const slideCount = mod.course_slides?.length ?? 0;
          const questionCount = mod.quiz_questions?.length ?? 0;

          return (
            <button
              key={mod.id}
              onClick={() => onStartModule(mod)}
              className={clsx(
                "w-full flex items-center gap-3 p-4 rounded-xl border text-left transition-all",
                isCompleted
                  ? "bg-sprout-green/5 border-sprout-green/20 hover:border-sprout-green/40"
                  : isNext
                  ? "bg-white border-sprout-purple/30 shadow-sm hover:shadow-md"
                  : "bg-white border-surface-border hover:border-sprout-green/30"
              )}
            >
              {/* Number / check */}
              <div className={clsx(
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                isCompleted ? "bg-sprout-green text-white" : isNext ? "bg-sprout-purple text-white" : "bg-gray-100 text-dark-secondary"
              )}>
                {isCompleted ? <Check className="w-4 h-4" /> : idx + 1}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={clsx("text-sm font-semibold truncate", isCompleted ? "text-dark/60" : "text-dark")}>{mod.title}</p>
                  {isNext && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sprout-purple/10 text-sprout-purple shrink-0">Up next</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={clsx("text-[10px] font-semibold capitalize", meta.color)}>{meta.label}</span>
                  {mod.module_type === "slides" && slideCount > 0 && (
                    <span className="text-[10px] text-dark/40">{slideCount} slides</span>
                  )}
                  {mod.module_type === "quiz" && questionCount > 0 && (
                    <span className="text-[10px] text-dark/40">{questionCount} questions</span>
                  )}
                  {mod.estimated_duration_mins && (
                    <span className="text-[10px] text-dark/40">{mod.estimated_duration_mins} min</span>
                  )}
                </div>
              </div>

              {/* Arrow / check */}
              <div className="shrink-0">
                {isCompleted
                  ? <CheckCircle2 className="w-5 h-5 text-sprout-green" />
                  : <ChevronRight className="w-4 h-4 text-dark/30" />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Start / Continue button */}
      {nextModule && (
        <div className="sticky bottom-0 px-4 pb-6 pt-3 bg-gradient-to-t from-surface-page via-surface-page to-transparent">
          <button
            onClick={() => onStartModule(nextModule)}
            className="w-full py-3.5 bg-sprout-green text-white rounded-xl text-sm font-bold shadow-lg hover:bg-sprout-green/90 transition-colors flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4 fill-current" />
            {enrollment.status === "not_started" ? "Start Course" : "Continue"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Player Page ───────────────────────────────────────────────────────────

export default function CoursePlayerPage() {
  const router = useRouter();
  const params = useParams();
  const enrollmentId = params.enrollmentId as string;

  const [data, setData] = useState<EnrollmentData | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [activeModule, setActiveModule] = useState<CourseModule | null>(null);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [retryKey, setRetryKey] = useState(0); // force remount quiz on retry

  const startTimeRef = useRef<number>(Date.now());

  // Load data
  useEffect(() => {
    getEnrollmentWithProgress(enrollmentId)
      .then(d => {
        setData(d);
        // If course already passed, go straight to complete screen
        if (d.enrollment.status === "passed") {
          setScreen("complete");
        } else {
          setScreen("overview");
        }
      })
      .catch(() => router.push("/dashboard/training"));
  }, [enrollmentId]);

  // Refresh data from API
  const refreshData = useCallback(async () => {
    try {
      const d = await getEnrollmentWithProgress(enrollmentId);
      setData(d);
    } catch { /* ignore */ }
  }, [enrollmentId]);

  // Start playing a module
  async function handleStartModule(mod: CourseModule) {
    setActiveModule(mod);
    startTimeRef.current = Date.now();
    // Mark as in_progress
    try {
      await updateProgress(enrollmentId, mod.id, "in_progress");
    } catch { /* ignore */ }
    setScreen(mod.module_type as Screen);
  }

  // Module completed (slides, video, pdf)
  async function handleModuleComplete() {
    if (!activeModule || !data) return;
    const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000);
    try {
      await updateProgress(enrollmentId, activeModule.id, "completed", timeSpent);
    } catch { /* ignore */ }
    await refreshData();

    const modules = sortedModules(data.course);
    const currentIdx = modules.findIndex(m => m.id === activeModule.id);
    const nextMod = modules[currentIdx + 1];

    if (nextMod) {
      // Auto-advance to next module
      handleStartModule(nextMod);
    } else {
      // All done
      await refreshData();
      setScreen("complete");
    }
  }

  // Quiz passed
  async function handleQuizPass(result: QuizResult) {
    if (!activeModule || !data) return;
    const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000);
    try {
      await updateProgress(enrollmentId, activeModule.id, "completed", timeSpent);
    } catch { /* ignore */ }
    setQuizResult(result);
    await refreshData();
    setScreen("quiz_results");
  }

  // Quiz failed
  function handleQuizFail(result: QuizResult) {
    setQuizResult(result);
    setScreen("quiz_results");
  }

  // Retry quiz
  function handleRetry() {
    setRetryKey(k => k + 1);
    setQuizResult(null);
    if (activeModule) setScreen("quiz");
  }

  // Next from quiz results
  async function handleNextAfterQuiz() {
    if (!data || !activeModule) return;
    const modules = sortedModules(data.course);
    const currentIdx = modules.findIndex(m => m.id === activeModule.id);
    const nextMod = modules[currentIdx + 1];
    if (nextMod) {
      handleStartModule(nextMod);
    } else {
      await refreshData();
      setScreen("complete");
    }
  }

  const isPlaying = ["slides", "quiz", "video", "pdf", "quiz_results"].includes(screen);
  const modules = data ? sortedModules(data.course) : [];
  const activeModuleIdx = activeModule ? modules.findIndex(m => m.id === activeModule.id) : -1;
  const hasNextModule = activeModuleIdx >= 0 && activeModuleIdx < modules.length - 1;

  if (screen === "loading" || !data) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-sprout-green animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] overflow-hidden bg-surface-page">
      {/* ── Top nav bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-surface-border shrink-0">
        <button
          onClick={() => {
            if (isPlaying) {
              setScreen("overview");
              setActiveModule(null);
              refreshData();
            } else {
              router.push("/dashboard/training");
            }
          }}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark-secondary transition-colors"
        >
          {isPlaying ? <ArrowLeft className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
        </button>

        <div className="flex-1 min-w-0">
          {isPlaying && activeModule ? (
            <>
              <p className="text-xs text-dark-secondary truncate">{data.course.title}</p>
              <p className="text-sm font-bold text-dark truncate">{activeModule.title}</p>
            </>
          ) : (
            <p className="text-sm font-bold text-dark truncate">{data.course.title}</p>
          )}
        </div>

        {/* Module navigation arrows when playing */}
        {isPlaying && screen !== "quiz_results" && activeModule && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => { if (activeModuleIdx > 0) handleStartModule(modules[activeModuleIdx - 1]); }}
              disabled={activeModuleIdx <= 0}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-dark-secondary disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-dark-secondary font-medium px-1">
              {activeModuleIdx + 1}/{modules.length}
            </span>
            <button
              onClick={() => { if (hasNextModule) handleStartModule(modules[activeModuleIdx + 1]); }}
              disabled={!hasNextModule}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-dark-secondary disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* ── Screen content ────────────────────────────────────────────────── */}
      {screen === "overview" && (
        <CourseOverview data={data} onStartModule={handleStartModule} />
      )}

      {screen === "slides" && activeModule && (
        <SlidesPlayer module={activeModule} onComplete={handleModuleComplete} />
      )}

      {screen === "quiz" && activeModule && (
        <QuizPlayer
          key={retryKey}
          module={activeModule}
          enrollmentId={enrollmentId}
          passingScore={data.course.passing_score}
          maxRetakes={data.course.max_retakes}
          attemptCount={data.enrollment.attempt_count}
          onComplete={handleQuizPass}
          onFail={handleQuizFail}
        />
      )}

      {screen === "video" && activeModule && (
        <VideoPlayerModule module={activeModule} onComplete={handleModuleComplete} />
      )}

      {screen === "pdf" && activeModule && (
        <PdfPlayerModule module={activeModule} onComplete={handleModuleComplete} />
      )}

      {screen === "quiz_results" && quizResult && activeModule && (
        <QuizResultsScreen
          result={quizResult}
          passingScore={data.course.passing_score}
          maxRetakes={data.course.max_retakes}
          attemptCount={data.enrollment.attempt_count}
          onRetry={handleRetry}
          onNext={handleNextAfterQuiz}
          hasNext={hasNextModule || true}
        />
      )}

      {screen === "complete" && (
        <CourseCompleteScreen
          course={data.course}
          enrollment={data.enrollment}
          onBack={() => router.push("/dashboard/training")}
        />
      )}
    </div>
  );
}
