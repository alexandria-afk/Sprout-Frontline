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

from dependencies import get_current_user, require_manager_or_above, paginate
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
from services.supabase_client import get_admin_client
from services.ai_logger import log_ai_request, AITimer

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
            text = await _call_claude(_AUDIT_TEMPLATE_SYSTEM, user_message)
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
):
    """Create an audit template with scoring config."""
    org_id = _get_org(current_user)
    created_by = current_user["sub"]
    db = get_admin_client()

    # 1. Create form_template with type='audit'
    from models.forms import CreateFormTemplateRequest, CreateFormSectionRequest
    ft_req = CreateFormTemplateRequest(
        title=body.title,
        description=body.description,
        type="audit",
        sections=body.sections,
    )
    template = await FormService.create_template(ft_req, org_id, created_by)
    template_id = str(template.id)

    # 2. Persist audit_config (passing_score)
    db.table("audit_configs").insert({
        "form_template_id": template_id,
        "passing_score": body.passing_score,
    }).execute()

    # 3. Persist section weights
    if body.section_weights:
        db.table("audit_section_weights").insert([
            {"section_id": str(sw.section_id), "weight": sw.weight}
            for sw in body.section_weights
        ]).execute()

    # 4. Persist field scores
    if body.field_scores:
        db.table("audit_field_scores").insert([
            {"field_id": str(fs.field_id), "max_score": fs.max_score}
            for fs in body.field_scores
        ]).execute()

    return {**template.model_dump(), "passing_score": body.passing_score}


