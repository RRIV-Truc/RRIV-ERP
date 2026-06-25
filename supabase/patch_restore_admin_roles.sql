-- Khôi phục quyền admin: role lưu trên user_accounts (không phụ thuộc category_personnel)

ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS department TEXT;

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

GRANT SELECT ON user_login_view TO anon, authenticated, service_role;

-- Chỉ đổi role, giữ nguyên mật khẩu
UPDATE user_accounts
SET role = 'admin', department = COALESCE(department, 'Viện RRIV')
WHERE username = 'rriv.nttruc';

-- Bỏ comment dòng dưới nếu rriv.dpchang cũng cần admin
-- UPDATE user_accounts SET role = 'admin', department = COALESCE(department, 'Viện RRIV') WHERE username = 'rriv.dpchang';
