# -*- coding: utf-8 -*-
"""Business logic - giao viec 2 cap TT SPM."""
from __future__ import annotations

import unicodedata
from datetime import date, datetime, timedelta

from modules.meetings.rbac import UserContext
from modules.spm_gv import rbac

STATUS_LABEL = {
    "not_started": "Chưa bắt đầu",
    "in_progress": "Đang thực hiện",
    "at_risk": "Rủi ro",
    "completed": "Hoàn thành",
    "blocked": "Bị vướng",
}

HIEN_USERNAME = "rriv.ntdhien"
DEPUTY_USERNAME = "rriv.nhtruong"
KTC_TEAM_ID = "team-spm-ktc"
SPM_DEPT = "dl-2"
INTERNAL_DEPTS = {"pgd", "nv", "nc", "pkn", "ktc", "tckt", "lx"}


def iso_week_bounds(d: date | None = None):
    d = d or date.today()
    y, w, _ = d.isocalendar()
    start = date.fromisocalendar(y, w, 1)
    end = start + timedelta(days=6)
    return y, w, start, end


def week_label(year: int, week_no: int, start: date, end: date) -> str:
    return "Tuần %02d/%s (%s-%s)" % (
        week_no, year, start.strftime("%d/%m"), end.strftime("%d/%m"),
    )


def compute_rag(status: str, pct: int) -> str:
    if status == "completed" or pct >= 100:
        return "green"
    if status in ("blocked", "at_risk"):
        return "red"
    if status == "not_started":
        return "gray"
    if pct < 40:
        return "yellow"
    return "green"


def _now_iso():
    return datetime.utcnow().isoformat() + "Z"


def _fold(s: str) -> str:
    text = unicodedata.normalize("NFD", str(s or ""))
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text.lower().replace("\u0111", "d").replace("\u0110", "d")


def _is_hien(emp: dict) -> bool:
    u = str(emp.get("username") or "").strip().lower()
    if u == HIEN_USERNAME:
        return True
    return "dieu hien" in _fold(emp.get("full_name") or "")


def infer_role_dept(emp: dict) -> tuple[str, str | None]:
    """Map chuc danh ERP -> vai tro + bo phan noi bo SPM."""
    if _is_hien(emp):
        return "head", "ktc"
    username = str(emp.get("username") or "").strip().lower()
    pos = _fold(emp.get("position_name") or "")
    team = str(emp.get("team_id") or "")
    if username == DEPUTY_USERNAME:
        return "deputy", "pgd"
    if username in rbac.director_usernames() or ("giam doc" in pos and "pho" not in pos):
        return "director", None
    if "pho giam doc" in pos or "pho gd" in pos or pos.startswith("pho "):
        return "deputy", "pgd"
    if "kiem tra cheo" in pos or team == KTC_TEAM_ID:
        return "head", "ktc"
    if "nghiep vu" in pos:
        return "head", "nv"
    if "nc&cg" in pos or "nc cg" in pos or "pt bp nc" in pos:
        return "head", "nc"
    if "lai xe" in pos:
        return "staff", "lx"
    if "ke toan" in pos or "tai chinh" in pos:
        role = "head" if ("phu trach" in pos or "truong" in pos) else "staff"
        return role, "tckt"
    if "kiem nghiem" in pos or "hieu chuan" in pos or "cao dang ky thuat" in pos:
        return "staff", "pkn"
    if "nghien cuu" in pos:
        return "staff", "nc"
    if "phu trach" in pos or pos.startswith("pt "):
        return "head", None
    return "staff", None


def list_departments(sb) -> list[dict]:
    res = sb.table("spm_gv_departments").select("*").order("sort_order").execute()
    return res.data or []


def list_staff(sb) -> list[dict]:
    res = sb.table("spm_gv_staff").select("*").eq("active", True).order("full_name").execute()
    return res.data or []


def list_spm_employees(sb) -> list[dict]:
    try:
        res = (
            sb.table("employee")
            .select("id, username, full_name, position_name, position_id, department_id, team_id, employment_status")
            .eq("department_id", SPM_DEPT)
            .execute()
        )
    except Exception:
        return []
    rows = []
    for row in res.data or []:
        st = str(row.get("employment_status") or "active").lower()
        if st in ("inactive", "resigned", "terminated"):
            continue
        if not row.get("username"):
            continue
        rows.append(row)
    return rows


