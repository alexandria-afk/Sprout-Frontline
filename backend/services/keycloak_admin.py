"""
Keycloak Admin API client.

Handles user lifecycle management that must stay in sync between the
profiles table and the Keycloak realm:
  - create_keycloak_user       → POST /admin/realms/{realm}/users
  - update_keycloak_user_role  → realm role mapping swap
  - disable_keycloak_user      → PUT /admin/realms/{realm}/users/{id} enabled=false
  - enable_keycloak_user       → PUT /admin/realms/{realm}/users/{id} enabled=true
  - get_keycloak_user_id_by_email → GET /admin/realms/{realm}/users?email=...

Admin tokens are obtained from the MASTER realm via the admin-cli client.
They are short-lived (~60 s) and fetched fresh per operation — no caching.

Configuration (backend/.env):
  KEYCLOAK_URL=http://localhost:56144
  KEYCLOAK_REALM=sprout
  KEYCLOAK_ADMIN_CLIENT_ID=admin-cli       # default, usually unchanged
  KEYCLOAK_ADMIN_USERNAME=admin            # master realm admin
  KEYCLOAK_ADMIN_PASSWORD=admin            # master realm admin password

App roles that live as Keycloak realm roles: super_admin, admin, manager, staff
"""
from __future__ import annotations

import logging
import secrets
import string
from typing import Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)

# ── URL helpers ────────────────────────────────────────────────────────────────
_ADMIN_BASE = f"{settings.keycloak_url}/admin/realms/{settings.keycloak_realm}"
_MASTER_TOKEN_URL = f"{settings.keycloak_url}/realms/master/protocol/openid-connect/token"

# Roles that belong to this application (used to clean up old role before assigning new one)
APP_ROLES = {"super_admin", "admin", "manager", "staff"}


# ── Internal helpers ───────────────────────────────────────────────────────────

def generate_temp_password(length: int = 12) -> str:
    """Return a random temporary password satisfying common complexity rules."""
    # Ensure at least one of each required character class
    upper   = secrets.choice(string.ascii_uppercase)
    lower   = secrets.choice(string.ascii_lowercase)
    digit   = secrets.choice(string.digits)
    special = secrets.choice("!@#$%")
    rest = "".join(
        secrets.choice(string.ascii_letters + string.digits + "!@#$%")
        for _ in range(length - 4)
    )
    password = list(upper + lower + digit + special + rest)
    secrets.SystemRandom().shuffle(password)
    return "".join(password)


