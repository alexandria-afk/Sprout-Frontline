-- Add media_urls array to announcements for feed-style multi-media posts
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS media_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
