import json
from fastapi import HTTPException
from psycopg2.extensions import connection as PgConn
from models.organisations import (
    OrganisationResponse,
    UpdateOrganisationRequest,
    LocationResponse,
    CreateLocationRequest,
    UpdateLocationRequest,
)
from services.db import row, rows, execute_returning


class OrgService:
    @staticmethod
    async def get_org(org_id: str, conn: PgConn) -> OrganisationResponse:
        try:
            result = row(
                conn,
                "SELECT * FROM organisations WHERE id = %s",
                (org_id,),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if result is None:
            raise HTTPException(status_code=404, detail="Organisation not found")

        return OrganisationResponse(**result)

    @staticmethod
    async def update_org(
        org_id: str, body: UpdateOrganisationRequest, conn: PgConn
    ) -> OrganisationResponse:
        updates = {}
        if body.name is not None:
            updates["name"] = body.name
        if body.logo_url is not None:
            updates["logo_url"] = body.logo_url

        if not updates:
            return await OrgService.get_org(org_id, conn)

        set_clause = ", ".join(f"{col} = %s" for col in updates)
        params = tuple(updates.values()) + (org_id,)

        try:
            result = execute_returning(
                conn,
                f"UPDATE organisations SET {set_clause} WHERE id = %s RETURNING *",
                params,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        if result is None:
            raise HTTPException(status_code=404, detail="Organisation not found")

        return OrganisationResponse(**result)

    @staticmethod
    async def update_feature_flags(
        org_id: str, feature_flags: dict, conn: PgConn
    ) -> OrganisationResponse:
        try:
            result = execute_returning(
                conn,
                "UPDATE organisations SET feature_flags = %s WHERE id = %s RETURNING *",
                (json.dumps(feature_flags), org_id),
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        if result is None:
            raise HTTPException(status_code=404, detail="Organisation not found")

        return OrganisationResponse(**result)

    @staticmethod
    async def list_locations(org_id: str, conn: PgConn) -> list[LocationResponse]:
        try:
            result = rows(
                conn,
                "SELECT * FROM locations WHERE organisation_id = %s AND is_deleted = false",
                (org_id,),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        return [LocationResponse(**r) for r in result]

    @staticmethod
    async def create_location(
        org_id: str, body: CreateLocationRequest, conn: PgConn
    ) -> LocationResponse:
        columns = ["organisation_id", "name", "geo_fence_radius_meters", "is_active", "is_deleted"]
        values: list = [org_id, body.name, body.geo_fence_radius_meters, True, False]

        if body.address is not None:
            columns.append("address")
            values.append(body.address)
        if body.latitude is not None:
            columns.append("latitude")
            values.append(body.latitude)
        if body.longitude is not None:
            columns.append("longitude")
            values.append(body.longitude)

        col_clause = ", ".join(columns)
        placeholder_clause = ", ".join(["%s"] * len(columns))

        try:
            result = execute_returning(
                conn,
                f"INSERT INTO locations ({col_clause}) VALUES ({placeholder_clause}) RETURNING *",
                tuple(values),
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        # Auto-create a team chat room for this location
        try:
            execute_returning(
                conn,
                """
                INSERT INTO location_chats (organisation_id, location_id)
                VALUES (%s, %s)
                ON CONFLICT (location_id) DO NOTHING
                """,
                (org_id, result["id"]),
            )
        except Exception:
            pass  # Non-fatal — chat can be backfilled via migration

        return LocationResponse(**result)

    @staticmethod
    async def update_location(
        org_id: str, loc_id: str, body: UpdateLocationRequest, conn: PgConn
    ) -> LocationResponse:
        updates = {}
        if body.name is not None:
            updates["name"] = body.name
        if body.address is not None:
            updates["address"] = body.address
        if body.latitude is not None:
            updates["latitude"] = body.latitude
        if body.longitude is not None:
            updates["longitude"] = body.longitude
        if body.geo_fence_radius_meters is not None:
            updates["geo_fence_radius_meters"] = body.geo_fence_radius_meters
        if body.is_active is not None:
            updates["is_active"] = body.is_active

        if not updates:
            result = row(
                conn,
                "SELECT * FROM locations WHERE id = %s AND organisation_id = %s",
                (loc_id, org_id),
            )
            if result is None:
                raise HTTPException(status_code=404, detail="Location not found")
            return LocationResponse(**result)

        set_clause = ", ".join(f"{col} = %s" for col in updates)
        params = tuple(updates.values()) + (loc_id, org_id)

        try:
            result = execute_returning(
                conn,
                f"UPDATE locations SET {set_clause} WHERE id = %s AND organisation_id = %s RETURNING *",
                params,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        if result is None:
            raise HTTPException(status_code=404, detail="Location not found")

        return LocationResponse(**result)
