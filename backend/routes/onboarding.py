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

from dependencies import get_current_user, require_admin
from services.supabase_client import get_supabase
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


def _strip_code_fence(text: str) -> str:
    """Remove markdown code fences from an AI response (```json ... ``` or ``` ... ```)."""
    text = text.strip()
    if text.startswith("```"):
        text = text[3:]                          # drop opening ```
        if text.startswith("json"):
            text = text[4:]                      # drop language tag
        text = text.strip()
        if text.endswith("```"):
            text = text[:-3].strip()             # drop closing ```
        elif "```" in text:
            text = text[:text.index("```")].strip()
    return text


def _get_org_id(current_user: dict) -> str:
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    if not org_id:
        raise HTTPException(status_code=400, detail="User not associated with an organisation.")
    return org_id


def _get_session(session_id: str, org_id: str) -> dict:
    sb = get_supabase()
    res = sb.table("onboarding_sessions").select("*").eq("id", session_id).eq("organisation_id", org_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Onboarding session not found.")
    return res.data[0]


def _require_step(session: dict, expected_step: int):
    if session["current_step"] < expected_step:
        raise HTTPException(
            status_code=400,
            detail=f"Session is at step {session['current_step']}. Complete previous steps first."
        )


def _advance_step(session_id: str, to_step: int):
    get_supabase().table("onboarding_sessions").update(
        {"current_step": to_step, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", session_id).execute()


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
async def create_session(current_user: dict = Depends(require_admin)):
    """Create a new onboarding session. Only one active session per org."""
    org_id = _get_org_id(current_user)
    sb = get_supabase()

    # Check for existing active session
    existing = sb.table("onboarding_sessions").select("*").eq("organisation_id", org_id).eq("status", "in_progress").execute()
    if existing.data:
        return _session_to_response(existing.data[0])

    res = sb.table("onboarding_sessions").insert({
        "organisation_id": org_id,
        "current_step": 1,
        "status": "in_progress",
    }).execute()
    return _session_to_response(res.data[0])


@router.get("/sessions/current", response_model=OnboardingSessionResponse)
async def get_current_session(current_user: dict = Depends(get_current_user)):
    """Get the active onboarding session for the user's org."""
    org_id = _get_org_id(current_user)
    sb = get_supabase()
    res = sb.table("onboarding_sessions").select("*").eq("organisation_id", org_id).in_("status", ["in_progress", "completed"]).order("created_at", desc=True).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="No active onboarding session.")
    return _session_to_response(res.data[0])


@router.get("/sessions/{session_id}", response_model=OnboardingSessionResponse)
async def get_session(session_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _get_org_id(current_user)
    return _session_to_response(_get_session(session_id, org_id))


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
    # Large chains keep store listings on a separate page; the homepage is just marketing copy.
    _LOCATION_KEYWORDS = [
        "/stores",  # exact top-level path — highest priority
        "store-locator", "store_locator", "find-a-store", "find-store",
        "store-finder", "storefinder", "branch", "branches",
        "our-stores", "our-locations", "locations", "outlets", "stores",
    ]
    # Collect ALL candidates then pick the shortest href.
    # Shortest = listing page (/stores) rather than individual page (/stores/branch-xyz).
    loc_candidates = []
    for a in soup.find_all("a", href=True):
        href = a["href"].lower().split("?")[0]  # ignore query params for matching
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
                # Append sub-page content so Claude has real location data to work with
                scraped["text_sample"] = (
                    scraped["text_sample"]
                    + "\n\n[Store Locator Page: " + loc_url + "]\n"
                    + loc_text[:6000]
                )
        except Exception as e:
            _log.debug("Sub-page fetch failed: %s", e)  # Non-fatal; homepage text is still available

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
        # Strip markdown fences if model wrapped the JSON
        cleaned = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        # Fall back to title-derived name rather than erroring
        data = {
            "company_name": scrape.get("og", {}).get("site_name") or scrape.get("title", "Your Company"),
            "industry_code": "qsr",
            "confidence": 0.3,
        }

    # Use logo from scrape if AI didn't find one
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
    current_user: dict = Depends(require_admin),
):
    """Step 1: Scrape website and classify company. Does not advance step."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 1)

    scrape = await _scrape_website(req.website_url)
    profile = await _classify_with_ai(scrape)

    # Save to session (not confirmed yet)
    get_supabase().table("onboarding_sessions").update({
        "website_url": req.website_url,
        "company_name": profile.company_name,
        "industry_code": profile.industry_code,
        "industry_subcategory": profile.industry_subcategory,
        "estimated_locations": profile.estimated_locations,
        "brand_color": profile.brand_color_hex,
        "logo_url": profile.logo_url,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", session_id).eq("organisation_id", org_id).execute()

    return profile


@router.post("/sessions/{session_id}/discover/fallback", response_model=CompanyProfile)
async def discover_company_fallback(
    session_id: str,
    req: CompanyDiscoveryFallbackRequest,
    current_user: dict = Depends(require_admin),
):
    """Step 1 fallback: Manual entry when scrape fails."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 1)

    get_supabase().table("onboarding_sessions").update({
        "company_name": req.company_name,
        "industry_code": req.industry_code,
        "industry_subcategory": req.industry_subcategory,
        "estimated_locations": req.estimated_locations,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", session_id).eq("organisation_id", org_id).execute()

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
    current_user: dict = Depends(require_admin),
):
    """Confirm company profile. Advance to step 2. Pre-populate template selections."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)

    if session["current_step"] > 1:
        # Allow re-confirming without resetting selections
        pass

    sb = get_supabase()

    # Save confirmed profile
    sb.table("onboarding_sessions").update({
        "company_name": profile.company_name,
        "industry_code": profile.industry_code,
        "industry_subcategory": profile.industry_subcategory,
        "estimated_locations": profile.estimated_locations,
        "brand_color": profile.brand_color_hex,
        "logo_url": profile.logo_url,
        "current_step": 2,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", session_id).eq("organisation_id", org_id).execute()

    # Pre-populate template selections from industry package
    pkg_res = sb.table("industry_packages").select("id").eq("industry_code", profile.industry_code).eq("is_active", True).limit(1).execute()
    if pkg_res.data:
        package_id = pkg_res.data[0]["id"]
        items_res = sb.table("template_items").select("id, is_recommended").eq("package_id", package_id).execute()

        # Only insert if selections don't already exist
        existing = sb.table("onboarding_selections").select("template_id").eq("session_id", session_id).execute()
        existing_ids = {r["template_id"] for r in existing.data}

        to_insert = [
            {"session_id": session_id, "template_id": item["id"], "is_selected": item["is_recommended"]}
            for item in items_res.data
            if item["id"] not in existing_ids
        ]
        if to_insert:
            sb.table("onboarding_selections").insert(to_insert).execute()

    updated = _get_session(session_id, org_id)
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
        }
    elif category == "issue_category":
        return {
            "default_priority": content.get("default_priority"),
            "subcategory_count": len(content.get("subcategories", [])),
            "sla_hours": content.get("sla_hours"),
        }
    elif category == "workflow":
        return {
            "trigger_type": content.get("trigger", {}).get("type"),
            "stage_count": len(content.get("stages", [])),
        }
    elif category == "training_module":
        return {
            "format": content.get("format"),
            "estimated_minutes": content.get("estimated_minutes"),
            "auto_assign_on_hire": content.get("auto_assign_on_hire", False),
            "section_count": len(content.get("sections", [])),
            "passing_score": content.get("passing_score"),
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
async def get_templates(session_id: str, current_user: dict = Depends(get_current_user)):
    """Load industry package with current selections for this session.

    Step 6 = template selection (the step where the user picks their templates).
    Steps 7 (workspace preview) and 8 (launch) are downstream of step 6, so
    sessions at those steps are also permitted to call this endpoint — hence
    the guard uses >= 6 rather than == 6.
    """
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 6)

    industry_code = session.get("industry_code", "qsr")
    sb = get_supabase()

    pkg_res = sb.table("industry_packages").select("*").eq("industry_code", industry_code).eq("is_active", True).limit(1).execute()
    if not pkg_res.data:
        raise HTTPException(status_code=404, detail=f"No industry package found for '{industry_code}'.")
    package = pkg_res.data[0]

    items_res = sb.table("template_items").select("*").eq("package_id", package["id"]).order("sort_order").execute()
    selections_res = sb.table("onboarding_selections").select("template_id, is_selected").eq("session_id", session_id).execute()

    selected_map = {r["template_id"]: r["is_selected"] for r in selections_res.data}

    # Group by category
    by_category: dict[str, list] = {c: [] for c in DISPLAY_CATEGORY_ORDER}
    for item in items_res.data:
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
    current_user: dict = Depends(get_current_user),
):
    """Batch update template selections (debounced from frontend)."""
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    sb = get_supabase()

    for u in updates:
        sb.table("onboarding_selections").upsert(
            {"session_id": session_id, "template_id": u.template_id, "is_selected": u.is_selected},
            on_conflict="session_id,template_id",
        ).execute()

    return {"ok": True}


@router.get("/sessions/{session_id}/selections/summary", response_model=SelectionSummary)
async def get_selection_summary(session_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    sb = get_supabase()

    rows = sb.table("onboarding_selections").select(
        "is_selected, template_items(category)"
    ).eq("session_id", session_id).execute()

    counts: dict[str, int] = {}
    total_selected = 0
    total_available = len(rows.data)
    for r in rows.data:
        cat = (r.get("template_items") or {}).get("category", "")
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
async def confirm_templates(session_id: str, current_user: dict = Depends(require_admin)):
    """Confirm template selections. Advance to step 7 (Preview)."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 6)
    _advance_step(session_id, 7)
    return _session_to_response(_get_session(session_id, org_id))


# ── Step 2: Team Setup ─────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/employee-source")
async def set_employee_source(
    session_id: str,
    req: EmployeeSourceRequest,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 2)
    get_supabase().table("onboarding_sessions").update(
        {"employee_source": req.source, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", session_id).eq("organisation_id", org_id).execute()
    return {"ok": True}


@router.post("/sessions/{session_id}/upload-employees", response_model=CSVImportResult)
async def upload_employee_csv(
    session_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_admin),
):
    """Upload CSV/XLSX, validate rows, AI-map roles."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
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

    for idx, row in df.iterrows():
        line = idx + 2  # human-readable row number

        # Build full_name
        if mapped.get("full_name") and pd.notna(row.get(mapped["full_name"], "")):
            full_name = str(row[mapped["full_name"]]).strip()
        elif mapped.get("first_name") and mapped.get("last_name"):
            fn = str(row.get(mapped["first_name"], "")).strip()
            ln = str(row.get(mapped["last_name"], "")).strip()
            full_name = f"{fn} {ln}".strip()
        else:
            errors.append({"row": line, "error": "Missing name columns"})
            continue

        email_col = mapped.get("email")
        email = str(row[email_col]).strip().lower() if email_col and pd.notna(row.get(email_col, "")) else ""
        if not email or "@" not in email:
            errors.append({"row": line, "error": f"Invalid or missing email for {full_name}"})
            continue

        position = ""
        if mapped.get("position") and pd.notna(row.get(mapped["position"], "")):
            position = str(row[mapped["position"]]).strip()

        department = ""
        if mapped.get("department") and pd.notna(row.get(mapped["department"], "")):
            department = str(row[mapped["department"]]).strip()

        location_name = ""
        if mapped.get("location") and pd.notna(row.get(mapped["location"], "")):
            location_name = str(row[mapped["location"]]).strip()

        reports_to = ""
        if mapped.get("reports_to") and pd.notna(row.get(mapped["reports_to"], "")):
            reports_to = str(row[mapped["reports_to"]]).strip()

        valid_employees.append({
            "full_name": full_name,
            "email": email,
            "phone": str(row.get(mapped["phone"] or "", "")).strip() if mapped.get("phone") else None,
            "position": position,
            "department": department,
            "location_name": location_name,
            "reports_to": reports_to or None,
        })

    # AI role mapping for unique positions
    sb = get_supabase()
    job_res = sb.table("employee_import_jobs").insert({
        "session_id": session_id,
        "source_type": "csv",
        "status": "processing",
        "total_records": len(valid_employees) + len(errors),
        "failed_records": len(errors),
        "error_log": errors,
    }).execute()
    job_id = job_res.data[0]["id"]

    # Run AI role mapping for unique position+department combos
    if valid_employees:
        unique_combos = {}
        for emp in valid_employees:
            key = (emp["position"], emp["department"])
            if key not in unique_combos:
                unique_combos[key] = 0
            unique_combos[key] += 1

        mappings = await _map_roles_with_ai(session_id, unique_combos, org_id)
        role_map = {(m["source_title"], m.get("source_department", "")): m["retail_role"] for m in mappings}

        # Insert employees
        to_insert = []
        for emp in valid_employees:
            role_key = (emp["position"], emp["department"])
            retail_role = role_map.get(role_key, "staff")
            to_insert.append({
                "session_id": session_id,
                "full_name": emp["full_name"],
                "email": emp["email"],
                "phone": emp.get("phone"),
                "position": emp["position"],
                "department": emp["department"],
                "location_name": emp["location_name"],
                "reports_to": emp.get("reports_to"),
                "retail_role": retail_role,
                "status": "pending",
            })

        if to_insert:
            sb.table("onboarding_employees").insert(to_insert).execute()

        # Update job
        sb.table("employee_import_jobs").update({
            "status": "completed" if not errors else "partial",
            "processed_records": len(valid_employees),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()

    return CSVImportResult(
        total_rows=len(valid_employees) + len(errors),
        valid_rows=len(valid_employees),
        error_rows=len(errors),
        errors=errors,
        import_job_id=job_id,
    )


async def _map_roles_with_ai(session_id: str, combos: dict, org_id: str) -> list[dict]:
    """AI role mapping for unique position+department combos."""
    client = _get_anthropic()
    sb = get_supabase()

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
    # Fetch existing row IDs first, insert new rows, then delete the old ones
    # only after the insert succeeds — so a failed insert never leaves the
    # session with zero mappings.
    existing_rows = sb.table("role_mappings").select("id").eq("session_id", session_id).eq("organisation_id", org_id).execute()
    old_ids = [r["id"] for r in (existing_rows.data or [])]

    to_insert = []
    for m in mappings:
        count = combos.get((m.get("source_title", ""), m.get("source_department", "")), 1)
        to_insert.append({
            "session_id": session_id,
            "organisation_id": org_id,
            "source_title": m.get("source_title", ""),
            "source_department": m.get("source_department"),
            "retail_role": m.get("retail_role", "staff"),
            "confidence_score": float(m.get("confidence", 0.5)),
            "is_confirmed": False,
            "employee_count": count,
        })
    if to_insert:
        sb.table("role_mappings").insert(to_insert).execute()
        # Insert succeeded — now safe to remove the previous mappings
        if old_ids:
            sb.table("role_mappings").delete().eq("organisation_id", org_id).in_("id", old_ids).execute()

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
    current_user: dict = Depends(require_admin),
):
    """Manually add a single employee during onboarding."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 2)
    sb = get_supabase()
    res = sb.table("onboarding_employees").insert({
        "session_id": session_id,
        "full_name": employee.full_name,
        "email": employee.email,
        "phone": employee.phone,
        "position": employee.position,
        "department": employee.department,
        "retail_role": employee.retail_role,
        "location_name": employee.location_name,
        "reports_to": getattr(employee, "reports_to", None),
        "status": "pending",
    }).execute()
    return res.data[0]


@router.get("/sessions/{session_id}/employees")
async def list_employees(session_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    res = get_supabase().table("onboarding_employees").select("*").eq("session_id", session_id).order("created_at").execute()
    return {"employees": res.data, "total": len(res.data)}


@router.delete("/sessions/{session_id}/employees/{employee_id}")
async def delete_employee(
    session_id: str,
    employee_id: str,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    get_supabase().table("onboarding_employees").update({"is_deleted": True}).eq("id", employee_id).eq("session_id", session_id).execute()
    return {"ok": True}


@router.post("/sessions/{session_id}/invite-link", response_model=InviteResult)
async def generate_invite_link(
    session_id: str,
    config: InviteConfig,
    current_user: dict = Depends(require_admin),
):
    """Generate invite URL + base64 QR code."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 2)

    token = secrets.token_urlsafe(24)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=config.expiry_hours)).isoformat()
    invite_url = f"https://app.sprout.ph/join/{token}?role={config.default_role}"
    get_supabase().table("onboarding_sessions").update({
        "invite_token_hash": token_hash,
        "invite_token_expires_at": expires_at,
        "invite_default_role": config.default_role,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", session_id).eq("organisation_id", org_id).execute()

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
async def get_role_mappings(session_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    res = get_supabase().table("role_mappings").select("*").eq("session_id", session_id).order("employee_count", desc=True).execute()
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
        for r in res.data
    ]


@router.patch("/sessions/{session_id}/role-mappings/{mapping_id}")
async def update_role_mapping(
    session_id: str,
    mapping_id: str,
    update: RoleMappingUpdate,
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    get_supabase().table("role_mappings").update({
        "retail_role": update.retail_role,
        "is_confirmed": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", mapping_id).eq("session_id", session_id).execute()
    return {"ok": True}


@router.post("/sessions/{session_id}/confirm-employees", response_model=OnboardingSessionResponse)
async def confirm_employees(session_id: str, current_user: dict = Depends(require_admin)):
    """Confirm employee setup. Advance to step 3 (Shift Settings)."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 2)
    _advance_step(session_id, 3)
    return _session_to_response(_get_session(session_id, org_id))


# ── Step 1: Locations (part of Company step) ──────────────────────────────────


@router.get("/sessions/{session_id}/suggest-locations")
async def suggest_locations(session_id: str, current_user: dict = Depends(require_admin)):
    """AI extracts real branch/location names from the company website, or generates plausible ones as fallback."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
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
        # Normalise — ensure every item has name and address keys
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
    current_user: dict = Depends(require_admin),
):
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 2)
    sb = get_supabase()
    res = sb.table("onboarding_locations").insert({
        "session_id": session_id,
        "name": loc.name,
        "address": loc.address,
    }).execute()
    row = res.data[0]
    return OnboardingLocation(id=row["id"], name=row["name"], address=row.get("address"))


@router.get("/sessions/{session_id}/locations")
async def list_locations(session_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    res = get_supabase().table("onboarding_locations").select("*").eq("session_id", session_id).execute()
    return res.data


@router.delete("/sessions/{session_id}/locations/{loc_id}", status_code=204)
async def delete_location(session_id: str, loc_id: str, current_user: dict = Depends(require_admin)):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    get_supabase().table("onboarding_locations").delete().eq("id", loc_id).eq("session_id", session_id).execute()


@router.post("/sessions/{session_id}/confirm-locations", response_model=OnboardingSessionResponse)
async def confirm_locations(session_id: str, current_user: dict = Depends(require_admin)):
    """Confirm locations (part of Company & Locations step). No step advance."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 2)
    # Locations are confirmed as part of Step 1; no step advance needed here.
    return _session_to_response(_get_session(session_id, org_id))


# ── Steps 4–5: Assets & Vendors ───────────────────────────────────────────────


@router.get("/sessions/{session_id}/suggest-assets")
async def suggest_assets(session_id: str, current_user: dict = Depends(require_admin)):
    """AI suggests equipment/assets based on industry and location count."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 4)

    industry = INDUSTRY_DISPLAY.get(session.get("industry_code", ""), session.get("industry_code", "retail"))
    loc_res = get_supabase().table("onboarding_locations").select("name").eq("session_id", session_id).execute()
    locations = [r["name"] for r in loc_res.data] or ["Main Branch"]

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
async def add_asset(session_id: str, asset: OnboardingAsset, current_user: dict = Depends(require_admin)):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    sb = get_supabase()
    res = sb.table("onboarding_assets").insert({
        "session_id": session_id,
        "name": asset.name,
        "category": asset.category,
        "model": asset.model,
        "manufacturer": asset.manufacturer,
        "location_name": asset.location_name,
    }).execute()
    row = res.data[0]
    return OnboardingAsset(**{k: row.get(k) for k in ["id", "name", "category", "model", "manufacturer", "location_name"]})


@router.get("/sessions/{session_id}/assets")
async def list_assets(session_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    res = get_supabase().table("onboarding_assets").select("*").eq("session_id", session_id).execute()
    return res.data


@router.delete("/sessions/{session_id}/assets/{asset_id}", status_code=204)
async def delete_asset(session_id: str, asset_id: str, current_user: dict = Depends(require_admin)):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    get_supabase().table("onboarding_assets").delete().eq("id", asset_id).eq("session_id", session_id).execute()


@router.post("/sessions/{session_id}/vendors", response_model=OnboardingVendor)
async def add_vendor(session_id: str, vendor: OnboardingVendor, current_user: dict = Depends(require_admin)):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    sb = get_supabase()
    res = sb.table("onboarding_vendors").insert({
        "session_id": session_id,
        "name": vendor.name,
        "service_type": vendor.service_type,
        "contact_email": vendor.contact_email,
        "contact_phone": vendor.contact_phone,
    }).execute()
    row = res.data[0]
    return OnboardingVendor(**{k: row.get(k) for k in ["id", "name", "service_type", "contact_email", "contact_phone"]})


@router.get("/sessions/{session_id}/vendors")
async def list_vendors(session_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    res = get_supabase().table("onboarding_vendors").select("*").eq("session_id", session_id).execute()
    return res.data


@router.delete("/sessions/{session_id}/vendors/{vendor_id}", status_code=204)
async def delete_vendor(session_id: str, vendor_id: str, current_user: dict = Depends(require_admin)):
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    get_supabase().table("onboarding_vendors").delete().eq("id", vendor_id).eq("session_id", session_id).execute()


@router.post("/sessions/{session_id}/confirm-assets", response_model=OnboardingSessionResponse)
async def confirm_assets(session_id: str, current_user: dict = Depends(require_admin)):
    """Confirm assets (or skip). Advance to step 5 (Vendors)."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 4)
    _advance_step(session_id, 5)
    return _session_to_response(_get_session(session_id, org_id))


@router.post("/sessions/{session_id}/confirm-vendors", response_model=OnboardingSessionResponse)
async def confirm_vendors(session_id: str, current_user: dict = Depends(require_admin)):
    """Confirm vendors (or skip). Advance to step 6 (Shift Settings)."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 5)
    _advance_step(session_id, 6)
    return _session_to_response(_get_session(session_id, org_id))


@router.post("/sessions/{session_id}/confirm-shift-settings", response_model=OnboardingSessionResponse)
async def confirm_shift_settings(session_id: str, current_user: dict = Depends(require_admin)):
    """Confirm shift settings (or skip). Advance to step 4 (Assets)."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 3)
    _advance_step(session_id, 4)
    return _session_to_response(_get_session(session_id, org_id))


# ── Step 7: Workspace Preview ──────────────────────────────────────────────────

@router.get("/sessions/{session_id}/preview", response_model=WorkspacePreview)
async def get_workspace_preview(session_id: str, current_user: dict = Depends(get_current_user)):
    """Aggregate all onboarding data into a preview (read-only)."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 7)
    sb = get_supabase()

    # Fetch selected templates with content
    selected_res = sb.table("onboarding_selections").select(
        "is_selected, customizations, template_items(*)"
    ).eq("session_id", session_id).eq("is_selected", True).execute()

    by_cat: dict[str, list] = {}
    for row in selected_res.data:
        item = row.get("template_items") or {}
        cat = item.get("category", "")
        content = item.get("content", {})
        if row.get("customizations"):
            content = {**content, **row["customizations"]}
        entry = {"id": item.get("id"), "name": item.get("name"), "description": item.get("description"), **content}
        by_cat.setdefault(cat, []).append(entry)

    # Employees
    emp_res = sb.table("onboarding_employees").select("*").eq("session_id", session_id).execute()
    by_role: dict[str, int] = {}
    for e in emp_res.data:
        r = e.get("retail_role", "staff")
        by_role[r] = by_role.get(r, 0) + 1

    role_res = sb.table("role_mappings").select("*").eq("session_id", session_id).eq("is_confirmed", False).execute()
    pending_review = len([r for r in role_res.data if r["confidence_score"] < 0.7])

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
        total_selected=len(selected_res.data),
        total_available=len(selected_res.data),
    )

    loc_res = sb.table("onboarding_locations").select("*").eq("session_id", session_id).execute()
    asset_res = sb.table("onboarding_assets").select("*").eq("session_id", session_id).execute()
    vendor_res = sb.table("onboarding_vendors").select("*").eq("session_id", session_id).execute()

    return WorkspacePreview(
        summary=summary,
        locations=loc_res.data,
        assets=asset_res.data,
        vendors=vendor_res.data,
        forms_and_checklists=by_cat.get("form", []) + by_cat.get("checklist", []) + by_cat.get("audit", []),
        issue_categories=by_cat.get("issue_category", []),
        workflows=by_cat.get("workflow", []),
        training_modules=by_cat.get("training_module", []),
        shift_templates=by_cat.get("shift_template", []),
        repair_manuals=by_cat.get("repair_manual", []),
        employees={"total": len(emp_res.data), "by_role": by_role, "pending_review": pending_review},
        company_name=session.get("company_name"),
        brand_color=session.get("brand_color"),
        logo_url=session.get("logo_url"),
    )


@router.patch("/sessions/{session_id}/preview/template/{template_id}")
async def edit_template_inline(
    session_id: str,
    template_id: str,
    updates: dict,
    current_user: dict = Depends(require_admin),
):
    """Inline edit template customizations during preview."""
    org_id = _get_org_id(current_user)
    _get_session(session_id, org_id)
    get_supabase().table("onboarding_selections").update(
        {"customizations": updates}
    ).eq("session_id", session_id).eq("template_id", template_id).execute()
    return {"ok": True}


@router.post("/sessions/{session_id}/confirm-preview", response_model=OnboardingSessionResponse)
async def confirm_preview(session_id: str, current_user: dict = Depends(require_admin)):
    """Advance to step 8."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 7)
    _advance_step(session_id, 8)
    return _session_to_response(_get_session(session_id, org_id))


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
    """Background task: create live workspace entities from onboarding selections."""
    sb = get_supabase()
    completed_steps = []

    def _update_progress(step: str, percent: int):
        sb.table("onboarding_sessions").update({
            "launch_progress": {
                "status": "provisioning",
                "current_step": step,
                "progress_percent": percent,
                "steps_completed": completed_steps,
                "steps_remaining": [s for s in LAUNCH_STEPS if s not in completed_steps],
            },
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", session_id).eq("organisation_id", org_id).execute()

    try:
        # Clean up any previously partially-provisioned records so re-runs are idempotent
        # Delete children first (no-cascade FKs), then parents
        for tbl in ["workflow_stages", "course_modules"]:
            # These don't have organisation_id — delete via parent join
            pass  # handled by parent delete below via Supabase cascade on form_sections/fields
        # workflow_stages: join through workflow_definitions
        wf_ids = [r["id"] for r in (sb.table("workflow_definitions").select("id").eq("organisation_id", org_id).execute().data or [])]
        if wf_ids:
            sb.table("workflow_stages").delete().in_("workflow_definition_id", wf_ids).execute()
            sb.table("workflow_routing_rules").delete().in_("workflow_definition_id", wf_ids).execute()
        # course_modules + slides + quiz questions: join through courses
        course_ids = [r["id"] for r in (sb.table("courses").select("id").eq("organisation_id", org_id).execute().data or [])]
        if course_ids:
            mod_ids = [r["id"] for r in (sb.table("course_modules").select("id").in_("course_id", course_ids).execute().data or [])]
            if mod_ids:
                sb.table("course_slides").delete().in_("module_id", mod_ids).execute()
                sb.table("quiz_questions").delete().in_("module_id", mod_ids).execute()
            sb.table("course_modules").delete().in_("course_id", course_ids).execute()
        # Delete children that RESTRICT form_templates deletion (form_sections CASCADE, so skip)
        ft_ids = [r["id"] for r in (sb.table("form_templates").select("id").eq("organisation_id", org_id).execute().data or [])]
        if ft_ids:
            sb.table("form_assignments").delete().in_("form_template_id", ft_ids).execute()
            sb.table("audit_configs").delete().in_("form_template_id", ft_ids).execute()
            sb.table("form_submissions").delete().in_("form_template_id", ft_ids).execute()
        # Order matters: delete children before parents (FK constraints)
        for tbl in [
            "repair_guides", "courses",
            "assets", "vendors",          # reference locations
            "shift_templates",            # cascades from locations but be explicit
            "workflow_definitions",       # references form_templates
            "issue_categories",
            "form_templates",
            "badge_configs",
            "locations",
        ]:
            sb.table(tbl).delete().eq("organisation_id", org_id).execute()

        session = sb.table("onboarding_sessions").select("*").eq("id", session_id).execute().data[0]
        industry = INDUSTRY_DISPLAY.get(session.get("industry_code", ""), session.get("industry_code", "retail"))

        # Stamp industry_code on the organisation so AI endpoints can use it post-onboarding
        if session.get("industry_code"):
            sb.table("organisations").update({
                "industry_code": session["industry_code"],
            }).eq("id", org_id).execute()

        # Fetch all selected templates
        selected_res = sb.table("onboarding_selections").select(
            "customizations, template_items(*)"
        ).eq("session_id", session_id).eq("is_selected", True).execute()

        by_cat: dict[str, list] = {}
        for row in selected_res.data:
            item = row.get("template_items") or {}
            cat = item.get("category", "")
            content = {**(item.get("content") or {}), **(row.get("customizations") or {})}
            by_cat.setdefault(cat, []).append({"name": item.get("name"), "content": content})

        total = len(LAUNCH_STEPS)

        # Step 1: Locations
        _update_progress("Creating locations", int(1 / total * 100))
        onb_locs = sb.table("onboarding_locations").select("*").eq("session_id", session_id).execute().data
        location_id_map: dict[str, str] = {}  # name → real location id
        first_location_id: str | None = None
        for loc in onb_locs:
            res = sb.table("locations").insert({
                "organisation_id": org_id,
                "name": loc["name"],
                "address": loc.get("address"),
                "is_active": True,
                "is_deleted": False,
            }).execute()
            real_id = res.data[0]["id"]
            location_id_map[loc["name"]] = real_id
            if first_location_id is None:
                first_location_id = real_id
        completed_steps.append("Creating locations")

        # Step 2: Assets
        _update_progress("Registering assets", int(2 / total * 100))
        onb_assets = sb.table("onboarding_assets").select("*").eq("session_id", session_id).execute().data
        real_assets = []
        for asset in onb_assets:
            loc_id = location_id_map.get(asset.get("location_name", "")) or first_location_id
            if not loc_id:
                continue  # skip if no locations were added
            res = sb.table("assets").insert({
                "organisation_id": org_id,
                "location_id": loc_id,
                "name": asset["name"],
                "category": asset["category"],
                "model": asset.get("model") or "",
                "manufacturer": asset.get("manufacturer") or "",
                "is_deleted": False,
            }).execute()
            real_assets.append(res.data[0])
        completed_steps.append("Registering assets")

        # Step 3: Vendors
        _update_progress("Setting up vendors", int(3 / total * 100))
        onb_vendors = sb.table("onboarding_vendors").select("*").eq("session_id", session_id).execute().data
        for vendor in onb_vendors:
            sb.table("vendors").insert({
                "organisation_id": org_id,
                "name": vendor["name"],
                "contact_email": vendor.get("contact_email"),
                "contact_phone": vendor.get("contact_phone"),
                "is_active": True,
                "is_deleted": False,
            }).execute()
        completed_steps.append("Setting up vendors")

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
            row: dict = {
                "organisation_id": org_id,
                "title": item["name"] or "Untitled Form",
                "description": c.get("description", ""),
                "type": form_type,
                "is_active": True,
                "is_deleted": False,
            }
            if created_by:
                row["created_by"] = created_by
            else:
                continue
            tmpl_res = sb.table("form_templates").insert(row).execute()
            tmpl_id = tmpl_res.data[0]["id"]
            form_name_to_id[item["name"]] = tmpl_id

            # Create sections + fields
            for s_order, section in enumerate(c.get("sections") or []):
                sec_res = sb.table("form_sections").insert({
                    "form_template_id": tmpl_id,
                    "title": section.get("title", f"Section {s_order + 1}"),
                    "display_order": s_order,
                }).execute()
                sec_id = sec_res.data[0]["id"]
                for f_order, field in enumerate(section.get("fields") or []):
                    raw_ftype = field.get("type", "text")
                    ftype = _FIELD_TYPE_MAP.get(raw_ftype, raw_ftype if raw_ftype in _VALID_FIELD_TYPES else "text")
                    sb.table("form_fields").insert({
                        "section_id": sec_id,
                        "label": field.get("label", f"Field {f_order + 1}"),
                        "field_type": ftype,
                        "is_required": bool(field.get("required", False)),
                        "display_order": f_order,
                        "is_critical": bool(field.get("is_critical", False)),
                    }).execute()

            # For audits: create audit_config with passing score
            if form_type == "audit":
                scoring = c.get("scoring") or {}
                passing = scoring.get("passing_threshold") or scoring.get("passing_score") or 80
                sb.table("audit_configs").insert({
                    "form_template_id": tmpl_id,
                    "passing_score": int(passing),
                }).execute()
        # Create a daily form_assignment for the Daily Store Opening Checklist
        daily_checklist_id = form_name_to_id.get("Daily Store Opening Checklist")
        if daily_checklist_id:
            sb.table("form_assignments").insert({
                "form_template_id": daily_checklist_id,
                "organisation_id": org_id,
                "recurrence": "daily",
                "due_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
                "is_active": True,
                "is_deleted": False,
            }).execute()

        completed_steps.append("Creating forms & checklists")
        _update_progress("Setting up issue categories", 20)

        # Step 2: Issue Categories
        for item in by_cat.get("issue_category", []):
            c = item["content"]
            sb.table("issue_categories").insert({
                "organisation_id": org_id,
                "name": c.get("category_name", item["name"]) or item["name"] or "Uncategorised",
                "description": c.get("description", ""),
                "default_priority": c.get("default_priority", "medium"),
                "sla_hours": c.get("sla_hours"),
                "icon": c.get("icon", ""),
            }).execute()
        completed_steps.append("Setting up issue categories")
        _update_progress("Configuring workflows", 35)

        # Build category name → id lookup for trigger_issue_category_ref resolution
        cat_name_to_id: dict[str, str] = {}
        for cat_row in (sb.table("issue_categories").select("id, name").eq("organisation_id", org_id).execute().data or []):
            cat_name_to_id[cat_row["name"]] = cat_row["id"]

        # Step 3: Workflows — definitions + stages
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

            wf_insert: dict = {
                "organisation_id": org_id,
                "name": c.get("workflow_name", item["name"]) or item["name"] or "Untitled Workflow",
                "trigger_type": trigger_type,
                "trigger_config": trigger,
                "is_active": False,
            }
            if trigger_conditions:
                wf_insert["trigger_conditions"] = trigger_conditions
            if trigger_issue_category_id:
                wf_insert["trigger_issue_category_id"] = trigger_issue_category_id

            wf_res = sb.table("workflow_definitions").insert(wf_insert).execute()
            wf_id = wf_res.data[0]["id"]

            stages = c.get("stages") or []
            for s_order, stage in enumerate(stages):
                raw_action = stage.get("type", "notify")
                action_type = _STAGE_ACTION_MAP.get(raw_action, raw_action if raw_action in _VALID_ACTION_TYPES else "notify")
                raw_role = stage.get("target_role") or stage.get("assign_to_role") or stage.get("assigned_role")
                assigned_role = raw_role if raw_role in _VALID_ROLES else None

                # Resolve form_ref to form_template_id for fill_form stages
                resolved_form_id = form_name_to_id.get(stage["form_ref"]) if action_type == "fill_form" and stage.get("form_ref") else None

                stage_row: dict = {
                    "workflow_definition_id": wf_id,
                    "name": stage.get("name") or stage.get("title") or f"Step {s_order + 1}",
                    "stage_order": s_order,
                    "action_type": action_type,
                    "is_final": bool(stage.get("is_final", s_order == len(stages) - 1)),
                    "config": {k: v for k, v in stage.items() if k not in _STAGE_EXCLUDE_KEYS},
                }
                if assigned_role:
                    stage_row["assigned_role"] = assigned_role
                if resolved_form_id:
                    stage_row["form_template_id"] = resolved_form_id
                if stage.get("sla_hours") or stage.get("due_hours"):
                    stage_row["sla_hours"] = stage.get("sla_hours") or stage.get("due_hours")
                sb.table("workflow_stages").insert(stage_row).execute()
        completed_steps.append("Configuring workflows")
        _update_progress("Importing training modules", 50)

        # Step 4: Training modules → courses + course_modules + AI content (parallel)
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
            course_row: dict = {
                "organisation_id": org_id,
                "created_by": created_by,
                "title": c.get("module_name", item["name"]) or item["name"] or "Untitled Course",
                "description": c.get("description", ""),
                "passing_score": int(c.get("passing_score", 80)),
                "is_mandatory": bool(c.get("auto_assign_on_hire", False)),
                "target_roles": c.get("target_roles", []),
                "estimated_duration_mins": c.get("estimated_minutes"),
                "is_published": False,
                "is_active": True,
                "is_deleted": False,
                "ai_generated": True,
            }
            if c.get("renewal_days"):
                course_row["cert_validity_days"] = int(c["renewal_days"])
            course_res = sb.table("courses").insert(course_row).execute()
            course_id = course_res.data[0]["id"]
            course_title = course_row["title"]

            module_records: list[dict] = []
            for m_order, section in enumerate(c.get("sections") or []):
                mtype = _MODULE_TYPE_MAP.get(section.get("content_type", "slides"), "slides")
                mod_res = sb.table("course_modules").insert({
                    "course_id": course_id,
                    "title": section.get("title", f"Module {m_order + 1}"),
                    "module_type": mtype,
                    "display_order": m_order,
                    "is_required": True,
                    "estimated_duration_mins": c.get("estimated_minutes"),
                }).execute()
                module_records.append({
                    "id": mod_res.data[0]["id"],
                    "title": section.get("title", f"Module {m_order + 1}"),
                    "type": mtype,
                })
            pending_ai.append({"course_title": course_title, "module_records": module_records})

        # Phase 4b: Fire all AI content calls in parallel
        async def _generate_course_content(course_title: str, module_records: list[dict]) -> tuple[str, list]:
            module_outline = [{"title": m["title"], "type": m["type"]} for m in module_records]
            client = _get_anthropic()
            def _call():
                return client.messages.create(
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
        slide_rows: list[dict] = []
        quiz_rows: list[dict] = []
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
                        slide_rows.append({
                            "module_id": mod["id"],
                            "title": slide.get("title", f"Slide {s_order + 1}"),
                            "body": slide.get("body") or slide.get("content") or slide.get("text") or slide.get("description") or "",
                            "display_order": s_order,
                        })
                else:
                    for q_order, q in enumerate(mod_content.get("questions") or []):
                        qtype = q.get("question_type", "multiple_choice")
                        if qtype not in ("multiple_choice", "true_false", "image_based"):
                            qtype = "multiple_choice"
                        quiz_rows.append({
                            "module_id": mod["id"],
                            "question": q.get("question", "Question"),
                            "question_type": qtype,
                            "options": q.get("options", []),
                            "explanation": q.get("explanation", ""),
                            "display_order": q_order,
                        })
        if slide_rows:
            sb.table("course_slides").insert(slide_rows).execute()
        if quiz_rows:
            sb.table("quiz_questions").insert(quiz_rows).execute()

        completed_steps.append("Importing training modules")
        _update_progress("Creating shift templates", 65)

        # Step 5: Shift templates
        for item in by_cat.get("shift_template", []):
            c = item["content"]
            start = c.get("start_time") or c.get("start") or "08:00"
            end   = c.get("end_time")   or c.get("end")   or "17:00"
            days  = _normalize_days(c.get("days_of_week") or c.get("days"))
            if not created_by:
                continue
            sb.table("shift_templates").insert({
                "organisation_id": org_id,
                "name": c.get("shift_name", item["name"]) or item["name"] or "Untitled Shift",
                "role": c.get("role", ""),
                "start_time": start,
                "end_time": end,
                "days_of_week": days,
                "is_active": True,
                "created_by": created_by,
            }).execute()
        completed_steps.append("Creating shift templates")
        _update_progress("Loading repair manuals", 73)

        # Step 9: Repair manuals — asset-specific if assets exist, else generic
        _VALID_GUIDE_TYPES = {"pdf", "video", "audio", "text"}
        if real_assets:
            # Generate asset-specific repair guides via AI
            asset_summary = [
                {"name": a["name"], "category": a["category"], "model": a.get("model") or ""}
                for a in real_assets
            ]
            # Deduplicate by category so we don't generate 10 guides for 10 fridges
            seen_cats: set[str] = set()
            unique_assets = []
            for a in asset_summary:
                key = f"{a['category']}:{a['name']}"
                if key not in seen_cats:
                    seen_cats.add(key)
                    unique_assets.append(a)

            try:
                client = _get_anthropic()
                def _repair_call():
                    return client.messages.create(
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
                    sb.table("repair_guides").insert({
                        "organisation_id": org_id,
                        "title": g.get("title", "Maintenance Guide"),
                        "guide_type": "text",
                        "content": g.get("content", ""),
                        "is_deleted": False,
                    }).execute()
            except Exception:
                pass  # don't fail provisioning if AI guide generation fails
        else:
            # Fall back to template-based generic guides
            for item in by_cat.get("repair_manual", []):
                c = item["content"]
                guide_type = c.get("guide_type", "text")
                if guide_type not in _VALID_GUIDE_TYPES:
                    guide_type = "text"
                sb.table("repair_guides").insert({
                    "organisation_id": org_id,
                    "title": c.get("title", item["name"]) or item["name"] or "Untitled Guide",
                    "guide_type": guide_type,
                    "content": c.get("content", c.get("steps", "")),
                    "is_deleted": False,
                }).execute()
        completed_steps.append("Loading repair manuals")

        # Step 10: Badges — use package templates when available, else AI
        _update_progress("Setting up badges", 88)
        valid_criteria = {
            "issues_reported", "issues_resolved", "checklists_completed",
            "checklist_streak_days", "training_completed", "attendance_streak_days",
            "tasks_completed", "manual",
        }
        try:
            badge_templates = by_cat.get("badge", [])
            if badge_templates:
                badge_rows = []
                for item in badge_templates:
                    c = item.get("content", {})
                    criteria = c.get("criteria_type", "manual")
                    if criteria not in valid_criteria:
                        criteria = "manual"
                    badge_rows.append({
                        "organisation_id": org_id,
                        "name": c.get("badge_name", item.get("name", "Badge")),
                        "description": c.get("description", ""),
                        "points_awarded": int(c.get("points_awarded", 50)),
                        "criteria_type": criteria,
                    })
                if badge_rows:
                    sb.table("badge_configs").insert(badge_rows).execute()
            else:
                client = _get_anthropic()
                def _badge_call():
                    return client.messages.create(
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
                badge_rows = []
                for b in badges:
                    criteria = b.get("criteria_type", "manual")
                    if criteria not in valid_criteria:
                        criteria = "manual"
                    badge_rows.append({
                        "organisation_id": org_id,
                        "name": b.get("name", "Badge"),
                        "description": b.get("description", ""),
                        "points_awarded": int(b.get("points", 50)),
                        "criteria_type": criteria,
                    })
                if badge_rows:
                    sb.table("badge_configs").insert(badge_rows).execute()
        except Exception:
            pass  # don't fail provisioning if badge generation fails
        completed_steps.append("Setting up badges")

        # Step 11: Create employee accounts (auth users + profiles)
        _update_progress("Activating employee accounts", 85)
        emp_res = sb.table("onboarding_employees").select("*").eq("session_id", session_id).execute()
        role_map = {"admin": "admin", "manager": "manager", "staff": "staff"}
        for emp in emp_res.data:
            email = emp.get("email", "").strip()
            if not email:
                continue
            full_name = emp.get("full_name", email)
            role = role_map.get(emp.get("retail_role", "staff"), "staff")
            location_name = emp.get("location_name")
            loc_id = location_id_map.get(location_name) if location_name else None

            # 1. Create auth user; if the email already exists (re-provision),
            #    fall back to finding the existing user's ID via admin list.
            new_user_id = None
            try:
                auth_resp = sb.auth.admin.create_user({
                    "email": email,
                    "email_confirm": True,
                    "app_metadata": {"organisation_id": org_id, "role": role},
                    "user_metadata": {"full_name": full_name},
                })
                new_user_id = str(auth_resp.user.id)
            except Exception:
                # Auth user likely already exists — find them by email
                try:
                    users_resp = sb.auth.admin.list_users()
                    user_list = getattr(users_resp, "users", users_resp) or []
                    for u in user_list:
                        if getattr(u, "email", None) == email:
                            new_user_id = str(u.id)
                            break
                except Exception:
                    pass

            if not new_user_id:
                continue

            # 2. Upsert profile so re-provisioning never fails on duplicate id.
            profile_data = {
                "id": new_user_id,
                "organisation_id": org_id,
                "full_name": full_name,
                "role": role,
                "language": "en",
                "is_active": True,
                "is_deleted": False,
            }
            if loc_id:
                profile_data["location_id"] = loc_id
            if emp.get("phone"):
                profile_data["phone_number"] = emp["phone"]
            if emp.get("position"):
                profile_data["position"] = emp["position"]

            try:
                sb.table("profiles").upsert(profile_data, on_conflict="id").execute()
                sb.table("onboarding_employees").update({"status": "invited"}).eq("id", emp["id"]).execute()
            except Exception:
                pass
        completed_steps.append("Activating employee accounts")

        # Step 8-9: Permissions + finalize
        _update_progress("Applying permissions", 93)
        completed_steps.append("Applying permissions")
        _update_progress("Finalizing workspace", 99)
        completed_steps.append("Finalizing workspace")

        # Mark session complete
        sb.table("onboarding_sessions").update({
            "status": "completed",
            "current_step": 8,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "launch_progress": {
                "status": "completed",
                "progress_percent": 100,
                "steps_completed": completed_steps,
                "steps_remaining": [],
            },
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", session_id).eq("organisation_id", org_id).execute()

    except Exception as e:
        sb.table("onboarding_sessions").update({
            "launch_progress": {
                "status": "failed",
                "error": str(e),
                "steps_completed": completed_steps,
                "steps_remaining": [s for s in LAUNCH_STEPS if s not in completed_steps],
            },
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", session_id).eq("organisation_id", org_id).execute()


@router.post("/sessions/{session_id}/launch")
async def launch_workspace(
    session_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_admin),
):
    """Kick off workspace provisioning as a background task."""
    org_id = _get_org_id(current_user)
    session = _get_session(session_id, org_id)
    _require_step(session, 7)

    existing_progress = session.get("launch_progress") or {}
    if session.get("status") == "completed":
        raise HTTPException(status_code=400, detail="This workspace has already been launched.")
    if existing_progress.get("status") == "provisioning":
        # Allow re-launch if the progress hasn't been updated in the last 10 minutes
        # (handles server restarts killing the background task mid-provisioning)
        updated_at_str = session.get("updated_at") or ""
        try:
            updated_at = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
            is_stale = datetime.now(timezone.utc) - updated_at > timedelta(minutes=10)
        except (ValueError, TypeError):
            is_stale = True
        if not is_stale:
            raise HTTPException(status_code=400, detail="Workspace provisioning is already in progress.")

    # Set initial progress
    get_supabase().table("onboarding_sessions").update({
        "launch_progress": {
            "status": "provisioning",
            "progress_percent": 0,
            "current_step": "Starting...",
            "steps_completed": [],
            "steps_remaining": LAUNCH_STEPS,
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", session_id).eq("organisation_id", org_id).execute()

    user_id = current_user.get("sub", "")
    background_tasks.add_task(_provision_workspace, session_id, org_id, user_id)
    return {"ok": True, "message": "Workspace provisioning started."}


@router.get("/sessions/{session_id}/launch-progress", response_model=LaunchProgress)
async def get_launch_progress(session_id: str, current_user: dict = Depends(get_current_user)):
    # Look up by session_id alone to avoid false 404s caused by JWT token refresh
    # changing app_metadata.organisation_id between the createSession call and polling.
    sb = get_supabase()
    res = sb.table("onboarding_sessions").select("*").eq("id", session_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Onboarding session not found.")
    session = res.data[0]
    # Verify ownership — check that the authenticated user belongs to the session's org.
    # We query the profiles table directly instead of comparing cached org_id values,
    # because the JWT's app_metadata can be stale (e.g. after multiple demo-start runs
    # that create new orgs) causing false 403s even for the legitimate session owner.
    user_id = current_user.get("sub")
    session_org_id = session.get("organisation_id")
    if user_id and session_org_id:
        _sb = get_supabase()
        membership = (
            _sb.table("profiles")
            .select("id")
            .eq("id", user_id)
            .eq("organisation_id", session_org_id)
            .eq("is_deleted", False)
            .maybe_single()
            .execute()
        )
        if not membership.data:
            raise HTTPException(status_code=403, detail="Access denied.")
    progress = session.get("launch_progress") or {}

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
    current_user: dict = Depends(get_current_user),
):
    """Return template items for the authenticated org's industry package.

    Falls back to QSR if the org has no industry_code or the package isn't seeded.
    Optionally filter by ``category`` (e.g. badge, workflow, form, checklist).
    """
    sb = get_supabase()

    # 1. Infer industry_code from the org
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    industry_code: Optional[str] = None
    if org_id:
        org_res = (
            sb.table("organisations")
            .select("industry_code")
            .eq("id", org_id)
            .maybe_single()
            .execute()
        )
        if org_res.data:
            industry_code = (org_res.data.get("industry_code") or "").strip() or None

    # 2. Find the matching package — fallback to QSR
    def _find_package(code: str):
        res = (
            sb.table("industry_packages")
            .select("id")
            .eq("industry_code", code)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else None

    pkg = _find_package(industry_code) if industry_code else None
    if not pkg:
        pkg = _find_package("qsr")
        industry_code = "qsr" if pkg else None

    if not pkg:
        return {"items": [], "industry_code": industry_code}

    # 3. Fetch items (optionally filtered by category)
    q = (
        sb.table("template_items")
        .select("id, name, description, category, content, sort_order")
        .eq("package_id", pkg["id"])
    )
    if category:
        q = q.eq("category", category)
    items_res = q.order("sort_order").execute()

    return {
        "items": items_res.data or [],
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