def ensure_hien_ktc(sb) -> None:
    """Assign Hien to Kiem tra cheo team."""
    try:
        sb.table("category_teams").upsert({
            "id": KTC_TEAM_ID,
            "name": "Kiểm tra chéo",
            "department": SPM_DEPT,
            "metadata": {"source": "spm-gv"},
        }).execute()
    except Exception:
        pass
    try:
        sb.table("employee").update({
            "team_id": KTC_TEAM_ID,
            "position_name": "Phụ trách kiểm tra chéo",
            "position_id": "pos-phu-trach",
        }).eq("username", HIEN_USERNAME).execute()
    except Exception:
        pass


def sync_staff_from_employee(sb) -> list[dict]:
    """Lay nhan su SPM tu bang employee, khong nhap lai thu cong."""
    ensure_hien_ktc(sb)
    emps = list_spm_employees(sb)
    existing = {str(s.get("username") or "").lower(): s for s in list_staff(sb)}
    seen = set()
    for emp in emps:
        username = str(emp.get("username") or "").strip().lower()
        if not username:
            continue
        seen.add(username)
        role, dept = infer_role_dept(emp)
        name = emp.get("full_name") or username
        doc = {
            "username": username,
            "full_name": name,
            "department_id": dept,
            "role": role,
            "active": True,
        }
        cur = existing.get(username)
        if cur:
            sid = cur["id"]
            fields = {"full_name": name, "active": True, "role": role}
            if dept:
                fields["department_id"] = dept
            elif cur.get("department_id"):
                fields["department_id"] = cur.get("department_id")
            sb.table("spm_gv_staff").update(fields).eq("id", sid).execute()
        else:
            sb.table("spm_gv_staff").insert(doc).execute()
    return list_staff(sb)


def bootstrap_director(sb, ctx: UserContext) -> dict | None:
    sync_staff_from_employee(sb)
    rows = list_staff(sb)
    if rows:
        return rbac.staff_of(ctx, sb)
    if not (ctx.is_global_admin or ctx.username in rbac.director_usernames()):
        return None
    name = ctx.username
    try:
        emp = (
            sb.table("employee")
            .select("full_name, ho_ten, name, username")
            .eq("username", ctx.username)
            .limit(1)
            .execute()
        )
        if emp.data:
            row = emp.data[0]
            name = row.get("full_name") or row.get("ho_ten") or row.get("name") or name
    except Exception:
        pass
    doc = {
        "username": ctx.username,
        "full_name": name,
        "department_id": None,
        "role": "director",
        "active": True,
    }
    ins = sb.table("spm_gv_staff").insert(doc).execute()
    return (ins.data or [doc])[0]


def upsert_staff(sb, payload: dict) -> dict:
    username = str(payload.get("username") or "").strip().lower()
    if not username:
        raise ValueError("Thieu tai khoan")
    doc = {
        "username": username,
        "full_name": str(payload.get("full_name") or username).strip(),
        "department_id": payload.get("department_id") or None,
        "role": payload.get("role") or "staff",
        "active": payload.get("active", True),
    }
    existing = (
        sb.table("spm_gv_staff").select("id").eq("username", username).limit(1).execute()
    )
    if existing.data:
        sid = existing.data[0]["id"]
        sb.table("spm_gv_staff").update(doc).eq("id", sid).execute()
        doc["id"] = sid
        return doc
    ins = sb.table("spm_gv_staff").insert(doc).execute()
    return (ins.data or [doc])[0]


def list_weeks(sb) -> list[dict]:
    res = sb.table("spm_gv_weeks").select("*").order("start_date", desc=True).execute()
    return res.data or []


