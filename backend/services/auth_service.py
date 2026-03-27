from models.auth import LoginRequest, UserSession, ChangePasswordRequest
from models.base import SuccessEnvelope
from services.supabase_client import get_supabase
from fastapi import HTTPException


class AuthService:
    @staticmethod
    async def login(body: LoginRequest) -> SuccessEnvelope[UserSession]:
        supabase = get_supabase()
        try:
            response = supabase.auth.sign_in_with_password(
                {"email": body.email, "password": body.password}
            )
        except Exception as e:
            raise HTTPException(status_code=401, detail=str(e))

        if not response.session:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        session = response.session
        user = response.user
        role = (user.app_metadata or {}).get("role") if user else None

        return SuccessEnvelope(
            message="Login successful",
            data=UserSession(
                access_token=session.access_token,
                refresh_token=session.refresh_token,
                user_id=str(user.id),
                email=user.email or "",
                role=role,
            ),
        )

    @staticmethod
    async def logout(current_user: dict) -> SuccessEnvelope[None]:
        supabase = get_supabase()
        try:
            supabase.auth.sign_out()
        except Exception:
            pass  # Best-effort logout
        return SuccessEnvelope(message="Logged out")

    @staticmethod
    async def change_password(body: ChangePasswordRequest, current_user: dict) -> SuccessEnvelope[None]:
        supabase = get_supabase()
        user_id = current_user["sub"]
        # Re-authenticate to verify current password
        try:
            email = current_user.get("email", "")
            supabase.auth.sign_in_with_password({"email": email, "password": body.current_password})
        except Exception:
            raise HTTPException(status_code=401, detail="Current password is incorrect")
        try:
            supabase.auth.admin.update_user_by_id(user_id, {"password": body.new_password})
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
        return SuccessEnvelope(message="Password updated successfully")