async def _get_admin_token() -> str:
    """Fetch a short-lived admin access token from the Keycloak master realm."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post(
            _MASTER_TOKEN_URL,
            data={
                "client_id": settings.keycloak_admin_client_id,
                "username":  settings.keycloak_admin_username,
                "password":  settings.keycloak_admin_password,
                "grant_type": "password",
            },
        )
        if not res.is_success:
            raise RuntimeError(
                f"Failed to obtain Keycloak admin token: {res.status_code} {res.text}"
            )
        return res.json()["access_token"]


async def _get_realm_role(role_name: str, token: str, client: httpx.AsyncClient) -> Optional[dict]:
    """Return the Keycloak role representation for a realm role name, or None if not found."""
    res = await client.get(
        f"{_ADMIN_BASE}/roles/{role_name}",
        headers={"Authorization": f"Bearer {token}"},
    )
    if res.status_code == 404:
        logger.warning("Keycloak realm role '%s' not found", role_name)
        return None
    res.raise_for_status()
    return res.json()


async def _swap_realm_role(
    user_id: str,
    new_role: str,
    token: str,
    client: httpx.AsyncClient,
) -> None:
    """
    Remove any existing app realm roles from the user, then assign new_role.
    This is a replace-not-add operation so users only ever have one app role.
    """
    # Fetch current realm role mappings
    existing_res = await client.get(
        f"{_ADMIN_BASE}/users/{user_id}/role-mappings/realm",
        headers={"Authorization": f"Bearer {token}"},
    )
    existing_res.raise_for_status()

    old_app_roles = [r for r in existing_res.json() if r["name"] in APP_ROLES]
    if old_app_roles:
        await client.request(
            "DELETE",
            f"{_ADMIN_BASE}/users/{user_id}/role-mappings/realm",
            headers={"Authorization": f"Bearer {token}"},
            json=old_app_roles,
        )

    new_role_rep = await _get_realm_role(new_role, token, client)
    if new_role_rep:
        assign_res = await client.post(
            f"{_ADMIN_BASE}/users/{user_id}/role-mappings/realm",
            headers={"Authorization": f"Bearer {token}"},
            json=[new_role_rep],
        )
        assign_res.raise_for_status()
    else:
        logger.warning("Skipping role assignment — realm role '%s' does not exist in Keycloak", new_role)


# ── Public API ─────────────────────────────────────────────────────────────────

async def create_keycloak_user(
    email: str,
    full_name: str,
    role: str,
    temp_password: Optional[str] = None,
) -> tuple[str, str]:
    """
    Create a user in Keycloak and assign a realm role.

    Returns:
        (keycloak_user_id, temp_password)

    The returned user_id should be used as the profiles.id so that the
    JWT `sub` claim matches the profile row on every authenticated request.

    The temp_password is marked `temporary=True` in Keycloak, forcing the
    user to change it on first login. Caller is responsible for delivering it
    (e.g. via email through the Resend service).

    Raises RuntimeError if the admin token cannot be obtained.
    Raises httpx.HTTPStatusError on unexpected Keycloak API errors.
    """
    if temp_password is None:
        temp_password = generate_temp_password()

    name_parts = full_name.strip().split(" ", 1)
    first_name = name_parts[0]
    last_name  = name_parts[1] if len(name_parts) > 1 else ""

    token = await _get_admin_token()

    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            f"{_ADMIN_BASE}/users",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "username":      email,
                "email":         email,
                "firstName":     first_name,
                "lastName":      last_name,
                "enabled":       True,
                "emailVerified": True,
                "credentials": [
                    {
                        "type":      "password",
                        "value":     temp_password,
                        "temporary": True,
                    }
                ],
            },
        )

        if res.status_code == 409:
            # User already exists — look up their ID and continue
            logger.info("Keycloak user '%s' already exists — reusing existing account", email)
            user_id = await get_keycloak_user_id_by_email(email)
            if not user_id:
                raise RuntimeError(f"Keycloak reported 409 for '{email}' but user not found by email")
        elif res.status_code == 201:
            # Location: .../admin/realms/{realm}/users/{uuid}
            location = res.headers.get("Location", "")
            user_id  = location.rstrip("/").split("/")[-1]
        else:
            res.raise_for_status()
            raise RuntimeError("Unexpected Keycloak response")

        # Assign realm role
        await _swap_realm_role(user_id, role, token, client)

    logger.info("Keycloak user created: id=%s email=%s role=%s", user_id, email, role)
    return user_id, temp_password


async def get_keycloak_user_id_by_email(email: str) -> Optional[str]:
    """
    Look up a Keycloak user by email address (exact match).
    Returns the Keycloak UUID or None if not found.
    """
    token = await _get_admin_token()
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{_ADMIN_BASE}/users",
            headers={"Authorization": f"Bearer {token}"},
            params={"email": email, "exact": "true"},
        )
        res.raise_for_status()
        users = res.json()
        return users[0]["id"] if users else None


async def update_keycloak_user_role(user_id: str, new_role: str) -> None:
    """
    Replace the user's current app realm role with new_role.
    Call this whenever profiles.role is changed in the admin UI.
    """
    token = await _get_admin_token()
    async with httpx.AsyncClient(timeout=10) as client:
        await _swap_realm_role(user_id, new_role, token, client)
    logger.info("Keycloak role updated: user_id=%s new_role=%s", user_id, new_role)


async def disable_keycloak_user(user_id: str) -> None:
    """
    Disable a Keycloak user so they cannot log in.
    Call this on soft-delete and on is_active=False updates.
    Their data is preserved; re-enable with enable_keycloak_user().
    """
    token = await _get_admin_token()
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.put(
            f"{_ADMIN_BASE}/users/{user_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"enabled": False},
        )
        res.raise_for_status()
    logger.info("Keycloak user disabled: user_id=%s", user_id)


async def enable_keycloak_user(user_id: str) -> None:
    """
    Re-enable a previously disabled Keycloak user.
    Call this when is_active is set back to True.
    """
    token = await _get_admin_token()
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.put(
            f"{_ADMIN_BASE}/users/{user_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"enabled": True},
        )
        res.raise_for_status()
    logger.info("Keycloak user enabled: user_id=%s", user_id)


async def reset_keycloak_user_password(user_id: str, new_password: str, temporary: bool = True) -> None:
    """
    Set a new password for an existing Keycloak user.
    If temporary=True the user must change it on next login.
    """
    token = await _get_admin_token()
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.put(
            f"{_ADMIN_BASE}/users/{user_id}/reset-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"type": "password", "value": new_password, "temporary": temporary},
        )
        res.raise_for_status()
    logger.info("Keycloak password reset: user_id=%s temporary=%s", user_id, temporary)
