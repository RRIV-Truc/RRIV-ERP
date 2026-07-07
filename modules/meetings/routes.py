"""Flask routes — /api/meetings/*"""
from __future__ import annotations

from flask import Blueprint, jsonify, request
from pydantic import ValidationError

from modules.meetings.decorators import (
    require_auth,
    require_meeting_manager,
    require_meeting_participant,
)
from modules.meetings.schemas import MeetingCreate, MeetingUpdate
from modules.meetings.service import create_meeting, delete_meeting, get_meeting_detail, list_meetings, update_meeting
from modules.meetings.room_service import (
    assert_can_access,
    find_meeting_by_code,
    get_room_state,
    heartbeat,
    join_room,
    leave_room,
    post_chat,
)
from modules.meetings.sync.firebase_sync import FirebaseMeetingSync
from modules.meetings import document_service as doc_svc
from modules.meetings import presentation_service as pres_svc
from modules.meetings import hand_service as hand_svc
from modules.meetings import screen_share_service as share_svc
from modules.meetings import slide_service as slide_svc
from modules.meetings.warm_service import warm_meeting_documents

meetings_bp = Blueprint('meetings', __name__)


def _supabase():
    from flask import current_app
    return current_app.config['SUPABASE_CLIENT']


@meetings_bp.route('/api/meetings', methods=['GET'])
@require_auth
def api_list_meetings():
    ctx = request.meetings_user  # type: ignore[attr-defined]
    limit = min(int(request.args.get('limit', 50)), 200)
    try:
        items = list_meetings(_supabase(), ctx, limit=limit)
        return jsonify({'success': True, 'meetings': items})
    except Exception as exc:
        print(f'api_list_meetings: {exc}')
        msg = str(exc)
        if 'secretary' in msg.lower() or 'invalid input value for enum' in msg.lower():
            msg = (
                'Lỗi vai trò Thư ký — chạy migration SQL '
                'supabase/migrations/20260630_meeting_secretary_role.sql trên Supabase rồi thử lại.'
            )
        return jsonify({'success': False, 'message': msg}), 500


@meetings_bp.route('/api/meetings', methods=['POST'])
@require_meeting_manager
def api_create_meeting():
    ctx = request.meetings_user  # type: ignore[attr-defined]
    try:
        payload = MeetingCreate.model_validate(request.json or {})
    except ValidationError as exc:
        return jsonify({'success': False, 'message': exc.errors()}), 400

    try:
        doc = create_meeting(_supabase(), payload, ctx)
        return jsonify({'success': True, 'meeting': doc}), 201
    except NotImplementedError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 501
    except Exception as exc:
        print(f'api_create_meeting: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>', methods=['GET'])
@require_meeting_participant('meeting_id')
def api_get_meeting(meeting_id):
    doc = get_meeting_detail(_supabase(), meeting_id)
    if not doc:
        return jsonify({'success': False, 'message': 'Không tìm thấy cuộc họp'}), 404
    return jsonify({'success': True, 'meeting': doc})


