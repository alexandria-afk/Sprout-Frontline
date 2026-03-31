# Onboarding Spec

**Scope:** Documents the current implementation of the AI-First Onboarding flow.
**Last updated:** 2026-03-31

---

## Overview

The onboarding flow takes a new organisation from zero to a fully-provisioned workspace in 8 UI steps. The user provides their company URL, adds their team, configures shift settings, registers assets and vendors, selects an industry template package, previews the workspace, then triggers provisioning.

All routes are prefixed `/api/v1/onboarding`. Frontend lives in `frontend/app/(onboarding)/onboarding/page.tsx`. Backend routes are in `backend/routes/onboarding.py`.

---

## The 8 UI Steps

### Step 1 — Company

**UI title:** "Tell us about your company"

The user enters a company website URL. The backend scrapes the site and calls Claude Haiku to extract:
- `company_name`
- `industry_code` (see valid values below)
- `estimated_locations` (integer count of branches/stores)
- `brand_color_hex` (dominant brand color)
- `logo_url`

If scraping fails or the user prefers not to use a URL, a manual fallback form accepts company name, industry, and estimated location count.

Once the company profile is confirmed (`POST /sessions/{id}/confirm-company`), **location management appears inline on Step 1**. The backend calls `suggest_locations` which re-scrapes the site for a store locator page and uses AI to extract branch names and addresses. Suggestions appear in an amber panel; the user can accept one at a time, accept all visible, or dismiss them. Saved locations appear in a white list above the suggestions panel.

**"Continue to Team"** advances to Step 2. The step is re-entrant; returning to it shows the previously confirmed profile and existing locations.

#### Location suggestion behavior

1. Backend fetches the homepage URL stored on the session.
2. Scans `<a>` tags for any href containing known keyword patterns: `/stores`, `store-locator`, `find-a-store`, `branches`, `locations`, `outlets`, `stores`, etc. The **shortest** matching href is selected (preferring a listing page over individual branch URLs).
3. If a matching sub-page is found, its text is appended to the homepage text.
4. The combined text is sent to Claude Haiku with a prompt asking for a JSON array of `{name, address}` objects.
5. If no location page is found, AI generates plausible placeholder names based on the company name.

---

### Step 2 — Team

**UI title:** Employee import

Four import methods are presented:

| Method | ID | Notes |
|---|---|---|
| Import CSV | `csv` | Upload a `.csv` file |
| Add Manually | `manual` | One-by-one entry form |
| Invite Link | `invite_link` | Generates a QR code + shareable URL |
| Sprout HR | `sprout_hr` | Disabled — "Coming Soon" |

**CSV import:** The backend parses the file, maps column headers via AI role mapping (Claude Haiku normalises arbitrary header names to `full_name`, `email`, `role`, `position`, `phone`, `location_name`). Each row is stored in `onboarding_employees` with `status = "pending"`. Returns a summary of rows imported and any validation errors.

**Manual entry:** Each employee row is added directly to `onboarding_employees`.

**Invite link:** Returns a URL of the form `/join/{org_id}` and a base64-encoded SVG QR code. No `onboarding_employees` rows are created at this stage.

All employees stored in `onboarding_employees` have fields: `full_name`, `email`, `retail_role` (admin/manager/staff), `position`, `phone`, `location_name`, `status` (pending/invited).

Confirming advances to Step 3.

---

### Step 3 — Shifts

**UI title:** "Configure shift settings"

Attendance rule configuration only — no shift scheduling. The user sets:

| Field | Default | Unit |
|---|---|---|
| Late threshold | 5 | minutes |
| Early departure threshold | 10 | minutes |
| Daily overtime threshold | 8 | hours |
| Weekly overtime threshold | 40 | hours |
| Default break duration | 30 | minutes |

These rules are written directly to the live `attendance_rules` table (not staged in onboarding tables). The user can click **"Use defaults"** to skip without saving, or **"Save & Continue"** to persist the values before advancing.

Confirming calls `POST /sessions/{id}/confirm-shift-settings` and advances to Step 4.

---

### Step 4 — Assets

