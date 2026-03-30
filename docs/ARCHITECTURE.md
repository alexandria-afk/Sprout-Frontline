# Architecture Reference
**Frontline Operations Platform**
_Last updated: 2026-03-30 — generated from codebase scan_

---

## Project Overview

**Frontline** is a multi-tenant SaaS operations platform for retail, quick-service restaurant, and logistics businesses. The product name in code is `frontline`; the repository directory is `RETAIL APP RENEGADE`.

The platform covers: task management, form/checklist assignments, auditing with corrective action plans (CAPs), issue tracking, maintenance/asset management, shift scheduling and attendance, a built-in LMS with AI-generated course content, workflow automation, gamification/leaderboards, announcements, and an AI onboarding wizard that provisions a full workspace from a company URL.

There is no `CLAUDE.md` or `README.md` at the repository root.

### Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Web frontend | Next.js (App Router) | 14.2.35 |
| Web UI | React | ^18 |
| Web language | TypeScript | ^5 |
| Web styling | Tailwind CSS | ^3.4.1 |
| Web charts | Recharts | ^3.8.0 |
| Web drag-drop | @hello-pangea/dnd | ^18.0.1 |
| Web forms | React Hook Form + Zod | ^7.71.2 + ^4.3.6 |
| Web data fetching | TanStack React Query | ^5.90.21 |
| Web state | Zustand | ^5.0.12 |
| Web icons | Lucide React | ^0.577.0 |
| Web E2E tests | Playwright | ^1.58.2 |
| Backend | FastAPI | 0.115.4 |
| Backend runtime | Python | 3.13 |
| Backend server | Uvicorn | 0.32.0 |
| Backend models | Pydantic | 2.12.5 |
| AI SDK | Anthropic | >=0.49.0 |
| Database client | supabase-py | 2.28.2 |
| Auth (backend) | PyJWT | 2.10.1 |
| Rate limiting | slowapi | 0.1.9 |
| PDF generation | reportlab | >=4.0.0 |
| Backend tests | pytest + pytest-asyncio | 8.3.5 + 0.24.0 |
| Database | PostgreSQL (via Supabase) | 17 |
| Mobile | Flutter (Dart SDK) | ^3.11.1 |
| Mobile state | flutter_riverpod | ^2.6.1 |
| Mobile routing | go_router | ^14.8.1 |
| Mobile HTTP | dio | ^5.7.0 |
| Mobile auth/DB | supabase_flutter | ^2.9.0 |
| Mobile local DB | hive_flutter | ^1.1.0 |
| Mobile background | workmanager | ^0.5.2 |

---

## Directory Structure

```
RETAIL APP RENEGADE/
├── backend/                   FastAPI Python backend
│   ├── main.py                App factory, router registration, middleware config
│   ├── config.py              Pydantic-settings config loader (reads .env)
│   ├── dependencies.py        FastAPI dependency injection (auth, pagination)
│   ├── requirements.txt       Python dependencies
│   ├── routes/                One module per feature domain (30+ files)
│   ├── services/              Business logic and external client wrappers (18+ files)
│   ├── models/                Pydantic request/response schemas and enums (14 files)
│   ├── middleware/            Auth enforcement, request logging middleware
│   └── scripts/               One-off seed scripts
├── frontend/                  Next.js web application
│   ├── app/                   App Router pages and layouts
│   │   ├── (auth)/            Login, set-password, auth callback routes
│   │   ├── (onboarding)/      7-step AI onboarding wizard
│   │   └── (dashboard)/       All post-login dashboard routes
│   ├── components/            Shared UI components
│   ├── services/              API client modules (one per domain)
│   ├── hooks/                 Custom React hooks
│   ├── lib/                   Utility functions
│   ├── types/                 TypeScript interfaces and enums
│   ├── e2e/                   Playwright end-to-end test suite
│   ├── middleware.ts           Auth guard + session refresh middleware
│   └── tailwind.config.ts     Tailwind theme configuration
├── mobile/                    Flutter mobile application
│   └── frontline_app/
│       ├── lib/
│       │   ├── main.dart      App entry point (Riverpod ProviderScope)
│       │   ├── core/          Shared infrastructure (router, API, auth, theme, offline)
│       │   └── features/      Feature modules (auth, dashboard, announcements, forms)
│       ├── android/           Android native project
│       └── ios/               iOS native project
├── supabase/                  Supabase local dev configuration and migrations
│   ├── config.toml            Local Supabase project settings
│   ├── migrations/            51 sequential SQL migration files
│   ├── seed.sql               Base seed data
│   └── seed_test_org.sql      Test organisation seed data
├── scripts/                   Utility scripts (seed, data migration)
├── docs/                      This file
├── QA_ONBOARDING_LOG.md       Onboarding QA findings (2026-03-29)
└── package.json               Root-level (no build logic; workspace tooling only)
```

---

## Database

**Engine:** PostgreSQL 17 via Supabase (local port 54322; API port 54321).
**Migration count:** 51 SQL files in `supabase/migrations/`, ordered by timestamp prefix.
**Soft deletes:** `is_deleted BOOLEAN DEFAULT false` column on most entities instead of hard deletion.
**Multi-tenancy:** Every tenant table has `organisation_id UUID REFERENCES organisations(id)`.
**RLS:** Enabled on 40+ tables; service role key bypasses RLS for backend writes; authenticated users are scoped to their organisation via `auth.uid() → profiles.organisation_id`.

### Tables

#### Foundations

| Table | Key Columns | Notes |
|---|---|---|
| `organisations` | `id`, `name TEXT UNIQUE`, `logo_url`, `settings JSONB`, `is_active`, `is_deleted` | Root tenant table |
| `locations` | `id`, `organisation_id`, `name`, `address`, `latitude NUMERIC`, `longitude NUMERIC`, `geo_fence_radius_meters INT`, `is_active`, `is_deleted` | Branches/outlets |
| `profiles` | `id` (FK → auth.users), `organisation_id`, `location_id`, `full_name`, `phone_number`, `role ENUM(super_admin\|admin\|manager\|staff)`, `position TEXT`, `reports_to UUID`, `language`, `fcm_token`, `is_active`, `is_deleted` | Extends Supabase auth |

#### Forms & Checklists

| Table | Key Columns | Notes |
|---|---|---|
| `form_templates` | `id`, `organisation_id`, `created_by`, `title`, `description`, `type ENUM(checklist\|form)`, `is_active`, `is_deleted` | |
| `form_sections` | `id`, `template_id`, `title`, `display_order` | |
| `form_fields` | `id`, `section_id`, `label`, `field_type ENUM(text\|number\|checkbox\|dropdown\|multi_select\|photo\|signature\|datetime)`, `options JSONB`, `is_required`, `conditional_logic JSONB`, `display_order` | |
| `form_assignments` | `id`, `template_id`, `assigned_to_user_id`, `assigned_to_location_id`, `assigned_by`, `recurrence ENUM(once\|daily\|weekly\|custom)`, `cron_expression`, `due_at`, `is_active` | |
| `form_submissions` | `id`, `assignment_id`, `submitted_by`, `location_id`, `status ENUM(draft\|submitted\|approved\|rejected)`, `submitted_at`, `reviewed_by`, `reviewed_at`, `manager_comment` | |
| `form_responses` | `id`, `submission_id`, `field_id`, `value TEXT` (file URL for media fields) | |

#### Audits

| Table | Key Columns | Notes |
|---|---|---|
| `audit_configs` | `id`, `template_id UNIQUE`, `passing_score NUMERIC` | 1:1 with form_templates |
| `audit_section_weights` | `id`, `section_id UNIQUE`, `weight NUMERIC` | |
| `audit_field_scores` | `id`, `field_id UNIQUE`, `max_score NUMERIC` | |
| `audit_signatures` | `id`, `submission_id`, `signed_by`, `signature_url`, `signed_at` | |

#### Corrective Action Plans (CAPs)

