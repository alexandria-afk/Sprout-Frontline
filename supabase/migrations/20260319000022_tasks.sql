-- ── Task Management Tables ────────────────────────────────────────────────────

-- Task Templates (reusable task definitions)
create table task_templates (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) not null,
  created_by      uuid references profiles(id) not null,
  title           text not null,
  description     text,
  priority        text check (priority in ('low','medium','high','critical')) default 'medium',
  assign_to_role  text check (assign_to_role in ('manager','staff','admin')),
  recurrence      text check (recurrence in ('none','daily','weekly','custom')) default 'none',
  cron_expression text,
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  is_deleted      boolean default false
);

-- Tasks
create table tasks (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid references organisations(id) not null,
  location_id           uuid references locations(id),
  created_by            uuid references profiles(id) not null,
  template_id           uuid references task_templates(id),
  source_type           text check (source_type in ('manual','audit','workflow')) default 'manual',
  source_submission_id  uuid references form_submissions(id),
  source_field_id       uuid references form_fields(id),
  title                 text not null,
  description           text,
  priority              text check (priority in ('low','medium','high','critical')) not null default 'medium',
  status                text check (status in ('pending','in_progress','completed','overdue','cancelled')) not null default 'pending',
  due_at                timestamptz,
  completed_at          timestamptz,
  recurrence            text check (recurrence in ('none','daily','weekly','custom')) default 'none',
  cron_expression       text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  is_deleted            boolean default false
);

-- Task Assignees (individual or group/role assignment)
create table task_assignees (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references tasks(id) not null,
  user_id     uuid references profiles(id),
  assign_role text check (assign_role in ('manager','staff','admin')),
  assigned_at timestamptz default now(),
  is_deleted  boolean default false
);

-- Task Messages (per-task thread)
create table task_messages (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid references tasks(id) not null,
  user_id    uuid references profiles(id) not null,
  body       text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false
);

-- Task Attachments (photos, videos, documents)
create table task_attachments (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid references tasks(id) not null,
  uploaded_by   uuid references profiles(id) not null,
  file_url      text not null,
  file_type     text check (file_type in ('image','video','document')) not null,
  annotated_url text,
  created_at    timestamptz default now(),
  is_deleted    boolean default false
);

-- Task Status History (immutable audit trail)
create table task_status_history (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid references tasks(id) not null,
  changed_by      uuid references profiles(id) not null,
  previous_status text,
  new_status      text not null,
  changed_at      timestamptz default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index on task_templates(organisation_id);
create index on tasks(organisation_id);
create index on tasks(location_id);
create index on tasks(status);
create index on tasks(due_at);
create index on tasks(source_submission_id);
create index on task_assignees(task_id);
create index on task_assignees(user_id);
create index on task_messages(task_id);
create index on task_attachments(task_id);
create index on task_status_history(task_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table task_templates       enable row level security;
alter table tasks                enable row level security;
alter table task_assignees       enable row level security;
alter table task_messages        enable row level security;
alter table task_attachments     enable row level security;
alter table task_status_history  enable row level security;

-- task_templates: org managers+ manage; all org members read active templates
create policy "managers manage task_templates"
  on task_templates for all
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (select 1 from profiles where id = auth.uid() and role in ('manager','admin','super_admin'))
  );

create policy "org members read task_templates"
  on task_templates for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and is_active = true
    and is_deleted = false
  );

-- tasks: assignees and managers+ can read
create policy "task assignees and managers read tasks"
  on tasks for select
  using (
    created_by = auth.uid()
    or exists (
      select 1 from task_assignees
      where task_id = tasks.id and user_id = auth.uid() and is_deleted = false
    )
    or exists (
      select 1 from profiles
      where id = auth.uid() and role in ('manager','admin','super_admin')
      and organisation_id = tasks.organisation_id
    )
  );

