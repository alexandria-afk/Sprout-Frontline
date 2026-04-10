"""
Workflow Engine — Phase 3
Server-side state machine for multi-stage approval chains.
All stage transitions enforced here. Client cannot transition stages directly.
Supports trigger types: manual, audit_submitted, issue_created, incident_created, form_submitted
Supports stage types: review, approve, fill_form, sign, create_task, create_issue, create_incident, notify, wait
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from services.db import row, rows, execute, execute_returning, execute_many

logger = logging.getLogger(__name__)

FAIL_VALUES = {"false", "0", "fail", "no", "n/a", ""}

# System stage types that auto-complete without human action
SYSTEM_STAGE_TYPES = {"create_task", "create_issue", "create_incident", "notify", "wait", "assign_training"}


# ─────────────────────────────────────────────────────────────────────────────
# Routing Rule Evaluation
# ─────────────────────────────────────────────────────────────────────────────

def evaluate_rule(
    rule: dict,
    submission_responses: dict[str, str],
    overall_score: float,
    stage_instance: Optional[dict] = None,
    source_record: Optional[dict] = None,
    acting_user_role: Optional[str] = None,
) -> bool:
    """
    Evaluate a single routing rule. Returns True if the condition is met.
    """
    ctype = rule.get("condition_type")

    if ctype == "always":
        return True

    if ctype == "approved":
        return stage_instance is not None and stage_instance.get("status") == "approved"

    if ctype == "rejected":
        return stage_instance is not None and stage_instance.get("status") == "rejected"

    if ctype == "score_below":
        try:
            return overall_score < float(rule.get("condition_value", 0))
        except (ValueError, TypeError):
            return False

    if ctype == "score_above":
        try:
            return overall_score >= float(rule.get("condition_value", 0))
        except (ValueError, TypeError):
            return False

    if ctype == "field_failed":
        field_id = rule.get("condition_field_id")
        if not field_id:
            return False
        value = submission_responses.get(str(field_id))
        return value is None or str(value).strip().lower() in FAIL_VALUES

    if ctype == "field_value_equals":
        field_id = rule.get("condition_field_id")
        if not field_id:
            return False
        value = submission_responses.get(str(field_id))
        return value is not None and str(value).strip() == str(rule.get("condition_value", "")).strip()

    if ctype == "priority_equals":
        if source_record:
            return str(source_record.get("priority", "")).lower() == str(rule.get("condition_value", "")).lower()
        return False

    if ctype == "role_equals":
        return acting_user_role is not None and acting_user_role.lower() == str(rule.get("condition_value", "")).lower()

    if ctype == "sla_breached":
        if stage_instance and stage_instance.get("due_at"):
            now = datetime.now(timezone.utc)
            due = datetime.fromisoformat(stage_instance["due_at"].replace("Z", "+00:00"))
            return now > due
        return False

    return False


def find_next_stage_id(
    routing_rules: list[dict],
    from_stage_id: str,
    submission_responses: dict[str, str],
    overall_score: float,
    stage_instance: Optional[dict] = None,
    source_record: Optional[dict] = None,
    acting_user_role: Optional[str] = None,
) -> Optional[str]:
    """
    Evaluate routing rules from a given stage, ordered by priority DESC.
    Returns the first matching to_stage_id, or None if no rule matches.
    """
    applicable = [
        r for r in routing_rules
        if str(r.get("from_stage_id")) == str(from_stage_id)
        and not r.get("is_deleted", False)
    ]
    # Sort by priority descending; 'always' rules are lowest priority
    applicable.sort(key=lambda r: (
        -int(r.get("priority", 0)),
        1 if r.get("condition_type") == "always" else 0
    ))

    always_rule = None
    for rule in applicable:
        if rule.get("condition_type") == "always":
            always_rule = rule
            continue
        if evaluate_rule(rule, submission_responses, overall_score, stage_instance, source_record, acting_user_role):
            return str(rule["to_stage_id"])

    # Fallback to 'always' rule if no specific condition matched
    if always_rule:
        return str(always_rule["to_stage_id"])

    return None


# ─────────────────────────────────────────────────────────────────────────────
# User Resolution
# ─────────────────────────────────────────────────────────────────────────────

async def resolve_stage_assignee(
    conn,
    stage: dict,
    location_id: Optional[str],
    org_id: str,
) -> Optional[str]:
    """
    Resolve the assigned user for a stage.
    Priority: specific assigned_user_id > first user with assigned_role at location.
    """
    if stage.get("assigned_user_id"):
        return str(stage["assigned_user_id"])

    assigned_role = stage.get("assigned_role")
    if not assigned_role:
        return None

    if location_id:
        r = row(conn,
            "SELECT id FROM profiles WHERE organisation_id = %s AND role = %s "
            "AND is_deleted = FALSE AND location_id = %s LIMIT 1",
            (org_id, assigned_role, location_id),
        )
    else:
        r = row(conn,
            "SELECT id FROM profiles WHERE organisation_id = %s AND role = %s "
            "AND is_deleted = FALSE LIMIT 1",
            (org_id, assigned_role),
        )
    return str(r["id"]) if r else None


# ─────────────────────────────────────────────────────────────────────────────
# System Stage Execution
# ─────────────────────────────────────────────────────────────────────────────

def _execute_system_stage(
    conn,
    stage: dict,
    stage_instance_id: str,
    instance: dict,
) -> dict:
    """
    Execute a system stage immediately (no human action needed).
    Returns update dict for the stage_instance.
    """
    action_type = stage.get("action_type")
    cfg = stage.get("config") or {}
    org_id = instance["organisation_id"]
    triggered_by = instance.get("triggered_by")
    location_id = instance.get("location_id")
    now_iso = datetime.now(timezone.utc).isoformat()

    update: dict = {
        "status": "auto_completed",
        "completed_at": now_iso,
    }

    if action_type == "notify":
        # TODO: send FCM notification via notification service
        logger.info(f"[notify stage] message={cfg.get('message')} roles={cfg.get('roles')}")

    elif action_type == "wait":
        timeout_days = cfg.get("timeout_days")
        if timeout_days:
            hours = int(float(timeout_days) * 24)
        else:
            hours = int(cfg.get("hours", 24))
        due_at = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
        # Mark as in_progress — tick_wait_stages advances when condition met or timed out
        update = {"status": "in_progress", "due_at": due_at}

    elif action_type == "create_task":
        # Resolve assignee: prefer stage.assigned_role, fall back to cfg key variants
        task_role = stage.get("assigned_role") or cfg.get("assign_role") or cfg.get("assigned_role")
        task_due_at = None
        deadline_days = cfg.get("deadline_days")
        due_hours = cfg.get("due_hours")
        if deadline_days:
            task_due_at = (datetime.now(timezone.utc) + timedelta(days=int(deadline_days))).isoformat()
        elif due_hours:
            task_due_at = (datetime.now(timezone.utc) + timedelta(hours=int(due_hours))).isoformat()

        assigned_to = None
        if task_role:
            assigned_to = _resolve_role_sync(conn, task_role, org_id, location_id)

        task_row = execute_returning(conn,
            """
            INSERT INTO tasks (organisation_id, title, priority, status, source_type,
                               created_by, location_id, due_at, assigned_to)
            VALUES (%s, %s, %s, 'pending', 'workflow', %s, %s, %s, %s)
            RETURNING id
            """,
            (
                org_id,
                cfg.get("title", "Workflow Task"),
                cfg.get("priority", "medium"),
                triggered_by,
                location_id,
                task_due_at,
                assigned_to,
            ),
        )
        if task_row:
            spawned_id = task_row["id"]
            execute(conn,
                "UPDATE workflow_stage_instances SET spawned_task_id = %s WHERE id = %s",
                (spawned_id, stage_instance_id),
            )
            logger.info(f"[create_task stage] spawned task {spawned_id}")

    elif action_type == "create_issue":
        reported_by = triggered_by or _get_first_admin(conn, org_id)
        loc_id = location_id or _get_first_location(conn, org_id)
        category_id = cfg.get("category_id")
        issue_row = execute_returning(conn,
            """
            INSERT INTO issues (organisation_id, title, priority, status, reported_by,
                                location_id, category_id)
            VALUES (%s, %s, %s, 'open', %s, %s, %s)
            RETURNING id
            """,
            (
                org_id,
                cfg.get("title", "Workflow Issue"),
                cfg.get("priority", "medium"),
                reported_by,
                loc_id,
                category_id,
            ),
        )
        if issue_row:
            spawned_id = issue_row["id"]
            execute(conn,
                "UPDATE workflow_stage_instances SET spawned_issue_id = %s WHERE id = %s",
                (spawned_id, stage_instance_id),
            )
            logger.info(f"[create_issue stage] spawned issue {spawned_id}")

    elif action_type == "create_incident":
        reported_by = triggered_by or _get_first_admin(conn, org_id)
        incident_row = execute_returning(conn,
            """
            INSERT INTO incidents (org_id, title, status, incident_date, reported_by)
            VALUES (%s, %s, 'reported', %s, %s)
            RETURNING id
            """,
            (
                org_id,
                cfg.get("title", "Workflow Incident"),
                now_iso,
                reported_by,
            ),
        )
        if incident_row:
            spawned_id = incident_row["id"]
            execute(conn,
                "UPDATE workflow_stage_instances SET spawned_incident_id = %s WHERE id = %s",
                (spawned_id, stage_instance_id),
            )
            logger.info(f"[create_incident stage] spawned incident {spawned_id}")

    elif action_type == "assign_training":
        course_ids_raw = cfg.get("course_ids", "[]")
        try:
            course_ids: list = json.loads(course_ids_raw) if isinstance(course_ids_raw, str) else list(course_ids_raw or [])
        except Exception:
            course_ids = []
        # Resolve course_refs (name strings) to IDs for this org
        course_refs = cfg.get("course_refs") or []
        if course_refs:
            ref_rows = rows(conn,
                "SELECT id FROM courses WHERE title = ANY(%s) AND organisation_id = %s AND is_deleted = FALSE",
                (course_refs, org_id),
            )
            course_ids += [r["id"] for r in ref_rows]

        subject_user_id = instance.get("subject_user_id") or triggered_by
        if subject_user_id and course_ids:
            deadline_dt = None
            deadline_days = cfg.get("deadline_days")
            if deadline_days:
                try:
                    deadline_dt = (datetime.now(timezone.utc) + timedelta(days=int(deadline_days))).isoformat()
                except (ValueError, TypeError):
                    pass
            # Single query to find already-enrolled courses (avoids N+1)
            already_rows = rows(conn,
                "SELECT course_id FROM course_enrollments WHERE user_id = %s AND course_id = ANY(%s::uuid[])",
                (subject_user_id, list(course_ids)),
            )
            already_enrolled = {r["course_id"] for r in already_rows}
            enrolled_by = triggered_by or _get_first_admin(conn, org_id)
            enrollment_rows = [
                (cid, subject_user_id, enrolled_by, "not_started", deadline_dt)
                for cid in course_ids if cid not in already_enrolled
            ]
            if enrollment_rows:
                execute_many(conn,
                    """
                    INSERT INTO course_enrollments (course_id, user_id, enrolled_by, status, cert_expires_at)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    enrollment_rows,
                )
                logger.info(f"[assign_training stage] enrolled user {subject_user_id} in {len(enrollment_rows)} courses")

    return update


