import uuid
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from dependencies import get_current_user, require_admin, get_db
from services.auth_service import AuthService
from services.db import rows, execute_returning, execute
from models.auth import ChangePasswordRequest

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

    # Delete all org data in dependency order (children before parents)
    for tbl in [
        # Issue children
        "issue_attachments", "issue_comments", "issue_status_history",
        # Task children
        "task_assignments", "task_read_receipts", "task_comments",
        # Workflow children
        "workflow_stage_instances", "workflow_instances",
        # Form children
        "form_submissions", "form_assignments",
        # LMS children
        "course_enrollments", "ai_course_jobs",
        # Gamification
        "user_badge_awards", "user_points",
        # Shift children
        "shift_claims", "shift_swaps", "leave_requests", "timesheets",
        # Onboarding children
        "onboarding_selections", "role_mappings", "onboarding_employees",
        "onboarding_assets", "onboarding_vendors", "onboarding_locations",
        # Main entities
        "issues", "tasks", "task_templates",
        "shifts", "shift_templates", "attendance_rules",
        "repair_guides", "courses", "assets", "vendors",
        "workflow_definitions", "issue_categories",
        "form_templates", "badge_configs", "leaderboard_configs",
        "locations", "onboarding_sessions",
        # Users
        "profiles",
    ]:
        try:
            execute(conn, f"DELETE FROM {tbl} WHERE organisation_id = %s", (org_id,))
        except Exception:
            pass  # Table may not exist or column name differs — continue

    # Delete the organisation itself
    execute(conn, "DELETE FROM organisations WHERE id = %s", (org_id,))

    return {"ok": True}
