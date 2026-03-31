# Testing Guidelines — Claude Code Standard Checklist

These are the baseline tests Claude Code must run or verify for every feature built. They apply to every screen, form, and API endpoint regardless of module. Run these before marking any feature as done.

---

## 1. Authentication & Access

- [ ] User can log in with valid credentials → lands on correct home screen for their role
- [ ] User cannot log in with incorrect password → error message shown, no redirect
- [ ] User cannot log in with a deactivated account → error message shown
- [ ] Logged-out user who navigates to a protected route is redirected to login
- [ ] After login, refreshing the page keeps the user logged in (token persists)
- [ ] User can log out → session cleared, redirected to login, back button does not return to app
- [ ] Token expiry is handled silently — user is not logged out mid-session, token refreshes automatically
- [ ] A staff member cannot access a manager-only route or screen — returns 403 or redirects

---

## 2. Navigation & Buttons

- [ ] Every button on every screen is tappable / clickable
- [ ] Every button does exactly what its label says
- [ ] Buttons that trigger destructive actions (delete, dismiss, reject) show a confirmation dialog before executing
- [ ] Back/cancel buttons discard changes and return to the previous screen without saving
- [ ] Loading state is shown while a button's action is in progress — button is disabled during this time to prevent double-submission
- [ ] After a successful action, the user is navigated to the correct next screen
- [ ] Empty state screens (no data yet) show a helpful message and a clear call-to-action button
- [ ] Disabled buttons are visually distinct and cannot be clicked

---

## 3. Forms — Field Rendering

Every form field must render as the correct input type. Test each field type present in the form:

| Field type | Expected render |
|---|---|
| Text | Single-line text input |
| Long text / notes | Multi-line textarea |
| Number | Numeric keyboard on mobile, number input on web |
| Yes / No | Two-option toggle or radio — not a text field |
| Checkbox | Checkable box — checked state is visually distinct |
| Dropdown / Select | Tappable picker showing all options |
| Multi-select | Multiple options selectable simultaneously |
| Date | Date picker — not a free-text field |
| Date + Time | Combined date and time picker |
| Photo | Camera/gallery button — opens camera or file picker |
| Signature | Canvas for finger/mouse drawing |
| Rating / Score | Star rating, slider, or numeric stepper — appropriate for context |

- [ ] All field labels are visible and legible
- [ ] Placeholder text is shown in grey inside empty fields
- [ ] Required fields are clearly marked (asterisk or "Required" label)
- [ ] Optional fields are either unmarked or explicitly labelled "Optional"

---

## 4. Forms — Validation

- [ ] Submitting a form with empty required fields is blocked — each empty required field shows an inline error message
- [ ] Inline errors appear next to the specific field that failed, not just at the top of the form
- [ ] Errors clear when the user corrects the field
- [ ] A form cannot be submitted twice — the submit button is disabled after first tap until the response returns
- [ ] Invalid input formats are caught before submission (e.g. letters in a number field, future date where past date is required)
- [ ] Forms with conditional logic only show fields when their condition is met — hidden fields do not appear in the payload
- [ ] Conditional fields that are hidden are not validated — a hidden required field does not block submission

---

## 5. Save, Draft, and Submit

- [ ] **Save as Draft** saves all current field values without validation — partial or empty forms are allowed
- [ ] **Save** (without submitting) saves current values and keeps the form open or navigates to a saved state
- [ ] **Submit** runs full validation before saving — blocks if required fields are missing
- [ ] Saving a draft and reopening it restores all previously entered values exactly
- [ ] Submitting a form marks it as submitted — the user cannot re-submit the same form
- [ ] A submitted form is read-only — fields cannot be edited after submission unless an explicit edit/reopen action is available
- [ ] Draft status is visually distinct from submitted status in list views
- [ ] If the app goes offline mid-form, field values are not lost — draft is preserved locally

---

## 6. Lists & Tables

- [ ] Lists load with the correct data for the current user's role and location — no data from other locations appears
- [ ] Empty lists show an empty state message — not a blank screen or error
- [ ] Lists with many items paginate or infinitely scroll — they do not load all records at once
- [ ] Filters apply correctly — filtered results only show matching records
- [ ] Clearing filters restores the full list
- [ ] Search returns relevant results and handles partial matches
- [ ] Sorting works in both ascending and descending order
- [ ] Tapping a list item navigates to the correct detail screen
- [ ] Status badges and labels match the actual status of the record

---

## 7. Detail Screens

