-- =============================================================================
-- Tài khoản IT dùng thử — quyền y hệt rriv.nttruc (+ phonghop)
-- Username: rriv.admin
-- Mật khẩu mặc định: Rriv@IT2026  (đổi ngay sau lần đăng nhập đầu)
--
-- Chạy trên Supabase → SQL Editor → Run
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- UUID cố định cho hồ sơ (tránh trùng khi chạy lại)
-- SELECT uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'rriv:admin');

DO $$
DECLARE
  v_emp_id UUID := uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'rriv:admin'
  );
  v_legacy_id TEXT := 'pers-rriv-admin';
  v_apps JSONB := '{
    "vanphongpham": {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "doanhnghiep":  {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "dieuhanhxe":   {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "vanbannoibo":  {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "nhansu":       {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "dautu":        {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "diemdanh":     {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "vuoncay":      {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "sanxuat":      {"roles": ["admin"], "scopes": {"departments": ["*"], "teams": ["*"], "factories": ["*"]}},
    "chatluong":    {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "thoitiet":     {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "baocao":       {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "thongbao":     {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "phanquyen":    {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "phonghop":     {"roles": ["admin"], "scopes": {"departments": ["*"]}}
  }'::jsonb;
BEGIN
  -- 1. Hồ sơ nhân sự (bảng employee — master hiện tại)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employee'
  ) THEN
    INSERT INTO employee (
      id, employee_code, full_name, national_id, username,
      department_id, department_name, position_name, position_id,
      company_email, employment_status, erp_role, app_roles_cache, metadata
    ) VALUES (
      v_emp_id,
      'VIEN-IT-001',
      'Tài khoản IT (Admin)',
      'MIG-RRIV-ADMIN',
      'rriv.admin',
      NULL,
      'Viện RRIV',
      'Quản trị hệ thống IT',
      'pos-giam-doc',
      'rriv.admin@rriv.org.vn',
      'active',
      'admin',
      v_apps,
      jsonb_build_object(
        'source', 'seed-user-rriv-admin',
        'systemRoleId', 1,
        'note', 'Tài khoản dùng thử IT — quyền Super_Admin + admin toàn app'
      )
    )
    ON CONFLICT (username) DO UPDATE SET
      id                = EXCLUDED.id,
      employee_code     = EXCLUDED.employee_code,
      full_name         = EXCLUDED.full_name,
      department_name   = EXCLUDED.department_name,
      position_name     = EXCLUDED.position_name,
      company_email     = EXCLUDED.company_email,
      employment_status = EXCLUDED.employment_status,
      erp_role          = 'admin',
      app_roles_cache   = EXCLUDED.app_roles_cache,
      metadata          = employee.metadata || EXCLUDED.metadata,
      updated_at        = now();
  END IF;

  -- 2. Legacy row cho FK user_roles.uid → category_personnel_table_legacy
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'category_personnel_table_legacy'
  ) THEN
    INSERT INTO category_personnel_table_legacy (
      id, username, ho_ten, role, department, email, status, app_roles_cache, metadata
    ) VALUES (
      v_legacy_id,
      'rriv.admin',
      'Tài khoản IT (Admin)',
      'admin',
      'Viện RRIV',
      'rriv.admin@rriv.org.vn',
      'active',
      v_apps,
      jsonb_build_object('source', 'seed-user-rriv-admin', 'employee_id', v_emp_id::text)
    )
    ON CONFLICT (id) DO UPDATE SET
      username        = EXCLUDED.username,
      ho_ten          = EXCLUDED.ho_ten,
      role            = 'admin',
      department      = EXCLUDED.department,
      email           = EXCLUDED.email,
      status          = EXCLUDED.status,
      app_roles_cache = EXCLUDED.app_roles_cache,
      metadata        = category_personnel_table_legacy.metadata || EXCLUDED.metadata,
      updated_at      = now();
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'category_personnel'
      AND table_type = 'BASE TABLE'
  ) THEN
    INSERT INTO category_personnel (
      id, username, ho_ten, role, department, email, status, app_roles_cache
    ) VALUES (
      v_legacy_id, 'rriv.admin', 'Tài khoản IT (Admin)', 'admin',
      'Viện RRIV', 'rriv.admin@rriv.org.vn', 'active', v_apps
    )
    ON CONFLICT (id) DO UPDATE SET
      username        = EXCLUDED.username,
      ho_ten          = EXCLUDED.ho_ten,
      role            = 'admin',
      department      = EXCLUDED.department,
      email           = EXCLUDED.email,
      app_roles_cache = EXCLUDED.app_roles_cache,
      updated_at      = now();
  END IF;
END $$;

-- 3. Tài khoản đăng nhập — role admin = toàn quyền kỹ thuật (giống rriv.nttruc)
INSERT INTO user_accounts (
  username, password, display_name, email, role, department, employee_id
) VALUES (
  'rriv.admin',
  'Rriv@IT2026',
  'Tài khoản IT (Admin)',
  'rriv.admin@rriv.org.vn',
  'admin',
  'Viện RRIV',
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'rriv:admin')
)
ON CONFLICT (username) DO UPDATE SET
  password      = EXCLUDED.password,
  display_name  = EXCLUDED.display_name,
  email         = EXCLUDED.email,
  role          = 'admin',
  department    = EXCLUDED.department,
  employee_id   = EXCLUDED.employee_id;

-- 4. Vai trò tổ chức Viện: Super_Admin (Quản trị viên)
INSERT INTO user_system_role (username, system_role_id, assigned_by)
SELECT 'rriv.admin', sr.id, 'seed-user-rriv-admin'
FROM system_role sr
WHERE sr.role_name = 'Super_Admin'
ON CONFLICT (username, system_role_id) DO NOTHING;

-- 5. Quyền từng app (user_roles) — uid phải có trong category_personnel_table_legacy
INSERT INTO user_roles (id, uid, username, app_id, role_id, is_active, metadata)
SELECT
  'ur-admin-' || app_id,
  'pers-rriv-admin',
  'rriv.admin',
  app_id,
  'admin',
  true,
  jsonb_build_object(
    'roles', jsonb_build_array('admin'),
    'scopes', jsonb_build_object(
      'departments', jsonb_build_array('*'),
      'teams', jsonb_build_array('*'),
      'factories', jsonb_build_array('*')
    ),
    'isActive', true
  )
FROM (VALUES
  ('vanphongpham'), ('doanhnghiep'), ('dieuhanhxe'), ('vanbannoibo'),
  ('nhansu'), ('dautu'), ('diemdanh'), ('vuoncay'), ('sanxuat'),
  ('chatluong'), ('thoitiet'), ('baocao'), ('thongbao'),
  ('phanquyen'), ('phonghop')
) AS apps(app_id)
ON CONFLICT (id) DO UPDATE SET
  is_active = true,
  role_id   = 'admin',
  metadata  = EXCLUDED.metadata;

COMMIT;

-- Kiểm tra sau khi chạy:
-- SELECT username, role, display_name FROM user_accounts WHERE username = 'rriv.admin';
-- SELECT sr.role_name FROM user_system_role usr
--   JOIN system_role sr ON sr.id = usr.system_role_id WHERE usr.username = 'rriv.admin';
-- SELECT app_roles_cache->'phonghop' FROM employee WHERE username = 'rriv.admin';
