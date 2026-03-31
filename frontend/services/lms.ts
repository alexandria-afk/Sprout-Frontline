import { apiFetch } from "./api/client";

export interface Course {
  id: string;
  organisation_id: string;
  created_by: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  estimated_duration_mins: number | null;
  passing_score: number;
  max_retakes: number | null;
  cert_validity_days: number | null;
  is_mandatory: boolean;
  target_roles: string[];
  target_location_ids: string[];
  is_published: boolean;
  was_published: boolean;
  is_active: boolean;
  ai_generated: boolean;
  language: string;
  version: number;
  parent_course_id: string | null;
  created_at: string;
  updated_at: string;
  course_modules?: CourseModule[];
  enrollment?: CourseEnrollment | null;
}

export interface CourseModule {
  id: string;
  course_id: string;
  title: string;
  module_type: "slides" | "video" | "pdf" | "quiz";
  content_url: string | null;
  display_order: number;
  is_required: boolean;
  estimated_duration_mins: number | null;
  course_slides?: CourseSlide[];
  quiz_questions?: QuizQuestion[];
}

export interface CourseSlide {
  id: string;
  module_id: string;
  title: string | null;
  body: string | null;
  image_url: string | null;
  display_order: number;
}

export interface QuizOption {
  id: string;
  text: string;
  is_correct: boolean;
}

export interface QuizQuestion {
  id: string;
  module_id: string;
  question: string;
  question_type: "multiple_choice" | "true_false" | "image_based";
  image_url: string | null;
  options: QuizOption[];
  explanation: string | null;
  display_order: number;
}

export interface CourseEnrollment {
  id: string;
  course_id: string;
  user_id: string;
  status: "not_started" | "in_progress" | "passed" | "failed";
  score: number | null;
  attempt_count: number;
  started_at: string | null;
  completed_at: string | null;
  cert_issued_at: string | null;
  cert_expires_at: string | null;
  cert_url: string | null;
  current_module_id: string | null;
  courses?: Course;
}

export interface CreateCoursePayload {
  title: string;
  description?: string;
  passing_score?: number;
  max_retakes?: number;
  cert_validity_days?: number;
  is_mandatory?: boolean;
  target_roles?: string[];
  target_location_ids?: string[];
  language?: string;
  modules?: ModulePayload[];
}

export interface ModulePayload {
  title: string;
  module_type: "slides" | "video" | "pdf" | "quiz";
  display_order?: number;
  slides?: { title?: string; body?: string; image_url?: string; display_order?: number }[];
  questions?: { question: string; question_type: string; options: QuizOption[]; explanation?: string; display_order?: number }[];
}

export interface GenerateCoursePayload {
  input_type: "topic" | "url" | "document" | "video";
  input_data?: string;
  input_file_url?: string;
  target_role?: string;
  language?: string;
}

export interface LmsAnalytics {
  total_enrollments: number;
  passed: number;
  in_progress: number;
  not_started: number;
  failed: number;
  completion_rate: number;
}

// ── Courses ─────────────────────────────────────────────────────────────────

export async function listPublishedCourses(params?: { page?: number; page_size?: number }) {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.page_size) q.set("page_size", String(params.page_size));
  return apiFetch<{ items: Course[]; total_count: number; page: number; page_size: number }>(
    `/api/v1/lms/courses${q.toString() ? `?${q}` : ""}`
  );
}

export async function listManagedCourses(params?: { page?: number; page_size?: number; search?: string }) {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.page_size) q.set("page_size", String(params.page_size));
  if (params?.search) q.set("search", params.search);
  return apiFetch<{ items: Course[]; total_count: number; page: number; page_size: number }>(
    `/api/v1/lms/courses/manage${q.toString() ? `?${q}` : ""}`
  );
}

export async function getCourse(courseId: string) {
  return apiFetch<Course>(`/api/v1/lms/courses/${courseId}`);
}

export async function createCourse(body: CreateCoursePayload) {
  return apiFetch<Course>(`/api/v1/lms/courses`, { method: "POST", body: JSON.stringify(body) });
}

export async function updateCourse(courseId: string, body: Partial<CreateCoursePayload>) {
  return apiFetch<Course>(`/api/v1/lms/courses/${courseId}`, { method: "PUT", body: JSON.stringify(body) });
}

export async function publishCourse(courseId: string) {
  return apiFetch<{ success: boolean }>(`/api/v1/lms/courses/${courseId}/publish`, { method: "POST" });
}

export interface EnrollableUser {
  id: string;
  full_name: string;
  role: string;
  location_id: string | null;
  enrollment_status: "not_started" | "in_progress" | "passed" | "failed" | null;
}

export interface OrgLocation {
  id: string;
  name: string;
}

export async function listEnrollableUsers(courseId: string) {
  return apiFetch<EnrollableUser[]>(`/api/v1/lms/courses/${courseId}/enrollable-users`);
}

export async function listOrgLocations() {
  return apiFetch<OrgLocation[]>(`/api/v1/lms/locations`);
}

export async function getEnrollmentStats(courseId: string) {
  return apiFetch<{ active_count: number; completed_count: number }>(
    `/api/v1/lms/courses/${courseId}/enrollment-stats`
  );
}

