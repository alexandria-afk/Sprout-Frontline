import csv
import io
from uuid import UUID
from fastapi import HTTPException
from collections import Counter
from models.users import CreateUserRequest, UpdateUserRequest, ProfileResponse, PositionSuggestion
from models.base import PaginatedResponse
from services.supabase_client import get_supabase
from config import settings


class UserService:
    @staticmethod
    async def list_users(
        org_id: str,
        location_id: str | None = None,
        role: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> PaginatedResponse[ProfileResponse]:
        supabase = get_supabase()
        offset = (page - 1) * page_size

        try:
            query = (
                supabase.table("profiles")
                .select("*, reports_to_profile:reports_to(id, full_name)", count="exact")
                .eq("organisation_id", str(org_id))
                .eq("is_deleted", False)
            )
            if location_id:
                query = query.eq("location_id", str(location_id))
            if role:
                query = query.eq("role", role)
            if search:
                query = query.ilike("full_name", f"%{search}%")

            response = query.range(offset, offset + page_size - 1).execute()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        items = [ProfileResponse(**row) for row in response.data]
        total_count = response.count if response.count is not None else len(items)

        return PaginatedResponse(
            items=items,
            total_count=total_count,
            page=page,
            page_size=page_size,
        )

    @staticmethod
    async def create_user(body: CreateUserRequest, org_id: str) -> ProfileResponse:
        supabase = get_supabase()
        # Check if a profile already exists for this email in this org
        existing = (
            supabase.table("profiles")
            .select("id")
            .eq("organisation_id", str(org_id))
            .eq("is_deleted", False)
            .execute()
        )
        # Also check auth users by email
        try:
            auth_list = supabase.auth.admin.list_users()
            existing_emails = {u.email for u in auth_list if u.email}
            if body.email in existing_emails:
                raise HTTPException(
                    status_code=409,
                    detail=f"A user with email {body.email} already exists. Re-send the invite from the user list instead.",
                )
        except HTTPException:
            raise
        except Exception:
            pass  # If list_users fails, proceed and let invite_user_by_email handle it

        try:
            auth_response = supabase.auth.admin.invite_user_by_email(
                body.email,
                options={
                    "data": {"full_name": body.full_name},
                    "redirect_to": f"{settings.frontend_url}/auth/callback",
                },
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invite failed: {e}")

        user_id = str(auth_response.user.id)

        try:
            supabase.auth.admin.update_user_by_id(
                user_id,
                {"app_metadata": {"organisation_id": str(org_id), "role": body.role}},
            )
        except Exception as e:
            supabase.auth.admin.delete_user(user_id)
            raise HTTPException(status_code=400, detail=f"Metadata update failed: {e}")

        profile_data = {
            "id": user_id,
            "organisation_id": str(org_id),
            "full_name": body.full_name,
            "role": body.role,
            "language": "en",
            "is_active": True,
            "is_deleted": False,
        }
        if body.location_id:
            profile_data["location_id"] = str(body.location_id)
        if body.phone_number:
            profile_data["phone_number"] = body.phone_number
        if body.reports_to:
            profile_data["reports_to"] = str(body.reports_to)
        if body.position:
            profile_data["position"] = body.position

        try:
            profile_response = supabase.table("profiles").insert(profile_data).execute()
        except Exception as e:
            supabase.auth.admin.delete_user(user_id)
            raise HTTPException(status_code=400, detail=f"Profile creation failed: {e}")

        return ProfileResponse(**profile_response.data[0])

    @staticmethod
    async def get_user(user_id: str, org_id: str) -> ProfileResponse:
        supabase = get_supabase()
        try:
            response = (
                supabase.table("profiles")
                .select("*")
                .eq("id", str(user_id))
                .eq("organisation_id", str(org_id))
                .eq("is_deleted", False)
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not response.data:
            raise HTTPException(status_code=404, detail="User not found")

        return ProfileResponse(**response.data[0])

    @staticmethod
    async def update_user(
        user_id: str, body: UpdateUserRequest, org_id: str
    ) -> ProfileResponse:
        supabase = get_supabase()

        # Verify user exists in org
        existing = (
            supabase.table("profiles")
            .select("*")
            .eq("id", str(user_id))
            .eq("organisation_id", str(org_id))
            .eq("is_deleted", False)
            .execute()
        )
        if not existing.data:
            raise HTTPException(status_code=404, detail="User not found")

        updates = {}
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
            return ProfileResponse(**existing.data[0])

        try:
            response = (
                supabase.table("profiles")
                .update(updates)
                .eq("id", str(user_id))
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        if body.role is not None:
            try:
                current_metadata = existing.data[0]
                supabase.auth.admin.update_user_by_id(
                    str(user_id),
                    {
                        "app_metadata": {
                            "organisation_id": str(org_id),
                            "role": body.role,
                        }
                    },
                )
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Metadata update failed: {e}")

        return ProfileResponse(**response.data[0])

    @staticmethod
    async def delete_user(user_id: str, org_id: str) -> dict:
        supabase = get_supabase()

        existing = (
            supabase.table("profiles")
            .select("id")
            .eq("id", str(user_id))
            .eq("organisation_id", str(org_id))
            .eq("is_deleted", False)
            .execute()
        )
        if not existing.data:
            raise HTTPException(status_code=404, detail="User not found")

        try:
            supabase.table("profiles").update({"is_deleted": True}).eq(
                "id", str(user_id)
            ).execute()
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        try:
            supabase.auth.admin.update_user_by_id(
                str(user_id), {"ban_duration": "876600h"}
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Auth ban failed: {e}")

        return {"success": True, "message": "User deleted"}

    @staticmethod
    async def bulk_import(csv_content: str, org_id: str) -> dict:
        reader = csv.DictReader(io.StringIO(csv_content))
        successes = []
        failures = []

        for row_num, row in enumerate(reader, start=1):
            email = row.get("email", "").strip()
            try:
                body = CreateUserRequest(
                    email=email,
                    full_name=row.get("full_name", "").strip(),
                    role=row.get("role", "staff").strip() or "staff",
                    location_id=row.get("location_id", "").strip() or None,
                    phone_number=row.get("phone_number", "").strip() or None,
                    position=row.get("position", "").strip() or None,
                )
                profile = await UserService.create_user(body, org_id)
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
    async def get_me(user_id: str) -> ProfileResponse:
        supabase = get_supabase()
        try:
            response = (
                supabase.table("profiles")
                .select("*")
                .eq("id", str(user_id))
                .eq("is_deleted", False)
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not response.data:
            raise HTTPException(status_code=404, detail="Profile not found")

        return ProfileResponse(**response.data[0])

    @staticmethod
    async def get_distinct_positions(org_id: str, search: str = "") -> list[PositionSuggestion]:
        supabase = get_supabase()
        try:
            resp = (
                supabase.table("profiles")
                .select("position")
                .eq("organisation_id", str(org_id))
                .eq("is_deleted", False)
                .not_.is_("position", "null")
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        counts = Counter(row["position"] for row in resp.data if row.get("position"))
        results = [PositionSuggestion(position=p, count=c) for p, c in counts.items()]
        if search:
            q = search.lower()
            results = [r for r in results if q in r.position.lower()]
        return sorted(results, key=lambda x: -x.count)


def _generate_temp_password() -> str:
    import secrets
    import string
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(16))
