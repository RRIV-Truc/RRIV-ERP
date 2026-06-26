-- Tài khoản thử: rriv.tminh — Phó giám đốc TT NCPT Giống
-- Chạy trên Supabase SQL Editor nếu cần tạo thủ công.

INSERT INTO employee (
  id, employee_code, full_name, national_id, username,
  department_id, department_name, position_name,
  company_email, employment_status, erp_role, metadata
) VALUES (
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'rriv:tminh'),
  'RRIV-TMINH',
  'Trần Minh',
  'MIG-TMINH-0001',
  'rriv.tminh',
  'dl-3',
  'Trung tâm nghiên cứu phát triển Giống cao su',
  'Phó giám đốc Trung tâm nghiên cứu phát triển giống',
  'rriv.tminh@rriv.org.vn',
  'active',
  'manager',
  '{"source":"seed-user-rriv-tminh"}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  department_name = EXCLUDED.department_name,
  position_name = EXCLUDED.position_name,
  employment_status = EXCLUDED.employment_status,
  erp_role = EXCLUDED.erp_role,
  updated_at = now();

INSERT INTO user_accounts (
  username, password, display_name, email, role, department, employee_id
) VALUES (
  'rriv.tminh',
  '123456',
  'Trần Minh',
  'rriv.tminh@rriv.org.vn',
  'manager',
  'Trung tâm nghiên cứu phát triển Giống cao su',
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'rriv:tminh')
)
ON CONFLICT (username) DO UPDATE SET
  password = EXCLUDED.password,
  display_name = EXCLUDED.display_name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  department = EXCLUDED.department,
  employee_id = EXCLUDED.employee_id;
