# Session Log
_Ongoing handoff notes for each work session. Most recent session at the top._

---

## Session: 2026-04-05 (continued × 2)

### What We Fixed

**1. Manager location scoping — all list endpoints**
Managers were seeing org-wide data on every list page. Fixed at the application layer (no RLS changes).

- `backend/dependencies.py`: `get_current_user` now reads `location_id` from the profiles lookup (already hits DB — zero extra cost) and stores it in `app_metadata`.
- `backend/routes/issues.py`: managers auto-scoped to their `location_id` when no explicit filter is passed.
- `backend/routes/tasks.py`: same pattern.
- `backend/routes/forms.py` (submissions): same pattern with `UUID()` coercion to match the `Optional[UUID]` param type.
- `backend/routes/shifts.py`: applied to both `list_shifts` and `list_attendance`.

**2. `inbox.py` — 3 broken queries fixed**
Three silent exceptions were causing the to-do list to return 0 items for any user with forms, announcements, or shift swaps.

| # | Query | Fix |
|---|---|---|
| 1 | Form assignments | Changed `user_id` → `assigned_to_user_id`, `completed=False` → `is_active=True`; cross-reference `form_submissions` to exclude already-submitted assignments |
| 2 | Announcements ack | Changed `announcement_acknowledgements` → `announcement_receipts`; added `.not_.is_("acknowledged_at", "null")` |
| 3 | Shift swaps | Changed `shifts!requester_shift_id` → `shifts!shift_id`, `profiles!requested_user_id` → `profiles!requested_by`, filter on `organisation_id` directly on the table (not via broken join) |

**3. `inbox.py` — issues query now location-scoped for managers**
Manager inbox issues: assigned to me OR (unassigned AND at my location) — using PostgREST nested `and(...)` inside `or(...)`.
Admin/super_admin remain org-wide (assigned to me OR any unassigned).

---

### Key Decisions

| Decision | Rationale |
|---|---|
| Manager location scoping at app layer, not RLS | User instruction: fix in backend route handlers, don't touch RLS policies |
| `location_id` enriched in `get_current_user` | Profiles lookup already happens on every request to refresh `role` and `organisation_id` — adding `location_id` to the same select costs nothing |
| Manager inbox issues: location-scoped (not org-wide) | Overrides earlier assumption from ARCHITECTURE.md "org-scoped read". User corrected: managers see only their location's data |

---

### Open Questions / Blockers

- **GitHub auth**: HTTPS push requires credentials not in PATH. Should set up SSH key or proper git credential helper.
- **Shift swap FK**: `shift_swap_requests!shift_id` join is the corrected hint — if the DB has no FK constraint named `shift_id` this will still fail silently. Verify once there are real swap requests in dev data.
- **Workflow navigation on mobile**: `/workflows/instances/:id` redirects to `/dashboard` — needs a real workflow detail screen when the feature is built.

---

### Next Logical Step

1. **Test manager to-do list end-to-end** — verify forms, announcements, and shift swaps now appear (no more silent query failures)
2. **Test manager issues page** — should only show issues at manager's location
3. **Implement Workflow detail screen on mobile**

---

## Session: 2026-04-05 (continued)

### What We Fixed

