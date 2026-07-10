#!/usr/bin/env python3
"""Kiểm tra kho tài liệu MTG-LIB-KHO — metadata DB vs Storage bucket."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

LIB_CODE = os.getenv('MEETING_DOC_LIBRARY_CODE', 'MTG-LIB-KHO').strip() or 'MTG-LIB-KHO'
BUCKET = os.getenv('MEETING_DOCS_BUCKET', 'meeting-docs').strip() or 'meeting-docs'


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / '.env')
    except ImportError:
        pass

    from supabase import create_client

    url = os.getenv('SUPABASE_URL')
    key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_KEY')
    if not url or not key:
        print('Thiếu SUPABASE_URL / SUPABASE_SERVICE_KEY trong .env')
        return 1

    sb = create_client(url, key)

    lib = sb.table('meetings').select('id, meeting_code, title, status').eq(
        'meeting_code', LIB_CODE
    ).limit(5).execute()
    print(f'=== Cuộc họp kho ({LIB_CODE}) ===')
    if not lib.data:
        print('  KHÔNG TÌM THẤY — ensure_library_meeting sẽ tạo mới khi mở Kho tài liệu')
        lib_ids: list[str] = []
    else:
        for row in lib.data:
            print(f"  id={row['id']}  status={row.get('status')}  title={row.get('title')}")
        lib_ids = [str(r['id']) for r in lib.data]

    all_docs = sb.table('meeting_documents').select(
        'id, meeting_id, kind, name, storage_path', count='exact'
    ).execute()
    total = getattr(all_docs, 'count', None) or len(all_docs.data or [])
    print(f'\n=== meeting_documents (tổng metadata) ===')
    print(f'  Số bản ghi: {total}')

    if lib_ids:
        for lid in lib_ids:
            sub = sb.table('meeting_documents').select('id', count='exact').eq(
                'meeting_id', lid
            ).execute()
            n = getattr(sub, 'count', None) or len(sub.data or [])
            print(f'  Trong kho {lid[:8]}…: {n} mục')

    orphan = sb.table('meeting_documents').select('id, name, meeting_id').limit(10).execute()
    if lib_ids:
        orphans = [r for r in (orphan.data or []) if str(r.get('meeting_id')) not in lib_ids]
        if orphans:
            print('\n  Một số tài liệu KHÔNG thuộc kho hiện tại (có thể kho cũ đã bị xóa):')
            for r in orphans[:5]:
                print(f"    - {r.get('name')} (meeting_id={r.get('meeting_id')})")

    print(f'\n=== Supabase Storage bucket «{BUCKET}» ===')
    try:
        listing = sb.storage.from_(BUCKET).list()
        top = listing if isinstance(listing, list) else []
        print(f'  Mục ở root bucket: {len(top)}')
        if top:
            for item in top[:8]:
                name = item.get('name') if isinstance(item, dict) else str(item)
                print(f'    · {name}')
        if len(top) > 8:
            print(f'    … và {len(top) - 8} mục khác')
        if total == 0 and len(top) > 0:
            print('\n  Gợi ý: Storage còn file nhưng DB trống — cần khôi phục metadata thủ công hoặc từ backup Supabase.')
    except Exception as exc:
        print(f'  Không liệt kê được bucket: {exc}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
