"""
LMS API — /api/v1/lms
"""
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, HTTPException, Query, UploadFile
from dependencies import get_current_user, require_manager_or_above
from services.supabase_client import get_admin_client
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
    current_user: dict = Depends(get_current_user),
):
    import uuid, time
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    db = get_admin_client()

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
