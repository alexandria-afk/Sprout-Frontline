-- Create issue-media storage bucket for photo attachments on issues
INSERT INTO storage.buckets (id, name, public)
VALUES ('issue-media', 'issue-media', true)
ON CONFLICT DO NOTHING;

-- RLS policies
CREATE POLICY IF NOT EXISTS "issue-media public read"
  ON storage.objects FOR SELECT USING (bucket_id = 'issue-media');

CREATE POLICY IF NOT EXISTS "issue-media auth insert"
  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'issue-media');

CREATE POLICY IF NOT EXISTS "issue-media auth update"
  ON storage.objects FOR UPDATE USING (bucket_id = 'issue-media');

CREATE POLICY IF NOT EXISTS "issue-media auth delete"
  ON storage.objects FOR DELETE USING (bucket_id = 'issue-media');
