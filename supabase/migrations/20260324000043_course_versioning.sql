-- Phase 4 LMS: Course versioning + was_published state
-- Adds columns needed for Draft → Published → Unpublished (Archived) lifecycle

alter table courses
  add column if not exists version int not null default 1,
  add column if not exists parent_course_id uuid references courses(id) on delete set null,
  add column if not exists was_published boolean not null default false;

-- Back-fill: any currently-published course was_published = true
update courses set was_published = true where is_published = true;

-- Index for looking up version history by parent
create index if not exists idx_courses_parent_course_id on courses(parent_course_id)
  where parent_course_id is not null;
