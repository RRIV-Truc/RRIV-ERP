-- Seed RBAC app TBKL — Theo dõi kết luận họp
INSERT INTO app_registry (
  app_id, name, scope_type, hub_enabled, assignable, sort_order, metadata
) VALUES (
  'tbkl',
  'Theo dõi KL họp',
  'department',
  true,
  true,
  26,
  '{"module": "tbkl", "features": ["directives", "weekly_reports", "dashboard"]}'::jsonb
)
ON CONFLICT (app_id) DO UPDATE SET
  name = EXCLUDED.name,
  scope_type = EXCLUDED.scope_type,
  hub_enabled = EXCLUDED.hub_enabled,
  assignable = EXCLUDED.assignable,
  sort_order = EXCLUDED.sort_order,
  metadata = app_registry.metadata || EXCLUDED.metadata,
  updated_at = now();

INSERT INTO role_definitions (
  id, role_id, name, permissions, metadata,
  app_id, role_name, description, is_active, scope_type, scopeable, sort_order, updated_at
) VALUES
  (
    'tbkl_admin', 'tbkl_admin', 'Quản trị TBKL',
    '["tbkl:*"]'::jsonb,
    '{"app_id":"tbkl","role_id":"admin","is_active":true}'::jsonb,
    'tbkl', 'Quản trị TBKL', 'Toàn quyền theo dõi kết luận họp',
    true, 'all', '{}'::jsonb, 10, now()
  ),
  (
    'tbkl_office', 'tbkl_office', 'Phòng nghiệp vụ',
    '["tbkl:view","tbkl:manage","tbkl:assign","tbkl:lock"]'::jsonb,
    '{"app_id":"tbkl","role_id":"office","is_active":true}'::jsonb,
    'tbkl', 'Phòng nghiệp vụ', 'Tách kết luận, giao việc, chốt báo cáo tuần',
    true, 'department', '{"byDepartment":true}'::jsonb, 20, now()
  ),
  (
    'tbkl_leader', 'tbkl_leader', 'Ban lãnh đạo',
    '["tbkl:view","tbkl:manage"]'::jsonb,
    '{"app_id":"tbkl","role_id":"leader","is_active":true}'::jsonb,
    'tbkl', 'Ban lãnh đạo', 'Xem toàn Viện, giám sát đơn vị',
    true, 'all', '{}'::jsonb, 30, now()
  ),
  (
    'tbkl_unit', 'tbkl_unit', 'Đơn vị thực hiện',
    '["tbkl:view","tbkl:report"]'::jsonb,
    '{"app_id":"tbkl","role_id":"unit","is_active":true}'::jsonb,
    'tbkl', 'Đơn vị thực hiện', 'Cập nhật tiến độ tuần cho việc được giao',
    true, 'department', '{"byDepartment":true}'::jsonb, 40, now()
  ),
  (
    'tbkl_viewer', 'tbkl_viewer', 'Xem báo cáo',
    '["tbkl:view"]'::jsonb,
    '{"app_id":"tbkl","role_id":"viewer","is_active":true}'::jsonb,
    'tbkl', 'Xem báo cáo', 'Chỉ xem dashboard tổng hợp',
    true, 'all', '{}'::jsonb, 50, now()
  )
ON CONFLICT (id) DO UPDATE SET
  permissions = EXCLUDED.permissions,
  role_name = EXCLUDED.role_name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  updated_at = now();
