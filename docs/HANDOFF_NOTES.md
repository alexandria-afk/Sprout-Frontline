# Handoff Notes

Non-obvious decisions, gotchas, and environment setup for a new engineer picking up this codebase.

---

## Environment Setup (Step by Step)

### Prerequisites
- Node.js 20+
- Python 3.13
- Flutter SDK ^3.11.1
- .NET SDK (for Keycloak via CoreServices.AppHost)
- Supabase CLI (for local PostgreSQL)
- Docker (for Azurite, if not using standalone)

### Step 1: Start Keycloak

Keycloak is NOT a standalone install — it runs via a .NET Aspire AppHost from the separate `Sprout-Frontline-V2` repository:

```bash
# In the Sprout-Frontline-V2 repository:
dotnet run --project CoreServices.AppHost
```

Keycloak will start on a dynamically allocated port visible in the Aspire dashboard (default: `http://localhost:56144`). Check the AppHost output for the exact port.

Realm: `sprout`. Client: `spaclient`. Admin console: `http://localhost:56144/admin`.

Test users (all exist in the `sprout` realm, password `Password1!`):
- `super_admin@sprout.test`
- `admin@sprout.test`
- `manager@sprout.test`
- `staff@sprout.test`

### Step 2: Start the Database (Supabase local)

```bash
supabase start
```

PostgreSQL runs on **port 54322** (not the standard 5432 — this is a local Supabase quirk). Connection string: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

If you need to apply migrations on a fresh database:
```bash
supabase db reset
```
This runs all 61 migrations in `supabase/migrations/` and then `supabase/seed.sql`.

### Step 3: Start Azurite (Azure Blob Storage emulator)

Azurite is the local Azure Blob Storage emulator. The backend `.env` is pre-configured to point at it on port 56008. Start it via:

```bash
# Via npm (if installed globally):
azurite --blobHost 127.0.0.1 --blobPort 56008

# Or via Docker:
docker run -p 56008:10000 mcr.microsoft.com/azure-storage/azurite azurite-blob --blobHost 0.0.0.0
```

Containers are created automatically on first upload (the `_ensure_container()` call in `blob_storage.py`).

### Step 4: Start the Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The `.env` file is at `backend/.env` (already populated for local dev — it contains a real Anthropic API key). Swagger UI: `http://localhost:8000/docs`.

The backend startup does two things automatically:
1. Resets any `onboarding_sessions` stuck in `provisioning` state for > 2 minutes (handles server crash recovery).
2. Starts the scheduled reminder background loop (`reminder_service.run_reminder_loop()`) as an asyncio task.

### Step 5: Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

The `.env.local` file is at `frontend/.env.local` (already populated for local dev). App at `http://localhost:3000`.

### Step 6: Start the Mobile App (optional)

```bash
cd mobile/frontline_app
flutter pub get
flutter run \
  --dart-define=KEYCLOAK_URL=http://10.0.2.2:56144 \
  --dart-define=KEYCLOAK_REALM=sprout \
  --dart-define=KEYCLOAK_CLIENT_ID=spaclient \
  --dart-define=API_BASE_URL=http://10.0.2.2:8000
```

`10.0.2.2` is the Android emulator's host alias. For iOS simulator, use `localhost` instead.

### Startup Order Matters

1. Keycloak must be running before the backend starts (backend fetches JWKS on first auth request)
2. PostgreSQL must be running before the backend starts
3. Azurite must be running before any file upload is attempted

---

## Keycloak Quirks

### JWKS Caching and Key Rotation

`dependencies.py` caches a `PyJWKClient` singleton in `_jwks_client`. When Keycloak is restarted with a new signing key, the first request that hits the backend will get a `PyJWKClientError` (unknown key ID). The code catches this, sets `_jwks_client = None`, and retries once with a fresh JWKS fetch. This is the recovery mechanism — it works correctly but means the very first request after a Keycloak restart will have double latency.

**Do not add retry logic on top of this.** The current single retry is the correct behavior.

