"""
Maintenance API — /api/v1/maintenance
Maintenance ticket CRUD.
"""
import os
from datetime import datetime
from typing import Optional
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, require_manager_or_above, paginate
from services.supabase_client import get_supabase

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


async def _send_fcm_notification(
    tokens: list,
    title: str,
    body: str,
    data: Optional[dict] = None,
):
    """Call the Supabase Edge Function to send FCM push notifications."""
    supabase_url = os.environ.get("SUPABASE_URL", "")
    if not supabase_url:
        return

    edge_url = supabase_url.replace("/rest/v1", "").rstrip("/")
    edge_url = f"{edge_url}/functions/v1/send-fcm-notification"

    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    payload = {
        "tokens": tokens,
        "notification": {"title": title, "body": body},
        "data": data or {},
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                edge_url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {service_role_key}",
                    "Content-Type": "application/json",
                },
            )
    except Exception:
        pass


# ── Tickets ────────────────────────────────────────────────────────────────────

@router.post("/")
async def create_ticket(
    body: CreateTicketRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    db = get_supabase()

    data = {
        "organisation_id": org_id,
        "created_by": user_id,
        "title": body.title,
        "priority": body.priority,
        "status": "open",
    }
    if body.description is not None:
        data["description"] = body.description
    if body.asset_id is not None:
        data["asset_id"] = body.asset_id
    if body.location_id is not None:
        data["location_id"] = body.location_id
    if body.issue_id is not None:
        data["issue_id"] = body.issue_id

    resp = db.table("maintenance_tickets").insert(data).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create maintenance ticket")
    return resp.data[0]


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
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    offset = pagination["offset"]
    page_size = pagination["page_size"]

    query = (
        db.table("maintenance_tickets")
        .select(
            "*, assets(name, asset_type), locations(name), vendors(name), "
            "profiles!assigned_to(full_name), profiles!created_by(full_name)",
            count="exact",
        )
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
    )

    if asset_id:
        query = query.eq("asset_id", asset_id)
    if status:
        query = query.eq("status", status)
    if priority:
        query = query.eq("priority", priority)
    if assigned_to:
        query = query.eq("assigned_to", assigned_to)
    if vendor_id:
        query = query.eq("vendor_id", vendor_id)
    if location_id:
        query = query.eq("location_id", location_id)

    resp = query.order("created_at", desc=True).range(offset, offset + page_size - 1).execute()

    return {"data": resp.data or [], "total": resp.count or 0}


@router.get("/{ticket_id}")
async def get_ticket(
    ticket_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    resp = (
        db.table("maintenance_tickets")
        .select(
            "*, assets(name, asset_type, serial_number), locations(name), vendors(name, contact_name), "
            "profiles!assigned_to(full_name), profiles!created_by(full_name)"
        )
        .eq("id", str(ticket_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Maintenance ticket not found")
    return resp.data[0]


@router.put("/{ticket_id}/status")
async def update_ticket_status(
    ticket_id: UUID,
    body: UpdateTicketStatusRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    db = get_supabase()

    current_resp = (
        db.table("maintenance_tickets")
        .select("id, status, asset_id, assigned_to, cost")
        .eq("id", str(ticket_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not current_resp.data:
        raise HTTPException(status_code=404, detail="Maintenance ticket not found")

    ticket = current_resp.data[0]
    previous_status = ticket["status"]

    updates = {
        "status": body.status,
        "updated_at": datetime.utcnow().isoformat(),
    }
    if body.note:
        updates["resolution_note"] = body.note

    # If resolving, record resolved time and update cost if provided
    if body.status == "resolved":
        updates["resolved_at"] = datetime.utcnow().isoformat()
        resolution_cost = body.cost if body.cost is not None else (ticket.get("cost") or 0)
        if body.cost is not None:
            updates["cost"] = body.cost

        # Atomically update asset: last_maintenance_at and total_repair_cost
        asset_id = ticket.get("asset_id")
        if asset_id:
            try:
                asset_resp = (
                    db.table("assets")
                    .select("id, total_repair_cost")
                    .eq("id", asset_id)
                    .execute()
                )
                if asset_resp.data:
                    current_total = float(asset_resp.data[0].get("total_repair_cost") or 0)
                    new_total = current_total + float(resolution_cost)
                    db.table("assets").update({
                        "last_maintenance_at": datetime.utcnow().isoformat(),
                        "total_repair_cost": new_total,
                        "updated_at": datetime.utcnow().isoformat(),
                    }).eq("id", asset_id).execute()
            except Exception:
                pass

    resp = (
        db.table("maintenance_tickets")
        .update(updates)
        .eq("id", str(ticket_id))
        .eq("organisation_id", org_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Send FCM to assignee if exists
    assigned_to = ticket.get("assigned_to")
    if assigned_to:
        try:
            profile_resp = (
                db.table("profiles")
                .select("fcm_token")
                .eq("id", assigned_to)
                .execute()
            )
            if profile_resp.data and profile_resp.data[0].get("fcm_token"):
                await _send_fcm_notification(
                    tokens=[profile_resp.data[0]["fcm_token"]],
                    title="Maintenance ticket updated",
                    body=f"Status changed from {previous_status} to {body.status}",
                    data={"ticket_id": str(ticket_id)},
                )
        except Exception:
            pass

    return resp.data[0]


@router.put("/{ticket_id}/assign")
async def assign_ticket(
    ticket_id: UUID,
    body: AssignTicketRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    ticket = (
        db.table("maintenance_tickets")
        .select("id")
        .eq("id", str(ticket_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not ticket.data:
        raise HTTPException(status_code=404, detail="Maintenance ticket not found")

    updates: dict = {"updated_at": datetime.utcnow().isoformat()}
    if body.assigned_to is not None:
        updates["assigned_to"] = body.assigned_to
    if body.vendor_id is not None:
        updates["vendor_id"] = body.vendor_id

    if len(updates) == 1:
        raise HTTPException(status_code=400, detail="Provide assigned_to or vendor_id")

    resp = (
        db.table("maintenance_tickets")
        .update(updates)
        .eq("id", str(ticket_id))
        .eq("organisation_id", org_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return resp.data[0]


@router.put("/{ticket_id}/cost")
async def update_ticket_cost(
    ticket_id: UUID,
    body: UpdateTicketCostRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    ticket = (
        db.table("maintenance_tickets")
        .select("id")
        .eq("id", str(ticket_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not ticket.data:
        raise HTTPException(status_code=404, detail="Maintenance ticket not found")

    resp = (
        db.table("maintenance_tickets")
        .update({"cost": body.cost, "updated_at": datetime.utcnow().isoformat()})
        .eq("id", str(ticket_id))
        .eq("organisation_id", org_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return resp.data[0]