**UI title:** Equipment registration

The user adds physical assets (equipment) owned by the organisation. Each asset record has:
- `name` — required
- `category` — e.g. "Fryer", "Refrigerator", "POS Terminal"
- `model` — optional
- `manufacturer` — optional
- `location_name` — maps to a location added in Step 1

Stored in `onboarding_assets`. At provisioning time, `location_name` is resolved to a real `location_id`. Assets with an unresolvable location name fall back to the first location created.

Assets are collected before Templates so repair manuals generated in provisioning (Step 9) can reference real asset categories.

---

### Step 5 — Vendors

**UI title:** Vendor / supplier registration

The user adds external vendors (suppliers, maintenance contractors). Each record has:
- `name` — required
- `contact_email`
- `contact_phone`

Stored in `onboarding_vendors`. No location linkage at this stage.

Vendors are collected before Templates so workflow routing rules can reference real vendor names at provisioning time.

---

### Step 6 — Templates

**UI title:** Industry template selection

The backend loads the template package for the confirmed `industry_code` from `template_items` (seeded by `backend/scripts/seed_industry_packages.py`). Items are grouped by category:

| Category icon | Key |
|---|---|
| 📋 Form | `form` |
| ✅ Checklist | `checklist` |
| 🔍 Audit | `audit` |
| 📦 Pull-Out | `pull_out` |
| ⚠️ Issue Type | `issue_category` |
| ⚡ Workflow | `workflow` |
| 🎓 Training | `training_module` |
| 📅 Shift Template | `shift_template` |
| 🔧 Repair Manual | `repair_manual` |
| 🏅 Badge | `badge` |

The user can deselect individual items. Selections are persisted in `onboarding_selections` with `is_selected` and optional `customizations` JSONB overrides. Confirming the step calls `POST /sessions/{id}/confirm-selections` and advances to Step 7.

---

### Step 7 — Preview

**UI title:** "Preview your workspace"

Calls `GET /sessions/{id}/workspace-preview` which aggregates selected template items into a structured preview object:

```
WorkspacePreview {
  company_name, brand_color,
  summary: { total_selected, forms, checklists, issue_categories, workflows, training_modules, shift_templates, repair_manuals },
  forms_and_checklists: [{name, description}],
  issue_categories: [{name, description}],
  workflows: [{name, description}],
  training_modules: [{name, description}],
  shift_templates: [{name, description}],
  repair_manuals: [{name, description}],
  employees: { total, breakdown_by_role },
}
```

The UI shows a tabbed card listing each category's items. Empty categories are hidden. The user reviews the list, then clicks **"Ready — Launch Workspace →"** which calls `POST /sessions/{id}/confirm-preview` and advances to Step 8.

---

### Step 8 — Launch

**UI title:** Workspace provisioning progress

`POST /sessions/{id}/launch` (requires admin role) enqueues `_provision_workspace` as a FastAPI background task and sets `launch_progress.status = "provisioning"`. The frontend polls `GET /sessions/{id}/launch-progress` every 2 seconds until `status == "completed"` or `status == "failed"`.

On completion the UI shows four **First Actions** (hardcoded):
1. Invite your store managers → `/dashboard/users`
2. Assign tomorrow's opening checklist → `/dashboard/forms`
3. Review your workflows → `/dashboard/workflows`
4. Push training to new hires → `/dashboard/training`

Clicking any action navigates into the main dashboard.

#### Re-launch guard

If `status == "provisioning"` and `updated_at` is within the last 10 minutes, the endpoint returns HTTP 400. This prevents double-provisioning while allowing a re-try if the server restarted mid-run.

---

## Session Model

One `onboarding_sessions` row per organisation. Key fields:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | session_id used in all endpoints |
| `organisation_id` | uuid | FK to organisations |
| `current_step` | int | 1–8; enforced by `_require_step` |
| `status` | text | pending / provisioning / completed / failed |
| `company_name` | text | confirmed in Step 1 |
| `industry_code` | text | one of 7 valid codes (see below) |
| `estimated_locations` | int | from company discovery |
| `website_url` | text | used for re-scraping in Step 1 |
| `brand_color` | text | hex e.g. "#E30022" |
| `logo_url` | text | |
| `launch_progress` | jsonb | `{status, progress_percent, current_step, steps_completed, steps_remaining, error}` |
| `completed_at` | timestamptz | set when status → completed |

