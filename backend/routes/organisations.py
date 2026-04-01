from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from dependencies import get_current_user, require_admin, require_manager_or_above
from models.organisations import UpdateOrganisationRequest, UpdateFeatureFlagsRequest, CreateLocationRequest, UpdateLocationRequest
from services.org_service import OrgService

router = APIRouter()


def _verify_org_access(org_id: UUID, current_user: dict) -> None:
    """Ensure the URL org_id matches the authenticated user's organisation."""
    user_org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    if user_org_id is None or str(org_id) != user_org_id:
        raise HTTPException(status_code=403, detail="Access denied: organisation mismatch")


@router.get("/my")
async def get_my_org(current_user: dict = Depends(get_current_user)):
    """Return the authenticated user's organisation including feature_flags.
    Accessible to all authenticated users (staff, manager, admin)."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    if not org_id:
        raise HTTPException(status_code=404, detail="No organisation found")
    return await OrgService.get_org(org_id)


@router.get("/{org_id}")
async def get_org(org_id: UUID, current_user: dict = Depends(require_admin)):
    _verify_org_access(org_id, current_user)
    return await OrgService.get_org(str(org_id))


@router.put("/{org_id}")
async def update_org(
    org_id: UUID,
    body: UpdateOrganisationRequest,
    current_user: dict = Depends(require_admin),
):
    _verify_org_access(org_id, current_user)
    return await OrgService.update_org(str(org_id), body)


@router.patch("/{org_id}/feature-flags")
async def update_feature_flags(
    org_id: UUID,
    body: UpdateFeatureFlagsRequest,
    current_user: dict = Depends(require_admin),
):
    _verify_org_access(org_id, current_user)
    return await OrgService.update_feature_flags(str(org_id), body.feature_flags)


@router.get("/{org_id}/locations")
async def list_locations(org_id: UUID, current_user: dict = Depends(require_manager_or_above)):
    _verify_org_access(org_id, current_user)
    return await OrgService.list_locations(str(org_id))


@router.post("/{org_id}/locations")
async def create_location(
    org_id: UUID,
    body: CreateLocationRequest,
    current_user: dict = Depends(require_admin),
):
    _verify_org_access(org_id, current_user)
    return await OrgService.create_location(str(org_id), body)


@router.put("/{org_id}/locations/{loc_id}")
async def update_location(
    org_id: UUID,
    loc_id: UUID,
    body: UpdateLocationRequest,
    current_user: dict = Depends(require_admin),
):
    _verify_org_access(org_id, current_user)
    return await OrgService.update_location(str(org_id), str(loc_id), body)
