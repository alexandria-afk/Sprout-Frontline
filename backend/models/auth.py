from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserSession(BaseModel):
    access_token: str
    refresh_token: str
    user_id: str
    email: str
    role: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
