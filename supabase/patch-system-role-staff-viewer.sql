-- Bổ sung vai trò chỉ xem cho nhân viên (chạy trên Supabase SQL Editor)
INSERT INTO system_role (id, role_name, description) VALUES
  (6, 'Staff_Viewer', 'Nhân viên - Chỉ xem dữ liệu, không chỉnh sửa')
ON CONFLICT (id) DO UPDATE SET
  role_name = EXCLUDED.role_name,
  description = EXCLUDED.description;

SELECT setval(pg_get_serial_sequence('system_role', 'id'),
  COALESCE((SELECT MAX(id) FROM system_role), 1));
