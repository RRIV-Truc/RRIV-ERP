-- TBKL — Đính kèm văn bản kết luận (PDF) + bảng kế hoạch triển khai
-- Chạy trên Supabase SQL Editor sau schema-tbkl.sql

ALTER TABLE tbkl_cycles
  ADD COLUMN IF NOT EXISTS conclusion_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS conclusion_pdf_name TEXT,
  ADD COLUMN IF NOT EXISTS plan_workbook_path TEXT,
  ADD COLUMN IF NOT EXISTS plan_workbook_name TEXT;
