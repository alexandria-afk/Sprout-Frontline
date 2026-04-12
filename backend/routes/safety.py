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
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from dependencies import get_current_user, require_admin, require_manager_or_above, paginate, get_db
from services.db import row, rows, execute, execute_returning

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


# ── Leaderboard ────────────────────────────────────────────────────────────────

@router.get("/leaderboard")
async def leaderboard(
    location_id: Optional[str] = Query(None),
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    offset = pagination["offset"]
    page_size = pagination["page_size"]

    if location_id:
        # Filter via profiles join — fetch user_ids at this location first
        profile_rows = rows(
            conn,
            """
            SELECT id FROM profiles
            WHERE organisation_id = %s
              AND location_id = %s
              AND is_deleted = FALSE
            """,
            (org_id, location_id),
        )
        user_ids = [p["id"] for p in profile_rows]
        if not user_ids:
            return {"data": [], "total": 0}

        data = rows(
            conn,
            """
            SELECT
                up.id,
                up.user_id,
                up.total_points,
                p.full_name,
                p.role,
                p.location_id,
                l.name AS location_name
            FROM user_points up
            JOIN profiles p ON p.id = up.user_id
            LEFT JOIN locations l ON l.id = p.location_id
            WHERE up.organisation_id = %s
              AND up.user_id = ANY(%s::uuid[])
            ORDER BY up.total_points DESC
            LIMIT %s OFFSET %s
            """,
            (org_id, user_ids, page_size, offset),
        )
        total_row = row(
            conn,
            """
            SELECT COUNT(*) AS cnt
            FROM user_points
            WHERE organisation_id = %s
              AND user_id = ANY(%s::uuid[])
            """,
            (org_id, user_ids),
        )
    else:
        data = rows(
            conn,
            """
            SELECT
                up.id,
                up.user_id,
                up.total_points,
                p.full_name,
                p.role,
                p.location_id,
                l.name AS location_name
            FROM user_points up
            JOIN profiles p ON p.id = up.user_id
            LEFT JOIN locations l ON l.id = p.location_id
            WHERE up.organisation_id = %s
            ORDER BY up.total_points DESC
            LIMIT %s OFFSET %s
            """,
            (org_id, page_size, offset),
        )
        total_row = row(
            conn,
            "SELECT COUNT(*) AS cnt FROM user_points WHERE organisation_id = %s",
            (org_id,),
        )

    total = total_row["cnt"] if total_row else 0
    return {"data": data, "total": total}


# ── Badges ─────────────────────────────────────────────────────────────────────

@router.get("/badges")
async def list_badges(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    data = rows(
        conn,
        """
        SELECT * FROM badge_configs
        WHERE organisation_id = %s
          AND is_deleted = FALSE
          AND is_active = TRUE
        ORDER BY name
        """,
        (org_id,),
    )

    return {"data": data, "total": len(data)}


@router.post("/badges")
async def create_badge(
    body: CreateBadgeRequest,
    current_user: dict = Depends(require_admin),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    result = execute_returning(
        conn,
        """
        INSERT INTO badge_configs (
            organisation_id, name, description, icon,
            points_awarded, criteria_type, criteria_value,
            is_active, is_template
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, FALSE)
        RETURNING *
        """,
        (
            org_id,
            body.name,
            body.description,
            body.icon,
            body.points_awarded or 0,
            body.criteria_type or "manual",
            body.criteria_value,
        ),
    )
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create badge")
    return result


@router.get("/badges/my")
async def my_badges(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    data = rows(
        conn,
        """
        SELECT
            uba.*,
            bc.name        AS badge_name,
            bc.description AS badge_description,
            bc.icon        AS badge_icon,
            bc.points_awarded,
            bc.criteria_type
        FROM user_badge_awards uba
        JOIN badge_configs bc ON bc.id = uba.badge_id
        WHERE uba.user_id = %s
          AND uba.organisation_id = %s
          AND uba.is_deleted = FALSE
        ORDER BY uba.awarded_at DESC
        """,
        (user_id, org_id),
    )

    return {"data": data, "total": len(data)}


@router.post("/badges/{badge_id}/award")
async def award_badge(
    badge_id: UUID,
    body: AwardBadgeRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    awarded_by = current_user["sub"]

    # Verify badge belongs to org
    badge = row(
        conn,
        """
        SELECT id, name, points_awarded FROM badge_configs
        WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
        """,
        (str(badge_id), org_id),
    )
    if not badge:
        raise HTTPException(status_code=404, detail="Badge not found")

    points_value = badge.get("points_awarded") or 0

    # Verify recipient exists in org
    recipient = row(
        conn,
        """
        SELECT id, fcm_token FROM profiles
        WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
        """,
        (body.user_id, org_id),
    )
    if not recipient:
        raise HTTPException(status_code=404, detail="User not found in organisation")

    # Insert user_badge_awards record
    award = execute_returning(
        conn,
        """
        INSERT INTO user_badge_awards (
            organisation_id, user_id, badge_id, awarded_by, awarded_at, is_deleted
        ) VALUES (%s, %s, %s, %s, %s, FALSE)
        RETURNING *
        """,
        (
            org_id,
            body.user_id,
            str(badge_id),
            awarded_by,
            datetime.utcnow().isoformat(),
        ),
    )
    if not award:
        raise HTTPException(status_code=500, detail="Failed to award badge")

    # Update or create safety_points record
    try:
        existing_points = row(
            conn,
            """
            SELECT id, total_points FROM safety_points
            WHERE user_id = %s AND organisation_id = %s
            """,
            (body.user_id, org_id),
        )
        if existing_points:
            current_total = float(existing_points.get("total_points") or 0)
            execute(
                conn,
                """
                UPDATE safety_points
                SET total_points = %s, updated_at = %s
                WHERE id = %s
                """,
                (current_total + points_value, datetime.utcnow().isoformat(), existing_points["id"]),
            )
        else:
            execute(
                conn,
                """
                INSERT INTO safety_points (organisation_id, user_id, total_points)
                VALUES (%s, %s, %s)
                """,
                (org_id, body.user_id, points_value),
            )
    except Exception:
        pass

    return award


# ── Points ─────────────────────────────────────────────────────────────────────

@router.get("/points/my")
async def my_points(
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")

    result = row(
        conn,
        """
        SELECT * FROM user_points
        WHERE user_id = %s AND organisation_id = %s
        """,
        (user_id, org_id),
    )

    if not result:
        # Return a zero-points record if none exists yet
        return {
            "user_id": user_id,
            "organisation_id": org_id,
            "total_points": 0,
        }

    return result
