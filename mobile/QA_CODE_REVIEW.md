# QA Code Review -- Mobile Flutter Dashboard Rebuild

**Date:** 2026-04-01
**Reviewer:** Claude Code
**Scope:** All new/changed mobile Flutter files for the dashboard rebuild, plus legacy files with known `.cast` bugs.

---

## Summary

- **CRITICAL:** 5 issues (runtime crashes, security, App Store rejection)
- **HIGH:** 9 issues (data correctness, role enforcement gaps, silent failures)
- **MEDIUM:** 8 issues (UX, maintainability, type safety)
- **LOW:** 5 issues (code quality, accessibility)

---

## CRITICAL Issues

### C-1. `.cast<Map<String, dynamic>>()` will crash at runtime on Supabase/Dio responses

**Severity:** CRITICAL
**Affected files and lines:**

| File | Lines |
|------|-------|
| `lib/features/training/data/repositories/training_repository.dart` | 62, 65 |
| `lib/features/forms/data/repositories/forms_repository.dart` | 10 |
| `lib/features/team/data/repositories/team_repository.dart` | 16, 19, 35, 38 |
| `lib/features/approvals/data/repositories/approvals_repository.dart` | 10, 13, 46, 49, 71, 74, 96, 99 |
| `lib/features/audits/data/repositories/audits_repository.dart` | 11 |
| `lib/features/forms/data/models/form_template.dart` | 26, 36 |
| `lib/features/tasks/data/models/task_models.dart` | 111, 114 |
| `lib/features/training/data/models/training_models.dart` | 64, 109, 114, 177 |
| `lib/features/audits/data/models/audit_models.dart` | 41, 73 |

**Description:** Dio parses JSON into `Map<dynamic, dynamic>` (not `Map<String, dynamic>`). Calling `.cast<Map<String, dynamic>>()` on a `List<dynamic>` containing `Map<dynamic, dynamic>` entries throws a `TypeError` at runtime. The corrected repositories (shifts, badges, announcements, notifications, tasks repo, issues repo) already use the safe pattern `Map<String, dynamic>.from(e as Map)`. These files still use the broken `.cast` pattern.

**Fix:** Replace every occurrence of:
```dart
data.cast<Map<String, dynamic>>()
items.cast<Map<String, dynamic>>()
rawList.cast<Map<String, dynamic>>()
```
with:
```dart
data.map((e) => Map<String, dynamic>.from(e as Map)).toList()
```
Or use the `_safeList` / `_unwrapList` helper already defined in shifts_repository.dart and badges_repository.dart.

---

### C-2. Missing `NSLocationWhenInUseUsageDescription` in Info.plist -- App Store rejection

**Severity:** CRITICAL
**File:** `ios/Runner/Info.plist`

**Description:** The dashboard uses `Geolocator` for clock-in/clock-out (line 824 of dashboard_screen.dart calls `Geolocator.requestPermission()`). iOS requires `NSLocationWhenInUseUsageDescription` (and optionally `NSLocationAlwaysUsageDescription`) in Info.plist. Without it, the app will crash on first location request in production and be rejected by App Store review.

**Fix:** Add to Info.plist:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Your location is used to verify clock-in at your assigned work location.</string>
```

---

### C-3. `NSAllowsArbitraryLoads=true` disables App Transport Security globally

**Severity:** CRITICAL
**File:** `ios/Runner/Info.plist` -- lines 7-10

**Description:** `NSAllowsArbitraryLoads` is set to `true`, which allows all HTTP (non-HTTPS) traffic. This is acceptable for local development but must NOT ship to production. Apple will reject or flag this during App Store review unless an exemption is justified.

**Fix:** For production builds, remove `NSAllowsArbitraryLoads` or set to `false`. Keep `NSAllowsLocalNetworking` for dev. Use per-domain exceptions if needed:
```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
    <!-- Remove NSAllowsArbitraryLoads for production -->