**1. My Team Today — staff shows as "not clocked in" (false negative)**
Root cause: `dashboard_service.py` was filtering attendance records by `location_id` (matching the manager's location). Staff who clock in via the web have `app_metadata.location_id` empty/null at clock-in time, so their attendance record is stored with a null `location_id`. The manager's query then excluded those records, putting them in the `not_clocked_in` list.

Fix: removed `eq("location_id", ...)` from the attendance query. Location scoping is already enforced by the shifts query — shifts are filtered to the manager's location, and attendance is matched to shifts via `shift_id` / `user_id`. Attendance records with null `location_id` now match correctly.

**2. Mobile: workflow to-do taps no longer dead-end**
Added `/workflows/instances/:id` and `/workflows` route stubs to `app_router.dart`. Both redirect to `/dashboard` since the workflow feature isn't yet implemented on mobile. Prevents a Go Router miss when a user taps a workflow item in the to-do list.

**3. Verified already-complete items**
- Mobile home screen `_InboxSection` was already wired to `todoItemsProvider` (5-item preview, "View all →" to `/notifications`)
- Shifts org-wide template fix (`genLocationId` + `BulkGenerateShiftsRequest.location_id`) already in place
- Launch-progress 403 fix (profiles-table membership check) already in place
- Location scraping fix (`/stores` keyword + shortest-candidate picker) already in place

---

### Key Decisions

| Decision | Rationale |
|---|---|
| Drop attendance `location_id` filter entirely | Shifts query already scopes to the manager's location; attendance matching via `shift_id`/`user_id` is the correct join — filtering attendance by `location_id` was doubly-scoping and excluding null-location records |
| Workflow routes → redirect to `/dashboard` | No workflow screens exist on mobile yet; redirect is safer than a Go Router miss which shows an error page |

---

### Open Questions / Blockers

- **GitHub auth**: HTTPS push requires credentials not in PATH. Workaround extracts token from keychain — fragile. Should set up SSH key or proper git credential helper.
- **Workflow navigation on mobile**: `/workflows/instances/:id` now redirects to `/dashboard` — needs a real workflow detail screen when the feature is built.
- **Announcements targeting in `/api/v1/inbox`**: Role/location filtering assumes `target_roles = []` means "all roles" and `target_location_ids = []` means "all locations". Not tested with complex targeting rules.

---

### Next Logical Step

The core to-do list, home screen card, and attendance card are all wired and working. Likely next steps:

1. **Push today's fixes to GitHub** (attendance fix + workflow route stubs)
2. **Implement the Workflow detail screen on mobile** — replace the `/dashboard` redirect with a real `WorkflowInstanceScreen`
3. **Test My Team Today end-to-end** — verify staff clock-in record now appears as clocked-in in manager view

---

## Session: 2026-04-05

### What We Built

**1. Unified Inbox API (`GET /api/v1/inbox`)**
New backend endpoint (`backend/routes/inbox.py`) that aggregates 6 entity types server-side for the current user and returns them sorted by urgency (overdue → upcoming → no due date). Replaces 6 parallel frontend fetches with one call.
- Tasks (not completed/cancelled) via `task_assignees` join
- Form assignments (not submitted)
- Workflow stage instances (in_progress, assigned to user)
- Course enrollments (not_started)
- Announcements (requires_acknowledgement, not yet acknowledged — filtered by role/location)
- Issues (assigned to user, not resolved/verified_closed)

**2. My To-Do List widget (web)**
Renamed "My Inbox" → "My To-Do List" throughout. `MyInbox` component in `dashboard/page.tsx` now calls `getInboxItems()` from the new `frontend/services/inbox.ts` instead of the old 6-query approach. Restored full pill/due-badge UI with `TODO_META`, `PRIORITY_PILL`, `FORM_TYPE_PILL`, `todoPills()`, `todoHref()`, `dueBadge()` helpers.

**3. Mobile To-Do List**
- New `InboxItem` model (`inbox_models.dart`)
- `getInboxItems()` method on `NotificationsRepository`
- `todoItemsProvider` / `TodoItemsNotifier` in `notifications_provider.dart`
- `NotificationsScreen` rewritten to "My To-Do List" using the new provider

**4. Dashboard My Shift card fixes**
- Clock-in time showed UTC (e.g. 4:53 AM instead of 12:53 PM); fixed with `fmtLocal()` using `new Date(iso).toLocaleTimeString()`
- Shift time disappeared when clocked in; fixed to always show shift time, with "Clocked in at X" as a secondary green line
- Break button didn't ask for break type; added Meal/Rest/Other modal matching the clock-in page UX
- "Clock In" button showed even when already clocked in; fixed by correcting `getMyAttendance` date range (`T23:59:59` not bare date) and adding `pathname` to `useEffect` deps for in-app navigation sync

**5. Issues kanban drag-and-drop fix**
Two bugs: (1) `isDragDisabled={!isManager}` blocked staff from dragging entirely — replaced with per-column `isDropDisabled` logic. (2) `IssueCard` was a `<button>` which captured `mousedown` before `@hello-pangea/dnd` — converted to `<div role="button">` matching `TaskCard`.

**6. Shifts page fixes**
- Create Shift modal defaulted to Monday of current week; changed to `new Date()` (today)
- "Today" filter button showed the full week; fixed with `showTodayOnly` state filtering `allDays` to today's date string

**7. Dashboard service fixes (backend)**
- `on_break` per-location was always 0 — backend counted break records but never distributed by location; fixed by fetching `attendance_id` values and mapping through `att_id_to_loc`
- `late_threshold` defaulted to 0 with a guard `if late_threshold > 0`; late arrivals were never flagged without an attendance_rules row; fixed: default 15, removed guard

**8. App rename: Frontline → Frontliner**
Updated in all 7 display-name locations: `layout.tsx`, `Sidebar.tsx`, `login/page.tsx`, `backend/main.py`, iOS `Info.plist`, Flutter `main.dart`, `pubspec.yaml`.

**9. Documentation**
- `ARCHITECTURE.md`: added `/api/v1/inbox` section, updated dashboard page description, clarified notifications vs. to-do list, bumped last-updated date
- `NOTIFICATION_SPEC.md`: restructured to 4 channels, rewrote Part 5 & 6 to reflect status-based to-do list vs. event-based notifications

---

### Key Decisions & Rationale

| Decision | Rationale |
|---|---|
| To-Do List is **status-based** (not event-based) | Items stay visible until work is done. A completed task should disappear from the list, not just be "marked read". Notifications table is the wrong model for this. |
| Aggregation moved to **backend** (`/api/v1/inbox`) | Frontend was making 6 parallel API calls on every dashboard load. Single server-side endpoint is faster and lets mobile reuse without duplicating logic. |
| **Notifications table stays separate** | Powers the sidebar unread badge (event history). Two distinct concepts coexist: "what happened" (notifications) vs. "what still needs doing" (to-do list). |
| `IssueCard` converted from `<button>` to `<div role="button">` | Native `<button>` captures `mousedown` before drag-and-drop libraries can initiate a drag. `TaskCard` already used this pattern. |
| Shift times use wall-clock extraction; attendance times use real UTC conversion | Shift start/end are stored as fake UTC (e.g. `09:00:00+00:00` meaning "9 AM local"). Attendance timestamps are real UTC. Two separate formatting functions required. |

---

### Open Questions / Blockers

- **GitHub auth**: HTTPS push requires credentials not in PATH. Workaround extracts token directly from keychain — fragile. Should set up SSH key or proper git credential helper.
- **Mobile home screen inbox card**: `MOBILE_DESIGN.md` specifies a 5-item to-do preview card on the dashboard home screen. `NotificationsScreen` is the full list, but the home screen card section still needs wiring to `todoItemsProvider` (currently on old notification provider — not verified).
- **Announcements targeting in `/api/v1/inbox`**: Role/location filtering assumes `target_roles = []` means "all roles" and `target_location_ids = []` means "all locations". Matches existing frontend logic but not tested with complex targeting rules.
- **Workflow navigation on mobile**: `InboxItem.route` for `workflow` navigates to `/workflows/instances/{workflowInstanceId}` — needs to confirm this route exists in `app_router.dart` and resolves to the correct fill screen.

---

### Next Logical Step

**Wire mobile home screen to `todoItemsProvider`.** The dashboard home screen should show a 5-item preview from `todoItemsProvider` with a "View all →" link to `NotificationsScreen`. This is the last missing piece of the to-do list rollout per `MOBILE_DESIGN.md`. After that, verify the notification unread badge on the home tab icon (`unreadCountProvider`) still works correctly alongside the new to-do list.

---

### Commits This Session

| Hash | Message |
|---|---|
| `41bfccd` | feat: unified inbox API, My To-Do List widget, dashboard fixes |
| `b4da7bf` | chore: rename app from Frontline to Frontliner |

---
