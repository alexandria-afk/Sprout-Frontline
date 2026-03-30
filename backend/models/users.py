from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, EmailStr


class ReportsToProfile(BaseModel):
    id: UUID
    full_name: str


class PositionSuggestion(BaseModel):
    position: str
    count: int


class ProfileResponse(BaseModel):
    id: UUID
    organisation_id: UUID
    location_id: UUID | None = None
    full_name: str
    phone_number: str | None = None
    role: str
    position: str | None = None
    language: str
    is_active: bool
    reports_to: UUID | None = None
    reports_to_profile: ReportsToProfile | None = None
    created_at: datetime
    updated_at: datetime


class CreateUserRequest(BaseModel):
    email: EmailStr
    full_name: str
    role: str
    position: str | None = None
    location_id: UUID | None = None
    phone_number: str | None = None
    reports_to: UUID | None = None


class UpdateUserRequest(BaseModel):
    full_name: str | None = None
    role: str | None = None
    position: str | None = None
    location_id: UUID | None = None
    phone_number: str | None = None
    is_active: bool | None = None
    language: str | None = None
    reports_to: UUID | None = None
