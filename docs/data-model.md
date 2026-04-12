# Data Model Reference

**Source of truth:** `supabase/migrations/` (61 SQL files, timestamps `20260317` through `20260401`).
**Database:** PostgreSQL 17. No Row-Level Security — all scoping enforced in application code.
**Conventions:** UUIDs for all PKs (`DEFAULT gen_random_uuid()`). Soft deletes via `is_deleted BOOLEAN DEFAULT false`. Multi-tenancy via `organisation_id UUID REFERENCES organisations(id)` on every tenant table.

---

## Domain: Foundations

### `organisations`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT UNIQUE | Org display name |
| `slug` | TEXT | URL-safe identifier |
| `logo_url` | TEXT | |
| `settings` | JSONB | General settings bag |
| `feature_flags` | JSONB DEFAULT `'{}'` | Boolean capability toggles per org (see ALLOWED_VALUES.md) |
| `is_active` | BOOLEAN | |
| `is_deleted` | BOOLEAN DEFAULT false | Soft delete |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Active feature flags:** `staff_availability_enabled` (boolean, default false).

### `locations`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK → organisations | |
| `name` | TEXT | Branch/outlet name |
| `address` | TEXT | |
| `latitude` | NUMERIC | |
| `longitude` | NUMERIC | |
| `geo_fence_radius_meters` | INT | Used for GPS clock-in validation |
| `is_active` | BOOLEAN | |
| `is_deleted` | BOOLEAN DEFAULT false | |
| `created_at` | TIMESTAMPTZ | |

### `profiles`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | **Keycloak subject UUID** — the FK to `auth.users` was dropped in migration ~35 |
| `organisation_id` | UUID FK → organisations | |
| `location_id` | UUID FK → locations | Nullable — unassigned users have no location |
| `full_name` | TEXT | |
| `email` | TEXT | Unique index; added in migration ~35 after Keycloak migration |
| `phone_number` | TEXT | |
| `role` | ENUM | `super_admin`, `admin`, `manager`, `staff` |
| `position` | TEXT | Job title string (free text) |
| `reports_to` | UUID FK → profiles | Direct manager; nullable |
| `language` | TEXT DEFAULT `'en'` | Preferred language code |
| `fcm_token` | TEXT | Firebase device token for push notifications |
| `is_active` | BOOLEAN | |
| `is_deleted` | BOOLEAN DEFAULT false | |
| `created_at` | TIMESTAMPTZ | |

**Legacy note:** The FK from `profiles.id` to `auth.users(id)` was dropped when Supabase Auth was replaced by Keycloak. The profile's `id` is now set to the Keycloak `sub` (subject UUID). On first login after migration, `dependencies.py` falls back to email lookup and re-keys the profile row to the Keycloak UUID automatically.

---

## Domain: Forms & Checklists

### `form_templates`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `created_by` | UUID FK → profiles | |
| `title` | TEXT | |
| `description` | TEXT | |
| `type` | TEXT CHECK | `'checklist'`, `'form'`, `'audit'`, `'pull_out'` — TEXT with CHECK constraint, not a PG enum |
| `is_active` | BOOLEAN | |
| `is_deleted` | BOOLEAN DEFAULT false | |

### `form_sections`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `form_template_id` | UUID FK → form_templates | |
| `title` | TEXT | |
| `display_order` | INT | |

### `form_fields`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `section_id` | UUID FK → form_sections | |
| `label` | TEXT | |
| `field_type` | ENUM | `text`, `number`, `checkbox`, `dropdown`, `multi_select`, `photo`, `signature`, `datetime` |
| `options` | JSONB | Array of strings for dropdown/multi_select |
| `is_required` | BOOLEAN | |
| `conditional_logic` | JSONB | Nullable. Two valid shapes — see ALLOWED_VALUES.md |
| `display_order` | INT | |
| `placeholder` | TEXT | |
| `is_critical` | BOOLEAN | When true, failed field triggers CAP generation |

### `form_assignments`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `form_template_id` | UUID FK | |
| `assigned_to_user_id` | UUID FK → profiles | Nullable if assigned to location |
| `assigned_to_location_id` | UUID FK → locations | Nullable if assigned to user |
| `organisation_id` | UUID FK | |
| `recurrence` | ENUM | `once`, `daily`, `weekly`, `custom` |
| `cron_expression` | TEXT | Used when recurrence = `custom` |
| `due_at` | TIMESTAMPTZ | |
| `is_active` | BOOLEAN | |
| `is_deleted` | BOOLEAN DEFAULT false | |

