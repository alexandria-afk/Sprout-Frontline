-- Organisations and Locations
-- Must run before profiles (profiles FK → organisations and locations)

CREATE TABLE organisations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  logo_url    text,
  settings    jsonb NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER organisations_updated_at
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE locations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  name                    text NOT NULL,
  address                 text,
  latitude                numeric,
  longitude               numeric,
  geo_fence_radius_meters int NOT NULL DEFAULT 200,
  is_active               boolean NOT NULL DEFAULT true,
  is_deleted              boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER locations_updated_at
  BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_locations_org ON locations(organisation_id) WHERE is_deleted = false;
