-- Add reports_to field to profiles for issue routing
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reports_to uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_reports_to ON profiles(reports_to);
