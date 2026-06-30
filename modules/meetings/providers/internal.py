"""
Phòng họp nội bộ — Firebase Realtime Database.
Auth: Service Account key qua modules.meetings.firebase_admin_client (KHÔNG user OAuth).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from modules.meetings.firebase_admin_client import init_firebase_admin_with_service_account
from modules.meetings.providers.base import MeetingPlatformProvider
from modules.meetings.schemas import MeetingCreate, PlatformMeetingResult


class InternalFirebaseProvider(MeetingPlatformProvider):
    platform_type = 'internal'

    def create_meeting(self, payload: MeetingCreate, meeting_id: str) -> PlatformMeetingResult:
        from firebase_admin import db

        init_firebase_admin_with_service_account()
        room_id = f'mtg_{meeting_id.replace("-", "")[:20]}_{uuid.uuid4().hex[:8]}'
        now_iso = datetime.now(timezone.utc).isoformat()

        room_data = {
            'meta': {
                'meetingId': meeting_id,
                'title': payload.title,
                'status': payload.status,
                'meetingMode': payload.meeting_mode,
                'platformType': 'internal',
                'scheduledStart': payload.scheduled_start.isoformat(),
                'scheduledEnd': payload.scheduled_end.isoformat(),
                'createdAt': now_iso,
            },
            'participants': {},
            'chat': {},
            'signaling': {},
            'presence': {},
        }

        ref = db.reference(f'meetings/{room_id}')
        ref.set(room_data)

        join_path = f'/meetings/{room_id}'
        return PlatformMeetingResult(
            platform_type='internal',
            online_meeting_url=join_path,
            online_meeting_id=room_id,
            firebase_room_id=room_id,
            raw={'rtdb_path': join_path},
        )

    def cancel_meeting(self, external_id: str) -> bool:
        from firebase_admin import db

        try:
            init_firebase_admin_with_service_account()
            ref = db.reference(f'meetings/{external_id}/meta')
            ref.update({'status': 'cancelled', 'cancelledAt': datetime.now(timezone.utc).isoformat()})
            return True
        except Exception as exc:
            print(f'[InternalFirebaseProvider] cancel_meeting: {exc}')
            return False
