-- RRIV ERP — Dữ liệu khởi tạo + quyền API (chạy sau schema)

-- ============================================================
-- 1. ĐĂNG NHẬP (user_login_view cho app.py)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_accounts (
  username      TEXT PRIMARY KEY,
  password      TEXT NOT NULL,
  display_name  TEXT,
  email         TEXT,
  role          TEXT DEFAULT 'user',
  department    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Bảng có thể đã tồn tại từ lần chạy trước (thiếu cột) — bổ sung an toàn
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DROP VIEW IF EXISTS user_login_view;

CREATE VIEW user_login_view AS
SELECT
  a.username,
  a.password,
  COALESCE(a.display_name, p.ho_ten, a.username) AS display_name,
  COALESCE(a.email, p.email) AS email,
  p.id AS personnel_id,
  COALESCE(p.role, a.role, 'user') AS role,
  COALESCE(p.department, a.department) AS department
FROM user_accounts a
LEFT JOIN category_personnel p ON lower(trim(p.username)) = lower(trim(a.username));

-- Tài khoản admin mặc định (đổi mật khẩu sau khi deploy)
INSERT INTO category_personnel (id, username, ho_ten, role, department, email, status)
VALUES (
  'admin-001', 'admin', 'Quản trị viên', 'admin', 'Viện RRIV', 'admin@rriv.org.vn', 'active'
)
ON CONFLICT (id) DO UPDATE SET
  ho_ten = EXCLUDED.ho_ten,
  role = EXCLUDED.role,
  department = EXCLUDED.department,
  email = EXCLUDED.email;

INSERT INTO user_accounts (username, password, display_name, email, role, department)
VALUES ('admin', 'admin123', 'Quản trị viên', 'admin@rriv.org.vn', 'admin', 'Viện RRIV')
ON CONFLICT (username) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  department = EXCLUDED.department;

-- Khôi phục quyền admin cho tài khoản Viện (không đổi mật khẩu)
UPDATE user_accounts SET role = 'admin', department = COALESCE(department, 'Viện RRIV')
WHERE username IN ('rriv.nttruc', 'rriv.dpchang');

-- ============================================================
-- 2. NHÀ MÁY (sanxuat)
-- ============================================================
INSERT INTO category_factories (id, name, metadata) VALUES
  ('A02', 'Nhà máy chế biến A02', '{"shortName":"A02","code":"A02"}'::jsonb),
  ('B01', 'Nhà máy B01', '{"shortName":"B01","code":"B01"}'::jsonb),
  ('ALL', 'Tất cả nhà máy', '{"shortName":"ALL","code":"ALL"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  metadata = EXCLUDED.metadata;

-- ============================================================
-- 3. PHÂN QUYỀN APP (mở tất cả cho giai đoạn dev)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_permissions_app_id ON app_permissions(app_id);

INSERT INTO app_permissions (app_id, allow_all, departments)
VALUES
  ('vuoncay', true, '[]'::jsonb),
  ('sanxuat', true, '[]'::jsonb),
  ('phanquyen', true, '[]'::jsonb),
  ('thongbao', true, '[]'::jsonb)
ON CONFLICT (app_id) DO UPDATE SET
  allow_all = EXCLUDED.allow_all,
  departments = EXCLUDED.departments;

-- ============================================================
-- 4. GRANT cho Supabase API (anon / authenticated)
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO anon, authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;

GRANT SELECT ON user_login_view TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
