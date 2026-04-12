# Current Focus

_Last updated: 2026-04-12 (rev 2)_

---

## What Is Working (confirmed by full backend routes + frontend pages)

### Core Operations
- **Tasks** — full CRUD, assignees, message threads, attachments with annotation, status history, templates, spawn-from-template. Frontend: combined `/dashboard/issues` page with kanban + list view, age badge SLA coloring.
- **Issues** — full CRUD, custom fields, comments, attachments, escalation rules, AI classification (category + priority + safety flag), PDF export, status history. Kanban board with all 5 statuses.
- **Forms** — 4 types (checklist, form, audit, pull_out), conditional logic (show/hide + show_options dropdown filtering), assignments, draft saving, submission, manager review/approve/reject. AI form generation.
- **Audits** — template builder with section weights and field scores, AI template generation, submission scoring server-side, CAP auto-creation on failure, PDF export, auditee signature capture.
- **CAPs** — AI-generated per failed audit field, manager confirm/dismiss, spawn follow-up tasks/issues/incidents, PDF export.
- **Announcements** — create, role + location targeting, acknowledgement tracking.
- **Workflows** — definition builder, 9 action types, 4 trigger types, routing rules, running instances, form fill for workflow stages.
- **LMS** — course creation, 4 module types (slides, video, pdf, quiz), quiz with 3 question types, enrollment, progress tracking, quiz attempts, AI course generation (async job), certificate generation, AI quiz generation, course translation, knowledge gap analysis, learning paths.
- **Gamification** — badge configs (8 criteria types), user badge awards, leaderboard configs, score computation. Settings page for badge management.
- **Shifts & Attendance** — shift templates, shift creation and publishing, open shifts, shift swap requests, leave requests, clock-in/out (GPS, selfie, QR, manager override), break tracking, attendance records with computed `worked_minutes`, AI schedule generation, timesheet report.
- **Vendors** — CRUD + category access grants.
- **Assets** — CRUD + repair history aggregated from maintenance-category issues. Predictive maintenance: `predicted_days_to_failure` (int) and `failure_risk_score` (float 0–1) populated by Claude after ticket resolution, or on demand via `POST /api/v1/assets/{id}/predict`.
- **Repair Guides** — CRUD with file upload.
- **Incidents** — CRUD, status, attachments, PDF export.
- **Safety** — points leaderboard, badge management.
- **Maintenance** — tracked via issues where `is_maintenance=true`, maintenance costs report, asset detail with repair history.
- **Reports** — audit compliance, checklist completion, pull-out summary/trends/top-items/anomalies, maintenance costs, task aging, issue aging, resolution time.
- **AI Daily Brief** — generates natural language summary including SLA breach context from aging endpoints; cached in localStorage.
- **Notifications** — event log table (`notifications`), unread count badge (60s poll), full notification list, FCM push via firebase-admin (task_assigned, form_assigned, scheduled_reminder push triggers).
- **Inbox** — status-based My To-Do List aggregating 6 entity types; dashboard widget + mobile full screen.
- **Onboarding** — 8-step AI wizard fully implemented: URL scrape, AI company profile extraction, AI location suggestions, team import (CSV with AI header mapping, manual, invite link), shift settings, assets, vendors, industry template package selection, workspace preview, background provisioning with progress polling, post-launch guided actions.
- **Audit Trail** — event log for task/issue/form/workflow/onboarding actions.
- **Feature Flags** — per-org JSONB feature flags, admin toggle UI at `/dashboard/settings/feature-settings`.
- **Pull-out analytics** — summary, trends, top items, anomaly detection (>1.5× 4-week rolling average).
- **Demo workspace** — `POST /api/v1/auth/demo-start` creates a fresh org + onboarding session; `DELETE /api/v1/auth/demo/{org_id}` wipes it. Login page has demo workspace creation and switching UI.

### Mobile (Flutter)
Auth (PKCE), dashboard, announcements, forms + form fill, issues (report + detail), tasks (list + detail + create), shifts, training (course player), audits (fill), approvals, badges, team, settings, notifications/inbox screen. Offline support via Hive + connectivity-aware sync. Internationalisation: EN + Thai.

---

## What Is Incomplete

### Facial Recognition Clock-In
`clock_in_method = 'facial_recognition'` is in ALLOWED_VALUES but no verification logic exists. `face_profiles` table exists but is never populated. Selfie clock-in stores a photo but does not perform face matching.

### `routes/maintenance.py` — Stale File
This route file still writes to/reads from `maintenance_tickets`, which was dropped in migration `20260331000105_drop_maintenance_tickets.sql`. The route is registered in `main.py` (it appears under the general routes import but is NOT included in the `app.include_router` calls in the current `main.py`). However, the file exists and is potentially loadable. Any call to any `/api/v1/maintenance` endpoint will 500 with a PostgreSQL relation-does-not-exist error.

### Supabase Dependencies in Frontend
`@supabase/ssr` and `@supabase/supabase-js` remain in `frontend/package.json`. A `frontend/services/supabase/` directory exists. These are unused by runtime code but present a potential confusion source and minor security surface (stale anon key is in `.env.local`). Should be removed in a cleanup pass.

