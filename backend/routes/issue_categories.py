"""
Issue Categories API — /api/v1/issue-categories
Issue categories + custom fields + escalation rules.
"""
from datetime import datetime
from typing import Optional, List, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, paginate
from services.supabase_client import get_supabase

router = APIRouter()


# ── Request Models ─────────────────────────────────────────────────────────────

class CreateCategoryRequest(BaseModel):
    name: str
    default_priority: str  # required: low | medium | high | critical
    description: Optional[str] = None
    sla_hours: Optional[int] = None
    color: Optional[str] = None
    icon: Optional[str] = None


class UpdateCategoryRequest(BaseModel):
    name: Optional[str] = None
    default_priority: Optional[str] = None
    description: Optional[str] = None
    sla_hours: Optional[int] = None
    color: Optional[str] = None
    icon: Optional[str] = None


class CreateCustomFieldRequest(BaseModel):
    label: str
    field_type: str  # text, number, boolean, select, date
    is_required: Optional[bool] = False
    options: Optional[List[str]] = None
    sort_order: Optional[int] = 0


class UpdateCustomFieldRequest(BaseModel):
    label: Optional[str] = None
    field_type: Optional[str] = None
    is_required: Optional[bool] = None
    options: Optional[List[str]] = None
    sort_order: Optional[int] = None


class CreateEscalationRuleRequest(BaseModel):
    trigger_type: str  # on_create, status_change, priority_critical
    trigger_status: Optional[str] = None
    escalate_to_role: Optional[str] = None
    escalate_to_user_id: Optional[str] = None
    notify_via_fcm: Optional[bool] = True
    notify_via_email: Optional[bool] = False
    sort_order: Optional[int] = 0


class UpdateEscalationRuleRequest(BaseModel):
    trigger_type: Optional[str] = None
    trigger_status: Optional[str] = None
    escalate_to_role: Optional[str] = None
    escalate_to_user_id: Optional[str] = None
    notify_via_fcm: Optional[bool] = None
    notify_via_email: Optional[bool] = None
    sort_order: Optional[int] = None


# ── Categories ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_categories(
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    resp = (
        db.table("issue_categories")
        .select(
            "*, issue_custom_fields!left(*), issue_escalation_rules!left(*)"
        )
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .order("name")
        .execute()
    )

    categories = []
    for cat in (resp.data or []):
        cat["issue_custom_fields"] = [
            f for f in (cat.get("issue_custom_fields") or []) if not f.get("is_deleted")
        ]
        cat["issue_escalation_rules"] = [
            r for r in (cat.get("issue_escalation_rules") or []) if not r.get("is_deleted")
        ]
        categories.append(cat)

    return {"data": categories, "total": len(categories)}


