"""Ghi âm phiên họp — lưu Supabase Storage + metadata Firebase RTDB."""
from __future__ import annotations

import os
import uuid
from typing import Any, Optional

from modules.meetings.document_service import BUCKET, _upload_bytes_supabase, _supabase_storage_client
from modules.meetings.meeting_roles import resolve_session_roles
from modules.meetings.rbac import UserContext
from modules.meetings.room_service import (
    _display_name,
    _now_iso,
    _rtdb_ref,
)


def _can_manage_recordings(supabase, meeting_id: str, ctx: UserContext) -> bool:
    roles = resolve_session_roles(supabase, meeting_id, ctx)
    return bool(
        roles.get('is_host')
        or roles.get('is_secretary')
        or roles.get('can_moderate')
    )


def _recordings_ref(room_id: str):
    return _rtdb_ref(f'meetings/{room_id}/recordings')


def _recording_storage_path(meeting_id: str, recording_id: str, ext: str) -> str:
    ext = (ext or 'webm').lstrip('.').lower() or 'webm'
    return f'recordings/{meeting_id}/{recording_id}.{ext}'


def parse_recordings_for_client(
    data: Any,
    ctx: UserContext,
    *,
    can_view: bool,
) -> list:
    if not can_view or not isinstance(data, dict):
        return []
    items = []
    for rec_id, raw in data.items():
        if not isinstance(raw, dict):
            continue
        items.append({**raw, 'id': raw.get('id') or str(rec_id)})
    items.sort(key=lambda x: x.get('created_at') or '', reverse=True)
    return items


def list_recordings(meeting: dict, ctx: UserContext, supabase) -> list:
    meeting_id = meeting['id']
    if not _can_manage_recordings(supabase, meeting_id, ctx):
        raise PermissionError('Chỉ Chủ trì / Thư ký mới xem được ghi âm phiên họp')
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        return []
    raw = _recordings_ref(room_id).get() or {}
    return parse_recordings_for_client(raw, ctx, can_view=True)


def save_recording(
    supabase,
    meeting: dict,
    ctx: UserContext,
    *,
    data: bytes,
    recording_type: str,
    mime_type: str,
    duration_sec: Optional[float] = None,
    transcript: Optional[str] = None,
    label: Optional[str] = None,
) -> dict:
    meeting_id = meeting['id']
    if not _can_manage_recordings(supabase, meeting_id, ctx):
        raise PermissionError('Chỉ Chủ trì / Thư ký mới ghi âm phiên họp')

    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng online')

    rtype = (recording_type or 'session').strip().lower()
    if rtype not in ('session', 'conclusion'):
        raise ValueError('Loại ghi âm không hợp lệ')

    if not data:
        raise ValueError('File ghi âm trống')

    max_mb = 120 if rtype == 'session' else 15
    size = len(data)
    if size > max_mb * 1024 * 1024:
        raise ValueError(f'File ghi âm quá lớn (tối đa {max_mb} MB)')

    mime = (mime_type or 'audio/webm').split(';')[0].strip().lower()
    ext_map = {
        'audio/webm': 'webm',
        'audio/ogg': 'ogg',
        'audio/mp4': 'm4a',
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
    }
    ext = ext_map.get(mime, 'webm')

    rec_id = uuid.uuid4().hex[:16]
    storage_path = _recording_storage_path(meeting_id, rec_id, ext)
    _upload_bytes_supabase(data, storage_path, mime)

    now = _now_iso()
    default_label = 'Ghi âm phiên họp' if rtype == 'session' else 'Kết luận'
    payload = {
        'id': rec_id,
        'type': rtype,
        'label': (label or '').strip() or default_label,
        'storage_path': storage_path,
        'mime_type': mime,
        'size_bytes': size,
        'duration_sec': duration_sec,
        'transcript': (transcript or '').strip() or None,
        'created_at': now,
        'created_by_username': ctx.username,
        'created_by_name': _display_name(supabase, ctx),
    }
    _recordings_ref(room_id).child(rec_id).set(payload)
    _rtdb_ref(f'meetings/{room_id}/meta').update({'lastActivity': now})
    return payload


