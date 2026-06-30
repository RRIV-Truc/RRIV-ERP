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

import json
import os


def _database_url() -> str:
    url = os.getenv('FIREBASE_DATABASE_URL', '').strip()
    if not url:
        raise RuntimeError('Thiếu FIREBASE_DATABASE_URL trong .env')
    return url


def _load_service_account_dict() -> dict:
    """
    Đọc Service Account JSON từ env.
    Bắt buộc type == 'service_account' — từ chối mọi key/token không phải Service Account.
    """
    path = os.getenv('FIREBASE_SERVICE_ACCOUNT_PATH', '').strip()
    raw_json = os.getenv('FIREBASE_SERVICE_ACCOUNT', '').strip()

    if path and os.path.isfile(path):
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
    elif raw_json:
        data = json.loads(raw_json)
    else:
        raise RuntimeError(
            'Thiếu Service Account: đặt FIREBASE_SERVICE_ACCOUNT_PATH (file .json) '
            'hoặc FIREBASE_SERVICE_ACCOUNT (JSON inline). '
            'Không dùng Firebase Auth user token.'
        )

    if not isinstance(data, dict):
        raise RuntimeError('Service Account JSON phải là object')
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
