from fastapi import APIRouter, Depends
from dependencies import get_current_user
from services.auth_service import AuthService
from models.auth import LoginRequest, ChangePasswordRequest

router = APIRouter()


@router.post("/login")
async def login(body: LoginRequest):
    return await AuthService.login(body)


@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    return await AuthService.logout(current_user)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
):
    return await AuthService.change_password(body, current_user)
