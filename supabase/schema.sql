-- RRIV ERP — Schema Supabase (chuyển từ Firestore Phước Hòa)
-- Chạy trong Supabase SQL Editor: https://supabase.com/dashboard

-- ============================================================
-- 1. BẢNG DOCUMENT (thay Firestore collection/document)
-- ============================================================
CREATE TABLE IF NOT EXISTS erp_collections (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  collection  TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  updated_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_erp_collections_name ON erp_collections(collection);
CREATE INDEX IF NOT EXISTS idx_erp_collections_created ON erp_collections(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_erp_collections_data ON erp_collections USING GIN(data);

-- ============================================================
-- 2. MASTER DATA (xương sống liên kết các module)
-- ============================================================
CREATE TABLE IF NOT EXISTS category_personnel (
  id              TEXT PRIMARY KEY,  -- UUID user (thay Firebase UID)
  username        TEXT UNIQUE,
  ho_ten          TEXT,
  phone           TEXT,
  email           TEXT,
  department      TEXT,
  position        TEXT,
  team            TEXT,
  role            TEXT DEFAULT 'user',
  disabled        BOOLEAN DEFAULT false,
  account_locked  BOOLEAN DEFAULT false,
  lock_until      TIMESTAMPTZ,
  status          TEXT DEFAULT 'active',
  app_roles_cache JSONB DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS category_departments (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT,
  ten         TEXT,
  ten_phong_ban TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS category_positions (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS category_teams (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT,
  department  TEXT,
  manager_id  TEXT REFERENCES category_personnel(id),
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS category_factories (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_permissions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  app_id        TEXT NOT NULL,
  allow_all     BOOLEAN DEFAULT false,
  departments   JSONB DEFAULT '[]',
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_definitions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role_id       TEXT UNIQUE NOT NULL,
  name          TEXT,
  permissions   JSONB DEFAULT '{}',
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  uid         TEXT REFERENCES category_personnel(id),
  role_id     TEXT,
  app_id      TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. HỆ THỐNG (đã có login_history từ phần đăng nhập thử)
-- ============================================================
CREATE TABLE IF NOT EXISTS login_history (
  id          BIGSERIAL PRIMARY KEY,
  username    TEXT,
  status      TEXT,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4. TRIGGER cập nhật updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_erp_collections_updated ON erp_collections;
CREATE TRIGGER trg_erp_collections_updated
  BEFORE UPDATE ON erp_collections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_category_personnel_updated ON category_personnel;
CREATE TRIGGER trg_category_personnel_updated
  BEFORE UPDATE ON category_personnel
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 5. VIEW đăng nhập (nếu chưa có — chỉnh theo bảng employee thực tế)
-- ============================================================
-- CREATE OR REPLACE VIEW user_login_view AS
-- SELECT e.username, e.password, e.display_name, p.id AS personnel_id, p.role
-- FROM employees e
-- LEFT JOIN category_personnel p ON p.username = e.username;
