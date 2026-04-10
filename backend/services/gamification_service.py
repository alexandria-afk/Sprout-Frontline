from uuid import UUID
from typing import Optional

from services.db import row, rows, execute, execute_returning

BADGE_TEMPLATES = [
    # Safety & Issues
    {"name": "First Responder",  "icon": "🚨", "description": "First issue reported",                  "criteria_type": "issues_reported",  "criteria_value": 1,  "points_awarded": 50,  "is_template": True},
    {"name": "Safety Spotter",   "icon": "👀", "description": "10 issues reported",                   "criteria_type": "issues_reported",  "criteria_value": 10, "points_awarded": 100, "is_template": True},
    {"name": "Safety Champion",  "icon": "⭐", "description": "50 issues reported",                   "criteria_type": "issues_reported",  "criteria_value": 50, "points_awarded": 500, "is_template": True},
    {"name": "Problem Solver",   "icon": "🔧", "description": "10 issues resolved",                   "criteria_type": "issues_resolved",  "criteria_value": 10, "points_awarded": 250, "is_template": True},
    {"name": "Quick Fix",        "icon": "⚡", "description": "25 issues resolved",                   "criteria_type": "issues_resolved",  "criteria_value": 25, "points_awarded": 400, "is_template": True},
    # Checklists
    {"name": "On It",            "icon": "✅", "description": "First checklist completed",             "criteria_type": "checklists_completed",    "criteria_value": 1,  "points_awarded": 25,  "is_template": True},
    {"name": "Consistent",       "icon": "🔥", "description": "7-day checklist streak",               "criteria_type": "checklist_streak_days",   "criteria_value": 7,  "points_awarded": 150, "is_template": True},
    {"name": "Reliable",         "icon": "💪", "description": "30-day checklist streak",              "criteria_type": "checklist_streak_days",   "criteria_value": 30, "points_awarded": 500, "is_template": True},
    {"name": "Operations Star",  "icon": "🌟", "description": "100 checklists completed",             "criteria_type": "checklists_completed",    "criteria_value": 100,"points_awarded": 300, "is_template": True},
    # Audits
    {"name": "Perfect Score",    "icon": "🏆", "description": "First perfect audit score",            "criteria_type": "audit_perfect_score",     "criteria_value": 1,  "points_awarded": 300, "is_template": True},
    {"name": "No Findings",      "icon": "🎯", "description": "5 perfect audit scores",               "criteria_type": "audit_perfect_score",     "criteria_value": 5,  "points_awarded": 600, "is_template": True},
    # Tasks
    {"name": "Gets Things Done", "icon": "📋", "description": "10 tasks completed",                   "criteria_type": "tasks_completed",         "criteria_value": 10, "points_awarded": 150, "is_template": True},
    {"name": "Task Master",      "icon": "🎯", "description": "50 tasks completed",                   "criteria_type": "tasks_completed",         "criteria_value": 50, "points_awarded": 400, "is_template": True},
]

LEADERBOARD_TEMPLATES = [
    {"name": "Safety Stars",        "metric_type": "issues_reported",    "scope": "location",     "time_window": "monthly",   "is_template": True},
    {"name": "Problem Solvers",     "metric_type": "issues_resolved",    "scope": "location",     "time_window": "monthly",   "is_template": True},
    {"name": "Checklist Heroes",    "metric_type": "checklists_completed","scope": "location",    "time_window": "weekly",    "is_template": True},
    {"name": "Top Performers",      "metric_type": "points_total",       "scope": "organisation", "time_window": "monthly",   "is_template": True},
    {"name": "Audit Aces",          "metric_type": "audit_score_avg",    "scope": "organisation", "time_window": "quarterly", "is_template": True},
    {"name": "Task Crushers",       "metric_type": "tasks_completed",    "scope": "location",     "time_window": "weekly",    "is_template": True},
]

