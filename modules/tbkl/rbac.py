"""RBAC app TBKL — RBAC chức năng + phạm vi phòng ban.

Mô hình:
- can_admin (tbkl:*)     → full quyền
- can_planning           → tbkl:view + thuộc Phòng KH (PDF, kế hoạch, xác nhận PKH)
- can_manage (tbkl:manage) → Phòng NV: giao việc, chốt báo cáo
- can_report + owner unit → đơn vị TH báo cáo tuần
"""
from __future__ import annotations

import os

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


def can_admin(ctx: UserContext, supabase=None) -> bool:
    """Quản trị TBKL — full quyền (tbkl:* hoặc global admin)."""
    if ctx.is_global_admin:
        return True
    return has_permission_with_overrides(ctx, 'tbkl:*', supabase, APP_ID)


def is_planning_department(ctx: UserContext, supabase=None) -> bool:
    """Phòng Kế hoạch chủ trì — mã phòng ban (TBKL_PLANNING_DEPT_IDS) hoặc tên."""
    dept_id = str(user_department_id(ctx) or '').strip()
    configured = os.getenv('TBKL_PLANNING_DEPT_IDS', 'dl-5,KHKD').strip()
    if configured and dept_id:
        allowed = {x.strip() for x in configured.split(',') if x.strip()}
        if dept_id in allowed:
            return True
    name = (user_department_name(ctx, supabase) or '').lower()
    if not name:
        return False
    return 'kế hoạch' in name or 'ke hoach' in name


def can_planning(ctx: UserContext, supabase=None) -> bool:
    """Phòng KH: PDF, bảng kế hoạch, xác nhận tiến độ PKH, tạo cuộc họp."""
    if can_admin(ctx, supabase):
        return True
    return can_view(ctx, supabase) and is_planning_department(ctx, supabase)


def can_update_attachments(ctx: UserContext, supabase=None) -> bool:
    return can_planning(ctx, supabase)


def can_confirm(ctx: UserContext, supabase=None) -> bool:
    return can_planning(ctx, supabase)


def can_manage(ctx: UserContext, supabase=None) -> bool:
    """Role Phòng NV — tbkl:manage (không tự động theo phòng ban)."""
    if can_admin(ctx, supabase):
        return True
    return has_permission_with_overrides(ctx, 'tbkl:manage', supabase, APP_ID)


def can_operate(ctx: UserContext, supabase=None) -> bool:
    """Thao tác nghiệp vụ chung: admin, Phòng KH, hoặc Phòng NV."""
    return (
        can_admin(ctx, supabase)
        or can_planning(ctx, supabase)
        or can_manage(ctx, supabase)
    )


def can_assign(ctx: UserContext, supabase=None) -> bool:
    if can_admin(ctx, supabase):
        return True
    return (
        has_permission_with_overrides(ctx, 'tbkl:assign', supabase, APP_ID)
        or can_manage(ctx, supabase)
    )


def can_report(ctx: UserContext, supabase=None) -> bool:
    if can_admin(ctx, supabase):
        return True
    return has_permission_with_overrides(ctx, 'tbkl:report', supabase, APP_ID)


def can_lock(ctx: UserContext, supabase=None) -> bool:
    if can_admin(ctx, supabase):
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
    """Đơn vị TH — chỉ báo cáo đầu việc thuộc phòng ban mình."""
    if can_admin(ctx, supabase):
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
    """Chế độ xem đơn vị — chỉ báo cáo, không quản lý toàn Viện."""
    if can_admin(ctx, supabase) or can_planning(ctx, supabase) or can_manage(ctx, supabase):
        return False
    return can_report(ctx, supabase)
