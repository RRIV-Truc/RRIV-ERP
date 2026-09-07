# -*- coding: utf-8 -*-
"""RBAC app Giao viec TT SPM - chi user Trung tam moi vao."""
from __future__ import annotations

import os

from modules.meetings.rbac import UserContext, load_user_context

APP_ID = "spmgv"

DIRECTOR_ENV = "SPM_GV_DIRECTOR_USERNAMES"
DEPT_ENV = "SPM_GV_DEPT_IDS"


def director_usernames() -> set[str]:
    raw = os.getenv(DIRECTOR_ENV, "rriv.nttruc").strip()
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def deputy_usernames() -> set[str]:
    raw = os.getenv("SPM_GV_DEPUTY_USERNAMES", "rriv.nhtruong").strip()
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


INTERNAL_DEPTS = {"pgd", "nv", "nc", "pkn", "ktc", "tckt", "lx"}

# PGD also heads Testing/Calibration department (pkn)
EXTRA_DEPTS_BY_USER = {
    "rriv.nhtruong": {"pkn"},
}


def spm_dept_ids() -> set[str]:
    raw = os.getenv(DEPT_ENV, "dl-2").strip()
    return {x.strip() for x in raw.split(",") if x.strip()}


def _staff_row(supabase, username: str) -> dict | None:
    try:
        res = (
            supabase.table("spm_gv_staff")
            .select("*")
            .eq("username", username)
            .eq("active", True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        return None


def staff_of(ctx: UserContext, supabase=None) -> dict | None:
    if not ctx or not supabase:
        return None
    return _staff_row(supabase, ctx.username)


def is_director(ctx: UserContext, supabase=None) -> bool:
    if ctx.username in director_usernames():
        return True
    row = staff_of(ctx, supabase)
    return bool(row and row.get("role") == "director")


def is_deputy(ctx: UserContext, supabase=None) -> bool:
    if ctx and ctx.username in deputy_usernames():
        return True
    row = staff_of(ctx, supabase)
    return bool(row and row.get("role") == "deputy")


def is_head(ctx: UserContext, supabase=None) -> bool:
    row = staff_of(ctx, supabase)
    return bool(row and row.get("role") == "head")


def extra_departments(username: str | None) -> set[str]:
    u = str(username or "").strip().lower()
    ids = set(EXTRA_DEPTS_BY_USER.get(u) or set())
    raw = os.getenv("SPM_GV_EXTRA_DEPTS", "").strip()
    if raw:
        for part in raw.split(","):
            if ":" not in part:
                continue
            name, depts = part.split(":", 1)
            if name.strip().lower() == u:
                ids |= {d.strip() for d in depts.split("|") if d.strip() in INTERNAL_DEPTS}
    return {d for d in ids if d in INTERNAL_DEPTS}


def staff_department_ids(ctx: UserContext, supabase=None) -> set[str]:
    ids: set[str] = set()
    row = staff_of(ctx, supabase) or {}
    did = str(row.get("department_id") or "").strip()
    if did in INTERNAL_DEPTS:
        ids.add(did)
    if is_deputy(ctx, supabase):
        ids.add("pgd")
    if ctx:
        ids |= extra_departments(ctx.username)
    return ids


def staff_department_id(ctx: UserContext, supabase=None) -> str:
    ids = staff_department_ids(ctx, supabase)
    if "pgd" in ids:
        return "pgd"
    return next(iter(sorted(ids)), "")


def owns_department(ctx: UserContext, supabase, department_id: str | None) -> bool:
    did = str(department_id or "").strip()
    if not did:
        return False
    return did in staff_department_ids(ctx, supabase)


def can_enter(ctx: UserContext, supabase=None) -> bool:
    """Chi thanh vien Trung tam (hoac admin he thong de cai dat lan dau)."""
    if not ctx:
        return False
    if ctx.is_global_admin:
        return True
    if ctx.username in director_usernames():
        return True
    if str(ctx.department_id or "") in spm_dept_ids():
        return True
    return staff_of(ctx, supabase) is not None


def can_assign_center(ctx: UserContext, supabase=None) -> bool:
    return is_director(ctx, supabase) or ctx.is_global_admin


def can_assign_dept(ctx: UserContext, supabase=None, department_id: str | None = None) -> bool:
    if can_assign_center(ctx, supabase):
        return True
    mine = staff_department_ids(ctx, supabase)
    if not (is_deputy(ctx, supabase) or is_head(ctx, supabase)):
        return False
    if not department_id:
        return bool(mine)
    return str(department_id) in mine


def can_report_task(ctx: UserContext, supabase, task: dict) -> bool:
    """Nguoi phu trach bo phan (cap 1) hoac nguoi duoc giao (cap 2) duoc bao cao."""
    if can_assign_center(ctx, supabase):
        return True
    dept = str(task.get("department_id") or "")
    if owns_department(ctx, supabase, dept) and (is_deputy(ctx, supabase) or is_head(ctx, supabase)):
        return True
    uname = ctx.username
    for a in task.get("assignees") or []:
        if str(a.get("username") or "").lower() == uname:
            return True
    return False


def can_score_work(ctx: UserContext, supabase, task: dict) -> bool:
    if task.get("level") == "center":
        return can_assign_center(ctx, supabase)
    return can_assign_dept(ctx, supabase, task.get("department_id"))


def can_see_leader_notes_center(ctx: UserContext, supabase=None) -> bool:
    return is_director(ctx, supabase) or ctx.is_global_admin


def can_see_leader_notes_dept(ctx: UserContext, supabase, department_id: str) -> bool:
    if can_see_leader_notes_center(ctx, supabase):
        return True
    if (is_head(ctx, supabase) or is_deputy(ctx, supabase)) and owns_department(ctx, supabase, department_id):
        return True
    return False


def can_write_leader_notes_center(ctx: UserContext, supabase=None) -> bool:
    return is_director(ctx, supabase)


def can_write_leader_notes_dept(ctx: UserContext, supabase, department_id: str) -> bool:
    if is_director(ctx, supabase):
        return True
    return (is_head(ctx, supabase) or is_deputy(ctx, supabase)) and owns_department(ctx, supabase, department_id)


def role_label(role: str) -> str:
    return {
        "director": "Giam doc",
        "deputy": "Pho giam doc",
        "head": "Truong bo phan",
        "staff": "Nhan vien",
    }.get(role or "staff", role)
