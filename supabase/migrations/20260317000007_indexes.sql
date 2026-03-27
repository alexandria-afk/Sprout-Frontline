-- Performance indexes on FK columns and common query patterns

-- profiles
CREATE INDEX idx_profiles_org      ON profiles(organisation_id) WHERE is_deleted = false;
CREATE INDEX idx_profiles_location ON profiles(location_id)     WHERE is_deleted = false;

-- form_templates
CREATE INDEX idx_form_templates_org ON form_templates(organisation_id) WHERE is_deleted = false;

-- form_sections
CREATE INDEX idx_form_sections_template ON form_sections(form_template_id) WHERE is_deleted = false;

-- form_fields
CREATE INDEX idx_form_fields_section ON form_fields(section_id) WHERE is_deleted = false;

-- form_assignments
CREATE INDEX idx_form_assignments_template ON form_assignments(form_template_id) WHERE is_deleted = false;
CREATE INDEX idx_form_assignments_user     ON form_assignments(assigned_to_user_id) WHERE is_deleted = false;
CREATE INDEX idx_form_assignments_location ON form_assignments(assigned_to_location_id) WHERE is_deleted = false;
CREATE INDEX idx_form_assignments_due      ON form_assignments(due_at) WHERE is_deleted = false AND is_active = true;

-- form_submissions
CREATE INDEX idx_form_submissions_assignment  ON form_submissions(assignment_id) WHERE is_deleted = false;
CREATE INDEX idx_form_submissions_submitted_by ON form_submissions(submitted_by) WHERE is_deleted = false;
CREATE INDEX idx_form_submissions_status       ON form_submissions(status)       WHERE is_deleted = false;

-- form_responses
CREATE INDEX idx_form_responses_submission ON form_responses(submission_id) WHERE is_deleted = false;

-- announcements — most recent first, scoped to org
CREATE INDEX idx_announcements_org_published
  ON announcements(organisation_id, publish_at DESC NULLS FIRST)
  WHERE is_deleted = false;

-- announcement_receipts
CREATE INDEX idx_announcement_receipts_announcement ON announcement_receipts(announcement_id) WHERE is_deleted = false;
CREATE INDEX idx_announcement_receipts_user         ON announcement_receipts(user_id)         WHERE is_deleted = false;
