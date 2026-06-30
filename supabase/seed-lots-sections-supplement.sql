-- Bổ sung lô + phần cạo (bảng mới từ user)
-- Chạy độc lập sau seed-laikhe-workforce.sql (ON CONFLICT an toàn, chạy lại được).
-- Lô 96.067 / 96.065 / 95.060 / 95.057 đã có trong seed Lai Khê — không lặp.
-- Lô 07.086: bảng gốc thiếu PC 5, lặp PC 6 → seed PC 1..8.

INSERT INTO rubber_lots (id, lot_code, squad, metadata) VALUES
  ('1.14VI.LK.17.108', '1.14VI.LK.17.108', 'LK', '{"ten_lo":"6-6/2017","team_id":"team-lk"}'),
  ('1.14VI.LK.17.109', '1.14VI.LK.17.109', 'LK', '{"ten_lo":"6-7/2017","team_id":"team-lk"}'),
  ('1.14VI.LK.17.111', '1.14VI.LK.17.111', 'LK', '{"ten_lo":"8-8/2017","team_id":"team-lk"}'),
  ('1.14VI.LK.18.118', '1.14VI.LK.18.118', 'LK', '{"ten_lo":"9-8/2018","team_id":"team-lk"}'),
  ('1.14VI.LK.16.098', '1.14VI.LK.16.098', 'LK', '{"ten_lo":"MONO/16","team_id":"team-lk"}'),
  ('1.14VI.LK.16.097', '1.14VI.LK.16.097', 'LK', '{"ten_lo":"RRIV230/2016","team_id":"team-lk"}'),
  ('1.14VI.LK.04.082', '1.14VI.LK.04.082', 'LK', '{"ten_lo":"SG,ST,XT/04","team_id":"team-lk"}'),
  ('1.14VI.LK.06.085', '1.14VI.LK.06.085', 'LK', '{"ten_lo":"ST/06","team_id":"team-lk"}'),
  ('1.14VI.LK.07.086', '1.14VI.LK.07.086', 'LK', '{"ten_lo":"ST/07","team_id":"team-lk"}')
ON CONFLICT (id) DO UPDATE SET
  lot_code = EXCLUDED.lot_code,
  squad = EXCLUDED.squad,
  metadata = EXCLUDED.metadata;

