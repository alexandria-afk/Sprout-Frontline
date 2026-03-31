"""
Seed script: F&B Industry Packages
Covers: casual_dining, full_service_restaurant, cafe_bar, bakery

Run from backend/ directory:
  python scripts/seed_fb_packages.py

Safe to re-run: upserts on (industry_code, version).
Allowed values: see docs/ALLOWED_VALUES.md
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.supabase_client import get_supabase


# ── FORMS ─────────────────────────────────────────────────────────────────────

FB_FORM_FOOD_COST_WASTE = {
    "name": "Food Cost & Waste Tracking Form",
    "description": "Daily per-item tracking of quantities prepared, sold, and wasted. Supports food cost percentage calculation.",
    "category": "form",
    "is_recommended": True,
    "sort_order": 1,
    "content": {
        "type": "form",
        "title": "Food Cost & Waste Tracking Form",
        "description": "Track food cost and waste by item per meal period",
        "sections": [
            {
                "title": "Shift Details",
                "fields": [
                    {"type": "datetime", "label": "Date", "required": True},
                    {"type": "dropdown", "label": "Meal Period", "required": True,
                     "options": ["Breakfast", "Brunch", "Lunch", "Dinner", "Late Night"]},
                    {"type": "text", "label": "Completed By", "required": True},
                ],
            },
            {
                "title": "Item Entry",
                "fields": [
                    {"type": "text", "label": "Item Name", "required": True},
                    {"type": "number", "label": "Quantity Prepared", "required": True},
                    {"type": "number", "label": "Quantity Sold", "required": True},
                    {"type": "number", "label": "Quantity Wasted", "required": True},
                    {"type": "dropdown", "label": "Waste Reason", "required": False,
                     "options": ["Overproduction", "Spoilage", "Plate waste", "Prep error", "Expired", "Staff meal", "Other"]},
                    {"type": "number", "label": "Estimated Waste Cost (PHP)", "required": False},
                    {"type": "text", "label": "Notes", "required": False},
                ],
            },
        ],
        "requires_signature": False,
        "requires_photo": False,
    },
}

FB_FORM_RESERVATION_COVERS = {
    "name": "Reservation & Covers Log",
    "description": "Daily log of reservations, walk-ins, no-shows, and total covers per meal period. Tracks no-show rate.",
    "category": "form",
    "is_recommended": True,
    "sort_order": 2,
    "content": {
        "type": "form",
        "title": "Reservation & Covers Log",
        "description": "Log reservations and covers by meal period",
        "sections": [
            {
                "title": "Covers Summary",
                "fields": [
                    {"type": "datetime", "label": "Date", "required": True},
                    {"type": "dropdown", "label": "Meal Period", "required": True,
                     "options": ["Breakfast", "Brunch", "Lunch", "Dinner"]},
                    {"type": "number", "label": "Total Reservations", "required": True},
                    {"type": "number", "label": "Walk-Ins", "required": True},
                    {"type": "number", "label": "No-Shows", "required": True},
                    {"type": "number", "label": "Total Covers", "required": True},
                    {"type": "number", "label": "Average Party Size", "required": False},
                    {"type": "number", "label": "Average Wait Time (minutes)", "required": False},
                    {"type": "number", "label": "Turned Away Count", "required": False},
                    {"type": "text", "label": "Special Events or Notes", "required": False},
                ],
            },
        ],
        "requires_signature": False,
        "requires_photo": False,
    },
}

FB_FORM_FOH_HANDOVER = {
    "name": "FOH Shift Handover Form",
    "description": "Front-of-house handover between outgoing and incoming shift leads. Covers covers, reservations, VIP guests, 86 list, and open issues.",
    "category": "form",
    "is_recommended": True,
    "sort_order": 3,
    "content": {
        "type": "form",
        "title": "FOH Shift Handover Form",
        "description": "Handover between outgoing and incoming FOH shift leads",
        "sections": [
            {
                "title": "Shift Handover",
                "fields": [
                    {"type": "text", "label": "Outgoing Shift Lead", "required": True},
                    {"type": "text", "label": "Incoming Shift Lead", "required": True},
                    {"type": "number", "label": "Current Covers in House", "required": False},
                    {"type": "number", "label": "Pending Reservations (next 2 hours)", "required": False},
                    {"type": "textarea", "label": "VIP Guests & Special Notes", "required": False},
                    {"type": "textarea", "label": "86 List — Items Out of Stock", "required": False},
                    {"type": "textarea", "label": "Open Issues to Follow Up", "required": False},
                    {"type": "number", "label": "Cash Drawer Count (PHP)", "required": True},
                    {"type": "textarea", "label": "Special Instructions for Incoming Lead", "required": False},
                    {"type": "checkbox", "label": "Both leads acknowledge and agree on handover status", "required": True},
                ],
            },
        ],
        "requires_signature": True,
        "requires_photo": False,
    },
}

FB_FORM_EQUIPMENT_MAINTENANCE = {
    "name": "Equipment Maintenance Log",
    "description": "Log for preventive and corrective maintenance on all venue equipment. Tracks work performed, parts replaced, and next scheduled date.",
    "category": "form",
    "is_recommended": True,
    "sort_order": 4,
    "content": {
        "type": "form",
        "title": "Equipment Maintenance Log",
        "description": "Record all equipment maintenance activities",
        "sections": [
            {
                "title": "Maintenance Record",
                "fields": [
                    {"type": "text", "label": "Equipment Name", "required": True},
                    {"type": "dropdown", "label": "Maintenance Type", "required": True,
                     "options": ["Preventive", "Corrective", "Emergency", "Calibration", "Inspection"]},
                    {"type": "datetime", "label": "Date Performed", "required": True},
                    {"type": "textarea", "label": "Work Performed", "required": True},
                    {"type": "text", "label": "Parts Replaced (if any)", "required": False},
                    {"type": "text", "label": "Technician / Performed By", "required": True},
                    {"type": "datetime", "label": "Next Scheduled Maintenance Date", "required": False},
                    {"type": "number", "label": "Downtime (hours)", "required": False},
                    {"type": "photo", "label": "Photo (before/after)", "required": False},
                ],
            },
        ],
        "requires_signature": False,
        "requires_photo": False,
    },
}

FB_FORM_INVENTORY_BAR = {
    "name": "Inventory Count — Bar",
    "description": "End-of-shift bar inventory count tracking opening stock, received, closing stock, and variance vs POS sales.",
    "category": "form",
    "is_recommended": True,
    "sort_order": 5,
    "content": {
        "type": "form",
        "title": "Inventory Count — Bar",
        "description": "Bar inventory count by category",
        "sections": [
            {
                "title": "Count Details",
                "fields": [
                    {"type": "datetime", "label": "Date", "required": True},
                    {"type": "dropdown", "label": "Shift", "required": True,
                     "options": ["Opening", "Closing", "End of Week"]},
                    {"type": "text", "label": "Counted By", "required": True},
                ],
            },
            {
                "title": "Item Count",
                "fields": [
                    {"type": "dropdown", "label": "Item Category", "required": True,
                     "options": ["Spirits", "Wine", "Beer", "Mixers", "Garnishes", "Non-alcoholic", "Other"]},
                    {"type": "text", "label": "Item Name", "required": True},
                    {"type": "text", "label": "Unit Size", "required": True},
                    {"type": "number", "label": "Opening Stock", "required": True},
                    {"type": "number", "label": "Received During Shift", "required": False},
                    {"type": "number", "label": "Closing Stock", "required": True},
                    {"type": "number", "label": "POS Sales Quantity", "required": False},
                    {"type": "text", "label": "Variance Reason (if any)", "required": False},
                ],
            },
        ],
        "requires_signature": True,
        "requires_photo": False,
    },
}

FB_FORM_INVENTORY_KITCHEN = {
    "name": "Inventory Count — Kitchen",
    "description": "End-of-shift kitchen inventory count tracking consumption against theoretical usage.",
    "category": "form",
    "is_recommended": True,
    "sort_order": 6,
    "content": {
        "type": "form",
        "title": "Inventory Count — Kitchen",
        "description": "Kitchen inventory count by food category",
        "sections": [
            {
                "title": "Count Details",
                "fields": [
                    {"type": "datetime", "label": "Date", "required": True},
                    {"type": "dropdown", "label": "Shift", "required": True,
                     "options": ["Opening", "Closing", "End of Week"]},
                    {"type": "text", "label": "Counted By", "required": True},
                ],
            },
            {
                "title": "Item Count",
                "fields": [
                    {"type": "dropdown", "label": "Item Category", "required": True,
                     "options": ["Protein", "Produce", "Dairy", "Dry Goods", "Frozen", "Sauces & Condiments", "Other"]},
                    {"type": "text", "label": "Item Name", "required": True},
                    {"type": "text", "label": "Unit", "required": True},
                    {"type": "number", "label": "Opening Stock", "required": True},
                    {"type": "number", "label": "Received During Shift", "required": False},
                    {"type": "number", "label": "Closing Stock", "required": True},
                    {"type": "number", "label": "Theoretical Usage", "required": False},
                    {"type": "checkbox", "label": "Storage Condition OK (correct temperature, sealed, labeled)", "required": False},
                ],
            },
        ],
        "requires_signature": False,
        "requires_photo": False,
    },
}

FB_FORM_INCIDENT_REPORT = {
    "name": "Incident Report Form",
    "description": "Document any on-premise incident: staff/customer injuries, food safety breaches, property damage, or security events.",
    "category": "form",
    "is_recommended": True,
    "sort_order": 7,
    "content": {
        "type": "form",
        "title": "Incident Report Form",
        "description": "Report any on-premise incident or near-miss",
        "sections": [
            {
                "title": "Incident Details",
                "fields": [
                    {"type": "dropdown", "label": "Incident Type", "required": True,
                     "options": ["Injury — Staff", "Injury — Customer", "Food Safety", "Property Damage",
                                 "Altercation", "Theft", "Near Miss", "Other"]},
                    {"type": "datetime", "label": "Date & Time of Incident", "required": True},
                    {"type": "text", "label": "Location in Venue", "required": True},
                    {"type": "textarea", "label": "Persons Involved", "required": True},
                    {"type": "textarea", "label": "Description of Incident", "required": True},
                    {"type": "textarea", "label": "Immediate Action Taken", "required": True},
                    {"type": "textarea", "label": "Witness Names (if any)", "required": False},
                    {"type": "photo", "label": "Photo Evidence", "required": False},
                    {"type": "rating", "label": "Severity (1 = Minor, 5 = Critical)", "required": True},
                ],
            },
        ],
        "requires_signature": True,
        "requires_photo": False,
    },
}

# Bakery-specific forms
FB_FORM_PRODUCTION_SCHEDULE = {
    "name": "Production Schedule Form",
    "description": "Track each baked product through its production pipeline: batch size, timing stages, decorator assignment, and quality check.",
    "category": "form",
    "is_recommended": True,
    "sort_order": 8,
    "content": {
        "type": "form",
        "title": "Production Schedule Form",
        "description": "Track product batches through each production stage",
        "sections": [
            {
                "title": "Batch Details",
                "fields": [
                    {"type": "datetime", "label": "Date", "required": True},
                    {"type": "text", "label": "Product Name", "required": True},
                    {"type": "number", "label": "Batch Size (units)", "required": True},
                ],
            },
            {
                "title": "Production Timeline",
                "fields": [
                    {"type": "datetime", "label": "Production Start Time", "required": True},
                    {"type": "number", "label": "Proof Time (minutes)", "required": False},
                    {"type": "number", "label": "Bake Time (minutes)", "required": True},
                    {"type": "number", "label": "Cooling Time (minutes)", "required": True},
                    {"type": "number", "label": "Packaging / Decorating Time (minutes)", "required": False},
                    {"type": "text", "label": "Decorator / Packager Assigned", "required": False},
                    {"type": "checkbox", "label": "Quality Check Passed", "required": True},
                    {"type": "text", "label": "Quality Notes", "required": False},
                ],
            },
        ],
        "requires_signature": False,
        "requires_photo": False,
    },
}

FB_FORM_BAKERY_WASTE_LOG = {
    "name": "Bakery Waste Log",
    "description": "Daily record of products baked, sold, wasted, and eligible for donation.",
    "category": "form",
    "is_recommended": True,
    "sort_order": 9,
    "content": {
        "type": "form",
        "title": "Bakery Waste Log",
        "description": "Daily waste tracking by product",
        "sections": [
            {
                "title": "Waste Entry",
                "fields": [
                    {"type": "datetime", "label": "Date", "required": True},
                    {"type": "text", "label": "Product Name", "required": True},
                    {"type": "number", "label": "Quantity Produced", "required": True},
                    {"type": "number", "label": "Quantity Sold", "required": True},
                    {"type": "number", "label": "Quantity Wasted", "required": True},
                    {"type": "dropdown", "label": "Waste Reason", "required": True,
                     "options": ["Overbaked", "Stale", "Damaged", "Overproduction", "Unsold — end of day", "Other"]},
                    {"type": "checkbox", "label": "Eligible for Donation", "required": False},
                ],
            },
        ],
        "requires_signature": False,
        "requires_photo": False,
    },
}


# ── CHECKLISTS ────────────────────────────────────────────────────────────────

_FOH_OPENING_BAR_SECTION = {
    "title": "Bar Readiness",
    "fields": [
        {"type": "checkbox", "label": "Bar fully stocked and organised", "required": True},
        {"type": "checkbox", "label": "Garnishes prepped and stored correctly", "required": True},
        {"type": "checkbox", "label": "Ice bins filled to service level", "required": True},
        {"type": "checkbox", "label": "Draft beer lines checked — no off flavours", "required": True},
        {"type": "checkbox", "label": "Glass washer cycle tested", "required": True},
    ],
}

_FOH_CLOSING_BAR_SECTION = {
    "title": "Bar Close",
    "fields": [
        {"type": "checkbox", "label": "Bar surface wiped down and sanitized", "required": True},
        {"type": "checkbox", "label": "All bottles sealed and stored", "required": True},
        {"type": "checkbox", "label": "Draft beer lines flushed", "required": True},
        {"type": "checkbox", "label": "Garnishes disposed of (daily perishables)", "required": True},
        {"type": "checkbox", "label": "Ice bins emptied and cleaned", "required": True},
    ],
}


def _make_foh_opening(include_bar: bool) -> dict:
    sections = [
        {
            "title": "Dining Room Setup",
            "fields": [
                {"type": "checkbox", "label": "Tables set per layout plan (cloth, cutlery, glassware)", "required": True},
                {"type": "checkbox", "label": "Glassware polished and streak-free", "required": True},
                {"type": "checkbox", "label": "Menus clean, current, and no missing pages", "required": True},
                {"type": "checkbox", "label": "Condiments and table items stocked", "required": True},
            ],
        },
        {
            "title": "Ambiance",
            "fields": [
                {"type": "checkbox", "label": "Background music playing at correct volume", "required": True},
                {"type": "checkbox", "label": "Lighting set to correct level for service", "required": True},
                {"type": "checkbox", "label": "Temperature comfortable for dining", "required": True},
            ],
        },
        {
            "title": "Service Readiness",
            "fields": [
                {"type": "checkbox", "label": "POS terminals powered on and logged in", "required": True},
                {"type": "checkbox", "label": "Reservation list printed / confirmed on system", "required": True},
                {"type": "checkbox", "label": "Specials board updated with today's menu", "required": True},
                {"type": "checkbox", "label": "Host stand ready — seating chart current", "required": True},
            ],
        },
        {
            "title": "Restrooms",
            "fields": [
                {"type": "checkbox", "label": "Restrooms cleaned and no odours", "required": True},
                {"type": "checkbox", "label": "Soap, paper towels, and toilet paper fully stocked", "required": True},
                {"type": "checkbox", "label": "All fixtures functional", "required": True},
            ],
        },
    ]
    if include_bar:
        sections.insert(3, _FOH_OPENING_BAR_SECTION)
    return {
        "name": "FOH Opening Checklist",
        "description": "Complete before first guests arrive. Covers dining room, ambiance, service readiness, bar setup, and restrooms.",
        "category": "checklist",
        "is_recommended": True,
        "sort_order": 8,
        "content": {
            "type": "checklist",
            "title": "FOH Opening Checklist",
            "description": "Front-of-house opening tasks before first guests",
            "sections": sections,
            "requires_signature": True,
            "requires_photo": False,
        },
    }


def _make_foh_closing(include_bar: bool) -> dict:
    sections = [
        {
            "title": "Dining Room",
            "fields": [
                {"type": "checkbox", "label": "All tables cleared and reset for next service", "required": True},
                {"type": "checkbox", "label": "Floors swept and mopped", "required": True},
                {"type": "checkbox", "label": "Chairs aligned or stacked per closing procedure", "required": True},
                {"type": "checkbox", "label": "Lost and found items logged", "required": True},
            ],
        },
        {
            "title": "Cash & POS",
            "fields": [
                {"type": "checkbox", "label": "Cash drawer reconciled against POS", "required": True},
                {"type": "checkbox", "label": "Tips logged and distributed per policy", "required": True},
                {"type": "checkbox", "label": "End-of-day reports run and filed", "required": True},
            ],
        },
        {
            "title": "Security",
            "fields": [
                {"type": "checkbox", "label": "All exterior doors locked and deadbolted", "required": True},
                {"type": "checkbox", "label": "Lights off in all closed areas", "required": True},
                {"type": "checkbox", "label": "Alarm set", "required": True},
                {"type": "checkbox", "label": "Reservation book / system updated for tomorrow", "required": True},
            ],
        },
    ]
    if include_bar:
        sections.insert(1, _FOH_CLOSING_BAR_SECTION)
    return {
        "name": "FOH Closing Checklist",
        "description": "Complete before locking up. Covers dining room, bar close, cash reconciliation, and security.",
        "category": "checklist",
        "is_recommended": True,
        "sort_order": 10,
        "content": {
            "type": "checklist",
            "title": "FOH Closing Checklist",
            "description": "Front-of-house closing tasks before lock-up",
            "sections": sections,
            "requires_signature": True,
            "requires_photo": False,
        },
    }


FB_CHECKLIST_FOH_OPENING = _make_foh_opening(include_bar=True)
FB_CHECKLIST_FOH_OPENING_BAKERY = _make_foh_opening(include_bar=False)
FB_CHECKLIST_FOH_CLOSING = _make_foh_closing(include_bar=True)
FB_CHECKLIST_FOH_CLOSING_BAKERY = _make_foh_closing(include_bar=False)

FB_CHECKLIST_BOH_OPENING = {
    "name": "BOH Opening Checklist",
    "description": "Back-of-house opening checks: cold storage temps, mise en place, equipment startup, safety, and incoming deliveries.",
    "category": "checklist",
    "is_recommended": True,
    "sort_order": 9,
    "content": {
        "type": "checklist",
        "title": "BOH Opening Checklist",
        "description": "Back-of-house opening checks before service",
        "sections": [
            {
                "title": "Cold Storage",
                "fields": [
                    {"type": "number", "label": "Walk-in cooler temperature (°C)", "required": True},
                    {"type": "number", "label": "Walk-in freezer temperature (°C)", "required": True},
                    {"type": "checkbox", "label": "Walk-in organised and FIFO applied", "required": True},
                    {"type": "checkbox", "label": "All items labeled and dated", "required": True},
                ],
            },
            {
                "title": "Prep & Mise en Place",
                "fields": [
                    {"type": "checkbox", "label": "Prep list reviewed and assigned to stations", "required": True},
                    {"type": "checkbox", "label": "Mise en place started per par levels", "required": True},
                    {"type": "checkbox", "label": "Allergen board updated with today's menu changes", "required": True},
                ],
            },
            {
                "title": "Equipment Startup",
                "fields": [
                    {"type": "checkbox", "label": "Ovens powered on and reaching temperature", "required": True},
                    {"type": "checkbox", "label": "Grill powered on and cleaned", "required": True},
                    {"type": "checkbox", "label": "Fryers or range burners on and at temperature", "required": True},
                    {"type": "checkbox", "label": "Dishwasher sanitizer checked and cycle run", "required": True},
                    {"type": "checkbox", "label": "Exhaust hood and ventilation on", "required": True},
                ],
            },
            {
                "title": "Safety",
                "fields": [
                    {"type": "checkbox", "label": "First aid kit accessible and stocked", "required": True},
                    {"type": "checkbox", "label": "Fire extinguisher in place and pressure OK", "required": True},
                    {"type": "checkbox", "label": "All staff in correct uniform and grooming standard", "required": True},
                    {"type": "checkbox", "label": "Handwashing stations stocked with soap and paper towels", "required": True},
                ],
            },
            {
                "title": "Deliveries",
                "fields": [
                    {"type": "checkbox", "label": "Delivery schedule reviewed for today", "required": True},
                    {"type": "checkbox", "label": "Receiving area clear and scales available", "required": True},
                ],
            },
        ],
        "requires_signature": True,
        "requires_photo": False,
    },
}

FB_CHECKLIST_BOH_CLOSING = {
    "name": "BOH Closing Checklist",
    "description": "Back-of-house closing tasks: food storage, deep cleaning, equipment shutdown, waste logging, and next-day prep.",
    "category": "checklist",
    "is_recommended": True,
    "sort_order": 11,
    "content": {
        "type": "checklist",
        "title": "BOH Closing Checklist",
        "description": "Back-of-house closing and sanitation tasks",
        "sections": [
            {
                "title": "Food Storage",
                "fields": [
                    {"type": "checkbox", "label": "All food labeled, dated, and stored correctly", "required": True},
                    {"type": "checkbox", "label": "Walk-in FIFO applied — oldest items to front", "required": True},
                    {"type": "checkbox", "label": "No uncovered items in cold storage", "required": True},
                ],
            },
            {
                "title": "Cleaning & Sanitation",
                "fields": [
                    {"type": "checkbox", "label": "All prep surfaces degreased and sanitized", "required": True},
                    {"type": "checkbox", "label": "Grill, fryer, and range cleaned and cooled", "required": True},
                    {"type": "checkbox", "label": "Grease traps checked and not overflowing", "required": True},
                    {"type": "checkbox", "label": "Floors cleaned and drains clear", "required": True},
                    {"type": "checkbox", "label": "Dishwasher cleaned and empty", "required": True},
                ],
            },
            {
                "title": "Shutdown",
                "fields": [
                    {"type": "checkbox", "label": "Gas lines turned off (range, grill, oven)", "required": True},
                    {"type": "checkbox", "label": "Exhaust hood off", "required": True},
                    {"type": "checkbox", "label": "All non-essential lighting off", "required": True},
                ],
            },
            {
                "title": "Prep & Waste",
                "fields": [
                    {"type": "checkbox", "label": "Food waste weighed and logged", "required": True},
                    {"type": "checkbox", "label": "Waste disposed in correct bins", "required": True},
                    {"type": "checkbox", "label": "Prep list for tomorrow posted at stations", "required": True},
                ],
            },
        ],
        "requires_signature": True,
        "requires_photo": False,
    },
}

FB_CHECKLIST_TEMP_MONITORING = {
    "name": "Temperature Monitoring Checklist",
    "description": "Record temperatures for all refrigeration and holding units at the start and end of each service. Flags out-of-range readings.",
    "category": "checklist",
    "is_recommended": True,
    "sort_order": 12,
    "content": {
        "type": "checklist",
        "title": "Temperature Monitoring Checklist",
        "description": "Log temperatures for all cold storage and hot holding units",
        "sections": [
            {
                "title": "Cold Storage Units",
                "fields": [
                    {"type": "number", "label": "Walk-in Cooler (°C) — target: 0–4°C", "required": True},
                    {"type": "number", "label": "Walk-in Freezer (°C) — target: -18°C or below", "required": True},
                    {"type": "number", "label": "Prep Fridge (°C) — target: 0–4°C", "required": True},
                    {"type": "number", "label": "Bar/Display Fridge (°C) — target: 0–5°C", "required": False},
                ],
            },
            {
                "title": "Hot Holding",
                "fields": [
                    {"type": "number", "label": "Hot Holding Station 1 (°C) — target: 60°C+", "required": False},
                    {"type": "number", "label": "Hot Holding Station 2 (°C) — target: 60°C+", "required": False},
                ],
            },
            {
                "title": "Corrective Action",
                "fields": [
                    {"type": "checkbox", "label": "All readings within acceptable range", "required": True},
                    {"type": "textarea", "label": "Corrective action taken for any out-of-range unit", "required": False},
                    {"type": "text", "label": "Checked by", "required": True},
                ],
            },
        ],
        "requires_signature": False,
        "requires_photo": False,
    },
}

FB_CHECKLIST_ALLERGEN_CHECK = {
    "name": "Allergen & Dietary Compliance Check",
    "description": "Monthly review and on-menu-change audit confirming allergen labeling, kitchen segregation, and staff knowledge.",
    "category": "checklist",
    "is_recommended": True,
    "sort_order": 13,
    "content": {
        "type": "checklist",
        "title": "Allergen & Dietary Compliance Check",
        "description": "Monthly allergen review and on-menu-change audit",
        "sections": [
            {
                "title": "Allergen Information",
                "fields": [
                    {"type": "checkbox", "label": "All 14 major allergens listed on menus or available on request", "required": True},
                    {"type": "checkbox", "label": "Allergen menu available in print and digital format", "required": True},
                    {"type": "checkbox", "label": "Menu changes reviewed for allergen impact within 48 hours", "required": True},
                ],
            },
            {
                "title": "Kitchen Procedures",
                "fields": [
                    {"type": "checkbox", "label": "Dedicated allergen-free prep area or protocol in place", "required": True},
                    {"type": "checkbox", "label": "Color-coded utensils used for allergen-free preparation", "required": True},
                    {"type": "checkbox", "label": "Separate frying oil available for gluten/nut-free orders", "required": True},
                    {"type": "checkbox", "label": "All staff can identify dishes containing each major allergen", "required": True},
                ],
            },
            {
                "title": "Guest Communication",
                "fields": [
                    {"type": "checkbox", "label": "FOH staff trained to ask about allergies proactively", "required": True},
                    {"type": "checkbox", "label": "Communication chain practiced: guest → server → kitchen → server → guest", "required": True},
                    {"type": "checkbox", "label": "Staff know never to guess — always confirm with kitchen", "required": True},
                ],
            },
        ],
        "requires_signature": True,
        "requires_photo": False,
    },
}


# ── AUDITS ────────────────────────────────────────────────────────────────────

def _make_table_service_audit(include_wine_pairing: bool) -> dict:
    menu_knowledge_fields = [
        {"type": "pass_fail", "label": "Specials explained clearly and accurately", "required": True},
        {"type": "pass_fail", "label": "Allergens communicated proactively for specials", "required": True},
    ]
    if include_wine_pairing:
        menu_knowledge_fields.append(
            {"type": "pass_fail", "label": "Wine pairing offered or suggested for main courses", "required": True}
        )
    name = "Table Service Quality Audit — Fine Dining" if include_wine_pairing else "Table Service Quality Audit"
    return {
        "name": name,
        "description": "Scored audit of FOH service quality covering greeting, order-taking, food delivery, complaint handling, and bar service.",
        "category": "audit",
        "is_recommended": True,
        "sort_order": 14,
        "content": {
            "type": "audit",
            "title": name,
            "description": "Mystery diner or manager observation audit of table service standards",
            "sections": [
                {
                    "title": "Greeting & Seating",
                    "weight": 15,
                    "fields": [
                        {"type": "pass_fail", "label": "Guests greeted within 1 minute of arrival", "required": True},
                        {"type": "pass_fail", "label": "Seated promptly or wait time communicated honestly", "required": True},
                        {"type": "pass_fail", "label": "Menus presented and specials mentioned at seating", "required": True},
                    ],
                },
                {
                    "title": "Menu Knowledge",
                    "weight": 15,
                    "fields": menu_knowledge_fields,
                },
                {
                    "title": "Order Process",
                    "weight": 15,
                    "fields": [
                        {"type": "pass_fail", "label": "Order taken without rushing guests", "required": True},
                        {"type": "pass_fail", "label": "Upsell attempted (appetizer, dessert, drinks) without pressure", "required": True},
                        {"type": "pass_fail", "label": "Order repeated back to confirm accuracy", "required": True},
                    ],
                },
                {
                    "title": "Food Delivery",
                    "weight": 20,
                    "fields": [
                        {"type": "pass_fail", "label": "Appetizers delivered within 15 minutes of order", "required": True},
                        {"type": "pass_fail", "label": "Main courses delivered within 25 minutes", "required": True},
                        {"type": "pass_fail", "label": "Correct dishes delivered to correct seats", "required": True},
                        {"type": "pass_fail", "label": "2-bite check-back performed", "required": True},
                    ],
                },
                {
                    "title": "Bill & Farewell",
                    "weight": 10,
                    "fields": [
                        {"type": "pass_fail", "label": "Bill presented promptly when requested", "required": True},
                        {"type": "pass_fail", "label": "Payment processed quickly and correctly", "required": True},
                        {"type": "pass_fail", "label": "Genuine farewell and invitation to return", "required": True},
                    ],
                },
                {
                    "title": "Environment",
                    "weight": 10,
                    "fields": [
                        {"type": "pass_fail", "label": "Table cleanliness maintained throughout meal", "required": True},
                        {"type": "pass_fail", "label": "Noise and lighting level appropriate", "required": True},
                        {"type": "pass_fail", "label": "Restrooms clean and stocked (spot check)", "required": True},
                    ],
                },
                {
                    "title": "Bar Service",
                    "weight": 15,
                    "fields": [
                        {"type": "pass_fail", "label": "Drinks poured accurately and consistently", "required": True},
                        {"type": "pass_fail", "label": "Bar service speed acceptable — no excessive queue", "required": True},
                        {"type": "pass_fail", "label": "Drink presentation meets standard", "required": True},
                        {"type": "pass_fail", "label": "Responsible service observed — intoxication signs monitored", "required": True},
                    ],
                },
            ],
            "scoring": {
                "type": "weighted_pass_fail",
                "passing_threshold": 75,
            },
            "requires_signature": True,
            "requires_photo": False,
        },
    }


FB_AUDIT_TABLE_SERVICE = _make_table_service_audit(include_wine_pairing=False)
FB_AUDIT_TABLE_SERVICE_FINE = _make_table_service_audit(include_wine_pairing=True)

FB_AUDIT_KITCHEN_HYGIENE = {
    "name": "Kitchen Hygiene & Food Safety Audit",
    "description": "Scored audit covering temperature compliance, personal hygiene, cross-contamination, cleaning standards, and pest control.",
    "category": "audit",
    "is_recommended": True,
    "sort_order": 15,
    "content": {
        "type": "audit",
        "title": "Kitchen Hygiene & Food Safety Audit",
        "description": "Monthly food safety and hygiene compliance audit",
        "sections": [
            {
                "title": "Temperature Compliance",
                "weight": 25,
                "fields": [
                    {"type": "pass_fail", "label": "Cold storage ≤ 4°C verified with probe thermometer", "required": True},
                    {"type": "pass_fail", "label": "Hot holding food maintained at ≥ 60°C", "required": True},
                    {"type": "pass_fail", "label": "Cooking temperatures met for all proteins (logged)", "required": True},
                    {"type": "pass_fail", "label": "Probe thermometer calibrated within last 3 months", "required": True},
                ],
            },
            {
                "title": "Personal Hygiene",
                "weight": 20,
                "fields": [
                    {"type": "pass_fail", "label": "Staff handwashing technique and frequency correct", "required": True},
                    {"type": "pass_fail", "label": "Gloves used correctly — changed between tasks", "required": True},
                    {"type": "pass_fail", "label": "Hair nets / hats worn by all food handlers", "required": True},
                    {"type": "pass_fail", "label": "Clean uniforms — no excessive jewelry", "required": True},
                ],
            },
            {
                "title": "Cross-Contamination Prevention",
                "weight": 20,
                "fields": [
                    {"type": "pass_fail", "label": "Color-coded cutting boards used correctly", "required": True},
                    {"type": "pass_fail", "label": "Raw proteins stored below cooked/ready-to-eat items", "required": True},
                    {"type": "pass_fail", "label": "Allergen prep procedures followed", "required": True},
                    {"type": "pass_fail", "label": "Utensils cleaned and sanitized between tasks", "required": True},
                ],
            },
            {
                "title": "Cleaning & Chemical Storage",
                "weight": 20,
                "fields": [
                    {"type": "pass_fail", "label": "All prep surfaces sanitized on schedule", "required": True},
                    {"type": "pass_fail", "label": "Equipment cleaning schedule followed and logged", "required": True},
                    {"type": "pass_fail", "label": "Cleaning chemicals stored separately from food areas", "required": True},
                    {"type": "pass_fail", "label": "All chemical containers labeled", "required": True},
                ],
            },
            {
                "title": "Pest Control",
                "weight": 15,
                "fields": [
                    {"type": "pass_fail", "label": "No signs of pest activity (droppings, damage, sightings)", "required": True},
                    {"type": "pass_fail", "label": "Door seals intact — no gaps or cracks", "required": True},
                    {"type": "pass_fail", "label": "Bait stations in place and undisturbed", "required": True},
                    {"type": "pass_fail", "label": "Waste managed — bins covered and emptied daily", "required": True},
                ],
            },
        ],
        "scoring": {
            "type": "weighted_pass_fail",
            "passing_threshold": 80,
            "critical_items": [
                "Cold storage ≤ 4°C verified with probe thermometer",
                "Hot holding food maintained at ≥ 60°C",
                "No signs of pest activity (droppings, damage, sightings)",
            ],
        },
        "requires_signature": True,
        "requires_photo": True,
    },
}

FB_AUDIT_BAR_OPERATIONS = {
    "name": "Bar Operations Audit",
    "description": "Scored bar audit covering pour accuracy, presentation, speed, hygiene, and responsible alcohol service.",
    "category": "audit",
    "is_recommended": True,
    "sort_order": 16,
    "content": {
        "type": "audit",
        "title": "Bar Operations Audit",
        "description": "Monthly bar performance and compliance audit",
        "sections": [
            {
                "title": "Pour Accuracy",
                "weight": 25,
                "fields": [
                    {"type": "pass_fail", "label": "Jigger used consistently — no free-pouring spirits", "required": True},
                    {"type": "pass_fail", "label": "Wine poured at 150ml standard", "required": True},
                    {"type": "pass_fail", "label": "Cocktail recipes followed accurately", "required": True},
                ],
            },
            {
                "title": "Presentation",
                "weight": 15,
                "fields": [
                    {"type": "pass_fail", "label": "Garnishes fresh and correctly applied", "required": True},
                    {"type": "pass_fail", "label": "Correct glassware used for each drink", "required": True},
                    {"type": "pass_fail", "label": "Consistent presentation across all bartenders", "required": True},
                ],
            },
            {
                "title": "Speed of Service",
                "weight": 15,
                "fields": [
                    {"type": "pass_fail", "label": "Cocktails completed within 3 minutes", "required": True},
                    {"type": "pass_fail", "label": "Beer service within 1 minute", "required": True},
                    {"type": "pass_fail", "label": "No excessive queue at bar during peak", "required": True},
                ],
            },
            {
                "title": "Bar Hygiene",
                "weight": 20,
                "fields": [
                    {"type": "pass_fail", "label": "Bar surface clean and dry during service", "required": True},
                    {"type": "pass_fail", "label": "Bar tools sanitized between uses", "required": True},
                    {"type": "pass_fail", "label": "Ice handled with scoop only — never with glass or hands", "required": True},
                    {"type": "pass_fail", "label": "Glass washer functioning and glasses clean", "required": True},
                ],
            },
            {
                "title": "Responsible Service",
                "weight": 25,
                "fields": [
                    {"type": "pass_fail", "label": "ID checked for all guests appearing under 25", "required": True},
                    {"type": "pass_fail", "label": "Signs of intoxication monitored during service", "required": True},
                    {"type": "pass_fail", "label": "Refusal policy followed and documented", "required": True},
                    {"type": "pass_fail", "label": "Incident documentation up to date", "required": True},
                ],
            },
        ],
        "scoring": {
            "type": "weighted_pass_fail",
            "passing_threshold": 80,
            "critical_items": [
                "ID checked for all guests appearing under 25",
                "Refusal policy followed and documented",
            ],
        },
        "requires_signature": True,
        "requires_photo": False,
    },
}

FB_AUDIT_FACILITY_SAFETY = {
    "name": "Facility Safety Inspection",
    "description": "Monthly facility safety audit covering fire safety, electrical, slip/trip hazards, and first aid readiness.",
    "category": "audit",
    "is_recommended": True,
    "sort_order": 17,
    "content": {
        "type": "audit",
        "title": "Facility Safety Inspection",
        "description": "Monthly safety walkthrough — DOLE and BFP compliance",
        "sections": [
            {
                "title": "Fire Safety",
                "weight": 25,
                "fields": [
                    {"type": "pass_fail", "label": "All fire extinguishers charged and accessible", "required": True},
                    {"type": "pass_fail", "label": "Fire exits unobstructed and clearly marked", "required": True},
                    {"type": "pass_fail", "label": "Kitchen suppression system last serviced within 6 months", "required": True},
                    {"type": "pass_fail", "label": "Evacuation plan posted at entrances and back of house", "required": True},
                ],
            },
            {
                "title": "Electrical",
                "weight": 20,
                "fields": [
                    {"type": "pass_fail", "label": "Electrical panel clear and accessible", "required": True},
                    {"type": "pass_fail", "label": "No exposed or frayed wiring visible", "required": True},
                    {"type": "pass_fail", "label": "GFCI outlets in kitchen and bar functional", "required": True},
                ],
            },
            {
                "title": "Slip, Trip & Fall",
                "weight": 20,
                "fields": [
                    {"type": "pass_fail", "label": "Kitchen and bar floors dry with anti-slip mats in place", "required": True},
                    {"type": "pass_fail", "label": "All areas adequately lit — no burnt bulbs in walkways", "required": True},
                    {"type": "pass_fail", "label": "Stairways and ramps clear and with handrails", "required": True},
                ],
            },
            {
                "title": "First Aid",
                "weight": 15,
                "fields": [
                    {"type": "pass_fail", "label": "First aid kit fully stocked and accessible", "required": True},
                    {"type": "pass_fail", "label": "Emergency contact numbers posted in kitchen and FOH", "required": True},
                    {"type": "pass_fail", "label": "At least one trained first aider on every shift", "required": True},
                ],
            },
            {
                "title": "General Safety",
                "weight": 20,
                "fields": [
                    {"type": "pass_fail", "label": "PPE (gloves, aprons, non-slip shoes) available and used", "required": True},
                    {"type": "pass_fail", "label": "All cleaning chemicals labeled and stored away from food", "required": True},
                    {"type": "pass_fail", "label": "Equipment guards and safety covers in place", "required": True},
                ],
            },
        ],
        "scoring": {
            "type": "weighted_pass_fail",
            "passing_threshold": 85,
            "critical_items": [
                "All fire extinguishers charged and accessible",
                "Fire exits unobstructed and clearly marked",
            ],
        },
        "requires_signature": True,
        "requires_photo": True,
    },
}

# Sub-type specific audits
FB_AUDIT_PLATING_PRESENTATION = {
    "name": "Plating & Presentation Standards Audit",
    "description": "Spot-check audit verifying dishes match photo standards for plating, portion size, garnish, and temperature at service.",
    "category": "audit",
    "is_recommended": True,
    "sort_order": 18,
    "content": {
        "type": "audit",
        "title": "Plating & Presentation Standards Audit",
        "description": "Spot-check of minimum 5 dishes per shift against photo standard",
        "sections": [
            {
                "title": "Dish Presentation Check",
                "weight": 100,
                "fields": [
                    {"type": "text", "label": "Dish Name", "required": True},
                    {"type": "dropdown", "label": "Matches Photo Standard", "required": True,
                     "options": ["Yes", "No", "Partial"]},
                    {"type": "pass_fail", "label": "Portion size correct", "required": True},
                    {"type": "pass_fail", "label": "Garnish correct and fresh", "required": True},
                    {"type": "pass_fail", "label": "Plate rim clean — no smudges or drips", "required": True},
                    {"type": "number", "label": "Temperature at Service (°C)", "required": True},
                    {"type": "rating", "label": "Overall Presentation Score (1–5)", "required": True},
                    {"type": "photo", "label": "Photo of dish", "required": True},
                ],
            },
        ],
        "scoring": {
            "type": "weighted_pass_fail",
            "passing_threshold": 80,
        },
        "requires_signature": True,
        "requires_photo": True,
    },
}

FB_AUDIT_COUNTER_SERVICE = {
    "name": "Counter Service Check",
    "description": "Scored audit for counter/cafe service: greeting, order accuracy, beverage quality, speed, upselling, and cleanliness.",
    "category": "audit",
    "is_recommended": True,
    "sort_order": 14,  # Replaces Table Service in cafe_bar
    "content": {
        "type": "audit",
        "title": "Counter Service Check",
        "description": "Observation audit of counter service quality and standards",
        "sections": [
            {
                "title": "Greeting",
                "weight": 15,
                "fields": [
                    {"type": "pass_fail", "label": "Guest greeted within 30 seconds of approaching counter", "required": True},
                    {"type": "pass_fail", "label": "Friendly, positive tone maintained", "required": True},
                ],
            },
            {
                "title": "Order Accuracy",
                "weight": 25,
                "fields": [
                    {"type": "pass_fail", "label": "Order taken completely and correctly", "required": True},
                    {"type": "pass_fail", "label": "Modifications and special requests noted accurately", "required": True},
                    {"type": "pass_fail", "label": "Order confirmed back to guest", "required": True},
                ],
            },
            {
                "title": "Beverage Quality",
                "weight": 25,
                "fields": [
                    {"type": "pass_fail", "label": "Espresso crema correct — golden and consistent", "required": False},
                    {"type": "pass_fail", "label": "Milk texture correct for drink type (microfoam / stretch)", "required": False},
                    {"type": "pass_fail", "label": "Drink served at correct temperature", "required": True},
                    {"type": "pass_fail", "label": "Correct cup size and presentation", "required": True},
                ],
            },
            {
                "title": "Speed of Service",
                "weight": 20,
                "fields": [
                    {"type": "pass_fail", "label": "Hot beverage ready within 3 minutes of order", "required": True},
                    {"type": "pass_fail", "label": "Food items ready within 5 minutes or wait time communicated", "required": True},
                ],
            },
            {
                "title": "Upselling & Cleanliness",
                "weight": 15,
                "fields": [
                    {"type": "pass_fail", "label": "Upsell or meal deal suggested naturally", "required": True},
                    {"type": "pass_fail", "label": "Counter and display area clean and tidy", "required": True},
                ],
            },
        ],
        "scoring": {
            "type": "weighted_pass_fail",
            "passing_threshold": 75,
        },
        "requires_signature": False,
        "requires_photo": False,
    },
}

FB_AUDIT_DISPLAY_CASE = {
    "name": "Display Case Audit",
    "description": "Daily check of bakery display: labeling, pricing, freshness marking, presentation, temperature (for refrigerated), and stock levels.",
    "category": "audit",
    "is_recommended": True,
    "sort_order": 16,
    "content": {
        "type": "audit",
        "title": "Display Case Audit",
        "description": "Daily display case standards check",
        "sections": [
            {
                "title": "Labeling & Pricing",
                "weight": 25,
                "fields": [
                    {"type": "pass_fail", "label": "All products clearly labeled with name", "required": True},
                    {"type": "pass_fail", "label": "Price visible and correct for each item", "required": True},
                    {"type": "pass_fail", "label": "Allergen information available for each product", "required": True},
                ],
            },
            {
                "title": "Freshness",
                "weight": 30,
                "fields": [
                    {"type": "pass_fail", "label": "Items baked today clearly marked as fresh", "required": True},
                    {"type": "pass_fail", "label": "Day-old items marked and discounted or removed", "required": True},
                    {"type": "pass_fail", "label": "No products past their display window remaining", "required": True},
                ],
            },
            {
                "title": "Presentation & Temperature",
                "weight": 25,
                "fields": [
                    {"type": "pass_fail", "label": "Display arranged neatly — no gaps or jumbled items", "required": True},
                    {"type": "pass_fail", "label": "Refrigerated items at correct temperature (0–5°C)", "required": False},
                    {"type": "pass_fail", "label": "Glass and surfaces clean and fingerprint-free", "required": True},
                ],
            },
            {
                "title": "Stock Level",
                "weight": 20,
                "fields": [
                    {"type": "pass_fail", "label": "Key products adequately stocked for current trading period", "required": True},
                    {"type": "pass_fail", "label": "No empty trays left in display", "required": True},
                ],
            },
        ],
        "scoring": {
            "type": "weighted_pass_fail",
            "passing_threshold": 80,
        },
        "requires_signature": False,
        "requires_photo": True,
    },
}


# ── ISSUE CATEGORIES ──────────────────────────────────────────────────────────

FB_ISSUE_GUEST_COMPLAINT = {
    "name": "Guest Complaint",
    "description": "Guest complaints about food, service, facilities, or their overall experience",
    "category": "issue_category",
    "is_recommended": True,
    "sort_order": 1,
    "content": {
        "category_name": "Guest Complaint",
        "default_priority": "high",
        "sla_hours": 2,
        "auto_route_to": "manager",
        "icon": "message-circle",
        "subcategories": [
            "Long wait — food", "Long wait — table", "Cold food", "Wrong order",
            "Hair in food", "Rude staff", "Billing error", "Noise level",
            "Reservation not honoured", "Allergen concern",
        ],
    },
}

FB_ISSUE_FOOD_QUALITY = {
    "name": "Food Quality Issue",
    "description": "Dish inconsistencies, incorrect cooking, missing components, or wrong plating reported by staff or guests",
    "category": "issue_category",
    "is_recommended": True,
    "sort_order": 2,
    "content": {
        "category_name": "Food Quality Issue",
        "default_priority": "high",
        "sla_hours": 4,
        "auto_route_to": "manager",
        "icon": "utensils",
        "subcategories": [
            "Inconsistent portion", "Undercooked", "Overcooked", "Wrong plating",
            "Missing component", "Stale ingredient", "Temperature wrong",
        ],
    },
}

FB_ISSUE_EQUIPMENT_FAILURE = {
    "name": "Equipment Failure",
    "description": "Broken or malfunctioning equipment in kitchen, FOH, or bar",
    "category": "issue_category",
    "is_recommended": True,
    "sort_order": 3,
    "content": {
        "category_name": "Equipment Failure",
        "default_priority": "high",
        "sla_hours": 4,
        "auto_route_to": "manager",
        "icon": "wrench",
        "subcategories": [
            "Refrigeration failure", "Oven / grill malfunction", "POS terminal down",
            "Dishwasher failure", "HVAC not working", "Espresso machine breakdown",
            "Lighting outage", "Draft beer tap failure",
        ],
    },
}

FB_ISSUE_SUPPLY_SHORTAGE = {
    "name": "Supply Shortage",
    "description": "Out-of-stock or critically low supply of food, beverage, or operational items affecting service",
    "category": "issue_category",
    "is_recommended": True,
    "sort_order": 4,
    "content": {
        "category_name": "Supply Shortage",
        "default_priority": "high",
        "sla_hours": 8,
        "auto_route_to": "manager",
        "icon": "package",
        "subcategories": [
            "Protein out of stock", "Produce shortage", "Dairy shortage",
            "Alcohol shortage", "Dry goods low", "Cleaning supplies low", "Packaging low",
        ],
    },
}

FB_ISSUE_BAR = {
    "name": "Bar Issue",
    "description": "Bar-specific operational issues including over-pouring, inventory variance, tap faults, or responsible service incidents",
    "category": "issue_category",
    "is_recommended": True,
    "sort_order": 5,
    "content": {
        "category_name": "Bar Issue",
        "default_priority": "medium",
        "sla_hours": 24,
        "auto_route_to": "manager",
        "icon": "wine",
        "subcategories": [
            "Over-pouring suspected", "Inventory variance", "Tap malfunction",
            "Breakage", "Supplier bad batch", "Responsible service incident",
        ],
    },
}

FB_ISSUE_STAFF = {
    "name": "Staff Issue",
    "description": "Employee conduct, attendance, safety violations, or interpersonal conflicts requiring management attention",
    "category": "issue_category",
    "is_recommended": True,
    "sort_order": 6,
    "content": {
        "category_name": "Staff Issue",
        "default_priority": "medium",
        "sla_hours": 24,
        "auto_route_to": "admin",
        "icon": "user-x",
        "confidential": True,
        "subcategories": [
            "No-show", "Tardiness", "Uniform violation", "Safety violation",
            "Conduct issue", "Interpersonal conflict",
        ],
    },
}

FB_ISSUE_SECURITY = {
    "name": "Security Incident",
    "description": "Theft, vandalism, unauthorized access, threats, or situations requiring security intervention",
    "category": "issue_category",
    "is_recommended": True,
    "sort_order": 7,
    "content": {
        "category_name": "Security Incident",
        "default_priority": "critical",
        "sla_hours": 1,
        "auto_route_to": "admin",
        "icon": "shield-alert",
        "subcategories": [
            "Theft", "Vandalism", "Unauthorized access", "Threat or intimidation",
            "Intoxicated/aggressive guest",
        ],
    },
}

FB_ISSUE_PEST = {
    "name": "Pest Sighting",
    "description": "Any pest sighting in food preparation, storage, or service areas — immediate action required",
    "category": "issue_category",
    "is_recommended": True,
    "sort_order": 8,
    "content": {
        "category_name": "Pest Sighting",
        "default_priority": "critical",
        "sla_hours": 1,
        "auto_route_to": "admin",
        "icon": "bug",
        "subcategories": [
            "Cockroach", "Rodent", "Flies", "Ants", "Other",
        ],
    },
}

FB_ISSUE_IT = {
    "name": "IT / System Issue",
    "description": "POS, network, printer, reservation system, kitchen display, or CCTV failures",
    "category": "issue_category",
    "is_recommended": True,
    "sort_order": 9,
    "content": {
        "category_name": "IT / System Issue",
        "default_priority": "high",
        "sla_hours": 4,
        "auto_route_to": "manager",
        "icon": "monitor",
        "subcategories": [
            "POS system down", "Network/WiFi failure", "Printer failure",
            "Reservation system down", "Kitchen display down", "CCTV issue",
        ],
    },
}


# ── WORKFLOWS ─────────────────────────────────────────────────────────────────
# Only trigger types: issue_created, employee_created (per ALLOWED_VALUES.md)
# Only action types: fill_form, approve, sign, review, create_task, notify, wait, assign_training

FB_WF_GUEST_COMPLAINT = {
    "name": "Guest Complaint Resolution",
    "description": "Notifies manager, creates a resolution task, documents outcome in the incident form, and routes to admin for review",
    "category": "workflow",
    "is_recommended": True,
    "sort_order": 1,
    "content": {
        "workflow_name": "Guest Complaint Resolution",
        "trigger": {
            "type": "issue_created",
            "issue_category_ref": "Guest Complaint",
        },
        "stages": [
            {
                "type": "notify",
                "name": "Alert Manager",
                "assigned_role": "manager",
                "message": "Guest complaint logged: {issue.title}. Respond within 30 minutes.",
            },
            {
                "type": "create_task",
                "name": "Resolve Guest Complaint",
                "assigned_role": "manager",
                "title": "Resolve guest complaint: {issue.title}",
                "priority": "high",
                "due_hours": 1,
            },
            {
                "type": "review",
                "name": "Admin Review",
                "assigned_role": "admin",
                "is_final": True,
            },
        ],
    },
}

FB_WF_EQUIPMENT_REPAIR = {
    "name": "Equipment Repair Request",
    "description": "Routes equipment failures through manager assessment, maintenance log, and admin sign-off",
    "category": "workflow",
    "is_recommended": True,
    "sort_order": 2,
    "content": {
        "workflow_name": "Equipment Repair Request",
        "trigger": {
            "type": "issue_created",
            "issue_category_ref": "Equipment Failure",
        },
        "stages": [
            {
                "type": "create_task",
                "name": "Assess Equipment Failure",
                "assigned_role": "manager",
                "title": "Assess equipment failure: {issue.title}",
                "priority": "high",
                "due_hours": 4,
            },
            {
                "type": "fill_form",
                "name": "Complete Maintenance Log",
                "assigned_role": "manager",
                "form_ref": "Equipment Maintenance Log",
            },
            {
                "type": "review",
                "name": "Admin Sign-Off",
                "assigned_role": "admin",
                "is_final": True,
            },
        ],
    },
}

FB_WF_ONBOARDING_FOH = {
    "name": "New Hire Onboarding — FOH",
    "description": "Assigns mandatory FOH training to new servers, hosts, and cashiers, waits for completion, then prompts manager to schedule a shadow shift",
    "category": "workflow",
    "is_recommended": True,
    "sort_order": 3,
    "content": {
        "workflow_name": "New Hire Onboarding — FOH",
        "trigger": {
            "type": "employee_created",
            "conditions": {"position": ["Server", "Host", "Cashier", "Service Crew", "Waiter", "Waitress"]},
        },
        "stages": [
            {
                "type": "assign_training",
                "name": "Assign FOH Onboarding Training",
                "assigned_role": "manager",
                "course_refs": [
                    "Guest Service Excellence — Table Service",
                    "POS & Order Management",
                    "Allergen Awareness",
                    "Food Safety for F&B",
                    "Workplace Safety & Emergency Response",
                ],
                "deadline_days": 7,
                "on_deadline_missed": "notify",
            },
            {
                "type": "wait",
                "name": "Wait for Training Completion",
                "condition": "all_courses_passed",
                "timeout_days": 7,
            },
            {
                "type": "notify",
                "name": "Notify Manager — FOH Training Complete",
                "assigned_role": "manager",
                "message": "{employee.name} has completed all FOH onboarding training.",
            },
            {
                "type": "create_task",
                "name": "Schedule Shadow Shift",
                "assigned_role": "manager",
                "title": "Schedule shadow shift for {employee.name}",
                "priority": "medium",
                "deadline_days": 3,
                "is_final": True,
            },
        ],
    },
}

FB_WF_ONBOARDING_BOH = {
    "name": "New Hire Onboarding — BOH",
    "description": "Assigns mandatory kitchen training to cooks, prep staff, and dishwashers, waits for completion, then prompts manager to schedule a shadow shift",
    "category": "workflow",
    "is_recommended": True,
    "sort_order": 4,
    "content": {
        "workflow_name": "New Hire Onboarding — BOH",
        "trigger": {
            "type": "employee_created",
            "conditions": {"position": ["Cook", "Kitchen Crew", "Prep Cook", "Chef", "Sous Chef", "Dishwasher"]},
        },
        "stages": [
            {
                "type": "assign_training",
                "name": "Assign BOH Onboarding Training",
                "assigned_role": "manager",
                "course_refs": [
                    "Food Safety for F&B",
                    "Kitchen Operations & Line Procedures",
                    "Allergen Awareness",
                    "Workplace Safety & Emergency Response",
                ],
                "deadline_days": 7,
                "on_deadline_missed": "notify",
            },
            {
                "type": "wait",
                "name": "Wait for Training Completion",
                "condition": "all_courses_passed",
                "timeout_days": 7,
            },
            {
                "type": "notify",
                "name": "Notify Manager — BOH Training Complete",
                "assigned_role": "manager",
                "message": "{employee.name} has completed all BOH onboarding training.",
            },
            {
                "type": "create_task",
                "name": "Schedule Shadow Shift",
                "assigned_role": "manager",
                "title": "Schedule shadow shift for {employee.name}",
                "priority": "medium",
                "deadline_days": 3,
                "is_final": True,
            },
        ],
    },
}

FB_WF_ONBOARDING_BAR = {
    "name": "New Hire Onboarding — Bar",
    "description": "Assigns bar training to new bartenders and baristas, waits for completion, then prompts manager to schedule a supervised bar shift",
    "category": "workflow",
    "is_recommended": True,
    "sort_order": 5,
    "content": {
        "workflow_name": "New Hire Onboarding — Bar",
        "trigger": {
            "type": "employee_created",
            "conditions": {"position": ["Bartender", "Barback", "Barista"]},
        },
        "stages": [
            {
                "type": "assign_training",
                "name": "Assign Bar Onboarding Training",
                "assigned_role": "manager",
                "course_refs": [
                    "Bar & Beverage Service",
                    "Responsible Alcohol Service",
                    "Food Safety for F&B",
                    "POS & Order Management",
                    "Workplace Safety & Emergency Response",
                ],
                "deadline_days": 7,
                "on_deadline_missed": "notify",
            },
            {
                "type": "wait",
                "name": "Wait for Training Completion",
                "condition": "all_courses_passed",
                "timeout_days": 7,
            },
            {
                "type": "notify",
                "name": "Notify Manager — Bar Training Complete",
                "assigned_role": "manager",
                "message": "{employee.name} has completed all bar onboarding training.",
            },
            {
                "type": "create_task",
                "name": "Schedule Supervised Bar Shift",
                "assigned_role": "manager",
                "title": "Schedule supervised bar shift for {employee.name}",
                "priority": "medium",
                "deadline_days": 3,
                "is_final": True,
            },
        ],
    },
}

# Bakery-specific FOH onboarding (counter service focus, no table service course)
FB_WF_ONBOARDING_FOH_BAKERY = {
    "name": "New Hire Onboarding — Counter Service",
    "description": "Assigns onboarding training to new counter and shop staff, waits for completion, then prompts manager to schedule a supervised shift",
    "category": "workflow",
    "is_recommended": True,
    "sort_order": 3,
    "content": {
        "workflow_name": "New Hire Onboarding — Counter Service",
        "trigger": {
            "type": "employee_created",
            "conditions": {"position": ["Cashier", "Counter Staff", "Service Crew", "Sales Associate"]},
        },
        "stages": [
            {
                "type": "assign_training",
                "name": "Assign Counter Service Onboarding Training",
                "assigned_role": "manager",
                "course_refs": [
                    "Customer Service Excellence — Counter Service",
                    "POS & Order Management",
                    "Allergen Awareness",
                    "Food Safety for F&B",
                    "Workplace Safety & Emergency Response",
                ],
                "deadline_days": 7,
                "on_deadline_missed": "notify",
            },
            {
                "type": "wait",
                "name": "Wait for Training Completion",
                "condition": "all_courses_passed",
                "timeout_days": 7,
            },
            {
                "type": "notify",
                "name": "Notify Manager — Training Complete",
                "assigned_role": "manager",
                "message": "{employee.name} has completed all counter service onboarding training.",
            },
            {
                "type": "create_task",
                "name": "Schedule Supervised Shift",
                "assigned_role": "manager",
                "title": "Schedule supervised counter shift for {employee.name}",
                "priority": "medium",
                "deadline_days": 3,
                "is_final": True,
            },
        ],
    },
}


# ── TRAINING MODULES ──────────────────────────────────────────────────────────
# content_type values: text_with_images → slides, scenario_based → quiz
# passing_score, renewal_days, auto_assign_on_hire, target_roles

FB_TRAINING_GUEST_SERVICE = {
    "name": "Guest Service Excellence — Table Service",
    "description": "End-to-end table service standards: greeting, order-taking, meal timing, complaint handling, and bill/farewell. Covers the LAST complaint recovery method.",
    "category": "training_module",
    "is_recommended": True,
    "sort_order": 1,
    "content": {
        "module_name": "Guest Service Excellence — Table Service",
        "estimated_minutes": 25,
        "auto_assign_on_hire": True,
        "target_roles": ["staff", "manager"],
        "sections": [
            {"title": "Approach & Greeting — reading body language, greeting within 1 minute, seating flow, presenting menus and specials", "content_type": "text_with_images"},
            {"title": "Taking the Order — avoiding rush, noting allergies, suggestive selling (appetizers, wine, dessert) without pressure, repeating orders, POS entry", "content_type": "text_with_images"},
            {"title": "During the Meal — timing courses, 2-bite check-back, reading the table, handling special requests mid-meal", "content_type": "text_with_images"},
            {"title": "Complaint Handling — LAST method (Listen, Apologize, Solve, Thank), when to escalate, comp authorization levels", "content_type": "text_with_images"},
            {"title": "Bill & Farewell — when to present bill, payment processing, split checks, genuine farewell and return invitation", "content_type": "text_with_images"},
            {"title": "Table Service Assessment", "content_type": "scenario_based"},
        ],
        "passing_score": 80,
        "certificate_on_pass": False,
        "renewal_days": 365,
    },
}

# Bakery-specific version (counter service)
FB_TRAINING_COUNTER_SERVICE = {
    "name": "Customer Service Excellence — Counter Service",
    "description": "Counter service standards for bakery and cafe staff: greeting, product knowledge, handling queues, upselling, and complaint recovery.",
    "category": "training_module",
    "is_recommended": True,
    "sort_order": 1,
    "content": {
        "module_name": "Customer Service Excellence — Counter Service",
        "estimated_minutes": 20,
        "auto_assign_on_hire": True,
        "target_roles": ["staff", "manager"],
        "sections": [
            {"title": "Counter Greeting & Queue Management — greeting within 30 seconds, managing busy queues, positive tone, wait time communication", "content_type": "text_with_images"},
            {"title": "Product Knowledge — knowing every product by name, ingredients, and allergens; describing items appetisingly; recommending products", "content_type": "text_with_images"},
            {"title": "Upselling & Add-Ons — suggesting add-ons naturally (beverage with pastry), meal deals, daily specials; what not to say", "content_type": "text_with_images"},
            {"title": "Complaint Handling at the Counter — staying calm, listening fully, LAST method, when to call manager, replacement policy", "content_type": "text_with_images"},
            {"title": "Customer Service Assessment", "content_type": "scenario_based"},
        ],
        "passing_score": 80,
        "certificate_on_pass": False,
        "renewal_days": 365,
    },
}

FB_TRAINING_FOOD_SAFETY = {
    "name": "Food Safety for F&B",
    "description": "HACCP-aligned food safety for restaurant and cafe environments: temperature control, personal hygiene, cross-contamination, FIFO, and pest awareness.",
    "category": "training_module",
    "is_recommended": True,
    "sort_order": 2,
    "content": {
        "module_name": "Food Safety for F&B",
        "estimated_minutes": 25,
        "auto_assign_on_hire": True,
        "target_roles": ["staff", "manager"],
        "sections": [
            {"title": "Temperature Danger Zone — 4–60°C, cold storage rules, hot holding above 60°C, safe cooking temps by protein (chicken 74°C, beef 63°C)", "content_type": "text_with_images"},
            {"title": "Handwashing & Personal Hygiene — 5 critical moments, 20-second technique, glove rules, uniform and grooming standards, illness reporting", "content_type": "text_with_images"},
            {"title": "Cross-Contamination Prevention — color-coded boards, fridge storage order, allergen segregation, utensil discipline between raw and cooked", "content_type": "text_with_images"},
            {"title": "FIFO, Storage & Labeling — date labeling (prep date, use-by, initials), sealed and off-floor storage, receiving inspection, dry storage", "content_type": "text_with_images"},
            {"title": "Pest Awareness — common restaurant pests, signs to look for, prevention (sealed doors, clean drains, covered waste), reporting immediately", "content_type": "text_with_images"},
            {"title": "Food Safety Assessment", "content_type": "scenario_based"},
        ],
        "passing_score": 85,
        "certificate_on_pass": True,
        "renewal_days": 365,
    },
}

FB_TRAINING_ALLERGEN = {
    "name": "Allergen Awareness",
    "description": "The 14 major allergens, kitchen procedures, guest communication chain, and emergency response for allergic reactions. Safety-critical: 90% pass required.",
    "category": "training_module",
    "is_recommended": True,
    "sort_order": 3,
    "content": {
        "module_name": "Allergen Awareness",
        "estimated_minutes": 15,
        "auto_assign_on_hire": True,
        "target_roles": ["staff", "manager"],
        "sections": [
            {"title": "The 14 Major Allergens — full list with common hiding places in restaurant food (soy in sauces, dairy in bread, nuts in pesto), severity of reactions, anaphylaxis basics", "content_type": "text_with_images"},
            {"title": "Kitchen Allergen Procedures — dedicated prep areas, clean utensils between allergen and non-allergen, separate frying oil, reading supplier labels, handling menu changes", "content_type": "text_with_images"},
            {"title": "Communicating with Guests — asking proactively, never guessing, checking with kitchen, the communication chain: guest → server → kitchen → server → guest", "content_type": "text_with_images"},
            {"title": "Allergic Reaction Emergency Response — recognizing symptoms, calling emergency services, EpiPen location and basics, documenting the incident", "content_type": "text_with_images"},
            {"title": "Allergen Knowledge Assessment", "content_type": "scenario_based"},
        ],
        "passing_score": 90,
        "certificate_on_pass": True,
        "renewal_days": 180,
    },
}

FB_TRAINING_BAR = {
    "name": "Bar & Beverage Service",
    "description": "Pouring standards, classic cocktails and wine service, bar efficiency, hygiene, and responsible service fundamentals.",
    "category": "training_module",
    "is_recommended": True,
    "sort_order": 4,
    "content": {
        "module_name": "Bar & Beverage Service",
        "estimated_minutes": 20,
        "auto_assign_on_hire": True,
        "target_roles": ["staff", "manager"],
        "sections": [
            {"title": "Pouring Standards — jigger use for consistency, standard pours (30ml spirit, 150ml wine, 330ml beer), free-pour risks, cocktail measuring", "content_type": "text_with_images"},
            {"title": "Classic Cocktails & Wine Service — 10 cocktails every bartender must know, wine service (presenting, opening, pouring, temperature), beer service and draft pouring", "content_type": "text_with_images"},
            {"title": "Bar Efficiency & Presentation — bar setup for rush service, garnish prep, glassware selection, multitasking, consistent presentation standards", "content_type": "text_with_images"},
            {"title": "Bar Hygiene — sanitizing bar surface, ice scoop only (never glass or hands), glass washer cycle, garnish freshness, draft line cleaning schedule", "content_type": "text_with_images"},
            {"title": "Responsible Service — checking IDs, signs of intoxication (speech, balance, behavior), refusal techniques, documenting incidents, legal liability", "content_type": "text_with_images"},
            {"title": "Bar Service Assessment", "content_type": "scenario_based"},
        ],
        "passing_score": 80,
        "certificate_on_pass": False,
        "renewal_days": 365,
    },
}

FB_TRAINING_RESPONSIBLE_ALCOHOL = {
    "name": "Responsible Alcohol Service",
    "description": "Legal framework for alcohol service, identifying intoxication, refusal and de-escalation, and incident documentation. Legal requirement: 90% pass required.",
    "category": "training_module",
    "is_recommended": True,
    "sort_order": 5,
    "content": {
        "module_name": "Responsible Alcohol Service",
        "estimated_minutes": 20,
        "auto_assign_on_hire": True,
        "target_roles": ["staff", "manager"],
        "sections": [
            {"title": "Legal Framework — local liquor licensing requirements, legal serving age, penalties for serving minors or intoxicated persons, venue liability", "content_type": "text_with_images"},
            {"title": "Identifying Intoxication — behavioral signs (loud, aggressive, unsteady, slurred speech), physical signs, tracking rate of consumption, happy vs impaired", "content_type": "text_with_images"},
            {"title": "Refusal & De-escalation — when to stop serving, how to say no without confrontation, offering water/food/transport, involving the manager, handling aggression", "content_type": "text_with_images"},
            {"title": "Documentation & Incidents — logging refusals, incident report requirements, when to call police, protecting staff safety, post-incident review", "content_type": "text_with_images"},
            {"title": "Responsible Service Assessment", "content_type": "scenario_based"},
        ],
        "passing_score": 90,
        "certificate_on_pass": True,
        "renewal_days": 365,
    },
}

FB_TRAINING_KITCHEN_OPS = {
    "name": "Kitchen Operations & Line Procedures",
    "description": "Station setup, service flow, kitchen communication (calling and firing), and end-of-service breakdown and cleaning.",
    "category": "training_module",
    "is_recommended": True,
    "sort_order": 6,
    "content": {
        "module_name": "Kitchen Operations & Line Procedures",
        "estimated_minutes": 20,
        "auto_assign_on_hire": True,
        "target_roles": ["staff", "manager"],
        "sections": [
            {"title": "Station Setup & Mise en Place — par levels by station, labeling and dating, equipment check before service, what good mise en place looks like", "content_type": "text_with_images"},
            {"title": "Service Flow — reading tickets, calling and firing, timing multiple tables, the pass and expediting role, plating standards and consistency", "content_type": "text_with_images"},
            {"title": "Kitchen Communication — behind/corner/hot/sharp calls, communicating with FOH on timing, handling 86 items, responding to allergy alerts", "content_type": "text_with_images"},
            {"title": "Breakdown & End-of-Service — equipment shutdown sequence, deep cleaning schedule, waste logging, FIFO wrap-up, prep list for next service", "content_type": "text_with_images"},
            {"title": "Kitchen Operations Assessment", "content_type": "scenario_based"},
        ],
        "passing_score": 80,
        "certificate_on_pass": False,
        "renewal_days": 365,
    },
}

FB_TRAINING_POS = {
    "name": "POS & Order Management",
    "description": "POS order entry (table, seat, modifiers, coursing), payment processing, split checks, voids/refunds, and end-of-shift reconciliation.",
    "category": "training_module",
    "is_recommended": True,
    "sort_order": 7,
    "content": {
        "module_name": "POS & Order Management",
        "estimated_minutes": 15,
        "auto_assign_on_hire": True,
        "target_roles": ["staff", "manager"],
        "sections": [
            {"title": "Order Entry — table numbers, seat numbers, modifiers and special requests, coursing (fire timing), sending to kitchen display, checking accuracy", "content_type": "text_with_images"},
            {"title": "Payments & Closing — splitting checks, applying discounts (manager approval required), processing card/cash/mobile, void and refund procedures, tip handling", "content_type": "text_with_images"},
            {"title": "End of Shift — running reports, cash drawer reconciliation, flagging discrepancies, shift handover to incoming lead", "content_type": "text_with_images"},
            {"title": "POS Operations Assessment", "content_type": "scenario_based"},
        ],
        "passing_score": 80,
        "certificate_on_pass": False,
        "renewal_days": 365,
    },
}

FB_TRAINING_FOOD_COST = {
    "name": "Food Cost Management",
    "description": "Food cost percentage, recipe costing, portion control, menu engineering (stars/plowhorses/puzzles/dogs), and daily waste reduction. Managers only.",
    "category": "training_module",
    "is_recommended": True,
    "sort_order": 8,
    "content": {
        "module_name": "Food Cost Management",
        "estimated_minutes": 20,
        "auto_assign_on_hire": False,
        "target_roles": ["manager"],
        "sections": [
            {"title": "Understanding Food Cost — food cost percentage formula (COGS/revenue), target ranges by restaurant type (casual 28–35%, fine dining 30–40%), cost per cover", "content_type": "text_with_images"},
            {"title": "Recipe Costing — costing every dish to the unit, waste factor calculation, updating costs when supplier prices change, gross margin per menu item", "content_type": "text_with_images"},
            {"title": "Portion Control — standardized portions with reference photos, weighing protein, sauce and garnish control, what poor portion control costs monthly", "content_type": "text_with_images"},
            {"title": "Menu Engineering — stars (high profit + popular), plowhorses (low profit + popular), puzzles (high profit + unpopular), dogs (low + unpopular); pricing and layout strategy", "content_type": "text_with_images"},
            {"title": "Waste Reduction — daily waste tracking, common waste sources, cross-utilization (trim → stock), par level adjustment, staff meal policy", "content_type": "text_with_images"},
            {"title": "Food Cost Management Assessment", "content_type": "scenario_based"},
        ],
        "passing_score": 80,
        "certificate_on_pass": False,
        "renewal_days": 365,
    },
}

FB_TRAINING_SAFETY = {
    "name": "Workplace Safety & Emergency Response",
    "description": "Fire safety in F&B kitchens, first aid for burns and cuts, chemical safety, and emergency evacuation procedures with guests on premise.",
    "category": "training_module",
    "is_recommended": True,
    "sort_order": 9,
    "content": {
        "module_name": "Workplace Safety & Emergency Response",
        "estimated_minutes": 20,
        "auto_assign_on_hire": True,
        "target_roles": ["staff", "manager"],
        "sections": [
            {"title": "Fire Safety in F&B — kitchen grease fires, gas leak procedure, Class K extinguisher use (PASS), suppression system basics, evacuation with guests present", "content_type": "text_with_images"},
            {"title": "Burns, Cuts & Common Injuries — burn severity and first aid, lacerations, slips and falls, when to call emergency services, first aid kit location and use", "content_type": "text_with_images"},
            {"title": "Chemical Safety — cleaning chemical storage (away from food), correct dilution ratios, never mixing chemicals, PPE for cleaning tasks, MSDS sheet basics", "content_type": "text_with_images"},
            {"title": "Emergency Procedures — guest evacuation (who guides, who does headcount), gas leak, power outage procedures, active threat basics", "content_type": "text_with_images"},
            {"title": "Safety & Emergency Assessment", "content_type": "scenario_based"},
        ],
        "passing_score": 85,
        "certificate_on_pass": True,
        "renewal_days": 365,
    },
}


# ── SHIFT TEMPLATES ───────────────────────────────────────────────────────────
# Provisioner reads: shift_name, start_time, end_time, role, days_of_week

# Full-service split shifts
FB_SHIFT_FS_LUNCH = {
    "name": "Full-Service Split Shift — Lunch",
    "description": "AM service block for full-service restaurants running a split shift model",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 1,
    "content": {
        "shift_name": "Full-Service Split Shift — Lunch",
        "start_time": "10:00",
        "end_time": "15:00",
        "role": "",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}

FB_SHIFT_FS_DINNER = {
    "name": "Full-Service Split Shift — Dinner",
    "description": "PM service block for full-service restaurants running a split shift model",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 2,
    "content": {
        "shift_name": "Full-Service Split Shift — Dinner",
        "start_time": "17:00",
        "end_time": "23:00",
        "role": "",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}

# Casual dining shifts
FB_SHIFT_CD_OPENING = {
    "name": "Casual Dining Opening",
    "description": "Opening shift for casual dining restaurants",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 1,
    "content": {
        "shift_name": "Casual Dining Opening",
        "start_time": "09:00",
        "end_time": "17:00",
        "role": "",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}

FB_SHIFT_CD_CLOSING = {
    "name": "Casual Dining Closing",
    "description": "Closing shift for casual dining restaurants",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 2,
    "content": {
        "shift_name": "Casual Dining Closing",
        "start_time": "15:00",
        "end_time": "23:00",
        "role": "",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}

# Cafe/bar shifts
FB_SHIFT_CAFE_MORNING = {
    "name": "Cafe Morning",
    "description": "Early morning shift for cafe operations — opens through breakfast and lunch",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 1,
    "content": {
        "shift_name": "Cafe Morning",
        "start_time": "05:30",
        "end_time": "13:30",
        "role": "",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}

FB_SHIFT_CAFE_AFTERNOON = {
    "name": "Cafe Afternoon",
    "description": "Afternoon shift for cafe operations — covers lunch through close",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 2,
    "content": {
        "shift_name": "Cafe Afternoon",
        "start_time": "11:30",
        "end_time": "19:30",
        "role": "",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}

FB_SHIFT_BAR_DAY = {
    "name": "Bar Day Shift",
    "description": "Day bar shift — lunch service through late afternoon",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 3,
    "content": {
        "shift_name": "Bar Day Shift",
        "start_time": "11:00",
        "end_time": "19:00",
        "role": "",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}

FB_SHIFT_BAR_NIGHT = {
    "name": "Bar Night Shift",
    "description": "Evening bar shift — runs overnight (18:00–02:00 next day)",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 4,
    "content": {
        "shift_name": "Bar Night Shift",
        "start_time": "18:00",
        "end_time": "02:00",  # provisioner adds 1 day when end_dt <= start_dt
        "role": "",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}

# Kitchen shifts (shared across non-bakery packages)
FB_SHIFT_KITCHEN_PREP = {
    "name": "Kitchen Prep",
    "description": "Early prep shift — mise en place and production before service begins",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 5,
    "content": {
        "shift_name": "Kitchen Prep",
        "start_time": "07:00",
        "end_time": "15:00",
        "role": "Kitchen",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}

FB_SHIFT_KITCHEN_LUNCH = {
    "name": "Kitchen Service — Lunch",
    "description": "Kitchen service shift covering lunch service",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 6,
    "content": {
        "shift_name": "Kitchen Service — Lunch",
        "start_time": "10:00",
        "end_time": "16:00",
        "role": "Kitchen",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}

FB_SHIFT_KITCHEN_DINNER = {
    "name": "Kitchen Service — Dinner",
    "description": "Kitchen service shift covering dinner and close",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 7,
    "content": {
        "shift_name": "Kitchen Service — Dinner",
        "start_time": "15:00",
        "end_time": "23:00",
        "role": "Kitchen",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}

# Bakery-specific shifts
FB_SHIFT_BAKERY_PRODUCTION = {
    "name": "Bakery Production",
    "description": "Early morning production shift — bread and pastry baking before shop opens",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 1,
    "content": {
        "shift_name": "Bakery Production",
        "start_time": "03:00",
        "end_time": "11:00",
        "role": "Production",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}

FB_SHIFT_BAKERY_SHOP = {
    "name": "Bakery Shop",
    "description": "Shop-floor shift — display, counter service, and customer sales",
    "category": "shift_template",
    "is_recommended": True,
    "sort_order": 2,
    "content": {
        "shift_name": "Bakery Shop",
        "start_time": "06:00",
        "end_time": "18:00",
        "role": "Sales",
        "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
}


# ── REPAIR MANUALS ────────────────────────────────────────────────────────────
# Shared across dining sub-types; sub-type-specific items marked inline.

FB_REPAIR_RANGE_GRILL = {
    "name": "Commercial Range & Grill Maintenance SOP",
    "description": "Daily and weekly cleaning and safety checks for commercial gas ranges, flat-tops, and char-grills.",
    "category": "repair_manual",
    "is_recommended": True,
    "sort_order": 1,
    "content": {
        "manual_name": "Commercial Range & Grill Maintenance SOP",
        "equipment_type": "commercial_range",
        "linked_issue_categories": ["Equipment Failure"],
        "sections": [
            {
                "title": "Daily Cleaning",
                "frequency": "daily",
                "steps": [
                    "Allow burners to cool completely before cleaning",
                    "Remove grates and drip trays; soak in degreaser for 15 minutes",
                    "Wipe burner heads and ports with a damp cloth — clear any blocked ports with a pin",
                    "Scrape flat-top / grill surface with a metal scraper while still warm (not hot)",
                    "Apply approved grill cleaner; scrub with grill brush; wipe clean",
                    "Reassemble grates and drip trays; check gas knobs turn freely",
                    "Log cleaning in Equipment Maintenance Log",
                ],
            },
            {
                "title": "Weekly Deep Clean",
                "frequency": "weekly",
                "steps": [
                    "Disconnect gas supply at the isolation valve before moving unit",
                    "Pull unit out from wall; clean behind and underneath with degreaser",
                    "Remove burner assemblies; inspect igniters for carbon buildup — clean with dry brush",
                    "Degrease oven cavity (if combo unit): remove racks, spray, wipe after 10 minutes",
                    "Inspect gas hose for cracks or kinks — do NOT use unit if hose is damaged; call vendor",
                    "Reconnect gas; test each burner ignition before returning to service",
                    "Log completion with staff signature",
                ],
            },
            {
                "title": "Safety Checks",
                "frequency": "daily",
                "steps": [
                    "Check pilot lights are lit before opening service",
                    "Confirm no gas smell near unit — if detected, shut off gas immediately and call manager",
                    "Verify overhead exhaust hood is operational and filters are in place",
                    "Check flame colour: blue = normal, yellow/orange = air issue, call technician",
                ],
            },
        ],
    },
}

FB_REPAIR_WALK_IN_COOLER = {
    "name": "Walk-in Cooler / Freezer Maintenance SOP",
    "description": "Temperature monitoring, door seal inspection, and cleaning schedule for walk-in refrigeration.",
    "category": "repair_manual",
    "is_recommended": True,
    "sort_order": 2,
    "content": {
        "manual_name": "Walk-in Cooler / Freezer Maintenance SOP",
        "equipment_type": "refrigeration",
        "linked_issue_categories": ["Equipment Failure", "Food Safety Concern"],
        "sections": [
            {
                "title": "Daily Checks",
                "frequency": "daily",
                "steps": [
                    "Record temperature twice daily (opening & closing) in the Temp Monitoring Log — Cooler must be 1–4°C, Freezer must be −18°C or below",
                    "Check door gaskets for tears, gaps, or ice buildup — report damage to manager immediately",
                    "Ensure door self-closes and latches fully; adjust spring tension if needed",
                    "Inspect evaporator coil visible panel for heavy frost buildup (>1 cm = call technician)",
                    "Wipe interior door frame and threshold with food-safe sanitiser",
                ],
            },
            {
                "title": "Weekly Cleaning",
                "frequency": "weekly",
                "steps": [
                    "Remove all products from one shelf section at a time; check for expired items",
                    "Wash shelving with warm soapy water; rinse; allow to air-dry before restocking",
                    "Sweep and mop floor with food-safe sanitiser; pay attention to drain area",
                    "Clean exterior condenser coils with a soft brush (if accessible) — dust reduces efficiency",
                    "Check drain line is clear — pour a cup of water down floor drain to confirm flow",
                ],
            },
            {
                "title": "Defrost Procedure",
                "frequency": "as_needed",
                "steps": [
                    "If frost buildup on evaporator coils exceeds 1 cm, initiate manual defrost",
                    "Move all product to backup refrigeration; document transfer",
                    "Set unit to defrost cycle or turn off compressor",
                    "Once fully defrosted, clean interior; verify drain is clear before restarting",
                    "Allow temperature to stabilise at target range before returning product",
                    "Log defrost event with date, duration, and technician name",
                ],
            },
        ],
    },
}

FB_REPAIR_DISHWASHER = {
    "name": "Commercial Dishwasher Maintenance SOP",
    "description": "Daily startup checks, chemical level monitoring, and descaling schedule for pass-through and undercounter dishwashers.",
    "category": "repair_manual",
    "is_recommended": True,
    "sort_order": 3,
    "content": {
        "manual_name": "Commercial Dishwasher Maintenance SOP",
        "equipment_type": "dishwasher",
        "linked_issue_categories": ["Equipment Failure"],
        "sections": [
            {
                "title": "Daily Startup",
                "frequency": "daily",
                "steps": [
                    "Fill wash tank with fresh water; confirm wash temperature reaches 60–65°C before first cycle",
                    "Check detergent and rinse-aid dispensers — refill if below minimum line",
                    "Inspect spray arms for blocked nozzles — remove and rinse under running water if needed",
                    "Check wash curtains (if present) for damage or soil buildup — wash separately",
                    "Run one empty cycle to verify temperatures and rinse pressure",
                ],
            },
            {
                "title": "End-of-Day Shutdown",
                "frequency": "daily",
                "steps": [
                    "Drain wash tank completely",
                    "Remove and clean all filters and screen traps — remove food debris",
                    "Wipe interior walls, door seals, and hood with a damp cloth",
                    "Leave door open overnight to prevent odour and mildew",
                    "Log final rinse temperature and chemical levels in Equipment Maintenance Log",
                ],
            },
            {
                "title": "Weekly Descale",
                "frequency": "weekly",
                "steps": [
                    "Add approved descaling chemical per manufacturer dosage to wash tank",
                    "Run 2–3 full cycles with empty racks",
                    "Drain and refill with clean water; run 1 rinse-only cycle",
                    "Inspect wash arms again after descaling — remove any loosened deposits",
                    "Record descale date in maintenance log",
                ],
            },
        ],
    },
}

FB_REPAIR_POS = {
    "name": "POS Terminal Troubleshooting & Maintenance SOP",
    "description": "Daily startup checks, printer maintenance, and common troubleshooting steps for POS systems.",
    "category": "repair_manual",
    "is_recommended": True,
    "sort_order": 4,
    "content": {
        "manual_name": "POS Terminal Troubleshooting & Maintenance SOP",
        "equipment_type": "pos_terminal",
        "linked_issue_categories": ["IT / System Issue"],
        "sections": [
            {
                "title": "Daily Startup Checks",
                "frequency": "daily",
                "steps": [
                    "Power on terminal; confirm it boots to the POS login screen within 2 minutes",
                    "Log in and run a test transaction (void immediately) to confirm payment processing is live",
                    "Load receipt paper; confirm print quality on a test receipt",
                    "Check touchscreen responsiveness in all corners — clean with microfibre cloth if needed",
                    "Confirm network/WiFi indicator is green; if not, check router and restart POS",
                ],
            },
            {
                "title": "Common Issues & First-Line Fixes",
                "frequency": "as_needed",
                "steps": [
                    "Printer not printing: check paper roll orientation (thermal side must face printhead), clear any paper jam",
                    "Screen unresponsive: power cycle the terminal; if still unresponsive, call IT support",
                    "Payment declined (connection): verify internet is active; switch to offline mode if available",
                    "POS software frozen: force-close app from task manager; reopen; do NOT press hard reset",
                    "Card reader error: clean card reader slot with approved cleaning card; retry",
                ],
            },
            {
                "title": "Weekly Cleaning",
                "frequency": "weekly",
                "steps": [
                    "Wipe screen and housing with a slightly damp microfibre cloth — NO spray directly on unit",
                    "Clean card reader slot with an approved cleaning card",
                    "Check all cables for fraying, especially at connectors — replace if worn",
                    "Blow compressed air into receipt printer paper slot to clear dust",
                    "Verify end-of-day report matches cash drawer — document any discrepancies",
                ],
            },
        ],
    },
}

FB_REPAIR_HVAC = {
    "name": "HVAC & Exhaust Hood Maintenance SOP",
    "description": "Filter cleaning schedule, exhaust hood grease trap maintenance, and AC unit checks.",
    "category": "repair_manual",
    "is_recommended": True,
    "sort_order": 5,
    "content": {
        "manual_name": "HVAC & Exhaust Hood Maintenance SOP",
        "equipment_type": "hvac",
        "linked_issue_categories": ["Facility / Safety Issue"],
        "sections": [
            {
                "title": "Daily Exhaust Hood Check",
                "frequency": "daily",
                "steps": [
                    "Turn on exhaust hood 15 minutes before kitchen opens; confirm suction is strong",
                    "Check grease collection tray — empty if >50% full before service",
                    "Inspect baffle filters for excessive grease (should be replaced if dripping)",
                    "After service, wipe hood exterior and drip ledge with degreaser cloth",
                ],
            },
            {
                "title": "Weekly Filter Cleaning",
                "frequency": "weekly",
                "steps": [
                    "Remove baffle filters; soak in commercial degreaser for 20 minutes",
                    "Scrub with a stiff brush; rinse thoroughly; allow to fully dry before reinserting",
                    "Wipe interior hood surfaces and duct opening with degreaser cloth",
                    "Check exhaust fan belt (if belt-driven): look for cracks or glazing — replace if worn",
                    "Log filter cleaning in maintenance log",
                ],
            },
            {
                "title": "Monthly AC Unit Check",
                "frequency": "monthly",
                "steps": [
                    "Replace or clean AC air filters according to manufacturer spec",
                    "Check condensate drain pan — clear any blockage to prevent overflow",
                    "Inspect outdoor condenser unit: clear debris, leaves, and overgrowth from around unit",
                    "Verify thermostat settings match dining area comfort standards",
                    "If unit is not reaching set temperature or making unusual noise, call HVAC technician",
                ],
            },
        ],
    },
}

FB_REPAIR_ESPRESSO = {
    "name": "Espresso Machine Calibration & Cleaning SOP",
    "description": "Daily backflush, steam wand purging, weekly descale, and grinder calibration for commercial espresso machines.",
    "category": "repair_manual",
    "is_recommended": True,
    "sort_order": 6,
    "content": {
        "manual_name": "Espresso Machine Calibration & Cleaning SOP",
        "equipment_type": "espresso_machine",
        "linked_issue_categories": ["Equipment Failure"],
        "sections": [
            {
                "title": "Daily Cleaning (End of Service)",
                "frequency": "daily",
                "steps": [
                    "Backflush group heads with blind basket and approved espresso machine cleaner — run 5 cycles",
                    "Remove portafilters and baskets; soak in cleaning solution for 10 minutes; rinse",
                    "Purge steam wands immediately after each use by wiping with damp cloth and releasing steam",
                    "Wipe steam wand tip with a clean cloth after final purge; check for milk residue blockage",
                    "Clean drip tray and grate; rinse; reinsert",
                    "Wipe machine exterior with a damp cloth; do NOT use abrasive cleaners on group head chrome",
                    "Log daily cleaning in Equipment Maintenance Log",
                ],
            },
            {
                "title": "Weekly Descale",
                "frequency": "weekly",
                "steps": [
                    "Run descale cycle per manufacturer instructions using approved descaling agent",
                    "Flush boiler with clean water for at least 3 full cycles after descaling",
                    "Check water filter: replace if >3 months old or water hardness is high",
                    "Run 2–3 test shots and check extraction time: target 25–30 seconds for a double espresso",
                    "Adjust grinder dose or grind size if extraction is off-target",
                ],
            },
            {
                "title": "Grinder Calibration",
                "frequency": "daily",
                "steps": [
                    "Pull a test shot at start of service — time extraction (25–30 seconds for double shot)",
                    "If under-extracted (fast/watery): adjust grinder finer by one click; retest",
                    "If over-extracted (slow/bitter): adjust coarser by one click; retest",
                    "Record grinder setting in shift notes when adjusted",
                    "Purge old grinds after any grind size adjustment before pulling a quality shot",
                ],
            },
        ],
    },
}

FB_REPAIR_DRAFT_BEER = {
    "name": "Draft Beer System Maintenance SOP",
    "description": "Line cleaning schedule, coupler checks, and CO₂ pressure monitoring for draft beer and beverage systems.",
    "category": "repair_manual",
    "is_recommended": True,
    "sort_order": 7,
    "content": {
        "manual_name": "Draft Beer System Maintenance SOP",
        "equipment_type": "draft_beer_system",
        "linked_issue_categories": ["Equipment Failure", "Bar Equipment Issue"],
        "sections": [
            {
                "title": "Daily Checks",
                "frequency": "daily",
                "steps": [
                    "Check CO₂ / mixed gas tank pressure: primary must be 10–14 psi for ales, 25–30 psi for lagers",
                    "Inspect all couplers for leaks — listen for hissing; tighten if loose",
                    "Run first pint of each line at opening — if flat, foamy, or off-flavour, tag the line",
                    "Clean faucet nozzles daily with warm water and a faucet brush",
                    "Wipe drip trays with sanitiser solution; empty waste tray",
                ],
            },
            {
                "title": "Weekly Line Cleaning",
                "frequency": "weekly",
                "steps": [
                    "Shut off CO₂; disconnect couplers from kegs",
                    "Connect line cleaning pump; flush lines with cold water first",
                    "Circulate approved beer line cleaner for 15 minutes",
                    "Flush with clean water until no cleaner residue remains (test with pH strip)",
                    "Reconnect couplers; restore CO₂ pressure; pull and discard first full pint of each line",
                    "Record cleaning in line cleaning log with staff signature",
                ],
            },
            {
                "title": "Keg Change Procedure",
                "frequency": "as_needed",
                "steps": [
                    "Relieve pressure from empty keg by pulling tap handle before disconnecting coupler",
                    "Remove coupler: push down and turn counter-clockwise",
                    "Wipe new keg top and coupler with sanitiser cloth",
                    "Attach coupler: push and turn clockwise until seated; engage handle",
                    "Allow keg to settle for 1 hour before serving if just chilled; 24 hours from room temp",
                    "Record keg change with brand, volume, and date in bar inventory log",
                ],
            },
        ],
    },
}

FB_REPAIR_COMMERCIAL_OVEN = {
    "name": "Commercial Oven Maintenance SOP",
    "description": "Daily calibration checks, cleaning schedule, and door seal inspection for deck, convection, and rack ovens.",
    "category": "repair_manual",
    "is_recommended": True,
    "sort_order": 6,
    "content": {
        "manual_name": "Commercial Oven Maintenance SOP",
        "equipment_type": "commercial_oven",
        "linked_issue_categories": ["Equipment Failure"],
        "sections": [
            {
                "title": "Daily Startup & Calibration",
                "frequency": "daily",
                "steps": [
                    "Preheat oven to production temperature; use an independent oven thermometer to verify actual temperature matches display",
                    "If variance >10°C: do NOT use for production; log and call technician",
                    "For deck ovens: inspect stone decks for cracks — do not use cracked decks under high heat",
                    "Check door hinges and seals — worn seals cause uneven baking; replace if torn",
                    "Verify steam injection (if fitted) produces consistent steam without sputtering",
                ],
            },
            {
                "title": "Daily Cleaning",
                "frequency": "daily",
                "steps": [
                    "Allow oven to cool to below 50°C before cleaning",
                    "Remove racks and oven liners; wash in sink with degreaser; rinse and dry",
                    "Wipe interior walls with food-safe oven cleaner on a damp cloth",
                    "Clean door glass with non-abrasive glass cleaner (inside and outside)",
                    "Wipe exterior and control panel with a damp cloth — no spray near electronics",
                    "Log cleaning in Equipment Maintenance Log",
                ],
            },
            {
                "title": "Weekly Deep Clean",
                "frequency": "weekly",
                "steps": [
                    "Apply commercial oven cleaner to interior; leave for recommended dwell time",
                    "Scrub interior with non-scratch pad; wipe clean with damp cloths",
                    "For convection ovens: remove and clean fan blade cover; check fan for grease buildup",
                    "Inspect burner or heating elements for visible damage or corrosion",
                    "Check door latch mechanism — adjust tension if door does not seal firmly",
                    "Record deep clean with date and staff signature",
                ],
            },
        ],
    },
}

FB_REPAIR_DOUGH_MIXER = {
    "name": "Dough Mixer Maintenance SOP",
    "description": "Attachment care, gear oil checks, and bowl sanitation for commercial planetary and spiral mixers.",
    "category": "repair_manual",
    "is_recommended": True,
    "sort_order": 7,
    "content": {
        "manual_name": "Dough Mixer Maintenance SOP",
        "equipment_type": "dough_mixer",
        "linked_issue_categories": ["Equipment Failure"],
        "sections": [
            {
                "title": "After Every Use",
                "frequency": "per_use",
                "steps": [
                    "Lock out mixer (switch off and unplug) before removing attachments",
                    "Remove dough hook, flat beater, or whisk; rinse immediately to prevent dough drying",
                    "Wash attachments with warm soapy water; rinse; air-dry or use clean cloth",
                    "Wipe mixer bowl with a damp cloth; wash in sink if heavily soiled",
                    "Wipe mixer head and column — do NOT let dough or batter dry on machine body",
                ],
            },
            {
                "title": "Weekly Checks",
                "frequency": "weekly",
                "steps": [
                    "Inspect attachment hub for cracks or wobble — report any looseness immediately",
                    "Check bowl locking mechanism: bowl must lock firmly before any operation",
                    "Look for oil seepage around the mixing head (planetary only) — call technician if observed",
                    "Lubricate bowl lift screw (if applicable) with food-grade grease per manufacturer spec",
                    "Check power cord and plug for damage; do NOT operate with damaged cord",
                ],
            },
            {
                "title": "Monthly Gear Oil Check",
                "frequency": "monthly",
                "steps": [
                    "Locate gear oil fill plug on mixer head (refer to manual for location)",
                    "With mixer cold and unplugged, check oil level via dipstick or sight glass",
                    "If oil is dark or below minimum mark, schedule service with approved technician",
                    "Do NOT attempt to change gear oil without proper training — improper fill damages gears",
                    "Log inspection date and observations in Equipment Maintenance Log",
                ],
            },
        ],
    },
}

FB_REPAIR_PROOFING_CABINET = {
    "name": "Proofing Cabinet Maintenance SOP",
    "description": "Humidity and temperature calibration, interior sanitation, and water reservoir maintenance for proofers.",
    "category": "repair_manual",
    "is_recommended": True,
    "sort_order": 8,
    "content": {
        "manual_name": "Proofing Cabinet Maintenance SOP",
        "equipment_type": "proofing_cabinet",
        "linked_issue_categories": ["Equipment Failure"],
        "sections": [
            {
                "title": "Daily Startup",
                "frequency": "daily",
                "steps": [
                    "Fill water reservoir with fresh water; do NOT use mineral water (causes scale buildup)",
                    "Set temperature to target (typically 27–32°C) and humidity to 75–85% RH",
                    "Allow 20–30 minutes to reach stable conditions before loading dough",
                    "Verify temperature and humidity display match settings — if not, call technician",
                    "Wipe interior walls and racks with a damp sanitised cloth before first use",
                ],
            },
            {
                "title": "Daily Shutdown & Cleaning",
                "frequency": "daily",
                "steps": [
                    "Drain water reservoir completely at end of production day",
                    "Remove racks and wash with warm soapy water; rinse; allow to dry",
                    "Wipe interior with food-safe sanitiser spray — leave door slightly open overnight",
                    "Wipe exterior and control panel with a damp cloth",
                    "Log temperature and humidity readings from today's production in maintenance log",
                ],
            },
            {
                "title": "Weekly Descale",
                "frequency": "weekly",
                "steps": [
                    "Mix descaling solution per manufacturer ratio; add to reservoir",
                    "Run one heating cycle to circulate; leave for 30 minutes",
                    "Drain reservoir; refill with clean water; run one full flush cycle",
                    "Inspect steam nozzle and humidity ports for scale — clear with a pin if blocked",
                    "Log descale with date and staff signature",
                ],
            },
        ],
    },
}


# ── BADGES ────────────────────────────────────────────────────────────────────
# criteria_type valid values (from provisioner): issues_reported, issues_resolved,
# checklists_completed, checklist_streak_days, training_completed,
# attendance_streak_days, tasks_completed, manual

FB_BADGE_SERVICE_STAR = {
    "name": "Service Star",
    "description": "Awarded for consistent service excellence — completing 50 service checklists",
    "category": "badge",
    "is_recommended": True,
    "sort_order": 1,
    "content": {
        "badge_name": "Service Star",
        "description": "Completed 50 service checklists",
        "points_awarded": 50,
        "criteria_type": "checklists_completed",
        "threshold": 50,
    },
}

FB_BADGE_SAFETY_FIRST = {
    "name": "Safety First",
    "description": "Awarded for proactively reporting safety and maintenance issues",
    "category": "badge",
    "is_recommended": True,
    "sort_order": 2,
    "content": {
        "badge_name": "Safety First",
        "description": "Reported 10 safety or maintenance issues",
        "points_awarded": 75,
        "criteria_type": "issues_reported",
        "threshold": 10,
    },
}

FB_BADGE_TRAINING_CHAMPION = {
    "name": "Training Champion",
    "description": "Awarded for completing 5 or more training courses",
    "category": "badge",
    "is_recommended": True,
    "sort_order": 3,
    "content": {
        "badge_name": "Training Champion",
        "description": "Completed 5 training courses",
        "points_awarded": 100,
        "criteria_type": "training_completed",
        "threshold": 5,
    },
}

FB_BADGE_PERFECT_ATTENDANCE = {
    "name": "Perfect Attendance",
    "description": "30 consecutive days on time — no late arrivals or early departures",
    "category": "badge",
    "is_recommended": True,
    "sort_order": 4,
    "content": {
        "badge_name": "Perfect Attendance",
        "description": "30 consecutive days on time",
        "points_awarded": 100,
        "criteria_type": "attendance_streak_days",
        "threshold": 30,
    },
}

FB_BADGE_TASK_CLOSER = {
    "name": "Task Closer",
    "description": "Awarded for completing 50 assigned tasks",
    "category": "badge",
    "is_recommended": True,
    "sort_order": 5,
    "content": {
        "badge_name": "Task Closer",
        "description": "Completed 50 assigned tasks",
        "points_awarded": 50,
        "criteria_type": "tasks_completed",
        "threshold": 50,
    },
}


# ── PACKAGE ASSEMBLY HELPERS ──────────────────────────────────────────────────

def _fb_badges():
    return [
        FB_BADGE_SERVICE_STAR,
        FB_BADGE_SAFETY_FIRST,
        FB_BADGE_TRAINING_CHAMPION,
        FB_BADGE_PERFECT_ATTENDANCE,
        FB_BADGE_TASK_CLOSER,
    ]


def _casual_dining_items():
    forms = [
        FB_FORM_FOOD_COST_WASTE,
        FB_FORM_RESERVATION_COVERS,
        FB_FORM_FOH_HANDOVER,
        FB_FORM_EQUIPMENT_MAINTENANCE,
        FB_FORM_INVENTORY_BAR,
        FB_FORM_INVENTORY_KITCHEN,
    ]
    checklists = [
        FB_CHECKLIST_FOH_OPENING,
        FB_CHECKLIST_BOH_OPENING,
        FB_CHECKLIST_FOH_CLOSING,
        FB_CHECKLIST_BOH_CLOSING,
        FB_CHECKLIST_TEMP_MONITORING,
        FB_CHECKLIST_ALLERGEN_CHECK,
    ]
    audits = [
        FB_AUDIT_TABLE_SERVICE,
        FB_AUDIT_KITCHEN_HYGIENE,
        FB_AUDIT_BAR_OPERATIONS,
        FB_AUDIT_FACILITY_SAFETY,
    ]
    issue_cats = [
        FB_ISSUE_GUEST_COMPLAINT,
        FB_ISSUE_FOOD_QUALITY,
        FB_ISSUE_EQUIPMENT_FAILURE,
        FB_ISSUE_SUPPLY_SHORTAGE,
        FB_ISSUE_BAR,
        FB_ISSUE_STAFF,
        FB_ISSUE_SECURITY,
        FB_ISSUE_PEST,
        FB_ISSUE_IT,
    ]
    workflows = [
        FB_WF_GUEST_COMPLAINT,
        FB_WF_EQUIPMENT_REPAIR,
        FB_WF_ONBOARDING_FOH,
        FB_WF_ONBOARDING_BOH,
        FB_WF_ONBOARDING_BAR,
    ]
    training = [
        FB_TRAINING_GUEST_SERVICE,
        FB_TRAINING_FOOD_SAFETY,
        FB_TRAINING_ALLERGEN,
        FB_TRAINING_BAR,
        FB_TRAINING_RESPONSIBLE_ALCOHOL,
        FB_TRAINING_KITCHEN_OPS,
        FB_TRAINING_POS,
        FB_TRAINING_FOOD_COST,
        FB_TRAINING_SAFETY,
    ]
    shifts = [
        FB_SHIFT_CD_OPENING,
        FB_SHIFT_CD_CLOSING,
        FB_SHIFT_KITCHEN_PREP,
        FB_SHIFT_KITCHEN_LUNCH,
        FB_SHIFT_KITCHEN_DINNER,
    ]
    repair_manuals = [
        FB_REPAIR_RANGE_GRILL,
        FB_REPAIR_WALK_IN_COOLER,
        FB_REPAIR_DISHWASHER,
        FB_REPAIR_POS,
        FB_REPAIR_HVAC,
    ]
    return forms + checklists + audits + issue_cats + workflows + training + shifts + repair_manuals + _fb_badges()


def _full_service_items():
    forms = [
        FB_FORM_FOOD_COST_WASTE,
        FB_FORM_RESERVATION_COVERS,
        FB_FORM_FOH_HANDOVER,
        FB_FORM_EQUIPMENT_MAINTENANCE,
        FB_FORM_INVENTORY_BAR,
        FB_FORM_INVENTORY_KITCHEN,
    ]
    checklists = [
        FB_CHECKLIST_FOH_OPENING,
        FB_CHECKLIST_BOH_OPENING,
        FB_CHECKLIST_FOH_CLOSING,
        FB_CHECKLIST_BOH_CLOSING,
        FB_CHECKLIST_TEMP_MONITORING,
        FB_CHECKLIST_ALLERGEN_CHECK,
    ]
    audits = [
        FB_AUDIT_TABLE_SERVICE_FINE,  # wine pairing version
        FB_AUDIT_KITCHEN_HYGIENE,
        FB_AUDIT_BAR_OPERATIONS,
        FB_AUDIT_FACILITY_SAFETY,
        FB_AUDIT_PLATING_PRESENTATION,  # full_service exclusive
    ]
    issue_cats = [
        FB_ISSUE_GUEST_COMPLAINT,
        FB_ISSUE_FOOD_QUALITY,
        FB_ISSUE_EQUIPMENT_FAILURE,
        FB_ISSUE_SUPPLY_SHORTAGE,
        FB_ISSUE_BAR,
        FB_ISSUE_STAFF,
        FB_ISSUE_SECURITY,
        FB_ISSUE_PEST,
        FB_ISSUE_IT,
    ]
    workflows = [
        FB_WF_GUEST_COMPLAINT,
        FB_WF_EQUIPMENT_REPAIR,
        FB_WF_ONBOARDING_FOH,
        FB_WF_ONBOARDING_BOH,
        FB_WF_ONBOARDING_BAR,
    ]
    training = [
        FB_TRAINING_GUEST_SERVICE,
        FB_TRAINING_FOOD_SAFETY,
        FB_TRAINING_ALLERGEN,
        FB_TRAINING_BAR,
        FB_TRAINING_RESPONSIBLE_ALCOHOL,
        FB_TRAINING_KITCHEN_OPS,
        FB_TRAINING_POS,
        FB_TRAINING_FOOD_COST,
        FB_TRAINING_SAFETY,
    ]
    shifts = [
        FB_SHIFT_FS_LUNCH,
        FB_SHIFT_FS_DINNER,
        FB_SHIFT_KITCHEN_PREP,
        FB_SHIFT_KITCHEN_LUNCH,
        FB_SHIFT_KITCHEN_DINNER,
    ]
    repair_manuals = [
        FB_REPAIR_RANGE_GRILL,
        FB_REPAIR_WALK_IN_COOLER,
        FB_REPAIR_DISHWASHER,
        FB_REPAIR_POS,
        FB_REPAIR_HVAC,
    ]
    return forms + checklists + audits + issue_cats + workflows + training + shifts + repair_manuals + _fb_badges()


def _cafe_bar_items():
    forms = [
        FB_FORM_FOOD_COST_WASTE,
        # No Reservation & Covers Log for cafe_bar
        FB_FORM_FOH_HANDOVER,
        FB_FORM_EQUIPMENT_MAINTENANCE,
        FB_FORM_INVENTORY_BAR,
        FB_FORM_INVENTORY_KITCHEN,
    ]
    checklists = [
        FB_CHECKLIST_FOH_OPENING,    # includes bar section
        FB_CHECKLIST_BOH_OPENING,
        FB_CHECKLIST_FOH_CLOSING,    # includes bar section
        FB_CHECKLIST_BOH_CLOSING,
        FB_CHECKLIST_TEMP_MONITORING,
        FB_CHECKLIST_ALLERGEN_CHECK,
    ]
    audits = [
        FB_AUDIT_COUNTER_SERVICE,    # replaces Table Service for cafe_bar
        FB_AUDIT_KITCHEN_HYGIENE,
        FB_AUDIT_BAR_OPERATIONS,
        FB_AUDIT_FACILITY_SAFETY,
    ]
    issue_cats = [
        FB_ISSUE_GUEST_COMPLAINT,
        FB_ISSUE_FOOD_QUALITY,
        FB_ISSUE_EQUIPMENT_FAILURE,
        FB_ISSUE_SUPPLY_SHORTAGE,
        FB_ISSUE_BAR,
        FB_ISSUE_STAFF,
        FB_ISSUE_SECURITY,
        FB_ISSUE_PEST,
        FB_ISSUE_IT,
    ]
    workflows = [
        FB_WF_GUEST_COMPLAINT,
        FB_WF_EQUIPMENT_REPAIR,
        FB_WF_ONBOARDING_FOH,
        FB_WF_ONBOARDING_BOH,
        FB_WF_ONBOARDING_BAR,    # primary onboarding for cafe_bar
    ]
    training = [
        FB_TRAINING_GUEST_SERVICE,
        FB_TRAINING_FOOD_SAFETY,
        FB_TRAINING_ALLERGEN,
        FB_TRAINING_BAR,
        FB_TRAINING_RESPONSIBLE_ALCOHOL,
        FB_TRAINING_KITCHEN_OPS,
        FB_TRAINING_POS,
        FB_TRAINING_FOOD_COST,
        FB_TRAINING_SAFETY,
    ]
    shifts = [
        FB_SHIFT_CAFE_MORNING,
        FB_SHIFT_CAFE_AFTERNOON,
        FB_SHIFT_BAR_DAY,
        FB_SHIFT_BAR_NIGHT,
        FB_SHIFT_KITCHEN_PREP,
        FB_SHIFT_KITCHEN_LUNCH,
    ]
    repair_manuals = [
        FB_REPAIR_ESPRESSO,
        FB_REPAIR_DRAFT_BEER,
        FB_REPAIR_WALK_IN_COOLER,
        FB_REPAIR_POS,
        FB_REPAIR_HVAC,
    ]
    return forms + checklists + audits + issue_cats + workflows + training + shifts + repair_manuals + _fb_badges()


def _bakery_items():
    forms = [
        FB_FORM_FOOD_COST_WASTE,
        # No Reservation & Covers Log
        FB_FORM_FOH_HANDOVER,
        FB_FORM_EQUIPMENT_MAINTENANCE,
        # No Bar Inventory
        FB_FORM_INVENTORY_KITCHEN,
        FB_FORM_PRODUCTION_SCHEDULE,  # bakery exclusive
        FB_FORM_BAKERY_WASTE_LOG,     # bakery exclusive
    ]
    checklists = [
        FB_CHECKLIST_FOH_OPENING_BAKERY,  # no bar section
        FB_CHECKLIST_BOH_OPENING,
        FB_CHECKLIST_FOH_CLOSING_BAKERY,  # no bar section
        FB_CHECKLIST_BOH_CLOSING,
        FB_CHECKLIST_TEMP_MONITORING,
        FB_CHECKLIST_ALLERGEN_CHECK,
    ]
    audits = [
        # No Table Service audit, no Bar Operations audit
        FB_AUDIT_KITCHEN_HYGIENE,
        FB_AUDIT_FACILITY_SAFETY,
        FB_AUDIT_DISPLAY_CASE,    # bakery exclusive
    ]
    issue_cats = [
        FB_ISSUE_GUEST_COMPLAINT,
        FB_ISSUE_FOOD_QUALITY,
        FB_ISSUE_EQUIPMENT_FAILURE,
        FB_ISSUE_SUPPLY_SHORTAGE,
        # No Bar Issue
        FB_ISSUE_STAFF,
        FB_ISSUE_SECURITY,
        FB_ISSUE_PEST,
        FB_ISSUE_IT,
    ]
    workflows = [
        FB_WF_GUEST_COMPLAINT,
        FB_WF_EQUIPMENT_REPAIR,
        FB_WF_ONBOARDING_FOH_BAKERY,  # counter service version, no table service
        FB_WF_ONBOARDING_BOH,
        # No Bar Onboarding
    ]
    training = [
        FB_TRAINING_COUNTER_SERVICE,  # replaces Table Service for bakery
        FB_TRAINING_FOOD_SAFETY,
        FB_TRAINING_ALLERGEN,
        # No Bar & Beverage Service
        # No Responsible Alcohol Service
        FB_TRAINING_KITCHEN_OPS,
        FB_TRAINING_POS,
        FB_TRAINING_FOOD_COST,
        FB_TRAINING_SAFETY,
    ]
    shifts = [
        FB_SHIFT_BAKERY_PRODUCTION,
        FB_SHIFT_BAKERY_SHOP,
        FB_SHIFT_KITCHEN_PREP,    # BOH prep still needed
    ]
    repair_manuals = [
        FB_REPAIR_COMMERCIAL_OVEN,
        FB_REPAIR_DOUGH_MIXER,
        FB_REPAIR_PROOFING_CABINET,
        FB_REPAIR_WALK_IN_COOLER,
    ]
    return forms + checklists + audits + issue_cats + workflows + training + shifts + repair_manuals + _fb_badges()


# ── SEED FUNCTION ─────────────────────────────────────────────────────────────

PACKAGES = [
    {
        "code": "casual_dining",
        "name": "Casual Dining Restaurant",
        "description": (
            "Full operations package for casual dining restaurants with table service. "
            "Covers FOH/BOH separation, reservations, bar operations, food cost tracking, "
            "and compliance audits aligned with Philippine DOLE and food safety standards."
        ),
        "items_fn": _casual_dining_items,
    },
    {
        "code": "full_service_restaurant",
        "name": "Full-Service Restaurant",
        "description": (
            "Extended package for full-service and fine dining restaurants. "
            "Includes all casual dining content plus plating standards audit and "
            "wine pairing fields in the table service quality audit."
        ),
        "items_fn": _full_service_items,
    },
    {
        "code": "cafe_bar",
        "name": "Cafe & Bar",
        "description": (
            "Operations package for cafes, bars, and coffee shops. "
            "Counter service focus replaces table service audit. "
            "Includes espresso quality checks, responsible alcohol service, "
            "and bar-focused onboarding workflows."
        ),
        "items_fn": _cafe_bar_items,
    },
    {
        "code": "bakery",
        "name": "Bakery & Pastry",
        "description": (
            "Operations package for bakeries and pastry shops. "
            "Includes production scheduling, display case auditing, waste logging, "
            "and early-morning shift templates. All bar and alcohol content excluded."
        ),
        "items_fn": _bakery_items,
    },
]


def seed():
    supabase = get_supabase()

    for pkg in PACKAGES:
        print(f"\nSeeding {pkg['name']} ({pkg['code']})...")

        pkg_res = supabase.table("industry_packages").upsert(
            {
                "industry_code": pkg["code"],
                "name": pkg["name"],
                "description": pkg["description"],
                "version": 1,
                "is_active": True,
            },
            on_conflict="industry_code,version",
        ).execute()

        package_id = pkg_res.data[0]["id"]
        print(f"  Package ID: {package_id}")

        # Clean re-seed
        supabase.table("template_items").delete().eq("package_id", package_id).execute()

        items = pkg["items_fn"]()
        inserted = 0
        by_cat: dict[str, int] = {}

        for item in items:
            supabase.table("template_items").insert({
                "package_id": package_id,
                "category": item["category"],
                "name": item["name"],
                "description": item.get("description"),
                "content": item["content"],
                "is_recommended": item.get("is_recommended", True),
                "sort_order": item.get("sort_order", 0),
            }).execute()
            inserted += 1
            by_cat[item["category"]] = by_cat.get(item["category"], 0) + 1

        print(f"  ✓ {inserted} templates inserted")
        for cat, count in sorted(by_cat.items()):
            print(f"    [{cat}] {count}")

    print("\n✓ All F&B packages seeded.")


if __name__ == "__main__":
    seed()
