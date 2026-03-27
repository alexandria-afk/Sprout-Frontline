-- Public bucket for announcement photos and videos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'announcement-media', 'announcement-media', true, 104857600,
  array['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/gif',
        'video/mp4','video/quicktime','video/webm','video/x-m4v']
) ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 104857600,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Authenticated users can upload announcement media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'announcement-media');

CREATE POLICY "Anyone can view announcement media"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'announcement-media');

CREATE POLICY "Users can delete own announcement media"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'announcement-media' AND (storage.foldername(name))[1] = auth.uid()::text);
