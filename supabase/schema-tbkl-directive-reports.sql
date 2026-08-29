-- TBKL — Báo cáo tiến độ mục kết luận lớn (KHCN đánh giá · VT/Thư ký xác nhận)
-- Chạy trên Supabase SQL Editor sau schema-tbkl.sql và schema-tbkl-confirm.sql

CREATE TABLE IF NOT EXISTS tbkl_directive_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directive_id UUID NOT NULL REFERENCES tbkl_directives(id) ON DELETE CASCADE,
  week_label TEXT NOT NULL,
  progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'in_progress', 'at_risk', 'completed', 'blocked'
  )),
  note TEXT,
  assessed_by_username TEXT,
  assessed_at TIMESTAMPTZ,
  confirmed_pct NUMERIC(5,2),
  confirmed_status TEXT CHECK (confirmed_status IS NULL OR confirmed_status IN (
    'not_started', 'in_progress', 'at_risk', 'completed', 'blocked'
  )),
  confirmed_by_username TEXT,
  confirmed_at TIMESTAMPTZ,
  rag TEXT CHECK (rag IS NULL OR rag IN ('green', 'yellow', 'red', 'gray')),
  locked BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (directive_id, week_label)
);

CREATE INDEX IF NOT EXISTS idx_tbkl_directive_reports_directive
  ON tbkl_directive_reports (directive_id, week_label DESC);