### `form_submissions`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `form_template_id` | UUID FK | |
| `assignment_id` | UUID FK → form_assignments | Nullable for ad-hoc submissions |
| `submitted_by` | UUID FK → profiles | |
| `location_id` | UUID FK → locations | |
| `status` | ENUM | `draft`, `submitted`, `approved`, `rejected` |
| `submitted_at` | TIMESTAMPTZ | |
| `reviewed_by` | UUID FK → profiles | |
| `reviewed_at` | TIMESTAMPTZ | |
| `manager_comment` | TEXT | |
| `overall_score` | NUMERIC | Populated for audit-type forms |
| `passed` | BOOLEAN | Populated for audit-type forms |
| `estimated_cost` | NUMERIC | Populated for pull_out type forms only |

### `form_responses`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `submission_id` | UUID FK → form_submissions | |
| `field_id` | UUID FK → form_fields | |
| `value` | TEXT | File URL for photo/signature/video fields |
| `comment` | TEXT | |

---

## Domain: Audits

### `audit_configs`
1:1 with `form_templates` where `type = 'audit'`.
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `template_id` | UUID UNIQUE FK → form_templates | |
| `passing_score` | NUMERIC | 0–100 |

### `audit_section_weights`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `section_id` | UUID UNIQUE FK → form_sections | |
| `weight` | NUMERIC | Relative weight for scoring |

### `audit_field_scores`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `field_id` | UUID UNIQUE FK → form_fields | |
| `max_score` | NUMERIC | Points available for this field |

### `audit_signatures`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `submission_id` | UUID FK → form_submissions | |
| `signed_by` | UUID FK → profiles | |
| `signature_url` | TEXT | Azure Blob URL (audit-signatures container) |
| `signed_at` | TIMESTAMPTZ | |

---

## Domain: Corrective Action Plans (CAPs)

### `corrective_action_plans`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `submission_id` | UUID UNIQUE FK → form_submissions | 1 CAP per audit submission |
| `organisation_id` | UUID FK | |
| `status` | ENUM | `pending_review`, `in_review`, `confirmed`, `dismissed` |
| `dismissed_reason` | TEXT | |
| `reviewed_by` | UUID FK → profiles | |
| `reviewed_at` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ | |

### `cap_items`
AI-generated per failed/critical field when CAP is created.
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `cap_id` | UUID FK → corrective_action_plans | |
| `field_id` | UUID FK → form_fields | |
| `field_label` | TEXT | Snapshot of field label at time of audit |
| `response_value` | TEXT | The failing response |
| `score_awarded` | NUMERIC | |
| `max_score` | NUMERIC | |
| `is_critical` | BOOLEAN | |
| `suggested_followup_type` | ENUM | `task`, `issue`, `incident` (AI suggestion) |
| `suggested_title` | TEXT | |
| `suggested_description` | TEXT | |
| `followup_type` | ENUM | Manager's confirmed choice |
| `followup_priority` | TEXT | |
| `spawned_task_id` | UUID | Set after CAP confirm |
| `spawned_issue_id` | UUID | Set after CAP confirm |
| `spawned_incident_id` | UUID | Set after CAP confirm |

---

## Domain: Workflows

### `workflow_definitions`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `name` | TEXT | |
| `trigger_type` | TEXT | `manual`, `form_submitted`, `issue_created`, `employee_created` |
| `trigger_form_template_id` | UUID FK | Used when trigger_type = `form_submitted` |
| `trigger_issue_category_id` | UUID FK | Used when trigger_type = `issue_created` |
| `trigger_conditions` | JSONB | Optional filters for `employee_created` trigger |
| `is_active` | BOOLEAN | |
| `template_id` | UUID FK | Source template (nullable) |
| `is_deleted` | BOOLEAN DEFAULT false | |

### `workflow_stages`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `definition_id` | UUID FK → workflow_definitions | |
| `name` | TEXT | |
| `stage_order` | INT | |
| `assigned_role` | TEXT | Role that receives this stage |
| `assigned_user_id` | UUID FK → profiles | Nullable — specific user assignment |
| `action_type` | ENUM | `review`, `approve`, `fill_form`, `sign`, `create_task`, `create_issue`, `notify`, `wait`, `assign_training` |
| `form_template_id` | UUID FK | Used when action_type = `fill_form` |
| `is_final` | BOOLEAN | |

