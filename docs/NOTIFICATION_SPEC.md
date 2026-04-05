# Notification & Inbox System Spec

**This document defines the centralized notification system, My To-Do List, push notifications, and AI insight integration.**

---

## Architecture Overview

Four channels for surfacing information to users:

### 1. My To-Do List (web + mobile)
- **Status-based**: shows everything the user still needs to action — regardless of when the triggering event happened
- Powered by `GET /api/v1/inbox` — aggregates 6 entity types server-side
- Entity types: tasks (not completed/cancelled), form assignments (not submitted), workflow stage instances (in_progress), course enrollments (not_started), announcements (requires acknowledgement, not yet acknowledged), issues (assigned to user, not resolved/closed)
- Sorted: overdue first (due_at ASC) → upcoming (due_at ASC) → no due date (created_at DESC)
- Items **stay** in the list until the underlying entity is done — completing a task removes it; marking an announcement acknowledged removes it
- Web: "My To-Do List" widget on dashboard (`frontend/app/(dashboard)/dashboard/page.tsx`)
- Mobile: full-screen "My To-Do List" (`notifications_screen.dart`) via `todoItemsProvider`
- Route file: `backend/routes/inbox.py`
- Frontend service: `frontend/services/inbox.ts` — `getInboxItems()`
- Mobile model: `inbox_models.dart`, repository method `getInboxItems()`, provider `todoItemsProvider`

### 2. Notifications (event log)
- **Event-based**: each trigger event (task assigned, issue commented on, etc.) creates one row
- Powered by the `notifications` table via `GET /api/v1/notifications`
- Items persist as history; users mark them read or dismiss them
- Powers the **sidebar unread badge** (polls `GET /api/v1/notifications/unread-count` every 60 s)
- Does NOT drive the My To-Do List widget

### 3. Push Notifications (mobile only, FCM)
- OS-level banners
- User controls on/off in app settings
- Only three triggers: task assigned, form assigned, scheduled reminders
- Light touch — everything else is inbox-only

### 4. AI Insight Cards (web dashboard + mobile dashboard)
- AI-generated observations and anomaly alerts
- Integrated into the AI Daily Brief on web dashboard
- Shown as dismissable cards on mobile dashboard (per MOBILE_DESIGN.md)
- Not stored in the notifications table — generated dynamically
- Separate from the to-do list and notifications

---

## Part 1: Database

### New Table: notifications

Replaces the broken `notification_log` table.

```sql
DROP TABLE IF EXISTS notification_log;

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) NOT NULL,
  recipient_user_id UUID REFERENCES profiles(id) NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'task_assigned',
    'form_assigned',
    'workflow_stage_assigned',
    'issue_assigned',
    'issue_comment',
    'issue_status_changed',
    'shift_claim_pending',
    'shift_swap_pending',
    'leave_request_pending',
    'form_submission_review',
    'cap_generated',
    'announcement',
    'course_enrolled',
    'scheduled_reminder'
  )),
  title TEXT NOT NULL,
  body TEXT,
  entity_type TEXT CHECK (entity_type IN (
    'task', 'form_assignment', 'workflow_instance', 'issue',
    'shift_claim', 'shift_swap', 'leave_request',
    'form_submission', 'cap', 'announcement', 'course_enrollment'
  )),
  entity_id UUID,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  is_dismissed BOOLEAN DEFAULT false,
  push_sent BOOLEAN DEFAULT false,
  push_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notifications_recipient 
  ON notifications(recipient_user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_org 
  ON notifications(organisation_id, created_at DESC);
```

---

## Part 2: Notification Service

Centralized service: `backend/services/notification_service.py`

All notification sending goes through this service. No scattered FCM code anywhere else.

### Methods

**notify()** — create a notification for a specific user
- Inserts into notifications table
- If send_push=True AND user has FCM token AND user has push enabled → send FCM

**notify_role()** — notify all users with a given role, optionally scoped to a location
- Looks up matching users, calls notify() for each