| Table | Key Columns | Notes |
|---|---|---|
| `corrective_action_plans` | `id`, `submission_id`, `organisation_id`, `status ENUM(pending_review\|in_review\|confirmed\|dismissed)`, `dismissed_reason`, `reviewed_by`, `reviewed_at` | 1 CAP per audit submission |
| `cap_items` | `id`, `cap_id`, `field_id`, `field_label`, `response_value`, `score_awarded`, `max_score`, `is_critical`, `suggested_followup_type ENUM(task\|issue\|incident)`, `suggested_title`, `suggested_description`, `followup_type`, `followup_priority`, `spawned_task_id`, `spawned_issue_id`, `spawned_incident_id` | AI-generated per failed field |

#### Workflows

| Table | Key Columns | Notes |
|---|---|---|
| `workflow_definitions` | `id`, `organisation_id`, `name`, `is_active`, `template_id` (FK, nullable) | |
| `workflow_stages` | `id`, `definition_id`, `name`, `stage_order`, `assigned_role`, `assigned_user_id`, `action_type ENUM(review\|approve\|fill_form\|sign)`, `form_template_id`, `is_final` | |
| `workflow_routing_rules` | `id`, `definition_id`, `from_stage_id`, `to_stage_id`, `condition_type ENUM(score_below\|score_above\|field_failed\|field_value_equals\|always)`, `condition_value`, `priority` | |
| `workflow_instances` | `id`, `definition_id`, `organisation_id`, `triggered_by`, `source_type`, `source_id`, `status ENUM(in_progress\|completed\|cancelled)`, `current_stage_id`, `completed_at` | |
| `workflow_stage_instances` | `id`, `instance_id`, `stage_id`, `assigned_to`, `status ENUM(pending\|in_progress\|approved\|rejected\|skipped)`, `started_at`, `completed_at`, `comment` | |

#### Tasks

| Table | Key Columns | Notes |
|---|---|---|
| `tasks` | `id`, `organisation_id`, `location_id`, `created_by`, `title`, `description`, `priority ENUM(low\|medium\|high\|critical)`, `status ENUM(pending\|in_progress\|completed\|overdue\|cancelled)`, `due_at`, `recurrence`, `cron_expression`, `source_type ENUM(manual\|audit\|workflow)`, `cap_item_id` | |
| `task_templates` | `id`, `organisation_id`, `title`, `description`, `assign_to_role ENUM(manager\|staff\|admin)`, `recurrence`, `cron_expression` | |
| `task_assignees` | `id`, `task_id`, `user_id`, `assign_role` | |
| `task_messages` | `id`, `task_id`, `sender_id`, `body TEXT`, `created_at` | |
| `task_attachments` | `id`, `task_id`, `file_url`, `file_type ENUM(image\|video\|document)`, `annotated_url` | |
| `task_status_history` | `id`, `task_id`, `changed_by`, `previous_status`, `new_status`, `changed_at` | Immutable audit trail |

#### Announcements

| Table | Key Columns | Notes |
|---|---|---|
| `announcements` | `id`, `organisation_id`, `created_by`, `title`, `body`, `media_url`, `requires_acknowledgement`, `publish_at`, `target_roles JSONB`, `target_location_ids JSONB`, `is_deleted` | |
| `announcement_receipts` | `id`, `announcement_id`, `user_id`, `read_at`, `acknowledged_at` | UNIQUE(announcement_id, user_id) |

#### Issues

| Table | Key Columns | Notes |
|---|---|---|
| `issue_categories` | `id`, `organisation_id`, `name`, `description`, `color`, `icon`, `sla_hours INT`, `default_priority`, `is_deleted` | |
| `issue_custom_fields` | `id`, `category_id`, `label`, `field_type ENUM(text\|number\|dropdown\|checkbox\|date)`, `options JSONB`, `is_required`, `display_order` | |
| `escalation_rules` | `id`, `category_id`, `trigger_type ENUM(on_create\|sla_breach\|priority_critical\|status_change\|unresolved_hours)`, `hours_threshold INT`, `notify_role`, `notify_user_id`, `notify_vendor_id` | |
| `issues` | `id`, `organisation_id`, `location_id`, `category_id`, `reported_by`, `assigned_to`, `assigned_vendor_id`, `asset_id`, `title`, `description`, `priority ENUM(low\|medium\|high\|critical)`, `status ENUM(open\|in_progress\|pending_vendor\|resolved\|closed)`, `location_description`, `recurrence_count INT`, `due_at`, `resolved_at`, `resolution_note`, `cost NUMERIC`, `ai_description`, `ai_suggested_category`, `ai_suggested_priority`, `ai_confidence_score`, `ai_flagged_safety BOOLEAN` | |
| `issue_custom_responses` | `id`, `issue_id`, `field_id`, `value TEXT` | |
| `issue_attachments` | `id`, `issue_id`, `file_url`, `file_type ENUM(image\|video)`, `uploaded_by` | |
| `issue_comments` | `id`, `issue_id`, `author_id`, `body`, `is_vendor_visible BOOLEAN`, `is_deleted` | |
| `issue_status_history` | `id`, `issue_id`, `changed_by`, `previous_status`, `new_status`, `changed_at` | Immutable |
| `vendor_category_access` | `vendor_id`, `category_id` | UNIQUE(vendor_id, category_id) |

#### Vendors & Assets

| Table | Key Columns | Notes |
|---|---|---|
| `vendors` | `id`, `organisation_id`, `name`, `contact_name`, `contact_email`, `contact_phone`, `is_deleted` | |
| `assets` | `id`, `organisation_id`, `location_id`, `name`, `category`, `serial_number`, `model`, `manufacturer`, `installed_at`, `last_maintenance_at`, `next_maintenance_due_at`, `total_repair_cost NUMERIC`, `predicted_days_to_failure INT`, `failure_risk_score NUMERIC`, `is_deleted` | `predicted_days_to_failure` and `failure_risk_score` are present in schema but not populated by any current backend logic |
| `repair_guides` | `id`, `organisation_id`, `asset_id`, `title`, `content TEXT`, `file_url`, `file_type`, `is_deleted` | |

#### Maintenance

| Table | Key Columns | Notes |
|---|---|---|
| `maintenance_tickets` | `id`, `organisation_id`, `asset_id`, `location_id`, `reported_by`, `assigned_to`, `assigned_vendor_id`, `title`, `description`, `priority`, `status ENUM(open\|in_progress\|pending_parts\|resolved\|closed)`, `cost NUMERIC`, `resolved_at` | Referenced by issues |

#### Incidents

| Table | Key Columns | Notes |
|---|---|---|
| `incidents` | `id`, `organisation_id`, `location_id`, `reported_by`, `title`, `description`, `severity`, `status`, `resolved_at`, `is_deleted` | |

#### LMS

