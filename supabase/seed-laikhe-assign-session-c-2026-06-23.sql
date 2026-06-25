-- Phân công cạo mủ Tổ SX Lai Khê — Phiên C, ngày 23/06/2026
-- Nguồn: bảng phân công phiên C (cạo 1 mình — work_mode solo)
--
-- Chạy SAU seed-laikhe-workforce.sql
-- App: Tổ SX Lai Khê → Phiên C → ngày 23/06/2026
--
-- Bỏ qua: Hoàng Thị Kim Lan (LK-KH-010) — bảng gốc chưa có lô/PC (KH08959697)

BEGIN;

DELETE FROM section_worker_assignments swa
USING tapping_sections ts
WHERE swa.tapping_section_id = ts.id
  AND ts.team_id = 'team-lk'
  AND swa.record_date = DATE '2026-06-23';

DELETE FROM section_worker_assignments
WHERE record_date = DATE '2026-06-23'
  AND (
    id LIKE 'swa-lk-c-%'
    OR id LIKE 'swa-20260623-%'
  );

-- Phiên C trên master (lô CN)
UPDATE tapping_sections ts
SET metadata = COALESCE(ts.metadata, '{}'::jsonb) || jsonb_build_object(
  'tapping_session', 'C',
  'work_mode', 'solo'
)
WHERE ts.team_id = 'team-lk'
  AND ts.id IN (
    SELECT ts2.id
    FROM (VALUES
      ('1.14VI.LK.19.125', 2), ('1.14VI.LK.19.125', 3), ('1.14VI.LK.19.125', 4),
      ('1.14VI.LK.19.125', 5), ('1.14VI.LK.19.125', 6),
      ('1.14VI.LK.19.120', 1), ('1.14VI.LK.19.120', 2), ('1.14VI.LK.19.120', 3),
      ('1.14VI.LK.19.122', 1), ('1.14VI.LK.19.122', 2),
      ('1.14VI.LK.18.116', 1), ('1.14VI.LK.18.116', 2), ('1.14VI.LK.18.116', 3),
      ('1.14VI.LK.18.117', 1), ('1.14VI.LK.18.117', 2), ('1.14VI.LK.18.117', 3),
      ('1.14VI.LK.18.117', 4), ('1.14VI.LK.18.117', 5), ('1.14VI.LK.18.117', 6),
      ('1.14VI.LK.18.117', 7), ('1.14VI.LK.18.117', 8),
      ('1.14VI.LK.16.101', 1), ('1.14VI.LK.16.101', 2), ('1.14VI.LK.16.101', 3),
      ('1.14VI.LK.16.101', 4), ('1.14VI.LK.16.101', 5), ('1.14VI.LK.16.101', 6),
      ('1.14VI.LK.16.101', 7),
      ('1.14VI.LK.15.093', 7),
      ('1.14VI.LK.06.085', 6),
      ('1.14VI.LK.13.089', 2), ('1.14VI.LK.13.089', 3), ('1.14VI.LK.13.089', 4),
      ('1.14VI.LK.13.089', 5), ('1.14VI.LK.13.089', 6), ('1.14VI.LK.13.089', 7),
      ('1.14VI.LK.14.090', 1), ('1.14VI.LK.14.090', 2), ('1.14VI.LK.14.090', 3),
      ('1.14VI.LK.14.090', 4), ('1.14VI.LK.14.090', 5), ('1.14VI.LK.14.090', 6)
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
  'swa-lk-c-' || to_char(DATE '2026-06-23', 'YYYYMMDD') || '-' || ts.id || '-' || e.employee_code,
  DATE '2026-06-23',
  ts.id,
  e.id,
  'tapper',
  '',
  jsonb_build_object(
    'tapping_session', 'C',
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
  -- 6-11/2019
  ('LK-CN-038', '1.14VI.LK.19.125', 2),   -- Phạm Thị Thùy Trang
  ('LK-CN-011', '1.14VI.LK.19.125', 3),   -- Lê Thị Nga
  ('LK-CN-016', '1.14VI.LK.19.125', 4),   -- Trần Văn Linh Sang
  ('LK-CN-036', '1.14VI.LK.19.125', 5),   -- Lê Thị Tuyết
  ('LK-CN-005', '1.14VI.LK.19.125', 6),   -- Võ Thị Như Thùy
  -- 10-8/2019
  ('LK-CN-013', '1.14VI.LK.19.120', 1),   -- Phạm Đức Hiền
  ('LK-CN-035', '1.14VI.LK.19.120', 2),   -- Lê Thị Hưng
  ('LK-CN-026', '1.14VI.LK.19.120', 3),   -- Huỳnh Văn Định
  -- 10-9/2019
  ('LK-CN-030', '1.14VI.LK.19.122', 1),   -- Trần Thanh Xuân
  ('LK-CN-022', '1.14VI.LK.19.122', 2),   -- Nguyễn Văn Trường
  -- E/2018
  ('LK-CN-004', '1.14VI.LK.18.116', 1),   -- Vương Thị Thanh Vân
  ('LK-CN-029', '1.14VI.LK.18.116', 2),   -- Nguyễn Thị Loan
  ('LK-CN-024', '1.14VI.LK.18.116', 3),   -- Phạm Thị Luyến
  -- F/2018
  ('LK-CN-033', '1.14VI.LK.18.117', 1),   -- Nguyễn Kim Lợi
  ('LK-CN-028', '1.14VI.LK.18.117', 2),   -- Huỳnh Tuấn Dũng
  ('LK-CN-005', '1.14VI.LK.18.117', 3),   -- Võ Thị Như Thùy
  ('LK-CN-027', '1.14VI.LK.18.117', 4),   -- Nguyễn Bá Luận
  ('LK-CN-018', '1.14VI.LK.18.117', 5),   -- Trần Thị Mỹ Tiên
  ('LK-CN-034', '1.14VI.LK.18.117', 6),   -- Nguyễn Thị Mộng Cầm
  ('LK-CN-025', '1.14VI.LK.18.117', 7),   -- Trần Thị Lệ Phương
  ('LK-CN-012', '1.14VI.LK.18.117', 8),   -- Trương Văn Thành
  -- RRIV206/2016
  ('LK-CN-037', '1.14VI.LK.16.101', 1),   -- Dương Tuấn
  ('LK-CN-020', '1.14VI.LK.16.101', 2),   -- Đoàn Thị Trang
  ('LK-CN-023', '1.14VI.LK.16.101', 3),   -- Lê Thị Hoa
  ('LK-CN-008', '1.14VI.LK.16.101', 4),   -- Lê Minh Giàu
  ('LK-CN-030', '1.14VI.LK.16.101', 5),   -- Trần Thanh Xuân
  ('LK-CN-001', '1.14VI.LK.16.101', 6),   -- Bùi Thái Hòa
  ('LK-CN-039', '1.14VI.LK.16.101', 7),   -- Nguyễn Hoàng Như yến
  -- RRIV209/2015
  ('LK-CN-031', '1.14VI.LK.15.093', 7),   -- Nguyễn Thị Tuyết
  -- ST/06
  ('LK-CN-015', '1.14VI.LK.06.085', 6),   -- Trần Văn Thiết
  -- ST,CT/2013
  ('LK-CN-006', '1.14VI.LK.13.089', 2),   -- Nguyễn Quang Nghiêm
  ('LK-CN-011', '1.14VI.LK.13.089', 3),   -- Lê Thị Nga
  ('LK-CN-032', '1.14VI.LK.13.089', 4),   -- Huỳnh Thị Mỹ Loan
  ('LK-CN-017', '1.14VI.LK.13.089', 5),   -- Lư Trần Kiều Dung
  ('LK-CN-021', '1.14VI.LK.13.089', 6),   -- Nguyễn Thị Thúy Hằng
  ('LK-CN-007', '1.14VI.LK.13.089', 7),   -- Vũ Thị Như
  -- STLK/14
  ('LK-CN-014', '1.14VI.LK.14.090', 1),   -- Nguyễn Văn Tự
  ('LK-CN-009', '1.14VI.LK.14.090', 2),   -- Nguyễn Ngọc Ánh
  ('LK-CN-019', '1.14VI.LK.14.090', 3),   -- Văn Quang Tuấn
  ('LK-CN-010', '1.14VI.LK.14.090', 4),   -- Trần Duy Năm
  ('LK-CN-003', '1.14VI.LK.14.090', 5),   -- Nguyễn Thị Cơ
  ('LK-CN-002', '1.14VI.LK.14.090', 6),   -- Văn Công Tâm
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
-- WHERE team_name = 'Tổ SX Lai Khê' AND record_date = '2026-06-23'
-- GROUP BY 1, 2;
-- → 2026-06-23 | C | 51
