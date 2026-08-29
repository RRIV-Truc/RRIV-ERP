-- TBKL — Sản phẩm / kết quả mục kết luận lớn
-- Chạy trên Supabase SQL Editor sau schema-tbkl.sql

ALTER TABLE tbkl_directives
  ADD COLUMN IF NOT EXISTS deliverable TEXT;