- [ ] All fields display the correct saved values
- [ ] Read-only fields cannot be edited
- [ ] Editable fields open the correct input type when tapped
- [ ] Changes made in edit mode are not saved until the user explicitly taps Save
- [ ] Cancelling edit mode discards changes and restores original values
- [ ] Related records (e.g. linked tasks, comments, attachments) are all visible and correct
- [ ] Timestamps (created at, updated at, submitted at) are displayed in the correct timezone
- [ ] Long text does not overflow or get cut off — it wraps or truncates with a "Read more" option

---

## 8. File Uploads & Attachments

- [ ] Photo upload opens camera or gallery as expected
- [ ] Uploaded photos are visible as thumbnails immediately after upload
- [ ] Video upload is supported where specified
- [ ] File size limit is enforced — oversized files show an error, not a silent failure
- [ ] Unsupported file types are rejected with a clear error message
- [ ] Uploaded files are accessible after saving — thumbnails load and files can be opened
- [ ] Deleting an attachment removes it from the UI and does not leave orphan files in storage
- [ ] Attachments are never served as permanent public URLs — signed URLs must be used

---

## 9. Offline Behaviour (Flutter mobile only)

- [ ] The app loads and displays cached data when offline
- [ ] Forms can be completed and saved offline — submission is queued
- [ ] The user sees a clear indicator when they are offline
- [ ] Queued submissions sync automatically when connectivity is restored
- [ ] Synced submissions appear correctly in the list view after reconnection
- [ ] No data is lost if the app is closed while offline with a queued submission

---

## 10. Notifications

- [ ] Push notifications are received when expected (assignment, status change, reminder)
- [ ] Tapping a push notification deep-links to the correct screen and record
- [ ] Notifications are not sent for actions the user performed themselves
- [ ] Notification content is correct — title, body, and linked record ID match the triggering event
- [ ] If FCM token is stale or missing, the send failure is logged — no silent failures

---

## 11. Role-Based Access

Test every screen and action with each relevant role:

- [ ] **Staff** can only see their own records and assigned items — not other users' data
- [ ] **Staff** cannot access manager-only screens or perform manager-only actions
- [ ] **Manager** can see all records for their location — not other locations
- [ ] **Manager** cannot access admin-only screens
- [ ] **Admin** can see all locations within their organisation
- [ ] **Super Admin** has full access
- [ ] API endpoints return 403 (not 404 or 500) when a lower-role user attempts an unauthorized action
- [ ] UI does not show buttons or actions the current user is not authorized to perform

---

## 12. Real-Time Updates (where applicable)

- [ ] Status changes made on one device appear on another device within 2 seconds without a page refresh
- [ ] New records created by another user appear in the list without a manual refresh
- [ ] Real-time updates do not reset scroll position or lose form state on the receiving device
- [ ] Disconnecting and reconnecting restores the real-time subscription automatically

---

## 13. Exports

- [ ] PDF export generates a correctly formatted document with all expected fields populated
- [ ] CSV export opens or downloads a correctly structured file with correct column headers
- [ ] Exports respect the current filters — only filtered data is exported
- [ ] Exports respect RLS — no data outside the user's authorized scope appears in an export
- [ ] Large exports complete within a reasonable time (under 10 seconds for up to 1,000 records)
- [ ] Empty exports (no matching data) return an empty file — not an error

---

## 14. Error Handling

- [ ] API errors display a user-friendly message — no raw error codes or stack traces shown to the user
- [ ] Network timeouts show a retry option — not a blank screen
- [ ] 404 errors navigate to a "Not Found" screen — not a crash
- [ ] 403 errors navigate to an "Access Denied" screen — not a blank screen or crash
- [ ] Form submission errors do not clear the user's entered data
- [ ] All error states have a clear recovery path (retry, go back, contact support)

---

## 15. Performance Spot Checks

- [ ] App launch time is under 3 seconds on a mid-range Android device
- [ ] List screens load within 2 seconds for typical data volumes (up to 100 records)
- [ ] Form screens open within 1 second
- [ ] No visible lag when typing in text fields
- [ ] Images and thumbnails load progressively — they do not block the rest of the screen

---

## How to Use This Checklist

**For every new feature or screen built, Claude Code must:**

1. Run through all applicable sections above
2. Note any checks that are not applicable (e.g. offline checks do not apply to web admin)
3. Fix all failures before marking the feature complete
4. Never skip Section 4 (Form Validation), Section 5 (Save/Draft/Submit), or Section 11 (Role-Based Access) — these are mandatory for every feature

**The human overseer must:**

1. Test all Flutter screens on a real iOS and Android device — not just the emulator
2. Test role-based access by logging in with a staff account and attempting manager actions
3. Test offline behaviour by enabling airplane mode mid-form
4. Sign off on the Definition of Done before moving to the next phase
