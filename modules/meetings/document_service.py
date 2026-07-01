"""Kho tài liệu cuộc họp — Cold Storage (Supabase DB + Storage/local)."""
from __future__ import annotations

import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from modules.meetings.rbac import UserContext, can_create_meeting, is_meeting_participant
from modules.meetings.service import get_meeting_detail

BUCKET = os.getenv('MEETING_DOCS_BUCKET', 'meeting-docs').strip() or 'meeting-docs'
LOCAL_ROOT = Path(os.getenv('MEETING_DOCS_LOCAL_ROOT', 'storage/meeting-docs'))
MAX_FILE_BYTES = int(os.getenv('MEETING_DOCS_MAX_MB', '50')) * 1024 * 1024
ALLOWED_EXT = {
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.png', '.jpg', '.jpeg', '.webp', '.txt', '.csv',
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_name(name: str) -> str:
    base = (name or 'file').strip()
    base = re.sub(r'[^\w.\- ()àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]', '_', base)
    return base[:200] or 'file'


def _storage_key() -> str:
    return os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_KEY') or ''


def can_manage_documents(supabase, meeting_id: str, ctx: UserContext) -> bool:
    if can_create_meeting(ctx, supabase):
        return True
    meeting = get_meeting_detail(supabase, meeting_id)
    if not meeting:
        return False
    org_id = meeting.get('organizer_employee_id')
    if org_id and ctx.employee_id and str(org_id) == str(ctx.employee_id):
        return True
    uname = (ctx.username or '').lower()
    for p in meeting.get('participants') or []:
        role = (p.get('participant_role') or '').lower()
        if role in ('organizer', 'host') and (
            (p.get('username') or '').lower() == uname
            or (ctx.employee_id and p.get('employee_id') == ctx.employee_id)
        ):
            return True
    return False


def assert_can_read(supabase, meeting_id: str, ctx: UserContext) -> dict:
    meeting = get_meeting_detail(supabase, meeting_id)
    if not meeting:
        raise LookupError('Không tìm thấy cuộc họp')
    if not is_meeting_participant(supabase, meeting_id, ctx) and not can_create_meeting(ctx, supabase):
        raise PermissionError('Bạn không có quyền xem tài liệu cuộc họp này')
    return meeting


def assert_can_write(supabase, meeting_id: str, ctx: UserContext) -> dict:
    meeting = assert_can_read(supabase, meeting_id, ctx)
    if not can_manage_documents(supabase, meeting_id, ctx):
        raise PermissionError('Chỉ Thư ký / Chủ trì / Manager mới quản lý tài liệu')
    return meeting


def _row_to_doc(row: dict) -> dict:
    return {
        'id': row.get('id'),
        'meeting_id': row.get('meeting_id'),
        'parent_id': row.get('parent_id'),
        'kind': row.get('kind'),
        'name': row.get('name'),
        'storage_backend': row.get('storage_backend'),
        'storage_path': row.get('storage_path'),
        'mime_type': row.get('mime_type'),
        'file_size': row.get('file_size'),
        'warm_status': row.get('warm_status'),
        'warm_error': row.get('warm_error'),
        'warmed_at': row.get('warmed_at'),
        'firebase_path': row.get('firebase_path'),
        'sort_order': row.get('sort_order'),
        'created_by_username': row.get('created_by_username'),
        'created_at': row.get('created_at'),
        'updated_at': row.get('updated_at'),
    }


def _fetch_all_docs(supabase, meeting_id: str) -> list[dict]:
    res = supabase.table('meeting_documents').select('*').eq(
        'meeting_id', meeting_id
    ).order('kind').order('sort_order').order('name').execute()
    return [_row_to_doc(r) for r in (res.data or [])]


def get_shared_root_ids(supabase, meeting_id: str) -> set[str]:
    try:
        res = supabase.table('meeting_document_shares').select('document_id').eq(
            'meeting_id', meeting_id
        ).execute()
        return {str(r['document_id']) for r in (res.data or []) if r.get('document_id')}
    except Exception as exc:
        print(f'[meeting_docs] shared roots (bảng shares chưa có?): {exc}')
        return set()


def _build_doc_index(docs: list[dict]) -> dict[str, dict]:
    return {str(d['id']): d for d in docs if d.get('id')}


def is_document_shared(
    doc_id: str,
    shared_roots: set[str],
    by_id: dict[str, dict],
) -> bool:
    if not doc_id:
        return False
    cur: Optional[str] = str(doc_id)
    seen: set[str] = set()
    while cur and cur not in seen:
        if cur in shared_roots:
            return True
        seen.add(cur)
        row = by_id.get(cur)
        if not row:
            break
        cur = row.get('parent_id')
        if cur:
            cur = str(cur)
    return False


def _folder_has_shared_descendant(
    folder_id: str,
    shared_roots: set[str],
    by_id: dict[str, dict],
    children_of: dict[Optional[str], list[dict]],
) -> bool:
    stack = [folder_id]
    seen: set[str] = set()
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        if is_document_shared(cur, shared_roots, by_id):
            return True
        for child in children_of.get(cur, []):
            cid = str(child.get('id') or '')
            if cid:
                stack.append(cid)
    return False


def is_document_shared_by_chain(
    supabase,
    meeting_id: str,
    doc_id: str,
    shared_roots: set[str],
) -> bool:
    if not doc_id:
        return False
    if str(doc_id) in shared_roots:
        return True
    cur: Optional[str] = str(doc_id)
    seen: set[str] = set()
    while cur and cur not in seen:
        seen.add(cur)
        res = supabase.table('meeting_documents').select('parent_id').eq(
            'id', cur
        ).eq('meeting_id', meeting_id).limit(1).execute()
        if not res.data:
            break
        parent = res.data[0].get('parent_id')
        if not parent:
            break
        cur = str(parent)
        if cur in shared_roots:
            return True
    return False


def should_filter_shared(supabase, meeting_id: str, ctx: UserContext) -> bool:
    return not can_manage_documents(supabase, meeting_id, ctx)


def assert_can_access_document(
    supabase,
    meeting_id: str,
    doc_id: str,
    ctx: UserContext,
) -> dict:
    doc = get_document(supabase, meeting_id, doc_id, ctx)
    if not should_filter_shared(supabase, meeting_id, ctx):
        return doc
    all_docs = _fetch_all_docs(supabase, meeting_id)
    shared_roots = get_shared_root_ids(supabase, meeting_id)
    by_id = _build_doc_index(all_docs)
    if not is_document_shared(doc_id, shared_roots, by_id):
        raise PermissionError('Tài liệu chưa được chia sẻ cho cuộc họp này')
    return doc


def list_documents(
    supabase,
    meeting_id: str,
    ctx: UserContext,
    parent_id: Optional[str] = None,
    shared_only: bool = False,
) -> list[dict]:
    assert_can_read(supabase, meeting_id, ctx)
    filter_shared = shared_only or should_filter_shared(supabase, meeting_id, ctx)
    q = supabase.table('meeting_documents').select('*').eq('meeting_id', meeting_id)
    if parent_id:
        q = q.eq('parent_id', parent_id)
    else:
        q = q.is_('parent_id', 'null')
    res = q.order('kind').order('sort_order').order('name').execute()
    items = [_row_to_doc(r) for r in (res.data or [])]
    if not filter_shared:
        return items

    all_docs = _fetch_all_docs(supabase, meeting_id)
    shared_roots = get_shared_root_ids(supabase, meeting_id)
    by_id = _build_doc_index(all_docs)
    children_of: dict[Optional[str], list[dict]] = {}
    for d in all_docs:
        pid = d.get('parent_id')
        key = str(pid) if pid else None
        children_of.setdefault(key, []).append(d)

    visible: list[dict] = []
    for item in items:
        iid = str(item.get('id') or '')
        if item.get('kind') == 'folder':
            if is_document_shared(iid, shared_roots, by_id) or _folder_has_shared_descendant(
                iid, shared_roots, by_id, children_of
            ):
                visible.append(item)
        elif is_document_shared(iid, shared_roots, by_id):
            visible.append(item)
    return visible


def list_shared_files_flat(
    supabase,
    meeting_id: str,
    ctx: UserContext,
    shared_only: bool = False,
) -> list[dict]:
    assert_can_read(supabase, meeting_id, ctx)
    all_docs = _fetch_all_docs(supabase, meeting_id)
    shared_roots = get_shared_root_ids(supabase, meeting_id)
    by_id = _build_doc_index(all_docs)
    filter_shared = shared_only or should_filter_shared(supabase, meeting_id, ctx)
    if not filter_shared:
        return [d for d in all_docs if d.get('kind') == 'file']
    return [
        d for d in all_docs
        if d.get('kind') == 'file' and is_document_shared(str(d['id']), shared_roots, by_id)
    ]


def list_documents_tree(supabase, meeting_id: str, ctx: UserContext) -> list[dict]:
    """Cây phẳng có depth — dùng cho form chọn chia sẻ."""
    assert_can_read(supabase, meeting_id, ctx)
    if not can_manage_documents(supabase, meeting_id, ctx):
        raise PermissionError('Chỉ Thư ký / Chủ trì mới chọn tài liệu chia sẻ')
    all_docs = _fetch_all_docs(supabase, meeting_id)
    by_id = _build_doc_index(all_docs)
    depth_cache: dict[str, int] = {}

    def depth(doc_id: str) -> int:
        if doc_id in depth_cache:
            return depth_cache[doc_id]
        row = by_id.get(doc_id)
        if not row or not row.get('parent_id'):
            depth_cache[doc_id] = 0
            return 0
        d = 1 + depth(str(row['parent_id']))
        depth_cache[doc_id] = d
        return d

    out: list[dict] = []
    for d in all_docs:
        did = str(d.get('id') or '')
        out.append({
            **d,
            'depth': depth(did) if did else 0,
        })
    out.sort(key=lambda x: (x.get('parent_id') or '', x.get('kind'), x.get('name') or ''))
    return out


def get_document_shares(supabase, meeting_id: str, ctx: UserContext) -> dict:
    assert_can_read(supabase, meeting_id, ctx)
    shared_ids = sorted(get_shared_root_ids(supabase, meeting_id))
    tree = list_documents_tree(supabase, meeting_id, ctx) if can_manage_documents(
        supabase, meeting_id, ctx
    ) else []
    return {
        'shared_document_ids': shared_ids,
        'tree': tree,
        'can_manage': can_manage_documents(supabase, meeting_id, ctx),
    }


def collect_descendant_file_ids(
    supabase,
    meeting_id: str,
    root_ids: list[str],
) -> list[str]:
    """File con (mọi cấp) của các folder/file được tick chia sẻ."""
    if not root_ids:
        return []
    all_docs = _fetch_all_docs(supabase, meeting_id)
    by_id = _build_doc_index(all_docs)
    children_of: dict[Optional[str], list[dict]] = {}
    for d in all_docs:
        pid = d.get('parent_id')
        key = str(pid) if pid else None
        children_of.setdefault(key, []).append(d)

    file_ids: list[str] = []
    seen: set[str] = set()
    for root in root_ids:
        stack = [str(root)]
        visited: set[str] = set()
        while stack:
            cur = stack.pop()
            if cur in visited:
                continue
            visited.add(cur)
            row = by_id.get(cur)
            if not row:
                continue
            if row.get('kind') == 'file':
                if cur not in seen:
                    seen.add(cur)
                    file_ids.append(cur)
            else:
                for child in children_of.get(cur, []):
                    cid = str(child.get('id') or '')
                    if cid:
                        stack.append(cid)
    return file_ids


def collect_shared_tree_doc_ids(
    supabase,
    meeting_id: str,
    root_ids: list[str],
) -> list[str]:
    """Folder + file thuộc cây chia sẻ (để index trên Firebase)."""
    if not root_ids:
        return []
    all_docs = _fetch_all_docs(supabase, meeting_id)
    by_id = _build_doc_index(all_docs)
    children_of: dict[Optional[str], list[dict]] = {}
    for d in all_docs:
        pid = d.get('parent_id')
        key = str(pid) if pid else None
        children_of.setdefault(key, []).append(d)

    out: list[str] = []
    seen: set[str] = set()
    for root in root_ids:
        stack = [str(root)]
        visited: set[str] = set()
        while stack:
            cur = stack.pop()
            if cur in visited:
                continue
            visited.add(cur)
            if cur not in seen:
                seen.add(cur)
                out.append(cur)
            for child in children_of.get(cur, []):
                cid = str(child.get('id') or '')
                if cid:
                    stack.append(cid)
    return out


def _assert_shares_table(supabase) -> None:
    try:
        supabase.table('meeting_document_shares').select('id').limit(1).execute()
    except Exception as exc:
        msg = str(exc)
        if 'meeting_document_shares' in msg or 'PGRST205' in msg:
            raise RuntimeError(
                'Chưa tạo bảng meeting_document_shares trên Supabase. '
                'Mở SQL Editor và chạy file supabase/patch-meeting-document-shares-20260702.sql '
                '(sau patch-meeting-documents-20260701.sql), rồi thử lại.'
            ) from exc
        raise


def set_document_shares(
    supabase,
    meeting_id: str,
    ctx: UserContext,
    document_ids: list[str],
) -> dict:
    assert_can_write(supabase, meeting_id, ctx)
    _assert_shares_table(supabase)

    clean_ids = []
    seen: set[str] = set()
    for raw in document_ids or []:
        did = str(raw or '').strip()
        if not did or did in seen:
            continue
        seen.add(did)
        clean_ids.append(did)

    if clean_ids:
        res = supabase.table('meeting_documents').select('id').eq(
            'meeting_id', meeting_id
        ).in_('id', clean_ids).execute()
        found = {str(r['id']) for r in (res.data or [])}
        missing = [d for d in clean_ids if d not in found]
        if missing:
            raise ValueError('Một số tài liệu không thuộc cuộc họp này')

    supabase.table('meeting_document_shares').delete().eq('meeting_id', meeting_id).execute()
    if clean_ids:
        rows = [{
            'meeting_id': meeting_id,
            'document_id': did,
            'shared_by_username': ctx.username,
        } for did in clean_ids]
        supabase.table('meeting_document_shares').insert(rows).execute()

    warm_result = None
    try:
        from modules.meetings.warm_service import sync_shared_documents_to_firebase
        warm_result = sync_shared_documents_to_firebase(supabase, meeting_id, clean_ids)
    except Exception as exc:
        print(f'[meeting_docs] sync shared to firebase: {exc}')

    data = get_document_shares(supabase, meeting_id, ctx)
    if warm_result:
        data['warm_result'] = warm_result
    return data


def _validate_parent(supabase, meeting_id: str, parent_id: Optional[str]) -> None:
    if not parent_id:
        return
    res = supabase.table('meeting_documents').select('id, kind').eq(
        'id', parent_id
    ).eq('meeting_id', meeting_id).limit(1).execute()
    if not res.data:
        raise ValueError('Thư mục cha không tồn tại')
    if res.data[0].get('kind') != 'folder':
        raise ValueError('parent_id phải là thư mục')


def create_folder(
    supabase,
    meeting_id: str,
    ctx: UserContext,
    name: str,
    parent_id: Optional[str] = None,
) -> dict:
    assert_can_write(supabase, meeting_id, ctx)
    _validate_parent(supabase, meeting_id, parent_id)
    clean = (name or '').strip()
    if not clean:
        raise ValueError('Tên thư mục không được trống')
    row = {
        'meeting_id': meeting_id,
        'parent_id': parent_id,
        'kind': 'folder',
        'name': clean,
        'storage_backend': 'supabase',
        'warm_status': 'ready',
        'created_by_username': ctx.username,
    }
    res = supabase.table('meeting_documents').insert(row).execute()
    if not res.data:
        raise RuntimeError('Không tạo được thư mục')
    return _row_to_doc(res.data[0])


def _upload_bytes_supabase(data: bytes, path: str, mime: str) -> bool:
    try:
        from supabase import create_client
        client = create_client(os.getenv('SUPABASE_URL', ''), _storage_key())
        client.storage.from_(BUCKET).upload(
            path,
            data,
            {'content-type': mime or 'application/octet-stream', 'upsert': 'true'},
        )
        return True
    except Exception as exc:
        print(f'[meeting_docs] supabase upload: {exc}')
        return False


def _upload_bytes_local(data: bytes, path: str) -> str:
    full = LOCAL_ROOT / path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(data)
    return str(full)


def upload_file(
    supabase,
    meeting_id: str,
    ctx: UserContext,
    filename: str,
    data: bytes,
    mime_type: Optional[str] = None,
    parent_id: Optional[str] = None,
) -> dict:
    assert_can_write(supabase, meeting_id, ctx)
    _validate_parent(supabase, meeting_id, parent_id)
    if not data:
        raise ValueError('File trống')
    if len(data) > MAX_FILE_BYTES:
        raise ValueError(f'File vượt quá {MAX_FILE_BYTES // (1024 * 1024)} MB')

    safe = _safe_name(filename)
    ext = Path(safe).suffix.lower()
    if ext and ext not in ALLOWED_EXT:
        raise ValueError(f'Định dạng {ext} không được phép')

    doc_id = str(uuid.uuid4())
    storage_path = f'{meeting_id}/{doc_id}/{safe}'
    backend = 'supabase'
    if not _upload_bytes_supabase(data, storage_path, mime_type or 'application/octet-stream'):
        backend = 'local'
        _upload_bytes_local(data, storage_path)

    row = {
        'id': doc_id,
        'meeting_id': meeting_id,
        'parent_id': parent_id,
        'kind': 'file',
        'name': safe,
        'storage_backend': backend,
        'storage_path': storage_path,
        'mime_type': mime_type or 'application/octet-stream',
        'file_size': len(data),
        'warm_status': 'pending',
        'created_by_username': ctx.username,
    }
    res = supabase.table('meeting_documents').insert(row).execute()
    if not res.data:
        raise RuntimeError('Không lưu metadata tài liệu')
    doc = _row_to_doc(res.data[0])

    try:
        from modules.meetings.warm_service import warm_meeting_documents
        warm_meeting_documents(supabase, meeting_id, doc_ids=[doc_id])
    except Exception as exc:
        print(f'[meeting_docs] warm after upload: {exc}')

    refreshed = supabase.table('meeting_documents').select('*').eq('id', doc_id).limit(1).execute()
    if refreshed.data:
        doc = _row_to_doc(refreshed.data[0])
    return doc


def read_file_bytes(supabase, doc: dict) -> bytes:
    path = doc.get('storage_path') or ''
    backend = doc.get('storage_backend') or 'supabase'
    if backend == 'local':
        full = LOCAL_ROOT / path
        if not full.is_file():
            raise FileNotFoundError('File local không tồn tại')
        return full.read_bytes()
    client = _supabase_storage_client()
    return client.storage.from_(BUCKET).download(path)


def read_presentation_bytes(doc: dict) -> bytes:
    """Tải file đầy đủ cho trình chiếu — pdf.js cần body hoàn chỉnh + Content-Length."""
    import urllib.error
    import urllib.request

    signed = create_signed_download_url(doc)
    if signed:
        try:
            with urllib.request.urlopen(signed, timeout=300) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            print(f'[meeting_docs] read_presentation_bytes signed: {exc}')

    local_path = local_file_path(doc)
    if local_path:
        return local_path.read_bytes()

    path = doc.get('storage_path') or ''
    if path:
        client = _supabase_storage_client()
        return client.storage.from_(BUCKET).download(path)
    raise FileNotFoundError('Không tải được file trình chiếu')


def iter_presentation_file(doc: dict):
    """Stream file cho trình chiếu — tránh load cả file lớn vào RAM."""
    import urllib.error
    import urllib.request

    signed = create_signed_download_url(doc)
    if signed:
        try:
            with urllib.request.urlopen(signed, timeout=180) as resp:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    yield chunk
            return
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            print(f'[meeting_docs] stream signed url: {exc}')

    local_path = local_file_path(doc)
    if local_path:
        with open(local_path, 'rb') as fh:
            while True:
                chunk = fh.read(65536)
                if not chunk:
                    break
                yield chunk
        return

    data = read_file_bytes(None, doc)  # type: ignore[arg-type]
    if data:
        yield data


_storage_client = None
_signed_url_cache: dict[str, tuple[str, float]] = {}
_SIGNED_URL_CACHE_TTL = 600


def _supabase_storage_client():
    global _storage_client
    if _storage_client is None:
        from supabase import create_client
        _storage_client = create_client(os.getenv('SUPABASE_URL', ''), _storage_key())
    return _storage_client


def create_firebase_download_url(doc: dict, expires_in: int = 3600) -> Optional[str]:
    """URL tải trực tiếp từ Firebase Storage (hot cache phiên họp)."""
    fb_path = (doc.get('firebase_path') or '').strip()
    if not fb_path or doc.get('warm_status') != 'ready':
        return None
    bucket_name = os.getenv('FIREBASE_STORAGE_BUCKET', '').strip()
    if not bucket_name:
        return None

    doc_id = str(doc.get('id') or fb_path)
    now = time.time()
    cache_key = f'fb:{doc_id}'
    cached = _signed_url_cache.get(cache_key)
    if cached and cached[1] > now:
        return cached[0]

    try:
        from datetime import timedelta

        from firebase_admin import storage

        from modules.meetings.firebase_admin_client import init_firebase_admin_with_service_account

        init_firebase_admin_with_service_account()
        blob = storage.bucket(bucket_name).blob(fb_path)
        url = blob.generate_signed_url(
            version='v4',
            expiration=timedelta(seconds=expires_in),
            method='GET',
        )
        if url:
            _signed_url_cache[cache_key] = (url, now + min(expires_in - 120, _SIGNED_URL_CACHE_TTL))
        return url
    except Exception as exc:
        print(f'[meeting_docs] create_firebase_download_url: {exc}')
    return None


def resolve_direct_download_url(doc: dict) -> Optional[str]:
    """Ưu tiên Firebase hot → Supabase cold."""
    return create_firebase_download_url(doc) or create_signed_download_url(doc)


def create_signed_download_url(doc: dict, expires_in: int = 3600) -> Optional[str]:
    """URL tải trực tiếp từ Supabase Storage — tránh proxy file lớn qua Flask."""
    backend = doc.get('storage_backend') or ''
    path = doc.get('storage_path') or ''
    doc_id = str(doc.get('id') or path)
    if backend != 'supabase' or not path:
        return None

    now = time.time()
    cached = _signed_url_cache.get(doc_id)
    if cached and cached[1] > now:
        return cached[0]

    try:
        res = _supabase_storage_client().storage.from_(BUCKET).create_signed_url(path, expires_in)
        url = None
        if isinstance(res, dict):
            url = (
                res.get('signedURL') or res.get('signedUrl') or
                res.get('signed_url') or (res.get('data') or {}).get('signedURL')
            )
        elif isinstance(res, str):
            url = res
        if url:
            _signed_url_cache[doc_id] = (url, now + min(expires_in - 120, _SIGNED_URL_CACHE_TTL))
        return url
    except Exception as exc:
        print(f'[meeting_docs] create_signed_download_url: {exc}')
    return None


def attach_download_urls(docs: list[dict], max_files: int = 12) -> list[dict]:
    """Gắn link tải trực tiếp khi liệt kê — bấm Mở không cần chờ thêm API."""
    files = [d for d in docs if d.get('kind') == 'file']
    if len(files) > max_files:
        return docs
    out: list[dict] = []
    for d in docs:
        row = dict(d)
        if row.get('kind') == 'file':
            signed = resolve_direct_download_url(row)
            if signed:
                row['download_url'] = signed
                row['download_source'] = 'firebase' if row.get('firebase_path') and row.get('warm_status') == 'ready' else 'supabase'
        out.append(row)
    return out


def get_download_link(
    supabase,
    meeting_id: str,
    doc_id: str,
    ctx: UserContext,
    *,
    inline: bool = False,
) -> dict:
    doc = get_document(supabase, meeting_id, doc_id, ctx, check_share=True)
    if doc.get('kind') != 'file':
        raise ValueError('Không phải file')
    name = doc.get('name') or 'download'
    mime = resolve_mime_type(name, doc.get('mime_type'))
    fb_url = create_firebase_download_url(doc)
    if fb_url:
        return {
            'name': name,
            'mime': mime,
            'direct': True,
            'url': fb_url,
            'source': 'firebase',
            'inline': inline and is_pdf_document(name, mime),
        }
    signed = create_signed_download_url(doc)
    return {
        'name': name,
        'mime': mime,
        'direct': bool(signed),
        'url': signed,
        'source': 'supabase' if signed else 'proxy',
        'inline': inline and is_pdf_document(name, mime),
    }


def presentation_download_url(
    meeting_id: str,
    doc_id: str,
    username: str,
    *,
    inline: bool = True,
) -> str:
    """URL cùng origin — proxy qua Flask để pdf.js/pptx đọc được (tránh CORS Supabase)."""
    from urllib.parse import urlencode

    params: dict[str, str] = {
        'username': username or '',
        'presentation': '1',
    }
    if inline:
        params['disposition'] = 'inline'
    return f'/api/meetings/{meeting_id}/documents/{doc_id}/download?{urlencode(params)}'


def local_file_path(doc: dict) -> Optional[Path]:
    if (doc.get('storage_backend') or '') != 'local':
        return None
    path = doc.get('storage_path') or ''
    if not path:
        return None
    full = LOCAL_ROOT / path
    return full if full.is_file() else None


def get_document(
    supabase,
    meeting_id: str,
    doc_id: str,
    ctx: UserContext,
    *,
    check_share: bool = True,
) -> dict:
    assert_can_read(supabase, meeting_id, ctx)
    res = supabase.table('meeting_documents').select('*').eq(
        'id', doc_id
    ).eq('meeting_id', meeting_id).limit(1).execute()
    if not res.data:
        raise LookupError('Không tìm thấy tài liệu')
    doc = _row_to_doc(res.data[0])
    if check_share and should_filter_shared(supabase, meeting_id, ctx):
        shared_roots = get_shared_root_ids(supabase, meeting_id)
        if not is_document_shared_by_chain(supabase, meeting_id, doc_id, shared_roots):
            raise PermissionError('Tài liệu chưa được chia sẻ cho cuộc họp này')
    return doc


def _is_ancestor_folder(
    supabase,
    meeting_id: str,
    ancestor_id: str,
    node_id: str,
) -> bool:
    """True nếu ancestor_id là tổ tiên của node_id (hoặc trùng)."""
    cur: Optional[str] = str(node_id)
    target = str(ancestor_id)
    seen: set[str] = set()
    while cur and cur not in seen:
        if cur == target:
            return True
        seen.add(cur)
        res = supabase.table('meeting_documents').select('parent_id').eq(
            'id', cur
        ).eq('meeting_id', meeting_id).limit(1).execute()
        if not res.data:
            break
        parent = res.data[0].get('parent_id')
        if not parent:
            break
        cur = str(parent)
    return False


def move_document(
    supabase,
    meeting_id: str,
    doc_id: str,
    ctx: UserContext,
    new_parent_id: Optional[str] = None,
) -> dict:
    assert_can_write(supabase, meeting_id, ctx)
    doc = get_document(supabase, meeting_id, doc_id, ctx, check_share=False)
    target_parent = new_parent_id or None
    if target_parent in ('', 'null', 'root'):
        target_parent = None

    current_parent = doc.get('parent_id')
    if (current_parent or None) == (target_parent or None):
        return doc

    if doc.get('kind') == 'folder':
        if target_parent and str(target_parent) == str(doc_id):
            raise ValueError('Không thể di chuyển thư mục vào chính nó')
        if target_parent and _is_ancestor_folder(supabase, meeting_id, str(doc_id), str(target_parent)):
            raise ValueError('Không thể di chuyển thư mục vào thư mục con của nó')

    _validate_parent(supabase, meeting_id, target_parent)

    supabase.table('meeting_documents').update({
        'parent_id': target_parent,
        'updated_at': _now_iso(),
    }).eq('id', doc_id).eq('meeting_id', meeting_id).execute()

    return get_document(supabase, meeting_id, doc_id, ctx, check_share=False)


def delete_document(supabase, meeting_id: str, doc_id: str, ctx: UserContext) -> bool:
    assert_can_write(supabase, meeting_id, ctx)
    doc = get_document(supabase, meeting_id, doc_id, ctx)
    if doc.get('kind') == 'folder':
        children = supabase.table('meeting_documents').select('id').eq(
            'parent_id', doc_id
        ).limit(1).execute()
        if children.data:
            raise ValueError('Thư mục còn tài liệu con — xóa hoặc di chuyển trước')
    else:
        _delete_storage_object(doc)
    supabase.table('meeting_documents').delete().eq('id', doc_id).execute()
    return True


def _delete_storage_object(doc: dict) -> None:
    path = doc.get('storage_path') or ''
    backend = doc.get('storage_backend') or ''
    if not path:
        return
    try:
        if backend == 'local':
            full = LOCAL_ROOT / path
            if full.is_file():
                full.unlink()
        elif backend == 'supabase':
            from supabase import create_client
            client = create_client(os.getenv('SUPABASE_URL', ''), _storage_key())
            client.storage.from_(BUCKET).remove([path])
    except Exception as exc:
        print(f'[meeting_docs] delete storage: {exc}')


def list_breadcrumb(
    supabase,
    meeting_id: str,
    folder_id: Optional[str],
    ctx: Optional[UserContext] = None,
) -> list[dict]:
    trail: list[dict] = []
    cur = folder_id
    seen = set()
    while cur and cur not in seen:
        seen.add(cur)
        res = supabase.table('meeting_documents').select('id, name, parent_id').eq(
            'id', cur
        ).eq('meeting_id', meeting_id).limit(1).execute()
        if not res.data:
            break
        row = res.data[0]
        trail.append({'id': row['id'], 'name': row['name']})
        cur = row.get('parent_id')
    trail.reverse()
    if ctx and folder_id and should_filter_shared(supabase, meeting_id, ctx):
        all_docs = _fetch_all_docs(supabase, meeting_id)
        shared_roots = get_shared_root_ids(supabase, meeting_id)
        by_id = _build_doc_index(all_docs)
        if not is_document_shared(str(folder_id), shared_roots, by_id):
            raise PermissionError('Thư mục chưa được chia sẻ cho cuộc họp này')
    return trail


_MIME_BY_EXT = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
}


