-- Phase 3: Issues, Maintenance, Vendors, Safety Gamification
-- Tables are ordered by dependency

-- ── Vendors ──────────────────────────────────────────────────────────────────
create table vendors (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) not null,
  name            text not null,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  is_deleted      boolean default false
);

create trigger vendors_updated_at
  before update on vendors
  for each row execute function set_updated_at();

-- ── Issue Categories ─────────────────────────────────────────────────────────
create table issue_categories (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) not null,
  name            text not null,
  description     text,
  color           text,
  icon            text,
  sla_hours       int default 24,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  is_deleted      boolean default false
);

create trigger issue_categories_updated_at
  before update on issue_categories
  for each row execute function set_updated_at();

-- ── Issue Custom Fields ──────────────────────────────────────────────────────
create table issue_custom_fields (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid references issue_categories(id) not null,
  label         text not null,
  field_type    text check (field_type in ('text','number','dropdown','checkbox','date')) not null,
  options       jsonb,
  is_required   boolean default false,
  display_order int not null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  is_deleted    boolean default false
);

create trigger issue_custom_fields_updated_at
  before update on issue_custom_fields
  for each row execute function set_updated_at();

-- ── Escalation Rules ─────────────────────────────────────────────────────────
create table escalation_rules (
  id                uuid primary key default gen_random_uuid(),
  category_id       uuid references issue_categories(id) not null,
  organisation_id   uuid references organisations(id) not null,
  trigger_type      text check (trigger_type in (
    'on_create',
    'sla_breach',
    'priority_critical',
    'status_change',
    'unresolved_hours'
  )) not null,
  trigger_value     int,
  notify_role       text check (notify_role in ('manager','admin','super_admin','vendor')),
  notify_user_id    uuid references profiles(id),
  notify_vendor_id  uuid references vendors(id),
  escalation_order  int default 0,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  is_deleted        boolean default false
);

create trigger escalation_rules_updated_at
  before update on escalation_rules
  for each row execute function set_updated_at();

-- ── Issues ───────────────────────────────────────────────────────────────────
create table issues (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid references organisations(id) not null,
  location_id           uuid references locations(id) not null,
  category_id           uuid references issue_categories(id),
  reported_by           uuid references profiles(id) not null,
  assigned_to           uuid references profiles(id),
  assigned_vendor_id    uuid references vendors(id),
  title                 text not null,
  description           text,
  priority              text check (priority in ('low','medium','high','critical')) not null default 'medium',
  status                text check (status in ('open','in_progress','pending_vendor','resolved','closed')) not null default 'open',
  location_description  text,
  recurrence_count      int default 0,
  due_at                timestamptz,
  resolved_at           timestamptz,
  resolution_note       text,
  cost                  numeric,
  -- Phase 6 AI enrichment (stubbed)
  ai_description        text,
  ai_suggested_category text,
  ai_suggested_priority text,
  ai_confidence_score   numeric,
  ai_flagged_safety     boolean default false,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  is_deleted            boolean default false
);

create trigger issues_updated_at
  before update on issues
  for each row execute function set_updated_at();

-- ── Issue Custom Field Responses ─────────────────────────────────────────────
create table issue_custom_responses (
  id              uuid primary key default gen_random_uuid(),
  issue_id        uuid references issues(id) not null,
  custom_field_id uuid references issue_custom_fields(id) not null,
  value           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  is_deleted      boolean default false
);

create trigger issue_custom_responses_updated_at
  before update on issue_custom_responses
  for each row execute function set_updated_at();

-- ── Issue Attachments ────────────────────────────────────────────────────────
create table issue_attachments (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid references issues(id) not null,
  uploaded_by uuid references profiles(id) not null,
  file_url    text not null,
  file_type   text check (file_type in ('image','video')) not null,
  created_at  timestamptz default now(),
  is_deleted  boolean default false
);

-- ── Issue Comments ───────────────────────────────────────────────────────────
create table issue_comments (
  id               uuid primary key default gen_random_uuid(),
  issue_id         uuid references issues(id) not null,
  user_id          uuid references profiles(id),
  vendor_id        uuid references vendors(id),
  body             text not null,
  is_vendor_visible boolean default true,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  is_deleted       boolean default false
);

create trigger issue_comments_updated_at
  before update on issue_comments
  for each row execute function set_updated_at();

-- ── Issue Status History ─────────────────────────────────────────────────────
create table issue_status_history (
  id              uuid primary key default gen_random_uuid(),
  issue_id        uuid references issues(id) not null,
  changed_by      uuid references profiles(id),
  previous_status text,
  new_status      text not null,
  comment         text,
  changed_at      timestamptz default now()
);

