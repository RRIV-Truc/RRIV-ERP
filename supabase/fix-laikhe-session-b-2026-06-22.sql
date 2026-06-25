-- Sửa phân công ngày 22/06/2026: tất cả phải là Phiên B (56 PC)
-- (9 CN KH hay bị ghi nhầm phiên A khi «Nạp phân công» từ 21/06 lúc đang chọn Phiên A)
--
-- Chạy trên Supabase SQL Editor, sau đó reload app.

BEGIN;

UPDATE section_worker_assignments swa
SET metadata = COALESCE(swa.metadata, '{}'::jsonb) || jsonb_build_object('tapping_session', 'B')
FROM tapping_sections ts
WHERE swa.tapping_section_id = ts.id
  AND ts.team_id = 'team-lk'
  AND swa.record_date = DATE '2026-06-22'
  AND COALESCE(swa.metadata->>'tapping_session', 'A') IS DISTINCT FROM 'B';

COMMIT;

-- Kiểm tra (phải 56 dòng, tất cả tapping_session = B):
-- SELECT metadata->>'tapping_session' AS phien, COUNT(*) 
-- FROM section_worker_assignments swa
-- JOIN tapping_sections ts ON ts.id = swa.tapping_section_id
-- WHERE ts.team_id = 'team-lk' AND swa.record_date = '2026-06-22'
-- GROUP BY 1;
