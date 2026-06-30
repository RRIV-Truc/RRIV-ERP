-- =============================================================================
-- RRIV ERP — Seed RBAC app Phòng họp (phonghop)
-- Chạy SAU: migrate-role-definitions-erp.sql, schema-meetings.sql
--
-- Hoặc chạy: python scripts/seed_role_definitions.py
--            (sau khi cập nhật data/role-definitions-seed.json)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Đăng ký app trên Hub / ma trận phân quyền
-- hub_enabled = true — hiển thị trên màn hình Hub
-- -----------------------------------------------------------------------------
INSERT INTO app_registry (
  app_id, name, scope_type, hub_enabled, assignable, sort_order, metadata
) VALUES (
  'phonghop',
  'Phòng họp',
  'department',
  true,
  true,
  25,
  '{"module": "meetings", "features": ["internal", "hybrid", "physical_rooms"]}'::jsonb
)
ON CONFLICT (app_id) DO UPDATE SET
  name        = EXCLUDED.name,
  scope_type  = EXCLUDED.scope_type,
  assignable  = EXCLUDED.assignable,
  sort_order  = EXCLUDED.sort_order,
  metadata    = app_registry.metadata || EXCLUDED.metadata,
  updated_at  = now();

-- -----------------------------------------------------------------------------
-- 2. Role definitions — permissions JSONB array
-- Quy tắc nghiệp vụ:
--   meeting:create  → admin, manager (tầng app)
--   meeting:view    → participant check bổ sung ở API (meeting_participants)
-- -----------------------------------------------------------------------------
INSERT INTO role_definitions (
  id, role_id, name, permissions, metadata,
  app_id, role_name, description, is_active, scope_type, scopeable, sort_order, updated_at
) VALUES
  (
    'phonghop_admin',
    'phonghop_admin',
    'Quản trị app',
    '["meeting:*", "room:*"]'::jsonb,
    jsonb_build_object(
      'app_id', 'phonghop', 'role_id', 'admin',
      'role_name', 'Quản trị app',
      'description', 'Toàn quyền phòng họp & quản lý phòng vật lý',
      'scope_type', 'all', 'sort_order', 10, 'is_active', true,
      'permissions', '["meeting:*", "room:*"]'::jsonb
    ),
    'phonghop', 'Quản trị app',
    'Toàn quyền phòng họp & quản lý phòng vật lý',
    true, 'all', '{}'::jsonb, 10, now()
  ),
  (
    'phonghop_manager',
    'phonghop_manager',
    'Quản lý phòng',
    '["meeting:create", "meeting:edit", "meeting:cancel", "meeting:view", "meeting:join", "room:view", "room:book"]'::jsonb,
    jsonb_build_object(
      'app_id', 'phonghop', 'role_id', 'manager',
      'role_name', 'Quản lý phòng',
      'description', 'Tạo & quản lý cuộc họp trong phạm vi phòng ban',
      'scope_type', 'department', 'sort_order', 20, 'is_active', true,
      'scopeable', '{"byDepartment": true}'::jsonb,
      'permissions', '["meeting:create", "meeting:edit", "meeting:cancel", "meeting:view", "meeting:join", "room:view", "room:book"]'::jsonb
    ),
    'phonghop', 'Quản lý phòng',
    'Tạo & quản lý cuộc họp trong phạm vi phòng ban',
    true, 'department', '{"byDepartment": true}'::jsonb, 20, now()
  ),
  (
    'phonghop_staff',
    'phonghop_staff',
    'Nhân viên',
    '["meeting:view", "meeting:join", "room:view"]'::jsonb,
    jsonb_build_object(
      'app_id', 'phonghop', 'role_id', 'staff',
      'role_name', 'Nhân viên',
      'description', 'Tham gia cuộc họp được mời — không tạo cuộc họp mới',
      'scope_type', 'department', 'sort_order', 30, 'is_active', true,
      'scopeable', '{"byDepartment": true}'::jsonb,
      'permissions', '["meeting:view", "meeting:join", "room:view"]'::jsonb
    ),
    'phonghop', 'Nhân viên',
    'Tham gia cuộc họp được mời — không tạo cuộc họp mới',
    true, 'department', '{"byDepartment": true}'::jsonb, 30, now()
  ),
  (
    'phonghop_viewer',
    'phonghop_viewer',
    'Chỉ xem',
    '["meeting:view", "room:view"]'::jsonb,
    jsonb_build_object(
      'app_id', 'phonghop', 'role_id', 'viewer',
      'role_name', 'Chỉ xem',
      'description', 'Xem lịch phòng & cuộc họp được mời',
      'scope_type', 'department', 'sort_order', 40, 'is_active', true,
      'scopeable', '{"byDepartment": true}'::jsonb,
      'permissions', '["meeting:view", "room:view"]'::jsonb
    ),
    'phonghop', 'Chỉ xem',
    'Xem lịch phòng & cuộc họp được mời',
    true, 'department', '{"byDepartment": true}'::jsonb, 40, now()
  )
ON CONFLICT (id) DO UPDATE SET
  role_id     = EXCLUDED.role_id,
  name        = EXCLUDED.name,
  permissions = EXCLUDED.permissions,
  metadata    = EXCLUDED.metadata,
  app_id      = EXCLUDED.app_id,
  role_name   = EXCLUDED.role_name,
  description = EXCLUDED.description,
  is_active   = EXCLUDED.is_active,
  scope_type  = EXCLUDED.scope_type,
  scopeable   = EXCLUDED.scopeable,
  sort_order  = EXCLUDED.sort_order,
  updated_at  = now();

-- Đồng bộ unique index (app_id, role_id) nếu cột role_id doc-style
UPDATE role_definitions
SET role_id = app_id || '_' || (metadata->>'role_id')
WHERE app_id = 'phonghop'
  AND metadata->>'role_id' IS NOT NULL
  AND role_id NOT LIKE 'phonghop_%';
