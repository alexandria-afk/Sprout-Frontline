"""
Onboarding routes — Steps 1–5 of the AI-First Onboarding flow.
All routes are prefixed with /api/v1/onboarding in main.py.
"""

import json
import io
import base64
import asyncio
import uuid
import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import anthropic
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import StreamingResponse

from dependencies import get_db, get_current_user, require_admin
from services.db import row, rows, execute, execute_returning, execute_many
from models.onboarding import (
    CompanyProfile, CompanyDiscoveryRequest, CompanyDiscoveryFallbackRequest,
    OnboardingSessionResponse, IndustryPackageResponse, TemplateCategoryGroup,
    TemplateItemResponse, SelectionUpdate, SelectionSummary,
    OnboardingLocation, OnboardingAsset, OnboardingVendor,
    EmployeeSourceRequest, ManualEmployeeInput, InviteConfig, InviteResult,
    RoleMappingResponse, RoleMappingUpdate, CSVImportResult, EmployeeImportSummary,
    WorkspacePreview, LaunchProgress, GuidedAction, LaunchResult, INDUSTRY_DISPLAY,
)
from config import settings
from utils.ai_helpers import _strip_code_fence

import logging as _logging
_log = _logging.getLogger(__name__)

router = APIRouter()

_DAY_STR_MAP = {
    "mon": 0, "monday": 0,
    "tue": 1, "tuesday": 1,
    "wed": 2, "wednesday": 2,
    "thu": 3, "thursday": 3,
    "fri": 4, "friday": 4,
    "sat": 5, "saturday": 5,
    "sun": 6, "sunday": 6,
}


def _normalize_days(days) -> list[int]:
    """Convert any day representation to INTEGER[] (0=Mon…6=Sun)."""
    if not isinstance(days, list) or not days:
        return [0, 1, 2, 3, 4, 5]
    result = []
    for d in days:
        if isinstance(d, int) and 0 <= d <= 6:
            result.append(d)
        elif isinstance(d, str):
            mapped = _DAY_STR_MAP.get(d.lower()[:3])
            if mapped is not None:
                result.append(mapped)
    return result or [0, 1, 2, 3, 4, 5]


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _get_anthropic() -> anthropic.Anthropic:
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured.")
    # 60-second timeout per call — prevents provisioning background tasks from hanging indefinitely
    return anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=60.0)


def _get_org_id(current_user: dict) -> str:
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    if not org_id:
        raise HTTPException(status_code=400, detail="User not associated with an organisation.")
    return org_id


def _get_session(conn, session_id: str, org_id: str) -> dict:
    r = row(conn, "SELECT * FROM onboarding_sessions WHERE id = %s AND organisation_id = %s", (session_id, org_id))
    if not r:
        raise HTTPException(status_code=404, detail="Onboarding session not found.")
    return dict(r)


def _require_step(session: dict, expected_step: int):
    """Enforce a minimum step gate on the session.

    Allows sessions at any step >= expected_step to proceed, enabling admins to
    revisit earlier steps. Stricter (exact-step) validation is intentionally
    avoided to support back-navigation in the UI.
    """
    if session["current_step"] < expected_step:
        raise HTTPException(
            status_code=400,
            detail=f"Session is at step {session['current_step']}. Complete previous steps first."
        )


def _advance_step(conn, session_id: str, to_step: int):
    execute(conn,
        "UPDATE onboarding_sessions SET current_step = %s, updated_at = %s WHERE id = %s",
        (to_step, datetime.now(timezone.utc).isoformat(), session_id),
    )


def _session_to_response(s: dict) -> OnboardingSessionResponse:
    return OnboardingSessionResponse(
        session_id=s["id"],
        current_step=s["current_step"],
        status=s["status"],
        company_name=s.get("company_name"),
        industry_code=s.get("industry_code"),
        industry_subcategory=s.get("industry_subcategory"),
        estimated_locations=s.get("estimated_locations"),
        brand_color=s.get("brand_color"),
        logo_url=s.get("logo_url"),
        website_url=s.get("website_url"),
        employee_source=s.get("employee_source"),
        launch_progress=s.get("launch_progress"),
    )


CATEGORY_META = {
    "form":            {"display": "Forms",              "icon": "clipboard-list"},
    "checklist":       {"display": "Checklists",         "icon": "check-square"},
    "audit":           {"display": "Audits",             "icon": "search"},
    "issue_category":  {"display": "Issue Categories",   "icon": "alert-triangle"},
    "workflow":        {"display": "Workflows",          "icon": "git-branch"},
    "training_module": {"display": "Training Modules",   "icon": "graduation-cap"},
    "shift_template":  {"display": "Shift Templates",    "icon": "calendar-clock"},
    "repair_manual":   {"display": "Manuals & SOPs",     "icon": "book-open"},
    "badge":           {"display": "Badges",             "icon": "award"},
}

DISPLAY_CATEGORY_ORDER = [
    "form", "checklist", "audit",
    "issue_category", "workflow",
    "training_module", "shift_template", "repair_manual", "badge",
]


# ── Session management ─────────────────────────────────────────────────────────

