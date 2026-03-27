-- Phase 3: Incidents table
create table if not exists incidents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid references organisations(id) on delete cascade not null,
  title            text not null,
  description      text,
  incident_date    timestamptz not null,
  severity         text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status           text not null default 'open' check (status in ('open','investigating','resolved','closed')),
  location_description text,
  people_involved  text,
  regulatory_body  text,
  reported_by      uuid references auth.users(id),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table incidents enable row level security;

create policy "incidents_select" on incidents
  for select using (org_id = get_user_org_id());

create policy "incidents_insert" on incidents
  for insert with check (org_id = get_user_org_id());

create policy "incidents_update" on incidents
  for update using (get_user_role() in ('admin','super_admin','manager'));
