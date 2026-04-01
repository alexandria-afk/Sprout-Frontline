# Allowed Values Reference

**This file defines the constrained enum values used across workflows, courses, and AI generation. Any code that creates, updates, or generates these entities MUST only use values listed here.**

**Read this file before modifying:** workflow generation, course generation, AI system prompts, seed templates, or industry package content.

---

## Workflow Definitions

### Trigger Types

Column: `workflow_definitions.trigger_type`

| Value | Description | Required Configuration |
|---|---|---|
| `manual` | User explicitly starts the workflow | `trigger_form_template_id` (linked form the user fills to start) |
| `form_submitted` | Auto-fires when a specific form is submitted | `trigger_form_template_id` (which form triggers this) |
| `issue_created` | Auto-fires when an issue is filed in a specific category | `trigger_issue_category_id` (which issue category triggers this) |
| `employee_created` | Auto-fires when a new employee/user is added | `trigger_conditions` JSONB (optional filters: role, department, location, employment_type) |

**No other trigger types exist.** Do not generate workflows with triggers like `scheduled`, `audit_submitted`, `incident_created`, `asset_updated`, or any other value.

Existing workflows with `trigger_type = NULL` are treated as `manual` for backward compatibility.

### Stage Action Types

Column: `workflow_stages.action_type`

| Value | Description | Required Configuration |
|---|---|---|
| `fill_form` | Assignee completes a linked form | `form_template_id` on the stage |
| `approve` | Assignee approves or rejects (gates the workflow) | Assigned role or user |
| `sign` | Assignee provides a digital signature | Assigned role or user |
| `review` | Assignee reads and acknowledges submitted content | Assigned role or user |
| `create_task` | Auto-creates a task | Stage config: title, description, priority, assignee, deadline |
| `create_issue` | Auto-creates an issue in a specified category | Stage config: category_id, title, description, priority |
| `notify` | Sends notification to assigned role or user | Stage config: message template, notification channel |
| `wait` | Pauses workflow for a duration or until a condition is met | Stage config: duration or condition |
| `assign_training` | Assigns one or more LMS courses | Stage config: course_ids[], deadline_days, completion_requirement, on_deadline_missed |

**No other action types exist.** Do not generate stages with types like `escalate`, `send_email`, `create_incident`, `update_field`, `webhook`, or any other value.

### Routing Rule Condition Types

Column: `workflow_routing_rules.condition_type`

| Value | Description |
|---|---|
| `always` | Unconditional — always routes to the target stage |
| `score_below` | Routes when audit score is below `condition_value` |
| `score_above` | Routes when audit score is above `condition_value` |
| `field_failed` | Routes when a specific form field fails validation |
| `field_value_equals` | Routes when a specific form field equals `condition_value` |

**No other condition types exist.** Do not generate rules with types like `priority_equals`, `role_is`, `time_elapsed`, or any other value.

---

## LMS Courses

### Module Types

Column: `course_modules.module_type`

| Value | Description | Content Structure |
|---|---|---|
| `slides` | Slide-based content with title, body text, optional image | Uses `course_slides` table (title, body, image_url, display_order) |
| `video` | Video content | `content_url` pointing to a video file |
| `pdf` | PDF document | `content_url` pointing to a PDF file |
| `quiz` | Assessment with questions | Uses `quiz_questions` table |

**No other module types exist.** Do not generate modules with types like `interactive`, `simulation`, `scenario`, `assessment`, `activity`, `discussion`, or any other value.

### Quiz Question Types

Column: `quiz_questions.question_type`

| Value | Description | Structure |
|---|---|---|
| `multiple_choice` | Multiple options, one correct answer | `options` JSONB array + `correct_option_index` |
| `true_false` | True or False | `options: ['True', 'False']` + `correct_option_index` |
| `image_based` | Question with an image, multiple options | `image_url` + `options` JSONB array + `correct_option_index` |

**No other question types exist.** Do not generate questions with types like `fill_in_blank`, `matching`, `short_answer`, `drag_and_drop`, or any other value.

---

## AI Generation Prompts

### Workflow Generation (`POST /ai/generate-workflow`)

The system prompt MUST include the full list of allowed trigger types, stage action types, and routing rule condition types from this document. The prompt must explicitly state: "Do NOT use any values outside these lists."

