# CLAUDE.md

## Project

**Sprout Field Ops** (internal repo name: `RETAIL APP RENEGADE`, product name: `Frontliner`) is a multi-tenant SaaS operations platform for retail, quick-service restaurant, hospitality, and logistics businesses. It covers task management, form/checklist assignments, auditing with corrective action plans, issue tracking, maintenance/asset management, shift scheduling and attendance, an LMS with AI-generated course content, workflow automation, gamification/leaderboards, announcements, and an AI onboarding wizard that provisions a full workspace from a company URL.

---

## Complete Tech Stack

### Web Frontend — `frontend/`
| Package | Version |
|---|---|
| Next.js (App Router) | 14.2.35 |
| React | ^18 |
| TypeScript | ^5 |
| Tailwind CSS | ^3.4.1 |
| TanStack React Query | ^5.90.21 |
| Zustand | ^5.0.12 |
| React Hook Form | ^7.71.2 |
| Zod | ^4.3.6 |
| Recharts | ^3.8.0 |
| @hello-pangea/dnd | ^18.0.1 |
| Lucide React | ^0.577.0 |
| jose (JWT verify) | ^6.2.2 |
| keycloak-js | ^26.2.3 |
| Playwright (E2E) | ^1.58.2 |

### Backend — `backend/`
| Package | Version |
|---|---|
| FastAPI | 0.115.4 |
| Python | 3.13 |
| Uvicorn | 0.32.0 |
| Pydantic + pydantic-settings | 2.12.5 / 2.6.1 |
| psycopg2-binary | 2.9.10 |
| PyJWT | 2.10.1 |
| anthropic SDK | >=0.49.0 |
| azure-storage-blob | >=12.28.0 |
| slowapi (rate limiting) | 0.1.9 |
| reportlab (PDF) | >=4.0.0 |
| httpx | 0.28.1 |
| beautifulsoup4 | >=4.12.0 |
| pytest / pytest-asyncio | 8.3.5 / 0.24.0 |

### Mobile — `mobile/frontline_app/`
| Package | Version |
|---|---|
| Flutter / Dart SDK | ^3.11.1 |
| flutter_riverpod | ^2.6.1 |
| go_router | ^14.8.1 |
| dio | ^5.7.0 |
| flutter_appauth | ^8.0.1 |
| jwt_decoder | ^2.0.1 |
| hive_flutter | ^1.1.0 |
| workmanager | ^0.5.2 |
| flutter_secure_storage | (transitive) |

### Auth
- **Keycloak** — realm `sprout`, client `spaclient`
- Web: Resource Owner Password Credentials (ROPC) flow — Next.js API routes exchange email/password with Keycloak
- Mobile: PKCE Authorization Code flow via `flutter_appauth`
- Backend: RS256 JWKS validation via `PyJWKClient` — keys cached, auto-reset on key rotation

### Database
- **PostgreSQL 17**, direct `psycopg2-binary` connection via `ThreadedConnectionPool` (min 2, max 20)
- 61 SQL migrations in `supabase/migrations/` (source of schema truth — Supabase is no longer used for auth or data)

### External Services
- **Keycloak** — auth (started via `dotnet run --project CoreServices.AppHost` from Sprout-Frontline-V2 repo)
- **Azure Blob Storage** (Azurite locally) — file storage; `AZURE_STORAGE_CONNECTION_STRING` env var
- **Anthropic Claude** — `claude-haiku-4-5` for all AI features; `ANTHROPIC_API_KEY` env var
- **Firebase / FCM** — push notifications; requires `FIREBASE_SERVICE_ACCOUNT_JSON` env var (not yet configured for dev)
- **Resend** — email (invite links); `RESEND_API_KEY` env var (not yet wired beyond config)

---

## Folder Structure

