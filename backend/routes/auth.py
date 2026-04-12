import logging
import uuid
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from dependencies import get_current_user, require_admin, get_db
from services.auth_service import AuthService
from services.db import rows, execute_returning, execute
from models.auth import ChangePasswordRequest

_log = logging.getLogger(__name__)


def _safe_delete(conn, sql: str, params: tuple = ()) -> None:
    """
    Execute a DELETE inside a savepoint so that a failure (wrong table name,
    constraint, etc.) rolls back only that statement and leaves the outer
    transaction alive for the next delete.
    """
    try:
        with conn.cursor() as cur:
            cur.execute("SAVEPOINT _demo_del")
            try:
                cur.execute(sql, params)
                cur.execute("RELEASE SAVEPOINT _demo_del")
            except Exception as exc:
                cur.execute("ROLLBACK TO SAVEPOINT _demo_del")
                cur.execute("RELEASE SAVEPOINT _demo_del")
                _log.warning("demo workspace cleanup skipped (%s): %s", sql.split()[2], exc)
    except Exception as exc:
        _log.error("savepoint management failed: %s", exc)

router = APIRouter()


# login and logout are removed — authentication is now handled by Keycloak.
# Clients should obtain tokens directly from Keycloak using the standard
# OAuth2 / OIDC password or authorization-code flow, and revoke them via
# Keycloak's token revocation endpoint.


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
):
    return await AuthService.change_password(body, current_user)


class DemoStartRequest(BaseModel):
    company_name: str = ""


class DemoStartResponse(BaseModel):
    email: str
    password: str
    org_id: str
    session_id: str


@router.post("/demo-start", response_model=DemoStartResponse)
async def demo_start(
    body: DemoStartRequest,
    conn=Depends(get_db),
):
    """
    For demo purposes: create a fresh org + super_admin profile + onboarding session.
    NOTE: No Supabase Auth user is created here. The caller is responsible for
    creating the corresponding Keycloak user and linking it via the profile id.
    Returns credentials so the caller can complete Keycloak user setup immediately.
    """
    uid = str(uuid.uuid4())[:8]

    company_name = body.company_name.strip() or f"Demo Company {uid.upper()}"
    slug = re.sub(r"[^a-z0-9]+", "-", company_name.lower()).strip("-") + f"-{uid}"
    email = f"demo-{uid}@sprout.demo"
    password = f"Demo{uid}!"

    # 1. Create organisation
    org = execute_returning(
        conn,
        """
        INSERT INTO organisations (name, slug, is_active, is_deleted)
        VALUES (%s, %s, TRUE, FALSE)
        RETURNING *
        """,
        (company_name, slug),
    )
    if not org:
        raise HTTPException(status_code=500, detail="Failed to create organisation.")
    org_id = str(org["id"])

    # 2. Create profile (Keycloak user creation must be done separately by the caller)
    profile_id = str(uuid.uuid4())
    try:
        execute_returning(
            conn,
            """
            INSERT INTO profiles
                (id, organisation_id, full_name, role, language, is_active, is_deleted)
            VALUES (%s, %s, %s, 'super_admin', 'en', TRUE, FALSE)
            RETURNING id
            """,
            (profile_id, org_id, f"Admin ({company_name})"),
        )
    except Exception as e:
        execute(conn, "DELETE FROM organisations WHERE id = %s", (org_id,))
        raise HTTPException(status_code=500, detail=f"Failed to create profile: {e}")

    # 3. Create onboarding session
    session_row = execute_returning(
        conn,
        """
        INSERT INTO onboarding_sessions (organisation_id, current_step, status)
        VALUES (%s, 1, 'in_progress')
        RETURNING id
        """,
        (org_id,),
    )
    session_id = str(session_row["id"]) if session_row else ""

    return DemoStartResponse(
        email=email,
        password=password,
        org_id=org_id,
        session_id=session_id,
    )