INSERT INTO tapping_sections (id, section_code, lot_id, lot_name, section_no, team_id, squad, active) VALUES
  ('ts-lk-17-108-pc01', '1.14VI.LK.17.108|PC|1', '1.14VI.LK.17.108', '6-6/2017',      1, 'team-lk', 'LK', true),
  ('ts-lk-17-108-pc02', '1.14VI.LK.17.108|PC|2', '1.14VI.LK.17.108', '6-6/2017',      2, 'team-lk', 'LK', true),
  ('ts-lk-17-109-pc01', '1.14VI.LK.17.109|PC|1', '1.14VI.LK.17.109', '6-7/2017',      1, 'team-lk', 'LK', true),
  ('ts-lk-17-109-pc02', '1.14VI.LK.17.109|PC|2', '1.14VI.LK.17.109', '6-7/2017',      2, 'team-lk', 'LK', true),
  ('ts-lk-17-111-pc01', '1.14VI.LK.17.111|PC|1', '1.14VI.LK.17.111', '8-8/2017',      1, 'team-lk', 'LK', true),
  ('ts-lk-17-111-pc02', '1.14VI.LK.17.111|PC|2', '1.14VI.LK.17.111', '8-8/2017',      2, 'team-lk', 'LK', true),
  ('ts-lk-17-111-pc03', '1.14VI.LK.17.111|PC|3', '1.14VI.LK.17.111', '8-8/2017',      3, 'team-lk', 'LK', true),
  ('ts-lk-17-111-pc04', '1.14VI.LK.17.111|PC|4', '1.14VI.LK.17.111', '8-8/2017',      4, 'team-lk', 'LK', true),
  ('ts-lk-17-111-pc05', '1.14VI.LK.17.111|PC|5', '1.14VI.LK.17.111', '8-8/2017',      5, 'team-lk', 'LK', true),
  ('ts-lk-17-111-pc06', '1.14VI.LK.17.111|PC|6', '1.14VI.LK.17.111', '8-8/2017',      6, 'team-lk', 'LK', true),
  ('ts-lk-17-111-pc07', '1.14VI.LK.17.111|PC|7', '1.14VI.LK.17.111', '8-8/2017',      7, 'team-lk', 'LK', true),
  ('ts-lk-18-118-pc01', '1.14VI.LK.18.118|PC|1', '1.14VI.LK.18.118', '9-8/2018',      1, 'team-lk', 'LK', true),
  ('ts-lk-18-118-pc02', '1.14VI.LK.18.118|PC|2', '1.14VI.LK.18.118', '9-8/2018',      2, 'team-lk', 'LK', true),
  ('ts-lk-18-118-pc03', '1.14VI.LK.18.118|PC|3', '1.14VI.LK.18.118', '9-8/2018',      3, 'team-lk', 'LK', true),
  ('ts-lk-18-118-pc04', '1.14VI.LK.18.118|PC|4', '1.14VI.LK.18.118', '9-8/2018',      4, 'team-lk', 'LK', true),
  ('ts-lk-18-118-pc05', '1.14VI.LK.18.118|PC|5', '1.14VI.LK.18.118', '9-8/2018',      5, 'team-lk', 'LK', true),
  ('ts-lk-18-118-pc06', '1.14VI.LK.18.118|PC|6', '1.14VI.LK.18.118', '9-8/2018',      6, 'team-lk', 'LK', true),
  ('ts-lk-16-098-pc01', '1.14VI.LK.16.098|PC|1', '1.14VI.LK.16.098', 'MONO/16',       1, 'team-lk', 'LK', true),
  ('ts-lk-16-098-pc02', '1.14VI.LK.16.098|PC|2', '1.14VI.LK.16.098', 'MONO/16',       2, 'team-lk', 'LK', true),
  ('ts-lk-16-098-pc03', '1.14VI.LK.16.098|PC|3', '1.14VI.LK.16.098', 'MONO/16',       3, 'team-lk', 'LK', true),
  ('ts-lk-16-097-pc08', '1.14VI.LK.16.097|PC|8', '1.14VI.LK.16.097', 'RRIV230/2016',  8, 'team-lk', 'LK', true),
  ('ts-lk-04-082-pc01', '1.14VI.LK.04.082|PC|1', '1.14VI.LK.04.082', 'SG,ST,XT/04',   1, 'team-lk', 'LK', true),
  ('ts-lk-04-082-pc02', '1.14VI.LK.04.082|PC|2', '1.14VI.LK.04.082', 'SG,ST,XT/04',   2, 'team-lk', 'LK', true),
  ('ts-lk-04-082-pc03', '1.14VI.LK.04.082|PC|3', '1.14VI.LK.04.082', 'SG,ST,XT/04',   3, 'team-lk', 'LK', true),
  ('ts-lk-04-082-pc04', '1.14VI.LK.04.082|PC|4', '1.14VI.LK.04.082', 'SG,ST,XT/04',   4, 'team-lk', 'LK', true),
  ('ts-lk-04-082-pc05', '1.14VI.LK.04.082|PC|5', '1.14VI.LK.04.082', 'SG,ST,XT/04',   5, 'team-lk', 'LK', true),
  ('ts-lk-04-082-pc06', '1.14VI.LK.04.082|PC|6', '1.14VI.LK.04.082', 'SG,ST,XT/04',   6, 'team-lk', 'LK', true),
  ('ts-lk-04-082-pc07', '1.14VI.LK.04.082|PC|7', '1.14VI.LK.04.082', 'SG,ST,XT/04',   7, 'team-lk', 'LK', true),
  ('ts-lk-06-085-pc01', '1.14VI.LK.06.085|PC|1', '1.14VI.LK.06.085', 'ST/06',         1, 'team-lk', 'LK', true),
  ('ts-lk-06-085-pc02', '1.14VI.LK.06.085|PC|2', '1.14VI.LK.06.085', 'ST/06',         2, 'team-lk', 'LK', true),
  ('ts-lk-06-085-pc03', '1.14VI.LK.06.085|PC|3', '1.14VI.LK.06.085', 'ST/06',         3, 'team-lk', 'LK', true),
  ('ts-lk-06-085-pc04', '1.14VI.LK.06.085|PC|4', '1.14VI.LK.06.085', 'ST/06',         4, 'team-lk', 'LK', true),
  ('ts-lk-06-085-pc05', '1.14VI.LK.06.085|PC|5', '1.14VI.LK.06.085', 'ST/06',         5, 'team-lk', 'LK', true),
  ('ts-lk-06-085-pc06', '1.14VI.LK.06.085|PC|6', '1.14VI.LK.06.085', 'ST/06',         6, 'team-lk', 'LK', true),
  ('ts-lk-07-086-pc01', '1.14VI.LK.07.086|PC|1', '1.14VI.LK.07.086', 'ST/07',         1, 'team-lk', 'LK', true),
  ('ts-lk-07-086-pc02', '1.14VI.LK.07.086|PC|2', '1.14VI.LK.07.086', 'ST/07',         2, 'team-lk', 'LK', true),
  ('ts-lk-07-086-pc03', '1.14VI.LK.07.086|PC|3', '1.14VI.LK.07.086', 'ST/07',         3, 'team-lk', 'LK', true),
  ('ts-lk-07-086-pc04', '1.14VI.LK.07.086|PC|4', '1.14VI.LK.07.086', 'ST/07',         4, 'team-lk', 'LK', true),
  ('ts-lk-07-086-pc05', '1.14VI.LK.07.086|PC|5', '1.14VI.LK.07.086', 'ST/07',         5, 'team-lk', 'LK', true),
  ('ts-lk-07-086-pc06', '1.14VI.LK.07.086|PC|6', '1.14VI.LK.07.086', 'ST/07',         6, 'team-lk', 'LK', true),
  ('ts-lk-07-086-pc07', '1.14VI.LK.07.086|PC|7', '1.14VI.LK.07.086', 'ST/07',         7, 'team-lk', 'LK', true),
  ('ts-lk-07-086-pc08', '1.14VI.LK.07.086|PC|8', '1.14VI.LK.07.086', 'ST/07',         8, 'team-lk', 'LK', true)
ON CONFLICT (id) DO UPDATE SET
  section_code = EXCLUDED.section_code,
  lot_id = EXCLUDED.lot_id,
  lot_name = EXCLUDED.lot_name,
  section_no = EXCLUDED.section_no,
  team_id = EXCLUDED.team_id;

-- SELECT count(*) FROM v_tapping_sections WHERE lot_code LIKE '1.14VI.LK.17.108%';
-- SELECT lot_code, section_no FROM v_tapping_sections WHERE team_id = 'team-lk' ORDER BY lot_code, section_no;
