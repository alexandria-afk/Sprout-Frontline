-- Add comment field to form responses so staff can annotate individual fields
ALTER TABLE form_responses ADD COLUMN comment text;
