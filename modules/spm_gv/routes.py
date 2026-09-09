# -*- coding: utf-8 -*-
from __future__ import annotations

from flask import Blueprint, jsonify, request

from modules.spm_gv.decorators import require_spm_auth
from modules.spm_gv import rbac
from modules.spm_gv import service as svc

spmgv_bp = Blueprint("spmgv", __name__)


def _sb():
    from flask import current_app
    return current_app.config["SUPABASE_CLIENT"]


def _ctx():
    return request.spm_user  # type: ignore[attr-defined]


@spmgv_bp.route("/api/spm-gv/context", methods=["GET"])
@require_spm_auth
def api_context():
    sb, ctx = _sb(), _ctx()
    try:
        staff = svc.bootstrap_director(sb, ctx)
        perms = svc.permissions_payload(ctx, sb)
        if staff:
            perms["full_name"] = staff.get("full_name") or perms.get("full_name")
            perms["role"] = staff.get("role") or perms.get("role")
            perms["department_id"] = staff.get("department_id") or perms.get("department_id")
        week = svc.ensure_current_week(sb, ctx)
        return jsonify({
            "success": True,
            "user": {
                "username": ctx.username,
                "full_name": perms.get("full_name"),
                "department_id": perms.get("department_id"),
            },
            "permissions": perms,
            "departments": svc.list_departments(sb),
            "staff": svc.list_staff(sb),
            "current_week": week,
        })
    except Exception as exc:
        print("spm context", exc)
        return jsonify({"success": False, "message": str(exc)}), 500


@spmgv_bp.route("/api/spm-gv/staff", methods=["GET"])
@require_spm_auth
def api_staff_list():
    return jsonify({"success": True, "staff": svc.list_staff(_sb())})


@spmgv_bp.route("/api/spm-gv/staff", methods=["POST"])
@require_spm_auth
def api_staff_upsert():
    ctx, sb = _ctx(), _sb()
    if not rbac.can_assign_center(ctx, sb):
        return jsonify({"success": False, "message": "Chi Giam doc them/sua can bo Trung tam"}), 403
    try:
        row = svc.upsert_staff(sb, request.json or {})
        return jsonify({"success": True, "staff": row})
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@spmgv_bp.route("/api/spm-gv/weeks", methods=["GET"])
@require_spm_auth
def api_weeks():
    try:
        svc.ensure_current_week(_sb(), _ctx())
        return jsonify({"success": True, "weeks": svc.list_weeks(_sb())})
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 500


@spmgv_bp.route("/api/spm-gv/weeks", methods=["POST"])
@require_spm_auth
def api_week_create():
    ctx, sb = _ctx(), _sb()
    if not rbac.can_assign_center(ctx, sb) and not rbac.can_assign_dept(ctx, sb):
        return jsonify({"success": False, "message": "Khong co quyen tao tuan"}), 403
    try:
        week = svc.create_week(sb, ctx, request.json or {})
        return jsonify({"success": True, "week": week}), 201
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@spmgv_bp.route("/api/spm-gv/weeks/<week_id>/board", methods=["GET"])
@require_spm_auth
def api_board(week_id):
    level = (request.args.get("level") or "center").strip()
    if level not in ("center", "dept"):
        level = "center"
    try:
        data = svc.board(_sb(), _ctx(), week_id, level)
        return jsonify({"success": True, **data})
    except Exception as exc:
        print("spm board", exc)
        return jsonify({"success": False, "message": str(exc)}), 500


@spmgv_bp.route("/api/spm-gv/unread", methods=["GET"])
@require_spm_auth
def api_unread():
    since = (request.args.get("since") or "").strip() or None
    try:
        data = svc.unread_payload(_sb(), _ctx(), since)
        return jsonify({"success": True, **data})
    except Exception as exc:
        print("spm unread", exc)
        return jsonify({"success": False, "message": str(exc), "count": 0, "items": []}), 500


@spmgv_bp.route("/api/spm-gv/unread/seen", methods=["POST"])
@require_spm_auth
def api_unread_seen():
    try:
        seen_at = svc.mark_seen(_sb(), _ctx().username)
        return jsonify({"success": True, "last_seen_at": seen_at, "count": 0})
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@spmgv_bp.route("/api/spm-gv/tasks", methods=["POST"])
@require_spm_auth
def api_task_create():
    try:
        task = svc.create_task(_sb(), _ctx(), request.json or {})
        return jsonify({"success": True, "task": task}), 201
    except PermissionError as exc:
        return jsonify({"success": False, "message": str(exc)}), 403
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@spmgv_bp.route("/api/spm-gv/tasks/<task_id>", methods=["PATCH"])
@require_spm_auth
def api_task_update(task_id):
    try:
        task = svc.update_task(_sb(), _ctx(), task_id, request.json or {})
        return jsonify({"success": True, "task": task})
    except PermissionError as exc:
        return jsonify({"success": False, "message": str(exc)}), 403
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@spmgv_bp.route("/api/spm-gv/tasks/<task_id>", methods=["DELETE"])
@require_spm_auth
def api_task_delete(task_id):
    try:
        svc.delete_task(_sb(), _ctx(), task_id)
        return jsonify({"success": True})
    except PermissionError as exc:
        return jsonify({"success": False, "message": str(exc)}), 403
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@spmgv_bp.route("/api/spm-gv/tasks/<task_id>/report", methods=["POST"])
@require_spm_auth
def api_task_report(task_id):
    try:
        rep = svc.submit_report(_sb(), _ctx(), task_id, request.json or {})
        return jsonify({"success": True, "report": rep})
    except PermissionError as exc:
        return jsonify({"success": False, "message": str(exc)}), 403
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@spmgv_bp.route("/api/spm-gv/tasks/<task_id>/work-score", methods=["PUT"])
@require_spm_auth
def api_task_work_score(task_id):
    try:
        task = svc.score_work(_sb(), _ctx(), task_id, request.json or {})
        return jsonify({"success": True, "task": task})
    except PermissionError as exc:
        return jsonify({"success": False, "message": str(exc)}), 403
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@spmgv_bp.route("/api/spm-gv/leader-notes", methods=["PUT"])
@require_spm_auth
def api_leader_note():
    try:
        note = svc.upsert_leader_note(_sb(), _ctx(), request.json or {})
        return jsonify({"success": True, "note": note})
    except PermissionError as exc:
        return jsonify({"success": False, "message": str(exc)}), 403
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
