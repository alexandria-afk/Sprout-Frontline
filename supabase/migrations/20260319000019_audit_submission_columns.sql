-- Extend form_submissions for audit scoring (Phase 2)

-- Make assignment_id nullable so audit submissions don't require an assignment
ALTER TABLE form_submissions ALTER COLUMN assignment_id DROP NOT NULL;

-- Add audit-specific columns
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS overall_score numeric,
  ADD COLUMN IF NOT EXISTS passed boolean;

-- Allow 'audit' as a form_template type
ALTER TABLE form_templates DROP CONSTRAINT IF EXISTS form_templates_type_check;
ALTER TABLE form_templates ADD CONSTRAINT form_templates_type_check
  CHECK (type IN ('checklist', 'form', 'audit'));

CREATE INDEX IF NOT EXISTS form_submissions_location_id_idx ON form_submissions(location_id);
CREATE INDEX IF NOT EXISTS form_submissions_passed_idx ON form_submissions(passed);
