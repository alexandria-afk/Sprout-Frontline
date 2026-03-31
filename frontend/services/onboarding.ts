import { apiFetch } from "./api/client";

const BASE = "/api/v1/onboarding";

export interface OnboardingSession {
  session_id: string;
  current_step: number;
  status: string;
  company_name?: string | null;
  industry_code?: string | null;
  industry_subcategory?: string | null;
  estimated_locations?: number | null;
  brand_color?: string | null;
  logo_url?: string | null;
  website_url?: string | null;
  employee_source?: string | null;
  launch_progress?: Record<string, unknown> | null;
}

export interface CompanyProfile {
  company_name: string;
  industry_code: string;
  industry_subcategory?: string | null;
  estimated_locations?: number | null;
  brand_color_hex?: string | null;
  logo_url?: string | null;
  confidence: number;
}

export interface TemplateItem {
  id: string;
  category: string;
  name: string;
  description?: string | null;
  is_recommended: boolean;
  is_selected: boolean;
  content_preview: Record<string, unknown>;
}

export interface TemplateCategoryGroup {
  category: string;
  display_name: string;
  icon: string;
  items: TemplateItem[];
  selected_count: number;
  total_count: number;
}

export interface IndustryPackage {
  package_name: string;
  industry_code: string;
  categories: TemplateCategoryGroup[];
  total_selected: number;
  total_available: number;
}

export interface SelectionSummary {
  forms: number;
  checklists: number;
  audits: number;
  issue_categories: number;
  workflows: number;
  training_modules: number;
  shift_templates: number;
  repair_manuals: number;
  badges: number;
  total_selected: number;
  total_available: number;
}

export interface OnboardingLocation {
  id?: string;
  name: string;
  address?: string | null;
}

export interface OnboardingAsset {
  id?: string;
  name: string;
  category: string;
  model?: string | null;
  manufacturer?: string | null;
  location_name?: string | null;
}

export interface OnboardingVendor {
  id?: string;
  name: string;
  service_type?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}

export interface OnboardingEmployee {
  id?: string;
  full_name: string;
  email: string;
  phone?: string;
  position?: string;
  department?: string;
  retail_role: string;
  location_name?: string;
  reports_to?: string;
  status?: string;
}

export interface RoleMapping {
  id: string;
  source_title: string;
  source_department?: string | null;
  retail_role: string;
  confidence_score: number;
  is_confirmed: boolean;
  employee_count: number;
  low_confidence: boolean;
}

export interface WorkspacePreview {
  summary: SelectionSummary;
  locations: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  vendors: Record<string, unknown>[];
  forms_and_checklists: Record<string, unknown>[];
  issue_categories: Record<string, unknown>[];
  workflows: Record<string, unknown>[];
  training_modules: Record<string, unknown>[];
  shift_templates: Record<string, unknown>[];
  repair_manuals: Record<string, unknown>[];
  employees: Record<string, unknown>;
  company_name?: string | null;
  brand_color?: string | null;
  logo_url?: string | null;
}

export interface LaunchProgress {
  status: string;
  current_step?: string | null;
  progress_percent: number;
  steps_completed: string[];
  steps_remaining: string[];
  error?: string | null;
}

// ── Session ──────────────────────────────────────────────────────────────────

export const createSession = (): Promise<OnboardingSession> =>
  apiFetch(`${BASE}/sessions`, { method: "POST" });

export const getCurrentSession = (): Promise<OnboardingSession | null> =>
  apiFetch<OnboardingSession>(`${BASE}/sessions/current`).catch(() => null);

// ── Step 1 ───────────────────────────────────────────────────────────────────

export const discoverCompany = (sessionId: string, websiteUrl: string): Promise<CompanyProfile> =>
  apiFetch(`${BASE}/sessions/${sessionId}/discover`, {
    method: "POST",
    body: JSON.stringify({ website_url: websiteUrl }),
  });

