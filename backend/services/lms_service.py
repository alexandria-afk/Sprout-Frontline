import json
import base64
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional
import httpx
import anthropic
from services.supabase_client import get_supabase
from services.industry_context import get_industry_context
from models.lms import (
    CreateCourseRequest,
    UpdateCourseRequest,
    GenerateCourseRequest,
    EnrollRequest,
    UpdateProgressRequest,
    SubmitQuizRequest,
)

logger = logging.getLogger(__name__)

_COURSE_SYSTEM_PROMPT = """You are a training course designer for retail and hospitality operations in the Philippines.
Generate a practical, professional training course.

Always respond with ONLY a valid JSON object — no markdown fences, no explanation.

Schema:
{
  "title": "string",
  "description": "string",
  "modules": [
    {
      "title": "string",
      "module_type": "slides",
      "slides": [
        {"title": "string", "body": "string (2-4 paragraphs of clear, practical content in markdown)", "display_order": 0}
      ]
    },
    {
      "title": "Quiz",
      "module_type": "quiz",
      "questions": [
        {
          "question": "string",
          "question_type": "multiple_choice",
          "options": [
            {"text": "string", "is_correct": false}
          ],
          "explanation": "string",
          "display_order": 0
        }
      ]
    }
  ]
}

Rules:
- Create 2-4 slide modules and exactly 1 quiz module at the end
- Each slide module has 3-5 slides with clear, practical content
- Quiz has 5-8 questions, each with exactly 4 options (one is_correct: true, three is_correct: false)
- Content should be actionable for frontline staff
- Keep language simple and direct
"""


