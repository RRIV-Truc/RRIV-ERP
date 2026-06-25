-- Vai trò phân công phần cạo (section_worker_assignments.assignment_role):
--   tapper    — người cạo (metadata.yield_share_pct: % sản lượng cạo)
--   stripper  — người trút mủ nước
--   collector — người bốc mủ đông
-- metadata.work_mode trên bản ghi tapper: solo | coop_2 | coop_3

COMMENT ON COLUMN section_worker_assignments.assignment_role IS
  'tapper | stripper | collector (legacy: primary→tapper)';
