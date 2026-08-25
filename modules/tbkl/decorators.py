"""Flask decorators — API TBKL."""
from __future__ import annotations

from functools import wraps

from flask import jsonify, request

from modules.meetings.rbac import UserContext, load_user_context
from modules.tbkl.rbac import can_manage, can_report, can_view


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


def require_tbkl_manage(f):
    @wraps(f)
    @require_tbkl_auth
    def wrapped(*args, **kwargs):
        ctx = request.tbkl_user  # type: ignore[attr-defined]
        supabase = _get_supabase()
        if not can_manage(ctx, supabase):
            return jsonify({'success': False, 'message': 'Chỉ Phòng NV / quản trị mới thao tác này'}), 403
        return f(*args, **kwargs)
    return wrapped


def require_tbkl_report(f):
    @wraps(f)
    @require_tbkl_auth
    def wrapped(*args, **kwargs):
        ctx = request.tbkl_user  # type: ignore[attr-defined]
        supabase = _get_supabase()
        if not (can_report(ctx, supabase) or can_manage(ctx, supabase)):
            return jsonify({'success': False, 'message': 'Không có quyền báo cáo tiến độ'}), 403
        return f(*args, **kwargs)
    return wrapped