-- ── Vendor Category Access ───────────────────────────────────────────────────
create table vendor_category_access (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid references vendors(id) not null,
  category_id uuid references issue_categories(id) not null,
  created_at  timestamptz default now(),
  is_deleted  boolean default false,
  unique (vendor_id, category_id)
);

-- ── Assets ───────────────────────────────────────────────────────────────────
create table assets (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid references organisations(id) not null,
  location_id              uuid references locations(id) not null,
  name                     text not null,
  category                 text not null,
  serial_number            text,
  model                    text,
  manufacturer             text,
  installed_at             timestamptz,
  last_maintenance_at      timestamptz,
  next_maintenance_due_at  timestamptz,
  total_repair_cost        numeric default 0,
  -- Phase 6 AI fields (stubbed)
  predicted_days_to_failure int,
  failure_risk_score        numeric,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now(),
  is_deleted               boolean default false
);

create trigger assets_updated_at
  before update on assets
  for each row execute function set_updated_at();

-- ── Repair Guides ────────────────────────────────────────────────────────────
create table repair_guides (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) not null,
  asset_id        uuid references assets(id),
  category_id     uuid references issue_categories(id),
  title           text not null,
  guide_type      text check (guide_type in ('pdf','video','audio','text')) not null,
  file_url        text,
  content         text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  is_deleted      boolean default false
);

create trigger repair_guides_updated_at
  before update on repair_guides
  for each row execute function set_updated_at();

-- ── Maintenance Tickets ──────────────────────────────────────────────────────
create table maintenance_tickets (
  id                 uuid primary key default gen_random_uuid(),
  asset_id           uuid references assets(id) not null,
  issue_id           uuid references issues(id),
  organisation_id    uuid references organisations(id) not null,
  location_id        uuid references locations(id) not null,
  reported_by        uuid references profiles(id) not null,
  assigned_to        uuid references profiles(id),
  assigned_vendor_id uuid references vendors(id),
  ticket_type        text check (ticket_type in ('repair','preventive','inspection')) not null default 'repair',
  title              text not null,
  description        text,
  priority           text check (priority in ('low','medium','high','critical')) not null default 'medium',
  status             text check (status in ('open','in_progress','pending_vendor','resolved','closed')) not null default 'open',
  sla_hours          int default 24,
  due_at             timestamptz,
  resolved_at        timestamptz,
  resolution_note    text,
  cost               numeric,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  is_deleted         boolean default false
);

create trigger maintenance_tickets_updated_at
  before update on maintenance_tickets
  for each row execute function set_updated_at();

-- ── Safety Badges ────────────────────────────────────────────────────────────
create table safety_badges (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) not null,
  name            text not null,
  description     text,
  icon            text,
  points          int default 0,
  criteria_type   text check (criteria_type in (
    'issues_reported',
    'issues_resolved',
    'streak_days',
    'manual'
  )) not null,
  criteria_value  int,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  is_deleted      boolean default false
);

create trigger safety_badges_updated_at
  before update on safety_badges
  for each row execute function set_updated_at();

-- ── User Badge Awards ────────────────────────────────────────────────────────
create table user_badge_awards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references profiles(id) not null,
  badge_id   uuid references safety_badges(id) not null,
  awarded_by uuid references profiles(id),
  awarded_at timestamptz default now(),
  is_deleted boolean default false
);

-- ── Safety Points ────────────────────────────────────────────────────────────
create table safety_points (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references profiles(id) not null unique,
  organisation_id uuid references organisations(id) not null,
  total_points    int default 0,
  issues_reported int default 0,
  issues_resolved int default 0,
  updated_at      timestamptz default now()
);

-- ── Notification Log ─────────────────────────────────────────────────────────
create table notification_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references profiles(id),
  vendor_id     uuid references vendors(id),
  title         text not null,
  body          text not null,
  data          jsonb,
  sent_at       timestamptz default now(),
  success       boolean default true,
  error_message text
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index on issue_categories(organisation_id);
create index on issue_custom_fields(category_id);
create index on escalation_rules(category_id);
create index on issues(organisation_id);
create index on issues(location_id);
create index on issues(category_id);
create index on issues(assigned_to);
create index on issues(status);
create index on issues(priority);
create index on issues(recurrence_count);
create index on issue_attachments(issue_id);
create index on issue_comments(issue_id);
create index on issue_status_history(issue_id);
create index on vendors(organisation_id);
create index on vendor_category_access(vendor_id);
create index on assets(organisation_id);
create index on assets(location_id);
create index on maintenance_tickets(asset_id);
create index on maintenance_tickets(assigned_to);
create index on maintenance_tickets(status);
create index on safety_badges(organisation_id);
create index on user_badge_awards(user_id);
create index on safety_points(user_id);
create index on notification_log(user_id);