### Firebase Push Notifications (prod only)
FCM push works in dev only if `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable is set. It is not in `backend/.env`. `_init_firebase()` in `notification_service.py` silently returns `False` if the env var is missing, so push is simply skipped in dev. This is intentional for local dev but must be configured before production.

### Resend Email
`RESEND_API_KEY` in `backend/.env` is `REPLACE_WITH_RESEND_API_KEY` — a placeholder. Email sending (invite links during onboarding) is not functional until this is replaced.

---

## What Is Known Broken or Recently Fixed

### Recently Fixed
- Supabase Auth → Keycloak migration (Phase 6, commit `0b9d803`): Mobile auth migrated from `supabase_flutter` to `flutter_appauth` + Keycloak PKCE.
- Supabase client → psycopg2 migration (commits `eaa36cd`, `74f99c3`, `7802d44`): All backend routes and services now use direct psycopg2 queries.
- Supabase Storage → Azure Blob Storage (commit `b1712a3`): All file upload/download now uses `services/blob_storage.py`.
- `maintenance_tickets` table dropped; maintenance now tracked as issues with `is_maintenance=true` category.
- `notification_log` table dropped and replaced with `notifications` table (more structured, with push tracking).
- `organisations.my` route ordering fixed — defined before `/{org_id}` to prevent path-param capture.
- **Keycloak user sync wired**: `user_service.py` now calls `services/keycloak_admin.py` on create (Keycloak UUID becomes `profiles.id`), role update, and soft delete (disable). Onboarding launch also creates Keycloak accounts per employee.
- **Predictive maintenance**: `services/asset_prediction_service.py` calls Claude (haiku) after ticket resolution; writes `predicted_days_to_failure` + `failure_risk_score` to assets. On-demand via `POST /api/v1/assets/{id}/predict`.
- **Demo workspace deletion**: Rewrote with PostgreSQL savepoints + correct table names + all child tables covered. Phase-based: leaf tables via subquery, then `org_id` tables, then org root, then Keycloak disable.
- **Token auto-refresh**: `apiFetch` retries on 401 via `POST /api/auth/refresh` (HttpOnly refresh cookie); redirects to `/login` if refresh fails.
- **UUID cast fixes**: `= ANY(%s::uuid[])` applied across task_service, gamification_service, dashboard_service, cap_service, safety routes — fixes psycopg2 type errors introduced during migration.
- **Date locale i18n**: All hardcoded locale strings (`"en-PH"`, `"en-US"`, `"en-GB"`) replaced with `undefined` in 12 frontend files (31 occurrences). Dates now render in the user's system locale automatically.
- **Mobile AI chat wired**: `_SidekickSheetState` in `issues_screen.dart` now calls `POST /api/v1/ai/chat` via `DioClient`. Renders conversation history with user/assistant bubbles, typing indicator, suggestion chips send on tap.
- **Workflow push notifications wired**: `notify` stage in `workflow_service.py` now calls `notify_role()` with `send_push=True` for each role in `cfg.roles`. FCM delivery follows the same pattern as all other push events.

### Known Broken
- **`routes/maintenance.py`** references dropped `maintenance_tickets` table. Calls to `/api/v1/maintenance/*` will 500. (The predictive maintenance trigger in this file is reached only when the endpoint is callable — verify registration in `main.py`.)

---

## Endpoints in Backend Without Corresponding Frontend Page

| Backend Endpoint | Notes |
|---|---|
| `GET /api/v1/ai/dashboard-insights` | Mobile only; web uses inline AI brief on dashboard |
| `POST /api/v1/ai/chat` (streaming) | Mobile AI chat button stubbed; web sidekick TBD |
| `GET /api/v1/safety/*` | Safety routes exist; `/dashboard/safety` page exists but may be incomplete |
| `GET /api/v1/shifts/availability` | Staff availability: controlled by `staff_availability_enabled` feature flag |
| `POST /api/v1/shifts/ai-schedule` | AI schedule generation endpoint; UI exists in shifts page |
| `GET /api/v1/lms/courses/{id}/cert` | Certificate download; wired in backend, frontend integration unknown |
| `GET /api/v1/incidents/*` | `routes/incidents.py` exists; no `/dashboard/incidents` standalone page — incidents surfaced through CAPs and reports |

## Frontend Pages Without Clear Backend Endpoint

| Frontend Route | Notes |
|---|---|
| `/dashboard/reports/compliance` | May call `/api/v1/reports/compliance`; verify route mapping |
| `/dashboard/settings/roles` | Role management UI; blocked for manager; admin-only; backend endpoint unclear — may be handled through `PATCH /api/v1/users/{id}` |
| `/dashboard/settings/shift-settings` | Calls `GET/PUT /api/v1/shifts/attendance/rules` — confirmed wired |

---

## Mobile App Status

**Well implemented and likely working:**
- Auth (PKCE login/logout/refresh via flutter_appauth)
- Dashboard (KPI cards, My To-Do List preview, AI brief section structure)
- Announcements (list + create)
- Forms (list + fill with field rendering)
- Issues (list + report + detail)
- Tasks (list + detail + create)
- Training (courses list + course player with slides + quiz)
- Shifts (schedule view)
- Approvals screen (shift claims, leave, swap approvals)
- Badges screen
- Notifications/inbox screen (My To-Do List)
- Settings screen
- Offline-first Hive caching + connectivity sync

**Partial / needs verification:**
- AI insights: data layer (models, repository, provider) implemented; UI integration in dashboard screen may be partial (cards not shown yet)
- AI chat: button present in issues screen but not wired (`// TODO: Wire to POST /api/v1/ai/chat`)
- Audits: fill screen and templates screen exist; end-to-end submission not verified
- Team screen: exists; content scope unclear

**Not implemented on mobile:**
- Workflow builder (web-only)
- Audit template creation (web-only)
- Reports/analytics (web-only)
- User management (web-only)
- Settings/admin (web-only)
- Onboarding wizard (web-only)
