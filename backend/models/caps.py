"""Pydantic models for the Corrective Action Plan (CAP) system."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class UpdateCAPItemRequest(BaseModel):
    followup_type: Optional[str] = None       # task | issue | incident | none
    followup_title: Optional[str] = None
    followup_description: Optional[str] = None
    followup_priority: Optional[str] = None   # low | medium | high | critical
    followup_assignee_id: Optional[UUID] = None
    followup_due_at: Optional[datetime] = None


class DismissCAPRequest(BaseModel):
    reason: str
