"""
Audit Workflow Seed Script
Demonstrates the full cycle:
  1. Create "Safety Compliance Audit" form template (3 fields)
  2. Set up audit config + section weights + field scores
  3. Assign to staff user at Main Branch
  4. Staff submits with failures (non_compliant on all 3 fields)
  5. Manager approves → CAP auto-generated
  6. Confirm CAP → spawns 1 task + 1 issue + 1 incident

Run from the backend/ directory:
  python seed_audit_workflow.py
"""

import asyncio
import sys
import os

# Make sure we're in the right directory for imports
sys.path.insert(0, os.path.dirname(__file__))

import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime, timezone, timedelta
from services.cap_service import CAPService
from services.form_service import FormService
from models.forms import (
    CreateFormTemplateRequest, CreateFormSectionRequest, CreateFormFieldRequest,
    CreateAssignmentRequest, CreateSubmissionRequest, FormResponseItem,
    ReviewSubmissionRequest,
)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/frontlinerdb")

def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

# ── Seed constants ────────────────────────────────────────────────────────────
ORG_ID      = "9e12ff9e-bc77-4ca2-8bfb-be7b7c1fe009"
LOCATION_ID = "a1000000-0000-0000-0000-000000000001"
MANAGER_ID  = "22daa328-e6d9-4f60-b71d-65e4aa070992"
STAFF_ID    = "58acd6c5-410a-4e9a-837d-5da05ce3c58b"


def log(msg: str):
    print(f"  ✓  {msg}")


def err(msg: str):
    print(f"  ✗  {msg}", file=sys.stderr)