### `workflow_routing_rules`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `definition_id` | UUID FK | |
| `from_stage_id` | UUID FK → workflow_stages | |
| `to_stage_id` | UUID FK → workflow_stages | |
| `condition_type` | ENUM | `always`, `score_below`, `score_above`, `field_failed`, `field_value_equals` |
| `condition_value` | TEXT | Threshold or field value |
| `priority` | INT | Rule evaluation order |

### `workflow_instances`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `definition_id` | UUID FK | |
| `organisation_id` | UUID FK | |
| `triggered_by` | UUID FK → profiles | |
| `source_type` | TEXT | Entity type that triggered this instance |
| `source_id` | UUID | ID of the triggering entity |
| `status` | ENUM | `in_progress`, `completed`, `cancelled` |
| `current_stage_id` | UUID FK → workflow_stages | |
| `completed_at` | TIMESTAMPTZ | |

### `workflow_stage_instances`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `instance_id` | UUID FK → workflow_instances | |
| `stage_id` | UUID FK → workflow_stages | |
| `assigned_to` | UUID FK → profiles | |
| `status` | ENUM | `pending`, `in_progress`, `approved`, `rejected`, `skipped` |
| `started_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ | |
| `comment` | TEXT | |

---

## Domain: Tasks

### `tasks`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `location_id` | UUID FK → locations | |
| `created_by` | UUID FK → profiles | |
| `title` | TEXT | |
| `description` | TEXT | |
| `priority` | ENUM | `low`, `medium`, `high`, `critical` |
| `status` | ENUM | `pending`, `in_progress`, `completed`, `overdue`, `cancelled` |
| `due_at` | TIMESTAMPTZ | |
| `recurrence` | TEXT | |
| `cron_expression` | TEXT | |
| `source_type` | ENUM | `manual`, `audit`, `workflow` |
| `cap_item_id` | UUID FK → cap_items | Set when spawned from a CAP |
| `is_deleted` | BOOLEAN DEFAULT false | |

### `task_templates`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `created_by` | UUID FK → profiles | |
| `title` | TEXT | |
| `description` | TEXT | |
| `priority` | ENUM | `low`, `medium`, `high`, `critical` |
| `assign_to_role` | ENUM | `manager`, `staff`, `admin` |
| `recurrence` | TEXT | |
| `cron_expression` | TEXT | |
| `is_active` | BOOLEAN | |
| `is_deleted` | BOOLEAN DEFAULT false | |

### `task_assignees`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `task_id` | UUID FK → tasks | |
| `user_id` | UUID FK → profiles | |
| `assign_role` | TEXT | |

### `task_messages`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `task_id` | UUID FK → tasks | |
| `sender_id` | UUID FK → profiles | |
| `body` | TEXT | |
| `created_at` | TIMESTAMPTZ | |

### `task_attachments`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `task_id` | UUID FK → tasks | |
| `file_url` | TEXT | Azure Blob URL |
| `file_type` | ENUM | `image`, `video`, `document` |
| `annotated_url` | TEXT | Optional annotated version URL |

### `task_status_history`
Immutable audit trail — never updated, only inserted.
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `task_id` | UUID FK → tasks | |
| `changed_by` | UUID FK → profiles | |
| `previous_status` | TEXT | |
| `new_status` | TEXT | |
| `changed_at` | TIMESTAMPTZ | |

---

## Domain: Announcements

### `announcements`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `created_by` | UUID FK → profiles | |
| `title` | TEXT | |
| `body` | TEXT | |
| `media_url` | TEXT | Azure Blob URL |
| `requires_acknowledgement` | BOOLEAN | |
| `publish_at` | TIMESTAMPTZ | Scheduled publish time |
| `target_roles` | JSONB | Array of role strings |
| `target_location_ids` | JSONB | Array of location UUIDs |
| `is_deleted` | BOOLEAN DEFAULT false | |

### `announcement_receipts`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `announcement_id` | UUID FK → announcements | |
| `user_id` | UUID FK → profiles | |
| `read_at` | TIMESTAMPTZ | |
| `acknowledged_at` | TIMESTAMPTZ | |
UNIQUE(`announcement_id`, `user_id`)

---

## Domain: Issues

### `issue_categories`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `name` | TEXT | |
| `description` | TEXT | |
| `color` | TEXT | Hex color for UI |
| `icon` | TEXT | Icon identifier |
| `sla_hours` | INT | SLA in hours for issues in this category |
| `default_priority` | TEXT | |
| `is_maintenance` | BOOLEAN | When true, issues in this category appear in maintenance costs report |
| `is_deleted` | BOOLEAN DEFAULT false | |

### `issue_custom_fields`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `category_id` | UUID FK → issue_categories | |
| `label` | TEXT | |
| `field_type` | ENUM | `text`, `number`, `dropdown`, `checkbox`, `date` |
| `options` | JSONB | For dropdown |
| `is_required` | BOOLEAN | |
| `display_order` | INT | |

### `escalation_rules`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `category_id` | UUID FK → issue_categories | |
| `trigger_type` | ENUM | `on_create`, `sla_breach`, `priority_critical`, `status_change`, `unresolved_hours` |
| `hours_threshold` | INT | Used by `unresolved_hours` trigger |
| `notify_role` | TEXT | Role to notify |
| `notify_user_id` | UUID FK → profiles | Specific user to notify |
| `notify_vendor_id` | UUID FK → vendors | |

### `issues`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `location_id` | UUID FK → locations | |
| `category_id` | UUID FK → issue_categories | |
| `reported_by` | UUID FK → profiles | |
| `assigned_to` | UUID FK → profiles | Nullable |
| `assigned_vendor_id` | UUID FK → vendors | Nullable — triggers `pending_vendor` status |
| `asset_id` | UUID FK → assets | Nullable — set for maintenance issues |
| `title` | TEXT | |
| `description` | TEXT | |
| `priority` | ENUM | `low`, `medium`, `high`, `critical` |
| `status` | ENUM | `open`, `in_progress`, `pending_vendor`, `resolved`, `verified_closed` |
| `location_description` | TEXT | Free text location detail |
| `recurrence_count` | INT | Incremented when AI detects duplicate issues |
| `due_at` | TIMESTAMPTZ | |
| `resolved_at` | TIMESTAMPTZ | |
| `resolution_note` | TEXT | |
| `cost` | NUMERIC | Repair cost — captured on resolve for maintenance-category issues |
| `ai_description` | TEXT | AI-enhanced description |
| `ai_suggested_category` | TEXT | |
| `ai_suggested_priority` | TEXT | |
| `ai_confidence_score` | NUMERIC | |
| `ai_flagged_safety` | BOOLEAN | AI detected safety risk |
| `is_deleted` | BOOLEAN DEFAULT false | |

### `issue_custom_responses`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `issue_id` | UUID FK → issues | |
| `field_id` | UUID FK → issue_custom_fields | |
| `value` | TEXT | |

### `issue_attachments`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `issue_id` | UUID FK → issues | |
| `file_url` | TEXT | Azure Blob URL (issues container) |
| `file_type` | ENUM | `image`, `video` |
| `uploaded_by` | UUID FK → profiles | |

### `issue_comments`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `issue_id` | UUID FK → issues | |
| `author_id` | UUID FK → profiles | |
| `body` | TEXT | |
| `is_vendor_visible` | BOOLEAN | Whether vendor can see this comment |
| `is_deleted` | BOOLEAN DEFAULT false | Soft delete |

### `issue_status_history`
Immutable audit trail.
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `issue_id` | UUID FK → issues | |
| `changed_by` | UUID FK → profiles | |
| `previous_status` | TEXT | |
| `new_status` | TEXT | |
| `changed_at` | TIMESTAMPTZ | |

---

## Domain: Vendors & Assets

### `vendors`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `name` | TEXT | |
| `contact_name` | TEXT | |
| `contact_email` | TEXT | |
| `contact_phone` | TEXT | |
| `is_deleted` | BOOLEAN DEFAULT false | |

### `vendor_category_access`
| Column | Type | Notes |
|---|---|---|
| `vendor_id` | UUID FK → vendors | |
| `category_id` | UUID FK → issue_categories | |
UNIQUE(`vendor_id`, `category_id`)

### `assets`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `location_id` | UUID FK → locations | |
| `name` | TEXT | |
| `category` | TEXT | e.g. "Fryer", "Refrigerator", "POS Terminal" |
| `serial_number` | TEXT | |
| `model` | TEXT | |
| `manufacturer` | TEXT | |
| `installed_at` | DATE | |
| `last_maintenance_at` | DATE | |
| `next_maintenance_due_at` | DATE | |
| `total_repair_cost` | NUMERIC | Aggregated from linked maintenance issues |
| `predicted_days_to_failure` | INT | **Schema only — not populated by any backend logic** |
| `failure_risk_score` | NUMERIC | **Schema only — not populated by any backend logic** |
| `is_deleted` | BOOLEAN DEFAULT false | |

### `repair_guides`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `asset_id` | UUID FK → assets | Nullable |
| `title` | TEXT | |
| `content` | TEXT | Markdown content |
| `file_url` | TEXT | Azure Blob URL (repair-guides container) |
| `file_type` | TEXT | |
| `is_deleted` | BOOLEAN DEFAULT false | |

---

## Domain: Maintenance

**DEPRECATED TABLE:** `maintenance_tickets` was dropped in migration `20260331000105_drop_maintenance_tickets.sql`. Maintenance is now modelled via issues where `issue_categories.is_maintenance = true`. The `routes/maintenance.py` file is stale and still references this dropped table — do not call `/api/v1/maintenance`.

---

## Domain: Incidents

### `incidents`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `location_id` | UUID FK → locations | |
| `reported_by` | UUID FK → profiles | |
| `title` | TEXT | |
| `description` | TEXT | |
| `severity` | TEXT | |
| `status` | TEXT | |
| `resolved_at` | TIMESTAMPTZ | |
| `is_deleted` | BOOLEAN DEFAULT false | |

---

## Domain: LMS (Learning Management System)

### `courses`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `created_by` | UUID FK → profiles | |
| `title` | TEXT | |
| `description` | TEXT | |
| `thumbnail_url` | TEXT | |
| `estimated_duration_mins` | INT | |
| `passing_score` | INT | 0–100 |
| `max_retakes` | INT | |
| `cert_validity_days` | INT | Certification expiry |
| `is_mandatory` | BOOLEAN | |
| `target_roles` | JSONB | Array of role strings |
| `target_location_ids` | JSONB | Array of location UUIDs |
| `is_published` | BOOLEAN | |
| `language` | TEXT | |
| `ai_generated` | BOOLEAN | |
| `is_deleted` | BOOLEAN DEFAULT false | |

### `course_modules`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `course_id` | UUID FK → courses | |
| `title` | TEXT | |
| `module_type` | ENUM | `slides`, `video`, `pdf`, `quiz` |
| `content_url` | TEXT | Azure Blob URL for video/pdf |
| `display_order` | INT | |
| `is_required` | BOOLEAN | |
| `estimated_duration_mins` | INT | |
| `is_deleted` | BOOLEAN DEFAULT false | |

### `course_slides`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `module_id` | UUID FK → course_modules | |
| `title` | TEXT | |
| `body` | TEXT | Slide body text |
| `image_url` | TEXT | |
| `display_order` | INT | |

### `quiz_questions`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `module_id` | UUID FK → course_modules | |
| `question` | TEXT | |
| `question_type` | ENUM | `multiple_choice`, `true_false`, `image_based` |
| `image_url` | TEXT | For image_based questions |
| `options` | JSONB | Array of option strings |
| `correct_option_index` | INT | 0-based index into options |
| `explanation` | TEXT | Shown after answer |
| `display_order` | INT | |

### `course_enrollments`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `course_id` | UUID FK → courses | |
| `user_id` | UUID FK → profiles | |
| `enrolled_by` | UUID FK → profiles | Manager who enrolled them |
| `status` | ENUM | `not_started`, `in_progress`, `passed`, `failed` |
| `score` | INT | Final quiz score |
| `attempt_count` | INT | |
| `started_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ | |
| `cert_issued_at` | TIMESTAMPTZ | |
| `cert_expires_at` | TIMESTAMPTZ | |
| `cert_url` | TEXT | Azure Blob URL |
| `current_module_id` | UUID FK → course_modules | Progress bookmark |

