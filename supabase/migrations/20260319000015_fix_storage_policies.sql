-- Idempotent re-creation of announcement-media storage policies
-- Safe to run multiple times; guards against duplicate-policy errors from migration 20260319000014
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can upload announcement media'
  ) THEN
    CREATE POLICY "Authenticated users can upload announcement media"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'announcement-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Anyone can view announcement media'
  ) THEN
    CREATE POLICY "Anyone can view announcement media"
      ON storage.objects FOR SELECT TO public
      USING (bucket_id = 'announcement-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users can delete own announcement media'
  ) THEN
    CREATE POLICY "Users can delete own announcement media"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'announcement-media' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
END $$;
