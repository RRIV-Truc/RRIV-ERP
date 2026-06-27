-- RRIV ERP — RBAC 3 tầng (chạy SAU schema.sql + seed.sql)
-- Tham khảo Phước Hòa: role_definitions + user_roles + app_roles_cache
-- Tầng Viện: system_role + user_system_role

-- ============================================================
-- 0. VAI TRÒ TỔ CHỨC VIỆN (nếu chưa tạo)
-- ============================================================
CREATE TABLE IF NOT EXISTS system_role (
  id            SERIAL PRIMARY KEY,
  role_name     TEXT NOT NULL UNIQUE,
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

INSERT INTO system_role (id, role_name, description) VALUES
  (1, 'Super_Admin', 'Quản trị viên - Toàn quyền cấu hình và quản trị hệ thống'),
  (2, 'Institute_Executive', 'Ban Lãnh đạo Viện - Xem báo cáo toàn Viện, phê duyệt tối cao'),
  (3, 'Department_Head', 'Lãnh đạo đơn vị - Quản lý và duyệt nội bộ đơn vị'),
  (4, 'Operations_Specialist', 'Chuyên viên Nghiệp vụ - Tổng hợp, xử lý dữ liệu toàn Viện'),
  (5, 'Technical_Staff', 'NCV / KTV - Nhập liệu chuyên môn, báo cáo kỹ thuật'),
  (6, 'Staff_Viewer', 'Nhân viên - Chỉ xem dữ liệu, không chỉnh sửa')
ON CONFLICT (id) DO UPDATE SET
  role_name = EXCLUDED.role_name,
  description = EXCLUDED.description;

SELECT setval(pg_get_serial_sequence('system_role', 'id'),
  COALESCE((SELECT MAX(id) FROM system_role), 1));

-- ============================================================
-- 1. GÁN VAI TRÒ TỔ CHỨC (user ↔ system_role)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_system_role (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  username        TEXT NOT NULL REFERENCES user_accounts(username) ON DELETE CASCADE,
  system_role_id  INT NOT NULL REFERENCES system_role(id) ON DELETE CASCADE,
  assigned_by     TEXT,
  assigned_at     TIMESTAMPTZ DEFAULT now(),
  metadata        JSONB DEFAULT '{}',
  UNIQUE (username, system_role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_system_role_user ON user_system_role(username);

-- ============================================================
-- 2. MỞ RỘNG user_roles (Phước Hòa — quyền theo từng app)
-- metadata JSONB lưu: { "roles": ["editor"], "scopes": { "departments": ["*"] }, "isActive": true }
-- ============================================================
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- ============================================================
-- 3. BỔ SUNG CỘT user_accounts (bảng cũ có thể thiếu)
-- ============================================================
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- ============================================================
-- 4. VIEW ĐĂNG NHẬP (gộp tầng Identity + Org role)
-- ============================================================
DROP VIEW IF EXISTS user_login_view;

CREATE VIEW user_login_view AS
SELECT
  a.username,
  a.password,
  COALESCE(a.display_name, p.ho_ten, a.username) AS display_name,
  COALESCE(a.email, p.email) AS email,
  p.id AS personnel_id,
  COALESCE(p.role, a.role, 'user') AS role,
  COALESCE(p.department, a.department) AS department,
  p.app_roles_cache,
  (
    SELECT COALESCE(json_agg(sr.role_name ORDER BY sr.id), '[]'::json)
    FROM user_system_role usr
    JOIN system_role sr ON sr.id = usr.system_role_id
    WHERE usr.username = a.username
  ) AS system_roles,
  EXISTS (
    SELECT 1
    FROM user_system_role usr
    JOIN system_role sr ON sr.id = usr.system_role_id
    WHERE usr.username = a.username
      AND sr.role_name IN ('Super_Admin', 'super_admin', 'SuperAdmin')
  ) AS is_super_admin
FROM user_accounts a
LEFT JOIN category_personnel p ON lower(trim(p.username)) = lower(trim(a.username));

GRANT SELECT ON user_login_view TO anon, authenticated, service_role;

-- ============================================================
-- 5. THIẾT LẬP rriv.nttruc — admin + Super_Admin
-- (không đổi mật khẩu)
-- ============================================================

-- 4a. Tầng đăng nhập
UPDATE user_accounts
SET role = 'admin',
    department = COALESCE(department, 'Viện RRIV'),
    display_name = COALESCE(display_name, 'rriv.nttruc')
WHERE username = 'rriv.nttruc';

-- 4b. Hồ sơ nhân sự (master — Phước Hòa dùng categoryPersonnel)
INSERT INTO category_personnel (id, username, ho_ten, role, department, email, status, app_roles_cache)
VALUES (
  'pers-rriv-nttruc',
  'rriv.nttruc',
  'rriv.nttruc',
  'admin',
  'Viện RRIV',
  NULL,
  'active',
  '{
    "vanphongpham": {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "dieuhanhxe":   {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "vanbannoibo":  {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "nhansu":       {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "diemdanh":     {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "vuoncay":      {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "sanxuat":      {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "chatluong":    {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "baocao":       {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "thongbao":     {"roles": ["admin"], "scopes": {"departments": ["*"]}},
    "phanquyen":    {"roles": ["admin"], "scopes": {"departments": ["*"]}}
  }'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  ho_ten = COALESCE(category_personnel.ho_ten, EXCLUDED.ho_ten),
  role = 'admin',
  department = EXCLUDED.department,
  app_roles_cache = EXCLUDED.app_roles_cache,
  updated_at = now();

-- 4c. Tầng tổ chức Viện
INSERT INTO user_system_role (username, system_role_id, assigned_by)
SELECT 'rriv.nttruc', sr.id, 'schema-rbac'
FROM system_role sr
WHERE sr.role_name = 'Super_Admin'
ON CONFLICT (username, system_role_id) DO NOTHING;

-- 4d. Tầng app (phanquyen — 1 dòng / app, role admin toàn Viện)
INSERT INTO user_roles (id, uid, username, app_id, role_id, is_active, metadata)
SELECT
  'ur-nttruc-' || app_id,
  'pers-rriv-nttruc',
  'rriv.nttruc',
  app_id,
  'admin',
  true,
  jsonb_build_object(
    'roles', jsonb_build_array('admin'),
    'scopes', jsonb_build_object('departments', jsonb_build_array('*')),
    'isActive', true
  )
FROM (VALUES
  ('vanphongpham'), ('dieuhanhxe'), ('vanbannoibo'), ('nhansu'),
  ('diemdanh'), ('vuoncay'), ('sanxuat'), ('chatluong'),
  ('baocao'), ('thongbao'), ('phanquyen')
) AS apps(app_id)
ON CONFLICT (id) DO UPDATE SET
  is_active = true,
  metadata = EXCLUDED.metadata;