```
RETAIL APP RENEGADE/
├── backend/
│   ├── main.py                  App factory, router registration, lifespan (reminder loop)
│   ├── config.py                Pydantic-settings config loader (reads backend/.env)
│   ├── dependencies.py          FastAPI DI: get_db, get_current_user, require_admin, require_manager_or_above, paginate
│   ├── requirements.txt
│   ├── routes/                  30 route files, one per feature domain
│   ├── services/                Business logic + external wrappers (21 files)
│   ├── models/                  Pydantic request/response schemas (14 files)
│   ├── middleware/
│   │   ├── auth.py              AuthMiddleware (supplemental; main auth is the dependency)
│   │   └── logging.py           Request logging middleware
│   ├── scripts/                 One-off seed scripts
│   └── .env                    Local secrets (do not commit)
├── frontend/
│   ├── app/
│   │   ├── (auth)/              Login, set-password, auth/callback pages
│   │   ├── (onboarding)/        8-step AI onboarding wizard (single page component)
│   │   ├── (dashboard)/         All post-login routes; shared layout with sidebar nav
│   │   └── api/auth/            Next.js API routes: signin, refresh, me, signout
│   ├── components/              Shared UI (layout, shared, issues, tasks, audits, etc.)
│   ├── services/                API client modules (one per domain) + api/client.ts
│   ├── hooks/                   Custom React hooks
│   ├── lib/
│   │   └── auth.ts              verifyToken(), getClientToken(), TOKEN_COOKIE, REFRESH_COOKIE
│   ├── types/                   TypeScript interfaces and enums
│   ├── middleware.ts             Auth guard + role-based page guards
│   ├── .env.local               Frontend env vars (do not commit)
│   └── e2e/                     Playwright test suite
├── mobile/frontline_app/lib/
│   ├── main.dart                Riverpod ProviderScope root, Hive init
│   ├── core/                    api/, auth/, config/, i18n/, offline/, router/, theme/
│   └── features/                Feature modules (15 features)
├── supabase/
│   ├── migrations/              61 SQL files — source of truth for schema history
│   ├── seed.sql                 Base seed data
│   └── seed_test_org.sql        Test org seed
└── docs/                        This file + ARCHITECTURE.md, ALLOWED_VALUES.md, etc.
```

---

## Naming Conventions (observed in actual code)

- **Route files:** `snake_case.py` matching API prefix (`issue_categories.py` → `/api/v1/issues/categories`)
- **Service files:** `{domain}_service.py` or `{noun}.py` (e.g. `shift_service.py`, `blob_storage.py`)
- **Model files:** `{domain}.py` with Pydantic classes (e.g. `models/tasks.py`)
- **Frontend service files:** `{domain}.ts` (e.g. `services/issues.ts`) — each wraps `apiFetch` calls for one backend route group
- **Frontend pages:** kebab-case directories with `page.tsx`, `layout.tsx`
- **Mobile features:** `features/{name}/data/models/`, `data/repositories/`, `presentation/screens/`, `providers/`
- **DB columns:** `snake_case`; UUIDs everywhere for PKs; `is_deleted BOOLEAN` for soft deletes; `organisation_id UUID` on every tenant table

---

## Key Architectural Decisions

### Soft Deletes
All entities use `is_deleted BOOLEAN DEFAULT false` instead of hard deletion. Every query must include `AND is_deleted = FALSE` (or `= false`). The `DELETE` HTTP verb still soft-deletes — it does not remove the row.

### Multi-Tenancy (Organisation Scoping)
Every table has `organisation_id UUID`. There is **no Row-Level Security** — RLS was dropped from all tables. Organisation scoping is enforced in application code: every route extracts `org_id` from `current_user["app_metadata"]["organisation_id"]` and appends it to every query. Never omit this filter.

### Roles
Four roles: `super_admin`, `admin`, `manager`, `staff`. Role is stored in `profiles.role` (PG enum) and echoed into the Keycloak JWT `role` claim via a realm mapper. The backend `get_current_user` dependency reads the JWT role but also fetches from `profiles` to get `organisation_id` and `location_id`.

### No Direct Supabase Usage
Supabase was the original auth + database client. It has been fully migrated out:
- Auth → Keycloak
- DB client → psycopg2
- File storage → Azure Blob Storage
- The `supabase/` directory is kept only as a schema history reference (migrations)
- `config.py` still has Supabase fields for backward compat — they are unused by runtime code

