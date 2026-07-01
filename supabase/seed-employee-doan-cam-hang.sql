-- =============================================================================
-- Thêm nhân sự: Đoàn Phan Cẩm Hằng — PT bộ phận nghiệp vụ, TT NCPT sản phẩm mới
-- Tài khoản: rriv.dpchang / mật khẩu: 123456
-- Chạy trên Supabase SQL Editor
-- =============================================================================

BEGIN;

INSERT INTO employee (
  id,
  employee_code,
  full_name,
  national_id,
  username,
  department_id,
  department_name,
  position_name,
  position_id,
  company_email,
  employment_status,
  erp_role,
  metadata
) VALUES (
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'rriv:dpchang'),
  'VIEN-05-012',
  'Đoàn Phan Cẩm Hằng',
  'MIG-DPCH-0001',
  'rriv.dpchang',
  'dl-2',
  'Trung tâm nghiên cứu phát triển sản phẩm mới',
  'Phụ trách bộ phận nghiệp vụ',
  'pos-phu-trach',
  'rriv.dpchang@rriv.org.vn',
  'active',
  'user',
    jsonb_build_object(
    'source', 'seed-employee-doan-cam-hang',
    'systemRoleId', 6
  )
)
ON CONFLICT (id) DO UPDATE SET
  employee_code   = EXCLUDED.employee_code,
  full_name       = EXCLUDED.full_name,
  username        = EXCLUDED.username,
  department_id   = EXCLUDED.department_id,
  department_name = EXCLUDED.department_name,
  position_name   = EXCLUDED.position_name,
  position_id     = EXCLUDED.position_id,
  company_email   = EXCLUDED.company_email,
  employment_status = EXCLUDED.employment_status,
  erp_role        = EXCLUDED.erp_role,
  metadata        = employee.metadata || EXCLUDED.metadata,
  updated_at      = now();

INSERT INTO user_accounts (
  username, password, display_name, email, role, department, employee_id
) VALUES (
  'rriv.dpchang',
  '123456',
  'Đoàn Phan Cẩm Hằng',
  'rriv.dpchang@rriv.org.vn',
  'user',
  'Trung tâm nghiên cứu phát triển sản phẩm mới',
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'rriv:dpchang')
)
ON CONFLICT (username) DO UPDATE SET
  password      = EXCLUDED.password,
  display_name  = EXCLUDED.display_name,
  email         = EXCLUDED.email,
  role          = EXCLUDED.role,
  department    = EXCLUDED.department,
  employee_id   = EXCLUDED.employee_id;

INSERT INTO user_system_role (username, system_role_id, assigned_by)
SELECT 'rriv.dpchang', sr.id, 'seed-employee-doan-cam-hang'
FROM system_role sr
WHERE sr.role_name = 'Staff_Viewer'
ON CONFLICT DO NOTHING;

COMMIT;

-- Nếu đã seed trước đó với listStt=1, bỏ ưu tiên STT thủ công (lãnh đạo luôn lên trên):
-- UPDATE employee SET metadata = metadata - 'listStt' - 'orderByDept' WHERE username = 'rriv.dpchang';

-- Kiểm tra:
-- SELECT full_name, employee_code, username, department_name, position_name FROM employee WHERE username = 'rriv.dpchang';
