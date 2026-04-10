"""
Maintenance API — /api/v1/maintenance
Maintenance ticket CRUD.
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, require_manager_or_above, paginate, get_db
from services.db import row, rows, execute, execute_returning

router = APIRouter()


# ── Request Models ─────────────────────────────────────────────────────────────

class CreateTicketRequest(BaseModel):
    title: str
    description: Optional[str] = None
    asset_id: Optional[str] = None
    location_id: Optional[str] = None
    priority: str = "medium"  # low, medium, high, critical
    issue_id: Optional[str] = None  # Link to an issue if applicable


class UpdateTicketStatusRequest(BaseModel):
    status: str
    note: Optional[str] = None
    cost: Optional[float] = None  # Cost incurred at resolution


class AssignTicketRequest(BaseModel):
    assigned_to: Optional[str] = None  # user_id
    vendor_id: Optional[str] = None


class UpdateTicketCostRequest(BaseModel):
    cost: float


# ── Tickets ────────────────────────────────────────────────────────────────────

@router.post("/")
async def create_ticket(
    body: CreateTicketRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]

    fields = ["organisation_id", "created_by", "title", "priority", "status"]
    values: list = [org_id, user_id, body.title, body.priority, "open"]

    for field in ["description", "asset_id", "location_id", "issue_id"]:
        val = getattr(body, field, None)
        if val is not None:
            fields.append(field)
            values.append(val)

    col_list = ", ".join(fields)
    placeholder_list = ", ".join(["%s"] * len(fields))
    result = execute_returning(
        conn,
        f"INSERT INTO maintenance_tickets ({col_list}) VALUES ({placeholder_list}) RETURNING *",
        tuple(values),
    )
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create maintenance ticket")
    return dict(result)


@router.get("/")
async def list_tickets(
    pagination: dict = Depends(paginate),
    asset_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    vendor_id: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    offset = pagination["offset"]
    page_size = pagination["page_size"]

    conditions = ["mt.organisation_id = %s", "mt.is_deleted = FALSE"]
    params: list = [org_id]

    if asset_id:
        conditions.append("mt.asset_id = %s")
        params.append(asset_id)
    if status:
        conditions.append("mt.status = %s")
        params.append(status)
    if priority:
        conditions.append("mt.priority = %s")
        params.append(priority)
    if assigned_to:
        conditions.append("mt.assigned_to = %s")
        params.append(assigned_to)
    if vendor_id:
        conditions.append("mt.vendor_id = %s")
        params.append(vendor_id)
    if location_id:
        conditions.append("mt.location_id = %s")
        params.append(location_id)

    where = " AND ".join(conditions)

    # Count query
    count_row = row(conn, f"SELECT COUNT(*) AS total FROM maintenance_tickets mt WHERE {where}", tuple(params))
    total = count_row["total"] if count_row else 0

    params.extend([page_size, offset])
    data = rows(
        conn,
        f"""
        SELECT
            mt.*,
            json_build_object('name', a.name, 'asset_type', a.asset_type) AS assets,
            json_build_object('name', l.name) AS locations,
            json_build_object('name', v.name) AS vendors,
            json_build_object('full_name', pa.full_name) AS assigned_profile,
            json_build_object('full_name', pc.full_name) AS creator_profile
        FROM maintenance_tickets mt
        LEFT JOIN assets a ON a.id = mt.asset_id
        LEFT JOIN locations l ON l.id = mt.location_id
        LEFT JOIN vendors v ON v.id = mt.vendor_id
        LEFT JOIN profiles pa ON pa.id = mt.assigned_to
        LEFT JOIN profiles pc ON pc.id = mt.created_by
        WHERE {where}
        ORDER BY mt.created_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params),
    )

    return {"data": data, "total": total}


