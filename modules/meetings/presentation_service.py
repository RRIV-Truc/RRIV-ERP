"""Trình chiếu slide — trạng thái realtime trên Firebase RTDB."""
from __future__ import annotations

from typing import Any, Optional

from modules.meetings.rbac import UserContext, can_create_meeting
from modules.meetings.room_service import (
    _display_name,
    _now_iso,
    _rtdb_ref,
    _user_key,
)


def assert_can_present(supabase, ctx: UserContext) -> None:
    if not can_create_meeting(ctx, supabase):
        raise PermissionError('Chỉ chủ trì / thư ký mới được trình chiếu slide')


def _presentation_ref(room_id: str):
    return _rtdb_ref(f'meetings/{room_id}/presentation')


def get_presentation(room_id: str) -> Optional[dict]:
    if not room_id:
        return None
    data = _presentation_ref(room_id).get()
    if not isinstance(data, dict) or not data.get('active'):
        return None
    return data


def start_presentation(
    supabase,
    meeting: dict,
    ctx: UserContext,
    *,
    doc_id: str,
    doc_name: str,
    slide_count: int,
    mode: str,
    download_url: Optional[str] = None,
    direct: bool = False,
    pdf_iframe: bool = False,
) -> dict:
    assert_can_present(supabase, ctx)
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')
    if slide_count < 1:
        raise ValueError('Tài liệu không có slide')

    payload = {
        'active': True,
        'docId': doc_id,
        'docName': doc_name,
        'slideIndex': 0,
        'slideCount': slide_count,
        'mode': mode,
        'presenterKey': _user_key(ctx),
        'presenterName': _display_name(supabase, ctx),
        'presenterUsername': ctx.username,
        'startedAt': _now_iso(),
        'updatedAt': _now_iso(),
    }
    if download_url:
        payload['downloadUrl'] = download_url
    if direct:
        payload['direct'] = True
    if pdf_iframe:
        payload['pdfIframe'] = True
    try:
        _presentation_ref(room_id).set(payload)
        _rtdb_ref(f'meetings/{room_id}/meta').update({'lastActivity': _now_iso()})
    except Exception as exc:
        raise ValueError(f'Không ghi Firebase: {exc}') from exc
    return payload


def update_presentation_slide(
    supabase,
    meeting: dict,
    ctx: UserContext,
    slide_index: int,
    slide_count: Optional[int] = None,
) -> dict:
    assert_can_present(supabase, ctx)
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')

    ref = _presentation_ref(room_id)
    current = ref.get() or {}
    if not current.get('active'):
        raise ValueError('Chưa có trình chiếu đang chạy')

    total = int(current.get('slideCount') or 1)
    idx = max(0, min(int(slide_index), total - 1))
    now = _now_iso()
    patch = {
        'slideIndex': idx,
        'updatedAt': now,
        'presenterKey': _user_key(ctx),
        'presenterName': _display_name(supabase, ctx),
    }
    if slide_count is not None and int(slide_count) >= 1:
        patch['slideCount'] = int(slide_count)
    ref.update(patch)
    return {**current, **patch}


def stop_presentation(supabase, meeting: dict, ctx: UserContext) -> dict:
    assert_can_present(supabase, ctx)
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        return {'stopped': True}
    ref = _presentation_ref(room_id)
    current = ref.get() or {}
    ref.delete()
    _rtdb_ref(f'meetings/{room_id}/meta').update({'lastActivity': _now_iso()})
    return {'stopped': True, 'previous': current}


def parse_presentation_for_client(data: Any) -> Optional[dict]:
    if not isinstance(data, dict) or not data.get('active'):
        return None
    return {
        'active': True,
        'doc_id': data.get('docId'),
        'doc_name': data.get('docName'),
        'slide_index': int(data.get('slideIndex') or 0),
        'slide_count': int(data.get('slideCount') or 0),
        'mode': data.get('mode') or 'images',
        'presenter_key': data.get('presenterKey'),
        'presenter_name': data.get('presenterName'),
        'presenter_username': data.get('presenterUsername'),
        'started_at': data.get('startedAt'),
        'updated_at': data.get('updatedAt'),
        'download_url': data.get('downloadUrl'),
        'direct': bool(data.get('direct')),
        'pdf_iframe': bool(data.get('pdfIframe')),
    }
