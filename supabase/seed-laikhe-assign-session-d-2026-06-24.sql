-- Phân công cạo mủ Tổ SX Lai Khê — Phiên D, ngày 24/06/2026
-- Nguồn: bảng phân công phiên D (cạo 1 mình — work_mode solo)
--
-- Chạy SAU seed-laikhe-workforce.sql
-- App: Tổ SX Lai Khê → Phiên D → ngày 24/06/2026
--
-- Bỏ qua: Hoàng Thị Kim Lan (LK-KH-010) — bảng gốc chưa có lô/PC (KH08959697)

BEGIN;

DELETE FROM section_worker_assignments swa
USING tapping_sections ts
WHERE swa.tapping_section_id = ts.id
  AND ts.team_id = 'team-lk'
  AND swa.record_date = DATE '2026-06-24';

DELETE FROM section_worker_assignments
WHERE record_date = DATE '2026-06-24'
  AND (
    id LIKE 'swa-lk-d-%'
    OR id LIKE 'swa-20260624-%'
  );

-- Phiên D trên master (lô CN)
UPDATE tapping_sections ts
SET metadata = COALESCE(ts.metadata, '{}'::jsonb) || jsonb_build_object(
  'tapping_session', 'D',
  'work_mode', 'solo'
)
WHERE ts.team_id = 'team-lk'
  AND ts.id IN (
    SELECT ts2.id
    FROM (VALUES
      ('1.14VI.LK.15.094', 1), ('1.14VI.LK.15.094', 2),
      ('1.14VI.LK.16.099', 1), ('1.14VI.LK.16.099', 2), ('1.14VI.LK.16.099', 3),
      ('1.14VI.LK.16.096', 1), ('1.14VI.LK.16.096', 2), ('1.14VI.LK.16.096', 3),
      ('1.14VI.LK.16.096', 4), ('1.14VI.LK.16.096', 5),
      ('1.14VI.LK.16.100', 1), ('1.14VI.LK.16.100', 2),
      ('1.14VI.LK.17.106', 1), ('1.14VI.LK.17.106', 2), ('1.14VI.LK.17.106', 3),
      ('1.14VI.LK.16.104', 1), ('1.14VI.LK.16.104', 2), ('1.14VI.LK.16.104', 3),
      ('1.14VI.LK.15.095', 1), ('1.14VI.LK.15.095', 2),
      ('1.14VI.LK.17.107', 1), ('1.14VI.LK.17.107', 2),
      ('1.14VI.LK.14.091', 1), ('1.14VI.LK.14.091', 2), ('1.14VI.LK.14.091', 3),
      ('1.14VI.LK.14.091', 4), ('1.14VI.LK.14.091', 5), ('1.14VI.LK.14.091', 6),
      ('1.14VI.LK.16.102', 1), ('1.14VI.LK.16.102', 2),
      ('1.14VI.LK.17.115', 1), ('1.14VI.LK.17.115', 2),
      ('1.14VI.LK.17.113', 1), ('1.14VI.LK.17.113', 2),
      ('1.14VI.LK.17.114', 1), ('1.14VI.LK.17.114', 2), ('1.14VI.LK.17.114', 3),
      ('1.14VI.LK.16.105', 1),
      ('1.14VI.LK.05.084', 1), ('1.14VI.LK.05.084', 2), ('1.14VI.LK.05.084', 3),
      ('1.14VI.LK.05.084', 4)
    ) AS x(lot_id, section_no)
    JOIN tapping_sections ts2
      ON ts2.lot_id = x.lot_id AND ts2.section_no = x.section_no
  );

-- Lô KH: phiên theo ngày — không gán tapping_session trên master
UPDATE tapping_sections ts
SET metadata = (COALESCE(ts.metadata, '{}'::jsonb) - 'tapping_session') || jsonb_build_object('work_mode', 'solo')
WHERE ts.team_id = 'team-lk'
  AND ts.lot_id IN (
    '1.14VI.LK.96.067', '1.14VI.LK.96.065', '1.14VI.LK.95.060', '1.14VI.LK.95.057'
  );