def ensure_current_week(sb, ctx: UserContext) -> dict:
    y, w, start, end = iso_week_bounds()
    found = (
        sb.table("spm_gv_weeks")
        .select("*")
        .eq("year", y)
        .eq("week_no", w)
        .limit(1)
        .execute()
    )
    if found.data:
        return found.data[0]
    doc = {
        "year": y,
        "week_no": w,
        "label": week_label(y, w, start, end),
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "status": "active",
        "created_by": ctx.username,
    }
    ins = sb.table("spm_gv_weeks").insert(doc).execute()
    return (ins.data or [doc])[0]


def create_week(sb, ctx: UserContext, payload: dict) -> dict:
    y = int(payload.get("year") or date.today().isocalendar()[0])
    w = int(payload.get("week_no") or date.today().isocalendar()[1])
    found = (
        sb.table("spm_gv_weeks")
        .select("*")
        .eq("year", y)
        .eq("week_no", w)
        .limit(1)
        .execute()
    )
    if found.data:
        return found.data[0]
    return ensure_current_week(sb, ctx)


def _assignees_of(sb, task_ids: list[str]) -> dict[str, list]:
    if not task_ids:
        return {}
    res = sb.table("spm_gv_assignees").select("*").in_("task_id", task_ids).execute()
    out: dict[str, list] = {}
    for row in res.data or []:
        out.setdefault(row["task_id"], []).append(row)
    return out


def _latest_reports(sb, task_ids: list[str]) -> dict[str, dict]:
    if not task_ids:
        return {}
    res = (
        sb.table("spm_gv_reports")
        .select("*")
        .in_("task_id", task_ids)
        .order("reported_at", desc=True)
        .execute()
    )
    out = {}
    for row in res.data or []:
        tid = row["task_id"]
        if tid not in out:
            out[tid] = row
    return out


def _leader_notes_map(sb, week_id: str, scope: str, department_id: str | None = None) -> dict[str, dict]:
    q = sb.table("spm_gv_leader_notes").select("*").eq("week_id", week_id).eq("scope", scope)
    if department_id:
        q = q.eq("department_id", department_id)
    res = q.execute()
    by_user = {row["username"]: row for row in (res.data or [])}
    by_dept = {}
    for row in res.data or []:
        did = row.get("department_id")
        if did:
            by_dept[did] = row
    return {"by_user": by_user, "by_dept": by_dept, "rows": res.data or []}


def dept_heads(staff: list[dict]) -> dict[str, dict]:
    out = {}
    for s in staff:
        did = s.get("department_id")
        if not did:
            continue
        role = s.get("role")
        if role in ("head", "deputy") and did not in out:
            out[did] = s
        elif role in ("head", "deputy"):
            if out[did].get("role") != "head" and role == "head":
                out[did] = s
    return out


def _enrich_task(task: dict, assignees: list, report: dict | None, leader_note: dict | None, include_leader: bool):
    lead = next((a for a in assignees if a.get("kind") == "lead"), None)
    doers = [a for a in assignees if a.get("kind") == "doer"]
    pct = int(task.get("progress_pct") or 0)
    status = task.get("status") or "not_started"
    out = dict(task)
    out["assignees"] = assignees
    out["lead"] = lead
    out["doers"] = doers
    out["doer_text"] = task.get("doer_text") or ""
    out["latest_report"] = report
    if report:
        out["completed_text"] = report.get("completed_text") or report.get("note") or ""
        out["incomplete_text"] = report.get("incomplete_text") or ""
        out["reason_text"] = report.get("reason_text") or report.get("difficulties") or ""
    else:
        out["completed_text"] = ""
        out["incomplete_text"] = ""
        out["reason_text"] = ""
    out["rag"] = compute_rag(status, pct)
    out["status_label"] = STATUS_LABEL.get(status, status)
    if include_leader:
        out["leader_note"] = leader_note
    else:
        out.pop("leader_note", None)
    return out


def _week_tasks(sb, week_id: str, level: str) -> list[dict]:
    res = (
        sb.table("spm_gv_tasks")
        .select("*")
        .eq("week_id", week_id)
        .eq("level", level)
        .order("created_at")
        .execute()
    )
    return res.data or []


