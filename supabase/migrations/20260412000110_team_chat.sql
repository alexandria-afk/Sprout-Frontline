-- Team Chat: location-scoped real-time messaging
-- One chat room per location, auto-populated by profile.location_id

CREATE TABLE location_chats (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID REFERENCES organisations(id) NOT NULL,
  location_id      UUID REFERENCES locations(id) NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     UUID REFERENCES location_chats(id) NOT NULL,
  sender_id   UUID REFERENCES profiles(id) NOT NULL,
  body        TEXT NOT NULL,
  media_url   TEXT,
  media_type  TEXT CHECK (media_type IN ('image', 'video') OR media_type IS NULL),
  is_deleted  BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chat_read_cursors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id      UUID REFERENCES location_chats(id) NOT NULL,
  user_id      UUID REFERENCES profiles(id) NOT NULL,
  last_read_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(chat_id, user_id)
);

CREATE INDEX idx_chat_messages_chat   ON chat_messages(chat_id, created_at DESC);
CREATE INDEX idx_chat_messages_sender ON chat_messages(sender_id);
CREATE INDEX idx_chat_read_cursors    ON chat_read_cursors(chat_id, user_id);

-- Backfill: create a chat room for every existing active location
INSERT INTO location_chats (organisation_id, location_id)
SELECT organisation_id, id
FROM   locations
WHERE  is_deleted = false
ON CONFLICT (location_id) DO NOTHING;
