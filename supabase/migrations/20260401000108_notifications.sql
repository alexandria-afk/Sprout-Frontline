-- Part 1: Replace broken notification_log with centralized notifications table

DROP TABLE IF EXISTS notification_log;

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) NOT NULL,
  recipient_user_id UUID REFERENCES profiles(id) NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'task_assigned',
    'form_assigned',
    'workflow_stage_assigned',
    'issue_assigned',
    'issue_comment',
    'issue_status_changed',
    'shift_claim_pending',
    'shift_swap_pending',
    'leave_request_pending',
    'form_submission_review',
    'cap_generated',
    'announcement',
    'course_enrolled',
    'scheduled_reminder'
  )),
  title TEXT NOT NULL,
  body TEXT,
  entity_type TEXT CHECK (entity_type IN (
    'task', 'form_assignment', 'workflow_instance', 'issue',
    'shift_claim', 'shift_swap', 'leave_request',
    'form_submission', 'cap', 'announcement', 'course_enrollment'
  )),
  entity_id UUID,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  is_dismissed BOOLEAN DEFAULT false,
  push_sent BOOLEAN DEFAULT false,
  push_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notifications_recipient
  ON notifications(recipient_user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_org
  ON notifications(organisation_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT USING (recipient_user_id = auth.uid());

-- Users can update their own notifications (mark read/dismissed)
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE USING (recipient_user_id = auth.uid());
