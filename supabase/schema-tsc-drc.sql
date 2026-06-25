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
