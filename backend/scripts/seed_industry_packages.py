"""
Seed script: Industry Packages for AI-First Onboarding
Run from backend/ directory:
  python scripts/seed_industry_packages.py

Seeds the QSR package with all required templates.
Safe to re-run: upserts on (industry_code, version).
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
from services.supabase_client import get_supabase


# ── QSR Template Content ───────────────────────────────────────────────────────

QSR_FORMS = [
    {
        "name": "Daily Store Opening Checklist",
        "description": "Complete before store opens to customers. Covers equipment, cleanliness, cash, and safety.",
        "category": "checklist",
        "is_recommended": True,
        "sort_order": 1,
        "content": {
            "type": "checklist",
            "title": "Daily Store Opening Checklist",
            "description": "Complete before store opens to customers",
            "sections": [
                {
                    "title": "Equipment Readiness",
                    "fields": [
                        {"type": "checkbox", "label": "Fryers pre-heated to operating temperature", "required": True},
                        {"type": "checkbox", "label": "POS terminals powered on and tested", "required": True},
                        {"type": "checkbox", "label": "Beverage machines calibrated and dispensing correctly", "required": True},
                        {"type": "number", "label": "Walk-in cooler temperature (°C)", "required": True, "validation": {"min": 0, "max": 5}},
                        {"type": "number", "label": "Freezer temperature (°C)", "required": True, "validation": {"min": -20, "max": -15}},
                        {"type": "checkbox", "label": "Drive-through headsets charged and operational", "required": True},
                    ]
                },
                {
                    "title": "Cleanliness & Sanitation",
                    "fields": [
                        {"type": "checkbox", "label": "Dining area tables wiped and sanitized", "required": True},
                        {"type": "checkbox", "label": "Restrooms cleaned, stocked, and odor-free", "required": True},
                        {"type": "checkbox", "label": "Kitchen floor mopped and dry", "required": True},
                        {"type": "checkbox", "label": "Grease traps checked and not overflowing", "required": True},
                        {"type": "checkbox", "label": "Handwashing stations stocked with soap and paper towels", "required": True},
                    ]
                },
                {
                    "title": "Cash & Security",
                    "fields": [
                        {"type": "number", "label": "Starting cash drawer amount (PHP)", "required": True},
                        {"type": "checkbox", "label": "Safe secured and balance verified", "required": True},
                        {"type": "checkbox", "label": "CCTV cameras operational", "required": True},
                        {"type": "checkbox", "label": "Back door secured and alarmed", "required": True},
                    ]
                },
                {
                    "title": "Inventory Quick Check",
                    "fields": [
                        {"type": "checkbox", "label": "Key ingredients stocked for opening rush", "required": True},
                        {"type": "checkbox", "label": "Packaging materials sufficient for the shift", "required": True},
                        {"type": "text", "label": "Items to reorder today (if any)", "required": False},
                    ]
                },
            ],
            "scoring": None,
            "requires_signature": True,
            "requires_photo": False,
        }
    },
    {
        "name": "Daily Store Closing Checklist",
        "description": "Complete before locking up. Ensures safety, cleanliness, and secure handover.",
        "category": "checklist",
        "is_recommended": True,
        "sort_order": 2,
        "content": {
            "type": "checklist",
            "title": "Daily Store Closing Checklist",
            "description": "Complete before locking up",
            "sections": [
                {
                    "title": "Equipment Shutdown",
                    "fields": [
                        {"type": "checkbox", "label": "All fryers drained and secured (or covered if not drained)", "required": True},
                        {"type": "checkbox", "label": "Grills cleaned and powered off", "required": True},
                        {"type": "checkbox", "label": "Beverage machines flushed and sanitized", "required": True},
                        {"type": "checkbox", "label": "POS terminals logged out and secured", "required": True},
                        {"type": "checkbox", "label": "All non-essential lighting switched off", "required": True},
                    ]
                },
                {
                    "title": "Deep Cleaning",
                    "fields": [
                        {"type": "checkbox", "label": "Kitchen surfaces degreased and sanitized", "required": True},
                        {"type": "checkbox", "label": "Restrooms deep-cleaned and restocked for next day", "required": True},
                        {"type": "checkbox", "label": "Dining area swept, mopped, and chairs stacked", "required": True},
                        {"type": "checkbox", "label": "Trash emptied and bins cleaned", "required": True},
                        {"type": "checkbox", "label": "Drive-through lane cleared and cleaned", "required": True},
                    ]
                },
                {
                    "title": "Cash & Inventory",
                    "fields": [
                        {"type": "number", "label": "End-of-day cash count (PHP)", "required": True},
                        {"type": "checkbox", "label": "Cash balanced against POS report", "required": True},
                        {"type": "checkbox", "label": "Excess cash dropped in safe", "required": True},
                        {"type": "checkbox", "label": "Inventory waste logged in system", "required": True},
                    ]
                },
                {
                    "title": "Security",
                    "fields": [
                        {"type": "checkbox", "label": "All doors and windows locked", "required": True},
                        {"type": "checkbox", "label": "Alarm armed", "required": True},
                        {"type": "checkbox", "label": "CCTV confirmed recording", "required": True},
                        {"type": "text", "label": "Closing manager name & time", "required": True},
                    ]
                },
            ],
            "scoring": None,
            "requires_signature": True,
            "requires_photo": False,
        }
    },
    {
        "name": "Food Safety & Hygiene Audit",
        "description": "Scored audit covering temperature control, food handling, storage, and sanitation. HACCP-aligned.",
        "category": "audit",
        "is_recommended": True,
        "sort_order": 3,
        "content": {
            "type": "audit",
            "title": "Food Safety & Hygiene Audit",
            "description": "HACCP-aligned food safety audit. Each section scored pass/fail.",
            "sections": [
                {
                    "title": "Temperature Control",
                    "weight": 30,
                    "fields": [
                        {"type": "pass_fail", "label": "Cold storage ≤ 5°C verified with probe thermometer", "required": True},
                        {"type": "pass_fail", "label": "Hot holding food maintained at ≥ 60°C", "required": True},
                        {"type": "pass_fail", "label": "Raw meat stored below cooked food in refrigerator", "required": True},
                        {"type": "number", "label": "Walk-in cooler temp at time of audit (°C)", "required": True},
                        {"type": "number", "label": "Freezer temp at time of audit (°C)", "required": True},
                    ]
                },
                {
                    "title": "Personal Hygiene",
                    "weight": 25,
                    "fields": [
                        {"type": "pass_fail", "label": "All food handlers wearing clean uniforms and hair nets", "required": True},
                        {"type": "pass_fail", "label": "No jewelry on food handlers (except plain wedding band)", "required": True},
                        {"type": "pass_fail", "label": "Proper handwashing observed before food handling", "required": True},
                        {"type": "pass_fail", "label": "Gloves used when handling ready-to-eat foods", "required": True},
                    ]
                },
                {
                    "title": "Food Storage & Handling",
                    "weight": 25,
                    "fields": [
                        {"type": "pass_fail", "label": "All food items properly labeled with date and time", "required": True},
                        {"type": "pass_fail", "label": "FIFO (First In, First Out) method followed", "required": True},
                        {"type": "pass_fail", "label": "No expired products in storage", "required": True},
                        {"type": "pass_fail", "label": "Thawing done in refrigerator or cold water (not counter)", "required": True},
                    ]
                },
                {
                    "title": "Facility & Equipment Sanitation",
                    "weight": 20,
                    "fields": [
                        {"type": "pass_fail", "label": "Food contact surfaces sanitized with approved solution", "required": True},
                        {"type": "pass_fail", "label": "Sanitizer concentration at correct PPM (verified with test strips)", "required": True},
                        {"type": "pass_fail", "label": "Dishwasher/sanitizing machine temperature verified", "required": True},
                        {"type": "pass_fail", "label": "No pest evidence (droppings, burrow holes, live pests)", "required": True},
                    ]
                },
            ],
            "scoring": {
                "type": "weighted_pass_fail",
                "passing_threshold": 85,
                "critical_items": ["No expired products in storage", "No pest evidence"],
            },
            "requires_signature": True,
            "requires_photo": True,
        }
    },
    {
        "name": "Customer Service Quality Audit",
        "description": "Mystery-shopper-style audit. Rates speed, accuracy, friendliness, and cleanliness on a 1-5 scale.",
        "category": "audit",
        "is_recommended": True,
        "sort_order": 4,
        "content": {
            "type": "audit",
            "title": "Customer Service Quality Audit",
            "description": "Rate each item 1 (poor) to 5 (excellent)",
            "sections": [
                {
                    "title": "Speed of Service",
                    "weight": 25,
                    "fields": [
                        {"type": "rating", "label": "Drive-through wait time (1=over 5min, 5=under 90sec)", "required": True, "scale": 5},
                        {"type": "rating", "label": "Counter service wait time", "required": True, "scale": 5},
                        {"type": "rating", "label": "Order accuracy speed (kitchen output rate)", "required": True, "scale": 5},
                    ]
                },
                {
                    "title": "Order Accuracy",
                    "weight": 30,
                    "fields": [
                        {"type": "rating", "label": "Order taken correctly (no missed items)", "required": True, "scale": 5},
                        {"type": "rating", "label": "Correct items in bag/tray", "required": True, "scale": 5},
                        {"type": "rating", "label": "Condiments and sides included as ordered", "required": True, "scale": 5},
                    ]
                },
                {
                    "title": "Staff Friendliness",
                    "weight": 25,
                    "fields": [
                        {"type": "rating", "label": "Greeted warmly upon arrival", "required": True, "scale": 5},
                        {"type": "rating", "label": "Staff maintained eye contact and smiled", "required": True, "scale": 5},
                        {"type": "rating", "label": "Handled complaints professionally (if applicable)", "required": False, "scale": 5},
                    ]
                },
                {
                    "title": "Cleanliness (Customer-Visible)",
                    "weight": 20,
                    "fields": [
                        {"type": "rating", "label": "Dining area clean and tables cleared promptly", "required": True, "scale": 5},
                        {"type": "rating", "label": "Restrooms clean and well-stocked", "required": True, "scale": 5},
                        {"type": "rating", "label": "Counter and drink station clean", "required": True, "scale": 5},
                    ]
                },
            ],
            "scoring": {
                "type": "weighted_average",
                "max_score": 5,
                "passing_threshold": 3.5,
            },
            "requires_signature": False,
            "requires_photo": False,
        }
    },
    {
        "name": "Inventory Count Sheet",
        "description": "Weekly physical inventory count for all key ingredients and packaging materials.",
        "category": "form",
        "is_recommended": True,
        "sort_order": 5,
        "content": {
            "type": "form",
            "title": "Weekly Inventory Count Sheet",
            "description": "Record actual physical counts. System will calculate variance vs. theoretical.",
            "sections": [
                {
                    "title": "Proteins & Proteins",
                    "fields": [
                        {"type": "number", "label": "Chicken pieces (raw, kg)", "required": True},
                        {"type": "number", "label": "Beef patties (frozen, units)", "required": True},
                        {"type": "number", "label": "Fish fillet (frozen, kg)", "required": True},
                        {"type": "number", "label": "Hotdogs (packs)", "required": True},
                    ]
                },
                {
                    "title": "Produce & Dairy",
                    "fields": [
                        {"type": "number", "label": "Lettuce heads (units)", "required": True},
                        {"type": "number", "label": "Tomatoes (kg)", "required": True},
                        {"type": "number", "label": "Cheese slices (packs of 20)", "required": True},
                        {"type": "number", "label": "Eggs (trays of 30)", "required": True},
                    ]
                },
                {
                    "title": "Dry Goods & Packaging",
                    "fields": [
                        {"type": "number", "label": "Burger buns (packs)", "required": True},
                        {"type": "number", "label": "Fry boxes (small, units)", "required": True},
                        {"type": "number", "label": "Fry boxes (large, units)", "required": True},
                        {"type": "number", "label": "Paper bags (units)", "required": True},
                        {"type": "number", "label": "Drink cups (medium, units)", "required": True},
                        {"type": "number", "label": "Drink cups (large, units)", "required": True},
                    ]
                },
                {
                    "title": "Beverages",
                    "fields": [
                        {"type": "number", "label": "Soft drink syrup (liters)", "required": True},
                        {"type": "number", "label": "Coffee beans (kg)", "required": True},
                        {"type": "number", "label": "Juice concentrate (liters)", "required": True},
                    ]
                },
                {
                    "title": "Audit Info",
                    "fields": [
                        {"type": "text", "label": "Counted by (name)", "required": True},
                        {"type": "text", "label": "Verified by (manager name)", "required": True},
                        {"type": "textarea", "label": "Discrepancy notes", "required": False},
                    ]
                },
            ],
            "scoring": None,
            "requires_signature": True,
            "requires_photo": False,
        }
    },
    {
        "name": "Equipment Maintenance Log",
        "description": "Log routine equipment maintenance activities. Tracks who did what and when.",
        "category": "form",
        "is_recommended": True,
        "sort_order": 6,
        "content": {
            "type": "form",
            "title": "Equipment Maintenance Log",
            "description": "Record all routine and corrective maintenance activities",
            "sections": [
                {
                    "title": "Equipment Details",
                    "fields": [
                        {"type": "select", "label": "Equipment", "required": True, "options": [
                            "Deep Fryer #1", "Deep Fryer #2", "Grill", "Soft Serve Machine",
                            "Espresso Machine", "Drive-Through Headset System", "POS Terminal",
                            "Walk-in Cooler", "Freezer", "HVAC", "Fire Suppression System", "Other"
                        ]},
                        {"type": "text", "label": "Equipment serial number / ID (if known)", "required": False},
                        {"type": "select", "label": "Maintenance type", "required": True, "options": [
                            "Routine cleaning", "Filter replacement", "Oil change / drain",
                            "Calibration", "Repair / corrective", "Preventive", "Inspection"
                        ]},
                    ]
                },
                {
                    "title": "Work Done",
                    "fields": [
                        {"type": "textarea", "label": "Description of work performed", "required": True},
                        {"type": "checkbox", "label": "Parts replaced", "required": False},
                        {"type": "text", "label": "Parts replaced (describe)", "required": False},
                        {"type": "checkbox", "label": "Equipment tested after maintenance and working correctly", "required": True},
                    ]
                },
                {
                    "title": "Sign-Off",
                    "fields": [
                        {"type": "text", "label": "Technician / staff name", "required": True},
                        {"type": "text", "label": "Supervisor / manager name", "required": True},
                        {"type": "text", "label": "Next scheduled maintenance date", "required": False},
                    ]
                },
            ],
            "scoring": None,
            "requires_signature": True,
            "requires_photo": True,
        }
    },
    {
        "name": "Cleanliness & Sanitation Checklist",
        "description": "Mid-shift sanitation checklist. Ensures cleaning standards are maintained throughout the day.",
        "category": "checklist",
        "is_recommended": True,
        "sort_order": 7,
        "content": {
            "type": "checklist",
            "title": "Mid-Shift Cleanliness & Sanitation Checklist",
            "description": "Complete every 2 hours during operating hours",
            "sections": [
                {
                    "title": "Kitchen",
                    "fields": [
                        {"type": "checkbox", "label": "All food contact surfaces wiped with sanitizer", "required": True},
                        {"type": "checkbox", "label": "Fryer surroundings free of grease splatter", "required": True},
                        {"type": "checkbox", "label": "Floors free of spills and debris", "required": True},
                        {"type": "checkbox", "label": "Sanitizer buckets refreshed (correct concentration)", "required": True},
                        {"type": "checkbox", "label": "Waste bins not overflowing", "required": True},
                    ]
                },
                {
                    "title": "Dining Area",
                    "fields": [
                        {"type": "checkbox", "label": "All tables cleaned after each customer", "required": True},
                        {"type": "checkbox", "label": "Floor swept and spot-mopped as needed", "required": True},
                        {"type": "checkbox", "label": "Tray return area clear", "required": True},
                        {"type": "checkbox", "label": "Condiment station stocked and clean", "required": True},
                    ]
                },
                {
                    "title": "Restrooms",
                    "fields": [
                        {"type": "checkbox", "label": "Restrooms checked and cleaned", "required": True},
                        {"type": "checkbox", "label": "Soap and paper towels refilled", "required": True},
                        {"type": "checkbox", "label": "No unpleasant odors", "required": True},
                    ]
                },
            ],
            "scoring": None,
            "requires_signature": False,
            "requires_photo": False,
        }
    },
    {
        "name": "Cash Handling Audit",
        "description": "Daily cash audit. Documents opening, closing, and mid-shift cash positions to detect discrepancies early.",
        "category": "audit",
        "is_recommended": True,
        "sort_order": 8,
        "content": {
            "type": "audit",
            "title": "Cash Handling Audit",
            "description": "Complete at shift change and end of day",
            "sections": [
                {
                    "title": "Cash Count",
                    "fields": [
                        {"type": "number", "label": "1,000-peso bills (count)", "required": True},
                        {"type": "number", "label": "500-peso bills (count)", "required": True},
                        {"type": "number", "label": "100-peso bills (count)", "required": True},
                        {"type": "number", "label": "50-peso bills (count)", "required": True},
                        {"type": "number", "label": "20-peso bills (count)", "required": True},
                        {"type": "number", "label": "Coins total (PHP)", "required": True},
                        {"type": "number", "label": "Total cash in drawer (PHP)", "required": True},
                    ]
                },
                {
                    "title": "Reconciliation",
                    "fields": [
                        {"type": "number", "label": "Expected cash per POS report (PHP)", "required": True},
                        {"type": "number", "label": "Variance (over/short) (PHP)", "required": True},
                        {"type": "pass_fail", "label": "Variance within acceptable range (±PHP 50)", "required": True},
                        {"type": "textarea", "label": "Explanation for variance (if any)", "required": False},
                    ]
                },
                {
                    "title": "Certification",
                    "fields": [
                        {"type": "text", "label": "Cashier name", "required": True},
                        {"type": "text", "label": "Supervisor name", "required": True},
                    ]
                },
            ],
            "scoring": {
                "type": "pass_fail",
                "critical_items": ["Variance within acceptable range (±PHP 50)"],
            },
            "requires_signature": True,
            "requires_photo": False,
        }
    },
    {
        "name": "Delivery / Receiving Checklist",
        "description": "Verify incoming deliveries for quality, quantity, and temperature compliance before accepting.",
        "category": "checklist",
        "is_recommended": True,
        "sort_order": 9,
        "content": {
            "type": "checklist",
            "title": "Delivery / Receiving Checklist",
            "description": "Complete for every incoming delivery before accepting goods",
            "sections": [
                {
                    "title": "Delivery Vehicle & Driver",
                    "fields": [
                        {"type": "checkbox", "label": "Delivery vehicle is clean and refrigerated (for cold items)", "required": True},
                        {"type": "checkbox", "label": "Driver has proper ID and delivery documentation", "required": True},
                    ]
                },
                {
                    "title": "Temperature Check",
                    "fields": [
                        {"type": "number", "label": "Refrigerated items delivery temp (°C) — must be ≤ 5°C", "required": True},
                        {"type": "number", "label": "Frozen items delivery temp (°C) — must be ≤ -15°C", "required": True},
                        {"type": "pass_fail", "label": "All temperature requirements met", "required": True},
                    ]
                },
                {
                    "title": "Product Inspection",
                    "fields": [
                        {"type": "checkbox", "label": "Quantities match purchase order", "required": True},
                        {"type": "checkbox", "label": "No damaged packaging", "required": True},
                        {"type": "checkbox", "label": "All products within expiry / best-before date", "required": True},
                        {"type": "checkbox", "label": "No signs of pest damage or contamination", "required": True},
                    ]
                },
                {
                    "title": "Action",
                    "fields": [
                        {"type": "select", "label": "Delivery accepted?", "required": True, "options": [
                            "Accepted in full", "Accepted with exceptions", "Rejected — returned to supplier"
                        ]},
                        {"type": "textarea", "label": "Notes / exceptions", "required": False},
                        {"type": "text", "label": "Receiver name", "required": True},
                    ]
                },
            ],
            "scoring": None,
            "requires_signature": True,
            "requires_photo": True,
        }
    },
    {
        "name": "Facility Safety Inspection",
        "description": "Monthly safety walkthrough. Covers fire safety, slip hazards, emergency equipment, and exits.",
        "category": "audit",
        "is_recommended": True,
        "sort_order": 10,
        "content": {
            "type": "audit",
            "title": "Facility Safety Inspection",
            "description": "Monthly safety walkthrough — DOLE and BFP compliance",
            "sections": [
                {
                    "title": "Fire Safety",
                    "weight": 30,
                    "fields": [
                        {"type": "pass_fail", "label": "Fire extinguishers charged and accessible", "required": True},
                        {"type": "pass_fail", "label": "Fire suppression system (Ansul) last serviced within 6 months", "required": True},
                        {"type": "pass_fail", "label": "Fire exits unobstructed and clearly marked", "required": True},
                        {"type": "pass_fail", "label": "Emergency lighting tested and functional", "required": True},
                    ]
                },
                {
                    "title": "Slip & Trip Hazards",
                    "weight": 25,
                    "fields": [
                        {"type": "pass_fail", "label": "All wet floor areas have warning signs", "required": True},
                        {"type": "pass_fail", "label": "Anti-slip mats in place at entrances and kitchen", "required": True},
                        {"type": "pass_fail", "label": "Electrical cords not crossing walkways", "required": True},
                    ]
                },
                {
                    "title": "First Aid & Emergency",
                    "weight": 25,
                    "fields": [
                        {"type": "pass_fail", "label": "First aid kit stocked and accessible", "required": True},
                        {"type": "pass_fail", "label": "Emergency contact numbers posted at counter", "required": True},
                        {"type": "pass_fail", "label": "At least one staff member has valid first aid cert", "required": True},
                    ]
                },
                {
                    "title": "Electrical & Gas",
                    "weight": 20,
                    "fields": [
                        {"type": "pass_fail", "label": "No exposed wiring visible", "required": True},
                        {"type": "pass_fail", "label": "Gas lines inspected — no leaks (smell test)", "required": True},
                        {"type": "pass_fail", "label": "Electrical panel accessible and labeled", "required": True},
                    ]
                },
            ],
            "scoring": {
                "type": "weighted_pass_fail",
                "passing_threshold": 90,
                "critical_items": [
                    "Fire extinguishers charged and accessible",
                    "Fire exits unobstructed and clearly marked",
                    "Gas lines inspected — no leaks (smell test)",
                ],
            },
            "requires_signature": True,
            "requires_photo": True,
        }
    },
]

QSR_ISSUE_CATEGORIES = [
    {
        "name": "Equipment Failure",
        "description": "Broken or malfunctioning kitchen and store equipment",
        "category": "issue_category",
        "is_recommended": True,
        "sort_order": 1,
        "content": {
            "category_name": "Equipment Failure",
            "default_priority": "high",
            "subcategories": [
                "Fryer malfunction", "POS terminal down", "HVAC not working",
                "Refrigeration failure", "Lighting outage", "Drive-through speaker broken",
                "Ice machine failure", "Espresso machine breakdown", "Dishwasher failure"
            ],
            "auto_route_to": "manager",
            "sla_hours": 4,
            "icon": "wrench",
        }
    },
    {
        "name": "Food Safety Violation",
        "description": "Any food safety breach requiring immediate action",
        "category": "issue_category",
        "is_recommended": True,
        "sort_order": 2,
        "content": {
            "category_name": "Food Safety Violation",
            "default_priority": "critical",
            "subcategories": [
                "Temperature out of range", "Cross-contamination observed", "Expired product served/found",
                "Pest sighting", "Improper food storage", "Personal hygiene violation"
            ],
            "auto_route_to": "manager",
            "sla_hours": 1,
            "icon": "alert-triangle",
        }
    },
    {
        "name": "Customer Complaint",
        "description": "Complaints from customers about food, service, or facilities",
        "category": "issue_category",
        "is_recommended": True,
        "sort_order": 3,
        "content": {
            "category_name": "Customer Complaint",
            "default_priority": "medium",
            "subcategories": [
                "Wrong order", "Food quality issue", "Long wait time",
                "Rude staff", "Dirty premises", "Foreign object in food", "Billing error"
            ],
            "auto_route_to": "manager",
            "sla_hours": 2,
            "icon": "message-circle",
        }
    },
    {
        "name": "Supply Shortage",
        "description": "Running low or out of key ingredients or packaging",
        "category": "issue_category",
        "is_recommended": True,
        "sort_order": 4,
        "content": {
            "category_name": "Supply Shortage",
            "default_priority": "medium",
            "subcategories": [
                "Protein shortage (chicken/beef)", "Produce shortage", "Packaging shortage",
                "Beverage supply low", "Condiments running out", "Cleaning supplies depleted"
            ],
            "auto_route_to": "manager",
            "sla_hours": 8,
            "icon": "package",
        }
    },
    {
        "name": "Facility Damage",
        "description": "Physical damage to the store interior or exterior",
        "category": "issue_category",
        "is_recommended": True,
        "sort_order": 5,
        "content": {
            "category_name": "Facility Damage",
            "default_priority": "medium",
            "subcategories": [
                "Broken furniture", "Damaged flooring", "Roof/ceiling leak",
                "Broken signage", "Graffiti", "Parking area damage"
            ],
            "auto_route_to": "manager",
            "sla_hours": 24,
            "icon": "building",
        }
    },
    {
        "name": "Staff Issue",
        "description": "Staffing and HR-related operational issues",
        "category": "issue_category",
        "is_recommended": True,
        "sort_order": 6,
        "content": {
            "category_name": "Staff Issue",
            "default_priority": "medium",
            "subcategories": [
                "No-show / absence", "Late arrival", "Uniform non-compliance",
                "Performance concern", "Conflict between staff", "Injury on duty"
            ],
            "auto_route_to": "manager",
            "sla_hours": 4,
            "icon": "users",
        }
    },
    {
        "name": "Security Incident",
        "description": "Theft, vandalism, suspicious activity, or safety threats",
        "category": "issue_category",
        "is_recommended": True,
        "sort_order": 7,
        "content": {
            "category_name": "Security Incident",
            "default_priority": "critical",
            "subcategories": [
                "Customer theft", "Employee theft", "Robbery / hold-up",
                "Vandalism", "Suspicious person", "CCTV not recording"
            ],
            "auto_route_to": "manager",
            "sla_hours": 1,
            "icon": "shield",
        }
    },
    {
        "name": "IT / System Issue",
        "description": "POS, network, printer, or software problems affecting operations",
        "category": "issue_category",
        "is_recommended": True,
        "sort_order": 8,
        "content": {
            "category_name": "IT / System Issue",
            "default_priority": "high",
            "subcategories": [
                "POS system down", "Receipt printer failure", "Internet outage",
                "Online ordering not working", "KDS (Kitchen Display) offline", "Card reader failure"
            ],
            "auto_route_to": "manager",
            "sla_hours": 2,
            "icon": "monitor",
        }
    },
]

QSR_WORKFLOWS = [
    {
        "name": "New Hire Onboarding",
        "description": "Assigns mandatory training when a new staff member is created, waits for completion, then prompts manager to schedule a shadow shift",
        "category": "workflow",
        "is_recommended": True,
        "sort_order": 1,
        "content": {
            "workflow_name": "New Hire Onboarding",
            "trigger": {
                "type": "employee_created",
                "conditions": {"roles": ["staff"]},
            },
            "stages": [
                {
                    "type": "assign_training",
                    "name": "Assign Onboarding Training",
                    "assigned_role": "manager",
                    "course_refs": [
                        "Food Safety Fundamentals",
                        "POS System Training",
                        "Customer Service Excellence",
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
                    "message": "{employee.name} has completed all onboarding training",
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
    },
    {
        "name": "Equipment Repair Request",
        "description": "Routes equipment failure issues through manager assessment, a maintenance log form, and admin sign-off",
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
                    "title": "Assess equipment failure: {issue.title} at {location.name}",
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
                    "name": "Admin Review",
                    "assigned_role": "admin",
                    "is_final": True,
                },
            ],
        },
    },
]

QSR_TRAINING = [
    {
        "name": "Food Safety Fundamentals",
        "description": "HACCP-aligned food safety training. Mandatory for all food handlers. Covers temperature control, contamination prevention, and personal hygiene.",
        "category": "training_module",
        "is_recommended": True,
        "sort_order": 1,
        "content": {
            "module_name": "Food Safety Fundamentals",
            "format": "interactive_quiz",
            "estimated_minutes": 25,
            "auto_assign_on_hire": True,
            "target_roles": ["staff", "manager"],
            "sections": [
                {"title": "Temperature Control", "content_type": "text_with_images", "quiz_questions": 5},
                {"title": "Personal Hygiene", "content_type": "text_with_images", "quiz_questions": 3},
                {"title": "Cross-Contamination Prevention", "content_type": "text_with_images", "quiz_questions": 4},
                {"title": "FIFO & Labeling", "content_type": "text_with_images", "quiz_questions": 3},
            ],
            "passing_score": 80,
            "certificate_on_pass": True,
            "renewal_days": 365,
        }
    },
    {
        "name": "Customer Service Excellence",
        "description": "Brand standards for customer interaction, complaint handling, and service recovery. Aligns with QSR service model.",
        "category": "training_module",
        "is_recommended": True,
        "sort_order": 2,
        "content": {
            "module_name": "Customer Service Excellence",
            "format": "interactive_quiz",
            "estimated_minutes": 20,
            "auto_assign_on_hire": True,
            "target_roles": ["staff", "manager"],
            "sections": [
                {"title": "The Service Promise", "content_type": "video_with_quiz", "quiz_questions": 3},
                {"title": "Taking Orders Correctly", "content_type": "text_with_images", "quiz_questions": 4},
                {"title": "Handling Complaints", "content_type": "scenario_based", "quiz_questions": 5},
                {"title": "Service Recovery", "content_type": "scenario_based", "quiz_questions": 3},
            ],
            "passing_score": 75,
            "certificate_on_pass": False,
            "renewal_days": 180,
        }
    },
    {
        "name": "POS System Training",
        "description": "How to operate the POS terminal: taking orders, voids, discounts, end-of-day reports, and troubleshooting common errors.",
        "category": "training_module",
        "is_recommended": True,
        "sort_order": 3,
        "content": {
            "module_name": "POS System Training",
            "format": "step_by_step",
            "estimated_minutes": 30,
            "auto_assign_on_hire": True,
            "target_roles": ["staff", "manager"],
            "sections": [
                {"title": "Starting Your Shift", "content_type": "step_by_step", "quiz_questions": 2},
                {"title": "Taking & Modifying Orders", "content_type": "step_by_step", "quiz_questions": 4},
                {"title": "Payments & Cash Handling", "content_type": "step_by_step", "quiz_questions": 5},
                {"title": "Voids, Refunds & Discounts", "content_type": "step_by_step", "quiz_questions": 4},
                {"title": "End of Day Reports", "content_type": "step_by_step", "quiz_questions": 3},
            ],
            "passing_score": 85,
            "certificate_on_pass": False,
            "renewal_days": 365,
        }
    },
    {
        "name": "Cash Handling Procedures",
        "description": "Secure cash handling, drawer management, counterfeit detection, and drop procedures to minimize shrinkage.",
        "category": "training_module",
        "is_recommended": True,
        "sort_order": 4,
        "content": {
            "module_name": "Cash Handling Procedures",
            "format": "interactive_quiz",
            "estimated_minutes": 15,
            "auto_assign_on_hire": True,
            "target_roles": ["staff", "manager"],
            "sections": [
                {"title": "Counting & Verifying Cash", "content_type": "text_with_images", "quiz_questions": 3},
                {"title": "Detecting Counterfeit Bills", "content_type": "text_with_images", "quiz_questions": 4},
                {"title": "Safe Drops & Deposits", "content_type": "text_with_images", "quiz_questions": 3},
                {"title": "Variance & Discrepancy Reporting", "content_type": "text_with_images", "quiz_questions": 3},
            ],
            "passing_score": 90,
            "certificate_on_pass": True,
            "renewal_days": 365,
        }
    },
    {
        "name": "Workplace Safety & Emergency Response",
        "description": "Fire safety, evacuation procedures, first aid basics, and incident reporting. Required for DOLE compliance.",
        "category": "training_module",
        "is_recommended": True,
        "sort_order": 5,
        "content": {
            "module_name": "Workplace Safety & Emergency Response",
            "format": "interactive_quiz",
            "estimated_minutes": 35,
            "auto_assign_on_hire": True,
            "target_roles": ["staff", "manager"],
            "sections": [
                {"title": "Fire Safety & Extinguisher Use", "content_type": "video_with_quiz", "quiz_questions": 5},
                {"title": "Evacuation Procedures", "content_type": "step_by_step", "quiz_questions": 3},
                {"title": "First Aid Basics", "content_type": "text_with_images", "quiz_questions": 4},
                {"title": "Incident Reporting", "content_type": "text_with_images", "quiz_questions": 3},
            ],
            "passing_score": 80,
            "certificate_on_pass": True,
            "renewal_days": 365,
        }
    },
    {
        "name": "Opening & Closing Procedures",
        "description": "Step-by-step guide for opening and closing managers. Covers cash, equipment, security, and checklist completion.",
        "category": "training_module",
        "is_recommended": True,
        "sort_order": 6,
        "content": {
            "module_name": "Opening & Closing Procedures",
            "format": "step_by_step",
            "estimated_minutes": 20,
            "auto_assign_on_hire": False,
            "target_roles": ["manager"],
            "sections": [
                {"title": "Pre-Opening Walkthrough", "content_type": "step_by_step", "quiz_questions": 3},
                {"title": "Activating Systems (POS, KDS, headsets)", "content_type": "step_by_step", "quiz_questions": 2},
                {"title": "End-of-Day Closing Sequence", "content_type": "step_by_step", "quiz_questions": 3},
                {"title": "Cash Drop & Safe Procedure", "content_type": "step_by_step", "quiz_questions": 3},
            ],
            "passing_score": 85,
            "certificate_on_pass": False,
            "renewal_days": 365,
        }
    },
    {
        "name": "Inventory Management Basics",
        "description": "How to conduct accurate stock counts, manage par levels, identify waste, and place reorder requests.",
        "category": "training_module",
        "is_recommended": True,
        "sort_order": 7,
        "content": {
            "module_name": "Inventory Management Basics",
            "format": "interactive_quiz",
            "estimated_minutes": 20,
            "auto_assign_on_hire": False,
            "target_roles": ["manager"],
            "sections": [
                {"title": "Understanding Par Levels", "content_type": "text_with_images", "quiz_questions": 3},
                {"title": "Conducting a Physical Count", "content_type": "step_by_step", "quiz_questions": 4},
                {"title": "Logging Waste & Spoilage", "content_type": "text_with_images", "quiz_questions": 3},
                {"title": "Placing Reorder Requests", "content_type": "step_by_step", "quiz_questions": 2},
            ],
            "passing_score": 75,
            "certificate_on_pass": False,
            "renewal_days": 365,
        }
    },
    {
        "name": "Brand Standards & Uniform Policy",
        "description": "Appearance standards, uniform requirements, personal hygiene expectations, and brand representation guidelines.",
        "category": "training_module",
        "is_recommended": True,
        "sort_order": 8,
        "content": {
            "module_name": "Brand Standards & Uniform Policy",
            "format": "interactive_quiz",
            "estimated_minutes": 10,
            "auto_assign_on_hire": True,
            "target_roles": ["staff", "manager"],
            "sections": [
                {"title": "Uniform Requirements", "content_type": "text_with_images", "quiz_questions": 3},
                {"title": "Personal Hygiene Standards", "content_type": "text_with_images", "quiz_questions": 3},
                {"title": "Brand Behaviour & Social Media Policy", "content_type": "text_with_images", "quiz_questions": 2},
            ],
            "passing_score": 80,
            "certificate_on_pass": False,
            "renewal_days": 365,
        }
    },
]

QSR_SHIFT_TEMPLATES = [
    {
        "name": "QSR Standard (3-shift)",
        "description": "Classic morning / mid / closing rotation for full-day operations",
        "category": "shift_template",
        "is_recommended": True,
        "sort_order": 1,
        "content": {
            "template_name": "QSR Standard (3-shift)",
            "shifts": [
                {"name": "Morning", "start": "06:00", "end": "14:00", "color": "#4CAF50"},
                {"name": "Mid", "start": "10:00", "end": "18:00", "color": "#2196F3"},
                {"name": "Closing", "start": "14:00", "end": "22:00", "color": "#9C27B0"},
            ],
            "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            "break_minutes": 60,
            "overtime_rules": "ph_dole_standard",
        }
    },
    {
        "name": "Extended Hours (16hr operation)",
        "description": "For stores open from early morning to late night — two long shifts",
        "category": "shift_template",
        "is_recommended": True,
        "sort_order": 2,
        "content": {
            "template_name": "Extended Hours (16hr operation)",
            "shifts": [
                {"name": "Day", "start": "06:00", "end": "14:00", "color": "#FF9800"},
                {"name": "Night", "start": "14:00", "end": "22:00", "color": "#3F51B5"},
            ],
            "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            "break_minutes": 60,
            "overtime_rules": "ph_dole_standard",
        }
    },
    {
        "name": "Split Shift (F&B Peak Hours)",
        "description": "For lean staffing during off-peak hours with full coverage at lunch and dinner",
        "category": "shift_template",
        "is_recommended": False,
        "sort_order": 3,
        "content": {
            "template_name": "Split Shift (F&B Peak Hours)",
            "shifts": [
                {"name": "Breakfast/Lunch", "start": "07:00", "end": "14:00", "color": "#E91E63"},
                {"name": "Afternoon", "start": "14:00", "end": "18:00", "color": "#9E9E9E"},
                {"name": "Dinner/Close", "start": "17:00", "end": "22:00", "color": "#795548"},
            ],
            "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            "break_minutes": 30,
            "overtime_rules": "ph_dole_standard",
        }
    },
]

QSR_REPAIR_MANUALS = [
    {
        "name": "Fryer Cleaning & Maintenance SOP",
        "description": "Daily and weekly deep-clean procedure for commercial deep fryers. Includes oil management.",
        "category": "repair_manual",
        "is_recommended": True,
        "sort_order": 1,
        "content": {
            "manual_name": "Fryer Cleaning & Maintenance SOP",
            "equipment_type": "deep_fryer",
            "linked_issue_categories": ["Equipment Failure"],
            "sections": [
                {
                    "title": "Daily Cleaning Procedure",
                    "frequency": "daily",
                    "steps": [
                        "Turn off fryer and allow oil to cool below 50°C (check with thermometer)",
                        "Drain oil into designated lidded container — label with date",
                        "Remove fry baskets and soak in degreaser solution for 15 minutes",
                        "Wipe fryer interior with approved food-safe degreaser",
                        "Rinse thoroughly with clean water — no soap residue",
                        "Dry completely before refilling",
                        "Refill with fresh or filtered oil to the fill line marked on the tank",
                        "Re-attach baskets and test heat-up cycle",
                    ]
                },
                {
                    "title": "Weekly Deep Clean",
                    "frequency": "weekly",
                    "steps": [
                        "Complete daily cleaning procedure first",
                        "Remove the heating elements (if removable model) and soak overnight",
                        "Use fryer boil-out tablet with water — boil for 20 minutes",
                        "Drain boil-out solution — do NOT use for cooking",
                        "Rinse three times with clean water",
                        "Inspect thermostat sensor for buildup — clean gently with non-abrasive pad",
                        "Check oil drain valve for leaks — notify manager if any found",
                        "Log completion in Equipment Maintenance Log",
                    ]
                },
                {
                    "title": "Oil Quality Check",
                    "frequency": "daily",
                    "steps": [
                        "Use fry quality test strips to check Total Polar Molecules (TPM)",
                        "If TPM > 24%, replace oil immediately regardless of colour",
                        "Check oil colour — discard if dark brown or black",
                        "Log oil replacement with date and quantity in maintenance log",
                    ]
                },
            ],
        }
    },
    {
        "name": "Espresso / Beverage Machine Calibration",
        "description": "Daily calibration and cleaning SOP for espresso and beverage dispensing equipment.",
        "category": "repair_manual",
        "is_recommended": True,
        "sort_order": 2,
        "content": {
            "manual_name": "Espresso / Beverage Machine Calibration",
            "equipment_type": "beverage_machine",
            "linked_issue_categories": ["Equipment Failure"],
            "sections": [
                {
                    "title": "Daily Backflush (Espresso Machine)",
                    "frequency": "daily",
                    "steps": [
                        "Insert blind basket into portafilter",
                        "Add approved espresso machine cleaner (1 tablet or 5g powder)",
                        "Run 5 backflush cycles of 10 seconds each",
                        "Remove blind basket, rinse portafilter thoroughly",
                        "Run 3 clean-water cycles to flush residue",
                        "Wipe group heads with a damp cloth",
                        "Pull test shot — discard, check for correct flow time (25-30 seconds for double)",
                    ]
                },
                {
                    "title": "Grinder Calibration",
                    "frequency": "daily",
                    "steps": [
                        "Pull a test espresso shot at start of each shift",
                        "Target: 25–30 seconds for a double shot (approx. 36g from 18g dose)",
                        "If extraction is too fast (under 20s) — adjust grinder finer (smaller number)",
                        "If extraction is too slow (over 35s) — adjust grinder coarser (larger number)",
                        "Document grind setting at start of day in maintenance log",
                    ]
                },
                {
                    "title": "Soft Drink / Beverage Dispenser Cleaning",
                    "frequency": "weekly",
                    "steps": [
                        "Disconnect all syrup lines",
                        "Flush each line with BIB (bag-in-box) sanitizer solution",
                        "Run clean water through for 2 minutes per line",
                        "Clean nozzles — soak in warm water for 30 minutes then scrub",
                        "Wipe dispenser head with sanitizer-dampened cloth",
                        "Reconnect syrup lines and run test dispense per flavour",
                    ]
                },
            ],
        }
    },
    {
        "name": "HVAC Filter Replacement SOP",
        "description": "Monthly air filter inspection and replacement procedure. Keeps kitchen ventilation effective and reduces fire risk.",
        "category": "repair_manual",
        "is_recommended": True,
        "sort_order": 3,
        "content": {
            "manual_name": "HVAC Filter Replacement SOP",
            "equipment_type": "hvac",
            "linked_issue_categories": ["Equipment Failure", "Facility Damage"],
            "sections": [
                {
                    "title": "Monthly Inspection",
                    "frequency": "monthly",
                    "steps": [
                        "Turn off HVAC unit before any filter work",
                        "Locate filter access panel (see store layout diagram)",
                        "Remove filter — inspect for dirt, grease buildup, or damage",
                        "Hold filter to light: if light is blocked completely, replace immediately",
                        "If reusable filter: wash with mild detergent, rinse, dry completely before reinstalling",
                        "If disposable filter: replace with same size/MERV rating filter",
                        "Note: Kitchen hood filters should be cleaned weekly (separate SOP)",
                        "Log inspection and any replacement in maintenance log",
                    ]
                },
                {
                    "title": "Kitchen Hood / Grease Filter",
                    "frequency": "weekly",
                    "steps": [
                        "Allow hood and filters to cool completely before handling",
                        "Remove grease filters from hood — handle with gloves",
                        "Soak filters in hot water + commercial degreaser for 20 minutes",
                        "Scrub with non-abrasive brush until grease-free",
                        "Rinse with hot water, drain, dry before reinstalling",
                        "Check hood fan belt condition — replace if cracked or worn",
                        "Log completion in maintenance log",
                    ]
                },
            ],
        }
    },
    {
        "name": "Emergency Procedures (Fire / Robbery / Medical)",
        "description": "Quick-reference emergency response procedures for store managers and staff.",
        "category": "repair_manual",
        "is_recommended": True,
        "sort_order": 4,
        "content": {
            "manual_name": "Emergency Procedures",
            "equipment_type": "emergency",
            "linked_issue_categories": ["Security Incident", "Food Safety Violation"],
            "sections": [
                {
                    "title": "Fire Response",
                    "steps": [
                        "Sound alarm / shout 'FIRE' to alert all staff and customers",
                        "Call BFP (Bureau of Fire Protection): 911 or local number",
                        "If fire is small and contained: use nearest CO2 extinguisher (PASS: Pull, Aim, Squeeze, Sweep)",
                        "If fire is spreading: do NOT attempt to fight — evacuate immediately",
                        "Guide all customers and staff to designated assembly area (see posted map)",
                        "Do NOT use elevators",
                        "Manager accounts for all staff at assembly area",
                        "Do NOT re-enter building until fire department gives all-clear",
                        "File incident report within 24 hours",
                    ]
                },
                {
                    "title": "Robbery / Hold-Up Response",
                    "steps": [
                        "Stay calm — comply with demands, do not resist",
                        "Activate silent alarm if safe to do so without detection",
                        "Observe robber description: height, clothing, distinguishing marks",
                        "Note direction of escape and any vehicles",
                        "Call 911 immediately after robbers leave",
                        "Do NOT allow anyone to leave the premises (preserve scene for police)",
                        "Call area manager / operations head immediately",
                        "Do NOT clean or touch anything — preserve evidence",
                    ]
                },
                {
                    "title": "Medical Emergency",
                    "steps": [
                        "Call 911 immediately for any serious injury or medical event",
                        "Do NOT move injured person unless in immediate danger",
                        "If trained in first aid: administer basic first aid until ambulance arrives",
                        "AED location: (set during store setup) — use if person is unresponsive and not breathing",
                        "Clear area of customers to give space",
                        "Assign one staff member to meet ambulance at entrance",
                        "Notify operations manager",
                        "Complete incident report after situation is resolved",
                    ]
                },
            ],
        }
    },
    {
        "name": "Brand Standards Quick Reference",
        "description": "One-page quick reference for visual merchandising, uniform, food presentation, and cleanliness standards.",
        "category": "repair_manual",
        "is_recommended": True,
        "sort_order": 5,
        "content": {
            "manual_name": "Brand Standards Quick Reference",
            "equipment_type": "standards",
            "linked_issue_categories": [],
            "sections": [
                {
                    "title": "Uniform Standards",
                    "steps": [
                        "Full uniform must be worn at all times during shift",
                        "Shirts must be tucked in and free of stains/damage",
                        "Name badge worn on left breast",
                        "Non-slip black shoes required in kitchen areas",
                        "Hair net required for all food handlers; no loose hair",
                        "No excessive jewelry — stud earrings and plain wedding band only",
                        "Clean-shaved or neatly trimmed beard with beard net if applicable",
                    ]
                },
                {
                    "title": "Food Presentation Standards",
                    "steps": [
                        "All burgers assembled per brand diagram (sequence matters)",
                        "Fries served at correct fill level — use portion guide",
                        "Drinks filled to 1cm below lid line",
                        "No partial/incomplete meals to be served",
                        "Hot items served hot; cold items served cold — verify with temperature sticker if applicable",
                    ]
                },
                {
                    "title": "Store Appearance Standards",
                    "steps": [
                        "Menu boards lit and all bulbs working",
                        "No handwritten signs unless pre-approved by marketing",
                        "Tables clear within 2 minutes of customer departure",
                        "Entrance swept hourly during peak",
                        "Windows and glass doors cleaned daily (streak-free)",
                    ]
                },
            ],
        }
    },
]


def seed():
    supabase = get_supabase()

    print("Seeding QSR industry package...")

    # Upsert package
    pkg_res = supabase.table("industry_packages").upsert(
        {
            "industry_code": "qsr",
            "name": "Quick Service Restaurant",
            "description": "Complete operations package for QSR and fast food stores. Includes checklists, audits, workflows, and training modules aligned with Philippine HACCP and DOLE standards.",
            "version": 1,
            "is_active": True,
        },
        on_conflict="industry_code,version",
    ).execute()

    package = pkg_res.data[0]
    package_id = package["id"]
    print(f"  Package ID: {package_id}")

    # Delete old items for this package (clean re-seed)
    supabase.table("template_items").delete().eq("package_id", package_id).execute()

    all_items = (
        QSR_FORMS +
        QSR_ISSUE_CATEGORIES +
        QSR_WORKFLOWS +
        QSR_TRAINING +
        QSR_SHIFT_TEMPLATES +
        QSR_REPAIR_MANUALS
    )

    inserted = 0
    for item in all_items:
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
        print(f"  [{item['category']}] {item['name']}")

    print(f"\n✓ Seeded {inserted} templates for QSR package")
    print(f"  Forms/Checklists/Audits: {sum(1 for i in all_items if i['category'] in ('form','checklist','audit'))}")
    print(f"  Issue Categories:        {sum(1 for i in all_items if i['category'] == 'issue_category')}")
    print(f"  Workflows:               {sum(1 for i in all_items if i['category'] == 'workflow')}")
    print(f"  Training Modules:        {sum(1 for i in all_items if i['category'] == 'training_module')}")
    print(f"  Shift Templates:         {sum(1 for i in all_items if i['category'] == 'shift_template')}")
    print(f"  Repair Manuals:          {sum(1 for i in all_items if i['category'] == 'repair_manual')}")


if __name__ == "__main__":
    seed()
