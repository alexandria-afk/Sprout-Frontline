"""
Issue Categories API — /api/v1/issue-categories
Issue categories + custom fields + escalation rules.
"""
from datetime import datetime, timezone
from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, get_db
from services.db import row, rows, execute, execute_returning

router = APIRouter()


# ── Request Models ─────────────────────────────────────────────────────────────

class CreateCategoryRequest(BaseModel):
    name: str
    default_priority: str  # required: low | medium | high | critical
    description: Optional[str] = None
    sla_hours: Optional[int] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    is_maintenance: Optional[bool] = None


class UpdateCategoryRequest(BaseModel):
    name: Optional[str] = None
    default_priority: Optional[str] = None
    description: Optional[str] = None
    sla_hours: Optional[int] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    is_maintenance: Optional[bool] = None


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
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    categories = rows(
        conn,
        """
        SELECT
            ic.*,
            COALESCE(
                json_agg(
                    icf ORDER BY icf.sort_order
                ) FILTER (WHERE icf.id IS NOT NULL AND icf.is_deleted = FALSE),
                '[]'
            ) AS issue_custom_fields,
            COALESCE(
                json_agg(
                    ier ORDER BY ier.sort_order
                ) FILTER (WHERE ier.id IS NOT NULL AND ier.is_deleted = FALSE),
                '[]'
            ) AS issue_escalation_rules
        FROM issue_categories ic
        LEFT JOIN issue_custom_fields icf ON icf.category_id = ic.id
        LEFT JOIN issue_escalation_rules ier ON ier.category_id = ic.id
        WHERE ic.organisation_id = %s
          AND ic.is_deleted = FALSE
        GROUP BY ic.id
        ORDER BY ic.name
        """,
        (org_id,),
    )

    # json_agg returns dicts already; cast to plain list for serialisation
    result = [dict(cat) for cat in categories]
    return {"data": result, "total": len(result)}


