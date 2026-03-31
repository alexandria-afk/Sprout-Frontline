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

## Updating This File

When new enum values are added via database migration:

1. Add the migration to `supabase/migrations/`
2. Update the corresponding enum table in this file
3. Update all AI system prompts that reference the affected enum
4. Update `docs/ARCHITECTURE.md` to reflect the new schema
