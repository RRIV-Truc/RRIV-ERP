-- Sửa lỗi: column a.role does not exist — chạy trước schema-rbac.sql nếu cần

ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
