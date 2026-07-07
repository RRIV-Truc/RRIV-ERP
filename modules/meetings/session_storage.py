"""
Kiến trúc lưu trữ Phòng họp (3 tầng):

1. Supabase — nguồn chính thức, vĩnh viễn (PostgreSQL + Storage bucket meeting-docs)
2. Firebase — hot cache theo phiên (RTDB metadata + Storage sessions/{room_id}/…)
3. Trình duyệt — IndexedDB (doc-cache.js) để mở lại tức thì / offline ngắn

Server production (Render) KHÔNG dùng ổ đĩa local.
"""
from __future__ import annotations

from modules.meetings.document_service import get_shared_root_ids
from modules.meetings.service import get_meeting_detail
from modules.meetings.warm_service import sync_shared_documents_to_firebase


def warm_session_documents_from_supabase(supabase, meeting_id: str) -> dict:
    """
    Khi vào phòng: copy tài liệu đã chọn (chia sẻ) từ Supabase lên Firebase phiên.
    Bỏ qua nếu chưa có phòng Firebase hoặc chưa chọn tài liệu chia sẻ.
    """
    meeting = get_meeting_detail(supabase, meeting_id)
    if not meeting or not meeting.get('firebase_room_id'):
        return {'skipped': True, 'reason': 'no_firebase_room'}

    shared_roots = sorted(get_shared_root_ids(supabase, meeting_id))
    if not shared_roots:
        return {'skipped': True, 'reason': 'no_shared_documents', 'meeting_id': meeting_id}

    return sync_shared_documents_to_firebase(supabase, meeting_id, shared_roots)
