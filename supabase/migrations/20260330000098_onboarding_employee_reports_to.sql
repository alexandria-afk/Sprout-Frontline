-- Add reports_to field to onboarding_employees (manager name/email from HRIS import)
ALTER TABLE onboarding_employees
  ADD COLUMN IF NOT EXISTS reports_to TEXT;
