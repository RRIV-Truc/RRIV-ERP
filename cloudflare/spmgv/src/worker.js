/* Giao viec TT SPM  Cloudflare Worker API (ghi thang Supabase). */
const INTERNAL_DEPTS = new Set(["pgd", "nv", "nc", "pkn", "ktc", "tckt", "lx"]);
const EXTRA_DEPTS = { "rriv.nhtruong": new Set(["pkn"]) };
const HIEN = "rriv.ntdhien";
const DEPUTY = "rriv.nhtruong";
const KTC_TEAM = "team-spm-ktc";
const SPM_DEPT = "dl-2";
const STATUS_LABEL = {
  not_started: "Chua bat dau",
  in_progress: "Dang thuc hien",
  at_risk: "Rui ro",
  completed: "Hoan thanh",
  blocked: "Bi vuong",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return cors(env, new Response(null, { status: 204 }));
    const url = new URL(request.url);
    try {
      if (url.pathname === "/config.js") return cors(env, configJs(env));
      if (url.pathname.startsWith("/api/spm-gv")) {
        return cors(env, await handleApi(request, env, url));
      }
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("Not found", { status: 404 });
    } catch (err) {
      return cors(env, json({ success: false, message: String(err.message || err) }, 500));
    }
  },
};

function configJs(env) {
  const hub = (env.HUB_URL || "/").replace(/\/$/, "") || "/";
  const body = `window.SPM_GV={apiBase:"/api/spm-gv",hubUrl:${JSON.stringify(hub)}};`;
  return new Response(body, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } });
}