Sessions are created on first visit via `POST /sessions/start` (or `demo-start` for test orgs). A second call for the same org returns the existing session rather than creating a duplicate.

---

## Valid Industry Codes

| Code | Display label | Seed script |
|---|---|---|
| `qsr` | Quick Service Restaurant | `seed_industry_packages.py` |
| `casual_dining` | Casual Dining Restaurant | `seed_fb_packages.py` |
| `full_service_restaurant` | Full-Service Restaurant | `seed_fb_packages.py` |
| `cafe_bar` | Cafe & Bar | `seed_fb_packages.py` |
| `bakery` | Bakery & Pastry | `seed_fb_packages.py` |
| `retail_fashion` | Retail — Fashion & Apparel | — |
| `retail_grocery` | Retail — Grocery & Convenience | — |
| `hospitality` | Hospitality & Hotels | — |
| `healthcare_clinic` | Healthcare — Clinics | — |
| `manufacturing` | Manufacturing | — |
| `logistics` | Logistics & Warehousing | — |

---

## Template Package: QSR

Seeded by `backend/scripts/seed_industry_packages.py`. Uses `upsert` on `(industry_code, version)`. Existing items for the package are deleted and re-inserted on each seed run.

### Forms, Checklists & Pull-Outs (11 items)

| Name | Category |
|---|---|
| Daily Store Opening Checklist | checklist |
| Daily Store Closing Checklist | checklist |
| Food Safety & Hygiene Audit | audit |
| Shift Handover Form | form |
| Customer Complaint Form | form |
| Manager Daily Walkthrough | checklist |
| Equipment Maintenance Log | form |
| New Employee Onboarding Checklist | checklist |
| Incident Report Form | form |
| Weekly Inventory Count Sheet | form |
| Pull-Out / Wastage Record | pull_out |

The **Pull-Out / Wastage Record** template has 9 fields: Date, Shift, Category (dropdown), Item Name (dropdown with `show_options` conditional logic keyed on Category), Quantity, Unit, Reason, Notes, and Estimated Cost (number, required). See `ALLOWED_VALUES.md` for pull-out enforcement rules.

The **Daily Store Opening Checklist** has a `form_assignment` created at provisioning time with `recurrence = "daily"` and a `due_at` 24 hours from provisioning time.

Audits generate an `audit_config` row with `passing_score` from the template's `scoring.passing_threshold` field (defaults to 80).

### Issue Categories (8 items)

Equipment failures, Food safety violations, Customer complaints, Staff conduct issues, Health & safety incidents, Inventory discrepancies, Maintenance requests, Cleanliness standards.

### Workflows (2 items)

Customer Complaint Resolution workflow, Equipment Breakdown Escalation workflow.

### Training Modules (8 items)

Food Safety Fundamentals, Customer Service Excellence, Opening & Closing Procedures, Cash Handling & POS Operations, Health & Safety Compliance, New Employee Orientation, Drive-Through Efficiency, Allergen Awareness & Management.

### Shift Templates (3 items)

| Name | Start | End |
|---|---|---|
| Opening Shift | 06:00 | 14:00 |
| Closing Shift | 14:00 | 22:00 |
| Extended Hours (16hr operation) | 08:00 | 00:00 (next day) |

Shift templates store `start_time` and `end_time` as `HH:MM` strings. When generating shifts, the service detects overnight shifts by checking if `end_dt <= start_dt` and adds 1 day to `end_dt` accordingly. Templates created during onboarding have `location_id = NULL` (org-wide). The Shifts page shows a location picker when generating from an org-wide template.

### Repair Manuals (5 items)

Deep Fryer Maintenance Guide, Walk-in Cooler/Freezer Maintenance, POS Terminal Troubleshooting, Beverage Machine Cleaning Guide, HVAC & Ventilation Maintenance.