### AI
All AI calls go through the Anthropic Python SDK (Claude Haiku). No direct AI calls from frontend. Every AI call is logged to `ai_request_log` via the `AILogger` service. The onboarding route uses a 60-second timeout on the Anthropic client to prevent provisioning tasks from hanging indefinitely.

### Connection Pooling
`backend/services/db.py` creates a `ThreadedConnectionPool(min=2, max=20)` lazily on first use. The `get_db_conn` FastAPI dependency borrows a connection from the pool per request and returns it on completion. `main.py` startup also borrows connections directly (using `_get_pool()`) for the stuck-session reset and reminder service — these must call `pool.putconn()` in a finally block.

---

## Auth Flow Summary

### Web Login
1. User submits email/password on `/login`
2. `POST /api/auth/signin` (Next.js API route) exchanges credentials with Keycloak via ROPC flow
3. Keycloak returns `access_token` (RS256 JWT, ~5 min expiry) + `refresh_token` (30 days)
4. Next.js sets two cookies: `kc_access_token` (not HttpOnly, readable by JS for `apiFetch`) and `kc_refresh_token` (HttpOnly)
5. `middleware.ts` calls `verifyToken()` (uses `jose` JWKS verify) on each request; unauthenticated dashboard requests → redirect to `/login`
6. `apiFetch` (client-side) reads `kc_access_token` from cookie, appends `Authorization: Bearer` header; on 401 → calls `POST /api/auth/refresh` → Keycloak refresh grant → new cookies → retry once

### Backend Validation
Every FastAPI route uses `get_current_user` dependency (in `dependencies.py`):
1. Extracts `Bearer` token from `Authorization` header
2. `PyJWKClient.get_signing_key_from_jwt(token)` fetches JWKS from Keycloak, caches
3. `jwt.decode(token, key, algorithms=["RS256"], options={"verify_aud": False})`
4. Looks up `profiles` by Keycloak UUID; if not found, falls back to email match and re-keys the profile row
5. Returns enriched dict with `app_metadata: {role, organisation_id, location_id, language}`

### Mobile Auth
PKCE flow via `flutter_appauth` — launches system browser, exchanges code for tokens, stores in `flutter_secure_storage`. Token refresh uses `flutter_appauth.token()` with `grant_type=refresh_token`. Tokens stored under keys `kc_access_token`, `kc_refresh_token`, `kc_id_token`.

---

## DO NOT Section — Actual Footguns

**UUID arrays in psycopg2:** When passing a Python `list` of UUID strings to `ANY(%s)`, always cast the parameter: `ANY(%s::uuid[])`. Text columns (`status`, `role`, `title`) do NOT need this cast. Missing the cast causes a psycopg2 type error at runtime that is not caught until the query executes.

**Never insert/update `attendance_records.worked_minutes` directly.** It is a `GENERATED ALWAYS AS (GREATEST(0, total_minutes - break_minutes)) STORED` computed column. PostgreSQL will reject INSERT/UPDATE statements that name it.

**The `/organisations/my` route must be defined before `/{org_id}` in the router** or FastAPI will match the literal string "my" as an org_id path param. This is handled in `routes/organisations.py` already — do not reorder.

**`maintenance.py` route file is stale.** It still writes to `maintenance_tickets` which was dropped in migration `20260331000105_drop_maintenance_tickets.sql`. The frontend `/dashboard/maintenance` page redirects to `/dashboard/issues?maintenance=1`. Do not call any `/api/v1/maintenance` endpoints. They will 500.

**`demo-start` does not create a Keycloak user.** `POST /api/v1/auth/demo-start` only creates the DB rows (org + profile + onboarding session). The caller must separately create the Keycloak user and link it to the returned `profile_id`. The demo flow in the login page handles this manually.

**JWKS caching and key rotation:** The `_jwks_client` singleton in `dependencies.py` is reset to `None` on a `PyJWKClientError`, which forces a re-fetch. This is the only automatic key-rotation recovery. If Keycloak is restarted with a new signing key, the first request after it will fail and retry once. This is intentional and correct behavior.

