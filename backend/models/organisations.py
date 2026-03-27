from uuid import UUID
from datetime import datetime
from pydantic import BaseModel


class OrganisationResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    logo_url: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UpdateOrganisationRequest(BaseModel):
    name: str | None = None
    logo_url: str | None = None


class LocationResponse(BaseModel):
    id: UUID
    organisation_id: UUID
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    geo_fence_radius_meters: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CreateLocationRequest(BaseModel):
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    geo_fence_radius_meters: int = 200


class UpdateLocationRequest(BaseModel):
    name: str | None = None
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    geo_fence_radius_meters: int | None = None
    is_active: bool | None = None