async def main():
    conn = get_conn()
    print("\n=== Audit Workflow Seed ===\n")

    # ── 1. Create form template ───────────────────────────────────────────────
    print("Step 1: Creating form template...")
    template_req = CreateFormTemplateRequest(
        title="Safety Compliance Audit",
        description="Monthly fire safety, equipment, and documentation check",
        type="audit",
        sections=[
            CreateFormSectionRequest(
                title="Fire Safety",
                display_order=1,
                fields=[
                    CreateFormFieldRequest(
                        label="Fire Exit Accessibility",
                        field_type="audit_item",
                        is_required=True,
                        display_order=1,
                        is_critical=True,   # critical → auto-fails audit; "fire" keyword → incident
                    ),
                ],
            ),
            CreateFormSectionRequest(
                title="Equipment",
                display_order=2,
                fields=[
                    CreateFormFieldRequest(
                        label="Fryer Equipment Maintenance",
                        field_type="audit_item",
                        is_required=True,
                        display_order=1,
                        is_critical=True,   # critical + "fryer"/"equipment" keywords → issue
                    ),
                ],
            ),
            CreateFormSectionRequest(
                title="Documentation",
                display_order=3,
                fields=[
                    CreateFormFieldRequest(
                        label="Staff Training Documentation",
                        field_type="audit_item",
                        is_required=True,
                        display_order=1,
                        is_critical=False,  # no keywords → task
                    ),
                ],
            ),
        ],
    )

    template = await FormService.create_template(template_req, ORG_ID, MANAGER_ID)
    template_id = str(template.id)
    log(f"Template created: {template.title} ({template_id})")

    # Collect field IDs by section title
    field_map: dict[str, str] = {}   # label → field_id
    section_ids: dict[str, str] = {} # title → section_id
    for section in template.sections:
        section_ids[section.title] = str(section.id)
        for field in section.fields:
            field_map[field.label] = str(field.id)

    fire_field_id  = field_map["Fire Exit Accessibility"]
    fryer_field_id = field_map["Fryer Equipment Maintenance"]
    docs_field_id  = field_map["Staff Training Documentation"]
    log(f"Fields: fire={fire_field_id[:8]}… fryer={fryer_field_id[:8]}… docs={docs_field_id[:8]}…")

    # ── 2. Audit config + section weights + field scores ─────────────────────
    print("\nStep 2: Setting up audit scoring config...")

    with conn.cursor() as cur:
        # audit_configs (passing_score=80)
        cur.execute(
            """
            INSERT INTO audit_configs (form_template_id, passing_score, is_deleted)
            VALUES (%s, %s, %s)
            """,
            (template_id, 80, False),
        )
        log("Audit config: passing_score=80")

        # section weights (equal weight — 1.0 each)
        for title, sid in section_ids.items():
            cur.execute(
                """
                INSERT INTO audit_section_weights (section_id, weight, is_deleted)
                VALUES (%s, %s, %s)
                """,
                (sid, 1.0, False),
            )
        log(f"Section weights set (1.0 each for {len(section_ids)} sections)")

        # field max scores (10 each)
        for label, fid in field_map.items():
            cur.execute(
                """
                INSERT INTO audit_field_scores (field_id, max_score, is_deleted)
                VALUES (%s, %s, %s)
                """,
                (fid, 10, False),
            )
        log(f"Field max scores set (10 each for {len(field_map)} fields)")

    conn.commit()

    # ── 3. Create form assignment for staff at this location ──────────────────
    print("\nStep 3: Creating form assignment...")
    assignment_req = CreateAssignmentRequest(
        form_template_id=template_id,
        assigned_to_user_id=STAFF_ID,
        assigned_to_location_id=LOCATION_ID,
        recurrence="once",
        due_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    assignment = await FormService.create_assignment(assignment_req, ORG_ID)
    assignment_id = assignment["id"]
    log(f"Assignment created: {assignment_id[:8]}… → staff {STAFF_ID[:8]}…")

    # ── 4. Staff submits form with all non_compliant answers ──────────────────
    print("\nStep 4: Staff submits form (all non_compliant — audit will fail)...")
    submission_req = CreateSubmissionRequest(
        assignment_id=assignment_id,
        form_template_id=template_id,
        status="submitted",
        responses=[
            FormResponseItem(field_id=fire_field_id,  value="non_compliant",
                             comment="Fire exit blocked by stock boxes"),
            FormResponseItem(field_id=fryer_field_id, value="non_compliant",
                             comment="Fryer filter overdue for replacement"),
            FormResponseItem(field_id=docs_field_id,  value="non_compliant",
                             comment="Training logs not updated this quarter"),
        ],
    )
    submission = await FormService.create_submission(submission_req, STAFF_ID)
    submission_id = submission["id"]
    overall_score = submission.get("overall_score", "?")
    passed = submission.get("passed", "?")
    log(f"Submission created: {submission_id[:8]}…  score={overall_score}  passed={passed}")

    if passed is not False:
        err("Submission unexpectedly passed — CAP will not be generated on approval. Check scoring config.")

    # ── 5. Manager approves submission → CAP auto-generated ──────────────────
    print("\nStep 5: Manager approves submission (triggers CAP generation)...")
    review_req = ReviewSubmissionRequest(
        status="approved",
        manager_comment="All three items failed — corrective actions required immediately.",
    )
    reviewed = await FormService.review_submission(
        submission_id=submission_id,
        body=review_req,
        reviewer_id=MANAGER_ID,
        org_id=ORG_ID,
    )
    log(f"Submission approved. Status: {reviewed.get('status')}")

    # Fetch the auto-generated CAP
    cap_record = await CAPService.get_cap_by_submission(submission_id, ORG_ID)
    if not cap_record:
        err("CAP was not auto-generated — check form_service.review_submission CAP logic")
        conn.close()
        return

    cap_id = cap_record["id"]
    log(f"CAP auto-generated: {cap_id[:8]}…  status={cap_record.get('status')}")

    # ── 6. Show CAP items and verify followup_type assignments ────────────────
    print("\nStep 6: Reviewing CAP items...")
    full_cap = await CAPService.get_cap(cap_id, ORG_ID)
    items = full_cap.get("cap_items", [])
    log(f"CAP has {len(items)} items")

    followup_counts: dict[str, int] = {}
    for item in items:
        ftype = item.get("followup_type", "?")
        followup_counts[ftype] = followup_counts.get(ftype, 0) + 1
        print(f"     [{ftype:10s}] {item.get('field_label','?')!r}  priority={item.get('followup_priority','?')}")

    # If any item has wrong type, manually fix it based on label
    with conn.cursor() as cur:
        for item in items:
            label = item.get("field_label", "").lower()
            expected = None
            if "fire" in label:
                expected = "incident"
            elif "fryer" in label or "equipment" in label:
                expected = "issue"
            elif "documentation" in label or "training" in label:
                expected = "task"
            if expected and item.get("followup_type") != expected:
                cur.execute(
                    """
                    UPDATE cap_items
                    SET followup_type = %s, updated_at = %s
                    WHERE id = %s
                    """,
                    (expected, datetime.now(timezone.utc), item["id"]),
                )
                log(f"Corrected followup_type on '{item.get('field_label')}': {item.get('followup_type')} → {expected}")
    conn.commit()

    # ── 7. Manager confirms CAP → spawns task, issue, incident ───────────────
    print("\nStep 7: Manager confirms CAP → spawning entities...")
    result = await CAPService.confirm_cap(cap_id, ORG_ID, MANAGER_ID)
    log(f"CAP confirmed!")
    log(f"  Tasks created:     {result['tasks_created']}")
    log(f"  Issues created:    {result['issues_created']}")
    log(f"  Incidents created: {result['incidents_created']}")
    log(f"  Items skipped:     {result['items_skipped']}")

    # ── 8. Summary ────────────────────────────────────────────────────────────
    print("\n=== Workflow Complete ===")
    print(f"  Form template:   {template_id}")
    print(f"  Assignment:      {assignment_id}")
    print(f"  Submission:      {submission_id}  (score={overall_score}, passed={passed})")
    print(f"  CAP:             {cap_id}")
    print(f"  Entities:        {result['tasks_created']} task(s), "
          f"{result['issues_created']} issue(s), "
          f"{result['incidents_created']} incident(s)")
    print()

    # Fetch and show spawned entity IDs
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT followup_type, field_label, spawned_task_id, spawned_issue_id, spawned_incident_id
            FROM cap_items
            WHERE cap_id = %s AND is_deleted = FALSE
            """,
            (cap_id,),
        )
        final_items = cur.fetchall()

    for item in final_items:
        spawned = []
        if item.get("spawned_task_id"):
            spawned.append(f"task:{item['spawned_task_id'][:8]}…")
        if item.get("spawned_issue_id"):
            spawned.append(f"issue:{item['spawned_issue_id'][:8]}…")
        if item.get("spawned_incident_id"):
            spawned.append(f"incident:{item['spawned_incident_id'][:8]}…")
        if spawned:
            print(f"  ↳ [{item.get('followup_type'):10s}] '{item.get('field_label')}' → {', '.join(spawned)}")

    conn.close()


if __name__ == "__main__":
    asyncio.run(main())
