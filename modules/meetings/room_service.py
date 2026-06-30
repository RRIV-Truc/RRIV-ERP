"""Phòng họp realtime — proxy Firebase RTDB qua Service Account."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from modules.meetings.firebase_admin_client import init_firebase_admin_with_service_account
from modules.meetings.rbac import UserContext, can_create_meeting


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rtdb_ref(path: str):
    from firebase_admin import db

    init_firebase_admin_with_service_account()
    return db.reference(path)


def _user_key(ctx: UserContext) -> str:
    if ctx.employee_id:
        return f'emp_{ctx.employee_id}'
    return f'user_{ctx.username}'


def _display_name(supabase, ctx: UserContext) -> str:
    if ctx.employee_id:
        try:
            res = supabase.table('employee').select('full_name').eq('id', ctx.employee_id).limit(1).execute()
            if res.data and res.data[0].get('full_name'):
                return res.data[0]['full_name']
        except Exception:
            pass
    return ctx.username


def find_meeting_by_code(supabase, code: str) -> Optional[dict]:
    code = (code or '').strip().upper()
    if not code:
        return None
    res = supabase.table('meetings').select('*').eq('meeting_code', code).limit(1).execute()
    return res.data[0] if res.data else None


def can_join_meeting(meeting: dict) -> bool:
    st = (meeting.get('status') or '').lower()
    return st in ('scheduled', 'live', 'draft')


def join_room(supabase, meeting: dict, ctx: UserContext) -> dict:
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')
    if not can_join_meeting(meeting):
        raise ValueError('Cuộc họp không còn mở để tham gia')

    meeting_id = meeting['id']
    now = _now_iso()
    name = _display_name(supabase, ctx)
    key = _user_key(ctx)

    presence_data = {
        'username': ctx.username,
        'employeeId': ctx.employee_id,
        'displayName': name,
        'online': True,
        'joinedAt': now,
        'lastSeen': now,
    }
    _rtdb_ref(f'meetings/{room_id}/presence/{key}').set(presence_data)

    participants_data = {
        'username': ctx.username,
        'employeeId': ctx.employee_id,
        'displayName': name,
        'joinedAt': now,
        'lastSeen': now,
    }
    _rtdb_ref(f'meetings/{room_id}/participants/{key}').update(participants_data)

    meta_ref = _rtdb_ref(f'meetings/{room_id}/meta')
    meta = meta_ref.get() or {}
    patch_meta = {'lastActivity': now}
    if not meta.get('actualStart'):
        patch_meta['actualStart'] = now
        patch_meta['status'] = 'live'
    meta_ref.update(patch_meta)

    if (meeting.get('status') or '') != 'live':
        supabase.table('meetings').update({
            'status': 'live',
            'actual_start': now,
            'updated_at': now,
        }).eq('id', meeting_id).execute()

    return get_room_state(supabase, meeting, ctx)


def leave_room(supabase, meeting: dict, ctx: UserContext) -> dict:
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        return {'left': True}
    now = _now_iso()
    key = _user_key(ctx)
    ref = _rtdb_ref(f'meetings/{room_id}/presence/{key}')
    ref.update({'online': False, 'leftAt': now, 'lastSeen': now})
    _rtdb_ref(f'meetings/{room_id}/participants/{key}').update({'leftAt': now, 'lastSeen': now})
    return {'left': True, 'at': now}


def post_chat(supabase, meeting: dict, ctx: UserContext, message: str) -> dict:
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')
    text = (message or '').strip()
    if not text:
        raise ValueError('Tin nhắn trống')
    if len(text) > 4000:
        raise ValueError('Tin nhắn quá dài')

    now = _now_iso()
    msg_id = uuid.uuid4().hex[:16]
    payload = {
        'id': msg_id,
        'text': text,
        'username': ctx.username,
        'employeeId': ctx.employee_id,
        'displayName': _display_name(supabase, ctx),
        'at': now,
    }
    _rtdb_ref(f'meetings/{room_id}/chat/{msg_id}').set(payload)
    _rtdb_ref(f'meetings/{room_id}/meta').update({'lastActivity': now})
    return payload


def _parse_chat(chat: Any) -> list:
    if not isinstance(chat, dict):
        return []
    items = []
    for k, v in chat.items():
        if isinstance(v, dict):
            items.append({**v, 'id': v.get('id') or k})
    items.sort(key=lambda x: x.get('at') or '')
    return items[-200:]


def _parse_presence(presence: Any) -> list:
    if not isinstance(presence, dict):
        return []
    out = []
    for k, v in presence.items():
        if not isinstance(v, dict):
            continue
        if v.get('online') is False:
            continue
        out.append({
            'key': k,
            'displayName': v.get('displayName') or v.get('username') or k,
            'username': v.get('username'),
            'employeeId': v.get('employeeId'),
            'lastSeen': v.get('lastSeen'),
        })
    out.sort(key=lambda x: x.get('displayName') or '')
    return out


def get_room_state(supabase, meeting: dict, ctx: UserContext) -> dict:
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')

    snap = _rtdb_ref(f'meetings/{room_id}').get() or {}
    meta = snap.get('meta') or {}
    chat = _parse_chat(snap.get('chat'))
    presence = _parse_presence(snap.get('presence'))

    return {
        'meeting_id': meeting.get('id'),
        'meeting_code': meeting.get('meeting_code'),
        'title': meeting.get('title'),
        'status': meeting.get('status') or meta.get('status'),
        'firebase_room_id': room_id,
        'meta': meta,
        'chat': chat,
        'presence': presence,
        'presence_count': len(presence),
        'self_key': _user_key(ctx),
    }


def heartbeat(supabase, meeting: dict, ctx: UserContext) -> None:
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        return
    now = _now_iso()
    key = _user_key(ctx)
    _rtdb_ref(f'meetings/{room_id}/presence/{key}').update({
        'online': True,
        'lastSeen': now,
    })


def assert_can_access(supabase, meeting_id: str, ctx: UserContext) -> dict:
    from modules.meetings.rbac import is_meeting_participant

    res = supabase.table('meetings').select('*').eq('id', meeting_id).limit(1).execute()
    if not res.data:
        raise LookupError('Không tìm thấy cuộc họp')
    meeting = res.data[0]
    if not is_meeting_participant(supabase, meeting_id, ctx) and not can_create_meeting(ctx, supabase):
        raise PermissionError('Bạn không có quyền vào phòng họp này')
    return meeting
