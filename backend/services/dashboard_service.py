from datetime import datetime, timezone, date as date_cls, timedelta
from typing import Optional
from fastapi import HTTPException
from services.supabase_client import get_supabase


class DashboardService:
    @staticmethod
    async def get_summary(
        org_id: str,
        location_id: Optional[str] = None,
        from_dt: Optional[datetime] = None,
        to_dt: Optional[datetime] = None,
        role: str = "manager",
        user_location_id: Optional[str] = None,
    ) -> dict:
        supabase = get_supabase()

        try:
            # --- Form assignments (all active, no date filter — show real totals) ---
            assignments_query = (
                supabase.table("form_assignments")
                .select("id", count="exact")
                .eq("organisation_id", str(org_id))
                .eq("is_deleted", False)
                .eq("is_active", True)
            )
            if location_id:
                assignments_query = assignments_query.eq(
                    "assigned_to_location_id", str(location_id)
                )

            assignments_resp = assignments_query.execute()
            total_assignments = (
                assignments_resp.count if assignments_resp.count is not None else 0
            )

            # --- Completed submissions: submitted + approved + rejected ---
            # (date filter applies to when they were submitted)
            submissions_query = (
                supabase.table("form_submissions")
                .select("id,assignment_id,form_assignments!inner(organisation_id)", count="exact")
                .in_("status", ["submitted", "approved", "rejected"])
                .eq("form_assignments.organisation_id", str(org_id))
            )
            if from_dt:
                submissions_query = submissions_query.gte("submitted_at", from_dt.isoformat())
            if to_dt:
                submissions_query = submissions_query.lte("submitted_at", to_dt.isoformat())

            submissions_resp = submissions_query.execute()
            total_submitted = (
                submissions_resp.count if submissions_resp.count is not None else 0
            )

            # Completion rate
            completion_rate = (
                round(total_submitted / total_assignments, 4)
                if total_assignments > 0
                else 0.0
            )

            # Pending = submitted (awaiting manager review)
            pending_count = sum(
                1 for row in submissions_resp.data if row.get("status") == "submitted"
            )

            # --- Announcements ---
            announcements_query = (
                supabase.table("announcements")
                .select("id", count="exact")
                .eq("organisation_id", str(org_id))
                .eq("is_deleted", False)
            )
            if from_dt:
                announcements_query = announcements_query.gte(
                    "created_at", from_dt.isoformat()
                )
            if to_dt:
                announcements_query = announcements_query.lte(
                    "created_at", to_dt.isoformat()
                )

            announcements_resp = announcements_query.execute()
            total_announcements = (
                announcements_resp.count if announcements_resp.count is not None else 0
            )

            # --- Announcement engagement (scoped to org via announcement join) ---
            receipts_resp = (
                supabase.table("announcement_receipts")
                .select("read_at,announcements!inner(organisation_id)", count="exact")
                .eq("announcements.organisation_id", str(org_id))
                .execute()
            )
            total_receipts = (
                receipts_resp.count if receipts_resp.count is not None else 0
            )
            read_receipts = sum(
                1 for r in receipts_resp.data if r.get("read_at") is not None
            )
            engagement_rate = (
                round(read_receipts / total_receipts, 4) if total_receipts > 0 else 0.0
            )

            # --- Audit compliance rate (% of audit submissions that passed) ---
            audit_submissions_resp = (
                supabase.table("form_submissions")
                .select("id,passed,form_templates!inner(type),form_assignments!inner(organisation_id)")
                .in_("status", ["submitted", "approved", "rejected"])
                .eq("form_assignments.organisation_id", str(org_id))
                .eq("form_templates.type", "audit")
                .execute()
            )
            audit_rows = audit_submissions_resp.data or []
            total_audit_submissions = len(audit_rows)
            passed_audit_submissions = sum(1 for r in audit_rows if r.get("passed") is True)
            audit_compliance_rate = (
                round(passed_audit_submissions / total_audit_submissions, 4)
                if total_audit_submissions > 0
                else None
            )

            # --- Attendance (manager / admin only, always today) ---
            attendance_data = None
            if role in ("manager", "admin", "super_admin"):
                today = date_cls.today()
                today_start = f"{today.isoformat()}T00:00:00"
                today_end = f"{today.isoformat()}T23:59:59"
                now_utc = datetime.now(timezone.utc)

                # Late threshold
                rules_resp = (
                    supabase.table("attendance_rules")
                    .select("late_threshold_mins")
                    .eq("organisation_id", str(org_id))
                    .execute()
                )
                late_threshold = 15  # default: 15 minutes when no attendance_rules row exists
                if rules_resp.data:
                    late_threshold = rules_resp.data[0].get("late_threshold_mins") or 15

                # Today's published, assigned shifts
                shifts_query = (
                    supabase.table("shifts")
                    .select("id,location_id,assigned_to_user_id,start_at,end_at,locations(id,name)")
                    .eq("organisation_id", str(org_id))
                    .eq("status", "published")
                    .not_.is_("assigned_to_user_id", "null")
                    .gte("start_at", today_start)
                    .lte("start_at", today_end)
                )
                if role == "manager" and user_location_id:
                    shifts_query = shifts_query.eq("location_id", str(user_location_id))

                shifts_resp = shifts_query.execute()
                shifts_today = shifts_resp.data or []

                # Today's attendance records
                # Fetch all attendance for the org today — do NOT filter by location_id here.
                # Reason: staff users may have clocked in with a null/empty location_id on
                # their attendance record (e.g. web clock-in when app_metadata.location_id
                # was not set). Location scoping is already enforced by the shifts query
                # above (shifts are filtered by the manager's location_id), so matching
                # attendance via shift_id / user_id against those location-scoped shifts is
                # sufficient and correctly handles null-location attendance records.
                att_query = (
                    supabase.table("attendance_records")
                    .select("id,user_id,shift_id,clock_in_at,clock_out_at,break_minutes,worked_minutes,location_id")
                    .eq("organisation_id", str(org_id))
                    .gte("clock_in_at", today_start)
                    .lte("clock_in_at", today_end)
                )

                att_resp = att_query.execute()
                att_today = att_resp.data or []

                att_by_shift = {a["shift_id"]: a for a in att_today if a.get("shift_id")}
                att_by_user = {a["user_id"]: a for a in att_today if a.get("user_id")}

                # Open breaks — fetch records so we can distribute counts per location
                att_ids = [a["id"] for a in att_today]
                att_id_to_loc = {a["id"]: a.get("location_id") for a in att_today}
                open_breaks_count = 0
                open_break_att_ids: set = set()
                if att_ids:
                    brk_resp = (
                        supabase.table("break_records")
                        .select("attendance_id")
                        .in_("attendance_id", att_ids)
                        .is_("break_end_at", "null")
                        .execute()
                    )
                    brk_records = brk_resp.data or []
                    open_breaks_count = len(brk_records)
                    open_break_att_ids = {b["attendance_id"] for b in brk_records}

                # User names for not-clocked-in
                all_user_ids = list({
                    s["assigned_to_user_id"]
                    for s in shifts_today
                    if s.get("assigned_to_user_id")
                })
                profile_map: dict = {}
                if all_user_ids:
                    prof_resp = (
                        supabase.table("profiles")
                        .select("id,full_name")
                        .in_("id", all_user_ids)
                        .execute()
                    )
                    profile_map = {p["id"]: p.get("full_name", "") for p in (prof_resp.data or [])}

                # Per-location aggregation
                by_location_map: dict = {}
                total_scheduled = len(shifts_today)
                total_clocked_in = 0
                total_late = 0
                total_sched_mins = 0
                total_worked_mins = 0

                for shift in shifts_today:
                    loc_id = shift.get("location_id")
                    loc_info = shift.get("locations") or {}
                    loc_name = loc_info.get("name", "Unknown") if isinstance(loc_info, dict) else "Unknown"
                    user_id = shift.get("assigned_to_user_id")
                    user_name = profile_map.get(user_id, "Unknown") if user_id else "Unknown"

                    if loc_id not in by_location_map:
                        by_location_map[loc_id] = {
                            "location_id": loc_id,
                            "location_name": loc_name,
                            "scheduled": 0,
                            "clocked_in": 0,
                            "late": 0,
                            "on_break": 0,
                            "sched_mins": 0,
                            "worked_mins": 0,
                            "not_clocked_in": [],
                        }

                    loc = by_location_map[loc_id]
                    loc["scheduled"] += 1

                    # Scheduled duration
                    start_str = shift.get("start_at")
                    end_str = shift.get("end_at")
                    sched_mins = 0
                    if start_str and end_str:
                        try:
                            s = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                            e = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                            sched_mins = max(0, int((e - s).total_seconds() / 60))
                            loc["sched_mins"] += sched_mins
                            total_sched_mins += sched_mins
                        except Exception:
                            pass

                    # Find matching attendance record
                    att = att_by_shift.get(shift["id"]) or (
                        att_by_user.get(user_id) if user_id else None
                    )
                    if att:
                        total_clocked_in += 1
                        loc["clocked_in"] += 1

                        # Late check
                        if start_str and att.get("clock_in_at"):
                            try:
                                shift_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                                clock_in = datetime.fromisoformat(att["clock_in_at"].replace("Z", "+00:00"))
                                if clock_in > shift_start + timedelta(minutes=late_threshold):
                                    total_late += 1
                                    loc["late"] += 1
                            except Exception:
                                pass

                        # Worked minutes: use worked_minutes if clocked out, compute live otherwise
                        worked = 0
                        if att.get("clock_out_at"):
                            worked = att.get("worked_minutes") or 0
                        elif att.get("clock_in_at"):
                            try:
                                cin = datetime.fromisoformat(att["clock_in_at"].replace("Z", "+00:00"))
                                brk = att.get("break_minutes") or 0
                                elapsed = int((now_utc - cin).total_seconds() / 60)
                                worked = max(0, elapsed - brk)
                                if sched_mins > 0:
                                    worked = min(worked, sched_mins)
                            except Exception:
                                pass

                        loc["worked_mins"] += worked
                        total_worked_mins += worked
                    else:
                        # Not clocked in — build display time
                        shift_time = ""
                        if start_str:
                            try:
                                s = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                                shift_time = s.strftime("%I:%M %p").lstrip("0")
                            except Exception:
                                pass
                        loc["not_clocked_in"].append({
                            "user_name": user_name,
                            "shift_start": shift_time,
                        })

                # Distribute open-break counts to the correct location bucket
                for att_id in open_break_att_ids:
                    loc_id = att_id_to_loc.get(att_id)
                    if loc_id and loc_id in by_location_map:
                        by_location_map[loc_id]["on_break"] += 1

                # Org-wide rates
                present_rate = round(total_clocked_in / total_scheduled * 100) if total_scheduled > 0 else 0
                on_time_rate = round((total_clocked_in - total_late) / total_clocked_in * 100) if total_clocked_in > 0 else 0
                utilization_rate = round(total_worked_mins / total_sched_mins * 100) if total_sched_mins > 0 else 0

                # Per-location list
                by_location_list = []
                for loc_id, loc in by_location_map.items():
                    loc_present = round(loc["clocked_in"] / loc["scheduled"] * 100) if loc["scheduled"] > 0 else 0
                    loc_on_time = round((loc["clocked_in"] - loc["late"]) / loc["clocked_in"] * 100) if loc["clocked_in"] > 0 else 0
                    loc_util = round(loc["worked_mins"] / loc["sched_mins"] * 100) if loc["sched_mins"] > 0 else 0
                    by_location_list.append({
                        "location_id": loc_id,
                        "location_name": loc["location_name"],
                        "scheduled": loc["scheduled"],
                        "clocked_in": loc["clocked_in"],
                        "late": loc["late"],
                        "on_break": loc["on_break"],
                        "present_rate": loc_present,
                        "on_time_rate": loc_on_time,
                        "utilization_rate": loc_util,
                        "not_clocked_in": loc["not_clocked_in"],
                    })

                by_location_list.sort(key=lambda x: x["location_name"])

                attendance_data = {
                    "total_scheduled": total_scheduled,
                    "total_clocked_in": total_clocked_in,
                    "total_late": total_late,
                    "total_on_break": open_breaks_count,
                    "present_rate": present_rate,
                    "on_time_rate": on_time_rate,
                    "utilization_rate": utilization_rate,
                    "by_location": by_location_list,
                }

        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        return {
            "total_assignments": total_assignments,
            "total_submitted": total_submitted,
            "completion_rate": completion_rate,
            "pending_count": pending_count,
            "total_announcements": total_announcements,
            "total_receipts": total_receipts,
            "read_receipts": read_receipts,
            "engagement_rate": engagement_rate,
            "total_audit_submissions": total_audit_submissions,
            "passed_audit_submissions": passed_audit_submissions,
            "audit_compliance_rate": audit_compliance_rate,
            "attendance": attendance_data,
        }
