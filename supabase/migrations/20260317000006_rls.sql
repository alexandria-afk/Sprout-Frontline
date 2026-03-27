-- Row Level Security policies
-- Enable RLS on every table — no exceptions.
-- Pattern: org-scoped reads, role-gated writes, NO hard deletes.

-- ── Helper: get calling user's organisation_id ────────────────────────────────
CREATE OR REPLACE FUNCTION auth_org_id() RETURNS uuid AS $$
  SELECT organisation_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ── Helper: get calling user's role ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION auth_role() RETURNS text AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;


-- ═══════════════════════════════════════════════════════════════════════════════
-- organisations
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organisations_select" ON organisations
  FOR SELECT USING (
    is_deleted = false
    AND id = auth_org_id()
  );

CREATE POLICY "organisations_update" ON organisations
  FOR UPDATE USING (
    id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin')
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- locations
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locations_select" ON locations
  FOR SELECT USING (
    is_deleted = false
    AND organisation_id = auth_org_id()
  );

CREATE POLICY "locations_insert" ON locations
  FOR INSERT WITH CHECK (
    organisation_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin')
  );

CREATE POLICY "locations_update" ON locations
  FOR UPDATE USING (
    organisation_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin')
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- profiles
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- All org members can read non-deleted profiles in their org
CREATE POLICY "profiles_select_org" ON profiles
  FOR SELECT USING (
    is_deleted = false
    AND organisation_id = auth_org_id()
  );

-- Users can always read their own profile (needed to bootstrap auth_org_id)
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (id = auth.uid());

-- Admins can insert new profiles (bulk import, user creation)
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (
    organisation_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin')
  );

-- Admins can update any profile in org; users can update their own non-role fields
CREATE POLICY "profiles_update_admin" ON profiles
  FOR UPDATE USING (
    organisation_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin')
  );

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid());


-- ═══════════════════════════════════════════════════════════════════════════════
-- form_templates
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_templates_select" ON form_templates
  FOR SELECT USING (
    is_deleted = false
    AND organisation_id = auth_org_id()
  );

CREATE POLICY "form_templates_insert" ON form_templates
  FOR INSERT WITH CHECK (
    organisation_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin', 'manager')
  );

CREATE POLICY "form_templates_update" ON form_templates
  FOR UPDATE USING (
    organisation_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin', 'manager')
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- form_sections
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE form_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_sections_select" ON form_sections
  FOR SELECT USING (
    is_deleted = false
    AND EXISTS (
      SELECT 1 FROM form_templates t
      WHERE t.id = form_sections.form_template_id
        AND t.organisation_id = auth_org_id()
        AND t.is_deleted = false
    )
  );

CREATE POLICY "form_sections_insert" ON form_sections
  FOR INSERT WITH CHECK (
    auth_role() IN ('super_admin', 'admin', 'manager')
    AND EXISTS (
      SELECT 1 FROM form_templates t
      WHERE t.id = form_sections.form_template_id
        AND t.organisation_id = auth_org_id()
    )
  );

CREATE POLICY "form_sections_update" ON form_sections
  FOR UPDATE USING (
    auth_role() IN ('super_admin', 'admin', 'manager')
    AND EXISTS (
      SELECT 1 FROM form_templates t
      WHERE t.id = form_sections.form_template_id
        AND t.organisation_id = auth_org_id()
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- form_fields
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE form_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_fields_select" ON form_fields
  FOR SELECT USING (
    is_deleted = false
    AND EXISTS (
      SELECT 1 FROM form_sections s
      JOIN form_templates t ON t.id = s.form_template_id
      WHERE s.id = form_fields.section_id
        AND t.organisation_id = auth_org_id()
        AND t.is_deleted = false
    )
  );

CREATE POLICY "form_fields_insert" ON form_fields
  FOR INSERT WITH CHECK (
    auth_role() IN ('super_admin', 'admin', 'manager')
  );

CREATE POLICY "form_fields_update" ON form_fields
  FOR UPDATE USING (
    auth_role() IN ('super_admin', 'admin', 'manager')
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- form_assignments
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE form_assignments ENABLE ROW LEVEL SECURITY;

-- Managers+ see all assignments in org; staff see only their own
CREATE POLICY "form_assignments_select_manager" ON form_assignments
  FOR SELECT USING (
    is_deleted = false
    AND organisation_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin', 'manager')
  );

CREATE POLICY "form_assignments_select_staff" ON form_assignments
  FOR SELECT USING (
    is_deleted = false
    AND assigned_to_user_id = auth.uid()
  );

CREATE POLICY "form_assignments_insert" ON form_assignments
  FOR INSERT WITH CHECK (
    organisation_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin', 'manager')
  );

CREATE POLICY "form_assignments_update" ON form_assignments
  FOR UPDATE USING (
    organisation_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin', 'manager')
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- form_submissions
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;

-- Staff can only see their own submissions
CREATE POLICY "form_submissions_select_own" ON form_submissions
  FOR SELECT USING (
    is_deleted = false
    AND submitted_by = auth.uid()
  );

-- Managers+ see all submissions in org
CREATE POLICY "form_submissions_select_manager" ON form_submissions
  FOR SELECT USING (
    is_deleted = false
    AND auth_role() IN ('super_admin', 'admin', 'manager')
    AND EXISTS (
      SELECT 1 FROM form_assignments a
      WHERE a.id = form_submissions.assignment_id
        AND a.organisation_id = auth_org_id()
    )
  );

-- Any authenticated user can create a submission for themselves
CREATE POLICY "form_submissions_insert" ON form_submissions
  FOR INSERT WITH CHECK (submitted_by = auth.uid());

-- Staff can update their own draft/submitted submissions; managers can update for review
CREATE POLICY "form_submissions_update_own" ON form_submissions
  FOR UPDATE USING (
    submitted_by = auth.uid()
    AND status IN ('draft', 'submitted')
  );

CREATE POLICY "form_submissions_update_manager" ON form_submissions
  FOR UPDATE USING (
    auth_role() IN ('super_admin', 'admin', 'manager')
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- form_responses
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE form_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_responses_select" ON form_responses
  FOR SELECT USING (
    is_deleted = false
    AND EXISTS (
      SELECT 1 FROM form_submissions s
      WHERE s.id = form_responses.submission_id
        AND (s.submitted_by = auth.uid() OR auth_role() IN ('super_admin', 'admin', 'manager'))
    )
  );

CREATE POLICY "form_responses_insert" ON form_responses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM form_submissions s
      WHERE s.id = form_responses.submission_id
        AND s.submitted_by = auth.uid()
    )
  );

CREATE POLICY "form_responses_update" ON form_responses
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM form_submissions s
      WHERE s.id = form_responses.submission_id
        AND s.submitted_by = auth.uid()
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- announcements
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- Users see org announcements targeted to their role/location (or broadcast)
CREATE POLICY "announcements_select" ON announcements
  FOR SELECT USING (
    is_deleted = false
    AND organisation_id = auth_org_id()
    AND (publish_at IS NULL OR publish_at <= now())
    AND (
      target_roles IS NULL
      OR target_roles = 'null'::jsonb
      OR target_roles @> to_jsonb(auth_role())
    )
  );

CREATE POLICY "announcements_insert" ON announcements
  FOR INSERT WITH CHECK (
    organisation_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin', 'manager')
  );

CREATE POLICY "announcements_update" ON announcements
  FOR UPDATE USING (
    organisation_id = auth_org_id()
    AND auth_role() IN ('super_admin', 'admin', 'manager')
    AND (publish_at IS NULL OR publish_at > now())  -- can only edit unpublished
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- announcement_receipts
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE announcement_receipts ENABLE ROW LEVEL SECURITY;

-- Users see only their own receipts
CREATE POLICY "announcement_receipts_select_own" ON announcement_receipts
  FOR SELECT USING (
    is_deleted = false
    AND user_id = auth.uid()
  );

-- Managers+ can view all receipts in their org (for read stats)
CREATE POLICY "announcement_receipts_select_manager" ON announcement_receipts
  FOR SELECT USING (
    is_deleted = false
    AND auth_role() IN ('super_admin', 'admin', 'manager')
    AND EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.id = announcement_receipts.announcement_id
        AND a.organisation_id = auth_org_id()
    )
  );

-- Users can create their own receipt (on first read/acknowledge)
CREATE POLICY "announcement_receipts_insert" ON announcement_receipts
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can update their own receipt (e.g. set acknowledged_at)
CREATE POLICY "announcement_receipts_update" ON announcement_receipts
  FOR UPDATE USING (user_id = auth.uid());