def get_recording_download_url(
    supabase,
    meeting: dict,
    ctx: UserContext,
    recording_id: str,
    *,
    expires_in: int = 3600,
) -> dict:
    meeting_id = meeting['id']
    if not _can_manage_recordings(supabase, meeting_id, ctx):
        raise PermissionError('Chỉ Chủ trì / Thư ký mới tải được ghi âm')

    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise LookupError('Cuộc họp chưa có phòng online')

    raw = _recordings_ref(room_id).child(recording_id).get() or {}
    if not raw:
        raise LookupError('Không tìm thấy bản ghi âm')

    path = raw.get('storage_path')
    if not path:
        raise FileNotFoundError('Thiếu đường dẫn file ghi âm')

    res = _supabase_storage_client().storage.from_(BUCKET).create_signed_url(path, expires_in)
    url = None
    if isinstance(res, dict):
        url = (
            res.get('signedURL') or res.get('signedUrl') or
            res.get('signed_url') or (res.get('data') or {}).get('signedURL')
        )
    if not url:
        raise RuntimeError('Không tạo được link tải ghi âm')

    return {
        'recording': raw,
        'url': url,
        'filename': f"{raw.get('label') or recording_id}.{(path.rsplit('.', 1)[-1] if '.' in path else 'webm')}",
    }


def transcribe_conclusion_audio(data: bytes, mime_type: str) -> str:
    """Chuyển audio kết luận ngắn → text qua OpenAI Whisper (nếu có API key)."""
    api_key = (os.getenv('OPENAI_API_KEY') or '').strip()
    if not api_key:
        raise ValueError(
            'Chưa cấu hình OPENAI_API_KEY trên server. '
            'Thư ký có thể dùng «Nhận giọng nói» trên trình duyệt hoặc nghe lại file ghi âm.'
        )

    if len(data) > 15 * 1024 * 1024:
        raise ValueError('Đoạn kết luận quá dài — tối đa 15 MB')

    import json
    import urllib.error
    import urllib.request

    mime = (mime_type or 'audio/webm').split(';')[0].strip() or 'audio/webm'
    ext = 'webm'
    if 'ogg' in mime:
        ext = 'ogg'
    elif 'mp4' in mime or 'm4a' in mime:
        ext = 'm4a'
    elif 'mpeg' in mime or 'mp3' in mime:
        ext = 'mp3'
    elif 'wav' in mime:
        ext = 'wav'

    boundary = f'----RRIVRecording{uuid.uuid4().hex}'
    body_parts = [
        f'--{boundary}\r\n'.encode(),
        b'Content-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n',
        f'--{boundary}\r\n'.encode(),
        b'Content-Disposition: form-data; name="language"\r\n\r\nvi\r\n',
        f'--{boundary}\r\n'.encode(),
        f'Content-Disposition: form-data; name="file"; filename="conclusion.{ext}"\r\n'.encode(),
        f'Content-Type: {mime}\r\n\r\n'.encode(),
        data,
        b'\r\n',
        f'--{boundary}--\r\n'.encode(),
    ]
    body = b''.join(body_parts)

    req = urllib.request.Request(
        'https://api.openai.com/v1/audio/transcriptions',
        data=body,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': f'multipart/form-data; boundary={boundary}',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace')[:400]
        raise ValueError(f'Whisper API lỗi (HTTP {exc.code}): {detail}') from exc
    except urllib.error.URLError as exc:
        raise ValueError(f'Không kết nối được Whisper API: {exc.reason}') from exc

    text = (result.get('text') or '').strip()
    if not text:
        raise ValueError('Không nhận diện được giọng nói — thử ghi lại rõ hơn')
    return text