function cors(env, res) {
  const headers = new Headers(res.headers);
  const origin = env.PAGES_ORIGIN || "*";
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-RRIV-Username");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  return new Response(res.body, { status: res.status, headers });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function csv(env, name, fallback) {
  return String(env[name] || fallback || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function directors(env) { return new Set(csv(env, "DIRECTOR_USERNAMES", "rriv.nttruc")); }
function deputies(env) { return new Set(csv(env, "DEPUTY_USERNAMES", "rriv.nhtruong")); }
function spmDepts(env) { return new Set(csv(env, "SPM_DEPT_IDS", SPM_DEPT)); }

function nowIso() { return new Date().toISOString(); }

function b64urlFromBytes(bytes) {
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesFromB64url(text) {
  const pad = "=".repeat((4 - (text.length % 4)) % 4);
  const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function hmacHex32(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function ticketSecret(env) {
  return (env.SPM_GV_TICKET_SECRET || env.SECRET_KEY || "rriv-spm-gv-ticket-dev").trim();
}

async function issueToken(env, username, extra, ttlSec) {
  const payload = Object.assign({
    u: String(username || "").trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + ttlSec,
    jti: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
  }, extra || {});
  const body = b64urlFromBytes(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacHex32(ticketSecret(env), body);
  return { token: body + "." + sig, payload };
}

async function verifyToken(env, token) {
  const raw = String(token || "").trim();
  const i = raw.lastIndexOf(".");
  if (i < 0) return null;
  const body = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expect = await hmacHex32(ticketSecret(env), body);
  if (expect.length !== sig.length) return null;
  let ok = 0;
  for (let n = 0; n < expect.length; n++) ok |= expect.charCodeAt(n) ^ sig.charCodeAt(n);
  if (ok) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(body))); }
  catch { return null; }
  if (!payload || !payload.u || Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

async function saveSession(env, payload) {
  if (!env.SESSIONS) return;
  try {
    await env.SESSIONS.put("sess:" + payload.jti, JSON.stringify({ u: payload.u, exp: payload.exp }), {
      expirationTtl: Math.max(60, Number(payload.exp) - Math.floor(Date.now() / 1000)),
    });
  } catch (_) {}
}

async function sessionOk(env, payload) {
  if (!payload || payload.kind !== "session") return false;
  if (!env.SESSIONS) return true;
  try {
    const hit = await env.SESSIONS.get("sess:" + payload.jti);
    return !!hit;
  } catch {
    return true;
  }
}

function sbHeaders(env, extra) {
  const key = String(env.SUPABASE_SERVICE_KEY || "");
  const headers = {
    apikey: key,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "rriv-spmgv-worker/1.0",
  };
  if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
  return Object.assign(headers, extra || {});
}

function errText(data, text, status) {
  if (data && typeof data === "object") {
    return data.message || data.error || data.details || data.hint || JSON.stringify(data);
  }
  if (text) return String(text).slice(0, 400);
  return "HTTP " + status;
}

async function sb(env, path, opts) {
  const url = String(env.SUPABASE_URL || "").replace(/\/$/, "") + "/rest/v1/" + path;
  const res = await fetch(url, Object.assign({}, opts, { headers: sbHeaders(env, opts && opts.headers) }));
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    throw new Error(path.split("?")[0] + ": " + errText(data, text, res.status));
  }
  return data;
}

function lit(val) {
  const s = String(val == null ? "" : val);
  if (/^[A-Za-z0-9._:-]+$/.test(s)) return s;
  return '"' + s.replace(/"/g, '\\"') + '"';
}

function q(table, query) { return table + "?" + query; }

async function rows(env, table, query) {
  const data = await sb(env, q(table, query));
  return Array.isArray(data) ? data : [];
}

async function one(env, table, query) {
  const list = await rows(env, table, query + (query.includes("limit=") ? "" : "&limit=1"));
  return list[0] || null;
}

async function insertRow(env, table, doc) {
  const data = await sb(env, table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(doc),
  });
  return Array.isArray(data) ? data[0] : data;
}

async function updateRows(env, table, query, fields) {
  const data = await sb(env, q(table, query), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(fields),
  });
  return Array.isArray(data) ? data : [];
}

async function deleteRows(env, table, query) {
  await sb(env, q(table, query), { method: "DELETE" });
}

function inList(ids) {
  return ids.filter(Boolean).map((id) => encodeURIComponent(id)).join(",");
}

function fold(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "d");
}

function inferRoleDept(emp, env) {
  const username = String(emp.username || "").trim().toLowerCase();
  const pos = fold(emp.position_name || "");
  const team = String(emp.team_id || "");
  const name = fold(emp.full_name || "");
  if (username === HIEN || name.includes("dieu hien")) return ["head", "ktc"];
  if (username === DEPUTY) return ["deputy", "pgd"];
  if (directors(env).has(username) || (pos.includes("giam doc") && !pos.includes("pho"))) return ["director", null];
  if (pos.includes("pho giam doc") || pos.includes("pho gd") || pos.startsWith("pho ")) return ["deputy", "pgd"];
  if (pos.includes("kiem tra cheo") || team === KTC_TEAM) return ["head", "ktc"];
  if (pos.includes("nghiep vu")) return ["head", "nv"];
  if (pos.includes("nc&cg") || pos.includes("nc cg") || pos.includes("pt bp nc")) return ["head", "nc"];
  if (pos.includes("lai xe")) return ["staff", "lx"];
  if (pos.includes("ke toan") || pos.includes("tai chinh")) {
    return [(pos.includes("phu trach") || pos.includes("truong")) ? "head" : "staff", "tckt"];
  }
  if (pos.includes("kiem nghiem") || pos.includes("hieu chuan") || pos.includes("cao dang ky thuat")) return ["staff", "pkn"];
  if (pos.includes("nghien cuu")) return ["staff", "nc"];
  if (pos.includes("phu trach") || pos.startsWith("pt ")) return ["head", null];
  return ["staff", null];
}

function extraDepts(username) {
  return EXTRA_DEPTS[String(username || "").toLowerCase()] || new Set();
}

function staffDeptIds(ctx) {
  const ids = new Set();
  const did = String((ctx.staff && ctx.staff.department_id) || "").trim();
  if (INTERNAL_DEPTS.has(did)) ids.add(did);
  if (ctx.isDeputy) ids.add("pgd");
  extraDepts(ctx.username).forEach((d) => ids.add(d));
  return ids;
}

function permsOf(ctx) {
  const staff = ctx.staff || {};
  const deptIds = [...staffDeptIds(ctx)].sort();
  return {
    is_director: ctx.isDirector,
    is_deputy: ctx.isDeputy,
    is_head: ctx.isHead,
    is_admin: ctx.isAdmin,
    can_assign_center: ctx.isDirector || ctx.isAdmin,
    can_assign_dept: ctx.isDirector || ctx.isAdmin || ctx.isDeputy || ctx.isHead,
    can_see_leader_center: ctx.isDirector || ctx.isAdmin,
    can_manage_staff: ctx.isDirector || ctx.isAdmin,
    role: staff.role || (ctx.isDirector ? "director" : "staff"),
    department_id: deptIds.includes("pgd") ? "pgd" : (deptIds[0] || ""),
    department_ids: deptIds,
    full_name: staff.full_name || ctx.username,
  };
}

function canEnter(ctx, env) {
  if (!ctx) return false;
  if (ctx.isAdmin || ctx.isDirector) return true;
  if (spmDepts(env).has(String(ctx.departmentId || ""))) return true;
  return !!ctx.staff;
}

async function loadCtx(env, username) {
  username = String(username || "").trim().toLowerCase();
  if (!username) return null;
  const staff = await one(env, "spm_gv_staff", `select=*&username=eq.${lit(username)}&active=eq.true`);
  let departmentId = staff && staff.department_id;
  let erpRole = "user";
  try {
    const ua = await one(env, "user_accounts", `username=eq.${encodeURIComponent(username)}&select=username,role,employee_id`);
    if (ua) {
      erpRole = ua.role || "user";
      if (ua.employee_id) {
        const emp = await one(env, "employee", `id=eq.${encodeURIComponent(ua.employee_id)}&select=id,department_id`);
        if (emp && emp.department_id) departmentId = emp.department_id;
      }
    }
  } catch (_) {}
  const isAdmin = String(erpRole).toLowerCase() === "admin";
  const isDirector = directors(env).has(username) || !!(staff && staff.role === "director");
  const isDeputy = deputies(env).has(username) || !!(staff && staff.role === "deputy");
  const isHead = !!(staff && staff.role === "head");
  return { username, staff, departmentId, isAdmin, isDirector, isDeputy, isHead };
}

async function authCtx(request, env, url) {
  const auth = request.headers.get("Authorization") || "";
  let username = "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const payload = await verifyToken(env, auth.slice(7).trim());
    if (payload && payload.kind === "session" && await sessionOk(env, payload)) username = payload.u;
    else if (payload && !payload.kind) username = payload.u;
  }
  if (!username) username = (request.headers.get("X-RRIV-Username") || url.searchParams.get("username") || "").trim().toLowerCase();
  const ctx = await loadCtx(env, username);
  if (!ctx) return { error: json({ success: false, message: "Chua dang nhap" }, 401) };
  if (!canEnter(ctx, env)) {
    return { error: json({ success: false, message: "App chi danh cho can bo Trung tam NCPT San pham moi" }, 403) };
  }
  return { ctx };
}

function isoWeekBounds() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const start = new Date(week1Mon);
  start.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const s = start.toISOString().slice(0, 10);
  const e = end.toISOString().slice(0, 10);
  const label = "Tuan " + String(week).padStart(2, "0") + "/" + year + " (" + s.slice(8, 10) + "/" + s.slice(5, 7) + "-" + e.slice(8, 10) + "/" + e.slice(5, 7) + ")";
  return { year, week, start: s, end: e, label };
}

