-- =============================================================================
-- RRIV ERP — Đồng bộ department_list → category_departments (một nguồn phòng ban)
-- Chạy trên Supabase SQL Editor sau migrate-employee-master.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Backup
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS department_list_backup_20260611 AS
TABLE department_list;

CREATE TABLE IF NOT EXISTS category_departments_backup_20260611 AS
TABLE category_departments;

-- -----------------------------------------------------------------------------
-- 1. Mở rộng category_departments (nếu thiếu)
-- -----------------------------------------------------------------------------
ALTER TABLE category_departments ADD COLUMN IF NOT EXISTS dept_type TEXT;
ALTER TABLE category_departments ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- -----------------------------------------------------------------------------
-- 2. Đồng bộ từ bảng department_list (nếu còn tồn tại)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'department_list'
      AND table_type = 'BASE TABLE'
  ) THEN
    -- Cập nhật bản ghi đã có (trùng tên)
    UPDATE category_departments cd
    SET
      name = COALESCE(cd.name, dl.department_name),
      ten = COALESCE(cd.ten, dl.department_name),
      ten_phong_ban = COALESCE(cd.ten_phong_ban, dl.department_name),
      dept_type = COALESCE(cd.dept_type, dl.type),
      active = COALESCE(cd.active, true),
      metadata = COALESCE(cd.metadata, '{}'::jsonb) || jsonb_build_object(
        'dept_type', dl.type,
        'legacy_department_list_id', dl.id,
        'migrated_from', 'department_list'
      )
    FROM department_list dl
    WHERE lower(trim(coalesce(cd.name, cd.ten, cd.ten_phong_ban, '')))
        = lower(trim(dl.department_name));

    -- Thêm bản ghi chưa có
    INSERT INTO category_departments (id, name, ten, ten_phong_ban, dept_type, active, metadata)
    SELECT
      'dl-' || dl.id::text,
      dl.department_name,
      dl.department_name,
      dl.department_name,
      dl.type,
      true,
      jsonb_build_object(
        'dept_type', dl.type,
        'legacy_department_list_id', dl.id,
        'migrated_from', 'department_list'
      )
    FROM department_list dl
    WHERE NOT EXISTS (
      SELECT 1 FROM category_departments cd
      WHERE lower(trim(coalesce(cd.name, cd.ten, cd.ten_phong_ban, '')))
          = lower(trim(dl.department_name))
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Seed cố định (6 phòng ban Viện — dùng khi department_list đã xóa hoặc trống)
-- -----------------------------------------------------------------------------
INSERT INTO category_departments (id, name, ten, ten_phong_ban, dept_type, active, metadata)
VALUES
  ('dl-1', 'Ban Lãnh đạo Viện', 'Ban Lãnh đạo Viện', 'Ban Lãnh đạo Viện', 'Ban Lãnh Đạo', true,
   '{"dept_type":"Ban Lãnh Đạo","legacy_department_list_id":1,"migrated_from":"department_list"}'::jsonb),
  ('dl-2', 'Trung tâm nghiên cứu phát triển sản phẩm mới', 'Trung tâm nghiên cứu phát triển sản phẩm mới', 'Trung tâm nghiên cứu phát triển sản phẩm mới', 'Trung Tâm', true,
   '{"dept_type":"Trung Tâm","legacy_department_list_id":2,"migrated_from":"department_list"}'::jsonb),
  ('dl-3', 'Trung tâm nghiên cứu phát triển Giống cao su', 'Trung tâm nghiên cứu phát triển Giống cao su', 'Trung tâm nghiên cứu phát triển Giống cao su', 'Trung Tâm', true,
   '{"dept_type":"Trung Tâm","legacy_department_list_id":3,"migrated_from":"department_list"}'::jsonb),
  ('dl-4', 'Trung tâm nghiên cứu ứng dụng nông nghiệp công nghệ cao và chuyển giao kỹ thuật', 'Trung tâm nghiên cứu ứng dụng nông nghiệp công nghệ cao và chuyển giao kỹ thuật', 'Trung tâm nghiên cứu ứng dụng nông nghiệp công nghệ cao và chuyển giao kỹ thuật', 'Trung Tâm', true,
   '{"dept_type":"Trung Tâm","legacy_department_list_id":4,"migrated_from":"department_list"}'::jsonb),
  ('dl-5', 'Phòng khoa học công nghệ', 'Phòng khoa học công nghệ', 'Phòng khoa học công nghệ', 'Phòng Nghiệp Vụ', true,
   '{"dept_type":"Phòng Nghiệp Vụ","legacy_department_list_id":5,"migrated_from":"department_list"}'::jsonb),
  ('dl-6', 'Phòng quản trị - tài chính kế toán', 'Phòng quản trị - tài chính kế toán', 'Phòng quản trị - tài chính kế toán', 'Phòng Nghiệp Vụ', true,
   '{"dept_type":"Phòng Nghiệp Vụ","legacy_department_list_id":6,"migrated_from":"department_list"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  ten = EXCLUDED.ten,
  ten_phong_ban = EXCLUDED.ten_phong_ban,
  dept_type = EXCLUDED.dept_type,
  active = EXCLUDED.active,
  metadata = category_departments.metadata || EXCLUDED.metadata;

-- -----------------------------------------------------------------------------
-- 4. (Tuỳ chọn) VIEW department_list — KHÔNG tạo; dùng cleanup script để xóa hẳn list
-- ERP chỉ đọc category_departments. Bỏ qua bước VIEW nếu đã chạy migrate trước đó.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 5. Gán department_id text trên employee từ tên phòng ban
-- -----------------------------------------------------------------------------
UPDATE employee e
SET department_id = cd.id
FROM category_departments cd
WHERE e.department_id IS NULL
  AND e.department_name IS NOT NULL
  AND lower(trim(e.department_name)) = lower(trim(coalesce(cd.name, cd.ten, cd.ten_phong_ban)));

COMMIT;

-- Sau khi ổn định, xóa hẳn department_list (không giữ VIEW):
--   → chạy supabase/cleanup-department-list-legacy.sql

-- -----------------------------------------------------------------------------
-- Kiểm tra
-- -----------------------------------------------------------------------------
-- SELECT id, name, dept_type, active FROM category_departments ORDER BY name;
-- SELECT * FROM department_list ORDER BY id;
-- Sau 1–2 tuần ổn định: DROP TABLE IF EXISTS department_list_table_legacy;
-- DROP TABLE IF EXISTS department_list_backup_20260611;
-- DROP TABLE IF EXISTS category_departments_backup_20260611;
