-- ============================================================
-- FRONTLINE SEED DATA  (safe to re-run — uses ON CONFLICT DO NOTHING)
-- ============================================================

-- ── Fixed IDs ────────────────────────────────────────────────
-- Organisation
-- 00000000-0000-0000-0000-000000000001  Renegade Retail

-- Users (auth + profiles)
-- ba9c1775-2b59-4b59-b158-55ddbc56dc32  admin@renegade.com        super_admin
-- 07318667-db61-46f9-85d5-1250164b59e7  branchadmin@renegade.com  admin
-- 771e1cab-4de5-43a2-8ef8-ce7aab1921b8  manager@renegade.com      manager
-- 4d49520d-ee7a-4cb2-9e1e-9c877f230ad4  staff@renegade.com        staff

-- Locations
-- 00000000-0000-0000-0000-000000000010  BGC Branch
-- 00000000-0000-0000-0000-000000000011  Makati Branch

-- Form Templates
-- 00000000-0000-0000-0000-000000000020  Opening Checklist (checklist/daily)
-- 00000000-0000-0000-0000-000000000021  Store Incident Report (form/once)
-- 00000000-0000-0000-0000-000000000022  Weekly Inventory Count (form/weekly)

-- ── ORGANISATION ─────────────────────────────────────────────
INSERT INTO organisations (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Renegade Retail', 'renegade-retail')
ON CONFLICT (id) DO NOTHING;

-- ── LOCATIONS ────────────────────────────────────────────────
INSERT INTO locations (id, organisation_id, name, address, geo_fence_radius_meters, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'BGC Branch',
   '9th Ave cor 26th St, Taguig, Metro Manila',
   200, true),
  ('00000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   'Makati Branch',
   'Ayala Ave, Makati, Metro Manila',
   200, true)
ON CONFLICT (id) DO NOTHING;

-- ── PROFILES (auth users created separately via admin API) ───
INSERT INTO profiles (id, organisation_id, full_name, role, location_id, is_active)
VALUES
  ('ba9c1775-2b59-4b59-b158-55ddbc56dc32',
   '00000000-0000-0000-0000-000000000001',
   'Admin User', 'super_admin', NULL, true),
  ('07318667-db61-46f9-85d5-1250164b59e7',
   '00000000-0000-0000-0000-000000000001',
   'Alex Admin', 'admin',
   '00000000-0000-0000-0000-000000000010', true),
  ('771e1cab-4de5-43a2-8ef8-ce7aab1921b8',
   '00000000-0000-0000-0000-000000000001',
   'Maria Manager', 'manager',
   '00000000-0000-0000-0000-000000000010', true),
  ('4d49520d-ee7a-4cb2-9e1e-9c877f230ad4',
   '00000000-0000-0000-0000-000000000001',
   'Sam Staff', 'staff',
   '00000000-0000-0000-0000-000000000010', true)
ON CONFLICT (id) DO UPDATE SET
  full_name   = EXCLUDED.full_name,
  role        = EXCLUDED.role,
  location_id = EXCLUDED.location_id,
  is_active   = EXCLUDED.is_active;

-- ── FORM TEMPLATES ───────────────────────────────────────────
INSERT INTO form_templates (id, organisation_id, created_by, title, description, type, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000020',
   '00000000-0000-0000-0000-000000000001',
   'ba9c1775-2b59-4b59-b158-55ddbc56dc32',
   'Opening Checklist',
   'Daily store opening tasks to be completed before trading hours.',
   'checklist', true),
  ('00000000-0000-0000-0000-000000000021',
   '00000000-0000-0000-0000-000000000001',
   'ba9c1775-2b59-4b59-b158-55ddbc56dc32',
   'Store Incident Report',
   'Report any accident, theft, or unusual incident that occurred in the store.',
   'form', true),
  ('00000000-0000-0000-0000-000000000022',
   '00000000-0000-0000-0000-000000000001',
   'ba9c1775-2b59-4b59-b158-55ddbc56dc32',
   'Weekly Inventory Count',
   'Count key SKUs and report discrepancies at the end of each week.',
   'form', true)
ON CONFLICT (id) DO NOTHING;

-- ── FORM SECTIONS ────────────────────────────────────────────
INSERT INTO form_sections (id, form_template_id, title, display_order)
VALUES
  -- Opening Checklist
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000020', 'Store Setup',        1),
  ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000020', 'Safety & Security',  2),
  -- Incident Report
  ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000021', 'Incident Details',   1),
  ('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000021', 'Follow-up Actions',  2),
  -- Inventory Count
  ('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000022', 'Product Count',      1),
  ('00000000-0000-0000-0001-000000000006', '00000000-0000-0000-0000-000000000022', 'Discrepancy Notes',  2)
ON CONFLICT (id) DO NOTHING;

-- ── FORM FIELDS ──────────────────────────────────────────────
INSERT INTO form_fields (id, section_id, label, field_type, is_required, options, placeholder, display_order)
VALUES
  -- Opening Checklist › Store Setup
  ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0001-000000000001',
   'Lights and signage on',          'checkbox',    true,  NULL, NULL, 1),
  ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0001-000000000001',
   'POS system booted and tested',   'checkbox',    true,  NULL, NULL, 2),
  ('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0001-000000000001',
   'Opening photo of store front',   'photo',       true,  NULL, NULL, 3),
  ('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0001-000000000001',
   'Staff count on duty',            'number',      true,  NULL, 'e.g. 3', 4),

  -- Opening Checklist › Safety & Security
  ('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0001-000000000002',
   'Fire exits clear',               'checkbox',    true,  NULL, NULL, 1),
  ('00000000-0000-0000-0002-000000000006', '00000000-0000-0000-0001-000000000002',
   'CCTV operational',               'checkbox',    true,  NULL, NULL, 2),
  ('00000000-0000-0000-0002-000000000007', '00000000-0000-0000-0001-000000000002',
   'Security notes',                 'text',        false, NULL, 'Any issues to flag?', 3),

  -- Incident Report › Incident Details
  ('00000000-0000-0000-0002-000000000010', '00000000-0000-0000-0001-000000000003',
   'Date and time of incident',      'datetime',    true,  NULL, NULL, 1),
  ('00000000-0000-0000-0002-000000000011', '00000000-0000-0000-0001-000000000003',
   'Incident type',                  'dropdown',    true,
   '["Theft","Accident","Property Damage","Customer Complaint","Other"]', NULL, 2),
  ('00000000-0000-0000-0002-000000000012', '00000000-0000-0000-0001-000000000003',
   'Description of incident',        'text',        true,  NULL, 'Describe what happened…', 3),
  ('00000000-0000-0000-0002-000000000013', '00000000-0000-0000-0001-000000000003',
   'Photo evidence',                 'photo',       false, NULL, NULL, 4),
  ('00000000-0000-0000-0002-000000000014', '00000000-0000-0000-0001-000000000003',
   'Was anyone injured?',            'checkbox',    true,  NULL, NULL, 5),
  ('00000000-0000-0000-0002-000000000015', '00000000-0000-0000-0001-000000000003',
   'Injury details',                 'text',        false,
   NULL, 'Describe injuries…', 6),

  -- Incident Report › Follow-up Actions
  ('00000000-0000-0000-0002-000000000016', '00000000-0000-0000-0001-000000000004',
   'Immediate actions taken',        'text',        true,  NULL, 'What steps were taken immediately?', 1),
  ('00000000-0000-0000-0002-000000000017', '00000000-0000-0000-0001-000000000004',
   'Notified parties',               'multi_select',false,
   '["Store Manager","HR","Security","Police","Medical"]', NULL, 2),
  ('00000000-0000-0000-0002-000000000018', '00000000-0000-0000-0001-000000000004',
   'Signature',                      'signature',   true,  NULL, NULL, 3),

  -- Inventory Count › Product Count
  ('00000000-0000-0000-0002-000000000020', '00000000-0000-0000-0001-000000000005',
   'Count date',                     'datetime',    true,  NULL, NULL, 1),
  ('00000000-0000-0000-0002-000000000021', '00000000-0000-0000-0001-000000000005',
   'Product category counted',       'dropdown',    true,
   '["Apparel","Footwear","Accessories","Electronics","Home Goods"]', NULL, 2),
  ('00000000-0000-0000-0002-000000000022', '00000000-0000-0000-0001-000000000005',
   'System count (from POS)',        'number',      true,  NULL, '0', 3),
  ('00000000-0000-0000-0002-000000000023', '00000000-0000-0000-0001-000000000005',
   'Physical count',                 'number',      true,  NULL, '0', 4),

  -- Inventory Count › Discrepancy Notes
  ('00000000-0000-0000-0002-000000000024', '00000000-0000-0000-0001-000000000006',
   'Discrepancy reason',             'dropdown',    false,
   '["Damaged goods","Theft","Data entry error","Not yet received","Other"]', NULL, 1),
  ('00000000-0000-0000-0002-000000000025', '00000000-0000-0000-0001-000000000006',
   'Additional notes',               'text',        false, NULL, 'Any remarks…', 2),
  ('00000000-0000-0000-0002-000000000026', '00000000-0000-0000-0001-000000000006',
   'Supervisor signature',           'signature',   true,  NULL, NULL, 3)
