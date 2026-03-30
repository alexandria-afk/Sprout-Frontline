import uuid
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from dependencies import get_current_user
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