function computeRag(status, pct) {
  if (status === "completed" || pct >= 100) return "green";
  if (status === "blocked" || status === "at_risk") return "red";
  if (status === "not_started") return "gray";
  if (pct < 40) return "yellow";
  return "green";
}

function autoStatus(pct, incomplete) {
  if (pct >= 100) return "completed";
  if (pct <= 0 && !incomplete) return "not_started";
  if (pct < 40) return "at_risk";
  return "in_progress";
}

async function listDepartments(env) {
  return rows(env, "spm_gv_departments", "select=*&order=sort_order.asc");
}

async function listStaff(env) {
  return rows(env, "spm_gv_staff", "select=*&active=eq.true&order=full_name.asc");
}

async function listWeeks(env) {
  return rows(env, "spm_gv_weeks", "select=*&order=start_date.desc");
}

async function ensureWeek(env, ctx) {
  const w = isoWeekBounds();
  const found = await one(env, "spm_gv_weeks", `year=eq.${w.year}&week_no=eq.${w.week}&select=*`);
  if (found) return found;
  return insertRow(env, "spm_gv_weeks", {
    year: w.year,
    week_no: w.week,
    label: w.label,
    start_date: w.start,
    end_date: w.end,
    status: "active",
    created_by: ctx.username,
  });
}

async function assigneesOf(env, ids) {
  if (!ids.length) return {};
  const list = await rows(env, "spm_gv_assignees", `select=*&task_id=in.(${inList(ids)})`);
  const out = {};
  list.forEach((row) => {
    (out[row.task_id] = out[row.task_id] || []).push(row);
  });
  return out;
}

async function latestReports(env, ids) {
  if (!ids.length) return {};
  const list = await rows(env, "spm_gv_reports", `select=*&task_id=in.(${inList(ids)})&order=reported_at.desc`);
  const out = {};
  list.forEach((row) => {
    if (!out[row.task_id]) out[row.task_id] = row;
  });
  return out;
}

async function notesMap(env, weekId, scope) {
  const list = await rows(env, "spm_gv_leader_notes", `select=*&week_id=eq.${encodeURIComponent(weekId)}&scope=eq.${scope}`);
  const byUser = {};
  const byDept = {};
  list.forEach((row) => {
    byUser[row.username] = row;
    if (row.department_id) byDept[row.department_id] = row;
  });
  return { byUser, byDept, rows: list };
}

function deptHeads(staff) {
  const out = {};
  staff.forEach((s) => {
    const did = s.department_id;
    if (!did) return;
    if ((s.role === "head" || s.role === "deputy") && !out[did]) out[did] = s;
    else if (s.role === "head") out[did] = s;
  });
  return out;
}

function enrich(task, assignees, report, note, includeLeader) {
  const lead = (assignees || []).find((a) => a.kind === "lead") || null;
  const doers = (assignees || []).filter((a) => a.kind === "doer");
  const pct = Number(task.progress_pct || 0);
  const status = task.status || "not_started";
  const out = Object.assign({}, task, {
    assignees: assignees || [],
    lead,
    doers,
    doer_text: task.doer_text || "",
    latest_report: report || null,
    completed_text: report ? (report.completed_text || report.note || "") : "",
    incomplete_text: report ? (report.incomplete_text || "") : "",
    reason_text: report ? (report.reason_text || report.difficulties || "") : "",
    rag: computeRag(status, pct),
    status_label: STATUS_LABEL[status] || status,
  });
  if (includeLeader) out.leader_note = note || null;
  return out;
}

function parseTs(s) {
  if (!s) return null;
  const t = Date.parse(String(s).replace("Z", "+00:00"));
  return Number.isNaN(t) ? null : t;
}

async function lastSeen(env, username) {
  try {
    const row = await one(env, "spm_gv_seen", `username=eq.${encodeURIComponent(username)}&select=last_seen_at`);
    return row && row.last_seen_at;
  } catch { return null; }
}

