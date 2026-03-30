-- RLS for onboarding tables
-- Membership is determined by profiles.organisation_id (no separate join table)

ALTER TABLE onboarding_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_selections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_import_jobs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_mappings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_employees   ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_packages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_items         ENABLE ROW LEVEL SECURITY;

-- Industry packages and items are globally readable (admin-seeded, read-only)
CREATE POLICY "Anyone can read active industry packages"
  ON industry_packages FOR SELECT USING (is_active = true);

CREATE POLICY "Anyone can read template items"
  ON template_items FOR SELECT USING (true);

-- Onboarding sessions: org members can manage their own
CREATE POLICY "Org members can manage onboarding sessions"
  ON onboarding_sessions FOR ALL
  USING (
    organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid() AND is_deleted = false
    )
  );

-- Selections: tied to session, therefore org-scoped
CREATE POLICY "Org members can manage onboarding selections"
  ON onboarding_selections FOR ALL
  USING (
    session_id IN (
      SELECT os.id FROM onboarding_sessions os
      JOIN profiles p ON p.organisation_id = os.organisation_id
      WHERE p.id = auth.uid() AND p.is_deleted = false
    )
  );

CREATE POLICY "Org members can manage import jobs"
  ON employee_import_jobs FOR ALL
  USING (
    session_id IN (
      SELECT os.id FROM onboarding_sessions os
      JOIN profiles p ON p.organisation_id = os.organisation_id
      WHERE p.id = auth.uid() AND p.is_deleted = false
    )
  );

CREATE POLICY "Org members can manage role mappings"
  ON role_mappings FOR ALL
  USING (
    session_id IN (
      SELECT os.id FROM onboarding_sessions os
      JOIN profiles p ON p.organisation_id = os.organisation_id
      WHERE p.id = auth.uid() AND p.is_deleted = false
    )
  );

CREATE POLICY "Org members can manage onboarding employees"
  ON onboarding_employees FOR ALL
  USING (
    session_id IN (
      SELECT os.id FROM onboarding_sessions os
      JOIN profiles p ON p.organisation_id = os.organisation_id
      WHERE p.id = auth.uid() AND p.is_deleted = false
    )
  );