class LmsService:

    @staticmethod
    async def list_published_courses(org_id: str, user_id: str, page: int = 1, page_size: int = 20):
        """Courses available to a learner — published and not deleted."""
        supabase = get_supabase()
        offset = (page - 1) * page_size
        result = supabase.table("courses").select(
            "*, course_modules(id, title, module_type, display_order, estimated_duration_mins)"
        ).eq("organisation_id", org_id).eq("is_published", True).eq("is_deleted", False).eq("is_active", True).order("created_at", desc=True).range(offset, offset + page_size - 1).execute()

        # Attach enrollment status for this user
        if result.data:
            course_ids = [c["id"] for c in result.data]
            enrollments = supabase.table("course_enrollments").select("course_id, status, score, completed_at").eq("user_id", user_id).eq("is_deleted", False).in_("course_id", course_ids).execute()
            enroll_map = {e["course_id"]: e for e in (enrollments.data or [])}
            for course in result.data:
                course["enrollment"] = enroll_map.get(course["id"])

        count_result = supabase.table("courses").select("id", count="exact").eq("organisation_id", org_id).eq("is_published", True).eq("is_deleted", False).execute()
        return {"items": result.data or [], "total_count": count_result.count or 0, "page": page, "page_size": page_size}

    @staticmethod
    async def list_managed_courses(org_id: str, page: int = 1, page_size: int = 20, search: Optional[str] = None):
        """All courses (including drafts) for managers."""
        supabase = get_supabase()
        offset = (page - 1) * page_size
        q = supabase.table("courses").select(
            "*, course_modules(id, module_type)"
        ).eq("organisation_id", org_id).eq("is_deleted", False).order("created_at", desc=True)
        if search:
            q = q.ilike("title", f"%{search}%")
        result = q.range(offset, offset + page_size - 1).execute()

        count_q = supabase.table("courses").select("id", count="exact").eq("organisation_id", org_id).eq("is_deleted", False)
        count_result = count_q.execute()
        return {"items": result.data or [], "total_count": count_result.count or 0, "page": page, "page_size": page_size}

    @staticmethod
    async def get_course(course_id: str, org_id: str):
        """Get full course with all modules, slides, and questions (excluding soft-deleted)."""
        supabase = get_supabase()
        result = supabase.table("courses").select(
            "*, course_modules(*, course_slides(*), quiz_questions(*))"
        ).eq("id", course_id).eq("organisation_id", org_id).eq("is_deleted", False).single().execute()
        data = result.data
        if data:
            # Filter out soft-deleted nested records (PostgREST doesn't filter nested is_deleted)
            mods = [m for m in (data.get("course_modules") or []) if not m.get("is_deleted", False)]
            for mod in mods:
                mod["course_slides"] = [s for s in (mod.get("course_slides") or []) if not s.get("is_deleted", False)]
                mod["quiz_questions"] = [q for q in (mod.get("quiz_questions") or []) if not q.get("is_deleted", False)]
            data["course_modules"] = mods
        return data

    @staticmethod
    async def create_course(body: CreateCourseRequest, org_id: str, created_by: str):
        """Create course with optional modules."""
        supabase = get_supabase()
        course_data = {
            "organisation_id": org_id,
            "created_by": created_by,
            "title": body.title,
            "description": body.description,
            "thumbnail_url": body.thumbnail_url,
            "estimated_duration_mins": body.estimated_duration_mins,
            "passing_score": body.passing_score,
            "max_retakes": body.max_retakes,
            "cert_validity_days": body.cert_validity_days,
            "is_mandatory": body.is_mandatory,
            "target_roles": body.target_roles,
            "target_location_ids": body.target_location_ids,
            "language": body.language,
            "is_published": False,
            "ai_generated": False,
        }
        course_result = supabase.table("courses").insert(course_data).execute()
        course = course_result.data[0]
        course_id = course["id"]

        # Insert modules
        for i, mod in enumerate(body.modules):
            mod_data = {
                "course_id": course_id,
                "title": mod.title,
                "module_type": mod.module_type,
                "content_url": mod.content_url,
                "display_order": mod.display_order or i,
                "is_required": mod.is_required,
                "estimated_duration_mins": mod.estimated_duration_mins,
            }
            mod_result = supabase.table("course_modules").insert(mod_data).execute()
            mod_id = mod_result.data[0]["id"]

            if mod.module_type == "slides":
                for j, slide in enumerate(mod.slides):
                    supabase.table("course_slides").insert({
                        "module_id": mod_id,
                        "title": slide.title,
                        "body": slide.body,
                        "image_url": slide.image_url,
                        "display_order": slide.display_order or j,
                    }).execute()
            elif mod.module_type == "quiz":
                for j, q in enumerate(mod.questions):
                    supabase.table("quiz_questions").insert({
                        "module_id": mod_id,
                        "question": q.question,
                        "question_type": q.question_type,
                        "image_url": q.image_url,
                        "options": [o.model_dump() for o in q.options],
                        "explanation": q.explanation,
                        "display_order": q.display_order or j,
                    }).execute()

        return await LmsService.get_course(course_id, org_id)

    @staticmethod
    async def update_course(course_id: str, body: UpdateCourseRequest, org_id: str):
        supabase = get_supabase()
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if updates:
            updates["updated_at"] = datetime.now(timezone.utc).isoformat()
            supabase.table("courses").update(updates).eq("id", course_id).eq("organisation_id", org_id).execute()
        return await LmsService.get_course(course_id, org_id)

    @staticmethod
    async def publish_course(course_id: str, org_id: str):
        supabase = get_supabase()
        supabase.table("courses").update({
            "is_published": True,
            "was_published": True,
            "updated_at": "now()",
        }).eq("id", course_id).eq("organisation_id", org_id).execute()
        return {"success": True}

    @staticmethod
    async def get_enrollment_stats(course_id: str, org_id: str):
        """Return active (in-progress / not-started) and completed enrollment counts."""
        supabase = get_supabase()
        # Verify ownership
        check = supabase.table("courses").select("id").eq("id", course_id).eq("organisation_id", org_id).maybe_single().execute()
        if not check.data:
            return {"active_count": 0, "completed_count": 0}

        active = supabase.table("course_enrollments").select("id", count="exact").eq("course_id", course_id).in_("status", ["in_progress", "not_started"]).eq("is_deleted", False).execute()
        completed = supabase.table("course_enrollments").select("id", count="exact").eq("course_id", course_id).in_("status", ["passed", "failed"]).eq("is_deleted", False).execute()
        return {
            "active_count": active.count or 0,
            "completed_count": completed.count or 0,
        }

    @staticmethod
    async def unpublish_course(course_id: str, org_id: str, cancel_enrollments: bool = False):
        """Unpublish a course. Optionally cancel all pending enrollments."""
        supabase = get_supabase()
        supabase.table("courses").update({
            "is_published": False,
            "was_published": True,
            "updated_at": "now()",
        }).eq("id", course_id).eq("organisation_id", org_id).execute()

        if cancel_enrollments:
            supabase.table("course_enrollments").update({
                "is_deleted": True,
                "updated_at": "now()",
            }).eq("course_id", course_id).in_("status", ["in_progress", "not_started"]).execute()

        return {"success": True}

    @staticmethod
    async def delete_course(course_id: str, org_id: str):
        supabase = get_supabase()
        supabase.table("courses").update({"is_deleted": True, "updated_at": "now()"}).eq("id", course_id).eq("organisation_id", org_id).execute()
        return {"success": True}

    @staticmethod
    async def start_ai_generation(body: GenerateCourseRequest, org_id: str, created_by: str):
        """Queue an AI course generation job."""
        supabase = get_supabase()
        job = supabase.table("ai_course_jobs").insert({
            "organisation_id": org_id,
            "created_by": created_by,
            "input_type": body.input_type,
            "input_data": body.input_data,
            "input_file_url": body.input_file_url,
            "status": "queued",
        }).execute()
        return job.data[0]

    @staticmethod
    async def get_ai_job(job_id: str, org_id: str):
        supabase = get_supabase()
        result = supabase.table("ai_course_jobs").select("*").eq("id", job_id).eq("organisation_id", org_id).single().execute()
        return result.data

    @staticmethod
    async def process_generation_job(job_id: str, body: GenerateCourseRequest, org_id: str, created_by: str):
        """Background task — calls Claude to generate the course, then creates it in DB."""
        from config import settings
        supabase = get_supabase()

        def _mark(status: str, course_id: str = None, error: str = None):
            update = {"status": status}
            if course_id:
                update["result_course_id"] = course_id
            if error:
                update["error_message"] = error[:500]
            supabase.table("ai_course_jobs").update(update).eq("id", job_id).execute()

        try:
            _mark("processing")
            api_key = getattr(settings, "anthropic_api_key", None)
            if not api_key:
                raise ValueError("ANTHROPIC_API_KEY not configured")

            client = anthropic.Anthropic(api_key=api_key)

            # ── Build the Claude message based on input_type ───────────────────
            if body.input_type == "video":
                # For video: no AI needed — create a simple video-module course
                file_url = body.input_file_url or ""
                title = (body.input_data or "Uploaded Video Training").strip() or "Uploaded Video Training"
                course_json = {
                    "title": title,
                    "description": f"Video training module uploaded for {body.target_role or 'staff'}.",
                    "modules": [
                        {"title": "Video", "module_type": "video", "content_url": file_url, "slides": [], "questions": []}
                    ],
                }
            else:
                # Build message content for Claude
                if body.input_type == "document" and body.input_file_url:
                    async with httpx.AsyncClient(timeout=30) as http:
                        resp = await http.get(body.input_file_url)
                        resp.raise_for_status()
                    b64_data = base64.standard_b64encode(resp.content).decode()
                    ctype = resp.headers.get("content-type", "application/pdf").split(";")[0].strip()
                    if ctype not in ("application/pdf",):
                        ctype = "application/pdf"
                    user_content = [
                        {"type": "document", "source": {"type": "base64", "media_type": ctype, "data": b64_data}},
                        {"type": "text", "text": (
                            f"Generate a training course for {body.target_role or 'staff'} from this document. "
                            "Respond with the JSON structure only."
                        )},
                    ]
                elif body.input_type == "url" and body.input_data:
                    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as http:
                        resp = await http.get(body.input_data, headers={"User-Agent": "Mozilla/5.0"})
                    page_text = resp.text[:6000]
                    user_content = (
                        f"Generate a training course for {body.target_role or 'staff'} based on "
                        f"this web page content:\n\n{page_text}\n\nRespond with JSON only."
                    )
                else:
                    # topic
                    user_content = (
                        f"Generate a training course on: \"{body.input_data or 'General Operations'}\"\n"
                        f"Target audience: {body.target_role or 'staff'}\n"
                        "Respond with JSON only."
                    )

                raw = client.messages.create(
                    model="claude-haiku-4-5",
                    max_tokens=8192,
                    system=get_industry_context(org_id) + _COURSE_SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": user_content}],
                ).content[0].text.strip()

                # Strip markdown fences if present
                if raw.startswith("```"):
                    raw = raw.split("```", 2)[1]
                    if raw.startswith("json"):
                        raw = raw[4:]
                    raw = raw.rsplit("```", 1)[0].strip()

                # Extract JSON robustly — find the outermost { ... } block
                # in case Claude prepended/appended stray text
                start = raw.find("{")
                end = raw.rfind("}")
                if start != -1 and end != -1 and end > start:
                    raw = raw[start:end + 1]

                course_json = json.loads(raw)

            # ── Persist course ─────────────────────────────────────────────────
            course_row = supabase.table("courses").insert({
                "organisation_id": org_id,
                "created_by": created_by,
                "title": course_json.get("title", "AI Generated Course"),
                "description": course_json.get("description"),
                "is_published": False,
                "ai_generated": True,
                "language": body.language or "en",
                "target_roles": [body.target_role] if body.target_role else [],
                "target_location_ids": [],
                "passing_score": 80,
                "max_retakes": 3,
            }).execute().data[0]
            course_id = course_row["id"]

            for i, mod in enumerate(course_json.get("modules", [])):
                mod_row = supabase.table("course_modules").insert({
                    "course_id": course_id,
                    "title": mod.get("title", f"Module {i+1}"),
                    "module_type": mod.get("module_type", "slides"),
                    "content_url": mod.get("content_url"),
                    "display_order": i,
                    "is_required": True,
                }).execute().data[0]
                mod_id = mod_row["id"]

                if mod.get("module_type") == "slides":
                    for j, slide in enumerate(mod.get("slides", [])):
                        supabase.table("course_slides").insert({
                            "module_id": mod_id,
                            "title": slide.get("title"),
                            "body": slide.get("body"),
                            "display_order": slide.get("display_order", j),
                        }).execute()

                elif mod.get("module_type") == "quiz":
                    for j, q in enumerate(mod.get("questions", [])):
                        options = [
                            {"id": str(uuid.uuid4()), "text": opt.get("text", ""), "is_correct": opt.get("is_correct", False)}
                            for opt in q.get("options", [])
                        ]
                        supabase.table("quiz_questions").insert({
                            "module_id": mod_id,
                            "question": q.get("question", ""),
                            "question_type": q.get("question_type", "multiple_choice"),
                            "options": options,
                            "explanation": q.get("explanation"),
                            "display_order": q.get("display_order", j),
                        }).execute()

            _mark("completed", course_id=course_id)

        except Exception as exc:
            logger.error("Course generation job %s failed: %s", job_id, exc, exc_info=True)
            _mark("failed", error=str(exc))

    @staticmethod
    async def my_enrollments(user_id: str, org_id: str):
        """All enrollments for current user with course details."""
        supabase = get_supabase()
        result = supabase.table("course_enrollments").select(
            "*, courses(id, title, description, thumbnail_url, estimated_duration_mins, passing_score, is_mandatory, course_modules(id, module_type))"
        ).eq("user_id", user_id).eq("organisation_id", org_id).eq("is_deleted", False).order("created_at", desc=True).execute()
        return result.data or []

    @staticmethod
    async def list_org_locations(org_id: str):
        """Return all active locations for the org."""
        supabase = get_supabase()
        result = supabase.table("locations").select("id, name").eq("organisation_id", org_id).eq("is_deleted", False).order("name").execute()
        return result.data or []

    @staticmethod
    async def list_enrollable_users(course_id: str, org_id: str):
        """Return all org users with their enrollment status for this course."""
        supabase = get_supabase()
        profiles = supabase.table("profiles").select(
            "id, full_name, role, location_id"
        ).eq("organisation_id", org_id).eq("is_deleted", False).order("full_name").execute().data or []

        if not profiles:
            return []

        # Fetch existing enrollments for this course in one query
        user_ids = [p["id"] for p in profiles]
        enrollments = supabase.table("course_enrollments").select(
            "user_id, status, is_mandatory"
        ).eq("course_id", course_id).eq("is_deleted", False).in_("user_id", user_ids).execute()
        enroll_map = {e["user_id"]: e for e in (enrollments.data or [])}

        return [
            {
                "id": p["id"],
                "full_name": p["full_name"],
                "role": p["role"],
                "location_id": p.get("location_id"),
                "enrollment_status": enroll_map[p["id"]]["status"] if p["id"] in enroll_map else None,
            }
            for p in profiles
        ]

    @staticmethod
    async def enroll_users(body: EnrollRequest, org_id: str, enrolled_by: str):
        """Enroll one or more users in a course."""
        supabase = get_supabase()
        existing_result = supabase.table("course_enrollments").select("user_id").eq("course_id", body.course_id).eq("is_deleted", False).in_("user_id", body.user_ids).execute()
        already_enrolled = {e["user_id"] for e in (existing_result.data or [])}
        inserts = [
            {
                "course_id": body.course_id,
                "user_id": uid,
                "organisation_id": org_id,
                "enrolled_by": enrolled_by,
                "status": "not_started",
                "is_mandatory": body.is_mandatory,
            }
            for uid in body.user_ids if uid not in already_enrolled
        ]
        if inserts:
            ins_resp = supabase.table("course_enrollments").insert(inserts).execute()
            inserted = ins_resp.data or []

            # Notify each enrolled user
            try:
                course_resp = supabase.table("courses").select("title, estimated_duration").eq("id", body.course_id).maybe_single().execute()
                course_data = course_resp.data or {}
                course_title = course_data.get("title", "Training course")
                duration = course_data.get("estimated_duration")
                notif_body = f"{duration} mins" if duration else None
                import asyncio as _asyncio
                from services import notification_service as _ns
                for row in inserted:
                    _asyncio.create_task(_ns.notify(
                        org_id=org_id,
                        recipient_user_id=row["user_id"],
                        type="course_enrolled",
                        title=f"New training: {course_title}",
                        body=notif_body,
                        entity_type="course_enrollment",
                        entity_id=row["id"],
                    ))
            except Exception:
                pass
        return {"enrolled": len(inserts), "skipped": len(body.user_ids) - len(inserts)}

    @staticmethod
    async def update_progress(enrollment_id: str, body: UpdateProgressRequest, user_id: str):
        """Update module progress for an enrollment."""
        supabase = get_supabase()
        # Verify ownership
        enrollment = supabase.table("course_enrollments").select("id, user_id, status").eq("id", enrollment_id).single().execute()
        if not enrollment.data or enrollment.data["user_id"] != user_id:
            raise ValueError("Enrollment not found or access denied")

        # Upsert module progress
        existing = supabase.table("module_progress").select("id, time_spent_seconds").eq("enrollment_id", enrollment_id).eq("module_id", body.module_id).execute()
        now_str = "now()"
        if existing.data:
            updates = {"status": body.status}
            if body.status == "in_progress" and not existing.data[0].get("started_at"):
                updates["started_at"] = now_str
            if body.status == "completed":
                updates["completed_at"] = now_str
            if body.time_spent_seconds:
                updates["time_spent_seconds"] = (existing.data[0].get("time_spent_seconds") or 0) + body.time_spent_seconds
            supabase.table("module_progress").update(updates).eq("id", existing.data[0]["id"]).execute()
        else:
            insert = {
                "enrollment_id": enrollment_id,
                "module_id": body.module_id,
                "status": body.status,
            }
            if body.status == "in_progress":
                insert["started_at"] = now_str
            if body.status == "completed":
                insert["completed_at"] = now_str
            if body.time_spent_seconds:
                insert["time_spent_seconds"] = body.time_spent_seconds
            supabase.table("module_progress").insert(insert).execute()

        # Update enrollment status to in_progress if not_started
        if enrollment.data["status"] == "not_started":
            supabase.table("course_enrollments").update({"status": "in_progress", "started_at": now_str, "current_module_id": body.module_id}).eq("id", enrollment_id).execute()
        elif enrollment.data["status"] == "in_progress":
            supabase.table("course_enrollments").update({"current_module_id": body.module_id}).eq("id", enrollment_id).execute()

        # Auto-pass: if all required modules are now completed, mark enrollment as passed
        if body.status == "completed" and enrollment.data["status"] in ("not_started", "in_progress"):
            enroll_info = supabase.table("course_enrollments").select("course_id").eq("id", enrollment_id).single().execute()
            course_id = enroll_info.data["course_id"]
            required = supabase.table("course_modules").select("id").eq("course_id", course_id).eq("is_required", True).eq("is_deleted", False).execute()
            required_ids = {m["id"] for m in (required.data or [])}
            if required_ids:
                done = supabase.table("module_progress").select("module_id").eq("enrollment_id", enrollment_id).eq("status", "completed").execute()
                done_ids = {m["module_id"] for m in (done.data or [])}
                if required_ids.issubset(done_ids):
                    supabase.table("course_enrollments").update({
                        "status": "passed",
                        "score": 100,
                        "completed_at": "now()",
                    }).eq("id", enrollment_id).execute()

        return {"success": True}

    @staticmethod
    async def submit_quiz(enrollment_id: str, body: SubmitQuizRequest, user_id: str):
        """Score a quiz attempt and update enrollment."""
        supabase = get_supabase()
        # Verify ownership
        enrollment = supabase.table("course_enrollments").select("*, courses(passing_score, max_retakes)").eq("id", enrollment_id).single().execute()
        if not enrollment.data or enrollment.data["user_id"] != user_id:
            raise ValueError("Enrollment not found or access denied")

        # Fetch questions for scoring
        questions = supabase.table("quiz_questions").select("id, options").eq("module_id", body.module_id).eq("is_deleted", False).execute()
        q_map = {q["id"]: q for q in (questions.data or [])}

        # Score answers
        scored = []
        correct = 0
        for ans in body.answers:
            q = q_map.get(ans.question_id)
            is_correct = False
            if q:
                for opt in q["options"]:
                    if opt["id"] == ans.selected_option and opt.get("is_correct"):
                        is_correct = True
                        break
            if is_correct:
                correct += 1
            scored.append({"question_id": ans.question_id, "selected_option": ans.selected_option, "is_correct": is_correct})

        total = len(body.answers)
        score_pct = round((correct / total) * 100) if total > 0 else 0
        passing = enrollment.data["courses"]["passing_score"] or 80
        passed = score_pct >= passing

        attempt_num = (enrollment.data.get("attempt_count") or 0) + 1
        supabase.table("quiz_attempts").insert({
            "enrollment_id": enrollment_id,
            "module_id": body.module_id,
            "attempt_number": attempt_num,
            "score": score_pct,
            "passed": passed,
            "answers": scored,
            "completed_at": "now()",
        }).execute()

        # Update enrollment
        updates = {"attempt_count": attempt_num, "score": score_pct}
        if passed:
            updates["status"] = "passed"
            updates["completed_at"] = "now()"
        else:
            max_retakes = enrollment.data["courses"].get("max_retakes")
            if max_retakes is not None and attempt_num >= max_retakes:
                updates["status"] = "failed"
        supabase.table("course_enrollments").update(updates).eq("id", enrollment_id).execute()

        return {"score": score_pct, "passed": passed, "correct": correct, "total": total, "attempt_number": attempt_num}

    @staticmethod
    async def list_enrollments(org_id: str, course_id: str = None, user_id_filter: str = None, status: str = None, page: int = 1, page_size: int = 20):
        supabase = get_supabase()
        offset = (page - 1) * page_size
        q = supabase.table("course_enrollments").select(
            "*, courses(id, title), profiles(id, full_name, role)"
        ).eq("organisation_id", org_id).eq("is_deleted", False)
        if course_id:
            q = q.eq("course_id", course_id)
        if user_id_filter:
            q = q.eq("user_id", user_id_filter)
        if status:
            q = q.eq("status", status)
        result = q.order("created_at", desc=True).range(offset, offset + page_size - 1).execute()
        return {"items": result.data or [], "total_count": len(result.data or []), "page": page, "page_size": page_size}

    @staticmethod
    async def get_analytics_completion(org_id: str):
        supabase = get_supabase()
        enrollments = supabase.table("course_enrollments").select("status, courses(title)").eq("organisation_id", org_id).eq("is_deleted", False).execute()
        data = enrollments.data or []
        total = len(data)
        passed = sum(1 for e in data if e["status"] == "passed")
        in_progress = sum(1 for e in data if e["status"] == "in_progress")
        not_started = sum(1 for e in data if e["status"] == "not_started")
        failed = sum(1 for e in data if e["status"] == "failed")
        return {
            "total_enrollments": total,
            "passed": passed,
            "in_progress": in_progress,
            "not_started": not_started,
            "failed": failed,
            "completion_rate": round(passed / total * 100) if total > 0 else 0,
        }

    @staticmethod
    async def save_course_structure(course_id: str, org_id: str, modules: list):
        """
        Replace all modules/slides/questions for a course with the provided structure.
        Soft-deletes existing modules, then inserts the new set.
        """
        supabase = get_supabase()

        # Verify course ownership
        course = supabase.table("courses").select("id").eq("id", course_id).eq("organisation_id", org_id).eq("is_deleted", False).single().execute()
        if not course.data:
            raise ValueError("Course not found")

        # Soft-delete all existing modules (cascades to slides/questions via app logic)
        existing_mods = supabase.table("course_modules").select("id").eq("course_id", course_id).eq("is_deleted", False).execute()
        if existing_mods.data:
            mod_ids = [m["id"] for m in existing_mods.data]
            supabase.table("course_modules").update({"is_deleted": True}).in_("id", mod_ids).execute()
            supabase.table("course_slides").update({"is_deleted": True}).in_("module_id", mod_ids).execute()
            supabase.table("quiz_questions").update({"is_deleted": True}).in_("module_id", mod_ids).execute()

        # Insert new modules
        for i, mod in enumerate(modules):
            mod_insert = {
                "course_id": course_id,
                "title": mod.get("title", "Untitled Module"),
                "module_type": mod.get("module_type", "slides"),
                "content_url": mod.get("content_url"),
                "display_order": mod.get("display_order", i),
                "is_required": mod.get("is_required", True),
                "estimated_duration_mins": mod.get("estimated_duration_mins"),
                "is_deleted": False,
            }
            mod_result = supabase.table("course_modules").insert(mod_insert).execute()
            mod_id = mod_result.data[0]["id"]

            if mod.get("module_type") == "slides":
                slides = mod.get("slides", [])
                for j, slide in enumerate(slides):
                    supabase.table("course_slides").insert({
                        "module_id": mod_id,
                        "title": slide.get("title"),
                        "body": slide.get("body"),
                        "image_url": slide.get("image_url"),
                        "display_order": slide.get("display_order", j),
                        "is_deleted": False,
                    }).execute()
            elif mod.get("module_type") == "quiz":
                questions = mod.get("questions", [])
                for j, q in enumerate(questions):
                    supabase.table("quiz_questions").insert({
                        "module_id": mod_id,
                        "question": q.get("question", ""),
                        "question_type": q.get("question_type", "multiple_choice"),
                        "image_url": q.get("image_url"),
                        "options": q.get("options", []),
                        "explanation": q.get("explanation"),
                        "display_order": q.get("display_order", j),
                        "is_deleted": False,
                    }).execute()

        # Return the full updated course so the frontend can sync state
        return await LmsService.get_course(course_id, org_id)

    @staticmethod
    async def get_enrollment_with_progress(enrollment_id: str, user_id: str):
        """Get a single enrollment with full course structure + module progress."""
        supabase = get_supabase()
        enrollment = supabase.table("course_enrollments").select("*") \
            .eq("id", enrollment_id).eq("user_id", user_id).eq("is_deleted", False) \
            .single().execute()
        if not enrollment.data:
            raise ValueError("Enrollment not found")

        course = supabase.table("courses").select(
            "*, course_modules(*, course_slides(*), quiz_questions(*))"
        ).eq("id", enrollment.data["course_id"]).eq("is_deleted", False).single().execute()

        # Filter soft-deleted nested records
        course_data = course.data
        if course_data:
            mods = [m for m in (course_data.get("course_modules") or []) if not m.get("is_deleted", False)]
            for mod in mods:
                mod["course_slides"] = [s for s in (mod.get("course_slides") or []) if not s.get("is_deleted", False)]
                mod["quiz_questions"] = [q for q in (mod.get("quiz_questions") or []) if not q.get("is_deleted", False)]
            course_data["course_modules"] = mods

        progress = supabase.table("module_progress").select("*") \
            .eq("enrollment_id", enrollment_id).execute()

        return {
            "enrollment": enrollment.data,
            "course": course_data,
            "module_progress": progress.data or [],
        }

    @staticmethod
    async def duplicate_course(course_id: str, org_id: str, created_by: str):
        """Duplicate a course (all modules/slides/questions) as a new Draft."""
        supabase = get_supabase()
        original = supabase.table("courses").select(
            "*, course_modules(*, course_slides(*), quiz_questions(*))"
        ).eq("id", course_id).eq("organisation_id", org_id).eq("is_deleted", False).single().execute()
        if not original.data:
            raise ValueError("Course not found")
        src = original.data

        new_course = supabase.table("courses").insert({
            "organisation_id": org_id,
            "created_by": created_by,
            "title": f"{src['title']} (Copy)",
            "description": src.get("description"),
            "thumbnail_url": src.get("thumbnail_url"),
            "estimated_duration_mins": src.get("estimated_duration_mins"),
            "passing_score": src.get("passing_score", 80),
            "max_retakes": src.get("max_retakes"),
            "cert_validity_days": src.get("cert_validity_days"),
            "is_mandatory": src.get("is_mandatory", False),
            "target_roles": src.get("target_roles", []),
            "target_location_ids": src.get("target_location_ids", []),
            "language": src.get("language", "en"),
            "is_published": False,
            "was_published": False,
            "ai_generated": src.get("ai_generated", False),
            "parent_course_id": course_id,
        }).execute()
        new_id = new_course.data[0]["id"]

        for mod in [m for m in (src.get("course_modules") or []) if not m.get("is_deleted", False)]:
            new_mod = supabase.table("course_modules").insert({
                "course_id": new_id,
                "title": mod["title"],
                "module_type": mod["module_type"],
                "content_url": mod.get("content_url"),
                "display_order": mod.get("display_order", 0),
                "is_required": mod.get("is_required", True),
                "estimated_duration_mins": mod.get("estimated_duration_mins"),
            }).execute()
            new_mod_id = new_mod.data[0]["id"]

            for slide in [s for s in (mod.get("course_slides") or []) if not s.get("is_deleted", False)]:
                supabase.table("course_slides").insert({
                    "module_id": new_mod_id,
                    "title": slide.get("title"),
                    "body": slide.get("body"),
                    "image_url": slide.get("image_url"),
                    "display_order": slide.get("display_order", 0),
                }).execute()

            for q in [q for q in (mod.get("quiz_questions") or []) if not q.get("is_deleted", False)]:
                supabase.table("quiz_questions").insert({
                    "module_id": new_mod_id,
                    "question": q["question"],
                    "question_type": q.get("question_type", "multiple_choice"),
                    "image_url": q.get("image_url"),
                    "options": q.get("options", []),
                    "explanation": q.get("explanation"),
                    "display_order": q.get("display_order", 0),
                }).execute()

        return {"id": new_id}
