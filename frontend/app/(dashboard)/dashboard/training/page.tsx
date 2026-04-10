"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  GraduationCap, BookOpen, CheckCircle2, Clock, Trophy, Plus,
  ChevronRight, Sparkles, AlertCircle, Search, Pencil, Trash2,
  Send, UserPlus, Upload, FileText, Loader2, Globe, X, ChevronDown,
  Brain, TrendingUp, AlertTriangle,
} from "lucide-react";
import {
  getMyEnrollments, listManagedCourses, getLmsAnalytics,
  publishCourse, deleteCourse, translateCourse, getKnowledgeGaps, getLearningPath,
  listPublishedCourses,
  type Course, type CourseEnrollment, type LmsAnalytics,
} from "@/services/lms";
import { EnrollStaffModal } from "./courses/_components/EnrollStaffModal";
import clsx from "clsx";
import { useTranslation } from "@/lib/i18n";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// Status styling
const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  not_started: { bg: "bg-gray-100",          text: "text-gray-600",       label: "Not Started" },
  in_progress:  { bg: "bg-blue-100",          text: "text-blue-700",       label: "In Progress" },
  passed:       { bg: "bg-sprout-green/10",   text: "text-sprout-green",   label: "Passed" },
  failed:       { bg: "bg-red-100",           text: "text-red-600",        label: "Failed" },
};

// ── Knowledge gap severity styles ─────────────────────────────────────────────
const GAP_SEVERITY: Record<string, { bg: string; text: string; border: string; icon: typeof AlertTriangle }> = {
  high:   { bg: "bg-red-50",    text: "text-red-600",    border: "border-red-100",   icon: AlertTriangle },
  medium: { bg: "bg-amber-50",  text: "text-amber-600",  border: "border-amber-100", icon: AlertCircle },
  low:    { bg: "bg-emerald-50",text: "text-emerald-600",border: "border-emerald-100",icon: CheckCircle2 },
};

