from fastapi import HTTPException
from models.organisations import (
    OrganisationResponse,
    UpdateOrganisationRequest,
    UpdateFeatureFlagsRequest,
    LocationResponse,
    CreateLocationRequest,
    UpdateLocationRequest,
)
from services.supabase_client import get_supabase


class OrgService:
    @staticmethod
    async def get_org(org_id: str) -> OrganisationResponse:
        supabase = get_supabase()
        try:
            response = (
                supabase.table("organisations")
                .select("*")
                .eq("id", str(org_id))
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not response.data:
            raise HTTPException(status_code=404, detail="Organisation not found")

        return OrganisationResponse(**response.data[0])

    @staticmethod
    async def update_org(org_id: str, body: UpdateOrganisationRequest) -> OrganisationResponse:
        supabase = get_supabase()

        updates = {}
        if body.name is not None:
            updates["name"] = body.name
        if body.logo_url is not None:
            updates["logo_url"] = body.logo_url

        if not updates:
            return await OrgService.get_org(org_id)

        try:
            response = (
                supabase.table("organisations")
                .update(updates)
                .eq("id", str(org_id))
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        if not response.data:
            raise HTTPException(status_code=404, detail="Organisation not found")

        return OrganisationResponse(**response.data[0])

    @staticmethod
    async def update_feature_flags(org_id: str, feature_flags: dict) -> OrganisationResponse:
        supabase = get_supabase()
        try:
            response = (
                supabase.table("organisations")
                .update({"feature_flags": feature_flags})
                .eq("id", str(org_id))
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        if not response.data:
            raise HTTPException(status_code=404, detail="Organisation not found")

        return OrganisationResponse(**response.data[0])

    @staticmethod
    async def list_locations(org_id: str) -> list[LocationResponse]:
        supabase = get_supabase()
        try:
            response = (
                supabase.table("locations")
                .select("*")
                .eq("organisation_id", str(org_id))
                .eq("is_deleted", False)
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        return [LocationResponse(**row) for row in response.data]

    @staticmethod
    async def create_location(org_id: str, body: CreateLocationRequest) -> LocationResponse:
        supabase = get_supabase()

        location_data = {
            "organisation_id": str(org_id),
            "name": body.name,
            "geo_fence_radius_meters": body.geo_fence_radius_meters,
            "is_active": True,
            "is_deleted": False,
        }
        if body.address is not None:
            location_data["address"] = body.address
        if body.latitude is not None:
            location_data["latitude"] = body.latitude
        if body.longitude is not None:
            location_data["longitude"] = body.longitude

        try:
            response = supabase.table("locations").insert(location_data).execute()
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        return LocationResponse(**response.data[0])

    @staticmethod
    async def update_location(
        org_id: str, loc_id: str, body: UpdateLocationRequest
    ) -> LocationResponse:
        supabase = get_supabase()

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
            existing = (
                supabase.table("locations")
                .select("*")
                .eq("id", str(loc_id))
                .eq("organisation_id", str(org_id))
                .execute()
            )
            if not existing.data:
                raise HTTPException(status_code=404, detail="Location not found")
            return LocationResponse(**existing.data[0])

        try:
            response = (
                supabase.table("locations")
                .update(updates)
                .eq("id", str(loc_id))
                .eq("organisation_id", str(org_id))
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        if not response.data:
            raise HTTPException(status_code=404, detail="Location not found")

        return LocationResponse(**response.data[0])
