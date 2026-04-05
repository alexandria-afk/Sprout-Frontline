# Mobile Gap Analysis — Spec vs Built

**Date:** 2026-04-05
**Compared against:** ALLOWED_VALUES.md, ARCHITECTURE.md, CLAUDE.md, TEAM_ATTENDANCE_SPEC.md, MOBILE_DESIGN.md, NOTIFICATION_SPEC.md, AI_DAILY_BRIEF_SPEC.md

---

## Dashboard Home Screen (MOBILE_DESIGN.md + user spec)

| Section | Spec | Built | Gap |
|---------|------|-------|-----|
| Greeting header | Greeting + profile avatar | Yes | None |
| 2x2 Metric cards | Overdue, Open Issues, Courses, Shifts | Yes (renamed Open Tasks) | **MOBILE_DESIGN.md says "Open Issues" but we count tasks — should either rename back or add real issue count** |
| AI Insight cards | Below metrics, manager+, dismissable, swipe right | Yes | None |
| My Shift | Next shift + Clock In/Out + GPS | Yes | None |
| Inbox (notifications) | GET /notifications?is_read=false&limit=5 | Yes | None |
| Leaderboard | Top 5 + user highlight | Yes | None |
| Announcements | Latest 3 with preview | Yes | None |

### Dashboard gaps: NONE (all 7 sections built)

---

## TEAM_ATTENDANCE_SPEC.md — NOT BUILT

| Feature | Spec | Built | Gap |
|---------|------|-------|-----|
| Manager "MY TEAM TODAY" card | 3 circular progress rings (Present %, On Time %, Utilization %) | **NO** | **Full feature missing** |
| Ring animation | 0 to value over 0.6s ease-out | **NO** | Missing |
| Not clocked in list | Names + shift start time for missing staff | **NO** | Missing |
| Admin "ATTENDANCE TODAY" card | 3 rings + per-location table with rates | **NO** | Missing |
| Per-location rows | Name, clocked/scheduled, %, status note, tappable | **NO** | Missing |
| Backend data | `attendance` object in dashboard summary response | **NO** | Backend endpoint exists but mobile doesn't consume it |
| Role gating | Manager: their locations only. Admin: all. Staff: hidden. | **NO** | Missing |

**Priority: HIGH** — This is a full dashboard card specified in its own doc that hasn't been built on mobile.

---

## NOTIFICATION_SPEC.md — Partially Built

| Feature | Spec | Built | Gap |
|---------|------|-------|-----|
| Inbox card on dashboard | Latest 5 unread notifications | Yes | None |
| Tap → navigate to entity | Each notification type maps to route | Yes | None |
| Mark as read on tap | POST /notifications/{id}/read | Yes | None |
| "View all" link | Navigate to full notification list | **Partial** | **Route exists but no full notifications list screen** |
| Full notification list screen | Scrollable list, pull to refresh, swipe to dismiss, filter tabs (All/Unread) | **NO** | **Screen not built** |
| Unread badge on Home tab | Badge count on bottom nav Home icon | **NO** | **Not implemented in app shell** |
| Push notifications (FCM) | OS-level banners for task_assigned, form_assigned, scheduled_reminder | **NO** | **No Firebase Messaging integration** |
| Push notification settings screen | 3 toggles (tasks, forms, reminders) stored in Hive | **NO** | **Settings screen not built** |
| FCM token registration | PUT /fcm-token on login | **NO** | **Not implemented** |

**Priority: MEDIUM-HIGH** — Inbox works but push notifications and the full list screen are missing.

---

## AI_DAILY_BRIEF_SPEC.md — Mostly Built

| Feature | Spec | Built | Gap |
|---------|------|-------|-----|
| AI Insight cards on mobile | Below stat cards, dismissable | Yes | None |
| Severity indicators | Red/Orange/Blue with emoji | Yes | None |
| Swipe right to dismiss | Dismissible widget | Yes | None |
| Dismissed IDs stored in Hive daily | Cleared each day | Yes | None |
| Only show when insights exist | SizedBox.shrink when empty | Yes | None |
| Brief text NOT shown on mobile | Cards only | Yes | None |
| Role filtering | Staff: personal, Manager: location, Admin: all | Yes (backend handles) | None |
| Manager+ only on mobile | Hidden for staff | Yes | None |

