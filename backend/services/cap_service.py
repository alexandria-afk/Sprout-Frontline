"""
Corrective Action Plan (CAP) Service
Generates, manages, and confirms CAPs for failed audit submissions.
"""
from __future__ import annotations

import json
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import anthropic
from fastapi import HTTPException

from config import settings
from models.caps import UpdateCAPItemRequest
from models.tasks import CreateTaskRequest
from services.db import row, rows, execute, execute_returning
from services.task_service import TaskService
from services.ai_logger import log_ai_request, AITimer

logger = logging.getLogger(__name__)

# Keywords for suggesting follow-up type (kept for fallback)
SAFETY_KEYWORDS = {
    "injury", "hazard", "accident", "fire", "chemical",
    "spill", "emergency", "safety", "exposure", "electrical",
}
EQUIPMENT_KEYWORDS = {
    "equipment", "machine", "oven", "fryer", "cooler",
    "refrigerator", "wiring", "leak", "broken", "repair",
    "malfunction", "maintenance",
}

DUE_DAYS = {"critical": 1, "high": 3, "medium": 7, "low": 14}

_CAP_AI_SYSTEM = """You are an operations specialist for QSR and retail compliance.
Given audit findings that failed, classify the best corrective action for each.

Return JSON array, one object per finding, in the SAME ORDER as input:
[
  {
    "followup_type": "task|issue|incident",
    "priority": "low|medium|high|critical",
    "title": "Short action title (max 80 chars)",
    "description": "What needs to be done and why",
    "reasoning": "One sentence explanation"
  }
]

Rules:
- incident: safety hazard, injury risk, regulatory violation, pest, fire/chemical
- issue: physical fault, equipment problem, structural defect
- task: process fix, training gap, administrative action
- critical: immediate safety risk or regulatory; high: significant non-compliance; medium: operational gap; low: minor improvement
- Keep titles action-oriented ("Fix X", "Retrain on Y", "Replace Z")"""


async def _ai_suggest_cap_items(failed_fields: list, org_context: str = "") -> list[dict] | None:
    """Use Claude to classify all failed CAP fields at once.
    Returns list of {followup_type, priority, title, description} or None on failure."""
    try:
        api_key = settings.anthropic_api_key
        if not api_key:
            return None

        client = anthropic.Anthropic(api_key=api_key)

        user_payload = json.dumps([
            {
                "label": f.label,
                "response_value": getattr(f, "response_value", None) or "non_compliant",
                "is_critical": f.is_critical,
                "score_awarded": f.achieved_score,
                "max_score": f.max_score,
            }
            for f in failed_fields
        ])

        user_message = user_payload
        if org_context:
            user_message = f"Organisation context: {org_context}\n\nFindings:\n{user_payload}"

        max_retries = 3
        last_error: Exception | None = None
        response = None

        with AITimer() as timer:
            for attempt in range(max_retries):
                try:
                    response = client.messages.create(
                        model="claude-haiku-4-5",
                        max_tokens=2048,
                        system=_CAP_AI_SYSTEM,
                        messages=[{"role": "user", "content": user_message}],
                    )
                    last_error = None
                    break
                except anthropic.APIStatusError as e:
                    if e.status_code == 529:
                        last_error = e
                        if attempt < max_retries - 1:
                            await asyncio.sleep(2 ** attempt)
                        continue
                    last_error = e
                    break
                except Exception as e:
                    last_error = e
                    break

        input_tokens = getattr(getattr(response, "usage", None), "input_tokens", None) if response else None
        output_tokens = getattr(getattr(response, "usage", None), "output_tokens", None) if response else None
        success = last_error is None and response is not None

        log_ai_request(
            feature="cap_suggest_items",
            model="claude-haiku-4-5",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=timer.elapsed_ms,
            success=success,
            error_message=str(last_error) if last_error else None,
        )

        if not success or response is None:
            return None

        text = ""
        for block in response.content:
            if block.type == "text":
                text = block.text
                break

        if not text:
            return None

        text = text.strip()
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.startswith("json"):
                text = text[4:]
            if "```" in text:
                text = text.rsplit("```", 1)[0]
            text = text.strip()

        result = json.loads(text)
        if not isinstance(result, list) or len(result) != len(failed_fields):
            return None

        return result

    except Exception as e:
        logger.debug(f"_ai_suggest_cap_items failed (will use keyword fallback): {e}")
        return None


