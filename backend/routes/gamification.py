from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import get_current_user, require_manager_or_above, require_admin, get_db
from services.gamification_service import GamificationService

router = APIRouter()


# ── Request models ──────────────────────────────────────────────────────────


class CreateLeaderboardRequest(BaseModel):
    name: str
    description: Optional[str] = None
    metric_type: str
    scope: Optional[str] = "location"
    time_window: Optional[str] = "monthly"
    is_active: Optional[bool] = True
    is_template: Optional[bool] = False


class CreateBadgeRequest(BaseModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    points_awarded: Optional[int] = 0
    criteria_type: str
    criteria_value: Optional[int] = None
    criteria_window: Optional[str] = "all_time"
    is_template: Optional[bool] = False
    scope: Optional[str] = "individual"


class AwardBadgeRequest(BaseModel):
    user_id: UUID


# ── Leaderboard endpoints ───────────────────────────────────────────────────


@router.get("/leaderboards")
async def list_leaderboards(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """List all active leaderboard configurations for the organisation."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await GamificationService.list_leaderboards(org_id, conn)


@router.get("/leaderboards/{leaderboard_id}")
async def get_leaderboard(
    leaderboard_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Get a leaderboard with computed ranked scores."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    config, entries = await GamificationService.get_leaderboard_scores(leaderboard_id, org_id, conn)
    if config is None:
        raise HTTPException(status_code=404, detail="Leaderboard not found")
    return {"config": config, "entries": entries}


@router.post("/leaderboards")
async def create_leaderboard(
    body: CreateLeaderboardRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    """Create a new leaderboard configuration."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    result = await GamificationService.create_leaderboard(org_id, body.model_dump(exclude_none=False), conn)
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create leaderboard")
    return result


# ── Badge endpoints ─────────────────────────────────────────────────────────


@router.get("/badges")
async def list_badges(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """List all active badge configurations for the organisation."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await GamificationService.list_badges(org_id, conn)


@router.get("/badges/my")
async def my_badges(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Get the current user's earned badges."""
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await GamificationService.list_my_badges(user_id, org_id, conn)


@router.post("/badges")
async def create_badge(
    body: CreateBadgeRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    """Create a new badge configuration."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    result = await GamificationService.create_badge(org_id, body.model_dump(exclude_none=False), conn)
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create badge")
    return result


@router.put("/badges/{badge_id}")
async def update_badge(
    badge_id: UUID,
    body: CreateBadgeRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    """Update an existing badge configuration."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    result = await GamificationService.update_badge(badge_id, org_id, body.model_dump(exclude_none=False), conn)
    if not result:
        raise HTTPException(status_code=404, detail="Badge not found")
    return result


@router.delete("/badges/{badge_id}")
async def delete_badge(
    badge_id: UUID,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    """Soft-delete a badge configuration."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    await GamificationService.delete_badge(badge_id, org_id, conn)
    return {"success": True}


@router.post("/badges/{badge_id}/award")
async def award_badge(
    badge_id: UUID,
    body: AwardBadgeRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    """Award a badge to a user."""
    awarded_by = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    try:
        result = await GamificationService.award_badge(badge_id, body.user_id, org_id, awarded_by, conn)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not result:
        raise HTTPException(status_code=500, detail="Failed to award badge")
    return result


# ── Points endpoints ────────────────────────────────────────────────────────


@router.get("/points/my")
async def my_points(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Get the current user's points row."""
    user_id = current_user["sub"]
    result = await GamificationService.get_my_points(user_id, conn)
    return result or {}


@router.get("/points/org")
async def org_leaderboard(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Overall org leaderboard ranked by total points — no config required."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    entries = await GamificationService.get_org_leaderboard(org_id, conn)
    return {"entries": entries}


@router.get("/points/summary")
async def points_summary(
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    """Get all users' points in the organisation, ordered by total points."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await GamificationService.get_points_summary(org_id, conn)


# ── Template endpoints ──────────────────────────────────────────────────────


@router.get("/templates/badges")
async def list_badge_templates(
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    """List badge templates for the organisation."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await GamificationService.list_badge_templates(org_id, conn)


@router.get("/templates/leaderboards")
async def list_leaderboard_templates(
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    """List leaderboard templates for the organisation."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await GamificationService.list_leaderboard_templates(org_id, conn)


@router.post("/templates/seed")
async def seed_templates(
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    """Seed all badge and leaderboard templates for this organisation."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    await GamificationService.seed_templates(org_id, conn)
    return {"success": True, "message": "Templates seeded successfully"}
