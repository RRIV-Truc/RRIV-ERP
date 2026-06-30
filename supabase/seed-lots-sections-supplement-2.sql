-- Bổ sung lô + phần cạo (bảng batch 2)
-- Chạy sau seed-laikhe-workforce.sql và seed-lots-sections-supplement.sql
-- ON CONFLICT an toàn — chỉ thêm phần còn thiếu.

INSERT INTO rubber_lots (id, lot_code, squad, metadata) VALUES
  ('1.14VI.LK.19.120', '1.14VI.LK.19.120', 'LK', '{"ten_lo":"10-8/2019","team_id":"team-lk"}'),
  ('1.14VI.LK.19.122', '1.14VI.LK.19.122', 'LK', '{"ten_lo":"10-9/2019","team_id":"team-lk"}'),
  ('1.14VI.LK.18.116', '1.14VI.LK.18.116', 'LK', '{"ten_lo":"E/2018","team_id":"team-lk"}'),
  ('1.14VI.LK.18.117', '1.14VI.LK.18.117', 'LK', '{"ten_lo":"F/2018","team_id":"team-lk"}'),
  ('1.14VI.LK.16.101', '1.14VI.LK.16.101', 'LK', '{"ten_lo":"RRIV206/2016","team_id":"team-lk"}'),
  ('1.14VI.LK.14.090', '1.14VI.LK.14.090', 'LK', '{"ten_lo":"STLK/14","team_id":"team-lk"}')
ON CONFLICT (id) DO UPDATE SET
  lot_code = EXCLUDED.lot_code,
  squad = EXCLUDED.squad,
  metadata = EXCLUDED.metadata;

