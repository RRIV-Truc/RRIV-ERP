-- SPM giao viec v3: noi cap 1 -> cap 2 (parent_id)
ALTER TABLE spm_gv_tasks
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES spm_gv_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_spm_gv_tasks_parent ON spm_gv_tasks (parent_id);
