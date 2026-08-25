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


def unit_can_edit_task(ctx: UserContext, task: dict) -> bool:
    if can_manage(ctx):
        return True
    if not can_report(ctx):
        return False
    dept = user_department_id(ctx)
    if not dept:
        return False
    owner = task.get('owner_unit_id') or ''
    return str(owner) == str(dept)
