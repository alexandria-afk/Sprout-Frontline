-- Phase 4: LMS (Learning Management System)
-- Migration: 20260324000042_phase4_lms.sql

-- Courses
create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) not null,
  created_by uuid references profiles(id) not null,
  title text not null,
  description text,
  thumbnail_url text,
  estimated_duration_mins int,
  passing_score int not null default 80,
  max_retakes int default 3,
  cert_validity_days int,
  is_mandatory boolean default false,
  target_roles jsonb default '[]',
  target_location_ids jsonb default '[]',
  is_published boolean default false,
  is_active boolean default true,
  ai_generated boolean default false,
  language text default 'en',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Course Modules
create table if not exists course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) not null,
  title text not null,
  module_type text check (module_type in ('slides','video','pdf','quiz')) not null,
  content_url text,
  display_order int not null default 0,
  is_required boolean default true,
  estimated_duration_mins int,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Slides
create table if not exists course_slides (
  id uuid primary key default gen_random_uuid(),
  module_id uuid references course_modules(id) not null,
  title text,
  body text,
  image_url text,
  display_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Quiz Questions
create table if not exists quiz_questions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid references course_modules(id) not null,
  question text not null,
  question_type text check (question_type in ('multiple_choice','true_false','image_based')) not null default 'multiple_choice',
  image_url text,
  options jsonb not null default '[]',
  explanation text,
  display_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Course Enrollments
create table if not exists course_enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) not null,
  user_id uuid references profiles(id) not null,
  organisation_id uuid references organisations(id) not null,
  enrolled_by uuid references profiles(id),
  status text check (status in ('not_started','in_progress','passed','failed')) default 'not_started',
  score int,
  attempt_count int default 0,
  started_at timestamptz,
  completed_at timestamptz,
  cert_issued_at timestamptz,
  cert_expires_at timestamptz,
  cert_url text,
  current_module_id uuid references course_modules(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Module Progress
create table if not exists module_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid references course_enrollments(id) not null,
  module_id uuid references course_modules(id) not null,
  status text check (status in ('not_started','in_progress','completed')) default 'not_started',
  started_at timestamptz,
  completed_at timestamptz,
  time_spent_seconds int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Quiz Attempts
create table if not exists quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid references course_enrollments(id) not null,
  module_id uuid references course_modules(id) not null,
  attempt_number int not null default 1,
  score int not null,
  passed boolean not null,
  answers jsonb not null default '[]',
  knowledge_gaps jsonb,
  started_at timestamptz default now(),
  completed_at timestamptz,
  created_at timestamptz default now()
);

-- Learning Paths
create table if not exists learning_paths (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) not null,
  user_id uuid references profiles(id) not null,
  generated_by_ai boolean default false,
  status text check (status in ('active','completed','abandoned')) default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Learning Path Items
create table if not exists learning_path_items (
  id uuid primary key default gen_random_uuid(),
  learning_path_id uuid references learning_paths(id) not null,
  course_id uuid references courses(id) not null,
  display_order int not null default 0,
  reason text,
  is_completed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- AI Course Generation Jobs
create table if not exists ai_course_jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) not null,
  created_by uuid references profiles(id) not null,
  input_type text check (input_type in ('topic','document','video','url')) not null,
  input_data text,
  input_file_url text,
  status text check (status in ('queued','processing','completed','failed')) default 'queued',
  result_course_id uuid references courses(id),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Course Translations
create table if not exists course_translations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) not null,
  language text not null,
  translated_content jsonb not null default '{}',
  ai_generated boolean default true,
  reviewed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index if not exists idx_courses_org on courses(organisation_id);
create index if not exists idx_courses_published on courses(is_published, is_deleted);
create index if not exists idx_course_modules_course on course_modules(course_id, display_order);
create index if not exists idx_course_slides_module on course_slides(module_id, display_order);
create index if not exists idx_quiz_questions_module on quiz_questions(module_id, display_order);
create index if not exists idx_enrollments_course on course_enrollments(course_id);
create index if not exists idx_enrollments_user on course_enrollments(user_id);
create index if not exists idx_enrollments_status on course_enrollments(status);
create index if not exists idx_enrollments_cert_expires on course_enrollments(cert_expires_at);
create index if not exists idx_module_progress_enrollment on module_progress(enrollment_id);
create index if not exists idx_quiz_attempts_enrollment on quiz_attempts(enrollment_id);
create index if not exists idx_learning_paths_user on learning_paths(user_id);
create index if not exists idx_ai_course_jobs_status on ai_course_jobs(organisation_id, status);

-- RLS
alter table courses enable row level security;
alter table course_modules enable row level security;
alter table course_slides enable row level security;
alter table quiz_questions enable row level security;
alter table course_enrollments enable row level security;
alter table module_progress enable row level security;
alter table quiz_attempts enable row level security;
alter table learning_paths enable row level security;
alter table learning_path_items enable row level security;
alter table ai_course_jobs enable row level security;
alter table course_translations enable row level security;

-- RLS Policies (service role bypass)
create policy "service role bypass" on courses for all to service_role using (true);
create policy "service role bypass" on course_modules for all to service_role using (true);
create policy "service role bypass" on course_slides for all to service_role using (true);
create policy "service role bypass" on quiz_questions for all to service_role using (true);
create policy "service role bypass" on course_enrollments for all to service_role using (true);
create policy "service role bypass" on module_progress for all to service_role using (true);
create policy "service role bypass" on quiz_attempts for all to service_role using (true);
create policy "service role bypass" on learning_paths for all to service_role using (true);
create policy "service role bypass" on learning_path_items for all to service_role using (true);
create policy "service role bypass" on ai_course_jobs for all to service_role using (true);
create policy "service role bypass" on course_translations for all to service_role using (true);