### Token Expiry

Keycloak default access token lifetime in the `sprout` realm is 5 minutes. The refresh token is 30 days. The web frontend auto-refreshes on 401 (see `apiFetch` in `frontend/services/api/client.ts`). The mobile app refreshes in `AuthRepository.refreshAccessToken()` when the JWT is expired.

### `verify_aud: False`

The backend decodes JWTs with `options={"verify_aud": False}`. This is intentional — the Keycloak client `spaclient` does not set a specific audience claim in the way `PyJWT` expects. Changing this to True will cause all requests to fail with an audience validation error.

### Realm and Client ID

- Realm: `sprout` (configured in both `backend/.env` as `KEYCLOAK_REALM=sprout` and `frontend/.env.local` as `NEXT_PUBLIC_KEYCLOAK_REALM=sprout`)
- Client ID: `spaclient` (the OAuth2 client created in the Keycloak admin console)
- The `role` claim in the JWT comes from a Keycloak realm mapper that maps realm roles to the `role` JWT claim as an array. `dependencies.py` takes `raw_role[0]` as the effective role.

### Test User Management

Test users are managed in the Keycloak admin console at `http://localhost:56144/admin`. To create a new test user, create them in Keycloak first, then either: (a) they log in once and the email-fallback path in `get_current_user` will find their profile row and re-key it, OR (b) manually insert a profile row with `id` set to the Keycloak `sub` UUID.

---

## Database Quirks

### psycopg2 UUID Cast Rule

When passing a Python `list` of UUID strings to a query using `ANY(%s)`, you MUST cast the parameter:

```python
# CORRECT:
conn.execute("SELECT * FROM tasks WHERE id = ANY(%s::uuid[])", (task_ids,))

# WRONG — causes DataError: invalid input syntax for type uuid:
conn.execute("SELECT * FROM tasks WHERE id = ANY(%s)", (task_ids,))
```

Text columns (`status`, `role`, `title`) do NOT need this cast. Only UUID columns do. This rule is documented in `docs/CLAUDE.md` and has bitten the team before.

### ThreadedConnectionPool

The connection pool in `services/db.py` has `min=2, max=20`. Connections are borrowed via `get_db_conn()` (FastAPI dependency) or directly via `_get_pool().getconn()`.

**Critical:** Any code that calls `_get_pool().getconn()` directly (i.e., outside the FastAPI dependency) MUST call `pool.putconn(conn)` in a `finally` block. `notification_service.py` and `reminder_service.py` both do this correctly. If you add new code that bypasses `get_db_conn()`, you must follow the same pattern or you will exhaust the pool under load.

### No RLS

Row-Level Security was dropped from all tables during the Supabase → psycopg2 migration. There are no database-level access controls. If you forget to add `AND organisation_id = %s` to a query, users from one org can see another org's data. There are no safety nets at the DB level.

### `attendance_records.worked_minutes` is a Generated Column

`worked_minutes` is `GENERATED ALWAYS AS (GREATEST(0, total_minutes - break_minutes)) STORED`. PostgreSQL will reject any INSERT or UPDATE statement that names this column. Never include `worked_minutes` in your INSERT column list or SET clause.

### Local DB Port Is 54322

The Supabase local setup binds PostgreSQL on port 54322, not 5432. This is non-standard and will surprise anyone who tries `psql -h localhost` without specifying the port.

---

## Token Lifecycle

| Token | Storage (Web) | Storage (Mobile) | Expiry | Purpose |
|---|---|---|---|---|
| Access token | `kc_access_token` cookie (not HttpOnly, JS-readable) | `flutter_secure_storage` | ~5 min (Keycloak realm default) | Bearer token for all API calls |
| Refresh token | `kc_refresh_token` cookie (HttpOnly) | `flutter_secure_storage` | 30 days | Obtain new access tokens |
| ID token (mobile only) | — | `flutter_secure_storage` | — | Used for Keycloak logout (`end_session`) |

