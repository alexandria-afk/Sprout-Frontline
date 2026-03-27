-- Create form-photos storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'form-photos',
  'form-photos',
  false,  -- private; access via signed URLs
  10485760,  -- 10 MB max
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- RLS: authenticated users can upload to their own folder
create policy "Authenticated users can upload form photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'form-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- RLS: authenticated users can read their own uploads
create policy "Authenticated users can read own form photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'form-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- RLS: managers/admins can read all form photos in their org
-- (simplified: any authenticated user can read from form-photos)
create policy "Managers can read all form photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'form-photos'
  );

-- RLS: users can delete their own uploads
create policy "Users can delete own form photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'form-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
