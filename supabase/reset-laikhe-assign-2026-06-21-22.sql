-- RESET phân công Tổ SX Lai Khê — ngày 21/06 (phiên A) và 22/06 (phiên B)
-- Chạy MỘT file này trên Supabase SQL Editor (thay cho cleanup + seed riêng lẻ)
--
-- Kết quả:
--   21/06 → chỉ phiên A (~49 PC, gồm 9 KH)
--   22/06 → chỉ phiên B (56 PC, gồm 9 KH)
--   Không còn dữ liệu rác ngày 01/06 hoặc bản trùng từ app

BEGIN;

-- ========== XÓA SẠCH ==========
DELETE FROM section_worker_assignments swa
USING tapping_sections ts
WHERE swa.tapping_section_id = ts.id
  AND ts.team_id = 'team-lk'
  AND swa.record_date IN (DATE '2026-06-01', DATE '2026-06-21', DATE '2026-06-22');

-- Xóa thêm mọi dòng cùng ngày (kể cả id do app tạo: swa-20260621-...)
DELETE FROM section_worker_assignments
WHERE record_date IN (DATE '2026-06-21', DATE '2026-06-22')
  AND (
    id LIKE 'swa-lk-%'
    OR id LIKE 'swa-20260621-%'
    OR id LIKE 'swa-20260622-%'
  );

-- Lô KH: phiên theo ngày — không gán tapping_session trên master
UPDATE tapping_sections ts
SET metadata = (COALESCE(ts.metadata, '{}'::jsonb) - 'tapping_session') || jsonb_build_object('work_mode', 'solo')
WHERE ts.team_id = 'team-lk'
  AND ts.lot_id IN (
    '1.14VI.LK.96.067', '1.14VI.LK.96.065', '1.14VI.LK.95.060', '1.14VI.LK.95.057'
  );

-- ========== NGÀY 21/06 — PHIÊN A ==========
UPDATE tapping_sections ts
SET metadata = COALESCE(ts.metadata, '{}'::jsonb) || jsonb_build_object('work_mode', 'solo', 'tapping_session', 'A')
WHERE ts.team_id = 'team-lk'
  AND ts.id IN (
    SELECT ts2.id FROM (VALUES
      ('1.14VI.LK.17.108', 1), ('1.14VI.LK.17.108', 2),
      ('1.14VI.LK.17.109', 1), ('1.14VI.LK.17.109', 2),
      ('1.14VI.LK.17.111', 1), ('1.14VI.LK.17.111', 2), ('1.14VI.LK.17.111', 3),
      ('1.14VI.LK.17.111', 4), ('1.14VI.LK.17.111', 5), ('1.14VI.LK.17.111', 6), ('1.14VI.LK.17.111', 7),
      ('1.14VI.LK.18.118', 1), ('1.14VI.LK.18.118', 2), ('1.14VI.LK.18.118', 3),
      ('1.14VI.LK.18.118', 4), ('1.14VI.LK.18.118', 5), ('1.14VI.LK.18.118', 6),
      ('1.14VI.LK.16.098', 1), ('1.14VI.LK.16.098', 2), ('1.14VI.LK.16.098', 3),
      ('1.14VI.LK.16.097', 8),
      ('1.14VI.LK.04.082', 1), ('1.14VI.LK.04.082', 3), ('1.14VI.LK.04.082', 4),
      ('1.14VI.LK.04.082', 5), ('1.14VI.LK.04.082', 6), ('1.14VI.LK.04.082', 7),
      ('1.14VI.LK.06.085', 1), ('1.14VI.LK.06.085', 2), ('1.14VI.LK.06.085', 3),
      ('1.14VI.LK.06.085', 4), ('1.14VI.LK.06.085', 5),
      ('1.14VI.LK.07.086', 1), ('1.14VI.LK.07.086', 2), ('1.14VI.LK.07.086', 3),
      ('1.14VI.LK.07.086', 4), ('1.14VI.LK.07.086', 5), ('1.14VI.LK.07.086', 6),
      ('1.14VI.LK.07.086', 7), ('1.14VI.LK.07.086', 8)
    ) AS x(lot_id, section_no)
    JOIN tapping_sections ts2 ON ts2.lot_id = x.lot_id AND ts2.section_no = x.section_no
  );

