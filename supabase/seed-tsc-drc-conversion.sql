-- Dữ liệu mẫu TSC → DRC (CHỈNH theo bảng thực tế Viện)
-- Công thức app: DRC = tra cứu(TSC); quy_kho = kg_tươi × DRC / 100

DELETE FROM tsc_drc_conversion WHERE material_type IN ('latex', 'coagulum');

-- Mủ nước — ví dụ (thay bằng bảng chuẩn của Viện)
INSERT INTO tsc_drc_conversion (material_type, tsc_pct, drc_pct, sort_order, notes) VALUES
  ('latex', 25.0, 22.0, 1, 'Mẫu — sửa'),
  ('latex', 28.0, 24.5, 2, NULL),
  ('latex', 30.0, 26.0, 3, NULL),
  ('latex', 32.0, 27.5, 4, NULL),
  ('latex', 35.0, 29.0, 5, NULL),
  ('latex', 38.0, 30.5, 6, NULL);

-- Mủ đông — ví dụ (có thể khác hệ số)
INSERT INTO tsc_drc_conversion (material_type, tsc_pct, drc_pct, sort_order) VALUES
  ('coagulum', 30.0, 55.0, 1),
  ('coagulum', 35.0, 58.0, 2),
  ('coagulum', 40.0, 60.0, 3),
  ('coagulum', 45.0, 62.0, 4);
