-- Add audit field types to form_fields (Phase 2)
-- Extend field_type check to include yes_no, rating, boolean, select, radio

ALTER TABLE form_fields DROP CONSTRAINT IF EXISTS form_fields_field_type_check;
ALTER TABLE form_fields ADD CONSTRAINT form_fields_field_type_check
  CHECK (field_type IN (
    'text', 'number', 'checkbox', 'dropdown',
    'multi_select', 'photo', 'signature', 'datetime',
    'time',
    -- Phase 1 additions (from migration 12)
    'yes_no', 'boolean', 'rating', 'select', 'radio', 'file',
    -- Phase 2 additions
    'textarea'
  ));
