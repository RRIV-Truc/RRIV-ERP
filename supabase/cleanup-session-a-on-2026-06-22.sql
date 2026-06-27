-- Dọn phiên A nhầm trên ngày 22/06/2026 (ngày này chỉ có phiên B)
-- Chạy trên Supabase SQL Editor

BEGIN;

DELETE FROM section_worker_assignments
WHERE record_date = DATE '2026-06-22'
  AND COALESCE(metadata->>'tapping_session', 'A') = 'A';

-- Khôi phục phần cạo bị ẩn nhầm do nút xóa cũ (chỉ set active=false, không xóa phân công)
UPDATE tapping_sections
SET active = true, updated_at = NOW()
WHERE id IN ('ts-lk-07-086-pc07', 'ts-lk-17-109-pc01')
  AND active = false;

COMMIT;