async function unreadCutoff(env, username, since) {
  const last = await lastSeen(env, username);
  if (last) return last;
  if (since) return since;
  return new Date(Date.now() - 48 * 3600 * 1000).toISOString();
}

async function unreadPayload(env, ctx, since) {
  const cutoff = await unreadCutoff(env, ctx.username, since);
  let tasks = [];
  try {
    tasks = await rows(env, "spm_gv_tasks", `select=id,title,level,department_id,created_at,created_by,week_id&created_at=gt.${lit(cutoff)}&order=created_at.desc&limit=80`);
  } catch {
    return { count: 0, items: [], last_seen_at: await lastSeen(env, ctx.username) };
  }
  const amap = await assigneesOf(env, tasks.map((t) => t.id));
  const mine = staffDeptIds(ctx);
  const items = [];
  tasks.forEach((t) => {
    if (String(t.created_by || "").toLowerCase() === ctx.username) return;
    const names = new Set((amap[t.id] || []).map((a) => String(a.username || "").toLowerCase()));
    const dept = String(t.department_id || "");
    let ok = names.has(ctx.username);
    if (!ok && dept && mine.has(dept)) {
      if (t.level === "center") ok = true;
      else ok = ctx.isDeputy || ctx.isHead;
    }
    if (ok) items.push({ id: t.id, title: t.title, level: t.level, department_id: t.department_id, created_at: t.created_at });
  });
  return { count: items.length, items: items.slice(0, 15), last_seen_at: await lastSeen(env, ctx.username) };
}

async function board(env, ctx, weekId, level) {
  const centerRaw0 = await rows(env, "spm_gv_tasks", `select=*&week_id=eq.${encodeURIComponent(weekId)}&level=eq.center&order=created_at.asc`);
  const deptRaw0 = await rows(env, "spm_gv_tasks", `select=*&week_id=eq.${encodeURIComponent(weekId)}&level=eq.dept&order=created_at.asc`);
  const staff = await listStaff(env);
  const heads = deptHeads(staff);
  const deptIds = staffDeptIds(ctx);
  const cutoff = await unreadCutoff(env, ctx.username, null);
  const isDir = ctx.isDirector || ctx.isAdmin;
  let centerRaw = centerRaw0;
  let deptRaw = deptRaw0;
  if (!isDir) {
    centerRaw = centerRaw.filter((t) => deptIds.has(String(t.department_id || "")));
    deptRaw = deptRaw.filter((t) => deptIds.has(String(t.department_id || "")));
  }
  const allIds = centerRaw.map((t) => t.id).concat(deptRaw.map((t) => t.id));
  const amap = await assigneesOf(env, allIds);
  const rmap = await latestReports(env, allIds);
  const notesCenter = isDir ? await notesMap(env, weekId, "center") : { byUser: {}, byDept: {}, rows: [] };
  const notesDept = (isDir || ctx.isHead || ctx.isDeputy) ? await notesMap(env, weekId, "dept") : { byUser: {}, byDept: {}, rows: [] };

  function pack(t) {
    let includeLeader = false;
    let note = null;
    const did = String(t.department_id || "");
    if (t.level === "center" && isDir) {
      note = notesCenter.byDept[t.department_id];
      if (!note) {
        const head = heads[t.department_id || ""];
        if (head) note = notesCenter.byUser[head.username];
      }
      includeLeader = true;
    } else if (t.level === "dept" && (isDir || ((ctx.isHead || ctx.isDeputy) && deptIds.has(did)))) {
      const lead = (amap[t.id] || []).find((a) => a.kind === "lead");
      note = lead && lead.username ? notesDept.byUser[lead.username] : null;
      includeLeader = true;
    }
    const assignees = amap[t.id] || [];
    const out = enrich(t, assignees, rmap[t.id], note, includeLeader);
    const owns = isDir || deptIds.has(did);
    const assigned = assignees.some((a) => String(a.username || "").toLowerCase() === ctx.username);
    const canCascade = isDir || ((ctx.isDeputy || ctx.isHead) && owns);
    out.can_report = isDir || assigned || ((ctx.isDeputy || ctx.isHead) && owns);
    out.can_cascade = canCascade;
    out.can_edit = t.level === "center" ? isDir : canCascade;
    const created = parseTs(t.created_at);
    const limit = parseTs(cutoff);
    out.is_new = String(t.created_by || "").toLowerCase() !== ctx.username && created && limit && created > limit;
    return out;
  }

  const kidsByParent = {};
  deptRaw.forEach((d) => {
    if (d.parent_id) (kidsByParent[d.parent_id] = kidsByParent[d.parent_id] || []).push(d);
  });
  const centerPacked = centerRaw.map((t) => {
    const item = pack(t);
    item.children = (kidsByParent[t.id] || []).map(pack);
    item.children_count = item.children.length;
    return item;
  });

  let outTasks = [];
  let groups = [];
  let peopleNotes = [];
  if (level === "center") {
    outTasks = centerPacked;
  } else {
    groups = centerPacked.map((p) => ({ parent: p, children: p.children || [] }));
    const orphans = deptRaw.filter((d) => !d.parent_id).map(pack);
    groups.forEach((g) => { outTasks = outTasks.concat(g.children); });
    outTasks = outTasks.concat(orphans);
    if (isDir) peopleNotes = notesDept.rows;
    else if (ctx.isHead || ctx.isDeputy) {
      peopleNotes = notesDept.rows.filter((row) => deptIds.has(String(row.department_id || "")));
    }
  }
  const src = level === "center" ? centerPacked : outTasks;
  const n = src.length;
  const avg = n ? Math.round(src.reduce((s, t) => s + Number(t.progress_pct || 0), 0) / n) : 0;
  const rag = { green: 0, yellow: 0, red: 0, gray: 0 };
  src.forEach((t) => { rag[t.rag] = (rag[t.rag] || 0) + 1; });
  return {
    tasks: outTasks,
    groups,
    orphan_children: level === "dept" ? deptRaw.filter((d) => !d.parent_id).map(pack) : [],
    center_inbox: centerPacked,
    summary: { count: n, avg_pct: avg, rag },
    leader_notes: peopleNotes,
    can_see_leader: (level === "center" && isDir) || (level === "dept" && (isDir || ctx.isHead || ctx.isDeputy)),
  };
}

