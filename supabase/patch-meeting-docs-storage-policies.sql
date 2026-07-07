-- Storage policies — bucket meeting-docs (private)
-- Chạy trên Supabase → SQL Editor (một lần).

DROP POLICY IF EXISTS meeting_docs_service_all ON storage.objects;
CREATE POLICY meeting_docs_service_all
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'meeting-docs')
WITH CHECK (bucket_id = 'meeting-docs');

DROP POLICY IF EXISTS meeting_docs_auth_read ON storage.objects;
CREATE POLICY meeting_docs_auth_read
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'meeting-docs');

DROP POLICY IF EXISTS meeting_docs_auth_insert ON storage.objects;
CREATE POLICY meeting_docs_auth_insert
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'meeting-docs');
