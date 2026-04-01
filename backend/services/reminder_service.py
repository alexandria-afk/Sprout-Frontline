"""
Scheduled Reminder Service
Runs every 5 minutes to send reminders for upcoming deadlines.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from services.supabase_client import get_supabase
from services import notification_service as ns

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _already_sent_today(db, recipient_user_id: str, entity_type: str, entity_id: str, org_id: str) -> bool:
    """Check if a scheduled_reminder already exists for this user+entity today."""
    today_start = _now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    try:
        resp = (
            db.table("notifications")
            .select("id")
            .eq("recipient_user_id", recipient_user_id)
            .eq("entity_type", entity_type)
            .eq("entity_id", entity_id)
            .eq("type", "scheduled_reminder")
            .eq("organisation_id", org_id)
            .gte("created_at", today_start)
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception:
        return False


async def check_scheduled_reminders() -> None:
    """
    Check for upcoming items and send reminders:
    - Form assignment due in 1 hour (no submission yet)
    - Training deadline in 1 day (not completed)
    - Shift starting in 30 minutes
    """
    db = get_supabase()
    now = _now()

    # ── 1. Form assignments due in 1 hour ───────────────────────────────────────
    try:
        window_start = now.isoformat()
        window_end = (now + timedelta(hours=1, minutes=5)).isoformat()

        assignments_resp = (
            db.table("form_assignments")
            .select("id, organisation_id, assigned_to_user_id, due_at, form_templates(title)")
            .gte("due_at", window_start)
            .lte("due_at", window_end)
            .eq("is_active", True)
            .eq("is_deleted", False)
            .not_.is_("assigned_to_user_id", "null")
            .execute()
        )
        for a in (assignments_resp.data or []):
            user_id = a.get("assigned_to_user_id")
            org_id = a.get("organisation_id")
            entity_id = a.get("id")
            if not user_id or not org_id:
                continue
            # Check if user already has a submission for this assignment
            sub_resp = (
                db.table("form_submissions")
                .select("id")
                .eq("assignment_id", entity_id)
                .in_("status", ["submitted", "approved"])
                .limit(1)
                .execute()
            )
            if sub_resp.data:
                continue  # already submitted
            if _already_sent_today(db, user_id, "form_assignment", entity_id, org_id):
                continue
            template_title = (a.get("form_templates") or {}).get("title", "Checklist")
            await ns.notify(
                org_id=org_id,
                recipient_user_id=user_id,
                type="scheduled_reminder",
                title=f"{template_title} due in 1 hour",
                body="Complete it before the deadline.",
                entity_type="form_assignment",
                entity_id=entity_id,
                send_push=True,
            )
    except Exception as e:
        logger.error(f"Reminder: form assignments check failed: {e}")

    # ── 2. Training deadlines in 1 day ─────────────────────────────────────────
    try:
        day_start = now.isoformat()
        day_end = (now + timedelta(days=1, hours=1)).isoformat()

        enrollments_resp = (
            db.table("course_enrollments")
            .select("id, organisation_id, user_id, deadline, courses(title)")
            .gte("deadline", day_start)
            .lte("deadline", day_end)
            .not_.in_("status", ["completed", "failed"])
            .eq("is_deleted", False)
            .execute()
        )
        for e in (enrollments_resp.data or []):
            user_id = e.get("user_id")
            org_id = e.get("organisation_id")
            entity_id = e.get("id")
            if not user_id or not org_id:
                continue
            if _already_sent_today(db, user_id, "course_enrollment", entity_id, org_id):
                continue
            course_title = (e.get("courses") or {}).get("title", "Training course")
            await ns.notify(
                org_id=org_id,
                recipient_user_id=user_id,
                type="scheduled_reminder",
                title=f"{course_title} due tomorrow",
                body="Complete your training before the deadline.",
                entity_type="course_enrollment",
                entity_id=entity_id,
                send_push=True,
            )
    except Exception as e:
        logger.error(f"Reminder: training deadlines check failed: {e}")

    # ── 3. Shifts starting in 30 minutes ───────────────────────────────────────
    try:
        shift_start = now.isoformat()
        shift_end = (now + timedelta(minutes=35)).isoformat()

        shifts_resp = (
            db.table("shifts")
            .select("id, organisation_id, assigned_to_user_id, start_at, role")
            .gte("start_at", shift_start)
            .lte("start_at", shift_end)
            .eq("status", "published")
            .eq("is_deleted", False)
            .not_.is_("assigned_to_user_id", "null")
            .execute()
        )
        for s in (shifts_resp.data or []):
            user_id = s.get("assigned_to_user_id")
            org_id = s.get("organisation_id")
            entity_id = s.get("id")
            if not user_id or not org_id:
                continue
            if _already_sent_today(db, user_id, "shift_claim", entity_id, org_id):
                continue
            role_label = s.get("role") or "Shift"
            await ns.notify(
                org_id=org_id,
                recipient_user_id=user_id,
                type="scheduled_reminder",
                title=f"{role_label} starts in 30 min",
                body="Your shift is coming up soon.",
                entity_type="shift_claim",
                entity_id=entity_id,
                send_push=True,
            )
    except Exception as e:
        logger.error(f"Reminder: shifts check failed: {e}")

    logger.debug("Scheduled reminder check complete.")


async def run_reminder_loop() -> None:
    """Background loop: runs check_scheduled_reminders every 5 minutes."""
    while True:
        try:
            await check_scheduled_reminders()
        except Exception as e:
            logger.error(f"Reminder loop error: {e}")
        await asyncio.sleep(300)  # 5 minutes
