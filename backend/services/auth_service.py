from models.auth import ChangePasswordRequest
from models.base import SuccessEnvelope
from fastapi import HTTPException


class AuthService:
    @staticmethod
    async def change_password(body: ChangePasswordRequest, current_user: dict) -> SuccessEnvelope[None]:
        """
        Password changes are now handled by Keycloak.
        Clients should use the Keycloak account management API or the
        Keycloak admin REST API to update passwords.
        """
        raise HTTPException(
            status_code=501,
            detail=(
                "Password changes must be performed via Keycloak. "
                "Use the Keycloak account management endpoint: "
                "POST /realms/{realm}/protocol/openid-connect/token "
                "with grant_type=password to re-authenticate, then "
                "PUT /realms/{realm}/users/{id}/reset-password."
            ),
        )
