-- Track when each user last read the messages for a task
-- Used to compute unread_message_count on the task list

create table if not exists task_message_reads (
  task_id      uuid references tasks(id) on delete cascade not null,
  user_id      uuid references profiles(id) on delete cascade not null,
  last_read_at timestamptz default now() not null,
  primary key (task_id, user_id)
);

create index if not exists task_message_reads_user_idx on task_message_reads(user_id);
