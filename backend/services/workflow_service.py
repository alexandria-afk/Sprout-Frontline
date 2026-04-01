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
from services.supabase_client import get_admin_client

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

    db = get_admin_client()
    q = db.table("profiles") \
        .select("id") \
        .eq("organisation_id", org_id) \
        .eq("role", assigned_role) \
        .eq("is_deleted", False) \
        .limit(1)

    if location_id:
        q = q.eq("location_id", location_id)

    res = q.execute()
    if res.data:
        return str(res.data[0]["id"])
    return None


# ─────────────────────────────────────────────────────────────────────────────
# System Stage Execution
# ─────────────────────────────────────────────────────────────────────────────

def _execute_system_stage(
    db,
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
        task_row: dict = {
            "organisation_id": org_id,
            "title": cfg.get("title", "Workflow Task"),
            "priority": cfg.get("priority", "medium"),
            "status": "pending",
            "source_type": "workflow",
            "created_by": triggered_by,
        }
        if location_id:
            task_row["location_id"] = location_id
        if task_due_at:
            task_row["due_at"] = task_due_at
        if task_role:
            resolved = _resolve_role_sync(db, task_role, org_id, location_id)
            if resolved:
                task_row["assigned_to"] = resolved
        task_res = db.table("tasks").insert(task_row).execute()
        if task_res.data:
            spawned_id = task_res.data[0]["id"]
            db.table("workflow_stage_instances").update({"spawned_task_id": spawned_id}).eq("id", stage_instance_id).execute()
            logger.info(f"[create_task stage] spawned task {spawned_id}")

    elif action_type == "create_issue":
        issue_res = db.table("issues").insert({
            "organisation_id": org_id,
            "title": cfg.get("title", "Workflow Issue"),
            "priority": cfg.get("priority", "medium"),
            "status": "open",
            "reported_by": triggered_by or _get_first_admin(db, org_id),
            "location_id": location_id or _get_first_location(db, org_id),
            **({"category_id": cfg["category_id"]} if cfg.get("category_id") else {}),
        }).execute()
        if issue_res.data:
            spawned_id = issue_res.data[0]["id"]
            db.table("workflow_stage_instances").update({"spawned_issue_id": spawned_id}).eq("id", stage_instance_id).execute()
            logger.info(f"[create_issue stage] spawned issue {spawned_id}")

    elif action_type == "create_incident":
        incident_res = db.table("incidents").insert({
            "org_id": org_id,
            "title": cfg.get("title", "Workflow Incident"),
            "status": "reported",
            "incident_date": now_iso,
            "reported_by": triggered_by or _get_first_admin(db, org_id),
        }).execute()
        if incident_res.data:
            spawned_id = incident_res.data[0]["id"]
            db.table("workflow_stage_instances").update({"spawned_incident_id": spawned_id}).eq("id", stage_instance_id).execute()
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
            refs_res = db.table("courses").select("id").in_("title", course_refs).eq("organisation_id", org_id).eq("is_deleted", False).execute()
            course_ids += [r["id"] for r in (refs_res.data or [])]
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
            existing_res = db.table("course_enrollments") \
                .select("course_id") \
                .eq("user_id", subject_user_id) \
                .in_("course_id", course_ids) \
                .execute()
            already_enrolled = {r["course_id"] for r in (existing_res.data or [])}
            enrolled_by = triggered_by or _get_first_admin(db, org_id)
            enrollment_rows = [
                {
                    "course_id": cid,
                    "user_id": subject_user_id,
                    "enrolled_by": enrolled_by,
                    "status": "not_started",
                    **({"cert_expires_at": deadline_dt} if deadline_dt else {}),
                }
                for cid in course_ids if cid not in already_enrolled
            ]
            if enrollment_rows:
                db.table("course_enrollments").insert(enrollment_rows).execute()
                logger.info(f"[assign_training stage] enrolled user {subject_user_id} in {len(enrollment_rows)} courses")

    return update


def _resolve_role_sync(db, role: str, org_id: str, location_id: Optional[str]) -> Optional[str]:
    q = db.table("profiles").select("id").eq("organisation_id", org_id).eq("role", role).eq("is_deleted", False).limit(1)
    if location_id:
        q = q.eq("location_id", location_id)
    res = q.execute()
    return res.data[0]["id"] if res.data else None


def _get_first_admin(db, org_id: str) -> Optional[str]:
    res = db.table("profiles").select("id").eq("organisation_id", org_id).in_("role", ["admin", "super_admin"]).limit(1).execute()
    return res.data[0]["id"] if res.data else None


def _get_first_location(db, org_id: str) -> Optional[str]:
    res = db.table("locations").select("id").eq("organisation_id", org_id).eq("is_deleted", False).limit(1).execute()
    return res.data[0]["id"] if res.data else None


# ─────────────────────────────────────────────────────────────────────────────
# Core Stage Activation
# ─────────────────────────────────────────────────────────────────────────────

def _activate_stage(db, instance_id: str, stage_id: str, stage: dict, instance: dict, response_map: dict):
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
        sub_res = db.table("form_submissions") \
            .select("location_id") \
            .eq("id", instance["submission_id"]) \
            .maybe_single() \
            .execute()
        location_id = sub_res.data.get("location_id") if sub_res.data else None

    # Resolve assignee (by specific user, or by role+location, or by role org-wide)
    assigned_user_id = stage.get("assigned_user_id")
    if not assigned_user_id and stage.get("assigned_role"):
        q = db.table("profiles") \
            .select("id") \
            .eq("organisation_id", org_id) \
            .eq("role", stage["assigned_role"]) \
            .eq("is_deleted", False) \
            .limit(1)
        if location_id:
            q = q.eq("location_id", location_id)
        user_res = q.execute()
        if user_res.data:
            assigned_user_id = user_res.data[0]["id"]
    logger.info(f"_activate_stage: stage='{stage.get('name')}' role={stage.get('assigned_role')} location={location_id} assigned_to={assigned_user_id}")

    # Compute due_at
    sla_hours = stage.get("sla_hours")
    due_at = None
    if sla_hours:
        due_at = (datetime.now(timezone.utc) + timedelta(hours=int(sla_hours))).isoformat()

    # Activate stage instance
    db.table("workflow_stage_instances").update({
        "status": "in_progress",
        "assigned_to": assigned_user_id,
        "started_at": "now()",
        **({"due_at": due_at} if due_at else {}),
    }).eq("workflow_instance_id", instance_id) \
      .eq("stage_id", stage_id) \
      .execute()

    # Execute system stages immediately
    action_type = stage.get("action_type")
    if action_type in SYSTEM_STAGE_TYPES:
        # Get the stage_instance id
        si_res = db.table("workflow_stage_instances") \
            .select("id") \
            .eq("workflow_instance_id", instance_id) \
            .eq("stage_id", stage_id) \
            .maybe_single() \
            .execute()
        if si_res.data:
            stage_instance_id = si_res.data["id"]
            update = _execute_system_stage(db, stage, stage_instance_id, instance)
            if update:
                db.table("workflow_stage_instances").update(update).eq("id", stage_instance_id).execute()

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
    db = get_admin_client()

    wf_res = db.table("workflow_definitions") \
        .select("id, name") \
        .eq("id", definition_id) \
        .eq("organisation_id", org_id) \
        .eq("is_active", True) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()

    if not wf_res.data:
        return None

    wf_def_id = wf_res.data["id"]

    stages_res = db.table("workflow_stages") \
        .select("*") \
        .eq("workflow_definition_id", wf_def_id) \
        .eq("is_deleted", False) \
        .order("stage_order") \
        .execute()
    stages = stages_res.data
    if not stages:
        logger.warning(f"Workflow {wf_def_id} has no stages — skipping instantiation")
        return None

    rules_res = db.table("workflow_routing_rules") \
        .select("*") \
        .eq("workflow_definition_id", wf_def_id) \
        .eq("is_deleted", False) \
        .execute()
    routing_rules = rules_res.data

    first_stage = stages[0]
    inst_res = db.table("workflow_instances").insert({
        "workflow_definition_id": wf_def_id,
        "organisation_id": org_id,
        "status": "in_progress",
        "current_stage_id": first_stage["id"],
        "source_type": source_type,
        "triggered_by": triggered_by,
        **({"source_id": source_id} if source_id else {}),
        **({"location_id": location_id} if location_id else {}),
        **({"submission_id": submission_id} if submission_id else {}),
        **({"subject_user_id": subject_user_id} if subject_user_id else {}),
    }).execute()

    instance = inst_res.data[0]
    instance_id = instance["id"]

    # Create all stage instances as pending
    db.table("workflow_stage_instances").insert([
        {"workflow_instance_id": instance_id, "stage_id": stage["id"], "status": "pending"}
        for stage in stages
    ]).execute()

    # Activate first stage
    _activate_stage(db, instance_id, first_stage["id"], first_stage, instance, submission_responses or {})

    logger.info(
        f"Workflow instance {instance_id} created (trigger={source_type}, source={source_id}), "
        f"first stage: {first_stage['name']}"
    )
    return instance


async def trigger_workflows_for_event(
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
    db = get_admin_client()
    q = db.table("workflow_definitions") \
        .select("id, trigger_form_template_id, trigger_issue_category_id, trigger_conditions") \
        .eq("trigger_type", event_type) \
        .eq("organisation_id", org_id) \
        .eq("is_active", True) \
        .eq("is_deleted", False)
    res = q.execute()

    instances = []
    for wf in (res.data or []):
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
    db = get_admin_client()
    res = db.table("workflow_definitions") \
        .select("id, trigger_conditions") \
        .eq("trigger_type", "employee_created") \
        .eq("organisation_id", org_id) \
        .eq("is_active", True) \
        .eq("is_deleted", False) \
        .execute()

    instances = []
    for wf in (res.data or []):
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

async def tick_wait_stages() -> dict:
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
    db = get_admin_client()
    now = datetime.now(timezone.utc)
    advanced = 0
    timed_out_count = 0

    # Select only the columns required for timeout/condition evaluation — do
    # not use SELECT * to avoid loading large config blobs for non-wait stages.
    res = db.table("workflow_stage_instances") \
        .select(
            "id, workflow_instance_id, due_at, stage_id,"
            "workflow_stages(action_type, config, workflow_definition_id),"
            "workflow_instances(organisation_id, subject_user_id)"
        ) \
        .eq("status", "in_progress") \
        .execute()

    for si in (res.data or []):
        stage_meta = si.get("workflow_stages") or {}
        if stage_meta.get("action_type") != "wait":
            continue

        instance_meta = si.get("workflow_instances") or {}
        org_id = instance_meta.get("organisation_id")
        subject_user_id = instance_meta.get("subject_user_id")
        cfg = stage_meta.get("config") or {}
        condition = cfg.get("condition")

        # ── Timeout check ────────────────────────────────────────────────────
        due_at_str = si.get("due_at")
        if due_at_str:
            due_dt = datetime.fromisoformat(due_at_str.replace("Z", "+00:00"))
            if now >= due_dt:
                db.table("workflow_stage_instances").update({
                    "status": "auto_completed",
                    "completed_at": now.isoformat(),
                    "comment": "Wait timed out",
                }).eq("id", si["id"]).execute()
                await advance_workflow(si["workflow_instance_id"], si["id"], None)
                timed_out_count += 1
                continue

        # ── Condition check ───────────────────────────────────────────────────
        if condition == "all_courses_passed" and subject_user_id and org_id:
            wf_def_id = stage_meta.get("workflow_definition_id")
            # Resolve course_refs from the sibling assign_training stage definition
            at_res = db.table("workflow_stages") \
                .select("config") \
                .eq("workflow_definition_id", wf_def_id) \
                .eq("action_type", "assign_training") \
                .limit(1) \
                .execute()
            if not at_res.data:
                continue
            at_cfg = at_res.data[0].get("config") or {}
            course_refs = at_cfg.get("course_refs") or []
            raw_ids = at_cfg.get("course_ids") or []
            if isinstance(raw_ids, str):
                try:
                    raw_ids = json.loads(raw_ids)
                except Exception:
                    raw_ids = []
            all_course_ids: list = list(raw_ids)
            if course_refs:
                refs_res = db.table("courses").select("id").in_("title", course_refs).eq("organisation_id", org_id).eq("is_deleted", False).execute()
                all_course_ids += [r["id"] for r in (refs_res.data or [])]

            if not all_course_ids:
                continue

            enroll_res = db.table("course_enrollments") \
                .select("status") \
                .eq("user_id", subject_user_id) \
                .in_("course_id", all_course_ids) \
                .execute()
            enrollments = enroll_res.data or []
            # All courses must be enrolled and passed
            if len(enrollments) == len(all_course_ids) and all(e["status"] == "passed" for e in enrollments):
                db.table("workflow_stage_instances").update({
                    "status": "auto_completed",
                    "completed_at": now.isoformat(),
                    "comment": "All required courses passed",
                }).eq("id", si["id"]).execute()
                await advance_workflow(si["workflow_instance_id"], si["id"], None)
                advanced += 1

    logger.info(f"[tick_wait_stages] advanced={advanced} timed_out={timed_out_count}")
    return {"advanced": advanced, "timed_out": timed_out_count}


# ─────────────────────────────────────────────────────────────────────────────
# Legacy: Workflow Instantiation on form submission (kept for backwards compat)
# ─────────────────────────────────────────────────────────────────────────────

async def instantiate_workflow(
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
    db = get_admin_client()

    wf_res = db.table("workflow_definitions") \
        .select("id, name") \
        .eq("form_template_id", form_template_id) \
        .eq("organisation_id", org_id) \
        .eq("is_active", True) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()

    if not wf_res.data:
        return None

    wf_def = wf_res.data

    # Find the submitter user for triggered_by
    sub_res = db.table("form_submissions").select("submitted_by").eq("id", submission_id).maybe_single().execute()
    triggered_by = sub_res.data.get("submitted_by") if sub_res.data else None

    return await trigger_workflow(
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
    instance_id: str,
    stage_instance_id: str,
    acting_user_id: Optional[str] = None,
) -> dict:
    """
    Find the next stage after stage_instance_id completes and activate it,
    or mark the workflow complete if there is no next stage.
    Call this after marking a stage instance as approved/completed.
    """
    db = get_admin_client()

    si_res = db.table("workflow_stage_instances") \
        .select("*, workflow_instances(*)") \
        .eq("id", stage_instance_id) \
        .maybe_single() \
        .execute()
    if not si_res.data:
        raise HTTPException(status_code=404, detail="Stage instance not found")
    stage_inst = si_res.data
    instance = stage_inst["workflow_instances"]
    wf_def_id = instance["workflow_definition_id"]
    stage_id = stage_inst["stage_id"]

    rules_res = db.table("workflow_routing_rules") \
        .select("*") \
        .eq("workflow_definition_id", wf_def_id) \
        .eq("is_deleted", False) \
        .execute()

    response_map: dict = {}
    overall_score = 0.0
    if instance.get("submission_id"):
        sub_res = db.table("form_responses") \
            .select("field_id, value") \
            .eq("submission_id", instance["submission_id"]) \
            .execute()
        response_map = {str(r["field_id"]): r["value"] for r in (sub_res.data or [])}
        score_res = db.table("form_submissions") \
            .select("overall_score") \
            .eq("id", instance["submission_id"]) \
            .maybe_single() \
            .execute()
        overall_score = float(score_res.data.get("overall_score", 0)) if score_res.data else 0.0

    source_record = None
    if instance.get("source_type") and instance.get("source_id"):
        source_table = {"issue": "issues", "incident": "incidents"}.get(instance["source_type"])
        if source_table:
            src_res = db.table(source_table).select("priority").eq("id", instance["source_id"]).maybe_single().execute()
            source_record = src_res.data

    acting_user_role = None
    if acting_user_id:
        profile_res = db.table("profiles").select("role").eq("id", acting_user_id).maybe_single().execute()
        acting_user_role = profile_res.data.get("role") if profile_res.data else None

    next_stage_id = find_next_stage_id(
        rules_res.data, str(stage_id), response_map, overall_score,
        stage_instance=stage_inst, source_record=source_record, acting_user_role=acting_user_role,
    )

    # If no routing rule matched, fall back to the next stage by stage_order
    if not next_stage_id:
        cur_stage_rows = db.table("workflow_stages").select("stage_order").eq("id", str(stage_id)).execute()
        if cur_stage_rows.data:
            cur_order = cur_stage_rows.data[0]["stage_order"]
            next_seq_rows = db.table("workflow_stages") \
                .select("id") \
                .eq("workflow_definition_id", wf_def_id) \
                .eq("stage_order", cur_order + 1) \
                .execute()
            if next_seq_rows.data:
                next_stage_id = str(next_seq_rows.data[0]["id"])

    if not next_stage_id:
        logger.info(f"advance_workflow {instance_id}: no next stage — completing workflow")
        db.table("workflow_instances").update({
            "status": "completed",
            "completed_at": "now()",
        }).eq("id", instance_id).execute()
        return {"status": "completed"}

    next_stage_res = db.table("workflow_stages").select("*").eq("id", next_stage_id).maybe_single().execute()
    if not next_stage_res.data:
        raise HTTPException(status_code=404, detail="Next workflow stage not found")
    next_stage = next_stage_res.data
    logger.info(f"advance_workflow {instance_id}: activating next stage '{next_stage.get('name')}' (order={next_stage.get('stage_order')}, action={next_stage.get('action_type')}, is_final={next_stage.get('is_final')})")

    _activate_stage(db, instance_id, next_stage_id, next_stage, instance, response_map)

    # Check the activated stage instance
    si_check = db.table("workflow_stage_instances").select("id, status, assigned_to").eq("workflow_instance_id", instance_id).eq("stage_id", next_stage_id).maybe_single().execute()
    logger.info(f"advance_workflow {instance_id}: stage instance after activation = {si_check.data}")

    db.table("workflow_instances").update({
        "status": "completed" if next_stage.get("is_final") else "in_progress",
        **({"completed_at": "now()"} if next_stage.get("is_final") else {}),
        "current_stage_id": next_stage_id,
    }).eq("id", instance_id).execute()

    if next_stage.get("is_final"):
        return {"status": "completed", "final_stage_id": next_stage_id}
    return {"status": "in_progress", "next_stage_id": next_stage_id}


# ─────────────────────────────────────────────────────────────────────────────
# Stage Completion (approve / reject)
# ─────────────────────────────────────────────────────────────────────────────

async def approve_stage(
    instance_id: str,
    stage_instance_id: str,
    acting_user_id: str,
    comment: Optional[str],
    org_id: str = "",
) -> dict:
    """
    Approve the current stage and advance the workflow.
    """
    db = get_admin_client()

    inst = db.table("workflow_instances").select("id").eq("id", instance_id).eq("organisation_id", org_id).maybe_single().execute()
    if not inst.data:
        raise HTTPException(status_code=403, detail="Not found")

    si_res = db.table("workflow_stage_instances") \
        .select("workflow_instance_id, status") \
        .eq("id", stage_instance_id) \
        .maybe_single() \
        .execute()
    if not si_res.data:
        raise HTTPException(status_code=404, detail="Stage instance not found")
    stage_inst = si_res.data

    if str(stage_inst["workflow_instance_id"]) != str(instance_id):
        raise ValueError("Stage instance does not belong to this workflow instance")

    if stage_inst["status"] not in ("pending", "in_progress"):
        raise ValueError(f"Stage instance is already {stage_inst['status']}")

    db.table("workflow_stage_instances").update({
        "status": "approved",
        "completed_at": "now()",
        "comment": comment,
    }).eq("id", stage_instance_id).execute()

    return await advance_workflow(instance_id, stage_instance_id, acting_user_id)


async def reject_stage(
    instance_id: str,
    stage_instance_id: str,
    acting_user_id: str,
    comment: Optional[str],
    org_id: str = "",
) -> dict:
    """
    Reject the current stage and cancel the workflow.
    """
    db = get_admin_client()

    inst = db.table("workflow_instances").select("id").eq("id", instance_id).eq("organisation_id", org_id).maybe_single().execute()
    if not inst.data:
        raise HTTPException(status_code=403, detail="Not found")

    si_res = db.table("workflow_stage_instances") \
        .select("workflow_instance_id, stage_id, status") \
        .eq("id", stage_instance_id) \
        .maybe_single() \
        .execute()
    if not si_res.data:
        raise HTTPException(status_code=404, detail="Stage instance not found")
    stage_inst = si_res.data

    if str(stage_inst["workflow_instance_id"]) != str(instance_id):
        raise ValueError("Stage instance does not belong to this workflow instance")

    if stage_inst["status"] not in ("pending", "in_progress"):
        raise ValueError(f"Stage instance is already {stage_inst['status']}")

    db.table("workflow_stage_instances").update({
        "status": "rejected",
        "completed_at": "now()",
        "comment": comment,
    }).eq("id", stage_instance_id).execute()

    db.table("workflow_instances").update({
        "status": "cancelled",
        "cancelled_reason": comment,
    }).eq("id", instance_id).execute()

    logger.info(f"Workflow instance {instance_id} CANCELLED — stage {stage_instance_id} rejected")
    return {"status": "cancelled"}


# ─────────────────────────────────────────────────────────────────────────────
# Queries
# ─────────────────────────────────────────────────────────────────────────────

async def get_my_tasks(user_id: str, org_id: str, user_role: Optional[str] = None) -> list[dict]:
    db = get_admin_client()
    base_select = """
        id, status, started_at, due_at, comment,
        stage_id,
        workflow_instances!inner(
            id, status, source_type, source_id, organisation_id,
            workflow_definitions(name)
        ),
        workflow_stages(name, action_type, stage_order, assigned_role, form_template_id, form_templates(title))
    """

    # Query 1: directly assigned to this user by ID
    r1 = db.table("workflow_stage_instances") \
        .select(base_select) \
        .eq("assigned_to", user_id) \
        .eq("status", "in_progress") \
        .eq("workflow_instances.organisation_id", org_id) \
        .execute()

    # Query 2: assigned by role but no specific user set yet
    role_tasks: list[dict] = []
    if user_role:
        r2 = db.table("workflow_stage_instances") \
            .select(base_select) \
            .is_("assigned_to", "null") \
            .eq("status", "in_progress") \
            .eq("workflow_instances.organisation_id", org_id) \
            .execute()
        for t in (r2.data or []):
            stage_info = t.get("workflow_stages") or {}
            stage_role = stage_info.get("assigned_role")
            # Match if role matches, OR if no role set and user is super_admin (catch-all)
            if stage_role == user_role or (stage_role is None and user_role == "super_admin"):
                role_tasks.append(t)

    # Merge, dedup by id
    seen: set[str] = set()
    merged: list[dict] = []
    for t in (r1.data or []) + role_tasks:
        if t["id"] not in seen:
            seen.add(t["id"])
            merged.append(t)
    return merged


async def get_instance_detail(instance_id: str, org_id: str) -> Optional[dict]:
    db = get_admin_client()
    res = db.table("workflow_instances") \
        .select("""
            *,
            workflow_definitions(id, name, trigger_type),
            workflow_stages!current_stage_id(name, action_type),
            workflow_stage_instances(
                id, status, started_at, completed_at, due_at, comment, assigned_to,
                spawned_task_id, spawned_issue_id, spawned_incident_id,
                workflow_stages(name, action_type, stage_order, is_final, config)
            )
        """) \
        .eq("id", instance_id) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    return res.data
