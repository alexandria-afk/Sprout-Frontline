"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  GraduationCap, BookOpen, CheckCircle2, Clock, Trophy, Plus,
  ChevronRight, Sparkles, AlertCircle, Search, Pencil, Trash2,
  Send, UserPlus, Upload, FileText, Loader2,
} from "lucide-react";
import { createClient } from "@/services/supabase/client";
import {
  getMyEnrollments, listManagedCourses, getLmsAnalytics,
  publishCourse, deleteCourse,
  type Course, type CourseEnrollment, type LmsAnalytics,
} from "@/services/lms";
import { EnrollStaffModal } from "./courses/_components/EnrollStaffModal";
import clsx from "clsx";

// Status styling
const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  not_started: { bg: "bg-gray-100",          text: "text-gray-600",       label: "Not Started" },
  in_progress:  { bg: "bg-blue-100",          text: "text-blue-700",       label: "In Progress" },
  passed:       { bg: "bg-sprout-green/10",   text: "text-sprout-green",   label: "Passed" },
  failed:       { bg: "bg-red-100",           text: "text-red-600",        label: "Failed" },
};

// ── Staff: My Training ────────────────────────────────────────────────────────
function MyTraining({ name }: { name: string }) {
  const router = useRouter();
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMyEnrollments().then(setEnrollments).catch(() => setEnrollments([])).finally(() => setLoading(false));
  }, []);

  const inProgress = enrollments.filter(e => e.status === "in_progress");
  const notStarted = enrollments.filter(e => e.status === "not_started");
  const passed     = enrollments.filter(e => e.status === "passed");

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* Hero */}
      <div className="bg-white rounded-xl border border-surface-border px-6 py-5">
        <p className="text-xl font-bold text-dark">My Training 🎓</p>
        <p className="text-sm text-dark-secondary mt-1">
          {loading ? "Loading your courses…" : enrollments.length === 0
            ? "No courses assigned yet. Check back soon!"
            : `You have ${enrollments.length} course${enrollments.length !== 1 ? "s" : ""} — ${passed.length} completed.`}
        </p>
      </div>

      {/* Stat row */}
      {!loading && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "In Progress", value: inProgress.length, icon: Clock,         bg: "bg-blue-50",          color: "text-blue-600" },
            { label: "Not Started", value: notStarted.length, icon: BookOpen,      bg: "bg-gray-100",         color: "text-gray-600" },
            { label: "Completed",   value: passed.length,     icon: CheckCircle2,  bg: "bg-sprout-green/10",  color: "text-sprout-green" },
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
              <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wide px-1">Continue Learning</p>
              {inProgress.map(e => <CourseCard key={e.id} enrollment={e} onClick={() => router.push(`/dashboard/training/learn/${e.id}`)} />)}
            </>
          )}
          {notStarted.length > 0 && (
            <>
              <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wide px-1 mt-2">Assigned</p>
              {notStarted.map(e => <CourseCard key={e.id} enrollment={e} onClick={() => router.push(`/dashboard/training/learn/${e.id}`)} />)}
            </>
          )}
          {passed.length > 0 && (
            <>
              <p className="text-xs font-semibold text-dark-secondary uppercase tracking-wide px-1 mt-2">Completed</p>
              {passed.map(e => <CourseCard key={e.id} enrollment={e} onClick={() => router.push(`/dashboard/training/learn/${e.id}`)} />)}
            </>
          )}
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

  return (
    <div className="flex flex-col gap-4 md:gap-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sprout-green/10 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-sprout-green" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Training</h1>
            <p className="text-sm text-dark-secondary">Manage courses and track team progress</p>
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
            { label: "Total Enrollments", value: analytics?.total_enrollments ?? 0,   icon: BookOpen,     bg: "bg-sprout-purple/10", color: "text-sprout-purple" },
            { label: "Completion Rate",   value: `${analytics?.completion_rate ?? 0}%`, icon: CheckCircle2, bg: "bg-sprout-green/10",  color: "text-sprout-green" },
            { label: "In Progress",       value: analytics?.in_progress ?? 0,          icon: Clock,        bg: "bg-blue-50",          color: "text-blue-600" },
            { label: "Failed",            value: analytics?.failed ?? 0,               icon: AlertCircle,  bg: "bg-red-50",           color: "text-red-500" },
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
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TrainingPage() {
  const [role, setRole]   = useState("staff");
  const [name, setName]   = useState("there");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (user) {
        setRole((user.app_metadata?.role as string) ?? "staff");
        setName(
          (user.app_metadata?.full_name as string) ||
          (user.user_metadata?.full_name as string) ||
          user.email?.split("@")[0] || "there"
        );
      }
      setReady(true);
    });
  }, []);

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
      {role === "staff" ? <MyTraining name={name} /> : <TrainingOverview />}
    </div>
  );
}
