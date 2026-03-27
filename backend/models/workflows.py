from uuid import UUID
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel


# ─────────────────────────────────────────────────────────────────────────────
# Workflow Definition
# ─────────────────────────────────────────────────────────────────────────────

class CreateWorkflowStageRequest(BaseModel):
    name: str
    stage_order: int
    assigned_role: Optional[str] = None    # staff | manager | admin | super_admin | vendor
    assigned_user_id: Optional[UUID] = None
    action_type: str                        # review | approve | fill_form | sign | create_task | create_issue | create_incident | notify | wait
    form_template_id: Optional[UUID] = None
    is_final: bool = False
    config: Optional[dict] = None          # system stage config (title, priority, hours, etc.)
    sla_hours: Optional[int] = None


class UpdateWorkflowStageRequest(BaseModel):
    name: Optional[str] = None
    stage_order: Optional[int] = None
    assigned_role: Optional[str] = None
    assigned_user_id: Optional[UUID] = None
    action_type: Optional[str] = None
    form_template_id: Optional[UUID] = None
    is_final: Optional[bool] = None
    config: Optional[dict] = None
    sla_hours: Optional[int] = None


class ReorderStagesRequest(BaseModel):
    stages: list[dict]  # [{id: str, stage_order: int}]


class CreateRoutingRuleRequest(BaseModel):
    from_stage_id: UUID
    to_stage_id: UUID
    condition_type: str   # score_below | score_above | field_failed | field_value_equals | always | approved | rejected | priority_equals | role_equals | sla_breached
    condition_field_id: Optional[UUID] = None
    condition_value: Optional[str] = None
    priority: int = 0
    label: Optional[str] = None


class UpdateRoutingRuleRequest(BaseModel):
    condition_type: Optional[str] = None
    condition_value: Optional[str] = None
    priority: Optional[int] = None
    label: Optional[str] = None


class CreateWorkflowDefinitionRequest(BaseModel):
    name: str
    trigger_type: str = "manual"            # manual | audit_submitted | issue_created | incident_created | scheduled | form_submitted
    trigger_config: Optional[dict] = None
    form_template_id: Optional[UUID] = None  # required when trigger_type = audit_submitted | form_submitted
    is_active: bool = True
    stages: list[CreateWorkflowStageRequest] = []


class UpdateWorkflowDefinitionRequest(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    trigger_type: Optional[str] = None
    trigger_config: Optional[dict] = None


# ─────────────────────────────────────────────────────────────────────────────
# Workflow Instance
# ─────────────────────────────────────────────────────────────────────────────

class TriggerWorkflowRequest(BaseModel):
    definition_id: UUID
    source_type: str = "manual"           # manual | issue | incident | audit
    source_id: Optional[UUID] = None
    location_id: Optional[UUID] = None


class CancelWorkflowRequest(BaseModel):
    reason: str


class WorkflowStageInstanceResponse(BaseModel):
    id: UUID
    stage_id: UUID
    assigned_to: Optional[UUID] = None
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    due_at: Optional[datetime] = None
    comment: Optional[str] = None
    form_submission_id: Optional[UUID] = None
    spawned_task_id: Optional[UUID] = None
    spawned_issue_id: Optional[UUID] = None
    spawned_incident_id: Optional[UUID] = None
    stage_name: Optional[str] = None
    stage_order: Optional[int] = None
    action_type: Optional[str] = None
    is_final: Optional[bool] = None


class WorkflowInstanceResponse(BaseModel):
    id: UUID
    workflow_definition_id: UUID
    submission_id: Optional[UUID] = None
    source_type: Optional[str] = None
    source_id: Optional[UUID] = None
    organisation_id: UUID
    status: str
    current_stage_id: Optional[UUID] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    workflow_name: Optional[str] = None
    stage_instances: list[WorkflowStageInstanceResponse] = []


class ApproveStageRequest(BaseModel):
    comment: Optional[str] = None


class RejectStageRequest(BaseModel):
    comment: str    # required on rejection


class SubmitFormForStageRequest(BaseModel):
    responses: list[dict]    # [{field_id, value}]