def _rollup_parent(sb, parent_id: str | None) -> None:
    if not parent_id:
        return
    kids = (
        sb.table("spm_gv_tasks")
        .select("progress_pct,status")
        .eq("parent_id", parent_id)
        .execute()
        .data
        or []
    )
    if not kids:
        return
    n = len(kids)
    avg = int(round(sum(int(k.get("progress_pct") or 0) for k in kids) / n))
    status = _auto_status(avg, "")
    if any((k.get("status") or "") in ("blocked", "at_risk") for k in kids) and avg < 100:
        status = "at_risk"
    sb.table("spm_gv_tasks").update({
        "progress_pct": avg,
        "status": status,
        "updated_at": _now_iso(),
    }).eq("id", parent_id).execute()


def board(sb, ctx: UserContext, week_id: str, level: str) -> dict:
    center_raw = _week_tasks(sb, week_id, "center")
    dept_raw = _week_tasks(sb, week_id, "dept")
    staff = list_staff(sb)
    heads = dept_heads(staff)
    dept_id = rbac.staff_department_id(ctx, sb)
    is_dir = rbac.is_director(ctx, sb) or ctx.is_global_admin
    is_head = rbac.is_head(ctx, sb)
    is_deputy = rbac.is_deputy(ctx, sb)

    def visible_dept(did: str | None) -> bool:
        if is_dir:
            return True
        mine = dept_id if dept_id in INTERNAL_DEPTS else ""
        if is_deputy:
            return str(did or "") in {mine, "pgd"} or not did
        return bool(mine) and str(did or "") == mine

    if not is_dir:
        center_raw = [t for t in center_raw if visible_dept(t.get("department_id"))]
        dept_raw = [t for t in dept_raw if visible_dept(t.get("department_id"))]

    all_ids = [t["id"] for t in center_raw] + [t["id"] for t in dept_raw]
    amap = _assignees_of(sb, all_ids)
    rmap = _latest_reports(sb, all_ids)
    show_center_notes = rbac.can_see_leader_notes_center(ctx, sb)
    notes_center = _leader_notes_map(sb, week_id, "center") if show_center_notes else {
        "by_user": {}, "by_dept": {}, "rows": []
    }

    def pack(t: dict) -> dict:
        include_leader = False
        note = None
        if t.get("level") == "center" and show_center_notes:
            note = notes_center["by_dept"].get(t.get("department_id"))
            if not note:
                head = heads.get(t.get("department_id") or "")
                if head:
                    note = notes_center["by_user"].get(head.get("username"))
            include_leader = True
        elif t.get("level") == "dept":
            d = t.get("department_id")
            if rbac.can_see_leader_notes_dept(ctx, sb, d):
                nmap = _leader_notes_map(sb, week_id, "dept", d)
                lead = next((a for a in amap.get(t["id"], []) if a.get("kind") == "lead"), None)
                key = (lead or {}).get("username")
                note = nmap["by_user"].get(key) if key else None
                include_leader = True
        out = _enrich_task(t, amap.get(t["id"], []), rmap.get(t["id"]), note, include_leader)
        out["can_report"] = rbac.can_report_task(ctx, sb, {**t, "assignees": amap.get(t["id"], [])})
        out["can_cascade"] = rbac.can_assign_dept(ctx, sb, t.get("department_id"))
        out["can_edit"] = rbac.can_score_work(ctx, sb, t)
        return out

    kids_by_parent: dict[str, list] = {}
    for d in dept_raw:
        pid = d.get("parent_id")
        if pid:
            kids_by_parent.setdefault(pid, []).append(d)

    center_packed = []
    for t in center_raw:
        item = pack(t)
        kids = [pack(k) for k in kids_by_parent.get(t["id"], [])]
        item["children"] = kids
        item["child_count"] = len(kids)
        names = []
        for k in kids:
            if k.get("lead"):
                names.append(k["lead"].get("full_name") or k["lead"].get("username"))
            if k.get("doer_text"):
                names.append(k["doer_text"])
        item["child_assignees"] = ", ".join([n for n in names if n])
        center_packed.append(item)

    if level == "center":
        out_tasks = center_packed
        people_notes = notes_center["rows"] if show_center_notes else []
        groups = [{"parent": t, "children": t.get("children") or []} for t in center_packed]
    else:
        groups = [{"parent": t, "children": t.get("children") or []} for t in center_packed]
        orphans = [pack(d) for d in dept_raw if not d.get("parent_id")]
        out_tasks = []
        for g in groups:
            out_tasks.extend(g["children"])
        out_tasks.extend(orphans)
        people_notes = []
        if is_dir or is_head:
            scope_dept = None if is_dir else dept_id
            people_notes = _leader_notes_map(sb, week_id, "dept", scope_dept)["rows"]

    n = len(out_tasks) if level == "dept" else len(center_packed)
    src = center_packed if level == "center" else out_tasks
    avg = int(round(sum(int(t.get("progress_pct") or 0) for t in src) / n)) if n else 0
    rag_count = {"green": 0, "yellow": 0, "red": 0, "gray": 0}
    for t in src:
        rag_count[t["rag"]] = rag_count.get(t["rag"], 0) + 1

    return {
        "tasks": out_tasks,
        "groups": groups,
        "orphan_children": [pack(d) for d in dept_raw if not d.get("parent_id")] if level == "dept" else [],
        "center_inbox": center_packed,
        "summary": {"count": n, "avg_pct": avg, "rag": rag_count},
        "leader_notes": people_notes,
        "can_see_leader": (
            (level == "center" and show_center_notes)
            or (level == "dept" and (is_dir or is_head))
        ),
    }