export const discoverFallback = (
  sessionId: string,
  payload: { company_name: string; industry_code: string; estimated_locations?: number }
): Promise<CompanyProfile> =>
  apiFetch(`${BASE}/sessions/${sessionId}/discover/fallback`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const confirmCompany = (sessionId: string, profile: CompanyProfile): Promise<OnboardingSession> =>
  apiFetch(`${BASE}/sessions/${sessionId}/confirm-company`, {
    method: "POST",
    body: JSON.stringify(profile),
  });

// ── Step 2 ───────────────────────────────────────────────────────────────────

export const getTemplates = (sessionId: string): Promise<IndustryPackage> =>
  apiFetch(`${BASE}/sessions/${sessionId}/templates`);

export const updateSelections = (
  sessionId: string,
  updates: { template_id: string; is_selected: boolean }[]
): Promise<{ ok: boolean }> =>
  apiFetch(`${BASE}/sessions/${sessionId}/selections`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });

export const getSelectionSummary = (sessionId: string): Promise<SelectionSummary> =>
  apiFetch(`${BASE}/sessions/${sessionId}/selections/summary`);

export const confirmTemplates = (sessionId: string): Promise<OnboardingSession> =>
  apiFetch(`${BASE}/sessions/${sessionId}/confirm-templates`, { method: "POST" });

// ── Step 3: Locations ─────────────────────────────────────────────────────────

export const suggestLocations = (sessionId: string): Promise<OnboardingLocation[]> =>
  apiFetch(`${BASE}/sessions/${sessionId}/suggest-locations`);

export const addLocation = (sessionId: string, loc: OnboardingLocation): Promise<OnboardingLocation> =>
  apiFetch(`${BASE}/sessions/${sessionId}/locations`, {
    method: "POST",
    body: JSON.stringify(loc),
  });

export const listLocations = (sessionId: string): Promise<OnboardingLocation[]> =>
  apiFetch(`${BASE}/sessions/${sessionId}/locations`);

export const deleteLocation = (sessionId: string, locId: string): Promise<void> =>
  apiFetch(`${BASE}/sessions/${sessionId}/locations/${locId}`, { method: "DELETE" });

export const confirmLocations = (sessionId: string): Promise<OnboardingSession> =>
  apiFetch(`${BASE}/sessions/${sessionId}/confirm-locations`, { method: "POST" });

// ── Step 4: Assets & Vendors ──────────────────────────────────────────────────

export const suggestAssets = (sessionId: string): Promise<OnboardingAsset[]> =>
  apiFetch(`${BASE}/sessions/${sessionId}/suggest-assets`);

export const addAsset = (sessionId: string, asset: OnboardingAsset): Promise<OnboardingAsset> =>
  apiFetch(`${BASE}/sessions/${sessionId}/assets`, {
    method: "POST",
    body: JSON.stringify(asset),
  });

export const listAssets = (sessionId: string): Promise<OnboardingAsset[]> =>
  apiFetch(`${BASE}/sessions/${sessionId}/assets`);

export const deleteAsset = (sessionId: string, assetId: string): Promise<void> =>
  apiFetch(`${BASE}/sessions/${sessionId}/assets/${assetId}`, { method: "DELETE" });

export const addVendor = (sessionId: string, vendor: OnboardingVendor): Promise<OnboardingVendor> =>
  apiFetch(`${BASE}/sessions/${sessionId}/vendors`, {
    method: "POST",
    body: JSON.stringify(vendor),
  });

export const listVendors = (sessionId: string): Promise<OnboardingVendor[]> =>
  apiFetch(`${BASE}/sessions/${sessionId}/vendors`);

export const deleteVendor = (sessionId: string, vendorId: string): Promise<void> =>
  apiFetch(`${BASE}/sessions/${sessionId}/vendors/${vendorId}`, { method: "DELETE" });

