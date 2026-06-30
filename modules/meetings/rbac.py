"""
RBAC backend — mirror logic static/js/utils/permissions.js
Tầng 1: user_accounts (identity)
Tầng 2: user_system_role → system_role
Tầng 3: employee.app_roles_cache → role_definitions permissions
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Optional

APP_ID = 'phonghop'

SUPER_ADMIN_ALIASES = frozenset({'superadmin', 'instituteexecutive'})
MEETING_MANAGER_ROLES = frozenset({'admin', 'manager'})


@dataclass
class UserContext:
    username: str
    erp_role: str = 'user'
    employee_id: Optional[str] = None
    department_id: Optional[str] = None
    system_roles: list[str] = field(default_factory=list)
    app_roles_cache: dict = field(default_factory=dict)
    is_super_admin: bool = False

    @property
    def is_global_admin(self) -> bool:
        if self.is_super_admin:
            return True
        return str(self.erp_role or '').lower() == 'admin'


def _norm_role_name(name: str) -> str:
    return str(name or '').lower().replace('_', '')


def is_super_admin(system_roles: list[str], erp_role: str = 'user') -> bool:
    if str(erp_role or '').lower() == 'admin':
        return True
    for r in system_roles or []:
        if _norm_role_name(r) in SUPER_ADMIN_ALIASES:
            return True
    return False


def permission_matches(granted: str, required: str) -> bool:
    if not granted or not required:
        return False
    if granted == required:
        return True
    if granted.endswith(':*'):
        return required.startswith(granted[:-1])
    return False


def _normalize_app_entry(entry: Any) -> dict:
    if not entry or not isinstance(entry, dict):
        return {'roles': [], 'scopes': {}, 'custom_permissions': {'granted': [], 'denied': []}}
    roles = entry.get('roles') or []
    if not isinstance(roles, list):
        roles = [roles] if roles else []
    cp = entry.get('customPermissions') or entry.get('custom_permissions') or {}
    return {
        'roles': roles,
        'scopes': entry.get('scopes') or {},
        'custom_permissions': {
            'granted': list(cp.get('granted') or []),
            'denied': list(cp.get('denied') or []),
        },
    }


def get_effective_app_data(ctx: UserContext, app_id: str = APP_ID) -> dict:
    cache = ctx.app_roles_cache if isinstance(ctx.app_roles_cache, dict) else {}
    return _normalize_app_entry(cache.get(app_id))


def collect_role_permissions(supabase, app_id: str, role_ids: list[str]) -> set[str]:
    perms: set[str] = set()
    if not role_ids:
        return perms
    try:
        res = supabase.table('role_definitions').select(
            'role_id, app_id, permissions, metadata'
        ).eq('app_id', app_id).eq('is_active', True).execute()
        defs_by_role: dict[str, list] = {}
        for row in res.data or []:
            meta = row.get('metadata') or {}
            rid = meta.get('role_id') or row.get('role_id') or ''
            if rid.startswith(f'{app_id}_'):
                rid = rid[len(app_id) + 1:]
            raw = row.get('permissions') or meta.get('permissions') or []
            if isinstance(raw, list):
                defs_by_role[rid] = raw
        for role_id in role_ids:
            for p in defs_by_role.get(role_id, []):
                perms.add(str(p))
    except Exception as exc:
        print(f'[meetings.rbac] collect_role_permissions: {exc}')
    return perms


def has_permission(ctx: UserContext, permission: str, supabase=None, app_id: str = APP_ID) -> bool:
    if ctx.is_global_admin:
        return True
    app_data = get_effective_app_data(ctx, app_id)
    role_ids = app_data.get('roles') or []
    if supabase is not None:
        role_perms = collect_role_permissions(supabase, app_id, role_ids)
    else:
        role_perms = set()
    for p in role_perms:
        if permission_matches(p, permission):
            return True
    return False


def has_permission_with_overrides(
    ctx: UserContext, permission: str, supabase=None, app_id: str = APP_ID
) -> bool:
    if ctx.is_global_admin:
        return True
    app_data = get_effective_app_data(ctx, app_id)
    denied = app_data.get('custom_permissions', {}).get('denied') or []
    for p in denied:
        if permission_matches(p, permission):
            return False
    if has_permission(ctx, permission, supabase, app_id):
        return True
    granted = app_data.get('custom_permissions', {}).get('granted') or []
    return any(permission_matches(p, permission) for p in granted)


def can_create_meeting(ctx: UserContext, supabase=None) -> bool:
    """Manager/Admin app phonghop hoặc Super_Admin / erp admin."""
    if ctx.is_global_admin:
        return True
    app_data = get_effective_app_data(ctx)
    roles = {str(r).lower() for r in (app_data.get('roles') or [])}
    if roles & MEETING_MANAGER_ROLES:
        return True
    return has_permission_with_overrides(ctx, 'meeting:create', supabase)


def load_user_context(supabase, username: str) -> Optional[UserContext]:
    username = (username or '').strip().lower()
    if not username:
        return None

    erp_role = 'user'
    employee_id = None
    department_id = None
    app_roles_cache: dict = {}
    system_roles: list[str] = []

    try:
        ua = supabase.table('user_accounts').select(
            'username, role, employee_id'
        ).eq('username', username).limit(1).execute()
        if ua.data:
            erp_role = ua.data[0].get('role') or 'user'
            employee_id = ua.data[0].get('employee_id')
    except Exception as exc:
        print(f'[meetings.rbac] user_accounts: {exc}')

    if employee_id:
        try:
            emp = supabase.table('employee').select(
                'id, department_id, app_roles_cache'
            ).eq('id', employee_id).limit(1).execute()
            if emp.data:
                row = emp.data[0]
                employee_id = str(row.get('id') or employee_id)
                department_id = row.get('department_id')
                cache = row.get('app_roles_cache')
                if isinstance(cache, dict):
                    app_roles_cache = cache
        except Exception as exc:
            print(f'[meetings.rbac] employee: {exc}')

    try:
        usr = supabase.table('user_system_role').select(
            'system_role_id'
        ).eq('username', username).execute()
        role_ids = [r.get('system_role_id') for r in (usr.data or []) if r.get('system_role_id')]
        if role_ids:
            sr = supabase.table('system_role').select('role_name').in_('id', role_ids).execute()
            system_roles = [r.get('role_name') for r in (sr.data or []) if r.get('role_name')]
    except Exception as exc:
        print(f'[meetings.rbac] system_role: {exc}')

    return UserContext(
        username=username,
        erp_role=erp_role,
        employee_id=str(employee_id) if employee_id else None,
        department_id=department_id,
        system_roles=system_roles,
        app_roles_cache=app_roles_cache,
        is_super_admin=is_super_admin(system_roles, erp_role),
    )


def is_meeting_participant(supabase, meeting_id: str, ctx: UserContext) -> bool:
    if ctx.is_global_admin:
        return True
    try:
        q = supabase.table('meeting_participants').select('id').eq('meeting_id', meeting_id)
        if ctx.employee_id:
            res = q.eq('employee_id', ctx.employee_id).limit(1).execute()
            if res.data:
                return True
        res = q.eq('username', ctx.username).limit(1).execute()
        return bool(res.data)
    except Exception as exc:
        print(f'[meetings.rbac] is_meeting_participant: {exc}')
        return False
