-- VIEW tổng hợp sản lượng phiếu giao nhận mủ (GN) theo ngày cạo
-- Chạy sau schema-harvest-production.sql (bảng rubber_deliveries, erp_collections)
--
-- Nguồn:
--   • rubber_deliveries (bảng chính)
--   • erp_collections collection=rubberDeliveries (legacy, bỏ qua nếu đã có trong bảng)
--
-- Cột kg khớp logic TabDelivery (latex/coag tươi + khô từ metadata hoặc gross × DRC%)

CREATE INDEX IF NOT EXISTS idx_rubber_deliveries_tapping_date
  ON rubber_deliveries (tapping_date);

CREATE INDEX IF NOT EXISTS idx_rubber_deliveries_tapping_date_team
  ON rubber_deliveries (tapping_date, team);

-- ---------------------------------------------------------------------------
-- Từng phiếu GN — đã chuẩn hóa kg mủ nước / mủ đông (tươi + khô)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rubber_delivery_receipt_metrics AS
WITH src AS (
  SELECT
    rd.id,
    rd.delivery_no,
    rd.team,
    rd.garden_id,
    rd.garden_code,
    rd.tapping_session,
    rd.tapping_date,
    rd.material_type::text AS material_type,
    COALESCE(rd.gross_weight, 0) AS gross_weight,
    COALESCE(rd.drc_percent, 0) AS drc_percent,
    COALESCE(rd.dry_weight, 0) AS dry_weight,
    COALESCE(rd.metadata, '{}'::jsonb) AS metadata,
    'rubber_deliveries'::text AS source_table
  FROM rubber_deliveries rd
  WHERE rd.tapping_date IS NOT NULL

  UNION ALL

  SELECT
    ec.id,
    ec.data->>'deliveryNo',
    COALESCE(ec.data->>'team_id', ec.data->>'team', ec.data->>'gardenId'),
    ec.data->>'gardenId',
    ec.data->>'gardenCode',
    ec.data->>'tappingSession',
    COALESCE(
      NULLIF(ec.data->>'tappingDate', '')::date,
      NULLIF(ec.data->>'tapping_date', '')::date,
      NULLIF(ec.data->>'tappingTime', '')::date
    ),
    COALESCE(ec.data->>'materialType', ec.data->>'material_type', 'latex'),
    COALESCE(
      NULLIF(ec.data->>'grossWeight', '')::numeric,
      NULLIF(ec.data->>'gross_weight', '')::numeric,
      0
    ),
    COALESCE(
      NULLIF(ec.data->>'drcPercent', '')::numeric,
      NULLIF(ec.data->>'drc_percent', '')::numeric,
      0
    ),
    COALESCE(
      NULLIF(ec.data->>'dryWeight', '')::numeric,
      NULLIF(ec.data->>'dry_weight', '')::numeric,
      0
    ),
    COALESCE(ec.data, '{}'::jsonb) AS metadata,
    'erp_collections'::text AS source_table
  FROM erp_collections ec
  WHERE ec.collection = 'rubberDeliveries'
    AND COALESCE(
      NULLIF(ec.data->>'tappingDate', ''),
      NULLIF(ec.data->>'tapping_date', ''),
      NULLIF(ec.data->>'tappingTime', '')
    ) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM rubber_deliveries rd2 WHERE rd2.id = ec.id
    )
),
norm AS (
  SELECT
    s.*,
    COALESCE(
      NULLIF(s.metadata->>'coagGrossWeight', '')::numeric,
      NULLIF(s.metadata->>'coag_gross_weight', '')::numeric,
      CASE WHEN s.material_type = 'coagulum' THEN s.gross_weight ELSE 0 END,
      0
    ) AS coag_fresh_kg,
    COALESCE(
      NULLIF(s.metadata->>'latexDrcPercent', '')::numeric,
      NULLIF(s.metadata->>'latex_drc_percent', '')::numeric,
      CASE WHEN s.material_type = 'latex' THEN s.drc_percent ELSE 0 END,
      0
    ) AS latex_drc_pct,
    COALESCE(
      NULLIF(s.metadata->>'coagDrcPercent', '')::numeric,
      NULLIF(s.metadata->>'coag_drc_percent', '')::numeric,
      CASE WHEN s.material_type = 'coagulum' THEN s.drc_percent ELSE 0 END,
      0
    ) AS coag_drc_pct
  FROM src s
),
calc AS (
  SELECT
    n.*,
    COALESCE(
      NULLIF(n.metadata->>'latexGrossWeight', '')::numeric,
      NULLIF(n.metadata->>'latex_gross_weight', '')::numeric,
      CASE
        WHEN n.material_type = 'latex' THEN n.gross_weight
        WHEN n.gross_weight > n.coag_fresh_kg AND n.coag_fresh_kg >= 0
          THEN n.gross_weight - n.coag_fresh_kg
        ELSE 0
      END,
      0
    ) AS latex_fresh_kg,
    COALESCE(
      NULLIF(n.metadata->>'latexDryWeight', '')::numeric,
      NULLIF(n.metadata->>'latex_dry_weight', '')::numeric,
      0
    ) AS latex_dry_stored,
    COALESCE(
      NULLIF(n.metadata->>'coagDryWeight', '')::numeric,
      NULLIF(n.metadata->>'coag_dry_weight', '')::numeric,
      0
    ) AS coag_dry_stored
  FROM norm n
),
final AS (
  SELECT
    c.*,
    CASE
      WHEN c.latex_dry_stored > 0 THEN c.latex_dry_stored
      WHEN c.latex_fresh_kg > 0 AND c.latex_drc_pct > 0
        THEN ROUND((c.latex_fresh_kg * c.latex_drc_pct / 100.0)::numeric, 3)
      ELSE 0
    END AS latex_dry_kg,
    CASE
      WHEN c.coag_dry_stored > 0 THEN c.coag_dry_stored
      WHEN c.coag_fresh_kg > 0 AND c.coag_drc_pct > 0
        THEN ROUND((c.coag_fresh_kg * c.coag_drc_pct / 100.0)::numeric, 3)
      ELSE 0
    END AS coag_dry_kg
  FROM calc c
)
SELECT
  id,
  delivery_no,
  team,
  garden_id,
  garden_code,
  tapping_session,
  tapping_date,
  material_type,
  latex_fresh_kg,
  coag_fresh_kg,
  latex_fresh_kg + coag_fresh_kg AS total_fresh_kg,
  latex_dry_kg,
  coag_dry_kg,
  latex_dry_kg + coag_dry_kg AS total_dry_kg,
  source_table
