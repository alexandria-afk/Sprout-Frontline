import jwt
import psycopg2
import psycopg2.extras
import time
from jwt import PyJWKClient
from datetime import timedelta
from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from config import settings
from services.db import get_db_conn

# Re-export get_db so route files can do: from dependencies import get_db
get_db = get_db_conn

# ── Profile cache ─────────────────────────────────────────────────────────────
# get_current_user is called on every request (including every 3-second poll).
# Caching the profile lookup by user_id for 60 seconds prevents psycopg2
# blocking calls from saturating the async event loop under polling load.
_profile_cache: dict[str, tuple[dict, float]] = {}
_PROFILE_TTL = 60  # seconds

def _get_cached_profile(user_id: str) -> dict | None:
    entry = _profile_cache.get(user_id)
    if entry and entry[1] > time.monotonic():
        return entry[0]
    return None

def _set_cached_profile(user_id: str, profile: dict) -> None:
    _profile_cache[user_id] = (profile, time.monotonic() + _PROFILE_TTL)

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
    except Exception as first_err:
        # If the key ID isn't in our cached JWKS (e.g. Keycloak restarted and
        # rotated keys), reset the singleton and retry once with fresh keys.
        from jwt.exceptions import PyJWKClientError
        if isinstance(first_err, PyJWKClientError):
            global _jwks_client
            _jwks_client = None
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
            except Exception as e:
                raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
        elif isinstance(first_err, jwt.ExpiredSignatureError):
            raise HTTPException(status_code=401, detail="Token has expired")
        else:
            raise HTTPException(status_code=401, detail=f"Invalid token: {first_err}")

    user_id = payload.get("sub")

    # Keycloak puts roles in the "role" claim (array) per the realm mapper.
    # Extract the first role as the effective role string.
    raw_role = payload.get("role", [])
    if isinstance(raw_role, list):
        role = raw_role[0] if raw_role else None
    else:
        role = raw_role  # scalar fallback

    # Enrich with org / location / language from the profiles table.
    # Cached for 60 s per user_id — avoids a blocking psycopg2 call on every
    # request (including every 3-second chat poll).
    app_meta: dict = {"role": role}
    email = payload.get("email") or payload.get("preferred_username")
    if user_id:
        cached = _get_cached_profile(user_id)
        if cached:
            app_meta = cached
        else:
            try:
                from services.db import _get_pool
                pool = _get_pool()
                conn = pool.getconn()
                try:
                    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                        # ── 1. Fast path: look up by Keycloak UUID ───────────
                        cur.execute(
                            """
                            SELECT id, organisation_id, role, location_id, language
                            FROM profiles
                            WHERE id = %s AND is_deleted = false
                            LIMIT 1
                            """,
                            (user_id,),
                        )
                        row = cur.fetchone()

                        # ── 2. Email fallback: link profile by email ─────────
                        if not row and email:
                            cur.execute(
                                """
                                SELECT id, organisation_id, role, location_id, language
                                FROM profiles
                                WHERE email = %s AND is_deleted = false
                                LIMIT 1
                                """,
                                (email,),
                            )
                            row = cur.fetchone()
                            if row:
                                old_id = row["id"]
                                try:
                                    cur.execute(
                                        "UPDATE profiles SET id = %s WHERE id = %s",
                                        (user_id, str(old_id)),
                                    )
                                    conn.commit()
                                except Exception:
                                    conn.rollback()

                    conn.commit()
                finally:
                    pool.putconn(conn)

                if row:
                    app_meta = {
                        "role": row["role"] or role,
                        "organisation_id": str(row["organisation_id"]) if row["organisation_id"] else None,
                        "location_id": row.get("location_id"),
                        "language": row.get("language") or "en",
                    }
                    _set_cached_profile(user_id, app_meta)
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
