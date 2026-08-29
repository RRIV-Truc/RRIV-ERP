-- TBKL — Xác nhận tiến độ Phòng Kế hoạch (cột % PKH, RAG theo đánh giá PKH)
-- Chạy trên Supabase SQL Editor sau schema-tbkl.sql

ALTER TABLE tbkl_reports
  ADD COLUMN IF NOT EXISTS confirmed_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS confirmed_status TEXT CHECK (confirmed_status IS NULL OR confirmed_status IN (
    'not_started', 'in_progress', 'at_risk', 'completed', 'blocked'
  )),
  ADD COLUMN IF NOT EXISTS confirmed_by_username TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
