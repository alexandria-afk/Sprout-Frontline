"""
LMS API — /api/v1/lms
"""
import asyncio
import json
from typing import Optional
import anthropic as _anthropic
from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, HTTPException, Query, UploadFile
from dependencies import get_current_user, require_manager_or_above
from services.supabase_client import get_admin_client
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

router = APIRouter()


def _strip_code_fence(text: str) -> str:
    """Remove markdown code fences from an LLM response."""
    text = text.strip()
    if text.startswith("```"):
        text = text[3:]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
        if text.endswith("```"):
            text = text[:-3].strip()
        elif "```" in text:
            text = text[: text.index("```")].strip()
    return text

# ── Published Courses (learner) ───────────────────────────────────────────────

@router.get("/courses")
async def list_courses(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await LmsService.list_published_courses(org_id, user_id, page, page_size)

# ── Course Management (manager+) ──────────────────────────────────────────────

@router.get("/courses/manage")
async def list_managed_courses(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.list_managed_courses(org_id, page, page_size, search)

@router.post("/courses")
async def create_course(
    body: CreateCourseRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.create_course(body, org_id, current_user["sub"])

@router.put("/courses/{course_id}/structure")
async def save_course_structure(
    course_id: str,
    body: dict = Body(...),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    modules = body.get("modules", [])
    return await LmsService.save_course_structure(course_id, org_id, modules)

@router.get("/courses/{course_id}")
async def get_course(
    course_id: str,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.get_course(course_id, org_id)

@router.post("/courses/{course_id}/regenerate-content")
async def regenerate_course_content(
    course_id: str,
    current_user: dict = Depends(require_manager_or_above),
):
    """Delete empty slides/quiz questions and re-generate them with Claude Haiku."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    sb = get_admin_client()

    # Fetch course (org ownership check)
    course_res = sb.table("courses").select("id, title, description").eq("id", course_id).eq("organisation_id", org_id).maybe_single().execute()
    if not course_res.data:
        raise HTTPException(status_code=404, detail="Course not found.")
    course = course_res.data
    course_title = course["title"]
    industry = course.get("description", "retail")

    # Fetch modules
    mods_res = sb.table("course_modules").select("id, title, type").eq("course_id", course_id).order("display_order").execute()
    module_records = mods_res.data or []
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
            sb.table("course_slides").delete().eq("module_id", mod["id"]).execute()
        else:
            sb.table("quiz_questions").delete().eq("module_id", mod["id"]).execute()

    # Step 3: Insert new content
    slide_rows: list[dict] = []
    quiz_rows: list[dict] = []
    for idx, mod in enumerate(module_records):
        if idx >= len(content_list):
            break
        mod_content = content_list[idx]
        if mod["type"] == "slides":
            for s_order, slide in enumerate(mod_content.get("slides") or []):
                slide_rows.append({
                    "module_id": mod["id"],
                    "title": slide.get("title", f"Slide {s_order + 1}"),
                    "body": slide.get("body") or slide.get("content") or slide.get("text") or slide.get("description") or "",
                    "display_order": s_order,
                })
        else:
            for q_order, q in enumerate(mod_content.get("questions") or []):
                qtype = q.get("question_type", "multiple_choice")
                if qtype not in ("multiple_choice", "true_false", "image_based"):
                    qtype = "multiple_choice"
                quiz_rows.append({
                    "module_id": mod["id"],
                    "question": q.get("question", "Question"),
                    "question_type": qtype,
                    "options": q.get("options", []),
                    "explanation": q.get("explanation", ""),
                    "display_order": q_order,
                })

    if slide_rows:
        sb.table("course_slides").insert(slide_rows).execute()
    if quiz_rows:
        sb.table("quiz_questions").insert(quiz_rows).execute()

    return {"ok": True, "message": "Content regenerated successfully."}


@router.put("/courses/{course_id}")
async def update_course(
    course_id: str,
    body: UpdateCourseRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.update_course(course_id, body, org_id)

@router.delete("/courses/{course_id}")
async def delete_course(
    course_id: str,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.delete_course(course_id, org_id)

@router.post("/courses/{course_id}/publish")
async def publish_course(
    course_id: str,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.publish_course(course_id, org_id)

@router.get("/locations")
async def list_org_locations(current_user: dict = Depends(require_manager_or_above)):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.list_org_locations(org_id)

@router.get("/courses/{course_id}/enrollable-users")
async def list_enrollable_users(
    course_id: str,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.list_enrollable_users(course_id, org_id)

@router.get("/courses/{course_id}/enrollment-stats")
async def get_enrollment_stats(
    course_id: str,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.get_enrollment_stats(course_id, org_id)

@router.post("/courses/{course_id}/duplicate")
async def duplicate_course(
    course_id: str,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.duplicate_course(course_id, org_id, current_user["sub"])

@router.post("/courses/{course_id}/unpublish")
async def unpublish_course(
    course_id: str,
    body: dict = Body(default={}),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    cancel = body.get("cancel_enrollments", False)
    return await LmsService.unpublish_course(course_id, org_id, cancel)

# ── AI Generation ─────────────────────────────────────────────────────────────

@router.post("/courses/generate")
async def generate_course(
    body: GenerateCourseRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    created_by = current_user["sub"]
    job = await LmsService.start_ai_generation(body, org_id, created_by)
    background_tasks.add_task(
        LmsService.process_generation_job,
        job["id"], body, org_id, created_by,
    )
    return job

@router.get("/courses/generate/{job_id}")
async def get_generation_job(
    job_id: str,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.get_ai_job(job_id, org_id)

# ── Enrollments ───────────────────────────────────────────────────────────────

@router.get("/enrollments/my")
async def my_enrollments(current_user: dict = Depends(get_current_user)):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.my_enrollments(current_user["sub"], org_id)

@router.get("/enrollments")
async def list_enrollments(
    course_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.list_enrollments(org_id, course_id, user_id, status, page, page_size)

@router.post("/enrollments")
async def enroll_users(
    body: EnrollRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.enroll_users(body, org_id, current_user["sub"])

@router.get("/enrollments/{enrollment_id}")
async def get_enrollment(
    enrollment_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await LmsService.get_enrollment_with_progress(enrollment_id, current_user["sub"])

@router.post("/enrollments/{enrollment_id}/progress")
async def update_progress(
    enrollment_id: str,
    body: UpdateProgressRequest,
    current_user: dict = Depends(get_current_user),
):
    return await LmsService.update_progress(enrollment_id, body, current_user["sub"])

@router.post("/enrollments/{enrollment_id}/quiz/submit")
async def submit_quiz(
    enrollment_id: str,
    body: SubmitQuizRequest,
    current_user: dict = Depends(get_current_user),
):
    return await LmsService.submit_quiz(enrollment_id, body, current_user["sub"])

# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/analytics/completion")
async def analytics_completion(current_user: dict = Depends(require_manager_or_above)):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await LmsService.get_analytics_completion(org_id)

# ── File Upload ────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_training_file(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_manager_or_above),
):
    import uuid, time
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    db = get_admin_client()

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

    db.storage.from_("training-media").upload(
        storage_path,
        content,
        {"content-type": file.content_type or "application/octet-stream"},
    )
    public_url = db.storage.from_("training-media").get_public_url(storage_path)
    return {"url": public_url}