def _resolve_role_sync(conn, role: str, org_id: str, location_id: Optional[str]) -> Optional[str]:
    if location_id:
        r = row(conn,
            "SELECT id FROM profiles WHERE organisation_id = %s AND role = %s "
            "AND is_deleted = FALSE AND location_id = %s LIMIT 1",
            (org_id, role, location_id),
        )
    else:
        r = row(conn,
            "SELECT id FROM profiles WHERE organisation_id = %s AND role = %s "
            "AND is_deleted = FALSE LIMIT 1",
            (org_id, role),
        )
    return r["id"] if r else None


def _get_first_admin(conn, org_id: str) -> Optional[str]:
    r = row(conn,
        "SELECT id FROM profiles WHERE organisation_id = %s AND role = ANY(%s) LIMIT 1",
        (org_id, ["admin", "super_admin"]),
    )
    return r["id"] if r else None


def _get_first_location(conn, org_id: str) -> Optional[str]:
    r = row(conn,
        "SELECT id FROM locations WHERE organisation_id = %s AND is_deleted = FALSE LIMIT 1",
        (org_id,),
    )
    return r["id"] if r else None


# ─────────────────────────────────────────────────────────────────────────────
# Core Stage Activation
# ─────────────────────────────────────────────────────────────────────────────

def _activate_stage(conn, instance_id: str, stage_id: str, stage: dict, instance: dict, response_map: dict):
    """
    Activate a stage instance:
    - Set status → in_progress (or auto_completed for system stages)
    - Assign user
    - Set due_at if sla_hours set
    - Execute system stages immediately
    """
    org_id = instance["organisation_id"]
    location_id = instance.get("location_id")

    # Resolve location from submission if not on instance
    if not location_id and instance.get("submission_id"):
        sub_loc = row(conn,
            "SELECT location_id FROM form_submissions WHERE id = %s",
            (instance["submission_id"],),
        )
        location_id = sub_loc["location_id"] if sub_loc else None

    # Resolve assignee (by specific user, or by role+location, or by role org-wide)
    assigned_user_id = stage.get("assigned_user_id")
    if not assigned_user_id and stage.get("assigned_role"):
        assigned_user_id = _resolve_role_sync(conn, stage["assigned_role"], org_id, location_id)
    logger.info(f"_activate_stage: stage='{stage.get('name')}' role={stage.get('assigned_role')} location={location_id} assigned_to={assigned_user_id}")

    # Compute due_at
    sla_hours = stage.get("sla_hours")
    due_at = None
    if sla_hours:
        due_at = (datetime.now(timezone.utc) + timedelta(hours=int(sla_hours))).isoformat()

    # Activate stage instance
    if due_at:
        execute(conn,
            """
            UPDATE workflow_stage_instances
            SET status = 'in_progress', assigned_to = %s, started_at = NOW(), due_at = %s
            WHERE workflow_instance_id = %s AND stage_id = %s
            """,
            (assigned_user_id, due_at, instance_id, stage_id),
        )
    else:
        execute(conn,
            """
            UPDATE workflow_stage_instances
            SET status = 'in_progress', assigned_to = %s, started_at = NOW()
            WHERE workflow_instance_id = %s AND stage_id = %s
            """,
            (assigned_user_id, instance_id, stage_id),
        )

    # Execute system stages immediately
    action_type = stage.get("action_type")
    if action_type in SYSTEM_STAGE_TYPES:
        si_row = row(conn,
            "SELECT id FROM workflow_stage_instances WHERE workflow_instance_id = %s AND stage_id = %s",
            (instance_id, stage_id),
        )
        if si_row:
            stage_instance_id = si_row["id"]
            update = _execute_system_stage(conn, stage, stage_instance_id, instance)
            if update:
                set_clauses = ", ".join(f"{k} = %s" for k in update.keys())
                execute(conn,
                    f"UPDATE workflow_stage_instances SET {set_clauses} WHERE id = %s",
                    (*update.values(), stage_instance_id),
                )

    # Notify the assigned user for human-action stages
    HUMAN_STAGE_TYPES = {"approve", "review", "sign", "fill_form"}
    if action_type in HUMAN_STAGE_TYPES and assigned_user_id:
        try:
            import asyncio as _asyncio
            from services import notification_service as _ns
            action_label = {
                "approve": "Needs your approval",
                "review": "Needs your review",
                "sign": "Needs your signature",
                "fill_form": "Fill in form",
            }.get(action_type, "Action needed")
            workflow_name = instance.get("workflow_definitions", {}).get("name", "Workflow")
            stage_name = stage.get("name", "Step")
            _asyncio.create_task(_ns.notify(
                org_id=org_id,
                recipient_user_id=assigned_user_id,
                type="workflow_stage_assigned",
                title=f"Action needed: {stage_name} for {workflow_name}",
                body=action_label,
                entity_type="workflow_instance",
                entity_id=instance_id,
            ))
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# Workflow Triggering (generic — used for all trigger types)
# ─────────────────────────────────────────────────────────────────────────────