@meetings_bp.route('/api/meetings/<meeting_id>', methods=['PATCH'])
@require_meeting_manager
def api_update_meeting(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    try:
        payload = MeetingUpdate.model_validate(request.json or {})
    except ValidationError as exc:
        return jsonify({'success': False, 'message': exc.errors()}), 400
    try:
        doc = update_meeting(_supabase(), meeting_id, payload, ctx)
        return jsonify({'success': True, 'meeting': doc})
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except Exception as exc:
        print(f'api_update_meeting: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>', methods=['DELETE'])
@require_meeting_manager
def api_delete_meeting(meeting_id):
    supabase = _supabase()
    if not get_meeting_detail(supabase, meeting_id):
        return jsonify({'success': False, 'message': 'Không tìm thấy cuộc họp'}), 404
    try:
        delete_meeting(supabase, meeting_id, request.meetings_user)  # type: ignore[attr-defined]
        return jsonify({'success': True})
    except Exception as exc:
        print(f'api_delete_meeting: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/sync', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_sync_meeting(meeting_id):
    """Đồng bộ Firebase RTDB → Supabase (Service Account auth)."""
    body = request.json or {}
    sync_type = body.get('sync_type') or 'meeting_end'
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    meeting = get_meeting_detail(supabase, meeting_id)
    if not meeting:
        return jsonify({'success': False, 'message': 'Không tìm thấy cuộc họp'}), 404
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        return jsonify({'success': False, 'message': 'Cuộc họp không có firebase_room_id'}), 400

    if sync_type == 'meeting_end':
        from modules.meetings.rbac import can_create_meeting
        if not can_create_meeting(ctx, supabase):
            return jsonify({'success': False, 'message': 'Chỉ Chủ trì / Thư ký mới được kết thúc cuộc họp'}), 403
        if (meeting.get('status') or '') == 'completed':
            return jsonify({'success': False, 'message': 'Cuộc họp đã kết thúc'}), 400

    try:
        syncer = FirebaseMeetingSync(supabase)
        if sync_type == 'presence':
            result = syncer.sync_presence(meeting_id, room_id)
        else:
            result = syncer.sync_meeting_end(meeting_id, room_id)
        return jsonify({'success': True, 'result': result})
    except Exception as exc:
        print(f'api_sync_meeting: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/lookup', methods=['GET'])
@require_auth
def api_lookup_meeting():
    """Tra cứu cuộc họp bằng mã MTG-YYYY-NNNN."""
    ctx = request.meetings_user  # type: ignore[attr-defined]
    code = request.args.get('code') or ''
    supabase = _supabase()
    meeting = find_meeting_by_code(supabase, code)
    if not meeting:
        return jsonify({'success': False, 'message': 'Không tìm thấy mã cuộc họp'}), 404
    try:
        assert_can_access(supabase, meeting['id'], ctx)
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    return jsonify({
        'success': True,
        'meeting': {
            'id': meeting.get('id'),
            'meeting_code': meeting.get('meeting_code'),
            'title': meeting.get('title'),
            'status': meeting.get('status'),
            'scheduled_start': meeting.get('scheduled_start'),
            'scheduled_end': meeting.get('scheduled_end'),
            'firebase_room_id': meeting.get('firebase_room_id'),
            'meeting_mode': meeting.get('meeting_mode'),
        },
    })


def _room_api_error(exc: Exception, action: str):
    """Trả JSON thay vì trang HTML 500 (đặc biệt khi thiếu Firebase trên Render)."""
    msg = str(exc)
    if isinstance(exc, RuntimeError) and (
        'FIREBASE' in msg.upper() or 'Service Account' in msg
    ):
        msg = (
            f'{msg} — Cấu hình FIREBASE_DATABASE_URL và FIREBASE_SERVICE_ACCOUNT '
            'trong Render Dashboard → Environment.'
        )
    print(f'api_{action}: {exc}')
    return jsonify({'success': False, 'message': msg}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/room', methods=['GET'])
@require_meeting_participant('meeting_id')
def api_get_room(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        heartbeat(supabase, meeting, ctx)
        state = get_room_state(supabase, meeting, ctx)
        return jsonify({'success': True, 'room': state})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        return _room_api_error(exc, 'get_room')


@meetings_bp.route('/api/meetings/<meeting_id>/room/join', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_join_room(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        state = join_room(supabase, meeting, ctx)
        return jsonify({'success': True, 'room': state})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        return _room_api_error(exc, 'join_room')


@meetings_bp.route('/api/meetings/<meeting_id>/room/leave', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_leave_room(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        result = leave_room(supabase, meeting, ctx)
        return jsonify({'success': True, 'result': result})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404


@meetings_bp.route('/api/meetings/<meeting_id>/room/chat', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_room_chat(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    body = request.json or {}
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        msg = post_chat(
            supabase,
            meeting,
            ctx,
            body.get('message') or '',
            channel=body.get('channel') or 'all',
            to_username=body.get('to_username') or body.get('toUsername'),
        )
        return jsonify({'success': True, 'message': msg})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400


@meetings_bp.route('/api/meetings/<meeting_id>/room/hand/raise', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_raise_hand(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        result = hand_svc.raise_hand(supabase, meeting, ctx)
        return jsonify({'success': True, 'hand': result})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400


@meetings_bp.route('/api/meetings/<meeting_id>/room/hand/lower', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_lower_hand(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    body = request.json or {}
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        result = hand_svc.lower_hand(
            supabase,
            meeting,
            ctx,
            target_username=body.get('target_username') or body.get('targetUsername'),
        )
        return jsonify({'success': True, 'result': result})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400


@meetings_bp.route('/api/meetings/<meeting_id>/room/hand/clear', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_clear_hands(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        result = hand_svc.clear_all_hands(supabase, meeting, ctx)
        return jsonify({'success': True, 'result': result})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400


@meetings_bp.route('/api/meetings/<meeting_id>/documents/<doc_id>/presentation-info', methods=['GET'])
@require_meeting_participant('meeting_id')
def api_presentation_info(meeting_id, doc_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    try:
        data = slide_svc.get_presentation_info(_supabase(), meeting_id, doc_id, ctx)
        return jsonify({'success': True, 'presentation': data})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except RuntimeError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 500
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_presentation_info: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/room/presentation/prepare', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_prepare_presentation(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    body = request.json or {}
    doc_id = str(body.get('doc_id') or '').strip()
    if not doc_id:
        return jsonify({'success': False, 'message': 'Thiếu doc_id'}), 400
    try:
        pres_svc.assert_can_present(supabase, ctx)
        data = slide_svc.prepare_presentation(supabase, meeting_id, doc_id, ctx)
        return jsonify({'success': True, 'presentation': data})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except RuntimeError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 500
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_prepare_presentation: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/room/presentation/start', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_start_presentation(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    body = request.json or {}
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        payload = pres_svc.start_presentation(
            supabase,
            meeting,
            ctx,
            doc_id=str(body.get('doc_id') or '').strip(),
            doc_name=str(body.get('doc_name') or 'Tài liệu'),
            slide_count=int(body.get('slide_count') or 0),
            mode=str(body.get('mode') or 'images'),
            download_url=str(body.get('download_url') or '').strip() or None,
            direct=bool(body.get('direct')),
            pdf_iframe=bool(body.get('pdf_iframe')),
        )
        return jsonify({'success': True, 'presentation': payload})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_start_presentation: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/room/presentation/slide', methods=['PUT'])
@require_meeting_participant('meeting_id')
def api_update_presentation_slide(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    body = request.json or {}
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        payload = pres_svc.update_presentation_slide(
            supabase, meeting, ctx, int(body.get('slide_index', 0)),
            slide_count=int(body['slide_count']) if body.get('slide_count') is not None else None,
        )
        return jsonify({'success': True, 'presentation': payload})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_update_presentation_slide: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/room/presentation/stop', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_stop_presentation(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        result = pres_svc.stop_presentation(supabase, meeting, ctx)
        return jsonify({'success': True, 'result': result})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_stop_presentation: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/room/screen-share/start', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_start_screen_share(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        payload = share_svc.start_screen_share(supabase, meeting, ctx)
        return jsonify({'success': True, 'screen_share': share_svc.parse_screen_share_for_client(payload)})
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_start_screen_share: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/room/screen-share/request', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_request_screen_share(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        req = share_svc.request_screen_share(supabase, meeting, ctx)
        return jsonify({'success': True, 'request': req})
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_request_screen_share: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/room/screen-share/request/<request_id>/approve', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_approve_screen_share(meeting_id, request_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        req = share_svc.approve_screen_share_request(supabase, meeting, ctx, request_id)
        return jsonify({'success': True, 'request': req})
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_approve_screen_share: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/room/screen-share/request/<request_id>/deny', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_deny_screen_share(meeting_id, request_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        req = share_svc.deny_screen_share_request(supabase, meeting, ctx, request_id)
        return jsonify({'success': True, 'request': req})
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_deny_screen_share: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/room/screen-share/stop', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_stop_screen_share(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    body = request.json or {}
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        result = share_svc.stop_screen_share(
            supabase, meeting, ctx, force=bool(body.get('force')),
        )
        return jsonify({'success': True, 'result': result})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_stop_screen_share: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/room/screen-share/signal', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_screen_share_signal(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    body = request.json or {}
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        msg = share_svc.post_screen_share_signal(
            supabase,
            meeting,
            ctx,
            signal_type=str(body.get('type') or ''),
            payload=body.get('payload'),
            to_username=str(body.get('to_username') or '').strip() or None,
        )
        return jsonify({'success': True, 'signal': msg})
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_screen_share_signal: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/room/screen-share/signals', methods=['GET'])
@require_meeting_participant('meeting_id')
def api_screen_share_signals(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    since = request.args.get('since') or None
    try:
        meeting = assert_can_access(supabase, meeting_id, ctx)
        signals = share_svc.list_screen_share_signals(meeting, ctx, since=since)
        return jsonify({'success': True, 'signals': signals})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_screen_share_signals: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/documents/<doc_id>/slides/<int:slide_index>', methods=['GET'])
@require_meeting_participant('meeting_id')
def api_presentation_slide_image(meeting_id, doc_id, slide_index):
    from flask import send_file
    ctx = request.meetings_user  # type: ignore[attr-defined]
    try:
        path = slide_svc.get_slide_image_path(
            _supabase(), meeting_id, doc_id, slide_index, ctx,
        )
        return send_file(path, mimetype='image/jpeg', max_age=3600)
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404


@meetings_bp.route('/api/meeting-rooms', methods=['GET'])
@require_auth
def api_list_meeting_rooms():
    active_only = request.args.get('active', 'true').lower() != 'false'
    q = _supabase().table('meeting_rooms').select('*').order('name')
    if active_only:
        q = q.eq('is_active', True)
    res = q.execute()
    return jsonify({'success': True, 'rooms': res.data or []})


# ----- Kho tài liệu cuộc họp (Cold → Hot) -----


@meetings_bp.route('/api/meetings/storage-probe', methods=['GET'])
@require_meeting_manager
def api_storage_probe():
    """Debug: kiểm tra SUPABASE_SERVICE_KEY + bucket meeting-docs trên server."""
    return jsonify({'success': True, 'probe': doc_svc.probe_storage_access()})


@meetings_bp.route('/api/meetings/documents/library/browse', methods=['GET'])
@require_auth
def api_browse_library():
    """Duyệt kho tài liệu chung theo thư mục (Explorer)."""
    ctx = request.meetings_user  # type: ignore[attr-defined]
    parent_id = request.args.get('parent_id') or None
    meeting_id = request.args.get('meeting_id') or None
    if parent_id in ('', 'null', 'root'):
        parent_id = None
    try:
        data = doc_svc.browse_library_folder(
            _supabase(), ctx, parent_id=parent_id, for_meeting_id=meeting_id,
        )
        items = doc_svc.attach_download_urls(data.get('documents') or [])
        data['documents'] = items
        return jsonify({'success': True, **data})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except Exception as exc:
        print(f'api_browse_library: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/documents/library/upload', methods=['POST'])
@require_auth
def api_upload_library_document():
    ctx = request.meetings_user  # type: ignore[attr-defined]
    supabase = _supabase()
    parent_id = request.form.get('parent_id') or None
    if parent_id in ('', 'null', 'root'):
        parent_id = None
    upload = request.files.get('file')
    if not upload or not upload.filename:
        return jsonify({'success': False, 'message': 'Thiếu file upload'}), 400
    try:
        lib_id = doc_svc.ensure_library_meeting(supabase, ctx)
        data = upload.read()
        doc = doc_svc.upload_file(
            supabase, lib_id, ctx,
            upload.filename, data, upload.mimetype, parent_id,
        )
        return jsonify({'success': True, 'document': doc}), 201
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        print(f'api_upload_library_document: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/documents/library/folder', methods=['POST'])
@require_auth
def api_create_library_folder():
    ctx = request.meetings_user  # type: ignore[attr-defined]
    body = request.json or {}
    supabase = _supabase()
    parent_id = body.get('parent_id') or None
    if parent_id in ('', 'null', 'root'):
        parent_id = None
    try:
        lib_id = doc_svc.ensure_library_meeting(supabase, ctx)
        doc = doc_svc.create_folder(
            supabase, lib_id, ctx, body.get('name') or '', parent_id=parent_id,
        )
        return jsonify({'success': True, 'document': doc})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400


@meetings_bp.route('/api/meetings/documents/library/tree', methods=['GET'])
@require_auth
def api_library_document_tree():
    """Cây kho tài liệu chung — chọn tài liệu họp (tạo/sửa cuộc họp)."""
    ctx = request.meetings_user  # type: ignore[attr-defined]
    meeting_id = request.args.get('meeting_id') or None
    try:
        data = doc_svc.list_library_tree(_supabase(), ctx, for_meeting_id=meeting_id)
        return jsonify({'success': True, **data})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404


@meetings_bp.route('/api/meetings/documents/library', methods=['GET'])
@require_auth
def api_list_document_library():
    """Kho tài liệu chung — gộp tài liệu các cuộc họp user được phép xem."""
    ctx = request.meetings_user  # type: ignore[attr-defined]
    meeting_id = request.args.get('meeting_id') or None
    parent_id = request.args.get('parent_id') or None
    meeting_filter = request.args.get('meeting_filter') or None
    if parent_id in ('', 'null', 'root'):
        parent_id = None
    if meeting_filter in ('', 'all'):
        meeting_filter = None
    try:
        data = doc_svc.list_library_documents(
            _supabase(), ctx,
            meeting_id=meeting_id,
            parent_id=parent_id,
            meeting_filter=meeting_filter,
        )
        items = doc_svc.attach_download_urls(data.get('documents') or [])
        data['documents'] = items
        return jsonify({'success': True, **data})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400


@meetings_bp.route('/api/meetings/<meeting_id>/documents', methods=['GET'])
@require_meeting_participant('meeting_id')
def api_list_documents(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    parent_id = request.args.get('parent_id') or None
    if parent_id in ('', 'null', 'root'):
        parent_id = None
    shared_only = request.args.get('shared_only', '').lower() in ('1', 'true', 'yes')
    flat = request.args.get('flat', '').lower() in ('1', 'true', 'yes')
    skip_urls = request.args.get('skip_urls', '').lower() in ('1', 'true', 'yes')
    supabase = _supabase()
    try:
        can_manage = doc_svc.can_manage_documents(supabase, meeting_id, ctx)
        if flat:
            items = doc_svc.list_shared_files_flat(
                supabase, meeting_id, ctx, shared_only=shared_only,
            )
            if not skip_urls:
                items = doc_svc.attach_download_urls(items)
            return jsonify({
                'success': True,
                'documents': items,
                'breadcrumb': [],
                'can_manage': can_manage,
                'shared_only': not can_manage or shared_only,
            })
        items = doc_svc.list_documents(
            supabase, meeting_id, ctx, parent_id, shared_only=shared_only,
        )
        if not skip_urls:
            items = doc_svc.attach_download_urls(items)
        breadcrumb = doc_svc.list_breadcrumb(supabase, meeting_id, parent_id, ctx)
        return jsonify({
            'success': True,
            'documents': items,
            'breadcrumb': breadcrumb,
            'can_manage': can_manage,
            'shared_only': not can_manage or shared_only,
        })
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_list_documents: {exc}')
        return jsonify({
            'success': False,
            'message': str(exc) or 'Lỗi tải danh sách tài liệu — thử lại',
        }), 500


@meetings_bp.route('/api/meetings/<meeting_id>/documents/shares', methods=['GET'])
@require_meeting_participant('meeting_id')
def api_get_document_shares(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    try:
        data = doc_svc.get_document_shares(_supabase(), meeting_id, ctx)
        return jsonify({'success': True, **data})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404


@meetings_bp.route('/api/meetings/<meeting_id>/documents/shares', methods=['PUT'])
@require_meeting_participant('meeting_id')
def api_set_document_shares(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    body = request.json or {}
    try:
        data = doc_svc.set_document_shares(
            _supabase(), meeting_id, ctx, body.get('document_ids') or [],
        )
        return jsonify({'success': True, **data})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404


@meetings_bp.route('/api/meetings/<meeting_id>/documents/folder', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_create_folder(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    body = request.json or {}
    try:
        doc = doc_svc.create_folder(
            _supabase(), meeting_id, ctx,
            body.get('name') or '',
            body.get('parent_id') or None,
        )
        try:
            warm_meeting_documents(_supabase(), meeting_id)
        except Exception as warm_exc:
            print(f'api_create_folder warm: {warm_exc}')
        return jsonify({'success': True, 'document': doc}), 201
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400


@meetings_bp.route('/api/meetings/<meeting_id>/documents/upload', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_upload_document(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    upload = request.files.get('file')
    if not upload or not upload.filename:
        return jsonify({'success': False, 'message': 'Thiếu file upload'}), 400
    parent_id = request.form.get('parent_id') or None
    if parent_id in ('', 'null', 'root'):
        parent_id = None
    try:
        data = upload.read()
        doc = doc_svc.upload_file(
            _supabase(), meeting_id, ctx,
            upload.filename, data, upload.mimetype, parent_id,
        )
        return jsonify({'success': True, 'document': doc}), 201
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        print(f'api_upload_document: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/documents/<doc_id>', methods=['DELETE'])
@require_meeting_participant('meeting_id')
def api_delete_document(meeting_id, doc_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    try:
        doc_svc.delete_document(_supabase(), meeting_id, doc_id, ctx)
        return jsonify({'success': True})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404


@meetings_bp.route('/api/meetings/<meeting_id>/documents/warm', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_warm_documents(meeting_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    try:
        result = warm_meeting_documents(_supabase(), meeting_id)
        return jsonify({'success': True, 'result': result})
    except Exception as exc:
        print(f'api_warm_documents: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/documents/<doc_id>/move', methods=['PATCH'])
@require_meeting_participant('meeting_id')
def api_move_document(meeting_id, doc_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    body = request.json or {}
    try:
        parent_id = body.get('parent_id')
        if parent_id in ('', 'null', 'root'):
            parent_id = None
        doc = doc_svc.move_document(_supabase(), meeting_id, doc_id, ctx, parent_id)
        return jsonify({'success': True, 'document': doc})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404


@meetings_bp.route('/api/meetings/<meeting_id>/documents/<doc_id>/download-link', methods=['GET'])
@require_meeting_participant('meeting_id')
def api_document_download_link(meeting_id, doc_id):
    ctx = request.meetings_user  # type: ignore[attr-defined]
    inline = request.args.get('disposition', '').lower() == 'inline'
    supabase = _supabase()
    try:
        link = doc_svc.get_download_link(
            supabase, meeting_id, doc_id, ctx, inline=inline,
        )
        if link.get('direct'):
            try:
                doc = doc_svc.get_document(supabase, meeting_id, doc_id, ctx, check_share=True)
                if doc.get('warm_status') in ('pending', 'failed'):
                    warm_meeting_documents(supabase, meeting_id, doc_ids=[doc_id])
            except Exception as warm_exc:
                print(f'api_document_download_link warm: {warm_exc}')
        if not link.get('direct'):
            link['url'] = (
                f'/api/meetings/{meeting_id}/documents/{doc_id}/download'
                f'?username={ctx.username or ""}'
                + ('&disposition=inline' if inline else '')
            )
        return jsonify({'success': True, 'link': link})
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404


@meetings_bp.route('/api/meetings/<meeting_id>/documents/<doc_id>/download', methods=['GET'])
@require_meeting_participant('meeting_id')
def api_download_document(meeting_id, doc_id):
    from flask import Response, redirect
    ctx = request.meetings_user  # type: ignore[attr-defined]
    inline = request.args.get('disposition', '').lower() == 'inline'
    presentation = request.args.get('presentation') == '1'
    try:
        doc = doc_svc.get_document(_supabase(), meeting_id, doc_id, ctx, check_share=True)
        if doc.get('kind') != 'file':
            return jsonify({'success': False, 'message': 'Không phải file'}), 400
        name = doc.get('name') or 'download'
        mime = doc_svc.resolve_mime_type(name, doc.get('mime_type'))

        if presentation:
            data = doc_svc.read_presentation_bytes(doc)
            return Response(
                data,
                mimetype=mime,
                headers={
                    'Content-Disposition': doc_svc.download_disposition(
                        name, mime, inline=inline,
                    ),
                    'Content-Length': str(len(data)),
                    'X-Content-Type-Options': 'nosniff',
                    'Cache-Control': 'private, max-age=300',
                },
            )

        direct = doc_svc.resolve_direct_download_url(doc)
        if direct and (not inline or doc_svc.is_pdf_document(name, mime)):
            return redirect(direct, code=302)

        signed = doc_svc.create_signed_download_url(doc)
        if signed and (not inline or doc_svc.is_pdf_document(name, mime)):
            return redirect(signed, code=302)

        data = doc_svc.read_file_bytes(_supabase(), doc)
        return Response(
            data,
            mimetype=mime,
            headers={
                'Content-Disposition': doc_svc.download_disposition(
                    name, mime, inline=inline,
                ),
                'X-Content-Type-Options': 'nosniff',
            },
        )
    except PermissionError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 403
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except FileNotFoundError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        print(f'api_download_document: {exc}')
        return jsonify({'success': False, 'message': 'Không tải được tài liệu'}), 500
