-- Add default_priority to issue_categories
ALTER TABLE issue_categories
  ADD COLUMN IF NOT EXISTS default_priority text NOT NULL DEFAULT 'medium'
  CHECK (default_priority IN ('low', 'medium', 'high', 'critical'));
