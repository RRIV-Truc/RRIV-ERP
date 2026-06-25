-- Phân công cạo mủ Tổ SX Lai Khê — Phiên A, từ ngày 21/06/2026
-- ⚠️ Khuyến nghị chạy file gộp: reset-laikhe-assign-2026-06-21-22.sql (xóa sạch + seed lại 21/06 + 22/06)
-- Nguồn: bảng phân công công nhân ↔ lô/PC (cạo 1 mình — work_mode solo)
--
-- Chạy SAU:
--   schema-field-workforce.sql
--   views-field-workforce.sql
--   seed-laikhe-workforce.sql
--
-- Trên app: chọn Tổ SX Lai Khê → Phiên A → ngày 21/06/2026 (hoặc «Nạp phân công» từ ngày này)

BEGIN;

-- Gỡ phân công cũ của Tổ Lai Khê đúng ngày 21/06/2026 (phiên A)
DELETE FROM section_worker_assignments swa
USING tapping_sections ts
WHERE swa.tapping_section_id = ts.id
  AND ts.team_id = 'team-lk'
  AND swa.record_date = DATE '2026-06-21';

-- Phiên A cho các phần cạo trong danh sách
UPDATE tapping_sections ts
SET metadata = COALESCE(ts.metadata, '{}'::jsonb) || jsonb_build_object(
  'work_mode', 'solo'
) || jsonb_build_object('tapping_session', 'A')
WHERE ts.team_id = 'team-lk'
  AND ts.id IN (
    SELECT ts2.id
    FROM (VALUES
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
    JOIN tapping_sections ts2
      ON ts2.lot_id = x.lot_id AND ts2.section_no = x.section_no
  );

-- Lô KH: phiên theo ngày (A 21/6, B 22/6) — không gán tapping_session trên master
UPDATE tapping_sections ts
SET metadata = (COALESCE(ts.metadata, '{}'::jsonb) - 'tapping_session') || jsonb_build_object('work_mode', 'solo')
WHERE ts.team_id = 'team-lk'
  AND ts.lot_id IN (
    '1.14VI.LK.96.067', '1.14VI.LK.96.065', '1.14VI.LK.95.060', '1.14VI.LK.95.057'
  );

-- employee_code | lot_id | PC
-- Bỏ qua: PC 2 lô 04.082 «Phần cạo trống»; Hoàng Thị Kim Lan (chưa có lô/PC)
-- Lê Thị Nga: bảng gốc ghi PC 6 trùng Lư Trần Kiều Dung → gán PC 5 (PC 5 lô 07.086 đang trống)
INSERT INTO section_worker_assignments (
  id, record_date, tapping_section_id, worker_id, assignment_role, notes, metadata
)
SELECT
  'swa-lk-a-' || to_char(DATE '2026-06-21', 'YYYYMMDD') || '-' || ts.id || '-' || e.employee_code,
  DATE '2026-06-21',
  ts.id,
  e.id,
  'tapper',
  '',
  jsonb_build_object(
    'tapping_session', 'A',
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
  ('LK-CN-039', '1.14VI.LK.17.108', 1),   -- Nguyễn Hoàng Như yến
  ('LK-CN-003', '1.14VI.LK.17.108', 2),   -- Nguyễn Thị Cơ
  ('LK-CN-023', '1.14VI.LK.17.109', 1),   -- Lê Thị Hoa
  ('LK-CN-004', '1.14VI.LK.17.109', 2),   -- Vương Thị Thanh Vân
  ('LK-CN-024', '1.14VI.LK.17.111', 1),   -- Phạm Thị Luyến
  ('LK-CN-038', '1.14VI.LK.17.111', 2),   -- Phạm Thị Thùy Trang
  ('LK-CN-013', '1.14VI.LK.17.111', 3),   -- Phạm Đức Hiển (DB: Hiền)
  ('LK-CN-026', '1.14VI.LK.17.111', 4),   -- Huỳnh Văn Định
  ('LK-CN-031', '1.14VI.LK.17.111', 5),   -- Nguyễn Thị Tuyết
  ('LK-CN-012', '1.14VI.LK.17.111', 6),   -- Trương Văn Thành
  ('LK-CN-020', '1.14VI.LK.17.111', 7),   -- Đoàn Thị Trang
  ('LK-CN-033', '1.14VI.LK.18.118', 1),   -- Nguyễn Kim Lợi
  ('LK-CN-005', '1.14VI.LK.18.118', 2),   -- Võ Thị Như Thủy
  ('LK-CN-016', '1.14VI.LK.18.118', 3),   -- Trần Văn Linh Sang
  ('LK-CN-021', '1.14VI.LK.18.118', 4),   -- Nguyễn Thị Thúy Hằng
  ('LK-CN-015', '1.14VI.LK.18.118', 5),   -- Trần Văn Thiết
  ('LK-CN-027', '1.14VI.LK.18.118', 6),   -- Nguyễn Bá Luận
  ('LK-CN-001', '1.14VI.LK.16.098', 1),   -- Bùi Thái Hòa
  ('LK-CN-025', '1.14VI.LK.16.098', 2),   -- Trần Thị Lệ Phương
  ('LK-CN-036', '1.14VI.LK.16.098', 3),   -- Lê Thị Tuyết
  ('LK-CN-008', '1.14VI.LK.16.097', 8),   -- Lê Minh Giàu
  ('LK-CN-022', '1.14VI.LK.04.082', 1),   -- Nguyễn Văn Trường
  ('LK-CN-002', '1.14VI.LK.04.082', 3),   -- Văn Công Tâm
  ('LK-CN-034', '1.14VI.LK.04.082', 4),   -- Nguyễn Thị Mộng Cầm
  ('LK-CN-009', '1.14VI.LK.04.082', 5),   -- Nguyễn Ngọc Ánh
  ('LK-CN-037', '1.14VI.LK.04.082', 6),   -- Dương Tuấn
  ('LK-CN-029', '1.14VI.LK.04.082', 7),   -- Nguyễn Thị Loan
  ('LK-CN-010', '1.14VI.LK.06.085', 1),   -- Trần Duy Năm
  ('LK-CN-030', '1.14VI.LK.06.085', 2),   -- Trần Thanh Xuân
  ('LK-CN-032', '1.14VI.LK.06.085', 3),   -- Huỳnh Thị Mỹ Loan
  ('LK-CN-028', '1.14VI.LK.06.085', 4),   -- Huỳnh Tuấn Dũng
  ('LK-CN-019', '1.14VI.LK.06.085', 5),   -- Văn Quang Tuấn
  ('LK-CN-014', '1.14VI.LK.07.086', 1),   -- Nguyễn Văn Tự
  ('LK-CN-035', '1.14VI.LK.07.086', 2),   -- Lê Thị Hưng
  ('LK-CN-006', '1.14VI.LK.07.086', 3),   -- Nguyễn Quang Nghiêm
  ('LK-CN-018', '1.14VI.LK.07.086', 4),   -- Trần Thị Mỹ Tiên
  ('LK-CN-011', '1.14VI.LK.07.086', 5),   -- Lê Thị Nga (điều chỉnh từ PC 6)
  ('LK-CN-017', '1.14VI.LK.07.086', 6),   -- Lư Trần Kiều Dung
  ('LK-CN-021', '1.14VI.LK.07.086', 7),   -- Nguyễn Thị Thúy Hằng (lô ST/07)
  ('LK-CN-007', '1.14VI.LK.07.086', 8),   -- Vũ Thị Như
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
  ON ts.lot_id = m.lot_id AND ts.section_no = m.section_no AND ts.team_id = 'team-lk'
ON CONFLICT (record_date, tapping_section_id, worker_id) DO UPDATE SET
  assignment_role = EXCLUDED.assignment_role,
  notes = EXCLUDED.notes,
  metadata = EXCLUDED.metadata;

COMMIT;

-- Kiểm tra:
-- SELECT lot_code, section_no, worker_name, work_mode, tapping_session
-- FROM v_tapping_section_roster
-- WHERE team_name = 'Tổ SX Lai Khê' AND record_date = '2026-06-21'
-- ORDER BY lot_code, section_no;