**notify_user_manager()** — notify the user's reports_to
- Looks up user's reports_to from profiles, calls notify()

### FCM Implementation

Use `firebase-admin` Python SDK instead of the broken Edge Function approach.

```python
import firebase_admin
from firebase_admin import messaging

def send_push(token: str, title: str, body: str, data: dict):
    message = messaging.Message(
        notification=messaging.Notification(title=title, body=body),
        data=data,  # { type, entity_type, entity_id } for deep linking
        token=token,
    )
    messaging.send(message)
```

---

## Part 3: Notification Triggers

Every flow that creates a notification, with exact specifications.

### task_assigned
- When: task_assignees row created
- Recipient: assigned user
- Title: "New task: {task.title}"
- Body: "{location.name} · Due {due_at formatted}"
- Entity: task, task.id
- Push: **YES**

### form_assigned
- When: form_assignment created
- Recipient: assigned user
- Title: "New assignment: {template.title}"
- Body: "{location.name} · Due {due_at formatted}"
- Entity: form_assignment, assignment.id
- Push: **YES**

### workflow_stage_assigned
- When: workflow_stage_instance status set to in_progress
- Recipient: assigned_to user
- Title: "Action needed: {stage.name} for {workflow.name}"
- Body: stage action type description
- Entity: workflow_instance, instance.id
- Push: NO

### issue_assigned
- When: issue.assigned_to is set or changed
- Recipient: newly assigned user
- Title: "Issue assigned: {issue.title}"
- Body: "{priority} · {location.name}"
- Entity: issue, issue.id
- Push: NO

### issue_comment
- When: issue_comments row created
- Recipient: issue.assigned_to AND issue.reported_by (exclude commenter)
- Title: "New comment on: {issue.title}"
- Body: first 100 chars of comment
- Entity: issue, issue.id
- Push: NO

### issue_status_changed
- When: issue status updated
- Recipient: issue.reported_by (so reporter knows progress)
- Title: "{issue.title} → {new_status}"
- Entity: issue, issue.id
- Push: NO

### shift_claim_pending
- When: open_shift_claims row created
- Recipient: managers at shift's location (notify_role)
- Title: "Shift claim: {staff.name} wants {shift date/time}"
- Entity: shift_claim, claim.id
- Push: NO

### shift_swap_pending
- When: swap created (status = pending_colleague)
  - Recipient: the requested colleague
  - Title: "Shift swap request from {requester.name}"
- When: colleague approves (status = pending_manager)
  - Recipient: managers at location (notify_role)
  - Title: "Shift swap needs approval: {requester} ↔ {colleague}"
- Entity: shift_swap, swap.id
- Push: NO

### leave_request_pending
- When: leave_requests row created
- Recipient: user's reports_to (notify_user_manager)
- Title: "Leave request: {user.name} — {leave_type}"
- Body: "{start_date} to {end_date}"
- Entity: leave_request, request.id
- Push: NO

### form_submission_review
- When: form_submission status = submitted
- Recipient: the assigned_by user (manager who assigned it)
- Title: "Submission ready: {template.title}"
- Body: "By {submitter.name} at {location.name}"
- Entity: form_submission, submission.id
- Push: NO

### cap_generated
- When: corrective_action_plans row created after failed audit
- Recipient: managers at location (notify_role)
- Title: "Failed audit: {template.title} — CAP needs review"
- Body: "Score: {score}% at {location.name}"
- Entity: cap, cap.id
- Push: NO

### announcement
- When: announcement created
- Recipient: all users matching target_roles and target_location_ids
- Title: announcement.title
- Body: first 100 chars of announcement body
- Entity: announcement, announcement.id
- Push: NO

### course_enrolled
- When: course_enrollment created
- Recipient: enrolled user
- Title: "New training: {course.title}"
- Body: "{estimated_duration} mins"
- Entity: course_enrollment, enrollment.id
- Push: NO