### `module_progress`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `enrollment_id` | UUID FK → course_enrollments | |
| `module_id` | UUID FK → course_modules | |
| `status` | ENUM | `not_started`, `in_progress`, `completed` |
| `time_spent_seconds` | INT | |

### `quiz_attempts`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `enrollment_id` | UUID FK → course_enrollments | |
| `module_id` | UUID FK → course_modules | |
| `attempt_number` | INT | |
| `score` | INT | |
| `passed` | BOOLEAN | |
| `answers` | JSONB | Selected answers |
| `knowledge_gaps` | JSONB | AI-identified gaps |

### `learning_paths`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → profiles | |
| `organisation_id` | UUID FK | |
| `title` | TEXT | |
| `status` | ENUM | `active`, `completed`, `abandoned` |
| `generated_by_ai` | BOOLEAN | |

### `learning_path_items`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `path_id` | UUID FK → learning_paths | |
| `course_id` | UUID FK → courses | |
| `display_order` | INT | |
| `reason` | TEXT | AI reasoning for inclusion |
| `is_completed` | BOOLEAN | |

### `ai_course_jobs`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `created_by` | UUID FK → profiles | |
| `input_type` | ENUM | `topic`, `document`, `video`, `url` |
| `input_value` | TEXT | |
| `status` | ENUM | `queued`, `processing`, `completed`, `failed` |
| `result_course_id` | UUID FK → courses | Set on completion |
| `error_message` | TEXT | |

