-- Extend field_type check constraint to include all new field types
ALTER TABLE form_fields DROP CONSTRAINT form_fields_field_type_check;
ALTER TABLE form_fields ADD CONSTRAINT form_fields_field_type_check
  CHECK (field_type = ANY (ARRAY[
    'text','number','checkbox','dropdown','multi_select',
    'photo','video','signature','datetime','date','time',
    'gps','rating','qr_code'
  ]));