ON CONFLICT (id) DO NOTHING;

-- Conditional logic: show "Injury details" only when "Was anyone injured?" is checked
UPDATE form_fields
SET conditional_logic = '{"fieldId":"00000000-0000-0000-0002-000000000014","value":"true","action":"show"}'
WHERE id = '00000000-0000-0000-0002-000000000015';

-- ── FORM ASSIGNMENTS ─────────────────────────────────────────
INSERT INTO form_assignments
  (id, form_template_id, organisation_id, assigned_to_user_id, recurrence, due_at, is_active)
VALUES
  -- Opening Checklist → Sam Staff, daily, due 9am
  ('00000000-0000-0000-0003-000000000001',
   '00000000-0000-0000-0000-000000000020',
   '00000000-0000-0000-0000-000000000001',
   '4d49520d-ee7a-4cb2-9e1e-9c877f230ad4',
   'daily',
   (now()::date + interval '9 hours'), true),

  -- Weekly Inventory → Sam Staff, weekly
  ('00000000-0000-0000-0003-000000000002',
   '00000000-0000-0000-0000-000000000022',
   '00000000-0000-0000-0000-000000000001',
   '4d49520d-ee7a-4cb2-9e1e-9c877f230ad4',
   'weekly',
   (date_trunc('week', now()) + interval '5 days 17 hours'), true),

  -- Incident Report → Sam Staff, once
  ('00000000-0000-0000-0003-000000000003',
   '00000000-0000-0000-0000-000000000021',
   '00000000-0000-0000-0000-000000000001',
   '4d49520d-ee7a-4cb2-9e1e-9c877f230ad4',
   'once',
   (now() + interval '3 days'), true)