**Priority: NONE** — Fully implemented.

---

## MOBILE_DESIGN.md — Mostly Built

| Feature | Spec | Built | Gap |
|---------|------|-------|-----|
| Color palette (light theme) | All tokens defined | Yes (_C class) | **L-4: Private class, not shared** (deferred) |
| Dark theme | User toggle | **NO** | **Not implemented** |
| Typography | System fonts, sizes defined | Mostly | Minor deviations possible |
| Home screen layout | Metrics + Inbox + Shift | Yes (expanded with more sections) | None |
| Bottom nav (5 tabs) | Home, Tasks, Issues, Shifts, More | Yes | None |
| More menu | Forms, Training, Announcements, Badges | Yes | None |
| Sidekick FAB | Purple FAB on all screens, opens chat sheet | Yes (wired to API) | None |
| Filter pills pattern | Horizontal scroll, active/inactive styling | Yes (on Tasks, Issues, Forms, Training) | None |
| Announcements social feed | Avatar, creator, media gallery, acknowledge | Yes | None |
| Issue reporting AI-assisted | Title + desc, "Analyze with AI", suggestion card | Yes | None |
| Card layering (surface-1/2) | Outer card surface-1, inner rows surface-2 | Yes | None |
| Skeleton loading | On home screen | Yes (with shimmer animation) | None |
| Error screens with back button | Never trap the user | Yes | None |
| Spacing (16px edge, 12px gap, etc.) | Defined specs | Yes | None |
| Animation | Swipe dismiss, bottom sheet slide, page transitions | Partial | **No card press scale 0.98 animation** |
| Accessibility | 44px touch targets, contrast, color+icon paired | Partial | **M-2: Still missing InkWell tap feedback** |

---

## CLAUDE.md — Role Enforcement

| Rule | Built | Gap |
|------|-------|-----|
| Staff can only view/complete own tasks | Yes (API-scoped) | None |
| Staff can report issues | Yes | None |
| Staff can view own shifts, clock in/out, claim open | Yes | None |
| Staff can take training courses | Yes | None |
| Staff can view announcements + acknowledge | Yes | None |
| Staff can view own badges/points | Yes | None |
| Staff can use AI chat | Yes (Sidekick) | None |
| Staff CANNOT see: other people's tasks | Yes (API-scoped) | None |
| Staff CANNOT see: team/attendance views | Yes (route guarded) | None |
| Staff CANNOT see: approval screens | Yes (route guarded) | None |
| Staff CANNOT see: user management | N/A (not built on mobile) | None |
| Staff CANNOT see: settings/admin pages | N/A (not built on mobile) | None |
| Staff CANNOT see: analytics/reports/insights | Yes (AI insights hidden for staff) | None |
| Manager can view team tasks/issues/attendance | Yes (Team screen) | None |
| Manager can approve (workflow, swap, leave, claims) | Yes (Approvals screen) | None |
| Manager can assign tasks and forms | Yes (Create Task, no Create Form Assignment) | **Minor: No form assignment creation on mobile** |
| Manager can run audits | Yes (Audit fill screen) | None |
| Manager can create announcements | Yes | None |

---

## ALLOWED_VALUES.md — Validation

| Area | Spec | Built | Gap |
|------|------|-------|-----|
| Task priorities (low/medium/high/critical) | Must use these values | Yes (in models) | None |
| Task statuses (open/in_progress/completed/blocked/cancelled) | Must use these values | Yes | None |
| Issue statuses | open/in_progress/pending_vendor/resolved/verified_closed | Yes (filter pills) | None |
| Form field types | text/number/date/select/multi_select/photo/signature/toggle/textarea/time/location | Yes (form_fill_screen) | None |
| Shift statuses | draft/published/open/cancelled | Yes (model) | None |
| Attendance statuses | present/late/early_departure/absent/unverified | Yes (model) | None |

