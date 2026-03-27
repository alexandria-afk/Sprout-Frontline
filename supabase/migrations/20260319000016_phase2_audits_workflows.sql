-- ============================================================
-- Phase 2: Audits & Compliance + Workflow Engine
-- ============================================================

-- -------------------------
-- AUDIT TABLES
-- -------------------------

-- Audit Config (audit-specific settings per form_template)
create table audit_configs (
  id uuid primary key default gen_random_uuid(),
  form_template_id uuid references form_templates(id) not null unique,
  passing_score numeric not null default 80,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Audit Section Weights (extends form_sections)
create table audit_section_weights (
  id uuid primary key default gen_random_uuid(),
  section_id uuid references form_sections(id) not null unique,
  weight numeric not null default 1.0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Audit Field Scores (extends form_fields)
create table audit_field_scores (
  id uuid primary key default gen_random_uuid(),
  field_id uuid references form_fields(id) not null unique,
  max_score numeric not null default 1.0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Corrective Action Plans
create table corrective_actions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references form_submissions(id) not null,
  field_id uuid references form_fields(id) not null,
  organisation_id uuid references organisations(id) not null,
  location_id uuid references locations(id) not null,
  description text not null,
  assigned_to uuid references profiles(id),
  due_at timestamptz,
  status text check (status in ('open','in_progress','resolved')) default 'open',
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Audit Signatures (auditee acknowledgement)
create table audit_signatures (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references form_submissions(id) not null unique,
  signed_by uuid references profiles(id) not null,
  signature_url text not null,
  signed_at timestamptz default now(),
  is_deleted boolean default false
);

-- -------------------------
-- WORKFLOW ENGINE TABLES
-- -------------------------

-- Workflow Definitions (attached to a form_template)
create table workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  form_template_id uuid references form_templates(id) not null unique,
  organisation_id uuid references organisations(id) not null,
  name text not null,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Workflow Stages (ordered steps within a definition)
create table workflow_stages (
  id uuid primary key default gen_random_uuid(),
  workflow_definition_id uuid references workflow_definitions(id) not null,
  name text not null,
  stage_order int not null,
  assigned_role text check (assigned_role in ('manager','admin','super_admin')),
  assigned_user_id uuid references profiles(id),
  action_type text check (action_type in ('review','approve','fill_form','sign')) not null,
  form_template_id uuid references form_templates(id),
  is_final boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Workflow Routing Rules (conditional branching between stages)
create table workflow_routing_rules (
  id uuid primary key default gen_random_uuid(),
  workflow_definition_id uuid references workflow_definitions(id) not null,
  from_stage_id uuid references workflow_stages(id) not null,
  to_stage_id uuid references workflow_stages(id) not null,
  condition_type text check (condition_type in (
    'score_below',
    'score_above',
    'field_failed',
    'field_value_equals',
    'always'
  )) not null,
  condition_field_id uuid references form_fields(id),
  condition_value text,
  priority int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Workflow Instances (one per form submission that has a workflow)
create table workflow_instances (
  id uuid primary key default gen_random_uuid(),
  workflow_definition_id uuid references workflow_definitions(id) not null,
  submission_id uuid references form_submissions(id) not null unique,
  organisation_id uuid references organisations(id) not null,
  status text check (status in ('in_progress','completed','cancelled')) default 'in_progress',
  current_stage_id uuid references workflow_stages(id),
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Workflow Stage Instances (state of each stage within a running instance)
create table workflow_stage_instances (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid references workflow_instances(id) not null,
  stage_id uuid references workflow_stages(id) not null,
  assigned_to uuid references profiles(id),
  status text check (status in ('pending','in_progress','approved','rejected','skipped')) default 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  comment text,
  form_submission_id uuid references form_submissions(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- -------------------------
-- INDEXES
-- -------------------------

create index on audit_configs(form_template_id);
create index on audit_section_weights(section_id);
create index on audit_field_scores(field_id);
create index on corrective_actions(submission_id);
create index on corrective_actions(location_id);
create index on corrective_actions(assigned_to);
create index on corrective_actions(status);
create index on audit_signatures(submission_id);

create index on workflow_definitions(form_template_id);
create index on workflow_stages(workflow_definition_id);
create index on workflow_routing_rules(workflow_definition_id);
create index on workflow_routing_rules(from_stage_id);
create index on workflow_instances(submission_id);
create index on workflow_instances(current_stage_id);
create index on workflow_stage_instances(workflow_instance_id);
create index on workflow_stage_instances(assigned_to);
create index on workflow_stage_instances(status);
