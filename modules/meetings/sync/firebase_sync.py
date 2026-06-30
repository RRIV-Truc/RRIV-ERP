"""
Đồng bộ Firebase Realtime Database → Supabase.

Auth Python ↔ Firebase: Service Account key ONLY
  → modules.meetings.firebase_admin_client.init_firebase_admin_with_service_account()

KHÔNG dùng: Firebase Auth user ID token, OAuth cá nhân, gcloud user login.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from modules.meetings.firebase_admin_client import init_firebase_admin_with_service_account


def _parse_iso_ts(value: Any) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000.0, tz=timezone.utc).isoformat()
    return str(value)


class FirebaseMeetingSync:
    """Đọc snapshot RTDB và ghi metadata quan trọng vào Supabase."""

    def __init__(self, supabase_client):
        self.supabase = supabase_client

    def fetch_room_snapshot(self, firebase_room_id: str) -> dict:
        from firebase_admin import db

        init_firebase_admin_with_service_account()
        ref = db.reference(f'meetings/{firebase_room_id}')
        return ref.get() or {}

    def sync_meeting_end(self, meeting_id: str, firebase_room_id: str) -> dict:
        snapshot = self.fetch_room_snapshot(firebase_room_id)
        meta = snapshot.get('meta') or {}
        participants = snapshot.get('participants') or {}
        chat = snapshot.get('chat') or {}

        actual_start = _parse_iso_ts(meta.get('actualStart') or meta.get('startedAt'))
        actual_end = _parse_iso_ts(meta.get('actualEnd') or meta.get('endedAt')) or datetime.now(
            timezone.utc
        ).isoformat()

        meeting_patch: dict[str, Any] = {
            'status': 'completed',
            'actual_end': actual_end,
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }
        if actual_start:
            meeting_patch['actual_start'] = actual_start

        self.supabase.table('meetings').update(meeting_patch).eq('id', meeting_id).execute()

        for uid, pdata in participants.items():
            if not isinstance(pdata, dict):
                continue
            username = pdata.get('username')
            employee_id = pdata.get('employeeId')
            joined_at = _parse_iso_ts(pdata.get('joinedAt'))
            left_at = _parse_iso_ts(pdata.get('leftAt'))
            if not username and not employee_id:
                continue
            q = self.supabase.table('meeting_participants').select('id').eq('meeting_id', meeting_id)
            if employee_id:
                q = q.eq('employee_id', employee_id)
            elif username:
                q = q.eq('username', username)
            res = q.limit(1).execute()
            if not res.data:
                continue
            patch = {}
            if joined_at:
                patch['joined_at'] = joined_at
            if left_at:
                patch['left_at'] = left_at
            if patch:
                self.supabase.table('meeting_participants').update(patch).eq(
                    'id', res.data[0]['id']
                ).execute()

        log_payload = {
            'participant_count': len(participants),
            'chat_message_count': len(chat) if isinstance(chat, dict) else 0,
            'meta': meta,
        }
        self.supabase.table('meeting_sync_log').insert({
            'meeting_id': meeting_id,
            'sync_type': 'meeting_end',
            'payload': log_payload,
        }).execute()

        return {'meeting_id': meeting_id, 'synced': True, 'payload': log_payload}

    def sync_presence(self, meeting_id: str, firebase_room_id: str) -> dict:
        snapshot = self.fetch_room_snapshot(firebase_room_id)
        presence = snapshot.get('presence') or snapshot.get('participants') or {}
        self.supabase.table('meeting_sync_log').insert({
            'meeting_id': meeting_id,
            'sync_type': 'presence',
            'payload': {'presence': presence},
        }).execute()
        return {'meeting_id': meeting_id, 'sync_type': 'presence', 'count': len(presence)}
