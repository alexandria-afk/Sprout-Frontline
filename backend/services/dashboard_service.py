from datetime import datetime, timezone, date as date_cls, timedelta
from typing import Optional
from fastapi import HTTPException
from services.db import row, rows


class DashboardService:
    @staticmethod
    async def get_summary(
        conn,
        org_id: str,
        location_id: Optional[str] = None,
        from_dt: Optional[datetime] = None,
        to_dt: Optional[datetime] = None,
        role: str = "manager",
        user_location_id: Optional[str] = None,
    ) -> dict:
        try:
            # --- Form assignments (all active, no date filter — show real totals) ---
            if location_id:
                assignments_row = row(
                    conn,
                    """
                    SELECT COUNT(*) AS cnt
                    FROM form_assignments
                    WHERE organisation_id = %s
                      AND is_deleted = false
                      AND is_active = true
                      AND assigned_to_location_id = %s
                    """,
                    (org_id, location_id),
                )
            else:
                assignments_row = row(
                    conn,
                    """
                    SELECT COUNT(*) AS cnt
                    FROM form_assignments
                    WHERE organisation_id = %s
                      AND is_deleted = false
                      AND is_active = true
                    """,
                    (org_id,),
                )
            total_assignments = int(assignments_row["cnt"]) if assignments_row else 0

            # --- Completed submissions: submitted + approved + rejected ---
            # (date filter applies to when they were submitted)
            submissions_params = [org_id]
            submissions_filters = ""
            if from_dt:
                submissions_filters += " AND fs.submitted_at >= %s"
                submissions_params.append(from_dt.isoformat())
            if to_dt:
                submissions_filters += " AND fs.submitted_at <= %s"
                submissions_params.append(to_dt.isoformat())

            submissions_rows = rows(
                conn,
                f"""
                SELECT fs.id, fs.assignment_id, fs.status
                FROM form_submissions fs
                JOIN form_assignments fa ON fa.id = fs.assignment_id
                WHERE fa.organisation_id = %s
                  AND fs.status IN ('submitted', 'approved', 'rejected')
                {submissions_filters}
                """,
                tuple(submissions_params),
            )
            total_submitted = len(submissions_rows)

            # Completion rate
            completion_rate = (
                round(total_submitted / total_assignments, 4)
                if total_assignments > 0
                else 0.0
            )

            # Pending = submitted (awaiting manager review)
            pending_count = sum(
                1 for r in submissions_rows if r.get("status") == "submitted"
            )

            # --- Announcements ---
            ann_params = [org_id]
            ann_filters = ""
            if from_dt:
                ann_filters += " AND created_at >= %s"
                ann_params.append(from_dt.isoformat())
            if to_dt:
                ann_filters += " AND created_at <= %s"
                ann_params.append(to_dt.isoformat())

            announcements_row = row(
                conn,
                f"""
                SELECT COUNT(*) AS cnt
                FROM announcements
                WHERE organisation_id = %s
                  AND is_deleted = false
                {ann_filters}
                """,
                tuple(ann_params),
            )
            total_announcements = int(announcements_row["cnt"]) if announcements_row else 0

            # --- Announcement engagement (scoped to org via announcement join) ---
            receipts_rows = rows(
                conn,
                """
                SELECT ar.read_at
                FROM announcement_receipts ar
                JOIN announcements a ON a.id = ar.announcement_id
                WHERE a.organisation_id = %s
                """,
                (org_id,),
            )
            total_receipts = len(receipts_rows)
            read_receipts = sum(
                1 for r in receipts_rows if r.get("read_at") is not None
            )
            engagement_rate = (
                round(read_receipts / total_receipts, 4) if total_receipts > 0 else 0.0
            )

            # --- Audit compliance rate (% of audit submissions that passed) ---
            audit_rows = rows(
                conn,
                """
                SELECT fs.id, fs.passed
                FROM form_submissions fs
                JOIN form_assignments fa ON fa.id = fs.assignment_id
                JOIN form_templates ft ON ft.id = fs.form_template_id
                WHERE fa.organisation_id = %s
                  AND fs.status IN ('submitted', 'approved', 'rejected')
                  AND ft.type = 'audit'
                """,
                (org_id,),
            )
            total_audit_submissions = len(audit_rows)
            passed_audit_submissions = sum(
                1 for r in audit_rows if r.get("passed") is True
            )
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
                rules_row = row(
                    conn,
                    """
                    SELECT late_threshold_mins
                    FROM attendance_rules
                    WHERE organisation_id = %s
                    LIMIT 1
                    """,
                    (org_id,),
                )
                late_threshold = 15  # default: 15 minutes when no attendance_rules row exists
                if rules_row:
                    late_threshold = rules_row.get("late_threshold_mins") or 15

                # Today's published, assigned shifts
                if role == "manager" and user_location_id:
                    shifts_today = rows(
                        conn,
                        """
                        SELECT s.id, s.location_id, s.assigned_to_user_id,
                               s.start_at, s.end_at,
                               l.id AS loc_id, l.name AS loc_name
                        FROM shifts s
                        LEFT JOIN locations l ON l.id = s.location_id
                        WHERE s.organisation_id = %s
                          AND s.status = 'published'
                          AND s.assigned_to_user_id IS NOT NULL
                          AND s.start_at >= %s
                          AND s.start_at <= %s
                          AND s.location_id = %s
                        """,
                        (org_id, today_start, today_end, user_location_id),
                    )
                else:
                    shifts_today = rows(
                        conn,
                        """
                        SELECT s.id, s.location_id, s.assigned_to_user_id,
                               s.start_at, s.end_at,
                               l.id AS loc_id, l.name AS loc_name
                        FROM shifts s
                        LEFT JOIN locations l ON l.id = s.location_id
                        WHERE s.organisation_id = %s
                          AND s.status = 'published'
                          AND s.assigned_to_user_id IS NOT NULL
                          AND s.start_at >= %s
                          AND s.start_at <= %s
                        """,
                        (org_id, today_start, today_end),
                    )

                # Normalise the joined location columns into a nested dict to
                # keep the aggregation logic below unchanged.
                for s in shifts_today:
                    s["locations"] = {
                        "id": s.pop("loc_id", None),
                        "name": s.pop("loc_name", None),
                    }

                # Today's attendance records
                # Fetch all attendance for the org today — do NOT filter by location_id here.
                # Reason: staff users may have clocked in with a null/empty location_id on
                # their attendance record (e.g. web clock-in when app_metadata.location_id
                # was not set). Location scoping is already enforced by the shifts query
                # above (shifts are filtered by the manager's location_id), so matching
                # attendance via shift_id / user_id against those location-scoped shifts is
                # sufficient and correctly handles null-location attendance records.
                att_today = rows(
                    conn,
                    """
                    SELECT id, user_id, shift_id, clock_in_at, clock_out_at,
                           break_minutes, worked_minutes, location_id
                    FROM attendance_records
                    WHERE organisation_id = %s
                      AND clock_in_at >= %s
                      AND clock_in_at <= %s
                    """,
                    (org_id, today_start, today_end),
                )

                att_by_shift = {a["shift_id"]: a for a in att_today if a.get("shift_id")}
                att_by_user = {a["user_id"]: a for a in att_today if a.get("user_id")}

                # Open breaks — fetch records so we can distribute counts per location
                att_ids = [a["id"] for a in att_today]
                att_id_to_loc = {a["id"]: a.get("location_id") for a in att_today}
                open_breaks_count = 0
                open_break_att_ids: set = set()
                if att_ids:
                    brk_records = rows(
                        conn,
                        """
                        SELECT attendance_id
                        FROM break_records
                        WHERE attendance_id = ANY(%s::uuid[])
                          AND break_end_at IS NULL
                        """,
                        (att_ids,),
                    )
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
                    prof_rows = rows(
                        conn,
                        """
                        SELECT id, full_name
                        FROM profiles
                        WHERE id = ANY(%s::uuid[])
                        """,
                        (all_user_ids,),
                    )
                    profile_map = {
                        p["id"]: p.get("full_name", "") for p in prof_rows
                    }

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
                            s = datetime.fromisoformat(str(start_str).replace("Z", "+00:00"))
                            e = datetime.fromisoformat(str(end_str).replace("Z", "+00:00"))
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
                                shift_start = datetime.fromisoformat(
                                    str(start_str).replace("Z", "+00:00")
                                )
                                clock_in = datetime.fromisoformat(
                                    str(att["clock_in_at"]).replace("Z", "+00:00")
                                )
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
                                cin = datetime.fromisoformat(
                                    str(att["clock_in_at"]).replace("Z", "+00:00")
                                )
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
                                s = datetime.fromisoformat(
                                    str(start_str).replace("Z", "+00:00")
                                )
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