INSERT INTO section_worker_assignments (id, record_date, tapping_section_id, worker_id, assignment_role, notes, metadata)
SELECT
  'swa-lk-a-' || to_char(DATE '2026-06-21', 'YYYYMMDD') || '-' || ts.id || '-' || e.employee_code,
  DATE '2026-06-21', ts.id, e.id, 'tapper', '',
  jsonb_build_object(
    'tapping_session', 'A', 'work_mode', 'solo', 'lot_code', m.lot_id, 'yield_share_pct', 100,
    'slots', jsonb_build_array(jsonb_build_object(
      'tapper_id', e.id::text, 'tapper_pct', 100,
      'stripper_id', e.id::text, 'stripper_pct', 100,
      'collector_id', e.id::text, 'collector_pct', 100
    )),
    'roles', jsonb_build_array(
      jsonb_build_object('role', 'tapper', 'yield_share_pct', 100),
      jsonb_build_object('role', 'stripper', 'yield_share_pct', 100),
      jsonb_build_object('role', 'collector', 'yield_share_pct', 100)
    )
  )
FROM (VALUES
  ('LK-CN-039', '1.14VI.LK.17.108', 1), ('LK-CN-003', '1.14VI.LK.17.108', 2),
  ('LK-CN-023', '1.14VI.LK.17.109', 1), ('LK-CN-004', '1.14VI.LK.17.109', 2),
  ('LK-CN-024', '1.14VI.LK.17.111', 1), ('LK-CN-038', '1.14VI.LK.17.111', 2),
  ('LK-CN-013', '1.14VI.LK.17.111', 3), ('LK-CN-026', '1.14VI.LK.17.111', 4),
  ('LK-CN-031', '1.14VI.LK.17.111', 5), ('LK-CN-012', '1.14VI.LK.17.111', 6),
  ('LK-CN-020', '1.14VI.LK.17.111', 7), ('LK-CN-033', '1.14VI.LK.18.118', 1),
  ('LK-CN-005', '1.14VI.LK.18.118', 2), ('LK-CN-016', '1.14VI.LK.18.118', 3),
  ('LK-CN-021', '1.14VI.LK.18.118', 4), ('LK-CN-015', '1.14VI.LK.18.118', 5),
  ('LK-CN-027', '1.14VI.LK.18.118', 6), ('LK-CN-001', '1.14VI.LK.16.098', 1),
  ('LK-CN-025', '1.14VI.LK.16.098', 2), ('LK-CN-036', '1.14VI.LK.16.098', 3),
  ('LK-CN-008', '1.14VI.LK.16.097', 8), ('LK-CN-022', '1.14VI.LK.04.082', 1),
  ('LK-CN-002', '1.14VI.LK.04.082', 3), ('LK-CN-034', '1.14VI.LK.04.082', 4),
  ('LK-CN-009', '1.14VI.LK.04.082', 5), ('LK-CN-037', '1.14VI.LK.04.082', 6),
  ('LK-CN-029', '1.14VI.LK.04.082', 7), ('LK-CN-010', '1.14VI.LK.06.085', 1),
  ('LK-CN-030', '1.14VI.LK.06.085', 2), ('LK-CN-032', '1.14VI.LK.06.085', 3),
  ('LK-CN-028', '1.14VI.LK.06.085', 4), ('LK-CN-019', '1.14VI.LK.06.085', 5),
  ('LK-CN-014', '1.14VI.LK.07.086', 1), ('LK-CN-035', '1.14VI.LK.07.086', 2),
  ('LK-CN-006', '1.14VI.LK.07.086', 3), ('LK-CN-018', '1.14VI.LK.07.086', 4),
  ('LK-CN-011', '1.14VI.LK.07.086', 5), ('LK-CN-017', '1.14VI.LK.07.086', 6),
  ('LK-CN-021', '1.14VI.LK.07.086', 7), ('LK-CN-007', '1.14VI.LK.07.086', 8),
  ('LK-KH-001', '1.14VI.LK.96.067', 1), ('LK-KH-002', '1.14VI.LK.96.067', 2),
  ('LK-KH-003', '1.14VI.LK.96.067', 3), ('LK-KH-004', '1.14VI.LK.96.067', 4),
  ('LK-KH-005', '1.14VI.LK.96.067', 5), ('LK-KH-006', '1.14VI.LK.96.065', 1),
  ('LK-KH-007', '1.14VI.LK.95.060', 1), ('LK-KH-008', '1.14VI.LK.95.060', 2),
  ('LK-KH-009', '1.14VI.LK.95.057', 1)
) AS m(employee_code, lot_id, section_no)
JOIN employee e ON e.employee_code = m.employee_code
JOIN tapping_sections ts ON ts.lot_id = m.lot_id AND ts.section_no = m.section_no AND ts.team_id = 'team-lk';

