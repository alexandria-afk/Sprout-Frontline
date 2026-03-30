from uuid import UUID
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


class FormFieldResponse(BaseModel):
    id: UUID
    section_id: UUID
    label: str
    field_type: str
    is_required: bool
    options: list[Any] | None = None
    conditional_logic: dict | None = None
    display_order: int
    placeholder: str | None = None
    is_critical: bool = False


class FormSectionResponse(BaseModel):
    id: UUID
    form_template_id: UUID
    title: str
    display_order: int
    fields: list[FormFieldResponse] = []


class FormTemplateResponse(BaseModel):
    id: UUID
    organisation_id: UUID
    created_by: UUID
    title: str
    description: str | None = None
    type: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    sections: list[FormSectionResponse] = []


class CreateFormFieldRequest(BaseModel):
    id: UUID | None = None
    label: str
    field_type: str
    is_required: bool = False
    options: list[Any] | None = None
    conditional_logic: dict | None = None
    display_order: int = 0
    placeholder: str | None = None
    is_critical: bool = False


class CreateFormSectionRequest(BaseModel):
    id: UUID | None = None
    title: str
    display_order: int = 0
    fields: list[CreateFormFieldRequest] = []


class CreateFormTemplateRequest(BaseModel):
    title: str
    description: str | None = None
    type: str
    sections: list[CreateFormSectionRequest] = []


class CreateAssignmentRequest(BaseModel):
    form_template_id: UUID
    assigned_to_user_id: UUID | None = None
    assigned_to_location_id: UUID | None = None
    recurrence: str
    cron_expression: str | None = None
    due_at: datetime


class FormSubmissionResponse(BaseModel):
    id: UUID
    form_template_id: UUID
    assignment_id: UUID
    submitted_by: UUID
    submitted_at: datetime | None = None
    status: str
    manager_comment: str | None = None
    created_at: datetime
    updated_at: datetime


class ReviewSubmissionRequest(BaseModel):
    status: str  # 'approved' | 'rejected'
    manager_comment: str | None = None


class FormResponseItem(BaseModel):
    field_id: UUID
    value: str
    comment: str | None = None


class CreateSubmissionRequest(BaseModel):
    assignment_id: UUID
    form_template_id: UUID
    status: str  # 'draft' | 'submitted'
    responses: list[FormResponseItem] = []


class UpdateFormTemplateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    type: str | None = None
    is_active: bool | None = None
    sections: list[CreateFormSectionRequest] | None = None


class GenerateTemplateRequest(BaseModel):
    description: str
    type: str = "form"  # "form" | "checklist"
    input_type: str = "topic"  # "topic" | "url" | "document"
    url: Optional[str] = None
    document_base64: Optional[str] = None


class TemplateStatsResponse(BaseModel):
    template_id: str
    assigned_count: int
    completed_count: int
    latest_response_at: Optional[str] = None  # ISO datetime string or None
