-- Dọn phiên B nhầm trên ngày 21/06/2026 (ngày này chỉ có phiên A)
-- Chạy trên Supabase SQL Editor sau khi đã seed phân công

BEGIN;

-- Xóa phân công ghi phiên B vào ngày 21/06 (nếu có)
DELETE FROM section_worker_assignments
WHERE record_date = DATE '2026-06-21'
  AND COALESCE(metadata->>'tapping_session', 'A') = 'B';

-- Lô KH dùng cả phiên A (21/6) và B (22/6): bỏ phiên cố định trên master phần cạo
UPDATE tapping_sections
SET metadata = COALESCE(metadata, '{}'::jsonb) - 'tapping_session'
WHERE team_id = 'team-lk'
  AND lot_id IN (
    '1.14VI.LK.96.067',
    '1.14VI.LK.96.065',
    '1.14VI.LK.95.060',
    '1.14VI.LK.95.057'
  );

COMMIT;