### `course_translations`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `course_id` | UUID FK → courses | |
| `language` | TEXT | ISO language code |
| `translated_content` | JSONB | |
| `ai_generated` | BOOLEAN | |
| `reviewed` | BOOLEAN | |

---

## Domain: Gamification

### `badge_configs`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `name` | TEXT | |
| `description` | TEXT | |
| `points_awarded` | INT | |
| `criteria_type` | ENUM | `issues_reported`, `issues_resolved`, `checklists_completed`, `checklist_streak_days`, `training_completed`, `attendance_streak_days`, `tasks_completed`, `manual` |
| `criteria_threshold` | INT | Threshold count/days for automatic award |

### `user_badge_awards`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `badge_config_id` | UUID FK → badge_configs | |
| `user_id` | UUID FK → profiles | |
| `awarded_by` | UUID FK → profiles | Manager who awarded (or null for auto) |
| `awarded_at` | TIMESTAMPTZ | |
| `note` | TEXT | |

### `leaderboard_configs`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `name` | TEXT | |
| `scope` | ENUM | `organisation`, `location`, `team` |
| `period` | ENUM | `daily`, `weekly`, `monthly` |
| `metric` | ENUM | `audits_completed`, `issues_resolved`, `learning_hours` |
| `is_active` | BOOLEAN | |

