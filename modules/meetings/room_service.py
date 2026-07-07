"""Phòng họp realtime — proxy Firebase RTDB qua Service Account."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from modules.meetings.firebase_admin_client import init_firebase_admin_with_service_account
from modules.meetings.rbac import UserContext, can_create_meeting

VN_TZ = ZoneInfo('Asia/Ho_Chi_Minh')


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if isinstance(value, str) and value.strip():
        try:
            return datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    return None


def _meeting_local_date(meeting: dict):
    start = _parse_dt(meeting.get('scheduled_start'))
    if not start:
        return None
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    return start.astimezone(VN_TZ).date()


def is_meeting_past_by_day(meeting: dict) -> bool:
    """Đã qua khi sang ngày hôm sau (VN) so với ngày lên lịch — trừ phiên đang live."""
    st = (meeting.get('status') or '').lower()
    if st == 'live':
        return False
    meeting_day = _meeting_local_date(meeting)
    if not meeting_day:
        return False
    return datetime.now(VN_TZ).date() > meeting_day


def is_meeting_in_join_window(meeting: dict) -> bool:
    st = (meeting.get('status') or '').lower()
    if st in ('completed', 'cancelled'):
        return False
    if st == 'live':
        return True
    if st not in ('scheduled', 'draft', 'live'):
        return False
    if is_meeting_past_by_day(meeting):
        return False
    return True


def ensure_firebase_room(supabase, meeting: dict) -> dict:
    """Tạo phòng Firebase nếu cuộc họp internal chưa có (cuộc họp cũ / tại chỗ)."""
    if meeting.get('firebase_room_id'):
        return meeting
    platform = (meeting.get('platform_type') or 'internal').lower()
    if platform != 'internal':
        raise ValueError('Cuộc họp chưa có phòng online')

    from modules.meetings.providers.internal import InternalFirebaseProvider
    from modules.meetings.schemas import MeetingCreate

    start = _parse_dt(meeting.get('scheduled_start')) or datetime.now(timezone.utc)
    end = _parse_dt(meeting.get('scheduled_end')) or start
    if end <= start:
        end = start

    mode = meeting.get('meeting_mode') or 'hybrid'
    payload = MeetingCreate(
        title=meeting.get('title') or 'Cuộc họp',
        meeting_mode=mode,
        platform_type='internal',
        status=meeting.get('status') or 'scheduled',
        scheduled_start=start,
        scheduled_end=end,
        physical_room_id=meeting.get('physical_room_id'),
    )
    result = InternalFirebaseProvider().create_meeting(payload, meeting['id'])
    now = _now_iso()
    patch = {
        'firebase_room_id': result.firebase_room_id,
        'online_meeting_url': result.online_meeting_url,
        'online_meeting_id': result.online_meeting_id,
        'updated_at': now,
    }
    supabase.table('meetings').update(patch).eq('id', meeting['id']).execute()
    meeting = {**meeting, **patch}
    return meeting


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
    return is_meeting_in_join_window(meeting)


def join_room(supabase, meeting: dict, ctx: UserContext) -> dict:
    if not can_join_meeting(meeting):
        raise ValueError('Cuộc họp không còn mở để tham gia')
    meeting = ensure_firebase_room(supabase, meeting)
    room_id = meeting.get('firebase_room_id')

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

    try:
        from modules.meetings.session_storage import warm_session_documents_from_supabase
        warm_session_documents_from_supabase(supabase, meeting_id)
    except Exception as exc:
        print(f'[room_service] warm session docs on join: {exc}')

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


def _is_presence_online(entry: dict) -> bool:
    """Coi là offline nếu cờ online=false hoặc không heartbeat >45s."""
    if not isinstance(entry, dict):
        return False
    if entry.get('online') is False:
        return False
    last = _parse_dt(entry.get('lastSeen'))
    if not last:
        return bool(entry.get('online'))
    age = (datetime.now(timezone.utc) - last).total_seconds()
    return age <= 45


def _parse_presence(presence: Any, *, online_only: bool = True) -> list:
    if not isinstance(presence, dict):
        return []
    out = []
    for k, v in presence.items():
        if not isinstance(v, dict):
            continue
        online = _is_presence_online(v)
        if online_only and not online:
            continue
        out.append({
            'key': k,
            'displayName': v.get('displayName') or v.get('username') or k,
            'username': v.get('username'),
            'employeeId': v.get('employeeId'),
            'lastSeen': v.get('lastSeen'),
            'online': online,
        })
    out.sort(key=lambda x: x.get('displayName') or '')
    return out


def _participant_display_name(p: dict, names_by_id: dict) -> str:
    if p.get('is_external'):
        return p.get('external_name') or p.get('external_email') or 'Khách mời'
    emp = names_by_id.get(str(p.get('employee_id') or ''))
    if emp and emp.get('full_name'):
        return emp['full_name']
    return p.get('username') or '—'


def _role_label_vi(role: str) -> str:
    labels = {
        'host': 'Chủ trì',
        'secretary': 'Thư ký',
        'organizer': 'Người tạo',
        'observer': 'Quan sát',
        'participant': 'Đại biểu',
    }
    return labels.get((role or '').lower(), 'Đại biểu')


def _build_attendee_roster(
    supabase,
    meeting_id: str,
    presence_raw: Any,
) -> list:
    """Danh sách mời + trạng thái online/offline thực tế."""
    try:
        pr = supabase.table('meeting_participants').select(
            'employee_id, username, participant_role, is_external, external_name, external_email'
        ).eq('meeting_id', meeting_id).execute()
        participants = pr.data or []
    except Exception:
        participants = []

    emp_ids = [p['employee_id'] for p in participants if p.get('employee_id')]
    names_by_id: dict = {}
    if emp_ids:
        try:
            er = supabase.table('employee').select('id, full_name').in_('id', emp_ids).execute()
            for row in er.data or []:
                names_by_id[str(row['id'])] = row
        except Exception:
            pass

    pres_map: dict = {}
    if isinstance(presence_raw, dict):
        for k, v in presence_raw.items():
            if isinstance(v, dict):
                pres_map[k] = v
                un = (v.get('username') or '').strip().lower()
                if un:
                    pres_map[f'user_{un}'] = v

    roster = []
    seen_keys = set()
    for p in participants:
        role = (p.get('participant_role') or 'participant').lower()
        if p.get('is_external'):
            key = f"ext_{(p.get('external_email') or p.get('external_name') or '').strip().lower()}"
            pres = None
            if p.get('external_email'):
                pres = pres_map.get(f"user_{p['external_email'].strip().lower()}")
        else:
            key = f"emp_{p['employee_id']}" if p.get('employee_id') else f"user_{(p.get('username') or '').strip().lower()}"
            pres = pres_map.get(key)
            if not pres and p.get('username'):
                pres = pres_map.get(f"user_{p['username'].strip().lower()}")
        seen_keys.add(key)
        online = _is_presence_online(pres) if pres else False
        roster.append({
            'key': key,
            'displayName': _participant_display_name(p, names_by_id),
            'username': p.get('username'),
            'employeeId': p.get('employee_id'),
            'participant_role': role,
            'role_label': _role_label_vi(role),
            'online': online,
            'lastSeen': pres.get('lastSeen') if pres else None,
        })

    if isinstance(presence_raw, dict):
        for k, v in presence_raw.items():
            if not isinstance(v, dict) or k in seen_keys:
                continue
            if not _is_presence_online(v):
                continue
            un = (v.get('username') or '').strip().lower()
            if any((r.get('username') or '').strip().lower() == un for r in roster if un):
                continue
            roster.append({
                'key': k,
                'displayName': v.get('displayName') or v.get('username') or k,
                'username': v.get('username'),
                'employeeId': v.get('employeeId'),
                'participant_role': 'guest',
                'role_label': 'Khách',
                'online': True,
                'lastSeen': v.get('lastSeen'),
            })

    roster.sort(key=lambda x: (
        0 if x.get('online') else 1,
        0 if x.get('participant_role') == 'host' else (
            1 if x.get('participant_role') == 'secretary' else 2
        ),
        x.get('displayName') or '',
    ))
    return roster


def get_room_state(supabase, meeting: dict, ctx: UserContext) -> dict:
    meeting = ensure_firebase_room(supabase, meeting)
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')

    snap = _rtdb_ref(f'meetings/{room_id}').get() or {}
    meta = snap.get('meta') or {}
    chat = _parse_chat(snap.get('chat'))
    presence_raw = snap.get('presence')
    presence = _parse_presence(presence_raw, online_only=True)
    meeting_id = meeting.get('id')
    attendees = _build_attendee_roster(supabase, meeting_id, presence_raw)
    online_count = sum(1 for a in attendees if a.get('online'))
    from modules.meetings.meeting_roles import resolve_session_roles
    from modules.meetings.presentation_service import parse_presentation_for_client
    from modules.meetings.screen_share_service import (
        parse_screen_share_for_client,
        parse_screen_share_requests_for_client,
    )
    roles = resolve_session_roles(supabase, meeting_id, ctx)
    presentation = parse_presentation_for_client(snap.get('presentation'))
    screen_share = parse_screen_share_for_client(snap.get('screenShare'))
    screen_share_requests = parse_screen_share_requests_for_client(
        snap.get('screenShareRequests'),
        ctx,
        is_host=roles.get('can_approve_share', False),
    )

    return {
        'meeting_id': meeting_id,
        'meeting_code': meeting.get('meeting_code'),
        'title': meeting.get('title'),
        'status': meeting.get('status') or meta.get('status'),
        'firebase_room_id': room_id,
        'meta': meta,
        'chat': chat,
        'presence': presence,
        'attendees': attendees,
        'presence_count': online_count,
        'self_key': _user_key(ctx),
        'is_host': roles.get('is_host', False),
        'is_secretary': roles.get('is_secretary', False),
        'can_moderate': roles.get('can_moderate', False),
        'can_approve_share': roles.get('can_approve_share', False),
        'participant_role': roles.get('participant_role'),
        'presentation': presentation,
        'screen_share': screen_share,
        'screen_share_requests': screen_share_requests,
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