async function bootstrapDirector(env, ctx) {
  let staffRows = await listStaff(env);
  if (!staffRows.length) {
    try { staffRows = await syncStaff(env); } catch (_) {}
  }
  if (staffRows.length) {
    ctx.staff = staffRows.find((s) => String(s.username).toLowerCase() === ctx.username) || ctx.staff;
    return ctx.staff;
  }
  if (!(ctx.isAdmin || directors(env).has(ctx.username))) return null;
  const doc = {
    username: ctx.username,
    full_name: ctx.username,
    department_id: null,
    role: "director",
    active: true,
  };
  const row = await insertRow(env, "spm_gv_staff", doc);
  ctx.staff = row;
  return row;
}

async function syncStaff(env) {
  const emps = await rows(env, "employee", `select=id,username,full_name,position_name,position_id,department_id,team_id,employment_status&department_id=eq.${SPM_DEPT}`);
  const existing = await rows(env, "spm_gv_staff", "select=*");
  const byUser = {};
  existing.forEach((s) => { byUser[String(s.username || "").toLowerCase()] = s; });
  for (const emp of emps) {
    const username = String(emp.username || "").trim().toLowerCase();
    if (!username) continue;
    const [role, dept] = inferRoleDept(emp, env);
    const doc = {
      username,
      full_name: emp.full_name || username,
      department_id: dept,
      role,
      active: String(emp.employment_status || "active") !== "inactive",
    };
    const cur = byUser[username];
    if (cur) {
      const fields = { full_name: doc.full_name, role: doc.role, active: doc.active };
      if (doc.department_id) fields.department_id = doc.department_id;
      else if (cur.department_id) fields.department_id = cur.department_id;
      await updateRows(env, "spm_gv_staff", `id=eq.${cur.id}`, fields);
    } else {
      await insertRow(env, "spm_gv_staff", doc);
    }
  }
  return listStaff(env);
}

async function saveAssignees(env, taskId, payload, level) {
  const rowsIn = [];
  if (level !== "center") {
    const lead = payload.lead || {};
    if (lead.username) {
      rowsIn.push({
        task_id: taskId,
        username: String(lead.username).trim().toLowerCase(),
        full_name: lead.full_name || lead.username,
        kind: "lead",
      });
    }
  }
  (payload.doers || []).forEach((d) => {
    const uname = String(d.username || "").trim().toLowerCase();
    const fname = String(d.full_name || d.name || "").trim();
    if (!uname && !fname) return;
    rowsIn.push({
      task_id: taskId,
      username: uname || ("name:" + fold(fname).replace(/\s+/g, "-").slice(0, 40)),
      full_name: fname || uname,
      kind: "doer",
    });
  });
  if (rowsIn.length) await insertRow(env, "spm_gv_assignees", rowsIn);
}

async function rollupParent(env, parentId) {
  if (!parentId) return;
  const kids = await rows(env, "spm_gv_tasks", `select=progress_pct,status&parent_id=eq.${encodeURIComponent(parentId)}`);
  if (!kids.length) return;
  const avg = Math.round(kids.reduce((s, k) => s + Number(k.progress_pct || 0), 0) / kids.length);
  let status = autoStatus(avg, "");
  if (kids.some((k) => k.status === "blocked" || k.status === "at_risk") && avg < 100) status = "at_risk";
  await updateRows(env, "spm_gv_tasks", `id=eq.${encodeURIComponent(parentId)}`, {
    progress_pct: avg,
    status,
    updated_at: nowIso(),
  });
}

function ownsDept(ctx, dept) {
  return staffDeptIds(ctx).has(String(dept || ""));
}

function canAssignDept(ctx, dept) {
  if (ctx.isDirector || ctx.isAdmin) return true;
  if (!(ctx.isDeputy || ctx.isHead)) return false;
  if (!dept) return staffDeptIds(ctx).size > 0;
  return ownsDept(ctx, dept);
}

