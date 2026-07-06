-- Gộp schema Phòng họp — chạy một lần trên Supabase SQL Editor

-- ========== schema-meetings.sql ==========
-- =============================================================================
-- RRIV ERP — Module Phòng họp (phonghop)
-- Chạy SAU: schema.sql, schema-rbac.sql, migrate-employee-master.sql,
--           migrate-role-definitions-erp.sql
--
-- Phase 1: internal (Firebase Realtime DB) + quản lý phòng vật lý
-- Phase 2: meeting_platform_credentials (Zoom / Google Meet OAuth)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -----------------------------------------------------------------------------
-- 0. ENUM / LOOKUP
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE meeting_mode AS ENUM ('in_person', 'online', 'hybrid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE meeting_platform AS ENUM ('internal', 'zoom', 'google_meet');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE meeting_status AS ENUM (
    'draft', 'scheduled', 'live', 'completed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE meeting_participant_role AS ENUM (
    'organizer', 'host', 'participant', 'observer'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE meeting_participant_role ADD VALUE 'secretary';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE meeting_rsvp_status AS ENUM (
    'pending', 'accepted', 'declined', 'tentative'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE meeting_platform_credential_type AS ENUM ('zoom', 'google_meet');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 1. PHÒNG HỌP VẬT LÝ
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_rooms (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  room_code       TEXT NOT NULL,
  name            TEXT NOT NULL,
  location        TEXT,
  floor           TEXT,
  building        TEXT,
  capacity        INT CHECK (capacity IS NULL OR capacity > 0),
  equipment       JSONB NOT NULL DEFAULT '{}'::jsonb,
  department_id   TEXT REFERENCES category_departments(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by      TEXT REFERENCES user_accounts(username) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_meeting_rooms_room_code UNIQUE (room_code)
);

CREATE INDEX IF NOT EXISTS idx_meeting_rooms_active
  ON meeting_rooms (is_active, name);
CREATE INDEX IF NOT EXISTS idx_meeting_rooms_department
  ON meeting_rooms (department_id)
  WHERE department_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. CUỘC HỌP (metadata — System of Record)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meetings (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_code            TEXT,
  title                   TEXT NOT NULL,
  description             TEXT,
  meeting_mode            meeting_mode NOT NULL DEFAULT 'hybrid',
  platform_type           meeting_platform NOT NULL DEFAULT 'internal',
  status                  meeting_status NOT NULL DEFAULT 'draft',
  scheduled_start         TIMESTAMPTZ NOT NULL,
  scheduled_end           TIMESTAMPTZ NOT NULL,
  actual_start            TIMESTAMPTZ,
  actual_end              TIMESTAMPTZ,
  physical_room_id        TEXT REFERENCES meeting_rooms(id) ON DELETE SET NULL,
  organizer_employee_id   UUID REFERENCES employee(id) ON DELETE SET NULL,
  created_by_username     TEXT REFERENCES user_accounts(username) ON DELETE SET NULL,
  department_id           TEXT REFERENCES category_departments(id) ON DELETE SET NULL,
  online_meeting_url      TEXT,
  online_meeting_id       TEXT,
  online_meeting_password TEXT,
  firebase_room_id        TEXT,
  recurrence_rule         JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_meetings_meeting_code UNIQUE (meeting_code),
  CONSTRAINT uq_meetings_firebase_room_id UNIQUE (firebase_room_id),
  CONSTRAINT chk_meetings_schedule_range
    CHECK (scheduled_end > scheduled_start),
  CONSTRAINT chk_meetings_actual_range
    CHECK (
      actual_start IS NULL
      OR actual_end IS NULL
      OR actual_end >= actual_start
    ),
  CONSTRAINT chk_meetings_hybrid_room
    CHECK (
      meeting_mode = 'online'
      OR physical_room_id IS NOT NULL
      OR status IN ('draft', 'cancelled')
    )
);

CREATE INDEX IF NOT EXISTS idx_meetings_status_start
  ON meetings (status, scheduled_start DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_organizer
  ON meetings (organizer_employee_id)
  WHERE organizer_employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_department
  ON meetings (department_id, scheduled_start DESC)
  WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_physical_room
  ON meetings (physical_room_id, scheduled_start, scheduled_end)
  WHERE physical_room_id IS NOT NULL
    AND status NOT IN ('cancelled', 'draft');
CREATE INDEX IF NOT EXISTS idx_meetings_firebase_room
  ON meetings (firebase_room_id)
  WHERE firebase_room_id IS NOT NULL;

-- Chặn trùng lịch phòng vật lý (PostgreSQL exclusion constraint)
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_no_room_overlap;
ALTER TABLE meetings ADD CONSTRAINT meetings_no_room_overlap
  EXCLUDE USING gist (
    physical_room_id WITH =,
    tstzrange(scheduled_start, scheduled_end, '[)') WITH &&
  )
  WHERE (
    physical_room_id IS NOT NULL
    AND status NOT IN ('cancelled', 'draft')
  );

-- -----------------------------------------------------------------------------
-- 3. NGƯỜI THAM DỰ (liên kết employee / user_accounts)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_participants (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_id          TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  employee_id         UUID REFERENCES employee(id) ON DELETE SET NULL,
  username            TEXT REFERENCES user_accounts(username) ON DELETE SET NULL,
  participant_role    meeting_participant_role NOT NULL DEFAULT 'participant',
  rsvp_status         meeting_rsvp_status NOT NULL DEFAULT 'pending',
  is_external         BOOLEAN NOT NULL DEFAULT false,
  external_name       TEXT,
  external_email      TEXT,
  invited_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at        TIMESTAMPTZ,
  joined_at           TIMESTAMPTZ,
  left_at             TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_meeting_participants_identity CHECK (
    (is_external = false AND (employee_id IS NOT NULL OR username IS NOT NULL))
    OR (is_external = true AND external_email IS NOT NULL)
  ),
  CONSTRAINT chk_meeting_participants_external_email CHECK (
    is_external = false OR external_email IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_participants_employee
  ON meeting_participants (meeting_id, employee_id)
  WHERE employee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_participants_username
  ON meeting_participants (meeting_id, lower(username))
  WHERE username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_participants_external_email
  ON meeting_participants (meeting_id, lower(external_email))
  WHERE is_external = true AND external_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting
  ON meeting_participants (meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_employee_lookup
  ON meeting_participants (employee_id)
  WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_participants_username_lookup
  ON meeting_participants (lower(username))
  WHERE username IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. CHƯƠNG TRÌNH HỌP (tùy chọn)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_agenda_items (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_id              TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  sort_order              INT NOT NULL DEFAULT 0,
  title                   TEXT NOT NULL,
  duration_minutes        INT CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  presenter_employee_id   UUID REFERENCES employee(id) ON DELETE SET NULL,
  notes                   TEXT,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_agenda_items_meeting
  ON meeting_agenda_items (meeting_id, sort_order);

-- -----------------------------------------------------------------------------
-- 5. OAuth credentials (Phase 2 — Zoom / Google Meet)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_platform_credentials (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  platform_type       meeting_platform_credential_type NOT NULL,
  account_email       TEXT NOT NULL,
  access_token_enc    TEXT,
  refresh_token_enc   TEXT,
  expires_at          TIMESTAMPTZ,
  created_by_username TEXT REFERENCES user_accounts(username) ON DELETE SET NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_platform_credentials_account
  ON meeting_platform_credentials (platform_type, lower(account_email));

CREATE INDEX IF NOT EXISTS idx_meeting_platform_credentials_active
  ON meeting_platform_credentials (platform_type, is_active);

-- -----------------------------------------------------------------------------
-- 6. AUDIT đồng bộ Firebase Realtime DB → Supabase
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_sync_log (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_id  TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  sync_type   TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_sync_log_meeting
  ON meeting_sync_log (meeting_id, synced_at DESC);

-- -----------------------------------------------------------------------------
-- 7. TRIGGER updated_at (dùng set_updated_at() nếu đã có từ migrate-employee-master)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_meeting_rooms_updated_at ON meeting_rooms;
CREATE TRIGGER trg_meeting_rooms_updated_at
  BEFORE UPDATE ON meeting_rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_meetings_updated_at ON meetings;
CREATE TRIGGER trg_meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_meeting_participants_updated_at ON meeting_participants;
CREATE TRIGGER trg_meeting_participants_updated_at
  BEFORE UPDATE ON meeting_participants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_meeting_agenda_items_updated_at ON meeting_agenda_items;
CREATE TRIGGER trg_meeting_agenda_items_updated_at
  BEFORE UPDATE ON meeting_agenda_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_meeting_platform_credentials_updated_at ON meeting_platform_credentials;
CREATE TRIGGER trg_meeting_platform_credentials_updated_at
  BEFORE UPDATE ON meeting_platform_credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- 8. VIEW — kiểm tra quyền truy cập & lịch phòng
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_meeting_participant_access AS
SELECT
  mp.id AS participant_row_id,
  mp.meeting_id,
  m.meeting_code,
  m.title,
  m.status AS meeting_status,
  m.scheduled_start,
  m.scheduled_end,
  m.firebase_room_id,
  mp.employee_id,
  mp.username,
  lower(trim(mp.username)) AS username_norm,
  mp.participant_role,
  mp.rsvp_status,
  mp.is_external,
  mp.external_email,
  e.full_name AS employee_full_name,
  e.department_id AS employee_department_id
FROM meeting_participants mp
JOIN meetings m ON m.id = mp.meeting_id
LEFT JOIN employee e ON e.id = mp.employee_id;

CREATE OR REPLACE VIEW v_meeting_room_schedule AS
SELECT
  m.id AS meeting_id,
  m.meeting_code,
  m.title,
  m.status,
  m.meeting_mode,
  m.platform_type,
  m.scheduled_start,
  m.scheduled_end,
  m.physical_room_id,
  mr.room_code,
  mr.name AS room_name,
  mr.capacity,
  m.organizer_employee_id,
  e.full_name AS organizer_name,
  m.department_id
FROM meetings m
JOIN meeting_rooms mr ON mr.id = m.physical_room_id
LEFT JOIN employee e ON e.id = m.organizer_employee_id
WHERE m.status NOT IN ('cancelled', 'draft')
ORDER BY m.scheduled_start;

-- -----------------------------------------------------------------------------
-- 9. GRANTS (Supabase API / service role)
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_rooms TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON meetings TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_participants TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_agenda_items TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_platform_credentials TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_sync_log TO anon, authenticated, service_role;
GRANT SELECT ON v_meeting_participant_access TO anon, authenticated, service_role;
GRANT SELECT ON v_meeting_room_schedule TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. SEED phòng họp mẫu (tùy chọn — có thể xóa sau khi nhập dữ liệu thật)
-- -----------------------------------------------------------------------------
INSERT INTO meeting_rooms (room_code, name, location, building, floor, capacity, equipment, notes)
VALUES
  (
    'PH-H001',
    'Phòng họp Hội trường',
    'Tầng trệt — Viện NC Cao su',
    'Tòa chính',
    'Tầng trệt',
    80,
    '{"projector": true, "microphone": true, "video_conference": true, "whiteboard": true}'::jsonb,
    'Phòng lớn — họp toàn Viện'
  ),
  (
    'PH-A101',
    'Phòng họp A101',
    'Tầng 1 — Viện NC Cao su',
    'Tòa A',
    'Tầng 1',
    20,
    '{"projector": true, "microphone": true, "video_conference": true}'::jsonb,
    'Phòng họp phòng ban'
  ),
  (
    'PH-A102',
    'Phòng họp A102',
    'Tầng 1 — Viện NC Cao su',
    'Tòa A',
    'Tầng 1',
    12,
    '{"projector": true, "whiteboard": true}'::jsonb,
    'Phòng họp nhỏ'
  )
ON CONFLICT (room_code) DO NOTHING;


-- ========== patch-meeting-documents-20260701.sql ==========
-- Kho tài liệu cuộc họp (Cold Storage — Supabase)
-- Chạy sau schema-meetings.sql
-- Bucket Storage (tạo trên Dashboard): meeting-docs (private)

DO $$ BEGIN
  CREATE TYPE meeting_doc_kind AS ENUM ('folder', 'file');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE meeting_doc_warm_status AS ENUM (
    'pending', 'warming', 'ready', 'failed', 'archived', 'purged'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS meeting_documents (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_id          TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  parent_id           TEXT REFERENCES meeting_documents(id) ON DELETE CASCADE,
  kind                meeting_doc_kind NOT NULL DEFAULT 'file',
  name                TEXT NOT NULL,
  storage_backend     TEXT NOT NULL DEFAULT 'supabase',
  storage_path        TEXT,
  firebase_path       TEXT,
  mime_type           TEXT,
  file_size           BIGINT CHECK (file_size IS NULL OR file_size >= 0),
  warm_status         meeting_doc_warm_status NOT NULL DEFAULT 'pending',
  warm_error          TEXT,
  warmed_at           TIMESTAMPTZ,
  archived_at         TIMESTAMPTZ,
  sort_order          INT NOT NULL DEFAULT 0,
  created_by_username TEXT REFERENCES user_accounts(username) ON DELETE SET NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_meeting_documents_folder_no_path
    CHECK (kind <> 'folder' OR (storage_path IS NULL AND file_size IS NULL)),
  CONSTRAINT chk_meeting_documents_file_path
    CHECK (kind <> 'file' OR storage_path IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_meeting_documents_meeting
  ON meeting_documents (meeting_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_meeting_documents_warm
  ON meeting_documents (meeting_id, warm_status)
  WHERE kind = 'file';

DROP TRIGGER IF EXISTS trg_meeting_documents_updated_at ON meeting_documents;
CREATE TRIGGER trg_meeting_documents_updated_at
  BEFORE UPDATE ON meeting_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_documents TO anon, authenticated, service_role;


-- ========== patch-meeting-document-shares-20260702.sql ==========
-- Chia sẻ tài liệu cuộc họp — chỉ mục được tick mới xem được (người tham dự)
-- Chạy sau patch-meeting-documents-20260701.sql

CREATE TABLE IF NOT EXISTS meeting_document_shares (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_id          TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  document_id         TEXT NOT NULL REFERENCES meeting_documents(id) ON DELETE CASCADE,
  shared_by_username  TEXT REFERENCES user_accounts(username) ON DELETE SET NULL,
  shared_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_meeting_document_share UNIQUE (meeting_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_document_shares_meeting
  ON meeting_document_shares (meeting_id);

CREATE INDEX IF NOT EXISTS idx_meeting_document_shares_document
  ON meeting_document_shares (document_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_document_shares TO anon, authenticated, service_role;


-- ========== seed-phonghop-rbac.sql ==========
-- =============================================================================
-- RRIV ERP — Seed RBAC app Phòng họp (phonghop)
-- Chạy SAU: migrate-role-definitions-erp.sql, schema-meetings.sql
--
-- Hoặc chạy: python scripts/seed_role_definitions.py
--            (sau khi cập nhật data/role-definitions-seed.json)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Đăng ký app trên Hub / ma trận phân quyền
-- hub_enabled = true — hiển thị trên màn hình Hub
-- -----------------------------------------------------------------------------
INSERT INTO app_registry (
  app_id, name, scope_type, hub_enabled, assignable, sort_order, metadata
) VALUES (
  'phonghop',
  'Phòng họp',
  'department',
  true,
  true,
  25,
  '{"module": "meetings", "features": ["internal", "hybrid", "physical_rooms"]}'::jsonb
)
ON CONFLICT (app_id) DO UPDATE SET
  name        = EXCLUDED.name,
  scope_type  = EXCLUDED.scope_type,
  assignable  = EXCLUDED.assignable,
  sort_order  = EXCLUDED.sort_order,
  metadata    = app_registry.metadata || EXCLUDED.metadata,
  updated_at  = now();

-- -----------------------------------------------------------------------------
-- 2. Role definitions — permissions JSONB array
-- Quy tắc nghiệp vụ:
--   meeting:create  → admin, manager (tầng app)
--   meeting:view    → participant check bổ sung ở API (meeting_participants)
-- -----------------------------------------------------------------------------
INSERT INTO role_definitions (
  id, role_id, name, permissions, metadata,
  app_id, role_name, description, is_active, scope_type, scopeable, sort_order, updated_at
) VALUES
  (
    'phonghop_admin',
    'phonghop_admin',
    'Quản trị app',
    '["meeting:*", "room:*"]'::jsonb,
    jsonb_build_object(
      'app_id', 'phonghop', 'role_id', 'admin',
      'role_name', 'Quản trị app',
      'description', 'Toàn quyền phòng họp & quản lý phòng vật lý',
      'scope_type', 'all', 'sort_order', 10, 'is_active', true,
      'permissions', '["meeting:*", "room:*"]'::jsonb
    ),
    'phonghop', 'Quản trị app',
    'Toàn quyền phòng họp & quản lý phòng vật lý',
    true, 'all', '{}'::jsonb, 10, now()
  ),
  (
    'phonghop_manager',
    'phonghop_manager',
    'Quản lý phòng',
    '["meeting:create", "meeting:edit", "meeting:cancel", "meeting:view", "meeting:join", "room:view", "room:book"]'::jsonb,
    jsonb_build_object(
      'app_id', 'phonghop', 'role_id', 'manager',
      'role_name', 'Quản lý phòng',
      'description', 'Tạo & quản lý cuộc họp trong phạm vi phòng ban',
      'scope_type', 'department', 'sort_order', 20, 'is_active', true,
      'scopeable', '{"byDepartment": true}'::jsonb,
      'permissions', '["meeting:create", "meeting:edit", "meeting:cancel", "meeting:view", "meeting:join", "room:view", "room:book"]'::jsonb
    ),
    'phonghop', 'Quản lý phòng',
    'Tạo & quản lý cuộc họp trong phạm vi phòng ban',
    true, 'department', '{"byDepartment": true}'::jsonb, 20, now()
  ),
  (
    'phonghop_staff',
    'phonghop_staff',
    'Nhân viên',
    '["meeting:view", "meeting:join", "room:view"]'::jsonb,
    jsonb_build_object(
      'app_id', 'phonghop', 'role_id', 'staff',
      'role_name', 'Nhân viên',
      'description', 'Tham gia cuộc họp được mời — không tạo cuộc họp mới',
      'scope_type', 'department', 'sort_order', 30, 'is_active', true,
      'scopeable', '{"byDepartment": true}'::jsonb,
      'permissions', '["meeting:view", "meeting:join", "room:view"]'::jsonb
    ),
    'phonghop', 'Nhân viên',
    'Tham gia cuộc họp được mời — không tạo cuộc họp mới',
    true, 'department', '{"byDepartment": true}'::jsonb, 30, now()
  ),
  (
    'phonghop_viewer',
    'phonghop_viewer',
    'Chỉ xem',
    '["meeting:view", "room:view"]'::jsonb,
    jsonb_build_object(
      'app_id', 'phonghop', 'role_id', 'viewer',
      'role_name', 'Chỉ xem',
      'description', 'Xem lịch phòng & cuộc họp được mời',
      'scope_type', 'department', 'sort_order', 40, 'is_active', true,
      'scopeable', '{"byDepartment": true}'::jsonb,
      'permissions', '["meeting:view", "room:view"]'::jsonb
    ),
    'phonghop', 'Chỉ xem',
    'Xem lịch phòng & cuộc họp được mời',
    true, 'department', '{"byDepartment": true}'::jsonb, 40, now()
  )
ON CONFLICT (id) DO UPDATE SET
  role_id     = EXCLUDED.role_id,
  name        = EXCLUDED.name,
  permissions = EXCLUDED.permissions,
  metadata    = EXCLUDED.metadata,
  app_id      = EXCLUDED.app_id,
  role_name   = EXCLUDED.role_name,
  description = EXCLUDED.description,
  is_active   = EXCLUDED.is_active,
  scope_type  = EXCLUDED.scope_type,
  scopeable   = EXCLUDED.scopeable,
  sort_order  = EXCLUDED.sort_order,
  updated_at  = now();

-- Đồng bộ unique index (app_id, role_id) nếu cột role_id doc-style
UPDATE role_definitions
SET role_id = app_id || '_' || (metadata->>'role_id')
WHERE app_id = 'phonghop'
  AND metadata->>'role_id' IS NOT NULL
  AND role_id NOT LIKE 'phonghop_%';


-- ========== patch-phonghop-hub-enabled.sql ==========
-- Bật app Phòng họp trên Hub (chạy một lần nếu đã seed trước đó với hub_enabled = false)
UPDATE app_registry
SET hub_enabled = true, updated_at = now()
WHERE app_id = 'phonghop';

