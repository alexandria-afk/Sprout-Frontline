from uuid import UUID
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel

from models.forms import CreateFormSectionRequest


# ─────────────────────────────────────────────────────────────────────────────
# Audit Template
# ─────────────────────────────────────────────────────────────────────────────

class AuditFieldScoreConfig(BaseModel):
    field_id: UUID
    max_score: float = 1.0


class AuditSectionWeightConfig(BaseModel):
    section_id: UUID
    weight: float = 1.0


class CreateAuditTemplateRequest(BaseModel):
    title: str
    description: Optional[str] = None
    sections: list[CreateFormSectionRequest] = []
    passing_score: float = 80.0
    section_weights: list[AuditSectionWeightConfig] = []
    field_scores: list[AuditFieldScoreConfig] = []


class UpdateAuditTemplateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    sections: Optional[list[CreateFormSectionRequest]] = None
    passing_score: Optional[float] = None
    section_weights: Optional[list[AuditSectionWeightConfig]] = None
    field_scores: Optional[list[AuditFieldScoreConfig]] = None


class AuditConfigResponse(BaseModel):
    id: UUID
    form_template_id: UUID
    passing_score: float


# ─────────────────────────────────────────────────────────────────────────────
# Audit Submission
# ─────────────────────────────────────────────────────────────────────────────

class AuditResponseItem(BaseModel):
    field_id: UUID
    value: str
    comment: Optional[str] = None


class CreateAuditSubmissionRequest(BaseModel):
    form_template_id: UUID
    location_id: UUID
    responses: list[AuditResponseItem] = []


class FieldScoreDetail(BaseModel):
    field_id: str
    label: str
    field_type: str
    max_score: float
    achieved_score: float
    weight: float
    is_failed: bool
    response_value: Optional[str] = None


class SectionScoreDetail(BaseModel):
    section_id: str
    title: str
    weight: float
    max_possible: float
    achieved: float
    score_pct: float
    fields: list[FieldScoreDetail]


class AuditSubmissionResponse(BaseModel):
    id: UUID
    form_template_id: UUID
    location_id: UUID
    submitted_by: UUID
    submitted_at: datetime
    overall_score: float
    passed: bool
    passing_score: float
    sections: list[SectionScoreDetail] = []
    corrective_action_ids: list[UUID] = []


# ─────────────────────────────────────────────────────────────────────────────
# Corrective Actions
# ─────────────────────────────────────────────────────────────────────────────

class CorrectiveActionResponse(BaseModel):
    id: UUID
    submission_id: UUID
    field_id: UUID
    organisation_id: UUID
    location_id: UUID
    description: str
    assigned_to: Optional[UUID] = None
    due_at: Optional[datetime] = None
    status: str
    resolved_at: Optional[datetime] = None
    resolution_note: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class UpdateCorrectiveActionRequest(BaseModel):
    status: Optional[str] = None        # open | in_progress | resolved
    assigned_to: Optional[UUID] = None
    due_at: Optional[datetime] = None
    resolution_note: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Audit Signature
# ─────────────────────────────────────────────────────────────────────────────

class CaptureSignatureRequest(BaseModel):
    signature_data_url: str   # base64 PNG data URL from signature_pad


class AuditSignatureResponse(BaseModel):
    id: UUID
    submission_id: UUID
    signed_by: UUID
    signature_url: str        # signed storage URL
    signed_at: datetime
