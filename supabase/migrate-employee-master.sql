-- =============================================================================
-- RRIV ERP — Chuẩn hóa bảng employee làm MASTER nhân sự duy nhất
-- Chạy trên Supabase SQL Editor (theo thứ tự từ trên xuống, một lần).
--
-- Trước khi chạy: backup (Supabase Dashboard → Database → Backups)
-- Sau khi chạy: deploy app.py đã cập nhật TABLE_MAP
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Backup an toàn
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_backup_20260611 AS
TABLE employee;

CREATE TABLE IF NOT EXISTS category_personnel_backup_20260611 AS
TABLE category_personnel;

-- -----------------------------------------------------------------------------
-- 1. Hàm tiện ích
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Chuẩn hóa status cũ (Full-time → employment_type) — nhận TEXT (gọi với status::text)
CREATE OR REPLACE FUNCTION map_employment_type(old_status TEXT)
RETURNS TEXT AS $$
DECLARE
  s TEXT;
BEGIN
  s := lower(trim(coalesce(old_status, '')));
  IF s = '' THEN RETURN 'full_time'; END IF;
  IF s IN ('full-time', 'full_time', 'fulltime', 'active') THEN RETURN 'full_time'; END IF;
  IF s IN ('part-time', 'part_time', 'parttime') THEN RETURN 'part_time'; END IF;
  IF s IN ('contract', 'hợp đồng') THEN RETURN 'contract'; END IF;
  IF s IN ('inactive', 'resigned', 'terminated') THEN RETURN NULL; END IF;
  RETURN lower(replace(trim(old_status), '-', '_'));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Giá trị mặc định khi import category_personnel → employee (cột NOT NULL trên bảng cũ)
CREATE OR REPLACE FUNCTION migrate_national_id(meta JSONB, legacy_id TEXT)
RETURNS TEXT AS $$
  SELECT COALESCE(
    NULLIF(trim(meta->>'national_id'), ''),
    NULLIF(trim(meta->>'nationalId'), ''),
    NULLIF(trim(meta->>'cmnd'), ''),
    'MIG-' || upper(left(regexp_replace(coalesce(legacy_id, 'x'), '[^a-zA-Z0-9]', '', 'g'), 12))
  );
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION migrate_employee_status_enum(cp_status TEXT)
RETURNS TEXT AS $$
DECLARE
  s TEXT;
