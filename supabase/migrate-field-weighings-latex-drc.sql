-- Thêm cột DRC mủ nước (nếu DB tạo từ rriv_full_schema.sql cũ)
-- Chạy trong Supabase SQL Editor. App vẫn lưu được qua metadata nếu chưa chạy file này.

ALTER TABLE field_worker_weighings ADD COLUMN IF NOT EXISTS latex_drc_pct NUMERIC(8,3);
ALTER TABLE field_worker_weighings ADD COLUMN IF NOT EXISTS coag_tsc_pct NUMERIC(8,3);
