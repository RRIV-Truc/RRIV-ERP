"""Decorators — thao tác chỉ dành cho admin hệ thống."""
from __future__ import annotations

from functools import wraps

from flask import jsonify, request

from modules.meetings.rbac import load_user_context


def resolve_api_username() -> str:
    return (
        request.headers.get("X-RRIV-Username")
        or request.args.get("username")
        or (request.json or {}).get("username")
        or ""
    ).strip().lower()


def require_global_admin(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        from flask import current_app

        username = resolve_api_username()
        if not username:
            return jsonify({"success": False, "message": "Thiếu username"}), 401

        supabase = current_app.config["SUPABASE_CLIENT"]
        ctx = load_user_context(supabase, username)
        if not ctx or not ctx.is_global_admin:
            return jsonify({"success": False, "message": "Chỉ admin hệ thống mới thao tác này"}), 403

        request.admin_user = ctx  # type: ignore[attr-defined]
        return f(*args, **kwargs)

    return wrapped
