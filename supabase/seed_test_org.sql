-- ============================================================
-- RENEGADE RETAIL — 30-Person Org Test Seed
-- Run with: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/seed_test_org.sql
-- ============================================================

BEGIN;

-- ── Variables ─────────────────────────────────────────────
\set org_id '9e12ff9e-bc77-4ca2-8bfb-be7b7c1fe009'
\set loc1   'a1000000-0000-0000-0000-000000000001'
\set loc2   'a1000000-0000-0000-0000-000000000002'
\set loc3   'a1000000-0000-0000-0000-000000000003'
\set loc4   'a1000000-0000-0000-0000-000000000004'

-- ── Locations ─────────────────────────────────────────────
INSERT INTO locations (id, organisation_id, name) VALUES
  (:'loc2', :'org_id', 'Main Branch – Level 2'),
  (:'loc3', :'org_id', 'North Branch'),
  (:'loc4', :'org_id', 'South Branch')
ON CONFLICT (id) DO NOTHING;

-- ── Auth Users ────────────────────────────────────────────
-- Minimal insert into auth.users (no real password needed for seed data)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role, aud, instance_id, created_at, updated_at) VALUES
  ('b0000001-0000-0000-0000-000000000001','maria.santos@renegade.com',    '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000001-0000-0000-0000-000000000002','jose.cruz@renegade.com',       '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000001-0000-0000-0000-000000000003','ana.reyes@renegade.com',       '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000001-0000-0000-0000-000000000004','carlo.delacruz@renegade.com',  '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000001-0000-0000-0000-000000000005','rosa.mendoza@renegade.com',    '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000001','juan.bautista@renegade.com',   '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000002','luz.flores@renegade.com',      '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000003','pedro.aquino@renegade.com',    '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000004','elena.villanueva@renegade.com','$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000005','miguel.torres@renegade.com',   '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000006','sofia.castillo@renegade.com',  '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000007','ramon.garcia@renegade.com',    '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000008','celia.ramos@renegade.com',     '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000009','fernando.lopez@renegade.com',  '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000010','maricel.salazar@renegade.com', '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000011','antonio.hernandez@renegade.com','$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000012','liza.navarro@renegade.com',    '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000013','eduardo.pascual@renegade.com', '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000014','cristina.ocampo@renegade.com', '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000015','alberto.morales@renegade.com', '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000016','diana.reyes@renegade.com',     '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000017','roberto.santos@renegade.com',  '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000018','carmela.cruz@renegade.com',    '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000019','dominic.guerrero@renegade.com','$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000020','jasmine.lim@renegade.com',     '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now()),
  ('b0000002-0000-0000-0000-000000000021','kenneth.tan@renegade.com',     '$2a$10$placeholder','2026-01-01 00:00:00+00','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now())
ON CONFLICT (id) DO NOTHING;

-- ── Profiles ──────────────────────────────────────────────
-- 26 new users (4 existing = 30 total)
INSERT INTO profiles (id, organisation_id, location_id, full_name, role) VALUES
  -- Managers (5)
  ('b0000001-0000-0000-0000-000000000001', :'org_id', :'loc1', 'Maria Santos',     'manager'),
  ('b0000001-0000-0000-0000-000000000002', :'org_id', :'loc2', 'Jose Cruz',        'manager'),
  ('b0000001-0000-0000-0000-000000000003', :'org_id', :'loc3', 'Ana Reyes',        'manager'),
  ('b0000001-0000-0000-0000-000000000004', :'org_id', :'loc4', 'Carlo Dela Cruz',  'manager'),
  ('b0000001-0000-0000-0000-000000000005', :'org_id', :'loc2', 'Rosa Mendoza',     'manager'),
  -- Staff (21)
  ('b0000002-0000-0000-0000-000000000001', :'org_id', :'loc1', 'Juan Bautista',    'staff'),
  ('b0000002-0000-0000-0000-000000000002', :'org_id', :'loc1', 'Luz Flores',       'staff'),
  ('b0000002-0000-0000-0000-000000000003', :'org_id', :'loc1', 'Pedro Aquino',     'staff'),
  ('b0000002-0000-0000-0000-000000000004', :'org_id', :'loc2', 'Elena Villanueva', 'staff'),
  ('b0000002-0000-0000-0000-000000000005', :'org_id', :'loc2', 'Miguel Torres',    'staff'),
  ('b0000002-0000-0000-0000-000000000006', :'org_id', :'loc2', 'Sofia Castillo',   'staff'),
  ('b0000002-0000-0000-0000-000000000007', :'org_id', :'loc3', 'Ramon Garcia',     'staff'),
  ('b0000002-0000-0000-0000-000000000008', :'org_id', :'loc3', 'Celia Ramos',      'staff'),
  ('b0000002-0000-0000-0000-000000000009', :'org_id', :'loc3', 'Fernando Lopez',   'staff'),
  ('b0000002-0000-0000-0000-000000000010', :'org_id', :'loc3', 'Maricel Salazar',  'staff'),
  ('b0000002-0000-0000-0000-000000000011', :'org_id', :'loc4', 'Antonio Hernandez','staff'),
  ('b0000002-0000-0000-0000-000000000012', :'org_id', :'loc4', 'Liza Navarro',     'staff'),
  ('b0000002-0000-0000-0000-000000000013', :'org_id', :'loc4', 'Eduardo Pascual',  'staff'),
  ('b0000002-0000-0000-0000-000000000014', :'org_id', :'loc4', 'Cristina Ocampo',  'staff'),
  ('b0000002-0000-0000-0000-000000000015', :'org_id', :'loc1', 'Alberto Morales',  'staff'),
  ('b0000002-0000-0000-0000-000000000016', :'org_id', :'loc1', 'Diana Reyes',      'staff'),
  ('b0000002-0000-0000-0000-000000000017', :'org_id', :'loc2', 'Roberto Santos',   'staff'),
  ('b0000002-0000-0000-0000-000000000018', :'org_id', :'loc3', 'Carmela Cruz',     'staff'),
  ('b0000002-0000-0000-0000-000000000019', :'org_id', :'loc4', 'Dominic Guerrero', 'staff'),
  ('b0000002-0000-0000-0000-000000000020', :'org_id', :'loc2', 'Jasmine Lim',      'staff'),
  ('b0000002-0000-0000-0000-000000000021', :'org_id', :'loc3', 'Kenneth Tan',      'staff')
ON CONFLICT (id) DO NOTHING;

-- ── User Points ───────────────────────────────────────────
-- Tier 1 – Top performers (400–600 pts)
INSERT INTO user_points (user_id, organisation_id, total_points, issues_reported, issues_resolved, checklists_completed, checklist_current_streak, checklist_longest_streak, tasks_completed, audit_perfect_scores) VALUES
  ('b0000002-0000-0000-0000-000000000001', :'org_id', 590, 42, 38, 120, 14,  21, 55, 8),
  ('b0000001-0000-0000-0000-000000000001', :'org_id', 565, 38, 35, 105, 11,  18, 48, 7),
  ('b0000002-0000-0000-0000-000000000004', :'org_id', 530, 35, 31, 98,  9,   15, 44, 6),
  ('b0000002-0000-0000-0000-000000000007', :'org_id', 505, 31, 29, 92,  7,   14, 41, 5),
  ('b0000001-0000-0000-0000-000000000003', :'org_id', 470, 28, 26, 87,  5,   12, 37, 5),
-- Tier 2 – Mid performers (200–380 pts)
  ('b0000002-0000-0000-0000-000000000008', :'org_id', 375, 22, 20, 75,  4,   10, 32, 4),
  ('b0000002-0000-0000-0000-000000000002', :'org_id', 355, 20, 18, 70,  3,    9, 30, 3),
  ('b0000002-0000-0000-0000-000000000011', :'org_id', 330, 18, 16, 65,  3,    8, 28, 3),
  ('b0000001-0000-0000-0000-000000000002', :'org_id', 310, 16, 15, 60,  2,    7, 25, 2),
  ('b0000002-0000-0000-0000-000000000005', :'org_id', 285, 14, 13, 55,  2,    6, 22, 2),
  ('b0000002-0000-0000-0000-000000000016', :'org_id', 265, 13, 12, 50,  2,    5, 20, 2),
  ('b0000001-0000-0000-0000-000000000004', :'org_id', 245, 12, 11, 45,  1,    5, 18, 1),
  ('b0000002-0000-0000-0000-000000000013', :'org_id', 225, 11, 10, 40,  1,    4, 16, 1),
  ('b0000002-0000-0000-0000-000000000020', :'org_id', 210, 10,  9, 38,  1,    3, 15, 1),
  ('b0000002-0000-0000-0000-000000000017', :'org_id', 200,  9,  8, 35,  0,    3, 13, 1),
-- Tier 3 – Early/casual (20–150 pts)
  ('b0000002-0000-0000-0000-000000000003', :'org_id', 148,  8,  7, 30,  0,    2, 11, 0),
  ('b0000002-0000-0000-0000-000000000009', :'org_id', 130,  7,  6, 27,  0,    2, 10, 0),
  ('b0000002-0000-0000-0000-000000000006', :'org_id', 115,  6,  5, 24,  0,    1,  9, 0),
  ('b0000002-0000-0000-0000-000000000018', :'org_id',  98,  5,  4, 20,  0,    1,  7, 0),
  ('b0000002-0000-0000-0000-000000000012', :'org_id',  85,  4,  3, 17,  0,    0,  6, 0),
  ('b0000001-0000-0000-0000-000000000005', :'org_id',  75,  4,  3, 15,  0,    0,  5, 0),
  ('b0000002-0000-0000-0000-000000000014', :'org_id',  65,  3,  3, 13,  0,    0,  5, 0),
  ('b0000002-0000-0000-0000-000000000019', :'org_id',  55,  3,  2, 11,  0,    0,  4, 0),
  ('b0000002-0000-0000-0000-000000000015', :'org_id',  45,  2,  2,  9,  0,    0,  3, 0),
  ('b0000002-0000-0000-0000-000000000010', :'org_id',  35,  2,  1,  7,  0,    0,  2, 0),
  ('b0000002-0000-0000-0000-000000000021', :'org_id',  22,  1,  1,  5,  0,    0,  1, 0)
ON CONFLICT (user_id) DO UPDATE SET
  total_points               = EXCLUDED.total_points,
  issues_reported            = EXCLUDED.issues_reported,
  issues_resolved            = EXCLUDED.issues_resolved,
  checklists_completed       = EXCLUDED.checklists_completed,
  checklist_current_streak   = EXCLUDED.checklist_current_streak,
  checklist_longest_streak   = EXCLUDED.checklist_longest_streak,
  tasks_completed            = EXCLUDED.tasks_completed,
  audit_perfect_scores       = EXCLUDED.audit_perfect_scores;

-- ── Badge Awards ──────────────────────────────────────────
-- Badge IDs (from badge_configs already seeded)
-- issues_reported : First Responder (23dd3000), Safety Spotter (e4bcbcfc), Safety Champion (07fbbe1b)
-- issues_resolved : Quick Fix (470bd1f6), Problem Solver (b67529c4)
-- tasks_completed : Gets Things Done (15e28509), Task Master (243d11d6)
-- audit_perfect   : No Findings (ef85bd5f), Perfect Score (145b7b8d)
-- checklists      : Consistent (027c6e01), Reliable (0a13027a), Operations Star (f1ca2c94), On It (222fa89e)

-- awarded_by = Super Admin
\set awarded_by '405d1108-a39b-414a-848f-c157b9ef8c2e'

-- Helper: truncate existing awards for our seed users so re-runs are idempotent
DELETE FROM user_badge_awards
  WHERE user_id::text LIKE 'b0000002%' OR user_id::text LIKE 'b0000001%';

-- ── Top 5 – multiple badges each ─────────────────────────
-- Juan Bautista (rank #1, 590 pts)
INSERT INTO user_badge_awards (user_id, badge_id, organisation_id, awarded_by) VALUES
  ('b0000002-0000-0000-0000-000000000001', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'), -- First Responder
  ('b0000002-0000-0000-0000-000000000001', 'e4bcbcfc-e64d-45a9-bb78-b03b8eb5ab28', :'org_id', :'awarded_by'), -- Safety Spotter
  ('b0000002-0000-0000-0000-000000000001', '07fbbe1b-a77a-4ed2-8716-f4ea075c616e', :'org_id', :'awarded_by'), -- Safety Champion
  ('b0000002-0000-0000-0000-000000000001', '470bd1f6-c50d-4335-96a4-b67f5d6ada7e', :'org_id', :'awarded_by'), -- Quick Fix
  ('b0000002-0000-0000-0000-000000000001', '243d11d6-19f8-471e-bc5c-588d7f32e3a2', :'org_id', :'awarded_by'), -- Task Master
  ('b0000002-0000-0000-0000-000000000001', 'ef85bd5f-91c9-4fd6-b2b6-e718902e1eaa', :'org_id', :'awarded_by'), -- No Findings
  ('b0000002-0000-0000-0000-000000000001', 'f1ca2c94-489a-4af2-837f-6a98234cda90', :'org_id', :'awarded_by'); -- Operations Star

-- Maria Santos (rank #2, 565 pts)
INSERT INTO user_badge_awards (user_id, badge_id, organisation_id, awarded_by) VALUES
  ('b0000001-0000-0000-0000-000000000001', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'), -- First Responder
  ('b0000001-0000-0000-0000-000000000001', 'e4bcbcfc-e64d-45a9-bb78-b03b8eb5ab28', :'org_id', :'awarded_by'), -- Safety Spotter
  ('b0000001-0000-0000-0000-000000000001', '07fbbe1b-a77a-4ed2-8716-f4ea075c616e', :'org_id', :'awarded_by'), -- Safety Champion
  ('b0000001-0000-0000-0000-000000000001', '470bd1f6-c50d-4335-96a4-b67f5d6ada7e', :'org_id', :'awarded_by'), -- Quick Fix
  ('b0000001-0000-0000-0000-000000000001', 'b67529c4-10d7-4dad-84fe-1749c761a545', :'org_id', :'awarded_by'), -- Problem Solver
  ('b0000001-0000-0000-0000-000000000001', '0a13027a-117e-4b54-a9f1-75d1fed3c0db', :'org_id', :'awarded_by'); -- Reliable

-- Elena Villanueva (rank #3, 530 pts)
INSERT INTO user_badge_awards (user_id, badge_id, organisation_id, awarded_by) VALUES
  ('b0000002-0000-0000-0000-000000000004', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'),
  ('b0000002-0000-0000-0000-000000000004', 'e4bcbcfc-e64d-45a9-bb78-b03b8eb5ab28', :'org_id', :'awarded_by'),
  ('b0000002-0000-0000-0000-000000000004', '470bd1f6-c50d-4335-96a4-b67f5d6ada7e', :'org_id', :'awarded_by'),
  ('b0000002-0000-0000-0000-000000000004', '15e28509-2ee2-42f4-9b36-f26d5b3bf077', :'org_id', :'awarded_by'), -- Gets Things Done
  ('b0000002-0000-0000-0000-000000000004', '027c6e01-2b4d-4a07-90f9-6395c279426c', :'org_id', :'awarded_by'); -- Consistent

-- Ramon Garcia (rank #4, 505 pts)
INSERT INTO user_badge_awards (user_id, badge_id, organisation_id, awarded_by) VALUES
  ('b0000002-0000-0000-0000-000000000007', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'),
  ('b0000002-0000-0000-0000-000000000007', 'e4bcbcfc-e64d-45a9-bb78-b03b8eb5ab28', :'org_id', :'awarded_by'),
  ('b0000002-0000-0000-0000-000000000007', '470bd1f6-c50d-4335-96a4-b67f5d6ada7e', :'org_id', :'awarded_by'),
  ('b0000002-0000-0000-0000-000000000007', 'ef85bd5f-91c9-4fd6-b2b6-e718902e1eaa', :'org_id', :'awarded_by');

-- Ana Reyes (rank #5, 470 pts)
INSERT INTO user_badge_awards (user_id, badge_id, organisation_id, awarded_by) VALUES
  ('b0000001-0000-0000-0000-000000000003', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'),
  ('b0000001-0000-0000-0000-000000000003', 'e4bcbcfc-e64d-45a9-bb78-b03b8eb5ab28', :'org_id', :'awarded_by'),
  ('b0000001-0000-0000-0000-000000000003', 'b67529c4-10d7-4dad-84fe-1749c761a545', :'org_id', :'awarded_by'),
  ('b0000001-0000-0000-0000-000000000003', '145b7b8d-8692-476a-abee-199b401a0b0b', :'org_id', :'awarded_by'); -- Perfect Score

-- ── Mid Tier – 1–3 badges each ───────────────────────────
INSERT INTO user_badge_awards (user_id, badge_id, organisation_id, awarded_by) VALUES
  -- Celia Ramos
  ('b0000002-0000-0000-0000-000000000008', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'),
  ('b0000002-0000-0000-0000-000000000008', '470bd1f6-c50d-4335-96a4-b67f5d6ada7e', :'org_id', :'awarded_by'),
  -- Luz Flores
  ('b0000002-0000-0000-0000-000000000002', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'),
  ('b0000002-0000-0000-0000-000000000002', '222fa89e-9b87-48f5-a7bf-6412cf28f30c', :'org_id', :'awarded_by'), -- On It
  -- Antonio Hernandez
  ('b0000002-0000-0000-0000-000000000011', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'),
  ('b0000002-0000-0000-0000-000000000011', '15e28509-2ee2-42f4-9b36-f26d5b3bf077', :'org_id', :'awarded_by'),
  -- Jose Cruz
  ('b0000001-0000-0000-0000-000000000002', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'),
  ('b0000001-0000-0000-0000-000000000002', '470bd1f6-c50d-4335-96a4-b67f5d6ada7e', :'org_id', :'awarded_by'),
  -- Miguel Torres
  ('b0000002-0000-0000-0000-000000000005', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'),
  -- Diana Reyes
  ('b0000002-0000-0000-0000-000000000016', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'),
  ('b0000002-0000-0000-0000-000000000016', '222fa89e-9b87-48f5-a7bf-6412cf28f30c', :'org_id', :'awarded_by'),
  -- Carlo Dela Cruz
  ('b0000001-0000-0000-0000-000000000004', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'),
  -- Eduardo Pascual
  ('b0000002-0000-0000-0000-000000000013', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by'),
  -- Jasmine Lim
  ('b0000002-0000-0000-0000-000000000020', '23dd3000-2913-4605-a413-5402a61ac9de', :'org_id', :'awarded_by');

-- ── Summary check ─────────────────────────────────────────
SELECT
  COUNT(*)                                         AS total_profiles,
  COUNT(*) FILTER (WHERE role = 'staff')           AS staff,
  COUNT(*) FILTER (WHERE role = 'manager')         AS managers,
  COUNT(*) FILTER (WHERE role IN ('admin','super_admin')) AS admins
FROM profiles
WHERE organisation_id = '9e12ff9e-bc77-4ca2-8bfb-be7b7c1fe009'
  AND is_deleted = false;

SELECT COUNT(*) AS user_points_rows FROM user_points
  WHERE organisation_id = '9e12ff9e-bc77-4ca2-8bfb-be7b7c1fe009';

SELECT COUNT(*) AS badge_awards FROM user_badge_awards
  WHERE organisation_id = '9e12ff9e-bc77-4ca2-8bfb-be7b7c1fe009';

COMMIT;