BEGIN
  s := lower(coalesce(trim(cp_status), ''));
  IF s IN ('inactive', 'resigned', 'terminated') THEN RETURN 'Probation'; END IF;
  IF s IN ('full-time', 'full_time', 'active') THEN RETURN 'Full-time'; END IF;
  IF s = 'probation' THEN RETURN 'Probation'; END IF;
  IF s IN ('part-time', 'part_time') THEN RETURN 'Part-time'; END IF;
  RETURN 'Full-time';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION migrate_gender(meta JSONB, src TEXT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
  g TEXT;
BEGIN
  g := lower(trim(coalesce(src, meta->>'gender', meta->>'gioi_tinh', '')));
  IF g IN ('male', 'm', 'nam') THEN RETURN 'Male'; END IF;
  IF g IN ('female', 'f', 'nữ', 'nu') THEN RETURN 'Female'; END IF;
  IF g = 'male' THEN RETURN 'Male'; END IF;
  IF g = 'female' THEN RETURN 'Female'; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- -----------------------------------------------------------------------------
-- 2. Bổ sung cột mới trên employee (giữ dữ liệu NV001, NV002)
-- -----------------------------------------------------------------------------
ALTER TABLE employee ADD COLUMN IF NOT EXISTS uuid_id UUID;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS department_id TEXT;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS position_id TEXT;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS team_id TEXT;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS department_name TEXT;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS position_name TEXT;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS team_name TEXT;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS employment_status TEXT DEFAULT 'active';
ALTER TABLE employee ADD COLUMN IF NOT EXISTS disabled BOOLEAN DEFAULT false;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS account_locked BOOLEAN DEFAULT false;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS lock_until TIMESTAMPTZ;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS app_roles_cache JSONB DEFAULT '{}'::jsonb;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS erp_role TEXT DEFAULT 'user';

-- Gán UUID chính = user_id (cột user_id kiểu UUID hoặc TEXT đều được)
UPDATE employee
SET uuid_id = user_id::uuid
WHERE uuid_id IS NULL
  AND user_id IS NOT NULL;

UPDATE employee
SET uuid_id = gen_random_uuid()
WHERE uuid_id IS NULL;

-- employment_type từ cột status cũ (Full-time) — status có thể là ENUM employee_status
UPDATE employee
SET employment_type = map_employment_type(status::text)
WHERE employment_type IS NULL;

UPDATE employee
SET employment_status = CASE
  WHEN termination_date IS NOT NULL THEN 'resigned'
  WHEN lower(coalesce(status::text, '')) IN ('inactive', 'resigned', 'terminated') THEN 'resigned'
  ELSE 'active'
END
WHERE employment_status IS NULL OR employment_status = 'active';

-- -----------------------------------------------------------------------------
-- 3. user_accounts ↔ employee
--    employee_id cũ có thể là BIGINT (FK serial) → đổi sang UUID
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  emp_col_type TEXT;
  r RECORD;
BEGIN
  -- Gỡ FK cũ trên cột employee_id (BIGINT) trước khi đổi tên
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'user_accounts'
      AND c.contype = 'f'
      AND a.attname = 'employee_id'
  LOOP
    EXECUTE format('ALTER TABLE user_accounts DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  SELECT data_type INTO emp_col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_accounts'
    AND column_name = 'employee_id';

  IF emp_col_type IN ('bigint', 'integer', 'smallint') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_accounts'
        AND column_name = 'employee_legacy_id'
    ) THEN
      ALTER TABLE user_accounts RENAME COLUMN employee_id TO employee_legacy_id;
    END IF;
    ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS employee_id UUID;
  ELSIF emp_col_type IS NULL THEN
    ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS employee_id UUID;
  END IF;
  -- emp_col_type = 'uuid' → giữ nguyên
END $$;

-- Gắn UUID từ employee.id serial cũ (nếu user_accounts từng trỏ BIGINT)
UPDATE user_accounts ua
SET employee_id = e.uuid_id
FROM employee e
WHERE ua.employee_id IS NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_accounts'
      AND column_name = 'employee_legacy_id'
  )
  AND ua.employee_legacy_id IS NOT NULL
  AND e.id = ua.employee_legacy_id;

-- Gắn employee_id qua user_id
UPDATE user_accounts ua
SET employee_id = e.uuid_id
FROM employee e
WHERE ua.employee_id IS NULL
  AND e.user_id IS NOT NULL
  AND lower(trim(ua.username)) = lower(trim(
    COALESCE(
      e.username,
      (SELECT cp.username FROM category_personnel cp WHERE cp.id = e.user_id::text LIMIT 1)
    )
  ));

-- Gắn thêm qua category_personnel.username
UPDATE user_accounts ua
SET employee_id = e.uuid_id
FROM employee e
JOIN category_personnel cp ON cp.id = e.user_id::text
WHERE ua.employee_id IS NULL
  AND lower(trim(ua.username)) = lower(trim(cp.username));

-- Gắn qua email
UPDATE user_accounts ua
SET employee_id = e.uuid_id
FROM employee e
WHERE ua.employee_id IS NULL
  AND e.company_email IS NOT NULL
  AND lower(trim(ua.email)) = lower(trim(e.company_email));

-- Điền username trên employee từ user_accounts
UPDATE employee e
SET username = ua.username
FROM user_accounts ua
WHERE e.username IS NULL
  AND ua.employee_id IS NOT NULL
  AND ua.employee_id = e.uuid_id;

-- -----------------------------------------------------------------------------
-- 4. Chuyển system_role_id từ employee → user_system_role
-- -----------------------------------------------------------------------------
INSERT INTO user_system_role (username, system_role_id, assigned_by, metadata)
SELECT DISTINCT
  ua.username,
  e.system_role_id,
  'migrate-employee-master',
  jsonb_build_object('migrated_from', 'employee.system_role_id')
