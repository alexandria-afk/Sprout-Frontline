from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from services.supabase_client import get_supabase


class IncidentService:

    @staticmethod
    async def list_incidents(
        org_id: str,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        limit: int = 100,
        team_user_ids: Optional[list] = None,
    ) -> list[dict]:
        db = get_supabase()
        query = (
            db.table("incidents")
            .select("*, profiles!reported_by(full_name)")
            .eq("org_id", org_id)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if status:
            query = query.eq("status", status)
        if severity:
            query = query.eq("severity", severity)
        if team_user_ids:
            # Filter to incidents reported by team members
            query = query.in_("reported_by", team_user_ids)
        resp = query.execute()
        return resp.data or []

    @staticmethod
    async def get_incident(incident_id: str, org_id: str) -> dict:
        db = get_supabase()
        resp = (
            db.table("incidents")
            .select(
                "*, profiles!reported_by(full_name), "
                "incident_attachments!left(id, file_url, file_type, uploaded_by, created_at, is_deleted), "
                "incident_status_history!left(id, previous_status, new_status, note, changed_by, changed_at, profiles!changed_by(full_name))"
            )
            .eq("id", incident_id)
            .eq("org_id", org_id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Incident not found")
        incident = resp.data[0]
        incident["incident_attachments"] = [
            a for a in (incident.get("incident_attachments") or []) if not a.get("is_deleted")
        ]
        return incident

    @staticmethod
    async def create_incident(org_id: str, user_id: str, body) -> dict:
        db = get_supabase()
        data: dict = {
            "org_id": org_id,
            "reported_by": user_id,
            "title": body.title,
            "incident_date": body.incident_date,
            "severity": body.severity,
            "status": "reported",
        }
        if body.description is not None:
            data["description"] = body.description
        if body.location_description is not None:
            data["location_description"] = body.location_description
        if getattr(body, "location_id", None) is not None:
            data["location_id"] = body.location_id
        if body.people_involved is not None:
            data["people_involved"] = body.people_involved
        if body.regulatory_body is not None:
            data["regulatory_body"] = body.regulatory_body

        resp = db.table("incidents").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to create incident")
        return resp.data[0]

    @staticmethod
    async def update_incident_status(
        incident_id: str,
        org_id: str,
        user_id: str,
        new_status: str,
        note: Optional[str] = None,
    ) -> dict:
        db = get_supabase()
        # Fetch current status
        current_resp = (
            db.table("incidents")
            .select("id, status")
            .eq("id", incident_id)
            .eq("org_id", org_id)
            .execute()
        )
        if not current_resp.data:
            raise HTTPException(status_code=404, detail="Incident not found")

        previous_status = current_resp.data[0]["status"]

        resp = (
            db.table("incidents")
            .update({
                "status": new_status,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", incident_id)
            .eq("org_id", org_id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Incident not found")

        # Record status history
        history: dict = {
            "incident_id": incident_id,
            "changed_by": user_id,
            "previous_status": previous_status,
            "new_status": new_status,
        }
        if note:
            history["note"] = note
        db.table("incident_status_history").insert(history).execute()

        return resp.data[0]

    @staticmethod
    async def add_attachment(
        incident_id: str,
        org_id: str,
        user_id: str,
        file_url: str,
        file_type: str,
    ) -> dict:
        db = get_supabase()
        # Verify incident belongs to org
        check = (
            db.table("incidents")
            .select("id")
            .eq("id", incident_id)
            .eq("org_id", org_id)
            .execute()
        )
        if not check.data:
            raise HTTPException(status_code=404, detail="Incident not found")

        resp = db.table("incident_attachments").insert({
            "incident_id": incident_id,
            "uploaded_by": user_id,
            "file_url": file_url,
            "file_type": file_type,
        }).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to add attachment")
        return resp.data[0]

    @staticmethod
    async def update_incident(incident_id: str, org_id: str, body) -> dict:
        db = get_supabase()
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        resp = (
            db.table("incidents")
            .update(updates)
            .eq("id", incident_id)
            .eq("org_id", org_id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Incident not found")
        return resp.data[0]
