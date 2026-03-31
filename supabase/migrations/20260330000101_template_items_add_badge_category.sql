-- Add 'badge' as a valid category in template_items so F&B packages can seed
-- badge configs via template items rather than relying solely on AI generation.

ALTER TABLE template_items
  DROP CONSTRAINT IF EXISTS template_items_category_check;

ALTER TABLE template_items
  ADD CONSTRAINT template_items_category_check
    CHECK (category IN (
      'form', 'checklist', 'audit',
      'issue_category', 'workflow',
      'training_module', 'shift_template',
      'repair_manual', 'badge'
    ));
