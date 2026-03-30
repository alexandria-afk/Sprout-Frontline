-- Add job position field to profiles (free-form, nullable)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS position TEXT;