// ── Staff: My Training ────────────────────────────────────────────────────────
function MyTraining({ name, userRole }: { name: string; userRole: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([]);
  const [loading, setLoading] = useState(true);

  // Knowledge gaps state
  const [gaps, setGaps] = useState<Array<{ topic: string; description: string; severity: "low" | "medium" | "high"; recommended_action: string }>>([]);
  const [gapsLoading, setGapsLoading] = useState(false);
  const [gapsError, setGapsError] = useState("");
  const [gapsDismissed, setGapsDismissed] = useState(false);

  // Learning path state
  const [learningPath, setLearningPath] = useState<Array<{ course_id: string; reason: string; priority: number }>>([]);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathError, setPathError] = useState("");
  const [pathDismissed, setPathDismissed] = useState(false);
  const [availableCourses, setAvailableCourses] = useState<Course[]>([]);

  useEffect(() => {
    getMyEnrollments().then(data => {
      setEnrollments(data);

      // Fetch available courses for learning path
      listPublishedCourses({ page_size: 50 })
        .then(res => setAvailableCourses(res.items))
        .catch(() => {});

      // Auto-trigger learning path if we have enrollments
      if (data.length > 0) {
        const completed = data.filter(e => e.status === "passed").map(e => e.courses?.title ?? "");
        const scores: Record<string, number> = {};
        data.filter(e => e.score !== null).forEach(e => {
          if (e.courses?.title && e.score !== null) scores[e.courses.title] = e.score!;
        });
        setPathLoading(true);
        listPublishedCourses({ page_size: 50 })
          .then(res => {
            setAvailableCourses(res.items);
            return getLearningPath({
              role: userRole,
              completed_courses: completed.filter(Boolean),
              quiz_scores: scores,
              available_courses: res.items.map(c => ({ id: c.id, title: c.title, type: c.is_mandatory ? "mandatory" : "elective" })),
            });
          })
          .then(res => setLearningPath(res.recommended))
          .catch(() => setPathError("Could not load learning path."))
          .finally(() => setPathLoading(false));
      }
    }).catch(() => setEnrollments([]))
      .finally(() => setLoading(false));
  }, [userRole]);

  function analyseGaps() {
    // Collect wrong answers from failed enrollments (use course titles as proxies since detail data isn't in the list)
    const failedEnrollments = enrollments.filter(e => e.status === "failed" && e.courses);
    if (failedEnrollments.length === 0) {
      setGaps([]);
      return;
    }
    setGapsLoading(true);
    setGapsError("");
    // Build synthetic wrong-answer entries based on failed courses and score
    const wrongAnswers = failedEnrollments.map(e => ({
      question: `Quiz for: ${e.courses?.title ?? "Unknown course"}`,
      chosen: "Incorrect answer",
      correct: "Correct answer",
      course_title: e.courses?.title ?? "Unknown",
    }));
    getKnowledgeGaps({ wrong_answers: wrongAnswers })
      .then(res => setGaps(res.gaps))
      .catch(e => setGapsError((e as Error).message || "Analysis failed. Try again."))
      .finally(() => setGapsLoading(false));
  }

  const inProgress = enrollments.filter(e => e.status === "in_progress");
  const notStarted = enrollments.filter(e => e.status === "not_started");
  const passed     = enrollments.filter(e => e.status === "passed");
  const failed     = enrollments.filter(e => e.status === "failed");

  // Map course_id to enrollment for linking recommended courses
  const enrollmentByCourseId: Record<string, CourseEnrollment> = {};
  enrollments.forEach(e => { if (e.course_id) enrollmentByCourseId[e.course_id] = e; });

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* Hero */}
      <div className="bg-white rounded-xl border border-surface-border px-6 py-5">
        <p className="text-xl font-bold text-dark">{t("training.staffTitle")} 🎓</p>
        <p className="text-sm text-dark-secondary mt-1">
          {loading ? t("common.loading") : enrollments.length === 0
            ? "No courses assigned yet. Check back soon!"
            : `You have ${enrollments.length} course${enrollments.length !== 1 ? "s" : ""} — ${passed.length} completed.`}
        </p>
      </div>

      {/* Stat row */}
      {!loading && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: t("training.statInProgress"), value: inProgress.length, icon: Clock,         bg: "bg-blue-50",          color: "text-blue-600" },
            { label: t("training.statNotStarted"), value: notStarted.length, icon: BookOpen,      bg: "bg-gray-100",         color: "text-gray-600" },
            { label: t("training.statCompleted"),  value: passed.length,     icon: CheckCircle2,  bg: "bg-sprout-green/10",  color: "text-sprout-green" },
          ].map(({ label, value, icon: Icon, bg, color }) => (
            <div key={label} className="bg-white rounded-xl border border-surface-border p-4 flex flex-col gap-2">
              <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center", bg)}>
                <Icon className={clsx("w-4 h-4", color)} />
              </div>
              <p className="text-xl font-bold text-dark">{value}</p>
              <p className="text-xs text-dark-secondary">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── AI Learning Path ─────────────────────────────────────────────────── */}
      {!loading && !pathDismissed && enrollments.length > 0 && (
        <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4 text-violet-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold text-dark">Your Learning Path</p>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-violet-100 to-purple-100 text-violet-600">✨ AI</span>
              </div>
              <p className="text-xs text-dark-secondary">Personalised recommendations based on your progress</p>
            </div>
            <button onClick={() => setPathDismissed(true)} className="p-1 rounded-lg hover:bg-gray-100 text-dark/30 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-4">
            {pathLoading ? (
              <div className="flex items-center gap-3 py-4 px-2">
                <Loader2 className="w-4 h-4 text-violet-500 animate-spin shrink-0" />
                <p className="text-sm text-dark-secondary">Building your personalised learning path…</p>
              </div>
            ) : pathError ? (
              <div className="flex items-center gap-3 text-sm text-dark-secondary py-2 px-1">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{pathError}</span>
                <button onClick={() => setPathError("")} className="ml-auto text-xs text-sprout-purple hover:underline">Retry</button>
              </div>
            ) : learningPath.length === 0 ? (
              <p className="text-sm text-dark-secondary text-center py-4">No recommendations yet — keep completing courses to get personalised suggestions.</p>
            ) : (
              <div className="space-y-2">
                {learningPath.slice(0, 5).map((rec, i) => {
                  const course = availableCourses.find(c => c.id === rec.course_id);
                  const enrollment = enrollmentByCourseId[rec.course_id];
                  const title = course?.title ?? "Course";
                  return (
                    <button
                      key={rec.course_id}
                      onClick={() => enrollment ? router.push(`/dashboard/training/learn/${enrollment.id}`) : undefined}
                      className={clsx(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all",
                        enrollment ? "hover:border-sprout-purple/30 hover:bg-violet-50/30 border-surface-border" : "border-surface-border cursor-default"
                      )}
                    >
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-violet-600">{i + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-dark truncate">{title}</p>
                        <p className="text-xs text-dark-secondary truncate">{rec.reason}</p>
                      </div>
                      {enrollment && <ChevronRight className="w-3.5 h-3.5 text-dark/30 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Course list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-xl border border-surface-border animate-pulse" />)}
        </div>
      ) : enrollments.length === 0 ? (
        <div className="bg-white rounded-xl border border-surface-border p-12 text-center">
          <GraduationCap className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-dark-secondary">No courses assigned yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {inProgress.length > 0 && (
            <>
              <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wide px-1">{t("training.continueLearning")}</p>
              {inProgress.map(e => <CourseCard key={e.id} enrollment={e} onClick={() => router.push(`/dashboard/training/learn/${e.id}`)} />)}
            </>
          )}
          {notStarted.length > 0 && (
            <>
              <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wide px-1 mt-2">{t("training.assigned")}</p>
              {notStarted.map(e => <CourseCard key={e.id} enrollment={e} onClick={() => router.push(`/dashboard/training/learn/${e.id}`)} />)}
            </>
          )}
          {passed.length > 0 && (
            <>
              <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wide px-1 mt-2">{t("training.statCompleted")}</p>
              {passed.map(e => <CourseCard key={e.id} enrollment={e} onClick={() => router.push(`/dashboard/training/learn/${e.id}`)} />)}
            </>
          )}
          {failed.length > 0 && (
            <>
              <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wide px-1 mt-2">{t("training.needsRetry")}</p>
              {failed.map(e => <CourseCard key={e.id} enrollment={e} onClick={() => router.push(`/dashboard/training/learn/${e.id}`)} />)}
            </>
          )}
        </div>
      )}

      {/* ── Knowledge Gaps ───────────────────────────────────────────────────── */}
      {!loading && !gapsDismissed && enrollments.length > 0 && (
        <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-red-50 to-amber-50 flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 text-amber-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold text-dark">Knowledge Gaps</p>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-violet-100 to-purple-100 text-violet-600">✨ AI</span>
              </div>
              <p className="text-xs text-dark-secondary">Areas where you may need more practice</p>
            </div>
            <button onClick={() => setGapsDismissed(true)} className="p-1 rounded-lg hover:bg-gray-100 text-dark/30 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-4">
            {gapsLoading ? (
              <div className="flex items-center gap-3 py-4 px-2">
                <Loader2 className="w-4 h-4 text-amber-500 animate-spin shrink-0" />
                <p className="text-sm text-dark-secondary">Analysing your quiz results…</p>
              </div>
            ) : gapsError ? (
              <div className="flex items-center gap-3 text-sm text-dark-secondary py-2 px-1">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{gapsError}</span>
                <button onClick={() => { setGapsError(""); analyseGaps(); }} className="ml-auto text-xs text-sprout-purple hover:underline">Retry</button>
              </div>
            ) : gaps.length > 0 ? (
              <div className="space-y-2">
                {gaps.map((gap, i) => {
                  const s = GAP_SEVERITY[gap.severity] ?? GAP_SEVERITY.low;
                  const SIcon = s.icon;
                  return (
                    <div key={i} className={clsx("flex gap-3 p-3 rounded-xl border", s.bg, s.border)}>
                      <SIcon className={clsx("w-4 h-4 mt-0.5 shrink-0", s.text)} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className={clsx("text-xs font-bold", s.text)}>{gap.topic}</span>
                          <span className={clsx("text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border", s.bg, s.border, s.text)}>
                            {gap.severity}
                          </span>
                        </div>
                        <p className="text-xs text-dark-secondary leading-relaxed">{gap.description}</p>
                        {gap.recommended_action && (
                          <p className="text-[11px] text-dark/60 mt-1">
                            <span className="font-semibold">Tip: </span>{gap.recommended_action}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-4">
                {failed.length === 0 ? (
                  <p className="text-sm text-dark-secondary">No failed courses — great work! Gaps appear after a failed quiz attempt.</p>
                ) : (
                  <button
                    onClick={analyseGaps}
                    className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl text-sm font-semibold text-violet-700 border-2 border-transparent transition-all hover:shadow-sm"
                    style={{ background: "linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box" }}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                    Analyse my gaps
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CourseCard({ enrollment, onClick }: { enrollment: CourseEnrollment; onClick: () => void }) {
  const course = enrollment.courses;
  if (!course) return null;
  const s       = STATUS_STYLES[enrollment.status] ?? STATUS_STYLES.not_started;
  const modules = course.course_modules ?? [];
  const totalMins = course.estimated_duration_mins;

  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-xl border border-surface-border p-4 flex items-center gap-4 text-left hover:border-sprout-purple/40 hover:shadow-sm transition-all"
    >
      <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-sprout-green/20 to-sprout-purple/10 flex items-center justify-center shrink-0 overflow-hidden">
        {course.thumbnail_url
          ? <img src={course.thumbnail_url} alt="" className="w-full h-full object-cover" />
          : <GraduationCap className="w-7 h-7 text-sprout-green/60" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={clsx("text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide", s.bg, s.text)}>{s.label}</span>
          {course.is_mandatory  && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide bg-red-100 text-red-600">Required</span>}
          {course.ai_generated  && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide bg-gradient-to-r from-violet-100 to-purple-100 text-violet-600">✨ Sidekick</span>}
        </div>
        <p className="text-sm font-semibold text-dark truncate">{course.title}</p>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-dark-secondary">
          {totalMins && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{totalMins} min</span>}
          <span>{modules.length} module{modules.length !== 1 ? "s" : ""}</span>
          {enrollment.score !== null && <span className="font-medium text-dark">{enrollment.score}% score</span>}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-dark/30 shrink-0" />
    </button>
  );
}

// ── Admin/Manager: Training Overview (full course management) ─────────────────
function TrainingOverview() {
  const { t } = useTranslation();
  const router = useRouter();

  // Analytics
  const [analytics, setAnalytics]   = useState<LmsAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Courses
  const [courses, setCourses]       = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [search, setSearch]         = useState("");
  const [filter, setFilter]         = useState<"all" | "published" | "draft" | "archived">("all");
  const [publishing, setPublishing] = useState<string | null>(null);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [enrollModal, setEnrollModal] = useState<Course | null>(null);

  // "Just created" highlight
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Translation
  const [translateCourseTarget, setTranslateCourseTarget] = useState<Course | null>(null);
  const [translateLang, setTranslateLang] = useState("Filipino");
  const [translating, setTranslating] = useState(false);
  const [translateSuccess, setTranslateSuccess] = useState<{ courseTitle: string; lang: string } | null>(null);

  // Load analytics once
  useEffect(() => {
    getLmsAnalytics()
      .then(setAnalytics)
      .catch(() => setAnalytics(null))
      .finally(() => setAnalyticsLoading(false));
  }, []);

  // Load courses whenever search changes
  const loadCourses = useCallback(() => {
    setCoursesLoading(true);
    listManagedCourses({ search: search || undefined })
      .then(r => setCourses(r.items))
      .catch(() => setCourses([]))
      .finally(() => setCoursesLoading(false));
  }, [search]);

  useEffect(() => { loadCourses(); }, [loadCourses]);

  // Pick up just-created ID from sessionStorage (set by new/page.tsx before redirect)
  useEffect(() => {
    try {
      const id = sessionStorage.getItem("justCreatedCourseId");
      if (id) {
        sessionStorage.removeItem("justCreatedCourseId");
        setJustCreatedId(id);
        highlightTimer.current = setTimeout(() => setJustCreatedId(null), 4000);
      }
    } catch { /* ignore */ }
    return () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); };
  }, []);

  const filtered = courses.filter(c => {
    if (filter === "published") return c.is_published;
    if (filter === "draft")     return !c.is_published && !c.was_published;
    if (filter === "archived")  return !c.is_published && c.was_published;
    return true;
  });

  async function handlePublish(id: string) {
    setPublishing(id);
    try { await publishCourse(id); loadCourses(); } finally { setPublishing(null); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this course?")) return;
    setDeleting(id);
    try { await deleteCourse(id); loadCourses(); } finally { setDeleting(null); }
  }

  async function handleTranslate() {
    if (!translateCourseTarget) return;
    setTranslating(true);
    try {
      await translateCourse({
        course_id: translateCourseTarget.id,
        target_language: translateLang,
        content: {
          title: translateCourseTarget.title,
          modules: (translateCourseTarget.course_modules ?? []).map(m => ({
            title: m.title,
            slides: (m.course_slides ?? []).map(s => ({ title: s.title, body: s.body })),
            quiz_questions: (m.quiz_questions ?? []).map(q => ({
              question: q.question,
              options: q.options.map(o => o.text),
              explanation: q.explanation,
            })),
          })),
        },
      });
      setTranslateSuccess({ courseTitle: translateCourseTarget.title, lang: translateLang });
      setTranslateCourseTarget(null);
      loadCourses();
    } catch (e) {
      alert("Translation failed: " + (e as Error).message);
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sprout-green/10 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-sprout-green" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">{t("training.pageTitle")}</h1>
            <p className="text-sm text-dark-secondary">{t("training.pageSubtitle")}</p>
          </div>
        </div>
        <button
          onClick={() => router.push("/dashboard/training/courses/new")}
          className="flex items-center gap-2 px-4 py-2.5 bg-sprout-green text-white rounded-xl text-sm font-semibold hover:bg-sprout-green/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Course
        </button>
      </div>

      {/* ── Status cards ── */}
      {analyticsLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-28 bg-white rounded-xl border border-surface-border animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: t("training.statTotalEnrollments"), value: analytics?.total_enrollments ?? 0,     icon: BookOpen,     bg: "bg-sprout-purple/10", color: "text-sprout-purple" },
            { label: t("training.statCompletionRate"),   value: `${analytics?.completion_rate ?? 0}%`, icon: CheckCircle2, bg: "bg-sprout-green/10",  color: "text-sprout-green" },
            { label: t("training.statInProgress"),       value: analytics?.in_progress ?? 0,           icon: Clock,        bg: "bg-blue-50",          color: "text-blue-600" },
            { label: t("training.statFailed"),           value: analytics?.failed ?? 0,                icon: AlertCircle,  bg: "bg-red-50",           color: "text-red-500" },
          ].map(({ label, value, icon: Icon, bg, color }) => (
            <div key={label} className="bg-white rounded-xl border border-surface-border p-4 flex flex-col gap-2">
              <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center", bg)}>
                <Icon className={clsx("w-4 h-4", color)} />
              </div>
              <p className="text-xl md:text-2xl font-bold text-dark">{value}</p>
              <p className="text-xs text-dark-secondary">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Search + Filters ── */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-48 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search courses…"
            className="w-full pl-9 pr-4 py-2 border border-surface-border rounded-xl text-sm bg-white focus:outline-none focus:border-sprout-green transition-colors"
          />
        </div>
        <div className="flex gap-1 bg-white border border-surface-border rounded-xl p-1">
          {(["all", "published", "draft", "archived"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx("px-3 py-1 rounded-lg text-xs font-medium transition-colors capitalize",
                filter === f ? "bg-sprout-green text-white" : "text-dark-secondary hover:bg-gray-50")}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* ── Empty state — no courses at all ── */}
      {!coursesLoading && courses.length === 0 && filter === "all" && (
        <div className="bg-white rounded-xl border border-surface-border p-8 md:p-12">
          <div className="max-w-xl mx-auto text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-sprout-green/10 flex items-center justify-center mx-auto mb-4">
              <GraduationCap className="w-7 h-7 text-sprout-green" />
            </div>
            <h2 className="text-xl font-bold text-dark mb-2">No courses yet</h2>
            <p className="text-sm text-dark-secondary">Create your first training course — build it manually, let AI write it, or upload existing content.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            <button onClick={() => router.push("/dashboard/training/courses/new?mode=sidekick")}
              className="flex flex-col gap-3 p-5 rounded-2xl border-2 border-transparent text-left transition-all hover:shadow-md"
              style={{ background: "linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box" }}>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <p className="font-bold text-sm bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Generate with Sidekick</p>
                <p className="text-xs text-dark-secondary mt-1">Type a topic or paste a URL — AI builds the full course</p>
              </div>
            </button>
            <button onClick={() => router.push("/dashboard/training/courses/new?mode=upload")}
              className="flex flex-col gap-3 p-5 rounded-2xl border-2 border-surface-border text-left hover:border-sprout-purple/40 hover:shadow-sm transition-all">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <Upload className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="font-bold text-sm text-dark">Upload Content</p>
                <p className="text-xs text-dark-secondary mt-1">Upload a PDF, doc, or video — AI turns it into a course</p>
              </div>
            </button>
            <button onClick={() => router.push("/dashboard/training/courses/new?mode=blank")}
              className="flex flex-col gap-3 p-5 rounded-2xl border-2 border-surface-border text-left hover:border-sprout-purple/40 hover:shadow-sm transition-all">
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
      )}

      {/* ── Course table ── */}
      {(coursesLoading || courses.length > 0 || filter !== "all") && (
        <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
          {coursesLoading ? (
            <div className="divide-y divide-surface-border">
              {[1,2,3,4].map(i => <div key={i} className="h-20 animate-pulse bg-gray-50/50 m-3 rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <GraduationCap className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-dark-secondary mb-1">No courses found</p>
              <button onClick={() => router.push("/dashboard/training/courses/new")}
                className="text-sm text-sprout-purple hover:underline font-medium">Create one →</button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50/50 border-b border-surface-border">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-dark-secondary">Course</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-secondary hidden md:table-cell">Modules</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-secondary hidden md:table-cell">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-secondary">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-dark-secondary">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {filtered.map(course => (
                  <tr key={course.id} className={clsx(
                    "transition-colors duration-700",
                    justCreatedId === course.id ? "bg-violet-50" : "hover:bg-gray-50/50"
                  )}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-sprout-green/10 flex items-center justify-center shrink-0">
                          <GraduationCap className="w-4 h-4 text-sprout-green" />
                        </div>
                        <div>
                          <p className="font-medium text-dark">{course.title}</p>
                          {course.ai_generated && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-gradient-to-r from-violet-100 to-purple-100 text-violet-600">✨ Sidekick</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell">
                      <span className="text-dark-secondary">{(course.course_modules ?? []).length}</span>
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell text-dark-secondary">
                      {course.estimated_duration_mins ? `${course.estimated_duration_mins} min` : "—"}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={clsx("text-[10px] font-bold px-2 py-0.5 rounded-full",
                        course.is_published
                          ? "bg-sprout-green/10 text-sprout-green"
                          : course.was_published
                            ? "bg-amber-100 text-amber-600"
                            : "bg-gray-100 text-gray-500")}>
                        {course.is_published ? "Published" : course.was_published ? "Archived" : "Draft"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        {course.is_published && (
                          <button onClick={() => setEnrollModal(course)}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors" title="Assign Course">
                            <UserPlus className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => { setTranslateCourseTarget(course); setTranslateLang("Filipino"); }}
                          className="p-1.5 rounded-lg hover:bg-violet-50 text-violet-500 transition-colors"
                          title="Translate course"
                        >
                          <Globe className="w-3.5 h-3.5" />
                        </button>
                        {!course.is_published && !course.was_published && (
                          <button onClick={() => handlePublish(course.id)} disabled={publishing === course.id}
                            className="p-1.5 rounded-lg hover:bg-sprout-green/10 text-sprout-green transition-colors disabled:opacity-40" title="Publish">
                            {publishing === course.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Send className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        <button onClick={() => router.push(`/dashboard/training/courses/${course.id}`)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark-secondary transition-colors" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(course.id)} disabled={deleting === course.id}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors disabled:opacity-40" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {enrollModal && (
        <EnrollStaffModal
          course={enrollModal}
          onClose={() => setEnrollModal(null)}
          onDone={loadCourses}
        />
      )}

      {/* ── Translate modal ──────────────────────────────────────────────────── */}
      {translateCourseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center shrink-0">
                <Globe className="w-4 h-4 text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-dark">Translate Course</h2>
                <p className="text-xs text-dark-secondary mt-0.5 truncate">&quot;{translateCourseTarget.title}&quot;</p>
              </div>
              <button onClick={() => setTranslateCourseTarget(null)} className="p-1 rounded-lg hover:bg-gray-100 text-dark/30 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-dark-secondary uppercase tracking-wide mb-1.5 block">Target Language</label>
              <div className="relative">
                <select
                  value={translateLang}
                  onChange={e => setTranslateLang(e.target.value)}
                  className="w-full px-3 py-2.5 border border-surface-border rounded-xl text-sm bg-white focus:outline-none focus:border-violet-400 transition-colors appearance-none pr-8"
                >
                  {["English", "Filipino", "Spanish", "Mandarin", "Arabic", "Hindi", "Indonesian", "Thai"].map(lang => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark/40 pointer-events-none" />
              </div>
            </div>

            <p className="text-xs text-dark-secondary bg-violet-50 rounded-xl px-3 py-2.5 leading-relaxed">
              A translated copy of this course will be created. The original remains unchanged.
            </p>

            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setTranslateCourseTarget(null)}
                className="px-4 py-2 border border-surface-border rounded-xl text-sm font-medium text-dark hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleTranslate} disabled={translating}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                style={{ background: "linear-gradient(135deg, #9333EA 0%, #6366F1 100%)" }}>
                {translating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {translating ? "Translating…" : "Translate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Translation success toast ──────────────────────────────────────── */}
      {translateSuccess && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-white border border-surface-border rounded-2xl shadow-xl px-5 py-3.5 max-w-sm">
          <div className="w-8 h-8 rounded-xl bg-sprout-green/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4 text-sprout-green" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-dark">Translation complete</p>
            <p className="text-xs text-dark-secondary truncate">New course created in {translateSuccess.lang}</p>
          </div>
          <button onClick={() => setTranslateSuccess(null)} className="p-1 rounded-lg hover:bg-gray-100 text-dark/30 transition-colors shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TrainingPage() {
  const { user: currentUser } = useCurrentUser();
  const [role, setRole]   = useState("staff");
  const [name, setName]   = useState("there");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    setRole(currentUser.role ?? "staff");
    setName(currentUser.app_metadata?.full_name ?? currentUser.email ?? "there");
    setReady(true);
  }, [currentUser]);

  if (!ready) return (
    <div className="p-4 md:p-6 flex flex-col gap-4">
      <div className="h-20 bg-white rounded-xl border border-surface-border animate-pulse" />
      <div className="grid grid-cols-3 gap-3">
        {[1,2,3].map(i => <div key={i} className="h-24 bg-white rounded-xl border border-surface-border animate-pulse" />)}
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-6">
      {role === "staff" ? <MyTraining name={name} userRole={role} /> : <TrainingOverview />}
    </div>
  );
}
