import jwt
import psycopg2
import psycopg2.extras
from jwt import PyJWKClient
from datetime import timedelta
from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from config import settings

security = HTTPBearer()

# ── Keycloak JWKS client (cached) ─────────────────────────────────────────────
# Fetches public keys from Keycloak once; reuses on subsequent requests.
# JWKS URL: {keycloak_url}/realms/{keycloak_realm}/protocol/openid-connect/certs
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(
            f"{settings.keycloak_url}/realms/{settings.keycloak_realm}"
            "/protocol/openid-connect/certs",
            cache_keys=True,
        )
    return _jwks_client


# ── Database connection (per-request) ─────────────────────────────────────────
def get_db():
    """Yields a psycopg2 connection for the duration of the request."""
    conn = psycopg2.connect(settings.database_url)
    try:
        yield conn
    finally:
        conn.close()


# ── Auth ───────────────────────────────────────────────────────────────────────
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """Validates a Keycloak-issued Bearer JWT and returns a normalised payload.

    The returned dict always contains an ``app_metadata`` sub-dict with:
      - ``role``            — Keycloak realm role (string, e.g. "admin")
      - ``organisation_id`` — from the profiles table
      - ``location_id``     — from the profiles table (may be None)
      - ``language``        — from the profiles table (default "en")

    This mirrors the shape previously returned by Supabase so that all route
    handlers that call ``current_user.get("app_metadata", {}).get("role")``
    continue to work unchanged.
    """
    token = credentials.credentials

    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

    user_id = payload.get("sub")

    # Keycloak puts roles in the "role" claim (array) per the realm mapper.
    # Extract the first role as the effective role string.
    raw_role = payload.get("role", [])
    if isinstance(raw_role, list):
        role = raw_role[0] if raw_role else None
    else:
        role = raw_role  # scalar fallback

    # Enrich with org / location / language from the profiles table.
    # Uses a direct psycopg2 connection (no Supabase client dependency here).
    app_meta: dict = {"role": role}
    if user_id:
        try:
            conn = psycopg2.connect(settings.database_url)
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT organisation_id, role, location_id, language
                    FROM profiles
                    WHERE id = %s AND is_deleted = false
                    LIMIT 1
                    """,
                    (user_id,),
                )
                row = cur.fetchone()
            conn.close()
            if row:
                app_meta = {
                    "role": row["role"] or role,
                    "organisation_id": str(row["organisation_id"]) if row["organisation_id"] else None,
                    "location_id": row.get("location_id"),
                    "language": row.get("language") or "en",
                }
        except Exception:
            pass  # Fall back to JWT claims if DB lookup fails

    return {**payload, "app_metadata": app_meta}


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