function canReport(ctx, task) {
  if (ctx.isDirector || ctx.isAdmin) return true;
  const dept = String(task.department_id || "");
  if (ownsDept(ctx, dept) && (ctx.isDeputy || ctx.isHead)) return true;
  return (task.assignees || []).some((a) => String(a.username || "").toLowerCase() === ctx.username);
}

async function bootPayload(env, ctx, level) {
  await bootstrapDirector(env, ctx);
  const perms = permsOf(ctx);
  if (level !== "center" && level !== "dept") {
    level = (perms.is_deputy || perms.is_head) && !perms.is_director ? "dept" : "center";
  }
  const week = await ensureWeek(env, ctx);
  const weeks = await listWeeks(env);
  const boardData = week
    ? await board(env, ctx, week.id, level)
    : { tasks: [], groups: [], center_inbox: [], summary: { count: 0, avg_pct: 0, rag: {} }, orphan_children: [], leader_notes: [], can_see_leader: false };
  const unread = await unreadPayload(env, ctx, null);
  return {
    user: { username: ctx.username, full_name: perms.full_name, department_id: perms.department_id },
    permissions: perms,
    departments: await listDepartments(env),
    staff: await listStaff(env),
    current_week: week,
    weeks,
    unread,
    board: boardData,
    level,
  };
}

async function verifyTicketViaHub(env, ticket) {
  const hub = String(env.HUB_URL || "").replace(/\/$/, "");
  if (!hub || !ticket) return null;
  try {
    const res = await fetch(hub + "/api/spm-gv/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
    const data = await res.json();
    if (res.ok && data && data.username) return { u: String(data.username).toLowerCase() };
  } catch (_) {}
  return null;
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/^\/api\/spm-gv/, "") || "/";
  const method = request.method.toUpperCase();

  if (path === "/session" && method === "POST") {
    const body = await readBody(request);
    const raw = body.ticket || url.searchParams.get("ticket") || "";
    let payload = await verifyToken(env, raw);
    if (!payload || payload.kind === "session") {
      payload = await verifyTicketViaHub(env, raw);
    }
    if (!payload || !payload.u || payload.kind === "session") {
      return json({ success: false, message: "Ticket het han hoac khong hop le" }, 401);
    }
    const issued = await issueToken(env, payload.u, { kind: "session" }, 8 * 3600);
    await saveSession(env, issued.payload);
    return json({ success: true, session: issued.token, username: payload.u, expires_in: 8 * 3600 });
  }

  if (path === "/health" && method === "GET") {
    const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
    const key = String(env.SUPABASE_SERVICE_KEY || "");
    const target = base + "/rest/v1/spm_gv_departments?select=id&limit=1";
    try {
      const res = await fetch(target, {
        headers: {
          apikey: key,
          Accept: "application/json",
          "User-Agent": "rriv-spmgv-worker/1.0",
        },
      });
      const text = await res.text();
      return json({
        success: res.ok,
        status: res.status,
        host: base,
        key_prefix: key.slice(0, 10),
        key_len: key.length,
        body: String(text).slice(0, 240),
      }, res.ok ? 200 : 400);
    } catch (err) {
      return json({ success: false, message: String(err.message || err), host: base, key_prefix: key.slice(0, 10) }, 400);
    }
  }

  const gate = await authCtx(request, env, url);
  if (gate.error) return gate.error;
  const ctx = gate.ctx;

  try {
    if (path === "/boot" && method === "GET") {
      const data = await bootPayload(env, ctx, url.searchParams.get("level") || "auto");
      return json(Object.assign({ success: true }, data));
    }
    if (path === "/context" && method === "GET") {
      await bootstrapDirector(env, ctx);
      const perms = permsOf(ctx);
      return json({
        success: true,
        user: { username: ctx.username, full_name: perms.full_name, department_id: perms.department_id },
        permissions: perms,
        departments: await listDepartments(env),
        staff: await listStaff(env),
        current_week: await ensureWeek(env, ctx),
      });
    }
    if (path === "/weeks" && method === "GET") {
      await ensureWeek(env, ctx);
      return json({ success: true, weeks: await listWeeks(env) });
    }
    if (path === "/weeks" && method === "POST") {
      if (!(ctx.isDirector || ctx.isAdmin || ctx.isDeputy || ctx.isHead)) {
        return json({ success: false, message: "Khong co quyen tao tuan" }, 403);
      }
      return json({ success: true, week: await ensureWeek(env, ctx) }, 201);
    }
    const boardM = path.match(/^\/weeks\/([^/]+)\/board$/);
    if (boardM && method === "GET") {
      let level = url.searchParams.get("level") || "center";
      if (level !== "center" && level !== "dept") level = "center";
      const data = await board(env, ctx, decodeURIComponent(boardM[1]), level);
      return json(Object.assign({ success: true }, data));
    }
    if (path === "/unread" && method === "GET") {
      const data = await unreadPayload(env, ctx, url.searchParams.get("since"));
      return json(Object.assign({ success: true }, data));
    }
    if (path === "/unread/seen" && method === "POST") {
      const now = nowIso();
      const found = await one(env, "spm_gv_seen", `username=eq.${encodeURIComponent(ctx.username)}&select=username`);
      if (found) await updateRows(env, "spm_gv_seen", `username=eq.${encodeURIComponent(ctx.username)}`, { last_seen_at: now });
      else await insertRow(env, "spm_gv_seen", { username: ctx.username, last_seen_at: now });
      return json({ success: true, last_seen_at: now, count: 0 });
    }
    if (path === "/staff" && method === "GET") return json({ success: true, staff: await listStaff(env) });
    if (path === "/staff/sync" && method === "POST") {
      if (!(ctx.isDirector || ctx.isAdmin)) return json({ success: false, message: "Chi Giam doc dong bo nhan su" }, 403);
      return json({ success: true, staff: await syncStaff(env) });
    }
    if (path === "/tasks" && method === "POST") {
      const payload = await readBody(request);
      const task = await createTask(env, ctx, payload);
      return json({ success: true, task }, 201);
    }
    const taskM = path.match(/^\/tasks\/([^/]+)(.*)$/);
    if (taskM) {
      const taskId = decodeURIComponent(taskM[1]);
      const rest = taskM[2] || "";
      if (rest === "" && method === "PATCH") {
        return json({ success: true, task: await updateTask(env, ctx, taskId, await readBody(request)) });
      }
      if (rest === "" && method === "DELETE") {
        await deleteTask(env, ctx, taskId);
        return json({ success: true });
      }
      if (rest === "/report" && method === "POST") {
        return json({ success: true, report: await submitReport(env, ctx, taskId, await readBody(request)) });
      }
      if (rest === "/work-score" && method === "PUT") {
        return json({ success: true, task: await scoreWork(env, ctx, taskId, await readBody(request)) });
      }
    }
    if (path === "/leader-notes" && method === "PUT") {
      return json({ success: true, note: await upsertNote(env, ctx, await readBody(request)) });
    }
    return json({ success: false, message: "Not found" }, 404);
  } catch (err) {
    const msg = String(err.message || err);
    const code = /quyen|Chi Giam/i.test(msg) ? 403 : 400;
    return json({ success: false, message: msg }, code);
  }
}

