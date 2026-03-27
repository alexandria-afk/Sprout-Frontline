-- Phase 3 RLS Policies

-- Enable RLS on all Phase 3 tables
alter table issue_categories       enable row level security;
alter table issue_custom_fields    enable row level security;
alter table escalation_rules       enable row level security;
alter table issues                 enable row level security;
alter table issue_custom_responses enable row level security;
alter table issue_attachments      enable row level security;
alter table issue_comments         enable row level security;
alter table issue_status_history   enable row level security;
alter table vendors                enable row level security;
alter table vendor_category_access enable row level security;
alter table assets                 enable row level security;
alter table repair_guides          enable row level security;
alter table maintenance_tickets    enable row level security;
alter table safety_badges          enable row level security;
alter table user_badge_awards      enable row level security;
alter table safety_points          enable row level security;
alter table notification_log       enable row level security;

-- ── Issue Categories ─────────────────────────────────────────────────────────
-- All org members can read categories
create policy "org members read issue categories"
  on issue_categories for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

-- Admins+ can insert/update/delete categories
create policy "admin manages issue categories"
  on issue_categories for insert
  with check (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );

create policy "admin updates issue categories"
  on issue_categories for update
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );

create policy "admin deletes issue categories"
  on issue_categories for delete
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );

-- ── Issue Custom Fields ──────────────────────────────────────────────────────
create policy "org members read issue custom fields"
  on issue_custom_fields for select
  using (
    exists (
      select 1 from issue_categories ic
      join profiles p on p.organisation_id = ic.organisation_id
      where ic.id = issue_custom_fields.category_id
      and p.id = auth.uid()
    )
  );

create policy "admin manages issue custom fields"
  on issue_custom_fields for all
  using (
    exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );

-- ── Escalation Rules ─────────────────────────────────────────────────────────
create policy "org admins read escalation rules"
  on escalation_rules for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );

create policy "org admins manage escalation rules"
  on escalation_rules for all
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );

-- ── Issues ───────────────────────────────────────────────────────────────────
-- Org members at same location can read issues
create policy "location members read issues"
  on issues for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and location_id = (select location_id from profiles where id = auth.uid())
  );

-- Managers+ can read all issues in their org (for dashboard)
create policy "managers read all org issues"
  on issues for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('manager','admin','super_admin')
    )
  );

-- All org members can create issues
create policy "org members create issues"
  on issues for insert
  with check (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

-- Reporter, assignee, or manager can update
create policy "reporter or assignee can update issue"
  on issues for update
  using (
    reported_by = auth.uid()
    or assigned_to = auth.uid()
    or exists (
      select 1 from profiles
      where id = auth.uid() and role in ('manager','admin','super_admin')
    )
  );

-- ── Issue Custom Responses ───────────────────────────────────────────────────
create policy "location members read issue custom responses"
  on issue_custom_responses for select
  using (
    exists (
      select 1 from issues i
      join profiles p on p.id = auth.uid()
      where i.id = issue_custom_responses.issue_id
      and i.location_id = p.location_id
    )
  );

create policy "org members manage issue custom responses"
  on issue_custom_responses for all
  using (
    exists (
      select 1 from issues i
      join profiles p on p.id = auth.uid()
      where i.id = issue_custom_responses.issue_id
      and i.organisation_id = p.organisation_id
    )
  );

-- ── Issue Attachments ────────────────────────────────────────────────────────
create policy "location members read issue attachments"
  on issue_attachments for select
  using (
    exists (
      select 1 from issues i
      join profiles p on p.id = auth.uid()
      where i.id = issue_attachments.issue_id
      and i.location_id = p.location_id
    )
  );

create policy "org members insert issue attachments"
  on issue_attachments for insert
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from issues i
      join profiles p on p.id = auth.uid()
      where i.id = issue_attachments.issue_id
      and i.organisation_id = p.organisation_id
    )
  );

-- ── Issue Comments ───────────────────────────────────────────────────────────
create policy "location members read issue comments"
  on issue_comments for select
  using (
    exists (
      select 1 from issues i
      join profiles p on p.id = auth.uid()
      where i.id = issue_comments.issue_id
      and i.location_id = p.location_id
    )
  );