@router.get("/templates")
async def list_audit_templates(
    is_active: Optional[bool] = Query(None),
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    q = db.table("form_templates") \
        .select("*, audit_configs(passing_score)") \
        .eq("organisation_id", org_id) \
        .eq("type", "audit") \
        .eq("is_deleted", False) \
        .order("created_at", desc=True)

    if is_active is not None:
        q = q.eq("is_active", is_active)

    q = q.range(
        pagination["offset"],
        pagination["offset"] + pagination["page_size"] - 1,
    )
    res = q.execute()
    return res.data


@router.get("/templates/{template_id}")
async def get_audit_template(
    template_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    res = db.table("form_templates") \
        .select("""
            *,
            audit_configs(passing_score),
            form_sections(
                id, title, display_order,
                audit_section_weights(weight),
                form_fields(
                    id, label, field_type, is_required, options,
                    display_order, placeholder,
                    audit_field_scores(max_score)
                )
            )
        """) \
        .eq("id", str(template_id)) \
        .eq("organisation_id", org_id) \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Audit template not found")
    return res.data


@router.put("/templates/{template_id}")
async def update_audit_template(
    template_id: UUID,
    body: UpdateAuditTemplateRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    # Verify ownership
    existing = db.table("form_templates") \
        .select("id") \
        .eq("id", str(template_id)) \
        .eq("organisation_id", org_id) \
        .eq("type", "audit") \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Audit template not found")

    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.title is not None:
        updates["title"] = body.title
    if body.description is not None:
        updates["description"] = body.description
    if body.is_active is not None:
        updates["is_active"] = body.is_active

    if updates:
        db.table("form_templates").update(updates).eq("id", str(template_id)).execute()

    if body.passing_score is not None:
        db.table("audit_configs").upsert({
            "form_template_id": str(template_id),
            "passing_score": body.passing_score,
        }, on_conflict="form_template_id").execute()

    if body.section_weights:
        for sw in body.section_weights:
            db.table("audit_section_weights").upsert({
                "section_id": str(sw.section_id),
                "weight": sw.weight,
            }, on_conflict="section_id").execute()

    if body.field_scores:
        for fs in body.field_scores:
            db.table("audit_field_scores").upsert({
                "field_id": str(fs.field_id),
                "max_score": fs.max_score,
            }, on_conflict="field_id").execute()

    return {"success": True}


@router.delete("/templates/{template_id}")
async def delete_audit_template(
    template_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    existing = db.table("form_templates") \
        .select("id") \
        .eq("id", str(template_id)) \
        .eq("organisation_id", org_id) \
        .eq("type", "audit") \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Audit template not found")

    db.table("form_templates").update({
        "is_deleted": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", str(template_id)).execute()

    return {"success": True}


# ─────────────────────────────────────────────────────────────────────────────
# Audit Submissions
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/submissions")
async def submit_audit(
    body: CreateAuditSubmissionRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Submit audit → server scores → atomically create CAPs for failed fields
    → trigger workflow if defined.
    """
    org_id = _get_org(current_user)
    user_id = current_user["sub"]
    db = get_admin_client()

    form_template_id = str(body.form_template_id)
    location_id = str(body.location_id)

    # Verify template belongs to org and is audit type
    tmpl = db.table("form_templates") \
        .select("id, type") \
        .eq("id", form_template_id) \
        .eq("organisation_id", org_id) \
        .eq("type", "audit") \
        .eq("is_deleted", False) \
        .maybe_single() \
        .execute()
    if not tmpl.data:
        raise HTTPException(status_code=404, detail="Audit template not found")

    # 1. Score the submission server-side
    responses_raw = [{"field_id": str(r.field_id), "value": r.value} for r in body.responses]
    score_result = await calculate_audit_score(
        submission_id="",   # not yet created
        form_template_id=form_template_id,
        responses=responses_raw,
        org_id=org_id,
    )

    # 2. Create form_submission record
    sub_res = db.table("form_submissions").insert({
        "form_template_id": form_template_id,
        "submitted_by": user_id,
        "location_id": location_id,
        "status": "submitted",
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "overall_score": score_result.overall_score,
        "passed": score_result.passed,
    }).execute()

    if not sub_res.data:
        raise HTTPException(status_code=500, detail="Failed to create submission")

    submission = sub_res.data[0]
    submission_id = submission["id"]

    # 3. Persist individual field responses
    if body.responses:
        response_records = [
            {
                "submission_id": submission_id,
                "field_id": str(r.field_id),
                "value": r.value,
                "comment": r.comment,
            }
            for r in body.responses
        ]
        db.table("form_responses").insert(response_records).execute()

    # 4. Atomically create CAP for all failed fields (if audit failed)
    cap_id: str | None = None
    if not score_result.passed and score_result.failed_fields:
        try:
            responses_raw = [{"field_id": str(r.field_id), "value": r.value} for r in body.responses]
            cap = await create_corrective_actions(
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
            db.table("form_submissions").delete().eq("id", submission_id).execute()
            db.table("form_responses").delete().eq("submission_id", submission_id).execute()
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
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    q = db.table("form_submissions") \
        .select("""
            id, form_template_id, submitted_by, location_id,
            submitted_at, overall_score, passed, status, created_at,
            form_templates!inner(title, type, organisation_id)
        """) \
        .eq("form_templates.organisation_id", org_id) \
        .eq("form_templates.type", "audit") \
        .order("submitted_at", desc=True)

    if location_id:
        q = q.eq("location_id", location_id)
    if passed is not None:
        q = q.eq("passed", passed)
    if from_date:
        q = q.gte("submitted_at", from_date)
    if to_date:
        q = q.lte("submitted_at", to_date)

    q = q.range(
        pagination["offset"],
        pagination["offset"] + pagination["page_size"] - 1,
    )
    res = q.execute()
    return res.data


@router.get("/submissions/{submission_id}")
async def get_audit_submission(
    submission_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = _get_org(current_user)
    db = get_admin_client()

    res = db.table("form_submissions") \
        .select("""
            *,
            form_templates!inner(title, type, organisation_id),
            form_responses(field_id, value, comment),
            audit_signatures(id, signed_by, signature_url, signed_at),
            corrective_actions(id, field_id, description, status, assigned_to, due_at),
            corrective_action_plans(id, status, generated_at, reviewed_at,
                cap_items(id, field_id, field_label, response_value, is_critical,
                    followup_type, followup_title, followup_priority, spawned_task_id))
        """) \
        .eq("id", str(submission_id)) \
        .eq("form_templates.organisation_id", org_id) \
        .eq("form_templates.type", "audit") \
        .maybe_single() \
        .execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Audit submission not found")
    return res.data


# ─────────────────────────────────────────────────────────────────────────────
# PDF Export
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/submissions/{submission_id}/export")
async def export_audit_pdf(
    submission_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    """Stream a PDF audit report generated on-demand via reportlab."""
    org_id = _get_org(current_user)
    db = get_admin_client()

    # Fetch submission with full detail
    res = db.table("form_submissions") \
        .select("""
            *,
            form_templates!inner(title, type, organisation_id, form_sections(
                id, title, display_order,
                form_fields(id, label, field_type, display_order)
            )),
            form_responses(field_id, value, comment),
            audit_signatures(signed_by, signature_url, signed_at),
            corrective_actions(field_id, description, status, due_at)
        """) \
        .eq("id", str(submission_id)) \
        .eq("form_templates.organisation_id", org_id) \
        .eq("form_templates.type", "audit") \
        .maybe_single() \
        .execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Audit submission not found")

    submission = res.data
    pdf_bytes = _generate_audit_pdf(submission)

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
        rows = [["Field", "Response"]]
        for field in sorted(section.get("form_fields") or [], key=lambda f: f.get("display_order", 0)):
            fid = str(field["id"])
            response_val = response_map.get(fid, "—")
            rows.append([field.get("label", ""), response_val])

        t = Table(rows, colWidths=[9*cm, 7*cm])
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
):
    """Upload a base64 signature PNG to audit-signatures bucket and record it."""
    org_id = _get_org(current_user)
    user_id = current_user["sub"]
    db = get_admin_client()

    # Verify submission belongs to org
    res = db.table("form_submissions") \
        .select("id, form_templates!inner(organisation_id, type)") \
        .eq("id", str(submission_id)) \
        .eq("form_templates.organisation_id", org_id) \
        .eq("form_templates.type", "audit") \
        .maybe_single() \
        .execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Audit submission not found")

    # Decode base64 data URL (data:image/png;base64,<data>)
    data_url = body.signature_data_url
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]

    try:
        img_bytes = base64.b64decode(data_url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 signature data")

    # Upload to audit-signatures bucket
    path = f"{org_id}/{submission_id}/signature_{uuid4().hex}.png"
    from services.supabase_client import get_supabase
    storage = get_supabase().storage.from_("audit-signatures")

    try:
        storage.upload(path, img_bytes, {"content-type": "image/png", "upsert": "true"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload signature: {e}")

    # Generate signed URL (1 hour)
    signed = storage.create_signed_url(path, 3600)
    signed_url = signed.get("signedURL") or signed.get("signed_url") or path

    # Upsert audit_signatures record
    sig_res = db.table("audit_signatures").upsert({
        "submission_id": str(submission_id),
        "signed_by": user_id,
        "signature_url": path,   # store path, serve via signed URL
        "signed_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="submission_id").execute()

    return {
        "success": True,
        "signature_url": signed_url,
        "signed_at": datetime.now(timezone.utc).isoformat(),
    }
