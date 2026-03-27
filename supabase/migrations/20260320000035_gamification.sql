-- Drop old Phase 3 gamification tables if they exist (replaced by proper schema)
drop table if exists user_badge_awards cascade;
drop table if exists safety_points cascade;
drop table if exists safety_badges cascade;

-- Leaderboard configurations
create table leaderboard_configs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) not null,
  name text not null,
  description text,
  metric_type text check (metric_type in (
    'issues_reported','issues_resolved','checklists_completed',
    'checklist_streak_days','audit_score_avg','audit_perfect_scores',
    'training_completed','training_score_avg','attendance_punctuality',
    'tasks_completed','points_total'
  )) not null,
  scope text check (scope in ('location','organisation')) default 'location',
  time_window text check (time_window in ('weekly','monthly','quarterly','all_time')) default 'monthly',
  is_active boolean default true,
  is_template boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Badge configurations
create table badge_configs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) not null,
  name text not null,
  description text,
  icon text,
  points_awarded int default 0,
  is_template boolean default false,
  is_active boolean default true,
  criteria_type text check (criteria_type in (
    'issues_reported','issues_resolved','checklist_streak_days',
    'checklists_completed','audit_perfect_score','audit_score_improvement',
    'training_completed','training_perfect_score','attendance_streak_days',
    'tasks_completed','points_total','manual'
  )) not null,
  criteria_value int,
  criteria_window text check (criteria_window in ('all_time','rolling_30_days','rolling_7_days')) default 'all_time',
  scope text check (scope in ('individual','team')) default 'individual',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- User badge awards
create table user_badge_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) not null,
  badge_id uuid references badge_configs(id) not null,
  organisation_id uuid references organisations(id) not null,
  awarded_by uuid references profiles(id),
  awarded_at timestamptz default now(),
  is_deleted boolean default false
);

-- User points ledger
create table user_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) not null unique,
  organisation_id uuid references organisations(id) not null,
  total_points int default 0,
  issues_reported int default 0,
  issues_resolved int default 0,
  checklists_completed int default 0,
  checklist_current_streak int default 0,
  checklist_longest_streak int default 0,
  audits_completed int default 0,
  audit_perfect_scores int default 0,
  training_completed int default 0,
  tasks_completed int default 0,
  attendance_current_streak int default 0,
  attendance_longest_streak int default 0,
  updated_at timestamptz default now()
);

-- Indexes
create index on leaderboard_configs(organisation_id);
create index on badge_configs(organisation_id);
create index on badge_configs(criteria_type);
create index on user_badge_awards(user_id);
create index on user_badge_awards(badge_id);
create index on user_points(user_id);
create index on user_points(organisation_id);
create index on user_points(total_points desc);

-- RLS
alter table leaderboard_configs enable row level security;
alter table badge_configs enable row level security;
alter table user_badge_awards enable row level security;
alter table user_points enable row level security;

create policy "org members read leaderboard configs" on leaderboard_configs for select
  using (organisation_id = (select organisation_id from profiles where id = auth.uid()));
create policy "admin manages leaderboard configs" on leaderboard_configs for all
  using (organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (select 1 from profiles where id = auth.uid() and role in ('admin','super_admin')));

create policy "org members read badge configs" on badge_configs for select
  using (organisation_id = (select organisation_id from profiles where id = auth.uid()));
create policy "admin manages badge configs" on badge_configs for all
  using (organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (select 1 from profiles where id = auth.uid() and role in ('admin','super_admin')));

create policy "org members read badge awards" on user_badge_awards for select
  using (organisation_id = (select organisation_id from profiles where id = auth.uid()));
create policy "manager awards badge" on user_badge_awards for insert
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('manager','admin','super_admin')));
create policy "service role manages badge awards" on user_badge_awards for all
  using (auth.role() = 'service_role');

create policy "org members read points" on user_points for select
  using (organisation_id = (select organisation_id from profiles where id = auth.uid()));
create policy "service role manages points" on user_points for all
  using (auth.role() = 'service_role');
