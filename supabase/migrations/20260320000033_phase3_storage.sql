-- Phase 3 Storage Buckets: issue-media and repair-guides

-- ── issue-media ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'issue-media',
  'issue-media',
  false,       -- private; always use signed URLs
  52428800,    -- 50 MB max
  array[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do nothing;

-- Org members can upload issue media (folder = user_id/)
create policy "Org members upload issue media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'issue-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Org members can read issue media (simplified: any authenticated user in org)
create policy "Org members read issue media"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'issue-media'
  );

-- Uploader can delete their own issue media
create policy "Uploader deletes own issue media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'issue-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── repair-guides ────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'repair-guides',
  'repair-guides',
  false,       -- private; always use signed URLs
  52428800,    -- 50 MB max
  array[
    'application/pdf',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/mp4', 'audio/wav'
  ]
)
on conflict (id) do nothing;

-- Admins can upload repair guides
create policy "Admin uploads repair guides"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'repair-guides'
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );

-- All org members can read repair guides
create policy "Org members read repair guides storage"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'repair-guides'
  );

-- Admins can delete repair guides
create policy "Admin deletes repair guides"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'repair-guides'
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );
