"""Điều phối tạo cuộc họp đa nền tảng."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

from modules.meetings.providers.google_meet import GoogleMeetProvider
from modules.meetings.providers.internal import InternalFirebaseProvider
from modules.meetings.providers.zoom import ZoomProvider
from modules.meetings.schemas import MeetingCreate, MeetingUpdate, PlatformMeetingResult, PlatformType
from modules.meetings.rbac import UserContext

PlatformLiteral = Literal['internal', 'zoom', 'google_meet']

_PROVIDERS = {
    'internal': InternalFirebaseProvider(),
    'zoom': ZoomProvider(),
    'google_meet': GoogleMeetProvider(),
}


def get_provider(platform_type: PlatformType | str):
    provider = _PROVIDERS.get(platform_type)
    if not provider:
        raise ValueError(f'Platform không hỗ trợ: {platform_type}')
    return provider


def _next_meeting_code(supabase) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f'MTG-{year}-'
    try:
        res = supabase.table('meetings').select('meeting_code').like(
            'meeting_code', f'{prefix}%'
        ).order('meeting_code', desc=True).limit(1).execute()
        if res.data and res.data[0].get('meeting_code'):
            last = res.data[0]['meeting_code']
            try:
                seq = int(last.split('-')[-1]) + 1
            except ValueError:
                seq = 1
        else:
            seq = 1
    except Exception:
        seq = int(datetime.now(timezone.utc).timestamp()) % 100000
    return f'{prefix}{seq:04d}'


def _insert_participants(supabase, meeting_id: str, participants: list, organizer_ctx: UserContext):
    rows = []
    seen = set()
    for p in participants:
        key = str(p.employee_id or p.username or p.external_email)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            'id': str(uuid.uuid4()),
            'meeting_id': meeting_id,
            'employee_id': str(p.employee_id) if p.employee_id else None,
            'username': (p.username or '').strip().lower() or None,
            'participant_role': p.participant_role,
            'is_external': p.is_external,
            'external_name': p.external_name,
            'external_email': p.external_email,
            'rsvp_status': 'pending',
        })

    if organizer_ctx.employee_id or organizer_ctx.username:
        org_key = organizer_ctx.employee_id or organizer_ctx.username
        if org_key not in seen:
            rows.append({
                'id': str(uuid.uuid4()),
                'meeting_id': meeting_id,
                'employee_id': organizer_ctx.employee_id,
                'username': organizer_ctx.username,
                'participant_role': 'organizer',
                'is_external': False,
                'rsvp_status': 'accepted',
            })

    if rows:
        supabase.table('meeting_participants').insert(rows).execute()


def _enrich_meeting(supabase, meeting: dict) -> dict:
    """Bổ sung tên phòng, số người mời, tên participant."""
    if not meeting:
        return meeting
    m = dict(meeting)
    mid = m.get('id') or m.get('meeting_id')
    if m.get('meeting_id') and not m.get('id'):
        m['id'] = m['meeting_id']
    if m.get('meeting_status') and not m.get('status'):
        m['status'] = m['meeting_status']

    room_id = m.get('physical_room_id')
    if room_id:
        try:
            rr = supabase.table('meeting_rooms').select('room_code,name').eq('id', room_id).limit(1).execute()
            if rr.data:
                m['room_code'] = rr.data[0].get('room_code')
                m['room_name'] = rr.data[0].get('name')
        except Exception:
            pass

    if mid:
        try:
            pr = supabase.table('meeting_participants').select(
                'id, employee_id, username, participant_role, rsvp_status, is_external, external_name'
            ).eq('meeting_id', mid).execute()
            parts = pr.data or []
            m['participant_count'] = len(parts)
            if 'participants' not in m or not m.get('participants'):
                m['participants'] = parts
        except Exception:
            m['participant_count'] = m.get('participant_count') or 0

    return m


def create_meeting(
    supabase,
    payload: MeetingCreate,
    ctx: UserContext,
    platform_type: PlatformLiteral | None = None,
) -> dict:
    platform = platform_type or payload.platform_type
    meeting_id = str(uuid.uuid4())
    meeting_code = _next_meeting_code(supabase)

    organizer_id = payload.organizer_employee_id
    if organizer_id is None and ctx.employee_id:
        organizer_id = ctx.employee_id

    row = {
        'id': meeting_id,
        'meeting_code': meeting_code,
        'title': payload.title,
        'description': payload.description,
        'meeting_mode': payload.meeting_mode,
        'platform_type': platform,
        'status': payload.status,
        'scheduled_start': payload.scheduled_start.isoformat(),
        'scheduled_end': payload.scheduled_end.isoformat(),
        'physical_room_id': payload.physical_room_id,
        'organizer_employee_id': str(organizer_id) if organizer_id else None,
        'created_by_username': ctx.username,
        'department_id': payload.department_id or ctx.department_id,
        'metadata': payload.metadata or {},
    }

    platform_result: PlatformMeetingResult | None = None
    defer_firebase = platform == 'internal'
    if not defer_firebase and (platform != 'internal' or payload.meeting_mode != 'in_person'):
        provider = get_provider(platform)
        platform_result = provider.create_meeting(payload, meeting_id)
        row['online_meeting_url'] = platform_result.online_meeting_url
        row['online_meeting_id'] = platform_result.online_meeting_id
        row['online_meeting_password'] = platform_result.online_meeting_password
        row['firebase_room_id'] = platform_result.firebase_room_id

    res = supabase.table('meetings').insert(row).execute()
    if not res.data:
        raise RuntimeError('Không thể lưu cuộc họp vào Supabase')

    _insert_participants(supabase, meeting_id, payload.participants, ctx)

    has_shared_docs = False
    if payload.shared_document_ids is not None:
        from modules.meetings import document_service as doc_svc
        try:
            doc_svc.set_document_shares(
                supabase, meeting_id, ctx, payload.shared_document_ids,
                defer_firebase_sync=True,
            )
            has_shared_docs = bool(payload.shared_document_ids)
        except (RuntimeError, ValueError) as exc:
            raise ValueError(str(exc)) from exc

    doc = dict(res.data[0])
    doc['participant_count'] = len(payload.participants or []) + 1
    if platform_result:
        doc['platform'] = platform_result.model_dump()

    if defer_firebase:
        from modules.meetings.background import defer_meeting_firebase_setup
        defer_meeting_firebase_setup(
            meeting_id,
            warm_documents=has_shared_docs or payload.shared_document_ids is not None,
        )

    return doc


def update_meeting(supabase, meeting_id: str, payload: MeetingUpdate, ctx: UserContext) -> dict:
    patch = payload.model_dump(
        exclude_unset=True,
        exclude={'participants', 'shared_document_ids'},
    )
    for k in ('scheduled_start', 'scheduled_end'):
        if k in patch and patch[k] is not None:
            patch[k] = patch[k].isoformat() if hasattr(patch[k], 'isoformat') else patch[k]
    patch['updated_at'] = datetime.now(timezone.utc).isoformat()

    if patch:
        supabase.table('meetings').update(patch).eq('id', meeting_id).execute()

    if payload.participants is not None:
        supabase.table('meeting_participants').delete().eq('meeting_id', meeting_id).execute()
        _insert_participants(supabase, meeting_id, payload.participants, ctx)

    participant_count = None
    if payload.participants is not None:
        participant_count = len(payload.participants) + 1

    warm_docs = False
    if payload.shared_document_ids is not None:
        from modules.meetings import document_service as doc_svc
        try:
            doc_svc.set_document_shares(
                supabase, meeting_id, ctx, payload.shared_document_ids,
                defer_firebase_sync=True,
            )
            warm_docs = True
        except RuntimeError as exc:
            raise ValueError(str(exc)) from exc

    res = supabase.table('meetings').select('*').eq('id', meeting_id).limit(1).execute()
    if not res.data:
        return {}
    doc = dict(res.data[0])
    if participant_count is not None:
        doc['participant_count'] = participant_count

    meeting_platform = (doc.get('platform_type') or 'internal').lower()
    if meeting_platform == 'internal':
        from modules.meetings.background import defer_meeting_firebase_setup
        defer_meeting_firebase_setup(meeting_id, warm_documents=warm_docs)

    return doc


def list_meetings(supabase, ctx: UserContext, limit: int = 50) -> list:
    if ctx.is_global_admin or _user_is_app_admin(supabase, ctx):
        res = supabase.table('meetings').select('*').order(
            'scheduled_start', desc=True
        ).limit(limit).execute()
        return [_enrich_meeting(supabase, row) for row in (res.data or [])]

    if not ctx.employee_id and not ctx.username:
        return []

    res = supabase.table('v_meeting_participant_access').select(
        'meeting_id, meeting_code, title, meeting_status, scheduled_start, scheduled_end, firebase_room_id'
    )
    if ctx.employee_id:
        res = res.eq('employee_id', ctx.employee_id)
    else:
        res = res.eq('username_norm', ctx.username)
    out = res.order('scheduled_start', desc=True).limit(limit).execute()
    rows = []
    for row in out.data or []:
        mid = row.get('meeting_id')
        try:
            if mid:
                full = supabase.table('meetings').select('*').eq('id', mid).limit(1).execute()
                if full.data:
                    rows.append(_enrich_meeting(supabase, full.data[0]))
                    continue
            rows.append(_enrich_meeting(supabase, row))
        except Exception as exc:
            print(f'[list_meetings] skip meeting {mid}: {exc}')
            rows.append(_enrich_meeting(supabase, row))
    return rows


def _user_is_app_admin(supabase, ctx: UserContext) -> bool:
    from modules.meetings.rbac import get_effective_app_data, MEETING_MANAGER_ROLES
    roles = {str(r).lower() for r in (get_effective_app_data(ctx).get('roles') or [])}
    return bool(roles & MEETING_MANAGER_ROLES) or 'admin' in roles


def get_meeting_detail_enriched(supabase, meeting_id: str) -> dict | None:
    res = supabase.table('meetings').select('*').eq('id', meeting_id).limit(1).execute()
    if not res.data:
        return None
    meeting = res.data[0]
    parts = supabase.table('meeting_participants').select('*').eq(
        'meeting_id', meeting_id
    ).execute()
    meeting['participants'] = parts.data or []

    emp_ids = [p['employee_id'] for p in meeting['participants'] if p.get('employee_id')]
    names_by_id: dict = {}
    if emp_ids:
        er = supabase.table('employee').select('id, full_name, employee_code, department_name').in_(
            'id', emp_ids
        ).execute()
        for row in er.data or []:
            names_by_id[str(row['id'])] = row

    for p in meeting['participants']:
        emp = names_by_id.get(str(p.get('employee_id') or ''))
        if emp:
            p['display_name'] = emp.get('full_name')
            p['employee_code'] = emp.get('employee_code')
            p['department_name'] = emp.get('department_name')
        elif p.get('username'):
            p['display_name'] = p['username']
        elif p.get('external_name'):
            p['display_name'] = p['external_name']

    return _enrich_meeting(supabase, meeting)


def get_meeting_detail(supabase, meeting_id: str) -> dict | None:
    return get_meeting_detail_enriched(supabase, meeting_id)


def delete_meeting(supabase, meeting_id: str, ctx: UserContext) -> bool:
    """Xóa vĩnh viễn cuộc họp (chỉ admin/manager — kiểm tra ở route)."""
    meeting = get_meeting_detail(supabase, meeting_id)
    if not meeting:
        return False

    room_id = meeting.get('firebase_room_id')
    if room_id and meeting.get('platform_type') == 'internal':
        try:
            get_provider('internal').delete_meeting(room_id)
        except Exception as exc:
            print(f'delete_meeting firebase cleanup: {exc}')

    supabase.table('meetings').delete().eq('id', meeting_id).execute()
    return True
