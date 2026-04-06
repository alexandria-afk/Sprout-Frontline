# Session Log — Mobile App Build

---

## Session 1: 2026-04-01 through 2026-04-05

**Scope:** Dashboard home screen rebuild, QA, gap closure  
**Commits:** `84d7392`, `511a206`, `184aa96`

### What We Built

1. **Dashboard Home Screen — Full Rebuild** with role-aware layout
   - Staff: greeting, 4 personal stat cards, My Shift (clock in/out + GPS), My To-Do List, Leaderboard, Announcements
   - Manager/Admin: different stat cards (Checklist %, Audit %, Training %, Shifts Today), AI Insight cards (stacked, swipe-to-dismiss), Team Attendance card (3 animated rings)

2. **AI Insights Feature** — model, repo, provider, Hive cache scoped by user ID, daily expiry, dismiss tracking

3. **Notifications Feature** — model, repo, provider, full list screen at /notifications, unread badge on Home tab

4. **Team Attendance Card** — 3 animated progress rings, manager/admin views, per-location table

5. **Sidekick AI Chat** — wired to POST /api/v1/ai/chat on dashboard + global FAB

6. **QA: 30 issues found, 24 fixed** — .cast crashes, ATS, timezone bugs, role enforcement, cache scoping, accessibility

### Key Decisions
- Shift times = wall-clock (fake UTC), attendance times = real UTC → two formatting approaches
- Dashboard summary fetched with date filters matching web (today for checklist, 30-day for audit)
- Hive caches cleared on sign-out to prevent cross-user data leaks
- To-Do List powered by GET /api/v1/inbox (status-based) not notifications (event-based)

---

## Session 2: 2026-04-05 through 2026-04-06

**Scope:** Web-mobile parity, bug fixes, feature gaps  
**Commits:** `d09df33`

### What We Built

1. **Break Management** (was placeholder)
   - Bottom sheet with 3 break types: Meal, Rest, Other
   - On-break state: "End Break" button + orange elapsed timer
   - Auto-loads break status when clocked in
   - Calls POST /api/v1/shifts/attendance/break/start and /end

2. **Leave Requests** (new)
   - "Leave" tab in shifts screen (all roles)
   - Request form: leave type dropdown (annual/sick/emergency/unpaid/other), start/end date pickers, optional reason
   - List with status badges (pending/approved/rejected)
   - Calls POST /api/v1/shifts/leave

3. **Shift Swap Requests** (new)
   - "Swaps" tab in shifts screen (all roles)
   - Create swap by selecting upcoming shift
   - Cancel support

4. **Shift Swap Colleague Response** (new)
   - Incoming swap detection (current user is target + pending_peer)
   - Accept/Decline buttons on incoming swap cards
   - Calls PUT /api/v1/shifts/swaps/{id}/colleague-response
   - Success feedback via snackbar

5. **Role Provider Fix** (critical bug)
   - `userRoleProvider` now watches `authSessionProvider` instead of reading stale Supabase session
   - Fixed: staff seeing manager stat cards, AI insights, and team attendance after switching accounts
   - This was the root cause of multiple reported issues

6. **Dashboard Stat Cards — Role-Aware**
   - Staff: Overdue Items, Open Tasks, Courses to Complete, Shifts This Week
   - Manager/Admin: Checklist Completion % (today), Audit Compliance % (30-day rolling), Training Completion %, Shifts Today
   - Separate API calls matching web: today filter for checklist, 30-day for audit, /lms/analytics/completion for training

7. **AI Insight Cards — Stacked UI**
   - Cards stacked behind each other (not vertical list)
   - 1-2 peek cards behind front card at 50% opacity
   - Count badge "1/3" in upper right
   - Swipe right dismisses front card, reveals next
   - Material icons (Icons.error, Icons.warning_amber, Icons.info_outline) replace broken emoji rendering

8. **Attendance Ring Typography**
   - Number: 20px bold, % symbol: 12px semibold secondary

9. **To-Do List Icons** — matched web exactly (task=green checkbox, form=amber clipboard, course=blue cap, issue=orange triangle)

10. **Settings Back Button** — context.push instead of context.go, explicit back arrow

11. **App Rename** — "Frontline" → "Frontliner" on login screen

### Bug Fixes
| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Staff seeing manager cards + AI insights | `userRoleProvider` cached first session's role forever | Watch `authSessionProvider` for re-evaluation |
| Checklist Completion 76% (should be 0%) | Dashboard summary called without date filter | Added `?from=today&to=today` matching web |
| Audit Compliance using today's data | Single summary call for both metrics | Separate 30-day rolling call for audit |
| Shift time showing wrong (9 PM vs 1 PM) | `.toLocal()` on wall-clock UTC times | Don't convert shift times to local |
| Insight cards showing same for all roles | Hive cache key not scoped by user | Cache key includes user ID |
| "Start Break" was a snackbar placeholder | Not implemented | Full break flow with type selection |
| Settings screen trapped user (no back button) | `context.go` replaced nav stack | `context.push` + explicit back arrow |
| Broken emoji icons on insight cards | iOS rendering issues with 🔴 ⚠️ ℹ️ | Replaced with Material Icons |

### Web-Mobile Parity Status (Staff)

| Feature | Status |
|---------|--------|
| Stat cards | Parity |
| My Shift + clock in/out | Parity |
| Break management (meal/rest/other) | Parity |
| My To-Do List | Parity |
| Leaderboard | Parity |
| Announcements | Parity (3 items vs 6 on web) |
| Tasks list + detail | Parity |
| Issues list + detail + AI classify | Parity (list view vs kanban — by design) |
| Forms + fill + conditional logic | Parity |
| Training + course player | Parity |
| Shifts (my/open/swaps/leave) | Parity |
| Swap colleague response | Parity |
| Badges + leaderboard | Parity |
| Sidekick AI chat | Parity |
| Availability management | **Gap** (web has it, mobile doesn't) |

### Open Items
- Availability management screen (staff can set available days/times)
- Push notifications (FCM integration)
- Push notification settings screen (3 toggles)
- Dark theme toggle
- M-2: InkWell tap feedback on interactive elements
- M-3: Hive boxes typed as raw Map (needs TypeAdapters)
- A-1/A-2: Backend response shape inconsistencies