@router.post("")
async def create_category(
    body: CreateCategoryRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    # Build dynamic column/value lists for optional fields
    cols = ["organisation_id", "name", "default_priority"]
    vals = [org_id, body.name, body.default_priority]

    if body.description is not None:
        cols.append("description"); vals.append(body.description)
    if body.sla_hours is not None:
        cols.append("sla_hours"); vals.append(body.sla_hours)
    if body.color is not None:
        cols.append("color"); vals.append(body.color)
    if body.icon is not None:
        cols.append("icon"); vals.append(body.icon)
    if body.is_maintenance is not None:
        cols.append("is_maintenance"); vals.append(body.is_maintenance)

    placeholders = ", ".join(["%s"] * len(cols))
    col_list = ", ".join(cols)

    cat = execute_returning(
        conn,
        f"INSERT INTO issue_categories ({col_list}) VALUES ({placeholders}) RETURNING *",
        tuple(vals),
    )
    if not cat:
        raise HTTPException(status_code=500, detail="Failed to create category")
    return dict(cat)


@router.put("/{category_id}")
async def update_category(
    category_id: UUID,
    body: UpdateCategoryRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    updates = {}
    for k, v in body.model_dump().items():
        if k == "is_maintenance":
            if v is not None:
                updates[k] = v
        elif v is not None:
            updates[k] = v

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    updates["updated_at"] = datetime.now(timezone.utc)

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    vals = list(updates.values()) + [str(category_id), org_id]

    cat = execute_returning(
        conn,
        f"""
        UPDATE issue_categories
        SET {set_clause}
        WHERE id = %s
          AND organisation_id = %s
          AND is_deleted = FALSE
        RETURNING *
        """,
        tuple(vals),
    )
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    return dict(cat)


@router.delete("/{category_id}")
async def delete_category(
    category_id: UUID,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    execute(
        conn,
        """
        UPDATE issue_categories
        SET is_deleted = TRUE, updated_at = %s
        WHERE id = %s AND organisation_id = %s
        """,
        (datetime.now(timezone.utc), str(category_id), org_id),
    )
    return {"ok": True}


# ── Custom Fields ──────────────────────────────────────────────────────────────

def _assert_category_owned(conn, category_id: str, org_id) -> None:
    """Raise 404 if the category doesn't exist or doesn't belong to the org."""
    cat = row(
        conn,
        """
        SELECT id FROM issue_categories
        WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
        """,
        (category_id, org_id),
    )
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")


@router.post("/{category_id}/custom-fields")
async def add_custom_field(
    category_id: UUID,
    body: CreateCustomFieldRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    _assert_category_owned(conn, str(category_id), org_id)

    cols = ["category_id", "label", "field_type", "is_required", "sort_order"]
    vals = [
        str(category_id),
        body.label,
        body.field_type,
        body.is_required or False,
        body.sort_order or 0,
    ]
    if body.options is not None:
        cols.append("options")
        # psycopg2 will serialise a Python list to a Postgres JSON/array value
        vals.append(body.options)

    placeholders = ", ".join(["%s"] * len(cols))
    col_list = ", ".join(cols)

    field = execute_returning(
        conn,
        f"INSERT INTO issue_custom_fields ({col_list}) VALUES ({placeholders}) RETURNING *",
        tuple(vals),
    )
    if not field:
        raise HTTPException(status_code=500, detail="Failed to create custom field")
    return dict(field)


@router.put("/{category_id}/custom-fields/{field_id}")
async def update_custom_field(
    category_id: UUID,
    field_id: UUID,
    body: UpdateCustomFieldRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    _assert_category_owned(conn, str(category_id), org_id)

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = datetime.now(timezone.utc)

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    vals = list(updates.values()) + [str(field_id), str(category_id)]

    field = execute_returning(
        conn,
        f"""
        UPDATE issue_custom_fields
        SET {set_clause}
        WHERE id = %s
          AND category_id = %s
          AND is_deleted = FALSE
        RETURNING *
        """,
        tuple(vals),
    )
    if not field:
        raise HTTPException(status_code=404, detail="Custom field not found")
    return dict(field)


@router.delete("/{category_id}/custom-fields/{field_id}")
async def delete_custom_field(
    category_id: UUID,
    field_id: UUID,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    _assert_category_owned(conn, str(category_id), org_id)

    execute(
        conn,
        """
        UPDATE issue_custom_fields
        SET is_deleted = TRUE, updated_at = %s
        WHERE id = %s AND category_id = %s
        """,
        (datetime.now(timezone.utc), str(field_id), str(category_id)),
    )
    return {"ok": True}


# ── Escalation Rules ───────────────────────────────────────────────────────────

@router.post("/{category_id}/escalation-rules")
async def add_escalation_rule(
    category_id: UUID,
    body: CreateEscalationRuleRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    _assert_category_owned(conn, str(category_id), org_id)

    cols = [
        "category_id", "trigger_type",
        "notify_via_fcm", "notify_via_email", "sort_order",
    ]
    vals = [
        str(category_id),
        body.trigger_type,
        body.notify_via_fcm if body.notify_via_fcm is not None else True,
        body.notify_via_email if body.notify_via_email is not None else False,
        body.sort_order or 0,
    ]

    if body.trigger_status is not None:
        cols.append("trigger_status"); vals.append(body.trigger_status)
    if body.escalate_to_role is not None:
        cols.append("escalate_to_role"); vals.append(body.escalate_to_role)
    if body.escalate_to_user_id is not None:
        cols.append("escalate_to_user_id"); vals.append(body.escalate_to_user_id)

    placeholders = ", ".join(["%s"] * len(cols))
    col_list = ", ".join(cols)

    rule = execute_returning(
        conn,
        f"INSERT INTO issue_escalation_rules ({col_list}) VALUES ({placeholders}) RETURNING *",
        tuple(vals),
    )
    if not rule:
        raise HTTPException(status_code=500, detail="Failed to create escalation rule")
    return dict(rule)


@router.put("/{category_id}/escalation-rules/{rule_id}")
async def update_escalation_rule(
    category_id: UUID,
    rule_id: UUID,
    body: UpdateEscalationRuleRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    _assert_category_owned(conn, str(category_id), org_id)

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = datetime.now(timezone.utc)

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    vals = list(updates.values()) + [str(rule_id), str(category_id)]

    rule = execute_returning(
        conn,
        f"""
        UPDATE issue_escalation_rules
        SET {set_clause}
        WHERE id = %s
          AND category_id = %s
          AND is_deleted = FALSE
        RETURNING *
        """,
        tuple(vals),
    )
    if not rule:
        raise HTTPException(status_code=404, detail="Escalation rule not found")
    return dict(rule)


@router.delete("/{category_id}/escalation-rules/{rule_id}")
async def delete_escalation_rule(
    category_id: UUID,
    rule_id: UUID,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    _assert_category_owned(conn, str(category_id), org_id)

    execute(
        conn,
        """
        UPDATE issue_escalation_rules
        SET is_deleted = TRUE, updated_at = %s
        WHERE id = %s AND category_id = %s
        """,
        (datetime.now(timezone.utc), str(rule_id), str(category_id)),
    )
    return {"ok": True}
