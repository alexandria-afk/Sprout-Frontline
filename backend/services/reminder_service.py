"""
Scheduled Reminder Service
Runs every 5 minutes to send reminders for upcoming deadlines.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from services.db import _get_pool, row as db_row, rows as db_rows
from services import notification_service as ns

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _already_sent_today(
    conn,
    recipient_user_id: str,
    entity_type: str,
    entity_id: str,
    org_id: str,
) -> bool:
    """Check if a scheduled_reminder already exists for this user+entity today."""
    today_start = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        result = db_row(
            conn,
            """
            SELECT id
            FROM notifications
            WHERE recipient_user_id = %s
              AND entity_type = %s
              AND entity_id = %s::uuid
              AND type = 'scheduled_reminder'
              AND organisation_id = %s::uuid
              AND created_at >= %s
            LIMIT 1
            """,
            (recipient_user_id, entity_type, entity_id, org_id, today_start),
        )
        return result is not None
    except Exception:
        return False


async def check_scheduled_reminders() -> None:
    """
    Check for upcoming items and send reminders:
    - Form assignment due in 1 hour (no submission yet)
    - Training deadline in 1 day (not completed)
    - Shift starting in 30 minutes
    """
    pool = _get_pool()
    now = _now()

    # ── 1. Form assignments due in 1 hour ───────────────────────────────────────
    conn = pool.getconn()
    try:
        window_start = now
        window_end = now + timedelta(hours=1, minutes=5)

        assignments = db_rows(
            conn,
            """
            SELECT
                fa.id,
                fa.organisation_id,
                fa.assigned_to_user_id,
                fa.due_at,
                ft.title AS form_template_title
            FROM form_assignments fa
            LEFT JOIN form_templates ft ON ft.id = fa.form_template_id
            WHERE fa.due_at >= %s
              AND fa.due_at <= %s
              AND fa.is_active = TRUE
              AND fa.is_deleted = FALSE
              AND fa.assigned_to_user_id IS NOT NULL
            """,
            (window_start, window_end),
        )

        for a in assignments:
            user_id = a.get("assigned_to_user_id")
            org_id = a.get("organisation_id")
            entity_id = a.get("id")
            if not user_id or not org_id:
                continue
            # Check if user already has a submission for this assignment
            sub = db_row(
                conn,
                """
                SELECT id
                FROM form_submissions
                WHERE assignment_id = %s::uuid
                  AND status = ANY(%s::text[])
                LIMIT 1
                """,
                (entity_id, ["submitted", "approved"]),
            )
            if sub:
                continue  # already submitted
            if _already_sent_today(conn, user_id, "form_assignment", entity_id, org_id):
                continue
            template_title = a.get("form_template_title") or "Checklist"
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
    finally:
        pool.putconn(conn)

    # ── 2. Training deadlines in 1 day ─────────────────────────────────────────
    conn = pool.getconn()
    try:
        day_start = now
        day_end = now + timedelta(days=1, hours=1)

        enrollments = db_rows(
            conn,
            """
            SELECT
                ce.id,
                ce.organisation_id,
                ce.user_id,
                ce.deadline,
                c.title AS course_title
            FROM course_enrollments ce
            LEFT JOIN courses c ON c.id = ce.course_id
            WHERE ce.deadline >= %s
              AND ce.deadline <= %s
              AND ce.status != ALL(%s::text[])
              AND ce.is_deleted = FALSE
            """,
            (day_start, day_end, ["completed", "failed"]),
        )

        for e in enrollments:
            user_id = e.get("user_id")
            org_id = e.get("organisation_id")
            entity_id = e.get("id")
            if not user_id or not org_id:
                continue
            if _already_sent_today(conn, user_id, "course_enrollment", entity_id, org_id):
                continue
            course_title = e.get("course_title") or "Training course"
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
    finally:
        pool.putconn(conn)

    # ── 3. Shifts starting in 30 minutes ───────────────────────────────────────
    conn = pool.getconn()
    try:
        shift_start = now
        shift_end = now + timedelta(minutes=35)

        shifts = db_rows(
            conn,
            """
            SELECT id, organisation_id, assigned_to_user_id, start_at, role
            FROM shifts
            WHERE start_at >= %s
              AND start_at <= %s
              AND status = 'published'
              AND is_deleted = FALSE
              AND assigned_to_user_id IS NOT NULL
            """,
            (shift_start, shift_end),
        )

        for s in shifts:
            user_id = s.get("assigned_to_user_id")
            org_id = s.get("organisation_id")
            entity_id = s.get("id")
            if not user_id or not org_id:
                continue
            if _already_sent_today(conn, user_id, "shift_claim", entity_id, org_id):
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
    finally:
        pool.putconn(conn)

    logger.debug("Scheduled reminder check complete.")


async def run_reminder_loop() -> None:
    """Background loop: runs check_scheduled_reminders every 5 minutes."""
    while True:
        try:
            await check_scheduled_reminders()
        except Exception as e:
            logger.error(f"Reminder loop error: {e}")
        await asyncio.sleep(300)  # 5 minutes