---

## Domain: Shifts & Attendance

### `shift_templates`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `location_id` | UUID FK → locations | **Nullable** — org-wide templates have no location |
| `name` | TEXT | |
| `role` | TEXT | |
| `start_time` | TIME | |
| `end_time` | TIME | |
| `days_of_week` | INTEGER[] | 0=Mon, 1=Tue, …, 6=Sun |

### `shifts`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `location_id` | UUID FK → locations | |
| `template_id` | UUID FK → shift_templates | Nullable |
| `assigned_to_user_id` | UUID FK → profiles | Nullable if open shift |
| `role` | TEXT | |
| `start_at` | TIMESTAMPTZ | |
| `end_at` | TIMESTAMPTZ | |
| `status` | ENUM | `draft`, `published`, `open`, `claimed`, `cancelled` |
| `is_open_shift` | BOOLEAN | |
| `cancellation_reason` | TEXT | |
| `ai_generated` | BOOLEAN | |

### `open_shift_claims`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `shift_id` | UUID FK → shifts | |
| `claimed_by` | UUID FK → profiles | |
| `status` | ENUM | `pending`, `approved`, `rejected` |
| `claimed_at` | TIMESTAMPTZ | |
| `manager_note` | TEXT | |
UNIQUE(`shift_id`, `claimed_by`)

### `shift_swap_requests`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `requester_shift_id` | UUID FK → shifts | |
| `requested_shift_id` | UUID FK → shifts | |
| `requested_user_id` | UUID FK → profiles | |
| `status` | ENUM | `pending_colleague`, `pending_manager`, `approved`, `rejected`, `cancelled` |
| `colleague_response_at` | TIMESTAMPTZ | |
| `manager_response_at` | TIMESTAMPTZ | |
| `approved_by` | UUID FK → profiles | |

### `staff_availability`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → profiles | |
| `day_of_week` | INT | 0=Mon … 6=Sun |
| `available_from` | TIME | |
| `available_to` | TIME | |
| `is_available` | BOOLEAN | |
| `effective_from` | DATE | |
| `effective_to` | DATE | |
UNIQUE(`user_id`, `day_of_week`)

Only used when `organisations.feature_flags.staff_availability_enabled = true`.

