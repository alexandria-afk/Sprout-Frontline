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
from services.supabase_client import get_admin_client
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

        db = get_admin_client()

        # Find a suggested assignee at the location
        staff_assignee = None
        manager_assignee = None
        try:
            staff_resp = (
                db.table("profiles")
                .select("id")
                .eq("location_id", location_id)
                .eq("is_deleted", False)
                .in_("role", ["staff"])
                .limit(1)
                .execute()
            )
            staff_assignee = staff_resp.data[0]["id"] if staff_resp.data else None

            mgr_resp = (
                db.table("profiles")
                .select("id")
                .eq("location_id", location_id)
                .eq("is_deleted", False)
                .in_("role", ["manager", "admin", "super_admin"])
                .limit(1)
                .execute()
            )
            manager_assignee = mgr_resp.data[0]["id"] if mgr_resp.data else None
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
        cap_resp = db.table("corrective_action_plans").insert({
            "submission_id": submission_id,
            "organisation_id": org_id,
            "location_id": location_id,
            "status": "pending_review",
        }).execute()
        if not cap_resp.data:
            raise HTTPException(status_code=500, detail="Failed to create CAP")
        cap = cap_resp.data[0]
        cap_id = cap["id"]

        now = datetime.now(timezone.utc)

        # Try AI suggestions first; fall back to keyword logic if AI fails
        ai_suggestions = await _ai_suggest_cap_items(failed_fields)

        # Create CAP items
        items = []
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

            items.append({
                "cap_id": cap_id,
                "field_id": f.field_id,
                "field_label": f.label,
                "response_value": response_value,
                "score_awarded": f.achieved_score,
                "max_score": f.max_score,
                "is_critical": f.is_critical,
                "suggested_followup_type": ftype,
                "suggested_title": title,
                "suggested_description": description,
                "suggested_priority": priority,
                "suggested_assignee_id": assignee,
                "suggested_due_days": due_days,
                # Pre-fill manager-editable fields with suggested values
                "followup_type": ftype,
                "followup_title": title,
                "followup_description": description,
                "followup_priority": priority,
                "followup_assignee_id": assignee,
                "followup_due_at": (now + timedelta(days=due_days)).isoformat(),
            })

        if items:
            items_resp = db.table("cap_items").insert(items).execute()
            cap["items"] = items_resp.data or []
        else:
            cap["items"] = []

        # Notify managers at the location that a CAP needs review
        try:
            tmpl_resp = db.table("form_templates").select("title").eq("id", form_template_id).maybe_single().execute()
            tmpl_title = (tmpl_resp.data or {}).get("title", "Audit")
            # Get the submission score if available
            sub_resp = db.table("form_submissions").select("score_percentage").eq("id", submission_id).maybe_single().execute()
            score = (sub_resp.data or {}).get("score_percentage")
            loc_resp = db.table("locations").select("name").eq("id", location_id).maybe_single().execute()
            loc_name = (loc_resp.data or {}).get("name", "")
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
        org_id: str,
        status: Optional[str] = None,
        location_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        db = get_admin_client()
        query = (
            db.table("corrective_action_plans")
            .select(
                "*, locations(name), "
                "form_submissions(submitted_at, overall_score, passed, form_templates(title))",
                count="exact",
            )
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
        )
        if status:
            query = query.eq("status", status)
        if location_id:
            query = query.eq("location_id", location_id)
        if from_date:
            query = query.gte("generated_at", from_date)
        if to_date:
            query = query.lte("generated_at", to_date)

        offset = (page - 1) * page_size
        resp = query.order("generated_at", desc=True).range(offset, offset + page_size - 1).execute()

        # Fetch item counts per CAP
        items = resp.data or []
        if items:
            cap_ids = [c["id"] for c in items]
            counts_resp = (
                db.table("cap_items")
                .select("cap_id", count="exact")
                .in_("cap_id", cap_ids)
                .eq("is_deleted", False)
                .execute()
            )
            # Build count map from raw data
            count_map: dict[str, int] = {}
            for row in (counts_resp.data or []):
                cid = row["cap_id"]
                count_map[cid] = count_map.get(cid, 0) + 1
            for c in items:
                c["item_count"] = count_map.get(c["id"], 0)

        return {
            "items": items,
            "total_count": resp.count or 0,
            "page": page,
            "page_size": page_size,
        }

    @staticmethod
    async def get_cap(cap_id: str, org_id: str) -> dict:
        db = get_admin_client()
        resp = (
            db.table("corrective_action_plans")
            .select(
                "*, locations(name), "
                "form_submissions(id, submitted_at, submitted_by, overall_score, passed, "
                "form_templates(id, title, form_sections(id, title, display_order, "
                "form_fields(id, label, display_order, section_id)))), "
                "cap_items(*, suggested_assignee:profiles!suggested_assignee_id(full_name), "
                "followup_assignee:profiles!followup_assignee_id(full_name))"
            )
            .eq("id", cap_id)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="CAP not found")
        cap = resp.data[0]
        # Filter deleted items
        cap["cap_items"] = [i for i in (cap.get("cap_items") or []) if not i.get("is_deleted")]
        return cap

    @staticmethod
    async def get_cap_by_submission(submission_id: str, org_id: str) -> dict | None:
        db = get_admin_client()
        resp = (
            db.table("corrective_action_plans")
            .select("id, status")
            .eq("submission_id", submission_id)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not resp.data:
            return None
        return resp.data[0]

    # ── Update / Confirm / Dismiss ────────────────────────────────────────────

    @staticmethod
    async def update_cap_item(
        cap_id: str, item_id: str, org_id: str, reviewed_by: str,
        body: UpdateCAPItemRequest,
    ) -> dict:
        db = get_admin_client()

        # Verify CAP exists and is editable
        cap_resp = (
            db.table("corrective_action_plans")
            .select("id, status")
            .eq("id", cap_id)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not cap_resp.data:
            raise HTTPException(status_code=404, detail="CAP not found")
        cap = cap_resp.data[0]
        if cap["status"] not in ("pending_review", "in_review"):
            raise HTTPException(status_code=400, detail="CAP is not editable")

        # Build update dict
        updates: dict = {}
        for field in ("followup_type", "followup_title", "followup_description", "followup_priority"):
            val = getattr(body, field, None)
            if val is not None:
                updates[field] = val
        if body.followup_assignee_id is not None:
            updates["followup_assignee_id"] = str(body.followup_assignee_id)
        if body.followup_due_at is not None:
            updates["followup_due_at"] = body.followup_due_at.isoformat()

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        updates["updated_at"] = datetime.now(timezone.utc).isoformat()

        item_resp = (
            db.table("cap_items")
            .update(updates)
            .eq("id", item_id)
            .eq("cap_id", cap_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not item_resp.data:
            raise HTTPException(status_code=404, detail="CAP item not found")

        # Auto-transition CAP to in_review
        if cap["status"] == "pending_review":
            db.table("corrective_action_plans").update({
                "status": "in_review",
                "reviewed_by": reviewed_by,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", cap_id).execute()

        return item_resp.data[0]

    @staticmethod
    async def confirm_cap(cap_id: str, org_id: str, reviewed_by: str) -> dict:
        db = get_admin_client()

        # Fetch CAP
        cap_resp = (
            db.table("corrective_action_plans")
            .select("*, cap_items(*)")
            .eq("id", cap_id)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not cap_resp.data:
            raise HTTPException(status_code=404, detail="CAP not found")
        cap = cap_resp.data[0]
        if cap["status"] not in ("pending_review", "in_review"):
            raise HTTPException(status_code=400, detail=f"CAP cannot be confirmed from status '{cap['status']}'")

        items = [i for i in (cap.get("cap_items") or []) if not i.get("is_deleted")]
        task_items    = [i for i in items if i.get("followup_type") == "task"]
        issue_items   = [i for i in items if i.get("followup_type") == "issue"]
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

                db.table("cap_items").update({
                    "spawned_task_id": task["id"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", item["id"]).execute()

                db.table("tasks").update({
                    "cap_item_id": item["id"],
                }).eq("id", task["id"]).execute()

        except Exception as e:
            for st in spawned_tasks:
                try:
                    db.table("tasks").update({"is_deleted": True}).eq("id", st["task"]["id"]).execute()
                except Exception:
                    pass
            logger.error(f"CAP confirmation failed, rolled back tasks: {e}")
            raise HTTPException(status_code=500, detail="Failed to create follow-up tasks — confirmation rolled back")

        # Spawn issues
        spawned_issues: list[str] = []
        for item in issue_items:
            try:
                issue_data = {
                    "organisation_id": org_id,
                    "location_id": cap.get("location_id"),
                    "reported_by": reviewed_by,
                    "title": item.get("followup_title") or item.get("suggested_title") or "CAP Issue",
                    "description": item.get("followup_description") or item.get("suggested_description") or "",
                    "priority": item.get("followup_priority") or item.get("suggested_priority") or "medium",
                    "status": "open",
                }
                # Find or use a default category
                cat_resp = db.table("issue_categories").select("id").eq("organisation_id", org_id).eq("is_deleted", False).limit(1).execute()
                if cat_resp.data:
                    issue_data["category_id"] = cat_resp.data[0]["id"]
                issue_resp = db.table("issues").insert(issue_data).execute()
                if issue_resp.data:
                    issue_id = issue_resp.data[0]["id"]
                    spawned_issues.append(issue_id)
                    db.table("cap_items").update({
                        "spawned_issue_id": issue_id,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", item["id"]).execute()
            except Exception as e:
                logger.error(f"Failed to spawn issue for CAP item {item['id']}: {e}")

        # Spawn incidents
        spawned_incidents: list[str] = []
        for item in incident_items:
            try:
                incident_data = {
                    "org_id": org_id,
                    "reported_by": reviewed_by,
                    "title": item.get("followup_title") or item.get("suggested_title") or "CAP Incident",
                    "description": item.get("followup_description") or item.get("suggested_description") or "",
                    "severity": item.get("followup_priority") or item.get("suggested_priority") or "medium",
                    "status": "reported",
                    "incident_date": datetime.now(timezone.utc).isoformat(),
                }
                if cap.get("location_id"):
                    incident_data["location_id"] = cap["location_id"]
                incident_resp = db.table("incidents").insert(incident_data).execute()
                if incident_resp.data:
                    incident_id = incident_resp.data[0]["id"]
                    spawned_incidents.append(incident_id)
                    db.table("cap_items").update({
                        "spawned_incident_id": incident_id,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", item["id"]).execute()
            except Exception as e:
                logger.error(f"Failed to spawn incident for CAP item {item['id']}: {e}")

        # Update CAP status
        now = datetime.now(timezone.utc).isoformat()
        db.table("corrective_action_plans").update({
            "status": "confirmed",
            "reviewed_by": reviewed_by,
            "reviewed_at": now,
            "updated_at": now,
        }).eq("id", cap_id).execute()

        return {
            "cap_id": cap_id,
            "status": "confirmed",
            "tasks_created": len(spawned_tasks),
            "issues_created": len(spawned_issues),
            "incidents_created": len(spawned_incidents),
            "items_skipped": len([i for i in items if i.get("followup_type") == "none"]),
        }

    @staticmethod
    async def dismiss_cap(cap_id: str, org_id: str, reviewed_by: str, reason: str) -> dict:
        db = get_admin_client()

        cap_resp = (
            db.table("corrective_action_plans")
            .select("id, status")
            .eq("id", cap_id)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not cap_resp.data:
            raise HTTPException(status_code=404, detail="CAP not found")
        if cap_resp.data[0]["status"] in ("confirmed", "dismissed"):
            raise HTTPException(status_code=400, detail="CAP is already finalized")

        now = datetime.now(timezone.utc).isoformat()
        db.table("corrective_action_plans").update({
            "status": "dismissed",
            "dismissed_reason": reason,
            "reviewed_by": reviewed_by,
            "reviewed_at": now,
            "updated_at": now,
        }).eq("id", cap_id).execute()

        return {"cap_id": cap_id, "status": "dismissed"}
