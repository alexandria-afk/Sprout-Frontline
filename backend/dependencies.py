import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from config import settings

security = HTTPBearer()

# Cached JWKS client — fetches EC public key from Supabase once and reuses it
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(
            f"{settings.supabase_url}/auth/v1/.well-known/jwks.json",
            cache_keys=True,
        )
    return _jwks_client


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """Validates Supabase-issued Bearer JWT and returns the decoded payload.

    If the JWT's app_metadata is missing organisation_id or role (this can happen
    when an invite token is used before the first token refresh, since metadata is
    set after the invite email is sent), the profile row is fetched from the DB to
    fill in the missing fields so every downstream handler always has them.
    """
    token = credentials.credentials

    try:
        header = jwt.get_unverified_header(token)
    except jwt.DecodeError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

    alg = header.get("alg", "HS256")

    try:
        if alg == "HS256":
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
        else:
            signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                audience="authenticated",
            )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

    # Enrich from DB profile if app_metadata is incomplete (invite token timing issue)
    app_meta = payload.get("app_metadata") or {}
    if not app_meta.get("organisation_id") or not app_meta.get("role"):
        user_id = payload.get("sub")
        if user_id:
            try:
                from services.supabase_client import get_supabase
                sb = get_supabase()
                profile = (
                    sb.table("profiles")
                    .select("organisation_id, role")
                    .eq("id", user_id)
                    .eq("is_deleted", False)
                    .maybe_single()
                    .execute()
                )
                if profile.data:
                    app_meta = {
                        **app_meta,
                        "organisation_id": str(profile.data["organisation_id"]),
                        "role": profile.data["role"],
                    }
                    payload = {**payload, "app_metadata": app_meta}
            except Exception:
                pass  # If DB lookup fails, proceed with whatever is in the token

    return payload


async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Raises 403 unless caller has admin or super_admin role."""
    role = (current_user.get("app_metadata") or {}).get("role", "")
    if role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


async def require_manager_or_above(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Raises 403 unless caller is manager, admin, or super_admin."""
    role = (current_user.get("app_metadata") or {}).get("role", "")
    if role not in ("manager", "admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Manager access required")
    return current_user


def paginate(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=500, description="Results per page"),
) -> dict:
    return {"page": page, "page_size": page_size, "offset": (page - 1) * page_size}
