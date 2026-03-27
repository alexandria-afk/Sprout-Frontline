-- ============================================================
-- Phase 2: RLS Policies
-- ============================================================

-- Enable RLS on all Phase 2 tables
alter table audit_configs enable row level security;
alter table audit_section_weights enable row level security;
alter table audit_field_scores enable row level security;
alter table corrective_actions enable row level security;
alter table audit_signatures enable row level security;
alter table workflow_definitions enable row level security;
alter table workflow_stages enable row level security;
alter table workflow_routing_rules enable row level security;
alter table workflow_instances enable row level security;
alter table workflow_stage_instances enable row level security;

-- -------------------------
-- audit_configs
-- -------------------------
create policy "org members read audit_configs"
  on audit_configs for select
  using (
    exists (
      select 1 from form_templates ft
      join profiles p on p.id = auth.uid()
      where ft.id = audit_configs.form_template_id
      and ft.organisation_id = p.organisation_id
    )
  );

create policy "managers manage audit_configs"
  on audit_configs for all
  using (
    exists (
      select 1 from form_templates ft
      join profiles p on p.id = auth.uid()
      where ft.id = audit_configs.form_template_id
      and ft.organisation_id = p.organisation_id
      and p.role in ('manager','admin','super_admin')
    )
  );

-- -------------------------
-- audit_section_weights
-- -------------------------
create policy "org members read section weights"
  on audit_section_weights for select
  using (
    exists (
      select 1 from form_sections fs
      join form_templates ft on ft.id = fs.form_template_id
      join profiles p on p.id = auth.uid()
      where fs.id = audit_section_weights.section_id
      and ft.organisation_id = p.organisation_id
    )
  );

create policy "managers manage section weights"
  on audit_section_weights for all
  using (
    exists (
      select 1 from form_sections fs
      join form_templates ft on ft.id = fs.form_template_id
      join profiles p on p.id = auth.uid()
      where fs.id = audit_section_weights.section_id
      and ft.organisation_id = p.organisation_id
      and p.role in ('manager','admin','super_admin')
    )
  );

-- -------------------------
-- audit_field_scores
-- -------------------------
create policy "org members read field scores"
  on audit_field_scores for select
  using (
    exists (
      select 1 from form_fields ff
      join form_sections fs on fs.id = ff.section_id
      join form_templates ft on ft.id = fs.form_template_id
      join profiles p on p.id = auth.uid()
      where ff.id = audit_field_scores.field_id
      and ft.organisation_id = p.organisation_id
    )
  );

create policy "managers manage field scores"
  on audit_field_scores for all
  using (
    exists (
      select 1 from form_fields ff
      join form_sections fs on fs.id = ff.section_id
      join form_templates ft on ft.id = fs.form_template_id
      join profiles p on p.id = auth.uid()
      where ff.id = audit_field_scores.field_id
      and ft.organisation_id = p.organisation_id
      and p.role in ('manager','admin','super_admin')
    )
  );

-- -------------------------
-- corrective_actions
-- -------------------------
create policy "location members read corrective actions"
  on corrective_actions for select
  using (
    location_id = (select location_id from profiles where id = auth.uid())
    or exists (
      select 1 from profiles
      where id = auth.uid() and role in ('manager','admin','super_admin')
      and organisation_id = corrective_actions.organisation_id
    )
  );

create policy "managers insert corrective actions"
  on corrective_actions for insert
  with check (
    exists (
      select 1 from profiles
      where id = auth.uid()
      and organisation_id = corrective_actions.organisation_id
    )
  );

create policy "assigned or manager can update corrective action"
  on corrective_actions for update
  using (
    assigned_to = auth.uid()
    or exists (
      select 1 from profiles
      where id = auth.uid() and role in ('manager','admin','super_admin')
      and organisation_id = corrective_actions.organisation_id
    )
  );

