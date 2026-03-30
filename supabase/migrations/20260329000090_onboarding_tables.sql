-- Migration: onboarding_tables
-- Tracks AI-first onboarding progress for each organisation

-- Onboarding session (one active per org)
CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  current_step          INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
  status                TEXT NOT NULL DEFAULT 'in_progress'
                          CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  ai_context            JSONB NOT NULL DEFAULT '{}',
  -- Step 1 outputs
  website_url           TEXT,
  company_name          TEXT,
  industry_code         TEXT,
  industry_subcategory  TEXT,
  estimated_locations   INTEGER,
  brand_color           TEXT,
  logo_url              TEXT,
  -- Step 3 outputs
  employee_source       TEXT CHECK (employee_source IN (
                          'sprout_hr', 'hris_other', 'csv', 'manual', 'invite_link'
                        )),
  -- Step 5 progress
  launch_progress       JSONB DEFAULT '{}',
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pre-built collections of templates for each industry
CREATE TABLE IF NOT EXISTS industry_packages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_code  TEXT NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (industry_code, version)
);

-- Individual template items within a package
CREATE TABLE IF NOT EXISTS template_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      UUID NOT NULL REFERENCES industry_packages(id) ON DELETE CASCADE,
  category        TEXT NOT NULL CHECK (category IN (
                    'form', 'checklist', 'audit',
                    'issue_category', 'workflow',
                    'training_module', 'shift_template',
                    'repair_manual'
                  )),
  name            TEXT NOT NULL,
  description     TEXT,
  content         JSONB NOT NULL DEFAULT '{}',
  is_recommended  BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client's template selections during Step 2
CREATE TABLE IF NOT EXISTS onboarding_selections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  template_id     UUID NOT NULL REFERENCES template_items(id) ON DELETE CASCADE,
  is_selected     BOOLEAN NOT NULL DEFAULT true,
  customizations  JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, template_id)
);

-- Employee import job tracking (Step 3)
CREATE TABLE IF NOT EXISTS employee_import_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL CHECK (source_type IN (
                      'sprout_hr', 'hris_other', 'csv', 'manual', 'invite_link'
                    )),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                      'pending', 'processing', 'completed', 'failed', 'partial'
                    )),
  total_records     INTEGER DEFAULT 0,
  processed_records INTEGER DEFAULT 0,
  failed_records    INTEGER DEFAULT 0,
  error_log         JSONB DEFAULT '[]',
  source_metadata   JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI role-mapping results (Step 3)
CREATE TABLE IF NOT EXISTS role_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  source_title     TEXT NOT NULL,
  source_department TEXT,
  source_level     TEXT,
  retail_role      TEXT NOT NULL CHECK (retail_role IN (
                     'super_admin', 'admin', 'manager', 'staff'
                   )),
  confidence_score FLOAT NOT NULL DEFAULT 0.0 CHECK (confidence_score BETWEEN 0.0 AND 1.0),
  is_confirmed     BOOLEAN NOT NULL DEFAULT false,
  employee_count   INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Manually entered employees during Step 3 (before accounts are created)
CREATE TABLE IF NOT EXISTS onboarding_employees (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  full_name        TEXT NOT NULL,
  email            TEXT NOT NULL,
  phone            TEXT,
  position         TEXT,
  department       TEXT,
  retail_role      TEXT NOT NULL DEFAULT 'staff' CHECK (retail_role IN (
                     'super_admin', 'admin', 'manager', 'staff'
                   )),
  location_name    TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                     'pending', 'invited', 'active', 'failed'
                   )),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_org    ON onboarding_sessions(organisation_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_status ON onboarding_sessions(status);
CREATE INDEX IF NOT EXISTS idx_template_items_package     ON template_items(package_id);
CREATE INDEX IF NOT EXISTS idx_template_items_category    ON template_items(category);
CREATE INDEX IF NOT EXISTS idx_onboarding_selections_sess ON onboarding_selections(session_id);
CREATE INDEX IF NOT EXISTS idx_employee_import_jobs_sess  ON employee_import_jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_role_mappings_session      ON role_mappings(session_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_employees_sess  ON onboarding_employees(session_id);