FROM final;

COMMENT ON VIEW v_rubber_delivery_receipt_metrics IS
  'Từng phiếu GN — kg mủ nước/đông tươi + khô (metadata hoặc gross×DRC).';

-- ---------------------------------------------------------------------------
-- Tổng hợp theo ngày cạo + trạm/đội SX (tra cứu nhanh: WHERE tapping_date = ...)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rubber_delivery_daily_totals AS
SELECT
  m.tapping_date,
  m.team,
  COALESCE(ct.name, m.garden_code, m.team) AS team_name,
  COUNT(*)::int AS receipt_count,
  ROUND(SUM(m.latex_fresh_kg)::numeric, 3) AS latex_fresh_kg,
  ROUND(SUM(m.coag_fresh_kg)::numeric, 3) AS coag_fresh_kg,
  ROUND(SUM(m.total_fresh_kg)::numeric, 3) AS total_fresh_kg,
  ROUND(SUM(m.latex_dry_kg)::numeric, 3) AS latex_dry_kg,
  ROUND(SUM(m.coag_dry_kg)::numeric, 3) AS coag_dry_kg,
  ROUND(SUM(m.total_dry_kg)::numeric, 3) AS total_dry_kg
FROM v_rubber_delivery_receipt_metrics m
LEFT JOIN category_teams ct ON ct.id = m.team
GROUP BY m.tapping_date, m.team, ct.name, m.garden_code;

COMMENT ON VIEW v_rubber_delivery_daily_totals IS
  'Tổng sản lượng GN theo ngày cạo + trạm. Ví dụ: tapping_date = ''2026-06-21'' AND team = ''team-lk''.';

-- ---------------------------------------------------------------------------
-- Tổng hợp cả ngày (gộp mọi trạm) — một dòng / ngày cạo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rubber_delivery_daily_totals_by_date AS
SELECT
  tapping_date,
  COUNT(*)::int AS receipt_count,
  COUNT(DISTINCT team)::int AS team_count,
  ROUND(SUM(latex_fresh_kg)::numeric, 3) AS latex_fresh_kg,
  ROUND(SUM(coag_fresh_kg)::numeric, 3) AS coag_fresh_kg,
  ROUND(SUM(total_fresh_kg)::numeric, 3) AS total_fresh_kg,
  ROUND(SUM(latex_dry_kg)::numeric, 3) AS latex_dry_kg,
  ROUND(SUM(coag_dry_kg)::numeric, 3) AS coag_dry_kg,
  ROUND(SUM(total_dry_kg)::numeric, 3) AS total_dry_kg
FROM v_rubber_delivery_receipt_metrics
GROUP BY tapping_date;

COMMENT ON VIEW v_rubber_delivery_daily_totals_by_date IS
  'Tổng sản lượng GN gộp cả ngày cạo (mọi trạm). Ví dụ: tapping_date = ''2026-06-21''.';

-- ---------------------------------------------------------------------------
-- Tổng hợp theo ngày cạo + trạm + phiên cạo (A/B/C/D)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rubber_delivery_daily_totals_by_session AS
SELECT
  m.tapping_date,
  m.team,
  COALESCE(NULLIF(TRIM(m.tapping_session), ''), '—') AS tapping_session,
  COALESCE(ct.name, m.garden_code, m.team) AS team_name,
  COUNT(*)::int AS receipt_count,
  ROUND(SUM(m.latex_fresh_kg)::numeric, 3) AS latex_fresh_kg,
  ROUND(SUM(m.coag_fresh_kg)::numeric, 3) AS coag_fresh_kg,
  ROUND(SUM(m.total_fresh_kg)::numeric, 3) AS total_fresh_kg,
  ROUND(SUM(m.latex_dry_kg)::numeric, 3) AS latex_dry_kg,
  ROUND(SUM(m.coag_dry_kg)::numeric, 3) AS coag_dry_kg,
  ROUND(SUM(m.total_dry_kg)::numeric, 3) AS total_dry_kg
FROM v_rubber_delivery_receipt_metrics m
LEFT JOIN category_teams ct ON ct.id = m.team
GROUP BY
  m.tapping_date,
  m.team,
  COALESCE(NULLIF(TRIM(m.tapping_session), ''), '—'),
  ct.name,
  m.garden_code;

COMMENT ON VIEW v_rubber_delivery_daily_totals_by_session IS
  'Tổng GN theo ngày cạo + trạm + phiên. Ví dụ: tapping_date + team + tapping_session = ''A''.';

-- Kiểm tra nhanh:
-- SELECT * FROM v_rubber_delivery_daily_totals WHERE tapping_date = DATE '2026-06-21';
-- SELECT * FROM v_rubber_delivery_daily_totals_by_date WHERE tapping_date = DATE '2026-06-21';
-- SELECT * FROM v_rubber_delivery_daily_totals_by_session
--   WHERE tapping_date = DATE '2026-06-21' AND team = 'team-lk';