### `leave_requests`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → profiles | |
| `organisation_id` | UUID FK | |
| `leave_type` | ENUM | `annual`, `sick`, `emergency`, `unpaid`, `other` |
| `start_date` | DATE | |
| `end_date` | DATE | |
| `reason` | TEXT | |
| `status` | ENUM | `pending`, `approved`, `rejected` |
| `approved_by` | UUID FK → profiles | |

### `attendance_rules`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID UNIQUE FK | **1 row per org** |
| `late_threshold_mins` | INT | Minutes after shift start before status = `late` |
| `early_departure_threshold_mins` | INT | Minutes before shift end for `early_departure` |
| `overtime_threshold_hours` | NUMERIC | Daily overtime threshold |
| `weekly_overtime_threshold_hours` | NUMERIC | |
| `break_duration_mins` | INT | Default break duration |

### `attendance_records`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → profiles | |
| `shift_id` | UUID FK → shifts | Nullable |
| `organisation_id` | UUID FK | |
| `location_id` | UUID FK → locations | |
| `clock_in_at` | TIMESTAMPTZ | |
| `clock_out_at` | TIMESTAMPTZ | |
| `clock_in_method` | ENUM | `gps`, `selfie`, `facial_recognition`, `qr_code`, `manager_override` |
| `clock_in_latitude` | NUMERIC | |
| `clock_in_longitude` | NUMERIC | |
| `clock_in_geo_valid` | BOOLEAN | |
| `total_minutes` | INT | Clock-out minus clock-in in minutes |
| `overtime_minutes` | INT | |
| `break_minutes` | INT DEFAULT 0 | Sum of completed break durations |
| `worked_minutes` | INT **GENERATED** | `GREATEST(0, total_minutes - break_minutes)` — **never insert/update** |
| `status` | ENUM | `present`, `late`, `early_departure`, `absent`, `unverified` |
| `manager_override_note` | TEXT | |

### `break_records`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `attendance_id` | UUID FK → attendance_records | |
| `organisation_id` | UUID FK | |
| `user_id` | UUID FK → profiles | |
| `break_start_at` | TIMESTAMPTZ | |
| `break_end_at` | TIMESTAMPTZ | Null until break ends |
| `duration_minutes` | INT | Filled on break end |
| `break_type` | TEXT CHECK | `meal`, `rest`, `other` |
| `created_at` | TIMESTAMPTZ | |

### `face_profiles`
**Schema only — no implementation.**
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID UNIQUE FK → profiles | |
| `enrolled` | BOOLEAN | |
| `enrolled_at` | TIMESTAMPTZ | |

### `ai_schedule_jobs`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `week_start` | DATE | |
| `shifts_created` | INT | |
| `warnings` | TEXT[] | |
| `status` | ENUM | `pending`, `running`, `completed`, `failed` |

---

## Domain: Onboarding

### `onboarding_sessions`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID UNIQUE FK | 1 session per org |
| `current_step` | INT | 1–8 |
| `status` | ENUM | `in_progress`, `completed`, `abandoned` |
| `website_url` | TEXT | |
| `company_name` | TEXT | |
| `industry_code` | TEXT | |
| `industry_subcategory` | TEXT | |
| `estimated_locations` | INT | |
| `brand_color` | TEXT | Hex color |
| `logo_url` | TEXT | |
| `employee_source` | ENUM | `sprout_hr`, `hris_other`, `csv`, `manual`, `invite_link` |
| `launch_progress` | JSONB | Provisioning status; `{"status": "provisioning"\|"completed"\|"failed", "error": "..."}` |
| `ai_context` | JSONB | Accumulated AI-extracted context |
| `updated_at` | TIMESTAMPTZ | |

### `industry_packages`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `industry_code` | TEXT | e.g. `qsr`, `retail_grocery`, `hospitality` |
| `name` | TEXT | |
| `description` | TEXT | |
| `version` | INT | |
| `is_active` | BOOLEAN | |
UNIQUE(`industry_code`, `version`)

### `template_items`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `package_id` | UUID FK → industry_packages | |
| `category` | ENUM | `form`, `checklist`, `audit`, `issue_category`, `workflow`, `training_module`, `shift_template`, `repair_manual`, `badge` |
| `name` | TEXT | |
| `description` | TEXT | |
| `content` | JSONB | Full template content — must use only ALLOWED_VALUES.md enum values |
| `is_recommended` | BOOLEAN | Pre-selected for new orgs |
| `sort_order` | INT | |