def create_task(sb, ctx: UserContext, payload: dict) -> dict:
    level = payload.get("level") or "center"
    dept = payload.get("department_id")
    parent_id = payload.get("parent_id") or None
    parent = None
    if parent_id:
        found = sb.table("spm_gv_tasks").select("*").eq("id", parent_id).limit(1).execute()
        if not found.data:
            raise ValueError("Khong tim thay dau viec Giam doc da giao")
        parent = found.data[0]
        if parent.get("level") != "center":
            raise ValueError("Chi phan cong tiep tu dau viec cap Trung tam")
        dept = parent.get("department_id")
        payload["week_id"] = parent.get("week_id") or payload.get("week_id")
    if level == "center" and not rbac.can_assign_center(ctx, sb):
        raise PermissionError("Chi Giam doc giao viec cap Trung tam")
    if level == "dept" and not rbac.can_assign_dept(ctx, sb, dept):
        raise PermissionError("Khong co quyen giao viec cap bo phan nay")
    title = str(payload.get("title") or "").strip()
    if not title and parent:
        title = str(parent.get("title") or "").strip()
    if not title:
        raise ValueError("Thieu ten dau viec")
    if not dept:
        raise ValueError("Chon bo phan chiu trach nhiem")
    if level == "dept":
        if not parent_id:
            raise ValueError("Chon dau viec Giam doc da giao de phan cong tiep")
        lead = payload.get("lead") or {}
        if not lead.get("username"):
            raise ValueError("Chon nguoi chiu trach nhiem chinh")
    deadline = payload.get("deadline") or None
    if not deadline and parent:
        deadline = parent.get("deadline")
    doc = {
        "week_id": payload["week_id"],
        "level": level,
        "department_id": dept,
        "parent_id": parent_id if level == "dept" else None,
        "title": title,
        "description": payload.get("description") or (parent.get("description") if parent else "") or "",
        "doer_text": str(payload.get("doer_text") or "").strip(),
        "deadline": deadline,
        "status": payload.get("status") or "not_started",
        "progress_pct": int(payload.get("progress_pct") or 0),
        "created_by": ctx.username,
        "updated_at": _now_iso(),
    }
    try:
        ins = sb.table("spm_gv_tasks").insert(doc).execute()
    except Exception:
        doc.pop("parent_id", None)
        ins = sb.table("spm_gv_tasks").insert(doc).execute()
    task = (ins.data or [doc])[0]
    _save_assignees(sb, task["id"], payload, level)
    if parent_id:
        _rollup_parent(sb, parent_id)
    return task


