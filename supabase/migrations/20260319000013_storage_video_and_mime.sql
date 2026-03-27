-- Allow video MIME types and increase size limit for announcement media
UPDATE storage.buckets
SET
  file_size_limit  = 104857600,  -- 100 MB
  allowed_mime_types = array[
    'image/jpeg','image/jpg','image/png','image/webp','image/heic',
    'video/mp4','video/quicktime','video/webm','video/x-m4v'
  ]
WHERE id = 'form-photos';
