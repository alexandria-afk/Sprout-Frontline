from __future__ import annotations

import json
import math
from datetime import datetime, date, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from models.shifts import (
    CreateShiftTemplateRequest,
    UpdateShiftTemplateRequest,
    BulkGenerateShiftsRequest,
    CreateShiftRequest,
    UpdateShiftRequest,
    PublishShiftsRequest,
    RespondToClaimRequest,
    CreateSwapRequest,
    RespondToSwapRequest,
    CreateLeaveRequest,
    RespondToLeaveRequest,
    SetAvailabilityRequest,
    ClockInRequest,
    ClockOutRequest,
    ManagerOverrideRequest,
    UpdateAttendanceRulesRequest,
    GenerateScheduleRequest,
    StartBreakRequest,
    EndBreakRequest,
)
from services.db import row, rows, execute, execute_returning, execute_many


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return distance in metres between two GPS coordinates."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class ShiftService:

    # ── Templates ──────────────────────────────────────────────────────────────

    @staticmethod
    async def list_templates(
        conn,
        org_id: str,
        location_id: Optional[str] = None,
        is_admin: bool = False,
    ) -> list[dict]:
        if is_admin:
            # Admin sees all templates (org-wide + all locations)
            result = rows(
                conn,
                """
                SELECT st.*, row_to_json(l.*) AS locations
                FROM shift_templates st
                LEFT JOIN locations l ON l.id = st.location_id
                WHERE st.organisation_id = %s
                ORDER BY st.created_at DESC
                """,
                (org_id,),
            )
        elif location_id:
            # Manager sees org-wide (null) + their location
            result = rows(
                conn,
                """
                SELECT st.*, row_to_json(l.*) AS locations
                FROM shift_templates st
                LEFT JOIN locations l ON l.id = st.location_id
                WHERE st.organisation_id = %s
                  AND (st.location_id IS NULL OR st.location_id = %s)
                ORDER BY st.created_at DESC
                """,
                (org_id, location_id),
            )
        else:
            result = rows(
                conn,
                """
                SELECT st.*, row_to_json(l.*) AS locations
                FROM shift_templates st
                LEFT JOIN locations l ON l.id = st.location_id
                WHERE st.organisation_id = %s
                ORDER BY st.created_at DESC
                """,
                (org_id,),
            )
        return [dict(r) for r in result]

    @staticmethod
    async def create_template(conn, body: CreateShiftTemplateRequest, org_id: str, user_id: str) -> dict:
        result = execute_returning(
            conn,
            """
            INSERT INTO shift_templates
                (organisation_id, location_id, name, role, start_time, end_time,
                 days_of_week, is_active, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                org_id,
                body.location_id,
                body.name,
                body.role,
                body.start_time,
                body.end_time,
                body.days_of_week,
                body.is_active,
                user_id,
            ),
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to create shift template")
        return dict(result)

    @staticmethod
    async def update_template(conn, template_id: str, org_id: str, body: UpdateShiftTemplateRequest) -> dict:
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        updates["updated_at"] = _now()

        set_clause = ", ".join(f"{k} = %s" for k in updates)
        values = list(updates.values()) + [template_id, org_id]

        result = execute_returning(
            conn,
            f"""
            UPDATE shift_templates
            SET {set_clause}
            WHERE id = %s AND organisation_id = %s
            RETURNING *
            """,
            tuple(values),
        )
        if not result:
            raise HTTPException(status_code=404, detail="Shift template not found")
        return dict(result)

    @staticmethod
    async def delete_template(conn, template_id: str, org_id: str) -> None:
        execute(
            conn,
            """
            UPDATE shift_templates
            SET is_deleted = TRUE
            WHERE id = %s AND organisation_id = %s
            """,
            (template_id, org_id),
        )

    @staticmethod
    async def bulk_generate(conn, body: BulkGenerateShiftsRequest, org_id: str, user_id: str) -> dict:
        """Generate draft shifts from a template for every matching day in the date range."""
        t = row(
            conn,
            "SELECT * FROM shift_templates WHERE id = %s AND organisation_id = %s",
            (body.template_id, org_id),
        )
        if not t:
            raise HTTPException(status_code=404, detail="Shift template not found")
        t = dict(t)

        start_time = t.get("start_time")
        end_time = t.get("end_time")
        if not start_time or not end_time:
            raise HTTPException(status_code=422, detail="Shift template is missing start_time or end_time.")

        shift_rows = []
        current = body.date_from
        while current <= body.date_to:
            # day_of_week: 0=Mon … 6=Sun matching Python weekday()
            if current.weekday() in (t.get("days_of_week") or []):
                try:
                    start_dt = datetime.fromisoformat(f"{current}T{start_time}")
                    end_dt   = datetime.fromisoformat(f"{current}T{end_time}")
                    # Handle overnight shifts: if end is before or equal to start,
                    # the shift crosses midnight — end is on the following day.
                    if end_dt <= start_dt:
                        end_dt += timedelta(days=1)
                    start_at = start_dt.isoformat()
                    end_at   = end_dt.isoformat()
                except ValueError as e:
                    raise HTTPException(status_code=422, detail=f"Invalid time format in template: {e}")
                location_id = t.get("location_id") or body.location_id
                if not location_id:
                    raise HTTPException(
                        status_code=422,
                        detail="This template is org-wide. Please select a location before generating shifts.",
                    )
                shift_rows.append((
                    org_id,
                    location_id,
                    t["id"],
                    t.get("role"),
                    start_at,
                    end_at,
                    "draft",
                    False,
                    False,
                    user_id,
                ))
            current += timedelta(days=1)

        if not shift_rows:
            return {"shifts_created": 0, "shifts": []}

        try:
            execute_many(
                conn,
                """
                INSERT INTO shifts
                    (organisation_id, location_id, template_id, role, start_at, end_at,
                     status, is_open_shift, ai_generated, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                shift_rows,
            )
            inserted = rows(
                conn,
                """
                SELECT * FROM shifts
                WHERE organisation_id = %s
                  AND template_id = %s
                  AND created_by = %s
                  AND start_at >= %s
                ORDER BY start_at
                """,
                (org_id, t["id"], user_id, shift_rows[0][4]),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to create shifts: {e}")
        result_list = [dict(r) for r in inserted]
        return {"shifts_created": len(result_list), "shifts": result_list}

    # ── Shifts ─────────────────────────────────────────────────────────────────

    @staticmethod
    async def list_shifts(
        conn,
        org_id: str,
        location_id: Optional[str] = None,
        user_id: Optional[str] = None,
        status: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict:
        conditions = [
            "s.organisation_id = %s",
            "s.is_deleted = FALSE",
        ]
        params: list = [org_id]

        if location_id:
            conditions.append("s.location_id = %s")
            params.append(location_id)
        if user_id:
            conditions.append("s.assigned_to_user_id = %s")
            params.append(user_id)
        if status:
            conditions.append("s.status = %s")
            params.append(status)
        if from_date:
            conditions.append("s.start_at >= %s")
            params.append(from_date)
        if to_date:
            conditions.append("s.start_at <= %s")
            params.append(to_date)

        where = " AND ".join(conditions)
        offset = (page - 1) * page_size

        count_result = row(
            conn,
            f"SELECT COUNT(*) AS total FROM shifts s WHERE {where}",
            tuple(params),
        )
        total_count = int(count_result["total"]) if count_result else 0

        params_page = params + [page_size, offset]
        items = rows(
            conn,
            f"""
            SELECT
                s.*,
                json_build_object('id', p.id, 'full_name', p.full_name, 'role', p.role) AS profiles,
                json_build_object('id', l.id, 'name', l.name) AS locations,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'id', osc.id,
                        'claimed_by', osc.claimed_by,
                        'status', osc.status,
                        'claimed_at', osc.claimed_at,
                        'manager_note', osc.manager_note,
                        'profiles', json_build_object('id', cp.id, 'full_name', cp.full_name)
                    ))
                    FROM open_shift_claims osc
                    LEFT JOIN profiles cp ON cp.id = osc.claimed_by
                    WHERE osc.shift_id = s.id),
                    '[]'::json
                ) AS open_shift_claims
            FROM shifts s
            LEFT JOIN profiles p ON p.id = s.assigned_to_user_id
            LEFT JOIN locations l ON l.id = s.location_id
            WHERE {where}
            ORDER BY s.start_at ASC
            LIMIT %s OFFSET %s
            """,
            tuple(params_page),
        )
        return {"items": [dict(r) for r in items], "total_count": total_count}

    @staticmethod
    async def get_shift(conn, shift_id: str, org_id: str) -> dict:
        result = row(
            conn,
            """
            SELECT
                s.*,
                json_build_object('id', p.id, 'full_name', p.full_name, 'role', p.role) AS profiles,
                json_build_object('id', l.id, 'name', l.name) AS locations,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'id', osc.id,
                        'claimed_by', osc.claimed_by,
                        'status', osc.status,
                        'claimed_at', osc.claimed_at,
                        'manager_note', osc.manager_note,
                        'profiles', json_build_object('id', cp.id, 'full_name', cp.full_name)
                    ))
                    FROM open_shift_claims osc
                    LEFT JOIN profiles cp ON cp.id = osc.claimed_by
                    WHERE osc.shift_id = s.id),
                    '[]'::json
                ) AS open_shift_claims
            FROM shifts s
            LEFT JOIN profiles p ON p.id = s.assigned_to_user_id
            LEFT JOIN locations l ON l.id = s.location_id
            WHERE s.id = %s AND s.organisation_id = %s AND s.is_deleted = FALSE
            """,
            (shift_id, org_id),
        )
        if not result:
            raise HTTPException(status_code=404, detail="Shift not found")
        return dict(result)

    @staticmethod
    async def create_shift(conn, body: CreateShiftRequest, org_id: str, user_id: str) -> dict:
        result = execute_returning(
            conn,
            """
            INSERT INTO shifts
                (organisation_id, location_id, role, start_at, end_at, status,
                 is_open_shift, created_by, assigned_to_user_id, template_id, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                org_id,
                body.location_id,
                body.role,
                body.start_at,
                body.end_at,
                body.status,
                body.is_open_shift,
                user_id,
                body.assigned_to_user_id or None,
                body.template_id or None,
                body.notes or None,
            ),
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to create shift")
        return dict(result)

    @staticmethod
    async def update_shift(conn, shift_id: str, org_id: str, body: UpdateShiftRequest) -> dict:
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        updates["updated_at"] = _now()

        set_clause = ", ".join(f"{k} = %s" for k in updates)
        values = list(updates.values()) + [shift_id, org_id]

        result = execute_returning(
            conn,
            f"""
            UPDATE shifts
            SET {set_clause}
            WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
            RETURNING *
            """,
            tuple(values),
        )
        if not result:
            raise HTTPException(status_code=404, detail="Shift not found")
        return dict(result)

    @staticmethod
    async def delete_shift(conn, shift_id: str, org_id: str) -> None:
        check = row(
            conn,
            "SELECT id, status FROM shifts WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE",
            (shift_id, org_id),
        )
        if not check:
            raise HTTPException(status_code=404, detail="Shift not found")
        if dict(check).get("status") != "cancelled":
            raise HTTPException(status_code=400, detail="Only cancelled shifts can be deleted")
        execute(
            conn,
            "UPDATE shifts SET is_deleted = TRUE, updated_at = %s WHERE id = %s AND organisation_id = %s",
            (_now(), shift_id, org_id),
        )

    @staticmethod
    async def publish_shifts(conn, shift_ids: list[str], org_id: str) -> dict:
        # Fetch shifts to validate and split into open vs assigned
        shifts = rows(
            conn,
            """
            SELECT id, assigned_to_user_id, is_open_shift
            FROM shifts
            WHERE id = ANY(%s::uuid[]) AND organisation_id = %s AND is_deleted = FALSE
            """,
            (list(shift_ids), org_id),
        )
        shifts = [dict(s) for s in shifts]

        # Reject shifts that have neither an assignee nor the open-shift flag
        unassigned = [
            s["id"] for s in shifts
            if not s.get("assigned_to_user_id") and not s.get("is_open_shift")
        ]
        if unassigned:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"{len(unassigned)} shift(s) have no assigned staff and are not "
                    "marked as open shifts. Please assign staff or mark as open shifts "
                    "before publishing."
                ),
            )

        open_ids = [s["id"] for s in shifts if s.get("is_open_shift")]
        assigned_ids = [s["id"] for s in shifts if not s.get("is_open_shift")]
        published = 0
        now = _now()

        if assigned_ids:
            n = execute(
                conn,
                """
                UPDATE shifts
                SET status = 'published', updated_at = %s
                WHERE id = ANY(%s::uuid[]) AND organisation_id = %s AND is_deleted = FALSE
                """,
                (now, list(assigned_ids), org_id),
            )
            published += n

        if open_ids:
            n = execute(
                conn,
                """
                UPDATE shifts
                SET status = 'open', updated_at = %s
                WHERE id = ANY(%s::uuid[]) AND organisation_id = %s AND is_deleted = FALSE
                """,
                (now, list(open_ids), org_id),
            )
            published += n

        return {"published": published}

    @staticmethod
    async def assign_bulk(conn, assignments: list, org_id: str) -> dict:
        """Bulk-assign staff to draft shifts (or mark as open shifts)."""
        updated = 0
        now = _now()
        for a in assignments:
            if a.is_open_shift:
                execute(
                    conn,
                    """
                    UPDATE shifts
                    SET is_open_shift = TRUE, assigned_to_user_id = NULL, updated_at = %s
                    WHERE id = %s AND organisation_id = %s
                    """,
                    (now, a.shift_id, org_id),
                )
            else:
                execute(
                    conn,
                    """
                    UPDATE shifts
                    SET is_open_shift = FALSE, assigned_to_user_id = %s, updated_at = %s
                    WHERE id = %s AND organisation_id = %s
                    """,
                    (a.user_id or None, now, a.shift_id, org_id),
                )
            updated += 1
        return {"updated": updated}

    @staticmethod
    async def publish_bulk(
        conn,
        org_id: str,
        filter_type: str,
        location_id: Optional[str] = None,
        role: Optional[str] = None,
        user_id: Optional[str] = None,
        week_start: Optional[str] = None,
        week_end: Optional[str] = None,
    ) -> dict:
        conditions = [
            "organisation_id = %s",
            "status = 'draft'",
            "is_deleted = FALSE",
        ]
        params: list = [org_id]

        if week_start:
            conditions.append("start_at >= %s")
            params.append(f"{week_start}T00:00:00")
        if week_end:
            conditions.append("start_at <= %s")
            params.append(f"{week_end}T23:59:59")
        if filter_type == "location" and location_id:
            conditions.append("location_id = %s")
            params.append(location_id)
        elif filter_type == "role" and role:
            conditions.append("role = %s")
            params.append(role)
        elif filter_type == "individual" and user_id:
            conditions.append("assigned_to_user_id = %s")
            params.append(user_id)

        where = " AND ".join(conditions)
        ids_result = rows(conn, f"SELECT id FROM shifts WHERE {where}", tuple(params))
        ids = [r["id"] for r in ids_result]

        if not ids:
            return {"published": 0}

        n = execute(
            conn,
            """
            UPDATE shifts
            SET status = 'published', updated_at = %s
            WHERE id = ANY(%s::uuid[]) AND organisation_id = %s
            """,
            (_now(), list(ids), org_id),
        )
        return {"published": n}

    # ── Open Shifts ─────────────────────────────────────────────────────────────

    @staticmethod
    async def claim_shift(conn, shift_id: str, user_id: str, org_id: str) -> dict:
        # Verify shift is open/published + belongs to org
        shift = row(
            conn,
            """
            SELECT id, status, is_open_shift, organisation_id
            FROM shifts
            WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
            """,
            (shift_id, org_id),
        )
        if not shift:
            raise HTTPException(status_code=404, detail="Shift not found")
        shift = dict(shift)
        if not shift.get("is_open_shift"):
            raise HTTPException(status_code=400, detail="Shift is not open for claiming")
        if shift["status"] not in ("published", "open"):
            raise HTTPException(status_code=400, detail="Shift is not available for claiming")

        # Mark shift as open if still published
        if shift["status"] == "published":
            execute(
                conn,
                "UPDATE shifts SET status = 'open', updated_at = %s WHERE id = %s",
                (_now(), shift_id),
            )

        try:
            claim = execute_returning(
                conn,
                """
                INSERT INTO open_shift_claims (shift_id, claimed_by, status)
                VALUES (%s, %s, 'pending')
                RETURNING *
                """,
                (shift_id, user_id),
            )
        except Exception as exc:
            raise HTTPException(status_code=409, detail="You have already claimed this shift") from exc

        if not claim:
            raise HTTPException(status_code=500, detail="Failed to claim shift")
        claim = dict(claim)

        # Notify managers at the shift's location
        try:
            shift_info = row(
                conn,
                "SELECT location_id, start_at FROM shifts WHERE id = %s",
                (shift_id,),
            )
            claimant_info = row(
                conn,
                "SELECT full_name FROM profiles WHERE id = %s",
                (user_id,),
            )
            loc_id = (dict(shift_info) if shift_info else {}).get("location_id")
            start_at = (dict(shift_info) if shift_info else {}).get("start_at", "")
            claimant_name = (dict(claimant_info) if claimant_info else {}).get("full_name", "A team member")
            shift_date = str(start_at)[:10] if start_at else ""
            shift_time = str(start_at)[11:16] if len(str(start_at)) > 16 else ""
            import asyncio as _asyncio
            from services import notification_service as _ns
            _asyncio.create_task(_ns.notify_role(
                org_id=org_id,
                role="manager",
                location_id=loc_id,
                type="shift_claim_pending",
                title=f"Shift claim: {claimant_name} wants {shift_date} {shift_time}".strip(),
                entity_type="shift_claim",
                entity_id=claim["id"],
            ))
        except Exception:
            pass

        return claim

    @staticmethod
    async def list_claims(
        conn,
        org_id: str,
        shift_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[dict]:
        # Join through shifts to filter by org
        org_shift_ids_result = rows(
            conn,
            "SELECT id FROM shifts WHERE organisation_id = %s AND is_deleted = FALSE",
            (org_id,),
        )
        org_shift_ids = [r["id"] for r in org_shift_ids_result]
        if not org_shift_ids:
            return []

        conditions = ["osc.shift_id = ANY(%s::uuid[])"]
        params: list = [list(org_shift_ids)]

        if shift_id:
            conditions.append("osc.shift_id = %s")
            params.append(shift_id)
        if status:
            conditions.append("osc.status = %s")
            params.append(status)

        where = " AND ".join(conditions)
        result = rows(
            conn,
            f"""
            SELECT
                osc.*,
                json_build_object('id', p.id, 'full_name', p.full_name) AS profiles,
                json_build_object(
                    'id', s.id,
                    'start_at', s.start_at,
                    'end_at', s.end_at,
                    'role', s.role,
                    'location_id', s.location_id,
                    'locations', json_build_object('name', l.name)
                ) AS shifts
            FROM open_shift_claims osc
            LEFT JOIN profiles p ON p.id = osc.claimed_by
            LEFT JOIN shifts s ON s.id = osc.shift_id
            LEFT JOIN locations l ON l.id = s.location_id
            WHERE {where}
            ORDER BY osc.claimed_at DESC
            """,
            tuple(params),
        )
        return [dict(r) for r in result]

    @staticmethod
    async def respond_to_claim(
        conn,
        claim_id: str,
        action: str,
        manager_note: Optional[str],
        org_id: str,
        manager_id: str,
    ) -> dict:
        claim_row = row(
            conn,
            """
            SELECT osc.*, s.organisation_id AS shift_org_id
            FROM open_shift_claims osc
            JOIN shifts s ON s.id = osc.shift_id
            WHERE osc.id = %s
            """,
            (claim_id,),
        )
        if not claim_row:
            raise HTTPException(status_code=404, detail="Claim not found")
        claim = dict(claim_row)
        if claim.get("shift_org_id") != org_id:
            raise HTTPException(status_code=403, detail="Not authorized")

        now = _now()
        if action == "approve":
            execute(
                conn,
                """
                UPDATE open_shift_claims
                SET status = 'approved', responded_at = %s, manager_note = %s
                WHERE id = %s
                """,
                (now, manager_note, claim_id),
            )

            shift_id = claim["shift_id"]
            execute(
                conn,
                """
                UPDATE shifts
                SET assigned_to_user_id = %s, status = 'claimed', updated_at = %s
                WHERE id = %s
                """,
                (claim["claimed_by"], now, shift_id),
            )

            # Reject all other pending claims for this shift
            execute(
                conn,
                """
                UPDATE open_shift_claims
                SET status = 'rejected', responded_at = %s,
                    manager_note = 'Another applicant was selected.'
                WHERE shift_id = %s AND id != %s AND status = 'pending'
                """,
                (now, shift_id, claim_id),
            )

        elif action == "reject":
            execute(
                conn,
                """
                UPDATE open_shift_claims
                SET status = 'rejected', responded_at = %s, manager_note = %s
                WHERE id = %s
                """,
                (now, manager_note, claim_id),
            )
        else:
            raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

        updated = row(conn, "SELECT * FROM open_shift_claims WHERE id = %s", (claim_id,))
        return dict(updated) if updated else {}

    # ── Swap Requests ───────────────────────────────────────────────────────────

    @staticmethod
    async def create_swap_request(conn, body: CreateSwapRequest, user_id: str, org_id: str) -> dict:
        # Verify shift belongs to user & org
        shift_check = row(
            conn,
            """
            SELECT id FROM shifts
            WHERE id = %s AND organisation_id = %s
              AND assigned_to_user_id = %s AND is_deleted = FALSE
            """,
            (body.shift_id, org_id, user_id),
        )
        if not shift_check:
            raise HTTPException(status_code=404, detail="Shift not found or not assigned to you")

        swap = execute_returning(
            conn,
            """
            INSERT INTO shift_swap_requests
                (organisation_id, requested_by, shift_id, status, target_user_id, target_shift_id)
            VALUES (%s, %s, %s, 'pending_colleague', %s, %s)
            RETURNING *
            """,
            (
                org_id,
                user_id,
                body.shift_id,
                body.target_user_id or None,
                body.target_shift_id or None,
            ),
        )
        if not swap:
            raise HTTPException(status_code=500, detail="Failed to create swap request")
        swap = dict(swap)

        # Notify the target colleague if specified
        try:
            if body.target_user_id:
                requester_info = row(
                    conn,
                    "SELECT full_name FROM profiles WHERE id = %s",
                    (user_id,),
                )
                requester_name = (dict(requester_info) if requester_info else {}).get("full_name", "A teammate")
                import asyncio as _asyncio
                from services import notification_service as _ns
                _asyncio.create_task(_ns.notify(
                    org_id=org_id,
                    recipient_user_id=body.target_user_id,
                    type="shift_swap_pending",
                    title=f"Shift swap request from {requester_name}",
                    entity_type="shift_swap",
                    entity_id=swap["id"],
                ))
        except Exception:
            pass

        return swap

    @staticmethod
    async def respond_to_swap(
        conn,
        swap_id: str,
        action: str,
        user_id: str,
        org_id: str,
        reason: Optional[str] = None,
    ) -> dict:
        swap_row_data = row(
            conn,
            "SELECT * FROM shift_swap_requests WHERE id = %s AND organisation_id = %s",
            (swap_id, org_id),
        )
        if not swap_row_data:
            raise HTTPException(status_code=404, detail="Swap request not found")
        swap = dict(swap_row_data)
        now = _now()

        if action in ("accept", "decline"):
            # Colleague response
            if swap.get("target_user_id") and swap["target_user_id"] != user_id:
                raise HTTPException(status_code=403, detail="Not the targeted colleague")
            if swap["status"] != "pending_colleague":
                raise HTTPException(status_code=400, detail="Swap is not awaiting colleague response")
            if action == "accept":
                execute(
                    conn,
                    """
                    UPDATE shift_swap_requests
                    SET status = 'pending_manager', colleague_response_at = %s, updated_at = %s
                    WHERE id = %s
                    """,
                    (now, now, swap_id),
                )

                # When colleague approves, notify managers for final approval
                try:
                    req_info = row(conn, "SELECT full_name FROM profiles WHERE id = %s", (swap["requested_by"],))
                    col_info = row(conn, "SELECT full_name, location_id FROM profiles WHERE id = %s", (user_id,))
                    req_name = (dict(req_info) if req_info else {}).get("full_name", "Staff")
                    col_name = (dict(col_info) if col_info else {}).get("full_name", "colleague")
                    loc_id = (dict(col_info) if col_info else {}).get("location_id")
                    import asyncio as _asyncio
                    from services import notification_service as _ns
                    _asyncio.create_task(_ns.notify_role(
                        org_id=org_id,
                        role="manager",
                        location_id=loc_id,
                        type="shift_swap_pending",
                        title=f"Shift swap needs approval: {req_name} \u2194 {col_name}",
                        entity_type="shift_swap",
                        entity_id=swap_id,
                    ))
                except Exception:
                    pass
            else:
                execute(
                    conn,
                    """
                    UPDATE shift_swap_requests
                    SET status = 'rejected', colleague_response_at = %s,
                        rejection_reason = %s, updated_at = %s
                    WHERE id = %s
                    """,
                    (now, reason, now, swap_id),
                )

        elif action in ("approve", "reject"):
            # Manager response
            if swap["status"] != "pending_manager":
                raise HTTPException(status_code=400, detail="Swap is not awaiting manager approval")
            if action == "approve":
                # Atomically swap the assigned_to_user_id fields
                shift_a = swap["shift_id"]
                shift_b = swap.get("target_shift_id")
                user_a = swap["requested_by"]
                user_b = swap.get("target_user_id")

                execute(
                    conn,
                    "UPDATE shifts SET assigned_to_user_id = %s, updated_at = %s WHERE id = %s",
                    (user_b, now, shift_a),
                )
                if shift_b and user_b:
                    execute(
                        conn,
                        "UPDATE shifts SET assigned_to_user_id = %s, updated_at = %s WHERE id = %s",
                        (user_a, now, shift_b),
                    )

                execute(
                    conn,
                    """
                    UPDATE shift_swap_requests
                    SET status = 'approved', manager_response_at = %s,
                        approved_by = %s, updated_at = %s
                    WHERE id = %s
                    """,
                    (now, user_id, now, swap_id),
                )
            else:
                execute(
                    conn,
                    """
                    UPDATE shift_swap_requests
                    SET status = 'rejected', manager_response_at = %s,
                        rejection_reason = %s, updated_at = %s
                    WHERE id = %s
                    """,
                    (now, reason, now, swap_id),
                )
        else:
            raise HTTPException(status_code=400, detail="action must be 'accept', 'decline', 'approve', or 'reject'")

        updated = row(conn, "SELECT * FROM shift_swap_requests WHERE id = %s", (swap_id,))
        return dict(updated) if updated else {}

    @staticmethod
    async def list_swap_requests(
        conn,
        org_id: str,
        user_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[dict]:
        conditions = ["ssr.organisation_id = %s"]
        params: list = [org_id]

        if user_id:
            conditions.append("(ssr.requested_by = %s OR ssr.target_user_id = %s)")
            params.extend([user_id, user_id])
        if status:
            conditions.append("ssr.status = %s")
            params.append(status)

        where = " AND ".join(conditions)
        result = rows(
            conn,
            f"""
            SELECT
                ssr.*,
                json_build_object('id', p.id, 'full_name', p.full_name) AS profiles,
                json_build_object('id', s.id, 'start_at', s.start_at, 'end_at', s.end_at, 'role', s.role) AS shifts,
                json_build_object('id', tp.id, 'full_name', tp.full_name) AS target_profile
            FROM shift_swap_requests ssr
            LEFT JOIN profiles p ON p.id = ssr.requested_by
            LEFT JOIN shifts s ON s.id = ssr.shift_id
            LEFT JOIN profiles tp ON tp.id = ssr.target_user_id
            WHERE {where}
            ORDER BY ssr.created_at DESC
            """,
            tuple(params),
        )
        return [dict(r) for r in result]

    # ── Leave ───────────────────────────────────────────────────────────────────

    @staticmethod
    async def create_leave_request(conn, body: CreateLeaveRequest, user_id: str, org_id: str) -> dict:
        if body.end_date < body.start_date:
            raise HTTPException(status_code=400, detail="end_date must be on or after start_date")

        leave = execute_returning(
            conn,
            """
            INSERT INTO leave_requests
                (user_id, organisation_id, leave_type, start_date, end_date, reason, status)
            VALUES (%s, %s, %s, %s, %s, %s, 'pending')
            RETURNING *
            """,
            (
                user_id,
                org_id,
                body.leave_type,
                body.start_date.isoformat(),
                body.end_date.isoformat(),
                body.reason,
            ),
        )
        if not leave:
            raise HTTPException(status_code=500, detail="Failed to create leave request")
        leave = dict(leave)

        # Notify the user's manager
        try:
            user_info = row(conn, "SELECT full_name FROM profiles WHERE id = %s", (user_id,))
            user_name = (dict(user_info) if user_info else {}).get("full_name", "A team member")
            start_str = body.start_date.isoformat()
            end_str = body.end_date.isoformat()
            import asyncio as _asyncio
            from services import notification_service as _ns
            _asyncio.create_task(_ns.notify_user_manager(
                org_id=org_id,
                user_id=user_id,
                type="leave_request_pending",
                title=f"Leave request: {user_name} \u2014 {body.leave_type}",
                body=f"{start_str} to {end_str}",
                entity_type="leave_request",
                entity_id=leave["id"],
            ))
        except Exception:
            pass

        return leave

    @staticmethod
    async def list_leave_requests(
        conn,
        org_id: str,
        user_id: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        conditions = ["lr.organisation_id = %s"]
        params: list = [org_id]

        if user_id:
            conditions.append("lr.user_id = %s")
            params.append(user_id)
        if status:
            conditions.append("lr.status = %s")
            params.append(status)

        where = " AND ".join(conditions)
        count_result = row(
            conn,
            f"SELECT COUNT(*) AS total FROM leave_requests lr WHERE {where}",
            tuple(params),
        )
        total_count = int(count_result["total"]) if count_result else 0

        params_page = params + [page_size, (page - 1) * page_size]
        items = rows(
            conn,
            f"""
            SELECT lr.*,
                   json_build_object('id', p.id, 'full_name', p.full_name) AS profiles
            FROM leave_requests lr
            LEFT JOIN profiles p ON p.id = lr.user_id
            WHERE {where}
            ORDER BY lr.created_at DESC
            LIMIT %s OFFSET %s
            """,
            tuple(params_page),
        )
        return {"items": [dict(r) for r in items], "total_count": total_count}

    @staticmethod
    async def respond_to_leave(conn, leave_id: str, action: str, manager_id: str, org_id: str) -> dict:
        leave_row_data = row(
            conn,
            "SELECT id, status FROM leave_requests WHERE id = %s AND organisation_id = %s",
            (leave_id, org_id),
        )
        if not leave_row_data:
            raise HTTPException(status_code=404, detail="Leave request not found")
        if dict(leave_row_data)["status"] != "pending":
            raise HTTPException(status_code=400, detail="Leave request is not pending")
        if action not in ("approve", "reject"):
            raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

        new_status = "approved" if action == "approve" else "rejected"
        result = execute_returning(
            conn,
            """
            UPDATE leave_requests
            SET status = %s, approved_by = %s, responded_at = %s, updated_at = %s
            WHERE id = %s
            RETURNING *
            """,
            (new_status, manager_id, _now(), _now(), leave_id),
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to update leave request")
        return dict(result)

    # ── Availability ────────────────────────────────────────────────────────────

    @staticmethod
    async def get_availability(conn, user_id: str, org_id: str) -> list[dict]:
        result = rows(
            conn,
            """
            SELECT * FROM staff_availability
            WHERE user_id = %s AND organisation_id = %s
            ORDER BY day_of_week ASC
            """,
            (user_id, org_id),
        )
        return [dict(r) for r in result]

    @staticmethod
    async def set_availability(conn, body: SetAvailabilityRequest, user_id: str, org_id: str) -> dict:
        result = execute_returning(
            conn,
            """
            INSERT INTO staff_availability
                (user_id, organisation_id, day_of_week, available_from, available_to,
                 is_available, updated_at, effective_from, effective_to)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, day_of_week) DO UPDATE SET
                available_from = EXCLUDED.available_from,
                available_to = EXCLUDED.available_to,
                is_available = EXCLUDED.is_available,
                updated_at = EXCLUDED.updated_at,
                effective_from = EXCLUDED.effective_from,
                effective_to = EXCLUDED.effective_to
            RETURNING *
            """,
            (
                user_id,
                org_id,
                body.day_of_week,
                body.available_from,
                body.available_to,
                body.is_available,
                _now(),
                body.effective_from or None,
                body.effective_to or None,
            ),
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to set availability")
        return dict(result)

    # ── Attendance ──────────────────────────────────────────────────────────────

    @staticmethod
    async def clock_in(conn, body: ClockInRequest, user_id: str, org_id: str) -> dict:
        # Check no active clock-in from the last 24 hours.
        # Records older than 24 h with no clock-out are treated as abandoned
        # so they don't permanently block the user (matches frontend today-only view).
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        active = row(
            conn,
            """
            SELECT id FROM attendance_records
            WHERE user_id = %s AND organisation_id = %s
              AND clock_out_at IS NULL
              AND clock_in_at IS NOT NULL
              AND clock_in_at >= %s
            """,
            (user_id, org_id, cutoff),
        )
        if active:
            raise HTTPException(status_code=400, detail="You are already clocked in. Clock out first.")

        # Fetch attendance rules for late detection
        rules_row = row(
            conn,
            "SELECT late_threshold_mins FROM attendance_rules WHERE organisation_id = %s",
            (org_id,),
        )
        late_threshold = (dict(rules_row) if rules_row else {}).get("late_threshold_mins", 15)

        # Geo-fence validation
        geo_valid: Optional[bool] = None
        if body.latitude is not None and body.longitude is not None:
            loc_row = row(
                conn,
                "SELECT latitude, longitude, geo_fence_radius_meters FROM locations WHERE id = %s",
                (body.location_id,),
            )
            if loc_row:
                loc = dict(loc_row)
                if loc.get("latitude") is not None and loc.get("longitude") is not None:
                    dist = _haversine_meters(
                        body.latitude, body.longitude,
                        float(loc["latitude"]), float(loc["longitude"])
                    )
                    geo_valid = dist <= float(loc.get("geo_fence_radius_meters") or 100)

        # Determine status
        status = "present"
        if body.clock_in_method == "gps" and geo_valid is False:
            status = "unverified"
        elif body.shift_id:
            shift_row = row(
                conn,
                "SELECT start_at FROM shifts WHERE id = %s",
                (body.shift_id,),
            )
            if shift_row:
                shift_start = datetime.fromisoformat(str(dict(shift_row)["start_at"]).replace("Z", "+00:00"))
                now_dt = datetime.now(timezone.utc)
                if now_dt > shift_start + timedelta(minutes=late_threshold):
                    status = "late"

        result = execute_returning(
            conn,
            """
            INSERT INTO attendance_records
                (user_id, organisation_id, location_id, clock_in_at, clock_in_method,
                 status, shift_id, clock_in_latitude, clock_in_longitude, clock_in_geo_valid)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                user_id,
                org_id,
                body.location_id,
                _now(),
                body.clock_in_method,
                status,
                body.shift_id or None,
                body.latitude if body.latitude is not None else None,
                body.longitude if body.longitude is not None else None,
                geo_valid,
            ),
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to clock in")
        return dict(result)

    @staticmethod
    async def clock_out(conn, body: ClockOutRequest, user_id: str, org_id: str) -> dict:
        record_row = row(
            conn,
            """
            SELECT ar.*, s.start_at AS shift_start_at, s.end_at AS shift_end_at
            FROM attendance_records ar
            LEFT JOIN shifts s ON s.id = ar.shift_id
            WHERE ar.id = %s AND ar.user_id = %s AND ar.organisation_id = %s
            """,
            (body.attendance_id, user_id, org_id),
        )
        if not record_row:
            raise HTTPException(status_code=404, detail="Attendance record not found")
        record = dict(record_row)
        if record.get("clock_out_at"):
            raise HTTPException(status_code=400, detail="Already clocked out")

        rules_row = row(
            conn,
            """
            SELECT early_departure_threshold_mins, overtime_threshold_hours, break_duration_mins
            FROM attendance_rules
            WHERE organisation_id = %s
            """,
            (org_id,),
        )
        rules = dict(rules_row) if rules_row else {}
        early_thresh = rules.get("early_departure_threshold_mins", 15)
        ot_thresh_hours = float(rules.get("overtime_threshold_hours", 8))
        break_mins = int(rules.get("break_duration_mins", 30))

        now_dt = datetime.now(timezone.utc)
        clock_in_dt = datetime.fromisoformat(str(record["clock_in_at"]).replace("Z", "+00:00"))
        total_minutes = int((now_dt - clock_in_dt).total_seconds() / 60)
        worked_minutes = max(0, total_minutes - break_mins)
        ot_threshold_mins = int(ot_thresh_hours * 60)
        overtime_minutes = max(0, worked_minutes - ot_threshold_mins)

        new_status = record.get("status", "present")
        if record.get("shift_end_at") and new_status not in ("late", "unverified"):
            shift_end = datetime.fromisoformat(str(record["shift_end_at"]).replace("Z", "+00:00"))
            if now_dt < shift_end - timedelta(minutes=early_thresh):
                new_status = "early_departure"

        result = execute_returning(
            conn,
            """
            UPDATE attendance_records
            SET clock_out_at = %s, total_minutes = %s, overtime_minutes = %s,
                break_minutes = %s, status = %s, updated_at = %s
            WHERE id = %s
            RETURNING *
            """,
            (
                now_dt.isoformat(),
                total_minutes,
                overtime_minutes,
                break_mins,
                new_status,
                _now(),
                body.attendance_id,
            ),
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to clock out")
        return dict(result)

    @staticmethod
    async def list_attendance(
        conn,
        org_id: str,
        user_id: Optional[str] = None,
        location_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict:
        conditions = ["ar.organisation_id = %s"]
        params: list = [org_id]

        if user_id:
            conditions.append("ar.user_id = %s")
            params.append(user_id)
        if location_id:
            conditions.append("ar.location_id = %s")
            params.append(location_id)
        if from_date:
            conditions.append("ar.clock_in_at >= %s")
            params.append(from_date)
        if to_date:
            conditions.append("ar.clock_in_at <= %s")
            params.append(to_date)
        if status:
            conditions.append("ar.status = %s")
            params.append(status)

        where = " AND ".join(conditions)
        count_result = row(
            conn,
            f"SELECT COUNT(*) AS total FROM attendance_records ar WHERE {where}",
            tuple(params),
        )
        total_count = int(count_result["total"]) if count_result else 0

        params_page = params + [page_size, (page - 1) * page_size]
        items = rows(
            conn,
            f"""
            SELECT
                ar.*,
                json_build_object('id', p.id, 'full_name', p.full_name) AS profiles,
                json_build_object('id', s.id, 'start_at', s.start_at, 'end_at', s.end_at, 'role', s.role) AS shifts
            FROM attendance_records ar
            LEFT JOIN profiles p ON p.id = ar.user_id
            LEFT JOIN shifts s ON s.id = ar.shift_id
            WHERE {where}
            ORDER BY ar.clock_in_at DESC
            LIMIT %s OFFSET %s
            """,
            tuple(params_page),
        )
        return {"items": [dict(r) for r in items], "total_count": total_count}

    @staticmethod
    async def manager_override(conn, body: ManagerOverrideRequest, org_id: str, manager_id: str) -> dict:
        clock_in_dt = datetime.fromisoformat(body.clock_in_at.replace("Z", "+00:00"))
        total_minutes: Optional[int] = None
        if body.clock_out_at:
            clock_out_dt = datetime.fromisoformat(body.clock_out_at.replace("Z", "+00:00"))
            total_minutes = int((clock_out_dt - clock_in_dt).total_seconds() / 60)

        result = execute_returning(
            conn,
            """
            INSERT INTO attendance_records
                (user_id, organisation_id, location_id, clock_in_at, clock_in_method,
                 clock_in_geo_valid, status, manager_override_note,
                 shift_id, clock_out_at, total_minutes)
            VALUES (%s, %s, %s, %s, 'manager_override', TRUE, 'present', %s, %s, %s, %s)
            RETURNING *
            """,
            (
                body.user_id,
                org_id,
                body.location_id,
                body.clock_in_at,
                body.note,
                body.shift_id or None,
                body.clock_out_at or None,
                total_minutes,
            ),
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to create attendance override")
        return dict(result)

    # ── Rules ───────────────────────────────────────────────────────────────────

    @staticmethod
    async def get_attendance_rules(conn, org_id: str) -> dict:
        result = row(
            conn,
            "SELECT * FROM attendance_rules WHERE organisation_id = %s",
            (org_id,),
        )
        if not result:
            # Return defaults if not yet configured
            return {
                "organisation_id": org_id,
                "late_threshold_mins": 15,
                "early_departure_threshold_mins": 15,
                "overtime_threshold_hours": 8.0,
                "weekly_overtime_threshold_hours": None,
                "break_duration_mins": 30,
            }
        return dict(result)

    @staticmethod
    async def update_attendance_rules(conn, body: UpdateAttendanceRulesRequest, org_id: str) -> dict:
        updates = body.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        updates["organisation_id"] = org_id
        updates["updated_at"] = _now()

        set_clause = ", ".join(
            f"{k} = %s" for k in updates if k != "organisation_id"
        )
        set_values = [v for k, v in updates.items() if k != "organisation_id"]

        result = execute_returning(
            conn,
            f"""
            INSERT INTO attendance_rules (organisation_id, {', '.join(k for k in updates if k != 'organisation_id')})
            VALUES (%s, {', '.join('%s' for k in updates if k != 'organisation_id')})
            ON CONFLICT (organisation_id) DO UPDATE SET {set_clause}
            RETURNING *
            """,
            tuple([org_id] + set_values + set_values),
        )
        if not result:
            raise HTTPException(status_code=500, detail="Failed to update attendance rules")
        return dict(result)

    # ── Timesheet Summary ───────────────────────────────────────────────────────

    @staticmethod
    async def get_timesheet_summary(
        conn,
        org_id: str,
        user_id: Optional[str] = None,
        week_start: Optional[str] = None,
    ) -> list[dict]:
        if not week_start:
            today = date.today()
            week_start_dt = today - timedelta(days=today.weekday())
        else:
            week_start_dt = date.fromisoformat(week_start)

        week_end_dt = week_start_dt + timedelta(days=6)
        from_iso = f"{week_start_dt}T00:00:00+00:00"
        to_iso = f"{week_end_dt}T23:59:59+00:00"

        att_conditions = [
            "ar.organisation_id = %s",
            "ar.clock_in_at >= %s",
            "ar.clock_in_at <= %s",
        ]
        att_params: list = [org_id, from_iso, to_iso]
        if user_id:
            att_conditions.append("ar.user_id = %s")
            att_params.append(user_id)

        att_where = " AND ".join(att_conditions)
        records = rows(
            conn,
            f"""
            SELECT ar.user_id, ar.status, ar.total_minutes, ar.break_minutes,
                   ar.overtime_minutes, p.id AS profile_id, p.full_name
            FROM attendance_records ar
            LEFT JOIN profiles p ON p.id = ar.user_id
            WHERE {att_where}
            """,
            tuple(att_params),
        )

        # Also get total shifts in the same period to count shift_count
        shift_conditions = [
            "s.organisation_id = %s",
            "s.start_at >= %s",
            "s.start_at <= %s",
            "s.is_deleted = FALSE",
            "s.status != 'cancelled'",
        ]
        shift_params: list = [org_id, from_iso, to_iso]
        if user_id:
            shift_conditions.append("s.assigned_to_user_id = %s")
            shift_params.append(user_id)

        shift_where = " AND ".join(shift_conditions)
        shift_rows_result = rows(
            conn,
            f"SELECT id, assigned_to_user_id FROM shifts s WHERE {shift_where}",
            tuple(shift_params),
        )
        shift_counts: dict[str, int] = {}
        for s in shift_rows_result:
            s = dict(s)
            uid = s.get("assigned_to_user_id")
            if uid:
                shift_counts[str(uid)] = shift_counts.get(str(uid), 0) + 1

        # Aggregate by user
        user_map: dict[str, dict] = {}
        for r in records:
            r = dict(r)
            uid = str(r["user_id"])
            if uid not in user_map:
                user_map[uid] = {
                    "user_id": uid,
                    "full_name": r.get("full_name", "Unknown"),
                    "total_minutes": 0,
                    "break_minutes": 0,
                    "overtime_minutes": 0,
                    "late_count": 0,
                    "absent_count": 0,
                    "shift_count": shift_counts.get(uid, 0),
                }
            user_map[uid]["total_minutes"] += r.get("total_minutes") or 0
            user_map[uid]["break_minutes"] += r.get("break_minutes") or 0
            user_map[uid]["overtime_minutes"] += r.get("overtime_minutes") or 0
            if r.get("status") == "late":
                user_map[uid]["late_count"] += 1
            if r.get("status") == "absent":
                user_map[uid]["absent_count"] += 1

        summary = []
        for uid, data in user_map.items():
            total_hours = round(data["total_minutes"] / 60, 2)
            break_hours = round(data["break_minutes"] / 60, 2)
            worked_hours = round(max(0, total_hours - break_hours), 2)
            ot_hours = round(data["overtime_minutes"] / 60, 2)
            summary.append({
                "user_id": uid,
                "full_name": data["full_name"],
                "total_hours": total_hours,
                "break_hours": break_hours,
                "worked_hours": worked_hours,
                "regular_hours": round(max(0, worked_hours - ot_hours), 2),
                "overtime_hours": ot_hours,
                "late_count": data["late_count"],
                "absent_count": data["absent_count"],
                "shift_count": data["shift_count"],
            })

        return sorted(summary, key=lambda x: x["full_name"])

    @staticmethod
    async def get_my_timesheet(conn, user_id: str, org_id: str, week_start: Optional[str] = None) -> dict:
        if not week_start:
            today = date.today()
            week_start_dt = today - timedelta(days=today.weekday())
        else:
            week_start_dt = date.fromisoformat(week_start)
        week_end_dt = week_start_dt + timedelta(days=6)
        from_iso = f"{week_start_dt}T00:00:00+00:00"
        to_iso = f"{week_end_dt}T23:59:59+00:00"

        records = rows(
            conn,
            """
            SELECT ar.*,
                   json_build_object('id', s.id, 'start_at', s.start_at, 'end_at', s.end_at, 'role', s.role) AS shifts
            FROM attendance_records ar
            LEFT JOIN shifts s ON s.id = ar.shift_id
            WHERE ar.user_id = %s AND ar.organisation_id = %s
              AND ar.clock_in_at >= %s AND ar.clock_in_at <= %s
            ORDER BY ar.clock_in_at ASC
            """,
            (user_id, org_id, from_iso, to_iso),
        )
        records = [dict(r) for r in records]

        total_minutes = sum(r.get("total_minutes") or 0 for r in records)
        break_minutes = sum(r.get("break_minutes") or 0 for r in records)
        overtime_minutes = sum(r.get("overtime_minutes") or 0 for r in records)
        total_hours = round(total_minutes / 60, 2)
        break_hours = round(break_minutes / 60, 2)
        worked_hours = round(max(0, total_hours - break_hours), 2)
        ot_hours = round(overtime_minutes / 60, 2)

        return {
            "records": records,
            "summary": {
                "total_hours": total_hours,
                "break_hours": break_hours,
                "worked_hours": worked_hours,
                "regular_hours": round(max(0, worked_hours - ot_hours), 2),
                "overtime_hours": ot_hours,
                "late_count": sum(1 for r in records if r.get("status") == "late"),
            },
        }

    # ── AI Schedule ─────────────────────────────────────────────────────────────

    @staticmethod
    async def generate_schedule(conn, body: GenerateScheduleRequest, org_id: str, user_id: str) -> dict:
        from routes.ai_generate import _call_claude

        week_end = body.week_start + timedelta(days=6)
        from_iso = f"{body.week_start}T00:00:00+00:00"
        to_iso = f"{week_end}T23:59:59+00:00"

        # Gather staff at location
        staff_list = rows(
            conn,
            """
            SELECT id, full_name, role FROM profiles
            WHERE organisation_id = %s AND location_id = %s
              AND is_deleted = FALSE AND is_active = TRUE
            """,
            (org_id, body.location_id),
        )
        staff_list = [dict(s) for s in staff_list]

        # Check if staff availability tracking is enabled for this org
        org_row = row(
            conn,
            "SELECT feature_flags FROM organisations WHERE id = %s",
            (org_id,),
        )
        org_flags = (dict(org_row).get("feature_flags") or {}) if org_row else {}
        availability_enabled = org_flags.get("staff_availability_enabled", False)

        # Gather their availability (only when tracking is enabled)
        staff_ids = [s["id"] for s in staff_list]
        availability_by_user: dict[str, list] = {}
        if availability_enabled and staff_ids:
            avail_rows = rows(
                conn,
                """
                SELECT user_id, day_of_week, available_from, available_to, is_available
                FROM staff_availability
                WHERE user_id = ANY(%s::uuid[]) AND is_available = TRUE
                """,
                (list(staff_ids),),
            )
            for a in avail_rows:
                a = dict(a)
                availability_by_user.setdefault(str(a["user_id"]), []).append(a)

        # Existing shifts for the week
        existing_shifts = rows(
            conn,
            """
            SELECT assigned_to_user_id, start_at, end_at, status
            FROM shifts
            WHERE organisation_id = %s AND location_id = %s
              AND start_at >= %s AND start_at <= %s
              AND is_deleted = FALSE
            """,
            (org_id, body.location_id, from_iso, to_iso),
        )
        existing_shifts = [dict(s) for s in existing_shifts]

        # Location info
        loc_row = row(conn, "SELECT name FROM locations WHERE id = %s", (body.location_id,))
        location_name = (dict(loc_row).get("name", "the location")) if loc_row else "the location"

        # Build prompt
        staff_context = json.dumps([
            {
                "id": s["id"],
                "name": s["full_name"],
                "role": s["role"],
                "availability": availability_by_user.get(str(s["id"]), []),
            }
            for s in staff_list
        ], indent=2)

        existing_context = json.dumps(existing_shifts, indent=2, default=str)

        avail_note = (
            "Respect each staff member's stated availability windows. "
            "Aim for 8-hour shifts unless availability is restricted."
            if availability_enabled
            else
            "Assume all staff are available at any time. Aim for 8-hour shifts."
        )
        system_prompt = (
            "You are an expert retail staff scheduler. Given staff"
            + (" and their availability," if availability_enabled else ",")
            + " and existing shifts, generate a fair weekly schedule. "
            "Return ONLY a valid JSON array of shift objects — no markdown, no extra text. "
            "Each object must have: user_id (string), role (string), start_at (ISO 8601 UTC), end_at (ISO 8601 UTC). "
            "Do not create duplicate shifts for times where staff already have shifts. "
            f"{avail_note} "
            "Distribute shifts fairly across the week."
        )

        user_message = (
            f"Location: {location_name}\n"
            f"Week: {body.week_start} to {week_end}\n"
            f"Additional notes: {body.notes or 'None'}\n\n"
            f"Staff and availability:\n{staff_context}\n\n"
            f"Existing shifts this week:\n{existing_context}\n\n"
            "Generate a schedule for any remaining coverage needed."
        )

        raw = await _call_claude(system_prompt, user_message)

        # Parse Claude's JSON response
        try:
            schedule = json.loads(raw)
            if not isinstance(schedule, list):
                raise ValueError("Expected a JSON array")
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(
                status_code=502,
                detail=f"AI returned unexpected response format: {exc}",
            ) from exc

        warnings: list[str] = []
        rows_to_insert = []
        for item in schedule:
            if not isinstance(item, dict):
                warnings.append("Skipped non-object item in AI response")
                continue
            user_id_in = item.get("user_id")
            if not user_id_in or user_id_in not in [s["id"] for s in staff_list]:
                warnings.append(f"Skipped shift for unknown user_id: {user_id_in}")
                continue
            try:
                start = datetime.fromisoformat(item["start_at"].replace("Z", "+00:00"))
                end = datetime.fromisoformat(item["end_at"].replace("Z", "+00:00"))
            except (KeyError, ValueError) as e:
                warnings.append(f"Skipped shift with invalid times: {e}")
                continue

            rows_to_insert.append((
                org_id,
                body.location_id,
                user_id_in,
                item.get("role"),
                start.isoformat(),
                end.isoformat(),
                "draft",
                False,
                True,
                user_id,
            ))

        shifts_created = 0
        if rows_to_insert:
            execute_many(
                conn,
                """
                INSERT INTO shifts
                    (organisation_id, location_id, assigned_to_user_id, role,
                     start_at, end_at, status, is_open_shift, ai_generated, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                rows_to_insert,
            )
            shifts_created = len(rows_to_insert)

        # Log the AI job
        execute(
            conn,
            """
            INSERT INTO ai_schedule_jobs
                (organisation_id, location_id, created_by, week_start, notes,
                 shifts_created, warnings, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'completed')
            """,
            (
                org_id,
                body.location_id,
                user_id,
                body.week_start.isoformat(),
                body.notes,
                shifts_created,
                json.dumps(warnings),
            ),
        )

        return {"shifts_created": shifts_created, "warnings": warnings}

    # ── Breaks ───────────────────────────────────────────────────────────────────

    @staticmethod
    async def start_break(conn, body: StartBreakRequest, user_id: str, org_id: str) -> dict:
        # Verify the attendance record belongs to this user and is active
        rec = row(
            conn,
            """
            SELECT id, clock_out_at FROM attendance_records
            WHERE id = %s AND user_id = %s AND organisation_id = %s
            """,
            (body.attendance_id, user_id, org_id),
        )
        if not rec:
            raise HTTPException(status_code=404, detail="Attendance record not found")
        if dict(rec).get("clock_out_at"):
            raise HTTPException(status_code=400, detail="Shift already clocked out")

        # Check no open break exists
        open_br = row(
            conn,
            """
            SELECT id FROM break_records
            WHERE attendance_id = %s AND break_end_at IS NULL
            """,
            (body.attendance_id,),
        )
        if open_br:
            raise HTTPException(status_code=400, detail="A break is already in progress")

        now = _now()
        result = execute_returning(
            conn,
            """
            INSERT INTO break_records
                (attendance_id, organisation_id, user_id, break_start_at, break_type)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
            """,
            (body.attendance_id, org_id, user_id, now, body.break_type),
        )
        return dict(result) if result else {}

    @staticmethod
    async def end_break(conn, body: EndBreakRequest, user_id: str, org_id: str) -> dict:
        # Find the open break for this attendance record
        br = row(
            conn,
            """
            SELECT * FROM break_records
            WHERE attendance_id = %s AND user_id = %s AND break_end_at IS NULL
            """,
            (body.attendance_id, user_id),
        )
        if not br:
            raise HTTPException(status_code=404, detail="No active break found")
        br = dict(br)

        now_dt = datetime.now(timezone.utc)
        start_dt = datetime.fromisoformat(str(br["break_start_at"]).replace("Z", "+00:00"))
        duration = max(0, int((now_dt - start_dt).total_seconds() / 60))
        now = now_dt.isoformat()

        # Update the break record
        updated = execute_returning(
            conn,
            """
            UPDATE break_records
            SET break_end_at = %s, duration_minutes = %s
            WHERE id = %s
            RETURNING *
            """,
            (now, duration, br["id"]),
        )

        # Recalculate total break_minutes on attendance_record
        total_break_result = row(
            conn,
            """
            SELECT COALESCE(SUM(duration_minutes), 0) AS total
            FROM break_records
            WHERE attendance_id = %s AND break_end_at IS NOT NULL
            """,
            (body.attendance_id,),
        )
        total_break_mins = int(dict(total_break_result)["total"]) if total_break_result else 0

        execute(
            conn,
            "UPDATE attendance_records SET break_minutes = %s WHERE id = %s",
            (total_break_mins, body.attendance_id),
        )

        return dict(updated) if updated else {}

    @staticmethod
    async def get_break_status(conn, attendance_id: str, user_id: str, org_id: str) -> dict:
        # Verify ownership
        rec = row(
            conn,
            """
            SELECT id, break_minutes FROM attendance_records
            WHERE id = %s AND user_id = %s AND organisation_id = %s
            """,
            (attendance_id, user_id, org_id),
        )
        if not rec:
            raise HTTPException(status_code=404, detail="Attendance record not found")
        rec = dict(rec)

        # Check for active break
        open_br = row(
            conn,
            "SELECT * FROM break_records WHERE attendance_id = %s AND break_end_at IS NULL",
            (attendance_id,),
        )

        all_brs = rows(
            conn,
            "SELECT * FROM break_records WHERE attendance_id = %s ORDER BY break_start_at ASC",
            (attendance_id,),
        )

        return {
            "on_break": bool(open_br),
            "active_break": dict(open_br) if open_br else None,
            "breaks": [dict(b) for b in all_brs],
            "total_break_minutes": rec.get("break_minutes") or 0,
        }
