-- Seed đội SX mẫu (không còn CN001–CN020 demo).
-- Nhân sự + phần cạo thật: seed-laikhe-workforce.sql
-- Xóa dữ liệu demo cũ: cleanup-demo-workers-cn001-020.sql

INSERT INTO category_teams (id, name, department, metadata) VALUES
  ('1', 'Đội SX 1', 'Sản xuất', '{"code":"1","squad":"1"}'),
  ('2', 'Đội SX 2', 'Sản xuất', '{"code":"2","squad":"2"}'),
  ('3', 'Đội SX 3', 'Sản xuất', '{"code":"3","squad":"3"}')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, metadata = EXCLUDED.metadata;
