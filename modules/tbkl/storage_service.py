"""Upload / signed URL — tài liệu TBKL trên Supabase Storage."""
from __future__ import annotations

import os
import re
import time
import uuid
from pathlib import Path
from typing import Optional

from modules.meetings.document_service import BUCKET, _upload_bytes_supabase

MAX_FILE_BYTES = int(os.getenv('TBKL_DOCS_MAX_MB', '30')) * 1024 * 1024
PDF_EXT = {'.pdf'}
PLAN_EXT = {'.xlsx', '.xls', '.csv'}

_signed_url_cache: dict[str, tuple[str, float]] = {}
_SIGNED_URL_CACHE_TTL = 3000


def _safe_name(name: str) -> str:
    base = Path(name or 'file').name
    base = re.sub(r'[^\w.\-() ]+', '_', base, flags=re.UNICODE).strip('._ ')
    return base or 'file'


def _storage_path(cycle_id: str, kind: str, filename: str) -> str:
    safe = _safe_name(filename)
    return f'tbkl/{cycle_id}/{kind}/{uuid.uuid4().hex[:12]}_{safe}'


def _supabase_storage_client():
    key = os.getenv('SUPABASE_SERVICE_KEY', '').strip()
    if not key:
        raise RuntimeError(
            'Thiếu SUPABASE_SERVICE_KEY trên server — cần Secret key để upload Storage.'
        )
    from supabase import create_client
    return create_client(os.getenv('SUPABASE_URL', ''), key)


def _validate_size(data: bytes) -> None:
    if not data:
        raise ValueError('File trống')
    if len(data) > MAX_FILE_BYTES:
        raise ValueError(f'File vượt quá {MAX_FILE_BYTES // (1024 * 1024)} MB')


def upload_conclusion_pdf(cycle_id: str, filename: str, data: bytes) -> tuple[str, str]:
    ext = Path(_safe_name(filename)).suffix.lower()
    if ext not in PDF_EXT:
        raise ValueError('Văn bản kết luận phải là file PDF')
    _validate_size(data)
    path = _storage_path(cycle_id, 'conclusion', filename)
    _upload_bytes_supabase(data, path, 'application/pdf')
    return path, _safe_name(filename)


def upload_plan_workbook(cycle_id: str, filename: str, data: bytes) -> tuple[str, str]:
    ext = Path(_safe_name(filename)).suffix.lower()
    if ext not in PLAN_EXT:
        raise ValueError('Bảng kế hoạch phải là Excel (.xlsx) hoặc CSV')
    _validate_size(data)
    mime = 'text/csv' if ext == '.csv' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    path = _storage_path(cycle_id, 'plan', filename)
    _upload_bytes_supabase(data, path, mime)
    return path, _safe_name(filename)


def create_signed_url(storage_path: str, *, expires_in: int = 3600) -> Optional[str]:
    if not storage_path:
        return None
    now = time.time()
    cached = _signed_url_cache.get(storage_path)
    if cached and cached[1] > now:
        return cached[0]
    try:
        res = _supabase_storage_client().storage.from_(BUCKET).create_signed_url(
            storage_path, expires_in
        )
        url = None
        if isinstance(res, dict):
            url = (
                res.get('signedURL') or res.get('signedUrl') or
                res.get('signed_url') or (res.get('data') or {}).get('signedURL')
            )
        elif isinstance(res, str):
            url = res
        if url:
            _signed_url_cache[storage_path] = (url, now + min(expires_in - 120, _SIGNED_URL_CACHE_TTL))
        return url
    except Exception as exc:
        print(f'[tbkl_storage] create_signed_url {storage_path}: {exc}')
        return None
