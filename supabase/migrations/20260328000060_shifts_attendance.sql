-- =============================================================================
-- Shifts & Attendance Module
-- Migration: 20260328000060_shifts_attendance.sql
-- =============================================================================

-- ── Shift Templates ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id     UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    location_id         UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    role                TEXT,
    start_time          TIME NOT NULL,
    end_time            TIME NOT NULL,
    days_of_week        INTEGER[] NOT NULL DEFAULT '{}',  -- 0=Mon … 6=Sun
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          UUID NOT NULL REFERENCES profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Shifts ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id         UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    location_id             UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    template_id             UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
    assigned_to_user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_by              UUID NOT NULL REFERENCES profiles(id),
    role                    TEXT,
    start_at                TIMESTAMPTZ NOT NULL,
    end_at                  TIMESTAMPTZ NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','published','open','claimed','cancelled')),
    is_open_shift           BOOLEAN NOT NULL DEFAULT FALSE,
    cancellation_reason     TEXT,
    notes                   TEXT,
    ai_generated            BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted              BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Open Shift Claims ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS open_shift_claims (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id        UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    claimed_by      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
    claimed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at    TIMESTAMPTZ,
    manager_note    TEXT,
    UNIQUE (shift_id, claimed_by)
);

-- ── Shift Swap Requests ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_swap_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id         UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    requested_by            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    shift_id                UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    target_user_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    target_shift_id         UUID REFERENCES shifts(id) ON DELETE SET NULL,
    status                  TEXT NOT NULL DEFAULT 'pending_colleague'
                            CHECK (status IN ('pending_colleague','pending_manager','approved','rejected','cancelled')),
    colleague_response_at   TIMESTAMPTZ,
    manager_response_at     TIMESTAMPTZ,
    approved_by             UUID REFERENCES profiles(id) ON DELETE SET NULL,
    rejection_reason        TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Staff Availability ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_availability (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Mon … 6=Sun
    available_from  TIME NOT NULL,
    available_to    TIME NOT NULL,
    is_available    BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from  DATE,
    effective_to    DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, day_of_week)
);

