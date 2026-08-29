"""Flask routes — /api/tbkl/*"""
from __future__ import annotations

import json
import io

from flask import Blueprint, jsonify, request, send_file

from modules.tbkl.decorators import (
    require_tbkl_admin,
    require_tbkl_assess_directive,
    require_tbkl_attachments,
    require_tbkl_auth,
    require_tbkl_confirm_directive,
    require_tbkl_lock,
    require_tbkl_operate,
    require_tbkl_planning,
    require_tbkl_report,
)
from modules.tbkl import service as svc
from modules.tbkl import plan_service as plan_svc
from modules.tbkl import storage_service as storage_svc
from modules.tbkl.rbac import (
    can_admin,
    can_assess_directive,
    can_assign,
    can_confirm,
    can_confirm_directive,
    can_lock,
    can_manage,
    can_operate,
    can_planning,
    can_report,
    can_update_attachments,
    is_planning_department,
    is_unit_reporter_only,
    user_department_name,
)

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
        'user': {
            'username': ctx.username,
            'department_id': ctx.department_id,
            'department_name': user_department_name(ctx, sb),
        },
        'permissions': {
            'can_admin': can_admin(ctx, sb),
            'can_planning': can_planning(ctx, sb),
            'can_manage': can_manage(ctx, sb),
            'can_operate': can_operate(ctx, sb),
            'can_update_attachments': can_update_attachments(ctx, sb),
            'can_confirm': can_confirm(ctx, sb),
            'can_assess_directive': can_assess_directive(ctx, sb),
            'can_confirm_directive': can_confirm_directive(ctx, sb),
            'can_assign': can_assign(ctx, sb),
            'can_report': can_report(ctx, sb),
            'can_lock': can_lock(ctx, sb),
            'is_planning_dept': is_planning_department(ctx, sb),
            'is_unit_only': is_unit_reporter_only(ctx, sb),
        },
    })


@tbkl_bp.route('/api/tbkl/cycles', methods=['GET'])
@require_tbkl_auth
def api_list_cycles():
    try:
        items = svc.list_cycles_enriched(_supabase())
        return jsonify({'success': True, 'cycles': items})
    except Exception as exc:
        print(f'api_list_cycles: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/cycles', methods=['POST'])
@require_tbkl_planning
def api_create_cycle():
    try:
        doc = svc.create_cycle(_supabase(), _ctx(), request.json or {})
        return jsonify({'success': True, 'cycle': svc.enrich_cycle_files(doc)}), 201
    except Exception as exc:
        print(f'api_create_cycle: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/cycles/create-full', methods=['POST'])
@require_tbkl_planning
def api_create_cycle_full():
    """Tạo cuộc họp kèm PDF kết luận + bảng kế hoạch (JSON hoặc Excel)."""
    try:
        raw = request.form.get('data') or '{}'
        payload = json.loads(raw) if isinstance(raw, str) else (raw or {})
        sb = _supabase()
        ctx = _ctx()
        cycle = svc.create_cycle(sb, ctx, payload)

        pdf = request.files.get('conclusion_pdf')
        if pdf and pdf.filename:
            data = pdf.read()
            path, name = storage_svc.upload_conclusion_pdf(cycle['id'], pdf.filename, data)
            cycle = svc.update_cycle_attachments(
                sb, cycle['id'], conclusion_pdf_path=path, conclusion_pdf_name=name
            )

        plan_file = request.files.get('plan_workbook')
        plan_json_raw = request.form.get('plan_json')
        plan: dict | None = None
        if plan_json_raw:
            plan = json.loads(plan_json_raw)
        elif plan_file and plan_file.filename:
            fdata = plan_file.read()
            path, name = storage_svc.upload_plan_workbook(cycle['id'], plan_file.filename, fdata)
            cycle = svc.update_cycle_attachments(
                sb, cycle['id'], plan_workbook_path=path, plan_workbook_name=name
            )
            plan = plan_svc.parse_workbook(fdata, plan_file.filename)

        publish = request.form.get('publish_plan', '1').lower() not in ('0', 'false', 'no')
        counts = {'directive_count': 0, 'task_count': 0}
        if plan and publish:
            counts = plan_svc.publish_plan(sb, ctx, cycle['id'], plan, replace=False)

        return jsonify({
            'success': True,
            'cycle': svc.enrich_cycle_files(cycle),
            **counts,
        }), 201
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        print(f'api_create_cycle_full: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/cycles/<cycle_id>/conclusion-pdf', methods=['GET'])
@require_tbkl_auth
def api_conclusion_pdf_url(cycle_id):
    try:
        cycle = svc.get_cycle(_supabase(), cycle_id)
        if not cycle:
            return jsonify({'success': False, 'message': 'Không tìm thấy cuộc họp'}), 404
        url = svc.conclusion_pdf_url(cycle)
        if not url:
            return jsonify({'success': False, 'message': 'Chưa có PDF kết luận'}), 404
        return jsonify({
            'success': True,
            'url': url,
            'name': cycle.get('conclusion_pdf_name') or 'TB-ket-luan.pdf',
        })
    except Exception as exc:
        print(f'api_conclusion_pdf_url: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/cycles/<cycle_id>/attachments', methods=['POST'])