</dict>
```
Consider using a separate Info.plist or build configuration for debug vs release.

---

### C-4. `activeAttendanceProvider` is a `StateProvider` -- resets to `null` on app restart

**Severity:** CRITICAL
**File:** `lib/features/shifts/providers/shifts_provider.dart` -- line 66-67

**Description:** `activeAttendanceProvider` is an in-memory `StateProvider<AttendanceRecord?>` initialized to `null`. If the user clocks in and then the app is killed/restarted (or Riverpod scope rebuilds), the state resets to `null`. The user appears "not clocked in" even though they are clocked in on the backend. The Clock Out button disappears. The user cannot clock out without manually calling the API or waiting for the shift to end.

**Fix:** On app launch (or in `MyShiftsNotifier.build()`), fetch the user's active attendance from the backend:
```dart
GET /api/v1/shifts/attendance?status=present&user_id=me
```
Or persist the active attendance to Hive and hydrate on startup.

---

### C-5. `_HomeBody.summary` typed as `dynamic` -- loses all type safety

**Severity:** CRITICAL
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- line 69

**Description:** `_HomeBody` declares `final dynamic summary;` but never actually uses `summary` in the build method. The `dashboardSummaryProvider` returns `DashboardSummary` but the widget ignores it entirely. This means:
1. The dashboard KPI data (tasksOverdue, issuesOpen, formCompletionRate) fetched from the backend is wasted.
2. The metric cards compute overdue/open counts by re-fetching all tasks and enrollments client-side, which is slower and inconsistent with the backend summary.
3. The `dynamic` type means any property access would compile but crash.

**Fix:** Either:
- (a) Use the `DashboardSummary` data for the metric cards instead of re-deriving from raw task lists, or
- (b) Remove `dashboardSummaryProvider` from this screen if the per-task approach is intentional.
At minimum, type it properly: `final DashboardSummary summary;`

---

## HIGH Issues

### H-1. Shift week filter uses local time but compares against UTC strings

**Severity:** HIGH
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- lines 91-98

**Description:** `DateTime.now()` returns local time, and `weekStart`/`weekEnd` are computed in local time. But `s.startAt` from the API is an ISO 8601 UTC string. `DateTime.tryParse()` on a UTC string returns a UTC DateTime. Comparing UTC against local time causes shifts near midnight to be miscounted (off by timezone offset hours). A shift at 11 PM UTC on Sunday would appear as Monday in UTC+8.

**Fix:**
```dart
final dt = DateTime.tryParse(s.startAt)?.toLocal();
```
Or normalize both sides to UTC consistently.

---

### H-2. AI insights accessible to staff via direct provider watch if route is misconfigured

**Severity:** HIGH
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- line 106, line 131

**Description:** The pull-to-refresh on line 106 calls `ref.read(aiInsightsProvider.notifier).refresh()` for ALL users regardless of role. This fires an API call for staff users too (wasting bandwidth and exposing the endpoint). The UI correctly hides AI insights on line 131 with `isManagerOrAboveProvider`, but the data is still fetched. Additionally, if there is an AI insights route elsewhere, staff could navigate to it directly.

**Fix:** Guard the refresh call:
```dart
if (ref.read(isManagerOrAboveProvider)) {
  ref.read(aiInsightsProvider.notifier).refresh();
}
```
Also verify the router guards AI-related routes by role.

---

### H-3. `dismissKey` uses `title.hashCode` -- not stable across Dart VM restarts

**Severity:** HIGH
**File:** `lib/features/ai_insights/data/models/ai_insight_models.dart` -- line 56

**Description:** `String.hashCode` in Dart is NOT guaranteed to be stable across isolates or app restarts. The Dart spec explicitly says hash codes may differ between runs. This means a dismissed insight could reappear after app restart because the key stored in Hive no longer matches.

**Fix:** Use a deterministic hash (e.g., a simple string key):
```dart
String get dismissKey => '${severity}_$title';
```
Or if title could be long, use a proper hash like `sha256` or a slug.

---

### H-4. No error handling on `markRead` in notifications provider -- silent swallow

**Severity:** HIGH
**File:** `lib/features/notifications/providers/notifications_provider.dart` -- lines 29-33

**Description:** `markRead` catches all exceptions with `catch (_) {}` and does nothing. If the network is down, the notification stays unread on the server but the UI removes it from the unread list (because `_load()` is called after). On next refresh, it reappears as unread, confusing the user.

**Fix:** At minimum, show a snackbar or re-add the notification to the list on failure. Consider optimistic update with rollback:
```dart
try {
  await repo.markRead(id);
} catch (e) {
  // Optionally re-fetch to restore correct state
  debugPrint('[Notifications] markRead failed: $e');
}
```

---

### H-5. Shifts cache stored in `formsCache` Hive box -- cross-contamination risk

**Severity:** HIGH
**File:** `lib/features/shifts/providers/shifts_provider.dart` -- lines 40, 51

**Description:** `_fromCache()` and `_toCache()` use `HiveService.formsCache` with key `'shifts_my'`. This works but is fragile -- if someone clears the forms cache to fix a forms bug, shifts data is also lost. The comment on line 40 says "reuse general cache" but this is misleading.

**Fix:** Add a dedicated `shiftsCacheBox` to `HiveService`, or at minimum rename the box to `generalCache` to make the shared usage explicit.

---

### H-6. Shift cache has no date-based expiry -- serves stale shifts indefinitely

**Severity:** HIGH
**File:** `lib/features/shifts/providers/shifts_provider.dart` -- lines 39-54

**Description:** The AI insights cache correctly checks `cachedDate != today` and expires daily. The shifts cache has no expiry check. If the app goes offline for days, it will show week-old shift data without any indication it is stale.

**Fix:** Add a `cached_date` field and expiry check, similar to the insights cache pattern.

---

### H-7. `_timeAgo` compares UTC-parsed DateTime against local `DateTime.now()`

**Severity:** HIGH
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- lines 1414-1423

**Description:** `DateTime.tryParse(isoDate)` returns UTC if the string has a `Z` suffix (as most API timestamps do). `DateTime.now()` returns local time. The `.difference()` call between UTC and local gives wrong results -- e.g., in UTC+8, a notification from 2 minutes ago shows as "8h" because the difference is 8 hours off.

**Fix:**
```dart
final diff = DateTime.now().toUtc().difference(dt);
```
Or convert `dt` to local: `final dt = DateTime.tryParse(isoDate)?.toLocal();`

---

### H-8. `BadgesRepository` swallows all errors in `getMyPoints()` -- hides backend misconfiguration

**Severity:** HIGH
**File:** `lib/features/badges/data/repositories/badges_repository.dart` -- lines 18-26

**Description:** The catch block returns a zero-point summary for ANY error, including 401 (unauthorized), 403 (wrong org), network timeout, or malformed JSON. The comment says "Backend may 500 if points table has no row" but this catches everything. A persistent auth issue would be invisible.

**Fix:** Only catch specific status codes:
```dart
} on DioException catch (e) {
  if (e.response?.statusCode == 500 || e.response?.statusCode == 404) {
    return const PointsSummary(userId: '', totalPoints: 0);
  }
  rethrow;
}
```

---

### H-9. `userRoleProvider` reads role from JWT without refresh -- stale role after admin changes

**Severity:** HIGH
**File:** `lib/core/auth/role_provider.dart` -- lines 6-12

**Description:** `userRoleProvider` reads `appMetadata['role']` from the current Supabase session JWT. JWTs are minted at login and cached. If an admin changes a user's role (e.g., staff to manager), the JWT still contains the old role until the user re-authenticates. The `Provider` (not `StateProvider`) means it re-reads the session object on watch, but the session itself is stale.

**Fix:** Consider refreshing the session token periodically or on app foreground:
```dart
await Supabase.instance.client.auth.refreshSession();
```

---

## MEDIUM Issues

### M-1. `_SidekickSheet` TextEditingController created but sheet has no actual functionality

**Severity:** MEDIUM
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- lines 1266-1385

**Description:** The Sidekick sheet has a text field, suggestion chips, and a send button, but the send button only shows "AI chat coming soon". The suggestion chips populate the text field but don't submit. This is placeholder UI that could confuse users if the sheet is accessible.

**Fix:** Either implement the AI chat integration or hide the Sidekick entry point until it's ready. If keeping as placeholder, add a "Coming Soon" label visually.

---

### M-2. `GestureDetector` used instead of `InkWell`/`Material` -- no tap feedback

**Severity:** MEDIUM
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- throughout (lines 200, 213, 376, 445, 484, 1175, 1209, 1239, 1396, 1502)

**Description:** All interactive elements use `GestureDetector` which provides zero visual feedback on tap. Users cannot tell if their tap registered. This is a significant UX issue on mobile where users rely on ripple/highlight feedback.

**Fix:** Wrap with `Material` + `InkWell` for ripple effect, or at minimum use `GestureDetector` with an `AnimatedContainer` that changes opacity on tap.

---

### M-3. Hive boxes typed as `Box<Map>` -- raw `Map<dynamic, dynamic>` everywhere

**Severity:** MEDIUM
**File:** `lib/core/offline/hive_service.dart` -- lines 21-24, 27-37

**Description:** All Hive boxes are `Box<Map>` (which is `Box<Map<dynamic, dynamic>>`). Every read requires `Map<String, dynamic>.from(raw)` conversion. If any code forgets the conversion, it gets `Map<dynamic, dynamic>` which may crash downstream `fromJson` calls that expect `String` keys.

**Fix:** Use `Box<String>` and store JSON-encoded strings, or create Hive TypeAdapters for the model classes. This is a Phase 1 shortcut noted in the code but should be tracked for cleanup.

---

### M-4. Pull-to-refresh fires 7+ parallel API calls with no debounce

**Severity:** MEDIUM
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- lines 101-109

**Description:** A single pull-to-refresh invalidates/refreshes 7 providers simultaneously. If the user pulls to refresh multiple times quickly, this can fire 14+ concurrent API calls. There's no debounce or mutex.

**Fix:** Add a debounce timer or a `_isRefreshing` flag to prevent duplicate refreshes. Consider a single "refresh all" method with rate limiting.

---

### M-5. `_AIInsightsSection` error state shows raw error object to user

**Severity:** MEDIUM
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- lines 514-516

**Description:** The error handler displays `'Insight error: $e'` which may contain raw DioException details, stack traces, or internal API URLs. Similarly, line 144 shows `'Shift error: $e'`.

**Fix:** Show a user-friendly message:
```dart
error: (_, __) => const Padding(
  padding: EdgeInsets.symmetric(horizontal: 16),
  child: Text('Could not load insights',
      style: TextStyle(fontSize: 12, color: _C.textTertiary)),
),
```

---

### M-6. `_HomeBody` computes `openIssueCount` from tasks, not issues

**Severity:** MEDIUM
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- lines 82-87

**Description:** The variable is named `openIssueCount` and the card says "Open Issues", but it actually counts tasks with status `pending`, `open`, or `in_progress`. This mislabels task data as issue data, misleading the user.

**Fix:** Either rename to `openTaskCount` / "Open Tasks", or actually fetch from an issues provider.

---

### M-7. Announcement body preview truncation could break multi-byte characters

**Severity:** MEDIUM
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- lines 1104-1105

**Description:** `a.body.substring(0, 80)` on a string with emoji or CJK characters could split a multi-byte character, producing garbled text or a RangeError if the string is measured in UTF-16 code units and the emoji is a surrogate pair.

**Fix:** Use `characters` package or check that substring doesn't split a surrogate pair:
```dart
final preview = a.body.characters.take(80).toString();
```

---

### M-8. Notification `route` getter returns `/issues` for issue notifications -- loses context

**Severity:** MEDIUM
**File:** `lib/features/notifications/data/models/notification_models.dart` -- line 41

**Description:** When `entityType` is `'issue'`, the route is `/issues` (the list page), not `/issues/$entityId` (the specific issue). The user taps a notification about a specific issue but lands on the issues list.

**Fix:**
```dart
'issue' => '/issues/$entityId',
```

---

## LOW Issues

### L-1. `_SectionCard` "View all" action area is text-only with no minimum touch target

**Severity:** LOW
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- lines 445-460

**Description:** The "View all" / arrow link is a small `GestureDetector` wrapping just the text/icon. On small text like "View all", the touch target may be under 44x44pt (Apple HIG minimum). This makes it hard to tap.

**Fix:** Wrap with `Padding` or set a minimum `SizedBox(height: 44)` around the tap target.

---

### L-2. Skeleton loader does not animate -- appears as static gray blocks

**Severity:** LOW
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- lines 1427-1479

**Description:** The skeleton loading state shows static gray containers. Best practice is to use a shimmer animation so users understand content is loading (not broken).

**Fix:** Use the `shimmer` package or a custom `AnimationController` to create a wave effect.

---

### L-3. No `Semantics` widgets for screen reader accessibility

**Severity:** LOW
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- throughout

**Description:** None of the metric cards, action buttons, or interactive elements have `Semantics` labels. Screen readers (VoiceOver/TalkBack) will not convey meaningful information about "3 Overdue Items" or "Clock In" button purpose.

**Fix:** Add `Semantics` wrappers to key interactive elements:
```dart
Semantics(
  label: '$overdueCount overdue tasks. Tap to view.',
  button: true,
  child: _MetricCard(...),
)
```

---

### L-4. `_C` color constants defined as private class in the screen file

**Severity:** LOW
**File:** `lib/features/dashboard/presentation/screens/dashboard_screen.dart` -- lines 23-42

**Description:** Design tokens are hardcoded as a private class `_C` in the screen file. These colors are reused across the app but defined locally, leading to duplication. Other screens will need to copy these values or re-import this file's private class (which they cannot).

**Fix:** Move to a shared `lib/core/theme/app_colors.dart` file.

---

### L-5. `DashboardSummary.fromJson` calculates `tasksPending` incorrectly

**Severity:** LOW
**File:** `lib/features/dashboard/data/models/dashboard_summary.dart` -- line 29

**Description:** `tasksPending` is computed as `totalAssignments - totalSubmitted`, which could be negative if the backend returns inconsistent data or counts form submissions separately from task assignments. Also, `tasksInProgress` and `issuesOpen` are hardcoded to `0`, making the model misleading.

**Fix:** Clamp to zero: `tasksPending: max(0, totalAssignments - totalSubmitted)` and populate the other fields from the actual API response.

---

## Full List of `.cast<Map<String, dynamic>>()` Occurrences to Fix

For convenience, here is every file and line that still uses the dangerous `.cast` pattern:

**Repository files (unwrap list from API):**
1. `lib/features/training/data/repositories/training_repository.dart` -- lines 62, 65
2. `lib/features/forms/data/repositories/forms_repository.dart` -- line 10
3. `lib/features/team/data/repositories/team_repository.dart` -- lines 16, 19, 35, 38
4. `lib/features/approvals/data/repositories/approvals_repository.dart` -- lines 10, 13, 46, 49, 71, 74, 96, 99
5. `lib/features/audits/data/repositories/audits_repository.dart` -- line 11

**Model files (nested list parsing):**
6. `lib/features/forms/data/models/form_template.dart` -- lines 26, 36
7. `lib/features/tasks/data/models/task_models.dart` -- lines 111, 114
8. `lib/features/training/data/models/training_models.dart` -- lines 64, 109, 114, 177
9. `lib/features/audits/data/models/audit_models.dart` -- lines 41, 73

**Total: 24 occurrences across 9 files.**

---

## Recommendations -- Priority Order

1. **Immediately fix** C-1 (.cast crashes), C-2 (missing location plist key), C-4 (attendance state loss).
2. **Before App Store submission** fix C-3 (ATS), C-5 (dynamic summary type).
3. **Before beta testing** fix all HIGH issues (timezone bugs, stale caches, error handling).
4. **Track for next sprint** MEDIUM and LOW issues.