def _suggest_followup_type(label: str, is_critical: bool) -> str:
    lower = label.lower()
    if any(kw in lower for kw in SAFETY_KEYWORDS):
        return "incident"
    if is_critical or any(kw in lower for kw in EQUIPMENT_KEYWORDS):
        return "issue"
    return "task"


def _suggest_priority(is_critical: bool, response_value: str) -> str:
    if is_critical:
        return "critical"
    if response_value == "non_compliant":
        return "high"
    if response_value == "needs_improvement":
        return "medium"
    return "low"


def _format_response(value: str) -> str:
    return value.replace("_", " ").title()


class CAPService:

    @staticmethod
    async def generate_cap(
        conn,
        submission_id: str,
        form_template_id: str,
        failed_fields: list,  # list[FieldScoreResult]
        org_id: str,
        location_id: str,
        responses: list[dict] | None = None,
    ) -> dict | None:
        """Auto-generate a CAP with items for every failed field."""
        if not failed_fields:
            return None

        # Find a suggested assignee at the location
        staff_assignee = None
        manager_assignee = None
        try:
            staff_row = row(
                conn,
                """
                SELECT id FROM profiles
                WHERE location_id = %s AND is_deleted = FALSE AND role = ANY(%s)
                LIMIT 1
                """,
                (location_id, ["staff"]),
            )
            staff_assignee = staff_row["id"] if staff_row else None

            mgr_row = row(
                conn,
                """
                SELECT id FROM profiles
                WHERE location_id = %s AND is_deleted = FALSE AND role = ANY(%s)
                LIMIT 1
                """,
                (location_id, ["manager", "admin", "super_admin"]),
            )
            manager_assignee = mgr_row["id"] if mgr_row else None
        except Exception:
            pass  # non-fatal — suggestions will have no assignee

        # Build response map for extracting response_value
        resp_map: dict[str, str] = {}
        if responses:
            for r in responses:
                fid = r.get("field_id")
                val = r.get("value", "")
                if fid:
                    resp_map[fid] = val

        # Create the CAP record
        cap = execute_returning(
            conn,
            """
            INSERT INTO corrective_action_plans
                (submission_id, organisation_id, location_id, status)
            VALUES (%s, %s, %s, 'pending_review')
            RETURNING *
            """,
            (submission_id, org_id, location_id),
        )
        if not cap:
            raise HTTPException(status_code=500, detail="Failed to create CAP")
        cap = dict(cap)
        cap_id = cap["id"]

        now = datetime.now(timezone.utc)

        # Try AI suggestions first; fall back to keyword logic if AI fails
        ai_suggestions = await _ai_suggest_cap_items(failed_fields)

        # Create CAP items
        items_data = []
        for idx, f in enumerate(failed_fields):
            response_value = resp_map.get(f.field_id, f.response_value or "non_compliant")

            ai = ai_suggestions[idx] if ai_suggestions else None
            if ai:
                ftype = ai.get("followup_type") or _suggest_followup_type(f.label, f.is_critical)
                priority = ai.get("priority") or _suggest_priority(f.is_critical, response_value)
                title = ai.get("title") or f"{f.label} — {_format_response(response_value)}"
                description = ai.get("description") or f"Scored {f.achieved_score}/{f.max_score}"
            else:
                ftype = _suggest_followup_type(f.label, f.is_critical)
                priority = _suggest_priority(f.is_critical, response_value)
                title = f"{f.label} — {_format_response(response_value)}"
                description = f"Scored {f.achieved_score}/{f.max_score}"

            due_days = DUE_DAYS.get(priority, 7)
            assignee = staff_assignee if ftype == "task" else manager_assignee

            items_data.append((
                cap_id,
                f.field_id,
                f.label,
                response_value,
                f.achieved_score,
                f.max_score,
                f.is_critical,
                ftype,
                title,
                description,
                priority,
                assignee,
                due_days,
                ftype,
                title,
                description,
                priority,
                assignee,
                (now + timedelta(days=due_days)).isoformat(),
            ))

        inserted_items = []
        if items_data:
            for params in items_data:
                item_row = execute_returning(
                    conn,
                    """
                    INSERT INTO cap_items (
                        cap_id, field_id, field_label, response_value,
                        score_awarded, max_score, is_critical,
                        suggested_followup_type, suggested_title,
                        suggested_description, suggested_priority,
                        suggested_assignee_id, suggested_due_days,
                        followup_type, followup_title, followup_description,
                        followup_priority, followup_assignee_id, followup_due_at
                    ) VALUES (
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s,
                        %s, %s,
                        %s, %s,
                        %s, %s, %s,
                        %s, %s, %s
                    )
                    RETURNING *
                    """,
                    params,
                )
                if item_row:
                    inserted_items.append(dict(item_row))

        cap["items"] = inserted_items

        # Notify managers at the location that a CAP needs review
        try:
            tmpl_row = row(
                conn,
                "SELECT title FROM form_templates WHERE id = %s",
                (form_template_id,),
            )
            tmpl_title = (tmpl_row or {}).get("title", "Audit")

            sub_row = row(
                conn,
                "SELECT score_percentage FROM form_submissions WHERE id = %s",
                (submission_id,),
            )
            score = (sub_row or {}).get("score_percentage")

            loc_row = row(
                conn,
                "SELECT name FROM locations WHERE id = %s",
                (location_id,),
            )
            loc_name = (loc_row or {}).get("name", "")

            score_str = f"Score: {round(score)}%" if score is not None else ""
            notif_body_parts = [p for p in [score_str, f"at {loc_name}" if loc_name else ""] if p]
            notif_body = " ".join(notif_body_parts) or None
            import asyncio as _asyncio
            from services import notification_service as _ns
            _asyncio.create_task(_ns.notify_role(
                org_id=org_id,
                role="manager",
                location_id=location_id,
                type="cap_generated",
                title=f"Failed audit: {tmpl_title} \u2014 CAP needs review",
                body=notif_body,
                entity_type="cap",
                entity_id=cap_id,
            ))
        except Exception:
            pass

        return cap

    # ── List / Get ────────────────────────────────────────────────────────────

    @staticmethod
    async def list_caps(
        conn,
        org_id: str,
        status: Optional[str] = None,
        location_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        filters = ["cap.organisation_id = %s", "cap.is_deleted = FALSE"]
        params: list = [org_id]

        if status:
            filters.append("cap.status = %s")
            params.append(status)
        if location_id:
            filters.append("cap.location_id = %s")
            params.append(location_id)
        if from_date:
            filters.append("cap.generated_at >= %s")
            params.append(from_date)
        if to_date:
            filters.append("cap.generated_at <= %s")
            params.append(to_date)

        where = " AND ".join(filters)

        # Total count
        count_row = row(
            conn,
            f"SELECT COUNT(*) AS cnt FROM corrective_action_plans cap WHERE {where}",
            tuple(params),
        )
        total_count = count_row["cnt"] if count_row else 0

        offset = (page - 1) * page_size
        list_params = tuple(params) + (page_size, offset)

        cap_rows = rows(
            conn,
            f"""
            SELECT
                cap.*,
                loc.name        AS location_name,
                sub.submitted_at,
                sub.overall_score,
                sub.passed,
                ft.title        AS form_template_title
            FROM corrective_action_plans cap
            LEFT JOIN locations loc          ON loc.id = cap.location_id
            LEFT JOIN form_submissions sub   ON sub.id = cap.submission_id
            LEFT JOIN form_templates ft      ON ft.id  = sub.form_template_id
            WHERE {where}
            ORDER BY cap.generated_at DESC
            LIMIT %s OFFSET %s
            """,
            list_params,
        )

        items = [dict(r) for r in cap_rows]

        # Nest related fields to match original shape
        for c in items:
            c["locations"] = {"name": c.pop("location_name", None)}
            c["form_submissions"] = {
                "submitted_at": c.pop("submitted_at", None),
                "overall_score": c.pop("overall_score", None),
                "passed": c.pop("passed", None),
                "form_templates": {"title": c.pop("form_template_title", None)},
            }

        # Fetch item counts per CAP
        if items:
            cap_ids = [c["id"] for c in items]
            count_rows_data = rows(
                conn,
                """
                SELECT cap_id, COUNT(*) AS cnt
                FROM cap_items
                WHERE cap_id = ANY(%s::uuid[]) AND is_deleted = FALSE
                GROUP BY cap_id
                """,
                (cap_ids,),
            )
            count_map = {r["cap_id"]: r["cnt"] for r in count_rows_data}
            for c in items:
                c["item_count"] = count_map.get(c["id"], 0)

        return {
            "items": items,
            "total_count": total_count,
            "page": page,
            "page_size": page_size,
        }

    @staticmethod
    async def get_cap(conn, cap_id: str, org_id: str) -> dict:
        cap_row = row(
            conn,
            """
            SELECT
                cap.*,
                loc.name                AS location_name,
                sub.id                  AS sub_id,
                sub.submitted_at,
                sub.submitted_by,
                sub.overall_score,
                sub.passed,
                ft.id                   AS ft_id,
                ft.title                AS ft_title
            FROM corrective_action_plans cap
            LEFT JOIN locations loc         ON loc.id  = cap.location_id
            LEFT JOIN form_submissions sub  ON sub.id  = cap.submission_id
            LEFT JOIN form_templates ft     ON ft.id   = sub.form_template_id
            WHERE cap.id = %s
              AND cap.organisation_id = %s
              AND cap.is_deleted = FALSE
            """,
            (cap_id, org_id),
        )
        if not cap_row:
            raise HTTPException(status_code=404, detail="CAP not found")
        cap = dict(cap_row)

        # Fetch form sections and fields for the template
        sections = rows(
            conn,
            """
            SELECT id, title, display_order
            FROM form_sections
            WHERE form_template_id = %s
            ORDER BY display_order
            """,
            (cap["ft_id"],),
        ) if cap.get("ft_id") else []

        section_list = []
        for sec in sections:
            sec = dict(sec)
            fields = rows(
                conn,
                """
                SELECT id, label, display_order, section_id
                FROM form_fields
                WHERE section_id = %s
                ORDER BY display_order
                """,
                (sec["id"],),
            )
            sec["form_fields"] = [dict(f) for f in fields]
            section_list.append(sec)

        # Fetch CAP items with assignee names
        item_rows = rows(
            conn,
            """
            SELECT
                ci.*,
                sa.full_name AS suggested_assignee_full_name,
                fa.full_name AS followup_assignee_full_name
            FROM cap_items ci
            LEFT JOIN profiles sa ON sa.id = ci.suggested_assignee_id
            LEFT JOIN profiles fa ON fa.id = ci.followup_assignee_id
            WHERE ci.cap_id = %s AND ci.is_deleted = FALSE
            """,
            (cap_id,),
        )
        cap_items = []
        for ir in item_rows:
            ir = dict(ir)
            ir["suggested_assignee"] = {"full_name": ir.pop("suggested_assignee_full_name", None)}
            ir["followup_assignee"] = {"full_name": ir.pop("followup_assignee_full_name", None)}
            cap_items.append(ir)

        # Nest related data to match original shape
        cap["locations"] = {"name": cap.pop("location_name", None)}
        cap["form_submissions"] = {
            "id": cap.pop("sub_id", None),
            "submitted_at": cap.pop("submitted_at", None),
            "submitted_by": cap.pop("submitted_by", None),
            "overall_score": cap.pop("overall_score", None),
            "passed": cap.pop("passed", None),
            "form_templates": {
                "id": cap.pop("ft_id", None),
                "title": cap.pop("ft_title", None),
                "form_sections": section_list,
            },
        }
        cap["cap_items"] = cap_items

        return cap

    @staticmethod
    async def get_cap_by_submission(conn, submission_id: str, org_id: str) -> dict | None:
        result = row(
            conn,
            """
            SELECT id, status
            FROM corrective_action_plans
            WHERE submission_id = %s
              AND organisation_id = %s
              AND is_deleted = FALSE
            """,
            (submission_id, org_id),
        )
        return dict(result) if result else None

    # ── Update / Confirm / Dismiss ────────────────────────────────────────────

    @staticmethod
    async def update_cap_item(
        conn,
        cap_id: str,
        item_id: str,
        org_id: str,
        reviewed_by: str,
        body: UpdateCAPItemRequest,
    ) -> dict:
        # Verify CAP exists and is editable
        cap_row = row(
            conn,
            """
            SELECT id, status
            FROM corrective_action_plans
            WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
            """,
            (cap_id, org_id),
        )
        if not cap_row:
            raise HTTPException(status_code=404, detail="CAP not found")
        cap_row = dict(cap_row)
        if cap_row["status"] not in ("pending_review", "in_review"):
            raise HTTPException(status_code=400, detail="CAP is not editable")

        # Build SET clause dynamically
        set_parts: list[str] = []
        update_params: list = []

        for field in ("followup_type", "followup_title", "followup_description", "followup_priority"):
            val = getattr(body, field, None)
            if val is not None:
                set_parts.append(f"{field} = %s")
                update_params.append(val)

        if body.followup_assignee_id is not None:
            set_parts.append("followup_assignee_id = %s")
            update_params.append(str(body.followup_assignee_id))

        if body.followup_due_at is not None:
            set_parts.append("followup_due_at = %s")
            update_params.append(body.followup_due_at.isoformat())

        if not set_parts:
            raise HTTPException(status_code=400, detail="No fields to update")

        set_parts.append("updated_at = %s")
        update_params.append(datetime.now(timezone.utc).isoformat())

        update_params.extend([item_id, cap_id])

        updated_item = execute_returning(
            conn,
            f"""
            UPDATE cap_items
            SET {', '.join(set_parts)}
            WHERE id = %s AND cap_id = %s AND is_deleted = FALSE
            RETURNING *
            """,
            tuple(update_params),
        )
        if not updated_item:
            raise HTTPException(status_code=404, detail="CAP item not found")

        # Auto-transition CAP to in_review
        if cap_row["status"] == "pending_review":
            execute(
                conn,
                """
                UPDATE corrective_action_plans
                SET status = 'in_review',
                    reviewed_by = %s,
                    updated_at = %s
                WHERE id = %s
                """,
                (reviewed_by, datetime.now(timezone.utc).isoformat(), cap_id),
            )

        return dict(updated_item)

    @staticmethod
    async def confirm_cap(conn, cap_id: str, org_id: str, reviewed_by: str) -> dict:
        # Fetch CAP with items
        cap_row = row(
            conn,
            """
            SELECT *
            FROM corrective_action_plans
            WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
            """,
            (cap_id, org_id),
        )
        if not cap_row:
            raise HTTPException(status_code=404, detail="CAP not found")
        cap = dict(cap_row)
        if cap["status"] not in ("pending_review", "in_review"):
            raise HTTPException(status_code=400, detail=f"CAP cannot be confirmed from status '{cap['status']}'")

        item_rows = rows(
            conn,
            "SELECT * FROM cap_items WHERE cap_id = %s AND is_deleted = FALSE",
            (cap_id,),
        )
        items = [dict(i) for i in item_rows]

        task_items     = [i for i in items if i.get("followup_type") == "task"]
        issue_items    = [i for i in items if i.get("followup_type") == "issue"]
        incident_items = [i for i in items if i.get("followup_type") == "incident"]

        spawned_tasks: list[dict] = []
        try:
            for item in task_items:
                task_body = CreateTaskRequest(
                    title=item["followup_title"] or item["suggested_title"],
                    description=item.get("followup_description") or item.get("suggested_description") or "",
                    priority=item.get("followup_priority") or item.get("suggested_priority") or "medium",
                    due_at=datetime.fromisoformat(item["followup_due_at"]) if item.get("followup_due_at") else None,
                    location_id=cap["location_id"],
                    source_type="audit",
                    source_submission_id=cap["submission_id"],
                    source_field_id=item["field_id"],
                    assignee_user_ids=[item["followup_assignee_id"]] if item.get("followup_assignee_id") else [],
                )
                task = await TaskService.create_task(task_body, org_id, reviewed_by)
                spawned_tasks.append({"task": task, "item_id": item["id"]})

                execute(
                    conn,
                    """
                    UPDATE cap_items
                    SET spawned_task_id = %s, updated_at = %s
                    WHERE id = %s
                    """,
                    (task["id"], datetime.now(timezone.utc).isoformat(), item["id"]),
                )
                execute(
                    conn,
                    "UPDATE tasks SET cap_item_id = %s WHERE id = %s",
                    (item["id"], task["id"]),
                )

        except Exception as e:
            for st in spawned_tasks:
                try:
                    execute(
                        conn,
                        "UPDATE tasks SET is_deleted = TRUE WHERE id = %s",
                        (st["task"]["id"],),
                    )
                except Exception:
                    pass
            logger.error(f"CAP confirmation failed, rolled back tasks: {e}")
            raise HTTPException(status_code=500, detail="Failed to create follow-up tasks — confirmation rolled back")

        # Spawn issues
        spawned_issues: list[str] = []
        for item in issue_items:
            try:
                cat_row = row(
                    conn,
                    """
                    SELECT id FROM issue_categories
                    WHERE organisation_id = %s AND is_deleted = FALSE
                    LIMIT 1
                    """,
                    (org_id,),
                )
                category_id = cat_row["id"] if cat_row else None

                issue_row = execute_returning(
                    conn,
                    """
                    INSERT INTO issues (
                        organisation_id, location_id, reported_by,
                        title, description, priority, status, category_id
                    ) VALUES (%s, %s, %s, %s, %s, %s, 'open', %s)
                    RETURNING id
                    """,
                    (
                        org_id,
                        cap.get("location_id"),
                        reviewed_by,
                        item.get("followup_title") or item.get("suggested_title") or "CAP Issue",
                        item.get("followup_description") or item.get("suggested_description") or "",
                        item.get("followup_priority") or item.get("suggested_priority") or "medium",
                        category_id,
                    ),
                )
                if issue_row:
                    issue_id = issue_row["id"]
                    spawned_issues.append(issue_id)
                    execute(
                        conn,
                        """
                        UPDATE cap_items
                        SET spawned_issue_id = %s, updated_at = %s
                        WHERE id = %s
                        """,
                        (issue_id, datetime.now(timezone.utc).isoformat(), item["id"]),
                    )
            except Exception as e:
                logger.error(f"Failed to spawn issue for CAP item {item['id']}: {e}")

        # Spawn incidents
        spawned_incidents: list[str] = []
        for item in incident_items:
            try:
                incident_row = execute_returning(
                    conn,
                    """
                    INSERT INTO incidents (
                        org_id, reported_by, title, description,
                        severity, status, incident_date, location_id
                    ) VALUES (%s, %s, %s, %s, %s, 'reported', %s, %s)
                    RETURNING id
                    """,
                    (
                        org_id,
                        reviewed_by,
                        item.get("followup_title") or item.get("suggested_title") or "CAP Incident",
                        item.get("followup_description") or item.get("suggested_description") or "",
                        item.get("followup_priority") or item.get("suggested_priority") or "medium",
                        datetime.now(timezone.utc).isoformat(),
                        cap.get("location_id"),
                    ),
                )
                if incident_row:
                    incident_id = incident_row["id"]
                    spawned_incidents.append(incident_id)
                    execute(
                        conn,
                        """
                        UPDATE cap_items
                        SET spawned_incident_id = %s, updated_at = %s
                        WHERE id = %s
                        """,
                        (incident_id, datetime.now(timezone.utc).isoformat(), item["id"]),
                    )
            except Exception as e:
                logger.error(f"Failed to spawn incident for CAP item {item['id']}: {e}")

        # Update CAP status
        now = datetime.now(timezone.utc).isoformat()
        execute(
            conn,
            """
            UPDATE corrective_action_plans
            SET status = 'confirmed',
                reviewed_by = %s,
                reviewed_at = %s,
                updated_at = %s
            WHERE id = %s
            """,
            (reviewed_by, now, now, cap_id),
        )

        return {
            "cap_id": cap_id,
            "status": "confirmed",
            "tasks_created": len(spawned_tasks),
            "issues_created": len(spawned_issues),
            "incidents_created": len(spawned_incidents),
            "items_skipped": len([i for i in items if i.get("followup_type") == "none"]),
        }

    @staticmethod
    async def dismiss_cap(conn, cap_id: str, org_id: str, reviewed_by: str, reason: str) -> dict:
        cap_row = row(
            conn,
            """
            SELECT id, status
            FROM corrective_action_plans
            WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
            """,
            (cap_id, org_id),
        )
        if not cap_row:
            raise HTTPException(status_code=404, detail="CAP not found")
        if cap_row["status"] in ("confirmed", "dismissed"):
            raise HTTPException(status_code=400, detail="CAP is already finalized")

        now = datetime.now(timezone.utc).isoformat()
        execute(
            conn,
            """
            UPDATE corrective_action_plans
            SET status = 'dismissed',
                dismissed_reason = %s,
                reviewed_by = %s,
                reviewed_at = %s,
                updated_at = %s
            WHERE id = %s
            """,
            (reason, reviewed_by, now, now, cap_id),
        )

        return {"cap_id": cap_id, "status": "dismissed"}