### scheduled_reminder
- When: background job detects upcoming items
- Triggers:
  - Form assignment due in 1 hour (no submission yet)
  - Training deadline in 1 day (not completed)
  - Shift starting in 30 minutes
- Recipient: assigned user
- Title: varies ("Opening Checklist due in 1 hour", "Food Safety training due tomorrow", "Shift starts in 30 min")
- Push: **YES**
- Dedup: check if a notification with same entity_type + entity_id + type exists for that user today before creating

---

## Part 4: API Endpoints

```
GET    /api/v1/notifications
         Query: is_read, type, page, limit
         Returns: paginated notifications for current user
         Sorted: created_at DESC

GET    /api/v1/notifications/unread-count
         Returns: { count: int }

POST   /api/v1/notifications/{id}/read
         Marks as read, sets read_at

POST   /api/v1/notifications/read-all
         Marks all as read for current user

POST   /api/v1/notifications/{id}/dismiss
         Sets is_dismissed = true, hides from inbox
```

---

## Part 5: Web — My To-Do List Widget

### Dashboard Widget

The "My To-Do List" widget calls `GET /api/v1/inbox` once and renders the sorted result.

- Each item: kind-based icon + title + description (location name or entity description) + type badge + priority/form-type pill + overdue/due-date label
- Tapping navigates to the source entity (no read-marking — item disappears when the underlying work is done)
- "View all N items" expands inline when count exceeds 8
- "All caught up!" empty state when the list is empty
- Implementation: `MyInbox` function in `dashboard/page.tsx`; helpers `TODO_META`, `PRIORITY_PILL`, `FORM_TYPE_PILL`, `todoPills()`, `todoHref()`, `dueBadge()`

### Navigation Mapping

| kind | Navigates to |
|---|---|
| task | `/dashboard/issues?tab=tasks&id={id}` |
| form | `/dashboard/forms/fill/{id}` |
| workflow | `/dashboard/workflows/instances/{workflow_instance_id}` |
| course | `/dashboard/training/learn/{id}` |
| announcement | `/dashboard/announcements` |
| issue | `/dashboard/issues?tab=issues&id={id}` |

### Unread Badge (notifications, not to-do list)

Sidebar unread badge is driven by **notifications**, not the to-do list. Poll `GET /api/v1/notifications/unread-count` every 60 seconds to keep badge current.

---

## Part 6: Mobile — My To-Do List Screen

### Full Screen

`NotificationsScreen` (`notifications_screen.dart`) renders the to-do list via `todoItemsProvider`:
- Calls `GET /api/v1/inbox` via `NotificationsRepository.getInboxItems()`
- Each row: kind icon + title + description + due badge + kind badge chip
- Tap navigates using `InboxItem.route`
- Pull to refresh
- Empty state: "You're all caught up!"

### Model & Provider

- `InboxItem` model: `inbox_models.dart`
- Repository method: `NotificationsRepository.getInboxItems()`
- Provider: `todoItemsProvider` (`AsyncNotifierProvider<TodoItemsNotifier, List<InboxItem>>`)

### Dashboard Home Screen

Per MOBILE_DESIGN.md, the home screen inbox card section should show the latest 5 items from `todoItemsProvider` (kind icon + title + due badge). "View all →" navigates to the full `NotificationsScreen`.

### Unread Badge (notifications)

The bottom nav unread badge is driven by `unreadCountProvider` → `GET /api/v1/notifications/unread-count`. This is separate from the to-do list count.

---

## Part 7: AI Insight Integration

AI insights are NOT notifications. They're dynamically generated observations shown in two places.

### Web: AI Daily Brief (existing)

The web dashboard already has an AI daily brief. Expand the context sent to Claude when generating the brief to include:

1. **Pull-out anomalies** — query GET /reports/pull-outs/anomalies. If any locations are > 1.5x their 4-week average, include in context.

