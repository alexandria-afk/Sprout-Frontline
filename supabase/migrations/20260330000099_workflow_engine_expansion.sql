-- Migration: Workflow Engine Expansion
-- Adds assign_training action type, employee_created trigger type,
-- additional trigger scoping columns on workflow_definitions,
-- and subject_user_id on workflow_instances.

-- ============================================================
-- 1. Expand workflow_stages.action_type CHECK constraint
-- ============================================================
ALTER TABLE workflow_stages
  DROP CONSTRAINT IF EXISTS workflow_stages_action_type_check;

ALTER TABLE workflow_stages
  ADD CONSTRAINT workflow_stages_action_type_check
    CHECK (action_type IN (
      'review',
      'approve',
      'fill_form',
      'sign',
      'create_task',
      'create_issue',
      'create_incident',
      'notify',
      'wait',
      'assign_training'
    ));

-- ============================================================
-- 2. Expand workflow_definitions.trigger_type CHECK constraint
-- ============================================================
ALTER TABLE workflow_definitions
  DROP CONSTRAINT IF EXISTS workflow_definitions_trigger_type_check;

ALTER TABLE workflow_definitions
  ADD CONSTRAINT workflow_definitions_trigger_type_check
    CHECK (trigger_type IN (
      'manual',
      'audit_submitted',
      'issue_created',
      'incident_created',
      'scheduled',
      'form_submitted',
      'employee_created'
    ));

-- ============================================================
-- 3. Add trigger scoping columns to workflow_definitions
-- ============================================================
ALTER TABLE workflow_definitions
  ADD COLUMN IF NOT EXISTS trigger_form_template_id UUID
    REFERENCES form_templates(id),
  ADD COLUMN IF NOT EXISTS trigger_issue_category_id UUID
    REFERENCES issue_categories(id),
  ADD COLUMN IF NOT EXISTS trigger_conditions JSONB DEFAULT '{}';

-- ============================================================
-- 4. Add subject_user_id to workflow_instances
-- ============================================================
ALTER TABLE workflow_instances
  ADD COLUMN IF NOT EXISTS subject_user_id UUID
    REFERENCES profiles(id);

-- ============================================================
-- 5. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_trigger_form_template_id
  ON workflow_definitions (trigger_form_template_id);

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_trigger_issue_category_id
  ON workflow_definitions (trigger_issue_category_id);

CREATE INDEX IF NOT EXISTS idx_workflow_instances_subject_user_id
  ON workflow_instances (subject_user_id);
