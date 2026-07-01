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