export const confirmAssets = (sessionId: string): Promise<OnboardingSession> =>
  apiFetch(`${BASE}/sessions/${sessionId}/confirm-assets`, { method: "POST" });

export const confirmVendors = (sessionId: string): Promise<OnboardingSession> =>
  apiFetch(`${BASE}/sessions/${sessionId}/confirm-vendors`, { method: "POST" });

// ── Step 5: Team ──────────────────────────────────────────────────────────────

export const setEmployeeSource = (sessionId: string, source: string): Promise<OnboardingSession> =>
  apiFetch(`${BASE}/sessions/${sessionId}/employee-source`, {
    method: "POST",
    body: JSON.stringify({ source }),
  });

export const addEmployee = (sessionId: string, employee: OnboardingEmployee): Promise<{ id: string }> =>
  apiFetch(`${BASE}/sessions/${sessionId}/employees`, {
    method: "POST",
    body: JSON.stringify(employee),
  });

export const listEmployees = (sessionId: string): Promise<{ employees: OnboardingEmployee[]; total: number }> =>
  apiFetch(`${BASE}/sessions/${sessionId}/employees`);

export const deleteEmployee = (sessionId: string, employeeId: string): Promise<void> =>
  apiFetch(`${BASE}/sessions/${sessionId}/employees/${employeeId}`, { method: "DELETE" });

export const generateInviteLink = (
  sessionId: string,
  config?: { default_role?: string; expiry_hours?: number }
): Promise<{ invite_url: string; qr_code_data: string; expires_at: string }> =>
  apiFetch(`${BASE}/sessions/${sessionId}/invite-link`, {
    method: "POST",
    body: JSON.stringify(config ?? {}),
  });

export const getRoleMappings = (sessionId: string): Promise<RoleMapping[]> =>
  apiFetch(`${BASE}/sessions/${sessionId}/role-mappings`);

export const confirmEmployees = (sessionId: string): Promise<OnboardingSession> =>
  apiFetch(`${BASE}/sessions/${sessionId}/confirm-employees`, { method: "POST" });

// ── Step 6: Shift Settings ────────────────────────────────────────────────────

export const confirmShiftSettings = (sessionId: string): Promise<OnboardingSession> =>
  apiFetch(`${BASE}/sessions/${sessionId}/confirm-shift-settings`, { method: "POST" });

// ── Step 7: Preview ───────────────────────────────────────────────────────────

export const getWorkspacePreview = (sessionId: string): Promise<WorkspacePreview> =>
  apiFetch(`${BASE}/sessions/${sessionId}/preview`);

export const confirmPreview = (sessionId: string): Promise<OnboardingSession> =>
  apiFetch(`${BASE}/sessions/${sessionId}/confirm-preview`, { method: "POST" });

// ── Step 7: Launch ────────────────────────────────────────────────────────────

export const launchWorkspace = (sessionId: string): Promise<{ success: boolean; message: string }> =>
  apiFetch(`${BASE}/sessions/${sessionId}/launch`, { method: "POST" });

export const getLaunchProgress = (sessionId: string): Promise<LaunchProgress> =>
  apiFetch(`${BASE}/sessions/${sessionId}/launch-progress`);

export const getFirstActions = (
  sessionId: string
): Promise<{ actions: { title: string; description: string; icon: string; action_url: string; action_label: string }[] }> =>
  apiFetch(`${BASE}/sessions/${sessionId}/first-actions`);

// ── Package templates (post-onboarding) ─────────────────────────────────────

export interface PackageTemplateItem {
  id: string;
  name: string;
  description: string;
  category: string;
  content: Record<string, unknown>;
  sort_order: number;
}

export interface PackageTemplatesResponse {
  items: PackageTemplateItem[];
  industry_code: string | null;
}

export const getPackageTemplates = (category?: string): Promise<PackageTemplatesResponse> => {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  return apiFetch(`${BASE}/package-templates${qs}`);
};
