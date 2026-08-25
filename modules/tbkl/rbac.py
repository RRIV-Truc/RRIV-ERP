"""RBAC app TBKL — tái sử dụng logic phân quyền ERP."""
from __future__ import annotations

from modules.meetings.rbac import (
    UserContext,
    get_effective_app_data,
    has_permission_with_overrides,
    load_user_context,
    permission_matches,
)

APP_ID = 'tbkl'


def can_view(ctx: UserContext, supabase=None) -> bool:
    if ctx.is_global_admin:
        return True
    return has_permission_with_overrides(ctx, 'tbkl:view', supabase, APP_ID)


def can_manage(ctx: UserContext, supabase=None) -> bool:
    if ctx.is_global_admin:
        return True
    return (
        has_permission_with_overrides(ctx, 'tbkl:manage', supabase, APP_ID)
        or has_permission_with_overrides(ctx, 'tbkl:*', supabase, APP_ID)
    )


def can_assign(ctx: UserContext, supabase=None) -> bool:
    if ctx.is_global_admin:
        return True
    return (
        has_permission_with_overrides(ctx, 'tbkl:assign', supabase, APP_ID)
        or can_manage(ctx, supabase)
    )


def can_report(ctx: UserContext, supabase=None) -> bool:
    if ctx.is_global_admin:
        return True
    return has_permission_with_overrides(ctx, 'tbkl:report', supabase, APP_ID)


def can_lock(ctx: UserContext, supabase=None) -> bool:
    if ctx.is_global_admin:
        return True
    return (
        has_permission_with_overrides(ctx, 'tbkl:lock', supabase, APP_ID)
        or can_manage(ctx, supabase)
    )


def user_department_id(ctx: UserContext) -> str | None:
    return ctx.department_id


def _norm_unit_label(value: str) -> str:
    return ''.join(c for c in str(value or '').lower() if c.isalnum())


def user_department_name(ctx: UserContext, supabase=None) -> str | None:
    cached = getattr(ctx, '_department_name', None)
    if cached:
        return cached
    dept_id = user_department_id(ctx)
    if not dept_id or supabase is None:
        return None
    try:
        res = supabase.table('category_departments').select('name').eq(
            'id', dept_id
        ).limit(1).execute()
        if res.data:
            name = (res.data[0].get('name') or '').strip() or None
            ctx._department_name = name  # type: ignore[attr-defined]
            return name
    except Exception as exc:
        print(f'[tbkl.rbac] user_department_name: {exc}')
    return None


def unit_can_edit_task(ctx: UserContext, task: dict, supabase=None) -> bool:
    if can_manage(ctx, supabase):
        return True
    if not can_report(ctx, supabase):
        return False
    dept_id = user_department_id(ctx)
    owner_id = task.get('owner_unit_id') or ''
    if dept_id and owner_id and str(owner_id) == str(dept_id):
        return True
    dept_name = user_department_name(ctx, supabase)
    owner_name = (task.get('owner_unit_name') or '').strip()
    if dept_name and owner_name:
        nd = _norm_unit_label(dept_name)
        no = _norm_unit_label(owner_name)
        if nd and no and (nd in no or no in nd or nd == no):
            return True
    return False


def is_unit_reporter_only(ctx: UserContext, supabase=None) -> bool:
    """Đơn vị TH — được báo cáo, không quản lý toàn Viện."""
    if ctx.is_global_admin:
        return False
    return can_report(ctx, supabase) and not can_manage(ctx, supabase)
