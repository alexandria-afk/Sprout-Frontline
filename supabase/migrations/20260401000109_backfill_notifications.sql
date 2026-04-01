-- Backfill notifications for all existing pending items.
-- The notifications table was empty on first deploy because all pre-existing
-- tasks, form assignments, workflow stages, etc. were created before the
-- notification trigger system existed. This migration creates one notification
-- row per pending item so the inbox shows them immediately.
--
-- Each INSERT uses NOT EXISTS to be fully idempotent (safe to re-run).

-- ── 1. Active form assignments (user-assigned, not yet submitted) ───────────────

INSERT INTO notifications
  (organisation_id, recipient_user_id, type, title, entity_type, entity_id)
SELECT
  fa.organisation_id,
  fa.assigned_to_user_id,
  'form_assigned',
  CONCAT('New assignment: ', COALESCE(ft.title, 'Form')),
  'form_assignment',
  fa.id
FROM form_assignments fa
JOIN form_templates ft ON ft.id = fa.form_template_id
WHERE fa.assigned_to_user_id IS NOT NULL
  AND fa.is_active   = true
  AND fa.is_deleted  = false
  -- skip if the user already has a submitted/approved submission for this assignment
  AND NOT EXISTS (
    SELECT 1 FROM form_submissions fs
    WHERE fs.assignment_id = fa.id
      AND fs.status IN ('submitted', 'approved')
  )
  -- idempotency guard
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.entity_type        = 'form_assignment'
      AND n.entity_id          = fa.id
      AND n.recipient_user_id  = fa.assigned_to_user_id
      AND n.type               = 'form_assigned'
  );

-- ── 2. Pending / in-progress tasks (directly assigned users) ──────────────────

INSERT INTO notifications
  (organisation_id, recipient_user_id, type, title, entity_type, entity_id)
SELECT DISTINCT
  t.organisation_id,
  ta.user_id,
  'task_assigned',
  CONCAT('New task: ', t.title),
  'task',
  t.id
FROM tasks t
JOIN task_assignees ta ON ta.task_id = t.id
WHERE ta.user_id  IS NOT NULL
  AND t.status    IN ('pending', 'in_progress')
  AND t.is_deleted = false
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.entity_type        = 'task'
      AND n.entity_id          = t.id
      AND n.recipient_user_id  = ta.user_id
      AND n.type               = 'task_assigned'
  );

-- ── 3. In-progress workflow stage instances ────────────────────────────────────

INSERT INTO notifications
  (organisation_id, recipient_user_id, type, title, entity_type, entity_id)
SELECT
  wi.organisation_id,
  wsi.assigned_to,
  'workflow_stage_assigned',
  CONCAT('Action needed: ', COALESCE(ws.name, 'Step'), ' for ', COALESCE(wd.name, 'Workflow')),
  'workflow_instance',
  wi.id
FROM workflow_stage_instances wsi
JOIN workflow_instances   wi  ON wi.id  = wsi.workflow_instance_id
JOIN workflow_stages      ws  ON ws.id  = wsi.stage_id
JOIN workflow_definitions wd  ON wd.id  = wi.workflow_definition_id
WHERE wsi.status      = 'in_progress'
  AND wsi.assigned_to IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.entity_type        = 'workflow_instance'
      AND n.entity_id          = wi.id
      AND n.recipient_user_id  = wsi.assigned_to
      AND n.type               = 'workflow_stage_assigned'
  );

-- ── 4. Active course enrollments (not yet completed) ──────────────────────────

INSERT INTO notifications
  (organisation_id, recipient_user_id, type, title, entity_type, entity_id)
SELECT
  ce.organisation_id,
  ce.user_id,
  'course_enrolled',
  CONCAT('New training: ', COALESCE(c.title, 'Training course')),
  'course_enrollment',
  ce.id
FROM course_enrollments ce
JOIN courses c ON c.id = ce.course_id
WHERE ce.status    IN ('not_started', 'in_progress')
  AND ce.is_deleted = false
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.entity_type        = 'course_enrollment'
      AND n.entity_id          = ce.id
      AND n.recipient_user_id  = ce.user_id
      AND n.type               = 'course_enrolled'
  );

-- ── 5. Pending leave requests → notify manager ────────────────────────────────
-- Uses reports_to if set; skips if no manager link (they'll see it on /shifts).

INSERT INTO notifications
  (organisation_id, recipient_user_id, type, title, body, entity_type, entity_id)
SELECT
  lr.organisation_id,
  p.reports_to,
  'leave_request_pending',
  CONCAT('Leave request: ', p.full_name, ' — ', lr.leave_type),
  CONCAT(lr.start_date::text, ' to ', lr.end_date::text),
  'leave_request',
  lr.id
FROM leave_requests lr
JOIN profiles p ON p.id = lr.user_id
WHERE lr.status     = 'pending'
  AND p.reports_to  IS NOT NULL
  AND p.is_deleted  = false
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.entity_type        = 'leave_request'
      AND n.entity_id          = lr.id
      AND n.recipient_user_id  = p.reports_to
      AND n.type               = 'leave_request_pending'
  );

-- ── 6. Pending open shift claims → notify managers at the shift's location ────

INSERT INTO notifications
  (organisation_id, recipient_user_id, type, title, entity_type, entity_id)
SELECT DISTINCT
  s.organisation_id,
  mgr.id,
  'shift_claim_pending',
  CONCAT('Shift claim: ', claimant.full_name, ' wants ', to_char(s.start_at, 'Mon DD HH24:MI')),
  'shift_claim',
  osc.id
FROM open_shift_claims osc
JOIN shifts   s        ON s.id       = osc.shift_id
JOIN profiles claimant ON claimant.id = osc.claimed_by
JOIN profiles mgr      ON mgr.location_id  = s.location_id
                       AND mgr.organisation_id = s.organisation_id
                       AND mgr.role        IN ('manager', 'admin', 'super_admin')
                       AND mgr.is_deleted  = false
                       AND mgr.is_active   = true
WHERE osc.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.entity_type        = 'shift_claim'
      AND n.entity_id          = osc.id
      AND n.recipient_user_id  = mgr.id
      AND n.type               = 'shift_claim_pending'
  );

-- ── 7. Announcements requiring acknowledgement (users without a receipt) ───────
-- Scoped to matching target_roles; target_location_ids filtering skipped here
-- (announcements with no location filter apply org-wide).

INSERT INTO notifications
  (organisation_id, recipient_user_id, type, title, entity_type, entity_id)
SELECT DISTINCT
  a.organisation_id,
  p.id,
  'announcement',
  a.title,
  'announcement',
  a.id
FROM announcements a
JOIN profiles p ON p.organisation_id = a.organisation_id
               AND p.is_deleted      = false
               AND p.is_active       = true
               -- role match: if target_roles is empty/null treat as all roles
               AND (
                 a.target_roles IS NULL
                 OR a.target_roles = '[]'::jsonb
                 OR a.target_roles @> to_jsonb(p.role)
               )
WHERE a.requires_acknowledgement = true
  AND a.is_deleted = false
  -- user has not acknowledged
  AND NOT EXISTS (
    SELECT 1 FROM announcement_receipts ar
    WHERE ar.announcement_id    = a.id
      AND ar.user_id            = p.id
      AND ar.acknowledged_at IS NOT NULL
  )
  -- idempotency
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.entity_type        = 'announcement'
      AND n.entity_id          = a.id
      AND n.recipient_user_id  = p.id
      AND n.type               = 'announcement'
  );
