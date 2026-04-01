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
from services.supabase_client import get_supabase


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
        org_id: str,
        location_id: Optional[str] = None,
        is_admin: bool = False,
    ) -> list[dict]:
        db = get_supabase()
        q = (
            db.table("shift_templates")
            .select("*, locations(id,name)")
            .eq("organisation_id", org_id)
            .order("created_at", desc=True)
        )
        if is_admin:
            # Admin sees all templates (org-wide + all locations)
            pass
        elif location_id:
            # Manager sees org-wide (null) + their location
            q = q.or_(f"location_id.is.null,location_id.eq.{location_id}")
        resp = q.execute()
        return resp.data or []

    @staticmethod
    async def create_template(body: CreateShiftTemplateRequest, org_id: str, user_id: str) -> dict:
        db = get_supabase()
        data = {
            "organisation_id": org_id,
            "location_id": body.location_id,
            "name": body.name,
            "role": body.role,
            "start_time": body.start_time,
            "end_time": body.end_time,
            "days_of_week": body.days_of_week,
            "is_active": body.is_active,
            "created_by": user_id,
        }
        resp = db.table("shift_templates").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to create shift template")
        return resp.data[0]

    @staticmethod
    async def update_template(template_id: str, org_id: str, body: UpdateShiftTemplateRequest) -> dict:
        db = get_supabase()
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        updates["updated_at"] = _now()
        resp = (
            db.table("shift_templates")
            .update(updates)
            .eq("id", template_id)
            .eq("organisation_id", org_id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Shift template not found")
        return resp.data[0]

    @staticmethod
    async def delete_template(template_id: str, org_id: str) -> None:
        db = get_supabase()
        db.table("shift_templates").update({"is_deleted": True}).eq("id", str(template_id)).eq("organisation_id", org_id).execute()

    @staticmethod
    async def bulk_generate(body: BulkGenerateShiftsRequest, org_id: str, user_id: str) -> dict:
        """Generate draft shifts from a template for every matching day in the date range."""
        db = get_supabase()
        tmpl_resp = (
            db.table("shift_templates")
            .select("*")
            .eq("id", body.template_id)
            .eq("organisation_id", org_id)
            .maybe_single()
            .execute()
        )
        if not tmpl_resp.data:
            raise HTTPException(status_code=404, detail="Shift template not found")
        t = tmpl_resp.data

        start_time = t.get("start_time")
        end_time = t.get("end_time")
        if not start_time or not end_time:
            raise HTTPException(status_code=422, detail="Shift template is missing start_time or end_time.")

        rows = []
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
                rows.append({
                    "organisation_id": org_id,
                    "location_id": location_id,
                    "template_id": t["id"],
                    "role": t.get("role"),
                    "start_at": start_at,
                    "end_at": end_at,
                    "status": "draft",
                    "is_open_shift": False,
                    "ai_generated": False,
                    "created_by": user_id,
                })
            current += timedelta(days=1)

        if not rows:
            return {"shifts_created": 0, "shifts": []}

        try:
            resp = db.table("shifts").insert(rows).execute()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to create shifts: {e}")
        return {"shifts_created": len(resp.data or []), "shifts": resp.data or []}

    # ── Shifts ─────────────────────────────────────────────────────────────────

    @staticmethod
    async def list_shifts(
        org_id: str,
        location_id: Optional[str] = None,
        user_id: Optional[str] = None,
        status: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict:
        db = get_supabase()
        q = (
            db.table("shifts")
            .select(
                "*, profiles!assigned_to_user_id(id,full_name,role), "
                "locations(id,name), "
                "open_shift_claims(id,claimed_by,status,claimed_at,manager_note,profiles!claimed_by(id,full_name))",
                count="exact",
            )
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
        )
        if location_id:
            q = q.eq("location_id", location_id)
        if user_id:
            q = q.eq("assigned_to_user_id", user_id)
        if status:
            q = q.eq("status", status)
        if from_date:
            q = q.gte("start_at", from_date)
        if to_date:
            q = q.lte("start_at", to_date)

        offset = (page - 1) * page_size
        resp = q.order("start_at", desc=False).range(offset, offset + page_size - 1).execute()
        return {"items": resp.data or [], "total_count": resp.count or 0}

    @staticmethod
    async def get_shift(shift_id: str, org_id: str) -> dict:
        db = get_supabase()
        resp = (
            db.table("shifts")
            .select(
                "*, profiles!assigned_to_user_id(id,full_name,role), "
                "locations(id,name), "
                "open_shift_claims(id,claimed_by,status,claimed_at,manager_note,profiles!claimed_by(id,full_name))"
            )
            .eq("id", shift_id)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .maybe_single()
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Shift not found")
        return resp.data

    @staticmethod
    async def create_shift(body: CreateShiftRequest, org_id: str, user_id: str) -> dict:
        db = get_supabase()
        data: dict = {
            "organisation_id": org_id,
            "location_id": body.location_id,
            "role": body.role,
            "start_at": body.start_at,
            "end_at": body.end_at,
            "status": body.status,
            "is_open_shift": body.is_open_shift,
            "created_by": user_id,
        }
        if body.assigned_to_user_id:
            data["assigned_to_user_id"] = body.assigned_to_user_id
        if body.template_id:
            data["template_id"] = body.template_id
        if body.notes:
            data["notes"] = body.notes
        resp = db.table("shifts").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to create shift")
        return resp.data[0]

    @staticmethod
    async def update_shift(shift_id: str, org_id: str, body: UpdateShiftRequest) -> dict:
        db = get_supabase()
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        updates["updated_at"] = _now()
        resp = (
            db.table("shifts")
            .update(updates)
            .eq("id", shift_id)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Shift not found")
        return resp.data[0]

    @staticmethod
    async def delete_shift(shift_id: str, org_id: str) -> None:
        db = get_supabase()
        # Only allow deletion of cancelled shifts
        check = (
            db.table("shifts")
            .select("id,status")
            .eq("id", shift_id)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .maybe_single()
            .execute()
        )
        if not check.data:
            raise HTTPException(status_code=404, detail="Shift not found")
        if check.data.get("status") != "cancelled":
            raise HTTPException(status_code=400, detail="Only cancelled shifts can be deleted")
        db.table("shifts").update({"is_deleted": True, "updated_at": _now()}).eq("id", shift_id).eq("organisation_id", org_id).execute()

    @staticmethod
    async def publish_shifts(shift_ids: list[str], org_id: str) -> dict:
        db = get_supabase()
        # Fetch shifts to validate and split into open vs assigned
        shifts_resp = (
            db.table("shifts")
            .select("id,assigned_to_user_id,is_open_shift")
            .in_("id", shift_ids)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .execute()
        )
        shifts = shifts_resp.data or []
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
        if assigned_ids:
            r = (
                db.table("shifts")
                .update({"status": "published", "updated_at": _now()})
                .in_("id", assigned_ids)
                .eq("organisation_id", org_id)
                .eq("is_deleted", False)
                .execute()
            )
            published += len(r.data or [])
        if open_ids:
            r = (
                db.table("shifts")
                .update({"status": "open", "updated_at": _now()})
                .in_("id", open_ids)
                .eq("organisation_id", org_id)
                .eq("is_deleted", False)
                .execute()
            )
            published += len(r.data or [])
        return {"published": published}

    @staticmethod
    async def assign_bulk(assignments: list, org_id: str) -> dict:
        """Bulk-assign staff to draft shifts (or mark as open shifts)."""
        db = get_supabase()
        updated = 0
        for a in assignments:
            updates: dict = {"updated_at": _now()}
            if a.is_open_shift:
                updates["is_open_shift"] = True
                updates["assigned_to_user_id"] = None
            else:
                updates["is_open_shift"] = False
                updates["assigned_to_user_id"] = a.user_id or None
            db.table("shifts").update(updates).eq("id", a.shift_id).eq("organisation_id", org_id).execute()
            updated += 1
        return {"updated": updated}

    @staticmethod
    async def publish_bulk(
        org_id: str,
        filter_type: str,
        location_id: Optional[str] = None,
        role: Optional[str] = None,
        user_id: Optional[str] = None,
        week_start: Optional[str] = None,
        week_end: Optional[str] = None,
    ) -> dict:
        db = get_supabase()
        q = (
            db.table("shifts")
            .select("id")
            .eq("organisation_id", org_id)
            .eq("status", "draft")
            .eq("is_deleted", False)
        )
        if week_start:
            q = q.gte("start_at", f"{week_start}T00:00:00")
        if week_end:
            q = q.lte("start_at", f"{week_end}T23:59:59")
        if filter_type == "location" and location_id:
            q = q.eq("location_id", location_id)
        elif filter_type == "role" and role:
            q = q.eq("role", role)
        elif filter_type == "individual" and user_id:
            q = q.eq("assigned_to_user_id", user_id)
        fetch = q.execute()
        ids = [r["id"] for r in (fetch.data or [])]
        if not ids:
            return {"published": 0}
        resp = (
            db.table("shifts")
            .update({"status": "published", "updated_at": _now()})
            .in_("id", ids)
            .eq("organisation_id", org_id)
            .execute()
        )
        return {"published": len(resp.data or [])}

    # ── Open Shifts ─────────────────────────────────────────────────────────────

    @staticmethod
    async def claim_shift(shift_id: str, user_id: str, org_id: str) -> dict:
        db = get_supabase()
        # Verify shift is open/published + belongs to org
        shift_resp = (
            db.table("shifts")
            .select("id,status,is_open_shift,organisation_id")
            .eq("id", shift_id)
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .maybe_single()
            .execute()
        )
        if not shift_resp.data:
            raise HTTPException(status_code=404, detail="Shift not found")
        shift = shift_resp.data
        if not shift.get("is_open_shift"):
            raise HTTPException(status_code=400, detail="Shift is not open for claiming")
        if shift["status"] not in ("published", "open"):
            raise HTTPException(status_code=400, detail="Shift is not available for claiming")

        # Mark shift as open if still published
        if shift["status"] == "published":
            db.table("shifts").update({"status": "open", "updated_at": _now()}).eq("id", shift_id).execute()

        try:
            resp = db.table("open_shift_claims").insert({
                "shift_id": shift_id,
                "claimed_by": user_id,
                "status": "pending",
            }).execute()
        except Exception as exc:
            raise HTTPException(status_code=409, detail="You have already claimed this shift") from exc

        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to claim shift")
        claim = resp.data[0]

        # Notify managers at the shift's location
        try:
            # Fetch the shift's location_id and start_at, plus claimant's name
            shift_info = (
                db.table("shifts")
                .select("location_id, start_at")
                .eq("id", shift_id)
                .maybe_single()
                .execute()
            )
            claimant_info = (
                db.table("profiles")
                .select("full_name")
                .eq("id", user_id)
                .maybe_single()
                .execute()
            )
            loc_id = (shift_info.data or {}).get("location_id")
            start_at = (shift_info.data or {}).get("start_at", "")
            claimant_name = (claimant_info.data or {}).get("full_name", "A team member")
            shift_date = start_at[:10] if start_at else ""
            shift_time = start_at[11:16] if len(start_at) > 16 else ""
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
    async def list_claims(org_id: str, shift_id: Optional[str] = None, status: Optional[str] = None) -> list[dict]:
        db = get_supabase()
        # Join through shifts to filter by org
        shift_ids_resp = (
            db.table("shifts")
            .select("id")
            .eq("organisation_id", org_id)
            .eq("is_deleted", False)
            .execute()
        )
        org_shift_ids = [r["id"] for r in (shift_ids_resp.data or [])]
        if not org_shift_ids:
            return []

        q = (
            db.table("open_shift_claims")
            .select("*, profiles!claimed_by(id,full_name), shifts(id,start_at,end_at,role,location_id,locations(name))")
            .in_("shift_id", org_shift_ids)
        )
        if shift_id:
            q = q.eq("shift_id", shift_id)
        if status:
            q = q.eq("status", status)
        resp = q.order("claimed_at", desc=True).execute()
        return resp.data or []

    @staticmethod
    async def respond_to_claim(claim_id: str, action: str, manager_note: Optional[str], org_id: str, manager_id: str) -> dict:
        db = get_supabase()
        claim_resp = (
            db.table("open_shift_claims")
            .select("*, shifts(id,organisation_id)")
            .eq("id", claim_id)
            .maybe_single()
            .execute()
        )
        if not claim_resp.data:
            raise HTTPException(status_code=404, detail="Claim not found")
        claim = claim_resp.data
        if (claim.get("shifts") or {}).get("organisation_id") != org_id:
            raise HTTPException(status_code=403, detail="Not authorized")

        now = _now()
        if action == "approve":
            # Approve this claim
            db.table("open_shift_claims").update({
                "status": "approved",
                "responded_at": now,
                "manager_note": manager_note,
            }).eq("id", claim_id).execute()

            # Assign shift to the claimer and mark as claimed
            shift_id = claim["shift_id"]
            db.table("shifts").update({
                "assigned_to_user_id": claim["claimed_by"],
                "status": "claimed",
                "updated_at": now,
            }).eq("id", shift_id).execute()

            # Reject all other pending claims for this shift
            db.table("open_shift_claims").update({
                "status": "rejected",
                "responded_at": now,
                "manager_note": "Another applicant was selected.",
            }).eq("shift_id", shift_id).neq("id", claim_id).eq("status", "pending").execute()

        elif action == "reject":
            db.table("open_shift_claims").update({
                "status": "rejected",
                "responded_at": now,
                "manager_note": manager_note,
            }).eq("id", claim_id).execute()
        else:
            raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

        # Return updated claim
        updated = db.table("open_shift_claims").select("*").eq("id", claim_id).maybe_single().execute()
        return updated.data or {}

    # ── Swap Requests ───────────────────────────────────────────────────────────

    @staticmethod
    async def create_swap_request(body: CreateSwapRequest, user_id: str, org_id: str) -> dict:
        db = get_supabase()
        # Verify shift belongs to user & org
        shift_resp = (
            db.table("shifts")
            .select("id,assigned_to_user_id,organisation_id")
            .eq("id", body.shift_id)
            .eq("organisation_id", org_id)
            .eq("assigned_to_user_id", user_id)
            .eq("is_deleted", False)
            .maybe_single()
            .execute()
        )
        if not shift_resp.data:
            raise HTTPException(status_code=404, detail="Shift not found or not assigned to you")

        data: dict = {
            "organisation_id": org_id,
            "requested_by": user_id,
            "shift_id": body.shift_id,
            "status": "pending_colleague",
        }
        if body.target_user_id:
            data["target_user_id"] = body.target_user_id
        if body.target_shift_id:
            data["target_shift_id"] = body.target_shift_id

        resp = db.table("shift_swap_requests").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to create swap request")
        swap = resp.data[0]

        # Notify the target colleague if specified
        try:
            if body.target_user_id:
                requester_info = (
                    db.table("profiles")
                    .select("full_name")
                    .eq("id", user_id)
                    .maybe_single()
                    .execute()
                )
                requester_name = (requester_info.data or {}).get("full_name", "A teammate")
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
    async def respond_to_swap(swap_id: str, action: str, user_id: str, org_id: str, reason: Optional[str] = None) -> dict:
        db = get_supabase()
        swap_resp = (
            db.table("shift_swap_requests")
            .select("*")
            .eq("id", swap_id)
            .eq("organisation_id", org_id)
            .maybe_single()
            .execute()
        )
        if not swap_resp.data:
            raise HTTPException(status_code=404, detail="Swap request not found")
        swap = swap_resp.data
        now = _now()

        if action in ("accept", "decline"):
            # Colleague response
            if swap.get("target_user_id") and swap["target_user_id"] != user_id:
                raise HTTPException(status_code=403, detail="Not the targeted colleague")
            if swap["status"] != "pending_colleague":
                raise HTTPException(status_code=400, detail="Swap is not awaiting colleague response")
            if action == "accept":
                db.table("shift_swap_requests").update({
                    "status": "pending_manager",
                    "colleague_response_at": now,
                    "updated_at": now,
                }).eq("id", swap_id).execute()

                # When colleague approves, notify managers for final approval
                try:
                    req_info = db.table("profiles").select("full_name").eq("id", swap["requested_by"]).maybe_single().execute()
                    col_info = db.table("profiles").select("full_name, location_id").eq("id", user_id).maybe_single().execute()
                    req_name = (req_info.data or {}).get("full_name", "Staff")
                    col_name = (col_info.data or {}).get("full_name", "colleague")
                    loc_id = (col_info.data or {}).get("location_id")
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
                db.table("shift_swap_requests").update({
                    "status": "rejected",
                    "colleague_response_at": now,
                    "rejection_reason": reason,
                    "updated_at": now,
                }).eq("id", swap_id).execute()

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

                db.table("shifts").update({"assigned_to_user_id": user_b, "updated_at": now}).eq("id", shift_a).execute()
                if shift_b and user_b:
                    db.table("shifts").update({"assigned_to_user_id": user_a, "updated_at": now}).eq("id", shift_b).execute()

                db.table("shift_swap_requests").update({
                    "status": "approved",
                    "manager_response_at": now,
                    "approved_by": user_id,
                    "updated_at": now,
                }).eq("id", swap_id).execute()
            else:
                db.table("shift_swap_requests").update({
                    "status": "rejected",
                    "manager_response_at": now,
                    "rejection_reason": reason,
                    "updated_at": now,
                }).eq("id", swap_id).execute()
        else:
            raise HTTPException(status_code=400, detail="action must be 'accept', 'decline', 'approve', or 'reject'")

        updated = db.table("shift_swap_requests").select("*").eq("id", swap_id).maybe_single().execute()
        return updated.data or {}

    @staticmethod
    async def list_swap_requests(org_id: str, user_id: Optional[str] = None, status: Optional[str] = None) -> list[dict]:
        db = get_supabase()
        q = (
            db.table("shift_swap_requests")
            .select(
                "*, "
                "profiles!requested_by(id,full_name), "
                "shifts!shift_id(id,start_at,end_at,role), "
                "target_profile:profiles!target_user_id(id,full_name)"
            )
            .eq("organisation_id", org_id)
        )
        if user_id:
            # show requests involving this user (requester or target)
            q = q.or_(f"requested_by.eq.{user_id},target_user_id.eq.{user_id}")
        if status:
            q = q.eq("status", status)
        resp = q.order("created_at", desc=True).execute()
        return resp.data or []

    # ── Leave ───────────────────────────────────────────────────────────────────

    @staticmethod
    async def create_leave_request(body: CreateLeaveRequest, user_id: str, org_id: str) -> dict:
        db = get_supabase()
        if body.end_date < body.start_date:
            raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
        data = {
            "user_id": user_id,
            "organisation_id": org_id,
            "leave_type": body.leave_type,
            "start_date": body.start_date.isoformat(),
            "end_date": body.end_date.isoformat(),
            "reason": body.reason,
            "status": "pending",
        }
        resp = db.table("leave_requests").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to create leave request")
        leave = resp.data[0]

        # Notify the user's manager
        try:
            user_info = (
                db.table("profiles")
                .select("full_name")
                .eq("id", user_id)
                .maybe_single()
                .execute()
            )
            user_name = (user_info.data or {}).get("full_name", "A team member")
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
        org_id: str,
        user_id: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        db = get_supabase()
        q = (
            db.table("leave_requests")
            .select("*, profiles!user_id(id,full_name)", count="exact")
            .eq("organisation_id", org_id)
        )
        if user_id:
            q = q.eq("user_id", user_id)
        if status:
            q = q.eq("status", status)
        offset = (page - 1) * page_size
        resp = q.order("created_at", desc=True).range(offset, offset + page_size - 1).execute()
        return {"items": resp.data or [], "total_count": resp.count or 0}

    @staticmethod
    async def respond_to_leave(leave_id: str, action: str, manager_id: str, org_id: str) -> dict:
        db = get_supabase()
        leave_resp = (
            db.table("leave_requests")
            .select("id,status")
            .eq("id", leave_id)
            .eq("organisation_id", org_id)
            .maybe_single()
            .execute()
        )
        if not leave_resp.data:
            raise HTTPException(status_code=404, detail="Leave request not found")
        if leave_resp.data["status"] != "pending":
            raise HTTPException(status_code=400, detail="Leave request is not pending")
        if action not in ("approve", "reject"):
            raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

        new_status = "approved" if action == "approve" else "rejected"
        resp = (
            db.table("leave_requests")
            .update({
                "status": new_status,
                "approved_by": manager_id,
                "responded_at": _now(),
                "updated_at": _now(),
            })
            .eq("id", leave_id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to update leave request")
        return resp.data[0]

    # ── Availability ────────────────────────────────────────────────────────────

    @staticmethod
    async def get_availability(user_id: str, org_id: str) -> list[dict]:
        db = get_supabase()
        resp = (
            db.table("staff_availability")
            .select("*")
            .eq("user_id", user_id)
            .eq("organisation_id", org_id)
            .order("day_of_week", desc=False)
            .execute()
        )
        return resp.data or []

    @staticmethod
    async def set_availability(body: SetAvailabilityRequest, user_id: str, org_id: str) -> dict:
        db = get_supabase()
        data: dict = {
            "user_id": user_id,
            "organisation_id": org_id,
            "day_of_week": body.day_of_week,
            "available_from": body.available_from,
            "available_to": body.available_to,
            "is_available": body.is_available,
            "updated_at": _now(),
        }
        if body.effective_from:
            data["effective_from"] = body.effective_from
        if body.effective_to:
            data["effective_to"] = body.effective_to

        resp = db.table("staff_availability").upsert(data, on_conflict="user_id,day_of_week").execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to set availability")
        return resp.data[0]

    # ── Attendance ──────────────────────────────────────────────────────────────

    @staticmethod
    async def clock_in(body: ClockInRequest, user_id: str, org_id: str) -> dict:
        db = get_supabase()

        # Check no active clock-in from the last 24 hours.
        # Records older than 24 h with no clock-out are treated as abandoned
        # so they don't permanently block the user (matches frontend today-only view).
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        active_resp = (
            db.table("attendance_records")
            .select("id")
            .eq("user_id", user_id)
            .eq("organisation_id", org_id)
            .is_("clock_out_at", "null")
            .not_.is_("clock_in_at", "null")
            .gte("clock_in_at", cutoff)
            .execute()
        )
        if active_resp.data:
            raise HTTPException(status_code=400, detail="You are already clocked in. Clock out first.")

        # Fetch attendance rules for late detection
        rules_resp = (
            db.table("attendance_rules")
            .select("late_threshold_mins")
            .eq("organisation_id", org_id)
            .maybe_single()
            .execute()
        )
        late_threshold = (rules_resp.data or {}).get("late_threshold_mins", 15)

        # Geo-fence validation
        geo_valid: Optional[bool] = None
        if body.latitude is not None and body.longitude is not None:
            loc_resp = (
                db.table("locations")
                .select("latitude,longitude,geo_fence_radius_meters")
                .eq("id", body.location_id)
                .maybe_single()
                .execute()
            )
            if loc_resp.data:
                loc = loc_resp.data
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
            shift_resp = (
                db.table("shifts")
                .select("start_at")
                .eq("id", body.shift_id)
                .maybe_single()
                .execute()
            )
            if shift_resp.data:
                shift_start = datetime.fromisoformat(shift_resp.data["start_at"].replace("Z", "+00:00"))
                now_dt = datetime.now(timezone.utc)
                if now_dt > shift_start + timedelta(minutes=late_threshold):
                    status = "late"

        record_data: dict = {
            "user_id": user_id,
            "organisation_id": org_id,
            "location_id": body.location_id,
            "clock_in_at": _now(),
            "clock_in_method": body.clock_in_method,
            "status": status,
        }
        if body.shift_id:
            record_data["shift_id"] = body.shift_id
        if body.latitude is not None:
            record_data["clock_in_latitude"] = body.latitude
        if body.longitude is not None:
            record_data["clock_in_longitude"] = body.longitude
        if geo_valid is not None:
            record_data["clock_in_geo_valid"] = geo_valid

        resp = db.table("attendance_records").insert(record_data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to clock in")
        return resp.data[0]

    @staticmethod
    async def clock_out(body: ClockOutRequest, user_id: str, org_id: str) -> dict:
        db = get_supabase()

        record_resp = (
            db.table("attendance_records")
            .select("*, shifts(start_at,end_at)")
            .eq("id", body.attendance_id)
            .eq("user_id", user_id)
            .eq("organisation_id", org_id)
            .maybe_single()
            .execute()
        )
        if not record_resp.data:
            raise HTTPException(status_code=404, detail="Attendance record not found")
        record = record_resp.data
        if record.get("clock_out_at"):
            raise HTTPException(status_code=400, detail="Already clocked out")

        rules_resp = (
            db.table("attendance_rules")
            .select("early_departure_threshold_mins,overtime_threshold_hours,break_duration_mins")
            .eq("organisation_id", org_id)
            .maybe_single()
            .execute()
        )
        rules = rules_resp.data or {}
        early_thresh = rules.get("early_departure_threshold_mins", 15)
        ot_thresh_hours = float(rules.get("overtime_threshold_hours", 8))
        break_mins = int(rules.get("break_duration_mins", 30))

        now_dt = datetime.now(timezone.utc)
        clock_in_dt = datetime.fromisoformat(record["clock_in_at"].replace("Z", "+00:00"))
        total_minutes = int((now_dt - clock_in_dt).total_seconds() / 60)
        worked_minutes = max(0, total_minutes - break_mins)
        ot_threshold_mins = int(ot_thresh_hours * 60)
        overtime_minutes = max(0, worked_minutes - ot_threshold_mins)

        new_status = record.get("status", "present")
        shift = record.get("shifts")
        if shift and new_status not in ("late", "unverified"):
            shift_end = datetime.fromisoformat(shift["end_at"].replace("Z", "+00:00"))
            if now_dt < shift_end - timedelta(minutes=early_thresh):
                new_status = "early_departure"

        updates: dict = {
            "clock_out_at": now_dt.isoformat(),
            "total_minutes": total_minutes,
            "overtime_minutes": overtime_minutes,
            "break_minutes": break_mins,
            "status": new_status,
            "updated_at": _now(),
        }

        resp = (
            db.table("attendance_records")
            .update(updates)
            .eq("id", body.attendance_id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to clock out")
        return resp.data[0]

    @staticmethod
    async def list_attendance(
        org_id: str,
        user_id: Optional[str] = None,
        location_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict:
        db = get_supabase()
        q = (
            db.table("attendance_records")
            .select(
                "*, profiles!user_id(id,full_name), "
                "shifts!shift_id(id,start_at,end_at,role)",
                count="exact",
            )
            .eq("organisation_id", org_id)
        )
        if user_id:
            q = q.eq("user_id", user_id)
        if location_id:
            q = q.eq("location_id", location_id)
        if from_date:
            q = q.gte("clock_in_at", from_date)
        if to_date:
            q = q.lte("clock_in_at", to_date)
        if status:
            q = q.eq("status", status)
        offset = (page - 1) * page_size
        resp = q.order("clock_in_at", desc=True).range(offset, offset + page_size - 1).execute()
        return {"items": resp.data or [], "total_count": resp.count or 0}

    @staticmethod
    async def manager_override(body: ManagerOverrideRequest, org_id: str, manager_id: str) -> dict:
        db = get_supabase()

        clock_in_dt = datetime.fromisoformat(body.clock_in_at.replace("Z", "+00:00"))
        total_minutes: Optional[int] = None
        if body.clock_out_at:
            clock_out_dt = datetime.fromisoformat(body.clock_out_at.replace("Z", "+00:00"))
            total_minutes = int((clock_out_dt - clock_in_dt).total_seconds() / 60)

        data: dict = {
            "user_id": body.user_id,
            "organisation_id": org_id,
            "location_id": body.location_id,
            "clock_in_at": body.clock_in_at,
            "clock_in_method": "manager_override",
            "clock_in_geo_valid": True,
            "status": "present",
            "manager_override_note": body.note,
        }
        if body.shift_id:
            data["shift_id"] = body.shift_id
        if body.clock_out_at:
            data["clock_out_at"] = body.clock_out_at
        if total_minutes is not None:
            data["total_minutes"] = total_minutes

        resp = db.table("attendance_records").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to create attendance override")
        return resp.data[0]

    # ── Rules ───────────────────────────────────────────────────────────────────

    @staticmethod
    async def get_attendance_rules(org_id: str) -> dict:
        db = get_supabase()
        resp = (
            db.table("attendance_rules")
            .select("*")
            .eq("organisation_id", org_id)
            .maybe_single()
            .execute()
        )
        if not resp.data:
            # Return defaults if not yet configured
            return {
                "organisation_id": org_id,
                "late_threshold_mins": 15,
                "early_departure_threshold_mins": 15,
                "overtime_threshold_hours": 8.0,
                "weekly_overtime_threshold_hours": None,   # optional — null means not tracked
                "break_duration_mins": 30,
            }
        return resp.data

    @staticmethod
    async def update_attendance_rules(body: UpdateAttendanceRulesRequest, org_id: str) -> dict:
        db = get_supabase()
        # exclude_unset so we only touch fields the caller actually sent
        updates = body.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        updates["organisation_id"] = org_id
        updates["updated_at"] = _now()
        resp = db.table("attendance_rules").upsert(updates, on_conflict="organisation_id").execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to update attendance rules")
        return resp.data[0]

    # ── Timesheet Summary ───────────────────────────────────────────────────────

    @staticmethod
    async def get_timesheet_summary(
        org_id: str,
        user_id: Optional[str] = None,
        week_start: Optional[str] = None,
    ) -> list[dict]:
        db = get_supabase()

        if not week_start:
            today = date.today()
            # Monday of current week
            week_start_dt = today - timedelta(days=today.weekday())
        else:
            week_start_dt = date.fromisoformat(week_start)

        week_end_dt = week_start_dt + timedelta(days=6)
        from_iso = f"{week_start_dt}T00:00:00+00:00"
        to_iso = f"{week_end_dt}T23:59:59+00:00"

        q = (
            db.table("attendance_records")
            .select("user_id,status,total_minutes,break_minutes,overtime_minutes,profiles!user_id(id,full_name)")
            .eq("organisation_id", org_id)
            .gte("clock_in_at", from_iso)
            .lte("clock_in_at", to_iso)
        )
        if user_id:
            q = q.eq("user_id", user_id)

        resp = q.execute()
        records = resp.data or []

        # Also get total shifts in the same period to count shift_count
        sq = (
            db.table("shifts")
            .select("id,assigned_to_user_id")
            .eq("organisation_id", org_id)
            .gte("start_at", from_iso)
            .lte("start_at", to_iso)
            .eq("is_deleted", False)
            .neq("status", "cancelled")
        )
        if user_id:
            sq = sq.eq("assigned_to_user_id", user_id)
        shift_resp = sq.execute()
        shift_counts: dict[str, int] = {}
        for s in (shift_resp.data or []):
            uid = s.get("assigned_to_user_id")
            if uid:
                shift_counts[uid] = shift_counts.get(uid, 0) + 1

        # Aggregate by user
        user_map: dict[str, dict] = {}
        for r in records:
            uid = r["user_id"]
            profile = r.get("profiles") or {}
            if uid not in user_map:
                user_map[uid] = {
                    "user_id": uid,
                    "full_name": profile.get("full_name", "Unknown"),
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
    async def get_my_timesheet(user_id: str, org_id: str, week_start: Optional[str] = None) -> dict:
        db = get_supabase()
        if not week_start:
            today = date.today()
            week_start_dt = today - timedelta(days=today.weekday())
        else:
            week_start_dt = date.fromisoformat(week_start)
        week_end_dt = week_start_dt + timedelta(days=6)
        from_iso = f"{week_start_dt}T00:00:00+00:00"
        to_iso = f"{week_end_dt}T23:59:59+00:00"

        resp = (
            db.table("attendance_records")
            .select("*, shifts!shift_id(id,start_at,end_at,role)")
            .eq("user_id", user_id)
            .eq("organisation_id", org_id)
            .gte("clock_in_at", from_iso)
            .lte("clock_in_at", to_iso)
            .order("clock_in_at", desc=False)
            .execute()
        )
        records = resp.data or []

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
    async def generate_schedule(body: GenerateScheduleRequest, org_id: str, user_id: str) -> dict:
        from routes.ai_generate import _call_claude

        db = get_supabase()

        week_end = body.week_start + timedelta(days=6)
        from_iso = f"{body.week_start}T00:00:00+00:00"
        to_iso = f"{week_end}T23:59:59+00:00"

        # Gather staff at location
        staff_resp = (
            db.table("profiles")
            .select("id,full_name,role")
            .eq("organisation_id", org_id)
            .eq("location_id", body.location_id)
            .eq("is_deleted", False)
            .eq("is_active", True)
            .execute()
        )
        staff_list = staff_resp.data or []

        # Check if staff availability tracking is enabled for this org
        org_resp = (
            db.table("organisations")
            .select("feature_flags")
            .eq("id", org_id)
            .maybe_single()
            .execute()
        )
        org_flags = ((org_resp.data if org_resp else None) or {}).get("feature_flags") or {}
        availability_enabled = org_flags.get("staff_availability_enabled", False)

        # Gather their availability (only when tracking is enabled)
        staff_ids = [s["id"] for s in staff_list]
        availability_by_user: dict[str, list] = {}
        if availability_enabled and staff_ids:
            avail_resp = (
                db.table("staff_availability")
                .select("user_id,day_of_week,available_from,available_to,is_available")
                .in_("user_id", staff_ids)
                .eq("is_available", True)
                .execute()
            )
            for a in (avail_resp.data or []):
                availability_by_user.setdefault(a["user_id"], []).append(a)

        # Existing shifts for the week
        existing_resp = (
            db.table("shifts")
            .select("assigned_to_user_id,start_at,end_at,status")
            .eq("organisation_id", org_id)
            .eq("location_id", body.location_id)
            .gte("start_at", from_iso)
            .lte("start_at", to_iso)
            .eq("is_deleted", False)
            .execute()
        )
        existing_shifts = existing_resp.data or []

        # Location info
        loc_resp = (
            db.table("locations")
            .select("name")
            .eq("id", body.location_id)
            .maybe_single()
            .execute()
        )
        location_name = (loc_resp.data or {}).get("name", "the location")

        # Build prompt
        staff_context = json.dumps([
            {
                "id": s["id"],
                "name": s["full_name"],
                "role": s["role"],
                "availability": availability_by_user.get(s["id"], []),
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

            rows_to_insert.append({
                "organisation_id": org_id,
                "location_id": body.location_id,
                "assigned_to_user_id": user_id_in,
                "role": item.get("role"),
                "start_at": start.isoformat(),
                "end_at": end.isoformat(),
                "status": "draft",
                "is_open_shift": False,
                "ai_generated": True,
                "created_by": user_id,
            })

        shifts_created = 0
        if rows_to_insert:
            insert_resp = db.table("shifts").insert(rows_to_insert).execute()
            shifts_created = len(insert_resp.data or [])

        # Log the AI job
        db.table("ai_schedule_jobs").insert({
            "organisation_id": org_id,
            "location_id": body.location_id,
            "created_by": user_id,
            "week_start": body.week_start.isoformat(),
            "notes": body.notes,
            "shifts_created": shifts_created,
            "warnings": warnings,
            "status": "completed",
        }).execute()

        return {"shifts_created": shifts_created, "warnings": warnings}

    # ── Breaks ───────────────────────────────────────────────────────────────────

    @staticmethod
    async def start_break(body: StartBreakRequest, user_id: str, org_id: str) -> dict:
        db = get_supabase()

        # Verify the attendance record belongs to this user and is active
        rec = (
            db.table("attendance_records")
            .select("id,clock_out_at")
            .eq("id", body.attendance_id)
            .eq("user_id", user_id)
            .eq("organisation_id", org_id)
            .maybe_single()
            .execute()
        )
        rec_data = rec.data if rec else None
        if not rec_data:
            raise HTTPException(status_code=404, detail="Attendance record not found")
        if rec_data.get("clock_out_at"):
            raise HTTPException(status_code=400, detail="Shift already clocked out")

        # Check no open break exists
        open_break = (
            db.table("break_records")
            .select("id")
            .eq("attendance_id", body.attendance_id)
            .is_("break_end_at", "null")
            .maybe_single()
            .execute()
        )
        open_break_data = open_break.data if open_break else None
        if open_break_data:
            raise HTTPException(status_code=400, detail="A break is already in progress")

        now = _now()
        result = (
            db.table("break_records")
            .insert({
                "attendance_id": body.attendance_id,
                "organisation_id": org_id,
                "user_id": user_id,
                "break_start_at": now,
                "break_type": body.break_type,
            })
            .execute()
        )
        return result.data[0] if result.data else {}

    @staticmethod
    async def end_break(body: EndBreakRequest, user_id: str, org_id: str) -> dict:
        db = get_supabase()

        # Find the open break for this attendance record
        open_break = (
            db.table("break_records")
            .select("*")
            .eq("attendance_id", body.attendance_id)
            .eq("user_id", user_id)
            .is_("break_end_at", "null")
            .maybe_single()
            .execute()
        )
        br = (open_break.data if open_break else None)
        if not br:
            raise HTTPException(status_code=404, detail="No active break found")
        now_dt = datetime.now(timezone.utc)
        start_dt = datetime.fromisoformat(br["break_start_at"].replace("Z", "+00:00"))
        duration = max(0, int((now_dt - start_dt).total_seconds() / 60))
        now = now_dt.isoformat()

        # Update the break record
        updated = (
            db.table("break_records")
            .update({
                "break_end_at": now,
                "duration_minutes": duration,
            })
            .eq("id", br["id"])
            .execute()
        )

        # Recalculate total break_minutes on attendance_record
        all_breaks = (
            db.table("break_records")
            .select("duration_minutes")
            .eq("attendance_id", body.attendance_id)
            .not_.is_("break_end_at", "null")
            .execute()
        )
        total_break_mins = sum((b.get("duration_minutes") or 0) for b in (all_breaks.data or []))
        db.table("attendance_records").update({
            "break_minutes": total_break_mins,
        }).eq("id", body.attendance_id).execute()

        return updated.data[0] if updated.data else {}

    @staticmethod
    async def get_break_status(attendance_id: str, user_id: str, org_id: str) -> dict:
        db = get_supabase()

        # Verify ownership
        rec = (
            db.table("attendance_records")
            .select("id,break_minutes")
            .eq("id", attendance_id)
            .eq("user_id", user_id)
            .eq("organisation_id", org_id)
            .maybe_single()
            .execute()
        )
        rec_data = rec.data if rec else None
        if not rec_data:
            raise HTTPException(status_code=404, detail="Attendance record not found")

        # Check for active break
        open_break = (
            db.table("break_records")
            .select("*")
            .eq("attendance_id", attendance_id)
            .is_("break_end_at", "null")
            .maybe_single()
            .execute()
        )
        open_break_data = open_break.data if open_break else None

        all_breaks = (
            db.table("break_records")
            .select("*")
            .eq("attendance_id", attendance_id)
            .order("break_start_at", desc=False)
            .execute()
        )

        return {
            "on_break": bool(open_break_data),
            "active_break": open_break_data,
            "breaks": all_breaks.data or [],
            "total_break_minutes": rec_data.get("break_minutes") or 0,
        }