-- ========== NGÀY 22/06 — PHIÊN B ==========
UPDATE tapping_sections ts
SET metadata = COALESCE(ts.metadata, '{}'::jsonb) || jsonb_build_object('tapping_session', 'B', 'work_mode', 'solo')
WHERE ts.team_id = 'team-lk'
  AND ts.id IN (
    SELECT ts2.id FROM (VALUES
      ('1.14VI.LK.16.103', 1), ('1.14VI.LK.16.103', 2), ('1.14VI.LK.16.103', 3),
      ('1.14VI.LK.16.103', 4), ('1.14VI.LK.16.103', 5), ('1.14VI.LK.16.103', 6),
      ('1.14VI.LK.16.103.2', 1),
      ('1.14VI.LK.19.121', 1), ('1.14VI.LK.19.121', 2), ('1.14VI.LK.19.121', 3), ('1.14VI.LK.19.121', 4),
      ('1.14VI.LK.19.124', 1), ('1.14VI.LK.19.124', 2),
      ('1.14VI.LK.17.110', 1), ('1.14VI.LK.17.110', 2), ('1.14VI.LK.17.110', 3),
      ('1.14VI.LK.17.112', 1), ('1.14VI.LK.17.112', 2), ('1.14VI.LK.17.112', 3),
      ('1.14VI.LK.17.112', 4), ('1.14VI.LK.17.112', 5), ('1.14VI.LK.17.112', 6),
      ('1.14VI.LK.17.112', 7), ('1.14VI.LK.17.112', 8), ('1.14VI.LK.17.112', 9), ('1.14VI.LK.17.112', 10),
      ('1.14VI.LK.19.125', 1),
      ('1.14VI.LK.15.092', 1), ('1.14VI.LK.15.092', 2), ('1.14VI.LK.15.092', 3),
      ('1.14VI.LK.15.092', 4), ('1.14VI.LK.15.092', 5), ('1.14VI.LK.15.092', 6),
      ('1.14VI.LK.15.093', 1), ('1.14VI.LK.15.093', 2), ('1.14VI.LK.15.093', 3),
      ('1.14VI.LK.15.093', 4), ('1.14VI.LK.15.093', 5), ('1.14VI.LK.15.093', 6),
      ('1.14VI.LK.03.081', 1), ('1.14VI.LK.03.081', 2), ('1.14VI.LK.03.081', 3),
      ('1.14VI.LK.03.081', 4), ('1.14VI.LK.03.081', 5), ('1.14VI.LK.03.081', 6),
      ('1.14VI.LK.13.089', 1), ('1.14VI.LK.18.119', 1)
    ) AS x(lot_id, section_no)
    JOIN tapping_sections ts2 ON ts2.lot_id = x.lot_id AND ts2.section_no = x.section_no
  );

INSERT INTO section_worker_assignments (id, record_date, tapping_section_id, worker_id, assignment_role, notes, metadata)
SELECT
  'swa-lk-b-' || to_char(DATE '2026-06-22', 'YYYYMMDD') || '-' || ts.id || '-' || e.employee_code,
  DATE '2026-06-22', ts.id, e.id, 'tapper', '',
  jsonb_build_object(
    'tapping_session', 'B', 'work_mode', 'solo', 'lot_code', m.lot_id, 'yield_share_pct', 100,
    'slots', jsonb_build_array(jsonb_build_object(
      'tapper_id', e.id::text, 'tapper_pct', 100,
      'stripper_id', e.id::text, 'stripper_pct', 100,
      'collector_id', e.id::text, 'collector_pct', 100
    )),
    'roles', jsonb_build_array(
      jsonb_build_object('role', 'tapper', 'yield_share_pct', 100),
      jsonb_build_object('role', 'stripper', 'yield_share_pct', 100),
      jsonb_build_object('role', 'collector', 'yield_share_pct', 100)
    )
  )
