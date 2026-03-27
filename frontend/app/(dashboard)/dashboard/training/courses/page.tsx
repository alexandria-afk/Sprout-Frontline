"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Plus, Search, Pencil, Trash2, Send, Loader2, UserPlus, Sparkles, Upload, FileText } from "lucide-react";
import { listManagedCourses, publishCourse, deleteCourse, type Course } from "@/services/lms";
import { EnrollStaffModal } from "./_components/EnrollStaffModal";
import clsx from "clsx";

export default function CoursesPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "published" | "draft" | "archived">("all");
  const [publishing, setPublishing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [enrollModal, setEnrollModal] = useState<Course | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listManagedCourses({ search: search || undefined })
      .then(r => setCourses(r.items))
      .catch(() => setCourses([]))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => { load(); }, [load]);

  // Detect just-created course from sessionStorage (set by new/page.tsx before redirect)
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
    if (filter === "draft") return !c.is_published && !c.was_published;
    if (filter === "archived") return !c.is_published && c.was_published;
    return true;
  });

  async function handlePublish(id: string) {
    setPublishing(id);
    try { await publishCourse(id); load(); } finally { setPublishing(null); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this course?")) return;
    setDeleting(id);
    try { await deleteCourse(id); load(); } finally { setDeleting(null); }
  }

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4 md:gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sprout-green/10 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-sprout-green" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Courses</h1>
            <p className="text-sm text-dark-secondary">Manage all training courses</p>
          </div>
        </div>
        <button
          onClick={() => router.push("/dashboard/training/courses/new")}
          className="flex items-center gap-2 px-4 py-2.5 bg-sprout-green text-white rounded-xl text-sm font-semibold hover:bg-sprout-green/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Course
        </button>
      </div>

      {/* Filters */}
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

      {/* Empty state — no courses at all */}
      {!loading && courses.length === 0 && filter === "all" && (
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

      {/* Course table */}
      {(loading || courses.length > 0 || filter !== "all") && (
        <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
          {loading ? (
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
                    justCreatedId === course.id
                      ? "bg-violet-50"
                      : "hover:bg-gray-50/50"
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
                            {publishing === course.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
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
          onDone={load}
        />
      )}
    </div>
  );
}
