from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from services.db import row, rows, execute, execute_returning


class IncidentService:

    @staticmethod
    async def list_incidents(
        conn,
        org_id: str,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        limit: int = 100,
        team_user_ids: Optional[list] = None,
    ) -> list[dict]:
        conditions = ["i.org_id = %s", "i.is_deleted = FALSE"]
        params: list = [org_id]

        if status:
            conditions.append("i.status = %s")
            params.append(status)
        if severity:
            conditions.append("i.severity = %s")
            params.append(severity)
        if team_user_ids:
            placeholders = ", ".join(["%s"] * len(team_user_ids))
            conditions.append(f"i.reported_by IN ({placeholders})")
            params.extend(team_user_ids)

        where = " AND ".join(conditions)
        params.append(limit)

        sql = f"""
            SELECT
                i.*,
                json_build_object('full_name', p.full_name) AS profiles
            FROM incidents i
            LEFT JOIN profiles p ON p.id = i.reported_by
            WHERE {where}
            ORDER BY i.created_at DESC
            LIMIT %s
        """
        return rows(conn, sql, tuple(params))

    @staticmethod
    async def get_incident(conn, incident_id: str, org_id: str) -> dict:
        sql = """
            SELECT
                i.*,
                json_build_object('full_name', p.full_name) AS profiles
            FROM incidents i
            LEFT JOIN profiles p ON p.id = i.reported_by
            WHERE i.id = %s AND i.org_id = %s
        """
        incident = row(conn, sql, (incident_id, org_id))
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")

        incident = dict(incident)

        # Attachments
        att_sql = """
            SELECT id, file_url, file_type, uploaded_by, created_at, is_deleted
            FROM incident_attachments
            WHERE incident_id = %s AND is_deleted = FALSE
        """
        incident["incident_attachments"] = rows(conn, att_sql, (incident_id,))

        # Status history with changer name
        hist_sql = """
            SELECT
                h.id, h.previous_status, h.new_status, h.note,
                h.changed_by, h.changed_at,
                json_build_object('full_name', p.full_name) AS profiles
            FROM incident_status_history h
            LEFT JOIN profiles p ON p.id = h.changed_by
            WHERE h.incident_id = %s
            ORDER BY h.changed_at
        """
        incident["incident_status_history"] = rows(conn, hist_sql, (incident_id,))

        return incident

    @staticmethod
    async def create_incident(conn, org_id: str, user_id: str, body) -> dict:
        fields = ["org_id", "reported_by", "title", "incident_date", "severity", "status"]
        values: list = [org_id, user_id, body.title, body.incident_date, body.severity, "reported"]

        optional_fields = [
            "description", "location_description", "location_id",
            "people_involved", "regulatory_body",
        ]
        for f in optional_fields:
            val = getattr(body, f, None)
            if val is not None:
                fields.append(f)
                values.append(val)

        col_list = ", ".join(fields)
        placeholder_list = ", ".join(["%s"] * len(fields))
        sql = f"""
            INSERT INTO incidents ({col_list})
            VALUES ({placeholder_list})
            RETURNING *
        """
        result = execute_returning(conn, sql, tuple(values))
        if not result:
            raise HTTPException(status_code=500, detail="Failed to create incident")
        return dict(result)

    @staticmethod
    async def update_incident(conn, incident_id: str, org_id: str, body) -> dict:
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()

        set_clause = ", ".join(f"{k} = %s" for k in updates)
        params = list(updates.values()) + [incident_id, org_id]
        sql = f"""
            UPDATE incidents
            SET {set_clause}
            WHERE id = %s AND org_id = %s
            RETURNING *
        """
        result = execute_returning(conn, sql, tuple(params))
        if not result:
            raise HTTPException(status_code=404, detail="Incident not found")
        return dict(result)

    @staticmethod
    async def update_incident_status(
        conn,
        incident_id: str,
        org_id: str,
        user_id: str,
        new_status: str,
        note: Optional[str] = None,
    ) -> dict:
        current = row(
            conn,
            "SELECT id, status FROM incidents WHERE id = %s AND org_id = %s",
            (incident_id, org_id),
        )
        if not current:
            raise HTTPException(status_code=404, detail="Incident not found")

        previous_status = current["status"]

        result = execute_returning(
            conn,
            """
            UPDATE incidents
            SET status = %s, updated_at = %s
            WHERE id = %s AND org_id = %s
            RETURNING *
            """,
            (new_status, datetime.now(timezone.utc).isoformat(), incident_id, org_id),
        )
        if not result:
            raise HTTPException(status_code=404, detail="Incident not found")

        # Record status history
        hist_fields = ["incident_id", "changed_by", "previous_status", "new_status"]
        hist_values: list = [incident_id, user_id, previous_status, new_status]
        if note:
            hist_fields.append("note")
            hist_values.append(note)

        col_list = ", ".join(hist_fields)
        placeholder_list = ", ".join(["%s"] * len(hist_fields))
        execute(
            conn,
            f"INSERT INTO incident_status_history ({col_list}) VALUES ({placeholder_list})",
            tuple(hist_values),
        )

        return dict(result)

    @staticmethod
    async def add_attachment(
        conn,
        incident_id: str,
        org_id: str,
        user_id: str,
        file_url: str,
        file_type: str,
    ) -> dict:
        check = row(
            conn,
            "SELECT id FROM incidents WHERE id = %s AND org_id = %s",
            (incident_id, org_id),
        )
        if not check:
            raise HTTPException(status_code=404, detail="Incident not found")

        result = execute_returning(
            conn,
            """
            INSERT INTO incident_attachments (incident_id, uploaded_by, file_url, file_type)
            VALUES (%s, %s, %s, %s)
            RETURNING *
            """,
            (incident_id, user_id, file_url, file_type),
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to add attachment")
        return dict(result)
