"""Nghiệp vụ TBKL — chu kỳ họp, kết luận, đầu việc, báo cáo tuần."""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

from modules.meetings.rbac import UserContext
from modules.tbkl.rbac import (
    can_admin,
    can_assess_directive,
    can_confirm,
    can_confirm_directive,
    can_lock,
    can_unlock_cycle,
    can_manage,
    can_operate,
    can_planning,
    can_report,
    can_update_attachments,
    is_planning_department,
    is_unit_reporter_only,
    unit_can_edit_task,
    user_department_name,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _week_label(d: Optional[date] = None) -> str:
    d = d or _today()
    iso = d.isocalendar()
    return f'{iso.year}-W{iso.week:02d}'


def _priority_label(p: str) -> str:
    return {
        'low': 'Thấp',
        'normal': 'Bình thường',
        'high': 'Cao',
        'critical': 'Rất cao',
    }.get(p or 'normal', p or '')


def _status_label(st: str) -> str:
    return {
        'not_started': 'Chưa thực hiện',
        'in_progress': 'Đang thực hiện',
        'at_risk': 'Có nguy cơ trễ',
        'completed': 'Hoàn thành',
        'blocked': 'Tạm dừng / vướng',
    }.get(st or 'not_started', st or '')


def compute_rag(
    *,
    progress_pct: float,
    status: str,
    deadline: Optional[str],
    cycle_locked: bool,
    has_report: bool,
) -> str:
    pct = float(progress_pct or 0)
    st = (status or 'not_started').lower()
    dl: Optional[date] = None
    if deadline:
        try:
            dl = date.fromisoformat(str(deadline)[:10])
        except ValueError:
            dl = None

    if st == 'completed' or pct >= 100:
        return 'green'
    if st == 'blocked':
        return 'red'
    if dl and _today() > dl:
        return 'red'
    if st == 'at_risk':
        return 'yellow'
    if dl and (_today() - dl).days >= -7 and pct < 80:
        return 'yellow'
    if cycle_locked and not has_report:
        return 'red'
    if st == 'in_progress':
        return 'yellow' if pct < 50 else 'green'
    if st == 'not_started':
        return 'gray'
    return 'yellow'


def _sort_directives(directives: list[dict]) -> list[dict]:
    return sorted(directives, key=lambda d: int(d.get('seq_no') or 999))


def _sort_tasks(directives: list[dict], tasks: list[dict]) -> list[dict]:
    dir_seq = {d['id']: int(d.get('seq_no') or 999) for d in directives}
    return sorted(
        tasks,
        key=lambda t: (
            dir_seq.get(t.get('directive_id'), 999),
            int(t.get('seq_no') or 999),
        ),
    )


def _directive_code(meeting_seq: int, seq_no: int) -> str:
    return f'H{meeting_seq}-{seq_no:02d}'


def _task_code(meeting_seq: int, dir_seq: int, task_seq: int) -> str:
    return f'H{meeting_seq}-{dir_seq:02d}-{task_seq:02d}'


def list_cycles(supabase) -> list[dict]:
    res = supabase.table('tbkl_cycles').select('*').order('meeting_seq', desc=True).execute()
    return res.data or []


def list_cycles_enriched(supabase) -> list[dict]:
    cycles = list_cycles(supabase)
    if not cycles:
        return []

    cycle_ids = [c['id'] for c in cycles]
    dirs_res = supabase.table('tbkl_directives').select('id, cycle_id').in_(
        'cycle_id', cycle_ids
    ).execute()
    directives = dirs_res.data or []
    dir_counts: dict[str, int] = {}
    dir_ids: list[str] = []
    dirs_by_cycle: dict[str, list[str]] = {}
    for d in directives:
        cid = d['cycle_id']
        dir_counts[cid] = dir_counts.get(cid, 0) + 1
        dir_ids.append(d['id'])
        dirs_by_cycle.setdefault(cid, []).append(d['id'])

    task_counts: dict[str, int] = {cid: 0 for cid in cycle_ids}
    if dir_ids:
        tasks_res = supabase.table('tbkl_tasks').select('id, directive_id').in_(
            'directive_id', dir_ids
        ).execute()
        dir_to_cycle = {d['id']: d['cycle_id'] for d in directives}
        for t in tasks_res.data or []:
            cid = dir_to_cycle.get(t['directive_id'])
            if cid:
                task_counts[cid] = task_counts.get(cid, 0) + 1

    out: list[dict] = []
    for c in cycles:
        cid = c['id']
        out.append({
            **c,
            'directive_count': dir_counts.get(cid, 0),
            'task_count': task_counts.get(cid, 0),
        })
    return out


def get_cycle(supabase, cycle_id: str) -> Optional[dict]:
    res = supabase.table('tbkl_cycles').select('*').eq('id', cycle_id).limit(1).execute()
    return res.data[0] if res.data else None


def next_meeting_seq(supabase) -> int:
    res = supabase.table('tbkl_cycles').select('meeting_seq').order(
        'meeting_seq', desc=True
    ).limit(1).execute()
    if res.data and res.data[0].get('meeting_seq') is not None:
        return int(res.data[0]['meeting_seq']) + 1
    return 1


def create_cycle(supabase, ctx: UserContext, payload: dict) -> dict:
    meeting_seq = payload.get('meeting_seq')
    if meeting_seq is None:
        meeting_seq = next_meeting_seq(supabase)
    else:
        meeting_seq = int(meeting_seq)

    title = (payload.get('title') or '').strip() or f'Cuộc họp số {meeting_seq}'
    row = {
        'meeting_seq': meeting_seq,
        'title': title,
        'meeting_date': payload.get('meeting_date') or None,
        'source_ref': (payload.get('source_ref') or '').strip() or None,
        'conclusion_summary': (payload.get('conclusion_summary') or '').strip() or None,
        'report_lock_at': payload.get('report_lock_at') or None,
        'status': 'active',
        'created_by_username': ctx.username,
        'updated_at': _now_iso(),
    }
    res = supabase.table('tbkl_cycles').insert(row).execute()
    if not res.data:
        raise RuntimeError('Không tạo được chu kỳ TBKL')
    return res.data[0]


def create_directive(supabase, ctx: UserContext, cycle_id: str, payload: dict) -> dict:
    cycle = get_cycle(supabase, cycle_id)
    if not cycle:
        raise LookupError('Không tìm thấy cuộc họp')
    if cycle.get('status') == 'locked':
        raise ValueError('Chu kỳ đã khóa — không thêm kết luận')

    res = supabase.table('tbkl_directives').select('seq_no').eq(
        'cycle_id', cycle_id
    ).order('seq_no', desc=True).limit(1).execute()
    seq_no = (res.data[0]['seq_no'] + 1) if res.data else 1
    meeting_seq = int(cycle['meeting_seq'])
    code = _directive_code(meeting_seq, seq_no)

    row = {
        'cycle_id': cycle_id,
        'seq_no': seq_no,
        'code': code,
        'title': (payload.get('title') or '').strip() or f'Kết luận {code}',
        'content': (payload.get('content') or '').strip() or None,
        'lead_department_id': payload.get('lead_department_id') or None,
        'lead_department_name': (payload.get('lead_department_name') or '').strip() or None,
        'supervisor_name': (payload.get('supervisor_name') or '').strip() or None,
        'priority': payload.get('priority') or 'normal',
        'deadline': payload.get('deadline') or None,
        'updated_at': _now_iso(),
    }
    ins = supabase.table('tbkl_directives').insert(row).execute()
    if not ins.data:
        raise RuntimeError('Không tạo được kết luận')
    return ins.data[0]


def create_task(supabase, ctx: UserContext, directive_id: str, payload: dict) -> dict:
    dres = supabase.table('tbkl_directives').select('*').eq(
        'id', directive_id
    ).limit(1).execute()
    if not dres.data:
        raise LookupError('Không tìm thấy kết luận')
    directive = dres.data[0]
    cycle = get_cycle(supabase, directive['cycle_id'])
    if not cycle:
        raise LookupError('Không tìm thấy cuộc họp')
    if cycle.get('status') == 'locked':
        raise ValueError('Chu kỳ đã khóa — không thêm đầu việc')

    tres = supabase.table('tbkl_tasks').select('seq_no').eq(
        'directive_id', directive_id
    ).order('seq_no', desc=True).limit(1).execute()
    seq_no = (tres.data[0]['seq_no'] + 1) if tres.data else 1
    meeting_seq = int(cycle.get('meeting_seq') or 1)
    dir_seq = int(directive.get('seq_no') or 1)
    code = _task_code(meeting_seq, dir_seq, seq_no)

    row = {
        'directive_id': directive_id,
        'seq_no': seq_no,
        'code': code,
        'title': (payload.get('title') or '').strip() or f'Đầu việc {code}',
        'deliverable': (payload.get('deliverable') or '').strip() or None,
        'owner_unit_id': payload.get('owner_unit_id') or None,
        'owner_unit_name': (payload.get('owner_unit_name') or '').strip() or None,
        'coordinator_units': (payload.get('coordinator_units') or '').strip() or None,
        'assignee_name': (payload.get('assignee_name') or '').strip() or None,
        'deadline': payload.get('deadline') or None,
        'priority': payload.get('priority') or 'normal',
        'updated_at': _now_iso(),
    }
    ins = supabase.table('tbkl_tasks').insert(row).execute()
    if not ins.data:
        raise RuntimeError('Không tạo được đầu việc')
    return ins.data[0]


def _report_display_rag(
    rep: Optional[dict],
    task: dict,
    *,
    cycle_locked: bool,
) -> str:
    """RAG hiển thị cho lãnh đạo — theo xác nhận Phòng Kế hoạch."""
    if rep and rep.get('confirmed_at'):
        return compute_rag(
            progress_pct=float(rep.get('confirmed_pct') or 0),
            status=rep.get('confirmed_status') or 'not_started',
            deadline=task.get('deadline'),
            cycle_locked=cycle_locked,
            has_report=True,
        )
    return 'gray'


def _directive_display_rag(
    rep: Optional[dict],
    directive: dict,
    *,
    cycle_locked: bool,
) -> str:
    """RAG mục lớn — theo xác nhận VT nếu có, không thì theo đánh giá KHCN."""
    if rep and rep.get('confirmed_at'):
        return compute_rag(
            progress_pct=float(rep.get('confirmed_pct') or 0),
            status=rep.get('confirmed_status') or 'not_started',
            deadline=directive.get('deadline'),
            cycle_locked=cycle_locked,
            has_report=True,
        )
    if rep and rep.get('assessed_at'):
        return compute_rag(
            progress_pct=float(rep.get('progress_pct') or 0),
            status=rep.get('status') or 'not_started',
            deadline=directive.get('deadline'),
            cycle_locked=cycle_locked,
            has_report=True,
        )
    return 'gray'


def confirm_report(
    supabase,
    ctx: UserContext,
    task_id: str,
    payload: dict,
) -> dict:
    if not can_confirm(ctx, supabase):
        raise PermissionError('Chỉ quản trị hoặc Phòng Kế hoạch mới xác nhận tiến độ')

    task_res = supabase.table('tbkl_tasks').select('*').eq('id', task_id).limit(1).execute()
    if not task_res.data:
        raise LookupError('Không tìm thấy đầu việc')
    task = task_res.data[0]

    directive_res = supabase.table('tbkl_directives').select('cycle_id').eq(
        'id', task['directive_id']
    ).limit(1).execute()
    cycle_id = directive_res.data[0]['cycle_id'] if directive_res.data else None
    cycle = get_cycle(supabase, cycle_id) if cycle_id else None
    if cycle and cycle.get('status') == 'locked':
        raise ValueError('Cuộc họp đã chốt — không xác nhận thêm')

    week_label = (payload.get('week_label') or '').strip() or _week_label()

    existing = supabase.table('tbkl_reports').select('*').eq(
        'task_id', task_id
    ).eq('week_label', week_label).limit(1).execute()

    confirmed_pct = max(0, min(100, float(payload.get('confirmed_pct') or 0)))
    confirmed_status = (payload.get('confirmed_status') or 'in_progress').lower()
    confirmed_at = _now_iso()
    rag = compute_rag(
        progress_pct=confirmed_pct,
        status=confirmed_status,
        deadline=task.get('deadline'),
        cycle_locked=False,
        has_report=True,
    )

    if existing.data:
        rep = existing.data[0]
        if rep.get('locked'):
            raise ValueError('Báo cáo tuần này đã khóa — không xác nhận thêm')
        patch = {
            'confirmed_pct': confirmed_pct,
            'confirmed_status': confirmed_status,
            'confirmed_by_username': ctx.username,
            'confirmed_at': confirmed_at,
            'rag': rag,
        }
        supabase.table('tbkl_reports').update(patch).eq('id', rep['id']).execute()
        return {**rep, **patch}

    row = {
        'task_id': task_id,
        'week_label': week_label,
        'progress_pct': 0,
        'status': 'not_started',
        'confirmed_pct': confirmed_pct,
        'confirmed_status': confirmed_status,
        'confirmed_by_username': ctx.username,
        'confirmed_at': confirmed_at,
        'rag': rag,
        'submitted_by_username': ctx.username,
        'submitted_at': confirmed_at,
    }
    ins = supabase.table('tbkl_reports').insert(row).execute()
    if not ins.data:
        raise RuntimeError('Không lưu được xác nhận PKH')
    return ins.data[0]


def submit_report(
    supabase,
    ctx: UserContext,
    task_id: str,
    payload: dict,
) -> dict:
    task_res = supabase.table('tbkl_tasks').select('*').eq('id', task_id).limit(1).execute()
    if not task_res.data:
        raise LookupError('Không tìm thấy đầu việc')
    task = task_res.data[0]

    if not unit_can_edit_task(ctx, task, supabase):
        raise PermissionError('Bạn không được báo cáo đầu việc này — chỉ đơn vị được giao mới nhập')

    week_label = (payload.get('week_label') or '').strip() or _week_label()

    existing = supabase.table('tbkl_reports').select('*').eq(
        'task_id', task_id
    ).eq('week_label', week_label).limit(1).execute()
    if existing.data and existing.data[0].get('locked'):
        raise ValueError('Báo cáo tuần này đã khóa — liên hệ Phòng NV')

    progress = max(0, min(100, float(payload.get('progress_pct') or 0)))
    status = (payload.get('status') or 'in_progress').lower()
    rag = compute_rag(
        progress_pct=progress,
        status=status,
        deadline=task.get('deadline'),
        cycle_locked=False,
        has_report=True,
    )
    if existing.data and existing.data[0].get('confirmed_at'):
        rag = _report_display_rag(existing.data[0], task, cycle_locked=False)

    row = {
        'task_id': task_id,
        'week_label': week_label,
        'progress_pct': progress,
        'status': status,
        'difficulties': (payload.get('difficulties') or '').strip() or None,
        'solution': (payload.get('solution') or '').strip() or None,
        'recommendation': (payload.get('recommendation') or '').strip() or None,
        'rag': rag,
        'submitted_by_username': ctx.username,
        'submitted_at': _now_iso(),
    }

    if existing.data:
        rep_id = existing.data[0]['id']
        supabase.table('tbkl_reports').update(row).eq('id', rep_id).execute()
        row['id'] = rep_id
    else:
        ins = supabase.table('tbkl_reports').insert(row).execute()
        row = ins.data[0] if ins.data else row

    return row


def _latest_directive_reports_map(supabase, directive_ids: list[str]) -> dict[str, dict]:
    if not directive_ids:
        return {}
    try:
        res = supabase.table('tbkl_directive_reports').select('*').in_(
            'directive_id', directive_ids
        ).order('week_label', desc=True).execute()
    except Exception as exc:
        print(f'[tbkl] directive_reports (chạy schema-tbkl-directive-reports.sql): {exc}')
        return {}
    out: dict[str, dict] = {}
    for row in res.data or []:
        did = row.get('directive_id')
        if did and did not in out:
            out[did] = row
    return out


def assess_directive_report(
    supabase,
    ctx: UserContext,
    directive_id: str,
    payload: dict,
) -> dict:
    if not can_assess_directive(ctx, supabase):
        raise PermissionError('Chỉ quản trị hoặc Phòng KHCN mới đánh giá mục lớn')

    dres = supabase.table('tbkl_directives').select('*').eq('id', directive_id).limit(1).execute()
    if not dres.data:
        raise LookupError('Không tìm thấy mục kết luận lớn')
    directive = dres.data[0]

    cycle = get_cycle(supabase, directive['cycle_id'])
    if cycle and cycle.get('status') == 'locked':
        raise ValueError('Cuộc họp đã chốt — không đánh giá thêm')

    week_label = (payload.get('week_label') or '').strip() or _week_label()
    existing = supabase.table('tbkl_directive_reports').select('*').eq(
        'directive_id', directive_id
    ).eq('week_label', week_label).limit(1).execute()

    progress = max(0, min(100, float(payload.get('progress_pct') or 0)))
    status = (payload.get('status') or 'in_progress').lower()
    assessed_at = _now_iso()
    rag = compute_rag(
        progress_pct=progress,
        status=status,
        deadline=directive.get('deadline'),
        cycle_locked=False,
        has_report=True,
    )

    row = {
        'progress_pct': progress,
        'status': status,
        'note': (payload.get('note') or '').strip() or None,
        'assessed_by_username': ctx.username,
        'assessed_at': assessed_at,
        'rag': rag,
    }

    if existing.data:
        rep = existing.data[0]
        if rep.get('locked'):
            raise ValueError('Báo cáo tuần này đã khóa — không đánh giá thêm')
        if rep.get('confirmed_at'):
            row['rag'] = _directive_display_rag({**rep, **row}, directive, cycle_locked=False)
        supabase.table('tbkl_directive_reports').update(row).eq('id', rep['id']).execute()
        return {**rep, **row}

    insert_row = {
        'directive_id': directive_id,
        'week_label': week_label,
        **row,
    }
    ins = supabase.table('tbkl_directive_reports').insert(insert_row).execute()
    if not ins.data:
        raise RuntimeError('Không lưu được đánh giá KHCN')
    return ins.data[0]


def confirm_directive_report(
    supabase,
    ctx: UserContext,
    directive_id: str,
    payload: dict,
) -> dict:
    if not can_confirm_directive(ctx, supabase):
        raise PermissionError('Chỉ Viện trưởng, Thư ký hoặc Ban lãnh đạo mới xác nhận mục lớn')

    dres = supabase.table('tbkl_directives').select('*').eq('id', directive_id).limit(1).execute()
    if not dres.data:
        raise LookupError('Không tìm thấy mục kết luận lớn')
    directive = dres.data[0]

    cycle = get_cycle(supabase, directive['cycle_id'])
    if cycle and cycle.get('status') == 'locked':
        raise ValueError('Cuộc họp đã chốt — không xác nhận thêm')

    week_label = (payload.get('week_label') or '').strip() or _week_label()
    existing = supabase.table('tbkl_directive_reports').select('*').eq(
        'directive_id', directive_id
    ).eq('week_label', week_label).limit(1).execute()

    confirmed_pct = max(0, min(100, float(payload.get('confirmed_pct') or 0)))
    confirmed_status = (payload.get('confirmed_status') or 'in_progress').lower()
    confirmed_at = _now_iso()
    rag = compute_rag(
        progress_pct=confirmed_pct,
        status=confirmed_status,
        deadline=directive.get('deadline'),
        cycle_locked=False,
        has_report=True,
    )

    if existing.data:
        rep = existing.data[0]
        if rep.get('locked'):
            raise ValueError('Báo cáo tuần này đã khóa — không xác nhận thêm')
        patch = {
            'confirmed_pct': confirmed_pct,
            'confirmed_status': confirmed_status,
            'confirmed_by_username': ctx.username,
            'confirmed_at': confirmed_at,
            'rag': rag,
        }
        supabase.table('tbkl_directive_reports').update(patch).eq('id', rep['id']).execute()
        return {**rep, **patch}

    row = {
        'directive_id': directive_id,
        'week_label': week_label,
        'progress_pct': 0,
        'status': 'not_started',
        'confirmed_pct': confirmed_pct,
        'confirmed_status': confirmed_status,
        'confirmed_by_username': ctx.username,
        'confirmed_at': confirmed_at,
        'assessed_by_username': ctx.username,
        'assessed_at': confirmed_at,
        'rag': rag,
    }
    ins = supabase.table('tbkl_directive_reports').insert(row).execute()
    if not ins.data:
        raise RuntimeError('Không lưu được xác nhận VT')
    return ins.data[0]


def lock_cycle_reports(supabase, ctx: UserContext, cycle_id: str) -> dict:
    if not can_lock(ctx, supabase):
        raise PermissionError('Không có quyền chốt báo cáo')

    cycle = get_cycle(supabase, cycle_id)
    if not cycle:
        raise LookupError('Không tìm thấy cuộc họp')

    task_ids = _task_ids_for_cycle(supabase, cycle_id)
    if task_ids:
        supabase.table('tbkl_reports').update({'locked': True}).in_('task_id', task_ids).execute()

    dir_ids = _directive_ids_for_cycle(supabase, cycle_id)
    if dir_ids:
        supabase.table('tbkl_directive_reports').update({'locked': True}).in_(
            'directive_id', dir_ids
        ).execute()

    supabase.table('tbkl_cycles').update({
        'status': 'locked',
        'updated_at': _now_iso(),
    }).eq('id', cycle_id).execute()

    return {'locked': True, 'task_count': len(task_ids), 'directive_count': len(dir_ids)}


def unlock_cycle_reports(supabase, ctx: UserContext, cycle_id: str) -> dict:
    if not can_unlock_cycle(ctx, supabase):
        raise PermissionError('Chỉ quản trị hoặc Viện trưởng mới mở chốt cuộc họp')

    cycle = get_cycle(supabase, cycle_id)
    if not cycle:
        raise LookupError('Không tìm thấy cuộc họp')
    if cycle.get('status') != 'locked':
        raise ValueError('Cuộc họp chưa chốt — không cần mở')

    task_ids = _task_ids_for_cycle(supabase, cycle_id)
    if task_ids:
        supabase.table('tbkl_reports').update({'locked': False}).in_('task_id', task_ids).execute()

    dir_ids = _directive_ids_for_cycle(supabase, cycle_id)
    if dir_ids:
        try:
            supabase.table('tbkl_directive_reports').update({'locked': False}).in_(
                'directive_id', dir_ids
            ).execute()
        except Exception as exc:
            print(f'[tbkl] unlock directive_reports: {exc}')

    supabase.table('tbkl_cycles').update({
        'status': 'active',
        'updated_at': _now_iso(),
    }).eq('id', cycle_id).execute()

    return {'unlocked': True, 'task_count': len(task_ids), 'directive_count': len(dir_ids)}


def _directive_ids_for_cycle(supabase, cycle_id: str) -> list[str]:
    dirs = supabase.table('tbkl_directives').select('id').eq('cycle_id', cycle_id).execute()
    return [d['id'] for d in (dirs.data or [])]


def _task_ids_for_cycle(supabase, cycle_id: str) -> list[str]:
    dirs = supabase.table('tbkl_directives').select('id').eq('cycle_id', cycle_id).execute()
    dir_ids = [d['id'] for d in (dirs.data or [])]
    if not dir_ids:
        return []
    tasks = supabase.table('tbkl_tasks').select('id').in_('directive_id', dir_ids).execute()
    return [t['id'] for t in (tasks.data or [])]


def _latest_reports_map(supabase, task_ids: list[str]) -> dict[str, dict]:
    if not task_ids:
        return {}
    res = supabase.table('tbkl_reports').select('*').in_(
        'task_id', task_ids
    ).order('submitted_at', desc=True).execute()
    out: dict[str, dict] = {}
    for row in res.data or []:
        tid = row.get('task_id')
        if tid and tid not in out:
            out[tid] = row
    return out


def build_dashboard(supabase, ctx: UserContext, cycle_id: str, *, unit_only: bool = False) -> dict:
    cycle = get_cycle(supabase, cycle_id)
    if not cycle:
        raise LookupError('Không tìm thấy cuộc họp')

    dirs = supabase.table('tbkl_directives').select('*').eq(
        'cycle_id', cycle_id
    ).order('seq_no').execute()
    directives = _sort_directives(dirs.data or [])
    dir_ids = [d['id'] for d in directives]
    tasks: list[dict] = []
    if dir_ids:
        tres = supabase.table('tbkl_tasks').select('*').in_(
            'directive_id', dir_ids
        ).execute()
        tasks = _sort_tasks(directives, tres.data or [])

    task_ids = [t['id'] for t in tasks]
    reports = _latest_reports_map(supabase, task_ids)
    dir_reports = _latest_directive_reports_map(supabase, dir_ids)
    cycle_locked = cycle.get('status') == 'locked'
    unit_view = unit_only or is_unit_reporter_only(ctx, supabase)
    dept_name = user_department_name(ctx, supabase)

    dir_by_id = {d['id']: d for d in directives}
    rows: list[dict] = []
    summary = {'green': 0, 'yellow': 0, 'red': 0, 'gray': 0, 'total': 0}

    for task in tasks:
        directive = dir_by_id.get(task['directive_id']) or {}
        rep = reports.get(task['id'])
        progress = float(rep.get('progress_pct') or 0) if rep else 0
        status = rep.get('status') if rep else 'not_started'
        confirmed = bool(rep and rep.get('confirmed_at'))
        confirmed_pct = float(rep.get('confirmed_pct') or 0) if confirmed else None
        confirmed_status = rep.get('confirmed_status') if confirmed else None
        rag = _report_display_rag(rep, task, cycle_locked=cycle_locked)

        row = {
            'task_id': task['id'],
            'directive_id': task['directive_id'],
            'directive_seq_no': int(directive.get('seq_no') or 0),
            'task_seq_no': int(task.get('seq_no') or 0),
            'directive_code': directive.get('code'),
            'directive_title': directive.get('title'),
            'directive_content': directive.get('content'),
            'task_code': task.get('code'),
            'task_title': task.get('title'),
            'source_ref': cycle.get('source_ref'),
            'lead_department_name': directive.get('lead_department_name'),
            'owner_unit_name': task.get('owner_unit_name'),
            'coordinator_units': task.get('coordinator_units'),
            'assignee_name': task.get('assignee_name'),
            'deadline': task.get('deadline'),
            'deliverable': task.get('deliverable'),
            'priority': task.get('priority'),
            'priority_label': _priority_label(task.get('priority')),
            'progress_pct': progress,
            'status': status,
            'status_label': _status_label(status),
            'confirmed_pct': confirmed_pct,
            'confirmed_status': confirmed_status,
            'confirmed_status_label': _status_label(confirmed_status) if confirmed_status else None,
            'confirmed_at': rep.get('confirmed_at') if rep else None,
            'confirmed_by_username': rep.get('confirmed_by_username') if rep else None,
            'is_confirmed': confirmed,
            'difficulties': rep.get('difficulties') if rep else None,
            'solution': rep.get('solution') if rep else None,
            'recommendation': rep.get('recommendation') if rep else None,
            'rag': rag,
            'week_label': rep.get('week_label') if rep else _week_label(),
            'report_locked': bool(rep.get('locked')) if rep else False,
            'can_report': unit_can_edit_task(ctx, task, supabase),
            'can_confirm': can_confirm(ctx, supabase),
        }
        if unit_view and not row['can_report']:
            continue
        rows.append(row)

    directive_summaries = []
    visible_dir_ids = {r['directive_id'] for r in rows}
    for d in directives:
        if unit_view and d['id'] not in visible_dir_ids:
            continue
        child = [r for r in rows if r['directive_id'] == d['id']]
        rags = [r['rag'] for r in child] if child else ['gray']
        child_rag = 'red' if 'red' in rags else ('yellow' if 'yellow' in rags else ('green' if child and all(x == 'green' for x in rags) else 'gray'))
        rep = dir_reports.get(d['id'])
        progress = float(rep.get('progress_pct') or 0) if rep else 0
        status = rep.get('status') if rep else 'not_started'
        assessed = bool(rep and rep.get('assessed_at'))
        confirmed = bool(rep and rep.get('confirmed_at'))
        confirmed_pct = float(rep.get('confirmed_pct') or 0) if confirmed else None
        confirmed_status = rep.get('confirmed_status') if confirmed else None
        directive_rag = _directive_display_rag(rep, d, cycle_locked=cycle_locked)
        display_rag = directive_rag if rep else child_rag
        directive_summaries.append({
            **d,
            'priority_label': _priority_label(d.get('priority')),
            'rag': display_rag,
            'directive_rag': directive_rag,
            'child_rag': child_rag,
            'task_count': len(child),
            'progress_pct': progress,
            'status': status,
            'status_label': _status_label(status),
            'assessed_at': rep.get('assessed_at') if rep else None,
            'is_assessed': assessed,
            'confirmed_pct': confirmed_pct,
            'confirmed_status': confirmed_status,
            'confirmed_status_label': _status_label(confirmed_status) if confirmed_status else None,
            'confirmed_at': rep.get('confirmed_at') if rep else None,
            'is_confirmed': confirmed,
            'note': rep.get('note') if rep else None,
            'week_label': rep.get('week_label') if rep else _week_label(),
            'report_locked': bool(rep.get('locked')) if rep else False,
            'can_assess_directive': can_assess_directive(ctx, supabase),
            'can_confirm_directive': can_confirm_directive(ctx, supabase),
            'avg_progress': round(
                sum(r['progress_pct'] for r in child) / len(child), 1
            ) if child else 0,
            'avg_confirmed_pct': round(
                sum(r['confirmed_pct'] or 0 for r in child if r.get('is_confirmed')) /
                max(1, sum(1 for r in child if r.get('is_confirmed'))), 1
            ) if any(r.get('is_confirmed') for r in child) else None,
        })

    directive_summaries = _sort_directives(directive_summaries)

    summary = {'green': 0, 'yellow': 0, 'red': 0, 'gray': 0, 'total': 0}
    for r in rows:
        rag = r.get('rag') or 'gray'
        summary[rag] = summary.get(rag, 0) + 1
        summary['total'] += 1

    pending_report = sum(1 for r in rows if r.get('can_report') and not r.get('report_locked'))

    return {
        'cycle': enrich_cycle_files(cycle),
        'meeting_label': f"H{int(cycle.get('meeting_seq') or 0)} — {cycle.get('title') or 'Cuộc họp'}",
        'directives': directive_summaries,
        'rows': rows,
        'summary': summary,
        'week_label': _week_label(),
        'unit_view': unit_view,
        'department_name': dept_name,
        'pending_report_count': pending_report,
        'permissions': {
            'can_admin': can_admin(ctx, supabase),
            'can_planning': can_planning(ctx, supabase),
            'can_manage': can_manage(ctx, supabase),
            'can_operate': can_operate(ctx, supabase),
            'can_update_attachments': can_update_attachments(ctx, supabase),
            'can_confirm': can_confirm(ctx, supabase),
            'can_assess_directive': can_assess_directive(ctx, supabase),
            'can_confirm_directive': can_confirm_directive(ctx, supabase),
            'can_report': can_report(ctx, supabase),
            'can_lock': can_lock(ctx, supabase),
            'can_unlock': can_unlock_cycle(ctx, supabase),
            'is_planning_dept': is_planning_department(ctx, supabase),
            'is_unit_only': is_unit_reporter_only(ctx, supabase),
        },
    }


_SEEDS_DIR = Path(__file__).resolve().parent / 'seeds'


def list_seed_bundles() -> list[dict]:
    out: list[dict] = []
    if not _SEEDS_DIR.is_dir():
        return out
    for path in sorted(_SEEDS_DIR.glob('*.json')):
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            out.append({
                'id': data.get('id') or path.stem,
                'label': data.get('label') or path.stem,
                'meeting_seq': (data.get('cycle') or {}).get('meeting_seq'),
                'source_ref': (data.get('cycle') or {}).get('source_ref'),
            })
        except (json.JSONDecodeError, OSError):
            continue
    return out


def load_seed_bundle(seed_id: str) -> dict:
    safe_id = ''.join(c for c in seed_id if c.isalnum() or c in ('_', '-'))
    path = _SEEDS_DIR / f'{safe_id}.json'
    if not path.is_file():
        raise LookupError(f'Không tìm thấy gói dữ liệu mẫu: {seed_id}')
    return json.loads(path.read_text(encoding='utf-8'))


def import_seed_bundle(
    supabase,
    ctx: UserContext,
    seed_id: str,
    *,
    replace: bool = False,
) -> dict:
    if not can_admin(ctx, supabase):
        raise PermissionError('Chỉ quản trị TBKL mới nạp dữ liệu mẫu')

    bundle = load_seed_bundle(seed_id)
    cycle_payload = dict(bundle.get('cycle') or {})
    meeting_seq = cycle_payload.get('meeting_seq')
    if meeting_seq is not None:
        existing = supabase.table('tbkl_cycles').select('id, meeting_seq').eq(
            'meeting_seq', int(meeting_seq)
        ).limit(1).execute()
        if existing.data:
            if not replace:
                raise ValueError(
                    f'Cuộc họp H{meeting_seq} đã tồn tại — chọn "Ghi đè" hoặc xóa trước khi nạp lại'
                )
            cycle_id = existing.data[0]['id']
            supabase.table('tbkl_cycles').delete().eq('id', cycle_id).execute()

    cycle = create_cycle(supabase, ctx, cycle_payload)
    cycle_id = cycle['id']
    directive_count = 0
    task_count = 0

    for item in bundle.get('directives') or []:
        tasks = item.get('tasks') or []
        directive_payload = {k: v for k, v in item.items() if k != 'tasks'}
        directive = create_directive(supabase, ctx, cycle_id, directive_payload)
        directive_count += 1
        for task_payload in tasks:
            create_task(supabase, ctx, directive['id'], task_payload)
            task_count += 1

    dashboard = build_dashboard(supabase, ctx, cycle_id)
    return {
        'cycle_id': cycle_id,
        'meeting_seq': cycle.get('meeting_seq'),
        'directive_count': directive_count,
        'task_count': task_count,
        'dashboard': dashboard,
    }


def update_cycle_attachments(
    supabase,
    cycle_id: str,
    *,
    conclusion_pdf_path: Optional[str] = None,
    conclusion_pdf_name: Optional[str] = None,
    plan_workbook_path: Optional[str] = None,
    plan_workbook_name: Optional[str] = None,
) -> dict:
    patch: dict[str, Any] = {'updated_at': _now_iso()}
    if conclusion_pdf_path is not None:
        patch['conclusion_pdf_path'] = conclusion_pdf_path
    if conclusion_pdf_name is not None:
        patch['conclusion_pdf_name'] = conclusion_pdf_name
    if plan_workbook_path is not None:
        patch['plan_workbook_path'] = plan_workbook_path
    if plan_workbook_name is not None:
        patch['plan_workbook_name'] = plan_workbook_name
    supabase.table('tbkl_cycles').update(patch).eq('id', cycle_id).execute()
    cycle = get_cycle(supabase, cycle_id)
    if not cycle:
        raise LookupError('Không tìm thấy cuộc họp')
    return cycle


def conclusion_pdf_url(cycle: dict) -> Optional[str]:
    from modules.tbkl import storage_service as storage
    path = cycle.get('conclusion_pdf_path')
    if not path:
        return None
    return storage.create_signed_url(path)


def enrich_cycle_files(cycle: dict) -> dict:
    out = dict(cycle)
    out['has_conclusion_pdf'] = bool(cycle.get('conclusion_pdf_path'))
    out['has_plan_workbook'] = bool(cycle.get('plan_workbook_path'))
    url = conclusion_pdf_url(cycle)
    if url:
        out['conclusion_pdf_url'] = url
    return out
