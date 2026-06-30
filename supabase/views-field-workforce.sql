-- VIEW quản lý sản lượng CN — bổ sung, KHÔNG thay category_personnel
-- Chạy sau schema-field-workforce.sql

-- Hồ sơ nhân sự SX: phòng ban + đội + nhóm
CREATE OR REPLACE VIEW v_production_workforce AS
SELECT
  e.id::text                    AS employee_id,
  e.employee_code,
  e.full_name,
  e.username,
  e.department_id,
  COALESCE(cd.name, e.department_name) AS department_name,
  e.team_id                     AS production_team_id,
  COALESCE(ct.name, e.team_name) AS production_team_name,
  e.work_group_id,
  wg.code                       AS work_group_code,
  wg.name                       AS work_group_name,
  e.position_name,
  e.employment_status,
  e.phone_number,
  e.disabled,
  e.metadata,
  e.created_at,
  e.updated_at
FROM employee e
LEFT JOIN category_departments cd ON cd.id = e.department_id
LEFT JOIN category_teams ct ON ct.id = e.team_id
LEFT JOIN work_groups wg ON wg.id = e.work_group_id;

COMMENT ON VIEW v_production_workforce IS
  'Nhân sự SX: Trung tâm/Phòng + Đội/Tổ + Nhóm (CN/KH). Dùng cho quản lý sản lượng, không thay category_personnel.';

-- Danh sách phần cạo (master): lô + PC SỐ
CREATE OR REPLACE VIEW v_tapping_sections AS
SELECT
  ts.id                         AS tapping_section_id,
  ts.section_code,
  ts.section_no,
  ts.lot_id,
  rl.lot_code,
  COALESCE(ts.lot_name, rl.metadata->>'ten_lo', rl.lot_code) AS lot_name,
  ts.team_id,
  ct.name                       AS team_name,
  ts.squad,
  ts.active,
  ts.metadata,
  ts.created_at,
  ts.updated_at
FROM tapping_sections ts
LEFT JOIN rubber_lots rl ON rl.id = ts.lot_id
LEFT JOIN category_teams ct ON ct.id = ts.team_id;

COMMENT ON VIEW v_tapping_sections IS
  'Master phần cạo. Khóa nghiệp vụ: (lot_code, section_no) = (ID LÔ, PC SỐ).';

-- Phân công theo ngày: chỉ dòng đã gán CN (không sinh dòng NULL cho PC chưa phân công)
-- PostgreSQL không cho CREATE OR REPLACE khi đổi thứ tự/tên cột — phải DROP trước.
DROP VIEW IF EXISTS v_tapping_section_roster CASCADE;

CREATE VIEW v_tapping_section_roster AS
SELECT
  vts.tapping_section_id,
  vts.section_code,
  vts.section_no,
  vts.lot_id,
  vts.lot_code,
  vts.lot_name,
  vts.team_id,
  vts.team_name,
  swa.record_date,
  COALESCE(swa.metadata->>'tapping_session', 'A') AS tapping_session,
  COALESCE(swa.metadata->>'work_mode', 'solo')      AS work_mode,
  swa.worker_id::text           AS employee_id,
  e.employee_code,
  e.full_name                   AS worker_name,
  wg.code                       AS work_group_code,
  wg.name                       AS work_group_name,
  swa.assignment_role,
  swa.notes,
  swa.id                        AS assignment_id
FROM section_worker_assignments swa
JOIN v_tapping_sections vts ON vts.tapping_section_id = swa.tapping_section_id
LEFT JOIN employee e ON e.id::text = swa.worker_id::text
LEFT JOIN work_groups wg ON wg.id = e.work_group_id;

COMMENT ON VIEW v_tapping_section_roster IS
  'Phân công CN theo ngày + lô/PC. Chỉ hiện dòng đã gán (không có NULL). Lọc record_date khi tra cứu.';

-- Danh mục PC chưa phân công (tuỳ chọn tra cứu)
CREATE OR REPLACE VIEW v_tapping_sections_unassigned AS
SELECT vts.*
FROM v_tapping_sections vts
WHERE vts.active IS DISTINCT FROM false
  AND NOT EXISTS (
    SELECT 1 FROM section_worker_assignments swa
    WHERE swa.tapping_section_id = vts.tapping_section_id
  );

COMMENT ON VIEW v_tapping_sections_unassigned IS
  'Phần cạo master chưa có bất kỳ phân công nào (mọi ngày).';