2. **Checklist completion trends** — query GET /reports/checklist-completion. If any template's completion rate dropped > 20% week-over-week, include.

3. **Issue patterns** — query GET /issues/dashboard/recurring. If any recurring issues exist, include.

4. **SLA breaches** — count issues where age > category.sla_hours. If any, include count and worst offenders.

5. **Aging outliers** — any tasks or issues open > 7 days.

6. **Training gaps** — enrollments past deadline that aren't completed.

7. **Unreviewed CAPs** — CAPs with status pending_review.

The AI brief prompt should include all of the above as context, and Claude generates a natural language summary highlighting what needs attention. This replaces the need for separate anomaly alert cards on web — the brief covers it.

### Mobile: AI Insight Cards

Per MOBILE_DESIGN.md Pattern 2, show dismissable insight cards on the mobile dashboard below the metric cards.

These cards are generated by a dedicated endpoint:

```
GET /api/v1/ai/dashboard-insights
  Returns: {
    brief: "Natural language AI brief text...",
    insights: [
      {
        id: string (hash for dedup/dismiss tracking),
        message: "Food waste 60% above average at Makati",
        link_label: "View Pull-Out Report",
        link_entity_type: "report",
        link_path: "/dashboard/insights/reports/pull-outs"
      },
      ...
    ]
  }
```

The endpoint:
1. Gathers the same context as the web brief (anomalies, trends, patterns)
2. Calls Claude to generate the brief text
3. Also returns structured insight cards for individual observations

Mobile shows:
- The brief text in the "AI BRIEF" card section
- Individual insights as the dismissable cards above the brief
- Dismissed card IDs stored locally (Hive) with today's date, cleared daily

Web shows:
- The brief text in the existing AI brief widget
- No separate insight cards on web — the brief text covers everything

---

## Part 8: Scheduled Reminder Background Job

Background job runs every 5 minutes:

```python
async def check_scheduled_reminders():
    now = utcnow()
    
    # Forms due in 1 hour (no submission yet)
    # Training deadline in 1 day (not completed)
    # Shift starting in 30 minutes
    
    # For each, check if reminder already sent today
    # (query notifications for same entity + type + user + today)
    # If not sent, create notification with send_push=True
```

---

## Part 9: Push Notification Settings (Mobile)

### Settings Screen

```
NOTIFICATIONS

Task assignments          [ ON/OFF ]
Form assignments          [ ON/OFF ]
Scheduled reminders       [ ON/OFF ]

All other updates are available in your inbox.
```

Store preferences locally in Hive. The mobile app filters push display based on these settings. Backend always sends the push — the mobile client decides whether to show it.

---

## Part 10: Cleanup

- Remove all scattered FCM code from routes/issues.py, routes/maintenance.py, routes/safety.py
- Drop the broken notification_log table
- Remove the Edge Function reference for FCM
- Remove the old MyInbox Promise.all polling logic from the dashboard
- All notification creation goes through NotificationService only

---

## Summary: What Goes Where

| Event | Inbox | Push | AI Brief |
|---|---|---|---|
| Task assigned | ✅ | ✅ | |
| Form assigned | ✅ | ✅ | |
| Scheduled reminder | ✅ | ✅ | |
| Workflow stage assigned | ✅ | | |
| Issue assigned | ✅ | | |
| Issue comment | ✅ | | |
| Issue status changed | ✅ | | |
| Shift claim pending | ✅ | | |
| Shift swap pending | ✅ | | |
| Leave request pending | ✅ | | |
| Form submission review | ✅ | | |
| CAP generated | ✅ | | |
| Announcement | ✅ | | |
| Course enrolled | ✅ | | |
| Pull-out anomaly | | | ✅ |
| Checklist completion drop | | | ✅ |
| Issue patterns | | | ✅ |
| SLA breaches summary | | | ✅ |
| Aging outliers | | | ✅ |
| Training gaps | | | ✅ |
| Unreviewed CAPs | | | ✅ |
