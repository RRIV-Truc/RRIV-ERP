-- Xóa hoàn toàn department_list (bảng + VIEW) — chỉ dùng category_departments
-- Chạy trên Supabase SQL Editor.

BEGIN;

DROP VIEW IF EXISTS public.department_list CASCADE;
DROP TABLE IF EXISTS public.department_list_table_legacy CASCADE;
DROP TABLE IF EXISTS public.department_list_backup_20260611;

-- Bảng gốc nếu migrate chưa đổi tên
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'department_list'
      AND table_type = 'BASE TABLE'
  ) THEN
    DROP TABLE public.department_list CASCADE;
  END IF;
END $$;

COMMIT;

-- Kiểm tra: không còn department_list
-- SELECT table_name, table_type FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name ILIKE '%department%';
-- → chỉ còn category_departments (+ backup nếu chưa xóa)