create policy "org members create issue comments"
  on issue_comments for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from issues i
      join profiles p on p.id = auth.uid()
      where i.id = issue_comments.issue_id
      and i.organisation_id = p.organisation_id
    )
  );

create policy "own comments can be deleted"
  on issue_comments for update
  using (user_id = auth.uid());

-- ── Issue Status History ─────────────────────────────────────────────────────
create policy "location members read issue status history"
  on issue_status_history for select
  using (
    exists (
      select 1 from issues i
      join profiles p on p.id = auth.uid()
      where i.id = issue_status_history.issue_id
      and i.location_id = p.location_id
    )
  );

create policy "org members insert issue status history"
  on issue_status_history for insert
  with check (
    exists (
      select 1 from issues i
      join profiles p on p.id = auth.uid()
      where i.id = issue_status_history.issue_id
      and i.organisation_id = p.organisation_id
    )
  );

-- ── Vendors ──────────────────────────────────────────────────────────────────
create policy "org admin manages vendors"
  on vendors for all
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );

-- Managers can read vendors (needed for assignment)
create policy "managers read vendors"
  on vendors for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('manager','admin','super_admin')
    )
  );

-- ── Vendor Category Access ───────────────────────────────────────────────────
create policy "org admin manages vendor category access"
  on vendor_category_access for all
  using (
    exists (
      select 1 from vendors v
      join profiles p on p.organisation_id = v.organisation_id
      where v.id = vendor_category_access.vendor_id
      and p.id = auth.uid()
      and p.role in ('admin','super_admin')
    )
  );

-- ── Assets ───────────────────────────────────────────────────────────────────
create policy "location members read assets"
  on assets for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and location_id = (select location_id from profiles where id = auth.uid())
  );

-- Managers+ can read all org assets
create policy "managers read all org assets"
  on assets for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('manager','admin','super_admin')
    )
  );

create policy "admin manages assets"
  on assets for all
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );

-- ── Repair Guides ────────────────────────────────────────────────────────────
create policy "org members read repair guides"
  on repair_guides for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

create policy "admin manages repair guides"
  on repair_guides for all
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );

-- ── Maintenance Tickets ──────────────────────────────────────────────────────
create policy "location members read tickets"
  on maintenance_tickets for select
  using (
    location_id = (select location_id from profiles where id = auth.uid())
  );

-- Managers+ can read all org tickets
create policy "managers read all org tickets"
  on maintenance_tickets for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('manager','admin','super_admin')
    )
  );

create policy "org members create tickets"
  on maintenance_tickets for insert
  with check (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

create policy "assignee or manager updates ticket"
  on maintenance_tickets for update
  using (
    assigned_to = auth.uid()
    or reported_by = auth.uid()
    or exists (
      select 1 from profiles where id = auth.uid()
      and role in ('manager','admin','super_admin')
    )
  );

-- ── Safety Badges ────────────────────────────────────────────────────────────
create policy "org members read safety badges"
  on safety_badges for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

create policy "admin manages safety badges"
  on safety_badges for all
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );

-- ── User Badge Awards ────────────────────────────────────────────────────────
create policy "org members read badge awards"
  on user_badge_awards for select
  using (
    exists (
      select 1 from safety_badges sb
      join profiles p on p.organisation_id = sb.organisation_id
      where sb.id = user_badge_awards.badge_id
      and p.id = auth.uid()
    )
  );

create policy "manager+ awards badges"
  on user_badge_awards for insert
  with check (
    exists (
      select 1 from profiles where id = auth.uid()
      and role in ('manager','admin','super_admin')
    )
  );

-- ── Safety Points ────────────────────────────────────────────────────────────
create policy "org members read safety points"
  on safety_points for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

-- Service role (Edge Functions) writes safety points
create policy "service role manages safety points"
  on safety_points for all
  using (auth.role() = 'service_role');

-- ── Notification Log ─────────────────────────────────────────────────────────
create policy "admin reads notification log"
  on notification_log for select
  using (
    exists (
      select 1 from profiles where id = auth.uid()
      and role in ('admin','super_admin')
    )
  );

create policy "service role manages notification log"
  on notification_log for all
  using (auth.role() = 'service_role');