### Badges (AI-generated)

QSR does not seed badge template items. Badges are always AI-generated at provisioning time (Step 10).

---

## Template Packages: F&B

Seeded by `backend/scripts/seed_fb_packages.py`. Covers four sub-types: `casual_dining`, `full_service_restaurant`, `cafe_bar`, `bakery`. All four share a common F&B base with sub-type variations.

### Category counts by sub-type

| Category | casual_dining | full_service_restaurant | cafe_bar | bakery |
|---|---|---|---|---|
| Forms | 6 | 6 | 5 | 6 |
| Checklists | 6 | 6 | 6 | 6 |
| Audits | 4 | 5 | 4 | 3 |
| Pull-Outs | 1 | 1 | 1 | 1 |
| Issue Categories | 9 | 9 | 9 | 8 |
| Workflows | 5 | 5 | 5 | 4 |
| Training Modules | 9 | 9 | 9 | 7 |
| Shift Templates | 5 | 5 | 6 | 3 |
| Repair Manuals | 5 | 5 | 5 | 4 |
| Badges | 5 | 5 | 5 | 5 |

Each sub-type includes one **Pull-Out / Wastage Record** template (`pull_out` type) with industry-appropriate categories and items. Category/item options differ by sub-type:

| Sub-type | Categories |
|---|---|
| casual_dining, full_service_restaurant | Starters, Mains, Desserts, Beverages, Sides, Bread & Pastry |
| cafe_bar | Coffee, Non-Coffee, Food, Pastry, Alcohol |
| bakery | Breads, Pastry, Cakes, Beverages, Savory |

The bakery variant uses "Expired / Past shelf life" as the first reason option (vs "Expired / Past hold time" for all others). All F&B pull-out templates share the same 9-field structure as the QSR version: Date, Shift, Category, Item Name (show_options), Quantity, Unit, Reason, Notes, Estimated Cost.

### Sub-type variations

**`full_service_restaurant`** adds over casual_dining:
- Plating & Presentation Audit
- Table Service Quality Audit includes wine pairing section

**`cafe_bar`** removes from casual_dining:
- No Reservation & Covers Log form
- No Table Service audit (replaced by Counter Service Audit)
- No bar-specific repair manuals (replaced by Espresso Machine + Draft Beer System SOPs)

**`bakery`** removes from casual_dining:
- No Reservation & Covers Log form
- No Bar Inventory form
- No Table Service or Bar Operations audits (replaced by Display Case & Product Presentation Audit)
- No Bar Issue category
- No Bar Onboarding workflow
- Training: Guest Service replaces Table Service with Counter Service; no Bar/Alcohol modules
- Repair Manuals: Commercial Oven + Dough Mixer + Proofing Cabinet + Walk-in Cooler (no Range/Grill, Dishwasher, or POS)

### Repair Manuals by sub-type

| Manual | casual_dining | full_service | cafe_bar | bakery |
|---|---|---|---|---|
| Commercial Range & Grill Maintenance | ✓ | ✓ | — | — |
| Walk-in Cooler / Freezer Maintenance | ✓ | ✓ | ✓ | ✓ |
| Commercial Dishwasher Maintenance | ✓ | ✓ | — | — |
| POS Terminal Troubleshooting | ✓ | ✓ | ✓ | — |
| HVAC & Exhaust Hood Maintenance | ✓ | ✓ | ✓ | — |
| Espresso Machine Calibration & Cleaning | — | — | ✓ | — |
| Draft Beer System Maintenance | — | — | ✓ | — |
| Commercial Oven Maintenance | — | — | — | ✓ |
| Dough Mixer Maintenance | — | — | — | ✓ |
| Proofing Cabinet Maintenance | — | — | — | ✓ |

Each manual has 3 sections (daily, weekly, and as-needed frequency) with detailed step-by-step procedures.

### Badges (5 items, all sub-types)

F&B packages seed badge configs directly from template items instead of using AI generation. The provisioner checks `by_cat.get("badge", [])` first; AI fallback only fires if no badge templates exist.

