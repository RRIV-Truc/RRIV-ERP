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
from modules.meetings.service import create_meeting, get_meeting_detail, list_meetings, update_meeting
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

meetings_bp = Blueprint('meetings', __name__)


def _supabase():
    from flask import current_app
    return current_app.config['SUPABASE_CLIENT']


@meetings_bp.route('/api/meetings', methods=['GET'])
@require_auth
def api_list_meetings():
    ctx = request.meetings_user  # type: ignore[attr-defined]
    limit = min(int(request.args.get('limit', 50)), 200)
    items = list_meetings(_supabase(), ctx, limit=limit)
    return jsonify({'success': True, 'meetings': items})


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
    except Exception as exc:
        print(f'api_update_meeting: {exc}')
        return jsonify({'success': False, 'message': str(exc)}), 500


@meetings_bp.route('/api/meetings/<meeting_id>/sync', methods=['POST'])
@require_meeting_participant('meeting_id')
def api_sync_meeting(meeting_id):
    """Đồng bộ Firebase RTDB → Supabase (Service Account auth)."""
    body = request.json or {}
    sync_type = body.get('sync_type') or 'meeting_end'
    supabase = _supabase()
    meeting = get_meeting_detail(supabase, meeting_id)
    if not meeting:
        return jsonify({'success': False, 'message': 'Không tìm thấy cuộc họp'}), 404
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        return jsonify({'success': False, 'message': 'Cuộc họp không có firebase_room_id'}), 400

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
        msg = post_chat(supabase, meeting, ctx, body.get('message') or '')
        return jsonify({'success': True, 'message': msg})
    except LookupError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400


@meetings_bp.route('/api/meeting-rooms', methods=['GET'])
@require_auth
def api_list_meeting_rooms():
    active_only = request.args.get('active', 'true').lower() != 'false'
    q = _supabase().table('meeting_rooms').select('*').order('name')
    if active_only:
        q = q.eq('is_active', True)
    res = q.execute()
    return jsonify({'success': True, 'rooms': res.data or []})