| Table | Key Columns | Notes |
|---|---|---|
| `courses` | `id`, `organisation_id`, `created_by`, `title`, `description`, `thumbnail_url`, `estimated_duration_mins INT`, `passing_score INT`, `max_retakes INT`, `cert_validity_days INT`, `is_mandatory BOOLEAN`, `target_roles JSONB`, `target_location_ids JSONB`, `is_published BOOLEAN`, `language`, `ai_generated BOOLEAN`, `is_deleted` | |
| `course_modules` | `id`, `course_id`, `title`, `module_type ENUM(slides\|video\|pdf\|quiz)`, `content_url`, `display_order INT`, `is_required BOOLEAN`, `estimated_duration_mins INT`, `is_deleted` | |
| `course_slides` | `id`, `module_id`, `title`, `body TEXT`, `image_url`, `display_order INT` | |
| `quiz_questions` | `id`, `module_id`, `question TEXT`, `question_type ENUM(multiple_choice\|true_false\|image_based)`, `image_url`, `options JSONB`, `correct_option_index INT`, `explanation TEXT`, `display_order INT` | |
| `course_enrollments` | `id`, `course_id`, `user_id`, `enrolled_by`, `status ENUM(not_started\|in_progress\|passed\|failed)`, `score INT`, `attempt_count INT`, `started_at`, `completed_at`, `cert_issued_at`, `cert_expires_at`, `cert_url`, `current_module_id` | |
| `module_progress` | `id`, `enrollment_id`, `module_id`, `status ENUM(not_started\|in_progress\|completed)`, `time_spent_seconds INT` | |
| `quiz_attempts` | `id`, `enrollment_id`, `module_id`, `attempt_number INT`, `score INT`, `passed BOOLEAN`, `answers JSONB`, `knowledge_gaps JSONB` | |
| `learning_paths` | `id`, `user_id`, `organisation_id`, `title`, `status ENUM(active\|completed\|abandoned)`, `generated_by_ai BOOLEAN` | |
| `learning_path_items` | `id`, `path_id`, `course_id`, `display_order INT`, `reason TEXT`, `is_completed BOOLEAN` | |
| `ai_course_jobs` | `id`, `organisation_id`, `created_by`, `input_type ENUM(topic\|document\|video\|url)`, `input_value TEXT`, `status ENUM(queued\|processing\|completed\|failed)`, `result_course_id`, `error_message` | |
| `course_translations` | `id`, `course_id`, `language`, `translated_content JSONB`, `ai_generated BOOLEAN`, `reviewed BOOLEAN` | |

#### Gamification

| Table | Key Columns | Notes |
|---|---|---|
| `badge_configs` | `id`, `organisation_id`, `name`, `description`, `points_awarded INT`, `criteria_type ENUM(issues_reported\|issues_resolved\|checklists_completed\|checklist_streak_days\|training_completed\|attendance_streak_days\|tasks_completed\|manual)`, `criteria_threshold INT` | |
| `user_badge_awards` | `id`, `badge_config_id`, `user_id`, `awarded_by`, `awarded_at`, `note` | |
| `leaderboard_configs` | `id`, `organisation_id`, `name`, `scope ENUM(organisation\|location\|team)`, `period ENUM(daily\|weekly\|monthly)`, `metric ENUM(audits_completed\|issues_resolved\|learning_hours)`, `is_active` | |

#### Shifts & Attendance

| Table | Key Columns | Notes |
|---|---|---|
| `shift_templates` | `id`, `organisation_id`, `location_id` (nullable), `name`, `role`, `start_time TIME`, `end_time TIME`, `days_of_week INTEGER[]` (0=Mon…6=Sun) | |
| `shifts` | `id`, `organisation_id`, `location_id`, `template_id`, `assigned_to_user_id`, `role`, `start_at TIMESTAMPTZ`, `end_at`, `status ENUM(draft\|published\|open\|claimed\|cancelled)`, `is_open_shift BOOLEAN`, `cancellation_reason`, `ai_generated BOOLEAN` | |
| `open_shift_claims` | `id`, `shift_id`, `claimed_by`, `status ENUM(pending\|approved\|rejected)`, `claimed_at`, `manager_note` | UNIQUE(shift_id, claimed_by) |
| `shift_swap_requests` | `id`, `requester_shift_id`, `requested_shift_id`, `requested_user_id`, `status ENUM(pending_colleague\|pending_manager\|approved\|rejected\|cancelled)`, `colleague_response_at`, `manager_response_at`, `approved_by` | |
| `staff_availability` | `id`, `user_id`, `day_of_week INT(0–6)`, `available_from TIME`, `available_to TIME`, `is_available BOOLEAN`, `effective_from DATE`, `effective_to DATE` | UNIQUE(user_id, day_of_week) |
| `leave_requests` | `id`, `user_id`, `organisation_id`, `leave_type ENUM(annual\|sick\|emergency\|unpaid\|other)`, `start_date DATE`, `end_date DATE`, `reason TEXT`, `status ENUM(pending\|approved\|rejected)`, `approved_by` | |
| `attendance_rules` | `id`, `organisation_id UNIQUE`, `late_threshold_mins INT`, `early_departure_threshold_mins INT`, `overtime_threshold_hours NUMERIC`, `weekly_overtime_threshold_hours NUMERIC`, `break_duration_mins INT` | 1 row per org |
| `attendance_records` | `id`, `user_id`, `shift_id`, `organisation_id`, `location_id`, `clock_in_at TIMESTAMPTZ`, `clock_out_at`, `clock_in_method ENUM(gps\|selfie\|facial_recognition\|qr_code\|manager_override)`, `clock_in_latitude NUMERIC`, `clock_in_longitude NUMERIC`, `clock_in_geo_valid BOOLEAN`, `total_minutes INT`, `overtime_minutes INT`, `break_minutes INT`, `status ENUM(present\|late\|early_departure\|absent\|unverified)`, `manager_override_note` | |
| `face_profiles` | `id`, `user_id UNIQUE`, `enrolled BOOLEAN`, `enrolled_at` | Schema exists; no backend logic populates it |
| `ai_schedule_jobs` | `id`, `organisation_id`, `week_start DATE`, `shifts_created INT`, `warnings TEXT[]`, `status ENUM(pending\|running\|completed\|failed)` | |

#### Onboarding

| Table | Key Columns | Notes |
|---|---|---|
| `onboarding_sessions` | `id`, `organisation_id UNIQUE`, `current_step INT(1–7)`, `status ENUM(in_progress\|completed\|abandoned)`, `website_url`, `company_name`, `industry_code`, `industry_subcategory`, `estimated_locations INT`, `brand_color`, `logo_url`, `employee_source ENUM(sprout_hr\|hris_other\|csv\|manual\|invite_link)`, `launch_progress JSONB`, `ai_context JSONB` | |
| `industry_packages` | `id`, `industry_code`, `name`, `description`, `version INT`, `is_active` | UNIQUE(industry_code, version) |
| `template_items` | `id`, `package_id`, `category ENUM(form\|checklist\|audit\|issue_category\|workflow\|training_module\|shift_template\|repair_manual)`, `name`, `description`, `content JSONB`, `is_recommended`, `sort_order` | |
| `onboarding_selections` | `session_id`, `template_id` | UNIQUE(session_id, template_id) |
| `onboarding_employees` | `id`, `session_id`, `full_name`, `email`, `phone`, `position`, `department`, `retail_role`, `location_name`, `status ENUM(pending\|invited\|active\|failed)` | |
| `role_mappings` | `id`, `session_id`, `source_title`, `source_department`, `source_level`, `retail_role ENUM(super_admin\|admin\|manager\|staff)`, `confidence_score FLOAT(0–1)`, `is_confirmed`, `employee_count INT` | AI-inferred from CSV imports |
| `employee_import_jobs` | `id`, `session_id`, `status ENUM(pending\|processing\|completed\|failed\|partial)`, `total_records INT`, `processed_records INT`, `failed_records INT`, `error_log JSONB`, `source_metadata JSONB` | |

#### Logging

| Table | Key Columns | Notes |
|---|---|---|
| `ai_request_log` | `id`, `organisation_id`, `user_id`, `feature TEXT`, `provider TEXT`, `model TEXT`, `input_tokens INT`, `output_tokens INT`, `latency_ms INT`, `success BOOLEAN`, `error_message`, `created_at` | Written by `AILogger` service after every Claude call |

### Storage Buckets

Configured in Supabase Storage (from migration `20260318000009_storage.sql` and subsequent migrations):

| Bucket | Contents |
|---|---|
| `forms` | Form response file uploads, signature images |
| `announcements` | Announcement media attachments |
| `videos` | Training course video files |
| `tasks` | Task attachment files |
| `issues` | Issue photo/video attachments |
| `audit-exports` | PDF exports of audit submissions |
| `cap-exports` | PDF exports of CAPs |
| `repair-guides` | Repair guide file uploads |

### RLS Policy Patterns