async function createTask(env, ctx, payload) {
  let level = payload.level || "center";
  let dept = payload.department_id;
  let parentId = payload.parent_id || null;
  let parent = null;
  if (parentId) {
    parent = await one(env, "spm_gv_tasks", `id=eq.${encodeURIComponent(parentId)}&select=*`);
    if (!parent) throw new Error("Khong tim thay dau viec Giam doc da giao");
    if (parent.level !== "center") throw new Error("Chi phan cong tiep tu dau viec cap Trung tam");
    dept = parent.department_id;
    payload.week_id = parent.week_id || payload.week_id;
  }
  if (level === "center" && !(ctx.isDirector || ctx.isAdmin)) throw new Error("Chi Giam doc giao viec cap Trung tam");
  if (level === "dept" && !canAssignDept(ctx, dept)) throw new Error("Khong co quyen giao viec cap bo phan nay");
  let title = String(payload.title || "").trim();
  if (!title && parent) title = String(parent.title || "").trim();
  if (!title) throw new Error("Thieu ten dau viec");
  if (!dept) throw new Error("Chon bo phan chiu trach nhiem");
  if (level === "dept") {
    if (!parentId) throw new Error("Chon dau viec Giam doc da giao de phan cong tiep");
    if (!(payload.lead && payload.lead.username)) throw new Error("Chon nguoi chiu trach nhiem chinh");
  }
  const deadline = payload.deadline || (parent && parent.deadline) || null;
  const doc = {
    week_id: payload.week_id,
    level,
    department_id: dept,
    parent_id: level === "dept" ? parentId : null,
    title,
    description: payload.description || (parent && parent.description) || "",
    doer_text: String(payload.doer_text || "").trim(),
    deadline,
    status: payload.status || "not_started",
    progress_pct: Number(payload.progress_pct || 0),
    created_by: ctx.username,
    updated_at: nowIso(),
  };
  let task;
  try { task = await insertRow(env, "spm_gv_tasks", doc); }
  catch {
    delete doc.parent_id;
    task = await insertRow(env, "spm_gv_tasks", doc);
  }
  await saveAssignees(env, task.id, payload, level);
  if (parentId) await rollupParent(env, parentId);
  return task;
}

async function updateTask(env, ctx, taskId, payload) {
  const task = await one(env, "spm_gv_tasks", `id=eq.${encodeURIComponent(taskId)}&select=*`);
  if (!task) throw new Error("Khong tim thay dau viec");
  if (task.level === "center" && !(ctx.isDirector || ctx.isAdmin)) throw new Error("Khong co quyen sua viec cap Trung tam");
  if (task.level === "dept" && !canAssignDept(ctx, task.department_id)) throw new Error("Khong co quyen sua viec cap bo phan");
  const fields = { updated_at: nowIso() };
  ["title", "description", "deadline", "department_id", "status", "doer_text", "parent_id"].forEach((k) => {
    if (k in payload) fields[k] = payload[k] || null;
  });
  if ("progress_pct" in payload) fields.progress_pct = Number(payload.progress_pct);
  await updateRows(env, "spm_gv_tasks", `id=eq.${encodeURIComponent(taskId)}`, fields);
  if ("lead" in payload || "doers" in payload || "assignees" in payload || "doer_text" in payload) {
    await deleteRows(env, "spm_gv_assignees", `task_id=eq.${encodeURIComponent(taskId)}`);
    await saveAssignees(env, taskId, payload, task.level);
  }
  const newParent = ("parent_id" in fields) ? fields.parent_id : task.parent_id;
  await rollupParent(env, task.parent_id);
  if (newParent && newParent !== task.parent_id) await rollupParent(env, newParent);
  return Object.assign({}, task, fields);
}

