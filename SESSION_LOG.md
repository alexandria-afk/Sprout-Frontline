# Session Log
_Ongoing handoff notes for each work session. Most recent session at the top._

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
