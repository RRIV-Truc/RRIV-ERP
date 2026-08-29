"""Kiểm tra quyền backup database."""
from __future__ import annotations

import os

from modules.meetings.rbac import UserContext


def _backup_admin_usernames() -> set[str]:
    raw = os.getenv('BACKUP_ADMIN_USERNAMES', 'rriv.nttruc,rriv.admin').strip()
    return {x.strip().lower() for x in raw.split(',') if x.strip()}


def can_database_backup(ctx: UserContext | None) -> bool:
    if not ctx:
        return False
    if ctx.is_global_admin:
        return True
    uname = str(ctx.username or '').strip().lower()
    return uname in _backup_admin_usernames()
