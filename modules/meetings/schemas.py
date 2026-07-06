"""Pydantic models — cuộc họp phonghop."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


MeetingMode = Literal['in_person', 'online', 'hybrid']
PlatformType = Literal['internal', 'zoom', 'google_meet']
MeetingStatus = Literal['draft', 'scheduled', 'live', 'completed', 'cancelled']
ParticipantRole = Literal['organizer', 'host', 'secretary', 'participant', 'observer']


class MeetingParticipantInput(BaseModel):
    employee_id: Optional[UUID] = None
    username: Optional[str] = None
    participant_role: ParticipantRole = 'participant'
    is_external: bool = False
    external_name: Optional[str] = None
    external_email: Optional[str] = None

    @model_validator(mode='after')
    def validate_identity(self):
        if self.is_external:
            if not self.external_email:
                raise ValueError('Khách ngoài cần external_email')
        elif not self.employee_id and not self.username:
            raise ValueError('Cần employee_id hoặc username cho người tham dự nội bộ')
        return self


class MeetingCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    meeting_mode: MeetingMode = 'hybrid'
    platform_type: PlatformType = 'internal'
    status: MeetingStatus = 'scheduled'
    scheduled_start: datetime
    scheduled_end: datetime
    physical_room_id: Optional[str] = None
    department_id: Optional[str] = None
    organizer_employee_id: Optional[UUID] = None
    online_meeting_url: Optional[str] = None
    participants: list[MeetingParticipantInput] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)
    shared_document_ids: Optional[list[str]] = None

    @field_validator('scheduled_start', 'scheduled_end', mode='before')
    @classmethod
    def parse_dt(cls, v):
        if isinstance(v, str) and v:
            return datetime.fromisoformat(v.replace('Z', '+00:00'))
        return v

    @model_validator(mode='after')
    def validate_schedule_and_room(self):
        if self.scheduled_end <= self.scheduled_start:
            raise ValueError('scheduled_end phải sau scheduled_start')
        if self.meeting_mode != 'online' and self.status not in ('draft', 'cancelled'):
            if not self.physical_room_id:
                raise ValueError('Cuộc họp tại chỗ/hybrid cần physical_room_id')
        return self


class MeetingUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = None
    meeting_mode: Optional[MeetingMode] = None
    platform_type: Optional[PlatformType] = None
    status: Optional[MeetingStatus] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    physical_room_id: Optional[str] = None
    department_id: Optional[str] = None
    online_meeting_url: Optional[str] = None
    participants: Optional[list[MeetingParticipantInput]] = None
    metadata: Optional[dict] = None
    shared_document_ids: Optional[list[str]] = None

    @field_validator('scheduled_start', 'scheduled_end', mode='before')
    @classmethod
    def parse_dt(cls, v):
        if v is None:
            return v
        if isinstance(v, str) and v:
            return datetime.fromisoformat(v.replace('Z', '+00:00'))
        return v


class PlatformMeetingResult(BaseModel):
    platform_type: PlatformType
    online_meeting_url: Optional[str] = None
    online_meeting_id: Optional[str] = None
    online_meeting_password: Optional[str] = None
    firebase_room_id: Optional[str] = None
    raw: dict = Field(default_factory=dict)
