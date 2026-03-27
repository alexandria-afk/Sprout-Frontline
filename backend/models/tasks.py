from __future__ import annotations
from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel


# ── Task Templates ────────────────────────────────────────────────────────────

class CreateTaskTemplateRequest(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "medium"
    assign_to_role: Optional[str] = None
    recurrence: str = "none"
    cron_expression: Optional[str] = None
    is_active: bool = True


class UpdateTaskTemplateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    assign_to_role: Optional[str] = None
    recurrence: Optional[str] = None
    cron_expression: Optional[str] = None
    is_active: Optional[bool] = None


class SpawnTaskRequest(BaseModel):
    location_id: str
    due_at: Optional[datetime] = None
    assignee_user_ids: list[str] = []


# ── Tasks ─────────────────────────────────────────────────────────────────────

class CreateTaskRequest(BaseModel):
    location_id: Optional[str] = None
    template_id: Optional[str] = None
    source_type: str = "manual"
    source_submission_id: Optional[str] = None
    source_field_id: Optional[str] = None
    cap_item_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    priority: str = "medium"
    due_at: Optional[datetime] = None
    recurrence: str = "none"
    cron_expression: Optional[str] = None
    assignee_user_ids: list[str] = []
    assignee_roles: list[str] = []


class UpdateTaskRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    due_at: Optional[datetime] = None


class UpdateTaskStatusRequest(BaseModel):
    status: str


class AddAssigneeRequest(BaseModel):
    user_id: Optional[str] = None
    assign_role: Optional[str] = None


class PostMessageRequest(BaseModel):
    body: str


class AddAttachmentRequest(BaseModel):
    file_url: str
    file_type: str   # image | video | document


class AnnotateAttachmentRequest(BaseModel):
    annotated_url: str
