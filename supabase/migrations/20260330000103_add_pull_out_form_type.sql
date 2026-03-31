-- ── Add pull_out to form_templates type check constraint ────────────────────
-- (type column is text with a CHECK constraint, not a PG enum)
ALTER TABLE form_templates DROP CONSTRAINT IF EXISTS form_templates_type_check;
ALTER TABLE form_templates ADD CONSTRAINT form_templates_type_check
  CHECK (type = ANY (ARRAY['checklist'::text, 'form'::text, 'audit'::text, 'pull_out'::text]));

-- ── Add estimated_cost column to form_submissions (populated for pull_out) ──
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS estimated_cost numeric;