async def trigger_workflow(
    conn,
    definition_id: str,
    org_id: str,
    source_type: str,
    triggered_by: str,
    source_id: Optional[str] = None,
    location_id: Optional[str] = None,
    submission_id: Optional[str] = None,
    submission_responses: Optional[dict] = None,
    overall_score: float = 0.0,
    subject_user_id: Optional[str] = None,
) -> Optional[dict]:
    """
    Create a workflow instance for the given definition and activate the first stage.
    Works for all trigger types (manual, issue_created, incident_created, audit_submitted, etc.)
    """
    wf_def = row(conn,
        """
        SELECT id, name FROM workflow_definitions
        WHERE id = %s AND organisation_id = %s AND is_active = TRUE AND is_deleted = FALSE
        """,
        (definition_id, org_id),
    )
    if not wf_def:
        return None

    wf_def_id = wf_def["id"]

    stages = rows(conn,
        """
        SELECT * FROM workflow_stages
        WHERE workflow_definition_id = %s AND is_deleted = FALSE
        ORDER BY stage_order
        """,
        (wf_def_id,),
    )
    if not stages:
        logger.warning(f"Workflow {wf_def_id} has no stages — skipping instantiation")
        return None

    routing_rules = rows(conn,
        "SELECT * FROM workflow_routing_rules WHERE workflow_definition_id = %s AND is_deleted = FALSE",
        (wf_def_id,),
    )

    first_stage = stages[0]
    instance = execute_returning(conn,
        """
        INSERT INTO workflow_instances (
            workflow_definition_id, organisation_id, status, current_stage_id,
            source_type, triggered_by, source_id, location_id, submission_id, subject_user_id
        ) VALUES (%s, %s, 'in_progress', %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            wf_def_id, org_id, first_stage["id"],
            source_type, triggered_by,
            source_id, location_id, submission_id, subject_user_id,
        ),
    )
    instance = dict(instance)
    instance_id = instance["id"]

    # Create all stage instances as pending
    execute_many(conn,
        "INSERT INTO workflow_stage_instances (workflow_instance_id, stage_id, status) VALUES (%s, %s, 'pending')",
        [(instance_id, stage["id"]) for stage in stages],
    )

    # Activate first stage
    _activate_stage(conn, instance_id, first_stage["id"], dict(first_stage), instance, submission_responses or {})

    logger.info(
        f"Workflow instance {instance_id} created (trigger={source_type}, source={source_id}), "
        f"first stage: {first_stage['name']}"
    )
    return instance


async def trigger_workflows_for_event(
    conn,
    event_type: str,  # 'issue_created' | 'incident_created'
    org_id: str,
    source_id: str,
    triggered_by: str,
    location_id: Optional[str] = None,
    category_id: Optional[str] = None,
    template_id: Optional[str] = None,
    subject_user_id: Optional[str] = None,
) -> list[dict]:
    """
    Find all active workflows matching trigger_type and auto-start them.
    Called from issue/incident create endpoints.
    """
    wf_rows = rows(conn,
        """
        SELECT id, trigger_form_template_id, trigger_issue_category_id, trigger_conditions
        FROM workflow_definitions
        WHERE trigger_type = %s AND organisation_id = %s AND is_active = TRUE AND is_deleted = FALSE
        """,
        (event_type, org_id),
    )

    instances = []
    for wf in wf_rows:
        # Filter by form template if applicable
        if event_type in ("form_submitted", "audit_submitted") and template_id:
            wf_tpl_id = wf.get("trigger_form_template_id")
            if wf_tpl_id and str(wf_tpl_id) != str(template_id):
                continue  # This workflow is scoped to a different template

        # Filter by issue category if applicable
        if event_type == "issue_created" and category_id:
            wf_cat_id = wf.get("trigger_issue_category_id")
            if wf_cat_id and str(wf_cat_id) != str(category_id):
                continue  # This workflow is scoped to a different category

        instance = await trigger_workflow(
            conn,
            definition_id=wf["id"],
            org_id=org_id,
            source_type=event_type.replace("_created", ""),
            triggered_by=triggered_by,
            source_id=source_id,
            location_id=location_id,
            subject_user_id=subject_user_id,
        )
        if instance:
            instances.append(instance)
    return instances


async def trigger_workflows_for_employee_created(
    conn,
    org_id: str,
    new_user_id: str,
    triggered_by: str,
    role: Optional[str] = None,
    department: Optional[str] = None,
    location_id: Optional[str] = None,
) -> list[dict]:
    """
    Find all active workflows with trigger_type='employee_created' and evaluate
    trigger_conditions against the new employee profile. If conditions match, start workflow.
    """
    wf_rows = rows(conn,
        """
        SELECT id, trigger_conditions FROM workflow_definitions
        WHERE trigger_type = 'employee_created' AND organisation_id = %s
          AND is_active = TRUE AND is_deleted = FALSE
        """,
        (org_id,),
    )

    instances = []
    for wf in wf_rows:
        conditions = wf.get("trigger_conditions") or {}

        # Role filter
        allowed_roles = conditions.get("roles")
        if allowed_roles and isinstance(allowed_roles, list) and role:
            if role not in allowed_roles:
                continue

        # Department filter
        required_dept = conditions.get("department")
        if required_dept and department:
            if str(required_dept).strip().lower() != str(department).strip().lower():
                continue

        instance = await trigger_workflow(
            conn,
            definition_id=wf["id"],
            org_id=org_id,
            source_type="employee_created",
            triggered_by=triggered_by,
            source_id=new_user_id,
            location_id=location_id,
            subject_user_id=new_user_id,
        )
        if instance:
            instances.append(instance)
    return instances


# ─────────────────────────────────────────────────────────────────────────────
# Wait Stage Ticker — advance condition-based and timed-out wait stages
# ─────────────────────────────────────────────────────────────────────────────

async def tick_wait_stages(conn) -> dict:
    """
    Advance all in-progress wait stage instances that are either:
      - Timed out (due_at <= now), or
      - Condition met (e.g. all_courses_passed for the subject_user_id).
    Call this every 5 minutes via an internal cron endpoint.

    Cross-tenant design note: this function is intentionally called from the
    internal tick endpoint and processes wait stages across ALL organisations
    in a single query.  There is no single-org scope here by design.  The
    select is deliberately limited to the minimum columns needed to keep the
    memory footprint small when the table grows.
    """
    now = datetime.now(timezone.utc)
    advanced = 0
    timed_out_count = 0

    # Select only the columns required for timeout/condition evaluation — do
    # not use SELECT * to avoid loading large config blobs for non-wait stages.
    stage_instances = rows(conn,
        """
        SELECT
            wsi.id,
            wsi.workflow_instance_id,
            wsi.due_at,
            wsi.stage_id,
            ws.action_type AS stage_action_type,
            ws.config AS stage_config,
            ws.workflow_definition_id AS stage_wf_def_id,
            wi.organisation_id AS instance_org_id,
            wi.subject_user_id AS instance_subject_user_id
        FROM workflow_stage_instances wsi
        JOIN workflow_stages ws ON ws.id = wsi.stage_id
        JOIN workflow_instances wi ON wi.id = wsi.workflow_instance_id
        WHERE wsi.status = 'in_progress'
        """,
        (),
    )

    for si in stage_instances:
        if si.get("stage_action_type") != "wait":
            continue

        org_id = si.get("instance_org_id")
        subject_user_id = si.get("instance_subject_user_id")
        cfg = si.get("stage_config") or {}
        condition = cfg.get("condition")
        wf_def_id = si.get("stage_wf_def_id")

        # ── Timeout check ────────────────────────────────────────────────────
        due_at_str = si.get("due_at")
        if due_at_str:
            if isinstance(due_at_str, str):
                due_dt = datetime.fromisoformat(due_at_str.replace("Z", "+00:00"))
            else:
                due_dt = due_at_str
            if now >= due_dt:
                execute(conn,
                    """
                    UPDATE workflow_stage_instances
                    SET status = 'auto_completed', completed_at = %s, comment = 'Wait timed out'
                    WHERE id = %s
                    """,
                    (now.isoformat(), si["id"]),
                )
                await advance_workflow(conn, si["workflow_instance_id"], si["id"], None)
                timed_out_count += 1
                continue

        # ── Condition check ───────────────────────────────────────────────────
        if condition == "all_courses_passed" and subject_user_id and org_id:
            # Resolve course_refs from the sibling assign_training stage definition
            at_row = row(conn,
                """
                SELECT config FROM workflow_stages
                WHERE workflow_definition_id = %s AND action_type = 'assign_training' LIMIT 1
                """,
                (wf_def_id,),
            )
            if not at_row:
                continue
            at_cfg = at_row.get("config") or {}
            course_refs = at_cfg.get("course_refs") or []
            raw_ids = at_cfg.get("course_ids") or []
            if isinstance(raw_ids, str):
                try:
                    raw_ids = json.loads(raw_ids)
                except Exception:
                    raw_ids = []
            all_course_ids: list = list(raw_ids)
            if course_refs:
                ref_rows = rows(conn,
                    "SELECT id FROM courses WHERE title = ANY(%s) AND organisation_id = %s AND is_deleted = FALSE",
                    (course_refs, org_id),
                )
                all_course_ids += [r["id"] for r in ref_rows]

            if not all_course_ids:
                continue

            enrollments = rows(conn,
                "SELECT status FROM course_enrollments WHERE user_id = %s AND course_id = ANY(%s::uuid[])",
                (subject_user_id, list(all_course_ids)),
            )
            # All courses must be enrolled and passed
            if len(enrollments) == len(all_course_ids) and all(e["status"] == "passed" for e in enrollments):
                execute(conn,
                    """
                    UPDATE workflow_stage_instances
                    SET status = 'auto_completed', completed_at = %s, comment = 'All required courses passed'
                    WHERE id = %s
                    """,
                    (now.isoformat(), si["id"]),
                )
                await advance_workflow(conn, si["workflow_instance_id"], si["id"], None)
                advanced += 1

    logger.info(f"[tick_wait_stages] advanced={advanced} timed_out={timed_out_count}")
    return {"advanced": advanced, "timed_out": timed_out_count}


# ─────────────────────────────────────────────────────────────────────────────
# Legacy: Workflow Instantiation on form submission (kept for backwards compat)
# ─────────────────────────────────────────────────────────────────────────────

async def instantiate_workflow(
    conn,
    submission_id: str,
    form_template_id: str,
    org_id: str,
    location_id: str,
    submission_responses: dict[str, str],
    overall_score: float,
) -> Optional[dict]:
    """
    Check if form_template has an active workflow. If yes, trigger it.
    Maintains backwards compatibility with Phase 2 audit submission trigger.
    """
    wf_def = row(conn,
        """
        SELECT id, name FROM workflow_definitions
        WHERE form_template_id = %s AND organisation_id = %s
          AND is_active = TRUE AND is_deleted = FALSE
        LIMIT 1
        """,
        (form_template_id, org_id),
    )
    if not wf_def:
        return None

    sub_row = row(conn,
        "SELECT submitted_by FROM form_submissions WHERE id = %s",
        (submission_id,),
    )
    triggered_by = sub_row["submitted_by"] if sub_row else None

    return await trigger_workflow(
        conn,
        definition_id=wf_def["id"],
        org_id=org_id,
        source_type="audit",
        triggered_by=triggered_by,
        source_id=submission_id,
        location_id=location_id,
        submission_id=submission_id,
        submission_responses=submission_responses,
        overall_score=overall_score,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Stage Advancement (shared by approve + submit-form)
# ─────────────────────────────────────────────────────────────────────────────

async def advance_workflow(
    conn,
    instance_id: str,
    stage_instance_id: str,
    acting_user_id: Optional[str] = None,
) -> dict:
    """
    Find the next stage after stage_instance_id completes and activate it,
    or mark the workflow complete if there is no next stage.
    Call this after marking a stage instance as approved/completed.
    """
    stage_inst = row(conn,
        """
        SELECT wsi.*, wi.id AS wi_id, wi.workflow_definition_id, wi.organisation_id,
               wi.status AS wi_status, wi.source_type, wi.source_id,
               wi.submission_id, wi.location_id, wi.triggered_by, wi.subject_user_id,
               wi.current_stage_id
        FROM workflow_stage_instances wsi
        JOIN workflow_instances wi ON wi.id = wsi.workflow_instance_id
        WHERE wsi.id = %s
        """,
        (stage_instance_id,),
    )
    if not stage_inst:
        raise HTTPException(status_code=404, detail="Stage instance not found")

    # Build a sub-dict that mirrors the old nested workflow_instances structure
    instance = {
        "id": stage_inst["wi_id"],
        "workflow_definition_id": stage_inst["workflow_definition_id"],
        "organisation_id": stage_inst["organisation_id"],
        "status": stage_inst["wi_status"],
        "source_type": stage_inst["source_type"],
        "source_id": stage_inst["source_id"],
        "submission_id": stage_inst["submission_id"],
        "location_id": stage_inst["location_id"],
        "triggered_by": stage_inst["triggered_by"],
        "subject_user_id": stage_inst["subject_user_id"],
        "current_stage_id": stage_inst["current_stage_id"],
    }
    wf_def_id = instance["workflow_definition_id"]
    stage_id = stage_inst["stage_id"]

    routing_rules = rows(conn,
        "SELECT * FROM workflow_routing_rules WHERE workflow_definition_id = %s AND is_deleted = FALSE",
        (wf_def_id,),
    )

    response_map: dict = {}
    overall_score = 0.0
    if instance.get("submission_id"):
        resp_rows = rows(conn,
            "SELECT field_id, value FROM form_responses WHERE submission_id = %s",
            (instance["submission_id"],),
        )
        response_map = {str(r["field_id"]): r["value"] for r in resp_rows}
        score_row = row(conn,
            "SELECT overall_score FROM form_submissions WHERE id = %s",
            (instance["submission_id"],),
        )
        overall_score = float(score_row["overall_score"] or 0) if score_row else 0.0

    source_record = None
    if instance.get("source_type") and instance.get("source_id"):
        source_table = {"issue": "issues", "incident": "incidents"}.get(instance["source_type"])
        if source_table:
            source_record = row(conn,
                f"SELECT priority FROM {source_table} WHERE id = %s",
                (instance["source_id"],),
            )

    acting_user_role = None
    if acting_user_id:
        profile = row(conn, "SELECT role FROM profiles WHERE id = %s", (acting_user_id,))
        acting_user_role = profile["role"] if profile else None

    next_stage_id = find_next_stage_id(
        list(routing_rules), str(stage_id), response_map, overall_score,
        stage_instance=dict(stage_inst), source_record=source_record,
        acting_user_role=acting_user_role,
    )

    # If no routing rule matched, fall back to the next stage by stage_order
    if not next_stage_id:
        cur_stage = row(conn,
            "SELECT stage_order FROM workflow_stages WHERE id = %s",
            (str(stage_id),),
        )
        if cur_stage:
            cur_order = cur_stage["stage_order"]
            next_seq = row(conn,
                """
                SELECT id FROM workflow_stages
                WHERE workflow_definition_id = %s AND stage_order = %s
                """,
                (wf_def_id, cur_order + 1),
            )
            if next_seq:
                next_stage_id = str(next_seq["id"])

    if not next_stage_id:
        logger.info(f"advance_workflow {instance_id}: no next stage — completing workflow")
        execute(conn,
            "UPDATE workflow_instances SET status = 'completed', completed_at = NOW() WHERE id = %s",
            (instance_id,),
        )
        return {"status": "completed"}

    next_stage = row(conn, "SELECT * FROM workflow_stages WHERE id = %s", (next_stage_id,))
    if not next_stage:
        raise HTTPException(status_code=404, detail="Next workflow stage not found")
    next_stage = dict(next_stage)

    logger.info(
        f"advance_workflow {instance_id}: activating next stage '{next_stage.get('name')}' "
        f"(order={next_stage.get('stage_order')}, action={next_stage.get('action_type')}, "
        f"is_final={next_stage.get('is_final')})"
    )

    _activate_stage(conn, instance_id, next_stage_id, next_stage, instance, response_map)

    # Check the activated stage instance
    si_check = row(conn,
        "SELECT id, status, assigned_to FROM workflow_stage_instances "
        "WHERE workflow_instance_id = %s AND stage_id = %s",
        (instance_id, next_stage_id),
    )
    logger.info(f"advance_workflow {instance_id}: stage instance after activation = {si_check}")

    if next_stage.get("is_final"):
        execute(conn,
            """
            UPDATE workflow_instances
            SET status = 'completed', completed_at = NOW(), current_stage_id = %s
            WHERE id = %s
            """,
            (next_stage_id, instance_id),
        )
        return {"status": "completed", "final_stage_id": next_stage_id}
    else:
        execute(conn,
            "UPDATE workflow_instances SET status = 'in_progress', current_stage_id = %s WHERE id = %s",
            (next_stage_id, instance_id),
        )
        return {"status": "in_progress", "next_stage_id": next_stage_id}


# ─────────────────────────────────────────────────────────────────────────────
# Stage Completion (approve / reject)
# ─────────────────────────────────────────────────────────────────────────────

async def approve_stage(
    conn,
    instance_id: str,
    stage_instance_id: str,
    acting_user_id: str,
    comment: Optional[str],
    org_id: str = "",
) -> dict:
    """
    Approve the current stage and advance the workflow.
    """
    inst = row(conn,
        "SELECT id FROM workflow_instances WHERE id = %s AND organisation_id = %s",
        (instance_id, org_id),
    )
    if not inst:
        raise HTTPException(status_code=403, detail="Not found")

    stage_inst = row(conn,
        "SELECT workflow_instance_id, status FROM workflow_stage_instances WHERE id = %s",
        (stage_instance_id,),
    )
    if not stage_inst:
        raise HTTPException(status_code=404, detail="Stage instance not found")

    if str(stage_inst["workflow_instance_id"]) != str(instance_id):
        raise ValueError("Stage instance does not belong to this workflow instance")

    if stage_inst["status"] not in ("pending", "in_progress"):
        raise ValueError(f"Stage instance is already {stage_inst['status']}")

    execute(conn,
        """
        UPDATE workflow_stage_instances
        SET status = 'approved', completed_at = NOW(), comment = %s
        WHERE id = %s
        """,
        (comment, stage_instance_id),
    )

    return await advance_workflow(conn, instance_id, stage_instance_id, acting_user_id)


async def reject_stage(
    conn,
    instance_id: str,
    stage_instance_id: str,
    acting_user_id: str,
    comment: Optional[str],
    org_id: str = "",
) -> dict:
    """
    Reject the current stage and cancel the workflow.
    """
    inst = row(conn,
        "SELECT id FROM workflow_instances WHERE id = %s AND organisation_id = %s",
        (instance_id, org_id),
    )
    if not inst:
        raise HTTPException(status_code=403, detail="Not found")

    stage_inst = row(conn,
        "SELECT workflow_instance_id, stage_id, status FROM workflow_stage_instances WHERE id = %s",
        (stage_instance_id,),
    )
    if not stage_inst:
        raise HTTPException(status_code=404, detail="Stage instance not found")

    if str(stage_inst["workflow_instance_id"]) != str(instance_id):
        raise ValueError("Stage instance does not belong to this workflow instance")

    if stage_inst["status"] not in ("pending", "in_progress"):
        raise ValueError(f"Stage instance is already {stage_inst['status']}")

    execute(conn,
        """
        UPDATE workflow_stage_instances
        SET status = 'rejected', completed_at = NOW(), comment = %s
        WHERE id = %s
        """,
        (comment, stage_instance_id),
    )

    execute(conn,
        "UPDATE workflow_instances SET status = 'cancelled', cancelled_reason = %s WHERE id = %s",
        (comment, instance_id),
    )

    logger.info(f"Workflow instance {instance_id} CANCELLED — stage {stage_instance_id} rejected")
    return {"status": "cancelled"}


# ─────────────────────────────────────────────────────────────────────────────
# Queries
# ─────────────────────────────────────────────────────────────────────────────

async def get_my_tasks(conn, user_id: str, org_id: str, user_role: Optional[str] = None) -> list[dict]:
    # Query 1: directly assigned to this user by ID
    r1 = rows(conn,
        """
        SELECT
            wsi.id, wsi.status, wsi.started_at, wsi.due_at, wsi.comment, wsi.stage_id,
            wi.id AS wi_id, wi.status AS wi_status, wi.source_type, wi.source_id,
            wi.organisation_id AS wi_org_id,
            wd.name AS wd_name,
            ws.name AS ws_name, ws.action_type AS ws_action_type,
            ws.stage_order AS ws_stage_order, ws.assigned_role AS ws_assigned_role,
            ws.form_template_id AS ws_form_template_id,
            ft.title AS ft_title
        FROM workflow_stage_instances wsi
        JOIN workflow_instances wi ON wi.id = wsi.workflow_instance_id
        JOIN workflow_definitions wd ON wd.id = wi.workflow_definition_id
        JOIN workflow_stages ws ON ws.id = wsi.stage_id
        LEFT JOIN form_templates ft ON ft.id = ws.form_template_id
        WHERE wsi.assigned_to = %s
          AND wsi.status = 'in_progress'
          AND wi.organisation_id = %s
        """,
        (user_id, org_id),
    )

    # Query 2: assigned by role but no specific user set yet
    role_tasks: list[dict] = []
    if user_role:
        r2 = rows(conn,
            """
            SELECT
                wsi.id, wsi.status, wsi.started_at, wsi.due_at, wsi.comment, wsi.stage_id,
                wi.id AS wi_id, wi.status AS wi_status, wi.source_type, wi.source_id,
                wi.organisation_id AS wi_org_id,
                wd.name AS wd_name,
                ws.name AS ws_name, ws.action_type AS ws_action_type,
                ws.stage_order AS ws_stage_order, ws.assigned_role AS ws_assigned_role,
                ws.form_template_id AS ws_form_template_id,
                ft.title AS ft_title
            FROM workflow_stage_instances wsi
            JOIN workflow_instances wi ON wi.id = wsi.workflow_instance_id
            JOIN workflow_definitions wd ON wd.id = wi.workflow_definition_id
            JOIN workflow_stages ws ON ws.id = wsi.stage_id
            LEFT JOIN form_templates ft ON ft.id = ws.form_template_id
            WHERE wsi.assigned_to IS NULL
              AND wsi.status = 'in_progress'
              AND wi.organisation_id = %s
            """,
            (org_id,),
        )
        for t in r2:
            stage_role = t.get("ws_assigned_role")
            # Match if role matches, OR if no role set and user is super_admin (catch-all)
            if stage_role == user_role or (stage_role is None and user_role == "super_admin"):
                role_tasks.append(t)

    def _shape(t: dict) -> dict:
        """Reshape flat row into nested structure matching old Supabase response."""
        return {
            "id": t["id"],
            "status": t["status"],
            "started_at": t["started_at"],
            "due_at": t["due_at"],
            "comment": t["comment"],
            "stage_id": t["stage_id"],
            "workflow_instances": {
                "id": t["wi_id"],
                "status": t["wi_status"],
                "source_type": t["source_type"],
                "source_id": t["source_id"],
                "organisation_id": t["wi_org_id"],
                "workflow_definitions": {"name": t["wd_name"]},
            },
            "workflow_stages": {
                "name": t["ws_name"],
                "action_type": t["ws_action_type"],
                "stage_order": t["ws_stage_order"],
                "assigned_role": t["ws_assigned_role"],
                "form_template_id": t["ws_form_template_id"],
                "form_templates": {"title": t["ft_title"]} if t.get("ft_title") else None,
            },
        }

    # Merge, dedup by id
    seen: set[str] = set()
    merged: list[dict] = []
    for t in list(r1) + role_tasks:
        if t["id"] not in seen:
            seen.add(t["id"])
            merged.append(_shape(t))
    return merged


async def get_instance_detail(conn, instance_id: str, org_id: str) -> Optional[dict]:
    inst = row(conn,
        """
        SELECT
            wi.*,
            wd.id AS wd_id, wd.name AS wd_name, wd.trigger_type AS wd_trigger_type,
            ws_cur.name AS cur_stage_name, ws_cur.action_type AS cur_stage_action_type
        FROM workflow_instances wi
        JOIN workflow_definitions wd ON wd.id = wi.workflow_definition_id
        LEFT JOIN workflow_stages ws_cur ON ws_cur.id = wi.current_stage_id
        WHERE wi.id = %s AND wi.organisation_id = %s AND wi.is_deleted = FALSE
        """,
        (instance_id, org_id),
    )
    if not inst:
        return None
    inst = dict(inst)

    stage_instances = rows(conn,
        """
        SELECT
            wsi.id, wsi.status, wsi.started_at, wsi.completed_at, wsi.due_at,
            wsi.comment, wsi.assigned_to, wsi.spawned_task_id, wsi.spawned_issue_id,
            wsi.spawned_incident_id,
            ws.name AS ws_name, ws.action_type AS ws_action_type,
            ws.stage_order AS ws_stage_order, ws.is_final AS ws_is_final,
            ws.config AS ws_config
        FROM workflow_stage_instances wsi
        JOIN workflow_stages ws ON ws.id = wsi.stage_id
        WHERE wsi.workflow_instance_id = %s
        ORDER BY ws.stage_order
        """,
        (instance_id,),
    )

    inst["workflow_definitions"] = {
        "id": inst.pop("wd_id"),
        "name": inst.pop("wd_name"),
        "trigger_type": inst.pop("wd_trigger_type"),
    }
    inst["workflow_stages"] = {
        "name": inst.pop("cur_stage_name", None),
        "action_type": inst.pop("cur_stage_action_type", None),
    }
    inst["workflow_stage_instances"] = [
        {
            "id": si["id"],
            "status": si["status"],
            "started_at": si["started_at"],
            "completed_at": si["completed_at"],
            "due_at": si["due_at"],
            "comment": si["comment"],
            "assigned_to": si["assigned_to"],
            "spawned_task_id": si["spawned_task_id"],
            "spawned_issue_id": si["spawned_issue_id"],
            "spawned_incident_id": si["spawned_incident_id"],
            "workflow_stages": {
                "name": si["ws_name"],
                "action_type": si["ws_action_type"],
                "stage_order": si["ws_stage_order"],
                "is_final": si["ws_is_final"],
                "config": si["ws_config"],
            },
        }
        for si in stage_instances
    ]
    return inst