| Badge | Criteria type | Threshold |
|---|---|---|
| Service Star | `checklists_completed` | 50 |
| Safety First | `issues_reported` | 10 |
| Training Champion | `training_completed` | 5 |
| Perfect Attendance | `attendance_streak_days` | 30 |
| Task Closer | `tasks_completed` | 100 |

### Notes for future packages

- Every package **must** include `repair_manual` items. Without them, users who skip the Assets step get no repair guides at all (the AI path only runs when assets are registered).
- Every package **should** include `badge` items. If omitted, badges fall back to AI generation which produces generic results.
- The `template_items.category` constraint must be updated (migration) before adding any new category values to seed scripts. Currently allowed: `form`, `checklist`, `audit`, `pull_out`, `issue_category`, `workflow`, `training_module`, `shift_template`, `repair_manual`, `badge`.

---

## Provisioning Order

`_provision_workspace` runs as a FastAPI `BackgroundTasks` coroutine. The 13 steps are executed sequentially (except training AI calls which run in parallel). All tables are wiped and recreated at the start, making the function idempotent on re-run.

### Cleanup (before any steps)

1. Delete `workflow_stages`, `workflow_routing_rules` (via parent definition IDs)
2. Delete `course_slides`, `quiz_questions`, `course_modules` (via course IDs)
3. Delete `form_assignments`, `audit_configs`, `form_submissions` (via form template IDs)
4. Delete in FK-safe order: `repair_guides`, `courses`, `assets`, `vendors`, `shift_templates`, `workflow_definitions`, `issue_categories`, `form_templates`, `badge_configs`, `locations`

### Provisioning Steps

| # | Step label | Progress % | Source data |
|---|---|---|---|
| 1 | Creating locations | 8% | `onboarding_locations` |
| 2 | Registering assets | 15% | `onboarding_assets` |
| 3 | Setting up vendors | 23% | `onboarding_vendors` |
| 4 | Creating forms & checklists | 5% | `onboarding_selections` where `category ∈ {form, checklist, audit, pull_out}` |
| 5 | Setting up issue categories | 20% | `onboarding_selections` where `category = issue_category` |
| 6 | Configuring workflows | 35% | `onboarding_selections` where `category = workflow` |
| 7 | Importing training modules | 50% | `onboarding_selections` where `category = training_module` |
| 8 | Creating shift templates | 65% | `onboarding_selections` where `category = shift_template` |
| 9 | Loading repair manuals | 73% | asset list or `onboarding_selections` where `category = repair_manual` |
| 10 | Setting up badges | 88% | AI-generated based on industry |
| 11 | Activating employee accounts | 85% | `onboarding_employees` |
| 12 | Applying permissions | 93% | (no-op — placeholder) |
| 13 | Finalizing workspace | 99% | (session completion) |

Note: progress percentages in the code reflect the order in which steps were added and are not strictly monotonic between steps 9 and 11.

### Step Detail: Forms & Checklists (Step 4)

- `content.type` is normalised to `form | checklist | audit | pull_out` (any other value → `checklist`).
- Each form gets `form_sections` and `form_fields`. Field types are normalised: `pass_fail → yes_no`, `boolean → yes_no`, `select → dropdown`. Unknown types fall back to `text`.
- Audit forms get an `audit_configs` row with `passing_score` from `content.scoring.passing_threshold` (default 80).
- The template name is stored in `form_name_to_id` for later resolution of `form_ref` in workflow stages.

### Step Detail: Workflows (Step 6)

- `trigger.type` is normalised via `_TRIGGER_MAP`: `issue_filed → issue_created`, `audit_complete → audit_submitted`, `form_complete → form_submitted`, `incident_raised → incident_created`, `user_created → employee_created`. Unknown values fall back to `manual`.
- Workflows are inserted with `is_active = False`.
- `trigger_issue_category_id` is resolved by looking up `trigger.issue_category_ref` in the category name → ID map built after Step 5.
- For each stage, `action_type` is normalised via `_STAGE_ACTION_MAP`. `fill_form` stages have `form_template_id` resolved from `stage.form_ref` via `form_name_to_id`.
- The stage's `config` JSONB strips internal keys: `type`, `target_role`, `assign_to_role`, `assigned_role`, `is_final`, `form_ref`, `name`.
- `assigned_role` is validated against: `staff | manager | admin | super_admin | vendor`.
- `is_final` defaults to `True` for the last stage.

### Step Detail: Training Modules (Step 7)

**Phase 4a** — DB rows created synchronously:
- One `courses` row per template item. `is_published = False`, `ai_generated = True`.
- One `course_modules` row per section. `module_type` normalised: `text_with_images → slides`, `scenario_based → quiz`, `video_with_quiz → video`. Unknown → `slides`.

**Phase 4b** — AI calls run in parallel via `asyncio.gather(..., return_exceptions=True)`:
- Model: `claude-haiku-4-5-20251001`, max_tokens: 4000, timeout: 60s.
- Prompt requests slides (3–4 per module, each `{title, body}`) or quiz questions (3–4 per module, each with `question`, `question_type`, 4 `options` with `is_correct`, and `explanation`).
- Individual course failures are logged and skipped; provisioning continues.

**Phase 4c** — Batch insert `course_slides` and `quiz_questions`.

### Step Detail: Repair Manuals (Step 9)

- If `real_assets` is non-empty (assets were registered in UI Step 4): assets are deduplicated by `category:name`, then AI (claude-haiku, max_tokens: 2048) generates a 3–5 step maintenance guide per unique asset. Inserted as `guide_type = "text"`.
- If no assets: falls back to the template-based repair manuals from `onboarding_selections`.
- Failures are silently swallowed; provisioning continues.

### Step Detail: Badges (Step 10)

- AI (claude-haiku, max_tokens: 512) suggests 4–5 achievement badges tailored to the industry.
- Each badge has `name`, `description`, `points_awarded` (int, default 50), and `criteria_type`.
- Valid `criteria_type` values: `issues_reported`, `issues_resolved`, `checklists_completed`, `checklist_streak_days`, `training_completed`, `attendance_streak_days`, `tasks_completed`, `manual`. Unknown values are coerced to `manual`.
- Failures are silently swallowed; provisioning continues.

### Step Detail: Employee Accounts (Step 11)

For each row in `onboarding_employees`:
1. Call `auth.admin.create_user({email, email_confirm: True, app_metadata: {organisation_id, role}, user_metadata: {full_name}})`.
2. If that throws (email already exists): call `auth.admin.list_users()` and scan for a matching email to retrieve the existing user's UUID.
3. If no UUID found after both attempts: skip this employee.
4. Upsert `profiles` on conflict `id` with `{organisation_id, full_name, role, location_id, phone_number, position}`.
5. Update `onboarding_employees.status = "invited"`.

`location_id` is resolved from `location_name` using `location_id_map` built in Step 1.

---

## Template Dependency Chain

The following provisioning-time dependencies must be respected (and are — by the sequential step ordering):

```
onboarding_locations   (Step 1)
   └─ assets.location_id            (Step 2 — resolved from location_id_map)
   └─ profiles.location_id          (Step 11 — resolved from location_id_map)

form_templates         (Step 4)
   └─ form_name_to_id               (dict, populated in Step 4)
       └─ workflow_stages.form_template_id  (Step 6 — fill_form stages)

issue_categories       (Step 5)
   └─ cat_name_to_id               (dict, populated in Step 5)
       └─ workflow_definitions.trigger_issue_category_id (Step 6)

courses / course_modules  (Step 7 Phase 4a)
   └─ course_slides / quiz_questions (Step 7 Phase 4c — after AI parallel batch)

real_assets            (Step 2 output)
   └─ repair_guides generation strategy (Step 9 — AI if assets, templates if not)
```

The UI step ordering (Assets → Vendors before Templates) mirrors this dependency chain: assets and vendors are known before template selections are finalised, allowing provisioning to generate asset-specific repair guides and vendor-aware workflow routing.

---

## Vertical-Aware AI Behavior

