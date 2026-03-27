-- Fix issue_attachments: add missing storage_path column, allow 'document' file type
ALTER TABLE issue_attachments ADD COLUMN IF NOT EXISTS storage_path text;

ALTER TABLE issue_attachments DROP CONSTRAINT IF EXISTS issue_attachments_file_type_check;
ALTER TABLE issue_attachments ADD CONSTRAINT issue_attachments_file_type_check
  CHECK (file_type = ANY (ARRAY['image'::text, 'video'::text, 'document'::text]));