async function deleteTask(env, ctx, taskId) {
  const task = await one(env, "spm_gv_tasks", `id=eq.${encodeURIComponent(taskId)}&select=*`);
  if (!task) throw new Error("Khong tim thay dau viec");
  if (task.level === "center" && !(ctx.isDirector || ctx.isAdmin)) throw new Error("Khong co quyen xoa viec cap Trung tam");
  if (task.level === "dept" && !canAssignDept(ctx, task.department_id)) throw new Error("Khong co quyen xoa viec cap bo phan");
  if (task.level === "center") {
    const kids = await rows(env, "spm_gv_tasks", `select=id&parent_id=eq.${encodeURIComponent(taskId)}`);
    for (const kid of kids) await deleteRows(env, "spm_gv_tasks", `id=eq.${encodeURIComponent(kid.id)}`);
  }
  await deleteRows(env, "spm_gv_tasks", `id=eq.${encodeURIComponent(taskId)}`);
  await rollupParent(env, task.parent_id);
}

async function submitReport(env, ctx, taskId, payload) {
  const task = await one(env, "spm_gv_tasks", `id=eq.${encodeURIComponent(taskId)}&select=*`);
  if (!task) throw new Error("Khong tim thay dau viec");
  task.assignees = await rows(env, "spm_gv_assignees", `select=*&task_id=eq.${encodeURIComponent(taskId)}`);
  if (!canReport(ctx, task)) throw new Error("Khong co quyen bao cao dau viec nay");
  let pct = Number(payload.progress_pct || 0);
  pct = Math.max(0, Math.min(100, pct));
  const completed = String(payload.completed_text || payload.note || "").trim();
  const incomplete = String(payload.incomplete_text || "").trim();
  const reason = String(payload.reason_text || payload.difficulties || "").trim();
  const status = payload.status || autoStatus(pct, incomplete);
  const rep = {
    task_id: taskId,
    progress_pct: pct,
    status,
    note: completed,
    difficulties: reason,
    solution: payload.solution || "",
    completed_text: completed,
    incomplete_text: incomplete,
    reason_text: reason,
    reported_by: ctx.username,
  };
  const saved = await insertRow(env, "spm_gv_reports", rep);
  await updateRows(env, "spm_gv_tasks", `id=eq.${encodeURIComponent(taskId)}`, {
    progress_pct: pct, status, updated_at: nowIso(),
  });
  await rollupParent(env, task.parent_id);
  return saved;
}

async function scoreWork(env, ctx, taskId, payload) {
  const task = await one(env, "spm_gv_tasks", `id=eq.${encodeURIComponent(taskId)}&select=*`);
  if (!task) throw new Error("Khong tim thay dau viec");
  const ok = task.level === "center" ? (ctx.isDirector || ctx.isAdmin) : canAssignDept(ctx, task.department_id);
  if (!ok) throw new Error("Khong co quyen cham diem dau viec");
  const fields = {
    work_score: payload.work_score != null ? Number(payload.work_score) : null,
    work_comment: payload.work_comment || "",
    work_scored_by: ctx.username,
    work_scored_at: nowIso(),
    updated_at: nowIso(),
  };
  await updateRows(env, "spm_gv_tasks", `id=eq.${encodeURIComponent(taskId)}`, fields);
  return Object.assign({}, task, fields);
}

async function upsertNote(env, ctx, payload) {
  const scope = payload.scope || "center";
  const dept = payload.department_id;
  if (scope === "center" && !ctx.isDirector) throw new Error("Chi Giam doc ghi nhan cap Trung tam");
  if (scope === "dept" && !(ctx.isDirector || ((ctx.isHead || ctx.isDeputy) && ownsDept(ctx, dept)))) {
    throw new Error("Khong co quyen ghi nhan cap bo phan");
  }
  const username = String(payload.username || "").trim().toLowerCase();
  if (!username) throw new Error("Thieu nguoi duoc ghi nhan");
  const doc = {
    week_id: payload.week_id,
    scope,
    department_id: dept,
    username,
    full_name: payload.full_name || username,
    support_score: payload.support_score,
    initiative_score: payload.initiative_score,
    note: payload.note || "",
    scored_by: ctx.username,
    scored_at: nowIso(),
  };
  const existing = await one(env, "spm_gv_leader_notes", `week_id=eq.${encodeURIComponent(doc.week_id)}&username=eq.${encodeURIComponent(username)}&scope=eq.${scope}&select=id`);
  if (existing) {
    await updateRows(env, "spm_gv_leader_notes", `id=eq.${existing.id}`, doc);
    doc.id = existing.id;
    return doc;
  }
  return insertRow(env, "spm_gv_leader_notes", doc);
}