def update_task(sb, ctx: UserContext, task_id: str, payload: dict) -> dict:
    cur = sb.table("spm_gv_tasks").select("*").eq("id", task_id).limit(1).execute()
    if not cur.data:
        raise ValueError("Khong tim thay dau viec")
    task = cur.data[0]
    if task.get("level") == "center" and not rbac.can_assign_center(ctx, sb):
        raise PermissionError("Khong co quyen sua viec cap Trung tam")
    if task.get("level") == "dept" and not rbac.can_assign_dept(ctx, sb, task.get("department_id")):
        raise PermissionError("Khong co quyen sua viec cap bo phan")
    fields = {}
    for k in ("title", "description", "deadline", "department_id", "status", "doer_text", "parent_id"):
        if k in payload:
            fields[k] = payload[k] or None
    if "progress_pct" in payload:
        fields["progress_pct"] = int(payload["progress_pct"])
    fields["updated_at"] = _now_iso()
    sb.table("spm_gv_tasks").update(fields).eq("id", task_id).execute()
    if "lead" in payload or "doers" in payload or "assignees" in payload or "doer_text" in payload:
        sb.table("spm_gv_assignees").delete().eq("task_id", task_id).execute()
        _save_assignees(sb, task_id, payload, task.get("level"))
    new_parent = fields.get("parent_id", task.get("parent_id"))
    _rollup_parent(sb, task.get("parent_id"))
    if new_parent and new_parent != task.get("parent_id"):
        _rollup_parent(sb, new_parent)
    return {**task, **fields}


def delete_task(sb, ctx: UserContext, task_id: str) -> None:
    cur = sb.table("spm_gv_tasks").select("*").eq("id", task_id).limit(1).execute()
    if not cur.data:
        raise ValueError("Khong tim thay dau viec")
    task = cur.data[0]
    if task.get("level") == "center" and not rbac.can_assign_center(ctx, sb):
        raise PermissionError("Khong co quyen xoa viec cap Trung tam")
    if task.get("level") == "dept" and not rbac.can_assign_dept(ctx, sb, task.get("department_id")):
        raise PermissionError("Khong co quyen xoa viec cap bo phan")
    parent_id = task.get("parent_id")
    if task.get("level") == "center":
        kids = sb.table("spm_gv_tasks").select("id").eq("parent_id", task_id).execute().data or []
        for kid in kids:
            sb.table("spm_gv_tasks").delete().eq("id", kid["id"]).execute()
    sb.table("spm_gv_tasks").delete().eq("id", task_id).execute()
    _rollup_parent(sb, parent_id)


def _save_assignees(sb, task_id: str, payload: dict, level: str | None = None) -> None:
    rows = []
    # Cap 1: chi giao bo phan, khong gan ten ca nhan lam chiu trach nhiem
    if level != "center":
        lead = payload.get("lead") or {}
        if lead.get("username"):
            rows.append({
                "task_id": task_id,
                "username": str(lead["username"]).strip().lower(),
                "full_name": lead.get("full_name") or lead.get("username"),
                "kind": "lead",
            })
    for d in payload.get("doers") or []:
        uname = str(d.get("username") or "").strip().lower()
        fname = str(d.get("full_name") or d.get("name") or "").strip()
        if not uname and not fname:
            continue
        rows.append({
            "task_id": task_id,
            "username": uname or ("name:" + _fold(fname).replace(" ", "-")[:40]),
            "full_name": fname or uname,
            "kind": "doer",
        })
    if rows:
        sb.table("spm_gv_assignees").insert(rows).execute()


def _auto_status(pct: int, incomplete: str) -> str:
    if pct >= 100:
        return "completed"
    if pct <= 0 and not incomplete:
        return "not_started"
    if pct < 40:
        return "at_risk"
    return "in_progress"