FROM (VALUES
  ('LK-CN-001', '1.14VI.LK.16.103', 1), ('LK-CN-002', '1.14VI.LK.16.103', 2),
  ('LK-CN-003', '1.14VI.LK.16.103', 3), ('LK-CN-004', '1.14VI.LK.16.103', 4),
  ('LK-CN-005', '1.14VI.LK.16.103', 5), ('LK-CN-006', '1.14VI.LK.16.103', 6),
  ('LK-CN-006', '1.14VI.LK.16.103.2', 1), ('LK-CN-007', '1.14VI.LK.19.121', 1),
  ('LK-CN-008', '1.14VI.LK.19.121', 2), ('LK-CN-009', '1.14VI.LK.19.121', 3),
  ('LK-CN-008', '1.14VI.LK.19.121', 4), ('LK-CN-010', '1.14VI.LK.19.124', 1),
  ('LK-CN-011', '1.14VI.LK.19.124', 2), ('LK-CN-012', '1.14VI.LK.17.110', 1),
  ('LK-CN-013', '1.14VI.LK.17.110', 2), ('LK-CN-014', '1.14VI.LK.17.110', 3),
  ('LK-CN-015', '1.14VI.LK.17.112', 1), ('LK-CN-016', '1.14VI.LK.17.112', 2),
  ('LK-CN-017', '1.14VI.LK.17.112', 3), ('LK-CN-018', '1.14VI.LK.17.112', 4),
  ('LK-CN-019', '1.14VI.LK.17.112', 5), ('LK-CN-020', '1.14VI.LK.17.112', 6),
  ('LK-CN-021', '1.14VI.LK.17.112', 7), ('LK-CN-022', '1.14VI.LK.17.112', 8),
  ('LK-CN-023', '1.14VI.LK.17.112', 9), ('LK-CN-024', '1.14VI.LK.17.112', 10),
  ('LK-CN-025', '1.14VI.LK.19.125', 1), ('LK-CN-024', '1.14VI.LK.15.092', 1),
  ('LK-CN-026', '1.14VI.LK.15.092', 2), ('LK-CN-025', '1.14VI.LK.15.092', 3),
  ('LK-CN-027', '1.14VI.LK.15.092', 4), ('LK-CN-028', '1.14VI.LK.15.092', 5),
  ('LK-CN-016', '1.14VI.LK.15.092', 6), ('LK-CN-029', '1.14VI.LK.15.093', 1),
  ('LK-CN-030', '1.14VI.LK.15.093', 2), ('LK-CN-031', '1.14VI.LK.15.093', 3),
  ('LK-CN-032', '1.14VI.LK.15.093', 4), ('LK-CN-033', '1.14VI.LK.15.093', 5),
  ('LK-CN-034', '1.14VI.LK.15.093', 6), ('LK-CN-031', '1.14VI.LK.03.081', 1),
  ('LK-CN-035', '1.14VI.LK.03.081', 2), ('LK-CN-030', '1.14VI.LK.03.081', 3),
  ('LK-CN-036', '1.14VI.LK.03.081', 4), ('LK-CN-037', '1.14VI.LK.03.081', 5),
  ('LK-CN-038', '1.14VI.LK.03.081', 6), ('LK-CN-039', '1.14VI.LK.13.089', 1),
  ('LK-CN-001', '1.14VI.LK.18.119', 1),
  ('LK-KH-001', '1.14VI.LK.96.067', 1), ('LK-KH-002', '1.14VI.LK.96.067', 2),
  ('LK-KH-003', '1.14VI.LK.96.067', 3), ('LK-KH-004', '1.14VI.LK.96.067', 4),
  ('LK-KH-005', '1.14VI.LK.96.067', 5), ('LK-KH-006', '1.14VI.LK.96.065', 1),
  ('LK-KH-007', '1.14VI.LK.95.060', 1), ('LK-KH-008', '1.14VI.LK.95.060', 2),
  ('LK-KH-009', '1.14VI.LK.95.057', 1)
) AS m(employee_code, lot_id, section_no)
JOIN employee e ON e.employee_code = m.employee_code
JOIN tapping_sections ts ON ts.lot_id = m.lot_id AND ts.section_no = m.section_no AND ts.team_id = 'team-lk';

COMMIT;

-- Kiểm tra:
-- SELECT record_date, tapping_session, COUNT(*)
-- FROM v_tapping_section_roster
-- WHERE team_name = 'Tổ SX Lai Khê' AND record_date IN ('2026-06-21','2026-06-22')
-- GROUP BY 1, 2 ORDER BY 1, 2;