def _ext_of(filename: str) -> str:
    return Path(filename or '').suffix.lower()


def is_pdf_document(filename: str, mime_type: Optional[str] = None) -> bool:
    if _ext_of(filename) == '.pdf':
        return True
    mime = (mime_type or '').lower()
    return 'pdf' in mime


def is_office_document(filename: str, mime_type: Optional[str] = None) -> bool:
    ext = _ext_of(filename)
    if ext in ('.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'):
        return True
    mime = (mime_type or '').lower()
    office_hints = (
        'word', 'excel', 'spreadsheet', 'powerpoint', 'presentation',
        'msword', 'ms-excel', 'ms-powerpoint',
    )
    return any(h in mime for h in office_hints)


def resolve_mime_type(filename: str, stored_mime: Optional[str] = None) -> str:
    ext = _ext_of(filename)
    if ext in _MIME_BY_EXT:
        return _MIME_BY_EXT[ext]
    stored = (stored_mime or '').strip()
    if stored and stored != 'application/octet-stream':
        return stored
    return 'application/octet-stream'


def download_disposition(filename: str, mime_type: Optional[str] = None, inline: bool = False) -> str:
    """PDF có thể inline; Word/Excel/PPT luôn attachment để mở app native."""
    if is_office_document(filename, mime_type):
        inline = False
    elif is_pdf_document(filename, mime_type) and inline:
        pass
    else:
        inline = False
    return content_disposition(filename, inline=inline)


def content_disposition(filename: str, inline: bool = False) -> str:
    from urllib.parse import quote
    safe = _safe_name(filename)
    mode = 'inline' if inline else 'attachment'
    encoded = quote(safe)
    return f"{mode}; filename=\"{safe}\"; filename*=UTF-8''{encoded}"
