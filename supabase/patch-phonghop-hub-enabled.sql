-- Bật app Phòng họp trên Hub (chạy một lần nếu đã seed trước đó với hub_enabled = false)
UPDATE app_registry
SET hub_enabled = true, updated_at = now()
WHERE app_id = 'phonghop';
