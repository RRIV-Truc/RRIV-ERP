"""Tác vụ nền — đồng bộ Firebase sau khi đã lưu Supabase."""
from __future__ import annotations

import threading
from typing import Callable, Optional


def _run_in_background(fn: Callable, *args, **kwargs) -> None:
    from flask import current_app

    app = current_app._get_current_object()

    def worker() -> None:
        with app.app_context():
            try:
                fn(*args, **kwargs)
            except Exception as exc:
                print(f'[meetings.background] {getattr(fn, "__name__", fn)}: {exc}')

    threading.Thread(target=worker, daemon=True).start()


def _sync_meeting_firebase(meeting_id: str, *, warm_documents: bool) -> None:
    from flask import current_app

    supabase = current_app.config['SUPABASE_CLIENT']
    from modules.meetings.document_service import get_shared_root_ids
    from modules.meetings.room_service import ensure_firebase_room
    from modules.meetings.service import get_meeting_detail
    from modules.meetings.warm_service import sync_shared_documents_to_firebase

    meeting = get_meeting_detail(supabase, meeting_id)
    if not meeting:
        return
    if (meeting.get('platform_type') or 'internal').lower() != 'internal':
        return

    meeting = ensure_firebase_room(supabase, meeting)

    if not warm_documents:
        return

    shared_roots = sorted(get_shared_root_ids(supabase, meeting_id))
    if not shared_roots:
        return

    sync_shared_documents_to_firebase(supabase, meeting_id, shared_roots)


def defer_meeting_firebase_setup(meeting_id: str, *, warm_documents: bool = False) -> None:
    """Tạo phòng Firebase + (tuỳ chọn) warm tài liệu chia sẻ — không chặn HTTP response."""
    _run_in_background(_sync_meeting_firebase, meeting_id, warm_documents=warm_documents)