INSERT INTO tapping_sections (id, section_code, lot_id, lot_name, section_no, team_id, squad, active) VALUES
  -- 19.125: bổ sung PC 2–6 (PC 1 đã có)
  ('ts-lk-19-125-pc02', '1.14VI.LK.19.125|PC|2', '1.14VI.LK.19.125', '6-11/2019',    2, 'team-lk', 'LK', true),
  ('ts-lk-19-125-pc03', '1.14VI.LK.19.125|PC|3', '1.14VI.LK.19.125', '6-11/2019',    3, 'team-lk', 'LK', true),
  ('ts-lk-19-125-pc04', '1.14VI.LK.19.125|PC|4', '1.14VI.LK.19.125', '6-11/2019',    4, 'team-lk', 'LK', true),
  ('ts-lk-19-125-pc05', '1.14VI.LK.19.125|PC|5', '1.14VI.LK.19.125', '6-11/2019',    5, 'team-lk', 'LK', true),
  ('ts-lk-19-125-pc06', '1.14VI.LK.19.125|PC|6', '1.14VI.LK.19.125', '6-11/2019',    6, 'team-lk', 'LK', true),
  ('ts-lk-19-120-pc01', '1.14VI.LK.19.120|PC|1', '1.14VI.LK.19.120', '10-8/2019',    1, 'team-lk', 'LK', true),
  ('ts-lk-19-120-pc02', '1.14VI.LK.19.120|PC|2', '1.14VI.LK.19.120', '10-8/2019',    2, 'team-lk', 'LK', true),
  ('ts-lk-19-120-pc03', '1.14VI.LK.19.120|PC|3', '1.14VI.LK.19.120', '10-8/2019',    3, 'team-lk', 'LK', true),
  ('ts-lk-19-122-pc01', '1.14VI.LK.19.122|PC|1', '1.14VI.LK.19.122', '10-9/2019',    1, 'team-lk', 'LK', true),
  ('ts-lk-19-122-pc02', '1.14VI.LK.19.122|PC|2', '1.14VI.LK.19.122', '10-9/2019',    2, 'team-lk', 'LK', true),
  ('ts-lk-18-116-pc01', '1.14VI.LK.18.116|PC|1', '1.14VI.LK.18.116', 'E/2018',       1, 'team-lk', 'LK', true),
  ('ts-lk-18-116-pc02', '1.14VI.LK.18.116|PC|2', '1.14VI.LK.18.116', 'E/2018',       2, 'team-lk', 'LK', true),
  ('ts-lk-18-116-pc03', '1.14VI.LK.18.116|PC|3', '1.14VI.LK.18.116', 'E/2018',       3, 'team-lk', 'LK', true),
  ('ts-lk-18-117-pc01', '1.14VI.LK.18.117|PC|1', '1.14VI.LK.18.117', 'F/2018',       1, 'team-lk', 'LK', true),
  ('ts-lk-18-117-pc02', '1.14VI.LK.18.117|PC|2', '1.14VI.LK.18.117', 'F/2018',       2, 'team-lk', 'LK', true),
  ('ts-lk-18-117-pc03', '1.14VI.LK.18.117|PC|3', '1.14VI.LK.18.117', 'F/2018',       3, 'team-lk', 'LK', true),
  ('ts-lk-18-117-pc04', '1.14VI.LK.18.117|PC|4', '1.14VI.LK.18.117', 'F/2018',       4, 'team-lk', 'LK', true),
  ('ts-lk-18-117-pc05', '1.14VI.LK.18.117|PC|5', '1.14VI.LK.18.117', 'F/2018',       5, 'team-lk', 'LK', true),
  ('ts-lk-18-117-pc06', '1.14VI.LK.18.117|PC|6', '1.14VI.LK.18.117', 'F/2018',       6, 'team-lk', 'LK', true),
  ('ts-lk-18-117-pc07', '1.14VI.LK.18.117|PC|7', '1.14VI.LK.18.117', 'F/2018',       7, 'team-lk', 'LK', true),
  ('ts-lk-18-117-pc08', '1.14VI.LK.18.117|PC|8', '1.14VI.LK.18.117', 'F/2018',       8, 'team-lk', 'LK', true),
  ('ts-lk-16-101-pc01', '1.14VI.LK.16.101|PC|1', '1.14VI.LK.16.101', 'RRIV206/2016', 1, 'team-lk', 'LK', true),
  ('ts-lk-16-101-pc02', '1.14VI.LK.16.101|PC|2', '1.14VI.LK.16.101', 'RRIV206/2016', 2, 'team-lk', 'LK', true),
  ('ts-lk-16-101-pc03', '1.14VI.LK.16.101|PC|3', '1.14VI.LK.16.101', 'RRIV206/2016', 3, 'team-lk', 'LK', true),
  ('ts-lk-16-101-pc04', '1.14VI.LK.16.101|PC|4', '1.14VI.LK.16.101', 'RRIV206/2016', 4, 'team-lk', 'LK', true),
  ('ts-lk-16-101-pc05', '1.14VI.LK.16.101|PC|5', '1.14VI.LK.16.101', 'RRIV206/2016', 5, 'team-lk', 'LK', true),
  ('ts-lk-16-101-pc06', '1.14VI.LK.16.101|PC|6', '1.14VI.LK.16.101', 'RRIV206/2016', 6, 'team-lk', 'LK', true),
  ('ts-lk-16-101-pc07', '1.14VI.LK.16.101|PC|7', '1.14VI.LK.16.101', 'RRIV206/2016', 7, 'team-lk', 'LK', true),
  -- 15.093: bổ sung PC 7 (PC 1–6 đã có)
  ('ts-lk-15-093-pc07', '1.14VI.LK.15.093|PC|7', '1.14VI.LK.15.093', 'RRIV209/2015', 7, 'team-lk', 'LK', true),
  -- 06.085: bổ sung PC 6 (PC 1–5 đã có)
  ('ts-lk-06-085-pc06', '1.14VI.LK.06.085|PC|6', '1.14VI.LK.06.085', 'ST/06',        6, 'team-lk', 'LK', true),
  -- 13.089: bổ sung PC 2–7 (PC 1 đã có)
  ('ts-lk-13-089-pc02', '1.14VI.LK.13.089|PC|2', '1.14VI.LK.13.089', 'ST,CT/2013',   2, 'team-lk', 'LK', true),
  ('ts-lk-13-089-pc03', '1.14VI.LK.13.089|PC|3', '1.14VI.LK.13.089', 'ST,CT/2013',   3, 'team-lk', 'LK', true),
  ('ts-lk-13-089-pc04', '1.14VI.LK.13.089|PC|4', '1.14VI.LK.13.089', 'ST,CT/2013',   4, 'team-lk', 'LK', true),
  ('ts-lk-13-089-pc05', '1.14VI.LK.13.089|PC|5', '1.14VI.LK.13.089', 'ST,CT/2013',   5, 'team-lk', 'LK', true),
  ('ts-lk-13-089-pc06', '1.14VI.LK.13.089|PC|6', '1.14VI.LK.13.089', 'ST,CT/2013',   6, 'team-lk', 'LK', true),
  ('ts-lk-13-089-pc07', '1.14VI.LK.13.089|PC|7', '1.14VI.LK.13.089', 'ST,CT/2013',   7, 'team-lk', 'LK', true),
  ('ts-lk-14-090-pc01', '1.14VI.LK.14.090|PC|1', '1.14VI.LK.14.090', 'STLK/14',      1, 'team-lk', 'LK', true),
  ('ts-lk-14-090-pc02', '1.14VI.LK.14.090|PC|2', '1.14VI.LK.14.090', 'STLK/14',      2, 'team-lk', 'LK', true),
  ('ts-lk-14-090-pc03', '1.14VI.LK.14.090|PC|3', '1.14VI.LK.14.090', 'STLK/14',      3, 'team-lk', 'LK', true),
  ('ts-lk-14-090-pc04', '1.14VI.LK.14.090|PC|4', '1.14VI.LK.14.090', 'STLK/14',      4, 'team-lk', 'LK', true),
  ('ts-lk-14-090-pc05', '1.14VI.LK.14.090|PC|5', '1.14VI.LK.14.090', 'STLK/14',      5, 'team-lk', 'LK', true),
  ('ts-lk-14-090-pc06', '1.14VI.LK.14.090|PC|6', '1.14VI.LK.14.090', 'STLK/14',      6, 'team-lk', 'LK', true)
ON CONFLICT (id) DO UPDATE SET
  section_code = EXCLUDED.section_code,
  lot_id = EXCLUDED.lot_id,
  lot_name = EXCLUDED.lot_name,
  section_no = EXCLUDED.section_no,
  team_id = EXCLUDED.team_id;
