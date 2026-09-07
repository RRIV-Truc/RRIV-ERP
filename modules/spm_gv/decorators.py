# -*- coding: utf-8 -*-
from __future__ import annotations

from functools import wraps

from flask import jsonify, request

from modules.meetings.rbac import load_user_context
from modules.spm_gv.rbac import can_enter


def _resolve_username() -> str:
    username = (
        request.headers.get("X-RRIV-Username")
        or request.args.get("username")
        or (request.json or {}).get("username")
        or ""
    )
    return username.strip().lower()


def _supabase():
    from flask import current_app
    return current_app.config["SUPABASE_CLIENT"]


def require_spm_auth(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        from modules.spm_gv import schema as schema_mod
        sb = _supabase()
        schema_mod.ensure_schema()
        ctx = load_user_context(sb, _resolve_username())
        if not ctx:
            return jsonify({"success": False, "message": "Chua dang nhap"}), 401
        if not can_enter(ctx, sb):
            return jsonify({
                "success": False,
                "message": "App chi danh cho can bo Trung tam NCPT San pham moi",
            }), 403
        request.spm_user = ctx  # type: ignore[attr-defined]
        return f(*args, **kwargs)
    return wrapped
