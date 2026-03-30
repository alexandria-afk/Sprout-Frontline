from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from dependencies import get_current_user, require_admin, require_manager_or_above, paginate
from models.users import CreateUserRequest, UpdateUserRequest, PositionSuggestion
from services.user_service import UserService

router = APIRouter()


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    user_id = current_user["sub"]
    return await UserService.get_me(user_id)


@router.get("/")
async def list_users(
    pagination: dict = Depends(paginate),
    location_id: Optional[UUID] = Query(None),
    role: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await UserService.list_users(
        org_id=org_id,
        location_id=str(location_id) if location_id else None,
        role=role,
        search=search,
        page=pagination["page"],
        page_size=pagination["page_size"],
    )


@router.post("/bulk-import")
async def bulk_import(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    content = await file.read()
    csv_content = content.decode("utf-8")
    return await UserService.bulk_import(csv_content, org_id)


@router.post("/")
async def create_user(
    body: CreateUserRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await UserService.create_user(body, org_id)


@router.get("/positions", response_model=list[PositionSuggestion])
async def list_positions(
    search: str = Query(default=""),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await UserService.get_distinct_positions(org_id=org_id, search=search)


@router.get("/{user_id}")
async def get_user(user_id: UUID, current_user: dict = Depends(require_admin)):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await UserService.get_user(str(user_id), org_id)


@router.patch("/{user_id}")
async def update_user(
    user_id: UUID,
    body: UpdateUserRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await UserService.update_user(str(user_id), body, org_id)


@router.delete("/{user_id}")
async def delete_user(user_id: UUID, current_user: dict = Depends(require_admin)):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await UserService.delete_user(str(user_id), org_id)
