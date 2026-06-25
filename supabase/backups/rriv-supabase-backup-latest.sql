-- ============================================================
-- RRIV-ERP — BACKUP SUPABASE (schema + seed)
-- Ngày tạo: 2026-06-11
-- Dùng: Supabase → SQL Editor → dán/chạy toàn bộ (DB mới)
-- Hoặc lưu file này về máy làm bản sao an toàn.
-- ============================================================

-- PHẦN 1: SCHEMA

-- ========== schema.sql ==========
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

-- ========== schema-harvest-production.sql ==========
-- RRIV ERP — Sản lượng (vuoncay) + Sản xuất (sanxuat)
-- Chạy SAU schema.sql. Giữ erp_collections cho migrate dần; bảng dưới là mô hình chuẩn.
--
-- Luồng nghiệp vụ (Viện — nhập tay, KHÔNG bắt buộc ZEN):
--   field_worker_weighings (cân CN + TSC tại vườn, theo phần cạo)
--     → truck_trip_sections (ghép phần cạo lên xe)
--     → factory_truck_weighings (cân xe + TSC tại NM)
--     → section_factory_allocations (quy trả SL kho về từng phần cạo)
--   Mỗi phần cạo có 2 số liệu: sl_ban_dau (vườn) và sl_quy_tra (NM)
--
-- Luồng nhà máy (sanxuat):
--   factory_receipts / factory_truck_weighings
--     → blending_batches → production_batches → production_line_records
--     → quality_tests, warehouse_items → rubber_deliveries
--
-- ZEN API (tùy chọn, Phước Hòa): harvest_records record_type = vehicle_zen

-- ============================================================
-- 0. ENUM / LOOKUP
-- ============================================================
DO $$ BEGIN
  CREATE TYPE harvest_record_type AS ENUM ('team_daily', 'vehicle_zen', 'vehicle_purchase');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE material_type AS ENUM ('latex', 'misc', 'coagulum');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 1. VƯỜN / LÔ (vuoncay + sanxuat)
-- ============================================================

