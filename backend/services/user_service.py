import csv
import io
import uuid
from uuid import UUID
from fastapi import HTTPException
from collections import Counter
from models.users import CreateUserRequest, UpdateUserRequest, ProfileResponse, PositionSuggestion
from models.base import PaginatedResponse
from services.db import row, rows, execute, execute_returning


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

        # TODO: create user in Keycloak admin API
        # Previously: supabase.auth.admin.invite_user_by_email(body.email, ...)
        # Previously: supabase.auth.admin.update_user_by_id(user_id, {"app_metadata": {...}})
        # Generate a profile ID; the real Keycloak user ID should be used here once
        # the Keycloak invite flow is implemented.
        user_id = str(uuid.uuid4())

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

        if body.role is not None:
            # TODO: update role in Keycloak admin API
            # Previously: supabase.auth.admin.update_user_by_id(user_id, {"app_metadata": {"role": body.role, ...}})
            pass

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

        # TODO: disable/ban user in Keycloak admin API
        # Previously: supabase.auth.admin.update_user_by_id(user_id, {"ban_duration": "876600h"})

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
