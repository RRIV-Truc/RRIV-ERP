-- Xóa 20 công nhân demo "Công nhân 1" … "Công nhân 20" (CN001–CN020 / CP-CN001–CP-CN020)
-- và dữ liệu sản lượng demo gắn với họ (phân công, cân vườn, phần cạo PC-01..PC-42).
-- Chạy trong Supabase SQL Editor.
-- KHÔNG xóa nhân sự Lai Khê (LK-CN-*, LK-KH-*, team-lk, ts-lk-*).

BEGIN;

-- Danh sách mã legacy + username demo
CREATE TEMP TABLE _demo_legacy_ids (legacy_id TEXT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _demo_legacy_ids (legacy_id) VALUES
  ('CN001'),('CN002'),('CN003'),('CN004'),('CN005'),
  ('CN006'),('CN007'),('CN008'),('CN009'),('CN010'),
  ('CN011'),('CN012'),('CN013'),('CN014'),('CN015'),
  ('CN016'),('CN017'),('CN018'),('CN019'),('CN020');

CREATE TEMP TABLE _demo_employees AS
SELECT e.id, e.id::text AS id_text, e.employee_code, e.full_name
FROM employee e
WHERE e.employee_code IN (
    'CP-CN001','CP-CN002','CP-CN003','CP-CN004','CP-CN005',
    'CP-CN006','CP-CN007','CP-CN008','CP-CN009','CP-CN010',
    'CP-CN011','CP-CN012','CP-CN013','CP-CN014','CP-CN015',
    'CP-CN016','CP-CN017','CP-CN018','CP-CN019','CP-CN020'
  )
  OR e.metadata->>'legacy_personnel_id' IN (SELECT legacy_id FROM _demo_legacy_ids)
  OR lower(coalesce(e.username, '')) IN (
    'cn001','cn002','cn003','cn004','cn005','cn006','cn007','cn008','cn009','cn010',
    'cn011','cn012','cn013','cn014','cn015','cn016','cn017','cn018','cn019','cn020'
  )
  OR e.full_name ~ '^Công nhân ([1-9]|1[0-9]|20)$';

-- Phần cạo demo (PC-01 … PC-42), không đụng ts-lk-*
CREATE TEMP TABLE _demo_sections AS
SELECT ts.id
FROM tapping_sections ts
WHERE ts.id LIKE 'ts-pc-%'
   OR ts.section_code ~ '^PC-[0-9]+$';

-- 1. Cân vườn
DELETE FROM field_worker_weighings f
WHERE f.tapping_section_id IN (SELECT id FROM _demo_sections)
   OR f.worker_id::text IN (SELECT id_text FROM _demo_employees)
   OR f.worker_id::text IN (SELECT legacy_id FROM _demo_legacy_ids)
   OR f.created_by::text IN (SELECT id_text FROM _demo_employees)
   OR f.created_by::text IN (SELECT legacy_id FROM _demo_legacy_ids);

-- 2. Phân công
DELETE FROM section_worker_assignments swa
WHERE swa.tapping_section_id IN (SELECT id FROM _demo_sections)
   OR swa.worker_id::text IN (SELECT id_text FROM _demo_employees)
   OR swa.worker_id::text IN (SELECT legacy_id FROM _demo_legacy_ids);

-- 3. Phân bổ NM (nếu đã có)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'worker_factory_allocations') THEN
    DELETE FROM worker_factory_allocations wfa
    WHERE wfa.worker_id::text IN (SELECT id_text FROM _demo_employees)
       OR wfa.worker_id::text IN (SELECT legacy_id FROM _demo_legacy_ids);
  END IF;
END $$;

-- 4. Phần cạo demo
DELETE FROM tapping_sections ts
WHERE ts.id IN (SELECT id FROM _demo_sections);

-- 5. Gỡ liên kết tài khoản / quản lý đội
UPDATE user_accounts ua
SET employee_id = NULL
WHERE ua.employee_id IN (SELECT id FROM _demo_employees);

UPDATE category_teams ct
SET manager_id = NULL
WHERE ct.manager_id IN (SELECT id_text FROM _demo_employees)
   OR ct.manager_id IN (SELECT legacy_id FROM _demo_legacy_ids);

-- 6. Xóa nhân sự demo
DELETE FROM employee e
WHERE e.id IN (SELECT id FROM _demo_employees);

-- 7. Dọn bảng legacy (nếu còn sau migrate)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'category_personnel_table_legacy'
  ) THEN
    DELETE FROM category_personnel_table_legacy cp
    WHERE cp.id IN (SELECT legacy_id FROM _demo_legacy_ids);
  END IF;
END $$;

COMMIT;

-- Sau khi xóa xong, có thể chạy lại block FK trong schema-field-workforce.sql
-- để worker_id trỏ employee(id) UUID.

-- Kiểm tra
SELECT 'remaining_demo_workers' AS check_name, count(*) AS cnt
FROM employee e
WHERE e.full_name ~ '^Công nhân ([1-9]|1[0-9]|20)$'
   OR e.employee_code LIKE 'CP-CN0%';

SELECT 'remaining_demo_sections' AS check_name, count(*) AS cnt
FROM tapping_sections ts
WHERE ts.id LIKE 'ts-pc-%' OR ts.section_code ~ '^PC-[0-9]+$';
