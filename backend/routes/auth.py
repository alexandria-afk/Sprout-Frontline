import uuid
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from dependencies import get_current_user, require_admin
from services.auth_service import AuthService
from services.supabase_client import get_supabase
from models.auth import LoginRequest, ChangePasswordRequest

router = APIRouter()


@router.post("/login")
async def login(body: LoginRequest):
    return await AuthService.login(body)


@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    return await AuthService.logout(current_user)


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
async def demo_start(body: DemoStartRequest):
    """
    For demo purposes: create a fresh org + super_admin user + onboarding session.
    Returns credentials so the caller can sign the user in immediately.
    """
    sb = get_supabase()
    uid = str(uuid.uuid4())[:8]

    company_name = body.company_name.strip() or f"Demo Company {uid.upper()}"
    slug = re.sub(r"[^a-z0-9]+", "-", company_name.lower()).strip("-") + f"-{uid}"
    email = f"demo-{uid}@sprout.demo"
    password = f"Demo{uid}!"

    # 1. Create organisation
    org_res = sb.table("organisations").insert({
        "name": company_name,
        "slug": slug,
        "is_active": True,
        "is_deleted": False,
    }).execute()
    if not org_res.data:
        raise HTTPException(status_code=500, detail="Failed to create organisation.")
    org_id = org_res.data[0]["id"]

    # 2. Create auth user with password (not invite — we need immediate sign-in)
    try:
        auth_res = sb.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,
            "app_metadata": {"organisation_id": org_id, "role": "super_admin"},
            "user_metadata": {"full_name": f"Admin ({company_name})"},
        })
        user_id = str(auth_res.user.id)
    except Exception as e:
        sb.table("organisations").delete().eq("id", org_id).execute()
        raise HTTPException(status_code=500, detail=f"Failed to create user: {e}")

    # 3. Create profile
    try:
        sb.table("profiles").insert({
            "id": user_id,
            "organisation_id": org_id,
            "full_name": f"Admin ({company_name})",
            "role": "super_admin",
            "language": "en",
            "is_active": True,
            "is_deleted": False,
        }).execute()
    except Exception as e:
        sb.auth.admin.delete_user(user_id)
        sb.table("organisations").delete().eq("id", org_id).execute()
        raise HTTPException(status_code=500, detail=f"Failed to create profile: {e}")

    # 4. Create onboarding session
    sess_res = sb.table("onboarding_sessions").insert({
        "organisation_id": org_id,
        "current_step": 1,
        "status": "in_progress",
    }).execute()
    session_id = sess_res.data[0]["id"] if sess_res.data else ""

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
):
    """
    Permanently delete a demo workspace and all its data.
    Requires admin or super_admin role. User must belong to the org being deleted.
    """
    app_meta = current_user.get("app_metadata") or {}

    # Only super_admin may wipe an org
    if app_meta.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Super-admin access required.")

    sb = get_supabase()

    # Verify caller belongs to this org
    caller_org = app_meta.get("organisation_id")
    if str(caller_org) != str(org_id):
        raise HTTPException(status_code=403, detail="Not your organisation.")

    # Collect user IDs to delete from auth
    profiles_res = sb.table("profiles").select("id").eq("organisation_id", org_id).execute()
    user_ids = [p["id"] for p in (profiles_res.data or [])]

    # Delete all org data in dependency order
    # Children before parents (FK constraints)
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
            sb.table(tbl).delete().eq("organisation_id", org_id).execute()
        except Exception:
            pass  # Table may not exist or column name differs — continue

    # Delete the organisation itself
    sb.table("organisations").delete().eq("id", org_id).execute()

    # Delete auth users
    for uid in user_ids:
        try:
            sb.auth.admin.delete_user(uid)
        except Exception:
            pass

    return {"ok": True}
