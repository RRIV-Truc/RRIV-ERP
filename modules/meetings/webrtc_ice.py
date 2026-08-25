"""Cấu hình STUN/TURN cho WebRTC chia sẻ màn hình."""
from __future__ import annotations

import os
from typing import Any


def get_webrtc_ice_config() -> dict[str, Any]:
    """Trả về iceServers — ưu tiên TURN Metered (env) nếu có, kèm openrelay dự phòng."""
    servers: list[dict[str, Any]] = [
        {'urls': 'stun:stun.l.google.com:19302'},
        {'urls': 'stun:stun1.l.google.com:19302'},
        {'urls': 'stun:stun2.l.google.com:19302'},
        {'urls': 'stun:stun.stunprotocol.org:3478'},
    ]

    turn_user = (os.getenv('METERED_TURN_USERNAME') or '').strip()
    turn_cred = (os.getenv('METERED_TURN_CREDENTIAL') or '').strip()
    if turn_user and turn_cred:
        servers.append({
            'urls': [
                'turn:global.relay.metered.ca:80',
                'turn:global.relay.metered.ca:80?transport=tcp',
                'turn:global.relay.metered.ca:443',
                'turn:global.relay.metered.ca:443?transport=tcp',
                'turns:global.relay.metered.ca:443?transport=tcp',
            ],
            'username': turn_user,
            'credential': turn_cred,
        })

    servers.append({
        'urls': [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turn:openrelay.metered.ca:443?transport=tcp',
        ],
        'username': 'openrelayproject',
        'credential': 'openrelayproject',
    })

    return {
        'iceServers': servers,
        'iceCandidatePoolSize': 8,
    }
