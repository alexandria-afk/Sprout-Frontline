"""
Seed user_points for all active profiles in an org so the leaderboard
is visible on the staff dashboard.

Usage (from backend/):
    .venv/bin/python3 scripts/seed_leaderboard.py
"""
import sys, os, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.supabase_client import get_supabase

# ── Target org (Renegade Burgers) ─────────────────────────────────────────────
ORG_NAME_CONTAINS = "Renegade"

def main():
    db = get_supabase()

    # Find the org
    orgs_resp = db.table("organisations").select("id, name").execute()
    orgs = [o for o in (orgs_resp.data or []) if ORG_NAME_CONTAINS.lower() in o["name"].lower()]
    if not orgs:
        print(f"No org matching '{ORG_NAME_CONTAINS}' found. Available:")
        for o in (orgs_resp.data or []):
            print(f"  - {o['name']} ({o['id']})")
        return

    org = orgs[0]
    org_id = org["id"]
    print(f"Seeding org: {org['name']} ({org_id})")

    # Fetch all active profiles in the org
    profiles_resp = (
        db.table("profiles")
        .select("id, full_name, role, location_id")
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .execute()
    )
    profiles = profiles_resp.data or []
    if not profiles:
        print("No profiles found in org.")
        return
    print(f"Found {len(profiles)} profiles.")

    # Fetch existing user_points rows
    existing_resp = (
        db.table("user_points")
        .select("user_id, total_points")
        .eq("organisation_id", org_id)
        .execute()
    )
    existing = {r["user_id"]: r["total_points"] for r in (existing_resp.data or [])}

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

    if to_insert:
        db.table("user_points").insert(to_insert).execute()
        print(f"  Inserted {len(to_insert)} new rows.")
    if to_update:
        for row in to_update:
            db.table("user_points").update({"total_points": row["total_points"]}).eq("user_id", row["user_id"]).execute()
        print(f"  Updated {len(to_update)} zero-point rows.")
    if not to_insert and not to_update:
        print("  All users already have points — no changes needed.")

    # Print leaderboard
    result = (
        db.table("user_points")
        .select("total_points, profiles!user_id(full_name, role)")
        .eq("organisation_id", org_id)
        .order("total_points", desc=True)
        .limit(10)
        .execute()
    )
    print(f"\n── Leaderboard — {org['name']} (top 10) ──")
    for i, row in enumerate(result.data or [], 1):
        prof = row.get("profiles") or {}
        name = prof.get("full_name", "Unknown")
        role = prof.get("role", "?")
        pts  = row["total_points"]
        print(f"  {i:>2}. {name:<30} ({role:<11}) {pts:>5} pts")

if __name__ == "__main__":
    main()
