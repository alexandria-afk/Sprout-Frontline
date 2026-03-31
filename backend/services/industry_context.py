"""
Shared helper: build an industry-specific context string to prepend to
AI system prompts so Claude generates vertically-appropriate content.

Usage:
    from services.industry_context import get_industry_context
    system = get_industry_context(org_id) + BASE_SYSTEM_PROMPT
"""

from services.supabase_client import get_supabase

_INDUSTRY_LABELS: dict[str, str] = {
    "qsr":                    "Quick Service Restaurant (QSR) / Fast Food",
    "casual_dining":          "Casual Dining Restaurant",
    "full_service_restaurant":"Full-Service / Fine Dining Restaurant",
    "cafe_bar":               "Cafe & Bar",
    "bakery":                 "Bakery & Pastry Shop",
    "retail_fashion":         "Fashion & Specialty Retail",
    "retail_grocery":         "Grocery & Supermarket",
    "retail_convenience":     "Convenience Store",
    "hospitality":            "Hospitality — Hotels & Resorts",
    "healthcare_clinic":      "Healthcare — Clinics & Outpatient",
    "manufacturing":          "Manufacturing",
    "logistics_warehouse":    "Logistics & Warehousing",
    "logistics":              "Logistics & Warehousing",
}


def get_industry_context(org_id: str | None) -> str:
    """Return an industry context string to prepend to AI system prompts.

    Fetches industry_code from the organisations table for the given org_id.
    Returns an empty string if the org has no industry_code or on any error,
    so callers never need to handle failure.
    """
    if not org_id:
        return ""
    try:
        res = (
            get_supabase()
            .table("organisations")
            .select("industry_code")
            .eq("id", org_id)
            .maybe_single()
            .execute()
        )
        if not res.data:
            return ""
        code = (res.data.get("industry_code") or "").strip()
        if not code:
            return ""
        label = _INDUSTRY_LABELS.get(code, code)
        return (
            f"This organisation operates in the {label} industry. "
            f"Generate content specific to this vertical. "
            f"Use terminology, standards, equipment names, and operational "
            f"examples relevant to {label} operations. "
            f"Do not use generic examples from other industries.\n\n"
        )
    except Exception:
        return ""