ON CONFLICT (id) DO NOTHING;

-- ── FORM SUBMISSIONS (sample data for dashboard metrics) ─────
INSERT INTO form_submissions
  (id, assignment_id, form_template_id, submitted_by, status, submitted_at)
VALUES
  -- Submitted & approved opening checklist
  ('00000000-0000-0000-0004-000000000001',
   '00000000-0000-0000-0003-000000000001',
   '00000000-0000-0000-0000-000000000020',
   '4d49520d-ee7a-4cb2-9e1e-9c877f230ad4',
   'approved',
   now() - interval '2 days'),

  -- Submitted & pending review opening checklist
  ('00000000-0000-0000-0004-000000000002',
   '00000000-0000-0000-0003-000000000001',
   '00000000-0000-0000-0000-000000000020',
   '4d49520d-ee7a-4cb2-9e1e-9c877f230ad4',
   'submitted',
   now() - interval '1 day'),

  -- Submitted inventory count, pending
  ('00000000-0000-0000-0004-000000000003',
   '00000000-0000-0000-0003-000000000002',
   '00000000-0000-0000-0000-000000000022',
   '4d49520d-ee7a-4cb2-9e1e-9c877f230ad4',
   'submitted',
   now() - interval '3 hours')
ON CONFLICT (id) DO NOTHING;

-- Sample responses for submission 1 (approved opening checklist)
INSERT INTO form_responses (submission_id, field_id, value)
VALUES
  ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0002-000000000001', 'true'),
  ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0002-000000000002', 'true'),
  ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0002-000000000004', '4'),
  ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0002-000000000005', 'true'),
  ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0002-000000000006', 'true')
ON CONFLICT DO NOTHING;

-- ── ANNOUNCEMENTS ────────────────────────────────────────────
INSERT INTO announcements
  (id, organisation_id, created_by, title, body, requires_acknowledgement, publish_at)
VALUES
  ('00000000-0000-0000-0005-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'ba9c1775-2b59-4b59-b158-55ddbc56dc32',
   'Q2 Sales Target Update',
   'Great news team! We hit 94% of our Q1 target. Our Q2 goal is ₱4.2M across all branches. Let''s push hard this quarter — weekly tracking starts Monday.',
   true,
   now() - interval '2 days'),

  ('00000000-0000-0000-0005-000000000002',
   '00000000-0000-0000-0000-000000000001',
   '771e1cab-4de5-43a2-8ef8-ce7aab1921b8',
   'New Product Launch — Summer Collection',
   'The Summer 2026 collection arrives in stores on April 1. All staff must complete the product training module before March 28. Display guidelines are pinned in the group chat.',
   false,
   now() - interval '5 hours'),

  ('00000000-0000-0000-0005-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'ba9c1775-2b59-4b59-b158-55ddbc56dc32',
   'Reminder: Safety Inspection This Friday',
   'The BFP safety inspection is scheduled for Friday, March 20 at 10am. Please ensure fire extinguishers are accessible, exits are clear, and the logbook is updated. Managers to confirm readiness by Thursday EOD.',
   true,
   now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;
