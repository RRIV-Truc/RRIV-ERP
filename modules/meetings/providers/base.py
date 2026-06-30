"""Abstract platform provider — Zoom / Meet / internal."""
from __future__ import annotations

from abc import ABC, abstractmethod

from modules.meetings.schemas import MeetingCreate, PlatformMeetingResult, PlatformType


class MeetingPlatformProvider(ABC):
    platform_type: PlatformType

    @abstractmethod
    def create_meeting(self, payload: MeetingCreate, meeting_id: str) -> PlatformMeetingResult:
        """Tạo phòng trực tuyến trên nền tảng tương ứng."""

    @abstractmethod
    def cancel_meeting(self, external_id: str) -> bool:
        """Hủy phòng trên nền tảng (nếu hỗ trợ)."""

    def supports_platform(self, platform: str) -> bool:
        return platform == self.platform_type
