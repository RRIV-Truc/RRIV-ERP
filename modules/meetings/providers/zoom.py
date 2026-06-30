"""Zoom OAuth2 — Phase 2 stub."""
from __future__ import annotations

from modules.meetings.providers.base import MeetingPlatformProvider
from modules.meetings.schemas import MeetingCreate, PlatformMeetingResult


class ZoomProvider(MeetingPlatformProvider):
    platform_type = 'zoom'

    def create_meeting(self, payload: MeetingCreate, meeting_id: str) -> PlatformMeetingResult:
        raise NotImplementedError('Zoom OAuth2 — triển khai ở Phase 2')

    def cancel_meeting(self, external_id: str) -> bool:
        raise NotImplementedError('Zoom OAuth2 — triển khai ở Phase 2')
