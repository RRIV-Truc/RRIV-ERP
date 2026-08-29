"""Flask decorators — API TBKL."""
from __future__ import annotations

from functools import wraps

from flask import jsonify, request

from modules.meetings.rbac import UserContext, load_user_context
from modules.tbkl.rbac import (
    can_admin,
    can_assess_directive,
    can_confirm_directive,
    can_lock,
    can_operate,
    can_planning,
    can_report,
    can_update_attachments,
    can_view,
    unit_can_edit_task,
)


def _resolve_username() -> str:
    username = (
        request.headers.get('X-RRIV-Username')
        or request.args.get('username')
        or (request.json or {}).get('username')
        or ''
    )
    return username.strip().lower()


def _get_supabase():
    from flask import current_app
    return current_app.config['SUPABASE_CLIENT']


def require_tbkl_auth(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        supabase = _get_supabase()
        ctx = load_user_context(supabase, _resolve_username())
        if not ctx:
            return jsonify({'success': False, 'message': 'Thiếu hoặc không hợp lệ username'}), 401
        if not can_view(ctx, supabase):
            return jsonify({'success': False, 'message': 'Không có quyền truy cập app TBKL'}), 403
        request.tbkl_user = ctx  # type: ignore[attr-defined]
        return f(*args, **kwargs)
    return wrapped


def require_tbkl_admin(f):
    """Full quyền — chỉ tbkl:* / global admin."""
    @wraps(f)
    @require_tbkl_auth
    def wrapped(*args, **kwargs):
        ctx = request.tbkl_user  # type: ignore[attr-defined]
        supabase = _get_supabase()
        if not can_admin(ctx, supabase):
            return jsonify({'success': False, 'message': 'Chỉ quản trị TBKL mới thao tác này'}), 403
        return f(*args, **kwargs)
    return wrapped


def require_tbkl_planning(f):
    """Phòng KH chủ trì — admin hoặc cán bộ thuộc phòng KH (có tbkl:view)."""
    @wraps(f)
    @require_tbkl_auth
    def wrapped(*args, **kwargs):
        ctx = request.tbkl_user  # type: ignore[attr-defined]
        supabase = _get_supabase()
        if not can_planning(ctx, supabase):
            return jsonify({
                'success': False,
                'message': 'Chỉ quản trị hoặc Phòng Kế hoạch mới thực hiện thao tác này',
            }), 403
        return f(*args, **kwargs)
    return wrapped


def require_tbkl_operate(f):
    """Nghiệp vụ chung — admin, Phòng KH, hoặc Phòng NV."""
    @wraps(f)
    @require_tbkl_auth
    def wrapped(*args, **kwargs):
        ctx = request.tbkl_user  # type: ignore[attr-defined]
        supabase = _get_supabase()
        if not can_operate(ctx, supabase):
            return jsonify({'success': False, 'message': 'Không có quyền thao tác nghiệp vụ TBKL'}), 403
        return f(*args, **kwargs)
    return wrapped


def require_tbkl_manage(f):
    """Giữ tên cũ — map sang can_operate."""
    return require_tbkl_operate(f)


def require_tbkl_lock(f):
    @wraps(f)
    @require_tbkl_auth
    def wrapped(*args, **kwargs):
        ctx = request.tbkl_user  # type: ignore[attr-defined]
        supabase = _get_supabase()
        if not can_lock(ctx, supabase):
            return jsonify({'success': False, 'message': 'Không có quyền chốt báo cáo tuần'}), 403
        return f(*args, **kwargs)
    return wrapped


def require_tbkl_attachments(f):
    """Cập nhật PDF / file đính kèm."""
    @wraps(f)
    @require_tbkl_auth
    def wrapped(*args, **kwargs):
        ctx = request.tbkl_user  # type: ignore[attr-defined]
        supabase = _get_supabase()
        if not can_update_attachments(ctx, supabase):
            return jsonify({
                'success': False,
                'message': 'Chỉ quản trị hoặc Phòng Kế hoạch mới cập nhật văn bản PDF',
            }), 403
        return f(*args, **kwargs)
    return wrapped


def require_tbkl_report(f):
    @wraps(f)
    @require_tbkl_auth
    def wrapped(*args, **kwargs):
        ctx = request.tbkl_user  # type: ignore[attr-defined]
        supabase = _get_supabase()
        if not can_report(ctx, supabase):
            return jsonify({'success': False, 'message': 'Không có quyền báo cáo tiến độ'}), 403
        return f(*args, **kwargs)
    return wrapped


def require_tbkl_assess_directive(f):
    """Phòng KHCN đánh giá tiến độ mục lớn."""
    @wraps(f)
    @require_tbkl_auth
    def wrapped(*args, **kwargs):
        ctx = request.tbkl_user  # type: ignore[attr-defined]
        supabase = _get_supabase()
        if not can_assess_directive(ctx, supabase):
            return jsonify({
                'success': False,
                'message': 'Chỉ quản trị hoặc Phòng KHCN mới đánh giá mục lớn',
            }), 403
        return f(*args, **kwargs)
    return wrapped


def require_tbkl_confirm_directive(f):
    """Viện trưởng / Thư ký xác nhận mục lớn."""
    @wraps(f)
    @require_tbkl_auth
    def wrapped(*args, **kwargs):
        ctx = request.tbkl_user  # type: ignore[attr-defined]
        supabase = _get_supabase()
        if not can_confirm_directive(ctx, supabase):
            return jsonify({
                'success': False,
                'message': 'Chỉ Viện trưởng, Thư ký hoặc Ban lãnh đạo mới xác nhận mục lớn',
            }), 403
        return f(*args, **kwargs)
    return wrapped