- **Service role key:** Full access on all tables (used by backend)
- **`super_admin` / `admin`:** Full read/write for their `organisation_id`
- **`manager`:** Organisation-scoped read + location-scoped write on operational tables
- **`staff`:** Read own assignments; write own submissions, responses, attendance
- **Vendors:** `issue_comments` scoped by `is_vendor_visible = true` where `assigned_vendor_id` matches
- **Onboarding tables:** `admin` and `super_admin` only during onboarding session

---

## API Endpoints

All routes are prefixed `/api/v1`. Auth required on all routes except `/health`, `/docs`, `POST /api/v1/auth/login`, `POST /api/v1/auth/demo-start`.

**Auth dependency levels:**
- `get_current_user` — any authenticated role
- `require_manager_or_above` — manager, admin, super_admin
- `require_admin` — admin, super_admin only

### Auth — `/api/v1/auth`

| Method | Path | Description |
|---|---|---|
| `POST` | `/login` | Email/password login via Supabase auth |
| `POST` | `/logout` | Invalidate session |
| `POST` | `/change-password` | Change authenticated user's password |
| `POST` | `/demo-start` | Create demo org + super_admin + onboarding session |

### Users — `/api/v1/users`

| Method | Path | Description |
|---|---|---|
| `GET` | `/me` | Current user profile |
| `GET` | `/` | List org users (manager+); filters: location_id, role, search, page |
| `POST` | `/` | Create user (admin) |
| `POST` | `/bulk-import` | Bulk import users from multipart CSV |
| `GET` | `/positions` | Distinct position strings in org |
| `GET` | `/{user_id}` | User detail |
| `PATCH` | `/{user_id}` | Update user |
| `DELETE` | `/{user_id}` | Delete user |

### Organisations — `/api/v1/organisations`

| Method | Path | Description |
|---|---|---|
| `GET` | `/{org_id}` | Organisation details |
| `PUT` | `/{org_id}` | Update organisation |
| `GET` | `/{org_id}/locations` | List locations |
| `POST` | `/{org_id}/locations` | Create location |
| `PUT` | `/{org_id}/locations/{loc_id}` | Update location |

### Forms — `/api/v1/forms`

| Method | Path | Description |
|---|---|---|
| `GET` | `/templates` | List form templates; filters: type, is_active, page |
| `POST` | `/templates` | Create form template |
| `GET` | `/templates/{id}` | Template detail |
| `PUT` | `/templates/{id}` | Update template |
| `DELETE` | `/templates/{id}` | Delete template (soft) |
| `GET` | `/templates/{id}/stats` | Submission stats for template |
| `POST` | `/generate` | AI-generate form from text description |
| `POST` | `/assignments` | Create form assignment |
| `GET` | `/assignments/my` | Current user's form assignments |
| `GET` | `/assignments/{id}/template` | Template for assignment |
| `GET` | `/assignments/{id}/draft` | User's draft submission for assignment |
| `POST` | `/submissions` | Submit (or save draft) form response |
| `GET` | `/submissions` | List submissions; filters: template_id, user_id, location_id, status, dates, page |
| `GET` | `/submissions/{id}` | Submission detail with responses |
| `PUT` | `/submissions/{id}/review` | Approve or reject submission (manager+) |

### Announcements — `/api/v1/announcements`

| Method | Path | Description |
|---|---|---|
| `POST` | `/` | Create announcement |
| `GET` | `/` | List announcements for current user (role + location filtered) |
| `GET` | `/{id}` | Announcement detail |
| `PUT` | `/{id}` | Update announcement |
| `POST` | `/{id}/read` | Mark as read |
| `POST` | `/{id}/acknowledge` | Acknowledge (when requires_acknowledgement=true) |
| `GET` | `/{id}/receipts` | Read/acknowledge receipts (manager+) |

### Dashboard — `/api/v1/dashboard`

| Method | Path | Description |
|---|---|---|
| `GET` | `/summary` | KPI summary: task counts, form completion, issue counts, audit scores |

### Audits — `/api/v1/audits`

| Method | Path | Description |
|---|---|---|
| `POST` | `/templates/generate` | AI-generate audit template from prompt |
| `POST` | `/templates` | Create audit template |
| `GET` | `/templates` | List audit templates |
| `GET` | `/templates/{id}` | Audit template detail with weights/scores |
| `PUT` | `/templates/{id}` | Update template |
| `DELETE` | `/templates/{id}` | Delete template |
| `POST` | `/submissions` | Submit audit (scores computed server-side; CAP created atomically) |
| `GET` | `/submissions` | List audit submissions |
| `GET` | `/submissions/{id}` | Submission detail with field scores and CAP |
| `GET` | `/submissions/{id}/export` | Download audit as PDF (reportlab) |
| `POST` | `/submissions/{id}/signature` | Upload auditee signature image to storage |

### Corrective Actions — `/api/v1/corrective-actions`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List corrective actions; filters: status, location_id, dates |
| `GET` | `/{id}` | Corrective action detail |
| `PUT` | `/{id}` | Update corrective action |

### CAPs — `/api/v1/caps`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List CAPs; filters: status, location_id, dates, page |
| `GET` | `/submission/{submission_id}` | CAP for a specific audit submission |
| `GET` | `/{id}` | CAP detail with items |
| `PUT` | `/{id}/items/{item_id}` | Update CAP item (followup type, priority, notes) |
| `POST` | `/{id}/confirm` | Confirm CAP (spawns tasks/issues/incidents from items) |
| `POST` | `/{id}/dismiss` | Dismiss CAP with reason |
| `GET` | `/{id}/export` | Download CAP as PDF |

### Workflows — `/api/v1/workflows`

| Method | Path | Description |
|---|---|---|
| `GET` | `/definitions` | List workflow definitions |
| `POST` | `/definitions` | Create workflow definition |
| `GET` | `/definitions/{id}` | Definition detail with stages and rules |
| `PUT` | `/definitions/{id}` | Update definition |
| `DELETE` | `/definitions/{id}` | Delete definition |
| `POST` | `/definitions/{id}/duplicate` | Duplicate definition |
| `POST` | `/definitions/{id}/publish` | Publish (validates stages exist) |
| `POST` | `/definitions/{id}/stages` | Add stage |
| `PUT` | `/definitions/{id}/stages/reorder` | Reorder stages |
| `PUT` | `/definitions/{id}/stages/{stage_id}` | Update stage |
| `DELETE` | `/definitions/{id}/stages/{stage_id}` | Delete stage |
| `POST` | `/definitions/{id}/routing-rules` | Add routing rule |
| `PUT` | `/definitions/{id}/rules/{rule_id}` | Update routing rule |
| `DELETE` | `/definitions/{id}/rules/{rule_id}` | Delete routing rule |
| `POST` | `/instances` | Trigger new workflow instance |
| `GET` | `/instances` | List instances; filters: status, location_id, definition_id, dates, my_team |
| `GET` | `/instances/my-tasks` | Instances where current user has a pending stage |
| `GET` | `/instances/{id}` | Instance detail with stage history |
| `POST` | `/instances/{id}/cancel` | Cancel running instance |
| `POST` | `/instances/{id}/stages/{stage_id}/approve` | Approve stage |
| `POST` | `/instances/{id}/stages/{stage_id}/reject` | Reject stage |
| `POST` | `/instances/{id}/stages/{stage_id}/submit-form` | Submit form for a form-type stage |

### Reports — `/api/v1/reports`

| Method | Path | Description |
|---|---|---|
| `GET` | `/compliance` | Audit compliance trend (weekly buckets) |
| `GET` | `/checklist-completion` | Checklist completion rates by template |

### Tasks — `/api/v1/tasks`

