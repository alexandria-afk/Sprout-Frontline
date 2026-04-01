from uuid import UUID
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from dependencies import require_manager_or_above
from services.dashboard_service import DashboardService

router = APIRouter()


@router.get("/summary")
async def get_summary(
    location_id: Optional[UUID] = Query(None),
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    current_user: dict = Depends(require_manager_or_above),
):
    meta = current_user.get("app_metadata") or {}
    org_id = meta.get("organisation_id")
    role = meta.get("role", "manager")
    user_location_id = meta.get("location_id")
    return await DashboardService.get_summary(
        org_id=org_id,
        location_id=str(location_id) if location_id else None,
        from_dt=from_dt,
        to_dt=to_dt,
        role=role,
        user_location_id=user_location_id,
    )
