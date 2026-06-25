-- Phân công cạo mủ Tổ SX Lai Khê — Phiên B, ngày 22/06/2026
-- ⚠️ Khuyến nghị chạy file gộp: reset-laikhe-assign-2026-06-21-22.sql (xóa sạch + seed lại 21/06 + 22/06)
-- Nguồn: bảng phân công phiên B (cạo 1 mình — work_mode solo)
--
-- Chạy SAU seed-laikhe-workforce.sql (và tuỳ chọn seed phiên A 21/06)
-- App: Tổ SX Lai Khê → Phiên B → ngày 22/06/2026

BEGIN;

DELETE FROM section_worker_assignments swa
USING tapping_sections ts
WHERE swa.tapping_section_id = ts.id
  AND ts.team_id = 'team-lk'
  AND swa.record_date = DATE '2026-06-22';

UPDATE tapping_sections ts
SET metadata = COALESCE(ts.metadata, '{}'::jsonb) || jsonb_build_object(
  'tapping_session', 'B',
  'work_mode', 'solo'
)
WHERE ts.team_id = 'team-lk'
  AND ts.id IN (
    SELECT ts2.id
    FROM (VALUES
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
      ('1.14VI.LK.13.089', 1),
      ('1.14VI.LK.18.119', 1)
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
  'swa-lk-b-' || to_char(DATE '2026-06-22', 'YYYYMMDD') || '-' || ts.id || '-' || e.employee_code,
  DATE '2026-06-22',
  ts.id,
  e.id,
  'tapper',
  '',
  jsonb_build_object(
    'tapping_session', 'B',
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
  ('LK-CN-001', '1.14VI.LK.16.103', 1),    -- Bùi Thái Hòa
  ('LK-CN-002', '1.14VI.LK.16.103', 2),    -- Văn Công Tâm
  ('LK-CN-003', '1.14VI.LK.16.103', 3),    -- Nguyễn Thị Cơ
  ('LK-CN-004', '1.14VI.LK.16.103', 4),    -- Vương Thị Thanh Vân
  ('LK-CN-005', '1.14VI.LK.16.103', 5),    -- Võ Thị Như Thùy
  ('LK-CN-006', '1.14VI.LK.16.103', 6),    -- Nguyễn Quang Nghiêm
  ('LK-CN-006', '1.14VI.LK.16.103.2', 1),  -- Nguyễn Quang Nghiêm (lô .2)
  ('LK-CN-007', '1.14VI.LK.19.121', 1),    -- Vũ Thị Như
  ('LK-CN-008', '1.14VI.LK.19.121', 2),    -- Lê Minh Giàu
  ('LK-CN-009', '1.14VI.LK.19.121', 3),    -- Nguyễn Ngọc Ánh
  ('LK-CN-008', '1.14VI.LK.19.121', 4),    -- Lê Minh Giàu
  ('LK-CN-010', '1.14VI.LK.19.124', 1),    -- Trần Duy Năm
  ('LK-CN-011', '1.14VI.LK.19.124', 2),    -- Lê Thị Nga
  ('LK-CN-012', '1.14VI.LK.17.110', 1),    -- Trương Văn Thành
  ('LK-CN-013', '1.14VI.LK.17.110', 2),    -- Phạm Đức Hiền
  ('LK-CN-014', '1.14VI.LK.17.110', 3),    -- Nguyễn Văn Tự (bảng: Tư)
  ('LK-CN-015', '1.14VI.LK.17.112', 1),    -- Trần Văn Thiết
  ('LK-CN-016', '1.14VI.LK.17.112', 2),    -- Trần Văn Linh Sang
  ('LK-CN-017', '1.14VI.LK.17.112', 3),    -- Lư Trần Kiều Dung
  ('LK-CN-018', '1.14VI.LK.17.112', 4),    -- Trần Thị Mỹ Tiên
  ('LK-CN-019', '1.14VI.LK.17.112', 5),    -- Văn Quang Tuấn
  ('LK-CN-020', '1.14VI.LK.17.112', 6),    -- Đoàn Thị Trang
  ('LK-CN-021', '1.14VI.LK.17.112', 7),    -- Nguyễn Thị Thúy Hằng
  ('LK-CN-022', '1.14VI.LK.17.112', 8),    -- Nguyễn Văn Trường
  ('LK-CN-023', '1.14VI.LK.17.112', 9),    -- Lê Thị Hoa
  ('LK-CN-024', '1.14VI.LK.17.112', 10),   -- Phạm Thị Luyến
  ('LK-CN-025', '1.14VI.LK.19.125', 1),    -- Trần Thị Lệ Phương
  ('LK-CN-024', '1.14VI.LK.15.092', 1),    -- Phạm Thị Luyến
  ('LK-CN-026', '1.14VI.LK.15.092', 2),    -- Huỳnh Văn Định
  ('LK-CN-025', '1.14VI.LK.15.092', 3),    -- Trần Thị Lệ Phương
  ('LK-CN-027', '1.14VI.LK.15.092', 4),    -- Nguyễn Bá Luận
  ('LK-CN-028', '1.14VI.LK.15.092', 5),    -- Huỳnh Tuấn Dũng
  ('LK-CN-016', '1.14VI.LK.15.092', 6),    -- Trần Văn Linh Sang
  ('LK-CN-029', '1.14VI.LK.15.093', 1),    -- Nguyễn Thị Loan
  ('LK-CN-030', '1.14VI.LK.15.093', 2),    -- Trần Thanh Xuân
  ('LK-CN-031', '1.14VI.LK.15.093', 3),    -- Nguyễn Thị Tuyết
  ('LK-CN-032', '1.14VI.LK.15.093', 4),    -- Huỳnh Thị Mỹ Loan
  ('LK-CN-033', '1.14VI.LK.15.093', 5),    -- Nguyễn Kim Lợi
  ('LK-CN-034', '1.14VI.LK.15.093', 6),    -- Nguyễn Thị Mộng Cầm
  ('LK-CN-031', '1.14VI.LK.03.081', 1),    -- Nguyễn Thị Tuyết
  ('LK-CN-035', '1.14VI.LK.03.081', 2),    -- Lê Thị Hưng
  ('LK-CN-030', '1.14VI.LK.03.081', 3),    -- Trần Thanh Xuân
  ('LK-CN-036', '1.14VI.LK.03.081', 4),    -- Lê Thị Tuyết
  ('LK-CN-037', '1.14VI.LK.03.081', 5),    -- Dương Tuấn
  ('LK-CN-038', '1.14VI.LK.03.081', 6),    -- Phạm Thị Thùy Trang
  ('LK-CN-039', '1.14VI.LK.13.089', 1),    -- Nguyễn Hoàng Như yến
  ('LK-CN-001', '1.14VI.LK.18.119', 1),    -- Bùi Thái Hòa (SoLip)
  ('LK-KH-001', '1.14VI.LK.96.067', 1),    -- Nguyễn Minh Tùng
  ('LK-KH-002', '1.14VI.LK.96.067', 2),    -- Lê Trọng Mạnh
  ('LK-KH-003', '1.14VI.LK.96.067', 3),    -- Lê Văn Hùng
  ('LK-KH-004', '1.14VI.LK.96.067', 4),    -- Danh Rel
  ('LK-KH-005', '1.14VI.LK.96.067', 5),    -- Nguyễn Văn Lan
  ('LK-KH-006', '1.14VI.LK.96.065', 1),    -- Nguyễn Minh Tâm
  ('LK-KH-007', '1.14VI.LK.95.060', 1),    -- Nguyễn Văn Ao
  ('LK-KH-008', '1.14VI.LK.95.060', 2),    -- Nguyễn Thanh Tạo
  ('LK-KH-009', '1.14VI.LK.95.057', 1)     -- Dương Quốc Thanh
) AS m(employee_code, lot_id, section_no)
JOIN employee e ON e.employee_code = m.employee_code
JOIN tapping_sections ts
  ON ts.lot_id = m.lot_id AND ts.section_no = m.section_no AND ts.team_id = 'team-lk'
ON CONFLICT (record_date, tapping_section_id, worker_id) DO UPDATE SET
  assignment_role = EXCLUDED.assignment_role,
  notes = EXCLUDED.notes,
  metadata = EXCLUDED.metadata;

-- Đảm bảo toàn bộ ngày 22/06 là phiên B (sửa nếu từng nạp nhầm từ 21/06 phiên A)
UPDATE section_worker_assignments swa
SET metadata = COALESCE(swa.metadata, '{}'::jsonb) || jsonb_build_object('tapping_session', 'B')
FROM tapping_sections ts
WHERE swa.tapping_section_id = ts.id
  AND ts.team_id = 'team-lk'
  AND swa.record_date = DATE '2026-06-22'
  AND COALESCE(swa.metadata->>'tapping_session', 'A') IS DISTINCT FROM 'B';

COMMIT;

-- Kiểm tra:
-- SELECT lot_code, section_no, worker_name, assignment_role
-- FROM v_tapping_section_roster
-- WHERE team_name = 'Tổ SX Lai Khê' AND record_date = '2026-06-22'
-- ORDER BY lot_code, section_no;