| Method | Path | Description |
|---|---|---|
| `GET` | `/templates` | List task templates |
| `POST` | `/templates` | Create task template |
| `PUT` | `/templates/{id}` | Update task template |
| `DELETE` | `/templates/{id}` | Delete task template |
| `POST` | `/templates/{id}/spawn` | Spawn a task instance from template |
| `GET` | `/` | List tasks; filters: status, priority, assigned_to, location_id, source_type, overdue, dates, my_team, my_tasks |
| `POST` | `/` | Create task |
| `GET` | `/my` | Current user's assigned tasks |
| `GET` | `/summary` | Org-wide task count summary |
| `GET` | `/unread-count` | Unread task messages count for current user |
| `GET` | `/{id}` | Task detail with assignees, messages, attachments |
| `PUT` | `/{id}` | Update task |
| `PUT` | `/{id}/status` | Update task status (writes to status_history) |
| `POST` | `/{id}/assignees` | Add assignee |
| `DELETE` | `/{id}/assignees/{assignee_id}` | Remove assignee |
| `POST` | `/{id}/messages` | Post message on task thread |
| `POST` | `/{id}/read` | Mark task messages as read |
| `POST` | `/{id}/attachments` | Upload attachment |
| `PUT` | `/{id}/attachments/{attachment_id}/annotate` | Save annotated version of attachment |

### Notifications — `/api/v1/notifications`

| Method | Path | Description |
|---|---|---|
| `PUT` | `/fcm-token` | Register or update user's FCM device token |
| `GET` | `/log` | FCM notification send log (admin) |

### Issue Categories — `/api/v1/issues/categories`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List categories with custom fields and escalation rules |
| `POST` | `/` | Create category |
| `PUT` | `/{id}` | Update category |
| `DELETE` | `/{id}` | Delete category |
| `POST` | `/{id}/custom-fields` | Add custom field to category |
| `PUT` | `/{id}/custom-fields/{field_id}` | Update custom field |
| `DELETE` | `/{id}/custom-fields/{field_id}` | Delete custom field |
| `POST` | `/{id}/escalation-rules` | Add escalation rule |
| `PUT` | `/{id}/escalation-rules/{rule_id}` | Update escalation rule |
| `DELETE` | `/{id}/escalation-rules/{rule_id}` | Delete escalation rule |

### Issue Dashboard — `/api/v1/issues/dashboard`

| Method | Path | Description |
|---|---|---|
| `GET` | `/summary` | Issue counts by status, priority, category |
| `GET` | `/trends` | Issue volume over time; filters: location_id, category_id, dates |
| `GET` | `/by-asset` | Issue counts grouped by asset |
| `GET` | `/by-location` | Issue counts grouped by location |
| `GET` | `/recurring` | Recurring issues (recurrence_count > 1) |

### Issues — `/api/v1/issues`

| Method | Path | Description |
|---|---|---|
| `POST` | `/` | Create issue |
| `GET` | `/` | List issues; filters: status, priority, category_id, location_id, assigned_to, recurring, dates, my_issues, my_team |
| `GET` | `/{id}` | Issue detail with comments, attachments, custom responses |
| `PUT` | `/{id}` | Update issue |
| `PUT` | `/{id}/status` | Update issue status (writes to status_history) |
| `POST` | `/{id}/comments` | Add comment |
| `DELETE` | `/{id}/comments/{comment_id}` | Delete comment |
| `POST` | `/{id}/attachments` | Upload photo/video attachment |
| `GET` | `/{id}/export` | Download issue as PDF |

### Vendors — `/api/v1/vendors`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List vendors |
| `POST` | `/` | Create vendor |
| `PUT` | `/{id}` | Update vendor |
| `DELETE` | `/{id}` | Delete vendor (soft) |
| `POST` | `/{id}/category-access` | Grant vendor access to issue category |
| `DELETE` | `/{id}/category-access/{category_id}` | Revoke category access |

### Assets — `/api/v1/assets`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List assets; filter: location_id |
| `POST` | `/` | Create asset |
| `GET` | `/{id}` | Asset detail with maintenance history |
| `PUT` | `/{id}` | Update asset |
| `DELETE` | `/{id}` | Delete asset (soft) |
| `GET` | `/{id}/guides` | Repair guides linked to asset |

### Repair Guides — `/api/v1/repair-guides`

| Method | Path | Description |
|---|---|---|
| `POST` | `/` | Create guide (optional file upload to storage) |
| `GET` | `/` | List guides; filters: asset_id, category_id |
| `GET` | `/{id}` | Guide detail |
| `DELETE` | `/{id}` | Delete guide |

### Maintenance — `/api/v1/maintenance`

| Method | Path | Description |
|---|---|---|
| `POST` | `/` | Create maintenance ticket |
| `GET` | `/` | List tickets; filters: asset_id, status, priority, assigned_to, vendor_id, location_id, page |
| `GET` | `/{id}` | Ticket detail |
| `PUT` | `/{id}/status` | Update ticket status |
| `PUT` | `/{id}/assign` | Assign ticket to user or vendor |
| `PUT` | `/{id}/cost` | Record maintenance cost |

### Safety — `/api/v1/safety`

| Method | Path | Description |
|---|---|---|
| `GET` | `/leaderboard` | Safety points leaderboard; filter: location_id |
| `GET` | `/badges` | List safety badge configs |
| `POST` | `/badges` | Create safety badge config |
| `GET` | `/badges/my` | Current user's awarded badges |
| `POST` | `/badges/{id}/award` | Award badge to a user |
| `GET` | `/points/my` | Current user's safety points total |

### Incidents — `/api/v1/incidents`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List incidents |
| `POST` | `/` | Create incident |
| `GET` | `/{id}` | Incident detail |
| `PATCH` | `/{id}` | Update incident |
| `PUT` | `/{id}/status` | Update incident status |
| `POST` | `/{id}/attachments` | Upload attachment |
| `GET` | `/{id}/export` | Export incident as PDF |

### AI Generate — `/api/v1/ai`

| Method | Path | Description |
|---|---|---|
| `POST` | `/generate-repair-guide` | Generate repair guide markdown from asset + symptom description |
| `POST` | `/generate-issue-categories` | Generate issue category definitions for an industry |
| `POST` | `/generate-badges` | Generate badge definitions for an industry |
| `POST` | `/generate-workflow` | Generate workflow stages + routing rules from prompt |
| `POST` | `/classify-issue` | Classify issue title/description into category + priority + safety flag |
| `POST` | `/analyse-photo` | Analyse photo (Claude vision) for hazards or maintenance issues |
| `POST` | `/suggest-task-priority` | Suggest task priority from title + description |
| `POST` | `/generate-audit-template` | Generate audit template with sections + fields from prompt |
| `POST` | `/generate-quiz` | Generate quiz questions from course content |
| `POST` | `/translate-course` | Translate course content to a target language |
| `POST` | `/knowledge-gaps` | Analyse quiz_attempts to identify knowledge gaps |
| `POST` | `/learning-path` | Generate personalised learning path for a user |
| `POST` | `/chat` | Sidekick AI assistant (streaming supported) |

### Gamification — `/api/v1/gamification`

| Method | Path | Description |
|---|---|---|
| `GET` | `/leaderboards` | List leaderboard configs |
| `POST` | `/leaderboards` | Create leaderboard |
| `GET` | `/leaderboards/{id}` | Leaderboard with ranked entries |
| `GET` | `/badges` | List badge configs |
| `GET` | `/badges/my` | Current user's awarded badges |
| `POST` | `/badges` | Create badge config |
| `PUT` | `/badges/{id}` | Update badge config |
| `DELETE` | `/badges/{id}` | Delete badge config |
| `POST` | `/badges/{id}/award` | Award badge to user |
| `GET` | `/points/my` | Current user's points |
| `GET` | `/points/org` | Org-wide points summary |
| `GET` | `/points/summary` | Points summary (alias) |
| `GET` | `/templates/badges` | Preset badge templates |
| `GET` | `/templates/leaderboards` | Preset leaderboard templates |
| `POST` | `/templates/seed` | Seed default templates for org |

### LMS — `/api/v1/lms`

