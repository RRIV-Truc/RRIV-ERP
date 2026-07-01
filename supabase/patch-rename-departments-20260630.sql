-- =============================================================================
-- Đổi tên / gộp phòng ban Viện (30/06/2026)
--   dl-5: Phòng khoa học công nghệ (bỏ "Kế hoạch và")
--   dl-6: Phòng quản trị - tài chính kế toán (gộp QTNS-HC + TCKT)
-- Chạy trên Supabase SQL Editor
-- =============================================================================

BEGIN;

-- Tên chuẩn mới
-- dl-5: Phòng khoa học công nghệ
-- dl-6: Phòng quản trị - tài chính kế toán

UPDATE category_departments
SET
  name = 'Phòng khoa học công nghệ',
  ten = 'Phòng khoa học công nghệ',
  ten_phong_ban = 'Phòng khoa học công nghệ',
  active = true,
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'renamed_at', '2026-06-30',
    'previous_name', 'Phòng Kế hoạch và Khoa học - Công nghệ'
  )
WHERE id = 'dl-5';

UPDATE category_departments
SET
  name = 'Phòng quản trị - tài chính kế toán',
  ten = 'Phòng quản trị - tài chính kế toán',
  ten_phong_ban = 'Phòng quản trị - tài chính kế toán',
  active = true,
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'renamed_at', '2026-06-30',
    'merged_from', jsonb_build_array(
      'Phòng Quản trị Nhân sự - Hành chính',
      'Phòng Tài chính Kế toán'
    )
  )
WHERE id = 'dl-6';

-- Ẩn / retire phòng ban cũ không còn dùng (nếu còn bản ghi riêng)
UPDATE category_departments
SET
  active = false,
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'retired', true,
    'retired_at', '2026-06-30',
    'merged_into', 'dl-6'
  )
WHERE id IN ('vien-02', 'vien-04')
   AND id NOT IN ('dl-5', 'dl-6');

UPDATE category_departments
SET
  active = false,
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'retired', true,
    'retired_at', '2026-06-30',
    'merged_into', 'dl-5'
  )
WHERE id = 'vien-03'
   AND id NOT IN ('dl-5', 'dl-6');

UPDATE category_departments
SET
  active = false,
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'retired', true,
    'retired_at', '2026-06-30'
  )
WHERE id NOT IN ('dl-5', 'dl-6')
  AND (
    lower(trim(coalesce(name, ten, ten_phong_ban, ''))) LIKE '%kế hoạch%khoa học%'
    OR lower(trim(coalesce(name, ten, ten_phong_ban, ''))) LIKE '%quản trị%nhân sự%'
    OR (
      lower(trim(coalesce(name, ten, ten_phong_ban, ''))) LIKE '%tài chính%kế toán%'
      AND lower(trim(coalesce(name, ten, ten_phong_ban, ''))) NOT LIKE '%quản trị%'
    )
  );

-- NV thuộc dl-5: cập nhật tên phòng
UPDATE employee
SET department_name = 'Phòng khoa học công nghệ',
    department_id = 'dl-5'
WHERE department_id = 'dl-5'
   OR lower(trim(coalesce(department_name, ''))) IN (
     lower('Phòng Kế hoạch và Khoa học - Công nghệ'),
     lower('Phòng khoa học - công nghệ'),
     lower('Phòng khoa học công nghệ')
   );

-- NV thuộc dl-6: gộp từ QTNS-HC và TCKT
UPDATE employee
SET department_name = 'Phòng quản trị - tài chính kế toán',
    department_id = 'dl-6'
WHERE department_id IN ('dl-6', 'vien-02', 'vien-04')
   OR lower(trim(coalesce(department_name, ''))) IN (
     lower('Phòng Quản trị Nhân sự - Hành chính'),
     lower('Phòng Tài chính Kế toán'),
     lower('Phòng tài chính - kế toán'),
     lower('Phòng Quản trị tài chính kế toán'),
     lower('Phòng quản trị - tài chính kế toán')
   );

-- Kiêm nhiệm (employee_assignment) — chỉ có department_name, không có department_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employee_assignment'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_assignment'
      AND column_name = 'department_name'
  ) THEN
    UPDATE employee_assignment
    SET department_name = 'Phòng khoa học công nghệ'
    WHERE lower(trim(coalesce(department_name, ''))) LIKE '%kế hoạch%khoa học%'
       OR lower(trim(coalesce(department_name, ''))) LIKE '%khoa học%công ngh%';

    UPDATE employee_assignment
    SET department_name = 'Phòng quản trị - tài chính kế toán'
    WHERE lower(trim(coalesce(department_name, ''))) LIKE '%quản trị%nhân sự%'
       OR lower(trim(coalesce(department_name, ''))) LIKE '%tài chính%kế toán%';
  END IF;
END $$;

COMMIT;

-- Kiểm tra:
-- SELECT id, name, active FROM category_departments WHERE id IN ('dl-5','dl-6') OR active = true ORDER BY id;
-- SELECT department_id, department_name, count(*) FROM employee GROUP BY 1,2 ORDER BY 3 DESC;