METRIC_POINT_VALUES = {
    "issues_reported": 10,
    "issues_resolved": 20,
    "checklists_completed": 5,
    "checklist_streak_day": 15,
    "audit_completed": 25,
    "audit_perfect_score": 100,
    "training_completed": 30,
    "task_completed": 10,
    "critical_issue_reported": 50,
}

# Map metric_type → user_points column name (used in get_leaderboard_scores)
METRIC_COLUMN = {
    "points_total":           "total_points",
    "issues_reported":        "issues_reported",
    "issues_resolved":        "issues_resolved",
    "checklists_completed":   "checklists_completed",
    "checklist_streak_days":  "checklist_longest_streak",
    "audit_perfect_scores":   "audit_perfect_scores",
    "tasks_completed":        "tasks_completed",
    "attendance_punctuality": "attendance_longest_streak",
}


class GamificationService:

    @staticmethod
    async def list_leaderboards(org_id, conn):
        return rows(
            conn,
            """
            SELECT * FROM leaderboard_configs
            WHERE organisation_id = %s
              AND is_active = TRUE
              AND is_deleted = FALSE
            ORDER BY name
            """,
            (str(org_id),),
        )

    @staticmethod
    async def list_badges(org_id, conn):
        return rows(
            conn,
            """
            SELECT * FROM badge_configs
            WHERE organisation_id = %s
              AND is_active = TRUE
              AND is_deleted = FALSE
            ORDER BY name
            """,
            (str(org_id),),
        )

    @staticmethod
    async def list_my_badges(user_id, org_id, conn):
        return rows(
            conn,
            """
            SELECT
                uba.*,
                bc.name        AS badge_name,
                bc.description AS badge_description,
                bc.icon        AS badge_icon,
                bc.points_awarded,
                bc.criteria_type,
                bc.criteria_value,
                bc.criteria_window,
                bc.scope,
                bc.is_active,
                bc.is_template
            FROM user_badge_awards uba
            JOIN badge_configs bc ON bc.id = uba.badge_id
            WHERE uba.user_id = %s
              AND uba.organisation_id = %s
              AND uba.is_deleted = FALSE
            ORDER BY uba.awarded_at DESC
            """,
            (str(user_id), str(org_id)),
        )

    @staticmethod
    async def get_my_points(user_id, conn):
        return row(
            conn,
            "SELECT * FROM user_points WHERE user_id = %s",
            (str(user_id),),
        )

    @staticmethod
    async def get_org_leaderboard(org_id, conn):
        """Return all users ranked by total_points for the org (no config needed)."""
        raw = rows(
            conn,
            """
            SELECT
                up.user_id,
                up.total_points,
                p.full_name,
                p.role,
                p.location_id
            FROM user_points up
            JOIN profiles p ON p.id = up.user_id
            WHERE up.organisation_id = %s
            ORDER BY up.total_points DESC
            LIMIT 50
            """,
            (str(org_id),),
        )

        entries = [
            {
                "user_id":   r["user_id"],
                "full_name": r.get("full_name"),
                "role":      r.get("role"),
                "score":     r.get("total_points") or 0,
            }
            for r in raw
            if (r.get("total_points") or 0) > 0
        ]

        # Add rank with tie support
        ranked, rank = [], 1
        for i, e in enumerate(entries):
            e["rank"] = ranked[-1]["rank"] if i > 0 and e["score"] == entries[i - 1]["score"] else rank
            rank = i + 2
            ranked.append(e)

        # Attach each user's earned badges
        if ranked:
            user_ids = [e["user_id"] for e in ranked]
            badge_rows = rows(
                conn,
                """
                SELECT uba.user_id, bc.icon, bc.name AS badge_name
                FROM user_badge_awards uba
                JOIN badge_configs bc ON bc.id = uba.badge_id
                WHERE uba.user_id = ANY(%s)
                  AND uba.is_deleted = FALSE
                """,
                (user_ids,),
            )
            badge_map: dict[str, list] = {}
            for br in badge_rows:
                uid = br["user_id"]
                if uid not in badge_map:
                    badge_map[uid] = []
                if br.get("badge_name"):
                    badge_map[uid].append({"icon": br.get("icon"), "name": br["badge_name"]})
            for e in ranked:
                e["badges"] = badge_map.get(e["user_id"], [])

        return ranked

    @staticmethod
    async def get_leaderboard_scores(config_id: UUID, org_id, conn):
        """Compute leaderboard scores from the pre-aggregated user_points table."""
        config = row(
            conn,
            """
            SELECT * FROM leaderboard_configs
            WHERE id = %s AND organisation_id = %s
            """,
            (str(config_id), str(org_id)),
        )
        if not config:
            return None, []

        metric = config["metric_type"]
        col = METRIC_COLUMN.get(metric, "total_points")

        # col is a trusted internal constant, safe to interpolate
        raw = rows(
            conn,
            f"""
            SELECT
                up.user_id,
                up.{col},
                p.full_name,
                p.role,
                p.location_id
            FROM user_points up
            JOIN profiles p ON p.id = up.user_id
            WHERE up.organisation_id = %s
            ORDER BY up.{col} DESC
            LIMIT 50
            """,
            (str(org_id),),
        )

        entries = [
            {
                "user_id":   r["user_id"],
                "full_name": r.get("full_name"),
                "role":      r.get("role"),
                "score":     r.get(col) or 0,
            }
            for r in raw
            if (r.get(col) or 0) > 0
        ]
        entries.sort(key=lambda x: x["score"], reverse=True)

        # Add rank with ties
        ranked = []
        rank = 1
        for i, e in enumerate(entries):
            if i > 0 and e["score"] == entries[i - 1]["score"]:
                e["rank"] = ranked[-1]["rank"]
            else:
                e["rank"] = rank
            rank = i + 2
            ranked.append(e)

        return config, ranked

    @staticmethod
    async def create_badge(org_id, data: dict, conn):
        return execute_returning(
            conn,
            """
            INSERT INTO badge_configs (
                organisation_id, name, description, icon,
                points_awarded, criteria_type, criteria_value,
                criteria_window, scope, is_active, is_template
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                      COALESCE(%s, TRUE), COALESCE(%s, FALSE))
            RETURNING *
            """,
            (
                str(org_id),
                data.get("name"),
                data.get("description"),
                data.get("icon"),
                data.get("points_awarded", 0),
                data.get("criteria_type"),
                data.get("criteria_value"),
                data.get("criteria_window", "all_time"),
                data.get("scope", "individual"),
                data.get("is_active"),
                data.get("is_template"),
            ),
        )

    @staticmethod
    async def award_badge(badge_id: UUID, user_id: UUID, org_id, awarded_by, conn):
        # Check not already awarded
        existing = row(
            conn,
            """
            SELECT id FROM user_badge_awards
            WHERE badge_id = %s AND user_id = %s AND is_deleted = FALSE
            """,
            (str(badge_id), str(user_id)),
        )
        if existing:
            raise ValueError("Badge already awarded to this user")

        return execute_returning(
            conn,
            """
            INSERT INTO user_badge_awards (badge_id, user_id, organisation_id, awarded_by)
            VALUES (%s, %s, %s, %s)
            RETURNING *
            """,
            (str(badge_id), str(user_id), str(org_id), str(awarded_by)),
        )

    @staticmethod
    async def seed_templates(org_id, conn):
        """Seed all badge and leaderboard templates for a new org."""
        for t in BADGE_TEMPLATES:
            execute(
                conn,
                """
                INSERT INTO badge_configs (
                    organisation_id, name, icon, description,
                    criteria_type, criteria_value, points_awarded, is_template
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                (
                    str(org_id),
                    t["name"],
                    t.get("icon"),
                    t.get("description"),
                    t["criteria_type"],
                    t["criteria_value"],
                    t["points_awarded"],
                    t["is_template"],
                ),
            )
        for t in LEADERBOARD_TEMPLATES:
            execute(
                conn,
                """
                INSERT INTO leaderboard_configs (
                    organisation_id, name, metric_type, scope, time_window, is_template
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                (
                    str(org_id),
                    t["name"],
                    t["metric_type"],
                    t["scope"],
                    t["time_window"],
                    t["is_template"],
                ),
            )

    @staticmethod
    async def list_badge_templates(org_id, conn):
        return rows(
            conn,
            """
            SELECT * FROM badge_configs
            WHERE organisation_id = %s
              AND is_template = TRUE
              AND is_deleted = FALSE
            """,
            (str(org_id),),
        )

    @staticmethod
    async def list_leaderboard_templates(org_id, conn):
        return rows(
            conn,
            """
            SELECT * FROM leaderboard_configs
            WHERE organisation_id = %s
              AND is_template = TRUE
              AND is_deleted = FALSE
            """,
            (str(org_id),),
        )

    @staticmethod
    async def activate_template(template_id: UUID, org_id, conn):
        execute(
            conn,
            """
            UPDATE badge_configs SET is_active = TRUE
            WHERE id = %s AND organisation_id = %s
            """,
            (str(template_id), str(org_id)),
        )
        execute(
            conn,
            """
            UPDATE leaderboard_configs SET is_active = TRUE
            WHERE id = %s AND organisation_id = %s
            """,
            (str(template_id), str(org_id)),
        )

    @staticmethod
    async def update_badge(badge_id: UUID, org_id, data: dict, conn):
        update_data = {k: v for k, v in data.items() if k not in ("id", "organisation_id", "is_deleted", "is_template")}
        return execute_returning(
            conn,
            """
            UPDATE badge_configs SET
                name             = %s,
                description      = %s,
                icon             = %s,
                points_awarded   = %s,
                criteria_type    = %s,
                criteria_value   = %s,
                criteria_window  = %s,
                scope            = %s,
                is_active        = %s
            WHERE id = %s
              AND organisation_id = %s
              AND is_deleted = FALSE
            RETURNING *
            """,
            (
                update_data.get("name"),
                update_data.get("description"),
                update_data.get("icon"),
                update_data.get("points_awarded", 0),
                update_data.get("criteria_type"),
                update_data.get("criteria_value"),
                update_data.get("criteria_window", "all_time"),
                update_data.get("scope", "individual"),
                update_data.get("is_active", True),
                str(badge_id),
                str(org_id),
            ),
        )

    @staticmethod
    async def delete_badge(badge_id: UUID, org_id, conn):
        return execute_returning(
            conn,
            """
            UPDATE badge_configs SET is_deleted = TRUE
            WHERE id = %s AND organisation_id = %s
            RETURNING *
            """,
            (str(badge_id), str(org_id)),
        )

    @staticmethod
    async def get_points_summary(org_id, conn):
        return rows(
            conn,
            """
            SELECT
                up.*,
                p.full_name,
                p.role,
                p.location_id
            FROM user_points up
            JOIN profiles p ON p.id = up.user_id
            WHERE up.organisation_id = %s
            ORDER BY up.total_points DESC
            """,
            (str(org_id),),
        )

    @staticmethod
    async def create_leaderboard(org_id, data: dict, conn):
        return execute_returning(
            conn,
            """
            INSERT INTO leaderboard_configs (
                organisation_id, name, description, metric_type,
                scope, time_window, is_active, is_template
            ) VALUES (%s, %s, %s, %s, %s, %s, COALESCE(%s, TRUE), COALESCE(%s, FALSE))
            RETURNING *
            """,
            (
                str(org_id),
                data.get("name"),
                data.get("description"),
                data.get("metric_type"),
                data.get("scope", "location"),
                data.get("time_window", "monthly"),
                data.get("is_active"),
                data.get("is_template"),
            ),
        )
