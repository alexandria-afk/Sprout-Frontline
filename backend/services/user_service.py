import csv
import io
import logging
import uuid
from uuid import UUID
from fastapi import HTTPException
from collections import Counter
from models.users import CreateUserRequest, UpdateUserRequest, ProfileResponse, PositionSuggestion
from models.base import PaginatedResponse
from services.db import row, rows, execute, execute_returning
from services.keycloak_admin import (
    create_keycloak_user,
    update_keycloak_user_role,
    disable_keycloak_user,
    enable_keycloak_user,
)

logger = logging.getLogger(__name__)


class UserService:
    @staticmethod
    async def list_users(
        conn,
        org_id: str,
        location_id: str | None = None,
        role: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> PaginatedResponse[ProfileResponse]:
        offset = (page - 1) * page_size

        # Build dynamic WHERE clauses
        conditions = [
            "p.organisation_id = %s",
            "p.is_deleted = false",
        ]
        params: list = [str(org_id)]

        if location_id:
            conditions.append("p.location_id = %s")
            params.append(str(location_id))
        if role:
            conditions.append("p.role = %s")
            params.append(role)
        if search:
            conditions.append("p.full_name ILIKE %s")
            params.append(f"%{search}%")

        where = " AND ".join(conditions)

        # Total count
        count_sql = f"SELECT COUNT(*) AS cnt FROM profiles p WHERE {where}"
        count_row = row(conn, count_sql, tuple(params))
        total_count = count_row["cnt"] if count_row else 0

        # Paginated data with reports_to join
        data_sql = f"""
            SELECT
                p.*,
                json_build_object('id', rp.id, 'full_name', rp.full_name)
                    AS reports_to_profile
            FROM profiles p
            LEFT JOIN profiles rp ON rp.id = p.reports_to AND rp.is_deleted = false
            WHERE {where}
            ORDER BY p.full_name ASC
            LIMIT %s OFFSET %s
        """
        params_data = tuple(params) + (page_size, offset)
        result_rows = rows(conn, data_sql, params_data)

        items = [ProfileResponse(**r) for r in result_rows]

        return PaginatedResponse(
            items=items,
            total_count=total_count,
            page=page,
            page_size=page_size,
        )

    @staticmethod
    async def create_user(conn, body: CreateUserRequest, org_id: str) -> ProfileResponse:
        # Check if a non-deleted profile with this email already exists in the org
        existing_profile = row(
            conn,
            """
            SELECT id FROM profiles
            WHERE organisation_id = %s AND email = %s AND is_deleted = false
            LIMIT 1
            """,
            (str(org_id), body.email),
        )
        if existing_profile:
            raise HTTPException(
                status_code=409,
                detail=f"A user with email {body.email} already exists. Re-send the invite from the user list instead.",
            )

        # Create the user in Keycloak first so we get their real UUID.
        # That UUID becomes profiles.id — this is what makes JWT sub → profile lookup work.
        try:
            user_id, temp_password = await create_keycloak_user(
                email=body.email,
                full_name=body.full_name,
                role=body.role,
            )
            logger.info(
                "Keycloak user created for %s (id=%s). Temp password logged below — "
                "wire Resend to deliver this via email instead.",
                body.email, user_id,
            )
            # TODO: send temp_password to body.email via Resend before shipping to prod
            logger.info("TEMP PASSWORD for %s: %s", body.email, temp_password)
        except Exception as kc_err:
            logger.error("Keycloak user creation failed for %s: %s", body.email, kc_err)
            raise HTTPException(
                status_code=502,
                detail=f"Could not create Keycloak account: {kc_err}",
            )

        # Build INSERT parameters
        columns = ["id", "organisation_id", "full_name", "role", "email", "language", "is_active", "is_deleted"]
        values: list = [user_id, str(org_id), body.full_name, body.role, body.email, "en", True, False]

        if body.location_id:
            columns.append("location_id")
            values.append(str(body.location_id))
        if body.phone_number:
            columns.append("phone_number")
            values.append(body.phone_number)
        if body.reports_to:
            columns.append("reports_to")
            values.append(str(body.reports_to))
        if body.position:
            columns.append("position")
            values.append(body.position)

        col_str = ", ".join(columns)
        placeholder_str = ", ".join(["%s"] * len(values))

        profile_row = execute_returning(
            conn,
            f"""
            INSERT INTO profiles ({col_str})
            VALUES ({placeholder_str})
            RETURNING *
            """,
            tuple(values),
        )
        if not profile_row:
            raise HTTPException(status_code=400, detail="Profile creation failed")

        return ProfileResponse(**profile_row)

    @staticmethod
    async def get_user(conn, user_id: str, org_id: str) -> ProfileResponse:
        result = row(
            conn,
            """
            SELECT * FROM profiles
            WHERE id = %s AND organisation_id = %s AND is_deleted = false
            LIMIT 1
            """,
            (str(user_id), str(org_id)),
        )
        if not result:
            raise HTTPException(status_code=404, detail="User not found")

        return ProfileResponse(**result)

    @staticmethod
    async def update_user(
        conn, user_id: str, body: UpdateUserRequest, org_id: str
    ) -> ProfileResponse:
        # Verify user exists in org
        existing = row(
            conn,
            """
            SELECT * FROM profiles
            WHERE id = %s AND organisation_id = %s AND is_deleted = false
            LIMIT 1
            """,
            (str(user_id), str(org_id)),
        )
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")

        updates: dict = {}
        if body.full_name is not None:
            updates["full_name"] = body.full_name
        if body.role is not None:
            updates["role"] = body.role
        if body.location_id is not None:
            updates["location_id"] = str(body.location_id)
        if body.phone_number is not None:
            updates["phone_number"] = body.phone_number
        if body.is_active is not None:
            updates["is_active"] = body.is_active
        if body.language is not None:
            updates["language"] = body.language
        if body.reports_to is not None:
            updates["reports_to"] = str(body.reports_to)
        if body.position is not None:
            updates["position"] = body.position if body.position else None

        if not updates:
            return ProfileResponse(**existing)

        set_clause = ", ".join(f"{col} = %s" for col in updates.keys())
        params = tuple(updates.values()) + (str(user_id),)

        updated_row = execute_returning(
            conn,
            f"""
            UPDATE profiles
            SET {set_clause}
            WHERE id = %s
            RETURNING *
            """,
            params,
        )
        if not updated_row:
            raise HTTPException(status_code=400, detail="Update failed")

        # Sync role change to Keycloak so JWT claims stay accurate
        if body.role is not None:
            try:
                await update_keycloak_user_role(str(user_id), body.role)
            except Exception as kc_err:
                # Log but don't roll back the DB update — an admin can retry
                logger.error(
                    "Keycloak role sync failed for user %s (new role=%s): %s",
                    user_id, body.role, kc_err,
                )

        # Sync is_active to Keycloak so deactivated users cannot log in
        if body.is_active is not None:
            try:
                if body.is_active:
                    await enable_keycloak_user(str(user_id))
                else:
                    await disable_keycloak_user(str(user_id))
            except Exception as kc_err:
                logger.error(
                    "Keycloak enable/disable failed for user %s (is_active=%s): %s",
                    user_id, body.is_active, kc_err,
                )

        return ProfileResponse(**updated_row)

    @staticmethod
    async def delete_user(conn, user_id: str, org_id: str) -> dict:
        existing = row(
            conn,
            """
            SELECT id FROM profiles
            WHERE id = %s AND organisation_id = %s AND is_deleted = false
            LIMIT 1
            """,
            (str(user_id), str(org_id)),
        )
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")

        affected = execute(
            conn,
            "UPDATE profiles SET is_deleted = true WHERE id = %s",
            (str(user_id),),
        )
        if not affected:
            raise HTTPException(status_code=400, detail="Delete failed")

        # Disable in Keycloak so the user's existing sessions can no longer refresh
        # and new logins are rejected. We do a soft delete in DB so data is preserved.
        try:
            await disable_keycloak_user(str(user_id))
        except Exception as kc_err:
            # Log but don't fail — the DB soft-delete succeeded; Keycloak can be
            # cleaned up manually if needed.
            logger.error("Keycloak disable failed for deleted user %s: %s", user_id, kc_err)

        return {"success": True, "message": "User deleted"}

    @staticmethod
    async def bulk_import(conn, csv_content: str, org_id: str) -> dict:
        reader = csv.DictReader(io.StringIO(csv_content))
        successes = []
        failures = []

        for row_num, csv_row in enumerate(reader, start=1):
            email = csv_row.get("email", "").strip()
            try:
                body = CreateUserRequest(
                    email=email,
                    full_name=csv_row.get("full_name", "").strip(),
                    role=csv_row.get("role", "staff").strip() or "staff",
                    location_id=csv_row.get("location_id", "").strip() or None,
                    phone_number=csv_row.get("phone_number", "").strip() or None,
                    position=csv_row.get("position", "").strip() or None,
                )
                profile = await UserService.create_user(conn, body, org_id)
                successes.append({"row": row_num, "email": email, "user_id": str(profile.id)})
            except Exception as e:
                err_str = str(e).lower()
                if "duplicate" in err_str or "already exists" in err_str or "unique" in err_str:
                    user_error = "Email already exists in the system"
                elif "violates" in err_str or "constraint" in err_str or "foreign key" in err_str:
                    user_error = "Invalid data — check role and location values"
                elif "invalid" in err_str and "role" in err_str:
                    user_error = "Invalid role — must be staff, manager, or admin"
                else:
                    user_error = "Failed to create user"
                failures.append({"row": row_num, "email": email, "error": user_error})

        return {"successes": successes, "failures": failures}

    @staticmethod
    async def get_me(conn, user_id: str) -> ProfileResponse:
        result = row(
            conn,
            """
            SELECT * FROM profiles
            WHERE id = %s AND is_deleted = false
            LIMIT 1
            """,
            (str(user_id),),
        )
        if not result:
            raise HTTPException(status_code=404, detail="Profile not found")

        return ProfileResponse(**result)

    @staticmethod
    async def get_distinct_positions(conn, org_id: str, search: str = "") -> list[PositionSuggestion]:
        result = rows(
            conn,
            """
            SELECT position
            FROM profiles
            WHERE organisation_id = %s
              AND is_deleted = false
              AND position IS NOT NULL
            """,
            (str(org_id),),
        )

        counts = Counter(r["position"] for r in result if r.get("position"))
        results = [PositionSuggestion(position=p, count=c) for p, c in counts.items()]
        if search:
            q = search.lower()
            results = [r for r in results if q in r.position.lower()]
        return sorted(results, key=lambda x: -x.count)
