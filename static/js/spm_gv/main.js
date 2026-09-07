/* Giao viec TT SPM */
(function () {
  'use strict';

  var I18N = {};
  try { I18N = JSON.parse((document.getElementById('gvI18n') || {}).textContent || '{}'); } catch (e) { I18N = {}; }
  function T(k) { return I18N[k] || k; }

  var API = '/api/spm-gv';
  var state = {
    weeks: [], week: null, level: 'center', board: null,
    perms: {}, user: {}, departments: [], staff: [],
    reportTaskId: null, scoreTaskId: null, editTaskId: null
  };

  function $(id) { return document.getElementById(id); }
  function username() {
    try {
      if (typeof Auth !== 'undefined' && Auth.getUser) {
        var au = Auth.getUser() || Auth.restoreSession();
        if (au && au.username) return String(au.username).toLowerCase();
      }
      var s = JSON.parse(localStorage.getItem('userSession') || 'null')
        || JSON.parse(localStorage.getItem('currentUser') || 'null')
        || {};
      return String(s.username || (s.user && s.user.username) || '').toLowerCase();
    } catch (_) { return ''; }
  }
  function headers() {
    return { 'Content-Type': 'application/json', 'X-RRIV-Username': username() };
  }
  async function api(path, opts) {
    opts = opts || {};
    var url = API + path;
    url += (url.indexOf('?') >= 0 ? '&' : '?') + 'username=' + encodeURIComponent(username());
    var res = await fetch(url, Object.assign({ headers: headers() }, opts));
    var body = {};
    try { body = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(body.message || ('HTTP ' + res.status));
    return body;
  }
  function toast(msg, err) {
    var el = $('gvToast');
    el.textContent = msg;
    el.style.background = err ? '#dc2626' : '#312e81';
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 3200);
  }
  function openM(id) { $(id).hidden = false; }
  function closeM(id) { $(id).hidden = true; }
  function deptName(id) {
    var d = (state.departments || []).find(function (x) { return x.id === id; });
    return d ? d.name : (id || '-');
  }
  function fillSelect(sel, items, valKey, labelKey, withBlank, blankLabel) {
    sel.innerHTML = withBlank ? '<option value="">' + (blankLabel || T('pickDept')) + '</option>' : '';
    (items || []).forEach(function (it) {
      var o = document.createElement('option');
      o.value = it[valKey];
      o.textContent = it[labelKey];
      sel.appendChild(o);
    });
  }
  function fillDatalist() {
    var dl = $('dlStaff');
    if (!dl) return;
    dl.innerHTML = (state.staff || []).map(function (s) {
      return '<option value="' + esc(s.full_name) + '"></option>';
    }).join('');
  }
  function canSeeLeader() {
    if (state.level === 'center') return !!state.perms.can_see_leader_center;
    return !!(state.perms.is_director || state.perms.is_admin || state.perms.is_head);
  }
  function canAssign() {
    if (state.level === 'center') return !!state.perms.can_assign_center;
    return !!(state.perms.can_assign_dept || state.perms.is_deputy || state.perms.is_head || state.perms.is_director);
  }
  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function clip(s, n) {
    s = String(s || '').trim();
    if (!s) return '-';
    return s.length > (n || 80) ? s.slice(0, n || 80) + '...' : s;
  }

  function renderWeeks() {
    var box = $('weekList');
    if (!state.weeks.length) { box.innerHTML = '<p class="gv-empty">' + T('noWeek') + '</p>'; return; }
    box.innerHTML = state.weeks.map(function (w) {
      var on = state.week && state.week.id === w.id ? ' is-active' : '';
      return '<button type="button" class="gv-week-card' + on + '" data-id="' + w.id + '">' +
        '<div class="gv-week-card-title">' + esc(w.label || '') + '</div>' +
        '<div class="gv-week-card-meta">' + esc(w.start_date || '') + ' ? ' + esc(w.end_date || '') + '</div></button>';
    }).join('');
  }

  function renderHead() {
    var w = state.week || {};
    $('weekTitle').textContent = w.label || T('chooseWeek');
    $('weekBadge').textContent = w.label || T('weekDash');
    $('levelKicker').textContent = state.level === 'center' ? T('kickerCenter') : T('kickerDept');
    var hint = T('hintStaff');
    if (state.perms.is_director) hint = T('hintDir');
    else if (state.perms.is_deputy) hint = T('hintDeputy');
    else if (state.perms.is_head) hint = T('hintHead');
    $('roleHint').textContent = hint;
    $('btnAssign').hidden = !canAssign();
    $('btnStaff').hidden = !state.perms.can_manage_staff;
    $('btnLeaderNote').hidden = !(
      (state.level === 'center' && state.perms.is_director) ||
      (state.level === 'dept' && (state.perms.is_director || state.perms.is_head))
    );
    $('btnNewWeek').hidden = !canAssign();
    var name = state.perms.full_name || state.user.username || '?';
    $('userChip').textContent = name;
    $('userAvatar').textContent = String(name).charAt(0).toUpperCase();
  }

  function renderStats() {
    var s = (state.board && state.board.summary) || { count: 0, avg_pct: 0, rag: {} };
    var r = s.rag || {};
    $('statsRow').innerHTML =
      '<div class="gv-stat"><b>' + s.count + '</b><span>' + T('statTasks') + '</span></div>' +
      '<div class="gv-stat"><b>' + s.avg_pct + '%</b><span>' + T('statAvg') + '</span></div>' +
      '<div class="gv-stat"><b>' + (r.green || 0) + '</b><span>Xanh</span></div>' +
      '<div class="gv-stat"><b>' + (r.yellow || 0) + '</b><span>' + T('statNote') + '</span></div>' +
      '<div class="gv-stat"><b>' + (r.red || 0) + '</b><span>' + T('statRisk') + '</span></div>';
  }

  function doerLabel(t) {
    if (t.doer_text) return t.doer_text;
    var doers = (t.doers || []).map(function (d) { return d.full_name || d.username; }).join(', ');
    return doers || '-';
  }

  function leadLabel(t) {
    if (t.level === 'center' || state.level === 'center') return deptName(t.department_id);
    if (t.lead) return t.lead.full_name || t.lead.username;
    return '-';
  }

  function findTask(id) {
    var list = [];
    ((state.board && state.board.groups) || []).forEach(function (g) {
      if (g.parent) list.push(g.parent);
      (g.children || []).forEach(function (c) { list.push(c); });
    });
    ((state.board && state.board.orphan_children) || []).forEach(function (c) { list.push(c); });
    ((state.board && state.board.tasks) || []).forEach(function (t) { list.push(t); });
    return list.find(function (x) { return x.id === id; });
  }

  function parentOptions() {
    return (state.board && state.board.center_inbox) || (state.board && state.board.groups || []).map(function (g) {
      return g.parent;
    }).filter(Boolean);
  }

  function actionBtns(t, extra) {
    var html = '';
    if (extra) html += extra;
    if (t.can_report) {
      html += '<button type="button" class="gv-btn-sm gv-btn-outline" data-report="' + t.id + '">' + T('btnReport') + '</button> ';
    }
    if (t.can_edit) {
      html += '<button type="button" class="gv-btn-sm gv-btn-outline" data-edit="' + t.id + '">' + T('btnEdit') + '</button> ';
      html += '<button type="button" class="gv-btn-sm gv-btn-outline" data-del="' + t.id + '">' + T('btnDelete') + '</button> ';
    }
    if (canAssign()) {
      html += '<button type="button" class="gv-btn-sm gv-btn-outline" data-score="' + t.id + '">' + T('btnScore') + '</button>';
    }
    return html;
  }

  function renderTable() {
    var see = canSeeLeader();
    var center = state.level === 'center';
    $('taskHead').innerHTML = '<tr>' +
      '<th>' + T('colTask') + '</th>' +
      '<th>' + T('colLeadDept') + '</th>' +
      '<th>' + T('colDoer') + '</th><th>' + T('colDeadline') + '</th>' +
      '<th>' + T('colChildAssign') + '</th>' +
      '<th>' + T('colDone') + '</th><th>' + T('colUndone') + '</th><th>' + T('colReason') + '</th>' +
      '<th>' + T('colPct') + '</th><th>' + T('colScore') + '</th>' +
      (see ? '<th>' + T('colSecret') + '</th>' : '') +
      '<th></th></tr>';
    var tasks = (state.board && (state.board.center_inbox || state.board.tasks)) || [];
    if (!tasks.length) {
      $('taskBody').innerHTML = '<tr><td class="gv-empty" colspan="12">' + T('emptyTasks') + '</td></tr>';
      return;
    }
    $('taskBody').innerHTML = tasks.map(function (t) {
      var rag = t.rag || 'gray';
      var secret = '';
      if (see) {
        var n = t.leader_note;
        secret = n
          ? ('<td><span class="gv-secret">' + T('secretSupport') + ' ' + (n.support_score || '-') +
             ' | ' + T('secretInit') + ' ' + (n.initiative_score || '-') + '</span></td>')
          : '<td><span class="gv-secret">' + T('secretEmpty') + '</span></td>';
      }
      var work = t.work_score ? (t.work_score + '/5') : '-';
      var casc = (t.child_count ? (t.child_count + ' nguoi: ' + (t.child_assignees || '')) : T('notCascaded'));
      return '<tr>' +
        '<td><strong>' + esc(t.title) + '</strong><div class="gv-week-card-meta">' + esc(t.description || '') + '</div></td>' +
        '<td>' + esc(leadLabel(t)) + '</td>' +
        '<td>' + esc(doerLabel(t)) + '</td>' +
        '<td>' + (t.deadline || '-') + '</td>' +
        '<td>' + esc(casc) + '</td>' +
        '<td class="gv-cell-note">' + esc(clip(t.completed_text, 90)) + '</td>' +
        '<td class="gv-cell-note">' + esc(clip(t.incomplete_text, 90)) + '</td>' +
        '<td class="gv-cell-note">' + esc(clip(t.reason_text, 70)) + '</td>' +
        '<td><span class="gv-rag gv-rag-' + rag + '"></span>' + (t.progress_pct || 0) + '%</td>' +
        '<td>' + work + '</td>' + secret +
        '<td style="white-space:nowrap">' + actionBtns(t) + '</td></tr>';
    }).join('');
  }

  function childRow(t, see) {
    var rag = t.rag || 'gray';
    var secret = '';
    if (see) {
      var n = t.leader_note;
      secret = n
        ? ('<td><span class="gv-secret">' + T('secretSupport') + ' ' + (n.support_score || '-') +
           ' | ' + T('secretInit') + ' ' + (n.initiative_score || '-') + '</span></td>')
        : '<td><span class="gv-secret">' + T('secretEmpty') + '</span></td>';
    }
    var work = t.work_score ? (t.work_score + '/5') : '-';
    var lead = t.lead ? (t.lead.full_name || t.lead.username) : '-';
    return '<tr>' +
      '<td>' + esc(t.title) + '</td>' +
      '<td>' + esc(lead) + '</td>' +
      '<td>' + esc(doerLabel(t)) + '</td>' +
      '<td>' + (t.deadline || '-') + '</td>' +
      '<td class="gv-cell-note">' + esc(clip(t.completed_text, 80)) + '</td>' +
      '<td class="gv-cell-note">' + esc(clip(t.incomplete_text, 80)) + '</td>' +
      '<td class="gv-cell-note">' + esc(clip(t.reason_text, 60)) + '</td>' +
      '<td><span class="gv-rag gv-rag-' + rag + '"></span>' + (t.progress_pct || 0) + '%</td>' +
      '<td>' + work + '</td>' + secret +
      '<td style="white-space:nowrap">' + actionBtns(t) + '</td></tr>';
  }

  function renderGroups() {
    var see = canSeeLeader();
    var groups = (state.board && state.board.groups) || [];
    var orphans = (state.board && state.board.orphan_children) || [];
    var box = $('groupList');
    if (!groups.length && !orphans.length) {
      box.innerHTML = '<p class="gv-empty">' + T('emptyInbox') + '</p>';
      return;
    }
    var html = groups.map(function (g) {
      var p = g.parent || {};
      var kids = g.children || [];
      var cascadeBtn = '';
      if (p.can_cascade) {
        cascadeBtn += '<button type="button" class="gv-btn gv-btn-sm gv-btn-primary" data-cascade="' + p.id + '">' + T('btnCascade') + '</button> ';
      }
      if (p.can_edit) {
        cascadeBtn += '<button type="button" class="gv-btn gv-btn-sm gv-btn-outline" data-edit="' + p.id + '">' + T('btnEdit') + '</button> ';
        cascadeBtn += '<button type="button" class="gv-btn gv-btn-sm gv-btn-outline" data-del="' + p.id + '">' + T('btnDelete') + '</button>';
      }
      var head = '<div class="gv-group">' +
        '<div class="gv-group-head">' +
          '<div><span class="gv-pill">' + T('fromDirector') + '</span> ' +
          '<strong>' + esc(p.title) + '</strong>' +
          '<div class="gv-week-card-meta">' + esc(deptName(p.department_id)) +
            (p.deadline ? ' ? han ' + p.deadline : '') +
            ' ? ' + (p.progress_pct || 0) + '%</div>' +
          (p.description ? '<div class="gv-week-card-meta">' + esc(p.description) + '</div>' : '') +
          '</div><div>' + cascadeBtn + '</div></div>';
      if (!kids.length) {
        return head + '<p class="gv-empty" style="padding:12px">' + T('emptyCascade') + '</p></div>';
      }
      return head +
        '<div class="gv-table-wrap" style="border:0;border-radius:0">' +
        '<table class="gv-table"><thead><tr>' +
        '<th>' + T('colTask') + '</th><th>' + T('colLeadPerson') + '</th><th>' + T('colDoer') + '</th><th>' + T('colDeadline') + '</th>' +
        '<th>' + T('colDone') + '</th><th>' + T('colUndone') + '</th><th>' + T('colReason') + '</th>' +
        '<th>' + T('colPct') + '</th><th>' + T('colScore') + '</th>' +
        (see ? '<th>' + T('colSecret') + '</th>' : '') + '<th></th></tr></thead><tbody>' +
        kids.map(function (c) { return childRow(c, see); }).join('') +
        '</tbody></table></div></div>';
    }).join('');
    box.innerHTML = html;
  }

  function renderBoard() {
    var dept = state.level === 'dept';
    $('tableWrap').hidden = dept;
    $('groupList').hidden = !dept;
    if (dept) renderGroups();
    else renderTable();
  }

  async function loadBoard() {
    if (!state.week) return;
    var body = await api('/weeks/' + state.week.id + '/board?level=' + state.level);
    state.board = body;
    renderHead(); renderStats(); renderBoard();
  }

  function staffForLead() {
    return (state.staff || []).filter(function (s) {
      return s.role !== 'director';
    });
  }

  function fillParentFromSelect() {
    var pid = $('fParent').value;
    var p = (parentOptions() || []).find(function (x) { return x && x.id === pid; });
    if (!p) return;
    $('fDept').value = p.department_id || '';
    if (!$('fTitle').value) $('fTitle').value = p.title || '';
    if (!$('fDesc').value) $('fDesc').value = p.description || '';
    if (!$('fDeadline').value && p.deadline) $('fDeadline').value = p.deadline;
  }

  function setupAssignForm(parentId, editTask) {
    state.editTaskId = editTask ? editTask.id : null;
    var isCenterTask = editTask ? (editTask.level === 'center') : (state.level === 'center');
    $('assignTitle').textContent = editTask
      ? T('editTitle')
      : (isCenterTask ? T('assignCenter') : T('assignDept'));
    $('assignHint').textContent = isCenterTask ? T('hintAssignCenter') : T('hintAssignDept');
    $('lblDept').textContent = isCenterTask ? T('lblDeptCenter') : T('lblDept');
    $('wrapLead').hidden = isCenterTask;
    $('wrapParent').hidden = isCenterTask;
    $('wrapDept').hidden = !isCenterTask;
    $('fTitle').value = '';
    $('fDesc').value = '';
    $('fDoers').value = '';
    $('fDeadline').value = '';
    $('fDept').value = '';
    fillSelect($('fDept'), state.departments, 'id', 'name', true, T('pickDept'));
    if (!isCenterTask) {
      var inbox = parentOptions() || [];
      var opts = inbox.map(function (p) {
        return { id: p.id, label: (deptName(p.department_id) + ' | ' + (p.title || '')) };
      });
      fillSelect($('fParent'), opts, 'id', 'label', true, T('pickParent'));
      fillSelect($('fLead'), staffForLead(), 'username', 'full_name', true, T('pickPerson'));
      $('fLead').value = '';
      $('fParent').onchange = fillParentFromSelect;
    }
    if (editTask) {
      $('fTitle').value = editTask.title || '';
      $('fDesc').value = editTask.description || '';
      $('fDoers').value = editTask.doer_text || '';
      $('fDeadline').value = editTask.deadline || '';
      $('fDept').value = editTask.department_id || '';
      if (!isCenterTask) {
        $('fParent').value = editTask.parent_id || parentId || '';
        if (editTask.lead && editTask.lead.username) $('fLead').value = editTask.lead.username;
      }
    } else if (!isCenterTask && parentId) {
      $('fParent').value = parentId;
      fillParentFromSelect();
    }
  }

  async function boot() {
    if (typeof Auth !== 'undefined' && Auth.restoreSession) Auth.restoreSession();
    if (!username()) { location.href = '/'; return; }
    try {
      var ctx = await api('/context');
      state.perms = ctx.permissions || {};
      state.user = ctx.user || {};
      if (state.perms.is_deputy || state.perms.is_head) {
        state.level = 'dept';
        document.querySelectorAll('.gv-tab').forEach(function (b) {
          b.classList.toggle('is-active', b.dataset.level === state.level);
        });
      }
      state.departments = ctx.departments || [];
      state.staff = ctx.staff || [];
      state.week = ctx.current_week;
      var w = await api('/weeks');
      state.weeks = w.weeks || [];
      if (!state.week && state.weeks[0]) state.week = state.weeks[0];
      fillSelect($('fDept'), state.departments, 'id', 'name', true, T('pickDept'));
      fillSelect($('fNoteDept'), state.departments, 'id', 'name');
      fillSelect($('fLead'), staffForLead(), 'username', 'full_name', true, T('pickPerson'));
      fillSelect($('fNoteUser'), state.staff, 'username', 'full_name');
      fillDatalist();
      renderWeeks();
      await loadBoard();
    } catch (e) {
      toast(e.message || String(e), true);
      $('weekList').innerHTML = '<p class="gv-empty">' + esc(e.message) + '</p>';
    }
  }

  function renderStaffTable() {
    var roleLb = { director: T('roleDir'), deputy: T('roleDeputy'), head: T('roleHead'), staff: T('roleStaff') };
    $('staffBody').innerHTML = (state.staff || []).map(function (s) {
      return '<tr><td>' + esc(s.username) + '</td><td>' + esc(s.full_name) + '</td><td>' +
        esc(deptName(s.department_id)) + '</td><td>' + (roleLb[s.role] || s.role) + '</td></tr>';
    }).join('');
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.id === 'btnHome') location.href = '/';
    if (t.dataset && t.dataset.close) closeM(t.dataset.close);
    if (t.classList.contains('gv-week-card')) {
      var id = t.getAttribute('data-id');
      state.week = state.weeks.find(function (w) { return w.id === id; });
      renderWeeks();
      loadBoard().catch(function (err) { toast(err.message, true); });
    }
    if (t.dataset && t.dataset.level) {
      state.level = t.dataset.level;
      document.querySelectorAll('.gv-tab').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.level === state.level);
      });
      loadBoard().catch(function (err) { toast(err.message, true); });
    }
    if (t.id === 'btnAssign') {
      if (state.level === 'dept' && !(parentOptions() || []).length) {
        toast(T('needParent'), true);
        return;
      }
      setupAssignForm();
      openM('modalAssign');
    }
    if (t.dataset && t.dataset.cascade) {
      setupAssignForm(t.dataset.cascade);
      openM('modalAssign');
    }
    if (t.dataset && t.dataset.edit) {
      var et = findTask(t.dataset.edit);
      if (!et) return;
      setupAssignForm(et.parent_id, et);
      openM('modalAssign');
    }
    if (t.dataset && t.dataset.del) {
      if (!window.confirm(T('confirmDelete'))) return;
      api('/tasks/' + t.dataset.del, { method: 'DELETE' })
        .then(function () { toast(T('okDelete')); return loadBoard(); })
        .catch(function (err) { toast(err.message, true); });
    }
    if (t.id === 'btnStaff') { renderStaffTable(); openM('modalStaff'); }
    if (t.id === 'btnLeaderNote') {
      $('wrapNoteDept').hidden = state.level === 'center';
      openM('modalLeader');
    }
    if (t.dataset && t.dataset.report) {
      state.reportTaskId = t.dataset.report;
      var task = findTask(state.reportTaskId);
      $('reportTaskTitle').textContent = task ? task.title : '';
      $('fPct').value = task ? (task.progress_pct || 0) : 0;
      $('fDone').value = task ? (task.completed_text || '') : '';
      $('fUndone').value = task ? (task.incomplete_text || '') : '';
      $('fReason').value = task ? (task.reason_text || '') : '';
      openM('modalReport');
    }
    if (t.dataset && t.dataset.score) {
      state.scoreTaskId = t.dataset.score;
      var ts = findTask(state.scoreTaskId);
      $('scoreTaskTitle').textContent = ts ? ts.title : '';
      $('fWorkScore').value = (ts && ts.work_score) || '';
      $('fWorkCmt').value = (ts && ts.work_comment) || '';
      openM('modalScore');
    }
    if (t.id === 'btnNewWeek') {
      api('/weeks', { method: 'POST', body: '{}' }).then(function () { return boot(); })
        .then(function () { toast(T('okWeek')); })
        .catch(function (err) { toast(err.message, true); });
    }
  });

  function bind(id, fn) {
    var el = $(id);
    if (el) el.onclick = fn;
  }

  bind('btnSaveAssign', function () {
    var doerText = ($('fDoers').value || '').trim();
    var editing = state.editTaskId ? findTask(state.editTaskId) : null;
    var isCenter = editing ? (editing.level === 'center') : (state.level === 'center');
    var payload = {
      week_id: state.week.id,
      level: isCenter ? 'center' : 'dept',
      title: $('fTitle').value.trim(),
      description: $('fDesc').value.trim(),
      department_id: $('fDept').value || null,
      deadline: $('fDeadline').value || null,
      doer_text: doerText,
      doers: []
    };
    if (!isCenter) {
      var u = $('fLead').value;
      var st = state.staff.find(function (s) { return s.username === u; });
      payload.lead = u ? { username: u, full_name: st ? st.full_name : u } : null;
      payload.parent_id = $('fParent').value || null;
      var p = (parentOptions() || []).find(function (x) { return x && x.id === payload.parent_id; });
      if (p) payload.department_id = p.department_id;
    }
    var path = state.editTaskId ? ('/tasks/' + state.editTaskId) : '/tasks';
    var method = state.editTaskId ? 'PATCH' : 'POST';
    api(path, { method: method, body: JSON.stringify(payload) })
      .then(function () {
        closeM('modalAssign');
        state.editTaskId = null;
        toast(T(method === 'PATCH' ? 'okEdit' : 'okAssign'));
        return loadBoard();
      })
      .catch(function (err) { toast(err.message, true); });
  });

  bind('btnSaveReport', function () {
    api('/tasks/' + state.reportTaskId + '/report', {
      method: 'POST',
      body: JSON.stringify({
        progress_pct: Number($('fPct').value || 0),
        completed_text: $('fDone').value,
        incomplete_text: $('fUndone').value,
        reason_text: $('fReason').value
      })
    }).then(function () { closeM('modalReport'); toast(T('okReport')); return loadBoard(); })
      .catch(function (err) { toast(err.message, true); });
  });

  bind('btnSaveScore', function () {
    api('/tasks/' + state.scoreTaskId + '/work-score', {
      method: 'PUT',
      body: JSON.stringify({
        work_score: $('fWorkScore').value ? Number($('fWorkScore').value) : null,
        work_comment: $('fWorkCmt').value
      })
    }).then(function () { closeM('modalScore'); toast(T('okScore')); return loadBoard(); })
      .catch(function (err) { toast(err.message, true); });
  });

  bind('btnSaveLeader', function () {
    var u = $('fNoteUser').value;
    var st = state.staff.find(function (s) { return s.username === u; });
    api('/leader-notes', {
      method: 'PUT',
      body: JSON.stringify({
        week_id: state.week.id,
        scope: state.level === 'center' ? 'center' : 'dept',
        department_id: state.level === 'dept' ? ($('fNoteDept').value || state.perms.department_id) : (st && st.department_id) || null,
        username: u,
        full_name: st ? st.full_name : u,
        support_score: $('fSupport').value ? Number($('fSupport').value) : null,
        initiative_score: $('fInit').value ? Number($('fInit').value) : null,
        note: $('fLeadNote').value
      })
    }).then(function () { closeM('modalLeader'); toast(T('okNote')); return loadBoard(); })
      .catch(function (err) { toast(err.message, true); });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
