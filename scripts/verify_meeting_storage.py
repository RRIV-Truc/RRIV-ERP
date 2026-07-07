#!/usr/bin/env python3
"""Kiểm tra meeting_documents có file thật trên Supabase Storage hay không."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_dotenv() -> None:
    try:
        from dotenv import load_dotenv as _load

        _load(ROOT / '.env')
    except ImportError:
        pass


def main() -> None:
    load_dotenv()
    from supabase import create_client

    from modules.meetings.document_service import BUCKET, _storage_key

    url = (os.getenv('SUPABASE_URL') or '').strip()
    key = _storage_key()
    if not url or not key:
        print('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_KEY/SUPABASE_KEY trong .env', file=sys.stderr)
        sys.exit(1)

    service = (os.getenv('SUPABASE_SERVICE_KEY') or '').strip()
    if not service:
        print('Cảnh báo: không có SUPABASE_SERVICE_KEY — bucket private có thể không đọc được trên server.')

    client = create_client(url, key)
    res = client.table('meeting_documents').select(
        'id,name,storage_path,storage_backend,meeting_id,created_at'
    ).eq('kind', 'file').order('created_at', desc=True).limit(30).execute()

    rows = res.data or []
    if not rows:
        print('Không có file trong meeting_documents.')
        return

    ok = 0
    missing = 0
    for row in rows:
        path = (row.get('storage_path') or '').strip()
        name = row.get('name') or row.get('id')
        backend = row.get('storage_backend') or '?'
        if not path:
            print(f'[THIEU PATH] {name} backend={backend}')
            missing += 1
            continue
        try:
            data = client.storage.from_(BUCKET).download(path)
            size = len(data) if data else 0
            print(f'[OK {size} bytes] {name}')
            print(f'         path={path} backend={backend}')
            ok += 1
        except Exception as exc:
            print(f'[LOI] {name}')
            print(f'      path={path} backend={backend}')
            print(f'      {exc}')
            missing += 1

    print()
    print(f'Tong: {ok} co file tren Storage, {missing} loi/thieu')
    print(f'Bucket: {BUCKET} — xem tren Dashboard: Storage > {BUCKET}')


if __name__ == '__main__':
    main()
