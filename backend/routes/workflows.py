"""
Workflow Routes — Phase 3
GET    /api/v1/workflows/definitions
POST   /api/v1/workflows/definitions
GET    /api/v1/workflows/definitions/{id}
PUT    /api/v1/workflows/definitions/{id}
DELETE /api/v1/workflows/definitions/{id}
POST   /api/v1/workflows/definitions/{id}/duplicate
POST   /api/v1/workflows/definitions/{id}/stages
PUT    /api/v1/workflows/definitions/{id}/stages/{stage_id}
DELETE /api/v1/workflows/definitions/{id}/stages/{stage_id}
PUT    /api/v1/workflows/definitions/{id}/stages/reorder
POST   /api/v1/workflows/definitions/{id}/routing-rules
PUT    /api/v1/workflows/definitions/{id}/rules/{rule_id}
DELETE /api/v1/workflows/definitions/{id}/rules/{rule_id}
POST   /api/v1/workflows/instances
GET    /api/v1/workflows/instances
GET    /api/v1/workflows/instances/my-tasks
GET    /api/v1/workflows/instances/{id}
POST   /api/v1/workflows/instances/{id}/cancel
POST   /api/v1/workflows/instances/{id}/stages/{stage_instance_id}/approve
POST   /api/v1/workflows/instances/{id}/stages/{stage_instance_id}/reject
POST   /api/v1/workflows/instances/{id}/stages/{stage_instance_id}/submit-form
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from dependencies import get_current_user, require_admin, require_manager_or_above
from models.workflows import (
    CreateWorkflowDefinitionRequest,
    UpdateWorkflowDefinitionRequest,
    CreateWorkflowStageRequest,
    UpdateWorkflowStageRequest,
    ReorderStagesRequest,
    CreateRoutingRuleRequest,
    UpdateRoutingRuleRequest,
    TriggerWorkflowRequest,
    CancelWorkflowRequest,
    ApproveStageRequest,
    RejectStageRequest,
    SubmitFormForStageRequest,
)
from services.workflow_service import (
    approve_stage,
    reject_stage,
    advance_workflow,
    get_my_tasks,
    get_instance_detail,
    trigger_workflow,
    tick_wait_stages,
)
from services.supabase_client import get_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_org(current_user: dict) -> str:
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation found for user")
    return org_id


def _validate_for_publish(definition_id: str, org_id: str, db) -> list[str]:
    """Run all publish validation rules. Returns a list of error strings (empty = valid)."""
    errors = []

    # Fetch definition for trigger context
    def_res = db.table("workflow_definitions") \
        .select("trigger_type,trigger_config") \
        .eq("id", definition_id) \
        .maybe_single() \
        .execute()
    def_data = def_res.data or {}
    trigger_type = def_data.get("trigger_type", "manual")
    trigger_config = def_data.get("trigger_config") or {}
    auto_linked_triggers = {"audit_submitted", "form_submitted"}
    # Triggers that don't require a fill_form first stage
    no_form_first_triggers = {"employee_created", "issue_created", "incident_created", "scheduled"}

    # Fetch stages — include top-level form_template_id column in addition to config JSONB
    stages_res = db.table("workflow_stages") \
        .select("id,name,action_type,assigned_role,form_template_id,config,is_final,stage_order") \
        .eq("workflow_definition_id", definition_id) \
        .eq("is_deleted", False) \
        .order("stage_order") \
        .execute()
    stages = stages_res.data or []
    logger.info(f"_validate_for_publish {definition_id}: {len(stages)} stages — " +
        str([{"name": s.get("name"), "action_type": s.get("action_type"),
              "assigned_role": s.get("assigned_role"), "form_template_id": s.get("form_template_id"),
              "is_final": s.get("is_final")} for s in stages]))

    # Stage validation
    if not stages:
        errors.append("This workflow has no stages.")
        return errors  # no point checking further

    first_stage = stages[0]

    # For manual/form triggers, Stage 1 must be fill_form with a linked template
    if trigger_type not in no_form_first_triggers:
        if first_stage.get("action_type") != "fill_form":
            errors.append("Stage 1 must be a Fill Form stage (Starting Form).")
        else:
            first_config = first_stage.get("config") or {}
            if trigger_type in auto_linked_triggers:
                # Template comes from trigger_config, not stage config
                if not trigger_config.get("form_template_id"):
                    errors.append("Stage 1: the trigger's linked template is not set. Configure the template in the Trigger section.")
            else:
                # Check both top-level column and config JSONB (either location is valid)
                first_form_tpl = first_stage.get("form_template_id") or first_config.get("form_template_id")
                if not first_form_tpl:
                    errors.append(f"Stage \"{first_stage.get('name', 'Starting Form')}\" has no linked form.")

    # Per-stage validation
    for idx, stage in enumerate(stages):
        action_type = stage.get("action_type", "")
        stage_name = stage.get("name") or action_type
        config = stage.get("config") or {}
        is_first = idx == 0

        # Assignee required for human stages
        if action_type in ("fill_form", "approve", "sign"):
            if not stage.get("assigned_role"):
                errors.append(f"Stage \"{stage_name}\" has no assignee.")

        # Linked form required for fill_form on non-first stages (first stage validated above)
        if action_type == "fill_form" and not is_first:
            form_tpl = stage.get("form_template_id") or config.get("form_template_id")
            if not form_tpl:
                errors.append(f"Stage \"{stage_name}\" has no linked form.")

        # Wait duration required
        if action_type == "wait":
            if not config.get("hours"):
                errors.append(f"Stage \"{stage_name}\" has no wait duration.")

        # assign_training must have at least one course
        if action_type == "assign_training":
            import json as _json
            course_ids_raw = config.get("course_ids", "[]")
            try:
                course_ids = _json.loads(course_ids_raw) if isinstance(course_ids_raw, str) else (course_ids_raw or [])
            except Exception:
                course_ids = []
            if not course_ids:
                errors.append(f"Stage \"{stage_name}\" has no courses selected.")

    # Routing rules: every non-final stage must have at least one outgoing rule
    # OR an implicit sequential connection to the next stage (always-fallback).
    rules_res = db.table("workflow_routing_rules") \
        .select("from_stage_id,to_stage_id") \
        .eq("workflow_definition_id", definition_id) \
        .eq("is_deleted", False) \
        .execute()
    rules = rules_res.data or []
    rules_by_from: dict[str, list[str]] = {}
    for r in rules:
        rules_by_from.setdefault(r["from_stage_id"], []).append(r["to_stage_id"])

    # Build sequential next-stage map (implicit "always" fallback)
    next_stage_id: dict[str, str] = {}
    for i in range(len(stages) - 1):
        next_stage_id[stages[i]["id"]] = stages[i + 1]["id"]

    for stage in stages:
        if not stage.get("is_final"):
            has_explicit = bool(rules_by_from.get(stage["id"]))
            has_implicit = stage["id"] in next_stage_id
            if not has_explicit and not has_implicit:
                stage_name = stage.get("name") or stage.get("action_type", "")
                errors.append(f"Stage \"{stage_name}\" has no routing rules. The workflow would stall here.")

    # Exactly one final stage
    final_stages = [s for s in stages if s.get("is_final")]
    if len(final_stages) == 0:
        errors.append("This workflow has no final stage.")
    elif len(final_stages) > 1:
        errors.append("This workflow has more than one final stage.")

    # Orphaned stage detection — graph traversal from first stage
    # Uses explicit rules first; falls back to sequential order when no explicit rules exist.
    reachable: set[str] = set()

    def _traverse(stage_id: str):
        if stage_id in reachable:
            return
        reachable.add(stage_id)
        explicit_targets = rules_by_from.get(stage_id, [])
        if explicit_targets:
            for to_id in explicit_targets:
                _traverse(to_id)
        elif stage_id in next_stage_id:
            # No explicit rules — follow implicit sequential connection
            _traverse(next_stage_id[stage_id])

    _traverse(stages[0]["id"])

    for stage in stages:
        if stage["id"] not in reachable:
            stage_name = stage.get("name") or stage.get("action_type", "")
            errors.append(f"Stage \"{stage_name}\" is not reachable from the start. Check your routing rules.")

    return errors


# ─────────────────────────────────────────────────────────────────────────────
# Workflow Definitions
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/definitions")
async def list_workflow_definitions(
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    db = get_admin_client()
    res = db.table("workflow_definitions") \
        .select("*, workflow_stages(id, name, stage_order, action_type, is_final)") \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .order("created_at", desc=True) \
        .execute()
    return res.data or []


@router.post("/definitions")
async def create_workflow_definition(
    body: CreateWorkflowDefinitionRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    wf_data: dict = {
        "organisation_id": org_id,
        "name": body.name,
        "trigger_type": body.trigger_type,
        "is_active": body.is_active,
    }
    if body.form_template_id:
        # Check no existing workflow for this template
        existing = db.table("workflow_definitions") \
            .select("id") \
            .eq("form_template_id", str(body.form_template_id)) \
            .eq("organisation_id", org_id) \
            .eq("is_deleted", False) \
            .maybe_single() \
            .execute()
        if existing.data:
            raise HTTPException(status_code=409, detail="A workflow definition already exists for this template")
        wf_data["form_template_id"] = str(body.form_template_id)
    if body.trigger_config:
        wf_data["trigger_config"] = body.trigger_config

    wf_res = db.table("workflow_definitions").insert(wf_data).execute()
    wf = wf_res.data[0]
    wf_id = wf["id"]

    if body.stages:
        stage_records = [
            {
                "workflow_definition_id": wf_id,
                "name": s.name,
                "stage_order": s.stage_order,
                "assigned_role": s.assigned_role,
                "assigned_user_id": str(s.assigned_user_id) if s.assigned_user_id else None,
                "action_type": s.action_type,
                "form_template_id": str(s.form_template_id) if s.form_template_id else None,
                "is_final": s.is_final,
                "config": s.config,
                "sla_hours": s.sla_hours,
            }
            for s in body.stages
        ]
        db.table("workflow_stages").insert(stage_records).execute()

    return wf


@router.get("/definitions/{definition_id}")
async def get_workflow_definition(
    definition_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    res = db.table("workflow_definitions") \
        .select("*, workflow_stages(*), workflow_routing_rules(*)") \
        .eq("id", str(definition_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    return res.data


@router.put("/definitions/{definition_id}")
async def update_workflow_definition(
    definition_id: UUID,
    body: UpdateWorkflowDefinitionRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    existing = db.table("workflow_definitions") \
        .select("id") \
        .eq("id", str(definition_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.name is not None:
        updates["name"] = body.name
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if body.trigger_type is not None:
        updates["trigger_type"] = body.trigger_type
    if body.trigger_config is not None:
        updates["trigger_config"] = body.trigger_config

    db.table("workflow_definitions").update(updates).eq("id", str(definition_id)).execute()
    return {"success": True}


@router.post("/definitions/{definition_id}/publish")
async def publish_workflow(
    definition_id: UUID,
    current_user: dict = Depends(require_admin),
):
    """Validate and publish a workflow (set is_active = true). Runs all validation rules."""
    org_id = _get_org(current_user)
    db = get_admin_client()

    existing = db.table("workflow_definitions") \
        .select("id,trigger_type") \
        .eq("id", str(definition_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    errors = _validate_for_publish(str(definition_id), org_id, db)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})

    db.table("workflow_definitions") \
        .update({"is_active": True, "updated_at": datetime.now(timezone.utc).isoformat()}) \
        .eq("id", str(definition_id)) \
        .execute()

    return {"success": True}


@router.delete("/definitions/{definition_id}")
async def delete_workflow_definition(
    definition_id: UUID,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    existing = db.table("workflow_definitions") \
        .select("id,is_active") \
        .eq("id", str(definition_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    if existing.data.get("is_active"):
        raise HTTPException(status_code=409, detail="Cannot delete an active workflow. Deactivate it first.")

    # Cancel all in-progress instances (cascade)
    db.table("workflow_instances") \
        .update({"status": "cancelled"}) \
        .eq("workflow_definition_id", str(definition_id)) \
        .eq("status", "in_progress") \
        .execute()

    db.table("workflow_definitions").update({"is_deleted": True}).eq("id", str(definition_id)).execute()
    return {"success": True}


@router.post("/definitions/{definition_id}/duplicate")
async def duplicate_workflow_definition(
    definition_id: UUID,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    # Load original
    orig_res = db.table("workflow_definitions") \
        .select("*, workflow_stages(*), workflow_routing_rules(*)") \
        .eq("id", str(definition_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not orig_res.data:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    orig = orig_res.data

    # Create copy of definition
    new_wf_res = db.table("workflow_definitions").insert({
        "organisation_id": org_id,
        "name": f"Copy of {orig['name']}",
        "trigger_type": orig.get("trigger_type", "manual"),
        "trigger_config": orig.get("trigger_config"),
        "form_template_id": orig.get("form_template_id"),
        "is_active": False,  # duplicates start inactive
    }).execute()
    new_wf = new_wf_res.data[0]
    new_wf_id = new_wf["id"]

    # Copy stages and build old_id → new_id map
    stage_id_map: dict[str, str] = {}
    orig_stages = sorted(orig.get("workflow_stages") or [], key=lambda s: s["stage_order"])
    for stage in orig_stages:
        new_stage_res = db.table("workflow_stages").insert({
            "workflow_definition_id": new_wf_id,
            "name": stage["name"],
            "stage_order": stage["stage_order"],
            "assigned_role": stage.get("assigned_role"),
            "assigned_user_id": stage.get("assigned_user_id"),
            "action_type": stage["action_type"],
            "form_template_id": stage.get("form_template_id"),
            "is_final": stage.get("is_final", False),
            "config": stage.get("config"),
            "sla_hours": stage.get("sla_hours"),
        }).execute()
        stage_id_map[stage["id"]] = new_stage_res.data[0]["id"]

    # Copy routing rules using new stage IDs
    for rule in (orig.get("workflow_routing_rules") or []):
        from_id = stage_id_map.get(rule["from_stage_id"])
        to_id = stage_id_map.get(rule["to_stage_id"])
        if from_id and to_id:
            db.table("workflow_routing_rules").insert({
                "workflow_definition_id": new_wf_id,
                "from_stage_id": from_id,
                "to_stage_id": to_id,
                "condition_type": rule["condition_type"],
                "condition_field_id": rule.get("condition_field_id"),
                "condition_value": rule.get("condition_value"),
                "priority": rule.get("priority", 0),
                "label": rule.get("label"),
            }).execute()

    return new_wf


@router.post("/definitions/{definition_id}/stages")
async def add_stage(
    definition_id: UUID,
    body: CreateWorkflowStageRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    existing = db.table("workflow_definitions") \
        .select("id") \
        .eq("id", str(definition_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    res = db.table("workflow_stages").insert({
        "workflow_definition_id": str(definition_id),
        "name": body.name,
        "stage_order": body.stage_order,
        "assigned_role": body.assigned_role,
        "assigned_user_id": str(body.assigned_user_id) if body.assigned_user_id else None,
        "action_type": body.action_type,
        "form_template_id": str(body.form_template_id) if body.form_template_id else None,
        "is_final": body.is_final,
        "config": body.config,
        "sla_hours": body.sla_hours,
    }).execute()
    return res.data[0]


@router.put("/definitions/{definition_id}/stages/reorder")
async def reorder_stages(
    definition_id: UUID,
    body: ReorderStagesRequest,
    current_user: dict = Depends(require_admin),
):
    """Bulk update stage_order after drag-and-drop reorder."""
    org_id = _get_org(current_user)
    db = get_admin_client()

    existing = db.table("workflow_definitions") \
        .select("id") \
        .eq("id", str(definition_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    for item in body.stages:
        db.table("workflow_stages") \
            .update({"stage_order": item["stage_order"]}) \
            .eq("id", item["id"]) \
            .eq("workflow_definition_id", str(definition_id)) \
            .execute()

    return {"success": True}


@router.put("/definitions/{definition_id}/stages/{stage_id}")
async def update_stage(
    definition_id: UUID,
    stage_id: UUID,
    body: UpdateWorkflowStageRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    existing = db.table("workflow_stages") \
        .select("id") \
        .eq("id", str(stage_id)) \
        .eq("workflow_definition_id", str(definition_id)) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Stage not found")

    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ("name", "stage_order", "assigned_role", "action_type", "config", "sla_hours"):
        val = getattr(body, field, None)
        if val is not None:
            updates[field] = val
    # is_final must use explicit None check since False is falsy but valid
    if body.is_final is not None:
        updates["is_final"] = body.is_final
    if body.assigned_user_id is not None:
        updates["assigned_user_id"] = str(body.assigned_user_id)
    if body.form_template_id is not None:
        updates["form_template_id"] = str(body.form_template_id)

    logger.info(f"update_stage {stage_id}: {list(updates.keys())}")
    try:
        res = db.table("workflow_stages").update(updates).eq("id", str(stage_id)).execute()
        logger.info(f"update_stage {stage_id} result: {res.data}")
    except Exception as e:
        logger.error(f"update_stage {stage_id} DB error: {e}")
        raise HTTPException(status_code=500, detail=f"Database update failed: {str(e)}")
    return {"success": True}


@router.delete("/definitions/{definition_id}/stages/{stage_id}")
async def delete_stage(
    definition_id: UUID,
    stage_id: UUID,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    existing = db.table("workflow_stages") \
        .select("id") \
        .eq("id", str(stage_id)) \
        .eq("workflow_definition_id", str(definition_id)) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Stage not found")

    db.table("workflow_stages").update({"is_deleted": True}).eq("id", str(stage_id)).execute()
    return {"success": True}


@router.post("/definitions/{definition_id}/routing-rules")
async def add_routing_rule(
    definition_id: UUID,
    body: CreateRoutingRuleRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    existing = db.table("workflow_definitions") \
        .select("id") \
        .eq("id", str(definition_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    res = db.table("workflow_routing_rules").insert({
        "workflow_definition_id": str(definition_id),
        "from_stage_id": str(body.from_stage_id),
        "to_stage_id": str(body.to_stage_id),
        "condition_type": body.condition_type,
        "condition_field_id": str(body.condition_field_id) if body.condition_field_id else None,
        "condition_value": body.condition_value,
        "priority": body.priority,
        "label": body.label,
    }).execute()
    return res.data[0]


@router.put("/definitions/{definition_id}/rules/{rule_id}")
async def update_routing_rule(
    definition_id: UUID,
    rule_id: UUID,
    body: UpdateRoutingRuleRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    existing = db.table("workflow_routing_rules") \
        .select("id") \
        .eq("id", str(rule_id)) \
        .eq("workflow_definition_id", str(definition_id)) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Routing rule not found")

    updates: dict = {}
    for field in ("condition_type", "condition_value", "priority", "label"):
        val = getattr(body, field, None)
        if val is not None:
            updates[field] = val

    if updates:
        db.table("workflow_routing_rules").update(updates).eq("id", str(rule_id)).execute()
    return {"success": True}


@router.delete("/definitions/{definition_id}/rules/{rule_id}")
async def delete_routing_rule(
    definition_id: UUID,
    rule_id: UUID,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    existing = db.table("workflow_routing_rules") \
        .select("id") \
        .eq("id", str(rule_id)) \
        .eq("workflow_definition_id", str(definition_id)) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Routing rule not found")

    db.table("workflow_routing_rules").update({"is_deleted": True}).eq("id", str(rule_id)).execute()
    return {"success": True}


# ─────────────────────────────────────────────────────────────────────────────
# Workflow Instances
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/instances")
async def trigger_workflow_instance(
    body: TriggerWorkflowRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    """Manually trigger a workflow instance."""
    org_id = _get_org(current_user)
    user_id = current_user["sub"]
    try:
        instance = await trigger_workflow(
            definition_id=str(body.definition_id),
            org_id=org_id,
            source_type=body.source_type,
            triggered_by=user_id,
            source_id=str(body.source_id) if body.source_id else None,
            location_id=str(body.location_id) if body.location_id else None,
        )
        if not instance:
            raise HTTPException(status_code=404, detail="Workflow definition not found or has no stages")
        return instance
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/instances/my-tasks")
async def my_workflow_tasks(
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org(current_user)
    user_id = current_user["sub"]
    user_role = (current_user.get("app_metadata") or {}).get("role")
    logger.info(f"my-tasks: user={user_id} role={user_role} org={org_id}")
    try:
        tasks = await get_my_tasks(user_id, org_id, user_role=user_role)
        logger.info(f"my-tasks: returning {len(tasks)} tasks")
        return tasks
    except Exception as e:
        logger.error(f"my-tasks: ERROR {e}", exc_info=True)
        raise


@router.get("/instances")
async def list_workflow_instances(
    status: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    definition_id: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    db = get_admin_client()
    offset = (page - 1) * page_size

    q = db.table("workflow_instances") \
        .select("""
            *,
            workflow_definitions(name, trigger_type),
            workflow_stages!current_stage_id(name, action_type)
        """) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .order("created_at", desc=True)

    if status:
        q = q.eq("status", status)
    if location_id:
        q = q.eq("location_id", location_id)
    if definition_id:
        q = q.eq("workflow_definition_id", definition_id)
    if from_date:
        q = q.gte("created_at", from_date)
    if to_date:
        q = q.lte("created_at", to_date)

    q = q.range(offset, offset + page_size - 1)
    res = q.execute()
    return res.data


@router.get("/instances/{instance_id}")
async def get_workflow_instance(
    instance_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    data = await get_instance_detail(str(instance_id), org_id)
    if not data:
        raise HTTPException(status_code=404, detail="Workflow instance not found")
    return data


@router.post("/instances/{instance_id}/cancel")
async def cancel_workflow_instance(
    instance_id: UUID,
    body: CancelWorkflowRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    inst = db.table("workflow_instances") \
        .select("id, status") \
        .eq("id", str(instance_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not inst.data:
        raise HTTPException(status_code=404, detail="Workflow instance not found")
    if inst.data["status"] in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Instance already {inst.data['status']}")

    db.table("workflow_instances").update({
        "status": "cancelled",
        "cancelled_reason": body.reason,
    }).eq("id", str(instance_id)).execute()

    return {"success": True}


@router.post("/instances/{instance_id}/stages/{stage_instance_id}/approve")
async def approve_workflow_stage(
    instance_id: UUID,
    stage_instance_id: UUID,
    body: ApproveStageRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        result = await approve_stage(
            instance_id=str(instance_id),
            stage_instance_id=str(stage_instance_id),
            acting_user_id=current_user["sub"],
            comment=body.comment,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/instances/{instance_id}/stages/{stage_instance_id}/reject")
async def reject_workflow_stage(
    instance_id: UUID,
    stage_instance_id: UUID,
    body: RejectStageRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        result = await reject_stage(
            instance_id=str(instance_id),
            stage_instance_id=str(stage_instance_id),
            acting_user_id=current_user["sub"],
            comment=body.comment,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/instances/{instance_id}/stages/{stage_instance_id}")
async def get_stage_instance_detail(
    instance_id: UUID,
    stage_instance_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Return a single stage instance with its stage definition (includes form_template_id)."""
    org_id = _get_org(current_user)
    db = get_admin_client()

    # Verify the workflow instance belongs to this org
    inst = db.table("workflow_instances") \
        .select("id") \
        .eq("id", str(instance_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not inst.data:
        raise HTTPException(status_code=404, detail="Workflow instance not found")

    res = db.table("workflow_stage_instances") \
        .select("*, workflow_stages(name, action_type, form_template_id, config, stage_order), workflow_instances(workflow_definitions(name))") \
        .eq("id", str(stage_instance_id)) \
        .eq("workflow_instance_id", str(instance_id)) \
        .maybe_single() \
        .execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Stage instance not found")

    data = dict(res.data)
    action_type = (data.get("workflow_stages") or {}).get("action_type")

    # Always fetch all sibling stage instances for history timeline
    sibling_res = db.table("workflow_stage_instances") \
        .select("id, status, completed_at, comment, assigned_to, form_submission_id, workflow_stages(name, action_type, stage_order), profiles!assigned_to(full_name)") \
        .eq("workflow_instance_id", str(instance_id)) \
        .execute()
    siblings = sibling_res.data or []

    # Build stage history sorted by stage_order
    siblings_sorted = sorted(siblings, key=lambda s: (s.get("workflow_stages") or {}).get("stage_order", 0))
    data["stage_history"] = [
        {
            "id": s.get("id"),
            "stage_name": (s.get("workflow_stages") or {}).get("name"),
            "action_type": (s.get("workflow_stages") or {}).get("action_type"),
            "stage_order": (s.get("workflow_stages") or {}).get("stage_order"),
            "status": s.get("status"),
            "completed_at": s.get("completed_at"),
            "comment": s.get("comment"),
            "completed_by": (s.get("profiles") or {}).get("full_name"),
            "form_submission_id": s.get("form_submission_id"),
        }
        for s in siblings_sorted
    ]

    # For approve/review/sign stages, find the most recently completed fill_form stage's submission
    if action_type in ("approve", "review", "sign"):
        fill_stages = [
            s for s in siblings
            if (s.get("workflow_stages") or {}).get("action_type") in ("fill_form", "sign")
            and s.get("form_submission_id")
        ]
        if fill_stages:
            fill_stages.sort(key=lambda s: (s.get("workflow_stages") or {}).get("stage_order", 0), reverse=True)
            data["review_submission_id"] = fill_stages[0]["form_submission_id"]
    return data


@router.post("/instances/{instance_id}/stages/{stage_instance_id}/submit-form")
async def submit_form_for_stage(
    instance_id: UUID,
    stage_instance_id: UUID,
    body: SubmitFormForStageRequest,
    current_user: dict = Depends(get_current_user),
):
    """Submit a form for a fill_form type stage."""
    org_id = _get_org(current_user)
    db = get_admin_client()

    si_res = db.table("workflow_stage_instances") \
        .select("*, workflow_stages(form_template_id, action_type)") \
        .eq("id", str(stage_instance_id)) \
        .eq("workflow_instance_id", str(instance_id)) \
        .maybe_single() \
        .execute()

    if not si_res.data:
        raise HTTPException(status_code=404, detail="Stage instance not found")

    stage = si_res.data.get("workflow_stages", {})
    if stage.get("action_type") not in ("fill_form", "sign"):
        raise HTTPException(status_code=400, detail="This stage does not require a form submission")

    form_template_id = stage.get("form_template_id")
    if not form_template_id:
        raise HTTPException(status_code=400, detail="Stage has no form template configured")

    try:
        sub_res = db.table("form_submissions").insert({
            "form_template_id": form_template_id,
            "submitted_by": current_user["sub"],
            "status": "submitted",
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as e:
        logger.error(f"submit_form_for_stage: form_submissions insert failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create submission: {e}")

    if not sub_res.data:
        logger.error(f"submit_form_for_stage: insert returned no data")
        raise HTTPException(status_code=500, detail="Failed to create submission — no data returned")

    sub_id = sub_res.data[0]["id"]
    logger.info(f"submit_form_for_stage: created submission {sub_id} for stage {stage_instance_id}")

    if body.responses:
        db.table("form_responses").insert([
            {"submission_id": sub_id, "field_id": r.get("field_id"), "value": r.get("value")}
            for r in body.responses
        ]).execute()

    db.table("workflow_stage_instances").update({
        "form_submission_id": sub_id,
        "status": "approved",
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", str(stage_instance_id)).execute()

    await advance_workflow(str(instance_id), str(stage_instance_id), current_user["sub"])

    return {"success": True, "form_submission_id": sub_id}


# ─── Internal: Wait Stage Ticker ─────────────────────────────────────────────

@router.post("/internal/tick")
async def tick(current_user: dict = Depends(require_admin)):
    """
    Advance condition-based and timed-out wait stages.
    Call every 5 minutes via a server cron or Supabase Edge Function scheduler.
    Requires admin role to prevent accidental public exposure.
    """
    return await tick_wait_stages()
