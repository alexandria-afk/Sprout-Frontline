"""
Safety API — /api/v1/safety
Safety gamification endpoints: leaderboard, badges, points.

NOTE: The old safety_badges and user_safety_badges tables were dropped.
      Badges are now in badge_configs / user_badge_awards (gamification module).
      Badge CRUD is handled by /api/v1/gamification/badges.
      This router retains the leaderboard and points endpoints which still
      read from safety_points (unchanged), and the badge endpoints have been
      updated to use the new tables.
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

class CreateBadgeRequest(BaseModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    points_awarded: Optional[int] = 0
    criteria_type: Optional[str] = "manual"
    criteria_value: Optional[int] = None


class AwardBadgeRequest(BaseModel):
    user_id: str
    note: Optional[str] = None


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


# ── Leaderboard ────────────────────────────────────────────────────────────────

@router.get("/leaderboard")
async def leaderboard(
    location_id: Optional[str] = Query(None),
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    offset = pagination["offset"]
    page_size = pagination["page_size"]

    query = (
        db.table("safety_points")
        .select(
            "id, user_id, total_points, profiles!user_id(full_name, location_id, locations(name))",
            count="exact",
        )
        .eq("organisation_id", org_id)
    )

    if location_id:
        # Filter via profiles join — fetch user_ids at this location first
        profile_resp = (
            db.table("profiles")
            .select("id")
            .eq("organisation_id", org_id)
            .eq("location_id", location_id)
            .eq("is_deleted", False)
            .execute()
        )
        user_ids = [p["id"] for p in (profile_resp.data or [])]
        if not user_ids:
            return {"data": [], "total": 0}
        query = query.in_("user_id", user_ids)

    resp = (
        query
        .order("total_points", desc=True)
        .range(offset, offset + page_size - 1)
        .execute()
    )

    return {"data": resp.data or [], "total": resp.count or 0}


# ── Badges ─────────────────────────────────────────────────────────────────────

@router.get("/badges")
async def list_badges(
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    resp = (
        db.table("badge_configs")
        .select("*")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .eq("is_active", True)
        .order("name")
        .execute()
    )

    return {"data": resp.data or [], "total": len(resp.data or [])}


@router.post("/badges")
async def create_badge(
    body: CreateBadgeRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    data = {
        "organisation_id": org_id,
        "name": body.name,
        "points_awarded": body.points_awarded or 0,
        "criteria_type": body.criteria_type or "manual",
        "is_active": True,
        "is_template": False,
    }
    if body.description is not None:
        data["description"] = body.description
    if body.icon is not None:
        data["icon"] = body.icon
    if body.criteria_value is not None:
        data["criteria_value"] = body.criteria_value

    resp = db.table("badge_configs").insert(data).execute()
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create badge")
    return resp.data[0]


@router.get("/badges/my")
async def my_badges(
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    resp = (
        db.table("user_badge_awards")
        .select("*, badge_configs(name, description, icon, points_awarded, criteria_type)")
        .eq("user_id", user_id)
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .order("awarded_at", desc=True)
        .execute()
    )

    return {"data": resp.data or [], "total": len(resp.data or [])}


@router.post("/badges/{badge_id}/award")
async def award_badge(
    badge_id: UUID,
    body: AwardBadgeRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    awarded_by = current_user["sub"]
    db = get_supabase()

    # Verify badge belongs to org
    badge_resp = (
        db.table("badge_configs")
        .select("id, name, points_awarded")
        .eq("id", str(badge_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not badge_resp.data:
        raise HTTPException(status_code=404, detail="Badge not found")

    badge = badge_resp.data[0]
    points_value = badge.get("points_awarded") or 0

    # Verify recipient exists in org
    recipient_resp = (
        db.table("profiles")
        .select("id, fcm_token")
        .eq("id", body.user_id)
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    if not recipient_resp.data:
        raise HTTPException(status_code=404, detail="User not found in organisation")

    recipient = recipient_resp.data[0]

    # Insert user_badge_awards record
    award_data = {
        "organisation_id": org_id,
        "user_id": body.user_id,
        "badge_id": str(badge_id),
        "awarded_by": awarded_by,
        "awarded_at": datetime.utcnow().isoformat(),
        "is_deleted": False,
    }

    award_resp = db.table("user_badge_awards").insert(award_data).execute()
    if not award_resp.data:
        raise HTTPException(status_code=500, detail="Failed to award badge")

    # Update or create safety_points record
    try:
        points_resp = (
            db.table("safety_points")
            .select("id, total_points")
            .eq("user_id", body.user_id)
            .eq("organisation_id", org_id)
            .execute()
        )
        if points_resp.data:
            current_total = float(points_resp.data[0].get("total_points") or 0)
            db.table("safety_points").update({
                "total_points": current_total + points_value,
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", points_resp.data[0]["id"]).execute()
        else:
            db.table("safety_points").insert({
                "organisation_id": org_id,
                "user_id": body.user_id,
                "total_points": points_value,
            }).execute()
    except Exception:
        pass

    # Send FCM to recipient
    fcm_token = recipient.get("fcm_token")
    if fcm_token:
        await _send_fcm_notification(
            tokens=[fcm_token],
            title="Badge awarded!",
            body=f"You've been awarded the '{badge['name']}' badge!",
            data={"badge_id": str(badge_id)},
        )

    return award_resp.data[0]


# ── Points ─────────────────────────────────────────────────────────────────────

@router.get("/points/my")
async def my_points(
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    db = get_supabase()

    resp = (
        db.table("safety_points")
        .select("*")
        .eq("user_id", user_id)
        .eq("organisation_id", org_id)
        .execute()
    )

    if not resp.data:
        # Return a zero-points record if none exists yet
        return {
            "user_id": user_id,
            "organisation_id": org_id,
            "total_points": 0,
        }

    return resp.data[0]
