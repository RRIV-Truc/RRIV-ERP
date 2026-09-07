-- SPM giao viec v2: cot bao cao, bo phan nghiep vu, to Kiem tra cheo + Hien
ALTER TABLE spm_gv_tasks ADD COLUMN IF NOT EXISTS doer_text TEXT;
ALTER TABLE spm_gv_reports ADD COLUMN IF NOT EXISTS completed_text TEXT;
ALTER TABLE spm_gv_reports ADD COLUMN IF NOT EXISTS incomplete_text TEXT;
ALTER TABLE spm_gv_reports ADD COLUMN IF NOT EXISTS reason_text TEXT;

INSERT INTO spm_gv_departments (id, name, sort_order) VALUES
  ('pgd',  'Phó giám đốc', 1),
  ('nv',   'Bộ phận nghiệp vụ', 2),
  ('nc',   'Bộ phận NC&CG', 3),
  ('pkn',  'Phòng kiểm nghiệm / hiệu chuẩn', 4),
  ('ktc',  'Kiểm tra chéo', 5),
  ('tckt', 'Tài chính / kế toán', 6),
  ('lx',   'Lái xe', 7)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

INSERT INTO category_teams (id, name, department, metadata)
VALUES ('team-spm-ktc', 'Kiểm tra chéo', 'dl-2', '{"source":"spm-gv"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  department = EXCLUDED.department,
  metadata = COALESCE(category_teams.metadata, '{}'::jsonb) || EXCLUDED.metadata;

UPDATE employee
SET team_id = 'team-spm-ktc',
    position_name = 'Phụ trách kiểm tra chéo',
    position_id = 'pos-phu-trach'
WHERE username = 'rriv.ntdhien';
