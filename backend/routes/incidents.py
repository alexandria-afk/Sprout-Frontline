"""
Incidents API — /api/v1/incidents
Incident reporting and management for operations.
Lifecycle: reported → investigating → closed
"""
import io
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from dependencies import get_current_user, require_manager_or_above, get_db
from services.db import row, rows
from services.incident_service import IncidentService

router = APIRouter()


# ── Request Models ─────────────────────────────────────────────────────────────

class CreateIncidentBody(BaseModel):
    title: str
    description: Optional[str] = None
    incident_date: str  # ISO datetime string
    severity: str = "medium"  # low, medium, high, critical
    location_description: Optional[str] = None
    location_id: Optional[str] = None
    people_involved: Optional[str] = None
    regulatory_body: Optional[str] = None


class UpdateIncidentBody(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None  # low | medium | high | critical


class UpdateIncidentStatusBody(BaseModel):
    status: str  # reported | investigating | closed
    note: Optional[str] = None


class AddIncidentAttachmentBody(BaseModel):
    file_url: str
    file_type: str = "image"  # image | video | document


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("")
async def list_incidents(
    status: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    my_team: Optional[bool] = Query(None),
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]

    # Resolve team member IDs for manager view
    team_user_ids: Optional[list] = None
    if my_team:
        team_rows = rows(
            conn,
            "SELECT id FROM profiles WHERE reports_to = %s AND is_deleted = FALSE",
            (user_id,),
        )
        team_user_ids = [r["id"] for r in team_rows] + [user_id]

    return await IncidentService.list_incidents(
        conn=conn,
        org_id=org_id,
        status=status,
        severity=severity,
        limit=limit,
        team_user_ids=team_user_ids,
    )


@router.post("")
async def create_incident(
    body: CreateIncidentBody,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    incident = await IncidentService.create_incident(
        conn=conn,
        org_id=org_id,
        user_id=user_id,
        body=body,
    )

    # Auto-trigger any incident_created workflows
    try:
        from services.workflow_service import trigger_workflows_for_event
        await trigger_workflows_for_event(
            event_type="incident_created",
            org_id=org_id,
            source_id=incident["id"],
            triggered_by=user_id,
            location_id=incident.get("location_id"),
        )
    except Exception as _wf_exc:
        import logging
        logging.getLogger(__name__).warning(f"Workflow trigger failed for incident {incident['id']}: {_wf_exc}")

    return incident


@router.get("/{incident_id}")
async def get_incident(
    incident_id: UUID,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await IncidentService.get_incident(
        conn=conn,
        incident_id=str(incident_id),
        org_id=org_id,
    )


@router.patch("/{incident_id}")
async def update_incident(
    incident_id: UUID,
    body: UpdateIncidentBody,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await IncidentService.update_incident(
        conn=conn,
        incident_id=str(incident_id),
        org_id=org_id,
        body=body,
    )


@router.put("/{incident_id}/status")
async def update_incident_status(
    incident_id: UUID,
    body: UpdateIncidentStatusBody,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await IncidentService.update_incident_status(
        conn=conn,
        incident_id=str(incident_id),
        org_id=org_id,
        user_id=user_id,
        new_status=body.status,
        note=body.note,
    )


@router.post("/{incident_id}/attachments")
async def add_incident_attachment(
    incident_id: UUID,
    body: AddIncidentAttachmentBody,
    current_user: dict = Depends(get_current_user),
    conn=Depends(get_db),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user["sub"]
    return await IncidentService.add_attachment(
        conn=conn,
        incident_id=str(incident_id),
        org_id=org_id,
        user_id=user_id,
        file_url=body.file_url,
        file_type=body.file_type,
    )


# ── PDF Export ─────────────────────────────────────────────────────────────────

@router.get("/{incident_id}/export")
async def export_incident_pdf(
    incident_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
    conn=Depends(get_db),
):
    """Stream a PDF incident report generated on-demand via reportlab."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation found for user")

    # Fetch incident with reporter
    incident = row(
        conn,
        """
        SELECT i.*, json_build_object('full_name', p.full_name) AS profiles
        FROM incidents i
        LEFT JOIN profiles p ON p.id = i.reported_by
        WHERE i.id = %s AND i.org_id = %s
        """,
        (str(incident_id), org_id),
    )
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    incident = dict(incident)

    # Fetch comments (best-effort)
    try:
        comments = rows(
            conn,
            """
            SELECT ic.body, ic.created_at,
                   json_build_object('full_name', p.full_name) AS profiles
            FROM incident_comments ic
            LEFT JOIN profiles p ON p.id = ic.user_id
            WHERE ic.incident_id = %s
            ORDER BY ic.created_at ASC
            """,
            (str(incident_id),),
        )
    except Exception:
        comments = []

    pdf_bytes = _generate_incident_pdf(incident, comments)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="incident-{str(incident_id)[:8]}.pdf"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


def _generate_incident_pdf(incident: dict, comments: list) -> bytes:
    """Generate an Incident PDF using reportlab."""
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

    title_style = ParagraphStyle("Title", parent=styles["Title"],
                                 textColor=brand, fontSize=20, spaceAfter=4)
    h2_style = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12,
                               textColor=HexColor("#1E293B"), spaceAfter=4)
    body_style = styles["BodyText"]
    small_style = ParagraphStyle("Small", parent=styles["BodyText"], fontSize=9)

    SEVERITY_COLORS = {
        "critical": HexColor("#EF4444"),
        "high": HexColor("#F97316"),
        "medium": HexColor("#F59E0B"),
        "low": HexColor("#9CA3AF"),
    }
    STATUS_COLORS = {
        "reported": HexColor("#7C3AED"),
        "investigating": HexColor("#3B82F6"),
        "closed": HexColor("#22C55E"),
    }
    STATUS_LABELS = {
        "reported": "Report Generated",
        "investigating": "Investigating",
        "closed": "Closed",
    }

    reporter = incident.get("profiles") or {}
    # location comes from the plain text field, not a join
    location_description_text = incident.get("location_description") or ""
    incident_date = incident.get("incident_date", "")
    severity = incident.get("severity", "medium")
    status = incident.get("status", "reported")

    elements = []

    # Title
    elements.append(Paragraph("Incident Report", title_style))
    elements.append(Paragraph(incident.get("title", ""), h2_style))

    # Reporter + date
    reporter_name = reporter.get("full_name", "Unknown") if isinstance(reporter, dict) else "Unknown"
    date_str = incident_date[:10] if incident_date else "N/A"
    elements.append(Paragraph(
        f"Reported by: {reporter_name} &nbsp;&nbsp; Date: {date_str}",
        body_style,
    ))
    elements.append(Spacer(1, 0.3 * cm))

    # Status + severity badges
    sev_color = SEVERITY_COLORS.get(severity, HexColor("#9CA3AF"))
    st_color = STATUS_COLORS.get(status, brand)
    st_label = STATUS_LABELS.get(status, status.replace("_", " ").title())
    badge_table = Table(
        [[
            Paragraph(f"<b>Severity: {severity.upper()}</b>",
                      ParagraphStyle("b1", fontSize=10, textColor=white, alignment=TA_CENTER)),
            Paragraph(f"<b>Status: {st_label}</b>",
                      ParagraphStyle("b2", fontSize=10, textColor=white, alignment=TA_CENTER)),
        ]],
        colWidths=[5 * cm, 6 * cm],
    )
    badge_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), sev_color),
        ("BACKGROUND", (1, 0), (1, 0), st_color),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWPADDING", (0, 0), (-1, -1), 6),
        ("ROUNDEDCORNERS", [4]),
    ]))
    elements.append(badge_table)
    elements.append(Spacer(1, 0.4 * cm))
    elements.append(HRFlowable(width="100%", thickness=1, color=HexColor("#E2E8F0")))
    elements.append(Spacer(1, 0.3 * cm))

    # Details table
    elements.append(Paragraph("Details", h2_style))
    details_rows = []
    location_display = location_description_text or "—"
    details_rows.append(["Location", location_display])
    if incident.get("people_involved"):
        details_rows.append(["People Involved", incident["people_involved"]])
    if incident.get("regulatory_body"):
        details_rows.append(["Regulatory Body", incident["regulatory_body"]])
    details_rows.append(["Created At", (incident.get("created_at", "") or "")[:19].replace("T", " ")])

    if details_rows:
        dt = Table(details_rows, colWidths=[4 * cm, 13 * cm])
        dt.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), HexColor("#F1F5F9")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#CBD5E1")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        elements.append(dt)
    elements.append(Spacer(1, 0.4 * cm))

    # Description
    if incident.get("description"):
        elements.append(HRFlowable(width="100%", thickness=1, color=HexColor("#E2E8F0")))
        elements.append(Spacer(1, 0.2 * cm))
        elements.append(Paragraph("Description / Notes", h2_style))
        elements.append(Paragraph(incident["description"], body_style))
        elements.append(Spacer(1, 0.3 * cm))

    # Comments timeline
    if comments:
        elements.append(HRFlowable(width="100%", thickness=1, color=HexColor("#E2E8F0")))
        elements.append(Spacer(1, 0.2 * cm))
        elements.append(Paragraph("Comments", h2_style))
        for comment in comments:
            author_obj = comment.get("profiles") or {}
            author = author_obj.get("full_name", "Unknown") if isinstance(author_obj, dict) else "Unknown"
            ts = (comment.get("created_at", "") or "")[:19].replace("T", " ")
            elements.append(Paragraph(
                f"<b>{author}</b> — {ts}",
                ParagraphStyle("cauth", parent=styles["BodyText"], fontSize=9, textColor=HexColor("#6B7280")),
            ))
            elements.append(Paragraph(comment.get("body", ""), small_style))
            elements.append(Spacer(1, 0.2 * cm))

    elements.append(Spacer(1, 0.3 * cm))
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
