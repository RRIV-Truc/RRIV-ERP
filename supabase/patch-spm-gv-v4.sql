-- SPM giao viec v4: moc thoi diem da xem de dem viec moi
CREATE TABLE IF NOT EXISTS spm_gv_seen (
  username TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