-- Lô polygon trên bản đồ (collection RubberLots — vuoncay)
CREATE TABLE IF NOT EXISTS rubber_lots (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lot_code      TEXT,
  squad         TEXT,                    -- đội SX (mapPlots.squad)
  area_ha       NUMERIC(12,4),
  geometry      JSONB,                   -- GeoJSON Feature hoặc ref file
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rubber_lots_squad ON rubber_lots(squad);

-- Vườn cây EUDR / chủ vườn (collection rubberGardens — sanxuat tab Giao hàng)
CREATE TABLE IF NOT EXISTS rubber_gardens (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code          TEXT,
  owner_name    TEXT,
  owner_phone   TEXT,
  area          NUMERIC(12,4),
  address       TEXT,
  location_lat  NUMERIC(10,7),
  location_lng  NUMERIC(10,7),
  eudr_status   TEXT DEFAULT 'pending',  -- compliant | pending | non-compliant
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rubber_gardens_code ON rubber_gardens(code) WHERE code IS NOT NULL;

-- GeoJSON metadata (app_settings.gardenGeoJson)
-- Lưu trong system_settings key = 'garden_geojson' HOẶC Supabase Storage + URL trong metadata

-- ============================================================
-- 2. SẢN LƯỢNG — harvestData (HAI mức trong cùng collection Firestore)
-- ============================================================
-- team_daily:    Excel vuoncay — 1 dòng/đội/ngày (donVi, muNuoc, drc, tongQKho)
-- vehicle_zen:   ZEN sync — 1 dòng/xe/ngày (soXe, soCt, zenDvcs, muChen, muDay...)
-- vehicle_purchase: source = ZEN_PURCHASE (báo cáo, không vào NM)

CREATE TABLE IF NOT EXISTS harvest_records (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  record_type     harvest_record_type NOT NULL DEFAULT 'team_daily',

  -- Thời gian
  import_date     DATE NOT NULL,           -- harvestData.importDate
  month           TEXT,                    -- YYYY-MM

  -- Đơn vị / nông trường
  don_vi          TEXT,                    -- đội SX hoặc tên nông trường (plantation)
  department_id   TEXT REFERENCES category_departments(id),

  -- Xe ZEN (chỉ vehicle_*)
  so_ct           TEXT,                    -- số chứng từ ZEN — dedupe reception
  so_xe           TEXT,
  zen_dvcs        TEXT,                    -- nhà máy đích: A02, ALL...

  -- Khối lượng mủ nước
  mu_nuoc         NUMERIC(14,3) DEFAULT 0,
  drc             NUMERIC(8,3) DEFAULT 0,
  qk_mu_nuoc      NUMERIC(14,3) DEFAULT 0,

  -- Mủ chén / dây / đông (ZEN vehicle)
  mu_chen         NUMERIC(14,3) DEFAULT 0,
  qk_mu_chen      NUMERIC(14,3) DEFAULT 0,
  mu_day          NUMERIC(14,3) DEFAULT 0,
  qk_mu_day       NUMERIC(14,3) DEFAULT 0,
  mu_dong         NUMERIC(14,3) DEFAULT 0,
  qk_mu_dong      NUMERIC(14,3) DEFAULT 0,
  tong_q_kho      NUMERIC(14,3) DEFAULT 0,

  -- Nguồn
  source          TEXT,                    -- EXCEL | ZEN | ZEN_PURCHASE
  imported_by     TEXT REFERENCES category_personnel(id),
  is_overwritten  BOOLEAN DEFAULT false,
  assigned_to     TEXT,                    -- hồ phối liệu đã gán

  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- team_daily: 1 dòng / đội / ngày
CREATE UNIQUE INDEX IF NOT EXISTS uq_harvest_team_daily
  ON harvest_records(import_date, don_vi)
  WHERE record_type = 'team_daily';

-- vehicle ZEN: 1 dòng / chứng từ / ngày / nhà máy
CREATE UNIQUE INDEX IF NOT EXISTS uq_harvest_vehicle_zen
  ON harvest_records(import_date, so_ct, zen_dvcs)
  WHERE record_type IN ('vehicle_zen', 'vehicle_purchase') AND so_ct IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_harvest_date ON harvest_records(import_date);
CREATE INDEX IF NOT EXISTS idx_harvest_month ON harvest_records(month);
CREATE INDEX IF NOT EXISTS idx_harvest_don_vi ON harvest_records(don_vi);
CREATE INDEX IF NOT EXISTS idx_harvest_type_date ON harvest_records(record_type, import_date);
CREATE INDEX IF NOT EXISTS idx_harvest_zen_dvcs ON harvest_records(zen_dvcs) WHERE zen_dvcs IS NOT NULL;

-- Kế hoạch sản lượng (harvestPlans)
CREATE TABLE IF NOT EXISTS harvest_plans (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plan_type     TEXT NOT NULL,             -- yearly | monthly | corporate
  don_vi        TEXT,
  year          INT,
  month         INT,
  kh_thang      NUMERIC(14,3),             -- tấn
  kh_nam        NUMERIC(14,3),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_harvest_plans_lookup ON harvest_plans(plan_type, don_vi, year, month);

-- Quỹ trả (quiTraData)
CREATE TABLE IF NOT EXISTS qui_tra_records (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ma_kh         TEXT,
  team_name     TEXT,
  year          INT NOT NULL,
  month         INT NOT NULL,
  amount        NUMERIC(14,3) DEFAULT 0,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qui_tra_period ON qui_tra_records(year, month, team_name);

-- ============================================================
-- 2B. LUỒNG VIỆN — Cân vườn → xe → NM → quy trả (nhập tay)
-- ============================================================
-- Quan hệ phần cạo ↔ công nhân: N-N theo ngày
--   • Thường: 1 phần cạo = 1 CN
--   • Cạo đúp: 1 CN → 2 phần cạo (2 dòng phân công / 2 dòng cân)
--   • Hỗ trợ: 1 phần cạo → 2 CN (2 dòng phân công / 2 dòng cân)
-- Khóa nghiệp vụ cân vườn: (record_date, tapping_section_id, worker_id, session_no)
--
-- Loại mủ (cột sẵn, nhập khi có):
--   latex  — mủ nước (TSC%)
--   coag   — mủ đông / bóc chén (DRC% ước lượng)
--   cord   — mủ dây (DRC% ước lượng)
--   other  — mủ khác (DRC% ước lượng)

-- Phần cạo (master — không gắn cứng 1 công nhân)
CREATE TABLE IF NOT EXISTS tapping_sections (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  section_code        TEXT NOT NULL,
  lot_id              TEXT REFERENCES rubber_lots(id),
  team_id             TEXT,
  squad               TEXT,
  active              BOOLEAN DEFAULT true,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tapping_sections_code ON tapping_sections(section_code);
CREATE INDEX IF NOT EXISTS idx_tapping_sections_team ON tapping_sections(team_id);

-- Phân công CN ↔ phần cạo theo ngày (N-N)
CREATE TABLE IF NOT EXISTS section_worker_assignments (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  record_date         DATE NOT NULL,
  tapping_section_id  TEXT NOT NULL REFERENCES tapping_sections(id),
  worker_id           TEXT NOT NULL REFERENCES category_personnel(id),
  assignment_role     TEXT DEFAULT 'primary',  -- primary | helper | double_tap
  notes               TEXT,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (record_date, tapping_section_id, worker_id)
);
CREATE INDEX IF NOT EXISTS idx_swa_worker_date ON section_worker_assignments(worker_id, record_date);
CREATE INDEX IF NOT EXISTS idx_swa_section_date ON section_worker_assignments(tapping_section_id, record_date);

-- Bước 1: Cân tại vườn — khóa (ngày + phần cạo + công nhân + phiên)
CREATE TABLE IF NOT EXISTS field_worker_weighings (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  record_date         DATE NOT NULL,
  tapping_section_id  TEXT NOT NULL REFERENCES tapping_sections(id),
  worker_id           TEXT NOT NULL REFERENCES category_personnel(id),
  session_no          INT NOT NULL DEFAULT 1,

  -- Mủ nước (latex): đo TSC → tra bảng → DRC; quy_kho = fresh × DRC/100
  latex_fresh_kg      NUMERIC(14,3) DEFAULT 0,
  latex_tsc_pct       NUMERIC(8,3),
  latex_drc_pct       NUMERIC(8,3),
  latex_dry_kg        NUMERIC(14,3),

  -- Mủ đông: TSC → DRC (bảng riêng material_type=coagulum)
  coag_fresh_kg       NUMERIC(14,3) DEFAULT 0,
  coag_tsc_pct        NUMERIC(8,3),
  coag_drc_pct        NUMERIC(8,3),
  coag_dry_kg         NUMERIC(14,3),

  -- Mủ dây
  cord_fresh_kg       NUMERIC(14,3) DEFAULT 0,
  cord_drc_pct        NUMERIC(8,3),
  cord_dry_kg         NUMERIC(14,3),

  -- Mủ khác
  other_fresh_kg      NUMERIC(14,3) DEFAULT 0,
  other_drc_pct       NUMERIC(8,3),
  other_dry_kg        NUMERIC(14,3),

  -- Tổng (có thể tính app hoặc trigger; lưu sẵn để query nhanh)
  total_fresh_kg      NUMERIC(14,3) DEFAULT 0,
  total_dry_kg        NUMERIC(14,3) DEFAULT 0,

  is_rainy            BOOLEAN DEFAULT false,
  has_stimulant       BOOLEAN DEFAULT false,
  notes               TEXT,
  created_by          TEXT REFERENCES category_personnel(id),
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),

  UNIQUE (record_date, tapping_section_id, worker_id, session_no)
);
CREATE INDEX IF NOT EXISTS idx_field_weigh_date ON field_worker_weighings(record_date);
CREATE INDEX IF NOT EXISTS idx_field_weigh_section ON field_worker_weighings(tapping_section_id, record_date);
CREATE INDEX IF NOT EXISTS idx_field_weigh_worker ON field_worker_weighings(worker_id, record_date);

-- SL ban đầu theo (phần cạo + công nhân + ngày)
CREATE OR REPLACE VIEW v_worker_section_field_totals AS
SELECT
  record_date,
  tapping_section_id,
  worker_id,
  SUM(latex_fresh_kg)  AS latex_fresh_kg,
  SUM(coag_fresh_kg)   AS coag_fresh_kg,
  SUM(cord_fresh_kg)   AS cord_fresh_kg,
  SUM(other_fresh_kg)  AS other_fresh_kg,
  SUM(total_fresh_kg)  AS total_fresh_kg,
  SUM(latex_dry_kg)    AS latex_dry_kg,
  SUM(coag_dry_kg)     AS coag_dry_kg,
  SUM(cord_dry_kg)     AS cord_dry_kg,
  SUM(other_dry_kg)    AS other_dry_kg,
  SUM(total_dry_kg)    AS total_dry_kg,
  CASE WHEN SUM(latex_fresh_kg) > 0
    THEN SUM(latex_fresh_kg * COALESCE(latex_tsc_pct, 0)) / SUM(latex_fresh_kg)
    ELSE NULL END AS latex_tsc_pct_avg
FROM field_worker_weighings
GROUP BY record_date, tapping_section_id, worker_id;

-- Tổng SL ban đầu theo phần cạo/ngày (gộp mọi CN trên phần cạo)
CREATE OR REPLACE VIEW v_section_field_totals AS
SELECT
  record_date,
  tapping_section_id,
  SUM(latex_fresh_kg)  AS latex_fresh_kg,
  SUM(coag_fresh_kg)   AS coag_fresh_kg,
  SUM(cord_fresh_kg)   AS cord_fresh_kg,
  SUM(other_fresh_kg)  AS other_fresh_kg,
  SUM(total_fresh_kg)  AS total_fresh_kg,
  SUM(latex_dry_kg)    AS latex_dry_kg,
  SUM(coag_dry_kg)     AS coag_dry_kg,
  SUM(cord_dry_kg)     AS cord_dry_kg,
  SUM(other_dry_kg)    AS other_dry_kg,
  SUM(total_dry_kg)    AS total_dry_kg,
  COUNT(DISTINCT worker_id) AS worker_count
FROM field_worker_weighings
GROUP BY record_date, tapping_section_id;

-- Bước 2: Chuyến xe vườn → nhà máy
CREATE TABLE IF NOT EXISTS truck_trips (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  trip_date       DATE NOT NULL,
  vehicle_no      TEXT,
  factory_id      TEXT NOT NULL,
  team_id         TEXT,
  status          TEXT DEFAULT 'draft',  -- draft | loaded | weighed | allocated
  notes           TEXT,
  created_by      TEXT REFERENCES category_personnel(id),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_truck_trips_date ON truck_trips(trip_date, factory_id);

-- Phần cạo trên xe (1 phần cạo / xe — gộp SL mọi CN trên phần cạo đó)
CREATE TABLE IF NOT EXISTS truck_trip_sections (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  truck_trip_id       TEXT NOT NULL REFERENCES truck_trips(id) ON DELETE CASCADE,
  tapping_section_id  TEXT NOT NULL REFERENCES tapping_sections(id),

  latex_fresh_kg      NUMERIC(14,3) DEFAULT 0,
  latex_tsc_pct       NUMERIC(8,3),
  latex_dry_kg        NUMERIC(14,3) DEFAULT 0,
  coag_fresh_kg       NUMERIC(14,3) DEFAULT 0,
  coag_drc_pct        NUMERIC(8,3),
  coag_dry_kg         NUMERIC(14,3) DEFAULT 0,
  cord_fresh_kg       NUMERIC(14,3) DEFAULT 0,
  cord_drc_pct        NUMERIC(8,3),
  cord_dry_kg         NUMERIC(14,3) DEFAULT 0,
  other_fresh_kg      NUMERIC(14,3) DEFAULT 0,
  other_drc_pct       NUMERIC(8,3),
  other_dry_kg        NUMERIC(14,3) DEFAULT 0,
  total_fresh_kg      NUMERIC(14,3) DEFAULT 0,
  total_dry_kg        NUMERIC(14,3) DEFAULT 0,

  UNIQUE (truck_trip_id, tapping_section_id)
);
CREATE INDEX IF NOT EXISTS idx_trip_sections_trip ON truck_trip_sections(truck_trip_id);

-- Bước 3: Cân xe tại nhà máy — tách từng loại mủ
CREATE TABLE IF NOT EXISTS factory_truck_weighings (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  truck_trip_id   TEXT NOT NULL UNIQUE REFERENCES truck_trips(id),
  receipt_date    DATE NOT NULL,
  factory_id      TEXT NOT NULL,
  receipt_no      TEXT,

  latex_gross_kg  NUMERIC(14,3) DEFAULT 0,
  latex_tare_kg   NUMERIC(14,3) DEFAULT 0,
  latex_net_kg    NUMERIC(14,3) DEFAULT 0,
  latex_tsc_pct   NUMERIC(8,3),
  latex_dry_kg    NUMERIC(14,3) DEFAULT 0,

  coag_net_kg     NUMERIC(14,3) DEFAULT 0,
  coag_drc_pct    NUMERIC(8,3),
  coag_dry_kg     NUMERIC(14,3) DEFAULT 0,

  cord_net_kg     NUMERIC(14,3) DEFAULT 0,
  cord_drc_pct    NUMERIC(8,3),
  cord_dry_kg     NUMERIC(14,3) DEFAULT 0,

  other_net_kg    NUMERIC(14,3) DEFAULT 0,
  other_drc_pct   NUMERIC(8,3),
  other_dry_kg    NUMERIC(14,3) DEFAULT 0,

  total_net_kg    NUMERIC(14,3) DEFAULT 0,
  total_dry_kg    NUMERIC(14,3) DEFAULT 0,

  weighed_by      TEXT REFERENCES category_personnel(id),
  weighed_at      TIMESTAMPTZ DEFAULT now(),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_factory_truck_date ON factory_truck_weighings(receipt_date, factory_id);

-- Bước 4: Quy trả về phần cạo — theo từng loại mủ
-- ratio_latex_i = section_latex_fresh_i / SUM(section_latex_fresh trên xe)
CREATE TABLE IF NOT EXISTS section_factory_allocations (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  factory_weighing_id   TEXT NOT NULL REFERENCES factory_truck_weighings(id) ON DELETE CASCADE,
  tapping_section_id    TEXT NOT NULL REFERENCES tapping_sections(id),

  field_latex_dry_kg    NUMERIC(14,3) DEFAULT 0,
  field_coag_dry_kg     NUMERIC(14,3) DEFAULT 0,
  field_cord_dry_kg     NUMERIC(14,3) DEFAULT 0,
  field_other_dry_kg    NUMERIC(14,3) DEFAULT 0,
  field_total_dry_kg    NUMERIC(14,3) DEFAULT 0,

  alloc_latex_dry_kg    NUMERIC(14,3) DEFAULT 0,
  alloc_coag_dry_kg     NUMERIC(14,3) DEFAULT 0,
  alloc_cord_dry_kg     NUMERIC(14,3) DEFAULT 0,
  alloc_other_dry_kg    NUMERIC(14,3) DEFAULT 0,
  alloc_total_dry_kg    NUMERIC(14,3) DEFAULT 0,   -- sl_quy_tra tổng

  variance_total_dry_kg NUMERIC(14,3),             -- alloc_total - field_total
  allocation_method     TEXT DEFAULT 'by_fresh_weight_per_material',
  metadata              JSONB DEFAULT '{}',
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (factory_weighing_id, tapping_section_id)
);

-- Quy trả xuống CN: khóa (phân bổ phần cạo + công nhân)
CREATE TABLE IF NOT EXISTS worker_factory_allocations (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  section_allocation_id   TEXT NOT NULL REFERENCES section_factory_allocations(id) ON DELETE CASCADE,
  worker_id               TEXT NOT NULL REFERENCES category_personnel(id),

  field_latex_dry_kg      NUMERIC(14,3) DEFAULT 0,
  field_coag_dry_kg       NUMERIC(14,3) DEFAULT 0,
  field_cord_dry_kg       NUMERIC(14,3) DEFAULT 0,
  field_other_dry_kg      NUMERIC(14,3) DEFAULT 0,
  field_total_dry_kg      NUMERIC(14,3) DEFAULT 0,

  alloc_latex_dry_kg      NUMERIC(14,3) DEFAULT 0,
  alloc_coag_dry_kg       NUMERIC(14,3) DEFAULT 0,
  alloc_cord_dry_kg       NUMERIC(14,3) DEFAULT 0,
  alloc_other_dry_kg      NUMERIC(14,3) DEFAULT 0,
  alloc_total_dry_kg      NUMERIC(14,3) DEFAULT 0,

  allocation_ratio        NUMERIC(10,6),
  UNIQUE (section_allocation_id, worker_id)
);

-- Hai số liệu / phần cạo (ban đầu vs quy trả), tách loại mủ
CREATE OR REPLACE VIEW v_section_yield_dual AS
SELECT
  ts.id AS tapping_section_id,
  ts.section_code,
  tt.trip_date,
  tt.vehicle_no,
  tt.factory_id,
  tts.latex_fresh_kg,
  tts.latex_dry_kg   AS sl_ban_dau_latex_kho,
  tts.coag_dry_kg    AS sl_ban_dau_coag_kho,
  tts.total_dry_kg   AS sl_ban_dau_tong_kho,
  ftw.latex_net_kg,
  ftw.latex_tsc_pct  AS tsc_nha_may_pct,
  ftw.total_dry_kg   AS xe_quy_kho,
  sfa.alloc_total_dry_kg AS sl_quy_tra_tong_kho,
  sfa.alloc_latex_dry_kg AS sl_quy_tra_latex_kho,
  sfa.variance_total_dry_kg
FROM truck_trip_sections tts
JOIN truck_trips tt ON tt.id = tts.truck_trip_id
JOIN tapping_sections ts ON ts.id = tts.tapping_section_id
LEFT JOIN factory_truck_weighings ftw ON ftw.truck_trip_id = tt.id
LEFT JOIN section_factory_allocations sfa
  ON sfa.factory_weighing_id = ftw.id AND sfa.tapping_section_id = ts.id;

-- Hai số liệu / (phần cạo + công nhân)
CREATE OR REPLACE VIEW v_worker_yield_dual AS
SELECT
  w.record_date,
  w.tapping_section_id,
  ts.section_code,
  w.worker_id,
  w.total_dry_kg AS sl_ban_dau_tong_kho,
  wa.alloc_total_dry_kg AS sl_quy_tra_tong_kho,
  wa.alloc_total_dry_kg - w.total_dry_kg AS variance_dry_kg
FROM v_worker_section_field_totals w
JOIN tapping_sections ts ON ts.id = w.tapping_section_id
LEFT JOIN section_factory_allocations sa
  ON sa.tapping_section_id = w.tapping_section_id
LEFT JOIN worker_factory_allocations wa
  ON wa.section_allocation_id = sa.id AND wa.worker_id = w.worker_id;

-- Cảnh báo cân sản lượng công nhân (cansanluong_warnings) — tùy chọn
CREATE TABLE IF NOT EXISTS harvest_worker_warnings (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  id_nhan_vien    TEXT,
  ten_nhan_vien   TEXT,
  id_phien_cao    TEXT,
  ten_to          TEXT,
  sl_tuoi         NUMERIC(14,3),
  sl_drc          NUMERIC(8,3),
  tsc_pct         NUMERIC(8,3),
  warning_flags   JSONB DEFAULT '{}',
  record_date     DATE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. TIẾP NHẬN NHÀ MÁY (sanxuat — reception)
-- ============================================================

-- Phiếu nhập tay tại NM (factoryReceipts — source MANUAL)
CREATE TABLE IF NOT EXISTS factory_receipts (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  receipt_no      TEXT NOT NULL,
  receipt_date    DATE NOT NULL,
  factory_id      TEXT NOT NULL,           -- A02, B01... → category_factories.id
  vehicle_no      TEXT,
  plantation      TEXT,                    -- nông trường / đội
  material_type   material_type DEFAULT 'latex',
  misc_sub_type   TEXT,
  gross_weight    NUMERIC(14,3) DEFAULT 0,
  tare_weight     NUMERIC(14,3) DEFAULT 0,
  net_weight      NUMERIC(14,3) DEFAULT 0,
  drc_percent     NUMERIC(8,3) DEFAULT 0,
  dry_weight      NUMERIC(14,3) DEFAULT 0,
  source          TEXT DEFAULT 'MANUAL',
  status          TEXT DEFAULT 'weighed',  -- weighed | assigned
  assigned_to     TEXT,
  created_by      TEXT REFERENCES category_personnel(id),
  updated_by      TEXT REFERENCES category_personnel(id),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_factory_receipts_date ON factory_receipts(receipt_date, factory_id);

-- Tiếp nhận NL tab cũ (materialReceipts — giao từ vườn, khác factoryReceipts)
CREATE TABLE IF NOT EXISTS material_receipts (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  receipt_no      TEXT,
  receipt_date    DATE,
  garden_id       TEXT REFERENCES rubber_gardens(id),
  garden_code     TEXT,
  vehicle_no      TEXT,
  gross_weight    NUMERIC(14,3) DEFAULT 0,
  tare_weight     NUMERIC(14,3) DEFAULT 0,
  net_weight      NUMERIC(14,3) DEFAULT 0,
  drc_percent     NUMERIC(8,3) DEFAULT 0,
  dry_weight      NUMERIC(14,3) DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- VIEW: Sản lượng xe NM = ZEN vehicle + manual (thay logic reception.js)
CREATE OR REPLACE VIEW v_factory_receipts_daily AS
SELECT
  h.id,
  h.import_date AS receipt_date,
  h.zen_dvcs AS factory_id,
  COALESCE(h.so_xe, '-') AS vehicle_no,
  h.don_vi AS plantation,
  CASE WHEN h.mu_nuoc > 0 THEN 'latex'::material_type ELSE 'misc'::material_type END AS material_type,
  h.mu_nuoc AS net_weight,
  h.drc AS drc_percent,
  h.tong_q_kho AS dry_weight,
  'ZEN' AS source,
  CASE WHEN h.assigned_to IS NOT NULL AND h.assigned_to <> '' THEN 'assigned' ELSE 'weighed' END AS status,
  h.assigned_to,
  h.so_ct,
  h.mu_chen, h.qk_mu_chen, h.mu_day, h.qk_mu_day, h.mu_dong, h.qk_mu_dong,
  h.tong_q_kho
FROM harvest_records h
WHERE h.record_type = 'vehicle_zen'
  AND COALESCE(h.source, '') <> 'ZEN_PURCHASE'

UNION ALL

SELECT
  f.id,
  f.receipt_date,
  f.factory_id,
  f.vehicle_no,
  f.plantation,
  f.material_type,
  f.net_weight,
  f.drc_percent,
  f.dry_weight,
  f.source,
  f.status,
  f.assigned_to,
  NULL AS so_ct,
  NULL, NULL, NULL, NULL, NULL, NULL,
  f.dry_weight AS tong_q_kho
FROM factory_receipts f;

-- ============================================================
-- 4. HỒ PHỐI LIỆU → LÔ SX (sanxuat — MES)
-- ============================================================

CREATE TABLE IF NOT EXISTS blending_batches (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  batch_code        TEXT NOT NULL,         -- H1/L1
  tank_no           INT NOT NULL,
  batch_date        DATE NOT NULL,
  sequence          INT DEFAULT 1,
  factory_id        TEXT NOT NULL,
  total_weight      NUMERIC(14,3) DEFAULT 0,
  avg_drc           NUMERIC(8,3) DEFAULT 0,
  total_dry_weight  NUMERIC(14,3) DEFAULT 0,
  status            TEXT DEFAULT 'filling', -- filling | full | processing | done
  created_by        TEXT REFERENCES category_personnel(id),
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_blending_date_factory ON blending_batches(batch_date, factory_id, tank_no);

-- Nguồn xe vào hồ (blendingBatches.sourceReceipts[] — ID harvest hoặc factory_receipt)
CREATE TABLE IF NOT EXISTS blending_batch_sources (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  blending_batch_id   TEXT NOT NULL REFERENCES blending_batches(id) ON DELETE CASCADE,
  source_kind         TEXT NOT NULL,       -- harvest_record | factory_receipt
  source_id           TEXT NOT NULL,
  UNIQUE (blending_batch_id, source_kind, source_id)
);

CREATE TABLE IF NOT EXISTS production_batches (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  batch_no          TEXT NOT NULL,
  batch_date        DATE,
  product           TEXT,                  -- SVR3L, RSS3...
  process_stage     TEXT,
  input_weight      NUMERIC(14,3) DEFAULT 0,
  output_weight     NUMERIC(14,3) DEFAULT 0,
  status            TEXT DEFAULT 'processing',
  notes             TEXT,
  tech_params       JSONB DEFAULT '{}',
  stage_data        JSONB DEFAULT '{}',    -- stageData.* per step
  timeline          JSONB DEFAULT '[]',
  source_tank_id    TEXT REFERENCES blending_batches(id),
  source_tank_code  TEXT,
  source_tank_no    INT,
  factory_id        TEXT NOT NULL,
  line_group        TEXT,
  created_by        TEXT REFERENCES category_personnel(id),
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_production_batches_factory ON production_batches(factory_id, batch_date DESC);
CREATE INDEX IF NOT EXISTS idx_production_batches_tank ON production_batches(source_tank_id);

CREATE TABLE IF NOT EXISTS production_line_records (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  record_code     TEXT,
  record_date     DATE NOT NULL,
  factory_id      TEXT NOT NULL,
  stage           TEXT,                    -- canmu, taohat, say, epbanh, baogoi
  line            TEXT,                    -- MN1, MN2, MT
  shift           TEXT,
  batch_id        TEXT REFERENCES production_batches(id),
  params          JSONB DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  created_by      TEXT REFERENCES category_personnel(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_records_date ON production_line_records(factory_id, record_date);

-- Kho mủ đông tích lũy (coagulumStorage)
CREATE TABLE IF NOT EXISTS coagulum_storage (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  storage_date    DATE NOT NULL,
  factory_id      TEXT NOT NULL,
  accumulated_kg  NUMERIC(14,3) DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (storage_date, factory_id)
);

-- Kho phụ (miscCompartments, miscStorageLogs)
CREATE TABLE IF NOT EXISTS misc_compartments (
  name            TEXT PRIMARY KEY,
  factory_id      TEXT,
  current_weight  NUMERIC(14,3) DEFAULT 0,
  metadata        JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS misc_storage_logs (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  compartment     TEXT REFERENCES misc_compartments(name),
  log_date        DATE,
  weight_delta    NUMERIC(14,3),
  notes           TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. KHO / GIAO HÀNG / CL (sanxuat)
-- ============================================================

CREATE TABLE IF NOT EXISTS warehouse_items (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  item_code       TEXT,
  product         TEXT,
  quantity        NUMERIC(14,3) DEFAULT 0,
  unit            TEXT DEFAULT 'kg',
  factory_id      TEXT,
  batch_id        TEXT REFERENCES production_batches(id),
  status          TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quality_tests (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  batch_id        TEXT REFERENCES production_batches(id),
  test_date       DATE,
  product         TEXT,
  results         JSONB DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Giao hàng từ vườn → NM (rubberDeliveries)
CREATE TABLE IF NOT EXISTS rubber_deliveries (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  delivery_no       TEXT,
  team              TEXT,
  grp               TEXT,
  garden_id         TEXT REFERENCES rubber_gardens(id),
  garden_code       TEXT,
  material_type     material_type,
  grade             TEXT,
  vehicle_no        TEXT,
  gross_weight      NUMERIC(14,3) DEFAULT 0,
  drc_percent       NUMERIC(8,3) DEFAULT 0,
  dry_weight        NUMERIC(14,3) DEFAULT 0,
  nh3_percent       NUMERIC(8,3),
  ph_value          NUMERIC(6,2),
  tapping_session   TEXT,
  tapping_date      DATE,
  plot_ids          JSONB DEFAULT '[]',
  plot_names        JSONB DEFAULT '[]',
  status            TEXT,
  delivery_person   TEXT,
  notes             TEXT,
  metadata          JSONB DEFAULT '{}',
  created_by        TEXT REFERENCES category_personnel(id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Ca khai (tappingSessions) — liên kết delivery
CREATE TABLE IF NOT EXISTS tapping_sessions (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_date    DATE,
  team            TEXT,
  plot_ids        JSONB DEFAULT '[]',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 6. VẬN HÀNH NM (shiftSchedules, ovenDailyOps, zen_sync_logs)
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_schedules (
  id              TEXT PRIMARY KEY,        -- docId theo factory+date
  factory_id      TEXT NOT NULL,
  schedule_date   DATE NOT NULL,
  shifts          JSONB DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oven_daily_ops (
  id              TEXT PRIMARY KEY,
  factory_id      TEXT NOT NULL,
  ops_date        DATE NOT NULL,
  payload         JSONB DEFAULT '{}',
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zen_sync_logs (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  dvcs            TEXT,
  date_from       DATE,
  date_to         DATE,
  records_saved   INT DEFAULT 0,
  status          TEXT,
  message         TEXT,
  synced_by       TEXT REFERENCES category_personnel(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 7. INDEX JSONB erp_collections (giai đoạn chuyển tiếp)
-- ============================================================
-- Ví dụ query tương thích Firestore trong lúc migrate:
-- CREATE INDEX IF NOT EXISTS idx_erp_harvest_date
--   ON erp_collections ((data->>'importDate'))
--   WHERE collection = 'harvestData';

-- ============================================================
-- 8. TRIGGERS updated_at
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rubber_lots','rubber_gardens','harvest_records','harvest_plans',
    'tapping_sections','section_worker_assignments','field_worker_weighings','truck_trips',
    'factory_truck_weighings','factory_receipts','material_receipts',
    'blending_batches','production_batches','production_line_records',
    'warehouse_items','rubber_deliveries'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END $$;

-- ========== schema-tsc-drc.sql ==========
-- Bảng quy đổi TSC% → DRC% (quy khô = kg tươi × DRC% / 100)
-- Chạy sau schema-harvest-production.sql

CREATE TABLE IF NOT EXISTS tsc_drc_conversion (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  material_type   TEXT NOT NULL DEFAULT 'latex',  -- latex | coagulum | cord | other
  tsc_pct         NUMERIC(8,3) NOT NULL,          -- TSC đo tại hiện trường (%)
  drc_pct         NUMERIC(8,3) NOT NULL,          -- DRC quy đổi để tính quy khô (%)
  sort_order      INT DEFAULT 0,
  active          BOOLEAN DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (material_type, tsc_pct)
);

CREATE INDEX IF NOT EXISTS idx_tsc_drc_material ON tsc_drc_conversion(material_type, tsc_pct)
  WHERE active = true;

-- Lưu cả TSC (đo) và DRC (quy đổi) trên phiếu cân
ALTER TABLE field_worker_weighings ADD COLUMN IF NOT EXISTS latex_drc_pct NUMERIC(8,3);
ALTER TABLE field_worker_weighings ADD COLUMN IF NOT EXISTS coag_tsc_pct NUMERIC(8,3);

COMMENT ON TABLE tsc_drc_conversion IS 'Tra cứu TSC→DRC; quy_kho_kg = fresh_kg * drc_pct / 100';

DROP TRIGGER IF EXISTS trg_tsc_drc_conversion_updated ON tsc_drc_conversion;
CREATE TRIGGER trg_tsc_drc_conversion_updated
  BEFORE UPDATE ON tsc_drc_conversion
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- View: trung bình DRC có trọng số (quy khô đã tính bằng DRC, không TSC)
CREATE OR REPLACE VIEW v_worker_section_field_totals AS
SELECT
  record_date,
  tapping_section_id,
  worker_id,
  SUM(latex_fresh_kg)  AS latex_fresh_kg,
  SUM(coag_fresh_kg)   AS coag_fresh_kg,
  SUM(cord_fresh_kg)   AS cord_fresh_kg,
  SUM(other_fresh_kg)  AS other_fresh_kg,
  SUM(total_fresh_kg)  AS total_fresh_kg,
  SUM(latex_dry_kg)    AS latex_dry_kg,
  SUM(coag_dry_kg)     AS coag_dry_kg,
  SUM(cord_dry_kg)     AS cord_dry_kg,
  SUM(other_dry_kg)    AS other_dry_kg,
  SUM(total_dry_kg)    AS total_dry_kg,
  CASE WHEN SUM(latex_fresh_kg) > 0
    THEN SUM(latex_fresh_kg * COALESCE(latex_drc_pct, 0)) / SUM(latex_fresh_kg)
    ELSE NULL END AS latex_drc_pct_avg,
  CASE WHEN SUM(latex_fresh_kg) > 0
    THEN SUM(latex_fresh_kg * COALESCE(latex_tsc_pct, 0)) / SUM(latex_fresh_kg)
    ELSE NULL END AS latex_tsc_pct_avg
FROM field_worker_weighings
GROUP BY record_date, tapping_section_id, worker_id;

-- ========== schema-rbac.sql ==========
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
  (5, 'Technical_Staff', 'NCV / KTV - Nhập liệu chuyên môn, báo cáo kỹ thuật')
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


-- PHẦN 2: DỮ LIỆU MẪU / SEED

-- ========== seed.sql ==========
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

-- ========== seed-tsc-drc-conversion-latex.sql ==========
-- Bảng quy đổi TSC → DRC (mủ nước) — Viện RRIV
-- Nguồn: data/tsc-drc-conversion-latex.tsv
-- 400 điểm, TSC 15.0 – 54.9
-- quy_kho_kg = kg_tuoi * drc / 100

DELETE FROM tsc_drc_conversion WHERE material_type = 'latex';

INSERT INTO tsc_drc_conversion (material_type, tsc_pct, drc_pct, sort_order) VALUES
  ('latex', 15.0, 12.9, 1),
  ('latex', 15.1, 13.0, 2),
  ('latex', 15.2, 13.1, 3),
  ('latex', 15.3, 13.1, 4),
  ('latex', 15.4, 13.2, 5),
  ('latex', 15.5, 13.3, 6),
  ('latex', 15.6, 13.4, 7),
  ('latex', 15.7, 13.5, 8),
  ('latex', 15.8, 13.6, 9),
  ('latex', 15.9, 13.7, 10),
  ('latex', 16.0, 13.8, 11),
  ('latex', 16.1, 13.9, 12),
  ('latex', 16.2, 14.0, 13),
  ('latex', 16.3, 14.1, 14),
  ('latex', 16.4, 14.2, 15),
  ('latex', 16.5, 14.3, 16),
  ('latex', 16.6, 14.4, 17),
  ('latex', 16.7, 14.5, 18),
  ('latex', 16.8, 14.5, 19),
  ('latex', 16.9, 14.6, 20),
  ('latex', 17.0, 14.7, 21),
  ('latex', 17.1, 14.8, 22),
  ('latex', 17.2, 14.9, 23),
  ('latex', 17.3, 15.0, 24),
  ('latex', 17.4, 15.1, 25),
  ('latex', 17.5, 15.2, 26),
  ('latex', 17.6, 15.3, 27),
  ('latex', 17.7, 15.4, 28),
  ('latex', 17.8, 15.5, 29),
  ('latex', 17.9, 15.6, 30),
  ('latex', 18.0, 15.7, 31),
  ('latex', 18.1, 15.8, 32),
  ('latex', 18.2, 15.8, 33),
  ('latex', 18.3, 15.9, 34),
  ('latex', 18.4, 16.0, 35),
  ('latex', 18.5, 16.1, 36),
  ('latex', 18.6, 16.2, 37),
  ('latex', 18.7, 16.3, 38),
  ('latex', 18.8, 16.4, 39),
  ('latex', 18.9, 16.5, 40),
  ('latex', 19.0, 16.6, 41),
  ('latex', 19.1, 16.7, 42),
  ('latex', 19.2, 16.8, 43),
  ('latex', 19.3, 16.9, 44),
  ('latex', 19.4, 17.0, 45),
  ('latex', 19.5, 17.1, 46),
  ('latex', 19.6, 17.2, 47),
  ('latex', 19.7, 17.2, 48),
  ('latex', 19.8, 17.3, 49),
  ('latex', 19.9, 17.4, 50),
  ('latex', 20.0, 17.5, 51),
  ('latex', 20.1, 17.6, 52),
  ('latex', 20.2, 17.7, 53),
  ('latex', 20.3, 17.8, 54),
  ('latex', 20.4, 17.9, 55),
  ('latex', 20.5, 18.0, 56),
  ('latex', 20.6, 18.1, 57),
  ('latex', 20.7, 18.2, 58),
  ('latex', 20.8, 18.3, 59),
  ('latex', 20.9, 18.4, 60),
  ('latex', 21.0, 18.5, 61),
  ('latex', 21.1, 18.6, 62),
  ('latex', 21.2, 18.6, 63),
  ('latex', 21.3, 18.7, 64),
  ('latex', 21.4, 18.8, 65),
  ('latex', 21.5, 18.9, 66),
  ('latex', 21.6, 19.0, 67),
  ('latex', 21.7, 19.1, 68),
  ('latex', 21.8, 19.2, 69),
  ('latex', 21.9, 19.3, 70),
  ('latex', 22.0, 19.4, 71),
  ('latex', 22.1, 19.5, 72),
  ('latex', 22.2, 19.6, 73),
  ('latex', 22.3, 19.7, 74),
  ('latex', 22.4, 19.8, 75),
  ('latex', 22.5, 19.9, 76),
  ('latex', 22.6, 19.9, 77),
  ('latex', 22.7, 20.0, 78),
  ('latex', 22.8, 20.1, 79),
  ('latex', 22.9, 20.2, 80),
  ('latex', 23.0, 20.3, 81),
  ('latex', 23.1, 20.4, 82),
  ('latex', 23.2, 20.5, 83),
  ('latex', 23.3, 20.6, 84),
  ('latex', 23.4, 20.7, 85),
  ('latex', 23.5, 20.8, 86),
  ('latex', 23.6, 20.9, 87),
  ('latex', 23.7, 21.0, 88),
  ('latex', 23.8, 21.1, 89),
  ('latex', 23.9, 21.2, 90),
  ('latex', 24.0, 21.3, 91),
  ('latex', 24.1, 21.3, 92),
  ('latex', 24.2, 21.4, 93),
  ('latex', 24.3, 21.5, 94),
  ('latex', 24.4, 21.6, 95),
  ('latex', 24.5, 21.7, 96),
  ('latex', 24.6, 21.8, 97),
  ('latex', 24.7, 21.9, 98),
  ('latex', 24.8, 22.0, 99),
  ('latex', 24.9, 22.1, 100),
  ('latex', 25.0, 22.3, 101),
  ('latex', 25.1, 22.4, 102),
  ('latex', 25.2, 22.4, 103),
  ('latex', 25.3, 22.5, 104),
  ('latex', 25.4, 22.6, 105),
  ('latex', 25.5, 22.7, 106),
  ('latex', 25.6, 22.8, 107),
  ('latex', 25.7, 22.8, 108),
  ('latex', 25.8, 22.9, 109),
  ('latex', 25.9, 23.0, 110),
  ('latex', 26.0, 23.1, 111),
  ('latex', 26.1, 23.2, 112),
  ('latex', 26.2, 23.3, 113),
  ('latex', 26.3, 23.4, 114),
  ('latex', 26.4, 23.5, 115),
  ('latex', 26.5, 23.5, 116),
  ('latex', 26.6, 23.6, 117),
  ('latex', 26.7, 23.7, 118),
  ('latex', 26.8, 23.8, 119),
  ('latex', 26.9, 23.9, 120),
  ('latex', 27.0, 24.0, 121),
  ('latex', 27.1, 24.1, 122),
  ('latex', 27.2, 24.2, 123),
  ('latex', 27.3, 24.3, 124),
  ('latex', 27.4, 24.4, 125),
  ('latex', 27.5, 24.5, 126),
  ('latex', 27.6, 24.6, 127),
  ('latex', 27.7, 24.7, 128),
  ('latex', 27.8, 24.8, 129),
  ('latex', 27.9, 24.9, 130),
  ('latex', 28.0, 25.0, 131),
  ('latex', 28.1, 25.1, 132),
  ('latex', 28.2, 25.2, 133),
  ('latex', 28.3, 25.3, 134),
  ('latex', 28.4, 25.4, 135),
  ('latex', 28.5, 25.4, 136),
  ('latex', 28.6, 25.5, 137),
  ('latex', 28.7, 25.6, 138),
  ('latex', 28.8, 25.7, 139),
  ('latex', 28.9, 25.8, 140),
  ('latex', 29.0, 25.9, 141),
  ('latex', 29.1, 26.0, 142),
  ('latex', 29.2, 26.1, 143),
  ('latex', 29.3, 26.2, 144),
  ('latex', 29.4, 26.3, 145),
  ('latex', 29.5, 26.4, 146),
  ('latex', 29.6, 26.5, 147),
  ('latex', 29.7, 26.6, 148),
  ('latex', 29.8, 26.7, 149),
  ('latex', 29.9, 26.8, 150),
  ('latex', 30.0, 26.9, 151),
  ('latex', 30.1, 27.0, 152),
  ('latex', 30.2, 27.1, 153),
  ('latex', 30.3, 27.2, 154),
  ('latex', 30.4, 27.3, 155),
  ('latex', 30.5, 27.5, 156),
  ('latex', 30.6, 27.6, 157),
  ('latex', 30.7, 27.7, 158),
  ('latex', 30.8, 27.8, 159),
  ('latex', 30.9, 27.9, 160),
  ('latex', 31.0, 28.0, 161),
  ('latex', 31.1, 28.1, 162),
  ('latex', 31.2, 28.2, 163),
  ('latex', 31.3, 28.3, 164),
  ('latex', 31.4, 28.4, 165),
  ('latex', 31.5, 28.5, 166),
  ('latex', 31.6, 28.6, 167),
  ('latex', 31.7, 28.7, 168),
  ('latex', 31.8, 28.8, 169),
  ('latex', 31.9, 28.9, 170),
  ('latex', 32.0, 29.0, 171),
  ('latex', 32.1, 29.1, 172),
  ('latex', 32.2, 29.2, 173),
  ('latex', 32.3, 29.3, 174),
  ('latex', 32.4, 29.4, 175),
  ('latex', 32.5, 29.5, 176),
  ('latex', 32.6, 29.6, 177),
  ('latex', 32.7, 29.7, 178),
  ('latex', 32.8, 29.8, 179),
  ('latex', 32.9, 29.9, 180),
  ('latex', 33.0, 30.0, 181),
  ('latex', 33.1, 30.1, 182),
  ('latex', 33.2, 30.2, 183),
  ('latex', 33.3, 30.3, 184),
  ('latex', 33.4, 30.4, 185),
  ('latex', 33.5, 30.5, 186),
  ('latex', 33.6, 30.6, 187),
  ('latex', 33.7, 30.7, 188),
  ('latex', 33.8, 30.8, 189),
  ('latex', 33.9, 30.9, 190),
  ('latex', 34.0, 31.0, 191),
  ('latex', 34.1, 31.1, 192),
  ('latex', 34.2, 31.2, 193),
  ('latex', 34.3, 31.3, 194),
  ('latex', 34.4, 31.4, 195),
  ('latex', 34.5, 31.5, 196),
  ('latex', 34.6, 31.6, 197),
  ('latex', 34.7, 31.7, 198),
  ('latex', 34.8, 31.8, 199),
  ('latex', 34.9, 31.9, 200),
  ('latex', 35.0, 32.0, 201),
  ('latex', 35.1, 32.1, 202),
  ('latex', 35.2, 32.2, 203),
  ('latex', 35.3, 32.3, 204),
  ('latex', 35.4, 32.4, 205),
  ('latex', 35.5, 32.5, 206),
  ('latex', 35.6, 32.6, 207),
  ('latex', 35.7, 32.7, 208),
  ('latex', 35.8, 32.8, 209),
  ('latex', 35.9, 32.9, 210),
  ('latex', 36.0, 33.0, 211),
  ('latex', 36.1, 33.1, 212),
  ('latex', 36.2, 33.2, 213),
  ('latex', 36.3, 33.3, 214),
  ('latex', 36.4, 33.4, 215),
  ('latex', 36.5, 33.5, 216),
  ('latex', 36.6, 33.5, 217),
  ('latex', 36.7, 33.6, 218),
  ('latex', 36.8, 33.7, 219),
  ('latex', 36.9, 33.8, 220),
  ('latex', 37.0, 33.9, 221),
  ('latex', 37.1, 34.0, 222),
  ('latex', 37.2, 34.1, 223),
  ('latex', 37.3, 34.2, 224),
  ('latex', 37.4, 34.3, 225),
  ('latex', 37.5, 34.4, 226),
  ('latex', 37.6, 34.5, 227),
  ('latex', 37.7, 34.6, 228),
  ('latex', 37.8, 34.7, 229),
  ('latex', 37.9, 34.8, 230),
  ('latex', 38.0, 34.9, 231),
  ('latex', 38.1, 35.0, 232),
  ('latex', 38.2, 35.1, 233),
  ('latex', 38.3, 35.2, 234),
  ('latex', 38.4, 35.3, 235),
  ('latex', 38.5, 35.3, 236),
  ('latex', 38.6, 35.4, 237),
  ('latex', 38.7, 35.5, 238),
  ('latex', 38.8, 35.6, 239),
  ('latex', 38.9, 35.7, 240),
  ('latex', 39.0, 35.8, 241),
  ('latex', 39.1, 35.9, 242),
  ('latex', 39.2, 36.0, 243),
  ('latex', 39.3, 36.1, 244),
  ('latex', 39.4, 36.2, 245),
  ('latex', 39.5, 36.3, 246),
  ('latex', 39.6, 36.4, 247),
  ('latex', 39.7, 36.5, 248),
  ('latex', 39.8, 36.6, 249),
  ('latex', 39.9, 36.7, 250),
  ('latex', 40.0, 36.8, 251),
  ('latex', 40.1, 36.9, 252),
  ('latex', 40.2, 37.0, 253),
  ('latex', 40.3, 37.1, 254),
  ('latex', 40.4, 37.2, 255),
  ('latex', 40.5, 37.2, 256),
  ('latex', 40.6, 37.3, 257),
  ('latex', 40.7, 37.4, 258),
  ('latex', 40.8, 37.5, 259),
  ('latex', 40.9, 37.6, 260),
  ('latex', 41.0, 37.7, 261),
  ('latex', 41.1, 37.8, 262),
  ('latex', 41.2, 37.9, 263),
  ('latex', 41.3, 38.0, 264),
  ('latex', 41.4, 38.1, 265),
  ('latex', 41.5, 38.2, 266),
  ('latex', 41.6, 38.3, 267),
  ('latex', 41.7, 38.4, 268),
  ('latex', 41.8, 38.5, 269),
  ('latex', 41.9, 38.6, 270),
  ('latex', 42.0, 38.7, 271),
  ('latex', 42.1, 38.8, 272),
  ('latex', 42.2, 38.9, 273),
  ('latex', 42.3, 39.0, 274),
  ('latex', 42.4, 39.1, 275),
  ('latex', 42.5, 39.1, 276),
  ('latex', 42.6, 39.2, 277),
  ('latex', 42.7, 39.3, 278),
  ('latex', 42.8, 39.4, 279),
  ('latex', 42.9, 39.5, 280),
  ('latex', 43.0, 39.6, 281),
  ('latex', 43.1, 39.7, 282),
  ('latex', 43.2, 39.8, 283),
  ('latex', 43.3, 39.9, 284),
  ('latex', 43.4, 40.0, 285),
  ('latex', 43.5, 40.0, 286),
  ('latex', 43.6, 40.1, 287),
  ('latex', 43.7, 40.2, 288),
  ('latex', 43.8, 40.3, 289),
  ('latex', 43.9, 40.4, 290),
  ('latex', 44.0, 40.5, 291),
  ('latex', 44.1, 40.6, 292),
  ('latex', 44.2, 40.7, 293),
  ('latex', 44.3, 40.8, 294),
  ('latex', 44.4, 40.9, 295),
  ('latex', 44.5, 40.9, 296),
  ('latex', 44.6, 41.0, 297),
  ('latex', 44.7, 41.1, 298),
  ('latex', 44.8, 41.2, 299),
  ('latex', 44.9, 41.3, 300),
  ('latex', 45.0, 41.4, 301),
  ('latex', 45.1, 41.5, 302),
  ('latex', 45.2, 41.6, 303),
  ('latex', 45.3, 41.7, 304),
  ('latex', 45.4, 41.8, 305),
  ('latex', 45.5, 41.9, 306),
  ('latex', 45.6, 42.0, 307),
  ('latex', 45.7, 42.1, 308),
  ('latex', 45.8, 42.2, 309),
  ('latex', 45.9, 42.3, 310),
  ('latex', 46.0, 42.4, 311),
  ('latex', 46.1, 42.5, 312),
  ('latex', 46.2, 42.6, 313),
  ('latex', 46.3, 42.7, 314),
  ('latex', 46.4, 42.8, 315),
  ('latex', 46.5, 42.8, 316),
  ('latex', 46.6, 42.9, 317),
  ('latex', 46.7, 43.0, 318),
  ('latex', 46.8, 43.1, 319),
  ('latex', 46.9, 43.2, 320),
  ('latex', 47.0, 43.3, 321),
  ('latex', 47.1, 43.4, 322),
  ('latex', 47.2, 43.5, 323),
  ('latex', 47.3, 43.6, 324),
  ('latex', 47.4, 43.7, 325),
  ('latex', 47.5, 43.7, 326),
  ('latex', 47.6, 43.8, 327),
  ('latex', 47.7, 43.9, 328),
  ('latex', 47.8, 44.0, 329),
  ('latex', 47.9, 44.1, 330),
  ('latex', 48.0, 44.2, 331),
  ('latex', 48.1, 44.3, 332),
  ('latex', 48.2, 44.4, 333),
  ('latex', 48.3, 44.5, 334),
  ('latex', 48.4, 44.6, 335),
  ('latex', 48.5, 44.7, 336),
  ('latex', 48.6, 44.8, 337),
  ('latex', 48.7, 44.9, 338),
  ('latex', 48.8, 45.0, 339),
  ('latex', 48.9, 45.1, 340),
  ('latex', 49.0, 45.2, 341),
  ('latex', 49.1, 45.3, 342),
  ('latex', 49.2, 45.4, 343),
  ('latex', 49.3, 45.5, 344),
  ('latex', 49.4, 45.6, 345),
  ('latex', 49.5, 45.6, 346),
  ('latex', 49.6, 45.7, 347),
  ('latex', 49.7, 45.8, 348),
  ('latex', 49.8, 45.9, 349),
  ('latex', 49.9, 46.0, 350),
  ('latex', 50.0, 46.1, 351),
  ('latex', 50.1, 46.2, 352),
  ('latex', 50.2, 46.3, 353),
  ('latex', 50.3, 46.4, 354),
  ('latex', 50.4, 46.4, 355),
  ('latex', 50.5, 46.5, 356),
  ('latex', 50.6, 46.6, 357),
  ('latex', 50.7, 46.7, 358),
  ('latex', 50.8, 46.8, 359),
  ('latex', 50.9, 46.9, 360),
  ('latex', 51.0, 47.0, 361),
  ('latex', 51.1, 47.1, 362),
  ('latex', 51.2, 47.2, 363),
  ('latex', 51.3, 47.3, 364),
  ('latex', 51.4, 47.3, 365),
  ('latex', 51.5, 47.4, 366),
  ('latex', 51.6, 47.5, 367),
  ('latex', 51.7, 47.6, 368),
  ('latex', 51.8, 47.7, 369),
  ('latex', 51.9, 47.8, 370),
  ('latex', 52.0, 47.9, 371),
  ('latex', 52.1, 48.0, 372),
  ('latex', 52.2, 48.1, 373),
  ('latex', 52.3, 48.2, 374),
  ('latex', 52.4, 48.3, 375),
  ('latex', 52.5, 48.4, 376),
  ('latex', 52.6, 48.5, 377),
  ('latex', 52.7, 48.6, 378),
  ('latex', 52.8, 48.7, 379),
  ('latex', 52.9, 48.8, 380),
  ('latex', 53.0, 48.9, 381),
  ('latex', 53.1, 49.0, 382),
  ('latex', 53.2, 49.1, 383),
  ('latex', 53.3, 49.2, 384),
  ('latex', 53.4, 49.2, 385),
  ('latex', 53.5, 49.3, 386),
  ('latex', 53.6, 49.4, 387),
  ('latex', 53.7, 49.5, 388),
  ('latex', 53.8, 49.6, 389),
  ('latex', 53.9, 49.7, 390),
  ('latex', 54.0, 49.8, 391),
  ('latex', 54.1, 49.9, 392),
  ('latex', 54.2, 50.0, 393),
  ('latex', 54.3, 50.1, 394),
  ('latex', 54.4, 50.1, 395),
  ('latex', 54.5, 50.2, 396),
  ('latex', 54.6, 50.3, 397),
  ('latex', 54.7, 50.4, 398),
  ('latex', 54.8, 50.5, 399),
  ('latex', 54.9, 50.6, 400);

-- ========== seed-demo-harvest.sql ==========
-- Dữ liệu mẫu: 20 CN + 18 phần cạo
-- work_mode + slots[]: mỗi slot có tapper/stripper/collector (có thể Không)

INSERT INTO category_personnel (id, username, ho_ten, team, department, position, role, status, disabled, metadata) VALUES
  ('CN001', 'cn001', 'Công nhân 1',  '1', 'Đội SX 1', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN002', 'cn002', 'Công nhân 2',  '1', 'Đội SX 1', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN003', 'cn003', 'Công nhân 3',  '1', 'Đội SX 1', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN004', 'cn004', 'Công nhân 4',  '1', 'Đội SX 1', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN005', 'cn005', 'Công nhân 5',  '1', 'Đội SX 1', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN006', 'cn006', 'Công nhân 6',  '1', 'Đội SX 1', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN007', 'cn007', 'Công nhân 7',  '2', 'Đội SX 2', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN008', 'cn008', 'Công nhân 8',  '2', 'Đội SX 2', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN009', 'cn009', 'Công nhân 9',  '2', 'Đội SX 2', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN010', 'cn010', 'Công nhân 10', '2', 'Đội SX 2', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN011', 'cn011', 'Công nhân 11', '2', 'Đội SX 2', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN012', 'cn012', 'Công nhân 12', '2', 'Đội SX 2', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN013', 'cn013', 'Công nhân 13', '3', 'Đội SX 3', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN014', 'cn014', 'Công nhân 14', '3', 'Đội SX 3', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN015', 'cn015', 'Công nhân 15', '3', 'Đội SX 3', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN016', 'cn016', 'Công nhân 16', '3', 'Đội SX 3', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN017', 'cn017', 'Công nhân 17', '3', 'Đội SX 3', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN018', 'cn018', 'Công nhân 18', '3', 'Đội SX 3', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN019', 'cn019', 'Công nhân 19', '3', 'Đội SX 3', 'CN cạo', 'user', 'active', false, '{}'),
  ('CN020', 'cn020', 'Công nhân 20', '3', 'Đội SX 3', 'CN cạo', 'user', 'active', false, '{}')
ON CONFLICT (id) DO UPDATE SET ho_ten = EXCLUDED.ho_ten, team = EXCLUDED.team, status = EXCLUDED.status;

INSERT INTO tapping_sections (id, section_code, squad, team_id, active, metadata) VALUES
  ('ts-pc-01', 'PC-01', '1', '1', true, '{"tapping_session":"A","work_mode":"solo","slots":[{"tapper_id":"CN001","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-02', 'PC-02', '1', '1', true, '{"tapping_session":"A","work_mode":"coop_2","slots":[{"tapper_id":"CN002","tapper_pct":50,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100},{"tapper_id":"CN003","tapper_pct":50,"stripper_id":"","stripper_pct":"","collector_id":"","collector_pct":""}]}'),
  ('ts-pc-03', 'PC-03', '1', '1', true, '{"tapping_session":"A","work_mode":"solo","slots":[{"tapper_id":"CN004","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-04', 'PC-04', '1', '1', true, '{"tapping_session":"A","work_mode":"solo","slots":[{"tapper_id":"CN005","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-05', 'PC-05', '1', '1', true, '{"tapping_session":"A","work_mode":"coop_3","slots":[{"tapper_id":"CN006","tapper_pct":33.33,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100},{"tapper_id":"CN007","tapper_pct":33.33,"stripper_id":"","stripper_pct":"","collector_id":"","collector_pct":""},{"tapper_id":"CN008","tapper_pct":33.34,"stripper_id":"","stripper_pct":"","collector_id":"","collector_pct":""}]}'),
  ('ts-pc-06', 'PC-06', '2', '2', true, '{"tapping_session":"B","work_mode":"solo","slots":[{"tapper_id":"CN006","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-07', 'PC-07', '2', '2', true, '{"tapping_session":"B","work_mode":"solo","slots":[{"tapper_id":"CN007","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-08', 'PC-08', '2', '2', true, '{"tapping_session":"B","work_mode":"solo","slots":[{"tapper_id":"CN008","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-09', 'PC-09', '2', '2', true, '{"tapping_session":"B","work_mode":"solo","slots":[{"tapper_id":"CN009","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-10', 'PC-10', '2', '2', true, '{"tapping_session":"B","work_mode":"solo","slots":[{"tapper_id":"CN010","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-11', 'PC-11', '2', '2', true, '{"tapping_session":"C","work_mode":"solo","slots":[{"tapper_id":"CN011","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-12', 'PC-12', '2', '2', true, '{"tapping_session":"C","work_mode":"solo","slots":[{"tapper_id":"CN012","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-13', 'PC-13', '3', '3', true, '{"tapping_session":"C","work_mode":"solo","slots":[{"tapper_id":"CN013","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-14', 'PC-14', '3', '3', true, '{"tapping_session":"C","work_mode":"solo","slots":[{"tapper_id":"CN014","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-15', 'PC-15', '3', '3', true, '{"tapping_session":"D","work_mode":"solo","slots":[{"tapper_id":"CN015","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-16', 'PC-16', '3', '3', true, '{"tapping_session":"D","work_mode":"solo","slots":[{"tapper_id":"CN016","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-17', 'PC-17', '3', '3', true, '{"tapping_session":"D","work_mode":"solo","slots":[{"tapper_id":"CN017","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}'),
  ('ts-pc-18', 'PC-18', '3', '3', true, '{"tapping_session":"D","work_mode":"solo","slots":[{"tapper_id":"CN018","tapper_pct":100,"stripper_id":"CN019","stripper_pct":100,"collector_id":"CN020","collector_pct":100}]}')
ON CONFLICT (id) DO UPDATE SET section_code = EXCLUDED.section_code, metadata = EXCLUDED.metadata;


-- PHẦN 3: PATCH (chỉ chạy khi nâng cấp DB cũ, không cần trên DB mới)

-- ========== patch_fix_user_login_view.sql ==========
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

-- ========== patch_restore_admin_roles.sql ==========
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

-- ========== patch_rbac_user_accounts_columns.sql ==========
-- Sửa lỗi: column a.role does not exist — chạy trước schema-rbac.sql nếu cần

ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- ========== patch-section-assignment-roles.sql ==========
-- Vai trò phân công phần cạo (section_worker_assignments.assignment_role):
--   tapper    — người cạo (metadata.yield_share_pct: % sản lượng cạo)
--   stripper  — người trút mủ nước
--   collector — người bốc mủ đông
-- metadata.work_mode trên bản ghi tapper: solo | coop_2 | coop_3

COMMENT ON COLUMN section_worker_assignments.assignment_role IS
  'tapper | stripper | collector (legacy: primary→tapper)';

-- ========== seed-tapping-sections-example.sql ==========
-- Đã gộp vào seed-demo-harvest.sql (20 CN + 18 phần cạo)
-- Chạy file đó trong Supabase SQL Editor:
--   supabase/seed-demo-harvest.sql