### Course Generation (`POST /lms/courses/generate`)

The system prompt MUST include the full list of allowed module types and quiz question types from this document. The prompt must explicitly state: "Do NOT generate modules with types like 'interactive', 'simulation', 'scenario', 'assessment', or any other type not listed."

### Quiz Generation (`POST /ai/generate-quiz`)

The system prompt MUST constrain question types to: `multiple_choice`, `true_false`, `image_based`. No other question types.

---

## Seed Templates & Industry Packages

All `template_items` content JSONB must use only allowed values:

- Templates with `category = 'workflow'`: content must only use trigger types, action types, and condition types listed above
- Templates with `category = 'training_module'`: content must only reference module types and question types listed above

**Validation:** The backend must reject any payload containing values outside the allowed enums, returning HTTP 422 with a clear error listing the invalid value and the allowed alternatives. This applies to all creation and update endpoints for workflows, courses, and seed data — regardless of whether the content was AI-generated, manually created, or loaded from a template pack.

---

## Form Template Types

Column: `form_templates.type` — `TEXT` with a `CHECK` constraint (not a PG enum)

```sql
CHECK (type = ANY (ARRAY['checklist','form','audit','pull_out']))
```

| Value | Description | Notes |
|---|---|---|
| `form` | Standard data collection form | General-purpose fields |
| `checklist` | Step-by-step task checklist | Staff complete items in order |
| `audit` | Scored inspection | Requires an `audit_configs` row with `passing_score`; submissions with score below threshold auto-generate CAPs |
| `pull_out` | Pull-out / wastage record | Requires an `Estimated Cost` field with value > 0; backend returns HTTP 422 if missing or zero; `estimated_cost` is persisted to `form_submissions.estimated_cost` for analytics |

### Pull-Out Enforcement Rules

1. **Estimated Cost required.** `POST /api/v1/forms/submissions` with `status = "submitted"` for a `pull_out` template validates that a field labelled "Estimated Cost" exists in `form_responses` with a numeric value > 0. Returns 422 if absent or zero.
2. **Auto-feeds analytics.** All submitted `form_submissions` rows where `form_templates.type = 'pull_out'` are automatically picked up by the pull-out analytics endpoints (`/api/v1/reports/pull-outs/*`). No tagging or naming convention required.
3. **Anomaly detection.** `GET /api/v1/reports/pull-outs/anomalies` compares each location's current-week total `estimated_cost` against its 4-week rolling average. Locations where current week > 1.5× average are flagged. Anomalies surface in the pull-out analytics dashboard and the AI sidekick nightly brief only — no push notifications or alerts are generated.

---

## Form Field Conditional Logic

Column: `form_fields.conditional_logic` — `JSONB`, nullable

Two shapes are supported:

### Shape 1 — Show / Hide

```json
{ "fieldId": "uuid", "value": "some-value", "action": "show" }
```

| Key | Type | Description |
|---|---|---|
| `fieldId` | string | UUID of the controlling field |
| `value` | string | Value that triggers the action |
| `action` | `"show"` \| `"hide"` | Whether to show or hide this field when the condition matches |

The `type` key is optional and ignored for backwards compatibility.

### Shape 2 — Show Options (dropdown filtering)

```json
{
  "type": "show_options",
  "fieldId": "uuid",
  "optionsMap": {
    "Category A": ["Item 1", "Item 2"],
    "Category B": ["Item 3", "Item 4"]
  }
}
```

| Key | Type | Description |
|---|---|---|
| `type` | `"show_options"` | Identifies this as an options-filtering rule |
| `fieldId` | string | UUID of the parent dropdown field |
| `optionsMap` | `Record<string, string[]>` | Maps each parent value to the list of allowed options for this field |

**Behaviour in form fill:** When the parent field has no value selected yet, the dependent dropdown shows "Select [parent field label] first…" and no options. When the parent has a value, only the matching `optionsMap` entries are shown. The field itself is always visible (the `show_options` shape does not hide the field).

**No other `conditional_logic` shapes exist.** Do not generate or seed conditional logic with keys like `condition`, `operator`, `target`, or any shape not listed above.

---

---

## Task SLA Thresholds

Defined in `backend/routes/reports.py` as `_TASK_SLA_HOURS` and mirrored in `frontend/app/(dashboard)/dashboard/issues/page.tsx` as `TASK_SLA_HOURS`.

