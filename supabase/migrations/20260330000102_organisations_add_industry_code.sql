-- Add industry_code to organisations so AI generation and template packs
-- can be scoped to the org's vertical without relying on onboarding_sessions.

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS industry_code TEXT;
