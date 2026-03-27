from uuid import UUID
from typing import Optional
from services.supabase_client import get_supabase

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


class GamificationService:

    @staticmethod
    async def list_leaderboards(org_id: UUID):
        supabase = get_supabase()
        res = supabase.table("leaderboard_configs").select("*").eq("organisation_id", str(org_id)).eq("is_active", True).eq("is_deleted", False).order("name").execute()
        return res.data or []

    @staticmethod
    async def list_badges(org_id: UUID):
        supabase = get_supabase()
        res = supabase.table("badge_configs").select("*").eq("organisation_id", str(org_id)).eq("is_active", True).eq("is_deleted", False).order("name").execute()
        return res.data or []

    @staticmethod
    async def list_my_badges(user_id: UUID, org_id: UUID):
        supabase = get_supabase()
        res = supabase.table("user_badge_awards").select("*, badge_configs(*)").eq("user_id", str(user_id)).eq("organisation_id", str(org_id)).eq("is_deleted", False).order("awarded_at", desc=True).execute()
        return res.data or []

    @staticmethod
    async def get_my_points(user_id: UUID):
        supabase = get_supabase()
        res = supabase.table("user_points").select("*").eq("user_id", str(user_id)).maybe_single().execute()
        return res.data

    @staticmethod
    async def get_org_leaderboard(org_id: UUID):
        """Return all users ranked by total_points for the org (no config needed)."""
        supabase = get_supabase()
        rows = (
            supabase.table("user_points")
            .select("user_id, total_points, profiles(full_name, role, location_id)")
            .eq("organisation_id", str(org_id))
            .order("total_points", desc=True)
            .limit(50)
            .execute()
        )
        entries = [
            {
                "user_id":   r["user_id"],
                "full_name": (r.get("profiles") or {}).get("full_name"),
                "role":      (r.get("profiles") or {}).get("role"),
                "score":     r.get("total_points") or 0,
            }
            for r in (rows.data or [])
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
            badge_rows = (
                supabase.table("user_badge_awards")
                .select("user_id, badge_configs(icon, name)")
                .in_("user_id", user_ids)
                .eq("is_deleted", False)
                .execute()
            )
            badge_map: dict[str, list] = {}
            for row in (badge_rows.data or []):
                uid = row["user_id"]
                bc = row.get("badge_configs") or {}
                if uid not in badge_map:
                    badge_map[uid] = []
                if bc and bc.get("name"):
                    badge_map[uid].append({"icon": bc.get("icon"), "name": bc["name"]})
            for e in ranked:
                e["badges"] = badge_map.get(e["user_id"], [])

        return ranked

    @staticmethod
    async def get_leaderboard_scores(config_id: UUID, org_id: UUID):
        """Compute leaderboard scores from the pre-aggregated user_points table."""
        supabase = get_supabase()
        config_res = supabase.table("leaderboard_configs").select("*").eq("id", str(config_id)).eq("organisation_id", str(org_id)).maybe_single().execute()
        if not config_res.data:
            return None, []
        config = config_res.data
        metric = config["metric_type"]

        # Map metric_type → user_points column name
        METRIC_COLUMN = {
            "points_total":          "total_points",
            "issues_reported":       "issues_reported",
            "issues_resolved":       "issues_resolved",
            "checklists_completed":  "checklists_completed",
            "checklist_streak_days": "checklist_longest_streak",
            "audit_perfect_scores":  "audit_perfect_scores",
            "tasks_completed":       "tasks_completed",
            "attendance_punctuality":"attendance_longest_streak",
        }
        col = METRIC_COLUMN.get(metric, "total_points")

        rows = (
            supabase.table("user_points")
            .select(f"user_id, {col}, profiles(full_name, role, location_id)")
            .eq("organisation_id", str(org_id))
            .order(col, desc=True)
            .limit(50)
            .execute()
        )
        entries = [
            {
                "user_id":   r["user_id"],
                "full_name": (r.get("profiles") or {}).get("full_name"),
                "role":      (r.get("profiles") or {}).get("role"),
                "score":     r.get(col) or 0,
            }
            for r in (rows.data or [])
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
    async def create_badge(org_id: UUID, data: dict):
        supabase = get_supabase()
        res = supabase.table("badge_configs").insert({**data, "organisation_id": str(org_id)}).execute()
        return res.data[0] if res.data else None

    @staticmethod
    async def award_badge(badge_id: UUID, user_id: UUID, org_id: UUID, awarded_by: UUID):
        supabase = get_supabase()
        # Check not already awarded
        existing = supabase.table("user_badge_awards").select("id").eq("badge_id", str(badge_id)).eq("user_id", str(user_id)).eq("is_deleted", False).execute()
        if existing.data:
            raise ValueError("Badge already awarded to this user")
        res = supabase.table("user_badge_awards").insert({"badge_id": str(badge_id), "user_id": str(user_id), "organisation_id": str(org_id), "awarded_by": str(awarded_by)}).execute()
        return res.data[0] if res.data else None

    @staticmethod
    async def seed_templates(org_id: UUID):
        """Seed all badge and leaderboard templates for a new org."""
        supabase = get_supabase()
        badge_rows = [{**t, "organisation_id": str(org_id)} for t in BADGE_TEMPLATES]
        lb_rows = [{**t, "organisation_id": str(org_id)} for t in LEADERBOARD_TEMPLATES]
        supabase.table("badge_configs").insert(badge_rows).execute()
        supabase.table("leaderboard_configs").insert(lb_rows).execute()

    @staticmethod
    async def list_badge_templates(org_id: UUID):
        supabase = get_supabase()
        res = supabase.table("badge_configs").select("*").eq("organisation_id", str(org_id)).eq("is_template", True).eq("is_deleted", False).execute()
        return res.data or []

    @staticmethod
    async def list_leaderboard_templates(org_id: UUID):
        supabase = get_supabase()
        res = supabase.table("leaderboard_configs").select("*").eq("organisation_id", str(org_id)).eq("is_template", True).eq("is_deleted", False).execute()
        return res.data or []

    @staticmethod
    async def activate_template(template_id: UUID, org_id: UUID):
        supabase = get_supabase()
        supabase.table("badge_configs").update({"is_active": True}).eq("id", str(template_id)).eq("organisation_id", str(org_id)).execute()
        supabase.table("leaderboard_configs").update({"is_active": True}).eq("id", str(template_id)).eq("organisation_id", str(org_id)).execute()

    @staticmethod
    async def update_badge(badge_id: UUID, org_id: UUID, data: dict):
        supabase = get_supabase()
        update_data = {k: v for k, v in data.items() if k not in ("id", "organisation_id", "is_deleted", "is_template")}
        res = (
            supabase.table("badge_configs")
            .update(update_data)
            .eq("id", str(badge_id))
            .eq("organisation_id", str(org_id))
            .eq("is_deleted", False)
            .execute()
        )
        return res.data[0] if res.data else None

    @staticmethod
    async def delete_badge(badge_id: UUID, org_id: UUID):
        supabase = get_supabase()
        res = supabase.table("badge_configs").update({"is_deleted": True}).eq("id", str(badge_id)).eq("organisation_id", str(org_id)).execute()
        return res.data[0] if res.data else None

    @staticmethod
    async def get_points_summary(org_id: UUID):
        supabase = get_supabase()
        res = supabase.table("user_points").select("*, profiles(full_name, role, location_id)").eq("organisation_id", str(org_id)).order("total_points", desc=True).execute()
        return res.data or []

    @staticmethod
    async def create_leaderboard(org_id: UUID, data: dict):
        supabase = get_supabase()
        res = supabase.table("leaderboard_configs").insert({**data, "organisation_id": str(org_id)}).execute()
        return res.data[0] if res.data else None
