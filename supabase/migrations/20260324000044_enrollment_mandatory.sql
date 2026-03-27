-- Add is_mandatory flag to course enrollments
alter table course_enrollments
  add column if not exists is_mandatory boolean not null default false;
