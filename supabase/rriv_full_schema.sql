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

  -- Mủ nước (latex): đo TSC → tra bảng → DRC
  latex_fresh_kg      NUMERIC(14,3) DEFAULT 0,
  latex_tsc_pct       NUMERIC(8,3),
  latex_drc_pct       NUMERIC(8,3),
  latex_dry_kg        NUMERIC(14,3),

  -- Mủ đông / bóc chén (coagulum)
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

