"""
Seed user_points for all active profiles in an org so the leaderboard
is visible on the staff dashboard.

Usage (from backend/):
    .venv/bin/python3 scripts/seed_leaderboard.py
"""
import sys, os, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/frontlinerdb")

def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

# ── Target org (Renegade Burgers) ─────────────────────────────────────────────
ORG_NAME_CONTAINS = "Renegade"

def main():
    conn = get_conn()

    with conn.cursor() as cur:
        # Find the org
        cur.execute("SELECT id, name FROM organisations")
        all_orgs = cur.fetchall()

    orgs = [o for o in all_orgs if ORG_NAME_CONTAINS.lower() in o["name"].lower()]
    if not orgs:
        print(f"No org matching '{ORG_NAME_CONTAINS}' found. Available:")
        for o in all_orgs:
            print(f"  - {o['name']} ({o['id']})")
        conn.close()
        return

    org = orgs[0]
    org_id = org["id"]
    print(f"Seeding org: {org['name']} ({org_id})")

    # Fetch all active profiles in the org
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, full_name, role, location_id
            FROM profiles
            WHERE organisation_id = %s AND is_deleted = FALSE
            """,
            (org_id,),
        )
        profiles = cur.fetchall()

    if not profiles:
        print("No profiles found in org.")
        conn.close()
        return
    print(f"Found {len(profiles)} profiles.")

    # Fetch existing user_points rows
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT user_id, total_points
            FROM user_points
            WHERE organisation_id = %s
            """,
            (org_id,),
        )
        existing = {r["user_id"]: r["total_points"] for r in cur.fetchall()}

    ROLE_RANGES = {
        "super_admin": (800, 1500),
        "admin":       (600, 1200),
        "manager":     (300, 800),
        "staff":       (50,  550),
    }

    to_insert = []
    to_update = []

    random.seed(42)  # reproducible
    for p in profiles:
        uid  = p["id"]
        role = p.get("role", "staff")
        lo, hi = ROLE_RANGES.get(role, (50, 400))
        pts = random.randint(lo, hi)

        if uid in existing:
            if existing[uid] == 0:
                to_update.append({"user_id": uid, "total_points": pts})
        else:
            to_insert.append({
                "organisation_id": org_id,
                "user_id": uid,
                "total_points": pts,
                "issues_reported": random.randint(0, 20),
                "issues_resolved": random.randint(0, 15),
                "checklists_completed": random.randint(0, 50),
                "tasks_completed": random.randint(0, 30),
            })

    with conn.cursor() as cur:
        if to_insert:
            cur.executemany(
                """
                INSERT INTO user_points (
                    organisation_id, user_id, total_points,
                    issues_reported, issues_resolved,
                    checklists_completed, tasks_completed
                )
                VALUES (
                    %(organisation_id)s, %(user_id)s, %(total_points)s,
                    %(issues_reported)s, %(issues_resolved)s,
                    %(checklists_completed)s, %(tasks_completed)s
                )
                ON CONFLICT DO NOTHING
                """,
                to_insert,
            )
            print(f"  Inserted {len(to_insert)} new rows.")

        if to_update:
            for row in to_update:
                cur.execute(
                    """
                    UPDATE user_points
                    SET total_points = %s
                    WHERE user_id = %s
                    """,
                    (row["total_points"], row["user_id"]),
                )
            print(f"  Updated {len(to_update)} zero-point rows.")

    conn.commit()

    if not to_insert and not to_update:
        print("  All users already have points — no changes needed.")

    # Print leaderboard
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT up.total_points, p.full_name, p.role
            FROM user_points up
            JOIN profiles p ON p.id = up.user_id
            WHERE up.organisation_id = %s
            ORDER BY up.total_points DESC
            LIMIT 10
            """,
            (org_id,),
        )
        leaderboard = cur.fetchall()

    print(f"\n── Leaderboard — {org['name']} (top 10) ──")
    for i, row in enumerate(leaderboard, 1):
        name = row.get("full_name", "Unknown")
        role = row.get("role", "?")
        pts  = row["total_points"]
        print(f"  {i:>2}. {name:<30} ({role:<11}) {pts:>5} pts")

    conn.close()

if __name__ == "__main__":
    main()
