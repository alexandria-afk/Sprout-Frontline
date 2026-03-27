-- ============================================================
-- Workflow Engine Phase 3 Upgrades
-- Adds: trigger_type, config, sla_hours, due_at, stalled,
--       source_type/source_id, system stage types, new condition types
-- ============================================================

-- ─── workflow_definitions ────────────────────────────────────────────────────

-- Make form_template_id nullable (non-form triggers don't need it)
ALTER TABLE workflow_definitions ALTER COLUMN form_template_id DROP NOT NULL;

-- Drop unique constraint so multiple issue/incident-triggered workflows can coexist
ALTER TABLE workflow_definitions DROP CONSTRAINT IF EXISTS workflow_definitions_form_template_id_key;

-- Add trigger_type (default manual for backwards compat)
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS trigger_type text
  DEFAULT 'manual'
  CHECK (trigger_type IN ('manual','audit_submitted','issue_created','incident_created','scheduled','form_submitted'));

-- Add optional configs
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS trigger_config jsonb;
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS cron_expression text;

-- ─── workflow_stages ─────────────────────────────────────────────────────────

-- Expand action_type to include system stage types
ALTER TABLE workflow_stages DROP CONSTRAINT IF EXISTS workflow_stages_action_type_check;
ALTER TABLE workflow_stages ADD CONSTRAINT workflow_stages_action_type_check
  CHECK (action_type IN (
    'review','approve','fill_form','sign',
    'create_task','create_issue','create_incident','notify','wait'
  ));

-- Expand assigned_role to include staff + vendor
ALTER TABLE workflow_stages DROP CONSTRAINT IF EXISTS workflow_stages_assigned_role_check;
ALTER TABLE workflow_stages ADD CONSTRAINT workflow_stages_assigned_role_check
  CHECK (assigned_role IN ('staff','manager','admin','super_admin','vendor'));

-- Add config (jsonb for system stage params) and sla_hours
ALTER TABLE workflow_stages ADD COLUMN IF NOT EXISTS config jsonb;
ALTER TABLE workflow_stages ADD COLUMN IF NOT EXISTS sla_hours int;

-- ─── workflow_routing_rules ──────────────────────────────────────────────────

-- Expand condition_type to include approved, rejected, priority/role/sla conditions
ALTER TABLE workflow_routing_rules DROP CONSTRAINT IF EXISTS workflow_routing_rules_condition_type_check;
ALTER TABLE workflow_routing_rules ADD CONSTRAINT workflow_routing_rules_condition_type_check
  CHECK (condition_type IN (
    'always','score_below','score_above',
    'field_failed','field_value_equals',
    'approved','rejected',
    'priority_equals','role_equals','sla_breached'
  ));

-- Add label for display in builder
ALTER TABLE workflow_routing_rules ADD COLUMN IF NOT EXISTS label text;

-- ─── workflow_instances ──────────────────────────────────────────────────────

-- Make submission_id nullable (manual/issue/incident triggers won't have one)
ALTER TABLE workflow_instances ALTER COLUMN submission_id DROP NOT NULL;
ALTER TABLE workflow_instances DROP CONSTRAINT IF EXISTS workflow_instances_submission_id_key;

-- Add stalled status
ALTER TABLE workflow_instances DROP CONSTRAINT IF EXISTS workflow_instances_status_check;
ALTER TABLE workflow_instances ADD CONSTRAINT workflow_instances_status_check
  CHECK (status IN ('in_progress','completed','cancelled','stalled'));

-- Add source context
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS source_type text
  CHECK (source_type IN ('audit','issue','incident','form','manual','scheduled'));
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS source_id uuid;
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS triggered_by uuid REFERENCES profiles(id);
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id);
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS cancelled_reason text;

-- ─── workflow_stage_instances ────────────────────────────────────────────────

-- Add auto_completed status (for system stages)
ALTER TABLE workflow_stage_instances DROP CONSTRAINT IF EXISTS workflow_stage_instances_status_check;
ALTER TABLE workflow_stage_instances ADD CONSTRAINT workflow_stage_instances_status_check
  CHECK (status IN ('pending','in_progress','approved','rejected','skipped','auto_completed'));

-- Add due_at for SLA tracking
ALTER TABLE workflow_stage_instances ADD COLUMN IF NOT EXISTS due_at timestamptz;

-- Add spawned record FKs
ALTER TABLE workflow_stage_instances ADD COLUMN IF NOT EXISTS spawned_task_id uuid REFERENCES tasks(id);
ALTER TABLE workflow_stage_instances ADD COLUMN IF NOT EXISTS spawned_issue_id uuid REFERENCES issues(id);
ALTER TABLE workflow_stage_instances ADD COLUMN IF NOT EXISTS spawned_incident_id uuid REFERENCES incidents(id);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_trigger_type ON workflow_definitions(trigger_type);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_source ON workflow_instances(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_workflow_stage_instances_due_at ON workflow_stage_instances(due_at) WHERE due_at IS NOT NULL;