**Why access token is not HttpOnly:** `apiFetch` in `frontend/services/api/client.ts` reads the token from `document.cookie` to attach it to fetch requests. If it were HttpOnly, client-side code could not read it. The short 5-minute expiry limits the XSS window.

**Refresh token rotation:** Keycloak issues a new refresh token on each use (if refresh token rotation is enabled in the realm). The refresh route (`/api/auth/refresh`) resets the refresh token cookie on every successful refresh.

---

## Azure Blob Storage Setup

### Local (Azurite)

The dev connection string in `backend/.env` uses the Azurite well-known dev key:
```
DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tPZ/RwAAAAAAAAAAAAAAAAAAAAAAAAA==;BlobEndpoint=http://127.0.0.1:56008/devstoreaccount1;
```

Containers are created automatically by `_ensure_container()` on first upload. You don't need to pre-create them.

### Container Names

| Container | Used by |
|---|---|
| `form-photos` | Form response photo uploads |
| `form-videos` | Form response video uploads |
| `audit-signatures` | Audit signature pad captures |
| `repair-guides` | Repair guide file attachments |
| `issues` | Issue photo/video attachments |
| `training-media` | LMS course video/media |
| `announcement-media` | Announcement media attachments |

### Production Setup

For production, set `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_ACCOUNT_NAME` to your real Azure Storage account values. The 7 containers must be created in the Azure portal or via the Azure CLI before first use (the auto-create in Azurite does not apply to real Azure — or rather, it does work but requires `Storage Blob Data Contributor` role on the connection string's identity).

### Signed URLs

`get_signed_url()` generates SAS tokens by extracting the account key from the connection string. In production with Azure Active Directory auth (no shared key), this will fail. The production deployment must use a shared key connection string or switch to a different SAS generation method.

---

## The Combined Issues+Tasks Page

`/dashboard/issues` (`frontend/app/(dashboard)/dashboard/issues/page.tsx`) is a combined page that renders BOTH issues and tasks. It has two tabs:
- "Issues" tab — shows `GET /api/v1/issues` data
- "Tasks" tab — shows `GET /api/v1/tasks` data

The `/dashboard/tasks` route redirects here (`/dashboard/issues?tab=tasks`).

The inbox navigation mapping in `NOTIFICATION_SPEC.md` confirms: task inbox items navigate to `/dashboard/issues?tab=tasks&id={id}` and issue inbox items navigate to `/dashboard/issues?tab=issues&id={id}`.

Age badges (green/yellow/red) on every card/row use the `taskAgeColor()` helper:
- Tasks: SLA from `_TASK_SLA_HOURS` constant (`critical=4h, high=24h, medium=72h, low=168h`) — defined in both `backend/routes/reports.py` and `frontend/app/(dashboard)/dashboard/issues/page.tsx`
- Issues: SLA from `issue_categories.sla_hours` (default 24h)

---

## Demo Workspace System

The login page (`/login`) has a "Try Demo" flow:

1. Calls `POST /api/v1/auth/demo-start` with an optional company name
2. Backend creates: org + super_admin profile + onboarding session
3. Backend returns `{ email, password, org_id, session_id }` — the email and password are generated (e.g. `demo-abc12345@sprout.demo` / `Demoabc12345!`)
4. Frontend then calls Keycloak to create the user with those credentials (exact Keycloak admin API call happens in the login page component, not the backend)
5. Calls `POST /api/auth/signin` to log in immediately

Demo workspace deletion: `DELETE /api/v1/auth/demo/{org_id}` wipes all data in FK-safe order. The handler has a hardcoded list of tables to delete from. **Known issue:** The list includes some incorrect table names (`task_assignments` vs `task_assignees`, `shift_claims` vs `open_shift_claims`, `shift_swaps` vs `shift_swap_requests`, `timesheets` — which doesn't exist). The handler catches all exceptions with `pass`, so these silently fail. Demo cleanup may leave orphan rows in those tables.

---

## Non-Obvious Decisions and Why They Exist

### Supabase Is Still in the Repo (But Not Used)

`supabase/` directory, `@supabase/ssr`, `@supabase/supabase-js` in `package.json`, Supabase fields in `config.py` — all legacy from the original architecture. They are kept to avoid a large cleanup PR that could introduce regressions. The migration happened in phases (Phases 4–6). Do not add new code that uses any Supabase client. The plan is to remove these in a future cleanup pass.

### `frontend/app/(dashboard)/layout.tsx` Doesn't Exist

The dashboard layout file appears to be missing from the repo (confirmed: `frontend/app/(dashboard)/layout.tsx` throws a file-not-found error on Read). The routing works because Next.js can use the parent `frontend/app/layout.tsx`. If a shared sidebar/nav layout is desired, this file needs to be created. The sidebar nav and layout appear to be implemented inside individual page components.

### `issue_categories.is_maintenance` vs Old `maintenance_tickets` Table

The system went through two maintenance models:
1. **Old:** Separate `maintenance_tickets` table with its own routes
2. **Current:** Issues where the category has `is_maintenance=true`

The transition was done via migration `20260331000104–000105`. The old `routes/maintenance.py` was not deleted — it is a dead file. All maintenance logic is now in `routes/issues.py`, `routes/assets.py`, and `routes/reports.py` (the `GET /reports/maintenance-issues` endpoint).

### `/api/v1/organisations/my` Before `/{org_id}`

FastAPI matches routes in registration order. If `/{org_id}` were registered before `/my`, a GET to `/organisations/my` would try to look up an org with `id = "my"` (a UUID parse failure). The route file defines `/my` first specifically to prevent this. Do not reorder these routes.

### Inbox vs Notifications — Two Different Systems

Frequently confused:

| | Inbox (`/api/v1/inbox`) | Notifications (`/api/v1/notifications`) |
|---|---|---|
| **What it shows** | Outstanding work the user needs to do | Events that happened (regardless of resolution state) |
| **When items disappear** | When the underlying entity is resolved/completed | When user marks as read or dismisses |
| **Powers** | "My To-Do List" dashboard widget | Sidebar unread badge (60s poll of `/notifications/unread-count`) |
| **Table** | No table — computed on each request from 6 entity types | `notifications` table |
| **Push** | No | Yes (3 trigger types: task_assigned, form_assigned, scheduled_reminder) |

### Why the Onboarding Step Count Is 8 in Code but the Spec Says 8 UI Steps

`migration 20260330000100_widen_onboarding_step_to_8.sql` increased the max step from 7 to 8. The `STEPS` array in the frontend onboarding page has 8 items: Company, Team, Shifts, Assets, Vendors, Templates, Preview, Launch. The ONBOARDING_SPEC.md correctly documents 8 UI steps. The data model column allows `current_step INT(1–8)`.

### `_reset_stuck_provisioning_sessions()` on Startup

If the FastAPI process crashes during an onboarding provisioning run (which runs as a background task), the session stays in `launch_progress.status = "provisioning"` forever. On next startup, `main.py` finds sessions stuck in this state for > 2 minutes and marks them as `"failed"` so the user sees an error and can retry. This is a crash recovery mechanism, not a health check.

### CORS Origins Include Multiple Ports

`backend/.env` has `ALLOWED_ORIGINS` including ports 3000, 3001, 3002, 3003, and local network IPs. This is because multiple developers run the frontend simultaneously on different ports during development. In production, this should be restricted to a single origin.

---

## Things That Look Wrong But Are Intentional

**`kc_access_token` cookie is not HttpOnly.** This is intentional — `apiFetch` must read it from JavaScript. See Token Lifecycle section.

**`verify_aud: False` in JWT decode.** Intentional — the Keycloak client does not emit an `aud` claim in the format PyJWT expects for validation.

**`except Exception: pass` in `demo_workspace` delete handler.** Intentional — some table names may differ or not have `organisation_id` columns, and the delete order is best-effort.

**`_jwks_client = None` reset on `PyJWKClientError`.** Intentional — this is the key rotation recovery mechanism.

**Supabase env vars in `.env` files.** Kept for backward compat during migration — they are not used by any runtime code but removing them requires confirming no import still references them.

**`maintenance.py` route file in `backend/routes/`.** Intentional to keep (not deleted) to preserve git history. It is NOT included in `main.py`'s `app.include_router` calls, so its endpoints are not registered. Verify this is still the case before adding any maintenance-related code.

---

## Things That Look Intentional But Are Actually Known Bugs

**Demo workspace deletion leaves orphan rows.** The `DELETE /api/v1/auth/demo/{org_id}` handler tries to delete from `task_assignments`, `task_read_receipts`, `task_comments`, `shift_claims`, `shift_swaps`, `timesheets` — these table names don't match the actual schema (`task_assignees`, `task_messages`, `open_shift_claims`, `shift_swap_requests`). The `pass` in the exception handler silently swallows these errors. Demo orgs are never fully cleaned up.

**User creation does not provision Keycloak.** `POST /api/v1/users/` looks like it creates a user, but only creates the DB profile. The created user cannot log in. The three `# TODO: create/update/disable user in Keycloak admin API` stubs in `user_service.py` are real functionality gaps, not future enhancements.

**Role changes require re-login.** `PATCH /api/v1/users/{user_id}` updates `profiles.role` but not the Keycloak realm role. The user's JWT will carry the old role until they log out and back in. In production, a user whose role is changed from admin to staff can continue performing admin actions until their refresh token expires (up to 30 days).

---

## Env File Locations

| File | What it configures |
|---|---|
| `backend/.env` | Backend Python settings: KEYCLOAK_URL, DATABASE_URL, AZURE_STORAGE_CONNECTION_STRING, ANTHROPIC_API_KEY, FCM keys, ALLOWED_ORIGINS |
| `frontend/.env.local` | Frontend Next.js vars: KEYCLOAK_* vars, NEXT_PUBLIC_API_BASE_URL, legacy Supabase vars (unused) |
| `.env.example` | Root-level example — **outdated** (still references Supabase, not Keycloak). Ignore it. |

Neither `.env` file should be committed. Both are in `.gitignore`. If you set up a fresh clone, copy these files from a teammate or the project's secret management system.

---

## Quick Reference: Common Patterns

### Get org_id from current user in a route handler
```python
org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
```

### Get user_id from JWT
```python
user_id = current_user["sub"]
```

### Get role from current user
```python
role = (current_user.get("app_metadata") or {}).get("role", "staff")
```

### Execute a query returning one row
```python
from services.db import row
r = row(conn, "SELECT * FROM issues WHERE id = %s AND organisation_id = %s", (issue_id, org_id))
```

### Execute a query returning many rows
```python
from services.db import rows
items = rows(conn, "SELECT * FROM tasks WHERE organisation_id = %s AND is_deleted = FALSE", (org_id,))
```

### Upload a file to Azure Blob
```python
from services.blob_storage import upload_blob, get_public_url
url = upload_blob("issues", f"{issue_id}/{filename}", file_bytes, content_type="image/jpeg")
```

### Send a notification
```python
from services.notification_service import notify
await notify(
    org_id=org_id,
    recipient_user_id=user_id,
    type="task_assigned",
    title=f"New task: {task.title}",
    body=f"{location.name} · Due {due_str}",
    entity_type="task",
    entity_id=task_id,
    send_push=True,
)
```

### Add a new feature flag
1. Add SQL: `UPDATE organisations SET feature_flags = feature_flags || '{"my_flag": false}'`
2. Add entry to `docs/ALLOWED_VALUES.md` under "Organisation Feature Flags"
3. Add toggle to `/dashboard/settings/feature-settings` page
4. Check the flag in relevant routes: `org.feature_flags.get("my_flag", False)`