| Method | Path | Description |
|---|---|---|
| `GET` | `/courses` | List published courses |
| `GET` | `/courses/manage` | List all courses for editor; filters: search, page |
| `POST` | `/courses` | Create course |
| `GET` | `/courses/{id}` | Course detail with modules, slides, quiz questions |
| `PUT` | `/courses/{id}` | Update course metadata |
| `PUT` | `/courses/{id}/structure` | Batch-save module + slide + question structure |
| `DELETE` | `/courses/{id}` | Delete course (soft) |
| `POST` | `/courses/{id}/publish` | Publish course |
| `POST` | `/courses/{id}/unpublish` | Unpublish course |
| `POST` | `/courses/{id}/duplicate` | Duplicate course and all content |
| `GET` | `/courses/{id}/enrollable-users` | Users who can be enrolled |
| `GET` | `/courses/{id}/enrollment-stats` | Enrollment and completion stats |
| `POST` | `/courses/generate` | Start AI course generation job (async) |
| `GET` | `/courses/generate/{job_id}` | Poll AI course generation job status |
| `GET` | `/locations` | Org locations (for course targeting) |

### Audit Trail — `/api/v1/settings`

| Method | Path | Description |
|---|---|---|
| `GET` | `/audit-trail` | Paginated event log; filters: entity_type (task\|issue\|form\|workflow\|onboarding) |

### Shifts — `/api/v1/shifts`

| Method | Path | Description |
|---|---|---|
| `GET` | `/templates` | List shift templates; filter: location_id |
| `POST` | `/templates` | Create shift template |
| `PUT` | `/templates/{id}` | Update shift template |
| `DELETE` | `/templates/{id}` | Delete shift template |
| `POST` | `/templates/{id}/generate` | Bulk generate shifts from template for a date range |
| `GET` | `/` | List shifts; filters: location_id, user_id, status, date range, page |
| `POST` | `/` | Create shift |
| `POST` | `/publish` | Publish selected shifts |
| `POST` | `/publish/bulk` | Bulk publish all draft shifts for a date range |
| `GET` | `/my` | Current user's upcoming shifts |
| `GET` | `/open` | Open shift offers available to claim |
| `GET` | `/claims` | Shift claim requests; filters: shift_id, status |
| `GET` | `/swaps` | Swap requests; filter: status |
| `POST` | `/swaps` | Create shift swap request |
| `POST` | `/swaps/{id}/respond` | Approve or reject swap request |

### Onboarding — `/api/v1/onboarding`

| Method | Path | Description |
|---|---|---|
| `POST` | `/sessions` | Create onboarding session for current org |
| `GET` | `/sessions/current` | Get current org's active session |
| `GET` | `/sessions/{id}` | Get session detail |
| `POST` | `/sessions/{id}/discover` | Scrape company URL with Claude; returns profile |
| `POST` | `/sessions/{id}/discover/fallback` | Manual company profile input |
| `POST` | `/sessions/{id}/confirm-company` | Save company details; advance to step 2 |
| `GET` | `/sessions/{id}/templates` | Fetch industry template package |
| `PATCH` | `/sessions/{id}/selections` | Toggle template item selections |
| `GET` | `/sessions/{id}/selections/summary` | Count selected items per category |
| `POST` | `/sessions/{id}/confirm-templates` | Save selections; advance to step 3 |
| `GET` | `/sessions/{id}/suggest-locations` | AI-suggest branch names for company |
| `POST` | `/sessions/{id}/locations` | Add location |
| `DELETE` | `/sessions/{id}/locations/{loc_id}` | Remove location |
| `GET` | `/sessions/{id}/suggest-assets` | AI-suggest equipment for industry |
| `POST` | `/sessions/{id}/assets` | Add asset |
| `DELETE` | `/sessions/{id}/assets/{asset_id}` | Remove asset |
| `POST` | `/sessions/{id}/vendors` | Add vendor |
| `DELETE` | `/sessions/{id}/vendors/{vendor_id}` | Remove vendor |
| `POST` | `/sessions/{id}/employee-source` | Set employee data source |
| `GET` | `/sessions/{id}/csv-template` | Download CSV import template |
| `POST` | `/sessions/{id}/upload-employees` | Upload and AI-map employee CSV |
| `GET` | `/sessions/{id}/role-mappings` | Get AI role mapping results |
| `PATCH` | `/sessions/{id}/role-mappings/{mapping_id}` | Confirm or override AI role mapping |
| `POST` | `/sessions/{id}/employees` | Manually add employee |
| `GET` | `/sessions/{id}/employees` | List onboarding employees |
| `DELETE` | `/sessions/{id}/employees/{employee_id}` | Remove employee |
| `GET` | `/sessions/{id}/preview` | Workspace preview summary |
| `POST` | `/sessions/{id}/launch` | Start background provisioning task |
| `GET` | `/sessions/{id}/launch-progress` | Poll provisioning progress |
| `GET` | `/sessions/{id}/first-actions` | Post-launch guided next steps |

---

## Frontend Pages

All dashboard routes are protected by `middleware.ts`. Staff role is blocked from `/dashboard/users`.

### Auth

| Route | File | Description |
|---|---|---|
| `/login` | `(auth)/login/page.tsx` | Email/password login form; dev quick-login buttons (hardcoded test accounts); demo workspace creation and switching |
| `/set-password` | `(auth)/set-password/page.tsx` | Password setup for invite link flow |
| `/auth/callback` | `auth/callback/page.tsx` | Supabase OAuth implicit-flow callback handler |

### Onboarding

| Route | File | Description |
|---|---|---|
| `/onboarding` | `(onboarding)/onboarding/page.tsx` | 7-step AI wizard (Company → Templates → Locations → Assets & Vendors → Team → Preview → Launch). All steps rendered in a single page component with step state machine. |

### Dashboard

