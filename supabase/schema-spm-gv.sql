-- Giao việc Trung tâm NCPT Sản phẩm mới (SPM)
CREATE TABLE IF NOT EXISTS spm_gv_departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO spm_gv_departments (id, name, sort_order) VALUES
  ('pgd',  'Phó giám đốc', 1),
  ('nv',   'Bộ phận nghiệp vụ', 2),
  ('nc',   'Bộ phận NC&CG', 3),
  ('pkn',  'Phòng kiểm nghiệm / hiệu chuẩn', 4),
  ('ktc',  'Kiểm tra chéo', 5),
  ('tckt', 'Tài chính / kế toán', 6),
  ('lx',   'Lái xe', 7)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS spm_gv_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  department_id TEXT REFERENCES spm_gv_departments(id),
  role TEXT NOT NULL DEFAULT 'staff'
    CHECK (role IN ('director', 'deputy', 'head', 'staff')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spm_gv_staff_dept ON spm_gv_staff (department_id);

CREATE TABLE IF NOT EXISTS spm_gv_weeks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INT NOT NULL,
  week_no INT NOT NULL,
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'locked')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, week_no)
);

CREATE TABLE IF NOT EXISTS spm_gv_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id UUID NOT NULL REFERENCES spm_gv_weeks(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('center', 'dept')),
  department_id TEXT REFERENCES spm_gv_departments(id),
  title TEXT NOT NULL,
  description TEXT,
  doer_text TEXT,
  deadline DATE,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'at_risk', 'completed', 'blocked')),
  progress_pct INT NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  work_score INT CHECK (work_score IS NULL OR (work_score >= 1 AND work_score <= 5)),
  work_comment TEXT,
  work_scored_by TEXT,
  work_scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spm_gv_tasks_week ON spm_gv_tasks (week_id, level);
CREATE INDEX IF NOT EXISTS idx_spm_gv_tasks_dept ON spm_gv_tasks (department_id);

CREATE TABLE IF NOT EXISTS spm_gv_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES spm_gv_tasks(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  full_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('lead', 'doer')),
  UNIQUE (task_id, username, kind)
);

CREATE INDEX IF NOT EXISTS idx_spm_gv_assignees_user ON spm_gv_assignees (username);

CREATE TABLE IF NOT EXISTS spm_gv_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES spm_gv_tasks(id) ON DELETE CASCADE,
  progress_pct INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress',
  note TEXT,
  difficulties TEXT,
  solution TEXT,
  completed_text TEXT,
  incomplete_text TEXT,
  reason_text TEXT,
  reported_by TEXT,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spm_gv_leader_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id UUID NOT NULL REFERENCES spm_gv_weeks(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('center', 'dept')),
  department_id TEXT REFERENCES spm_gv_departments(id),
  username TEXT NOT NULL,
  full_name TEXT,
  support_score INT CHECK (support_score IS NULL OR (support_score >= 1 AND support_score <= 5)),
  initiative_score INT CHECK (initiative_score IS NULL OR (initiative_score >= 1 AND initiative_score <= 5)),
  note TEXT,
  scored_by TEXT NOT NULL,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (week_id, username, scope, department_id)
);

CREATE INDEX IF NOT EXISTS idx_spm_gv_leader_notes_week ON spm_gv_leader_notes (week_id, scope);

INSERT INTO app_registry (app_id, name, sort_order, assignable, hub_enabled, scope_type)
VALUES ('spmgv', 'Giao việc TT SPM', 45, TRUE, TRUE, 'department')
ON CONFLICT (app_id) DO UPDATE SET name = EXCLUDED.name, hub_enabled = TRUE;
