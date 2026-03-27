-- Profiles: extends auth.users with org membership and role
-- FK to auth.users — CASCADE delete removes profile if auth user is deleted

CREATE TABLE profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  location_id     uuid REFERENCES locations(id) ON DELETE SET NULL,
  full_name       text NOT NULL,
  phone_number    text,
  role            text NOT NULL CHECK (role IN ('super_admin', 'admin', 'manager', 'staff')),
  language        text NOT NULL DEFAULT 'en',
  fcm_token       text,
  is_active       boolean NOT NULL DEFAULT true,
  is_deleted      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-create a skeleton profile row when a new auth user signs up.
-- The setup script (or invite flow) fills in organisation_id, role, full_name.
-- Without this trigger, the RLS "get my org" subquery would fail on first login.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Only insert if org context is available via app_metadata
  IF NEW.raw_app_meta_data->>'organisation_id' IS NOT NULL THEN
    INSERT INTO profiles (id, organisation_id, full_name, role)
    VALUES (
      NEW.id,
      (NEW.raw_app_meta_data->>'organisation_id')::uuid,
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
      COALESCE(NEW.raw_app_meta_data->>'role', 'staff')
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
