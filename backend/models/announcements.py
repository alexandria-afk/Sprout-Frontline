from uuid import UUID
from datetime import datetime
from pydantic import BaseModel


class AnnouncementResponse(BaseModel):
    id: UUID
    organisation_id: UUID
    created_by: UUID
    title: str
    body: str
    media_url: str | None = None
    media_urls: list[str] = []
    creator_name: str | None = None
    requires_acknowledgement: bool
    my_acknowledged: bool = False
    publish_at: datetime | None = None
    target_roles: list[str] | None = None
    target_location_ids: list[UUID] | None = None
    created_at: datetime
    updated_at: datetime


class CreateAnnouncementRequest(BaseModel):
    title: str
    body: str
    media_url: str | None = None
    media_urls: list[str] = []
    requires_acknowledgement: bool = False
    publish_at: datetime | None = None
    target_roles: list[str] | None = None
    target_location_ids: list[UUID] | None = None


class UpdateAnnouncementRequest(BaseModel):
    title: str | None = None
    body: str | None = None
    media_url: str | None = None
    media_urls: list[str] | None = None
    requires_acknowledgement: bool | None = None
    publish_at: datetime | None = None
    target_roles: list[str] | None = None
    target_location_ids: list[UUID] | None = None


class ReceiptResponse(BaseModel):
    id: UUID
    announcement_id: UUID
    user_id: UUID
    read_at: datetime | None = None
    acknowledged_at: datetime | None = None
    created_at: datetime


class ReceiptStatsResponse(BaseModel):
    total_targeted: int
    total_read: int
    total_acknowledged: int
    receipts: list[ReceiptResponse] = []
