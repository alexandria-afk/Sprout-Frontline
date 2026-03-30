-- AI Request Log
-- Tracks every AI call: provider, model, feature, tokens, latency, success
-- Used for cost monitoring and debugging.

create table if not exists ai_request_log (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid references organisations(id) on delete cascade,
  user_id          uuid references profiles(id) on delete set null,
  feature          text not null,           -- e.g. "issue_classification", "cap_suggestion"
  provider         text not null default 'anthropic',
  model            text not null,
  input_tokens     int,
  output_tokens    int,
  latency_ms       int,
  success          boolean not null default true,
  error_message    text,
  created_at       timestamptz not null default now()
);

create index idx_ai_request_log_org  on ai_request_log (organisation_id, created_at desc);
create index idx_ai_request_log_feat on ai_request_log (feature, created_at desc);

alter table ai_request_log enable row level security;

-- Service role can do everything (backend uses service key)
create policy "service_role_all_ai_log"
  on ai_request_log for all
  using (auth.role() = 'service_role');

-- Admins can read their org's logs
create policy "admins_read_ai_log"
  on ai_request_log for select
  using (
    organisation_id = (
      select (raw_app_meta_data->>'organisation_id')::uuid
      from auth.users where id = auth.uid()
    )
    and (select raw_app_meta_data->>'role' from auth.users where id = auth.uid())
      in ('admin', 'super_admin')
  );