The `industry` display string (from `INDUSTRY_DISPLAY` dict, e.g. `"Quick Service Restaurant"`) is injected into every AI prompt. This affects:

| Step | AI call | Industry influence |
|---|---|---|
| Step 1 | Company discovery | Extracted `industry_code` seeds all downstream prompts |
| Step 7 (training) | Course content generation | `"for a {industry} course titled '{title}'"` |
| Step 9 (repair guides) | Asset maintenance guides | `"For each asset in a {industry} business"` |
| Step 10 (badges) | Badge suggestions | `"for a {industry} business"` |

All AI calls use `claude-haiku-4-5-20251001` with a 60-second per-call timeout. All responses are JSON; code fences are stripped via `_strip_code_fence` before parsing.

---

## Validation Rules

### Step constraints

`_require_step(session, expected)` raises HTTP 422 if `session.current_step < expected`. Each confirm endpoint advances `current_step` by 1.

### Industry codes

Only the 7 values in `IndustryCode` enum are accepted. The fallback form's `<select>` is pre-populated with these values; unknown values from AI discovery are rejected.

### Shift template times

- `start_time` and `end_time` must parse as `datetime.fromisoformat(f"{date}T{time}")`.
- Invalid time strings raise HTTP 422 with `"Invalid time format in template: {error}"`.
- Overnight shifts (end ≤ start) are handled by adding 1 day to `end_dt`.

### Field type normalisation

Unknown form field types fall back to `text`. Unknown workflow action types fall back to `notify`. Unknown workflow trigger types fall back to `manual`. Unknown badge criteria types fall back to `manual`.

### Employee role mapping

`retail_role` values are mapped through `{"admin": "admin", "manager": "manager", "staff": "staff"}`. Any unknown value becomes `"staff"`.

### Re-launch guard

- If `status == "completed"` → HTTP 400 "This workspace has already been launched."
- If `status == "provisioning"` and `updated_at` is within the last 10 minutes → HTTP 400 "Workspace provisioning is already in progress."
- Stale provisioning (>10 minutes without an update) is considered a server restart and re-launch is allowed.

### launch-progress ownership check

`GET /sessions/{id}/launch-progress` looks up the session by `session_id` alone (not `org_id`), then verifies the calling user's `sub` (UUID) exists in `profiles` with matching `organisation_id` and `is_deleted = False`. This avoids false 403s when JWT `app_metadata.organisation_id` is stale.

---

## Database Tables Used

| Table | Created by step | Cleaned on re-provision |
|---|---|---|
| `onboarding_sessions` | `demo-start` | No (session record persists) |
| `onboarding_locations` | Step 1 | No |
| `onboarding_employees` | Step 2 | No |
| `onboarding_assets` | Step 4 | No |
| `onboarding_vendors` | Step 5 | No |
| `onboarding_selections` | Step 6 | No |
| `locations` | Provisioning Step 1 | Yes |
| `assets` | Provisioning Step 2 | Yes |
| `vendors` | Provisioning Step 3 | Yes |
| `form_templates` | Provisioning Step 4 | Yes |
| `form_sections` | Provisioning Step 4 | Yes (cascade) |
| `form_fields` | Provisioning Step 4 | Yes (cascade) |
| `form_assignments` | Provisioning Step 4 | Yes |
| `audit_configs` | Provisioning Step 4 | Yes |
| `issue_categories` | Provisioning Step 5 | Yes |
| `workflow_definitions` | Provisioning Step 6 | Yes |
| `workflow_stages` | Provisioning Step 6 | Yes |
| `courses` | Provisioning Step 7 | Yes |
| `course_modules` | Provisioning Step 7 | Yes |
| `course_slides` | Provisioning Step 7 | Yes |
| `quiz_questions` | Provisioning Step 7 | Yes |
| `shift_templates` | Provisioning Step 8 | Yes |
| `repair_guides` | Provisioning Step 9 | Yes |
| `badge_configs` | Provisioning Step 10 | Yes |
| `profiles` | Provisioning Step 11 | No (upsert) |
| `attendance_rules` | Step 3 | No (direct write) |