-- -------------------------
-- audit_signatures
-- -------------------------
create policy "location members read signatures"
  on audit_signatures for select
  using (
    exists (
      select 1 from form_submissions fs
      join form_templates ft on ft.id = fs.form_template_id
      join profiles p on p.id = auth.uid()
      where fs.id = audit_signatures.submission_id
      and ft.organisation_id = p.organisation_id
    )
  );

create policy "authenticated users insert signatures"
  on audit_signatures for insert
  with check (signed_by = auth.uid());

-- -------------------------
-- workflow_definitions
-- -------------------------
create policy "org members read workflow definitions"
  on workflow_definitions for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

create policy "admins manage workflow definitions"
  on workflow_definitions for all
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles
      where id = auth.uid() and role in ('admin','super_admin')
    )
  );

-- -------------------------
-- workflow_stages
-- -------------------------
create policy "org members read workflow stages"
  on workflow_stages for select
  using (
    exists (
      select 1 from workflow_definitions wd
      join profiles p on p.id = auth.uid()
      where wd.id = workflow_stages.workflow_definition_id
      and wd.organisation_id = p.organisation_id
    )
  );

create policy "admins manage workflow stages"
  on workflow_stages for all
  using (
    exists (
      select 1 from workflow_definitions wd
      join profiles p on p.id = auth.uid()
      where wd.id = workflow_stages.workflow_definition_id
      and wd.organisation_id = p.organisation_id
      and p.role in ('admin','super_admin')
    )
  );

-- -------------------------
-- workflow_routing_rules
-- -------------------------
create policy "org members read routing rules"
  on workflow_routing_rules for select
  using (
    exists (
      select 1 from workflow_definitions wd
      join profiles p on p.id = auth.uid()
      where wd.id = workflow_routing_rules.workflow_definition_id
      and wd.organisation_id = p.organisation_id
    )
  );

create policy "admins manage routing rules"
  on workflow_routing_rules for all
  using (
    exists (
      select 1 from workflow_definitions wd
      join profiles p on p.id = auth.uid()
      where wd.id = workflow_routing_rules.workflow_definition_id
      and wd.organisation_id = p.organisation_id
      and p.role in ('admin','super_admin')
    )
  );

-- -------------------------
-- workflow_instances
-- -------------------------
create policy "org members read workflow instances"
  on workflow_instances for select
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

create policy "system insert workflow instances"
  on workflow_instances for insert
  with check (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
  );

create policy "managers update workflow instances"
  on workflow_instances for update
  using (
    organisation_id = (select organisation_id from profiles where id = auth.uid())
    and exists (
      select 1 from profiles
      where id = auth.uid() and role in ('manager','admin','super_admin')
    )
  );

-- -------------------------
-- workflow_stage_instances
-- -------------------------
create policy "assigned user reads stage instance"
  on workflow_stage_instances for select
  using (
    assigned_to = auth.uid()
    or exists (
      select 1 from profiles
      where id = auth.uid() and role in ('manager','admin','super_admin')
    )
  );

create policy "system insert stage instances"
  on workflow_stage_instances for insert
  with check (
    exists (
      select 1 from workflow_instances wi
      join profiles p on p.id = auth.uid()
      where wi.id = workflow_stage_instances.workflow_instance_id
      and wi.organisation_id = p.organisation_id
    )
  );

create policy "assigned user updates stage instance"
  on workflow_stage_instances for update
  using (
    assigned_to = auth.uid()
    or exists (
      select 1 from profiles
      where id = auth.uid() and role in ('manager','admin','super_admin')
    )
  );

-- -------------------------
-- Audit submissions readable by managers (form type = audit)
-- -------------------------
create policy "managers read audit submissions"
  on form_submissions for select
  using (
    exists (
      select 1 from form_templates ft
      join profiles p on p.id = auth.uid()
      where ft.id = form_submissions.form_template_id
      and ft.type = 'audit'
      and p.role in ('manager','admin','super_admin')
      and p.organisation_id = ft.organisation_id
    )
  );