-- ── Leave Requests ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    leave_type      TEXT NOT NULL
                    CHECK (leave_type IN ('annual','sick','emergency','unpaid','other')),
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    reason          TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
    approved_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
    responded_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Attendance Rules ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_rules (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id                 UUID NOT NULL UNIQUE REFERENCES organisations(id) ON DELETE CASCADE,
    late_threshold_mins             INTEGER NOT NULL DEFAULT 15,
    early_departure_threshold_mins  INTEGER NOT NULL DEFAULT 15,
    overtime_threshold_hours        NUMERIC(5,2) NOT NULL DEFAULT 8.0,
    weekly_overtime_threshold_hours NUMERIC(5,2) NOT NULL DEFAULT 40.0,
    break_duration_mins             INTEGER NOT NULL DEFAULT 30,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Attendance Records ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_records (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    shift_id                UUID REFERENCES shifts(id) ON DELETE SET NULL,
    location_id             UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    organisation_id         UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    clock_in_at             TIMESTAMPTZ,
    clock_in_method         TEXT
                            CHECK (clock_in_method IN ('gps','selfie','facial_recognition','qr_code','manager_override')),
    clock_in_latitude       NUMERIC(10,7),
    clock_in_longitude      NUMERIC(10,7),
    clock_in_geo_valid      BOOLEAN,
    clock_out_at            TIMESTAMPTZ,
    total_minutes           INTEGER,
    overtime_minutes        INTEGER NOT NULL DEFAULT 0,
    break_minutes           INTEGER NOT NULL DEFAULT 0,
    status                  TEXT NOT NULL DEFAULT 'unverified'
                            CHECK (status IN ('present','late','early_departure','absent','unverified')),
    manager_override_note   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Face Profiles (stub — no actual face vector processing) ───────────────────
CREATE TABLE IF NOT EXISTS face_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    -- Actual face vector storage / processing is out of scope for web.
    -- This stub table holds enrollment state only.
    enrolled        BOOLEAN NOT NULL DEFAULT FALSE,
    enrolled_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── AI Schedule Jobs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_schedule_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    location_id     UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    created_by      UUID NOT NULL REFERENCES profiles(id),
    week_start      DATE NOT NULL,
    notes           TEXT,
    shifts_created  INTEGER NOT NULL DEFAULT 0,
    warnings        TEXT[] NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('pending','running','completed','failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_shift_templates_org       ON shift_templates (organisation_id);
CREATE INDEX IF NOT EXISTS idx_shift_templates_location  ON shift_templates (location_id);

CREATE INDEX IF NOT EXISTS idx_shifts_org               ON shifts (organisation_id);
CREATE INDEX IF NOT EXISTS idx_shifts_location          ON shifts (location_id);
CREATE INDEX IF NOT EXISTS idx_shifts_assigned_user     ON shifts (assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_shifts_start_at          ON shifts (start_at);
CREATE INDEX IF NOT EXISTS idx_shifts_status            ON shifts (status);
CREATE INDEX IF NOT EXISTS idx_shifts_is_open           ON shifts (is_open_shift);
CREATE INDEX IF NOT EXISTS idx_shifts_not_deleted       ON shifts (organisation_id, is_deleted) WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_open_shift_claims_shift  ON open_shift_claims (shift_id);
CREATE INDEX IF NOT EXISTS idx_open_shift_claims_user   ON open_shift_claims (claimed_by);
CREATE INDEX IF NOT EXISTS idx_open_shift_claims_status ON open_shift_claims (status);

CREATE INDEX IF NOT EXISTS idx_swap_requests_org        ON shift_swap_requests (organisation_id);
CREATE INDEX IF NOT EXISTS idx_swap_requests_requester  ON shift_swap_requests (requested_by);
CREATE INDEX IF NOT EXISTS idx_swap_requests_shift      ON shift_swap_requests (shift_id);
CREATE INDEX IF NOT EXISTS idx_swap_requests_status     ON shift_swap_requests (status);

CREATE INDEX IF NOT EXISTS idx_staff_avail_user         ON staff_availability (user_id);
CREATE INDEX IF NOT EXISTS idx_staff_avail_org          ON staff_availability (organisation_id);

CREATE INDEX IF NOT EXISTS idx_leave_requests_user      ON leave_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_org       ON leave_requests (organisation_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status    ON leave_requests (status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates     ON leave_requests (start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_attendance_user          ON attendance_records (user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_org           ON attendance_records (organisation_id);
CREATE INDEX IF NOT EXISTS idx_attendance_location      ON attendance_records (location_id);
CREATE INDEX IF NOT EXISTS idx_attendance_shift         ON attendance_records (shift_id);
CREATE INDEX IF NOT EXISTS idx_attendance_clock_in      ON attendance_records (clock_in_at);
CREATE INDEX IF NOT EXISTS idx_attendance_status        ON attendance_records (status);

CREATE INDEX IF NOT EXISTS idx_ai_schedule_jobs_org     ON ai_schedule_jobs (organisation_id);

-- =============================================================================
-- Enable RLS
-- =============================================================================

ALTER TABLE shift_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_shift_claims    ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_swap_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_availability   ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records   ENABLE ROW LEVEL SECURITY;
ALTER TABLE face_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_schedule_jobs     ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- RLS Policies
-- Note: The backend uses the service role key (bypasses RLS) for all writes.
-- These policies protect direct PostgREST / Supabase JS access.
-- =============================================================================

-- ── shift_templates ────────────────────────────────────────────────────────────
-- Managers+ in same org can read/write; staff can read their own org's active templates
CREATE POLICY shift_templates_select ON shift_templates
    FOR SELECT USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
    );

CREATE POLICY shift_templates_insert ON shift_templates
    FOR INSERT WITH CHECK (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
    );

CREATE POLICY shift_templates_update ON shift_templates
    FOR UPDATE USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
    );

CREATE POLICY shift_templates_delete ON shift_templates
    FOR DELETE USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
    );

-- ── shifts ────────────────────────────────────────────────────────────────────
-- Staff see only their own + open/published shifts; managers see all in org
CREATE POLICY shifts_select ON shifts
    FOR SELECT USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND is_deleted = FALSE
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
            OR assigned_to_user_id = auth.uid()
            OR is_open_shift = TRUE
        )
    );

CREATE POLICY shifts_insert ON shifts
    FOR INSERT WITH CHECK (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
    );

CREATE POLICY shifts_update ON shifts
    FOR UPDATE USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
    );

CREATE POLICY shifts_delete ON shifts
    FOR DELETE USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
    );

-- ── open_shift_claims ─────────────────────────────────────────────────────────
CREATE POLICY open_shift_claims_select ON open_shift_claims
    FOR SELECT USING (
        claimed_by = auth.uid()
        OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
    );

CREATE POLICY open_shift_claims_insert ON open_shift_claims
    FOR INSERT WITH CHECK (claimed_by = auth.uid());

CREATE POLICY open_shift_claims_update ON open_shift_claims
    FOR UPDATE USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
    );

