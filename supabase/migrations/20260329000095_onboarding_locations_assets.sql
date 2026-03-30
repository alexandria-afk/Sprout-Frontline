-- Widen current_step constraint from 1-5 to 1-7 (adding Locations + Assets steps)
ALTER TABLE onboarding_sessions
  DROP CONSTRAINT IF EXISTS onboarding_sessions_current_step_check;
ALTER TABLE onboarding_sessions
  ADD CONSTRAINT onboarding_sessions_current_step_check
  CHECK (current_step BETWEEN 1 AND 7);

-- Locations entered during onboarding Step 3
CREATE TABLE IF NOT EXISTS onboarding_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Assets (equipment) entered during onboarding Step 4
CREATE TABLE IF NOT EXISTS onboarding_assets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  model          TEXT,
  manufacturer   TEXT,
  location_name  TEXT,  -- loose FK to onboarding_locations.name, resolved at launch
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vendors entered during onboarding Step 4
CREATE TABLE IF NOT EXISTS onboarding_vendors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  service_type  TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_locations_sess ON onboarding_locations(session_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_assets_sess    ON onboarding_assets(session_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_vendors_sess   ON onboarding_vendors(session_id);
