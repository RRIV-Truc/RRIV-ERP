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
