from pydantic import BaseModel
from typing import Optional, List, Any
from enum import Enum


class IndustryCode(str, Enum):
    QSR = "qsr"
    RETAIL_FASHION = "retail_fashion"
    RETAIL_GROCERY = "retail_grocery"
    HOSPITALITY = "hospitality"
    HEALTHCARE_CLINIC = "healthcare_clinic"
    MANUFACTURING = "manufacturing"
    LOGISTICS = "logistics"
    CASUAL_DINING = "casual_dining"
    FULL_SERVICE_RESTAURANT = "full_service_restaurant"
    CAFE_BAR = "cafe_bar"
    BAKERY = "bakery"


INDUSTRY_DISPLAY = {
    "qsr": "Quick Service Restaurant",
    "retail_fashion": "Retail — Fashion & Apparel",
    "retail_grocery": "Retail — Grocery & Convenience",
    "hospitality": "Hospitality & Hotels",
    "healthcare_clinic": "Healthcare — Clinics",
    "manufacturing": "Manufacturing",
    "logistics": "Logistics & Warehousing",
    "casual_dining": "Casual Dining Restaurant",
    "full_service_restaurant": "Full-Service Restaurant",
    "cafe_bar": "Cafe & Bar",
    "bakery": "Bakery & Pastry",
}


# ── Step 1: Company Discovery ──────────────────────────────────────────────────

class CompanyProfile(BaseModel):
    company_name: str
    industry_code: str
    industry_subcategory: Optional[str] = None
    estimated_locations: Optional[int] = None
    brand_color_hex: Optional[str] = None
    logo_url: Optional[str] = None
    confidence: float = 0.0


class CompanyDiscoveryRequest(BaseModel):
    website_url: str


class CompanyDiscoveryFallbackRequest(BaseModel):
    company_name: str
    industry_code: str
    industry_subcategory: Optional[str] = None
    estimated_locations: Optional[int] = None


class OnboardingSessionResponse(BaseModel):
    session_id: str
    current_step: int
    status: str
    company_name: Optional[str] = None
    industry_code: Optional[str] = None
    industry_subcategory: Optional[str] = None
    estimated_locations: Optional[int] = None
    brand_color: Optional[str] = None
    logo_url: Optional[str] = None
    website_url: Optional[str] = None
    employee_source: Optional[str] = None
    launch_progress: Optional[dict] = None


# ── Step 2: Template Selection ─────────────────────────────────────────────────

class TemplateItemResponse(BaseModel):
    id: str
    category: str
    name: str
    description: Optional[str] = None
    is_recommended: bool
    is_selected: bool
    content_preview: dict


class TemplateCategoryGroup(BaseModel):
    category: str
    display_name: str
    icon: str
    items: List[TemplateItemResponse]
    selected_count: int
    total_count: int


class IndustryPackageResponse(BaseModel):
    package_name: str
    industry_code: str
    categories: List[TemplateCategoryGroup]
    total_selected: int
    total_available: int


class SelectionUpdate(BaseModel):
    template_id: str
    is_selected: bool


class SelectionSummary(BaseModel):
    forms: int = 0
    checklists: int = 0
    audits: int = 0
    issue_categories: int = 0
    workflows: int = 0
    training_modules: int = 0
    shift_templates: int = 0
    repair_manuals: int = 0
    badges: int = 0
    total_selected: int = 0
    total_available: int = 0


# ── Step 3: Locations ─────────────────────────────────────────────────────────

class OnboardingLocation(BaseModel):
    id: Optional[str] = None
    name: str
    address: Optional[str] = None


# ── Step 4: Assets & Vendors ──────────────────────────────────────────────────

class OnboardingAsset(BaseModel):
    id: Optional[str] = None
    name: str
    category: str
    model: Optional[str] = None
    manufacturer: Optional[str] = None
    location_name: Optional[str] = None


class OnboardingVendor(BaseModel):
    id: Optional[str] = None
    name: str
    service_type: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None


# ── Step 5: Employee Setup ─────────────────────────────────────────────────────

class EmployeeSourceRequest(BaseModel):
    source: str  # sprout_hr | hris_other | csv | manual | invite_link


class ManualEmployeeInput(BaseModel):
    full_name: str
    email: str
    phone: Optional[str] = None
    position: Optional[str] = None
    department: Optional[str] = None
    retail_role: str = "staff"
    location_name: Optional[str] = None


class InviteConfig(BaseModel):
    default_role: str = "staff"
    location_id: Optional[str] = None
    expiry_hours: int = 72


class InviteResult(BaseModel):
    invite_url: str
    qr_code_data: str  # base64 PNG
    expires_at: str


class RoleMappingResponse(BaseModel):
    id: str
    source_title: str
    source_department: Optional[str] = None
    retail_role: str
    confidence_score: float
    is_confirmed: bool
    employee_count: int
    low_confidence: bool  # True if < 0.7


class RoleMappingUpdate(BaseModel):
    retail_role: str


class CSVImportResult(BaseModel):
    total_rows: int
    valid_rows: int
    error_rows: int
    errors: List[dict] = []
    import_job_id: str


class EmployeeImportSummary(BaseModel):
    total_employees: int
    by_role: dict
    pending_role_assignment: int
    import_source: Optional[str] = None


# ── Step 6: Workspace Preview ─────────────────────────────────────────────────

class WorkspacePreview(BaseModel):
    summary: SelectionSummary
    locations: List[dict] = []
    assets: List[dict] = []
    vendors: List[dict] = []
    forms_and_checklists: List[dict] = []
    issue_categories: List[dict] = []
    workflows: List[dict] = []
    training_modules: List[dict] = []
    shift_templates: List[dict] = []
    repair_manuals: List[dict] = []
    employees: dict = {}
    company_name: Optional[str] = None
    brand_color: Optional[str] = None
    logo_url: Optional[str] = None


# ── Step 7: Launch ─────────────────────────────────────────────────────────────

class LaunchProgress(BaseModel):
    status: str  # pending | provisioning | completed | failed
    current_step: Optional[str] = None
    progress_percent: int = 0
    steps_completed: List[str] = []
    steps_remaining: List[str] = []
    error: Optional[str] = None


class GuidedAction(BaseModel):
    title: str
    description: str
    icon: str
    action_url: str
    action_label: str


class LaunchResult(BaseModel):
    success: bool
    message: str
    entities_created: dict = {}