def submit_report(sb, ctx: UserContext, task_id: str, payload: dict) -> dict:
    cur = sb.table("spm_gv_tasks").select("*").eq("id", task_id).limit(1).execute()
    if not cur.data:
        raise ValueError("Khong tim thay dau viec")
    task = cur.data[0]
    assignees = (
        sb.table("spm_gv_assignees").select("*").eq("task_id", task_id).execute().data or []
    )
    task["assignees"] = assignees
    if not rbac.can_report_task(ctx, sb, task):
        raise PermissionError("Khong co quyen bao cao dau viec nay")
    pct = int(payload.get("progress_pct") or 0)
    pct = max(0, min(100, pct))
    completed = str(payload.get("completed_text") or payload.get("note") or "").strip()
    incomplete = str(payload.get("incomplete_text") or "").strip()
    reason = str(payload.get("reason_text") or payload.get("difficulties") or "").strip()
    status = payload.get("status") or _auto_status(pct, incomplete)
    rep = {
        "task_id": task_id,
        "progress_pct": pct,
        "status": status,
        "note": completed,
        "difficulties": reason,
        "solution": payload.get("solution") or "",
        "completed_text": completed,
        "incomplete_text": incomplete,
        "reason_text": reason,
        "reported_by": ctx.username,
    }
    ins = sb.table("spm_gv_reports").insert(rep).execute()
    sb.table("spm_gv_tasks").update({
        "progress_pct": pct,
        "status": status,
        "updated_at": _now_iso(),
    }).eq("id", task_id).execute()
    _rollup_parent(sb, task.get("parent_id"))
    return (ins.data or [rep])[0]


def score_work(sb, ctx: UserContext, task_id: str, payload: dict) -> dict:
    cur = sb.table("spm_gv_tasks").select("*").eq("id", task_id).limit(1).execute()
    if not cur.data:
        raise ValueError("Khong tim thay dau viec")
    task = cur.data[0]
    if not rbac.can_score_work(ctx, sb, task):
        raise PermissionError("Khong co quyen cham diem dau viec")
    fields = {
        "work_score": int(payload["work_score"]) if payload.get("work_score") is not None else None,
        "work_comment": payload.get("work_comment") or "",
        "work_scored_by": ctx.username,
        "work_scored_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    sb.table("spm_gv_tasks").update(fields).eq("id", task_id).execute()
    return {**task, **fields}


def upsert_leader_note(sb, ctx: UserContext, payload: dict) -> dict:
    scope = payload.get("scope") or "center"
    dept = payload.get("department_id")
    if scope == "center" and not rbac.can_write_leader_notes_center(ctx, sb):
        raise PermissionError("Chi Giam doc ghi nhan cap Trung tam")
    if scope == "dept" and not rbac.can_write_leader_notes_dept(ctx, sb, dept):
        raise PermissionError("Khong co quyen ghi nhan cap bo phan")
    username = str(payload.get("username") or "").strip().lower()
    if not username:
        raise ValueError("Thieu nguoi duoc ghi nhan")
    doc = {
        "week_id": payload["week_id"],
        "scope": scope,
        "department_id": dept,
        "username": username,
        "full_name": payload.get("full_name") or username,
        "support_score": payload.get("support_score"),
        "initiative_score": payload.get("initiative_score"),
        "note": payload.get("note") or "",
        "scored_by": ctx.username,
        "scored_at": _now_iso(),
    }
    existing = (
        sb.table("spm_gv_leader_notes")
        .select("id")
        .eq("week_id", doc["week_id"])
        .eq("username", username)
        .eq("scope", scope)
        .execute()
    )
    if existing.data:
        nid = existing.data[0]["id"]
        sb.table("spm_gv_leader_notes").update(doc).eq("id", nid).execute()
        doc["id"] = nid
        return doc
    ins = sb.table("spm_gv_leader_notes").insert(doc).execute()
    return (ins.data or [doc])[0]


def permissions_payload(ctx: UserContext, sb) -> dict:
    staff = rbac.staff_of(ctx, sb) or {}
    return {
        "is_director": rbac.is_director(ctx, sb),
        "is_deputy": rbac.is_deputy(ctx, sb),
        "is_head": rbac.is_head(ctx, sb),
        "is_admin": ctx.is_global_admin,
        "can_assign_center": rbac.can_assign_center(ctx, sb),
        "can_assign_dept": rbac.can_assign_dept(ctx, sb),
        "can_see_leader_center": rbac.can_see_leader_notes_center(ctx, sb),
        "can_manage_staff": rbac.can_assign_center(ctx, sb),
        "role": staff.get("role") or ("director" if rbac.is_director(ctx, sb) else "staff"),
        "department_id": rbac.staff_department_id(ctx, sb),
        "full_name": staff.get("full_name") or ctx.username,
    }
