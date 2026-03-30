-- Allow shift templates to be org-wide (location_id = NULL)
-- Admin-created templates with no location are visible to all locations
ALTER TABLE shift_templates
  ALTER COLUMN location_id DROP NOT NULL;

-- Allow weekly_overtime_threshold_hours to be NULL (meaning: no weekly OT tracking)
ALTER TABLE attendance_rules
  ALTER COLUMN weekly_overtime_threshold_hours DROP NOT NULL;
