"""Chia sẻ màn hình phiên họp — duyệt bởi chủ trì + WebRTC signaling."""
from __future__ import annotations

import uuid
from typing import Any, Optional

from modules.meetings.meeting_roles import resolve_session_roles
from modules.meetings.rbac import UserContext
from modules.meetings.room_service import (
    _display_name,
    _now_iso,
    _rtdb_ref,
    _user_key,
)


def _can_approve_share(supabase, meeting_id: str, ctx: UserContext) -> bool:
    return resolve_session_roles(supabase, meeting_id, ctx).get('can_approve_share', False)


def _can_moderate(supabase, meeting_id: str, ctx: UserContext) -> bool:
    return resolve_session_roles(supabase, meeting_id, ctx).get('can_moderate', False)


def _share_ref(room_id: str):
    return _rtdb_ref(f'meetings/{room_id}/screenShare')


def _signals_ref(room_id: str):
    return _rtdb_ref(f'meetings/{room_id}/screenShareSignals')


def _requests_ref(room_id: str):
    return _rtdb_ref(f'meetings/{room_id}/screenShareRequests')


def parse_screen_share_for_client(data: Any) -> Optional[dict]:
    if not isinstance(data, dict) or not data.get('active'):
        return None
    return {
        'active': True,
        'sharer_key': data.get('sharerKey'),
        'sharer_name': data.get('sharerName'),
        'sharer_username': data.get('sharerUsername'),
        'started_at': data.get('startedAt'),
        'updated_at': data.get('updatedAt'),
    }


def _parse_request_item(req_id: str, data: dict) -> dict:
    return {
        'id': req_id,
        'status': data.get('status') or 'pending',
        'requester_key': data.get('requesterKey'),
        'requester_name': data.get('requesterName'),
        'requester_username': data.get('requesterUsername'),
        'requested_at': data.get('requestedAt'),
        'resolved_at': data.get('resolvedAt'),
        'resolved_by_username': data.get('resolvedByUsername'),
        'resolved_by_name': data.get('resolvedByName'),
    }


def _stop_active_share(room_id: str) -> Optional[dict]:
    """Dừng chia sẻ đang phát (nếu có). Trả về snapshot trước khi xóa."""
    ref = _share_ref(room_id)
    current = ref.get() or {}
    if not current.get('active'):
        return None
    ref.delete()
    _signals_ref(room_id).delete()
    return current


def parse_screen_share_requests_for_client(
    data: Any,
    ctx: UserContext,
    *,
    is_host: bool,
) -> dict:
    if not isinstance(data, dict):
        data = {}
    my_username = (ctx.username or '').strip().lower()
    pending = []
    mine = None

    for req_id, raw in data.items():
        if not isinstance(raw, dict):
            continue
        item = _parse_request_item(str(req_id), raw)
        st = (item.get('status') or '').lower()
        req_user = (item.get('requester_username') or '').strip().lower()

        if st == 'pending' and is_host:
            pending.append(item)
        if req_user == my_username:
            if mine is None or (item.get('requested_at') or '') >= (mine.get('requested_at') or ''):
                mine = item

    pending.sort(key=lambda x: x.get('requested_at') or '')
    return {'pending': pending, 'mine': mine}


def _find_approved_request(room_id: str, username: str) -> Optional[dict]:
    username = (username or '').strip().lower()
    raw = _requests_ref(room_id).get() or {}
    if not isinstance(raw, dict):
        return None
    best = None
    for req_id, data in raw.items():
        if not isinstance(data, dict):
            continue
        if (data.get('status') or '').lower() != 'approved':
            continue
        if (data.get('requesterUsername') or '').strip().lower() != username:
            continue
        item = _parse_request_item(str(req_id), data)
        if best is None or (item.get('resolved_at') or '') >= (best.get('resolved_at') or ''):
            best = item
    return best


def _clear_request(room_id: str, request_id: str) -> None:
    if request_id:
        _requests_ref(room_id).child(request_id).delete()


def request_screen_share(supabase, meeting: dict, ctx: UserContext) -> dict:
    if _can_approve_share(supabase, meeting['id'], ctx):
        raise ValueError('Chủ trì / thư ký bấm «Chia sẻ màn hình» trực tiếp — không cần xin phép')

    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')

    my_key = _user_key(ctx)
    my_username = (ctx.username or '').strip().lower()
    raw = _requests_ref(room_id).get() or {}
    if isinstance(raw, dict):
        for req_id, data in raw.items():
            if not isinstance(data, dict):
                continue
            st = (data.get('status') or '').lower()
            req_user = (data.get('requesterUsername') or '').strip().lower()
            if req_user == my_username and st in ('pending', 'approved'):
                if st == 'approved':
                    return _parse_request_item(str(req_id), data)
                raise ValueError('Bạn đã gửi yêu cầu — đang chờ chủ trì duyệt')

    now = _now_iso()
    req_id = uuid.uuid4().hex[:12]
    payload = {
        'status': 'pending',
        'requesterKey': my_key,
        'requesterName': _display_name(supabase, ctx),
        'requesterUsername': ctx.username,
        'requestedAt': now,
        'updatedAt': now,
    }
    _requests_ref(room_id).child(req_id).set(payload)
    _rtdb_ref(f'meetings/{room_id}/meta').update({'lastActivity': now})
    return _parse_request_item(req_id, payload)


