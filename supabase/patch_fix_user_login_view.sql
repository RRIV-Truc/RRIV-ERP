-- Chạy riêng nếu gặp lỗi: column a.display_name does not exist
-- (bảng user_accounts cũ thiếu cột)

ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DROP VIEW IF EXISTS user_login_view;

CREATE VIEW user_login_view AS
SELECT
  a.username,
  a.password,
  COALESCE(a.display_name, p.ho_ten, a.username) AS display_name,
  a.email,
  p.id AS personnel_id,
  COALESCE(p.role, 'user') AS role,
  p.department
FROM user_accounts a
LEFT JOIN category_personnel p ON lower(trim(p.username)) = lower(trim(a.username));

GRANT SELECT ON user_login_view TO anon, authenticated, service_role;

INSERT INTO category_personnel (id, username, ho_ten, role, department, email, status)
VALUES (
  'admin-001', 'admin', 'Quản trị viên', 'admin', 'Viện RRIV', 'admin@rriv.org.vn', 'active'
)
ON CONFLICT (id) DO UPDATE SET
  ho_ten = EXCLUDED.ho_ten,
  role = EXCLUDED.role,
  department = EXCLUDED.department,
  email = EXCLUDED.email;

INSERT INTO user_accounts (username, password, display_name, email)
VALUES ('admin', 'admin123', 'Quản trị viên', 'admin@rriv.org.vn')
ON CONFLICT (username) DO UPDATE SET
  password = EXCLUDED.password,
  display_name = EXCLUDED.display_name,
  email = EXCLUDED.email;
