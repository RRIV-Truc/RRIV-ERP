-- ============================================================
-- Nhân sự sản xuất vườn: Đội/Tổ → Nhóm (CN/KH) → Lô → Phần cạo
-- Chạy SAU migrate-employee-master.sql và schema-harvest-production.sql
-- ============================================================
-- Phân cấp nghiệp vụ (không thay VIEW category_personnel):
--   category_departments  — Phòng / Trung tâm (vd dl-3 TT NC Giống cao su)
--   category_teams        — Đội / Tổ SX (Lai Khê, Suối Kiết, …)
--   work_groups           — Nhóm trong đội (CN, KH, Nhóm 1, Nhóm 2, …)
--   employee              — Master nhân sự (+ work_group_id, team_id)
--   rubber_lots           — Lô (ID LÔ = lot_code, khóa nghiệp vụ)
--   tapping_sections      — Phần cạo: UNIQUE (lot_id, section_no)
--   section_worker_assignments — Gán CN ↔ phần cạo theo ngày (N-N)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Nhóm làm việc trong đội (CN / KH / Nhóm 1 / Nhóm 2 …)
CREATE TABLE IF NOT EXISTS work_groups (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  team_id     TEXT REFERENCES category_teams(id) ON DELETE SET NULL,
  sort_order  INT DEFAULT 0,
  active      BOOLEAN DEFAULT true,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (team_id, code)
);
CREATE INDEX IF NOT EXISTS idx_work_groups_team ON work_groups(team_id);

-- Liên kết nhân sự ↔ nhóm SX (bổ sung employee, giữ category_personnel VIEW)
ALTER TABLE employee
  ADD COLUMN IF NOT EXISTS work_group_id TEXT REFERENCES work_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employee_work_group ON employee(work_group_id);
CREATE INDEX IF NOT EXISTS idx_employee_team ON employee(team_id);

-- Lô: mã ID LÔ là khóa nghiệp vụ (đồng bộ với bản đồ vuoncay khi có polygon)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rubber_lots_lot_code
  ON rubber_lots(lot_code) WHERE lot_code IS NOT NULL;

-- Phần cạo: khóa nghiệp vụ = (lot_id, section_no) — một lô nhiều phần cạo
ALTER TABLE tapping_sections
  ADD COLUMN IF NOT EXISTS section_no INT,
  ADD COLUMN IF NOT EXISTS lot_name TEXT;

COMMENT ON COLUMN tapping_sections.section_no IS 'PC SỐ — số thứ tự phần cạo trong lô';
COMMENT ON COLUMN tapping_sections.lot_name IS 'TÊN LÔ (denorm để tra cứu nhanh)';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tapping_sections_lot_pc
  ON tapping_sections(lot_id, section_no)
  WHERE lot_id IS NOT NULL AND section_no IS NOT NULL;

-- section_code chuẩn: {ID_LÔ}|PC|{số}
CREATE OR REPLACE FUNCTION build_tapping_section_code(p_lot_code TEXT, p_section_no INT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_lot_code || '|PC|' || p_section_no::text;
$$;

-- FK worker → employee (UUID). Bỏ qua nếu còn dữ liệu demo CN001…
DO $$
BEGIN
  ALTER TABLE section_worker_assignments
    DROP CONSTRAINT IF EXISTS section_worker_assignments_worker_id_fkey;

  IF NOT EXISTS (
    SELECT 1 FROM section_worker_assignments swa
    WHERE swa.worker_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee') THEN
    ALTER TABLE section_worker_assignments
      ALTER COLUMN worker_id TYPE UUID USING worker_id::uuid;
    ALTER TABLE section_worker_assignments
      ADD CONSTRAINT section_worker_assignments_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES employee(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Giữ worker_id TEXT — chạy lại sau khi xóa/ migrate demo CN001…: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE field_worker_weighings
    DROP CONSTRAINT IF EXISTS field_worker_weighings_worker_id_fkey;
  ALTER TABLE field_worker_weighings
    DROP CONSTRAINT IF EXISTS field_worker_weighings_created_by_fkey;

  IF NOT EXISTS (
    SELECT 1 FROM field_worker_weighings fww
    WHERE fww.worker_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee') THEN
    ALTER TABLE field_worker_weighings
      ALTER COLUMN worker_id TYPE UUID USING worker_id::uuid;
    ALTER TABLE field_worker_weighings
      ALTER COLUMN created_by TYPE UUID USING NULLIF(created_by, '')::uuid;
    ALTER TABLE field_worker_weighings
      ADD CONSTRAINT field_worker_weighings_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES employee(id) ON UPDATE CASCADE ON DELETE RESTRICT;
    ALTER TABLE field_worker_weighings
      ADD CONSTRAINT field_worker_weighings_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES employee(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'field_worker_weighings FK employee: %', SQLERRM;
END $$;