def approve_screen_share_request(
    supabase,
    meeting: dict,
    ctx: UserContext,
    request_id: str,
) -> dict:
    if not _can_approve_share(supabase, meeting['id'], ctx):
        raise PermissionError('Chỉ chủ trì / thư ký mới duyệt được yêu cầu chia sẻ')

    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')

    ref = _requests_ref(room_id).child(request_id)
    data = ref.get() or {}
    if not data:
        raise LookupError('Không tìm thấy yêu cầu chia sẻ')

    if (data.get('status') or '').lower() != 'pending':
        raise ValueError('Yêu cầu đã được xử lý')

    share = _share_ref(room_id).get() or {}
    if share.get('active'):
        _stop_active_share(room_id)

    now = _now_iso()
    patch = {
        'status': 'approved',
        'resolvedAt': now,
        'resolvedByUsername': ctx.username,
        'resolvedByName': _display_name(supabase, ctx),
        'updatedAt': now,
    }
    ref.update(patch)
    _rtdb_ref(f'meetings/{room_id}/meta').update({'lastActivity': now})
    return _parse_request_item(request_id, {**data, **patch})


def deny_screen_share_request(
    supabase,
    meeting: dict,
    ctx: UserContext,
    request_id: str,
) -> dict:
    if not _can_approve_share(supabase, meeting['id'], ctx):
        raise PermissionError('Chỉ chủ trì / thư ký mới từ chối được yêu cầu chia sẻ')

    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')

    ref = _requests_ref(room_id).child(request_id)
    data = ref.get() or {}
    if not data:
        raise LookupError('Không tìm thấy yêu cầu chia sẻ')

    if (data.get('status') or '').lower() != 'pending':
        raise ValueError('Yêu cầu đã được xử lý')

    now = _now_iso()
    patch = {
        'status': 'denied',
        'resolvedAt': now,
        'resolvedByUsername': ctx.username,
        'resolvedByName': _display_name(supabase, ctx),
        'updatedAt': now,
    }
    ref.update(patch)
    _rtdb_ref(f'meetings/{room_id}/meta').update({'lastActivity': now})
    return _parse_request_item(request_id, {**data, **patch})


def start_screen_share(supabase, meeting: dict, ctx: UserContext) -> dict:
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')

    ref = _share_ref(room_id)
    current = ref.get() or {}
    my_key = _user_key(ctx)
    if current.get('active') and current.get('sharerKey') != my_key:
        if _can_approve_share(supabase, meeting['id'], ctx):
            _stop_active_share(room_id)
            current = {}
        else:
            who = current.get('sharerName') or current.get('sharerUsername') or 'người khác'
            raise ValueError(f'{who} đang chia sẻ màn hình — chờ họ dừng hoặc yêu cầu nhường')

    approved_req = None
    if not _can_approve_share(supabase, meeting['id'], ctx):
        resuming_own = current.get('active') and current.get('sharerKey') == my_key
        if not resuming_own:
            approved_req = _find_approved_request(room_id, ctx.username)
            if not approved_req:
                raise PermissionError(
                    'Chủ trì chưa cho phép — bấm «Xin chia sẻ màn hình» và chờ duyệt'
                )

    now = _now_iso()
    payload = {
        'active': True,
        'sharerKey': my_key,
        'sharerName': _display_name(supabase, ctx),
        'sharerUsername': ctx.username,
        'startedAt': now,
        'updatedAt': now,
    }
    try:
        _signals_ref(room_id).delete()
        ref.set(payload)
        if approved_req:
            _clear_request(room_id, approved_req['id'])
        _rtdb_ref(f'meetings/{room_id}/meta').update({'lastActivity': now})
    except Exception as exc:
        raise ValueError(f'Không ghi Firebase: {exc}') from exc
    return payload


def stop_screen_share(supabase, meeting: dict, ctx: UserContext, *, force: bool = False) -> dict:
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        return {'stopped': True}

    ref = _share_ref(room_id)
    current = ref.get() or {}
    if not current.get('active'):
        return {'stopped': True}

    my_key = _user_key(ctx)
    if not force and current.get('sharerKey') != my_key:
        if not _can_approve_share(supabase, meeting['id'], ctx):
            raise PermissionError('Chỉ người đang chia sẻ hoặc chủ trì / thư ký mới dừng được')

    ref.delete()
    _signals_ref(room_id).delete()
    _rtdb_ref(f'meetings/{room_id}/meta').update({'lastActivity': _now_iso()})
    return {'stopped': True, 'previous': current}


def post_screen_share_signal(
    supabase,
    meeting: dict,
    ctx: UserContext,
    *,
    signal_type: str,
    payload: Any,
    to_username: Optional[str] = None,
) -> dict:
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')

    st = (signal_type or '').strip().lower()
    if st not in ('join', 'offer', 'answer', 'ice', 'leave'):
        raise ValueError('Loại tín hiệu không hợp lệ')

    msg_id = uuid.uuid4().hex[:16]
    now = _now_iso()
    msg = {
        'id': msg_id,
        'type': st,
        'fromKey': _user_key(ctx),
        'fromUsername': ctx.username,
        'fromName': _display_name(supabase, ctx),
        'toUsername': (to_username or '').strip().lower() or None,
        'payload': payload,
        'at': now,
    }

    _signals_ref(room_id).child(msg_id).set(msg)
    _rtdb_ref(f'meetings/{room_id}/meta').update({'lastActivity': now})
    return msg


def list_screen_share_signals(
    meeting: dict,
    ctx: UserContext,
    *,
    since: Optional[str] = None,
) -> list:
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        return []

    raw = _signals_ref(room_id).get() or {}
    if not isinstance(raw, dict):
        return []

    my_username = (ctx.username or '').strip().lower()
    my_aliases = {my_username, f'{my_username}__tv'}
    items = []
    for k, v in raw.items():
        if not isinstance(v, dict):
            continue
        to_user = (v.get('toUsername') or '').strip().lower()
        if to_user and to_user not in my_aliases:
            continue
        if since and (v.get('at') or '') < since:
            continue
        items.append({**v, 'id': v.get('id') or k})

    items.sort(key=lambda x: x.get('at') or '')
    return items[-100:]
