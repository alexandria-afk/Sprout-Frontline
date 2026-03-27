-- Entity Definition Alignment Migration
-- Aligns Task/Issue/Incident with canonical spec definitions
-- Fixes: incident statuses, issue 'verified_closed', cross-links, incident_attachments, incident_status_history

-- ── Fix incidents.reported_by FK to reference profiles (needed for PostgREST join) ─
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_reported_by_fkey;
ALTER TABLE incidents ADD CONSTRAINT incidents_reported_by_fkey
  FOREIGN KEY (reported_by) REFERENCES profiles(id);

-- ── Incidents: status rename (open → reported, remove resolved) ───────────────

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_status_check;

UPDATE incidents SET status = 'reported' WHERE status = 'open';
UPDATE incidents SET status = 'closed'   WHERE status = 'resolved';

ALTER TABLE incidents ALTER COLUMN status SET DEFAULT 'reported';

ALTER TABLE incidents ADD CONSTRAINT incidents_status_check
  CHECK (status IN ('reported', 'investigating', 'closed'));

-- ── Incidents: new columns ────────────────────────────────────────────────────

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS location_id      uuid REFERENCES locations(id);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS related_issue_id uuid REFERENCES issues(id);

-- ── Issues: rename 'closed' → 'verified_closed' ───────────────────────────────

-- Drop all check constraints on issues.status (there may be one from maintenance_tickets too)
ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_status_check;

UPDATE issues SET status = 'verified_closed' WHERE status = 'closed';

ALTER TABLE issues ADD CONSTRAINT issues_status_check
  CHECK (status IN ('open', 'in_progress', 'pending_vendor', 'resolved', 'verified_closed'));

-- ── Issues: new cross-link column ────────────────────────────────────────────

ALTER TABLE issues ADD COLUMN IF NOT EXISTS related_incident_id uuid REFERENCES incidents(id);

-- ── incident_attachments ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS incident_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid REFERENCES incidents(id) ON DELETE CASCADE NOT NULL,
  file_url    text NOT NULL,
  file_type   text CHECK (file_type IN ('image', 'video', 'document')) NOT NULL DEFAULT 'image',
  uploaded_by uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

ALTER TABLE incident_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "incident_attachments_select" ON incident_attachments
  FOR SELECT USING (
    incident_id IN (SELECT id FROM incidents WHERE org_id = auth_org_id())
  );

CREATE POLICY "incident_attachments_insert" ON incident_attachments
  FOR INSERT WITH CHECK (
    incident_id IN (SELECT id FROM incidents WHERE org_id = auth_org_id())
  );

-- ── incident_status_history ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS incident_status_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     uuid REFERENCES incidents(id) ON DELETE CASCADE NOT NULL,
  changed_by      uuid REFERENCES auth.users(id),
  previous_status text,
  new_status      text NOT NULL,
  note            text,
  changed_at      timestamptz DEFAULT now()
);

ALTER TABLE incident_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "incident_status_history_select" ON incident_status_history
  FOR SELECT USING (
    incident_id IN (SELECT id FROM incidents WHERE org_id = auth_org_id())
  );

CREATE POLICY "incident_status_history_insert" ON incident_status_history
  FOR INSERT WITH CHECK (
    incident_id IN (SELECT id FROM incidents WHERE org_id = auth_org_id())
  );
