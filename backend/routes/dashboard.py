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
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await DashboardService.get_summary(
        org_id=org_id,
        location_id=str(location_id) if location_id else None,
        from_dt=from_dt,
        to_dt=to_dt,
    )
