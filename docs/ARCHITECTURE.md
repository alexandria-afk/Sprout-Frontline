# Architecture Reference
**Frontline Operations Platform**
_Last updated: 2026-04-12 — full migration from Supabase to Keycloak (auth) + psycopg2 (database client) + Azure Blob Storage (file storage); RLS dropped; app-layer org scoping in place_

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
| Database client | psycopg2-binary | >=2.9 |
| Auth (backend) | PyJWT + Keycloak JWKS (`PyJWKClient`) | 2.10.1 |
| Rate limiting | slowapi | 0.1.9 |
| PDF generation | reportlab | >=4.0.0 |
| Backend tests | pytest + pytest-asyncio | 8.3.5 + 0.24.0 |
| Database | PostgreSQL | 17 |
| Mobile | Flutter (Dart SDK) | ^3.11.1 |
| Mobile state | flutter_riverpod | ^2.6.1 |
| Mobile routing | go_router | ^14.8.1 |
| Mobile HTTP | dio | ^5.7.0 |
| Mobile auth | flutter_appauth + jwt_decoder | ^8.0.1 + ^2.0.1 |
| Mobile local DB | hive_flutter | ^1.1.0 |
| Mobile background | workmanager | ^0.5.2 |

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (Next.js 14 App Router)                                     │
│  - middleware.ts: verifies kc_access_token cookie (jose JWKS)       │
│  - /api/auth/*: signin, refresh, me, signout (Next.js API Routes)   │
│  - apiFetch(): reads cookie, attaches Bearer, auto-refreshes on 401 │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS / HTTP (localhost:8000 in dev)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FastAPI (Uvicorn, port 8000)                                        │
│  - CORSMiddleware, AuthMiddleware, LoggingMiddleware                 │
│  - slowapi rate limiting (60 req/min default)                        │
│  - dependencies.py: get_current_user (JWKS → profiles lookup)       │
│  - 30 route files under backend/routes/                             │
│  - 21 service files under backend/services/                         │
└────┬──────────────┬────────────────────┬────────────────────────────┘
     │              │                    │
     ▼              ▼                    ▼
┌─────────┐  ┌──────────────┐  ┌──────────────────────────────────────┐
│PostgreSQL│  │Azure Blob    │  │External Services                      │
│17        │  │Storage       │  │  - Keycloak (port 56144): auth realm  │
│port 54322│  │(Azurite dev) │  │  - Anthropic Claude (haiku-4-5): AI  │
│psycopg2  │  │port 56008    │  │  - Firebase/FCM: push notifications  │
│pool:2-20 │  │7 containers  │  │  - Resend: email (not yet wired)     │
└─────────┘  └──────────────┘  └──────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Flutter Mobile App                                                  │
│  - flutter_appauth: PKCE flow via system browser                    │
│  - flutter_secure_storage: tokens at rest                           │
│  - dio: HTTP client with auth interceptor                           │
│  - Hive: offline-first local cache                                  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ Same FastAPI backend
                            ▼
                    (FastAPI port 8000)
```

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
│   ├── services/              Business logic and external client wrappers (21 files)
│   ├── models/                Pydantic request/response schemas and enums (14 files)
│   ├── middleware/            Auth enforcement, request logging middleware
│   └── scripts/               One-off seed scripts
├── frontend/                  Next.js web application
│   ├── app/                   App Router pages and layouts
│   │   ├── (auth)/            Login, set-password, auth callback routes
│   │   ├── (onboarding)/      8-step AI onboarding wizard
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
│       │   └── features/      Feature modules (auth, dashboard, announcements, forms, issues,
│       │                      notifications, shifts, tasks, training, approvals, audits,
│       │                      badges, gamification, team, settings, ai_insights)
│       ├── android/           Android native project
│       └── ios/               iOS native project
├── supabase/                  Legacy schema reference only (Supabase no longer used for auth or DB client)
│   ├── migrations/            61 sequential SQL migration files (source of truth for schema history)
│   ├── seed.sql               Base seed data
│   └── seed_test_org.sql      Test organisation seed data
├── scripts/                   Utility scripts (seed, data migration)
├── docs/                      This file
└── QA_ONBOARDING_LOG.md       Onboarding QA findings (2026-03-29)
```

---

## Backend Route Files

All routes prefixed `/api/v1`. Auth required on all routes except `/health`, `POST /api/v1/auth/demo-start`.

| File | Prefix | Domain |
|---|---|---|
| `routes/auth.py` | `/api/v1/auth` | Login, logout, change-password, demo workspace create/delete |
| `routes/users.py` | `/api/v1/users` | User CRUD, bulk import, positions |
| `routes/organisations.py` | `/api/v1/organisations` | Org settings, locations, feature flags |
| `routes/forms.py` | `/api/v1/forms` | Form templates, assignments, submissions |
| `routes/announcements.py` | `/api/v1/announcements` | Announcements + read/acknowledge receipts |
| `routes/dashboard.py` | `/api/v1/dashboard` | KPI summary |
| `routes/audits.py` | `/api/v1/audits` | Audit templates, submissions, PDF export, signatures |
| `routes/corrective_actions.py` | `/api/v1/corrective-actions` | Corrective action list and update |
| `routes/caps.py` | `/api/v1/caps` | CAP CRUD, confirm/dismiss, spawn follow-ups, PDF export |
| `routes/workflows.py` | `/api/v1/workflows` | Workflow definitions, stages, routing rules, instances |
| `routes/reports.py` | `/api/v1/reports` | Analytics: compliance, checklists, pull-outs, maintenance, aging |
| `routes/tasks.py` | `/api/v1/tasks` | Task CRUD, assignees, messages, attachments, templates |
| `routes/notifications.py` | `/api/v1/notifications` | Notification CRUD, FCM token registration, read/dismiss |
| `routes/issue_categories.py` | `/api/v1/issues/categories` | Issue categories, custom fields, escalation rules |
| `routes/issue_dashboard.py` | `/api/v1/issues/dashboard` | Issue analytics: summary, trends, by-asset, by-location, recurring |
| `routes/issues.py` | `/api/v1/issues` | Issue CRUD, status, comments, attachments, PDF export |
| `routes/vendors.py` | `/api/v1/vendors` | Vendor CRUD, category access grants |
| `routes/assets.py` | `/api/v1/assets` | Asset CRUD, repair history |
| `routes/repair_guides.py` | `/api/v1/repair-guides` | Repair guide CRUD with file upload |
| `routes/safety.py` | `/api/v1/safety` | Safety leaderboard, badges, points |
| `routes/incidents.py` | `/api/v1/incidents` | Incident CRUD, status, attachments, PDF export |
| `routes/ai_generate.py` | `/api/v1/ai` | AI generation endpoints (repair guides, categories, workflows, quiz, etc.) |
| `routes/ai_insights.py` | `/api/v1/ai` | AI dashboard insights endpoint |
| `routes/gamification.py` | `/api/v1/gamification` | Leaderboards, badges, points, seeding templates |
| `routes/lms.py` | `/api/v1/lms` | Courses, modules, quizzes, enrollments, AI generation |
| `routes/audit_trail.py` | `/api/v1/settings` | Audit trail event log |
| `routes/shifts.py` | `/api/v1/shifts` | Shift templates, scheduling, attendance, breaks, leave, swaps |
| `routes/onboarding.py` | `/api/v1/onboarding` | 8-step AI onboarding wizard backend |
| `routes/inbox.py` | `/api/v1/inbox` | Status-based unified to-do list (6 entity types) |
| `routes/maintenance.py` | `/api/v1/maintenance` | **STALE — do not call.** Still references dropped `maintenance_tickets` table. |

---

## Backend Service Files

| File | What It Does |
|---|---|
| `services/db.py` | `ThreadedConnectionPool(min=2, max=20)`, `get_db_conn()` FastAPI dependency, helpers: `row()`, `rows()`, `execute()`, `execute_returning()`, `execute_many()` |
| `services/blob_storage.py` | Azure Blob Storage wrapper: `upload_blob()`, `get_public_url()`, `get_signed_url()`, `delete_blob()`. Lazy `BlobServiceClient` singleton. Auto-creates containers. |
| `services/notification_service.py` | `notify()`, `notify_role()`, `notify_user_manager()`. Writes to `notifications` table, fires FCM via `firebase-admin` SDK when device token present. |
| `services/reminder_service.py` | Background async loop (`run_reminder_loop()`) started in `main.py` lifespan. Runs every 5 min; sends `scheduled_reminder` push notifications for forms due in 1h, training due in 1 day, shifts starting in 30 min. |
| `services/auth_service.py` | `AuthService.change_password()` — calls Keycloak admin API to change password |
| `services/user_service.py` | User CRUD (creates DB profile only — Keycloak user creation is a TODO stub) |
| `services/org_service.py` | Organisation and location operations |
| `services/form_service.py` | Form assignment and submission logic |
| `services/audit_scoring_service.py` | Computes audit scores, determines pass/fail, triggers CAP generation |
| `services/cap_service.py` | CAP creation, item spawning (tasks/issues/incidents), PDF export |
| `services/workflow_service.py` | Workflow engine: advance stages, evaluate routing rules, trigger notifications |
| `services/task_service.py` | Task CRUD, assignees, messages, status history |
| `services/shift_service.py` | Shift scheduling, attendance records, breaks, leave, AI schedule generation |
| `services/lms_service.py` | Course management, enrollment, progress tracking, AI course generation |
| `services/gamification_service.py` | Leaderboard score computation, badge management |
| `services/announcement_service.py` | Announcement delivery to targeted roles/locations |
| `services/dashboard_service.py` | KPI aggregation for dashboard summary |
| `services/ai_service.py` | Low-level Anthropic API wrapper |
| `services/ai_logger.py` | `AILogger` — writes every Claude call to `ai_request_log` |
| `services/incident_service.py` | Incident CRUD and PDF export |
| `services/industry_context.py` | Industry-specific context for AI prompts |

---

## Backend Models (Pydantic Schemas)

| File | Contents |
|---|---|
| `models/auth.py` | `ChangePasswordRequest` |
| `models/base.py` | Shared base model config |
| `models/announcements.py` | Announcement request/response shapes |
| `models/audits.py` | Audit template, section, field, submission schemas |
| `models/caps.py` | CAP and CAP item schemas |
| `models/forms.py` | Form template, field, assignment, submission schemas |
| `models/lms.py` | Course, module, quiz, enrollment schemas |
| `models/onboarding.py` | All onboarding step request/response shapes, `INDUSTRY_DISPLAY` map |
| `models/organisations.py` | Org and location schemas |
| `models/shifts.py` | All shift, attendance, break, leave, swap request schemas |
| `models/tasks.py` | Task and task template schemas |
| `models/users.py` | User profile schemas |
| `models/workflows.py` | Workflow definition, stage, instance schemas |

---

## Frontend Service Files (`frontend/services/`)

| File | API Calls Wrapped |
|---|---|
| `api/client.ts` | Core `apiFetch<T>()` — token cookie reading, auto-refresh on 401, error handling |
| `auth.ts` | `verifyToken()`, `getClientToken()`, `signOut()` |
| `server-auth.ts` | Server-side token/user extraction from cookies (used by API routes and server components) |
| `users.ts` | `/api/v1/users/*` — user list, create, update, bulk import |
| `onboarding.ts` | `/api/v1/onboarding/*` — all 8 onboarding steps |
| `forms.ts` | `/api/v1/forms/*` — templates, assignments, submissions |
| `issues.ts` | `/api/v1/issues/*` — issue CRUD, comments, attachments |
| `tasks.ts` | `/api/v1/tasks/*` — task CRUD, assignees, messages |
| `shifts.ts` | `/api/v1/shifts/*` — shifts, attendance, breaks, leave, swaps |
| `lms.ts` | `/api/v1/lms/*` — courses, enrollments, progress |
| `workflows.ts` | `/api/v1/workflows/*` — definitions, instances |
| `announcements.ts` | `/api/v1/announcements/*` |
| `notifications.ts` | `/api/v1/notifications/*` |
| `inbox.ts` | `/api/v1/inbox` — `getInboxItems()` |
| `dashboard.ts` | `/api/v1/dashboard/*` |
| `caps.ts` | `/api/v1/caps/*` |
| `gamification.ts` | `/api/v1/gamification/*` |
| `ai.ts` | `/api/v1/ai/*` — all AI generation endpoints + sidekick chat |
| `maintenance.ts` | `/api/v1/assets/*`, `/api/v1/repair-guides/*` (maintenance-specific wrappers) |
| `vendors.ts` | `/api/v1/vendors/*` |
| `safety.ts` | `/api/v1/safety/*` |
| `settings.ts` | `/api/v1/settings/*`, org feature flags |
| `supabase/` | **Legacy** — Supabase client wrappers; not used by runtime code; kept for reference |

---

## Auth Flow (End to End)

### Web Login → FastAPI Request

```
1. POST /api/auth/signin (Next.js API route)
     ↓
2. Keycloak ROPC: POST /realms/sprout/protocol/openid-connect/token
     ↓ access_token (RS256, ~5 min), refresh_token (30 days)
3. Set cookies: kc_access_token (not HttpOnly), kc_refresh_token (HttpOnly)
     ↓
4. Client request → apiFetch() reads kc_access_token from document.cookie
     → Authorization: Bearer <token>
     ↓
5. FastAPI → get_current_user dependency
     → PyJWKClient fetches JWKS from http://localhost:56144/realms/sprout/protocol/openid-connect/certs
     → jwt.decode(token, signing_key, algorithms=["RS256"], options={"verify_aud": False})
     → SELECT from profiles WHERE id = <sub> (fast path) or email = <email> (fallback, re-keys on match)
     → Returns {sub, email, role, app_metadata: {role, organisation_id, location_id, language}}
```

### Token Refresh Flow

```
401 received by apiFetch()
     ↓
POST /api/auth/refresh (Next.js API route) — reads kc_refresh_token HttpOnly cookie
     ↓
Keycloak refresh_token grant → new access_token + new refresh_token
     ↓
Set both cookies again (rotating refresh token)
     ↓
apiFetch() retries original request once with new token
```

### Mobile Auth (PKCE)

```
AuthRepository.signIn()
     ↓
flutter_appauth.authorizeAndExchangeCode() → launches system browser
     ↓
Keycloak PKCE flow (user logs in in browser)
     ↓
Redirect to com.frontliner.app://callback
     ↓
Tokens stored in flutter_secure_storage (kc_access_token, kc_refresh_token, kc_id_token)
     ↓
DioClient auth interceptor reads token, refreshes via flutter_appauth.token() on expiry
```

---

## Storage Flow (Azure Blob)

```
Frontend file input → apiFetch (multipart/form-data)
     ↓
FastAPI route (e.g. POST /api/v1/issues/{id}/attachments)
     ↓
services/blob_storage.upload_blob(container, blob_name, data, content_type)
     → BlobServiceClient.from_connection_string(AZURE_STORAGE_CONNECTION_STRING)
     → _ensure_container() [idempotent create]
     → blob.upload_blob(data, overwrite=True, content_settings=ContentSettings(...))
     → Returns blob.url
     ↓
URL stored in DB (e.g. issue_attachments.file_url)
     ↓
Clients request URL directly (public containers in dev via Azurite)
OR
services/blob_storage.get_signed_url(container, blob_name, expiry_seconds=3600)
     → Generates SAS token with read permission, returns time-limited URL
```

**Container names** (mirror old Supabase bucket names):
`form-photos`, `form-videos`, `audit-signatures`, `repair-guides`, `issues`, `training-media`, `announcement-media`

---

## Notification Flow

```
Business event (e.g. task assigned, issue commented)
     ↓
Route handler calls services/notification_service.notify() or notify_role() or notify_user_manager()
     ↓
INSERT INTO notifications (org_id, recipient_user_id, type, title, body, entity_type, entity_id)
     ↓
If send_push=True AND user has fcm_token:
     → _send_push(token, title, body, {type, entity_type, entity_id})
     → firebase_admin.messaging.send(Message(...))
     → UPDATE notifications SET push_sent=TRUE, push_sent_at=now()
     ↓
Client polls GET /api/v1/notifications/unread-count every 60s (sidebar badge)
     ↓
Full notification list: GET /api/v1/notifications?is_read=false

Separate scheduled reminder loop (reminder_service.py, every 5 min):
     → Queries for forms due in 1h, training deadlines in 1 day, shifts in 30 min
     → Creates scheduled_reminder notifications with send_push=True
     → Deduplication: checks if same entity+type+user notification exists today
```

---

## Onboarding Flow (AI Wizard)

8 steps, all in `routes/onboarding.py`. Session stored in `onboarding_sessions` table.

```
Step 1 — Company
  POST /sessions/{id}/discover → scrapes URL, calls Claude → company_name, industry_code, 
                                  estimated_locations, brand_color, logo_url
  POST /sessions/{id}/confirm-company → saves profile, advances to step 2
  GET  /sessions/{id}/suggest-locations → scrapes site for store locator, AI extracts branches

Step 2 — Team (employee import)
  Four methods: CSV upload, manual entry, invite link, Sprout HR (disabled)
  POST /sessions/{id}/upload-employees → AI maps CSV headers, stores in onboarding_employees
  POST /sessions/{id}/employees → manual add

Step 3 — Shifts
  Saves attendance rules to live attendance_rules table directly
  POST /sessions/{id}/confirm-shift-settings

Step 4 — Assets
  POST /sessions/{id}/assets, DELETE /sessions/{id}/assets/{id}
  GET  /sessions/{id}/suggest-assets → AI suggests industry-appropriate equipment

Step 5 — Vendors
  POST /sessions/{id}/vendors, DELETE /sessions/{id}/vendors/{id}

Step 6 — Templates
  GET  /sessions/{id}/templates → fetches industry_packages matching industry_code
  PATCH /sessions/{id}/selections → toggle template item selections
  POST /sessions/{id}/confirm-templates

Step 7 — Preview
  GET /sessions/{id}/preview → workspace summary (counts of what will be created)

Step 8 — Launch
  POST /sessions/{id}/launch → starts background provisioning task (FastAPI BackgroundTasks)
      → creates locations, assets, vendors, provisions template items (forms, checklists, audits,
         issue categories, workflows, shift templates, training modules, badges),
         invites employees via Resend email, advances onboarding_session.status to "completed"
  GET  /sessions/{id}/launch-progress → polls provisioning progress (JSONB field)
  GET  /sessions/{id}/first-actions → returns GuidedAction[] for post-launch checklist

On startup (main.py lifespan): _reset_stuck_provisioning_sessions() resets any sessions
stuck in "provisioning" state for > 2 minutes to status "failed" so user can retry.
```

---

## External Services and Integration Points

| Service | Integration Point | Config |
|---|---|---|
| Keycloak | `dependencies.py` PyJWKClient; `app/api/auth/signin/route.ts` ROPC; `mobile/lib/core/auth/auth_repository.dart` PKCE | `KEYCLOAK_URL`, `NEXT_PUBLIC_KEYCLOAK_REALM`, `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID` |
| PostgreSQL | `services/db.py` ThreadedConnectionPool via psycopg2 | `DATABASE_URL` |
| Azure Blob Storage | `services/blob_storage.py` BlobServiceClient | `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_ACCOUNT_NAME` |
| Anthropic Claude | `services/ai_service.py`, `services/ai_logger.py`; direct `anthropic.Anthropic()` in onboarding.py and lms.py | `ANTHROPIC_API_KEY` |
| Firebase/FCM | `services/notification_service.py` `firebase_admin.messaging` | `FIREBASE_SERVICE_ACCOUNT_JSON` (env var, not in .env file) |
| Resend | `services/auth_service.py` (invite emails) | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |

---

## Database Connection Pool Details

- **Type:** `psycopg2.pool.ThreadedConnectionPool`
- **Min connections:** 2
- **Max connections:** 20
- **Lifecycle:** Lazy singleton (`_pool` module global in `services/db.py`), created on first `get_db_conn()` call
- **Per-request pattern:** `get_db_conn()` FastAPI dependency calls `pool.getconn()`, yields connection, commits on success, rolls back on exception, calls `pool.putconn()` in finally
- **Out-of-band usage:** `notification_service.py` and `reminder_service.py` call `_get_pool()` directly (outside FastAPI request context). These must use their own getconn/putconn pattern and must not forget `putconn()` in finally blocks — a leak exhausts the pool
- **Thread safety:** `ThreadedConnectionPool` is safe for use across threads (Uvicorn worker threads). Do not use `SimpleConnectionPool` in the backend.

---

## Database

**Engine:** PostgreSQL 17, direct psycopg2 connection (ThreadedConnectionPool via `_get_pool()` in `backend/services/db.py`).
**Migration count:** 61 SQL files in `supabase/migrations/`, ordered by timestamp prefix.
**Soft deletes:** `is_deleted BOOLEAN DEFAULT false` column on most entities instead of hard deletion.
**Multi-tenancy:** Every tenant table has `organisation_id UUID REFERENCES organisations(id)`.
**Access control:** RLS has been dropped from all tables. Organisation scoping is enforced at the application layer — every query filters by `organisation_id` derived from the authenticated user's JWT/profile.

### Tables

#### Foundations

| Table | Key Columns | Notes |
|---|---|---|
| `organisations` | `id`, `name TEXT UNIQUE`, `logo_url`, `settings JSONB`, `feature_flags JSONB DEFAULT '{}'`, `is_active`, `is_deleted` | Root tenant table; `feature_flags` holds per-org boolean capability toggles (e.g. `staff_availability_enabled`) |
| `locations` | `id`, `organisation_id`, `name`, `address`, `latitude NUMERIC`, `longitude NUMERIC`, `geo_fence_radius_meters INT`, `is_active`, `is_deleted` | Branches/outlets |
| `profiles` | `id UUID`, `organisation_id`, `location_id`, `full_name`, `email TEXT` (unique index), `phone_number`, `role ENUM(super_admin\|admin\|manager\|staff)`, `position TEXT`, `reports_to UUID`, `language`, `fcm_token`, `is_active`, `is_deleted` | FK to `auth.users` dropped; `email` column added and backfilled; identity managed by Keycloak |

#### Forms & Checklists

| Table | Key Columns | Notes |
|---|---|---|
| `form_templates` | `id`, `organisation_id`, `created_by`, `title`, `description`, `type TEXT CHECK(checklist\|form\|audit\|pull_out)`, `is_active`, `is_deleted` | `type` is a `text` column with a `CHECK` constraint — not a PG enum |
| `form_sections` | `id`, `form_template_id`, `title`, `display_order` | |
| `form_fields` | `id`, `section_id`, `label`, `field_type ENUM(text\|number\|checkbox\|dropdown\|multi_select\|photo\|signature\|datetime)`, `options JSONB`, `is_required`, `conditional_logic JSONB`, `display_order`, `placeholder`, `is_critical` | `conditional_logic` supports two shapes: `{fieldId, value, action:"show"\|"hide"}` and `{type:"show_options", fieldId, optionsMap:{value→string[]}}` |
| `form_assignments` | `id`, `form_template_id`, `assigned_to_user_id`, `assigned_to_location_id`, `organisation_id`, `recurrence ENUM(once\|daily\|weekly\|custom)`, `cron_expression`, `due_at`, `is_active`, `is_deleted` | |
| `form_submissions` | `id`, `form_template_id`, `assignment_id`, `submitted_by`, `location_id`, `status ENUM(draft\|submitted\|approved\|rejected)`, `submitted_at`, `reviewed_by`, `reviewed_at`, `manager_comment`, `overall_score NUMERIC`, `passed BOOLEAN`, `estimated_cost NUMERIC` | `estimated_cost` populated by backend for `pull_out` type submissions only |
| `form_responses` | `id`, `submission_id`, `field_id`, `value TEXT`, `comment TEXT` | `field_id` FK → `form_fields.id`; `value` is a file URL for media fields |

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
| `workflow_definitions` | `id`, `organisation_id`, `name`, `trigger_type`, `trigger_form_template_id`, `trigger_issue_category_id`, `trigger_conditions JSONB`, `is_active`, `template_id` (FK, nullable) | trigger_type values: `manual`, `form_submitted`, `issue_created`, `employee_created` |
| `workflow_stages` | `id`, `definition_id`, `name`, `stage_order`, `assigned_role`, `assigned_user_id`, `action_type ENUM(review\|approve\|fill_form\|sign\|create_task\|create_issue\|notify\|wait\|assign_training)`, `form_template_id`, `is_final` | |
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
| `issue_categories` | `id`, `organisation_id`, `name`, `description`, `color`, `icon`, `sla_hours INT`, `default_priority`, `is_maintenance BOOLEAN`, `is_deleted` | `is_maintenance=true` means issues in this category appear in the maintenance costs report and trigger cost entry on resolve |
| `issue_custom_fields` | `id`, `category_id`, `label`, `field_type ENUM(text\|number\|dropdown\|checkbox\|date)`, `options JSONB`, `is_required`, `display_order` | |
| `escalation_rules` | `id`, `category_id`, `trigger_type ENUM(on_create\|sla_breach\|priority_critical\|status_change\|unresolved_hours)`, `hours_threshold INT`, `notify_role`, `notify_user_id`, `notify_vendor_id` | |
| `issues` | `id`, `organisation_id`, `location_id`, `category_id`, `reported_by`, `assigned_to`, `assigned_vendor_id`, `asset_id`, `title`, `description`, `priority ENUM(low\|medium\|high\|critical)`, `status ENUM(open\|in_progress\|pending_vendor\|resolved\|verified_closed)`, `location_description`, `recurrence_count INT`, `due_at`, `resolved_at`, `resolution_note`, `cost NUMERIC`, `ai_description`, `ai_suggested_category`, `ai_suggested_priority`, `ai_confidence_score`, `ai_flagged_safety BOOLEAN` | |
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

The `maintenance_tickets` table has been removed (migration `20260331000105_drop_maintenance_tickets.sql`). Maintenance is now modelled as issues where `issue_categories.is_maintenance = true`. An issue is considered a maintenance issue when its category has `is_maintenance=true` AND it has an `asset_id` linked. `issues.cost` stores the repair cost, captured via a cost input shown when resolving a maintenance-category issue.

The `routes/maintenance.py` file still references the dropped table and will 500 if called. Do not route to `/api/v1/maintenance`.

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
| `attendance_records` | `id`, `user_id`, `shift_id`, `organisation_id`, `location_id`, `clock_in_at TIMESTAMPTZ`, `clock_out_at`, `clock_in_method ENUM(gps\|selfie\|facial_recognition\|qr_code\|manager_override)`, `clock_in_latitude NUMERIC`, `clock_in_longitude NUMERIC`, `clock_in_geo_valid BOOLEAN`, `total_minutes INT`, `overtime_minutes INT`, `break_minutes INT DEFAULT 0`, `worked_minutes INT GENERATED ALWAYS AS (GREATEST(0, total_minutes - break_minutes)) STORED`, `status ENUM(present\|late\|early_departure\|absent\|unverified)`, `manager_override_note` | `worked_minutes` is a computed column; never insert/update directly |
| `break_records` | `id`, `attendance_id` (FK → attendance_records), `organisation_id`, `user_id`, `break_start_at TIMESTAMPTZ`, `break_end_at TIMESTAMPTZ`, `duration_minutes INT`, `break_type TEXT CHECK(meal\|rest\|other)`, `created_at` | Tracks individual break periods; `duration_minutes` filled on end-break; `break_minutes` on `attendance_records` is updated to the sum of all completed breaks |
| `face_profiles` | `id`, `user_id UNIQUE`, `enrolled BOOLEAN`, `enrolled_at` | Schema exists; no backend logic populates it |
| `ai_schedule_jobs` | `id`, `organisation_id`, `week_start DATE`, `shifts_created INT`, `warnings TEXT[]`, `status ENUM(pending\|running\|completed\|failed)` | |

#### Onboarding

| Table | Key Columns | Notes |
|---|---|---|
| `onboarding_sessions` | `id`, `organisation_id UNIQUE`, `current_step INT(1–8)`, `status ENUM(in_progress\|completed\|abandoned)`, `website_url`, `company_name`, `industry_code`, `industry_subcategory`, `estimated_locations INT`, `brand_color`, `logo_url`, `employee_source ENUM(sprout_hr\|hris_other\|csv\|manual\|invite_link)`, `launch_progress JSONB`, `ai_context JSONB` | |
| `industry_packages` | `id`, `industry_code`, `name`, `description`, `version INT`, `is_active` | UNIQUE(industry_code, version) |
| `template_items` | `id`, `package_id`, `category ENUM(form\|checklist\|audit\|issue_category\|workflow\|training_module\|shift_template\|repair_manual\|badge)`, `name`, `description`, `content JSONB`, `is_recommended`, `sort_order` | |
| `onboarding_selections` | `session_id`, `template_id` | UNIQUE(session_id, template_id) |
| `onboarding_employees` | `id`, `session_id`, `full_name`, `email`, `phone`, `position`, `department`, `retail_role`, `location_name`, `status ENUM(pending\|invited\|active\|failed)` | |
| `role_mappings` | `id`, `session_id`, `source_title`, `source_department`, `source_level`, `retail_role ENUM(super_admin\|admin\|manager\|staff)`, `confidence_score FLOAT(0–1)`, `is_confirmed`, `employee_count INT` | AI-inferred from CSV imports |
| `employee_import_jobs` | `id`, `session_id`, `status ENUM(pending\|processing\|completed\|failed\|partial)`, `total_records INT`, `processed_records INT`, `failed_records INT`, `error_log JSONB`, `source_metadata JSONB` | |

#### Notifications

| Table | Key Columns | Notes |
|---|---|---|
| `notifications` | `id`, `organisation_id`, `recipient_user_id`, `type TEXT CHECK(...)` (14 values), `title`, `body`, `entity_type`, `entity_id`, `is_read BOOLEAN`, `read_at`, `is_dismissed BOOLEAN`, `push_sent BOOLEAN`, `push_sent_at`, `created_at` | Replaced the old `notification_log` table (dropped). Indexed on recipient+is_read+created_at |

#### Logging

| Table | Key Columns | Notes |
|---|---|---|
| `ai_request_log` | `id`, `organisation_id`, `user_id`, `feature TEXT`, `provider TEXT`, `model TEXT`, `input_tokens INT`, `output_tokens INT`, `latency_ms INT`, `success BOOLEAN`, `error_message`, `created_at` | Written by `AILogger` service after every Claude call |

---

## Storage

File storage has been migrated from Supabase Storage to **Azure Blob Storage**. The shared helper is `backend/services/blob_storage.py` and exposes `upload_blob()`, `get_public_url()`, `get_signed_url()`, and `delete_blob()`. The 7 containers mirror the old Supabase bucket names:

| Container | Contents |
|---|---|
| `form-photos` | Form response photo uploads |
| `form-videos` | Form response video uploads |
| `audit-signatures` | Audit signature images |
| `repair-guides` | Repair guide file uploads |
| `issues` | Issue photo/video attachments |
| `training-media` | Training course video/media files |
| `announcement-media` | Announcement media attachments |

**Environment variables:** `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_ACCOUNT_NAME`

---

## API Endpoints

All routes are prefixed `/api/v1`. Auth required on all routes except `/health`, `/docs`, `POST /api/v1/auth/demo-start`.

**Auth dependency levels:**
- `get_current_user` — any authenticated role
- `require_manager_or_above` — manager, admin, super_admin
- `require_admin` — admin, super_admin only

### Auth — `/api/v1/auth`

| Method | Path | Description |
|---|---|---|
| `POST` | `/change-password` | Change authenticated user's password via Keycloak admin API |
| `POST` | `/demo-start` | Create demo org + super_admin profile + onboarding session (DB only; Keycloak user created separately by caller) |
| `DELETE` | `/demo/{org_id}` | Wipe all DB data for a demo workspace (FK-safe order; Keycloak users deleted separately by caller) |

### Users — `/api/v1/users`

| Method | Path | Description |
|---|---|---|
| `GET` | `/me` | Current user profile |
| `GET` | `/` | List org users (manager+); filters: location_id, role, search, page |
| `POST` | `/` | Create user profile in DB (Keycloak user not created — stub TODO) |
| `POST` | `/bulk-import` | Bulk import users from multipart CSV |
| `GET` | `/positions` | Distinct position strings in org |
| `GET` | `/{user_id}` | User detail |
| `PATCH` | `/{user_id}` | Update user (role update does not sync to Keycloak — stub TODO) |
| `DELETE` | `/{user_id}` | Soft-delete user (Keycloak user not disabled — stub TODO) |

### Organisations — `/api/v1/organisations`

| Method | Path | Description |
|---|---|---|
| `GET` | `/my` | Current user's organisation details including `feature_flags`; **must be defined before `/{org_id}` to prevent path-param capture** |
| `GET` | `/{org_id}` | Organisation details |
| `PUT` | `/{org_id}` | Update organisation |
| `PATCH` | `/{org_id}/feature-flags` | Update feature flags JSONB for org (admin only) |
| `GET` | `/{org_id}/locations` | List locations |
| `POST` | `/{org_id}/locations` | Create location |
| `PUT` | `/{org_id}/locations/{loc_id}` | Update location |
| `PATCH` | `/{org_id}/locations/{loc_id}` | Partial update location |
| `DELETE` | `/{org_id}/locations/{loc_id}` | Delete location |

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
| `PUT` | `/{id}/items/{item_id}` | Update CAP item |
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
| `GET` | `/instances` | List instances |
| `GET` | `/instances/my-tasks` | Instances where current user has a pending stage |
| `GET` | `/instances/{id}` | Instance detail with stage history |
| `POST` | `/instances/{id}/cancel` | Cancel running instance |
| `POST` | `/instances/{id}/stages/{stage_id}/approve` | Approve stage |
| `POST` | `/instances/{id}/stages/{stage_id}/reject` | Reject stage |
| `POST` | `/instances/{id}/stages/{stage_id}/submit-form` | Submit form for a form-type stage |

### Reports — `/api/v1/reports`

| Method | Path | Description |
|---|---|---|
| `GET` | `/compliance` | Audit compliance trend |
| `GET` | `/checklist-completion` | Checklist completion rates by template |
| `GET` | `/pull-outs/summary` | Pull-out totals |
| `GET` | `/pull-outs/trends` | Pull-out count and cost by day/week/month |
| `GET` | `/pull-outs/top-items` | Most frequently pulled-out items |
| `GET` | `/pull-outs/anomalies` | Cost-based weekly anomaly detection per location |
| `GET` | `/maintenance-issues` | Maintenance costs report (issues where category.is_maintenance=true) |
| `GET` | `/aging/tasks` | Task aging report with SLA breach counts |
| `GET` | `/aging/issues` | Issue aging report |
| `GET` | `/aging/resolution-time` | Avg/median resolution time |

### Tasks — `/api/v1/tasks`

| Method | Path | Description |
|---|---|---|
| `GET` | `/templates` | List task templates |
| `POST` | `/templates` | Create task template |
| `PUT` | `/templates/{id}` | Update task template |
| `DELETE` | `/templates/{id}` | Delete task template |
| `POST` | `/templates/{id}/spawn` | Spawn a task instance from template |
| `GET` | `/` | List tasks |
| `POST` | `/` | Create task |
| `GET` | `/my` | Current user's assigned tasks |
| `GET` | `/summary` | Org-wide task count summary |
| `GET` | `/unread-count` | Unread task messages count |
| `GET` | `/{id}` | Task detail with assignees, messages, attachments |
| `PUT` | `/{id}` | Update task |
| `PUT` | `/{id}/status` | Update task status |
| `POST` | `/{id}/assignees` | Add assignee |
| `DELETE` | `/{id}/assignees/{assignee_id}` | Remove assignee |
| `POST` | `/{id}/messages` | Post message on task thread |
| `POST` | `/{id}/read` | Mark task messages as read |
| `POST` | `/{id}/attachments` | Upload attachment |
| `PUT` | `/{id}/attachments/{attachment_id}/annotate` | Save annotated attachment |

### Inbox — `/api/v1/inbox`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Status-based unified to-do list: tasks, forms, workflows, courses, announcements, issues |

Items sorted overdue → upcoming → no due date. Items remain until underlying entity is resolved/completed. Distinct from notifications (event-based). Powers the "My To-Do List" dashboard widget and mobile NotificationsScreen.

### Notifications — `/api/v1/notifications`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List notifications for current user |
| `GET` | `/unread-count` | Returns `{ count: N }` |
| `POST` | `/{id}/read` | Mark single notification as read |
| `POST` | `/read-all` | Mark all as read |
| `POST` | `/{id}/dismiss` | Dismiss notification |
| `PUT` | `/fcm-token` | Register/update user's FCM device token |

### Issue Categories — `/api/v1/issues/categories`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List categories with custom fields and escalation rules |
| `POST` | `/` | Create category |
| `PUT` | `/{id}` | Update category |
| `DELETE` | `/{id}` | Delete category |
| `POST` | `/{id}/custom-fields` | Add custom field |
| `PUT` | `/{id}/custom-fields/{field_id}` | Update custom field |
| `DELETE` | `/{id}/custom-fields/{field_id}` | Delete custom field |
| `POST` | `/{id}/escalation-rules` | Add escalation rule |
| `PUT` | `/{id}/escalation-rules/{rule_id}` | Update escalation rule |
| `DELETE` | `/{id}/escalation-rules/{rule_id}` | Delete escalation rule |

### Issue Dashboard — `/api/v1/issues/dashboard`

| Method | Path | Description |
|---|---|---|
| `GET` | `/summary` | Issue counts by status, priority, category |
| `GET` | `/trends` | Issue volume over time |
| `GET` | `/by-asset` | Issues grouped by asset (maintenance-category only) |
| `GET` | `/by-location` | Issue counts grouped by location |
| `GET` | `/recurring` | Recurring issues (recurrence_count > 1) |

### Issues — `/api/v1/issues`

| Method | Path | Description |
|---|---|---|
| `POST` | `/` | Create issue |
| `GET` | `/` | List issues |
| `GET` | `/{id}` | Issue detail with comments, attachments, custom responses |
| `PUT` | `/{id}` | Update issue |
| `PUT` | `/{id}/status` | Update issue status |
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
| `GET` | `/{id}` | Asset detail with repair history |
| `PUT` | `/{id}` | Update asset |
| `DELETE` | `/{id}` | Delete asset (soft) |
| `GET` | `/{id}/guides` | Repair guides linked to asset |

### Repair Guides — `/api/v1/repair-guides`

| Method | Path | Description |
|---|---|---|
| `POST` | `/` | Create guide (optional file upload) |
| `GET` | `/` | List guides; filters: asset_id, category_id |
| `GET` | `/{id}` | Guide detail |
| `DELETE` | `/{id}` | Delete guide |

### Safety — `/api/v1/safety`

| Method | Path | Description |
|---|---|---|
| `GET` | `/leaderboard` | Safety points leaderboard |
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

### AI — `/api/v1/ai`

| Method | Path | Description |
|---|---|---|
| `POST` | `/generate-repair-guide` | Generate repair guide markdown |
| `POST` | `/generate-issue-categories` | Generate issue category definitions |
| `POST` | `/generate-badges` | Generate badge definitions |
| `POST` | `/generate-workflow` | Generate workflow stages + routing rules |
| `POST` | `/classify-issue` | Classify issue into category + priority + safety flag |
| `POST` | `/analyse-photo` | Claude vision: analyse photo for hazards |
| `POST` | `/suggest-task-priority` | Suggest task priority |
| `POST` | `/generate-audit-template` | Generate audit template |
| `POST` | `/generate-quiz` | Generate quiz questions |
| `POST` | `/translate-course` | Translate course content |
| `POST` | `/knowledge-gaps` | Analyse quiz attempts for knowledge gaps |
| `POST` | `/learning-path` | Generate personalised learning path |
| `POST` | `/chat` | Sidekick AI assistant (streaming supported) |
| `GET` | `/dashboard-insights` | AI brief + structured insight cards for mobile dashboard |

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
| `GET` | `/templates/badges` | Preset badge templates |
| `GET` | `/templates/leaderboards` | Preset leaderboard templates |
| `POST` | `/templates/seed` | Seed default templates for org |

### LMS — `/api/v1/lms`

| Method | Path | Description |
|---|---|---|
| `GET` | `/courses` | List published courses |
| `GET` | `/courses/manage` | List all courses for editor |
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
| `POST` | `/courses/{id}/enroll` | Enroll users |
| `PUT` | `/courses/{id}/progress` | Update module progress |
| `POST` | `/courses/{id}/quiz/submit` | Submit quiz attempt |
| `POST` | `/courses/{id}/cert` | Generate certificate |

### Audit Trail — `/api/v1/settings`

| Method | Path | Description |
|---|---|---|
| `GET` | `/audit-trail` | Paginated event log; filters: entity_type |

### Shifts — `/api/v1/shifts`

| Method | Path | Description |
|---|---|---|
| `GET` | `/templates` | List shift templates |
| `POST` | `/templates` | Create shift template |
| `PUT` | `/templates/{id}` | Update shift template |
| `DELETE` | `/templates/{id}` | Delete shift template |
| `POST` | `/templates/{id}/generate` | Bulk generate shifts from template |
| `GET` | `/` | List shifts |
| `POST` | `/` | Create shift |
| `POST` | `/publish` | Publish selected shifts |
| `POST` | `/publish/bulk` | Bulk publish all draft shifts for a date range |
| `GET` | `/my` | Current user's upcoming shifts |
| `GET` | `/open` | Open shift offers available to claim |
| `GET` | `/claims` | Shift claim requests |
| `GET` | `/swaps` | Swap requests |
| `POST` | `/swaps` | Create shift swap request |
| `POST` | `/swaps/{id}/respond` | Approve or reject swap |
| `POST` | `/attendance/clock-in` | Clock in |
| `POST` | `/attendance/clock-out` | Clock out |
| `GET` | `/attendance` | List attendance records |
| `POST` | `/attendance/override` | Manager clock-in/out override |
| `GET` | `/attendance/timesheet` | Org timesheet report |
| `GET` | `/attendance/my-timesheet` | Current user's timesheet |
| `GET` | `/attendance/rules` | Get org attendance rules |
| `PUT` | `/attendance/rules` | Update org attendance rules |
| `POST` | `/attendance/break/start` | Start break |
| `POST` | `/attendance/break/end` | End break |
| `GET` | `/attendance/break/status` | Get current break status |
| `GET` | `/leave` | List leave requests |
| `POST` | `/leave` | Create leave request |
| `PUT` | `/leave/{id}` | Approve/reject leave request |
| `GET` | `/availability` | Get staff availability |
| `PUT` | `/availability` | Set staff availability |
| `POST` | `/ai-schedule` | Trigger AI schedule generation |

### Onboarding — `/api/v1/onboarding`

Full list in ARCHITECTURE.md API section above. See ONBOARDING_SPEC.md for step-by-step details.

---

## Frontend Pages

All dashboard routes protected by `middleware.ts`.

### Auth

| Route | File | Description |
|---|---|---|
| `/login` | `(auth)/login/page.tsx` | Email/password login; dev quick-login buttons; demo workspace creation/switching |
| `/set-password` | `(auth)/set-password/page.tsx` | Password setup for invite link flow |
| `/auth/callback` | `auth/callback/page.tsx` | OAuth callback (legacy; Keycloak now uses `/api/auth/*`) |

### Onboarding

| Route | File | Description |
|---|---|---|
| `/onboarding` | `(onboarding)/onboarding/page.tsx` | 8-step AI wizard — all steps rendered in a single page component with step state machine |

### Dashboard

| Route | Description |
|---|---|
| `/dashboard` | Main home with stat cards, My Shift (clock-in/out/breaks), My To-Do List, leaderboard, announcements, AI daily brief |
| `/dashboard/tasks` | Redirects to `/dashboard/issues?tab=tasks` |
| `/dashboard/issues` | Combined issues AND tasks page — kanban and list views, age badge SLA coloring |
| `/dashboard/issues/categories` | Issue category editor (custom fields, escalation rules) |
| `/dashboard/issues/dashboard` | Issue analytics |
| `/dashboard/audits` | Audit submissions |
| `/dashboard/audits/caps` | CAP list |
| `/dashboard/audits/caps/[id]` | CAP detail + confirm/dismiss/spawn |
| `/dashboard/audits/templates` | Audit template builder |
| `/dashboard/audits/corrective-actions` | Corrective actions list |
| `/dashboard/forms` | Form template list (all 4 types: form, checklist, audit, pull_out) |
| `/dashboard/forms/fill/[id]` | Form fill for assignments; supports `show_options` conditional logic |
| `/dashboard/training` | Training dashboard |
| `/dashboard/training/courses` | Published courses |
| `/dashboard/training/courses/new` | New course creation |
| `/dashboard/training/courses/[id]` | Course editor |
| `/dashboard/training/learn/[enrollmentId]` | Course player |
| `/dashboard/workflows` | Workflow definition list |
| `/dashboard/workflows/builder/[id]` | Workflow stage and rule builder |
| `/dashboard/workflows/instances` | Running workflow instances |
| `/dashboard/workflows/my-tasks` | Workflows with pending action for current user |
| `/dashboard/workflows/fill/[instanceId]/[stageInstanceId]` | Form fill for workflow stage |
| `/dashboard/announcements` | Announcements list and creation |
| `/dashboard/safety` | Safety leaderboard and points |
| `/dashboard/maintenance` | Redirects to `/dashboard/issues?maintenance=1` |
| `/dashboard/maintenance/assets` | Asset inventory and repair history |
| `/dashboard/maintenance/guides` | Repair guides |
| `/dashboard/shifts` | Shift schedule, open shifts, swap requests |
| `/dashboard/insights` | Insights overview |
| `/dashboard/insights/reports/tasks` | Task analytics |
| `/dashboard/insights/reports/training` | Training completion analytics |
| `/dashboard/insights/reports/operations/audits` | Audit compliance report |
| `/dashboard/insights/reports/operations/caps` | CAP resolution report |
| `/dashboard/insights/reports/operations/checklists` | Checklist completion report |
| `/dashboard/insights/reports/operations/pull-outs` | Pull-out & wastage report |
| `/dashboard/insights/reports/safety/leaderboard` | Safety leaderboard report |
| `/dashboard/insights/reports/issues/maintenance` | Maintenance costs report |
| `/dashboard/insights/reports/issues/incidents` | Incidents report |
| `/dashboard/insights/reports/issues/recurring` | Recurring issues report |
| `/dashboard/insights/reports/issues/summary` | Issues summary report |
| `/dashboard/insights/reports/aging` | Aging report (tasks + issues) |
| `/dashboard/reports/compliance` | Compliance report |
| `/dashboard/users` | User management (admin only) |
| `/dashboard/vendors` | Vendor management |
| `/dashboard/settings` | Settings overview |
| `/dashboard/settings/locations` | Location management |
| `/dashboard/settings/roles` | Role management (admin only) |
| `/dashboard/settings/badges` | Badge configuration |
| `/dashboard/settings/feature-settings` | Feature flags toggle |
| `/dashboard/settings/shift-settings` | Attendance rules |
| `/dashboard/settings/audit-trail` | Audit trail event log |

---

## Mobile App Feature Modules

Located in `mobile/frontline_app/lib/features/`:

| Feature | Screens | Status |
|---|---|---|
| `auth` | `login_screen.dart` | Implemented — PKCE login |
| `dashboard` | `dashboard_screen.dart` | Implemented — KPI cards, My To-Do preview, AI brief section |
| `announcements` | `announcements_screen.dart`, `create_announcement_screen.dart` | Implemented |
| `forms` | `forms_screen.dart`, `form_fill_screen.dart` | Implemented |
| `issues` | `issues_screen.dart`, `issue_detail_screen.dart`, `report_issue_screen.dart` | Implemented; AI chat button stubbed (TODO: wire to `/api/v1/ai/chat`) |
| `notifications` | `notifications_screen.dart` (My To-Do List) | Implemented |
| `tasks` | `tasks_screen.dart`, `task_detail_screen.dart`, `create_task_screen.dart` | Implemented |
| `shifts` | `shifts_screen.dart` | Implemented |
| `training` | `courses_screen.dart`, `course_player_screen.dart` | Implemented |
| `audits` | `audit_fill_screen.dart`, `audit_templates_screen.dart` | Implemented |
| `approvals` | `approvals_screen.dart` | Implemented |
| `badges` | `badges_screen.dart` | Implemented |
| `team` | `team_screen.dart` | Implemented |
| `settings` | `settings_screen.dart` | Implemented |
| `ai_insights` | Models + repository + provider | Data layer implemented; UI integration partial |

Internationalisation: English + Thai (`l10n/app_en.arb`, `l10n/app_th.arb`).
Offline: `hive_service.dart` (local cache), `sync_service.dart` (connectivity-aware sync), `connectivity_service.dart`.
