"""
LMS API — /api/v1/lms
"""
import asyncio
import json
from typing import Optional
import anthropic as _anthropic
from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, HTTPException, Query, UploadFile
from dependencies import get_current_user, require_manager_or_above, get_db
from config import settings
from models.lms import (
    CreateCourseRequest,
    UpdateCourseRequest,
    GenerateCourseRequest,
    EnrollRequest,
    UpdateProgressRequest,
    SubmitQuizRequest,
)
from services.lms_service import LmsService
from utils.ai_helpers import _strip_code_fence
from services.blob_storage import upload_blob, get_public_url

router = APIRouter()

# ── Published Courses (learner) ───────────────────────────────────────────────

@router.get("/courses")
async def list_courses(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await LmsService.list_published_courses(conn, org_id, user_id, page, page_size)

# ── Course Management (manager+) ──────────────────────────────────────────────

@router.get("/courses/manage")
async def list_managed_courses(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.list_managed_courses(conn, org_id, page, page_size, search)

@router.post("/courses")
async def create_course(
    body: CreateCourseRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.create_course(conn, body, org_id, current_user["sub"])

@router.put("/courses/{course_id}/structure")
async def save_course_structure(
    course_id: str,
    body: dict = Body(...),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    modules = body.get("modules", [])
    return await LmsService.save_course_structure(conn, course_id, org_id, modules)

@router.get("/courses/{course_id}")
async def get_course(
    course_id: str,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.get_course(conn, course_id, org_id)

@router.post("/courses/{course_id}/regenerate-content")
async def regenerate_course_content(
    course_id: str,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    """Delete empty slides/quiz questions and re-generate them with Claude Haiku."""
    from services.db import row as _row, rows as _rows, execute as _execute, execute_returning as _execute_returning
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    # Fetch course (org ownership check)
    course = _row(
        conn,
        "SELECT id, title, description FROM courses WHERE id = %s AND organisation_id = %s",
        (course_id, org_id),
    )
    if not course:
        raise HTTPException(status_code=404, detail="Course not found.")
    course_title = course["title"]
    industry = course.get("description", "retail")

    # Fetch modules
    module_records = _rows(
        conn,
        "SELECT id, title, type FROM course_modules WHERE course_id = %s ORDER BY display_order",
        (course_id,),
    )
    if not module_records:
        raise HTTPException(status_code=400, detail="Course has no modules to regenerate.")

    # Step 1: Generate content with Claude Haiku FIRST — if this fails, nothing is deleted
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="AI content generation is not configured.")

    client = _anthropic.Anthropic(api_key=settings.anthropic_api_key)
    module_outline = [{"title": m["title"], "type": m["type"]} for m in module_records]

    def _call():
        return client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4000,
            messages=[{"role": "user", "content": (
                f"Generate training content for a course titled '{course_title}'. "
                f"Modules: {json.dumps(module_outline)}. "
                f"For each 'slides' module: write 3-4 slides. Each slide MUST have exactly two keys: \"title\" (short heading) and \"body\" (2-3 sentence explanation of a key concept). Do NOT use any other key name — only \"title\" and \"body\". "
                f"For each 'quiz' or 'video' module: write 3-4 multiple_choice quiz questions with 4 options (exactly 1 correct), and a brief explanation. "
                f"Respond ONLY with JSON array matching the module order: "
                f'[{{"type": "slides", "slides": [{{"title": "...", "body": "..."}}]}}, '
                f'{{"type": "quiz", "questions": [{{"question": "...", "question_type": "multiple_choice", "options": [{{"text": "...", "is_correct": true}}], "explanation": "..."}}]}}]'
            )}],
        )

    try:
        resp = await asyncio.to_thread(_call)
        content_text = "".join(b.text for b in resp.content if hasattr(b, "text"))
        content_list = json.loads(_strip_code_fence(content_text))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI content generation failed: {exc}")

    # Step 2: Only now that generation succeeded, delete existing slides/quiz questions
    for mod in module_records:
        if mod["type"] == "slides":
            _execute(conn, "DELETE FROM course_slides WHERE module_id = %s", (mod["id"],))
        else:
            _execute(conn, "DELETE FROM quiz_questions WHERE module_id = %s", (mod["id"],))

    # Step 3: Insert new content
    for idx, mod in enumerate(module_records):
        if idx >= len(content_list):
            break
        mod_content = content_list[idx]
        if mod["type"] == "slides":
            for s_order, slide in enumerate(mod_content.get("slides") or []):
                _execute(
                    conn,
                    "INSERT INTO course_slides (module_id, title, body, display_order) VALUES (%s, %s, %s, %s)",
                    (
                        mod["id"],
                        slide.get("title", f"Slide {s_order + 1}"),
                        slide.get("body") or slide.get("content") or slide.get("text") or slide.get("description") or "",
                        s_order,
                    ),
                )
        else:
            for q_order, q in enumerate(mod_content.get("questions") or []):
                qtype = q.get("question_type", "multiple_choice")
                if qtype not in ("multiple_choice", "true_false", "image_based"):
                    qtype = "multiple_choice"
                _execute(
                    conn,
                    "INSERT INTO quiz_questions (module_id, question, question_type, options, explanation, display_order) VALUES (%s, %s, %s, %s::jsonb, %s, %s)",
                    (
                        mod["id"],
                        q.get("question", "Question"),
                        qtype,
                        json.dumps(q.get("options", [])),
                        q.get("explanation", ""),
                        q_order,
                    ),
                )

    return {"ok": True, "message": "Content regenerated successfully."}


@router.put("/courses/{course_id}")
async def update_course(
    course_id: str,
    body: UpdateCourseRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.update_course(conn, course_id, body, org_id)

@router.delete("/courses/{course_id}")
async def delete_course(
    course_id: str,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.delete_course(conn, course_id, org_id)

@router.post("/courses/{course_id}/publish")
async def publish_course(
    course_id: str,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.publish_course(conn, course_id, org_id)

@router.get("/locations")
async def list_org_locations(
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.list_org_locations(conn, org_id)

@router.get("/courses/{course_id}/enrollable-users")
async def list_enrollable_users(
    course_id: str,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.list_enrollable_users(conn, course_id, org_id)

@router.get("/courses/{course_id}/enrollment-stats")
async def get_enrollment_stats(
    course_id: str,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.get_enrollment_stats(conn, course_id, org_id)

@router.post("/courses/{course_id}/duplicate")
async def duplicate_course(
    course_id: str,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.duplicate_course(conn, course_id, org_id, current_user["sub"])

@router.post("/courses/{course_id}/unpublish")
async def unpublish_course(
    course_id: str,
    body: dict = Body(default={}),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    cancel = body.get("cancel_enrollments", False)
    return await LmsService.unpublish_course(conn, course_id, org_id, cancel)

# ── AI Generation ─────────────────────────────────────────────────────────────

@router.post("/courses/generate")
async def generate_course(
    body: GenerateCourseRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    created_by = current_user["sub"]
    job = await LmsService.start_ai_generation(conn, body, org_id, created_by)
    background_tasks.add_task(
        LmsService.process_generation_job,
        job["id"], body, org_id, created_by,
    )
    return job

@router.get("/courses/generate/{job_id}")
async def get_generation_job(
    job_id: str,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.get_ai_job(conn, job_id, org_id)

# ── Enrollments ───────────────────────────────────────────────────────────────

@router.get("/enrollments/my")
async def my_enrollments(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.my_enrollments(conn, current_user["sub"], org_id)

@router.get("/enrollments")
async def list_enrollments(
    course_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.list_enrollments(conn, org_id, course_id, user_id, status, page, page_size)

@router.post("/enrollments")
async def enroll_users(
    body: EnrollRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.enroll_users(conn, body, org_id, current_user["sub"])

@router.get("/enrollments/{enrollment_id}")
async def get_enrollment(
    enrollment_id: str,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    return await LmsService.get_enrollment_with_progress(conn, enrollment_id, current_user["sub"])

@router.post("/enrollments/{enrollment_id}/progress")
async def update_progress(
    enrollment_id: str,
    body: UpdateProgressRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    return await LmsService.update_progress(conn, enrollment_id, body, current_user["sub"])

@router.post("/enrollments/{enrollment_id}/quiz/submit")
async def submit_quiz(
    enrollment_id: str,
    body: SubmitQuizRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    return await LmsService.submit_quiz(conn, enrollment_id, body, current_user["sub"])

# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/analytics/completion")
async def analytics_completion(
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.get_analytics_completion(conn, org_id)

# ── File Upload ────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_training_file(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_manager_or_above),
):
    import uuid, time
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]

    # Restrict to safe media types — reject anything that is not a video,
    # image, or PDF to prevent arbitrary file uploads.
    allowed_prefixes = ("video/", "image/", "application/pdf")
    content_type = file.content_type or ""
    if not any(content_type.startswith(prefix) for prefix in allowed_prefixes):
        raise HTTPException(status_code=422, detail="Unsupported file type")

    content = await file.read()
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 100MB)")

    ext = (file.filename or "file").rsplit(".", 1)[-1].lower()
    suffix = uuid.uuid4().hex[:8]
    timestamp = int(time.time())
    storage_path = f"{org_id}/{user_id}/{timestamp}-{suffix}.{ext}"

    upload_blob("training-media", storage_path, content, file.content_type or "application/octet-stream")
    public_url = get_public_url("training-media", storage_path)
    return {"url": public_url}
