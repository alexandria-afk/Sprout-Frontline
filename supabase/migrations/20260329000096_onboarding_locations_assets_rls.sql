-- RLS for onboarding_locations, onboarding_assets, onboarding_vendors
ALTER TABLE onboarding_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_assets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_vendors   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can manage onboarding locations"
  ON onboarding_locations FOR ALL USING (
    session_id IN (
      SELECT os.id FROM onboarding_sessions os
      JOIN profiles p ON p.organisation_id = os.organisation_id
      WHERE p.id = auth.uid() AND p.is_deleted = false
    )
  );

CREATE POLICY "Org members can manage onboarding assets"
  ON onboarding_assets FOR ALL USING (
    session_id IN (
      SELECT os.id FROM onboarding_sessions os
      JOIN profiles p ON p.organisation_id = os.organisation_id
      WHERE p.id = auth.uid() AND p.is_deleted = false
    )
  );

CREATE POLICY "Org members can manage onboarding vendors"
  ON onboarding_vendors FOR ALL USING (
    session_id IN (
      SELECT os.id FROM onboarding_sessions os
      JOIN profiles p ON p.organisation_id = os.organisation_id
      WHERE p.id = auth.uid() AND p.is_deleted = false
    )
  );
