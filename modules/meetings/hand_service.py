"""Giơ tay xin phát biểu trong phiên họp."""
from __future__ import annotations

from typing import Any, Optional

from modules.meetings.meeting_roles import resolve_session_roles
from modules.meetings.rbac import UserContext
from modules.meetings.room_service import (
    _display_name,
    _now_iso,
    _rtdb_ref,
    _user_key,
)


def _hands_ref(room_id: str):
    return _rtdb_ref(f'meetings/{room_id}/raisedHands')


def _find_user_key_by_username(room_id: str, username: str) -> str:
    username = (username or '').strip().lower()
    if not username:
        raise ValueError('Thiếu username')
    presence = _rtdb_ref(f'meetings/{room_id}/presence').get() or {}
    if isinstance(presence, dict):
        for key, entry in presence.items():
            if not isinstance(entry, dict):
                continue
            if (entry.get('username') or '').strip().lower() == username:
                return str(key)
    return f'user_{username}'


def _parse_hand_item(key: str, data: dict) -> dict:
    return {
        'key': key,
        'user_key': data.get('userKey') or key,
        'username': data.get('username'),
        'display_name': data.get('displayName') or data.get('username') or key,
        'raised_at': data.get('raisedAt'),
    }


def parse_raised_hands_for_client(
    data: Any,
    ctx: UserContext,
    *,
    can_moderate: bool,
) -> dict:
    """Trả danh sách giơ tay + trạng thái của chính mình."""
    if not isinstance(data, dict):
        data = {}
    my_username = (ctx.username or '').strip().lower()
    my_key = _user_key(ctx)
    hands = []
    mine = None

    for key, raw in data.items():
        if not isinstance(raw, dict):
            continue
        item = _parse_hand_item(str(key), raw)
        hands.append(item)
        item_user = (item.get('username') or '').strip().lower()
        item_key = str(item.get('user_key') or key)
        if item_user == my_username or item_key == my_key:
            mine = item

    hands.sort(key=lambda x: x.get('raised_at') or '')
    return {
        'hands': hands,
        'mine': mine,
        'count': len(hands),
        'can_moderate': can_moderate,
    }


def raise_hand(supabase, meeting: dict, ctx: UserContext) -> dict:
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')

    key = _user_key(ctx)
    now = _now_iso()
    payload = {
        'userKey': key,
        'username': ctx.username,
        'displayName': _display_name(supabase, ctx),
        'raisedAt': now,
    }
    _rtdb_ref(f'meetings/{room_id}/raisedHands/{key}').set(payload)
    _rtdb_ref(f'meetings/{room_id}/presence/{key}').update({'handRaised': True, 'lastSeen': now})
    _rtdb_ref(f'meetings/{room_id}/meta').update({'lastActivity': now})
    return payload


def lower_hand(
    supabase,
    meeting: dict,
    ctx: UserContext,
    target_username: Optional[str] = None,
) -> dict:
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')

    meeting_id = meeting.get('id')
    roles = resolve_session_roles(supabase, meeting_id, ctx)
    target = (target_username or '').strip().lower()
    my_user = (ctx.username or '').strip().lower()

    if target and target != my_user:
        if not roles.get('can_moderate'):
            raise PermissionError('Chỉ chủ trì/thư ký mới hạ tay người khác')
        key = _find_user_key_by_username(room_id, target)
    else:
        key = _user_key(ctx)

    _rtdb_ref(f'meetings/{room_id}/raisedHands/{key}').delete()
    _rtdb_ref(f'meetings/{room_id}/presence/{key}').update({'handRaised': False})
    return {'lowered_key': key}


def clear_all_hands(supabase, meeting: dict, ctx: UserContext) -> dict:
    meeting_id = meeting.get('id')
    roles = resolve_session_roles(supabase, meeting_id, ctx)
    if not roles.get('can_moderate'):
        raise PermissionError('Chỉ chủ trì/thư ký mới hạ tất cả tay')

    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')

    raw = _hands_ref(room_id).get() or {}
    count = 0
    if isinstance(raw, dict):
        for key in raw.keys():
            _rtdb_ref(f'meetings/{room_id}/presence/{key}').update({'handRaised': False})
            count += 1
    _hands_ref(room_id).delete()
    return {'cleared': count}