INSERT INTO section_worker_assignments (
  id, record_date, tapping_section_id, worker_id, assignment_role, notes, metadata
)
SELECT
  'swa-lk-d-' || to_char(DATE '2026-06-24', 'YYYYMMDD') || '-' || ts.id || '-' || e.employee_code,
  DATE '2026-06-24',
  ts.id,
  e.id,
  'tapper',
  '',
  jsonb_build_object(
    'tapping_session', 'D',
    'work_mode', 'solo',
    'lot_code', m.lot_id,
    'yield_share_pct', 100,
    'slots', jsonb_build_array(jsonb_build_object(
      'tapper_id', e.id::text,
      'tapper_pct', 100,
      'stripper_id', e.id::text,
      'stripper_pct', 100,
      'collector_id', e.id::text,
      'collector_pct', 100
    )),
    'roles', jsonb_build_array(
      jsonb_build_object('role', 'tapper', 'yield_share_pct', 100),
      jsonb_build_object('role', 'stripper', 'yield_share_pct', 100),
      jsonb_build_object('role', 'collector', 'yield_share_pct', 100)
    )
  )
FROM (VALUES
  -- 3-0/2015
  ('LK-CN-022', '1.14VI.LK.15.094', 1),   -- Nguyễn Văn Trường
  ('LK-CN-036', '1.14VI.LK.15.094', 2),   -- Lê Thị Tuyết
  -- 3-0/2016
  ('LK-CN-030', '1.14VI.LK.16.099', 1),   -- Trần Thanh Xuân
  ('LK-CN-031', '1.14VI.LK.16.099', 2),   -- Nguyễn Thị Tuyết
  ('LK-CN-001', '1.14VI.LK.16.099', 3),   -- Bùi Thái Hòa
  -- 3-4/2016
  ('LK-CN-017', '1.14VI.LK.16.096', 1),   -- Lư Trần Kiều Dung
  ('LK-CN-012', '1.14VI.LK.16.096', 2),   -- Trương Văn Thành
  ('LK-CN-034', '1.14VI.LK.16.096', 3),   -- Nguyễn Thị Mộng Cầm
  ('LK-CN-009', '1.14VI.LK.16.096', 4),   -- Nguyễn Ngọc Ánh
  ('LK-CN-004', '1.14VI.LK.16.096', 5),   -- Vương Thị Thanh Vân
  -- 4-0/2016
  ('LK-CN-014', '1.14VI.LK.16.100', 1),   -- Nguyễn Văn Tự
  ('LK-CN-015', '1.14VI.LK.16.100', 2),   -- Trần Văn Thiết
  -- 4-1/2017
  ('LK-CN-016', '1.14VI.LK.17.106', 1),   -- Trần Văn Linh Sang
  ('LK-CN-013', '1.14VI.LK.17.106', 2),   -- Phạm Đức Hiền
  ('LK-CN-038', '1.14VI.LK.17.106', 3),   -- Phạm Thị Thùy Trang
  -- 5-4/2016
  ('LK-CN-023', '1.14VI.LK.16.104', 1),   -- Lê Thị Hoa
  ('LK-CN-008', '1.14VI.LK.16.104', 2),   -- Lê Minh Giàu
  ('LK-CN-006', '1.14VI.LK.16.104', 3),   -- Nguyễn Quang Nghiêm
  -- 5-5/2015
  ('LK-CN-039', '1.14VI.LK.15.095', 1),   -- Nguyễn Hoàng Như yến
  ('LK-CN-021', '1.14VI.LK.15.095', 2),   -- Nguyễn Thị Thúy Hằng
  -- 5-6/2017
  ('LK-CN-006', '1.14VI.LK.17.107', 1),   -- Nguyễn Quang Nghiêm
  ('LK-CN-010', '1.14VI.LK.17.107', 2),   -- Trần Duy Năm
  -- BC/2014
  ('LK-CN-029', '1.14VI.LK.14.091', 1),   -- Nguyễn Thị Loan
  ('LK-CN-025', '1.14VI.LK.14.091', 2),   -- Trần Thị Lệ Phương
  ('LK-CN-035', '1.14VI.LK.14.091', 3),   -- Lê Thị Hưng
  ('LK-CN-024', '1.14VI.LK.14.091', 4),   -- Phạm Thị Luyến
  ('LK-CN-026', '1.14VI.LK.14.091', 5),   -- Huỳnh Văn Định
  ('LK-CN-019', '1.14VI.LK.14.091', 6),   -- Văn Quang Tuấn
  -- G1/2016
  ('LK-CN-028', '1.14VI.LK.16.102', 1),   -- Huỳnh Tuấn Dũng
  ('LK-CN-032', '1.14VI.LK.16.102', 2),   -- Huỳnh Thị Mỹ Loan
  -- G1-2/2017
  ('LK-CN-018', '1.14VI.LK.17.115', 1),   -- Trần Thị Mỹ Tiên
  ('LK-CN-007', '1.14VI.LK.17.115', 2),   -- Vũ Thị Như
  -- LK1/2017
  ('LK-CN-021', '1.14VI.LK.17.113', 1),   -- Nguyễn Thị Thúy Hằng
  ('LK-CN-005', '1.14VI.LK.17.113', 2),   -- Võ Thị Như Thùy
  -- LK2/2017
  ('LK-CN-033', '1.14VI.LK.17.114', 1),   -- Nguyễn Kim Lợi
  ('LK-CN-011', '1.14VI.LK.17.114', 2),   -- Lê Thị Nga
  ('LK-CN-002', '1.14VI.LK.17.114', 3),   -- Văn Công Tâm
  -- RRIV106/2016
  ('LK-CN-007', '1.14VI.LK.16.105', 1),   -- Vũ Thị Như
  -- ST/05
  ('LK-CN-037', '1.14VI.LK.05.084', 1),   -- Dương Tuấn
  ('LK-CN-020', '1.14VI.LK.05.084', 2),   -- Đoàn Thị Trang
  ('LK-CN-003', '1.14VI.LK.05.084', 3),   -- Nguyễn Thị Cơ
  ('LK-CN-027', '1.14VI.LK.05.084', 4),   -- Nguyễn Bá Luận
  -- Khoán hộ
  ('LK-KH-001', '1.14VI.LK.96.067', 1),   -- Nguyễn Minh Tùng
  ('LK-KH-002', '1.14VI.LK.96.067', 2),   -- Lê Trọng Mạnh
  ('LK-KH-003', '1.14VI.LK.96.067', 3),   -- Lê Văn Hùng
  ('LK-KH-004', '1.14VI.LK.96.067', 4),   -- Danh Rel
  ('LK-KH-005', '1.14VI.LK.96.067', 5),   -- Nguyễn Văn Lan
  ('LK-KH-006', '1.14VI.LK.96.065', 1),   -- Nguyễn Minh Tâm
  ('LK-KH-007', '1.14VI.LK.95.060', 1),   -- Nguyễn Văn Ao
  ('LK-KH-008', '1.14VI.LK.95.060', 2),   -- Nguyễn Thanh Tạo
  ('LK-KH-009', '1.14VI.LK.95.057', 1)    -- Dương Quốc Thanh
) AS m(employee_code, lot_id, section_no)
JOIN employee e ON e.employee_code = m.employee_code
JOIN tapping_sections ts
  ON ts.lot_id = m.lot_id AND ts.section_no = m.section_no AND ts.team_id = 'team-lk';

COMMIT;

-- Kiểm tra:
-- SELECT record_date, tapping_session, COUNT(*)
-- FROM v_tapping_section_roster
-- WHERE team_name = 'Tổ SX Lai Khê' AND record_date = '2026-06-24'
-- GROUP BY 1, 2;
-- → 2026-06-24 | D | 51
