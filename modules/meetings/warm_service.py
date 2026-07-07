"""Warm job — Supabase (gốc) → Firebase hot cache theo phiên họp."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from modules.meetings.document_service import read_file_bytes
from modules.meetings.firebase_admin_client import init_firebase_admin_with_service_account
from modules.meetings.service import get_meeting_detail


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rtdb_ref(room_id: str):
    from firebase_admin import db
    init_firebase_admin_with_service_account()
    return db.reference(f'meetings/{room_id}')


def _try_firebase_storage_upload(room_id: str, doc_id: str, name: str, data: bytes, mime: str) -> Optional[str]:
    bucket_name = __import__('os').getenv('FIREBASE_STORAGE_BUCKET', '').strip()
    if not bucket_name:
        return None
    try:
        from firebase_admin import storage
        init_firebase_admin_with_service_account()
        bucket = storage.bucket(bucket_name)
        path = f'sessions/{room_id}/{doc_id}/{name}'
        blob = bucket.blob(path)
        blob.upload_from_string(data, content_type=mime or 'application/octet-stream')
        return path
    except Exception as exc:
        print(f'[warm_service] firebase storage: {exc}')
        return None


def warm_meeting_documents(
    supabase,
    meeting_id: str,
    doc_ids: Optional[list[str]] = None,
    *,
    include_all_folders: bool = True,
) -> dict:
    meeting = get_meeting_detail(supabase, meeting_id)
    if not meeting:
        raise LookupError('Không tìm thấy cuộc họp')
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        raise ValueError('Cuộc họp chưa có phòng Firebase')

    q = supabase.table('meeting_documents').select('*').eq('meeting_id', meeting_id).eq('kind', 'file')
    if doc_ids:
        q = q.in_('id', doc_ids)
    else:
        q = q.in_('warm_status', ['pending', 'failed'])
    res = q.execute()
    rows = res.data or []

    ref = _rtdb_ref(room_id)
    warmed = 0
    failed = 0

    for row in rows:
        doc_id = row['id']
        supabase.table('meeting_documents').update({
            'warm_status': 'warming',
            'warm_error': None,
            'updated_at': _now_iso(),
        }).eq('id', doc_id).execute()
        try:
            data = read_file_bytes(supabase, row)
            fb_path = _try_firebase_storage_upload(
                room_id, doc_id, row.get('name') or 'file',
                data, row.get('mime_type') or 'application/octet-stream',
            )
            index = {
                'id': doc_id,
                'name': row.get('name'),
                'kind': 'file',
                'parentId': row.get('parent_id'),
                'mimeType': row.get('mime_type'),
                'size': row.get('file_size'),
                'storageBackend': row.get('storage_backend'),
                'storagePath': row.get('storage_path'),
                'firebasePath': fb_path,
                'downloadApi': f'/api/meetings/{meeting_id}/documents/{doc_id}/download',
                'warmedAt': _now_iso(),
            }
            ref.child(f'documents/{doc_id}').set(index)
            patch = {
                'warm_status': 'ready',
                'warmed_at': _now_iso(),
                'warm_error': None,
                'updated_at': _now_iso(),
            }
            if fb_path:
                patch['firebase_path'] = fb_path
            supabase.table('meeting_documents').update(patch).eq('id', doc_id).execute()
            warmed += 1
        except Exception as exc:
            failed += 1
            supabase.table('meeting_documents').update({
                'warm_status': 'failed',
                'warm_error': str(exc)[:500],
                'updated_at': _now_iso(),
            }).eq('id', doc_id).execute()

    if include_all_folders:
        folders = supabase.table('meeting_documents').select('*').eq(
            'meeting_id', meeting_id
        ).eq('kind', 'folder').execute()
        for folder in folders.data or []:
            fid = folder['id']
            ref.child(f'documents/{fid}').set({
                'id': fid,
                'name': folder.get('name'),
                'kind': 'folder',
                'parentId': folder.get('parent_id'),
                'warmedAt': _now_iso(),
            })

    ref.child('documentsMeta').update({
        'warmStatus': 'ready' if failed == 0 else 'partial',
        'warmedAt': _now_iso(),
        'fileCount': warmed,
        'failedCount': failed,
    })

    return {'meeting_id': meeting_id, 'warmed': warmed, 'failed': failed, 'room_id': room_id}


def sync_shared_documents_to_firebase(
    supabase,
    meeting_id: str,
    shared_root_ids: list[str],
) -> dict:
    """Chỉ giữ tài liệu đã chia sẻ trên Firebase hot; warm file (kể cả trong folder)."""
    from modules.meetings.document_service import (
        collect_descendant_file_ids,
        collect_shared_tree_doc_ids,
    )

    meeting = get_meeting_detail(supabase, meeting_id)
    if not meeting:
        raise LookupError('Không tìm thấy cuộc họp')
    room_id = meeting.get('firebase_room_id')
    if not room_id:
        return {'skipped': True, 'reason': 'no_firebase_room'}

    tree_ids = set(collect_shared_tree_doc_ids(supabase, meeting_id, shared_root_ids))
    file_ids = collect_descendant_file_ids(supabase, meeting_id, shared_root_ids)

    ref = _rtdb_ref(room_id)
    try:
        existing = ref.child('documents').get() or {}
        if isinstance(existing, dict):
            for doc_id in list(existing.keys()):
                if doc_id not in tree_ids:
                    ref.child(f'documents/{doc_id}').delete()
    except Exception as exc:
        print(f'[warm_service] purge unshared: {exc}')

    if not file_ids and not tree_ids:
        ref.child('documentsMeta').set({
            'warmStatus': 'ready',
            'warmedAt': _now_iso(),
            'fileCount': 0,
            'failedCount': 0,
            'sharedOnly': True,
        })
        return {'meeting_id': meeting_id, 'warmed': 0, 'failed': 0, 'room_id': room_id}

    warm_result = warm_meeting_documents(
        supabase, meeting_id, doc_ids=file_ids or None, include_all_folders=False,
    )

    for fid in tree_ids:
        row = supabase.table('meeting_documents').select('*').eq(
            'id', fid
        ).eq('kind', 'folder').limit(1).execute()
        if row.data:
            folder = row.data[0]
            ref.child(f'documents/{fid}').set({
                'id': fid,
                'name': folder.get('name'),
                'kind': 'folder',
                'parentId': folder.get('parent_id'),
                'warmedAt': _now_iso(),
                'shared': True,
            })

    ref.child('documentsMeta').update({'sharedOnly': True, 'sharedRoots': shared_root_ids})
    return warm_result


def _delete_firebase_storage_session(room_id: str) -> None:
    bucket_name = __import__('os').getenv('FIREBASE_STORAGE_BUCKET', '').strip()
    if not bucket_name or not room_id:
        return
    try:
        from firebase_admin import storage

        init_firebase_admin_with_service_account()
        bucket = storage.bucket(bucket_name)
        prefix = f'sessions/{room_id}/'
        for blob in bucket.list_blobs(prefix=prefix):
            try:
                blob.delete()
            except Exception as exc:
                print(f'[warm_service] delete blob {blob.name}: {exc}')
    except Exception as exc:
        print(f'[warm_service] purge storage session/{room_id}: {exc}')


def purge_hot_documents(room_id: str) -> None:
    try:
        _delete_firebase_storage_session(room_id)
        ref = _rtdb_ref(room_id)
        ref.child('documents').delete()
        ref.child('documentsMeta').delete()
    except Exception as exc:
        print(f'[warm_service] purge: {exc}')