FROM employee e
JOIN user_accounts ua ON ua.employee_id = e.uuid_id
WHERE e.system_role_id IS NOT NULL
ON CONFLICT (username, system_role_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Import category_personnel → employee (những người chưa có trong employee)
-- -----------------------------------------------------------------------------
-- gender: CHECK chỉ cho Male/Female — thiếu thì để NULL (không dùng 'Unknown')
DO $$
BEGIN
  ALTER TABLE employee ALTER COLUMN gender DROP NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

INSERT INTO employee (
  uuid_id,
  employee_code,
  full_name,
  gender,
  phone_number,
  personal_email,
  company_email,
  national_id,
  status,
  hire_date,
  username,
  department_name,
  position_name,
  team_name,
  employment_status,
  disabled,
  account_locked,
  lock_until,
  app_roles_cache,
  metadata,
  erp_role,
  created_at,
  updated_at
)
SELECT
  cp.id::uuid,
  COALESCE(
    NULLIF(trim(cp.metadata->>'employee_code'), ''),
    NULLIF(trim(cp.metadata->>'employeeCode'), ''),
    'CP-' || left(cp.id, 8)
  ),
  COALESCE(cp.ho_ten, cp.username, 'Chưa đặt tên'),
  migrate_gender(cp.metadata, NULL),
  COALESCE(cp.phone, '0000000000'),
  cp.email,
  cp.email,
  migrate_national_id(cp.metadata, cp.id),
  migrate_employee_status_enum(cp.status)::employee_status,
  COALESCE(cp.created_at::date, CURRENT_DATE),
  cp.username,
  cp.department,
  cp.position,
  cp.team,
  CASE
    WHEN cp.disabled OR lower(coalesce(cp.status, '')) IN ('inactive', 'resigned') THEN 'resigned'
    ELSE 'active'
  END,
  COALESCE(cp.disabled, false),
  COALESCE(cp.account_locked, false),
  cp.lock_until,
  COALESCE(cp.app_roles_cache, '{}'::jsonb),
  COALESCE(cp.metadata, '{}'::jsonb) || jsonb_build_object(
    'migrated_from', 'category_personnel',
    'legacy_personnel_id', cp.id
  ),
  COALESCE(cp.role, 'user'),
  COALESCE(cp.created_at, now()),
  COALESCE(cp.updated_at, now())
FROM category_personnel cp
WHERE cp.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND NOT EXISTS (
    SELECT 1 FROM employee e
    WHERE e.uuid_id = cp.id::uuid
       OR lower(trim(coalesce(e.username, ''))) = lower(trim(coalesce(cp.username, '')))
       OR lower(trim(coalesce(e.employee_code, ''))) = lower(trim(coalesce(cp.metadata->>'employee_code', cp.metadata->>'employeeCode', '')))
  );

-- Nhân sự category_personnel có id không phải UUID (admin-001, pers-rriv-nttruc…)
INSERT INTO employee (
  uuid_id, employee_code, full_name, gender, phone_number, personal_email, company_email,
  national_id, status, hire_date,
  username, department_name, position_name, team_name, employment_status,
  disabled, account_locked, lock_until, app_roles_cache, metadata, erp_role,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'CP-' || left(cp.id, 20),
  COALESCE(cp.ho_ten, cp.username, 'Chưa đặt tên'),
  migrate_gender(cp.metadata, NULL),
  COALESCE(cp.phone, '0000000000'),
  cp.email, cp.email,
  migrate_national_id(cp.metadata, cp.id),
  migrate_employee_status_enum(cp.status)::employee_status,
  COALESCE(cp.created_at::date, CURRENT_DATE),
  cp.username,
  cp.department, cp.position, cp.team,
  CASE WHEN cp.disabled OR lower(coalesce(cp.status, '')) IN ('inactive', 'resigned') THEN 'resigned' ELSE 'active' END,
  COALESCE(cp.disabled, false), COALESCE(cp.account_locked, false), cp.lock_until,
  COALESCE(cp.app_roles_cache, '{}'::jsonb),
  COALESCE(cp.metadata, '{}'::jsonb) || jsonb_build_object('migrated_from', 'category_personnel', 'legacy_personnel_id', cp.id),
  COALESCE(cp.role, 'user'),
  COALESCE(cp.created_at, now()), COALESCE(cp.updated_at, now())
FROM category_personnel cp
WHERE cp.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND NOT EXISTS (
    SELECT 1 FROM employee e
    WHERE lower(trim(coalesce(e.username, ''))) = lower(trim(coalesce(cp.username, '')))
       OR (e.metadata->>'legacy_personnel_id') = cp.id
  );

-- Cập nhật employee đã tồn tại từ dữ liệu category_personnel
UPDATE employee e
SET
  username = COALESCE(e.username, cp.username),
  department_name = COALESCE(e.department_name, cp.department),
  position_name = COALESCE(e.position_name, cp.position),
  team_name = COALESCE(e.team_name, cp.team),
  phone_number = COALESCE(e.phone_number, cp.phone),
  company_email = COALESCE(e.company_email, cp.email),
  personal_email = COALESCE(e.personal_email, cp.email),
  app_roles_cache = CASE
    WHEN cp.app_roles_cache IS NOT NULL AND cp.app_roles_cache <> '{}'::jsonb THEN cp.app_roles_cache
    ELSE e.app_roles_cache
  END,
  erp_role = COALESCE(NULLIF(cp.role, ''), e.erp_role),
  disabled = COALESCE(cp.disabled, e.disabled),
  account_locked = COALESCE(cp.account_locked, e.account_locked),
  lock_until = COALESCE(cp.lock_until, e.lock_until),
  metadata = e.metadata || jsonb_build_object('synced_from_category_personnel', cp.id),
  updated_at = now()
FROM category_personnel cp
WHERE (
    cp.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND e.uuid_id = cp.id::uuid
  )
   OR (e.user_id IS NOT NULL AND e.user_id::text = cp.id)
   OR (
     e.username IS NOT NULL AND cp.username IS NOT NULL
     AND lower(trim(e.username)) = lower(trim(cp.username))
   );

-- Gắn user_accounts cho nhân sự mới import (chưa có employee_id)
UPDATE user_accounts ua
SET employee_id = e.uuid_id
FROM employee e
WHERE ua.employee_id IS NULL
  AND e.username IS NOT NULL
  AND lower(trim(ua.username)) = lower(trim(e.username));

-- -----------------------------------------------------------------------------
-- 6. Đổi PK: integer id → UUID (uuid_id)
--    Tạo bảng mới, copy, đổi tên (an toàn nhất)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_new (
  id                    UUID PRIMARY KEY,
  legacy_serial_id      BIGINT UNIQUE,
  employee_code         TEXT UNIQUE NOT NULL,
  full_name             TEXT NOT NULL,
  gender                TEXT,
  date_of_birth         DATE,
  phone_number          TEXT,
  personal_email        TEXT,
  company_email         TEXT,
  permanent_address     TEXT,
  current_address       TEXT,
  national_id           TEXT,
  username              TEXT UNIQUE,
  department_id         TEXT,
  position_id           TEXT,
  team_id               TEXT,
  department_name       TEXT,
  position_name         TEXT,
  team_name             TEXT,
  hire_date             DATE,
  conversion_date       DATE,
  termination_date      DATE,
  employment_type       TEXT,
  employment_status     TEXT NOT NULL DEFAULT 'active',
  base_salary           NUMERIC(15,2),
  tax_code              TEXT,
  bank_account_number   TEXT,
  bank_name             TEXT,
  disabled              BOOLEAN NOT NULL DEFAULT false,
  account_locked        BOOLEAN NOT NULL DEFAULT false,
  lock_until            TIMESTAMPTZ,
  erp_role              TEXT DEFAULT 'user',
  app_roles_cache       JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO employee_new (
  id, legacy_serial_id, employee_code, full_name, gender, date_of_birth,
  phone_number, personal_email, company_email, permanent_address, current_address,
  national_id, username, department_id, position_id, team_id,
  department_name, position_name, team_name,
  hire_date, conversion_date, termination_date,
  employment_type, employment_status,
  base_salary, tax_code, bank_account_number, bank_name,
  disabled, account_locked, lock_until, erp_role, app_roles_cache, metadata,
  created_at, updated_at
)
SELECT
  e.uuid_id,
  e.id,
  e.employee_code,
  e.full_name,
  e.gender,
  e.date_of_birth,
  e.phone_number,
  e.personal_email,
  e.company_email,
  e.permanent_address,
  e.current_address,
  e.national_id,
  e.username,
  e.department_id,
  e.position_id,
  e.team_id,
  e.department_name,
  e.position_name,
  e.team_name,
  e.hire_date,
  e.conversion_date,
  e.termination_date,
  e.employment_type,
  COALESCE(e.employment_status, 'active'),
  e.base_salary,
  e.tax_code,
  e.bank_account_number,
  e.bank_name,
  COALESCE(e.disabled, false),
  COALESCE(e.account_locked, false),
  e.lock_until,
  COALESCE(e.erp_role, 'user'),
  COALESCE(e.app_roles_cache, '{}'::jsonb),
  COALESCE(e.metadata, '{}'::jsonb) || jsonb_build_object(
    'legacy_user_id', e.user_id,
    'legacy_system_role_id', e.system_role_id
  ),
  COALESCE(e.created_at, now()),
  COALESCE(e.updated_at, now())
FROM employee e
ON CONFLICT (id) DO NOTHING;

-- Cập nhật FK user_accounts → employee_new.id (UUID)
UPDATE user_accounts ua
SET employee_id = en.id
FROM employee e
JOIN employee_new en ON en.legacy_serial_id = e.id
WHERE ua.employee_id IS NULL
  AND e.uuid_id IS NOT NULL;

UPDATE user_accounts ua
SET employee_id = en.id
FROM employee e
JOIN employee_new en ON en.id = e.uuid_id
WHERE (ua.employee_id IS NULL OR ua.employee_id = e.uuid_id)
  AND e.uuid_id IS NOT NULL;

-- Hoán đổi bảng
ALTER TABLE IF EXISTS employee RENAME TO employee_old_serial;
ALTER TABLE employee_new RENAME TO employee;

CREATE INDEX IF NOT EXISTS idx_employee_username ON employee(username);
CREATE INDEX IF NOT EXISTS idx_employee_employee_code ON employee(employee_code);
CREATE INDEX IF NOT EXISTS idx_employee_department_name ON employee(department_name);
CREATE INDEX IF NOT EXISTS idx_employee_team_name ON employee(team_name);
CREATE INDEX IF NOT EXISTS idx_employee_employment_status ON employee(employment_status);

DROP TRIGGER IF EXISTS trg_employee_updated ON employee;
CREATE TRIGGER trg_employee_updated
  BEFORE UPDATE ON employee
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- FK user_accounts.employee_id (UUID) → employee.id
ALTER TABLE user_accounts DROP CONSTRAINT IF EXISTS user_accounts_employee_id_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_accounts'
      AND column_name = 'employee_id'
      AND data_type = 'uuid'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_accounts_employee_id_fkey'
  ) THEN
    ALTER TABLE user_accounts
      ADD CONSTRAINT user_accounts_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES employee(id) ON DELETE SET NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7. VIEW tương thích category_personnel (app ERP cũ vẫn đọc được)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'category_personnel' AND table_type = 'BASE TABLE'
  ) THEN
    ALTER TABLE category_personnel RENAME TO category_personnel_table_legacy;
  END IF;
END $$;

DROP VIEW IF EXISTS category_personnel CASCADE;

CREATE OR REPLACE VIEW category_personnel AS
SELECT
  e.id::text AS id,
  e.username,
  e.full_name AS ho_ten,
  e.phone_number AS phone,
  COALESCE(e.company_email, e.personal_email) AS email,
  e.department_name AS department,
  e.position_name AS position,
  e.team_name AS team,
  COALESCE(e.erp_role, 'user') AS role,
  e.disabled,
  e.account_locked,
  e.lock_until,
  e.employment_status AS status,
  e.app_roles_cache,
  e.metadata,
  e.created_at,
  e.updated_at
FROM employee e;

-- Ghi qua view → employee (INSERT/UPDATE)
CREATE OR REPLACE FUNCTION category_personnel_view_upsert()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE employee SET employment_status = 'resigned', disabled = true, updated_at = now()
    WHERE id::text = OLD.id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO employee (
      id, username, full_name, phone_number, company_email,
      department_name, position_name, team_name, erp_role,
      disabled, account_locked, lock_until, employment_status,
      app_roles_cache, metadata
    ) VALUES (
      COALESCE(NULLIF(NEW.id, '')::uuid, gen_random_uuid()),
      NEW.username,
      NEW.ho_ten,
      NEW.phone,
      NEW.email,
      NEW.department,
      NEW.position,
      NEW.team,
      COALESCE(NEW.role, 'user'),
      COALESCE(NEW.disabled, false),
      COALESCE(NEW.account_locked, false),
      NEW.lock_until,
      COALESCE(NEW.status, 'active'),
      COALESCE(NEW.app_roles_cache, '{}'::jsonb),
      COALESCE(NEW.metadata, '{}'::jsonb)
    )
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      full_name = EXCLUDED.full_name,
      phone_number = EXCLUDED.phone_number,
      company_email = EXCLUDED.company_email,
      department_name = EXCLUDED.department_name,
      position_name = EXCLUDED.position_name,
      team_name = EXCLUDED.team_name,
      erp_role = EXCLUDED.erp_role,
      disabled = EXCLUDED.disabled,
      account_locked = EXCLUDED.account_locked,
      lock_until = EXCLUDED.lock_until,
      employment_status = EXCLUDED.employment_status,
      app_roles_cache = EXCLUDED.app_roles_cache,
      metadata = EXCLUDED.metadata,
      updated_at = now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    UPDATE employee SET
      username = NEW.username,
      full_name = NEW.ho_ten,
      phone_number = NEW.phone,
      company_email = NEW.email,
      department_name = NEW.department,
      position_name = NEW.position,
      team_name = NEW.team,
      erp_role = COALESCE(NEW.role, erp_role),
      disabled = COALESCE(NEW.disabled, disabled),
      account_locked = COALESCE(NEW.account_locked, account_locked),
      lock_until = NEW.lock_until,
      employment_status = COALESCE(NEW.status, employment_status),
      app_roles_cache = COALESCE(NEW.app_roles_cache, app_roles_cache),
      metadata = COALESCE(NEW.metadata, metadata),
      updated_at = now()
    WHERE id::text = NEW.id;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_category_personnel_insert ON category_personnel;
DROP TRIGGER IF EXISTS trg_category_personnel_update ON category_personnel;
DROP TRIGGER IF EXISTS trg_category_personnel_delete ON category_personnel;

CREATE TRIGGER trg_category_personnel_insert
  INSTEAD OF INSERT ON category_personnel
  FOR EACH ROW EXECUTE FUNCTION category_personnel_view_upsert();

CREATE TRIGGER trg_category_personnel_update
  INSTEAD OF UPDATE ON category_personnel
  FOR EACH ROW EXECUTE FUNCTION category_personnel_view_upsert();

CREATE TRIGGER trg_category_personnel_delete
  INSTEAD OF DELETE ON category_personnel
  FOR EACH ROW EXECUTE FUNCTION category_personnel_view_upsert();

-- -----------------------------------------------------------------------------
-- 8. VIEW đăng nhập — ưu tiên employee
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS user_login_view;

CREATE VIEW user_login_view AS
SELECT
  a.username,
  a.password,
  COALESCE(e.full_name, a.display_name, a.username) AS display_name,
  COALESCE(e.company_email, e.personal_email, a.email) AS email,
  e.id::text AS personnel_id,
  COALESCE(e.erp_role, a.role, 'user') AS role,
  COALESCE(e.department_name, a.department) AS department,
  e.position_name,
  e.app_roles_cache,
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
LEFT JOIN employee e ON e.id = a.employee_id;

GRANT SELECT ON user_login_view TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. (Tuỳ chọn) Cập nhật FK bảng con employee_assignment nếu đang trỏ id số
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employee_assignment'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_assignment' AND column_name = 'employee_id'
  ) THEN
    -- Nếu employee_id là BIGINT, thêm cột uuid và map
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'employee_assignment'
        AND column_name = 'employee_id' AND data_type IN ('bigint', 'integer')
    ) THEN
      ALTER TABLE employee_assignment ADD COLUMN IF NOT EXISTS employee_uuid UUID;
      UPDATE employee_assignment ea
      SET employee_uuid = e.id
      FROM employee e
      WHERE e.legacy_serial_id = ea.employee_id AND ea.employee_uuid IS NULL;
      -- Sau khi kiểm tra dữ liệu, có thể: ALTER TABLE employee_assignment DROP COLUMN employee_id;
      -- ALTER TABLE employee_assignment RENAME COLUMN employee_uuid TO employee_id;
    END IF;
  END IF;
END $$;

COMMIT;

-- -----------------------------------------------------------------------------
-- 10. Kiểm tra sau migrate (chạy riêng)
-- -----------------------------------------------------------------------------
-- SELECT id, employee_code, full_name, username, department_name, employment_status FROM employee ORDER BY employee_code;
-- SELECT username, employee_id FROM user_accounts WHERE employee_id IS NOT NULL;
-- SELECT * FROM category_personnel LIMIT 10;
-- SELECT username, personnel_id, display_name, department FROM user_login_view LIMIT 10;