@router.delete("/demo/{org_id}")
async def delete_demo_workspace(
    org_id: str,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    """
    Permanently delete a demo workspace and all its data.
    Requires super_admin role. User must belong to the org being deleted.
    NOTE: Corresponding Keycloak users must be deleted separately by the caller.
    """
    app_meta = current_user.get("app_metadata") or {}

    if app_meta.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Super-admin access required.")

    caller_org = app_meta.get("organisation_id")
    if str(caller_org) != str(org_id):
        raise HTTPException(status_code=403, detail="Not your organisation.")

    # Collect Keycloak user IDs before we delete profiles
    profile_rows = rows(conn, "SELECT id FROM profiles WHERE organisation_id = %s AND is_deleted = false", (org_id,))
    keycloak_user_ids = [str(r["id"]) for r in profile_rows]

    # ── Phase 1: Leaf tables (no organisation_id — delete via parent subquery) ──

    # Issue children
    _safe_delete(conn, "DELETE FROM issue_custom_fields WHERE category_id IN (SELECT id FROM issue_categories WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM issue_attachments WHERE issue_id IN (SELECT id FROM issues WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM issue_comments WHERE issue_id IN (SELECT id FROM issues WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM issue_custom_responses WHERE issue_id IN (SELECT id FROM issues WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM issue_status_history WHERE issue_id IN (SELECT id FROM issues WHERE organisation_id = %s)", (org_id,))

    # Incident children (incidents uses org_id, not organisation_id)
    _safe_delete(conn, "DELETE FROM incident_attachments WHERE incident_id IN (SELECT id FROM incidents WHERE org_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM incident_status_history WHERE incident_id IN (SELECT id FROM incidents WHERE org_id = %s)", (org_id,))

    # Task children
    _safe_delete(conn, "DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM task_message_reads WHERE task_id IN (SELECT id FROM tasks WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM task_messages WHERE task_id IN (SELECT id FROM tasks WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM task_status_history WHERE task_id IN (SELECT id FROM tasks WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM task_attachments WHERE task_id IN (SELECT id FROM tasks WHERE organisation_id = %s)", (org_id,))

    # CAP children
    _safe_delete(conn, "DELETE FROM cap_items WHERE cap_id IN (SELECT id FROM corrective_action_plans WHERE organisation_id = %s)", (org_id,))

    # Announcement children
    _safe_delete(conn, "DELETE FROM announcement_receipts WHERE announcement_id IN (SELECT id FROM announcements WHERE organisation_id = %s)", (org_id,))

    # Form children (form_submissions and form_sections have no organisation_id — go via form_templates)
    _safe_delete(conn, "DELETE FROM audit_field_scores WHERE field_id IN (SELECT ff.id FROM form_fields ff JOIN form_sections fs ON fs.id = ff.section_id JOIN form_templates ft ON ft.id = fs.form_template_id WHERE ft.organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM form_responses WHERE submission_id IN (SELECT fs.id FROM form_submissions fs JOIN form_templates ft ON ft.id = fs.form_template_id WHERE ft.organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM audit_signatures WHERE submission_id IN (SELECT fs.id FROM form_submissions fs JOIN form_templates ft ON ft.id = fs.form_template_id WHERE ft.organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM form_fields WHERE section_id IN (SELECT fs.id FROM form_sections fs JOIN form_templates ft ON ft.id = fs.form_template_id WHERE ft.organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM audit_section_weights WHERE section_id IN (SELECT fs.id FROM form_sections fs JOIN form_templates ft ON ft.id = fs.form_template_id WHERE ft.organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM audit_configs WHERE template_id IN (SELECT id FROM form_templates WHERE organisation_id = %s)", (org_id,))

    # Workflow children
    _safe_delete(conn, "DELETE FROM workflow_stage_instances WHERE instance_id IN (SELECT id FROM workflow_instances WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM workflow_routing_rules WHERE definition_id IN (SELECT id FROM workflow_definitions WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM workflow_stages WHERE definition_id IN (SELECT id FROM workflow_definitions WHERE organisation_id = %s)", (org_id,))

    # Shift children
    _safe_delete(conn, "DELETE FROM open_shift_claims WHERE shift_id IN (SELECT id FROM shifts WHERE organisation_id = %s)", (org_id,))

    # Vendor children
    _safe_delete(conn, "DELETE FROM vendor_category_access WHERE vendor_id IN (SELECT id FROM vendors WHERE organisation_id = %s)", (org_id,))

    # Onboarding children
    _safe_delete(conn, "DELETE FROM role_mappings WHERE session_id IN (SELECT id FROM onboarding_sessions WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM onboarding_employees WHERE session_id IN (SELECT id FROM onboarding_sessions WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM onboarding_assets WHERE session_id IN (SELECT id FROM onboarding_sessions WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM onboarding_vendors WHERE session_id IN (SELECT id FROM onboarding_sessions WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM onboarding_locations WHERE session_id IN (SELECT id FROM onboarding_sessions WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM onboarding_selections WHERE session_id IN (SELECT id FROM onboarding_sessions WHERE organisation_id = %s)", (org_id,))

    # LMS children
    _safe_delete(conn, "DELETE FROM module_progress WHERE enrollment_id IN (SELECT id FROM course_enrollments WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM quiz_attempts WHERE enrollment_id IN (SELECT id FROM course_enrollments WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM quiz_questions WHERE slide_id IN (SELECT cs.id FROM course_slides cs JOIN course_modules cm ON cm.id = cs.module_id JOIN courses c ON c.id = cm.course_id WHERE c.organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM course_slides WHERE module_id IN (SELECT cm.id FROM course_modules cm JOIN courses c ON c.id = cm.course_id WHERE c.organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM course_modules WHERE course_id IN (SELECT id FROM courses WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM course_translations WHERE course_id IN (SELECT id FROM courses WHERE organisation_id = %s)", (org_id,))
    _safe_delete(conn, "DELETE FROM learning_path_items WHERE path_id IN (SELECT id FROM learning_paths WHERE organisation_id = %s)", (org_id,))

    # ── Phase 2: Tables with organisation_id (mid-level, in dependency order) ──
    for tbl in [
        "incidents",            # uses org_id — handled separately below
        "issues", "issue_categories", "issue_escalation_rules", "escalation_rules",
        "tasks", "task_templates",
        "corrective_action_plans", "corrective_actions",
        "announcements",
        "form_submissions",     # no org_id — delete via form_templates join below
        "form_sections",        # no org_id — delete via form_templates join below
        "form_assignments", "form_templates",
        "workflow_instances", "workflow_definitions",
        "shifts", "shift_templates", "shift_swap_requests",
        "leave_requests", "attendance_records", "attendance_rules",
        "staff_availability", "break_records",
        "vendors",
        "onboarding_sessions",
        "course_enrollments", "courses", "learning_paths", "repair_guides",
        "user_badge_awards", "user_points",
        "assets", "notifications",
        "ai_course_jobs", "ai_request_log", "ai_schedule_jobs",
        "badge_configs", "leaderboard_configs", "face_profiles",
        "profiles",
        "locations",
    ]:
        if tbl == "incidents":
            _safe_delete(conn, "DELETE FROM incidents WHERE org_id = %s", (org_id,))
        elif tbl in ("form_submissions", "form_sections"):
            _safe_delete(conn, f"DELETE FROM {tbl} WHERE form_template_id IN (SELECT id FROM form_templates WHERE organisation_id = %s)", (org_id,))
        else:
            _safe_delete(conn, f"DELETE FROM {tbl} WHERE organisation_id = %s", (org_id,))

    # ── Phase 3: Organisation root ─────────────────────────────────────────────
    execute(conn, "DELETE FROM organisations WHERE id = %s", (org_id,))

    # ── Phase 4: Disable Keycloak accounts (best-effort) ──────────────────────
    # We disable rather than hard-delete so Keycloak audit logs are preserved.
    if keycloak_user_ids:
        try:
            from services.keycloak_admin import disable_keycloak_user
            for uid in keycloak_user_ids:
                try:
                    await disable_keycloak_user(uid)
                except Exception as kc_err:
                    _log.warning("Keycloak disable failed for %s during demo deletion: %s", uid, kc_err)
        except Exception as kc_err:
            _log.error("Keycloak cleanup skipped entirely: %s", kc_err)

    return {"ok": True}