-- ── shift_swap_requests ───────────────────────────────────────────────────────
CREATE POLICY swap_requests_select ON shift_swap_requests
    FOR SELECT USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (
            requested_by = auth.uid()
            OR target_user_id = auth.uid()
            OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
        )
    );

CREATE POLICY swap_requests_insert ON shift_swap_requests
    FOR INSERT WITH CHECK (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND requested_by = auth.uid()
    );

CREATE POLICY swap_requests_update ON shift_swap_requests
    FOR UPDATE USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (
            requested_by = auth.uid()
            OR target_user_id = auth.uid()
            OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
        )
    );

-- ── staff_availability ────────────────────────────────────────────────────────
CREATE POLICY staff_avail_select ON staff_availability
    FOR SELECT USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (
            user_id = auth.uid()
            OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
        )
    );

CREATE POLICY staff_avail_insert ON staff_availability
    FOR INSERT WITH CHECK (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND user_id = auth.uid()
    );

CREATE POLICY staff_avail_update ON staff_availability
    FOR UPDATE USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND user_id = auth.uid()
    );

-- ── leave_requests ────────────────────────────────────────────────────────────
CREATE POLICY leave_requests_select ON leave_requests
    FOR SELECT USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (
            user_id = auth.uid()
            OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
        )
    );

CREATE POLICY leave_requests_insert ON leave_requests
    FOR INSERT WITH CHECK (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND user_id = auth.uid()
    );

CREATE POLICY leave_requests_update ON leave_requests
    FOR UPDATE USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
    );

-- ── attendance_rules ──────────────────────────────────────────────────────────
CREATE POLICY attendance_rules_select ON attendance_rules
    FOR SELECT USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
    );

CREATE POLICY attendance_rules_insert ON attendance_rules
    FOR INSERT WITH CHECK (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','super_admin')
    );

CREATE POLICY attendance_rules_update ON attendance_rules
    FOR UPDATE USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','super_admin')
    );

-- ── attendance_records ────────────────────────────────────────────────────────
CREATE POLICY attendance_records_select ON attendance_records
    FOR SELECT USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (
            user_id = auth.uid()
            OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
        )
    );

CREATE POLICY attendance_records_insert ON attendance_records
    FOR INSERT WITH CHECK (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND user_id = auth.uid()
    );

CREATE POLICY attendance_records_update ON attendance_records
    FOR UPDATE USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (
            user_id = auth.uid()
            OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
        )
    );

-- ── face_profiles ─────────────────────────────────────────────────────────────
CREATE POLICY face_profiles_select ON face_profiles
    FOR SELECT USING (
        user_id = auth.uid()
        OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
    );

-- ── ai_schedule_jobs ──────────────────────────────────────────────────────────
CREATE POLICY ai_schedule_jobs_select ON ai_schedule_jobs
    FOR SELECT USING (
        organisation_id = (auth.jwt() -> 'app_metadata' ->> 'organisation_id')::UUID
        AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('manager','admin','super_admin')
    );