| Route | File | Description |
|---|---|---|
| `/dashboard` | `(dashboard)/dashboard/page.tsx` | Main home; role-differentiated (admin/manager vs staff); daily AI brief (localStorage cached) |
| `/dashboard/tasks` | `dashboard/tasks/page.tsx` | Task list with status, priority, date filters |
| `/dashboard/issues` | `dashboard/issues/page.tsx` | Issue list with multi-filter |
| `/dashboard/issues/categories` | `dashboard/issues/categories/page.tsx` | Issue category editor (custom fields, escalation rules) |
| `/dashboard/issues/dashboard` | `dashboard/issues/dashboard/page.tsx` | Issue analytics (trends, by-location, by-asset, recurring) |
| `/dashboard/audits` | `dashboard/audits/page.tsx` | Audit submission list |
| `/dashboard/audits/caps` | `dashboard/audits/caps/page.tsx` | CAP list |
| `/dashboard/audits/caps/[id]` | `dashboard/audits/caps/[id]/page.tsx` | CAP detail; confirm/dismiss; spawn follow-ups |
| `/dashboard/audits/templates` | `dashboard/audits/templates/page.tsx` | Audit template list and builder |
| `/dashboard/audits/corrective-actions` | `dashboard/audits/corrective-actions/page.tsx` | Corrective actions list |
| `/dashboard/forms` | `dashboard/forms/page.tsx` | Form/checklist template list |
| `/dashboard/forms/fill/[id]` | `dashboard/forms/fill/[id]/page.tsx` | Form fill view for assignments |
| `/dashboard/training` | `dashboard/training/page.tsx` | Training dashboard (enrollment stats, course list) |
| `/dashboard/training/courses` | `dashboard/training/courses/page.tsx` | Published courses list |
| `/dashboard/training/courses/new` | `dashboard/training/courses/new/page.tsx` | New course creation form |
| `/dashboard/training/courses/[id]` | `dashboard/training/courses/[id]/page.tsx` | Course editor (modules, slides, quizzes, enrollment) |
| `/dashboard/training/learn/[enrollmentId]` | `dashboard/training/learn/[enrollmentId]/page.tsx` | Course player (slides, quiz taking) |
| `/dashboard/workflows` | `dashboard/workflows/page.tsx` | Workflow definition list |
| `/dashboard/workflows/builder/[id]` | `dashboard/workflows/builder/[id]/page.tsx` | Workflow stage and rule builder |
| `/dashboard/workflows/instances` | `dashboard/workflows/instances/page.tsx` | Running workflow instances |
| `/dashboard/workflows/my-tasks` | `dashboard/workflows/my-tasks/page.tsx` | Workflows with pending action for current user |
| `/dashboard/workflows/fill/[instanceId]/[stageInstanceId]` | `dashboard/workflows/fill/.../page.tsx` | Form fill for workflow stage |
| `/dashboard/announcements` | `dashboard/announcements/page.tsx` | Announcements list and creation |
| `/dashboard/safety` | `dashboard/safety/page.tsx` | Safety leaderboard and points |
| `/dashboard/maintenance` | `dashboard/maintenance/page.tsx` | Maintenance ticket list |
| `/dashboard/maintenance/assets` | `dashboard/maintenance/assets/page.tsx` | Asset inventory |
| `/dashboard/maintenance/guides` | `dashboard/maintenance/guides/page.tsx` | Repair guides list |
| `/dashboard/shifts` | `dashboard/shifts/page.tsx` | Shift schedule, open shifts, swap requests |
| `/dashboard/insights` | `dashboard/insights/page.tsx` | Insights overview |
| `/dashboard/insights/reports/tasks` | `...reports/tasks/page.tsx` | Task analytics report |
| `/dashboard/insights/reports/training` | `...reports/training/page.tsx` | Training completion analytics |
| `/dashboard/insights/reports/operations/audits` | `...operations/audits/page.tsx` | Audit compliance report |
| `/dashboard/insights/reports/operations/caps` | `...operations/caps/page.tsx` | CAP resolution report |
| `/dashboard/insights/reports/operations/checklists` | `...operations/checklists/page.tsx` | Checklist completion report |
| `/dashboard/insights/reports/safety/leaderboard` | `...safety/leaderboard/page.tsx` | Safety points leaderboard report |
| `/dashboard/insights/reports/issues/maintenance` | `...issues/maintenance/page.tsx` | Maintenance issue report |
| `/dashboard/insights/reports/issues/incidents` | `...issues/incidents/page.tsx` | Incident report |
| `/dashboard/insights/reports/issues/summary` | `...issues/summary/page.tsx` | Issue summary report |
| `/dashboard/insights/reports/issues/recurring` | `...issues/recurring/page.tsx` | Recurring issues report |
| `/dashboard/insights/reports/compliance` | `...reports/compliance/page.tsx` | Compliance trend report |
| `/dashboard/vendors` | `dashboard/vendors/page.tsx` | Vendor list and category access management |
| `/dashboard/settings` | `dashboard/settings/page.tsx` | Settings overview |
| `/dashboard/settings/locations` | `dashboard/settings/locations/page.tsx` | Location management |
| `/dashboard/settings/roles` | `dashboard/settings/roles/page.tsx` | Role management |
| `/dashboard/settings/users` | `dashboard/settings/users/page.tsx` | User management (manager+ only) |
| `/dashboard/settings/audit-trail` | `dashboard/settings/audit-trail/page.tsx` | Audit trail log viewer |
| `/dashboard/settings/badges` | `dashboard/settings/badges/page.tsx` | Badge config management |

### Shared Components (`components/`)

| Component | Description |
|---|---|
| `announcements/AnnouncementCard.tsx` | Announcement card with read/acknowledge actions |
| `audits/AuditDetailModal.tsx` | Modal showing audit submission scores and field results |
| `auth/LoginForm.tsx` | Login form with dev quick-login and demo workspace management |
| `issues/IssuesTabNav.tsx` | Tab navigation bar for Issues section |
| `layout/Sidebar.tsx` | Primary navigation sidebar with role-based menu filtering |
| `shared/AssignPeoplePanel.tsx` | User/role assignment panel used by tasks and workflows |
| `shared/PositionCombobox.tsx` | Searchable position input combobox |
| `shared/SidekickChat.tsx` | Floating AI chat assistant (calls `/api/v1/ai/chat`) |
| `tasks/CreateTaskModal.tsx` | Modal to create tasks with assignees and due date |
| `workflows/WorkflowInstanceModal.tsx` | Modal to view and action running workflow instances |
| `training/courses/_components/EnrollStaffModal.tsx` | Modal to enroll users into a course |

---

## Mobile (Flutter)

**App name:** `frontline_app`
**Description:** "Frontline Operations Platform by Sprout Solutions — Phase 1"
**Platforms:** Android and iOS
**State management:** Riverpod (manual providers; code generation disabled due to upstream package conflicts between `riverpod_generator` and `hive_generator`)
**Local storage:** Hive (manual TypeAdapters; `hive_generator` disabled for same reason)

### Screens

| Route | Screen | Description |
|---|---|---|
| `/login` | `LoginScreen` | Email/password login via Supabase auth |
| `/dashboard` | `DashboardScreen` | Home screen (content not yet detailed) |
| `/announcements` | `AnnouncementsScreen` | Announcements list |
| `/forms` | `FormsScreen` | Forms/checklists list |

Navigation is handled by `GoRouter` with a `ShellRoute` wrapping dashboard routes. The bottom nav bar has 3 items: Dashboard, Announcements, Forms.

### Core Infrastructure

| File | Description |
|---|---|
| `core/config/app_config.dart` | API base URL and environment config |
| `core/api/dio_client.dart` | Dio HTTP client with base URL and timeout config |
| `core/api/auth_interceptor.dart` | Adds Bearer token to all requests; handles 401 token refresh |
| `core/auth/auth_repository.dart` | Supabase auth calls (sign in, sign out, session) |
| `core/offline/hive_service.dart` | Hive box initialisation and local data access |
| `core/offline/connectivity_service.dart` | Connectivity monitoring (online/offline detection) |
| `core/router/app_router.dart` | GoRouter definition with auth redirect guards |
| `core/theme/app_theme.dart` | Material 3 theme configuration |
| `features/auth/providers/auth_provider.dart` | Riverpod provider for Supabase auth session |

The mobile app has 4 screens implemented. The full feature set present in the web app (audits, tasks, issues, shifts, training, workflows, etc.) is not yet implemented in mobile.

---

## Integrations

### Supabase

- **Role:** PostgreSQL database, authentication, file storage, real-time (configured but not actively used in application code)
- **Client (backend):** `supabase-py 2.28.2` — service role key used for all DB operations; bypasses RLS
- **Client (web):** `@supabase/supabase-js ^2.99.2` with `@supabase/ssr ^0.9.0` for cookie-based session management
- **Client (mobile):** `supabase_flutter ^2.9.0`
- **Local dev:** Supabase CLI; ports 54321 (API), 54322 (DB), 54323 (realtime), 54324 (storage), 54325 (Inbucket mail)
- **Auth:** Email/password via Supabase Auth; JWT tokens verified by backend using `PyJWT` with Supabase JWKS or symmetric secret

### Anthropic Claude API

- **SDK:** `anthropic >=0.49.0`
- **Model used everywhere:** `claude-haiku-4-5` / `claude-haiku-4-5-20251001`
- **Auth:** `ANTHROPIC_API_KEY` environment variable
- **Retry logic:** 3 retries with exponential backoff on HTTP 529 (overloaded)
- **Threading:** All blocking Claude calls run in `asyncio.to_thread()` to avoid blocking the FastAPI event loop

### FCM (Firebase Cloud Messaging)

- `fcm_server_key` and `firebase_project_id` are present in `config.py`
- `fcm_token` column exists on `profiles` table
- `PUT /api/v1/notifications/fcm-token` endpoint registers tokens
- Two `# TODO` comments in `workflow_service.py` reference sending FCM notifications
- No actual FCM send logic is implemented

