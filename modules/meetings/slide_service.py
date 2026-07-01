"""Chuẩn bị slide trình chiếu — PDF trực tiếp, PPTX chuyển sang ảnh."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

from modules.meetings import document_service as doc_svc
from modules.meetings.rbac import UserContext

SLIDE_CACHE_ROOT = Path(os.getenv('MEETING_SLIDE_CACHE', 'data/meeting_slide_cache'))


def is_presentable_document(filename: str, mime_type: Optional[str] = None) -> bool:
    ext = Path(filename or '').suffix.lower()
    if ext in ('.pdf', '.ppt', '.pptx'):
        return True
    mime = (mime_type or '').lower()
    return 'pdf' in mime or 'powerpoint' in mime or 'presentation' in mime


def _find_libreoffice() -> Optional[str]:
    found = shutil.which('soffice')
    if found:
        return found
    if sys.platform == 'win32':
        candidates = [
            r'C:\Program Files\LibreOffice\program\soffice.exe',
            r'C:\Program Files (x86)\LibreOffice\program\soffice.exe',
        ]
        for path in candidates:
            if os.path.isfile(path):
                return path
    return None


def _convert_with_libreoffice(data: bytes, filename: str) -> Optional[bytes]:
    soffice = _find_libreoffice()
    if not soffice:
        return None
    safe_name = Path(filename).name or 'deck.pptx'
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / safe_name
        src.write_bytes(data)
        try:
            subprocess.run(
                [soffice, '--headless', '--convert-to', 'pdf', '--outdir', tmp, str(src)],
                check=True,
                timeout=180,
                capture_output=True,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
            print(f'[slide_service] libreoffice: {exc}')
            return None
        pdf_path = Path(tmp) / (src.stem + '.pdf')
        if pdf_path.is_file():
            return pdf_path.read_bytes()
    return None


def _convert_with_powerpoint_com(data: bytes, filename: str) -> Optional[bytes]:
    if sys.platform != 'win32':
        return None
    try:
        import comtypes.client  # type: ignore
    except ImportError:
        return None

    safe_name = Path(filename).name or 'deck.pptx'
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / safe_name
        pdf_path = Path(tmp) / (src.stem + '.pdf')
        src.write_bytes(data)
        app = None
        try:
            app = comtypes.client.CreateObject('PowerPoint.Application')
            app.Visible = 0
            presentation = app.Presentations.Open(str(src.resolve()), WithWindow=False)
            presentation.SaveAs(str(pdf_path.resolve()), 32)  # ppSaveAsPDF
            presentation.Close()
            if pdf_path.is_file():
                return pdf_path.read_bytes()
        except Exception as exc:
            print(f'[slide_service] powerpoint com: {exc}')
        finally:
            if app is not None:
                try:
                    app.Quit()
                except Exception:
                    pass
    return None


def convert_pptx_to_pdf(data: bytes, filename: str) -> bytes:
    pdf = _convert_with_libreoffice(data, filename)
    if pdf:
        return pdf
    pdf = _convert_with_powerpoint_com(data, filename)
    if pdf:
        return pdf
    raise ValueError(
        'Không chuyển được PowerPoint sang slide. '
        'Cài LibreOffice hoặc Microsoft PowerPoint trên máy chủ, hoặc upload bản PDF để trình chiếu.'
    )


def _cache_dir(meeting_id: str, doc_id: str) -> Path:
    return SLIDE_CACHE_ROOT / meeting_id / doc_id


def _cache_marker_path(cache_dir: Path) -> Path:
    return cache_dir / '.ready'


def _ensure_cache(cache_dir: Path, pdf_bytes: bytes) -> int:
    marker = _cache_marker_path(cache_dir)
    if marker.is_file():
        existing = sorted(cache_dir.glob('*.jpg'))
        if existing:
            return len(existing)

    if cache_dir.exists():
        for child in cache_dir.iterdir():
            if child.is_file():
                child.unlink()
    else:
        cache_dir.mkdir(parents=True, exist_ok=True)

    try:
        import fitz  # PyMuPDF
    except ImportError as exc:
        raise RuntimeError(
            'Thiếu thư viện PyMuPDF — chạy: pip install pymupdf'
        ) from exc

    doc = fitz.open(stream=pdf_bytes, filetype='pdf')
    try:
        for i in range(doc.page_count):
            page = doc.load_page(i)
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            pix.save(str(cache_dir / f'{i}.jpg'))
        count = doc.page_count
    finally:
        doc.close()

    marker.write_text(str(count), encoding='utf-8')
    return count


def get_presentation_info(
    supabase,
    meeting_id: str,
    doc_id: str,
    ctx: UserContext,
) -> dict:
    doc = doc_svc.get_document(supabase, meeting_id, doc_id, ctx, check_share=True)
    if doc.get('kind') != 'file':
        raise ValueError('Chỉ trình chiếu được file')
    name = doc.get('name') or 'document'
    mime = doc.get('mime_type')
    if not is_presentable_document(name, mime):
        raise ValueError('Chỉ hỗ trợ PDF và PowerPoint (.ppt / .pptx)')

    if doc_svc.is_pdf_document(name, mime):
        link = doc_svc.get_download_link(supabase, meeting_id, doc_id, ctx, inline=True)
        signed = link.get('url') if link.get('direct') else None
        return {
            'format': 'pdf',
            'doc_id': doc_id,
            'doc_name': name,
            'slide_count': 0,
            'download_url': signed or doc_svc.presentation_download_url(
                meeting_id, doc_id, ctx.username or '', inline=True,
            ),
            'direct': bool(signed),
        }

    return prepare_presentation(supabase, meeting_id, doc_id, ctx)


def prepare_presentation(
    supabase,
    meeting_id: str,
    doc_id: str,
    ctx: UserContext,
) -> dict:
    doc = doc_svc.get_document(supabase, meeting_id, doc_id, ctx, check_share=True)
    if doc.get('kind') != 'file':
        raise ValueError('Chỉ trình chiếu được file')

    name = doc.get('name') or 'document'
    mime = doc.get('mime_type')
    if not is_presentable_document(name, mime):
        raise ValueError('Chỉ hỗ trợ PDF và PowerPoint (.ppt / .pptx)')

    if doc_svc.is_pdf_document(name, mime):
        link = doc_svc.get_download_link(supabase, meeting_id, doc_id, ctx, inline=True)
        signed = link.get('url') if link.get('direct') else None
        return {
            'format': 'pdf',
            'doc_id': doc_id,
            'doc_name': name,
            'download_url': signed or doc_svc.presentation_download_url(
                meeting_id, doc_id, ctx.username or '', inline=True,
            ),
            'direct': bool(signed),
        }

    pptx_url = doc_svc.presentation_download_url(
        meeting_id, doc_id, ctx.username or '', inline=False,
    )
    data = doc_svc.read_file_bytes(supabase, doc)
    try:
        pdf_bytes = convert_pptx_to_pdf(data, name)
        cache_dir = _cache_dir(meeting_id, doc_id)
        slide_count = _ensure_cache(cache_dir, pdf_bytes)
        return {
            'format': 'images',
            'doc_id': doc_id,
            'doc_name': name,
            'slide_count': slide_count,
            'slides_base_url': f'/api/meetings/{meeting_id}/documents/{doc_id}/slides',
        }
    except ValueError as exc:
        print(f'[slide_service] pptx server convert skipped, client mode: {exc}')
        return {
            'format': 'pptx',
            'doc_id': doc_id,
            'doc_name': name,
            'download_url': pptx_url,
        }


def get_slide_image_path(
    supabase,
    meeting_id: str,
    doc_id: str,
    slide_index: int,
    ctx: UserContext,
) -> Path:
    doc_svc.get_document(supabase, meeting_id, doc_id, ctx, check_share=True)
    cache_dir = _cache_dir(meeting_id, doc_id)
    if not _cache_marker_path(cache_dir).is_file():
        raise LookupError('Slide chưa được chuẩn bị — bấm Chia sẻ slide trước')
    path = cache_dir / f'{int(slide_index)}.jpg'
    if not path.is_file():
        raise LookupError('Không tìm thấy slide')
    return path