export async function unpublishCourse(courseId: string, cancelEnrollments: boolean) {
  return apiFetch<{ success: boolean }>(`/api/v1/lms/courses/${courseId}/unpublish`, {
    method: "POST",
    body: JSON.stringify({ cancel_enrollments: cancelEnrollments }),
  });
}

export async function deleteCourse(courseId: string) {
  return apiFetch<{ success: boolean }>(`/api/v1/lms/courses/${courseId}`, { method: "DELETE" });
}

export async function duplicateCourse(courseId: string) {
  return apiFetch<{ id: string }>(`/api/v1/lms/courses/${courseId}/duplicate`, { method: "POST" });
}

export async function generateCourse(body: GenerateCoursePayload) {
  return apiFetch<{ id: string; status: string }>(`/api/v1/lms/courses/generate`, { method: "POST", body: JSON.stringify(body) });
}

export async function uploadTrainingFile(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<{ url: string }>("/api/v1/lms/upload", {
    method: "POST",
    body: formData,
    rawBody: true,
  });
}

export async function getGenerationJob(jobId: string) {
  return apiFetch<{ id: string; status: string; result_course_id: string | null; error_message: string | null }>(
    `/api/v1/lms/courses/generate/${jobId}`
  );
}

// ── Enrollments ─────────────────────────────────────────────────────────────

export async function getMyEnrollments() {
  return apiFetch<CourseEnrollment[]>(`/api/v1/lms/enrollments/my`);
}

export async function listEnrollments(params?: { course_id?: string; user_id?: string; status?: string; page?: number; page_size?: number }) {
  const q = new URLSearchParams();
  if (params?.course_id) q.set("course_id", params.course_id);
  if (params?.user_id) q.set("user_id", params.user_id);
  if (params?.status) q.set("status", params.status);
  if (params?.page) q.set("page", String(params.page));
  if (params?.page_size) q.set("page_size", String(params.page_size));
  return apiFetch<{ items: CourseEnrollment[]; total_count: number }>(
    `/api/v1/lms/enrollments${q.toString() ? `?${q}` : ""}`
  );
}

export async function enrollUsers(courseId: string, userIds: string[], isMandatory = false) {
  return apiFetch<{ enrolled: number; skipped: number }>(`/api/v1/lms/enrollments`, {
    method: "POST",
    body: JSON.stringify({ course_id: courseId, user_ids: userIds, is_mandatory: isMandatory }),
  });
}

export async function updateProgress(enrollmentId: string, moduleId: string, status: string, timeSpent?: number) {
  return apiFetch<{ success: boolean }>(`/api/v1/lms/enrollments/${enrollmentId}/progress`, {
    method: "POST",
    body: JSON.stringify({ module_id: moduleId, status, time_spent_seconds: timeSpent }),
  });
}

export async function submitQuiz(enrollmentId: string, moduleId: string, answers: { question_id: string; selected_option: string }[]) {
  return apiFetch<{ score: number; passed: boolean; correct: number; total: number; attempt_number: number }>(
    `/api/v1/lms/enrollments/${enrollmentId}/quiz/submit`,
    { method: "POST", body: JSON.stringify({ module_id: moduleId, answers }) }
  );
}

// ── Analytics ────────────────────────────────────────────────────────────────

export async function getLmsAnalytics() {
  return apiFetch<LmsAnalytics>(`/api/v1/lms/analytics/completion`);
}

export async function saveCourseStructure(courseId: string, modules: ModulePayload[]) {
  return apiFetch<Course>(`/api/v1/lms/courses/${courseId}/structure`, {
    method: "PUT",
    body: JSON.stringify({ modules }),
  });
}

export interface ModuleProgress {
  id: string;
  enrollment_id: string;
  module_id: string;
  status: "not_started" | "in_progress" | "completed";
  started_at: string | null;
  completed_at: string | null;
  time_spent_seconds: number;
}

export interface EnrollmentWithProgress {
  enrollment: CourseEnrollment;
  course: Course;
  module_progress: ModuleProgress[];
}

export async function getEnrollmentWithProgress(enrollmentId: string) {
  return apiFetch<EnrollmentWithProgress>(`/api/v1/lms/enrollments/${enrollmentId}`);
}

// ── AI endpoints ──────────────────────────────────────────────────────────────

export function generateQuiz(body: {
  course_id: string;
  slides_content: string[];
  num_questions?: number;
}): Promise<{ questions: Array<{ question: string; options: string[]; correct_index: number; explanation: string }> }> {
  return apiFetch("/api/v1/ai/generate-quiz", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function translateCourse(body: {
  course_id: string;
  target_language: string;
  content: object;
}): Promise<object> {
  return apiFetch("/api/v1/ai/translate-course", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getKnowledgeGaps(body: {
  wrong_answers: Array<{ question: string; chosen: string; correct: string; course_title: string }>;
}): Promise<{ gaps: Array<{ topic: string; description: string; severity: "low" | "medium" | "high"; recommended_action: string }> }> {
  return apiFetch("/api/v1/ai/knowledge-gaps", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getLearningPath(body: {
  role: string;
  completed_courses: string[];
  quiz_scores: Record<string, number>;
  available_courses: Array<{ id: string; title: string; type: string }>;
}): Promise<{ recommended: Array<{ course_id: string; reason: string; priority: number }> }> {
  return apiFetch("/api/v1/ai/learning-path", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
