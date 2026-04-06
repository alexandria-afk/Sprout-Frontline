# Session Log — Mobile Dashboard Build & QA

**Dates:** 2026-04-01 through 2026-04-05  
**Scope:** Flutter mobile app — dashboard home screen rebuild, QA, gap closure  
**Commits:** `84d7392`, `511a206`, plus uncommitted fixes from 04-05 session

---

## What We Built

### 1. Dashboard Home Screen — Full Rebuild
Rewrote `dashboard_screen.dart` from scratch with role-aware layout:

**Staff view (top to bottom):**
- Greeting header
- 4 stat cards: Overdue Items, Open Tasks, Courses to Complete, Shifts This Week
- My Shift (next upcoming, with Clock In / Start Break / Clock Out buttons + GPS)
- My To-Do List (from `GET /api/v1/inbox` — tasks, forms, workflows, courses, announcements, issues)
- Leaderboard (top 5 + current user's row if outside top 5)
- Latest Announcements (3 most recent with preview)

**Manager/Admin view adds:**
- Different stat cards: Checklist Completion % (today), Audit Compliance % (30-day rolling), Training Completion %, Shifts Today
- AI Insight cards (stacked, swipe-to-dismiss, count badge)
- Team Attendance card (3 animated progress rings: Present/On Time/Utilization %)
  - Manager: "MY TEAM TODAY" + not-clocked-in list
  - Admin: "ATTENDANCE TODAY" + per-location table

### 2. AI Insights Feature (new)
- `features/ai_insights/` — model, repository, provider
- Calls `GET /api/v1/ai/dashboard-insights` with 60s timeout (Claude AI call)
- Hive cache scoped by user ID with daily expiry
- Dismiss tracking persisted in Hive, scoped by user ID, cleared daily
- Stacked card UI: front card visible, 1-2 peek cards behind, "1/3" badge, swipe right to dismiss
- Hidden for staff per CLAUDE.md role rules

### 3. Notifications Feature (new)
- `features/notifications/` — model, repository, provider
- Dashboard card: "MY TO-DO LIST" powered by `GET /api/v1/inbox` (status-based, not event-based)
- Full list screen at `/notifications` with All/Unread filter tabs, swipe-to-dismiss, mark-all-read
- Unread count badge on Home tab in bottom nav
- Icons/colors match web exactly (task=green checkbox, form=amber clipboard, etc.)

### 4. Team Attendance Card (new)
- 3 circular progress rings with animated fill (0.6s ease-out)
- Color thresholds: green/yellow/red per spec
- Manager view: rings + not-clocked-in staff list
- Admin view: rings + per-location table rows (tappable)
- Models: `AttendanceData`, `LocationAttendance`, `MissingStaff`

### 5. Sidekick AI Chat — Wired Up
- Dashboard Sidekick: full chat with `POST /api/v1/ai/chat`, message bubbles, typing indicator, suggestion chips, reset
- Global Sidekick (FAB on all screens): same implementation in `app_router.dart`

### 6. QA — 30 Issues Found, 24 Fixed
- 50 API acceptance tests (all pass, 4 roles x 9 endpoints + edge cases)
- Full code review across 14 files
- See `mobile/QA_TEST_CASES.md` for complete tracker

---

## Key Decisions & Rationale

| Decision | Rationale |
|---|---|
| Shift times displayed without `.toLocal()` | Backend stores shifts as "fake UTC" — `13:00+00:00` means 1 PM local. Attendance timestamps ARE real UTC and DO get `.toLocal()`. Two different formatting approaches needed. |
| Dashboard summary fetched with `?from=today&to=today` | Web does this. Without date filter, mobile was showing all-time completion rate (76%) vs today's rate (0%). |
| Audit compliance uses separate 30-day rolling call | Web makes two `/dashboard/summary` calls: one for today (checklist), one for 30 days (audit). Mobile now matches. |
| Hive caches cleared on sign-out | Prevented data leaking between user accounts. Staff was seeing admin's cached shifts and insights. |
| AI insights cache keyed by user ID | Manager and admin get different AI-generated insights (location-scoped vs org-wide). Cache must not cross-contaminate. |
| To-Do List powered by `GET /api/v1/inbox` (not notifications) | Per handoff note: to-do list is status-based ("what still needs doing") vs notifications which are event-based ("what happened"). Two distinct concepts. |
| `.cast<Map<String,dynamic>>()` replaced everywhere | Dio returns `Map<dynamic, dynamic>`. The `.cast` call throws `TypeError` at runtime. Replaced with `Map<String, dynamic>.from(e as Map)` across 9+ files. |
| `NSAllowsArbitraryLoads` removed, `NSExceptionDomains` for localhost added | Global ATS disable would cause App Store rejection. Per-domain exception for localhost is dev-safe and prod-safe. |
| Stat cards differ by role | Staff sees personal metrics (overdue, open tasks). Manager/admin sees operational KPIs (checklist %, audit %, training %, shifts today) matching web. |
| Insight cards stacked (not listed vertically) | User requested cards "stacked behind each other" with count badge, matching a notification-card pattern. Swipe reveals next card. |

---

## Open Issues (6 remaining)

| ID | Issue | Priority |
|----|-------|----------|
| H-9 | `userRoleProvider` reads stale JWT — role changes don't reflect until re-login | Deferred per user request |
| M-2 | No tap feedback (InkWell) on interactive elements | UX polish — needs Material wrapping |
| M-3 | Hive boxes typed as raw `Map<dynamic, dynamic>` | Phase 1 shortcut, needs TypeAdapters |
| M-4 | Pull-to-refresh fires 7+ parallel calls, no debounce | Low risk, cosmetic |
| A-1 | Backend response shapes inconsistent (bare `[]` vs `{items:[]}`) | Backend fix |
| A-2 | Pagination field naming (`total_count` vs `total`) | Backend fix |

---

## Open Gaps (from GAP_ANALYSIS.md)

| Feature | Spec | Priority |
|---------|------|----------|
| Push notifications (FCM) | NOTIFICATION_SPEC.md Part 2 | Medium |
| Push notification settings screen | NOTIFICATION_SPEC.md Part 9 | Medium |
| Dark theme toggle | MOBILE_DESIGN.md | Low |
| Card press scale 0.98 animation | MOBILE_DESIGN.md | Low |

---

## Files Changed (this session)

**New features (created):**
- `features/ai_insights/` (3 files: model, repo, provider)
- `features/notifications/` (5 files: model, inbox_models, repo, provider, screen)
- `mobile/QA_TEST_CASES.md`, `QA_API_TEST_RESULTS.md`, `QA_CODE_REVIEW.md`, `GAP_ANALYSIS.md`

**Major rewrites:**
- `dashboard/presentation/screens/dashboard_screen.dart` — complete rebuild (~1800 lines)
- `core/router/app_router.dart` — notifications route, unread badge, global Sidekick wired

**Bug fixes across:**
- 9 repository files (`.cast` crash fix)
- 5 model files (`.cast` crash fix)
- `ios/Runner/Info.plist` (ATS, location permission)
- `core/offline/hive_service.dart` (shifts cache box, clearUserCaches)
- `features/auth/providers/auth_provider.dart` (clear caches on sign-out)
- `features/shifts/providers/shifts_provider.dart` (AsyncNotifier for attendance, dedicated cache, daily expiry)
- `features/dashboard/data/repositories/dashboard_repository.dart` (today filter, audit 30-day, training, shifts-today)
- `features/dashboard/providers/dashboard_provider.dart` (audit, training, shifts-today providers)
- `features/dashboard/data/models/dashboard_summary.dart` (attendance models, tasksPending clamp)

---

## Next Logical Steps

1. **Commit the 04-05 session changes** — there are uncommitted fixes (role-aware stat cards, stacked insight cards, cache scoping, shift time fix, to-do list wiring, attendance ring font, ATS localhost exception, inbox_models routing updates, notifications_screen kind meta updates)

2. **Push notifications (FCM)** — add `firebase_messaging` package, FCM token registration on login (`PUT /fcm-token`), handle incoming push messages, deep-link to source entity

3. **Push notification settings screen** — 3 Hive-backed toggles (task assignments, form assignments, scheduled reminders) accessible from More menu

4. **Verify mobile home screen card wiring** — the dashboard inbox card uses `todoItemsProvider` now, but should verify it shows the correct items for each role by testing all 4 accounts

5. **M-2: Tap feedback** — wrap all `GestureDetector` instances with `Material` + `InkWell` for ripple effect across the dashboard
