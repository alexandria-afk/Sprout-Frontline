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

import json
import logging
import os as _os
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query

_INTERNAL_SECRET = _os.environ.get("INTERNAL_CRON_SECRET", "")

from dependencies import get_db, get_current_user, require_admin, require_manager_or_above
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
from services.db import row, rows, execute, execute_returning, execute_many
from services.workflow_service import (
    approve_stage,
    reject_stage,
    advance_workflow,
    get_my_tasks,
    get_instance_detail,
    trigger_workflow,
    tick_wait_stages,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_org(current_user: dict) -> str:
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation found for user")
    return org_id


def _validate_for_publish(conn, definition_id: str, org_id: str) -> list[str]:
    """Run all publish validation rules. Returns a list of error strings (empty = valid)."""
    errors = []

    # Fetch definition for trigger context
    def_data = row(conn,
        "SELECT trigger_type, trigger_config FROM workflow_definitions WHERE id = %s",
        (definition_id,),
    ) or {}
    trigger_type = def_data.get("trigger_type", "manual")
    trigger_config = def_data.get("trigger_config") or {}
    auto_linked_triggers = {"audit_submitted", "form_submitted"}
    # Triggers that don't require a fill_form first stage
    no_form_first_triggers = {"employee_created", "issue_created", "incident_created", "scheduled"}

    # Fetch stages — include top-level form_template_id column in addition to config JSONB
    stages = rows(conn,
        """
        SELECT id, name, action_type, assigned_role, form_template_id, config, is_final, stage_order
        FROM workflow_stages
        WHERE workflow_definition_id = %s AND is_deleted = FALSE
        ORDER BY stage_order
        """,
        (definition_id,),
    )
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
            course_ids_raw = config.get("course_ids", "[]")
            try:
                course_ids = json.loads(course_ids_raw) if isinstance(course_ids_raw, str) else (course_ids_raw or [])
            except Exception:
                course_ids = []
            if not course_ids:
                errors.append(f"Stage \"{stage_name}\" has no courses selected.")

    # Routing rules: every non-final stage must have at least one outgoing rule
    # OR an implicit sequential connection to the next stage (always-fallback).
    rule_rows = rows(conn,
        """
        SELECT from_stage_id, to_stage_id FROM workflow_routing_rules
        WHERE workflow_definition_id = %s AND is_deleted = FALSE
        """,
        (definition_id,),
    )
    rules_by_from: dict[str, list[str]] = {}
    for r in rule_rows:
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
    conn = Depends(get_db),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    wf_rows = rows(conn,
        """
        SELECT wd.*,
               COALESCE(
                   json_agg(
                       json_build_object(
                           'id', ws.id,
                           'name', ws.name,
                           'stage_order', ws.stage_order,
                           'action_type', ws.action_type,
                           'is_final', ws.is_final
                       ) ORDER BY ws.stage_order
                   ) FILTER (WHERE ws.id IS NOT NULL),
                   '[]'
               ) AS workflow_stages
        FROM workflow_definitions wd
        LEFT JOIN workflow_stages ws ON ws.workflow_definition_id = wd.id AND ws.is_deleted = FALSE
        WHERE wd.organisation_id = %s AND wd.is_deleted = FALSE
        GROUP BY wd.id
        ORDER BY wd.created_at DESC
        """,
        (org_id,),
    )
    return [dict(r) for r in wf_rows]


@router.post("/definitions")
async def create_workflow_definition(
    body: CreateWorkflowDefinitionRequest,
    conn = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)

    if body.form_template_id:
        # Check no existing *active* workflow for this template.
        # Inactive (but not deleted) workflows do not block creation so that
        # a deactivated workflow can be superseded by a fresh one.
        existing = row(conn,
            """
            SELECT id FROM workflow_definitions
            WHERE form_template_id = %s AND organisation_id = %s
              AND is_deleted = FALSE AND is_active = TRUE
            LIMIT 1
            """,
            (str(body.form_template_id), org_id),
        )
        if existing:
            raise HTTPException(status_code=409, detail="A workflow definition already exists for this template")

    wf = execute_returning(conn,
        """
        INSERT INTO workflow_definitions (organisation_id, name, trigger_type, is_active, form_template_id, trigger_config)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            org_id,
            body.name,
            body.trigger_type,
            body.is_active,
            str(body.form_template_id) if body.form_template_id else None,
            json.dumps(body.trigger_config) if body.trigger_config else None,
        ),
    )
    wf = dict(wf)
    wf_id = wf["id"]

    if body.stages:
        execute_many(conn,
            """
            INSERT INTO workflow_stages (
                workflow_definition_id, name, stage_order, assigned_role,
                assigned_user_id, action_type, form_template_id, is_final, config, sla_hours
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                (
                    wf_id,
                    s.name,
                    s.stage_order,
                    s.assigned_role,
                    str(s.assigned_user_id) if s.assigned_user_id else None,
                    s.action_type,
                    str(s.form_template_id) if s.form_template_id else None,
                    s.is_final,
                    json.dumps(s.config) if s.config else None,
                    s.sla_hours,
                )
                for s in body.stages
            ],
        )

    return wf


@router.get("/definitions/{definition_id}")
async def get_workflow_definition(
    definition_id: UUID,
    conn = Depends(get_db),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)

    wf = row(conn,
        """
        SELECT * FROM workflow_definitions
        WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
        """,
        (str(definition_id), org_id),
    )
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    wf = dict(wf)

    stage_rows = rows(conn,
        "SELECT * FROM workflow_stages WHERE workflow_definition_id = %s AND is_deleted = FALSE ORDER BY stage_order",
        (str(definition_id),),
    )
    routing_rows = rows(conn,
        "SELECT * FROM workflow_routing_rules WHERE workflow_definition_id = %s AND is_deleted = FALSE",
        (str(definition_id),),
    )
    wf["workflow_stages"] = [dict(s) for s in stage_rows]
    wf["workflow_routing_rules"] = [dict(r) for r in routing_rows]
    return wf


@router.put("/definitions/{definition_id}")
async def update_workflow_definition(
    definition_id: UUID,
    body: UpdateWorkflowDefinitionRequest,
    conn = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)

    existing = row(conn,
        "SELECT id FROM workflow_definitions WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(definition_id), org_id),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.name is not None:
        updates["name"] = body.name
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if body.trigger_type is not None:
        updates["trigger_type"] = body.trigger_type
    if body.trigger_config is not None:
        updates["trigger_config"] = json.dumps(body.trigger_config)

    set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
    execute(conn,
        f"UPDATE workflow_definitions SET {set_clause} WHERE id = %s",
        (*updates.values(), str(definition_id)),
    )
    return {"success": True}


@router.post("/definitions/{definition_id}/publish")
async def publish_workflow(
    definition_id: UUID,
    conn = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Validate and publish a workflow (set is_active = true). Runs all validation rules."""
    org_id = _get_org(current_user)

    existing = row(conn,
        "SELECT id, trigger_type FROM workflow_definitions WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(definition_id), org_id),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    errors = _validate_for_publish(conn, str(definition_id), org_id)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})

    execute(conn,
        "UPDATE workflow_definitions SET is_active = TRUE, updated_at = %s WHERE id = %s",
        (datetime.now(timezone.utc).isoformat(), str(definition_id)),
    )
    return {"success": True}


@router.delete("/definitions/{definition_id}")
async def delete_workflow_definition(
    definition_id: UUID,
    conn = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)

    existing = row(conn,
        "SELECT id, is_active FROM workflow_definitions WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(definition_id), org_id),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    if existing["is_active"]:
        raise HTTPException(status_code=409, detail="Cannot delete an active workflow. Deactivate it first.")

    # Cancel all in-progress instances (cascade).
    # current_stage_id is also cleared so deleted stage foreign keys don't
    # linger on cancelled instances.
    execute(conn,
        """
        UPDATE workflow_instances
        SET status = 'cancelled', current_stage_id = NULL
        WHERE workflow_definition_id = %s AND status = 'in_progress'
        """,
        (str(definition_id),),
    )

    execute(conn,
        "UPDATE workflow_definitions SET is_deleted = TRUE WHERE id = %s",
        (str(definition_id),),
    )
    return {"success": True}


@router.post("/definitions/{definition_id}/duplicate")
async def duplicate_workflow_definition(
    definition_id: UUID,
    conn = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)

    orig = row(conn,
        """
        SELECT wd.*
        FROM workflow_definitions wd
        WHERE wd.id = %s AND wd.organisation_id = %s AND wd.is_deleted = FALSE
        """,
        (str(definition_id), org_id),
    )
    if not orig:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    orig = dict(orig)

    orig_stages = rows(conn,
        "SELECT * FROM workflow_stages WHERE workflow_definition_id = %s AND is_deleted = FALSE ORDER BY stage_order",
        (str(definition_id),),
    )
    orig_rules = rows(conn,
        "SELECT * FROM workflow_routing_rules WHERE workflow_definition_id = %s AND is_deleted = FALSE",
        (str(definition_id),),
    )

    # Create copy of definition
    new_wf = execute_returning(conn,
        """
        INSERT INTO workflow_definitions (organisation_id, name, trigger_type, trigger_config, form_template_id, is_active)
        VALUES (%s, %s, %s, %s, %s, FALSE)
        RETURNING *
        """,
        (
            org_id,
            f"Copy of {orig['name']}",
            orig.get("trigger_type", "manual"),
            orig.get("trigger_config"),
            orig.get("form_template_id"),
        ),
    )
    new_wf = dict(new_wf)
    new_wf_id = new_wf["id"]

    # Copy stages and build old_id → new_id map
    stage_id_map: dict[str, str] = {}
    for stage in sorted(orig_stages, key=lambda s: s["stage_order"]):
        new_stage = execute_returning(conn,
            """
            INSERT INTO workflow_stages (
                workflow_definition_id, name, stage_order, assigned_role,
                assigned_user_id, action_type, form_template_id, is_final, config, sla_hours
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                new_wf_id,
                stage["name"],
                stage["stage_order"],
                stage.get("assigned_role"),
                stage.get("assigned_user_id"),
                stage["action_type"],
                stage.get("form_template_id"),
                stage.get("is_final", False),
                stage.get("config"),
                stage.get("sla_hours"),
            ),
        )
        stage_id_map[str(stage["id"])] = str(new_stage["id"])

    # Copy routing rules using new stage IDs
    for rule in orig_rules:
        from_id = stage_id_map.get(str(rule["from_stage_id"]))
        to_id = stage_id_map.get(str(rule["to_stage_id"]))
        if from_id and to_id:
            execute(conn,
                """
                INSERT INTO workflow_routing_rules (
                    workflow_definition_id, from_stage_id, to_stage_id,
                    condition_type, condition_field_id, condition_value, priority, label
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    new_wf_id,
                    from_id,
                    to_id,
                    rule["condition_type"],
                    rule.get("condition_field_id"),
                    rule.get("condition_value"),
                    rule.get("priority", 0),
                    rule.get("label"),
                ),
            )

    return new_wf


@router.post("/definitions/{definition_id}/stages")
async def add_stage(
    definition_id: UUID,
    body: CreateWorkflowStageRequest,
    conn = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)

    existing = row(conn,
        "SELECT id FROM workflow_definitions WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(definition_id), org_id),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    stage = execute_returning(conn,
        """
        INSERT INTO workflow_stages (
            workflow_definition_id, name, stage_order, assigned_role,
            assigned_user_id, action_type, form_template_id, is_final, config, sla_hours
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            str(definition_id),
            body.name,
            body.stage_order,
            body.assigned_role,
            str(body.assigned_user_id) if body.assigned_user_id else None,
            body.action_type,
            str(body.form_template_id) if body.form_template_id else None,
            body.is_final,
            json.dumps(body.config) if body.config else None,
            body.sla_hours,
        ),
    )
    return dict(stage)


@router.put("/definitions/{definition_id}/stages/reorder")
async def reorder_stages(
    definition_id: UUID,
    body: ReorderStagesRequest,
    conn = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Bulk update stage_order after drag-and-drop reorder."""
    org_id = _get_org(current_user)

    existing = row(conn,
        "SELECT id FROM workflow_definitions WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(definition_id), org_id),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    for item in body.stages:
        execute(conn,
            """
            UPDATE workflow_stages SET stage_order = %s
            WHERE id = %s AND workflow_definition_id = %s
            """,
            (item["stage_order"], item["id"], str(definition_id)),
        )

    return {"success": True}


@router.put("/definitions/{definition_id}/stages/{stage_id}")
async def update_stage(
    definition_id: UUID,
    stage_id: UUID,
    body: UpdateWorkflowStageRequest,
    conn = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)

    existing = row(conn,
        "SELECT id FROM workflow_stages WHERE id = %s AND workflow_definition_id = %s AND is_deleted = FALSE",
        (str(stage_id), str(definition_id)),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Stage not found")

    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ("name", "stage_order", "assigned_role", "action_type", "sla_hours"):
        val = getattr(body, field, None)
        if val is not None:
            updates[field] = val
    # config needs JSON serialisation
    if getattr(body, "config", None) is not None:
        updates["config"] = json.dumps(body.config)
    # is_final must use explicit None check since False is falsy but valid
    if body.is_final is not None:
        updates["is_final"] = body.is_final
    if body.assigned_user_id is not None:
        updates["assigned_user_id"] = str(body.assigned_user_id)
    if body.form_template_id is not None:
        updates["form_template_id"] = str(body.form_template_id)

    logger.info(f"update_stage {stage_id}: {list(updates.keys())}")
    try:
        set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
        execute(conn,
            f"UPDATE workflow_stages SET {set_clause} WHERE id = %s",
            (*updates.values(), str(stage_id)),
        )
        logger.info(f"update_stage {stage_id} success")
    except Exception as e:
        logger.error(f"update_stage {stage_id} DB error: {e}")
        raise HTTPException(status_code=500, detail=f"Database update failed: {str(e)}")
    return {"success": True}


@router.delete("/definitions/{definition_id}/stages/{stage_id}")
async def delete_stage(
    definition_id: UUID,
    stage_id: UUID,
    conn = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)

    existing = row(conn,
        "SELECT id FROM workflow_stages WHERE id = %s AND workflow_definition_id = %s AND is_deleted = FALSE",
        (str(stage_id), str(definition_id)),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Stage not found")

    execute(conn,
        "UPDATE workflow_stages SET is_deleted = TRUE WHERE id = %s",
        (str(stage_id),),
    )
    return {"success": True}


@router.post("/definitions/{definition_id}/routing-rules")
async def add_routing_rule(
    definition_id: UUID,
    body: CreateRoutingRuleRequest,
    conn = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)

    existing = row(conn,
        "SELECT id FROM workflow_definitions WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(definition_id), org_id),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    rule = execute_returning(conn,
        """
        INSERT INTO workflow_routing_rules (
            workflow_definition_id, from_stage_id, to_stage_id,
            condition_type, condition_field_id, condition_value, priority, label
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            str(definition_id),
            str(body.from_stage_id),
            str(body.to_stage_id),
            body.condition_type,
            str(body.condition_field_id) if body.condition_field_id else None,
            body.condition_value,
            body.priority,
            body.label,
        ),
    )
    return dict(rule)


@router.put("/definitions/{definition_id}/rules/{rule_id}")
async def update_routing_rule(
    definition_id: UUID,
    rule_id: UUID,
    body: UpdateRoutingRuleRequest,
    conn = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)

    existing = row(conn,
        "SELECT id FROM workflow_routing_rules WHERE id = %s AND workflow_definition_id = %s AND is_deleted = FALSE",
        (str(rule_id), str(definition_id)),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Routing rule not found")

    updates: dict = {}
    for field in ("condition_type", "condition_value", "priority", "label"):
        val = getattr(body, field, None)
        if val is not None:
            updates[field] = val

    if updates:
        set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
        execute(conn,
            f"UPDATE workflow_routing_rules SET {set_clause} WHERE id = %s",
            (*updates.values(), str(rule_id)),
        )
    return {"success": True}


@router.delete("/definitions/{definition_id}/rules/{rule_id}")
async def delete_routing_rule(
    definition_id: UUID,
    rule_id: UUID,
    conn = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org(current_user)

    existing = row(conn,
        "SELECT id FROM workflow_routing_rules WHERE id = %s AND workflow_definition_id = %s AND is_deleted = FALSE",
        (str(rule_id), str(definition_id)),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Routing rule not found")

    execute(conn,
        "UPDATE workflow_routing_rules SET is_deleted = TRUE WHERE id = %s",
        (str(rule_id),),
    )
    return {"success": True}


# ─────────────────────────────────────────────────────────────────────────────
# Workflow Instances
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/instances")
async def trigger_workflow_instance(
    body: TriggerWorkflowRequest,
    conn = Depends(get_db),
    current_user: dict = Depends(require_manager_or_above),
):
    """Manually trigger a workflow instance."""
    org_id = _get_org(current_user)
    user_id = current_user["sub"]
    try:
        instance = await trigger_workflow(
            conn,
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
    conn = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org(current_user)
    user_id = current_user["sub"]
    user_role = (current_user.get("app_metadata") or {}).get("role")
    logger.info(f"my-tasks: user={user_id} role={user_role} org={org_id}")
    try:
        tasks = await get_my_tasks(conn, user_id, org_id, user_role=user_role)
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
    conn = Depends(get_db),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    offset = (page - 1) * page_size

    conditions = ["wi.organisation_id = %s", "wi.is_deleted = FALSE"]
    params: list = [org_id]

    if status:
        conditions.append("wi.status = %s")
        params.append(status)
    if location_id:
        conditions.append("wi.location_id = %s")
        params.append(location_id)
    if definition_id:
        conditions.append("wi.workflow_definition_id = %s")
        params.append(definition_id)
    if from_date:
        conditions.append("wi.created_at >= %s")
        params.append(from_date)
    if to_date:
        conditions.append("wi.created_at <= %s")
        params.append(to_date)

    where_clause = " AND ".join(conditions)
    params.extend([page_size, offset])

    instance_rows = rows(conn,
        f"""
        SELECT
            wi.*,
            wd.name AS wd_name, wd.trigger_type AS wd_trigger_type,
            ws_cur.name AS cur_stage_name, ws_cur.action_type AS cur_stage_action_type
        FROM workflow_instances wi
        LEFT JOIN workflow_definitions wd ON wd.id = wi.workflow_definition_id
        LEFT JOIN workflow_stages ws_cur ON ws_cur.id = wi.current_stage_id
        WHERE {where_clause}
        ORDER BY wi.created_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params),
    )

    result = []
    for wi in instance_rows:
        wi = dict(wi)
        wi["workflow_definitions"] = {"name": wi.pop("wd_name", None), "trigger_type": wi.pop("wd_trigger_type", None)}
        wi["workflow_stages"] = {"name": wi.pop("cur_stage_name", None), "action_type": wi.pop("cur_stage_action_type", None)}
        result.append(wi)
    return result


@router.get("/instances/{instance_id}")
async def get_workflow_instance(
    instance_id: UUID,
    conn = Depends(get_db),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    data = await get_instance_detail(conn, str(instance_id), org_id)
    if not data:
        raise HTTPException(status_code=404, detail="Workflow instance not found")
    return data


@router.post("/instances/{instance_id}/cancel")
async def cancel_workflow_instance(
    instance_id: UUID,
    body: CancelWorkflowRequest,
    conn = Depends(get_db),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)

    inst = row(conn,
        "SELECT id, status FROM workflow_instances WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(instance_id), org_id),
    )
    if not inst:
        raise HTTPException(status_code=404, detail="Workflow instance not found")
    if inst["status"] in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Instance already {inst['status']}")

    execute(conn,
        "UPDATE workflow_instances SET status = 'cancelled', cancelled_reason = %s WHERE id = %s",
        (body.reason, str(instance_id)),
    )
    return {"success": True}


@router.post("/instances/{instance_id}/stages/{stage_instance_id}/approve")
async def approve_workflow_stage(
    instance_id: UUID,
    stage_instance_id: UUID,
    body: ApproveStageRequest,
    conn = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org(current_user)
    try:
        result = await approve_stage(
            conn,
            instance_id=str(instance_id),
            stage_instance_id=str(stage_instance_id),
            acting_user_id=current_user["sub"],
            comment=body.comment,
            org_id=org_id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/instances/{instance_id}/stages/{stage_instance_id}/reject")
async def reject_workflow_stage(
    instance_id: UUID,
    stage_instance_id: UUID,
    body: RejectStageRequest,
    conn = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org(current_user)
    try:
        result = await reject_stage(
            conn,
            instance_id=str(instance_id),
            stage_instance_id=str(stage_instance_id),
            acting_user_id=current_user["sub"],
            comment=body.comment,
            org_id=org_id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/instances/{instance_id}/stages/{stage_instance_id}")
async def get_stage_instance_detail(
    instance_id: UUID,
    stage_instance_id: UUID,
    conn = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return a single stage instance with its stage definition (includes form_template_id)."""
    org_id = _get_org(current_user)

    # Verify the workflow instance belongs to this org
    inst = row(conn,
        "SELECT id FROM workflow_instances WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(instance_id), org_id),
    )
    if not inst:
        raise HTTPException(status_code=404, detail="Workflow instance not found")

    si = row(conn,
        """
        SELECT
            wsi.*,
            ws.name AS ws_name, ws.action_type AS ws_action_type,
            ws.form_template_id AS ws_form_template_id,
            ws.config AS ws_config, ws.stage_order AS ws_stage_order,
            wd.name AS wd_name
        FROM workflow_stage_instances wsi
        JOIN workflow_stages ws ON ws.id = wsi.stage_id
        JOIN workflow_instances wi ON wi.id = wsi.workflow_instance_id
        JOIN workflow_definitions wd ON wd.id = wi.workflow_definition_id
        WHERE wsi.id = %s AND wsi.workflow_instance_id = %s
        """,
        (str(stage_instance_id), str(instance_id)),
    )
    if not si:
        raise HTTPException(status_code=404, detail="Stage instance not found")

    data = dict(si)
    action_type = data.get("ws_action_type")
    data["workflow_stages"] = {
        "name": data.pop("ws_name"),
        "action_type": action_type,
        "form_template_id": data.pop("ws_form_template_id"),
        "config": data.pop("ws_config"),
        "stage_order": data.pop("ws_stage_order"),
    }
    data["workflow_instances"] = {
        "workflow_definitions": {"name": data.pop("wd_name")}
    }

    # Always fetch all sibling stage instances for history timeline
    siblings = rows(conn,
        """
        SELECT
            wsi.id, wsi.status, wsi.completed_at, wsi.comment,
            wsi.assigned_to, wsi.form_submission_id,
            ws.name AS ws_name, ws.action_type AS ws_action_type, ws.stage_order AS ws_stage_order,
            p.full_name AS assignee_full_name
        FROM workflow_stage_instances wsi
        JOIN workflow_stages ws ON ws.id = wsi.stage_id
        LEFT JOIN profiles p ON p.id = wsi.assigned_to
        WHERE wsi.workflow_instance_id = %s
        ORDER BY ws.stage_order
        """,
        (str(instance_id),),
    )

    data["stage_history"] = [
        {
            "id": s["id"],
            "stage_name": s["ws_name"],
            "action_type": s["ws_action_type"],
            "stage_order": s["ws_stage_order"],
            "status": s["status"],
            "completed_at": s["completed_at"],
            "comment": s["comment"],
            "completed_by": s["assignee_full_name"],
            "form_submission_id": s["form_submission_id"],
        }
        for s in siblings
    ]

    # For approve/review/sign stages, find the most recently completed fill_form stage's submission
    if action_type in ("approve", "review", "sign"):
        fill_stages = [
            s for s in siblings
            if s["ws_action_type"] in ("fill_form", "sign") and s["form_submission_id"]
        ]
        if fill_stages:
            fill_stages.sort(key=lambda s: s["ws_stage_order"] or 0, reverse=True)
            data["review_submission_id"] = fill_stages[0]["form_submission_id"]
    return data


@router.post("/instances/{instance_id}/stages/{stage_instance_id}/submit-form")
async def submit_form_for_stage(
    instance_id: UUID,
    stage_instance_id: UUID,
    body: SubmitFormForStageRequest,
    conn = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Submit a form for a fill_form type stage."""
    org_id = _get_org(current_user)

    # Verify the workflow instance belongs to this org
    inst_check = row(conn,
        "SELECT id FROM workflow_instances WHERE id = %s AND organisation_id = %s",
        (str(instance_id), org_id),
    )
    if not inst_check:
        raise HTTPException(status_code=403, detail="Not found")

    si = row(conn,
        """
        SELECT wsi.*, ws.form_template_id AS ws_form_template_id, ws.action_type AS ws_action_type
        FROM workflow_stage_instances wsi
        JOIN workflow_stages ws ON ws.id = wsi.stage_id
        WHERE wsi.id = %s AND wsi.workflow_instance_id = %s
        """,
        (str(stage_instance_id), str(instance_id)),
    )
    if not si:
        raise HTTPException(status_code=404, detail="Stage instance not found")

    if si["ws_action_type"] not in ("fill_form", "sign"):
        raise HTTPException(status_code=400, detail="This stage does not require a form submission")

    form_template_id = si["ws_form_template_id"]
    if not form_template_id:
        raise HTTPException(status_code=400, detail="Stage has no form template configured")

    try:
        sub = execute_returning(conn,
            """
            INSERT INTO form_submissions (form_template_id, submitted_by, status, submitted_at)
            VALUES (%s, %s, 'submitted', %s)
            RETURNING id
            """,
            (form_template_id, current_user["sub"], datetime.now(timezone.utc).isoformat()),
        )
    except Exception as e:
        logger.error(f"submit_form_for_stage: form_submissions insert failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create submission: {e}")

    if not sub:
        logger.error("submit_form_for_stage: insert returned no data")
        raise HTTPException(status_code=500, detail="Failed to create submission — no data returned")

    sub_id = sub["id"]
    logger.info(f"submit_form_for_stage: created submission {sub_id} for stage {stage_instance_id}")

    if body.responses:
        execute_many(conn,
            "INSERT INTO form_responses (submission_id, field_id, value) VALUES (%s, %s, %s)",
            [(sub_id, r.get("field_id"), r.get("value")) for r in body.responses],
        )

    execute(conn,
        """
        UPDATE workflow_stage_instances
        SET form_submission_id = %s, status = 'approved', completed_at = %s
        WHERE id = %s
        """,
        (sub_id, datetime.now(timezone.utc).isoformat(), str(stage_instance_id)),
    )

    await advance_workflow(conn, str(instance_id), str(stage_instance_id), current_user["sub"])

    return {"success": True, "form_submission_id": sub_id}


# ─── Internal: Wait Stage Ticker ─────────────────────────────────────────────

@router.post("/internal/tick")
async def tick(
    conn = Depends(get_db),
    x_internal_secret: str = Header(default="", alias="X-Internal-Secret"),
    current_user: dict = Depends(require_admin),
):
    """
    Advance condition-based and timed-out wait stages.
    Call every 5 minutes via a server cron job.
    Requires admin role to prevent accidental public exposure.
    """
    if not _INTERNAL_SECRET or x_internal_secret != _INTERNAL_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    return await tick_wait_stages(conn)
