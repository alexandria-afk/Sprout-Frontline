-- Forms: templates → sections → fields → assignments → submissions → responses

CREATE TABLE form_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  created_by      uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  title           text NOT NULL,
  description     text,
  type            text NOT NULL CHECK (type IN ('checklist', 'form')),
  is_active       boolean NOT NULL DEFAULT true,
  is_deleted      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER form_templates_updated_at
  BEFORE UPDATE ON form_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE form_sections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_template_id uuid NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  title            text NOT NULL,
  display_order    int NOT NULL DEFAULT 0,
  is_deleted       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER form_sections_updated_at
  BEFORE UPDATE ON form_sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE form_fields (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id        uuid NOT NULL REFERENCES form_sections(id) ON DELETE CASCADE,
  label             text NOT NULL,
  field_type        text NOT NULL CHECK (field_type IN (
                      'text', 'number', 'checkbox', 'dropdown',
                      'multi_select', 'photo', 'signature', 'datetime'
                    )),
  is_required       boolean NOT NULL DEFAULT false,
  options           jsonb,            -- string[] for dropdown/multi_select
  conditional_logic jsonb,            -- { fieldId, value, action: 'show'|'hide' }
  display_order     int NOT NULL DEFAULT 0,
  is_deleted        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER form_fields_updated_at
  BEFORE UPDATE ON form_fields
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE form_assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_template_id      uuid NOT NULL REFERENCES form_templates(id) ON DELETE RESTRICT,
  organisation_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  assigned_to_user_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_to_location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  recurrence            text NOT NULL CHECK (recurrence IN ('once', 'daily', 'weekly', 'custom')),
  cron_expression       text,
  due_at                timestamptz NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,
  is_deleted            boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER form_assignments_updated_at
  BEFORE UPDATE ON form_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE form_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_template_id uuid NOT NULL REFERENCES form_templates(id) ON DELETE RESTRICT,
  assignment_id    uuid NOT NULL REFERENCES form_assignments(id) ON DELETE RESTRICT,
  submitted_by     uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  submitted_at     timestamptz,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  manager_comment  text,
  is_deleted       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER form_submissions_updated_at
  BEFORE UPDATE ON form_submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE form_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  field_id      uuid NOT NULL REFERENCES form_fields(id) ON DELETE RESTRICT,
  value         text,       -- file URL for photo fields
  is_deleted    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER form_responses_updated_at
  BEFORE UPDATE ON form_responses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
