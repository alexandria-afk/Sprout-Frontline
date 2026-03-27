-- Announcements and per-user read/acknowledgement receipts

CREATE TABLE announcements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  created_by               uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  title                    text NOT NULL,
  body                     text NOT NULL,
  media_url                text,
  requires_acknowledgement boolean NOT NULL DEFAULT false,
  publish_at               timestamptz,         -- null = publish immediately
  target_roles             jsonb,               -- string[] e.g. ["staff","manager"]
  target_location_ids      jsonb,               -- uuid[]
  is_deleted               boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE announcement_receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  read_at         timestamptz,
  acknowledged_at timestamptz,
  is_deleted      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- One receipt row per user per announcement
  CONSTRAINT announcement_receipts_unique UNIQUE (announcement_id, user_id)
);

CREATE TRIGGER announcement_receipts_updated_at
  BEFORE UPDATE ON announcement_receipts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
