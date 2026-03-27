-- Fix issue_categories schema mismatches between backend and DB

-- 1. Rename escalation_rules → issue_escalation_rules (backend uses this name)
alter table escalation_rules rename to issue_escalation_rules;

-- Update the trigger name to match
alter trigger escalation_rules_updated_at on issue_escalation_rules rename to issue_escalation_rules_updated_at;

-- 2. Make organisation_id nullable (backend inserts don't always supply it)
alter table issue_escalation_rules alter column organisation_id drop not null;

-- 3. Add columns the backend model expects
alter table issue_escalation_rules
  add column if not exists trigger_status       text,
  add column if not exists escalate_to_role     text,
  add column if not exists escalate_to_user_id  uuid references profiles(id),
  add column if not exists notify_via_fcm       boolean default true,
  add column if not exists notify_via_email     boolean default false,
  add column if not exists sort_order           int     default 0;

-- 4. Fix issue_custom_fields: rename display_order → sort_order, add default
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'issue_custom_fields' and column_name = 'display_order'
  ) then
    alter table issue_custom_fields rename column display_order to sort_order;
  end if;
end $$;

alter table issue_custom_fields alter column sort_order set default 0;
alter table issue_custom_fields alter column sort_order drop not null;

-- 5. Update field_type check to also accept 'boolean' and 'select' values
alter table issue_custom_fields drop constraint if exists issue_custom_fields_field_type_check;
alter table issue_custom_fields
  add constraint issue_custom_fields_field_type_check
  check (field_type in ('text','number','dropdown','checkbox','date','boolean','select'));

-- 6. Re-enable RLS on renamed table (carried over, but ensure it's on)
alter table issue_escalation_rules enable row level security;
