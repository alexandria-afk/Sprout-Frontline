-- Add feature_flags JSONB column to organisations
-- Stores per-org feature toggles. Default is empty object (all features off).
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}';

-- Set staff_availability_enabled = false for all existing orgs explicitly
UPDATE organisations
  SET feature_flags = COALESCE(feature_flags, '{}') || '{"staff_availability_enabled": false}'
  WHERE NOT (feature_flags ? 'staff_availability_enabled');
