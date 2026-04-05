# QA API Acceptance Test Results

**Date:** 2026-04-01  
**Tester:** Automated (Claude Code via curl)  
**Backend:** http://localhost:8000  
**Auth:** Supabase local (http://localhost:54321)

---

## Authentication

All 4 dev accounts authenticated successfully via `POST /auth/v1/token?grant_type=password`.

| Role         | Email                    | Auth Status |
|--------------|--------------------------|-------------|
| super_admin  | admin@renegade.com       | OK (200)    |
| admin        | branchadmin@renegade.com | OK (200)    |
| manager      | manager@renegade.com     | OK (200)    |
| staff        | staff@renegade.com       | OK (200)    |

---

## Endpoint Test Matrix

### 1. GET /api/v1/shifts/my

**Response shape:** `{items: [...], total_count: N}`  
**Item keys:** id, organisation_id, location_id, template_id, assigned_to_user_id, created_by, role, start_at, end_at, status, is_open_shift, cancellation_reason, notes, ai_generated, is_deleted, created_at, updated_at, profiles, locations, open_shift_claims

| Role         | HTTP | Items | total_count | Notes |
|--------------|------|-------|-------------|-------|
| super_admin  | 200  | 0     | 0           | No shifts assigned to this user |
| admin        | 200  | 0     | 0           | No shifts assigned to this user |
| manager      | 200  | 1     | 1           | Has 1 shift |
| staff        | 200  | 2     | 2           | Has 2 published shifts |

**Verdict:** PASS -- correctly returns only shifts assigned to the authenticated user.

---

### 2. GET /api/v1/notifications?is_read=false&limit=5

**Response shape:** `{items: [...], total: N, page: N, limit: N}`

| Role         | HTTP | Items | Total (unread) | Notes |
|--------------|------|-------|----------------|-------|
| super_admin  | 200  | 3     | 3              | 3 unread, all returned |
| admin        | 200  | 5     | 7              | 7 unread, limited to 5 by `limit=5` |
| manager      | 200  | 5     | 9              | 9 unread, limited to 5 |
| staff        | 200  | 0     | 0              | No unread notifications |

**Verdict:** PASS -- limit parameter works, data is user-scoped.

---

### 3. GET /api/v1/notifications/unread-count

**Response shape:** `{count: N}`

| Role         | HTTP | count |
|--------------|------|-------|
| super_admin  | 200  | 3     |
| admin        | 200  | 7     |
| manager      | 200  | 9     |
| staff        | 200  | 0     |

**Verdict:** PASS -- counts match the `total` from the notifications list endpoint above.

---

### 4. GET /api/v1/ai/dashboard-insights

**Response shape:** `{brief: "string", insights: [...], cached_at: "timestamp", role_level: "string"}`  
**Insight item keys:** severity, title, body, recommendation

| Role         | HTTP | role_level | Insights | Brief length |
|--------------|------|------------|----------|--------------|
| super_admin  | 200  | admin      | 3        | 278 chars    |
| admin        | 200  | admin      | 3        | 278 chars    |
| manager      | 200  | manager    | 3        | ~278 chars   |
| staff        | 200  | staff      | 3        | ~278 chars   |

**Verdict:** PASS -- role_level correctly differentiates: super_admin and admin both get "admin" level, manager gets "manager", staff gets "staff".

---

### 5. GET /api/v1/gamification/leaderboards

**Response shape:** bare JSON array `[...]` (NOT wrapped in `{items:[...]}`)  
**Item keys:** id, organisation_id, name, description, metric_type, scope, time_window, is_active, is_template, created_at, updated_at, is_deleted

| Role         | HTTP | Items |
|--------------|------|-------|
| super_admin  | 200  | 4     |
| admin        | 200  | 4     |
| manager      | 200  | 4     |
| staff        | 200  | 4     |

**Verdict:** PASS -- all roles see the same 4 leaderboard configs (org-scoped, not user-scoped).

**NOTE (inconsistency):** This endpoint returns a bare list, while most other list endpoints return `{items: [...]}`. The mobile app must handle both shapes.

---

### 6. GET /api/v1/gamification/points/my

**Response shape:** single object `{id, user_id, organisation_id, total_points, issues_reported, issues_resolved, checklists_completed, checklist_current_streak, checklist_longest_streak, audits_completed, audit_perfect_scores, training_completed, tasks_completed, attendance_current_streak, attendance_longest_streak, updated_at}`

| Role         | HTTP | total_points | tasks_completed | issues_reported |
|--------------|------|-------------|-----------------|-----------------|
| super_admin  | 200  | 1465        | (varies)        | (varies)        |
| admin        | 200  | 884         | (varies)        | (varies)        |
| manager      | 200  | 790         | (varies)        | (varies)        |
| staff        | 200  | 73          | 27              | 7               |

**Verdict:** PASS -- returns user-specific gamification data.

---

### 7. GET /api/v1/announcements/

**Response shape:** `{items: [...], total_count: N, page: N, page_size: N}`  
**Item keys:** id, organisation_id, created_by, title, body, media_url, media_urls, creator_name, requires_acknowledgement, my_acknowledged, publish_at, target_roles, target_location_ids, created_at, updated_at

| Role         | HTTP | Items | total_count |
|--------------|------|-------|-------------|
| super_admin  | 200  | 14    | 14          |
| admin        | 200  | 14    | 14          |
| manager      | 200  | 14    | 14          |
| staff        | 200  | 14    | 14          |

**Verdict:** PASS -- all roles can see announcements. Note: `my_acknowledged` field is per-user for acknowledgement tracking.

---

### 8. GET /api/v1/tasks/my

**Response shape:** bare JSON array `[...]` (NOT wrapped in `{items:[...]}`)  
**Item keys:** id, organisation_id, location_id, created_by, template_id, source_type, source_submission_id, source_field_id, title, description, priority, status, due_at, completed_at, recurrence, cron_expression, created_at, updated_at, is_deleted, cap_item_id, locations, task_assignees, task_messages, unread_message_count

| Role         | HTTP | Items | Notes |
|--------------|------|-------|-------|
| super_admin  | 200  | 0     | No tasks assigned |
| admin        | 200  | 0     | No tasks assigned |
| manager      | 200  | 0     | No tasks assigned |
| staff        | 200  | 9     | Mix of in_progress and pending |

**Verdict:** PASS -- correctly returns only tasks assigned to the authenticated user.

**NOTE (inconsistency):** Returns bare list, not `{items: [...]}`. Same as leaderboards.

---

### 9. GET /api/v1/gamification/badges/my

**Response shape:** bare JSON array `[...]`

| Role         | HTTP | Items |
|--------------|------|-------|
| super_admin  | 200  | 0     |
| admin        | 200  | 0     |
| manager      | 200  | 0     |
| staff        | 200  | 0     |

**Verdict:** PASS (no badges earned yet in seed data, but endpoint responds correctly).

---

## No-Auth Tests (Missing Authorization Header)

All endpoints correctly reject unauthenticated requests.

| Endpoint                               | HTTP | Response |
|----------------------------------------|------|----------|
| GET /shifts/my                         | 401  | `{success: false, message: "Authentication required", errors: []}` |
| GET /notifications?is_read=false&limit=5 | 401  | `{success: false, message: "Authentication required", errors: []}` |
| GET /notifications/unread-count        | 401  | `{success: false, message: "Authentication required", errors: []}` |
| GET /ai/dashboard-insights             | 401  | `{success: false, message: "Authentication required", errors: []}` |
| GET /gamification/leaderboards         | 401  | `{success: false, message: "Authentication required", errors: []}` |
| GET /gamification/points/my            | 401  | `{success: false, message: "Authentication required", errors: []}` |
| GET /announcements/                    | 401  | `{success: false, message: "Authentication required", errors: []}` |
| GET /tasks/my                          | 401  | `{success: false, message: "Authentication required", errors: []}` |
| GET /gamification/badges/my            | 401  | `{success: false, message: "Authentication required", errors: []}` |

**Verdict:** PASS -- consistent 401 responses with uniform error shape.

---

## Edge Case: POST /api/v1/shifts/attendance/clock-in Without Body

| Role         | HTTP | Response |
|--------------|------|----------|
| super_admin  | 422  | `{detail: [{type: "missing", loc: ["body"], msg: "Field required", input: null}]}` |
| admin        | 422  | `{detail: [{type: "missing", loc: ["body"], msg: "Field required", input: null}]}` |
| manager      | 422  | `{detail: [{type: "missing", loc: ["body"], msg: "Field required", input: null}]}` |
| staff        | 422  | `{detail: [{type: "missing", loc: ["body"], msg: "Field required", input: null}]}` |
| no_auth      | 401  | `{success: false, message: "Authentication required", errors: []}` |

**Verdict:** PASS -- returns 422 with clear validation error when body missing; returns 401 when not authenticated (auth checked before body validation).

---

## Summary

### Overall: 9/9 endpoints PASS, all edge cases PASS

### Response Shape Consistency Report

| Shape                              | Endpoints                                      |
|------------------------------------|-------------------------------------------------|
| `{items: [...], total_count}`      | /shifts/my, /announcements/                     |
| `{items: [...], total, page, limit}` | /notifications                                |
| `{count: N}`                       | /notifications/unread-count                     |
| `{brief, insights, cached_at, role_level}` | /ai/dashboard-insights                |
| `{total_points, ...stats}`         | /gamification/points/my (single object)         |
| bare `[...]` array                 | /gamification/leaderboards, /tasks/my, /gamification/badges/my |

### Issues Found

1. **INCONSISTENT RESPONSE SHAPES** -- Three endpoints return bare arrays (`/tasks/my`, `/gamification/leaderboards`, `/gamification/badges/my`) while most others wrap results in `{items: [...]}`. The mobile app's API client must handle both patterns. Consider standardizing to `{items: [...]}` across all list endpoints.

2. **PAGINATION FIELD INCONSISTENCY** -- `/shifts/my` and `/announcements/` use `total_count`, while `/notifications` uses `total`. Both are paginated but use different field names.

3. **NO BADGES IN SEED DATA** -- `/gamification/badges/my` returns empty for all roles. Cannot verify badge object shape until badges are earned.

4. **ROLE LEVEL MAPPING** -- AI insights maps both `super_admin` and `admin` roles to `role_level: "admin"`. This is correct behavior but worth noting for the mobile app to not expect a "super_admin" role_level.

### Data Isolation Verification

- `/shifts/my` -- correctly scoped per user (staff sees 2, manager sees 1, admins see 0)
- `/tasks/my` -- correctly scoped per user (only staff has assigned tasks)
- `/notifications` -- correctly scoped per user (different counts per role)
- `/gamification/points/my` -- correctly scoped per user (different point totals)
- `/announcements/` -- org-scoped, all roles see same 14 (correct for broadcast)
- `/gamification/leaderboards` -- org-scoped, all roles see same 4 configs (correct)

### Test Count

- **36** authenticated endpoint+role combinations tested
- **9** no-auth rejection tests
- **5** clock-in edge case tests (4 roles + no-auth)
- **Total: 50 test cases, 50 passed, 0 failed**