### Resend (Email)

- `resend_api_key` and `resend_from_email` in `config.py`
- No Resend SDK imported or called anywhere in backend code

### ReportLab (PDF)

- Used in: audit export, CAP export, incident export, issue export
- Generates PDF in-memory and returns as streaming response

---

## Auth

### Web (Next.js)

1. User submits credentials to `POST /api/v1/auth/login` which calls Supabase Auth
2. Supabase returns a JWT; stored in browser cookies via `@supabase/ssr`
3. `middleware.ts` runs on every request, refreshes the session, and enforces route guards:
   - Unauthenticated → redirect to `/login`
   - Authenticated on `/login` → redirect to `/dashboard`
   - `staff` role on `/dashboard/users` → blocked
4. `services/api/client.ts` reads the session and adds `Authorization: Bearer <token>` to every API request

### Backend (FastAPI)

1. `AuthMiddleware` enforces Bearer token presence for all non-public paths
2. `get_current_user()` dependency: decodes JWT using Supabase JWKS (ES256/RS256) or symmetric HS256 secret; audience must be `"authenticated"`; leeway of 12 hours applied for local dev clock skew
3. JWT `app_metadata` contains `organisation_id` and `role`; if missing, backend enriches from `profiles` table
4. `require_manager_or_above()` and `require_admin()` are layered on top

### Mobile (Flutter)

- `supabase_flutter` manages the session
- `auth_interceptor.dart` injects the Bearer token on all Dio requests and refreshes on 401
- `GoRouter` redirect guard checks `authSessionProvider` (Riverpod); redirects unauthenticated users to `/login`

---

## AI Usage

All AI calls use `claude-haiku-4-5` or `claude-haiku-4-5-20251001`. Every call is logged to `ai_request_log` via the `AILogger` service (feature name, model, token counts, latency, success/failure).

### Onboarding (`backend/routes/onboarding.py`)

| Call site | What it does |
|---|---|
| `POST /sessions/{id}/discover` | Scrapes company website; Claude returns structured company profile (name, industry, products, estimated locations, brand color) as JSON |
| `GET /sessions/{id}/suggest-locations` | Claude generates realistic branch/location names for the company |
| `GET /sessions/{id}/suggest-assets` | Claude suggests 6–10 typical equipment items for the industry, assigned to locations |
| `POST /sessions/{id}/upload-employees` | Claude maps CSV job titles/departments to internal role enum (`super_admin\|admin\|manager\|staff`) with confidence scores |
| Provisioning — training modules | Claude generates slide content and quiz questions for each course module (sequential; 8 calls for 8 courses) |
| Provisioning — repair guides | Claude generates a repair guide for each registered asset |
| Provisioning — badges | Claude suggests 4–5 employee achievement badge definitions for the industry |

All JSON responses from Claude are stripped of markdown code fences before `json.loads()`.

### Forms (`backend/services/ai_service.py` + `backend/routes/forms.py`)

| Call site | What it does |
|---|---|
| `POST /forms/generate` | Claude generates a complete form template (sections → fields with types, validation, options) from a plain-text description |

### Audits (`backend/routes/audits.py`)

| Call site | What it does |
|---|---|
| `POST /audits/templates/generate` | Claude generates an audit template with sections, fields, and max scores from a prompt; system prompt frames Claude as an audit template designer |

### CAPs (`backend/services/cap_service.py`)

| Call site | What it does |
|---|---|
| Post-audit submission | Claude analyses failed audit fields and generates suggested corrective action items (followup type, title, description, priority) as JSON |

### AI Generate endpoints (`backend/routes/ai_generate.py`)

| Endpoint | What it does |
|---|---|
| `POST /ai/generate-repair-guide` | Returns a markdown repair guide for an asset + symptom |
| `POST /ai/generate-issue-categories` | Returns category definitions with colors, icons, SLAs for an industry |
| `POST /ai/generate-badges` | Returns badge definitions with criteria for an industry |
| `POST /ai/generate-workflow` | Returns workflow stage + routing rule JSON from a prompt |
| `POST /ai/classify-issue` | Returns predicted category, priority (low/medium/high/critical), and `ai_flagged_safety` boolean |
| `POST /ai/analyse-photo` | Claude vision: takes base64 image, returns findings (hazards, damage, recommendations) |
| `POST /ai/suggest-task-priority` | Returns `critical\|high\|medium\|low` with a one-line reason |
| `POST /ai/generate-audit-template` | Returns audit template JSON (sections + fields + max scores) |
| `POST /ai/generate-quiz` | Returns quiz question array (question, options, correct index, explanation) |
| `POST /ai/translate-course` | Translates course content JSON to a target language |
| `POST /ai/knowledge-gaps` | Analyses quiz attempt history; returns gap summary and recommended topics |
| `POST /ai/learning-path` | Returns an ordered list of course recommendations with reasons |
| `POST /ai/chat` | Sidekick assistant; general-purpose chat with context about the org; streaming supported |

### LMS (`backend/services/lms_service.py`)

| Call site | What it does |
|---|---|
| `POST /lms/courses/generate` | Async job; Claude generates full course structure (modules, slides, quiz questions) from a topic, URL, or document |

### Shifts (`backend/routes/shifts.py`)

| Call site | What it does |
|---|---|
| `POST /shifts/ai/generate-schedule` | Claude generates a shift schedule for a week given staff availability and templates; creates `ai_schedule_jobs` record |

---

## What's Built vs Stubbed

### Confirmed Stubbed / Incomplete

| Item | Location | Status |
|---|---|---|
| FCM push notifications | `workflow_service.py` (2× `# TODO`), `notifications` route | Config and token storage exist; no send logic implemented |
| Resend email | `config.py` | Config keys present; SDK not imported; no usage anywhere |
| Facial recognition clock-in | `face_profiles` table, `clock_in_method` enum includes `facial_recognition` | Table exists; no enrollment or verification logic in backend |
| Asset failure prediction | `assets.predicted_days_to_failure`, `assets.failure_risk_score` columns | Columns in schema; no backend logic populates them |
| Sprout HR integration (onboarding) | `onboarding/page.tsx` employee source option | UI option present but `disabled: true` with label "coming soon" |
| Mobile feature parity | `mobile/frontline_app/lib/features/` | Only 4 screens implemented (login, dashboard, announcements, forms) vs ~50 web pages |
| Zustand stores | `package.json` includes `zustand ^5.0.12` | Dependency present; no active store files found |
| `leaderboards` module | `leaderboard_configs` table, gamification routes | Table and routes exist; leaderboard population logic not confirmed |
| Stripe | Not present | Referenced nowhere in codebase |
| Keycloak | Not present | Referenced nowhere in codebase |
| OpenAI | Not present | Anthropic only |

### Silent Exception Handlers (`except Exception: pass`)

Present throughout provisioning code. These swallow errors during background workspace provisioning to prevent a single step failure from aborting the entire launch. Affected steps: badge generation, repair guide generation, course content generation, role mapping, location suggestions, asset suggestions.

### Hardcoded Values

| Item | Location |
|---|---|
| `backend_secret_key = "dev-secret-change-me"` | `config.py` default |
| `allowed_origins = ["http://localhost:3000"]` | `config.py` default |
| `frontend_url = "http://localhost:3000"` | `config.py` default |
| Demo test accounts (`admin@renegade.com`, `branchadmin@renegade.com`, `manager@renegade.com`, `staff@renegade.com`, password `Test1234!`) | `components/auth/LoginForm.tsx` |
| Demo email format `demo-{uid}@sprout.demo` | `routes/auth.py` demo-start handler |

### Feature Flags / Commented-Out Code

- Mobile `pubspec.yaml` comment: `riverpod_generator` and `hive_generator` intentionally excluded due to upstream `source_gen` version conflict; re-addition deferred until resolved upstream
- Onboarding Sprout HR source: rendered but `disabled: true` in UI