@require_tbkl_attachments
def api_upload_cycle_attachments(cycle_id):
    try:
        sb = _supabase()
        cycle = svc.get_cycle(sb, cycle_id)
        if not cycle:
            return jsonify({'success': False, 'message': 'Không tìm thấy cuộc họp'}), 404

        pdf = request.files.get('conclusion_pdf')
        plan_file = request.files.get('plan_workbook')
        if not (pdf and pdf.filename) and not (plan_file and plan_file.filename):
            return jsonify({'success': False, 'message': 'Chọn file PDF hoặc Excel cần cập nhật'}), 400
        if pdf and pdf.filename:
            data = pdf.read()
            path, name = storage_svc.upload_conclusion_pdf(cycle_id, pdf.filename, data)
            cycle = svc.update_cycle_attachments(
                sb, cycle_id, conclusion_pdf_path=path, conclusion_pdf_name=name
            )
        if plan_file and plan_file.filename:
            fdata = plan_file.read()
            path, name = storage_svc.upload_plan_workbook(cycle_id, plan_file.filename, fdata)
            cycle = svc.update_cycle_attachments(
                sb, cycle_id, plan_workbook_path=path, plan_workbook_name=name
            )

        return jsonify({'success': True, 'cycle': svc.enrich_cycle_files(cycle)})
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        print(f'api_upload_cycle_attachments: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/cycles/<cycle_id>/plan/publish', methods=['POST'])
@require_tbkl_planning
def api_publish_plan(cycle_id):
    payload = request.json or {}
    try:
        counts = plan_svc.publish_plan(
            _supabase(), _ctx(), cycle_id, payload.get('plan') or payload,
            replace=bool(payload.get('replace')),
        )
        return jsonify({'success': True, **counts})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        print(f'api_publish_plan: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/plan/parse', methods=['POST'])
@require_tbkl_planning
def api_parse_plan():
    f = request.files.get('plan_workbook') or request.files.get('file')
    if not f or not f.filename:
        return jsonify({'success': False, 'message': 'Chọn file Excel/CSV'}), 400
    try:
        plan = plan_svc.parse_workbook(f.read(), f.filename)
        return jsonify({'success': True, 'plan': plan})
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        print(f'api_parse_plan: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/plan-template.xlsx', methods=['GET'])
@require_tbkl_auth
def api_plan_template():
    meeting_seq = request.args.get('meeting_seq', type=int) or 1
    try:
        data = plan_svc.generate_template_xlsx(meeting_seq)
        return send_file(
            io.BytesIO(data),
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=f'TBKL-ke-hoach-H{meeting_seq}.xlsx',
        )
    except Exception as exc:
        print(f'api_plan_template: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/cycles/<cycle_id>/dashboard', methods=['GET'])
@require_tbkl_auth
def api_dashboard(cycle_id):
    unit_only = request.args.get('unit_only', '').lower() in ('1', 'true', 'yes')
    try:
        data = svc.build_dashboard(_supabase(), _ctx(), cycle_id, unit_only=unit_only)
        return jsonify({'success': True, **data})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_dashboard: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/cycles/<cycle_id>/directives', methods=['POST'])
@require_tbkl_operate
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
@require_tbkl_operate
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


@tbkl_bp.route('/api/tbkl/directives/<directive_id>/assess', methods=['POST'])
@require_tbkl_assess_directive
def api_assess_directive(directive_id):
    try:
        doc = svc.assess_directive_report(_supabase(), _ctx(), directive_id, request.json or {})
        return jsonify({'success': True, 'report': doc})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        print(f'api_assess_directive: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/directives/<directive_id>/confirm', methods=['POST'])
@require_tbkl_confirm_directive
def api_confirm_directive(directive_id):
    try:
        doc = svc.confirm_directive_report(_supabase(), _ctx(), directive_id, request.json or {})
        return jsonify({'success': True, 'report': doc})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        print(f'api_confirm_directive: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/tasks/<task_id>/confirm', methods=['POST'])
@require_tbkl_planning
def api_confirm_report(task_id):
    try:
        doc = svc.confirm_report(_supabase(), _ctx(), task_id, request.json or {})
        return jsonify({'success': True, 'report': doc})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        print(f'api_confirm_report: {exc}')
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
@require_tbkl_lock
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


@tbkl_bp.route('/api/tbkl/seeds', methods=['GET'])
@require_tbkl_auth
def api_list_seeds():
    try:
        return jsonify({'success': True, 'seeds': svc.list_seed_bundles()})
    except Exception as exc:
        return jsonify({'success': False, 'message': str(exc)}), 500


@tbkl_bp.route('/api/tbkl/seeds/<seed_id>/import', methods=['POST'])
@require_tbkl_admin
def api_import_seed(seed_id):
    payload = request.json or {}
    replace = bool(payload.get('replace'))
    try:
        result = svc.import_seed_bundle(_supabase(), _ctx(), seed_id, replace=replace)
        return jsonify({'success': True, **result})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except Exception as exc:
        print(f'api_import_seed: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500
