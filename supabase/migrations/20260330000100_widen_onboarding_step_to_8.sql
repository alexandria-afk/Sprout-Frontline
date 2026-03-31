-- Widen current_step constraint from 1-7 to 1-8 (adding Shift Settings as step 6)
ALTER TABLE onboarding_sessions
  DROP CONSTRAINT IF EXISTS onboarding_sessions_current_step_check;
ALTER TABLE onboarding_sessions
  ADD CONSTRAINT onboarding_sessions_current_step_check
  CHECK (current_step BETWEEN 1 AND 8);