create policy "all org members create tasks"
  on tasks for insert
  with check (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

create policy "task creator and managers update tasks"
  on tasks for update
  using (
    created_by = auth.uid()
    or exists (
      select 1 from profiles
      where id = auth.uid() and role in ('manager','admin','super_admin')
      and organisation_id = tasks.organisation_id
    )
    or exists (
      select 1 from task_assignees
      where task_id = tasks.id and user_id = auth.uid() and is_deleted = false
    )
  );

-- task_assignees: managers+ manage; task participants read
create policy "managers manage task_assignees"
  on task_assignees for all
  using (
    exists (
      select 1 from tasks t
      join profiles p on p.id = auth.uid()
      where t.id = task_assignees.task_id
      and p.role in ('manager','admin','super_admin')
      and p.organisation_id = t.organisation_id
    )
  );

create policy "task participants read assignees"
  on task_assignees for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from tasks t
      left join task_assignees ta on ta.task_id = t.id and ta.is_deleted = false
      where t.id = task_assignees.task_id
      and (t.created_by = auth.uid() or ta.user_id = auth.uid())
    )
  );

-- task_messages: task participants can read and insert
create policy "task participants read messages"
  on task_messages for select
  using (
    exists (
      select 1 from tasks t
      left join task_assignees ta on ta.task_id = t.id and ta.is_deleted = false
      where t.id = task_messages.task_id
      and (t.created_by = auth.uid() or ta.user_id = auth.uid())
    )
    or exists (
      select 1 from tasks t
      join profiles p on p.id = auth.uid()
      where t.id = task_messages.task_id
      and p.role in ('manager','admin','super_admin')
      and p.organisation_id = t.organisation_id
    )
  );

create policy "task participants post messages"
  on task_messages for insert
  with check (
    user_id = auth.uid()
    and (
      exists (
        select 1 from tasks t
        left join task_assignees ta on ta.task_id = t.id and ta.is_deleted = false
        where t.id = task_messages.task_id
        and (t.created_by = auth.uid() or ta.user_id = auth.uid())
      )
      or exists (
        select 1 from tasks t
        join profiles p on p.id = auth.uid()
        where t.id = task_messages.task_id
        and p.role in ('manager','admin','super_admin')
        and p.organisation_id = t.organisation_id
      )
    )
  );

-- task_attachments: task participants can read and upload
create policy "task participants read attachments"
  on task_attachments for select
  using (
    exists (
      select 1 from tasks t
      left join task_assignees ta on ta.task_id = t.id and ta.is_deleted = false
      where t.id = task_attachments.task_id
      and (t.created_by = auth.uid() or ta.user_id = auth.uid())
    )
    or exists (
      select 1 from tasks t
      join profiles p on p.id = auth.uid()
      where t.id = task_attachments.task_id
      and p.role in ('manager','admin','super_admin')
      and p.organisation_id = t.organisation_id
    )
  );

create policy "task participants upload attachments"
  on task_attachments for insert
  with check (
    uploaded_by = auth.uid()
  );

-- task_status_history: same read access as tasks
create policy "task participants read status history"
  on task_status_history for select
  using (
    exists (
      select 1 from tasks t
      left join task_assignees ta on ta.task_id = t.id and ta.is_deleted = false
      where t.id = task_status_history.task_id
      and (t.created_by = auth.uid() or ta.user_id = auth.uid())
    )
    or exists (
      select 1 from tasks t
      join profiles p on p.id = auth.uid()
      where t.id = task_status_history.task_id
      and p.role in ('manager','admin','super_admin')
      and p.organisation_id = t.organisation_id
    )
  );

create policy "task participants insert status history"
  on task_status_history for insert
  with check (changed_by = auth.uid());

-- ── Storage bucket for task attachments ──────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments',
  'task-attachments',
  false,
  52428800,  -- 50 MB
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

create policy "org members upload task attachments"
  on storage.objects for insert
  with check (
    bucket_id = 'task-attachments'
    and auth.role() = 'authenticated'
  );

create policy "org members read task attachments"
  on storage.objects for select
  using (
    bucket_id = 'task-attachments'
    and auth.role() = 'authenticated'
  );
