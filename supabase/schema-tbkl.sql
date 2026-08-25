-- TBKL — Theo dõi kết luận họp (app con RRIV-ERP)
-- Chạy trên Supabase SQL Editor, sau đó: supabase/seed-tbkl-rbac.sql

CREATE TABLE IF NOT EXISTS tbkl_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_seq INT NOT NULL,
  title TEXT NOT NULL,
  meeting_date DATE,
  source_ref TEXT,
  conclusion_summary TEXT,
  report_lock_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'locked', 'archived')),
  created_by_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_seq)
);

CREATE TABLE IF NOT EXISTS tbkl_directives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES tbkl_cycles(id) ON DELETE CASCADE,
  seq_no INT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  lead_department_id TEXT,
  lead_department_name TEXT,
  supervisor_name TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  deadline DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, seq_no),
  UNIQUE (cycle_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tbkl_directives_cycle ON tbkl_directives(cycle_id);

CREATE TABLE IF NOT EXISTS tbkl_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directive_id UUID NOT NULL REFERENCES tbkl_directives(id) ON DELETE CASCADE,
  seq_no INT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  deliverable TEXT,
  owner_unit_id TEXT,
  owner_unit_name TEXT,
  coordinator_units TEXT,
  assignee_name TEXT,
  deadline DATE,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (directive_id, seq_no),
  UNIQUE (directive_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tbkl_tasks_directive ON tbkl_tasks(directive_id);
CREATE INDEX IF NOT EXISTS idx_tbkl_tasks_owner ON tbkl_tasks(owner_unit_id);

CREATE TABLE IF NOT EXISTS tbkl_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tbkl_tasks(id) ON DELETE CASCADE,
  week_label TEXT NOT NULL,
  progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'in_progress', 'at_risk', 'completed', 'blocked'
  )),
  difficulties TEXT,
  solution TEXT,
  recommendation TEXT,
  rag TEXT CHECK (rag IN ('green', 'yellow', 'red', 'gray')),
  submitted_by_username TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (task_id, week_label)
);

CREATE INDEX IF NOT EXISTS idx_tbkl_reports_task ON tbkl_reports(task_id);
