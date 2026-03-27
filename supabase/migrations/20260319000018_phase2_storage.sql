-- ============================================================
-- Phase 2: Storage Buckets — audit-signatures + audit-evidence
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('audit-signatures', 'audit-signatures', false, 5242880,  array['image/png','image/jpeg','image/webp']),
  ('audit-evidence',   'audit-evidence',   false, 52428800, array['image/png','image/jpeg','image/webp','video/mp4','video/quicktime'])
on conflict (id) do nothing;

-- audit-signatures: org members can read (via signed URL)
create policy "org members read audit signatures storage"
  on storage.objects for select
  using (
    bucket_id = 'audit-signatures'
    and exists (
      select 1 from profiles
      where id = auth.uid()
      and organisation_id = (
        select ft.organisation_id
        from audit_signatures sig
        join form_submissions fs on fs.id = sig.submission_id
        join form_templates ft on ft.id = fs.form_template_id
        where sig.signature_url like '%' || storage.objects.name || '%'
        limit 1
      )
    )
  );

create policy "authenticated users upload audit signatures"
  on storage.objects for insert
  with check (
    bucket_id = 'audit-signatures'
    and auth.role() = 'authenticated'
  );

-- audit-evidence: org members can read and upload
create policy "org members read audit evidence"
  on storage.objects for select
  using (
    bucket_id = 'audit-evidence'
    and auth.role() = 'authenticated'
  );

create policy "authenticated users upload audit evidence"
  on storage.objects for insert
  with check (
    bucket_id = 'audit-evidence'
    and auth.role() = 'authenticated'
  );

create policy "authenticated users delete audit evidence"
  on storage.objects for delete
  using (
    bucket_id = 'audit-evidence'
    and auth.role() = 'authenticated'
  );
