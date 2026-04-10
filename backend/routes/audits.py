"""
Audit Routes — Phase 2
POST   /api/v1/audits/templates
GET    /api/v1/audits/templates
GET    /api/v1/audits/templates/{id}
PUT    /api/v1/audits/templates/{id}
DELETE /api/v1/audits/templates/{id}
POST   /api/v1/audits/submissions
GET    /api/v1/audits/submissions
GET    /api/v1/audits/submissions/{id}
GET    /api/v1/audits/submissions/{id}/export   (PDF stream)
POST   /api/v1/audits/submissions/{id}/signature
"""

import base64
import io
import json
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from dependencies import get_current_user, require_manager_or_above, paginate, get_db
from services.industry_context import get_industry_context
from models.audits import (
    CreateAuditTemplateRequest,
    UpdateAuditTemplateRequest,
    CreateAuditSubmissionRequest,
    UpdateCorrectiveActionRequest,
    CaptureSignatureRequest,
)
from services.audit_scoring_service import calculate_audit_score, create_corrective_actions
from services.workflow_service import instantiate_workflow
from services.form_service import FormService
from services.db import row, rows, execute, execute_returning
from services.ai_logger import log_ai_request, AITimer
from services.blob_storage import upload_blob, get_signed_url

logger = logging.getLogger(__name__)
router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_org(current_user: dict) -> str:
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation found for user")
    return org_id


# ─────────────────────────────────────────────────────────────────────────────
# Audit Templates
# ─────────────────────────────────────────────────────────────────────────────

class GenerateAuditTemplateBody(BaseModel):
    topic: str
    passing_score: int = 70


_AUDIT_TEMPLATE_SYSTEM = """You are an audit template designer for QSR and retail compliance.
Generate a fully scored audit template that frontline managers use during inspections.

Always respond with ONLY valid JSON — no markdown fences, no explanation.

Schema:
{
  "title": "string",
  "description": "string",
  "passing_score": number,
  "sections": [
    {
      "title": "string",
      "weight": number (sections must sum to 100),
      "fields": [
        {
          "label": "string",
          "field_type": "checkbox" | "text" | "number" | "photo" | "dropdown",
          "is_required": true | false,
          "is_critical": true | false,
          "scoring_type": "binary" | "partial",
          "max_score": number,
          "options": ["opt1", "opt2"] | null
        }
      ]
    }
  ]
}

Rules:
- Generate 3–5 sections with 4–7 fields each
- Section weights must sum to exactly 100
- Mark is_critical=true for regulatory or safety-critical items
- scoring_type=binary means 0 or max_score; partial means anywhere in between
- field_type=photo for visual verification; checkbox for yes/no compliance; dropdown for multi-option
- Keep field labels action-oriented and specific
- Include at least one photo field per section for verification
- Regulatory/safety items should have higher max_score (10–20); minor items 5–10
"""


@router.post("/templates/generate")
async def generate_audit_template_draft(
    body: GenerateAuditTemplateBody,
    current_user: dict = Depends(require_manager_or_above),
):
    """Use AI to generate an audit template draft that the frontend can review before saving."""
    org_id = _get_org(current_user)
    user_id = current_user.get("sub")

    from routes.ai_generate import _call_claude

    user_message = f"Generate an audit template for: {body.topic}\nPassing score threshold: {body.passing_score}%"

    with AITimer() as timer:
        try:
            text = await _call_claude(get_industry_context(org_id) + _AUDIT_TEMPLATE_SYSTEM, user_message)
            success = True
        except Exception as e:
            log_ai_request(
                feature="generate_audit_template_draft", model="claude-haiku-4-5",
                input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
                success=False, org_id=org_id, user_id=user_id, error_message=str(e),
            )
            raise

    log_ai_request(
        feature="generate_audit_template_draft", model="claude-haiku-4-5",
        input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
        success=True, org_id=org_id, user_id=user_id,
    )

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    for key in ("title", "sections"):
        if key not in data:
            raise HTTPException(status_code=502, detail=f"AI response missing required field: {key}")

    data.setdefault("passing_score", body.passing_score)
    return data


@router.post("/templates")
async def create_audit_template(
    body: CreateAuditTemplateRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    """Create an audit template with scoring config."""
    org_id = _get_org(current_user)
    created_by = current_user["sub"]

    # 1. Create form_template with type='audit'
    from models.forms import CreateFormTemplateRequest
    ft_req = CreateFormTemplateRequest(
        title=body.title,
        description=body.description,
        type="audit",
        sections=body.sections,
    )
    template = await FormService.create_template(ft_req, org_id, created_by)
    template_id = str(template.id)

    # 2. Persist audit_config (passing_score)
    execute(
        conn,
        """
        INSERT INTO audit_configs (form_template_id, passing_score)
        VALUES (%s, %s)
        ON CONFLICT (form_template_id) DO UPDATE SET passing_score = EXCLUDED.passing_score
        """,
        (template_id, body.passing_score),
    )

    # 3. Persist section weights
    if body.section_weights:
        for sw in body.section_weights:
            execute(
                conn,
                """
                INSERT INTO audit_section_weights (section_id, weight)
                VALUES (%s, %s)
                ON CONFLICT (section_id) DO UPDATE SET weight = EXCLUDED.weight
                """,
                (str(sw.section_id), sw.weight),
            )

    # 4. Persist field scores
    if body.field_scores:
        for fs in body.field_scores:
            execute(
                conn,
                """
                INSERT INTO audit_field_scores (field_id, max_score)
                VALUES (%s, %s)
                ON CONFLICT (field_id) DO UPDATE SET max_score = EXCLUDED.max_score
                """,
                (str(fs.field_id), fs.max_score),
            )

    return {**template.model_dump(), "passing_score": body.passing_score}


@router.get("/templates")
async def list_audit_templates(
    is_active: Optional[bool] = Query(None),
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = _get_org(current_user)

    conditions = [
        "ft.organisation_id = %s",
        "ft.type = 'audit'",
        "ft.is_deleted = FALSE",
    ]
    params: list = [org_id]

    if is_active is not None:
        conditions.append("ft.is_active = %s")
        params.append(is_active)

    where = " AND ".join(conditions)
    params += [pagination["page_size"], pagination["offset"]]

    return rows(
        conn,
        f"""
        SELECT
            ft.*,
            ac.passing_score
        FROM form_templates ft
        LEFT JOIN audit_configs ac ON ac.form_template_id = ft.id
        WHERE {where}
        ORDER BY ft.created_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params),
    )


@router.get("/templates/{template_id}")
async def get_audit_template(
    template_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = _get_org(current_user)

    tmpl = row(
        conn,
        """
        SELECT ft.*, ac.passing_score
        FROM form_templates ft
        LEFT JOIN audit_configs ac ON ac.form_template_id = ft.id
        WHERE ft.id = %s
          AND ft.organisation_id = %s
          AND ft.type = 'audit'
          AND ft.is_deleted = FALSE
        """,
        (str(template_id), org_id),
    )
    if not tmpl:
        raise HTTPException(status_code=404, detail="Audit template not found")

    sections = rows(
        conn,
        """
        SELECT fs.id, fs.title, fs.display_order,
               asw.weight
        FROM form_sections fs
        LEFT JOIN audit_section_weights asw ON asw.section_id = fs.id
        WHERE fs.form_template_id = %s
          AND fs.is_deleted = FALSE
        ORDER BY fs.display_order
        """,
        (str(template_id),),
    )

    section_ids = [str(s["id"]) for s in sections]
    fields_by_section: dict[str, list] = {sid: [] for sid in section_ids}

    if section_ids:
        all_fields = rows(
            conn,
            """
            SELECT ff.id, ff.form_section_id, ff.label, ff.field_type,
                   ff.is_required, ff.options, ff.display_order, ff.placeholder,
                   afs.max_score
            FROM form_fields ff
            LEFT JOIN audit_field_scores afs ON afs.field_id = ff.id
            WHERE ff.form_section_id = ANY(%s::uuid[])
              AND ff.is_deleted = FALSE
            ORDER BY ff.display_order
            """,
            (section_ids,),
        )
        for f in all_fields:
            key = str(f["form_section_id"])
            if key in fields_by_section:
                fields_by_section[key].append(dict(f))

    result = dict(tmpl)
    result["form_sections"] = [
        {**dict(s), "form_fields": fields_by_section.get(str(s["id"]), [])}
        for s in sections
    ]
    return result


@router.put("/templates/{template_id}")
async def update_audit_template(
    template_id: UUID,
    body: UpdateAuditTemplateRequest,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = _get_org(current_user)

    # Verify ownership
    existing = row(
        conn,
        """
        SELECT id FROM form_templates
        WHERE id = %s
          AND organisation_id = %s
          AND type = 'audit'
          AND is_deleted = FALSE
        """,
        (str(template_id), org_id),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Audit template not found")

    # Build dynamic SET clause for form_templates
    set_clauses = ["updated_at = %s"]
    params: list = [datetime.now(timezone.utc)]

    if body.title is not None:
        set_clauses.append("title = %s")
        params.append(body.title)
    if body.description is not None:
        set_clauses.append("description = %s")
        params.append(body.description)
    if body.is_active is not None:
        set_clauses.append("is_active = %s")
        params.append(body.is_active)

    params.append(str(template_id))
    execute(
        conn,
        f"UPDATE form_templates SET {', '.join(set_clauses)} WHERE id = %s",
        tuple(params),
    )

    if body.passing_score is not None:
        execute(
            conn,
            """
            INSERT INTO audit_configs (form_template_id, passing_score)
            VALUES (%s, %s)
            ON CONFLICT (form_template_id) DO UPDATE SET passing_score = EXCLUDED.passing_score
            """,
            (str(template_id), body.passing_score),
        )

    if body.section_weights:
        for sw in body.section_weights:
            execute(
                conn,
                """
                INSERT INTO audit_section_weights (section_id, weight)
                VALUES (%s, %s)
                ON CONFLICT (section_id) DO UPDATE SET weight = EXCLUDED.weight
                """,
                (str(sw.section_id), sw.weight),
            )

    if body.field_scores:
        for fs in body.field_scores:
            execute(
                conn,
                """
                INSERT INTO audit_field_scores (field_id, max_score)
                VALUES (%s, %s)
                ON CONFLICT (field_id) DO UPDATE SET max_score = EXCLUDED.max_score
                """,
                (str(fs.field_id), fs.max_score),
            )

    return {"success": True}


@router.delete("/templates/{template_id}")
async def delete_audit_template(
    template_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = _get_org(current_user)

    existing = row(
        conn,
        """
        SELECT id FROM form_templates
        WHERE id = %s
          AND organisation_id = %s
          AND type = 'audit'
          AND is_deleted = FALSE
        """,
        (str(template_id), org_id),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Audit template not found")

    execute(
        conn,
        """
        UPDATE form_templates
        SET is_deleted = TRUE, updated_at = %s
        WHERE id = %s
        """,
        (datetime.now(timezone.utc), str(template_id)),
    )

    return {"success": True}


# ─────────────────────────────────────────────────────────────────────────────
# Audit Submissions
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/submissions")
async def submit_audit(
    body: CreateAuditSubmissionRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """
    Submit audit → server scores → atomically create CAPs for failed fields
    → trigger workflow if defined.
    """
    org_id = _get_org(current_user)
    user_id = current_user["sub"]

    form_template_id = str(body.form_template_id)
    location_id = str(body.location_id)

    # Verify template belongs to org and is audit type
    tmpl = row(
        conn,
        """
        SELECT id, type FROM form_templates
        WHERE id = %s
          AND organisation_id = %s
          AND type = 'audit'
          AND is_deleted = FALSE
        """,
        (form_template_id, org_id),
    )
    if not tmpl:
        raise HTTPException(status_code=404, detail="Audit template not found")

    # 1. Score the submission server-side
    responses_raw = [{"field_id": str(r.field_id), "value": r.value} for r in body.responses]
    score_result = await calculate_audit_score(
        conn,
        submission_id="",   # not yet created
        form_template_id=form_template_id,
        responses=responses_raw,
        org_id=org_id,
    )

    # 2. Create form_submission record
    submission = execute_returning(
        conn,
        """
        INSERT INTO form_submissions
            (form_template_id, submitted_by, location_id, status,
             submitted_at, overall_score, passed)
        VALUES (%s, %s, %s, 'submitted', %s, %s, %s)
        RETURNING *
        """,
        (
            form_template_id,
            user_id,
            location_id,
            datetime.now(timezone.utc),
            score_result.overall_score,
            score_result.passed,
        ),
    )
    if not submission:
        raise HTTPException(status_code=500, detail="Failed to create submission")

    submission_id = str(submission["id"])

    # 3. Persist individual field responses
    if body.responses:
        for r in body.responses:
            execute(
                conn,
                """
                INSERT INTO form_responses (submission_id, field_id, value, comment)
                VALUES (%s, %s, %s, %s)
                """,
                (submission_id, str(r.field_id), r.value, r.comment),
            )

    # 4. Atomically create CAP for all failed fields (if audit failed)
    cap_id: str | None = None
    if not score_result.passed and score_result.failed_fields:
        try:
            responses_raw = [{"field_id": str(r.field_id), "value": r.value} for r in body.responses]
            cap = await create_corrective_actions(
                conn,
                submission_id=submission_id,
                failed_fields=score_result.failed_fields,
                org_id=org_id,
                location_id=location_id,
                form_template_id=form_template_id,
                responses=responses_raw,
            )
            cap_id = cap["id"] if cap else None
        except Exception as e:
            # Atomic requirement: roll back submission if CAP creation fails
            execute(conn, "DELETE FROM form_submissions WHERE id = %s", (submission_id,))
            execute(conn, "DELETE FROM form_responses WHERE submission_id = %s", (submission_id,))
            logger.error(f"CAP creation failed, rolling back submission: {e}")
            raise HTTPException(status_code=500, detail="Failed to create corrective actions — submission rolled back")

    # 5. Trigger workflow if definition exists
    try:
        response_map = {str(r.field_id): r.value for r in body.responses}
        await instantiate_workflow(
            submission_id=submission_id,
            form_template_id=form_template_id,
            org_id=org_id,
            location_id=location_id,
            submission_responses=response_map,
            overall_score=score_result.overall_score,
        )
    except Exception as e:
        logger.warning(f"Workflow instantiation failed (non-fatal): {e}")

    return {
        "id": submission_id,
        "form_template_id": form_template_id,
        "overall_score": score_result.overall_score,
        "passed": score_result.passed,
        "passing_score": score_result.passing_score,
        "cap_id": cap_id,
        "sections": [
            {
                "section_id": s.section_id,
                "title": s.title,
                "score_pct": s.score_pct,
                "fields": [
                    {
                        "field_id": f.field_id,
                        "label": f.label,
                        "achieved_score": f.achieved_score,
                        "max_score": f.max_score,
                        "is_failed": f.is_failed,
                    }
                    for f in s.fields
                ],
            }
            for s in score_result.sections
        ],
    }


@router.get("/submissions")
async def list_audit_submissions(
    location_id: Optional[str] = Query(None),
    passed: Optional[bool] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = _get_org(current_user)

    conditions = [
        "ft.organisation_id = %s",
        "ft.type = 'audit'",
    ]
    params: list = [org_id]

    if location_id:
        conditions.append("fs.location_id = %s")
        params.append(location_id)
    if passed is not None:
        conditions.append("fs.passed = %s")
        params.append(passed)
    if from_date:
        conditions.append("fs.submitted_at >= %s")
        params.append(from_date)
    if to_date:
        conditions.append("fs.submitted_at <= %s")
        params.append(to_date)

    where = " AND ".join(conditions)
    params += [pagination["page_size"], pagination["offset"]]

    return rows(
        conn,
        f"""
        SELECT
            fs.id, fs.form_template_id, fs.submitted_by, fs.location_id,
            fs.submitted_at, fs.overall_score, fs.passed, fs.status, fs.created_at,
            ft.title AS template_title, ft.type AS template_type
        FROM form_submissions fs
        JOIN form_templates ft ON ft.id = fs.form_template_id
        WHERE {where}
        ORDER BY fs.submitted_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params),
    )


@router.get("/submissions/{submission_id}")
async def get_audit_submission(
    submission_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = _get_org(current_user)

    submission = row(
        conn,
        """
        SELECT fs.*,
               ft.title AS template_title,
               ft.type  AS template_type
        FROM form_submissions fs
        JOIN form_templates ft ON ft.id = fs.form_template_id
        WHERE fs.id = %s
          AND ft.organisation_id = %s
          AND ft.type = 'audit'
        """,
        (str(submission_id), org_id),
    )
    if not submission:
        raise HTTPException(status_code=404, detail="Audit submission not found")

    result = dict(submission)

    result["form_responses"] = rows(
        conn,
        "SELECT field_id, value, comment FROM form_responses WHERE submission_id = %s",
        (str(submission_id),),
    )

    result["audit_signatures"] = rows(
        conn,
        "SELECT id, signed_by, signature_url, signed_at FROM audit_signatures WHERE submission_id = %s",
        (str(submission_id),),
    )

    result["corrective_actions"] = rows(
        conn,
        """
        SELECT id, field_id, description, status, assigned_to, due_at
        FROM corrective_actions
        WHERE submission_id = %s
        """,
        (str(submission_id),),
    )

    caps = rows(
        conn,
        """
        SELECT id, status, generated_at, reviewed_at
        FROM corrective_action_plans
        WHERE submission_id = %s
        """,
        (str(submission_id),),
    )
    cap_ids = [str(c["id"]) for c in caps]
    cap_items_by_cap: dict[str, list] = {cid: [] for cid in cap_ids}
    if cap_ids:
        cap_items = rows(
            conn,
            """
            SELECT id, cap_id, field_id, field_label, response_value, is_critical,
                   followup_type, followup_title, followup_priority, spawned_task_id
            FROM cap_items
            WHERE cap_id = ANY(%s::uuid[])
            """,
            (cap_ids,),
        )
        for item in cap_items:
            key = str(item["cap_id"])
            if key in cap_items_by_cap:
                cap_items_by_cap[key].append(dict(item))

    result["corrective_action_plans"] = [
        {**dict(c), "cap_items": cap_items_by_cap.get(str(c["id"]), [])}
        for c in caps
    ]

    return result


# ─────────────────────────────────────────────────────────────────────────────
# PDF Export
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/submissions/{submission_id}/export")
async def export_audit_pdf(
    submission_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    """Stream a PDF audit report generated on-demand via reportlab."""
    org_id = _get_org(current_user)

    submission = row(
        conn,
        """
        SELECT fs.*,
               ft.title AS template_title,
               ft.type  AS template_type
        FROM form_submissions fs
        JOIN form_templates ft ON ft.id = fs.form_template_id
        WHERE fs.id = %s
          AND ft.organisation_id = %s
          AND ft.type = 'audit'
        """,
        (str(submission_id), org_id),
    )
    if not submission:
        raise HTTPException(status_code=404, detail="Audit submission not found")

    result = dict(submission)

    # Load sections + fields for the template
    sections = rows(
        conn,
        """
        SELECT id, title, display_order
        FROM form_sections
        WHERE form_template_id = %s
          AND is_deleted = FALSE
        ORDER BY display_order
        """,
        (str(result["form_template_id"]),),
    )
    section_ids = [str(s["id"]) for s in sections]
    fields_by_section: dict[str, list] = {sid: [] for sid in section_ids}
    if section_ids:
        all_fields = rows(
            conn,
            """
            SELECT id, form_section_id, label, field_type, display_order
            FROM form_fields
            WHERE form_section_id = ANY(%s::uuid[])
              AND is_deleted = FALSE
            ORDER BY display_order
            """,
            (section_ids,),
        )
        for f in all_fields:
            key = str(f["form_section_id"])
            if key in fields_by_section:
                fields_by_section[key].append(dict(f))

    result["form_templates"] = {
        "title": result.pop("template_title", ""),
        "type": result.pop("template_type", ""),
        "form_sections": [
            {**dict(s), "form_fields": fields_by_section.get(str(s["id"]), [])}
            for s in sections
        ],
    }

    result["form_responses"] = rows(
        conn,
        "SELECT field_id, value, comment FROM form_responses WHERE submission_id = %s",
        (str(submission_id),),
    )

    result["audit_signatures"] = rows(
        conn,
        "SELECT signed_by, signature_url, signed_at FROM audit_signatures WHERE submission_id = %s",
        (str(submission_id),),
    )

    result["corrective_actions"] = rows(
        conn,
        """
        SELECT field_id, description, status, due_at
        FROM corrective_actions
        WHERE submission_id = %s
        """,
        (str(submission_id),),
    )

    pdf_bytes = _generate_audit_pdf(result)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="audit-{submission_id}.pdf"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


def _generate_audit_pdf(submission: dict) -> bytes:
    """Generate PDF using reportlab."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.colors import HexColor, black, white
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.enums import TA_CENTER, TA_LEFT

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=2*cm, bottomMargin=2*cm,
                            leftMargin=2*cm, rightMargin=2*cm)

    styles = getSampleStyleSheet()
    brand = HexColor("#00B4D8")
    pass_color = HexColor("#22C55E")
    fail_color = HexColor("#EF4444")

    title_style = ParagraphStyle("Title", parent=styles["Title"],
                                 textColor=brand, fontSize=20, spaceAfter=6)
    h2_style = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=13,
                               textColor=HexColor("#1E293B"), spaceAfter=4)
    body_style = styles["BodyText"]

    template = submission.get("form_templates", {})
    response_map = {str(r["field_id"]): r["value"] for r in (submission.get("form_responses") or [])}
    caps = submission.get("corrective_actions") or []
    signature = (submission.get("audit_signatures") or [None])[0] if submission.get("audit_signatures") else None

    overall_score = submission.get("overall_score", 0)
    passed = submission.get("passed", False)
    submitted_at = submission.get("submitted_at", "")

    elements = []

    # Header
    elements.append(Paragraph(template.get("title", "Audit Report"), title_style))
    elements.append(Paragraph(f"Submitted: {submitted_at[:19].replace('T', ' ') if submitted_at else 'N/A'}", body_style))
    elements.append(Spacer(1, 0.3*cm))

    # Score badge table
    score_color = pass_color if passed else fail_color
    score_label = "PASSED" if passed else "FAILED"
    score_table = Table(
        [[Paragraph(f"<b>{overall_score:.1f}%</b>", ParagraphStyle("sc", fontSize=22, textColor=white, alignment=TA_CENTER)),
          Paragraph(f"<b>{score_label}</b>", ParagraphStyle("sl", fontSize=18, textColor=white, alignment=TA_CENTER))]],
        colWidths=[5*cm, 5*cm],
    )
    score_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), score_color),
        ("BACKGROUND", (1, 0), (1, 0), score_color),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWPADDING", (0, 0), (-1, -1), 8),
        ("ROUNDEDCORNERS", [4]),
    ]))
    elements.append(score_table)
    elements.append(Spacer(1, 0.5*cm))
    elements.append(HRFlowable(width="100%", thickness=1, color=HexColor("#E2E8F0")))
    elements.append(Spacer(1, 0.3*cm))

    # Sections
    for section in sorted(template.get("form_sections") or [], key=lambda s: s.get("display_order", 0)):
        elements.append(Paragraph(section.get("title", "Section"), h2_style))
        table_rows = [["Field", "Response"]]
        for field in sorted(section.get("form_fields") or [], key=lambda f: f.get("display_order", 0)):
            fid = str(field["id"])
            response_val = response_map.get(fid, "—")
            table_rows.append([field.get("label", ""), response_val])

        t = Table(table_rows, colWidths=[9*cm, 7*cm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), brand),
            ("TEXTCOLOR", (0, 0), (-1, 0), white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#F8FAFC"), white]),
            ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#CBD5E1")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(t)
        elements.append(Spacer(1, 0.4*cm))

    # Corrective Actions
    if caps:
        elements.append(HRFlowable(width="100%", thickness=1, color=HexColor("#E2E8F0")))
        elements.append(Spacer(1, 0.2*cm))
        elements.append(Paragraph("Corrective Action Plans", h2_style))
        cap_rows = [["Description", "Status", "Due Date"]]
        for cap in caps:
            due = cap.get("due_at", "—") or "—"
            if due and due != "—":
                due = due[:10]
            cap_rows.append([cap.get("description", ""), cap.get("status", "open"), due])
        cap_t = Table(cap_rows, colWidths=[11*cm, 3*cm, 3*cm])
        cap_t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), fail_color),
            ("TEXTCOLOR", (0, 0), (-1, 0), white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#FEF2F2"), white]),
            ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#FECACA")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(cap_t)
        elements.append(Spacer(1, 0.4*cm))

    # Signature
    if signature:
        elements.append(HRFlowable(width="100%", thickness=1, color=HexColor("#E2E8F0")))
        elements.append(Spacer(1, 0.2*cm))
        elements.append(Paragraph("Auditee Signature", h2_style))
        signed_at = signature.get("signed_at", "")[:19].replace("T", " ") if signature.get("signed_at") else "N/A"
        elements.append(Paragraph(f"Signed at: {signed_at}", body_style))
        elements.append(Spacer(1, 0.3*cm))

    doc.build(elements)
    return buf.getvalue()


# ─────────────────────────────────────────────────────────────────────────────
# Audit Signature
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/submissions/{submission_id}/signature")
async def capture_signature(
    submission_id: UUID,
    body: CaptureSignatureRequest,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    """Upload a base64 signature PNG to audit-signatures bucket and record it."""
    org_id = _get_org(current_user)
    user_id = current_user["sub"]

    # Verify submission belongs to org
    existing = row(
        conn,
        """
        SELECT fs.id
        FROM form_submissions fs
        JOIN form_templates ft ON ft.id = fs.form_template_id
        WHERE fs.id = %s
          AND ft.organisation_id = %s
          AND ft.type = 'audit'
        """,
        (str(submission_id), org_id),
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Audit submission not found")

    # Decode base64 data URL (data:image/png;base64,<data>)
    data_url = body.signature_data_url
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]

    try:
        img_bytes = base64.b64decode(data_url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 signature data")

    path = f"{org_id}/{submission_id}/signature_{uuid4().hex}.png"

    try:
        upload_blob("audit-signatures", path, img_bytes, "image/png")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload signature: {e}")

    signed_url = get_signed_url("audit-signatures", path, 3600)

    # Upsert audit_signatures record
    execute(
        conn,
        """
        INSERT INTO audit_signatures (submission_id, signed_by, signature_url, signed_at)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (submission_id)
        DO UPDATE SET
            signed_by     = EXCLUDED.signed_by,
            signature_url = EXCLUDED.signature_url,
            signed_at     = EXCLUDED.signed_at
        """,
        (str(submission_id), user_id, path, datetime.now(timezone.utc)),
    )

    return {
        "success": True,
        "signature_url": signed_url,
        "signed_at": datetime.now(timezone.utc).isoformat(),
    }
