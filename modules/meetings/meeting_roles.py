"""Vai trò phiên họp — chủ trì / thư ký / người tạo."""
from __future__ import annotations

from modules.meetings.rbac import UserContext, can_create_meeting

MODERATOR_ROLES = frozenset({'host', 'secretary', 'organizer'})
SHARE_APPROVER_ROLES = frozenset({'host', 'secretary'})


ROLE_RANK = {
    'host': 50,
    'secretary': 40,
    'organizer': 30,
    'participant': 10,
    'observer': 5,
}


def lookup_participant_role(supabase, meeting_id: str, ctx: UserContext) -> str:
    uname = (ctx.username or '').strip().lower()
    emp_id = str(ctx.employee_id) if ctx.employee_id else None
    best = 'participant'
    best_rank = ROLE_RANK.get(best, 0)
    try:
        res = supabase.table('meeting_participants').select(
            'participant_role, username, employee_id'
        ).eq('meeting_id', meeting_id).execute()
    except Exception:
        return 'participant'
    for p in res.data or []:
        matched = False
        if emp_id and str(p.get('employee_id') or '') == emp_id:
            matched = True
        elif uname and (p.get('username') or '').strip().lower() == uname:
            matched = True
        if not matched:
            continue
        role = (p.get('participant_role') or 'participant').lower()
        rank = ROLE_RANK.get(role, 0)
        if rank >= best_rank:
            best = role
            best_rank = rank
    return best


def resolve_session_roles(supabase, meeting_id: str, ctx: UserContext) -> dict:
    role = lookup_participant_role(supabase, meeting_id, ctx)
    sys_mgr = can_create_meeting(ctx, supabase)
    is_host = role == 'host'
    is_secretary = role == 'secretary'
    is_organizer = role == 'organizer'
    can_moderate = role in MODERATOR_ROLES or sys_mgr
    can_approve_share = role in SHARE_APPROVER_ROLES
    return {
        'participant_role': role,
        'is_host': is_host,
        'is_secretary': is_secretary,
        'is_organizer': is_organizer,
        'can_moderate': can_moderate,
        'can_approve_share': can_approve_share,
    }
