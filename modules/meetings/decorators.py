"""Flask decorators — RBAC 3 tầng cho API phonghop."""
from __future__ import annotations

from functools import wraps

from flask import jsonify, request

from modules.meetings.rbac import (
    APP_ID,
    UserContext,
    can_create_meeting,
    has_permission_with_overrides,
    is_meeting_participant,
    load_user_context,
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


def _get_user_context() -> UserContext | None:
    supabase = _get_supabase()
    return load_user_context(supabase, _resolve_username())


def require_auth(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        ctx = _get_user_context()
        if not ctx:
            return jsonify({'success': False, 'message': 'Thiếu hoặc không hợp lệ username'}), 401
        request.meetings_user = ctx  # type: ignore[attr-defined]
        return f(*args, **kwargs)
    return wrapped


def require_meeting_permission(permission: str):
    def decorator(f):
        @wraps(f)
        @require_auth
        def wrapped(*args, **kwargs):
            ctx = request.meetings_user  # type: ignore[attr-defined]
            supabase = _get_supabase()
            if not has_permission_with_overrides(ctx, permission, supabase, APP_ID):
                return jsonify({
                    'success': False,
                    'message': f'Không có quyền: {permission}',
                }), 403
            return f(*args, **kwargs)
        return wrapped
    return decorator


def require_meeting_manager(f):
    """Chỉ admin/manager app phonghop (hoặc global admin)."""
    @wraps(f)
    @require_auth
    def wrapped(*args, **kwargs):
        ctx = request.meetings_user  # type: ignore[attr-defined]
        supabase = _get_supabase()
        if not can_create_meeting(ctx, supabase):
            return jsonify({
                'success': False,
                'message': 'Chỉ Manager hoặc Admin mới được tạo/sửa cuộc họp',
            }), 403
        return f(*args, **kwargs)
    return wrapped


def require_meeting_participant(meeting_id_param: str = 'meeting_id'):
    def decorator(f):
        @wraps(f)
        @require_auth
        def wrapped(*args, **kwargs):
            ctx = request.meetings_user  # type: ignore[attr-defined]
            meeting_id = kwargs.get(meeting_id_param) or request.view_args.get(meeting_id_param)
            if not meeting_id:
                return jsonify({'success': False, 'message': 'Thiếu meeting_id'}), 400
            supabase = _get_supabase()
            if not is_meeting_participant(supabase, str(meeting_id), ctx):
                if not can_create_meeting(ctx, supabase):
                    return jsonify({
                        'success': False,
                        'message': 'Bạn không nằm trong danh sách tham dự cuộc họp này',
                    }), 403
            return f(*args, **kwargs)
        return wrapped
    return decorator
