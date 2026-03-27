-- Add is_critical flag to form_fields and audit_item field type

ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS is_critical boolean DEFAULT false;

-- Extend field_type constraint to include audit_item
ALTER TABLE form_fields DROP CONSTRAINT IF EXISTS form_fields_field_type_check;
ALTER TABLE form_fields ADD CONSTRAINT form_fields_field_type_check
  CHECK (field_type IN (
    'text', 'number', 'checkbox', 'dropdown',
    'multi_select', 'photo', 'signature', 'datetime',
    'time',
    -- Phase 1 additions
    'yes_no', 'boolean', 'rating', 'select', 'radio', 'file',
    -- Phase 2 additions
    'textarea',
    -- Audit-specific three-tier response field
    'audit_item'
  ));