---

## ARCHITECTURE.md — Mobile Routes

| Route | Spec | Built | Gap |
|-------|------|-------|-----|
| /dashboard | Home | Yes | None |
| /tasks | My Tasks | Yes | None |
| /tasks/:id | Task Detail | Yes | None |
| /tasks/create | Create Task (manager) | Yes | None |
| /issues | My Issues | Yes | None |
| /issues/:id | Issue Detail | Yes | None |
| /issues/report | Report Issue | Yes | None |
| /shifts | My Shifts | Yes | None |
| /forms | Forms & Checklists | Yes | None |
| /forms/fill/:id | Form Fill | Yes | None |
| /training | My Training | Yes | None |
| /training/:id | Course Player | Yes | None |
| /announcements | Announcements | Yes | None |
| /announcements/create | Create Announcement (manager) | Yes | None |
| /badges | Badges & Points | Yes | None |
| /approvals | Approvals (manager) | Yes | None |
| /team | Team View (manager) | Yes | None |
| /audits | Audit Templates | Yes | None |
| /audits/fill/:id | Audit Fill | Yes | None |
| /notifications | **Full notification list** | **NO** | **Screen not built** |
| /settings | **Push notification settings** | **NO** | **Screen not built** |

---

## Summary — Gap Priority

### Must Build (HIGH) — ALL DONE

| # | Feature | Source Spec | Status |
|---|---------|-----------|--------|
| 1 | **Team Attendance dashboard card** (3 rings + not-clocked-in list + per-location table) | TEAM_ATTENDANCE_SPEC.md | **BUILT** — animated rings, manager/admin views, ring color thresholds |
| 2 | **Full notifications list screen** (/notifications route) | NOTIFICATION_SPEC.md Part 6 | **BUILT** — All/Unread filter, swipe dismiss, mark all read, pull to refresh |
| 3 | **Unread badge on Home tab** in bottom nav | NOTIFICATION_SPEC.md Part 6 | **BUILT** — Badge on Home tab from unreadCountProvider |

### Should Build (MEDIUM)

| # | Feature | Source Spec | Status |
|---|---------|-----------|--------|
| 4 | **Push notification setup** (FCM token registration, firebase_messaging package) | NOTIFICATION_SPEC.md Part 2 | OPEN |
| 5 | **Push notification settings screen** (3 toggles in Hive) | NOTIFICATION_SPEC.md Part 9 | OPEN |
| 6 | **Sidekick AI in app shell** (currently wired in dashboard only, spec says FAB on ALL screens) | MOBILE_DESIGN.md | **BUILT** — Global Sidekick wired to POST /api/v1/ai/chat |

### Nice to Have (LOW)

| # | Feature | Source Spec | Effort |
|---|---------|-----------|--------|
| 7 | Dark theme toggle | MOBILE_DESIGN.md | Medium |
| 8 | Card press scale 0.98 animation | MOBILE_DESIGN.md Animation | Small |
| 9 | Form assignment creation on mobile (manager) | CLAUDE.md roles | Medium |
| 10 | InkWell tap feedback on all interactive elements | MOBILE_DESIGN.md Accessibility | Medium |

---

## What's Fully Complete (no gaps)

- Dashboard layout (all 7 sections)
- AI Daily Brief / Insight cards
- Task management (CRUD + detail + comments)
- Issue tracking (report + detail + AI classification)
- Forms / Checklists (dynamic rendering + conditional logic)
- Announcements (social feed + create + acknowledge)
- Training (courses + player + quizzes)
- Audits (templates + fill + results)
- Shifts (my shifts + open shifts + clock in/out + claim)
- Badges & Leaderboard
- Approvals (workflows + swaps + claims + leave)
- Team view (on shift + clocked in)
- Sidekick AI chat (wired to POST /api/v1/ai/chat)
- Offline support (Hive cache + sync service)
- Role enforcement (all CLAUDE.md rules enforced)
- All ALLOWED_VALUES.md enums used correctly
- All 19/20 ARCHITECTURE.md routes implemented