### `onboarding_selections`
| Column | Type | Notes |
|---|---|---|
| `session_id` | UUID FK → onboarding_sessions | |
| `template_id` | UUID FK → template_items | |
UNIQUE(`session_id`, `template_id`)

### `onboarding_employees`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `session_id` | UUID FK → onboarding_sessions | |
| `full_name` | TEXT | |
| `email` | TEXT | |
| `phone` | TEXT | |
| `position` | TEXT | |
| `department` | TEXT | |
| `retail_role` | TEXT | `admin`, `manager`, `staff` |
| `location_name` | TEXT | Matched to created location |
| `status` | ENUM | `pending`, `invited`, `active`, `failed` |

### `role_mappings`
AI-inferred role assignments from CSV imports.
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `session_id` | UUID FK | |
| `source_title` | TEXT | Job title from CSV |
| `source_department` | TEXT | |
| `source_level` | TEXT | |
| `retail_role` | ENUM | `super_admin`, `admin`, `manager`, `staff` |
| `confidence_score` | FLOAT | 0–1 |
| `is_confirmed` | BOOLEAN | Manager has accepted or overridden |
| `employee_count` | INT | Employees sharing this role mapping |

### `employee_import_jobs`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `session_id` | UUID FK | |
| `status` | ENUM | `pending`, `processing`, `completed`, `failed`, `partial` |
| `total_records` | INT | |
| `processed_records` | INT | |
| `failed_records` | INT | |
| `error_log` | JSONB | Per-row errors |
| `source_metadata` | JSONB | Original column headers and mapping |

---

## Domain: Notifications

### `notifications`
Replaced the dropped `notification_log` table (migration `20260401000108_notifications.sql`).
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `recipient_user_id` | UUID FK → profiles | |
| `type` | TEXT CHECK | 14 values: `task_assigned`, `form_assigned`, `workflow_stage_assigned`, `issue_assigned`, `issue_comment`, `issue_status_changed`, `shift_claim_pending`, `shift_swap_pending`, `leave_request_pending`, `form_submission_review`, `cap_generated`, `announcement`, `course_enrolled`, `scheduled_reminder` |
| `title` | TEXT | |
| `body` | TEXT | |
| `entity_type` | TEXT CHECK | `task`, `form_assignment`, `workflow_instance`, `issue`, `shift_claim`, `shift_swap`, `leave_request`, `form_submission`, `cap`, `announcement`, `course_enrollment` |
| `entity_id` | UUID | |
| `is_read` | BOOLEAN DEFAULT false | |
| `read_at` | TIMESTAMPTZ | |
| `is_dismissed` | BOOLEAN DEFAULT false | |
| `push_sent` | BOOLEAN DEFAULT false | |
| `push_sent_at` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ | |

Indexes: `(recipient_user_id, is_read, created_at DESC)`, `(organisation_id, created_at DESC)`

---

## Domain: Logging

### `ai_request_log`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID FK | |
| `user_id` | UUID FK → profiles | |
| `feature` | TEXT | Which feature triggered the call (e.g. `course_generation`, `onboarding_discover`) |
| `provider` | TEXT | Always `anthropic` currently |
| `model` | TEXT | e.g. `claude-haiku-4-5` |
| `input_tokens` | INT | |
| `output_tokens` | INT | |
| `latency_ms` | INT | |
| `success` | BOOLEAN | |
| `error_message` | TEXT | |
| `created_at` | TIMESTAMPTZ | |

---

## Migration History (key milestones)

| Migration | Notable Change |
|---|---|
| `20260317000001–000007` | Extensions, organisations, profiles, forms, announcements, RLS, indexes |
| `20260319000016–000021` | Phase 2: audits, workflows, audit scoring |
| `20260319000022–000023` | Tasks, task message reads |
| `20260320000024` | CAP system |
| `20260320000031–000034` | Phase 3: issues, maintenance, incidents |
| `20260320000035` | Gamification |
| `20260322000039–000065` | Issues asset_id, issue categories, profile reports_to |
| `20260324000042–000044` | Phase 4: LMS, course versioning, enrollment |
| `20260328000050` | AI request log |
| `20260328000060–000080` | Shifts, attendance, breaks |
| `20260329000090–000096` | Onboarding tables |
| `20260330000099–000103` | Workflow engine expansion, pull_out form type |
| `20260331000104–000105` | is_maintenance on issue_categories; **drop maintenance_tickets** |
| `20260401000107` | Feature flags on organisations |
| `20260401000108–000109` | Notifications table (replaces notification_log) + backfill |
