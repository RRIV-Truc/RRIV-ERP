"""Flask routes — /api/tbkl/*"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from modules.tbkl.decorators import require_tbkl_auth, require_tbkl_manage, require_tbkl_report
from modules.tbkl import service as svc
from modules.tbkl.rbac import can_assign, can_lock, can_manage, can_report

tbkl_bp = Blueprint('tbkl', __name__)


def _supabase():
    from flask import current_app
    return current_app.config['SUPABASE_CLIENT']


def _ctx():
    return request.tbkl_user  # type: ignore[attr-defined]


@tbkl_bp.route('/api/tbkl/context', methods=['GET'])
@require_tbkl_auth
def api_tbkl_context():
    ctx = _ctx()
    sb = _supabase()
    return jsonify({
        'success': True,
        'user': {'username': ctx.username, 'department_id': ctx.department_id},
        'permissions': {
            'can_manage': can_manage(ctx, sb),
            'can_assign': can_assign(ctx, sb),
            'can_report': can_report(ctx, sb),
            'can_lock': can_lock(ctx, sb),
        },
    })


@tbkl_bp.route('/api/tbkl/cycles', methods=['GET'])
@require_tbkl_auth
def api_list_cycles():
    try:
        items = svc.list_cycles(_supabase())
        return jsonify({'success': True, 'cycles': items})
    except Exception as exc:
        print(f'api_list_cycles: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/cycles', methods=['POST'])
@require_tbkl_manage
def api_create_cycle():
    try:
        doc = svc.create_cycle(_supabase(), _ctx(), request.json or {})
        return jsonify({'success': True, 'cycle': doc}), 201
    except Exception as exc:
        print(f'api_create_cycle: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/cycles/<cycle_id>/dashboard', methods=['GET'])
@require_tbkl_auth
def api_dashboard(cycle_id):
    try:
        data = svc.build_dashboard(_supabase(), _ctx(), cycle_id)
        return jsonify({'success': True, **data})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_dashboard: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/cycles/<cycle_id>/directives', methods=['POST'])
@require_tbkl_manage
def api_create_directive(cycle_id):
    try:
        doc = svc.create_directive(_supabase(), _ctx(), cycle_id, request.json or {})
        return jsonify({'success': True, 'directive': doc}), 201
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        print(f'api_create_directive: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/directives/<directive_id>/tasks', methods=['POST'])
@require_tbkl_manage
def api_create_task(directive_id):
    try:
        doc = svc.create_task(_supabase(), _ctx(), directive_id, request.json or {})
        return jsonify({'success': True, 'task': doc}), 201
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        print(f'api_create_task: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/tasks/<task_id>/reports', methods=['POST'])
@require_tbkl_report
def api_submit_report(task_id):
    try:
        doc = svc.submit_report(_supabase(), _ctx(), task_id, request.json or {})
        return jsonify({'success': True, 'report': doc})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        print(f'api_submit_report: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/cycles/<cycle_id>/lock', methods=['POST'])
@require_tbkl_manage
def api_lock_cycle(cycle_id):
    try:
        result = svc.lock_cycle_reports(_supabase(), _ctx(), cycle_id)
        return jsonify({'success': True, **result})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except Exception as exc:
        print(f'api_lock_cycle: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500