@router.post("")
async def create_category(
    body: CreateCategoryRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    data = {
        "organisation_id": org_id,
        "name": body.name,
        "default_priority": body.default_priority,
    }
    if body.description is not None:
        data["description"] = body.description
    if body.sla_hours is not None:
        data["sla_hours"] = body.sla_hours
    if body.color is not None:
        data["color"] = body.color
    if body.icon is not None:
        data["icon"] = body.icon

    resp = db.table("issue_categories").insert(data).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create category")
    return resp.data[0]


@router.put("/{category_id}")
async def update_category(
    category_id: UUID,
    body: UpdateCategoryRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = datetime.utcnow().isoformat()

    resp = (
        db.table("issue_categories")
        .update(updates)
        .eq("id", str(category_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Category not found")
    return resp.data[0]


@router.delete("/{category_id}")
async def delete_category(
    category_id: UUID,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    db.table("issue_categories").update({
        "is_deleted": True,
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", str(category_id)).eq("organisation_id", org_id).execute()

    return {"ok": True}


# ── Custom Fields ──────────────────────────────────────────────────────────────

@router.post("/{category_id}/custom-fields")
async def add_custom_field(
    category_id: UUID,
    body: CreateCustomFieldRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    # Verify category belongs to org
    cat = (
        db.table("issue_categories")
        .select("id")
        .eq("id", str(category_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not cat.data:
        raise HTTPException(status_code=404, detail="Category not found")

    data = {
        "category_id": str(category_id),
        "label": body.label,
        "field_type": body.field_type,
        "is_required": body.is_required or False,
        "sort_order": body.sort_order or 0,
    }
    if body.options is not None:
        data["options"] = body.options

    resp = db.table("issue_custom_fields").insert(data).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create custom field")
    return resp.data[0]


@router.put("/{category_id}/custom-fields/{field_id}")
async def update_custom_field(
    category_id: UUID,
    field_id: UUID,
    body: UpdateCustomFieldRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    cat = (
        db.table("issue_categories")
        .select("id")
        .eq("id", str(category_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not cat.data:
        raise HTTPException(status_code=404, detail="Category not found")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = datetime.utcnow().isoformat()

    resp = (
        db.table("issue_custom_fields")
        .update(updates)
        .eq("id", str(field_id))
        .eq("category_id", str(category_id))
        .eq("is_deleted", False)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Custom field not found")
    return resp.data[0]


@router.delete("/{category_id}/custom-fields/{field_id}")
async def delete_custom_field(
    category_id: UUID,
    field_id: UUID,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    cat = (
        db.table("issue_categories")
        .select("id")
        .eq("id", str(category_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not cat.data:
        raise HTTPException(status_code=404, detail="Category not found")

    db.table("issue_custom_fields").update({
        "is_deleted": True,
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", str(field_id)).eq("category_id", str(category_id)).execute()

    return {"ok": True}


# ── Escalation Rules ───────────────────────────────────────────────────────────

@router.post("/{category_id}/escalation-rules")
async def add_escalation_rule(
    category_id: UUID,
    body: CreateEscalationRuleRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    cat = (
        db.table("issue_categories")
        .select("id")
        .eq("id", str(category_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not cat.data:
        raise HTTPException(status_code=404, detail="Category not found")

    data = {
        "category_id": str(category_id),
        "trigger_type": body.trigger_type,
        "notify_via_fcm": body.notify_via_fcm if body.notify_via_fcm is not None else True,
        "notify_via_email": body.notify_via_email if body.notify_via_email is not None else False,
        "sort_order": body.sort_order or 0,
    }
    if body.trigger_status is not None:
        data["trigger_status"] = body.trigger_status
    if body.escalate_to_role is not None:
        data["escalate_to_role"] = body.escalate_to_role
    if body.escalate_to_user_id is not None:
        data["escalate_to_user_id"] = body.escalate_to_user_id

    resp = db.table("issue_escalation_rules").insert(data).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create escalation rule")
    return resp.data[0]


@router.put("/{category_id}/escalation-rules/{rule_id}")
async def update_escalation_rule(
    category_id: UUID,
    rule_id: UUID,
    body: UpdateEscalationRuleRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    cat = (
        db.table("issue_categories")
        .select("id")
        .eq("id", str(category_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not cat.data:
        raise HTTPException(status_code=404, detail="Category not found")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = datetime.utcnow().isoformat()

    resp = (
        db.table("issue_escalation_rules")
        .update(updates)
        .eq("id", str(rule_id))
        .eq("category_id", str(category_id))
        .eq("is_deleted", False)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Escalation rule not found")
    return resp.data[0]


@router.delete("/{category_id}/escalation-rules/{rule_id}")
async def delete_escalation_rule(
    category_id: UUID,
    rule_id: UUID,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    cat = (
        db.table("issue_categories")
        .select("id")
        .eq("id", str(category_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not cat.data:
        raise HTTPException(status_code=404, detail="Category not found")

    db.table("issue_escalation_rules").update({
        "is_deleted": True,
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", str(rule_id)).eq("category_id", str(category_id)).execute()

    return {"ok": True}
