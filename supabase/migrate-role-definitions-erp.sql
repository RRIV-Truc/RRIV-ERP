-- RBAC ERP: role_definitions + app_registry (chạy trên Supabase)
-- Mục tiêu: dropdown quyền Nhân sự / Phân quyền đọc từ DB, không hard-code JS.

-- -----------------------------------------------------------------------------
-- 1. Bảng danh mục ứng dụng (hiển thị ma trận gán quyền)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_registry (
  app_id        TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  scope_type    TEXT NOT NULL DEFAULT 'department',
  hub_enabled   BOOLEAN NOT NULL DEFAULT false,
  assignable    BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 100,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. Mở rộng role_definitions (1 dòng = 1 role trong 1 app)
-- -----------------------------------------------------------------------------
ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS app_id TEXT;
ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS role_name TEXT;
ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS scope_type TEXT;
ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS scopeable JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 100;
ALTER TABLE role_definitions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- permissions: JSONB array of strings (harvest:view, employee:*, …)
-- Nếu cột cũ là object rỗng {}, giữ nguyên — app.py chuẩn hóa khi đọc.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_definitions_role_id_key'
  ) THEN
    ALTER TABLE role_definitions DROP CONSTRAINT role_definitions_role_id_key;
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_definitions_app_role
  ON role_definitions (app_id, role_id)
  WHERE app_id IS NOT NULL AND role_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_role_definitions_app_active
  ON role_definitions (app_id, is_active, sort_order);

GRANT SELECT ON app_registry TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON role_definitions TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_registry TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Đồng bộ cột mới từ metadata (dữ liệu seed cũ)
-- -----------------------------------------------------------------------------
UPDATE role_definitions
SET
  app_id     = metadata->>'app_id',
  role_id    = COALESCE(metadata->>'role_id', role_id),
  role_name  = COALESCE(metadata->>'role_name', name),
  description = NULLIF(metadata->>'description', ''),
  scope_type = NULLIF(metadata->>'scope_type', ''),
  scopeable  = COALESCE(metadata->'scopeable', '{}'::jsonb),
  sort_order = COALESCE((metadata->>'sort_order')::int, 100),
  is_active  = COALESCE((metadata->>'is_active')::boolean, true),
  updated_at = now()
WHERE metadata->>'app_id' IS NOT NULL;
