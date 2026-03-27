from datetime import datetime, timezone
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
        }
