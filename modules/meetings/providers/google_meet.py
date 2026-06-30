"""Google Meet / Calendar OAuth2 — Phase 2 stub."""
from __future__ import annotations

from modules.meetings.providers.base import MeetingPlatformProvider
from modules.meetings.schemas import MeetingCreate, PlatformMeetingResult


class GoogleMeetProvider(MeetingPlatformProvider):
    platform_type = 'google_meet'

    def create_meeting(self, payload: MeetingCreate, meeting_id: str) -> PlatformMeetingResult:
        raise NotImplementedError('Google Meet OAuth2 — triển khai ở Phase 2')

    def cancel_meeting(self, external_id: str) -> bool:
        raise NotImplementedError('Google Meet OAuth2 — triển khai ở Phase 2')
