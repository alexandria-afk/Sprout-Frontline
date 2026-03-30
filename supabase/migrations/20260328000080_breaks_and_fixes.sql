-- Fix missing INSERT RLS policy on ai_schedule_jobs
CREATE POLICY ai_schedule_jobs_insert ON ai_schedule_jobs
  FOR INSERT WITH CHECK (
    organisation_id = ((auth.jwt() -> 'app_metadata' ->> 'organisation_id')::uuid)
    AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
  );

-- ── Break Records ─────────────────────────────────────────────────────────────
-- Tracks individual break periods within an attendance record

CREATE TABLE IF NOT EXISTS break_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id     uuid NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  organisation_id   uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  break_start_at    timestamptz NOT NULL DEFAULT now(),
  break_end_at      timestamptz,
  duration_minutes  integer,        -- filled in when break ends
  break_type        text NOT NULL DEFAULT 'rest'
                    CHECK (break_type IN ('meal','rest','other')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_break_records_attendance ON break_records(attendance_id);
CREATE INDEX idx_break_records_user ON break_records(user_id);

-- RLS
ALTER TABLE break_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY break_records_select ON break_records FOR SELECT
  USING (organisation_id = ((auth.jwt() -> 'app_metadata' ->> 'organisation_id')::uuid));

CREATE POLICY break_records_insert ON break_records FOR INSERT
  WITH CHECK (
    organisation_id = ((auth.jwt() -> 'app_metadata' ->> 'organisation_id')::uuid)
    AND user_id = auth.uid()
  );

CREATE POLICY break_records_update ON break_records FOR UPDATE
  USING (
    organisation_id = ((auth.jwt() -> 'app_metadata' ->> 'organisation_id')::uuid)
    AND (
      user_id = auth.uid()
      OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
    )
  );

-- ── Attendance Records — add break/worked columns ────────────────────────────

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS break_minutes  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worked_minutes integer GENERATED ALWAYS AS (
    CASE WHEN total_minutes IS NOT NULL
      THEN GREATEST(0, total_minutes - break_minutes)
      ELSE NULL
    END
  ) STORED;
