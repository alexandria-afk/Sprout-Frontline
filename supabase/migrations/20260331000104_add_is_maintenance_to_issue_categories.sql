-- Add is_maintenance flag to issue_categories
ALTER TABLE issue_categories ADD COLUMN IF NOT EXISTS is_maintenance BOOLEAN DEFAULT false;
