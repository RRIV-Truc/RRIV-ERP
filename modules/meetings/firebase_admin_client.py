"""
Firebase Admin — chỉ dùng Service Account key (server-to-server).

ĐÚNG (code này):
  File JSON từ Firebase Console → Project settings → Service accounts → Generate new private key
  → firebase_admin.credentials.Certificate(service_account_dict)

KHÔNG DÙNG:
  - Firebase Auth signInWithEmail / ID token người dùng
  - OAuth refresh token cá nhân (Zoom/Meet user flow)
  - gcloud application-default credentials đăng nhập bằng tài khoản Google cá nhân
"""
from __future__ import annotations

import base64
import json
import os


def _database_url() -> str:
    url = os.getenv('FIREBASE_DATABASE_URL', '').strip()
    if not url:
        raise RuntimeError('Thiếu FIREBASE_DATABASE_URL trong .env')
    return url


def _parse_service_account_json(raw_json: str) -> dict:
    """Parse JSON Service Account từ chuỗi env (Render thường cần một dòng)."""
    raw = (raw_json or '').strip()
    if not raw:
        raise RuntimeError('FIREBASE_SERVICE_ACCOUNT rỗng')

    if raw.endswith('.json') or (
        ('\\' in raw or '/' in raw) and '{' not in raw and '"type"' not in raw
    ):
        raise RuntimeError(
            f'FIREBASE_SERVICE_ACCOUNT đang là đường dẫn/tên file ({raw[:80]}…). '
            'Trên Render phải dán toàn bộ nội dung JSON (một dòng), không dán tên file.'
        )

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            'FIREBASE_SERVICE_ACCOUNT không phải JSON hợp lệ. '
            'Mở file .json Service Account → copy hết → dán một dòng vào Render '
            '(hoặc dùng FIREBASE_SERVICE_ACCOUNT_B64 — chạy '
            'python scripts/render_firebase_env.py). '
            f'Chi tiết: {exc}'
        ) from exc

    if not isinstance(data, dict):
        raise RuntimeError('Service Account JSON phải là object')
    return data


def _load_service_account_dict() -> dict:
    """
    Đọc Service Account JSON từ env.
    Bắt buộc type == 'service_account' — từ chối mọi key/token không phải Service Account.
    """
    path = os.getenv('FIREBASE_SERVICE_ACCOUNT_PATH', '').strip()
    raw_json = os.getenv('FIREBASE_SERVICE_ACCOUNT', '').strip()
    raw_b64 = os.getenv('FIREBASE_SERVICE_ACCOUNT_B64', '').strip()

    if path and os.path.isfile(path):
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
    elif raw_b64:
        try:
            decoded = base64.b64decode(raw_b64).decode('utf-8')
        except Exception as exc:
            raise RuntimeError(f'FIREBASE_SERVICE_ACCOUNT_B64 không decode được: {exc}') from exc
        data = _parse_service_account_json(decoded)
    elif raw_json:
        data = _parse_service_account_json(raw_json)
    else:
        raise RuntimeError(
            'Thiếu Service Account: đặt FIREBASE_SERVICE_ACCOUNT (JSON một dòng), '
            'FIREBASE_SERVICE_ACCOUNT_B64, hoặc FIREBASE_SERVICE_ACCOUNT_PATH (local). '
            'Không dùng Firebase Auth user token.'
        )

    if data.get('type') != 'service_account':
        raise RuntimeError(
            f"File/env không phải Firebase Service Account (type={data.get('type')!r}). "
            'Tải key từ Firebase Console → Service accounts → Generate new private key.'
        )
    if not data.get('private_key') or not data.get('client_email'):
        raise RuntimeError('Service Account JSON thiếu private_key hoặc client_email')

    return data


def init_firebase_admin_with_service_account():
    """
    Khởi tạo firebase_admin một lần bằng Service Account key.
    Trả về Firebase App — dùng cho Realtime Database (Python backend / sync).
    """
    import firebase_admin
    from firebase_admin import credentials

    if firebase_admin._apps:
        return firebase_admin.get_app()

    service_account = _load_service_account_dict()
    # Certificate() = chứng thư Service Account JSON, KHÔNG phải user OAuth token
    service_account_cert = credentials.Certificate(service_account)
    return firebase_admin.initialize_app(
        service_account_cert,
        {'databaseURL': _database_url()},
    )


# Alias ngắn — giữ tương thích nội bộ module
get_firebase_admin_app = init_firebase_admin_with_service_account