@router.post("/sessions", response_model=OnboardingSessionResponse)
async def create_session(
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Create a new onboarding session. Only one active session per org."""
    org_id = _get_org_id(current_user)

    # Check for existing active session
    existing = row(conn,
        "SELECT * FROM onboarding_sessions WHERE organisation_id = %s AND status = %s LIMIT 1",
        (org_id, "in_progress"),
    )
    if existing:
        return _session_to_response(dict(existing))

    r = execute_returning(conn,
        """INSERT INTO onboarding_sessions (organisation_id, current_step, status)
           VALUES (%s, %s, %s) RETURNING *""",
        (org_id, 1, "in_progress"),
    )
    return _session_to_response(dict(r))


@router.get("/sessions/current", response_model=OnboardingSessionResponse)
async def get_current_session(
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get the active onboarding session for the user's org."""
    org_id = _get_org_id(current_user)
    r = row(conn,
        """SELECT * FROM onboarding_sessions
           WHERE organisation_id = %s AND status IN ('in_progress', 'completed')
           ORDER BY created_at DESC LIMIT 1""",
        (org_id,),
    )
    if not r:
        raise HTTPException(status_code=404, detail="No active onboarding session.")
    return _session_to_response(dict(r))


@router.get("/sessions/{session_id}", response_model=OnboardingSessionResponse)
async def get_session(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org_id(current_user)
    return _session_to_response(_get_session(conn, session_id, org_id))


# ── Step 1: Company Discovery ─────────────────────────────────────────────────

async def _scrape_website(url: str) -> dict:
    """Scrape website and extract text, meta, og tags, logo, color hints."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        raise HTTPException(status_code=500, detail="beautifulsoup4 not installed.")

    # Normalize URL
    if not url.startswith("http"):
        url = "https://" + url

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
    scraped = {"url": url, "title": "", "description": "", "og": {}, "headings": [], "logo_url": None, "text_sample": ""}

    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            html = resp.text
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not fetch website: {str(e)}")

    soup = BeautifulSoup(html, "html.parser")

    scraped["title"] = soup.title.string.strip() if soup.title else ""
    meta_desc = soup.find("meta", attrs={"name": "description"})
    if meta_desc:
        scraped["description"] = meta_desc.get("content", "")

    # OG tags
    for og in soup.find_all("meta", property=lambda p: p and p.startswith("og:")):
        scraped["og"][og.get("property", "").replace("og:", "")] = og.get("content", "")

    # Headings
    for tag in soup.find_all(["h1", "h2", "h3"])[:10]:
        text = tag.get_text(strip=True)
        if text:
            scraped["headings"].append(text)

    # Logo
    logo = soup.find("img", {"alt": lambda a: a and "logo" in a.lower()})
    if not logo:
        logo = soup.find("img", {"src": lambda s: s and "logo" in s.lower()})
    if logo and logo.get("src"):
        src = logo["src"]
        if src.startswith("/"):
            from urllib.parse import urlparse
            parsed = urlparse(url)
            src = f"{parsed.scheme}://{parsed.netloc}{src}"
        scraped["logo_url"] = src

    # Body text sample from homepage
    body_text = soup.get_text(separator=" ", strip=True)
    scraped["text_sample"] = body_text[:3000]

    # Try to find and scrape a locations / store-locator sub-page.
    _LOCATION_KEYWORDS = [
        "/stores",
        "store-locator", "store_locator", "find-a-store", "find-store",
        "store-finder", "storefinder", "branch", "branches",
        "our-stores", "our-locations", "locations", "outlets", "stores",
    ]
    loc_candidates = []
    for a in soup.find_all("a", href=True):
        href = a["href"].lower().split("?")[0]
        if any(kw in href for kw in _LOCATION_KEYWORDS):
            loc_candidates.append(a["href"])
    loc_link = min(loc_candidates, key=lambda h: len(h)) if loc_candidates else None

    if loc_link:
        from urllib.parse import urljoin
        loc_url = urljoin(url, loc_link)
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as loc_client:
                loc_resp = await loc_client.get(loc_url, headers=headers)
                loc_resp.raise_for_status()
                loc_soup = BeautifulSoup(loc_resp.text, "html.parser")
                loc_text = loc_soup.get_text(separator=" ", strip=True)
                scraped["text_sample"] = (
                    scraped["text_sample"]
                    + "\n\n[Store Locator Page: " + loc_url + "]\n"
                    + loc_text[:6000]
                )
        except Exception as e:
            _log.debug("Sub-page fetch failed: %s", e)

    return scraped


async def _classify_with_ai(scrape: dict) -> CompanyProfile:
    """Send scraped content to Claude for structured company classification."""
    client = _get_anthropic()

    system_prompt = """You are an industry classifier for a frontline operations platform called Sprout.
Given website content, extract structured company information.

Respond ONLY with valid JSON — no markdown fences, no explanation.

JSON schema:
{
  "company_name": "string",
  "industry_code": "one of: qsr, casual_dining, full_service_restaurant, cafe_bar, bakery, retail_fashion, retail_grocery, hospitality, healthcare_clinic, manufacturing, logistics",
  "industry_subcategory": "string (e.g. 'Fast Food — Multi-brand franchise') or null",
  "estimated_locations": integer_or_null,
  "brand_color_hex": "hex color string like #FF0000 or null",
  "logo_url": "absolute URL string or null",
  "confidence": float_between_0_and_1
}"""

    user_msg = json.dumps({
        "url": scrape["url"],
        "title": scrape["title"],
        "description": scrape["description"],
        "og_tags": scrape["og"],
        "headings": scrape["headings"],
        "logo_url": scrape.get("logo_url"),
        "text_sample": scrape["text_sample"][:2000],
    })

    def _call():
        return client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            system=system_prompt,
            messages=[{"role": "user", "content": user_msg}],
        )

    response = await asyncio.to_thread(_call)
    text = "".join(b.text for b in response.content if hasattr(b, "text"))

    try:
        cleaned = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        data = {
            "company_name": scrape.get("og", {}).get("site_name") or scrape.get("title", "Your Company"),
            "industry_code": "qsr",
            "confidence": 0.3,
        }

    if not data.get("logo_url") and scrape.get("logo_url"):
        data["logo_url"] = scrape["logo_url"]

    return CompanyProfile(
        company_name=data.get("company_name", "Your Company"),
        industry_code=data.get("industry_code", "qsr"),
        industry_subcategory=data.get("industry_subcategory"),
        estimated_locations=data.get("estimated_locations"),
        brand_color_hex=data.get("brand_color_hex"),
        logo_url=data.get("logo_url"),
        confidence=float(data.get("confidence", 0.5)),
    )


@router.post("/sessions/{session_id}/discover", response_model=CompanyProfile)
async def discover_company(
    session_id: str,
    req: CompanyDiscoveryRequest,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Step 1: Scrape website and classify company. Does not advance step."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 1)

    scrape = await _scrape_website(req.website_url)
    profile = await _classify_with_ai(scrape)

    execute(conn,
        """UPDATE onboarding_sessions
           SET website_url = %s, company_name = %s, industry_code = %s,
               industry_subcategory = %s, estimated_locations = %s,
               brand_color = %s, logo_url = %s, updated_at = %s
           WHERE id = %s AND organisation_id = %s""",
        (req.website_url, profile.company_name, profile.industry_code,
         profile.industry_subcategory, profile.estimated_locations,
         profile.brand_color_hex, profile.logo_url,
         datetime.now(timezone.utc).isoformat(),
         session_id, org_id),
    )

    return profile


@router.post("/sessions/{session_id}/discover/fallback", response_model=CompanyProfile)
async def discover_company_fallback(
    session_id: str,
    req: CompanyDiscoveryFallbackRequest,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Step 1 fallback: Manual entry when scrape fails."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 1)

    execute(conn,
        """UPDATE onboarding_sessions
           SET company_name = %s, industry_code = %s, industry_subcategory = %s,
               estimated_locations = %s, updated_at = %s
           WHERE id = %s AND organisation_id = %s""",
        (req.company_name, req.industry_code, req.industry_subcategory,
         req.estimated_locations, datetime.now(timezone.utc).isoformat(),
         session_id, org_id),
    )

    return CompanyProfile(
        company_name=req.company_name,
        industry_code=req.industry_code,
        industry_subcategory=req.industry_subcategory,
        estimated_locations=req.estimated_locations,
        confidence=1.0,
    )


@router.post("/sessions/{session_id}/confirm-company", response_model=OnboardingSessionResponse)
async def confirm_company(
    session_id: str,
    profile: CompanyProfile,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Confirm company profile. Advance to step 2. Pre-populate template selections."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)

    # Save confirmed profile
    execute(conn,
        """UPDATE onboarding_sessions
           SET company_name = %s, industry_code = %s, industry_subcategory = %s,
               estimated_locations = %s, brand_color = %s, logo_url = %s,
               current_step = 2, updated_at = %s
           WHERE id = %s AND organisation_id = %s""",
        (profile.company_name, profile.industry_code, profile.industry_subcategory,
         profile.estimated_locations, profile.brand_color_hex, profile.logo_url,
         datetime.now(timezone.utc).isoformat(),
         session_id, org_id),
    )

    # Pre-populate template selections from industry package
    pkg = row(conn,
        "SELECT id FROM industry_packages WHERE industry_code = %s AND is_active = true LIMIT 1",
        (profile.industry_code,),
    )
    if pkg:
        package_id = pkg["id"]
        items = rows(conn,
            "SELECT id, is_recommended FROM template_items WHERE package_id = %s",
            (package_id,),
        )

        existing = rows(conn,
            "SELECT template_id FROM onboarding_selections WHERE session_id = %s",
            (session_id,),
        )
        existing_ids = {r["template_id"] for r in existing}

        to_insert = [
            (session_id, item["id"], item["is_recommended"])
            for item in items
            if item["id"] not in existing_ids
        ]
        if to_insert:
            execute_many(conn,
                "INSERT INTO onboarding_selections (session_id, template_id, is_selected) VALUES (%s, %s, %s)",
                to_insert,
            )

    updated = _get_session(conn, session_id, org_id)
    return _session_to_response(updated)


# ── Step 6: Template Selection ─────────────────────────────────────────────────

def _build_content_preview(category: str, content: dict) -> dict:
    """Extract a lightweight preview subset from full template content."""
    if category in ("form", "checklist", "audit"):
        sections = content.get("sections", [])
        return {
            "type": content.get("type", category),
            "section_count": len(sections),
            "field_count": sum(len(s.get("fields", [])) for s in sections),
            "requires_signature": content.get("requires_signature", False),
            "requires_photo": content.get("requires_photo", False),
            "scoring": content.get("scoring") is not None,
            "first_section": sections[0]["title"] if sections else None,
            "sections": [
                {
                    "title": s.get("title", ""),
                    "fields": [
                        {"label": f.get("label", ""), "type": f.get("field_type", f.get("type", ""))}
                        for f in s.get("fields", [])
                    ]
                }
                for s in sections
            ],
        }
    elif category == "issue_category":
        return {
            "default_priority": content.get("default_priority"),
            "subcategory_count": len(content.get("subcategories", [])),
            "sla_hours": content.get("sla_hours"),
            "subcategories": content.get("subcategories", []),
        }
    elif category == "workflow":
        stages = content.get("stages", [])
        deps = []
        for stage in stages:
            if stage.get("form_ref"):
                deps.append({"type": "form", "name": stage["form_ref"]})
            for cr in stage.get("course_refs", []):
                deps.append({"type": "training_module", "name": cr})
        trigger = content.get("trigger", {})
        if trigger.get("issue_category_ref"):
            deps.append({"type": "issue_category", "name": trigger["issue_category_ref"]})
        return {
            "trigger_type": trigger.get("type"),
            "stage_count": len(stages),
            "stages": [
                {"name": s.get("name", ""), "action_type": s.get("type", s.get("action_type", ""))}
                for s in stages
            ],
            "required_refs": deps,
        }
    elif category == "training_module":
        return {
            "format": content.get("format"),
            "estimated_minutes": content.get("estimated_minutes"),
            "auto_assign_on_hire": content.get("auto_assign_on_hire", False),
            "section_count": len(content.get("sections", [])),
            "passing_score": content.get("passing_score"),
            "sections": [
                {"title": s.get("title", ""), "modules": [m.get("title", "") for m in s.get("modules", [])]}
                for s in content.get("sections", [])
            ],
        }
    elif category == "shift_template":
        return {
            "shift_count": len(content.get("shifts", [])),
            "shifts": content.get("shifts", []),
        }
    elif category == "repair_manual":
        return {
            "equipment_type": content.get("equipment_type"),
            "section_count": len(content.get("sections", [])),
        }
    return {}


@router.get("/sessions/{session_id}/templates", response_model=IndustryPackageResponse)
async def get_templates(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Load industry package with current selections for this session."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 6)

    industry_code = session.get("industry_code", "qsr")

    package = row(conn,
        "SELECT * FROM industry_packages WHERE industry_code = %s AND is_active = true LIMIT 1",
        (industry_code,),
    )
    if not package:
        raise HTTPException(status_code=404, detail=f"No industry package found for '{industry_code}'.")

    items_list = rows(conn,
        "SELECT * FROM template_items WHERE package_id = %s ORDER BY sort_order",
        (package["id"],),
    )
    selections_list = rows(conn,
        "SELECT template_id, is_selected FROM onboarding_selections WHERE session_id = %s",
        (session_id,),
    )

    selected_map = {r["template_id"]: r["is_selected"] for r in selections_list}

    # Group by category
    by_category: dict[str, list] = {c: [] for c in DISPLAY_CATEGORY_ORDER}
    for item in items_list:
        cat = item["category"]
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(TemplateItemResponse(
            id=item["id"],
            category=cat,
            name=item["name"],
            description=item.get("description"),
            is_recommended=item["is_recommended"],
            is_selected=selected_map.get(item["id"], item["is_recommended"]),
            content_preview=_build_content_preview(cat, item.get("content", {})),
        ))

    categories = []
    total_selected = 0
    total_available = 0
    for cat in DISPLAY_CATEGORY_ORDER:
        items = by_category.get(cat, [])
        if not items:
            continue
        sel_count = sum(1 for i in items if i.is_selected)
        total_selected += sel_count
        total_available += len(items)
        meta = CATEGORY_META.get(cat, {"display": cat, "icon": "file"})
        categories.append(TemplateCategoryGroup(
            category=cat,
            display_name=meta["display"],
            icon=meta["icon"],
            items=items,
            selected_count=sel_count,
            total_count=len(items),
        ))

    return IndustryPackageResponse(
        package_name=package["name"],
        industry_code=industry_code,
        categories=categories,
        total_selected=total_selected,
        total_available=total_available,
    )


@router.patch("/sessions/{session_id}/selections")
async def update_selections(
    session_id: str,
    updates: list[SelectionUpdate],
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Batch update template selections (debounced from frontend)."""
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)

    for u in updates:
        execute(conn,
            """INSERT INTO onboarding_selections (session_id, template_id, is_selected)
               VALUES (%s, %s, %s)
               ON CONFLICT (session_id, template_id) DO UPDATE SET is_selected = EXCLUDED.is_selected""",
            (session_id, u.template_id, u.is_selected),
        )

    return {"ok": True}


@router.get("/sessions/{session_id}/selections/summary", response_model=SelectionSummary)
async def get_selection_summary(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)

    sel_rows = rows(conn,
        """SELECT os.is_selected, ti.category
           FROM onboarding_selections os
           JOIN template_items ti ON ti.id = os.template_id
           WHERE os.session_id = %s""",
        (session_id,),
    )

    counts: dict[str, int] = {}
    total_selected = 0
    total_available = len(sel_rows)
    for r in sel_rows:
        cat = r.get("category", "")
        if r["is_selected"]:
            counts[cat] = counts.get(cat, 0) + 1
            total_selected += 1

    return SelectionSummary(
        forms=counts.get("form", 0),
        checklists=counts.get("checklist", 0),
        audits=counts.get("audit", 0),
        issue_categories=counts.get("issue_category", 0),
        workflows=counts.get("workflow", 0),
        training_modules=counts.get("training_module", 0),
        shift_templates=counts.get("shift_template", 0),
        repair_manuals=counts.get("repair_manual", 0),
        badges=counts.get("badge", 0),
        total_selected=total_selected,
        total_available=total_available,
    )


@router.post("/sessions/{session_id}/confirm-templates", response_model=OnboardingSessionResponse)
async def confirm_templates(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Confirm template selections. Advance to step 7 (Preview)."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 6)
    _advance_step(conn, session_id, 7)
    return _session_to_response(_get_session(conn, session_id, org_id))


# ── Step 2: Team Setup ─────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/employee-source")
async def set_employee_source(
    session_id: str,
    req: EmployeeSourceRequest,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 2)
    execute(conn,
        "UPDATE onboarding_sessions SET employee_source = %s, updated_at = %s WHERE id = %s AND organisation_id = %s",
        (req.source, datetime.now(timezone.utc).isoformat(), session_id, org_id),
    )
    return {"ok": True}


@router.post("/sessions/{session_id}/upload-employees", response_model=CSVImportResult)
async def upload_employee_csv(
    session_id: str,
    file: UploadFile = File(...),
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Upload CSV/XLSX, validate rows, AI-map roles."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 2)

    try:
        import pandas as pd
    except ImportError:
        raise HTTPException(status_code=500, detail="pandas not installed.")

    content = await file.read()
    try:
        if file.filename and file.filename.endswith(".xlsx"):
            df = pd.read_excel(io.BytesIO(content))
        else:
            df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse file: {e}")

    # Normalize column names
    df.columns = [c.lower().strip().replace(" ", "_") for c in df.columns]
    COL_MAP = {
        "first_name": ["first_name", "firstname", "given_name"],
        "last_name": ["last_name", "lastname", "surname", "family_name"],
        "full_name": ["full_name", "name", "employee_name"],
        "email": ["email", "email_address", "work_email"],
        "phone": ["phone", "mobile", "contact_number", "phone_number"],
        "position": ["position", "job_title", "title", "role", "designation"],
        "department": ["department", "dept", "team", "division"],
        "location": ["location", "branch", "store", "outlet", "work_location"],
        "reports_to": ["reports_to", "manager", "supervisor", "manager_name", "reports_to_name"],
    }

    mapped: dict[str, Optional[str]] = {}
    for target, aliases in COL_MAP.items():
        for alias in aliases:
            if alias in df.columns:
                mapped[target] = alias
                break
        else:
            mapped[target] = None

    errors = []
    valid_employees = []

    for idx, csv_row in df.iterrows():
        line = idx + 2  # human-readable row number

        # Build full_name
        if mapped.get("full_name") and pd.notna(csv_row.get(mapped["full_name"], "")):
            full_name = str(csv_row[mapped["full_name"]]).strip()
        elif mapped.get("first_name") and mapped.get("last_name"):
            fn = str(csv_row.get(mapped["first_name"], "")).strip()
            ln = str(csv_row.get(mapped["last_name"], "")).strip()
            full_name = f"{fn} {ln}".strip()
        else:
            errors.append({"row": line, "error": "Missing name columns"})
            continue

        email_col = mapped.get("email")
        email = str(csv_row[email_col]).strip().lower() if email_col and pd.notna(csv_row.get(email_col, "")) else ""
        if not email or "@" not in email:
            errors.append({"row": line, "error": f"Invalid or missing email for {full_name}"})
            continue

        position = ""
        if mapped.get("position") and pd.notna(csv_row.get(mapped["position"], "")):
            position = str(csv_row[mapped["position"]]).strip()

        department = ""
        if mapped.get("department") and pd.notna(csv_row.get(mapped["department"], "")):
            department = str(csv_row[mapped["department"]]).strip()

        location_name = ""
        if mapped.get("location") and pd.notna(csv_row.get(mapped["location"], "")):
            location_name = str(csv_row[mapped["location"]]).strip()

        reports_to = ""
        if mapped.get("reports_to") and pd.notna(csv_row.get(mapped["reports_to"], "")):
            reports_to = str(csv_row[mapped["reports_to"]]).strip()

        valid_employees.append({
            "full_name": full_name,
            "email": email,
            "phone": str(csv_row.get(mapped["phone"] or "", "")).strip() if mapped.get("phone") else None,
            "position": position,
            "department": department,
            "location_name": location_name,
            "reports_to": reports_to or None,
        })

    # AI role mapping for unique positions
    job = execute_returning(conn,
        """INSERT INTO employee_import_jobs (session_id, source_type, status, total_records, failed_records, error_log)
           VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
        (session_id, "csv", "processing", len(valid_employees) + len(errors), len(errors), json.dumps(errors)),
    )
    job_id = job["id"]

    # Run AI role mapping for unique position+department combos
    if valid_employees:
        unique_combos = {}
        for emp in valid_employees:
            key = (emp["position"], emp["department"])
            if key not in unique_combos:
                unique_combos[key] = 0
            unique_combos[key] += 1

        mappings = await _map_roles_with_ai(conn, session_id, unique_combos, org_id)
        role_map = {(m["source_title"], m.get("source_department", "")): m["retail_role"] for m in mappings}

        # Insert employees
        to_insert = []
        for emp in valid_employees:
            role_key = (emp["position"], emp["department"])
            retail_role = role_map.get(role_key, "staff")
            to_insert.append((
                session_id, emp["full_name"], emp["email"], emp.get("phone"),
                emp["position"], emp["department"], emp["location_name"],
                emp.get("reports_to"), retail_role, "pending",
            ))

        if to_insert:
            execute_many(conn,
                """INSERT INTO onboarding_employees
                   (session_id, full_name, email, phone, position, department,
                    location_name, reports_to, retail_role, status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                to_insert,
            )

        # Update job
        execute(conn,
            """UPDATE employee_import_jobs
               SET status = %s, processed_records = %s, updated_at = %s
               WHERE id = %s""",
            ("completed" if not errors else "partial", len(valid_employees),
             datetime.now(timezone.utc).isoformat(), job_id),
        )

    return CSVImportResult(
        total_rows=len(valid_employees) + len(errors),
        valid_rows=len(valid_employees),
        error_rows=len(errors),
        errors=errors,
        import_job_id=job_id,
    )


async def _map_roles_with_ai(conn, session_id: str, combos: dict, org_id: str) -> list[dict]:
    """AI role mapping for unique position+department combos."""
    client = _get_anthropic()

    system_prompt = """You are mapping retail HR position titles to app roles.

Role definitions (pick the LOWEST role that fits):
- super_admin: C-level, owner, CEO, COO, President
- admin: Multi-location or org-wide oversight — Area Manager, Regional Manager, Operations Manager, HR Manager, Training Manager, District Manager
- manager: Any single-location supervisor or any title containing "Manager" not covered above — Store Manager, Kitchen Manager, Shift Manager, Assistant Manager, Floor Manager, Team Lead
- staff: All frontline workers with no managerial authority — Crew, Cashier, Cook, Barista, Rider, Service Crew, Utility, Drive-Thru, etc.

Rules:
1. If the title contains "Manager" → at least 'manager' unless clearly multi-location/regional → 'admin'
2. If the title contains "Director", "Regional", "Area" → 'admin'
3. When in doubt between manager and staff → choose 'manager'
4. Never return a role not in: super_admin, admin, manager, staff

Respond ONLY with a JSON array. No markdown, no explanation.
Schema: [{"source_title": "...", "source_department": "...", "retail_role": "...", "confidence": 0.0-1.0}]"""

    combo_list = [
        {"title": title, "department": dept, "count": count}
        for (title, dept), count in combos.items()
        if title
    ]
    if not combo_list:
        return []

    def _call():
        return client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": json.dumps(combo_list)}],
        )

    try:
        response = await asyncio.to_thread(_call)
        text = "".join(b.text for b in response.content if hasattr(b, "text"))
        text = text.strip()
        text = _strip_code_fence(text)
        mappings = json.loads(text.strip())
    except Exception as e:
        _log.error("Role mapping AI call failed: %s", e, exc_info=True)
        mappings = [{"source_title": t, "source_department": d, "retail_role": "staff", "confidence": 0.5}
                    for (t, d) in combos.keys()]

    # Save to role_mappings table (replace any existing mappings for this session).
    existing_rows_list = rows(conn,
        "SELECT id FROM role_mappings WHERE session_id = %s AND organisation_id = %s",
        (session_id, org_id),
    )
    old_ids = [r["id"] for r in existing_rows_list]

    to_insert = []
    for m in mappings:
        count = combos.get((m.get("source_title", ""), m.get("source_department", "")), 1)
        to_insert.append((
            session_id, org_id, m.get("source_title", ""),
            m.get("source_department"), m.get("retail_role", "staff"),
            float(m.get("confidence", 0.5)), False, count,
        ))
    if to_insert:
        execute_many(conn,
            """INSERT INTO role_mappings
               (session_id, organisation_id, source_title, source_department,
                retail_role, confidence_score, is_confirmed, employee_count)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            to_insert,
        )
        # Insert succeeded — now safe to remove the previous mappings
        if old_ids:
            execute(conn,
                "DELETE FROM role_mappings WHERE organisation_id = %s AND id = ANY(%s::uuid[])",
                (org_id, old_ids),
            )

    return mappings


@router.get("/sessions/{session_id}/csv-template")
async def download_csv_template(session_id: str, current_user: dict = Depends(get_current_user)):
    """Return a pre-formatted CSV template."""
    csv_content = (
        "full_name,email,phone,position,department,location\n"
        "Juan dela Cruz,juan@example.com,+639171234567,Store Manager,Operations,Eastwood Branch\n"
        "Maria Santos,maria@example.com,+639181234567,Crew Member,Front of House,Eastwood Branch\n"
    )
    return StreamingResponse(
        io.BytesIO(csv_content.encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=employee_import_template.csv"},
    )


@router.post("/sessions/{session_id}/employees")
async def add_employee_manual(
    session_id: str,
    employee: ManualEmployeeInput,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Manually add a single employee during onboarding."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 2)
    r = execute_returning(conn,
        """INSERT INTO onboarding_employees
           (session_id, full_name, email, phone, position, department,
            retail_role, location_name, reports_to, status)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (session_id, employee.full_name, employee.email, employee.phone,
         employee.position, employee.department, employee.retail_role,
         employee.location_name, getattr(employee, "reports_to", None), "pending"),
    )
    return dict(r)


@router.get("/sessions/{session_id}/employees")
async def list_employees(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    emp_rows = rows(conn,
        "SELECT * FROM onboarding_employees WHERE session_id = %s ORDER BY created_at",
        (session_id,),
    )
    return {"employees": [dict(r) for r in emp_rows], "total": len(emp_rows)}


@router.delete("/sessions/{session_id}/employees/{employee_id}")
async def delete_employee(
    session_id: str,
    employee_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    execute(conn,
        "UPDATE onboarding_employees SET is_deleted = true WHERE id = %s AND session_id = %s",
        (employee_id, session_id),
    )
    return {"ok": True}


@router.post("/sessions/{session_id}/invite-link", response_model=InviteResult)
async def generate_invite_link(
    session_id: str,
    config: InviteConfig,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Generate invite URL + base64 QR code."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 2)

    token = secrets.token_urlsafe(24)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=config.expiry_hours)).isoformat()
    invite_url = f"https://app.sprout.ph/join/{token}?role={config.default_role}"
    execute(conn,
        """UPDATE onboarding_sessions
           SET invite_token_hash = %s, invite_token_expires_at = %s,
               invite_default_role = %s, updated_at = %s
           WHERE id = %s AND organisation_id = %s""",
        (token_hash, expires_at, config.default_role,
         datetime.now(timezone.utc).isoformat(), session_id, org_id),
    )

    # Generate real QR code as SVG
    try:
        import qrcode
        import qrcode.image.svg
        import io as _io
        qr = qrcode.QRCode(box_size=6, border=2)
        qr.add_data(invite_url)
        qr.make(fit=True)
        img = qr.make_image(image_factory=qrcode.image.svg.SvgImage)
        buf = _io.BytesIO()
        img.save(buf)
        qr_b64 = base64.b64encode(buf.getvalue()).decode()
    except Exception:
        qr_b64 = base64.b64encode(
            f'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#f0f0f0"/><text x="100" y="105" text-anchor="middle" font-size="10" fill="#666">QR unavailable</text></svg>'.encode()
        ).decode()

    return InviteResult(
        invite_url=invite_url,
        qr_code_data=qr_b64,
        expires_at=expires_at,
    )


@router.get("/sessions/{session_id}/role-mappings", response_model=list[RoleMappingResponse])
async def get_role_mappings(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    mapping_rows = rows(conn,
        "SELECT * FROM role_mappings WHERE session_id = %s ORDER BY employee_count DESC",
        (session_id,),
    )
    return [
        RoleMappingResponse(
            id=r["id"],
            source_title=r["source_title"],
            source_department=r.get("source_department"),
            retail_role=r["retail_role"],
            confidence_score=r["confidence_score"],
            is_confirmed=r["is_confirmed"],
            employee_count=r.get("employee_count", 0),
            low_confidence=r["confidence_score"] < 0.7,
        )
        for r in mapping_rows
    ]


@router.patch("/sessions/{session_id}/role-mappings/{mapping_id}")
async def update_role_mapping(
    session_id: str,
    mapping_id: str,
    update: RoleMappingUpdate,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    execute(conn,
        """UPDATE role_mappings SET retail_role = %s, is_confirmed = true, updated_at = %s
           WHERE id = %s AND session_id = %s""",
        (update.retail_role, datetime.now(timezone.utc).isoformat(), mapping_id, session_id),
    )
    return {"ok": True}


@router.post("/sessions/{session_id}/confirm-employees", response_model=OnboardingSessionResponse)
async def confirm_employees(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Confirm employee setup. Advance to step 3 (Shift Settings)."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 2)
    _advance_step(conn, session_id, 3)
    return _session_to_response(_get_session(conn, session_id, org_id))


# ── Step 1: Locations (part of Company step) ──────────────────────────────────


@router.get("/sessions/{session_id}/suggest-locations")
async def suggest_locations(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """AI extracts real branch/location names from the company website, or generates plausible ones as fallback."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 2)

    company_name = session.get("company_name") or "the company"
    estimated = session.get("estimated_locations") or 3
    industry = INDUSTRY_DISPLAY.get(session.get("industry_code", ""), session.get("industry_code", "retail"))
    website_url = session.get("website_url")

    # Try to get real location data from the website
    website_text = ""
    if website_url:
        try:
            scraped = await _scrape_website(website_url)
            website_text = scraped.get("text_sample", "")
            _log.info("suggest_locations: website_url=%s text_len=%d", website_url, len(website_text))
            _log.info("suggest_locations: text_preview=%s", website_text[:500])
        except Exception as e:
            _log.warning("suggest_locations: scrape failed for %s: %s", website_url, e)
    else:
        _log.info("suggest_locations: no website_url in session, falling back to generated names")

    client = _get_anthropic()

    if website_text:
        prompt = (
            f"The following is scraped content from the website of {company_name} ({website_url}):\n\n"
            f"{website_text[:9000]}\n\n"
            f"Your task: Extract real branch, store, or outlet names and addresses from this content. "
            f"Look for any mentions of specific locations, branches, stores, offices, or outlets. "
            f"If you find real locations in the content, return ALL of them. "
            f"If the content does not mention specific locations, generate {estimated} realistic "
            f"location names for a {industry} business in the Philippines.\n"
            f"Respond ONLY with a JSON array (no other text): "
            f'[{{"name": "Branch/store name", "address": "Full address or empty string"}}]'
        )
    else:
        prompt = (
            f"Generate {estimated} realistic branch/location names for {company_name}, "
            f"a {industry} business in the Philippines. "
            f"Each location should have a descriptive name (e.g. 'Makati Branch', 'SM Megamall Outlet') "
            f"and an optional address. "
            f"Respond ONLY with a JSON array: "
            f'[{{"name": "...", "address": "..."}}]'
        )

    def _call():
        return client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )

    try:
        response = await asyncio.to_thread(_call)
        text = "".join(b.text for b in response.content if hasattr(b, "text"))
        _log.info("suggest_locations: raw claude response=%s", text[:300])
        text = text.strip()
        text = _strip_code_fence(text)
        suggestions = json.loads(text.strip())
        if not isinstance(suggestions, list):
            suggestions = []
        suggestions = [
            {"name": s.get("name", "").strip(), "address": (s.get("address") or "").strip()}
            for s in suggestions
            if isinstance(s, dict) and s.get("name", "").strip()
        ]
        _log.info("suggest_locations: returning %d suggestions", len(suggestions))
    except Exception as e:
        _log.warning("suggest_locations: claude call/parse failed: %s", e)
        suggestions = [{"name": f"{company_name} Main Branch", "address": ""}]

    return suggestions


@router.post("/sessions/{session_id}/locations", response_model=OnboardingLocation)
async def add_location(
    session_id: str,
    loc: OnboardingLocation,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 2)
    r = execute_returning(conn,
        "INSERT INTO onboarding_locations (session_id, name, address) VALUES (%s, %s, %s) RETURNING *",
        (session_id, loc.name, loc.address),
    )
    return OnboardingLocation(id=r["id"], name=r["name"], address=r.get("address"))


@router.get("/sessions/{session_id}/locations")
async def list_locations(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    loc_rows = rows(conn,
        "SELECT * FROM onboarding_locations WHERE session_id = %s",
        (session_id,),
    )
    return [dict(r) for r in loc_rows]


@router.delete("/sessions/{session_id}/locations/{loc_id}", status_code=204)
async def delete_location(
    session_id: str,
    loc_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    execute(conn,
        "DELETE FROM onboarding_locations WHERE id = %s AND session_id = %s",
        (loc_id, session_id),
    )


@router.post("/sessions/{session_id}/confirm-locations", response_model=OnboardingSessionResponse)
async def confirm_locations(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Confirm locations (part of Company & Locations step). No step advance."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 2)
    return _session_to_response(_get_session(conn, session_id, org_id))


# ── Steps 4–5: Assets & Vendors ───────────────────────────────────────────────


@router.get("/sessions/{session_id}/suggest-assets")
async def suggest_assets(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """AI suggests equipment/assets based on industry and location count."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 4)

    industry = INDUSTRY_DISPLAY.get(session.get("industry_code", ""), session.get("industry_code", "retail"))
    loc_rows_list = rows(conn,
        "SELECT name FROM onboarding_locations WHERE session_id = %s",
        (session_id,),
    )
    locations = [r["name"] for r in loc_rows_list] or ["Main Branch"]

    client = _get_anthropic()

    def _call():
        return client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[{"role": "user", "content": (
                f"List 6-10 common pieces of equipment/assets for a {industry} business. "
                f"For each asset include: name, category, and optionally model and manufacturer. "
                f"Assign each asset to one of these locations: {', '.join(locations)}. "
                f"Respond ONLY with a JSON array: "
                f'[{{"name": "...", "category": "...", "model": "...", "manufacturer": "...", "location_name": "..."}}]'
            )}],
        )

    try:
        response = await asyncio.to_thread(_call)
        text = "".join(b.text for b in response.content if hasattr(b, "text"))
        text = text.strip()
        text = _strip_code_fence(text)
        suggestions = json.loads(text.strip())
        if not isinstance(suggestions, list):
            suggestions = []
    except Exception:
        suggestions = [
            {"name": "POS Terminal", "category": "POS", "model": "", "manufacturer": "", "location_name": locations[0]},
            {"name": "Refrigerator", "category": "Kitchen Equipment", "model": "", "manufacturer": "", "location_name": locations[0]},
        ]

    return suggestions


@router.post("/sessions/{session_id}/assets", response_model=OnboardingAsset)
async def add_asset(
    session_id: str,
    asset: OnboardingAsset,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    r = execute_returning(conn,
        """INSERT INTO onboarding_assets (session_id, name, category, model, manufacturer, location_name)
           VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
        (session_id, asset.name, asset.category, asset.model, asset.manufacturer, asset.location_name),
    )
    return OnboardingAsset(**{k: r.get(k) for k in ["id", "name", "category", "model", "manufacturer", "location_name"]})


@router.get("/sessions/{session_id}/assets")
async def list_assets(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    asset_rows = rows(conn,
        "SELECT * FROM onboarding_assets WHERE session_id = %s",
        (session_id,),
    )
    return [dict(r) for r in asset_rows]


@router.delete("/sessions/{session_id}/assets/{asset_id}", status_code=204)
async def delete_asset(
    session_id: str,
    asset_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    execute(conn,
        "DELETE FROM onboarding_assets WHERE id = %s AND session_id = %s",
        (asset_id, session_id),
    )


@router.post("/sessions/{session_id}/vendors", response_model=OnboardingVendor)
async def add_vendor(
    session_id: str,
    vendor: OnboardingVendor,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    r = execute_returning(conn,
        """INSERT INTO onboarding_vendors (session_id, name, service_type, contact_email, contact_phone)
           VALUES (%s, %s, %s, %s, %s) RETURNING *""",
        (session_id, vendor.name, vendor.service_type, vendor.contact_email, vendor.contact_phone),
    )
    return OnboardingVendor(**{k: r.get(k) for k in ["id", "name", "service_type", "contact_email", "contact_phone"]})


@router.get("/sessions/{session_id}/vendors")
async def list_vendors(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    vendor_rows = rows(conn,
        "SELECT * FROM onboarding_vendors WHERE session_id = %s",
        (session_id,),
    )
    return [dict(r) for r in vendor_rows]


@router.delete("/sessions/{session_id}/vendors/{vendor_id}", status_code=204)
async def delete_vendor(
    session_id: str,
    vendor_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    execute(conn,
        "DELETE FROM onboarding_vendors WHERE id = %s AND session_id = %s",
        (vendor_id, session_id),
    )


@router.post("/sessions/{session_id}/confirm-assets", response_model=OnboardingSessionResponse)
async def confirm_assets(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Confirm assets (or skip). Advance to step 5 (Vendors)."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 4)
    _advance_step(conn, session_id, 5)
    return _session_to_response(_get_session(conn, session_id, org_id))


@router.post("/sessions/{session_id}/confirm-vendors", response_model=OnboardingSessionResponse)
async def confirm_vendors(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Confirm vendors (or skip). Advance to step 6 (Shift Settings)."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 5)
    _advance_step(conn, session_id, 6)
    return _session_to_response(_get_session(conn, session_id, org_id))


@router.post("/sessions/{session_id}/confirm-shift-settings", response_model=OnboardingSessionResponse)
async def confirm_shift_settings(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Confirm shift settings (or skip). Advance to step 4 (Assets)."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 3)
    _advance_step(conn, session_id, 4)
    return _session_to_response(_get_session(conn, session_id, org_id))


# ── Step 7: Workspace Preview ──────────────────────────────────────────────────

@router.get("/sessions/{session_id}/preview", response_model=WorkspacePreview)
async def get_workspace_preview(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Aggregate all onboarding data into a preview (read-only)."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 7)

    # Fetch selected templates with content
    selected_rows = rows(conn,
        """SELECT os.is_selected, os.customizations,
                  ti.id AS ti_id, ti.name AS ti_name, ti.description AS ti_description,
                  ti.category, ti.content
           FROM onboarding_selections os
           JOIN template_items ti ON ti.id = os.template_id
           WHERE os.session_id = %s AND os.is_selected = true""",
        (session_id,),
    )

    by_cat: dict[str, list] = {}
    for r in selected_rows:
        cat = r.get("category", "")
        content = r.get("content") or {}
        if isinstance(content, str):
            content = json.loads(content)
        customizations = r.get("customizations")
        if customizations:
            if isinstance(customizations, str):
                customizations = json.loads(customizations)
            content = {**content, **customizations}
        entry = {"id": r.get("ti_id"), "name": r.get("ti_name"), "description": r.get("ti_description"), **content}
        by_cat.setdefault(cat, []).append(entry)

    # Employees
    emp_rows = rows(conn,
        "SELECT * FROM onboarding_employees WHERE session_id = %s",
        (session_id,),
    )
    by_role: dict[str, int] = {}
    for e in emp_rows:
        r_val = e.get("retail_role", "staff")
        by_role[r_val] = by_role.get(r_val, 0) + 1

    role_rows = rows(conn,
        "SELECT * FROM role_mappings WHERE session_id = %s AND is_confirmed = false",
        (session_id,),
    )
    pending_review = len([r for r in role_rows if r["confidence_score"] < 0.7])

    summary = SelectionSummary(
        forms=len(by_cat.get("form", [])),
        checklists=len(by_cat.get("checklist", [])),
        audits=len(by_cat.get("audit", [])),
        issue_categories=len(by_cat.get("issue_category", [])),
        workflows=len(by_cat.get("workflow", [])),
        training_modules=len(by_cat.get("training_module", [])),
        shift_templates=len(by_cat.get("shift_template", [])),
        repair_manuals=len(by_cat.get("repair_manual", [])),
        badges=len(by_cat.get("badge", [])),
        total_selected=len(selected_rows),
        total_available=len(selected_rows),
    )

    loc_rows = rows(conn, "SELECT * FROM onboarding_locations WHERE session_id = %s", (session_id,))
    asset_rows = rows(conn, "SELECT * FROM onboarding_assets WHERE session_id = %s", (session_id,))
    vendor_rows = rows(conn, "SELECT * FROM onboarding_vendors WHERE session_id = %s", (session_id,))

    return WorkspacePreview(
        summary=summary,
        locations=[dict(r) for r in loc_rows],
        assets=[dict(r) for r in asset_rows],
        vendors=[dict(r) for r in vendor_rows],
        forms_and_checklists=by_cat.get("form", []) + by_cat.get("checklist", []) + by_cat.get("audit", []),
        issue_categories=by_cat.get("issue_category", []),
        workflows=by_cat.get("workflow", []),
        training_modules=by_cat.get("training_module", []),
        shift_templates=by_cat.get("shift_template", []),
        repair_manuals=by_cat.get("repair_manual", []),
        employees={"total": len(emp_rows), "by_role": by_role, "pending_review": pending_review},
        company_name=session.get("company_name"),
        brand_color=session.get("brand_color"),
        logo_url=session.get("logo_url"),
    )


@router.patch("/sessions/{session_id}/preview/template/{template_id}")
async def edit_template_inline(
    session_id: str,
    template_id: str,
    updates: dict,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Inline edit template customizations during preview."""
    org_id = _get_org_id(current_user)
    _get_session(conn, session_id, org_id)
    execute(conn,
        """UPDATE onboarding_selections SET customizations = %s
           WHERE session_id = %s AND template_id = %s""",
        (json.dumps(updates), session_id, template_id),
    )
    return {"ok": True}


@router.post("/sessions/{session_id}/confirm-preview", response_model=OnboardingSessionResponse)
async def confirm_preview(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Advance to step 8."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 7)
    _advance_step(conn, session_id, 8)
    return _session_to_response(_get_session(conn, session_id, org_id))


# ── Step 8: Launch ─────────────────────────────────────────────────────────────

LAUNCH_STEPS = [
    "Creating locations",
    "Registering assets",
    "Setting up vendors",
    "Creating forms & checklists",
    "Setting up issue categories",
    "Configuring workflows",
    "Importing training modules",
    "Creating shift templates",
    "Loading repair manuals",
    "Setting up badges",
    "Activating employee accounts",
    "Applying permissions",
    "Finalizing workspace",
]


async def _provision_workspace(session_id: str, org_id: str, created_by: str = ""):
    """Background task: create live workspace entities from onboarding selections.

    NOTE: This runs as a background task outside the request lifecycle, so it
    obtains its own DB connection from the pool rather than using Depends(get_db).
    """
    from services.db import _get_pool
    pool = _get_pool()
    conn = pool.getconn()

    completed_steps = []

    def _update_progress(step: str, percent: int):
        execute(conn,
            """UPDATE onboarding_sessions
               SET launch_progress = %s, updated_at = %s
               WHERE id = %s AND organisation_id = %s""",
            (json.dumps({
                "status": "provisioning",
                "current_step": step,
                "progress_percent": percent,
                "steps_completed": completed_steps,
                "steps_remaining": [s for s in LAUNCH_STEPS if s not in completed_steps],
            }), datetime.now(timezone.utc).isoformat(), session_id, org_id),
        )
        conn.commit()

    try:
        # Clean up any previously partially-provisioned records so re-runs are idempotent
        # workflow_stages: join through workflow_definitions
        wf_id_rows = rows(conn, "SELECT id FROM workflow_definitions WHERE organisation_id = %s", (org_id,))
        wf_ids = [r["id"] for r in wf_id_rows]
        if wf_ids:
            execute(conn, "DELETE FROM workflow_stages WHERE workflow_definition_id = ANY(%s::uuid[])", (wf_ids,))
            execute(conn, "DELETE FROM workflow_routing_rules WHERE workflow_definition_id = ANY(%s::uuid[])", (wf_ids,))

        # course_modules + slides + quiz questions: join through courses
        course_id_rows = rows(conn, "SELECT id FROM courses WHERE organisation_id = %s", (org_id,))
        course_ids = [r["id"] for r in course_id_rows]
        if course_ids:
            mod_id_rows = rows(conn, "SELECT id FROM course_modules WHERE course_id = ANY(%s::uuid[])", (course_ids,))
            mod_ids = [r["id"] for r in mod_id_rows]
            if mod_ids:
                execute(conn, "DELETE FROM course_slides WHERE module_id = ANY(%s::uuid[])", (mod_ids,))
                execute(conn, "DELETE FROM quiz_questions WHERE module_id = ANY(%s::uuid[])", (mod_ids,))
            execute(conn, "DELETE FROM course_modules WHERE course_id = ANY(%s::uuid[])", (course_ids,))

        # Delete children that RESTRICT form_templates deletion
        ft_id_rows = rows(conn, "SELECT id FROM form_templates WHERE organisation_id = %s", (org_id,))
        ft_ids = [r["id"] for r in ft_id_rows]
        if ft_ids:
            execute(conn, "DELETE FROM form_assignments WHERE form_template_id = ANY(%s::uuid[])", (ft_ids,))
            execute(conn, "DELETE FROM audit_configs WHERE form_template_id = ANY(%s::uuid[])", (ft_ids,))
            execute(conn, "DELETE FROM form_submissions WHERE form_template_id = ANY(%s::uuid[])", (ft_ids,))

        # Order matters: delete children before parents (FK constraints)
        for tbl in [
            "repair_guides", "courses",
            "assets", "vendors",
            "shift_templates",
            "workflow_definitions",
            "issue_categories",
            "form_templates",
            "badge_configs",
            "locations",
        ]:
            execute(conn, f"DELETE FROM {tbl} WHERE organisation_id = %s", (org_id,))

        conn.commit()

        session = dict(row(conn, "SELECT * FROM onboarding_sessions WHERE id = %s", (session_id,)))
        industry = INDUSTRY_DISPLAY.get(session.get("industry_code", ""), session.get("industry_code", "retail"))

        # Stamp industry_code on the organisation so AI endpoints can use it post-onboarding
        if session.get("industry_code"):
            execute(conn, "UPDATE organisations SET industry_code = %s WHERE id = %s",
                    (session["industry_code"], org_id))

        # Fetch all selected templates
        selected_res = rows(conn,
            """SELECT os.customizations,
                      ti.name AS ti_name, ti.category, ti.content
               FROM onboarding_selections os
               JOIN template_items ti ON ti.id = os.template_id
               WHERE os.session_id = %s AND os.is_selected = true""",
            (session_id,),
        )

        by_cat: dict[str, list] = {}
        for sel_row in selected_res:
            cat = sel_row.get("category", "")
            content_val = sel_row.get("content") or {}
            if isinstance(content_val, str):
                content_val = json.loads(content_val)
            cust = sel_row.get("customizations") or {}
            if isinstance(cust, str):
                cust = json.loads(cust)
            content_val = {**content_val, **cust}
            by_cat.setdefault(cat, []).append({"name": sel_row.get("ti_name"), "content": content_val})

        total = len(LAUNCH_STEPS)

        # Step 1: Locations
        _update_progress("Creating locations", int(1 / total * 100))
        onb_locs = rows(conn, "SELECT * FROM onboarding_locations WHERE session_id = %s", (session_id,))
        location_id_map: dict[str, str] = {}  # name -> real location id
        first_location_id: str | None = None
        for loc in onb_locs:
            loc_row = execute_returning(conn,
                """INSERT INTO locations (organisation_id, name, address, is_active, is_deleted)
                   VALUES (%s, %s, %s, true, false) RETURNING *""",
                (org_id, loc["name"], loc.get("address")),
            )
            real_id = loc_row["id"]
            location_id_map[loc["name"]] = real_id
            if first_location_id is None:
                first_location_id = real_id
        completed_steps.append("Creating locations")
        conn.commit()

        # Step 2: Assets
        _update_progress("Registering assets", int(2 / total * 100))
        onb_assets = rows(conn, "SELECT * FROM onboarding_assets WHERE session_id = %s", (session_id,))
        real_assets = []
        for asset in onb_assets:
            loc_id = location_id_map.get(asset.get("location_name", "")) or first_location_id
            if not loc_id:
                continue
            asset_row = execute_returning(conn,
                """INSERT INTO assets (organisation_id, location_id, name, category, model, manufacturer, is_deleted)
                   VALUES (%s, %s, %s, %s, %s, %s, false) RETURNING *""",
                (org_id, loc_id, asset["name"], asset["category"],
                 asset.get("model") or "", asset.get("manufacturer") or ""),
            )
            real_assets.append(dict(asset_row))
        completed_steps.append("Registering assets")
        conn.commit()

        # Step 3: Vendors
        _update_progress("Setting up vendors", int(3 / total * 100))
        onb_vendors = rows(conn, "SELECT * FROM onboarding_vendors WHERE session_id = %s", (session_id,))
        for vendor in onb_vendors:
            execute(conn,
                """INSERT INTO vendors (organisation_id, name, contact_email, contact_phone, is_active, is_deleted)
                   VALUES (%s, %s, %s, %s, true, false)""",
                (org_id, vendor["name"], vendor.get("contact_email"), vendor.get("contact_phone")),
            )
        completed_steps.append("Setting up vendors")
        conn.commit()

        # Step 4: Forms / Checklists / Audits (with sections + fields)
        _update_progress("Creating forms & checklists", 5)
        _FIELD_TYPE_MAP = {
            "pass_fail": "yes_no", "boolean": "yes_no",
            "select": "dropdown", "multi_select": "multi_select",
            "radio": "radio", "date": "datetime",
        }
        _VALID_FIELD_TYPES = {
            "text", "number", "checkbox", "dropdown", "multi_select", "photo",
            "signature", "datetime", "time", "yes_no", "boolean", "rating",
            "select", "radio", "file", "textarea", "audit_item",
        }
        form_name_to_id: dict[str, str] = {}
        for item in by_cat.get("form", []) + by_cat.get("checklist", []) + by_cat.get("audit", []):
            c = item["content"]
            raw_type = c.get("type", "checklist")
            form_type = raw_type if raw_type in ("form", "checklist", "audit") else "checklist"
            if not created_by:
                continue
            tmpl = execute_returning(conn,
                """INSERT INTO form_templates (organisation_id, title, description, type, is_active, is_deleted, created_by)
                   VALUES (%s, %s, %s, %s, true, false, %s) RETURNING *""",
                (org_id, item["name"] or "Untitled Form", c.get("description", ""), form_type, created_by),
            )
            tmpl_id = tmpl["id"]
            form_name_to_id[item["name"]] = tmpl_id

            # Create sections + fields
            for s_order, section in enumerate(c.get("sections") or []):
                sec = execute_returning(conn,
                    """INSERT INTO form_sections (form_template_id, title, display_order)
                       VALUES (%s, %s, %s) RETURNING *""",
                    (tmpl_id, section.get("title", f"Section {s_order + 1}"), s_order),
                )
                sec_id = sec["id"]
                for f_order, field in enumerate(section.get("fields") or []):
                    raw_ftype = field.get("type", "text")
                    ftype = _FIELD_TYPE_MAP.get(raw_ftype, raw_ftype if raw_ftype in _VALID_FIELD_TYPES else "text")
                    execute(conn,
                        """INSERT INTO form_fields (section_id, label, field_type, is_required, display_order, is_critical)
                           VALUES (%s, %s, %s, %s, %s, %s)""",
                        (sec_id, field.get("label", f"Field {f_order + 1}"), ftype,
                         bool(field.get("required", False)), f_order, bool(field.get("is_critical", False))),
                    )

            # For audits: create audit_config with passing score
            if form_type == "audit":
                scoring = c.get("scoring") or {}
                passing = scoring.get("passing_threshold") or scoring.get("passing_score") or 80
                execute(conn,
                    "INSERT INTO audit_configs (form_template_id, passing_score) VALUES (%s, %s)",
                    (tmpl_id, int(passing)),
                )

        # Create a daily form_assignment for the Daily Store Opening Checklist
        daily_checklist_id = form_name_to_id.get("Daily Store Opening Checklist")
        if daily_checklist_id:
            execute(conn,
                """INSERT INTO form_assignments (form_template_id, organisation_id, recurrence, due_at, is_active, is_deleted)
                   VALUES (%s, %s, %s, %s, true, false)""",
                (daily_checklist_id, org_id, "daily",
                 (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()),
            )

        completed_steps.append("Creating forms & checklists")
        conn.commit()
        _update_progress("Setting up issue categories", 20)

        # Step 5: Issue Categories
        for item in by_cat.get("issue_category", []):
            c = item["content"]
            cat_name = c.get("category_name", item["name"]) or item["name"] or "Uncategorised"
            _MAINTENANCE_NAMES = ["equipment failure", "facility damage", "it / system issue", "it/system issue", "it system issue", "maintenance", "equipment repair"]
            is_maint = any(m in cat_name.lower() for m in _MAINTENANCE_NAMES)

            execute(conn,
                """INSERT INTO issue_categories
                   (organisation_id, name, description, default_priority, sla_hours, icon, is_maintenance)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (org_id, cat_name, c.get("description", ""), c.get("default_priority", "medium"),
                 c.get("sla_hours"), c.get("icon", ""), is_maint),
            )
        completed_steps.append("Setting up issue categories")
        conn.commit()
        _update_progress("Configuring workflows", 35)

        # Build category name -> id lookup for trigger_issue_category_ref resolution
        cat_name_to_id: dict[str, str] = {}
        for cat_row in rows(conn, "SELECT id, name FROM issue_categories WHERE organisation_id = %s", (org_id,)):
            cat_name_to_id[cat_row["name"]] = cat_row["id"]

        # Step 6: Workflows -- definitions + stages
        _VALID_TRIGGER_TYPES = {
            "manual", "audit_submitted", "issue_created", "incident_created",
            "scheduled", "form_submitted", "employee_created",
        }
        _TRIGGER_MAP = {
            "issue_filed": "issue_created", "issue_raised": "issue_created",
            "audit_complete": "audit_submitted", "audit_done": "audit_submitted",
            "audit_item_failed": "audit_submitted",
            "form_complete": "form_submitted", "form_done": "form_submitted",
            "incident_raised": "incident_created", "incident_filed": "incident_created",
            "user_created": "employee_created",
        }
        _VALID_ACTION_TYPES = {
            "review", "approve", "fill_form", "sign", "create_task",
            "create_issue", "create_incident", "notify", "wait", "assign_training",
        }
        _STAGE_ACTION_MAP = {
            "condition": "wait", "escalate": "notify", "delay": "wait",
            "assign": "review", "send_notification": "notify",
        }
        _VALID_ROLES = {"staff", "manager", "admin", "super_admin", "vendor"}
        _STAGE_EXCLUDE_KEYS = {"type", "target_role", "assign_to_role", "assigned_role", "is_final", "form_ref", "name"}

        for item in by_cat.get("workflow", []):
            c = item["content"]
            trigger = c.get("trigger") or {}
            raw_trigger = trigger.get("type", "manual")
            trigger_type = _TRIGGER_MAP.get(raw_trigger, raw_trigger if raw_trigger in _VALID_TRIGGER_TYPES else "manual")

            # Trigger scoping
            trigger_conditions = trigger.get("conditions") or None
            issue_cat_ref = trigger.get("issue_category_ref")
            trigger_issue_category_id = cat_name_to_id.get(issue_cat_ref) if issue_cat_ref else None

            wf_row = execute_returning(conn,
                """INSERT INTO workflow_definitions
                   (organisation_id, name, trigger_type, trigger_config, is_active,
                    trigger_conditions, trigger_issue_category_id)
                   VALUES (%s, %s, %s, %s, false, %s, %s) RETURNING *""",
                (org_id,
                 c.get("workflow_name", item["name"]) or item["name"] or "Untitled Workflow",
                 trigger_type, json.dumps(trigger),
                 json.dumps(trigger_conditions) if trigger_conditions else None,
                 trigger_issue_category_id),
            )
            wf_id = wf_row["id"]

            stages = c.get("stages") or []
            for s_order, stage in enumerate(stages):
                raw_action = stage.get("type", "notify")
                action_type = _STAGE_ACTION_MAP.get(raw_action, raw_action if raw_action in _VALID_ACTION_TYPES else "notify")
                raw_role = stage.get("target_role") or stage.get("assign_to_role") or stage.get("assigned_role")
                assigned_role = raw_role if raw_role in _VALID_ROLES else None

                # Resolve form_ref to form_template_id for fill_form stages
                resolved_form_id = form_name_to_id.get(stage["form_ref"]) if action_type == "fill_form" and stage.get("form_ref") else None

                sla_hours = stage.get("sla_hours") or stage.get("due_hours") or None

                execute(conn,
                    """INSERT INTO workflow_stages
                       (workflow_definition_id, name, stage_order, action_type, is_final,
                        config, assigned_role, form_template_id, sla_hours)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (wf_id,
                     stage.get("name") or stage.get("title") or f"Step {s_order + 1}",
                     s_order, action_type,
                     bool(stage.get("is_final", s_order == len(stages) - 1)),
                     json.dumps({k: v for k, v in stage.items() if k not in _STAGE_EXCLUDE_KEYS}),
                     assigned_role, resolved_form_id, sla_hours),
                )
        completed_steps.append("Configuring workflows")
        conn.commit()
        _update_progress("Importing training modules", 50)

        # Step 7: Training modules -> courses + course_modules + AI content (parallel)
        _MODULE_TYPE_MAP = {
            "text_with_images": "slides", "text": "slides", "slides": "slides",
            "video_with_quiz": "video", "video": "video",
            "scenario_based": "quiz", "quiz": "quiz",
            "pdf": "pdf",
        }

        # Phase 4a: Create all course + module rows (fast DB ops, sequential)
        pending_ai: list[dict] = []  # {course_title, module_records}
        for item in by_cat.get("training_module", []):
            c = item["content"]
            if not created_by:
                continue

            cert_validity_days = int(c["renewal_days"]) if c.get("renewal_days") else None
            course_row = execute_returning(conn,
                """INSERT INTO courses
                   (organisation_id, created_by, title, description, passing_score,
                    is_mandatory, target_roles, estimated_duration_mins, is_published,
                    is_active, is_deleted, ai_generated, cert_validity_days)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, false, true, false, true, %s) RETURNING *""",
                (org_id, created_by,
                 c.get("module_name", item["name"]) or item["name"] or "Untitled Course",
                 c.get("description", ""), int(c.get("passing_score", 80)),
                 bool(c.get("auto_assign_on_hire", False)),
                 c.get("target_roles", []),
                 c.get("estimated_minutes"),
                 cert_validity_days),
            )
            course_id = course_row["id"]
            course_title = course_row["title"]

            module_records: list[dict] = []
            for m_order, section in enumerate(c.get("sections") or []):
                mtype = _MODULE_TYPE_MAP.get(section.get("content_type", "slides"), "slides")
                mod = execute_returning(conn,
                    """INSERT INTO course_modules
                       (course_id, title, module_type, display_order, is_required, estimated_duration_mins)
                       VALUES (%s, %s, %s, %s, true, %s) RETURNING *""",
                    (course_id, section.get("title", f"Module {m_order + 1}"), mtype, m_order,
                     c.get("estimated_minutes")),
                )
                module_records.append({
                    "id": mod["id"],
                    "title": section.get("title", f"Module {m_order + 1}"),
                    "type": mtype,
                })
            pending_ai.append({"course_title": course_title, "module_records": module_records})

        conn.commit()

        # Phase 4b: Fire all AI content calls in parallel
        async def _generate_course_content(course_title: str, module_records: list[dict]) -> tuple[str, list]:
            module_outline = [{"title": m["title"], "type": m["type"]} for m in module_records]
            ai_client = _get_anthropic()
            def _call():
                return ai_client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=4000,
                    messages=[{"role": "user", "content": (
                        f"Generate training content for a {industry} course titled '{course_title}'. "
                        f"Modules: {json.dumps(module_outline)}. "
                        f"For each 'slides' module: write 3-4 slides. Each slide MUST have exactly two keys: \"title\" (short heading) and \"body\" (2-3 sentence explanation of a key concept). Do NOT use any other key name — only \"title\" and \"body\". "
                        f"For each 'quiz' or 'video' module: write 3-4 multiple_choice quiz questions with 4 options (exactly 1 correct), and a brief explanation. "
                        f"Respond ONLY with JSON array matching the module order: "
                        f'[{{"type": "slides", "slides": [{{"title": "...", "body": "..."}}]}}, '
                        f'{{"type": "quiz", "questions": [{{"question": "...", "question_type": "multiple_choice", "options": [{{"text": "...", "is_correct": true}}], "explanation": "..."}}]}}]'
                    )}],
                )
            resp = await asyncio.to_thread(_call)
            text = _strip_code_fence("".join(b.text for b in resp.content if hasattr(b, "text")))
            return course_title, json.loads(text)

        ai_results = await asyncio.gather(
            *[_generate_course_content(p["course_title"], p["module_records"]) for p in pending_ai],
            return_exceptions=True,
        )

        # Phase 4c: Batch-insert slides and quiz questions
        slide_insert_rows: list[tuple] = []
        quiz_insert_rows: list[tuple] = []
        for pending, result in zip(pending_ai, ai_results):
            if isinstance(result, Exception):
                _log.warning("Course content generation failed for '%s': %s", pending["course_title"], result)
                continue
            _, content_list = result
            for idx, mod in enumerate(pending["module_records"]):
                if idx >= len(content_list):
                    break
                mod_content = content_list[idx]
                if mod["type"] == "slides":
                    for s_order, slide in enumerate(mod_content.get("slides") or []):
                        slide_insert_rows.append((
                            mod["id"],
                            slide.get("title", f"Slide {s_order + 1}"),
                            slide.get("body") or slide.get("content") or slide.get("text") or slide.get("description") or "",
                            s_order,
                        ))
                else:
                    for q_order, q in enumerate(mod_content.get("questions") or []):
                        qtype = q.get("question_type", "multiple_choice")
                        if qtype not in ("multiple_choice", "true_false", "image_based"):
                            qtype = "multiple_choice"
                        quiz_insert_rows.append((
                            mod["id"],
                            q.get("question", "Question"),
                            qtype,
                            json.dumps(q.get("options", [])),
                            q.get("explanation", ""),
                            q_order,
                        ))
        if slide_insert_rows:
            execute_many(conn,
                "INSERT INTO course_slides (module_id, title, body, display_order) VALUES (%s, %s, %s, %s)",
                slide_insert_rows,
            )
        if quiz_insert_rows:
            execute_many(conn,
                """INSERT INTO quiz_questions (module_id, question, question_type, options, explanation, display_order)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                quiz_insert_rows,
            )

        completed_steps.append("Importing training modules")
        conn.commit()
        _update_progress("Creating shift templates", 65)

        # Step 8: Shift templates
        for item in by_cat.get("shift_template", []):
            c = item["content"]
            start = c.get("start_time") or c.get("start") or "08:00"
            end   = c.get("end_time")   or c.get("end")   or "17:00"
            days  = _normalize_days(c.get("days_of_week") or c.get("days"))
            if not created_by:
                continue
            execute(conn,
                """INSERT INTO shift_templates
                   (organisation_id, name, role, start_time, end_time, days_of_week, is_active, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s, true, %s)""",
                (org_id, c.get("shift_name", item["name"]) or item["name"] or "Untitled Shift",
                 c.get("role", ""), start, end, days, created_by),
            )
        completed_steps.append("Creating shift templates")
        conn.commit()
        _update_progress("Loading repair manuals", 73)

        # Step 9: Repair manuals -- asset-specific if assets exist, else generic
        _VALID_GUIDE_TYPES = {"pdf", "video", "audio", "text"}
        if real_assets:
            # Generate asset-specific repair guides via AI
            asset_summary = [
                {"name": a["name"], "category": a["category"], "model": a.get("model") or ""}
                for a in real_assets
            ]
            # Deduplicate by category
            seen_cats: set[str] = set()
            unique_assets = []
            for a in asset_summary:
                key = f"{a['category']}:{a['name']}"
                if key not in seen_cats:
                    seen_cats.add(key)
                    unique_assets.append(a)

            try:
                ai_client = _get_anthropic()
                def _repair_call():
                    return ai_client.messages.create(
                        model="claude-haiku-4-5-20251001",
                        max_tokens=2048,
                        messages=[{"role": "user", "content": (
                            f"For each asset in a {industry} business, write a concise maintenance/repair guide. "
                            f"Assets: {json.dumps(unique_assets)}. "
                            f"For each, give: title, a short 3-5 step maintenance procedure as plain text. "
                            f"Respond ONLY with JSON array: "
                            f'[{{"title": "...", "content": "..."}}]'
                        )}],
                    )
                repair_resp = await asyncio.to_thread(_repair_call)
                repair_text = "".join(b.text for b in repair_resp.content if hasattr(b, "text"))
                repair_text = _strip_code_fence(repair_text)
                repair_guides = json.loads(repair_text)
                for g in repair_guides:
                    execute(conn,
                        """INSERT INTO repair_guides (organisation_id, title, guide_type, content, is_deleted)
                           VALUES (%s, %s, %s, %s, false)""",
                        (org_id, g.get("title", "Maintenance Guide"), "text", g.get("content", "")),
                    )
            except Exception:
                pass  # don't fail provisioning if AI guide generation fails
        else:
            # Fall back to template-based generic guides
            for item in by_cat.get("repair_manual", []):
                c = item["content"]
                guide_type = c.get("guide_type", "text")
                if guide_type not in _VALID_GUIDE_TYPES:
                    guide_type = "text"
                execute(conn,
                    """INSERT INTO repair_guides (organisation_id, title, guide_type, content, is_deleted)
                       VALUES (%s, %s, %s, %s, false)""",
                    (org_id, c.get("title", item["name"]) or item["name"] or "Untitled Guide",
                     guide_type, c.get("content", c.get("steps", ""))),
                )
        completed_steps.append("Loading repair manuals")
        conn.commit()

        # Step 10: Badges -- use package templates when available, else AI
        _update_progress("Setting up badges", 88)
        valid_criteria = {
            "issues_reported", "issues_resolved", "checklists_completed",
            "checklist_streak_days", "training_completed", "attendance_streak_days",
            "tasks_completed", "manual",
        }
        try:
            badge_templates = by_cat.get("badge", [])
            if badge_templates:
                badge_insert_rows = []
                for item in badge_templates:
                    c = item.get("content", {})
                    criteria = c.get("criteria_type", "manual")
                    if criteria not in valid_criteria:
                        criteria = "manual"
                    badge_insert_rows.append((
                        org_id,
                        c.get("badge_name", item.get("name", "Badge")),
                        c.get("description", ""),
                        int(c.get("points_awarded", 50)),
                        criteria,
                    ))
                if badge_insert_rows:
                    execute_many(conn,
                        """INSERT INTO badge_configs (organisation_id, name, description, points_awarded, criteria_type)
                           VALUES (%s, %s, %s, %s, %s)""",
                        badge_insert_rows,
                    )
            else:
                ai_client = _get_anthropic()
                def _badge_call():
                    return ai_client.messages.create(
                        model="claude-haiku-4-5-20251001",
                        max_tokens=512,
                        messages=[{"role": "user", "content": (
                            f"Suggest 4-5 employee achievement badges for a {industry} business. "
                            f"Each badge should reward a specific positive behavior. "
                            f"Available criteria_type values: issues_reported, issues_resolved, checklists_completed, checklist_streak_days, training_completed, attendance_streak_days, tasks_completed, manual. "
                            f"Respond ONLY with JSON array: "
                            f'[{{"name": "...", "description": "...", "points": 50, "criteria_type": "..."}}]'
                        )}],
                    )
                badge_resp = await asyncio.to_thread(_badge_call)
                badge_text = "".join(b.text for b in badge_resp.content if hasattr(b, "text"))
                badge_text = _strip_code_fence(badge_text)
                badges = json.loads(badge_text)
                badge_insert_rows = []
                for b in badges:
                    criteria = b.get("criteria_type", "manual")
                    if criteria not in valid_criteria:
                        criteria = "manual"
                    badge_insert_rows.append((
                        org_id,
                        b.get("name", "Badge"),
                        b.get("description", ""),
                        int(b.get("points", 50)),
                        criteria,
                    ))
                if badge_insert_rows:
                    execute_many(conn,
                        """INSERT INTO badge_configs (organisation_id, name, description, points_awarded, criteria_type)
                           VALUES (%s, %s, %s, %s, %s)""",
                        badge_insert_rows,
                    )
        except Exception:
            pass  # don't fail provisioning if badge generation fails
        completed_steps.append("Setting up badges")
        conn.commit()

        # Step 11: Create employee accounts (auth users + profiles)
        _update_progress("Activating employee accounts", 85)
        emp_rows = rows(conn, "SELECT * FROM onboarding_employees WHERE session_id = %s", (session_id,))
        role_map = {"admin": "admin", "manager": "manager", "staff": "staff"}
        for emp in emp_rows:
            email = emp.get("email", "").strip()
            if not email:
                continue
            full_name = emp.get("full_name", email)
            role = role_map.get(emp.get("retail_role", "staff"), "staff")
            location_name = emp.get("location_name")
            loc_id = location_id_map.get(location_name) if location_name else None

            # Create the employee in Keycloak to get their real UUID.
            # That UUID becomes profiles.id so JWT sub → profile lookup works.
            try:
                from services.keycloak_admin import create_keycloak_user
                new_user_id, temp_password = await create_keycloak_user(
                    email=email,
                    full_name=full_name,
                    role=role,
                )
                # TODO: deliver temp_password to employee via email (Resend) before prod
                _log.info("Keycloak account created for %s (id=%s) — TEMP PW: %s", email, new_user_id, temp_password)
            except Exception as kc_err:
                _log.error("Keycloak user creation failed for %s during onboarding: %s — skipping", email, kc_err)
                continue

            # Upsert profile so re-provisioning never fails on duplicate id.
            execute(conn,
                """INSERT INTO profiles (id, organisation_id, full_name, role, language, is_active, is_deleted, location_id, phone_number, position)
                   VALUES (%s, %s, %s, %s, %s, true, false, %s, %s, %s)
                   ON CONFLICT (id) DO UPDATE SET
                       organisation_id = EXCLUDED.organisation_id,
                       full_name = EXCLUDED.full_name,
                       role = EXCLUDED.role,
                       language = EXCLUDED.language,
                       is_active = EXCLUDED.is_active,
                       is_deleted = EXCLUDED.is_deleted,
                       location_id = EXCLUDED.location_id,
                       phone_number = EXCLUDED.phone_number,
                       position = EXCLUDED.position""",
                (new_user_id, org_id, full_name, role, "en",
                 loc_id, emp.get("phone"), emp.get("position")),
            )
            execute(conn,
                "UPDATE onboarding_employees SET status = %s WHERE id = %s",
                ("invited", emp["id"]),
            )
        completed_steps.append("Activating employee accounts")
        conn.commit()

        # Step 12-13: Permissions + finalize
        _update_progress("Applying permissions", 93)
        completed_steps.append("Applying permissions")
        _update_progress("Finalizing workspace", 99)
        completed_steps.append("Finalizing workspace")

        # Mark session complete
        execute(conn,
            """UPDATE onboarding_sessions
               SET status = %s, current_step = 8, completed_at = %s,
                   launch_progress = %s, updated_at = %s
               WHERE id = %s AND organisation_id = %s""",
            ("completed", datetime.now(timezone.utc).isoformat(),
             json.dumps({
                 "status": "completed",
                 "progress_percent": 100,
                 "steps_completed": completed_steps,
                 "steps_remaining": [],
             }),
             datetime.now(timezone.utc).isoformat(),
             session_id, org_id),
        )
        conn.commit()

    except Exception as e:
        conn.rollback()
        execute(conn,
            """UPDATE onboarding_sessions
               SET launch_progress = %s, updated_at = %s
               WHERE id = %s AND organisation_id = %s""",
            (json.dumps({
                "status": "failed",
                "error": str(e),
                "steps_completed": completed_steps,
                "steps_remaining": [s for s in LAUNCH_STEPS if s not in completed_steps],
            }),
             datetime.now(timezone.utc).isoformat(),
             session_id, org_id),
        )
        conn.commit()
    finally:
        pool.putconn(conn)


@router.post("/sessions/{session_id}/launch")
async def launch_workspace(
    session_id: str,
    background_tasks: BackgroundTasks,
    conn=Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Kick off workspace provisioning as a background task."""
    org_id = _get_org_id(current_user)
    session = _get_session(conn, session_id, org_id)
    _require_step(session, 7)

    existing_progress = session.get("launch_progress") or {}
    if session.get("status") == "completed":
        raise HTTPException(status_code=400, detail="This workspace has already been launched.")
    if existing_progress.get("status") == "provisioning":
        updated_at_str = session.get("updated_at") or ""
        try:
            updated_at = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
            is_stale = datetime.now(timezone.utc) - updated_at > timedelta(minutes=10)
        except (ValueError, TypeError):
            is_stale = True
        if not is_stale:
            raise HTTPException(status_code=400, detail="Workspace provisioning is already in progress.")

    # Set initial progress
    execute(conn,
        """UPDATE onboarding_sessions
           SET launch_progress = %s, updated_at = %s
           WHERE id = %s AND organisation_id = %s""",
        (json.dumps({
            "status": "provisioning",
            "progress_percent": 0,
            "current_step": "Starting...",
            "steps_completed": [],
            "steps_remaining": LAUNCH_STEPS,
        }),
         datetime.now(timezone.utc).isoformat(),
         session_id, org_id),
    )

    user_id = current_user.get("sub", "")
    background_tasks.add_task(_provision_workspace, session_id, org_id, user_id)
    return {"ok": True, "message": "Workspace provisioning started."}


@router.get("/sessions/{session_id}/launch-progress", response_model=LaunchProgress)
async def get_launch_progress(
    session_id: str,
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    # Look up by session_id alone to avoid false 404s caused by JWT token refresh
    session = row(conn, "SELECT * FROM onboarding_sessions WHERE id = %s", (session_id,))
    if not session:
        raise HTTPException(status_code=404, detail="Onboarding session not found.")
    session = dict(session)

    # Verify ownership
    user_id = current_user.get("sub")
    session_org_id = session.get("organisation_id")
    if user_id and session_org_id:
        membership = row(conn,
            "SELECT id FROM profiles WHERE id = %s AND organisation_id = %s AND is_deleted = false LIMIT 1",
            (user_id, session_org_id),
        )
        if not membership:
            raise HTTPException(status_code=403, detail="Access denied.")

    progress = session.get("launch_progress") or {}
    if isinstance(progress, str):
        progress = json.loads(progress)

    if session.get("status") == "completed":
        return LaunchProgress(status="completed", progress_percent=100, steps_completed=LAUNCH_STEPS, steps_remaining=[])

    return LaunchProgress(
        status=progress.get("status", "pending"),
        current_step=progress.get("current_step"),
        progress_percent=progress.get("progress_percent", 0),
        steps_completed=progress.get("steps_completed", []),
        steps_remaining=progress.get("steps_remaining", LAUNCH_STEPS),
        error=progress.get("error"),
    )


@router.get("/package-templates")
async def get_package_templates(
    category: Optional[str] = None,
    conn=Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return template items for the authenticated org's industry package.

    Falls back to QSR if the org has no industry_code or the package isn't seeded.
    Optionally filter by ``category`` (e.g. badge, workflow, form, checklist).
    """
    # 1. Infer industry_code from the org
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    industry_code: Optional[str] = None
    if org_id:
        org_row = row(conn, "SELECT industry_code FROM organisations WHERE id = %s", (org_id,))
        if org_row:
            industry_code = (org_row.get("industry_code") or "").strip() or None

    # 2. Find the matching package -- fallback to QSR
    def _find_package(code: str):
        return row(conn,
            "SELECT id FROM industry_packages WHERE industry_code = %s AND is_active = true LIMIT 1",
            (code,),
        )

    pkg = _find_package(industry_code) if industry_code else None
    if not pkg:
        pkg = _find_package("qsr")
        industry_code = "qsr" if pkg else None

    if not pkg:
        return {"items": [], "industry_code": industry_code}

    # 3. Fetch items (optionally filtered by category)
    if category:
        items_data = rows(conn,
            """SELECT id, name, description, category, content, sort_order
               FROM template_items WHERE package_id = %s AND category = %s ORDER BY sort_order""",
            (pkg["id"], category),
        )
    else:
        items_data = rows(conn,
            """SELECT id, name, description, category, content, sort_order
               FROM template_items WHERE package_id = %s ORDER BY sort_order""",
            (pkg["id"],),
        )

    return {
        "items": [dict(r) for r in items_data],
        "industry_code": industry_code,
    }


@router.get("/sessions/{session_id}/first-actions", response_model=list[GuidedAction])
async def get_first_actions(session_id: str, current_user: dict = Depends(get_current_user)):
    """Return contextual first actions after launch."""
    return [
        GuidedAction(
            title="Invite your store managers",
            description="Send onboarding links to your location managers so they can set up their teams.",
            icon="users",
            action_url="/dashboard/users",
            action_label="Go to Users",
        ),
        GuidedAction(
            title="Assign tomorrow's opening checklist",
            description="Schedule the Daily Store Opening Checklist for each location.",
            icon="clipboard-list",
            action_url="/dashboard/forms",
            action_label="Go to Forms",
        ),
        GuidedAction(
            title="Review your workflows",
            description="Review your provisioned workflows and activate them when you're ready — they're off by default.",
            icon="git-branch",
            action_url="/dashboard/workflows",
            action_label="Go to Workflows",
        ),
        GuidedAction(
            title="Push training to new hires",
            description="Assign mandatory training modules to your new employees.",
            icon="graduation-cap",
            action_url="/dashboard/training",
            action_label="Go to Training",
        ),
    ]
