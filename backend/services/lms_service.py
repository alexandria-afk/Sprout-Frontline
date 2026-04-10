import json
import base64
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional
import httpx
import anthropic
from services.db import row, rows, execute, execute_returning
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
    async def list_published_courses(conn, org_id: str, user_id: str, page: int = 1, page_size: int = 20):
        """Courses available to a learner — published and not deleted."""
        offset = (page - 1) * page_size

        courses = rows(
            conn,
            """
            SELECT c.*
            FROM courses c
            WHERE c.organisation_id = %s
              AND c.is_published = TRUE
              AND c.is_deleted = FALSE
              AND c.is_active = TRUE
            ORDER BY c.created_at DESC
            LIMIT %s OFFSET %s
            """,
            (org_id, page_size, offset),
        )

        if courses:
            course_ids = [c["id"] for c in courses]
            # Fetch modules for all courses in one query
            all_modules = rows(
                conn,
                """
                SELECT id, course_id, title, module_type, display_order, estimated_duration_mins
                FROM course_modules
                WHERE course_id = ANY(%s::uuid[]) AND is_deleted = FALSE
                ORDER BY display_order
                """,
                (course_ids,),
            )
            mod_map: dict = {}
            for m in all_modules:
                mod_map.setdefault(str(m["course_id"]), []).append(dict(m))
            for c in courses:
                c = dict(c) if not isinstance(c, dict) else c
                c["course_modules"] = mod_map.get(str(c["id"]), [])

            # Attach enrollment status for this user
            placeholders = ", ".join(["%s"] * len(course_ids))
            enrollments = rows(
                conn,
                f"""
                SELECT course_id, status, score, completed_at
                FROM course_enrollments
                WHERE user_id = %s AND is_deleted = FALSE AND course_id IN ({placeholders})
                """,
                tuple([user_id] + course_ids),
            )
            enroll_map = {str(e["course_id"]): e for e in enrollments}
            for c in courses:
                c["enrollment"] = enroll_map.get(str(c["id"]))

        count_row = row(
            conn,
            "SELECT COUNT(*) AS total FROM courses WHERE organisation_id = %s AND is_published = TRUE AND is_deleted = FALSE",
            (org_id,),
        )
        total_count = (count_row or {}).get("total", 0)
        return {"items": courses, "total_count": total_count, "page": page, "page_size": page_size}

    @staticmethod
    async def list_managed_courses(conn, org_id: str, page: int = 1, page_size: int = 20, search: Optional[str] = None):
        """All courses (including drafts) for managers."""
        offset = (page - 1) * page_size

        conditions = ["c.organisation_id = %s", "c.is_deleted = FALSE"]
        params: list = [org_id]
        if search:
            conditions.append("c.title ILIKE %s")
            params.append(f"%{search}%")

        where_clause = " AND ".join(conditions)

        courses = rows(
            conn,
            f"""
            SELECT c.*
            FROM courses c
            WHERE {where_clause}
            ORDER BY c.created_at DESC
            LIMIT %s OFFSET %s
            """,
            tuple(params) + (page_size, offset),
        )

        if courses:
            course_ids = [c["id"] for c in courses]
            all_modules = rows(
                conn,
                "SELECT id, course_id, module_type FROM course_modules WHERE course_id = ANY(%s::uuid[])",
                (course_ids,),
            )
            mod_map: dict = {}
            for m in all_modules:
                mod_map.setdefault(str(m["course_id"]), []).append(dict(m))
            for c in courses:
                c["course_modules"] = mod_map.get(str(c["id"]), [])

        count_row = row(conn, f"SELECT COUNT(*) AS total FROM courses c WHERE {where_clause}", tuple(params))
        total_count = (count_row or {}).get("total", 0)
        return {"items": courses, "total_count": total_count, "page": page, "page_size": page_size}

    @staticmethod
    async def get_course(conn, course_id: str, org_id: str):
        """Get full course with all modules, slides, and questions (excluding soft-deleted)."""
        course = row(
            conn,
            "SELECT * FROM courses WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
            (course_id, org_id),
        )
        if not course:
            return None
        course = dict(course)

        modules = rows(
            conn,
            "SELECT * FROM course_modules WHERE course_id = %s AND is_deleted = FALSE ORDER BY display_order",
            (course_id,),
        )

        mod_ids = [m["id"] for m in modules]
        slides_map: dict = {}
        questions_map: dict = {}
        if mod_ids:
            all_slides = rows(
                conn,
                "SELECT * FROM course_slides WHERE module_id = ANY(%s::uuid[]) AND is_deleted = FALSE ORDER BY display_order",
                (mod_ids,),
            )
            for s in all_slides:
                slides_map.setdefault(str(s["module_id"]), []).append(dict(s))

            all_questions = rows(
                conn,
                "SELECT * FROM quiz_questions WHERE module_id = ANY(%s::uuid[]) AND is_deleted = FALSE ORDER BY display_order",
                (mod_ids,),
            )
            for q in all_questions:
                questions_map.setdefault(str(q["module_id"]), []).append(dict(q))

        for mod in modules:
            mod = dict(mod)
            mod["course_slides"] = slides_map.get(str(mod["id"]), [])
            mod["quiz_questions"] = questions_map.get(str(mod["id"]), [])

        course["course_modules"] = [dict(m) for m in modules]
        # Re-attach enriched module dicts
        enriched_mods = []
        for mod in modules:
            mod_dict = dict(mod)
            mod_dict["course_slides"] = slides_map.get(str(mod_dict["id"]), [])
            mod_dict["quiz_questions"] = questions_map.get(str(mod_dict["id"]), [])
            enriched_mods.append(mod_dict)
        course["course_modules"] = enriched_mods
        return course

    @staticmethod
    async def create_course(conn, body: CreateCourseRequest, org_id: str, created_by: str):
        """Create course with optional modules."""
        course = execute_returning(
            conn,
            """
            INSERT INTO courses
                (organisation_id, created_by, title, description, thumbnail_url,
                 estimated_duration_mins, passing_score, max_retakes, cert_validity_days,
                 is_mandatory, target_roles, target_location_ids, language,
                 is_published, ai_generated)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, FALSE, FALSE)
            RETURNING *
            """,
            (
                org_id, created_by, body.title, body.description, body.thumbnail_url,
                body.estimated_duration_mins, body.passing_score, body.max_retakes,
                body.cert_validity_days, body.is_mandatory,
                json.dumps(body.target_roles), json.dumps(body.target_location_ids),
                body.language,
            ),
        )
        course_id = course["id"]

        # Insert modules
        for i, mod in enumerate(body.modules):
            mod_row = execute_returning(
                conn,
                """
                INSERT INTO course_modules
                    (course_id, title, module_type, content_url, display_order, is_required, estimated_duration_mins)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    course_id, mod.title, mod.module_type, mod.content_url,
                    mod.display_order if mod.display_order is not None else i,
                    mod.is_required, mod.estimated_duration_mins,
                ),
            )
            mod_id = mod_row["id"]

            if mod.module_type == "slides":
                for j, slide in enumerate(mod.slides):
                    execute(
                        conn,
                        "INSERT INTO course_slides (module_id, title, body, image_url, display_order) VALUES (%s, %s, %s, %s, %s)",
                        (mod_id, slide.title, slide.body, slide.image_url, slide.display_order if slide.display_order is not None else j),
                    )
            elif mod.module_type == "quiz":
                for j, q in enumerate(mod.questions):
                    execute(
                        conn,
                        "INSERT INTO quiz_questions (module_id, question, question_type, image_url, options, explanation, display_order) VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s)",
                        (
                            mod_id, q.question, q.question_type, q.image_url,
                            json.dumps([o.model_dump() for o in q.options]),
                            q.explanation,
                            q.display_order if q.display_order is not None else j,
                        ),
                    )

        return await LmsService.get_course(conn, course_id, org_id)

    @staticmethod
    async def update_course(conn, course_id: str, body: UpdateCourseRequest, org_id: str):
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if updates:
            set_parts = []
            values = []
            for k, v in updates.items():
                if k in ("target_roles", "target_location_ids") and isinstance(v, list):
                    set_parts.append(f"{k} = %s::jsonb")
                    values.append(json.dumps(v))
                else:
                    set_parts.append(f"{k} = %s")
                    values.append(v)
            set_clause = ", ".join(set_parts)
            values.extend([course_id, org_id])
            execute(
                conn,
                f"UPDATE courses SET {set_clause}, updated_at = NOW() WHERE id = %s AND organisation_id = %s",
                tuple(values),
            )
        return await LmsService.get_course(conn, course_id, org_id)

    @staticmethod
    async def publish_course(conn, course_id: str, org_id: str):
        execute(
            conn,
            "UPDATE courses SET is_published = TRUE, was_published = TRUE, updated_at = NOW() WHERE id = %s AND organisation_id = %s",
            (course_id, org_id),
        )
        return {"success": True}

    @staticmethod
    async def get_enrollment_stats(conn, course_id: str, org_id: str):
        """Return active (in-progress / not-started) and completed enrollment counts."""
        check = row(conn, "SELECT id FROM courses WHERE id = %s AND organisation_id = %s", (course_id, org_id))
        if not check:
            return {"active_count": 0, "completed_count": 0}

        active_row = row(
            conn,
            "SELECT COUNT(*) AS cnt FROM course_enrollments WHERE course_id = %s AND status IN ('in_progress', 'not_started') AND is_deleted = FALSE",
            (course_id,),
        )
        completed_row = row(
            conn,
            "SELECT COUNT(*) AS cnt FROM course_enrollments WHERE course_id = %s AND status IN ('passed', 'failed') AND is_deleted = FALSE",
            (course_id,),
        )
        return {
            "active_count": (active_row or {}).get("cnt", 0),
            "completed_count": (completed_row or {}).get("cnt", 0),
        }

    @staticmethod
    async def unpublish_course(conn, course_id: str, org_id: str, cancel_enrollments: bool = False):
        """Unpublish a course. Optionally cancel all pending enrollments."""
        execute(
            conn,
            "UPDATE courses SET is_published = FALSE, was_published = TRUE, updated_at = NOW() WHERE id = %s AND organisation_id = %s",
            (course_id, org_id),
        )
        if cancel_enrollments:
            execute(
                conn,
                "UPDATE course_enrollments SET is_deleted = TRUE, updated_at = NOW() WHERE course_id = %s AND status IN ('in_progress', 'not_started')",
                (course_id,),
            )
        return {"success": True}

    @staticmethod
    async def delete_course(conn, course_id: str, org_id: str):
        execute(
            conn,
            "UPDATE courses SET is_deleted = TRUE, updated_at = NOW() WHERE id = %s AND organisation_id = %s",
            (course_id, org_id),
        )
        return {"success": True}

    @staticmethod
    async def start_ai_generation(conn, body: GenerateCourseRequest, org_id: str, created_by: str):
        """Queue an AI course generation job."""
        job = execute_returning(
            conn,
            """
            INSERT INTO ai_course_jobs (organisation_id, created_by, input_type, input_data, input_file_url, status)
            VALUES (%s, %s, %s, %s, %s, 'queued')
            RETURNING *
            """,
            (org_id, created_by, body.input_type, body.input_data, body.input_file_url),
        )
        return job

    @staticmethod
    async def get_ai_job(conn, job_id: str, org_id: str):
        result = row(
            conn,
            "SELECT * FROM ai_course_jobs WHERE id = %s AND organisation_id = %s",
            (job_id, org_id),
        )
        return result

    @staticmethod
    async def process_generation_job(job_id: str, body: GenerateCourseRequest, org_id: str, created_by: str):
        """Background task — calls Claude to generate the course, then creates it in DB.

        NOTE: This background task acquires its own connection since it runs outside
        the request lifecycle. It uses get_db_conn directly.
        """
        from config import settings
        from services.db import get_db_conn

        with get_db_conn() as conn:  # type: ignore[attr-defined]
            pass

        # Re-implement using a raw pool connection for the background task
        from services.db import _get_pool
        pool = _get_pool()
        bg_conn = pool.getconn()

        def _mark(status: str, course_id: str = None, error: str = None):
            update_parts = ["status = %s"]
            vals: list = [status]
            if course_id:
                update_parts.append("result_course_id = %s")
                vals.append(course_id)
            if error:
                update_parts.append("error_message = %s")
                vals.append(error[:500])
            vals.append(job_id)
            execute(bg_conn, f"UPDATE ai_course_jobs SET {', '.join(update_parts)} WHERE id = %s", tuple(vals))
            bg_conn.commit()

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
            course_row = execute_returning(
                bg_conn,
                """
                INSERT INTO courses
                    (organisation_id, created_by, title, description, is_published, ai_generated,
                     language, target_roles, target_location_ids, passing_score, max_retakes)
                VALUES (%s, %s, %s, %s, FALSE, TRUE, %s, %s::jsonb, '[]'::jsonb, 80, 3)
                RETURNING id
                """,
                (
                    org_id, created_by,
                    course_json.get("title", "AI Generated Course"),
                    course_json.get("description"),
                    body.language or "en",
                    json.dumps([body.target_role] if body.target_role else []),
                ),
            )
            course_id = course_row["id"]

            for i, mod in enumerate(course_json.get("modules", [])):
                mod_row = execute_returning(
                    bg_conn,
                    """
                    INSERT INTO course_modules
                        (course_id, title, module_type, content_url, display_order, is_required)
                    VALUES (%s, %s, %s, %s, %s, TRUE)
                    RETURNING id
                    """,
                    (
                        course_id,
                        mod.get("title", f"Module {i+1}"),
                        mod.get("module_type", "slides"),
                        mod.get("content_url"),
                        i,
                    ),
                )
                mod_id = mod_row["id"]

                if mod.get("module_type") == "slides":
                    for j, slide in enumerate(mod.get("slides", [])):
                        execute(
                            bg_conn,
                            "INSERT INTO course_slides (module_id, title, body, display_order) VALUES (%s, %s, %s, %s)",
                            (mod_id, slide.get("title"), slide.get("body"), slide.get("display_order", j)),
                        )

                elif mod.get("module_type") == "quiz":
                    for j, q in enumerate(mod.get("questions", [])):
                        options = [
                            {"id": str(uuid.uuid4()), "text": opt.get("text", ""), "is_correct": opt.get("is_correct", False)}
                            for opt in q.get("options", [])
                        ]
                        execute(
                            bg_conn,
                            "INSERT INTO quiz_questions (module_id, question, question_type, options, explanation, display_order) VALUES (%s, %s, %s, %s::jsonb, %s, %s)",
                            (
                                mod_id,
                                q.get("question", ""),
                                q.get("question_type", "multiple_choice"),
                                json.dumps(options),
                                q.get("explanation"),
                                q.get("display_order", j),
                            ),
                        )

            bg_conn.commit()
            _mark("completed", course_id=course_id)

        except Exception as exc:
            logger.error("Course generation job %s failed: %s", job_id, exc, exc_info=True)
            try:
                bg_conn.rollback()
            except Exception:
                pass
            _mark("failed", error=str(exc))
        finally:
            try:
                pool.putconn(bg_conn)
            except Exception:
                pass

    @staticmethod
    async def my_enrollments(conn, user_id: str, org_id: str):
        """All enrollments for current user with course details."""
        enrollment_rows = rows(
            conn,
            """
            SELECT e.*,
                   c.id AS course_id_v, c.title AS course_title, c.description AS course_description,
                   c.thumbnail_url AS course_thumbnail_url,
                   c.estimated_duration_mins AS course_estimated_duration_mins,
                   c.passing_score AS course_passing_score,
                   c.is_mandatory AS course_is_mandatory
            FROM course_enrollments e
            JOIN courses c ON c.id = e.course_id
            WHERE e.user_id = %s AND e.organisation_id = %s AND e.is_deleted = FALSE
            ORDER BY e.created_at DESC
            """,
            (user_id, org_id),
        )
        if not enrollment_rows:
            return []

        # Fetch module type counts per course
        course_ids = list({str(e["course_id"]) for e in enrollment_rows})
        all_mods = rows(
            conn,
            "SELECT course_id, id, module_type FROM course_modules WHERE course_id = ANY(%s::uuid[])",
            (course_ids,),
        )
        mod_map: dict = {}
        for m in all_mods:
            mod_map.setdefault(str(m["course_id"]), []).append({"id": m["id"], "module_type": m["module_type"]})

        result = []
        for e in enrollment_rows:
            e_dict = dict(e)
            e_dict["courses"] = {
                "id": e_dict.get("course_id"),
                "title": e_dict.pop("course_title", None),
                "description": e_dict.pop("course_description", None),
                "thumbnail_url": e_dict.pop("course_thumbnail_url", None),
                "estimated_duration_mins": e_dict.pop("course_estimated_duration_mins", None),
                "passing_score": e_dict.pop("course_passing_score", None),
                "is_mandatory": e_dict.pop("course_is_mandatory", None),
                "course_modules": mod_map.get(str(e_dict.get("course_id")), []),
            }
            e_dict.pop("course_id_v", None)
            result.append(e_dict)
        return result

    @staticmethod
    async def list_org_locations(conn, org_id: str):
        """Return all active locations for the org."""
        return rows(
            conn,
            "SELECT id, name FROM locations WHERE organisation_id = %s AND is_deleted = FALSE ORDER BY name",
            (org_id,),
        )

    @staticmethod
    async def list_enrollable_users(conn, course_id: str, org_id: str):
        """Return all org users with their enrollment status for this course."""
        profiles = rows(
            conn,
            "SELECT id, full_name, role, location_id FROM profiles WHERE organisation_id = %s AND is_deleted = FALSE ORDER BY full_name",
            (org_id,),
        )
        if not profiles:
            return []

        user_ids = [p["id"] for p in profiles]
        placeholders = ", ".join(["%s"] * len(user_ids))
        enrollments = rows(
            conn,
            f"SELECT user_id, status, is_mandatory FROM course_enrollments WHERE course_id = %s AND is_deleted = FALSE AND user_id IN ({placeholders})",
            tuple([course_id] + user_ids),
        )
        enroll_map = {str(e["user_id"]): e for e in enrollments}

        return [
            {
                "id": p["id"],
                "full_name": p["full_name"],
                "role": p["role"],
                "location_id": p.get("location_id"),
                "enrollment_status": enroll_map[str(p["id"])]["status"] if str(p["id"]) in enroll_map else None,
            }
            for p in profiles
        ]

    @staticmethod
    async def enroll_users(conn, body: EnrollRequest, org_id: str, enrolled_by: str):
        """Enroll one or more users in a course."""
        placeholders = ", ".join(["%s"] * len(body.user_ids))
        existing = rows(
            conn,
            f"SELECT user_id FROM course_enrollments WHERE course_id = %s AND is_deleted = FALSE AND user_id IN ({placeholders})",
            tuple([body.course_id] + body.user_ids),
        )
        already_enrolled = {str(e["user_id"]) for e in existing}

        inserted = []
        for uid in body.user_ids:
            if str(uid) in already_enrolled:
                continue
            new_enrollment = execute_returning(
                conn,
                """
                INSERT INTO course_enrollments
                    (course_id, user_id, organisation_id, enrolled_by, status, is_mandatory)
                VALUES (%s, %s, %s, %s, 'not_started', %s)
                RETURNING *
                """,
                (body.course_id, uid, org_id, enrolled_by, body.is_mandatory),
            )
            if new_enrollment:
                inserted.append(new_enrollment)

        if inserted:
            # Notify each enrolled user
            try:
                course_data = row(
                    conn,
                    "SELECT title, estimated_duration FROM courses WHERE id = %s",
                    (body.course_id,),
                ) or {}
                course_title = course_data.get("title", "Training course")
                duration = course_data.get("estimated_duration")
                notif_body = f"{duration} mins" if duration else None
                import asyncio as _asyncio
                from services import notification_service as _ns
                for enrollment_row in inserted:
                    _asyncio.create_task(_ns.notify(
                        org_id=org_id,
                        recipient_user_id=str(enrollment_row["user_id"]),
                        type="course_enrolled",
                        title=f"New training: {course_title}",
                        body=notif_body,
                        entity_type="course_enrollment",
                        entity_id=str(enrollment_row["id"]),
                    ))
            except Exception:
                pass

        return {"enrolled": len(inserted), "skipped": len(body.user_ids) - len(inserted)}

    @staticmethod
    async def update_progress(conn, enrollment_id: str, body: UpdateProgressRequest, user_id: str):
        """Update module progress for an enrollment."""
        enrollment = row(
            conn,
            "SELECT id, user_id, status FROM course_enrollments WHERE id = %s",
            (enrollment_id,),
        )
        if not enrollment or str(enrollment["user_id"]) != user_id:
            raise ValueError("Enrollment not found or access denied")

        existing_progress = row(
            conn,
            "SELECT id, time_spent_seconds, started_at FROM module_progress WHERE enrollment_id = %s AND module_id = %s",
            (enrollment_id, body.module_id),
        )

        if existing_progress:
            update_parts = ["status = %s"]
            vals: list = [body.status]
            if body.status == "in_progress" and not existing_progress.get("started_at"):
                update_parts.append("started_at = NOW()")
            if body.status == "completed":
                update_parts.append("completed_at = NOW()")
            if body.time_spent_seconds:
                update_parts.append("time_spent_seconds = COALESCE(time_spent_seconds, 0) + %s")
                vals.append(body.time_spent_seconds)
            vals.append(existing_progress["id"])
            execute(
                conn,
                f"UPDATE module_progress SET {', '.join(update_parts)} WHERE id = %s",
                tuple(vals),
            )
        else:
            insert_parts = ["enrollment_id", "module_id", "status"]
            insert_vals: list = [enrollment_id, body.module_id, body.status]
            if body.status == "in_progress":
                insert_parts.append("started_at")
                insert_vals.append("NOW()")  # handled inline below
            if body.status == "completed":
                insert_parts.append("completed_at")
                insert_vals.append("NOW()")
            if body.time_spent_seconds:
                insert_parts.append("time_spent_seconds")
                insert_vals.append(body.time_spent_seconds)

            # Build parameterized insert
            cols = "enrollment_id, module_id, status"
            placeholders_list = ["%s", "%s", "%s"]
            vals2: list = [enrollment_id, body.module_id, body.status]
            if body.status == "in_progress":
                cols += ", started_at"
                placeholders_list.append("NOW()")
            if body.status == "completed":
                cols += ", completed_at"
                placeholders_list.append("NOW()")
            if body.time_spent_seconds:
                cols += ", time_spent_seconds"
                placeholders_list.append("%s")
                vals2.append(body.time_spent_seconds)

            execute(
                conn,
                f"INSERT INTO module_progress ({cols}) VALUES ({', '.join(placeholders_list)})",
                tuple(vals2),
            )

        # Update enrollment status to in_progress if not_started
        if enrollment["status"] == "not_started":
            execute(
                conn,
                "UPDATE course_enrollments SET status = 'in_progress', started_at = NOW(), current_module_id = %s WHERE id = %s",
                (body.module_id, enrollment_id),
            )
        elif enrollment["status"] == "in_progress":
            execute(
                conn,
                "UPDATE course_enrollments SET current_module_id = %s WHERE id = %s",
                (body.module_id, enrollment_id),
            )

        # Auto-pass: if all required modules are now completed, mark enrollment as passed
        if body.status == "completed" and enrollment["status"] in ("not_started", "in_progress"):
            enroll_info = row(
                conn,
                "SELECT course_id FROM course_enrollments WHERE id = %s",
                (enrollment_id,),
            )
            if enroll_info:
                course_id = enroll_info["course_id"]
                required_mods = rows(
                    conn,
                    "SELECT id FROM course_modules WHERE course_id = %s AND is_required = TRUE AND is_deleted = FALSE",
                    (course_id,),
                )
                required_ids = {str(m["id"]) for m in required_mods}
                if required_ids:
                    done_mods = rows(
                        conn,
                        "SELECT module_id FROM module_progress WHERE enrollment_id = %s AND status = 'completed'",
                        (enrollment_id,),
                    )
                    done_ids = {str(m["module_id"]) for m in done_mods}
                    if required_ids.issubset(done_ids):
                        execute(
                            conn,
                            "UPDATE course_enrollments SET status = 'passed', score = 100, completed_at = NOW() WHERE id = %s",
                            (enrollment_id,),
                        )

        return {"success": True}

    @staticmethod
    async def submit_quiz(conn, enrollment_id: str, body: SubmitQuizRequest, user_id: str):
        """Score a quiz attempt and update enrollment."""
        enrollment = row(
            conn,
            """
            SELECT e.*, c.passing_score, c.max_retakes
            FROM course_enrollments e
            JOIN courses c ON c.id = e.course_id
            WHERE e.id = %s
            """,
            (enrollment_id,),
        )
        if not enrollment or str(enrollment["user_id"]) != user_id:
            raise ValueError("Enrollment not found or access denied")

        # Fetch questions for scoring
        questions = rows(
            conn,
            "SELECT id, options FROM quiz_questions WHERE module_id = %s AND is_deleted = FALSE",
            (body.module_id,),
        )
        q_map = {str(q["id"]): q for q in questions}

        # Score answers
        scored = []
        correct = 0
        for ans in body.answers:
            q = q_map.get(str(ans.question_id))
            is_correct = False
            if q:
                opts = q["options"]
                if isinstance(opts, str):
                    opts = json.loads(opts)
                for opt in opts:
                    if opt["id"] == ans.selected_option and opt.get("is_correct"):
                        is_correct = True
                        break
            if is_correct:
                correct += 1
            scored.append({"question_id": ans.question_id, "selected_option": ans.selected_option, "is_correct": is_correct})

        total = len(body.answers)
        score_pct = round((correct / total) * 100) if total > 0 else 0
        passing = enrollment.get("passing_score") or 80
        passed = score_pct >= passing

        attempt_num = (enrollment.get("attempt_count") or 0) + 1
        execute(
            conn,
            """
            INSERT INTO quiz_attempts
                (enrollment_id, module_id, attempt_number, score, passed, answers, completed_at)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, NOW())
            """,
            (enrollment_id, body.module_id, attempt_num, score_pct, passed, json.dumps(scored)),
        )

        # Update enrollment
        update_parts = ["attempt_count = %s", "score = %s"]
        update_vals: list = [attempt_num, score_pct]
        if passed:
            update_parts.extend(["status = 'passed'", "completed_at = NOW()"])
        else:
            max_retakes = enrollment.get("max_retakes")
            if max_retakes is not None and attempt_num >= max_retakes:
                update_parts.append("status = 'failed'")
        update_vals.append(enrollment_id)
        execute(
            conn,
            f"UPDATE course_enrollments SET {', '.join(update_parts)} WHERE id = %s",
            tuple(update_vals),
        )

        return {"score": score_pct, "passed": passed, "correct": correct, "total": total, "attempt_number": attempt_num}

    @staticmethod
    async def list_enrollments(conn, org_id: str, course_id: str = None, user_id_filter: str = None, status: str = None, page: int = 1, page_size: int = 20):
        offset = (page - 1) * page_size
        conditions = ["e.organisation_id = %s", "e.is_deleted = FALSE"]
        params: list = [org_id]
        if course_id:
            conditions.append("e.course_id = %s")
            params.append(course_id)
        if user_id_filter:
            conditions.append("e.user_id = %s")
            params.append(user_id_filter)
        if status:
            conditions.append("e.status = %s")
            params.append(status)
        where_clause = " AND ".join(conditions)

        result = rows(
            conn,
            f"""
            SELECT e.*,
                   c.id AS c_id, c.title AS c_title,
                   p.id AS p_id, p.full_name AS p_full_name, p.role AS p_role
            FROM course_enrollments e
            LEFT JOIN courses c ON c.id = e.course_id
            LEFT JOIN profiles p ON p.id = e.user_id
            WHERE {where_clause}
            ORDER BY e.created_at DESC
            LIMIT %s OFFSET %s
            """,
            tuple(params) + (page_size, offset),
        )

        items = []
        for r in result:
            r_dict = dict(r)
            r_dict["courses"] = {"id": r_dict.pop("c_id", None), "title": r_dict.pop("c_title", None)}
            r_dict["profiles"] = {"id": r_dict.pop("p_id", None), "full_name": r_dict.pop("p_full_name", None), "role": r_dict.pop("p_role", None)}
            items.append(r_dict)

        return {"items": items, "total_count": len(items), "page": page, "page_size": page_size}

    @staticmethod
    async def get_analytics_completion(conn, org_id: str):
        enrollment_rows = rows(
            conn,
            """
            SELECT e.status, c.title AS course_title
            FROM course_enrollments e
            JOIN courses c ON c.id = e.course_id
            WHERE e.organisation_id = %s AND e.is_deleted = FALSE
            """,
            (org_id,),
        )
        total = len(enrollment_rows)
        passed = sum(1 for e in enrollment_rows if e["status"] == "passed")
        in_progress = sum(1 for e in enrollment_rows if e["status"] == "in_progress")
        not_started = sum(1 for e in enrollment_rows if e["status"] == "not_started")
        failed = sum(1 for e in enrollment_rows if e["status"] == "failed")
        return {
            "total_enrollments": total,
            "passed": passed,
            "in_progress": in_progress,
            "not_started": not_started,
            "failed": failed,
            "completion_rate": round(passed / total * 100) if total > 0 else 0,
        }

    @staticmethod
    async def save_course_structure(conn, course_id: str, org_id: str, modules: list):
        """
        Replace all modules/slides/questions for a course with the provided structure.
        Soft-deletes existing modules, then inserts the new set.
        """
        course_check = row(
            conn,
            "SELECT id FROM courses WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
            (course_id, org_id),
        )
        if not course_check:
            raise ValueError("Course not found")

        # Soft-delete all existing modules (cascades to slides/questions via app logic)
        existing_mods = rows(
            conn,
            "SELECT id FROM course_modules WHERE course_id = %s AND is_deleted = FALSE",
            (course_id,),
        )
        if existing_mods:
            mod_ids = [m["id"] for m in existing_mods]
            execute(conn, "UPDATE course_modules SET is_deleted = TRUE WHERE id = ANY(%s::uuid[])", (mod_ids,))
            execute(conn, "UPDATE course_slides SET is_deleted = TRUE WHERE module_id = ANY(%s::uuid[])", (mod_ids,))
            execute(conn, "UPDATE quiz_questions SET is_deleted = TRUE WHERE module_id = ANY(%s::uuid[])", (mod_ids,))

        # Insert new modules
        for i, mod in enumerate(modules):
            new_mod = execute_returning(
                conn,
                """
                INSERT INTO course_modules
                    (course_id, title, module_type, content_url, display_order, is_required,
                     estimated_duration_mins, is_deleted)
                VALUES (%s, %s, %s, %s, %s, %s, %s, FALSE)
                RETURNING id
                """,
                (
                    course_id,
                    mod.get("title", "Untitled Module"),
                    mod.get("module_type", "slides"),
                    mod.get("content_url"),
                    mod.get("display_order", i),
                    mod.get("is_required", True),
                    mod.get("estimated_duration_mins"),
                ),
            )
            mod_id = new_mod["id"]

            if mod.get("module_type") == "slides":
                for j, slide in enumerate(mod.get("slides", [])):
                    execute(
                        conn,
                        "INSERT INTO course_slides (module_id, title, body, image_url, display_order, is_deleted) VALUES (%s, %s, %s, %s, %s, FALSE)",
                        (mod_id, slide.get("title"), slide.get("body"), slide.get("image_url"), slide.get("display_order", j)),
                    )
            elif mod.get("module_type") == "quiz":
                for j, q in enumerate(mod.get("questions", [])):
                    execute(
                        conn,
                        "INSERT INTO quiz_questions (module_id, question, question_type, image_url, options, explanation, display_order, is_deleted) VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, FALSE)",
                        (
                            mod_id,
                            q.get("question", ""),
                            q.get("question_type", "multiple_choice"),
                            q.get("image_url"),
                            json.dumps(q.get("options", [])),
                            q.get("explanation"),
                            q.get("display_order", j),
                        ),
                    )

        return await LmsService.get_course(conn, course_id, org_id)

    @staticmethod
    async def get_enrollment_with_progress(conn, enrollment_id: str, user_id: str):
        """Get a single enrollment with full course structure + module progress."""
        enrollment = row(
            conn,
            "SELECT * FROM course_enrollments WHERE id = %s AND user_id = %s AND is_deleted = FALSE",
            (enrollment_id, user_id),
        )
        if not enrollment:
            raise ValueError("Enrollment not found")

        course = await LmsService.get_course(conn, str(enrollment["course_id"]), None)

        progress = rows(
            conn,
            "SELECT * FROM module_progress WHERE enrollment_id = %s",
            (enrollment_id,),
        )

        return {
            "enrollment": dict(enrollment),
            "course": course,
            "module_progress": progress,
        }

    @staticmethod
    async def duplicate_course(conn, course_id: str, org_id: str, created_by: str):
        """Duplicate a course (all modules/slides/questions) as a new Draft."""
        src = row(
            conn,
            "SELECT * FROM courses WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
            (course_id, org_id),
        )
        if not src:
            raise ValueError("Course not found")
        src = dict(src)

        new_course = execute_returning(
            conn,
            """
            INSERT INTO courses
                (organisation_id, created_by, title, description, thumbnail_url,
                 estimated_duration_mins, passing_score, max_retakes, cert_validity_days,
                 is_mandatory, target_roles, target_location_ids, language,
                 is_published, was_published, ai_generated, parent_course_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, FALSE, FALSE, %s, %s)
            RETURNING id
            """,
            (
                org_id, created_by,
                f"{src['title']} (Copy)",
                src.get("description"),
                src.get("thumbnail_url"),
                src.get("estimated_duration_mins"),
                src.get("passing_score", 80),
                src.get("max_retakes"),
                src.get("cert_validity_days"),
                src.get("is_mandatory", False),
                json.dumps(src.get("target_roles", [])),
                json.dumps(src.get("target_location_ids", [])),
                src.get("language", "en"),
                src.get("ai_generated", False),
                course_id,
            ),
        )
        new_id = new_course["id"]

        # Copy modules
        orig_mods = rows(
            conn,
            "SELECT * FROM course_modules WHERE course_id = %s AND is_deleted = FALSE ORDER BY display_order",
            (course_id,),
        )
        for mod in orig_mods:
            new_mod = execute_returning(
                conn,
                """
                INSERT INTO course_modules
                    (course_id, title, module_type, content_url, display_order, is_required, estimated_duration_mins)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    new_id,
                    mod["title"],
                    mod["module_type"],
                    mod.get("content_url"),
                    mod.get("display_order", 0),
                    mod.get("is_required", True),
                    mod.get("estimated_duration_mins"),
                ),
            )
            new_mod_id = new_mod["id"]

            orig_slides = rows(
                conn,
                "SELECT * FROM course_slides WHERE module_id = %s AND is_deleted = FALSE ORDER BY display_order",
                (mod["id"],),
            )
            for slide in orig_slides:
                execute(
                    conn,
                    "INSERT INTO course_slides (module_id, title, body, image_url, display_order) VALUES (%s, %s, %s, %s, %s)",
                    (new_mod_id, slide.get("title"), slide.get("body"), slide.get("image_url"), slide.get("display_order", 0)),
                )

            orig_questions = rows(
                conn,
                "SELECT * FROM quiz_questions WHERE module_id = %s AND is_deleted = FALSE ORDER BY display_order",
                (mod["id"],),
            )
            for q in orig_questions:
                execute(
                    conn,
                    "INSERT INTO quiz_questions (module_id, question, question_type, image_url, options, explanation, display_order) VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s)",
                    (
                        new_mod_id,
                        q["question"],
                        q.get("question_type", "multiple_choice"),
                        q.get("image_url"),
                        json.dumps(q.get("options", [])) if isinstance(q.get("options"), list) else q.get("options", "[]"),
                        q.get("explanation"),
                        q.get("display_order", 0),
                    ),
                )

        return {"id": new_id}