@router.get("/{ticket_id}")
async def get_ticket(
    ticket_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    result = row(
        conn,
        """
        SELECT
            mt.*,
            json_build_object('name', a.name, 'asset_type', a.asset_type, 'serial_number', a.serial_number) AS assets,
            json_build_object('name', l.name) AS locations,
            json_build_object('name', v.name, 'contact_name', v.contact_name) AS vendors,
            json_build_object('full_name', pa.full_name) AS assigned_profile,
            json_build_object('full_name', pc.full_name) AS creator_profile
        FROM maintenance_tickets mt
        LEFT JOIN assets a ON a.id = mt.asset_id
        LEFT JOIN locations l ON l.id = mt.location_id
        LEFT JOIN vendors v ON v.id = mt.vendor_id
        LEFT JOIN profiles pa ON pa.id = mt.assigned_to
        LEFT JOIN profiles pc ON pc.id = mt.created_by
        WHERE mt.id = %s AND mt.organisation_id = %s AND mt.is_deleted = FALSE
        """,
        (str(ticket_id), org_id),
    )
    if not result:
        raise HTTPException(status_code=404, detail="Maintenance ticket not found")
    return dict(result)


@router.put("/{ticket_id}/status")
async def update_ticket_status(
    ticket_id: UUID,
    body: UpdateTicketStatusRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]

    ticket = row(
        conn,
        "SELECT id, status, asset_id, assigned_to, cost FROM maintenance_tickets WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(ticket_id), org_id),
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Maintenance ticket not found")

    now_iso = datetime.now(timezone.utc).isoformat()
    set_parts = ["status = %s", "updated_at = %s"]
    set_values: list = [body.status, now_iso]

    if body.note:
        set_parts.append("resolution_note = %s")
        set_values.append(body.note)

    # If resolving, record resolved time and update cost if provided
    if body.status == "resolved":
        set_parts.append("resolved_at = %s")
        set_values.append(now_iso)

        resolution_cost = body.cost if body.cost is not None else float(ticket.get("cost") or 0)
        if body.cost is not None:
            set_parts.append("cost = %s")
            set_values.append(body.cost)

        # Atomically update asset: last_maintenance_at and total_repair_cost
        asset_id = ticket.get("asset_id")
        if asset_id:
            try:
                asset = row(conn, "SELECT id, total_repair_cost FROM assets WHERE id = %s", (asset_id,))
                if asset:
                    current_total = float(asset.get("total_repair_cost") or 0)
                    new_total = current_total + float(resolution_cost)
                    execute(
                        conn,
                        "UPDATE assets SET last_maintenance_at = %s, total_repair_cost = %s, updated_at = %s WHERE id = %s",
                        (now_iso, new_total, now_iso, asset_id),
                    )
            except Exception:
                pass

    set_clause = ", ".join(set_parts)
    set_values.extend([str(ticket_id), org_id])
    result = execute_returning(
        conn,
        f"UPDATE maintenance_tickets SET {set_clause} WHERE id = %s AND organisation_id = %s RETURNING *",
        tuple(set_values),
    )
    if not result:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return dict(result)


@router.put("/{ticket_id}/assign")
async def assign_ticket(
    ticket_id: UUID,
    body: AssignTicketRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    ticket = row(
        conn,
        "SELECT id FROM maintenance_tickets WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(ticket_id), org_id),
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Maintenance ticket not found")

    set_parts = ["updated_at = %s"]
    set_values: list = [datetime.now(timezone.utc).isoformat()]

    if body.assigned_to is not None:
        set_parts.append("assigned_to = %s")
        set_values.append(body.assigned_to)
    if body.vendor_id is not None:
        set_parts.append("vendor_id = %s")
        set_values.append(body.vendor_id)

    if len(set_parts) == 1:
        raise HTTPException(status_code=400, detail="Provide assigned_to or vendor_id")

    set_clause = ", ".join(set_parts)
    set_values.extend([str(ticket_id), org_id])
    result = execute_returning(
        conn,
        f"UPDATE maintenance_tickets SET {set_clause} WHERE id = %s AND organisation_id = %s RETURNING *",
        tuple(set_values),
    )
    if not result:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return dict(result)


@router.put("/{ticket_id}/cost")
async def update_ticket_cost(
    ticket_id: UUID,
    body: UpdateTicketCostRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    ticket = row(
        conn,
        "SELECT id FROM maintenance_tickets WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
        (str(ticket_id), org_id),
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Maintenance ticket not found")

    result = execute_returning(
        conn,
        "UPDATE maintenance_tickets SET cost = %s, updated_at = %s WHERE id = %s AND organisation_id = %s RETURNING *",
        (body.cost, datetime.now(timezone.utc).isoformat(), str(ticket_id), org_id),
    )
    if not result:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return dict(result)
