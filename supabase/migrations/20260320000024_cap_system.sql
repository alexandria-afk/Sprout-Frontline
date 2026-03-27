-- Corrective Action Plan (CAP) system
-- Replaces the simple corrective_actions table with a richer two-table model

-- One CAP per audit submission
create table if not exists corrective_action_plans (
  id               uuid primary key default gen_random_uuid(),
  submission_id    uuid references form_submissions(id) not null unique,
  organisation_id  uuid references organisations(id) not null,
  location_id      uuid references locations(id) not null,
  generated_at     timestamptz default now(),
  reviewed_by      uuid references profiles(id),
  reviewed_at      timestamptz,
  status           text check (status in (
    'pending_review',
    'in_review',
    'confirmed',
    'dismissed'
  )) default 'pending_review',
  dismissed_reason text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  is_deleted       boolean default false
);

-- One item per failed or partial finding
create table if not exists cap_items (
  id                        uuid primary key default gen_random_uuid(),
  cap_id                    uuid references corrective_action_plans(id) not null,
  field_id                  uuid references form_fields(id) not null,
  field_label               text not null,
  response_value            text not null,
  score_awarded             numeric,
  max_score                 numeric,
  is_critical               boolean default false,
  -- Suggested follow-up (auto-generated)
  suggested_followup_type   text check (suggested_followup_type in ('task','issue','incident')),
  suggested_title           text,
  suggested_description     text,
  suggested_priority        text check (suggested_priority in ('low','medium','high','critical')),
  suggested_assignee_id     uuid references profiles(id),
  suggested_due_days        int,
  -- Manager overrides (editable before confirmation)
  followup_type             text check (followup_type in ('task','issue','incident','none')),
  followup_title            text,
  followup_description      text,
  followup_priority         text check (followup_priority in ('low','medium','high','critical')),
  followup_assignee_id      uuid references profiles(id),
  followup_due_at           timestamptz,
  -- Execution (populated after confirmation)
  spawned_task_id           uuid references tasks(id),
  spawned_issue_id          uuid,   -- no FK yet, issues table doesn't exist
  spawned_incident_id       uuid,   -- no FK yet, incidents table doesn't exist
  created_at                timestamptz default now(),
  updated_at                timestamptz default now(),
  is_deleted                boolean default false
);

-- Back-link from tasks to cap_items
alter table tasks add column if not exists cap_item_id uuid references cap_items(id);

-- Indexes
create index if not exists cap_plans_submission_idx    on corrective_action_plans(submission_id);
create index if not exists cap_plans_org_status_idx    on corrective_action_plans(organisation_id, status);
create index if not exists cap_plans_location_idx      on corrective_action_plans(location_id);
create index if not exists cap_items_cap_idx           on cap_items(cap_id);
create index if not exists cap_items_field_idx         on cap_items(field_id);
create index if not exists cap_items_spawned_task_idx  on cap_items(spawned_task_id);
create index if not exists tasks_cap_item_idx          on tasks(cap_item_id);