**`@supabase/ssr` and `@supabase/supabase-js` are still in `package.json`.** They are legacy dependencies — not used by any runtime code, but removing them requires checking for any stale imports in `frontend/services/supabase/`. Do not add new code that imports from these packages.

**Token cookie is not HttpOnly.** `kc_access_token` is intentionally readable by JavaScript so `apiFetch` can attach it to requests. The short 5-minute expiry limits the XSS exposure window. Do not change it to HttpOnly — it will break `apiFetch`.

**`face_profiles` table exists but facial recognition is not implemented.** `clock_in_method = 'facial_recognition'` is in the schema and ALLOWED_VALUES but no verification logic runs.

**Date formatting: always use `undefined` as the locale argument**, not a hardcoded string. All `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`, and `Intl.DateTimeFormat` calls in the frontend pass `undefined` so the browser renders dates in the user's system locale. Do not introduce hardcoded locale strings like `"en-PH"` or `"en-US"`.

**Predictive maintenance runs after ticket resolution.** `maintenance.py:update_ticket_status` calls `services/asset_prediction_service.predict_asset_failure()` when `status == "resolved"` and the ticket has an `asset_id`. This is awaited inline — expect ~1–2 s of Claude latency added to that endpoint. Failures are caught and logged; they do not fail the ticket update.

---

## How to Start Everything

### 1. Keycloak (required first)
```bash
# From the Sprout-Frontline-V2 repo:
dotnet run --project CoreServices.AppHost
```
Keycloak will be available at `http://localhost:56144`. Realm: `sprout`. Client: `spaclient`.

### 2. PostgreSQL (via Supabase local)
The local DB runs via the Supabase CLI on port 54322 (not the default 5432):
```bash
supabase start
```
Connection string: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

### 3. Azurite (Azure Blob Storage emulator)
If using Azurite for local storage, start it separately. The default connection string in `backend/.env` points to `http://127.0.0.1:56008/devstoreaccount1`.

### 4. Backend (FastAPI)
```bash
cd backend
python -m uvicorn main:app --reload --port 8000
```
API docs at `http://localhost:8000/docs`.

### 5. Frontend (Next.js)
```bash
cd frontend
npm install
npm run dev
```
Available at `http://localhost:3000`.

### 6. Mobile (Flutter) — optional
```bash
cd mobile/frontline_app
flutter run \
  --dart-define=KEYCLOAK_URL=http://10.0.2.2:56144 \
  --dart-define=KEYCLOAK_REALM=sprout \
  --dart-define=KEYCLOAK_CLIENT_ID=spaclient \
  --dart-define=API_BASE_URL=http://10.0.2.2:8000
```
`10.0.2.2` is the Android emulator's alias for the host machine's `localhost`.

---

## Test User Credentials

All test users exist in the `sprout` Keycloak realm. Password for all: `Password1!`

| Email | Role |
|---|---|
| `super_admin@sprout.test` | super_admin |
| `admin@sprout.test` | admin |
| `manager@sprout.test` | manager |
| `staff@sprout.test` | staff |

---

## Role Permissions Quick Reference

**Staff** can only: view/complete own tasks+forms+checklists, report issues, view own shifts/clock in/out/claim open shifts, take training, view announcements, view own badges, submit leave requests, use AI chat.

**Staff cannot see:** other people's tasks, team/attendance views, approval screens, user management, settings, analytics, workflow builder, issue categories editor, template management.

**Manager** adds: view team tasks/issues/attendance, approve/reject workflows+shifts+leave, assign tasks+forms, run audits, create announcements, view location reports.

**Admin/Super Admin** adds: all locations, user management, settings, workflow builder, template management, full analytics.

Every screen, nav item, and button must check role before rendering. Hidden, not disabled.

---

## Key Docs

- `docs/ARCHITECTURE.md` — complete route, table, and page reference
- `docs/ALLOWED_VALUES.md` — constrained enum values (read before touching workflows, courses, AI prompts, seed data)
- `docs/NOTIFICATION_SPEC.md` — notification system spec
- `docs/ONBOARDING_SPEC.md` — onboarding wizard step-by-step spec
- `docs/HANDOFF_NOTES.md` — gotchas, environment setup, known issues