| Priority | SLA Hours |
|---|---|
| `critical` | 4 |
| `high` | 24 |
| `medium` | 72 |
| `low` | 168 |

These constants are used by:
- `GET /api/v1/reports/aging/tasks` — breach detection
- `taskAgeColor()` in `issues/page.tsx` — age badge color on task kanban cards and list rows
- The aging report page (`/dashboard/insights/reports/aging`) — breach counts and bucket chart for tasks

**Issue SLA** comes from `issue_categories.sla_hours` per category (set during AI generation or manual creation). Default fallback: 24 hours.

### Age Badge Color Logic

| Color | Condition |
|---|---|
| Green | Age < 50% of SLA |
| Yellow | Age ≥ 50% and ≤ 100% of SLA |
| Red | Age > 100% of SLA (breached) |

Age badges appear on every issue card (kanban + list) and every task card (kanban + list) in `dashboard/issues/page.tsx`.

### Aging Bucket Definitions

Used by both `/aging/tasks` and `/aging/issues` endpoints and displayed in the aging report bar chart.

| Bucket | Range |
|---|---|
| `0–4h` | Age < 4 hours |
| `4–24h` | 4 ≤ age < 24 hours |
| `24–72h` | 24 ≤ age < 72 hours |
| `72–168h` | 72 ≤ age < 168 hours |
| `168h+` | Age ≥ 168 hours (7+ days) |

---

---

## Issue Statuses

Column: `issues.status`

| Value | Description |
|---|---|
| `open` | Newly filed, unassigned |
| `in_progress` | Being worked on by an internal assignee |
| `pending_vendor` | Waiting on an external vendor (assigned_vendor_id set) |
| `resolved` | Work complete; cost recorded if maintenance category |
| `verified_closed` | Verified closed by manager / auto-closed after resolve |

**No other status values exist.** Do not use `pending`, `escalated`, `closed`, or any other value.

Kanban columns on the Issues board use all five values. The "Update Status" dropdown in the issue detail modal must include `pending_vendor` alongside the other four. The UI label for `verified_closed` is **"Verified Closed"**.

---

## Break Types

Column: `break_records.break_type`

| Value | Description |
|---|---|
| `meal` | Meal break |
| `rest` | Short rest break |
| `other` | Other / unclassified |

**No other break types exist.**

---

## Attendance Record Statuses

Column: `attendance_records.status`

| Value | Description |
|---|---|
| `present` | Clocked in on time |
| `late` | Clock-in after `attendance_rules.late_threshold_mins` |
| `early_departure` | Clocked out before shift end by more than `early_departure_threshold_mins` |
| `absent` | Did not clock in |
| `unverified` | Clock-in method is `manager_override` or GPS validation failed |

---

## Clock-In Methods

Column: `attendance_records.clock_in_method`

| Value | Description | Backend status |
|---|---|---|
| `gps` | GPS coordinates verified against geo-fence | Active |
| `selfie` | Selfie photo taken at clock-in | Active (photo stored; no facial verification) |
| `facial_recognition` | Face matched against enrolled profile | Stubbed — schema only; no verification logic |
| `qr_code` | QR code scan at location | Active |
| `manager_override` | Manager manually clocks staff in/out | Active |

---

## Organisation Feature Flags

Column: `organisations.feature_flags` — `JSONB DEFAULT '{}'`

All values are `boolean`. Missing keys are treated as `false`.

| Key | Default | Description |
|---|---|---|
| `staff_availability_enabled` | `false` | When `true`: Availability tab shows on web/mobile Shifts screen; AI schedule generator respects `staff_availability` table. When `false`: Availability tab hidden; AI scheduler assumes all staff always available. |

**Adding new flags:** Add the key to this table, set a sensible default in the migration (`UPDATE organisations SET feature_flags = feature_flags \|\| '{"new_flag": false}'`), and update the Feature Settings admin page (`/dashboard/settings/feature-settings`) to expose the toggle.

---

## Updating This File

When new enum values are added via database migration:

1. Add the migration to `supabase/migrations/`
2. Update the corresponding enum table in this file
3. Update all AI system prompts that reference the affected enum
4. Update `docs/ARCHITECTURE.md` to reflect the new schema
