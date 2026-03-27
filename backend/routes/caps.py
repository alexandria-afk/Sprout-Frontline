"""
Corrective Action Plans API — /api/v1/caps
"""
import io
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from dependencies import get_current_user, require_manager_or_above, paginate
from models.caps import UpdateCAPItemRequest, DismissCAPRequest
from services.cap_service import CAPService
from services.supabase_client import get_admin_client

router = APIRouter()


@router.get("/")
async def list_caps(
    pagination: dict = Depends(paginate),
    status: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await CAPService.list_caps(
        org_id=org_id,
        status=status,
        location_id=location_id,
        from_date=from_date,
        to_date=to_date,
        page=pagination["page"],
        page_size=pagination["page_size"],
    )


@router.get("/submission/{submission_id}")
async def get_cap_by_submission(
    submission_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    cap = await CAPService.get_cap_by_submission(str(submission_id), org_id)
    if not cap:
        return {"cap": None}
    return cap


@router.get("/{cap_id}")
async def get_cap(
    cap_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await CAPService.get_cap(str(cap_id), org_id)


@router.put("/{cap_id}/items/{item_id}")
async def update_cap_item(
    cap_id: UUID,
    item_id: UUID,
    body: UpdateCAPItemRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await CAPService.update_cap_item(str(cap_id), str(item_id), org_id, user_id, body)


@router.post("/{cap_id}/confirm")
async def confirm_cap(
    cap_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await CAPService.confirm_cap(str(cap_id), org_id, user_id)


@router.post("/{cap_id}/dismiss")
async def dismiss_cap(
    cap_id: UUID,
    body: DismissCAPRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await CAPService.dismiss_cap(str(cap_id), org_id, user_id, body.reason)


# ── PDF Export ─────────────────────────────────────────────────────────────────

@router.get("/{cap_id}/export")
async def export_cap_pdf(
    cap_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    """Stream a PDF CAP report generated on-demand via reportlab."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation found for user")
    db = get_admin_client()

    # Fetch CAP with related data
    cap_resp = (
        db.table("corrective_action_plans")
        .select(
            "*, locations(name), "
            "form_submissions(submitted_at, overall_score, passed, "
            "form_templates(title))"
        )
        .eq("id", str(cap_id))
        .eq("organisation_id", org_id)
        .eq("is_deleted", False)
        .maybe_single()
        .execute()
    )
    if not cap_resp.data:
        raise HTTPException(status_code=404, detail="CAP not found")
    cap = cap_resp.data

    # Fetch CAP items with assignee info
    items_resp = (
        db.table("cap_items")
        .select("*, followup_assignee:profiles!followup_assignee_id(full_name)")
        .eq("cap_id", str(cap_id))
        .eq("is_deleted", False)
        .execute()
    )
    items = items_resp.data or []

    pdf_bytes = _generate_cap_pdf(cap, items)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="cap-{str(cap_id)[:8]}.pdf"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


def _generate_cap_pdf(cap: dict, items: list) -> bytes:
    """Generate a CAP PDF using reportlab."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.colors import HexColor, white
    from reportlab.lib.units import cm
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm,
                            leftMargin=2 * cm, rightMargin=2 * cm)

    styles = getSampleStyleSheet()
    brand = HexColor("#7C3AED")  # sprout-purple
    pass_color = HexColor("#22C55E")
    fail_color = HexColor("#EF4444")
    amber_color = HexColor("#F59E0B")

    title_style = ParagraphStyle("Title", parent=styles["Title"],
                                 textColor=brand, fontSize=20, spaceAfter=4)
    h2_style = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12,
                               textColor=HexColor("#1E293B"), spaceAfter=4)
    body_style = styles["BodyText"]
    small_style = ParagraphStyle("Small", parent=styles["BodyText"], fontSize=8)

    sub = cap.get("form_submissions") or {}
    template = sub.get("form_templates") or {}
    location = cap.get("locations") or {}
    submitted_at = sub.get("submitted_at", "")
    overall_score = sub.get("overall_score")
    passed = sub.get("passed", False)

    STATUS_LABELS = {
        "pending_review": "Pending Review",
        "in_review": "In Review",
        "confirmed": "Confirmed",
        "dismissed": "Dismissed",
    }
    STATUS_COLORS = {
        "pending_review": HexColor("#F59E0B"),
        "in_review": HexColor("#3B82F6"),
        "confirmed": HexColor("#22C55E"),
        "dismissed": HexColor("#6B7280"),
    }
    PRIORITY_COLORS = {
        "critical": HexColor("#EF4444"),
        "high": HexColor("#F97316"),
        "medium": HexColor("#F59E0B"),
        "low": HexColor("#9CA3AF"),
    }

    cap_status = cap.get("status", "pending_review")
    status_label = STATUS_LABELS.get(cap_status, cap_status.replace("_", " ").title())
    status_color = STATUS_COLORS.get(cap_status, brand)

    elements = []

    # Title
    elements.append(Paragraph("Corrective Action Plan", title_style))

    # Subtitle info
    meta_lines = []
    if template.get("title"):
        meta_lines.append(template["title"])
    if location.get("name"):
        meta_lines.append(f"Location: {location['name']}")
    if submitted_at:
        meta_lines.append(f"Submitted: {submitted_at[:10]}")
    if overall_score is not None:
        score_label = "PASSED" if passed else "FAILED"
        meta_lines.append(f"Audit Score: {overall_score:.1f}% — {score_label}")
    for line in meta_lines:
        elements.append(Paragraph(line, body_style))
    elements.append(Spacer(1, 0.3 * cm))

    # Status badge
    status_table = Table(
        [[Paragraph(f"<b>Status: {status_label}</b>",
                    ParagraphStyle("st", fontSize=11, textColor=white, alignment=TA_CENTER))]],
        colWidths=[6 * cm],
    )
    status_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), status_color),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWPADDING", (0, 0), (-1, -1), 6),
        ("ROUNDEDCORNERS", [4]),
    ]))
    elements.append(status_table)
    elements.append(Spacer(1, 0.4 * cm))
    elements.append(HRFlowable(width="100%", thickness=1, color=HexColor("#E2E8F0")))
    elements.append(Spacer(1, 0.3 * cm))

    if cap.get("dismissed_reason"):
        elements.append(Paragraph("Dismissed Reason", h2_style))
        elements.append(Paragraph(cap["dismissed_reason"], body_style))
        elements.append(Spacer(1, 0.3 * cm))

    # CAP items table
    elements.append(Paragraph("Action Items", h2_style))
    if items:
        header = [
            Paragraph("<b>Field Label</b>", small_style),
            Paragraph("<b>Priority</b>", small_style),
            Paragraph("<b>Follow-up Type</b>", small_style),
            Paragraph("<b>Assigned To</b>", small_style),
            Paragraph("<b>Due Date</b>", small_style),
            Paragraph("<b>Status</b>", small_style),
        ]
        rows = [header]
        for item in items:
            priority = item.get("followup_priority") or item.get("suggested_priority") or "medium"
            ftype = item.get("followup_type") or item.get("suggested_followup_type") or "task"
            due = item.get("followup_due_at", "") or ""
            if due:
                due = due[:10]
            assignee_obj = item.get("followup_assignee") or {}
            assignee_name = assignee_obj.get("full_name", "Unassigned") if isinstance(assignee_obj, dict) else "Unassigned"
            spawned = []
            if item.get("spawned_task_id"):
                spawned.append("Task")
            if item.get("spawned_issue_id"):
                spawned.append("Issue")
            if item.get("spawned_incident_id"):
                spawned.append("Incident")
            item_status = ", ".join(spawned) if spawned else ("Skipped" if ftype == "none" else "Pending")

            label_text = item.get("field_label", "")
            if item.get("is_critical"):
                label_text = f"{label_text} [CRITICAL]"

            rows.append([
                Paragraph(label_text, small_style),
                Paragraph(priority.title(), small_style),
                Paragraph(ftype.title(), small_style),
                Paragraph(assignee_name, small_style),
                Paragraph(due or "—", small_style),
                Paragraph(item_status, small_style),
            ])

        col_widths = [5.5 * cm, 2 * cm, 2.5 * cm, 3 * cm, 2.2 * cm, 2.3 * cm]
        t = Table(rows, colWidths=col_widths)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), brand),
            ("TEXTCOLOR", (0, 0), (-1, 0), white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#F8FAFC"), white]),
            ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#CBD5E1")),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        elements.append(t)
    else:
        elements.append(Paragraph("No items in this CAP.", body_style))

    elements.append(Spacer(1, 0.5 * cm))
    elements.append(HRFlowable(width="100%", thickness=1, color=HexColor("#E2E8F0")))
    elements.append(Spacer(1, 0.2 * cm))

    # Footer
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    elements.append(Paragraph(
        f"Generated: {generated_at}",
        ParagraphStyle("footer", parent=styles["BodyText"], fontSize=8, textColor=HexColor("#94A3B8")),
    ))

    doc.build(elements)
    return buf.getvalue()
