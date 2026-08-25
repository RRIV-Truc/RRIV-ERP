/* main.js — TBKL dashboard */
(function () {
  'use strict';

  var state = {
    cycles: [],
    currentCycleId: null,
    dashboard: null,
    departments: [],
    permissions: {},
    filterRag: '',
    search: ''
  };

  function $(id) { return document.getElementById(id); }

  function showToast(msg, isError) {
    var el = $('tbklToast');
    if (!el) return;
    el.textContent = msg;
    el.style.background = isError ? '#dc2626' : '#064e3b';
    el.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.hidden = true; }, 3500);
  }

  function openModal(id) { var m = $(id); if (m) m.hidden = false; }
  function closeModal(id) { var m = $(id); if (m) m.hidden = true; }

  function ragClass(rag) {
    return 'tbkl-rag tbkl-rag-' + (rag || 'gray');
  }

  function fmtDate(d) {
    if (!d) return '—';
    try {
      var p = String(d).slice(0, 10).split('-');
      return p[2] + '/' + p[1] + '/' + p[0];
    } catch (_) { return d; }
  }

  function renderUserChip() {
    var user = TbklPermissions.getUser();
    var chip = $('userChip');
    if (!chip || !user) return;
    var name = user.fullName || user.full_name || user.username || '?';
    chip.querySelector('.tbkl-user-name').textContent = name;
    chip.querySelector('.tbkl-avatar').textContent = name.charAt(0).toUpperCase();
  }

  function fillDeptSelects() {
    var selects = ['directiveDeptSelect', 'taskOwnerSelect'];
    selects.forEach(function (sid) {
      var sel = $(sid);
      if (!sel) return;
      var first = sel.options[0];
      sel.innerHTML = '';
      if (first) sel.appendChild(first);
      state.departments.forEach(function (d) {
        var opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        opt.dataset.name = d.name;
        sel.appendChild(opt);
      });
    });
  }

  function renderCycleSelect() {
    var sel = $('cycleSelect');
    if (!sel) return;
    sel.innerHTML = '';
    if (!state.cycles.length) {
      var o = document.createElement('option');
      o.value = '';
      o.textContent = '— Chưa có cuộc họp —';
      sel.appendChild(o);
      return;
    }
    state.cycles.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      var label = 'H' + c.meeting_seq + ' — ' + (c.title || 'Cuộc họp');
      if (c.status === 'locked') label += ' 🔒';
      opt.textContent = label;
      sel.appendChild(opt);
    });
    if (state.currentCycleId) sel.value = state.currentCycleId;
  }

  function applyFilters(rows) {
    var q = (state.search || '').toLowerCase();
    var rag = state.filterRag;
    return rows.filter(function (r) {
      if (rag && r.rag !== rag) return false;
      if (!q) return true;
      var blob = [
        r.task_code, r.directive_code, r.task_title, r.directive_title,
        r.owner_unit_name, r.lead_department_name, r.difficulties, r.solution
      ].join(' ').toLowerCase();
      return blob.indexOf(q) >= 0;
    });
  }

  function renderSummary(summary) {
    summary = summary || { green: 0, yellow: 0, red: 0, gray: 0 };
    $('statGreen').textContent = summary.green || 0;
    $('statYellow').textContent = summary.yellow || 0;
    $('statRed').textContent = summary.red || 0;
    $('statGray').textContent = summary.gray || 0;
  }

  function renderTable(rows) {
    var tbody = $('taskTableBody');
    if (!tbody) return;
    var filtered = applyFilters(rows || []);
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="tbkl-empty">' +
        (rows && rows.length ? 'Không có dòng phù hợp bộ lọc' : 'Chưa có đầu việc — Phòng NV thêm kết luận và giao việc') +
        '</td></tr>';
      return;
    }
    tbody.innerHTML = filtered.map(function (r) {
      var note = [r.difficulties, r.solution].filter(Boolean).join(' → ');
      var reportBtn = r.can_report && !r.report_locked
        ? '<button type="button" class="tbkl-btn tbkl-btn-sm tbkl-btn-primary" data-report="' + r.task_id + '">Báo cáo</button>'
        : (r.report_locked ? '<span class="tbkl-note">Đã chốt</span>' : '');
      return '<tr data-rag="' + r.rag + '">' +
        '<td><span class="' + ragClass(r.rag) + '" title="' + r.rag + '"></span></td>' +
        '<td><span class="tbkl-code">' + escapeHtml(r.task_code || '') + '</span>' +
          '<div class="tbkl-dir-ref">' + escapeHtml(r.directive_code || '') + '</div></td>' +
        '<td><div class="tbkl-task-title">' + escapeHtml(r.task_title || '') + '</div>' +
          '<div class="tbkl-dir-ref">' + escapeHtml(r.directive_title || '') + '</div></td>' +
        '<td>' + escapeHtml(r.lead_department_name || '—') + '</td>' +
        '<td>' + escapeHtml(r.owner_unit_name || '—') + '</td>' +
        '<td>' + fmtDate(r.deadline) + '</td>' +
        '<td><strong>' + Math.round(r.progress_pct || 0) + '%</strong>' +
          '<div class="tbkl-progress-bar"><div class="tbkl-progress-fill" style="width:' +
          Math.min(100, r.progress_pct || 0) + '%"></div></div></td>' +
        '<td>' + escapeHtml(r.status_label || '—') + '</td>' +
        '<td class="tbkl-note">' + escapeHtml(note || '—') + '</td>' +
        '<td>' + reportBtn + '</td></tr>';
    }).join('');

    tbody.querySelectorAll('[data-report]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openReportModal(btn.getAttribute('data-report'));
      });
    });
  }

  function renderDirectives(directives) {
    var panel = $('directivesPanel');
    var list = $('directivesList');
    if (!panel || !list || !directives || !directives.length) {
      if (panel) panel.hidden = true;
      return;
    }
    panel.hidden = false;
    list.innerHTML = directives.map(function (d) {
      return '<article class="tbkl-dir-card">' +
        '<div class="tbkl-dir-card-head">' +
        '<span class="' + ragClass(d.rag) + '"></span>' +
        '<span class="tbkl-code">' + escapeHtml(d.code || '') + '</span></div>' +
        '<div class="tbkl-dir-card-title">' + escapeHtml(d.title || d.content || '') + '</div>' +
        '<div class="tbkl-note">' + (d.task_count || 0) + ' đầu việc · TB ' +
        Math.round(d.avg_progress || 0) + '%</div></article>';
    }).join('');
  }

  function fillDirectiveSelect(directives) {
    var sel = $('taskDirectiveSelect');
    if (!sel) return;
    sel.innerHTML = '';
    (directives || []).forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = (d.code || '') + ' — ' + (d.title || '').slice(0, 60);
      sel.appendChild(opt);
    });
  }

  function updateToolbar(perms, cycle) {
    var manage = $('manageActions');
    var lockBtn = $('btnLockCycle');
    if (manage) manage.hidden = !perms.can_manage;
    if (lockBtn) {
      lockBtn.hidden = !(perms.can_lock && cycle && cycle.status !== 'locked');
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadDashboard(cycleId) {
    if (!cycleId) return;
    state.currentCycleId = cycleId;
    $('taskTableBody').innerHTML = '<tr><td colspan="10" class="tbkl-empty">Đang tải…</td></tr>';
    try {
      var data = await TbklServices.getDashboard(cycleId);
      state.dashboard = data;
      state.permissions = data.permissions || {};
      $('weekBadge').textContent = 'Tuần ' + (data.week_label || '—');
      renderSummary(data.summary);
      renderTable(data.rows || []);
      renderDirectives(data.directives || []);
      fillDirectiveSelect(data.directives || []);
      updateToolbar(state.permissions, data.cycle);
    } catch (err) {
      showToast(err.message || 'Lỗi tải dashboard', true);
      $('taskTableBody').innerHTML = '<tr><td colspan="10" class="tbkl-empty">' +
        escapeHtml(err.message) + '</td></tr>';
    }
  }

  async function refreshCycles(selectId) {
    var res = await TbklServices.listCycles();
    state.cycles = res.cycles || [];
    renderCycleSelect();
    var id = selectId || state.currentCycleId || (state.cycles[0] && state.cycles[0].id);
    if (id) {
      state.currentCycleId = id;
      $('cycleSelect').value = id;
      await loadDashboard(id);
    }
  }

  function openReportModal(taskId) {
    var row = (state.dashboard && state.dashboard.rows || []).find(function (r) {
      return r.task_id === taskId;
    });
    if (!row) return;
    $('reportTaskId').value = taskId;
    $('reportMeta').textContent = row.task_code + ' — ' + row.task_title;
    $('reportModalTitle').textContent = 'Báo cáo tuần ' + (state.dashboard.week_label || '');
    var form = $('formReport');
    form.progress_pct.value = row.progress_pct || 0;
    form.status.value = row.status || 'in_progress';
    form.difficulties.value = row.difficulties || '';
    form.solution.value = row.solution || '';
    form.recommendation.value = row.recommendation || '';
    openModal('modalReport');
  }

  function bindEvents() {
    $('btnHome').addEventListener('click', function () { window.location.href = '/'; });

    $('cycleSelect').addEventListener('change', function () {
      loadDashboard(this.value);
    });

    $('searchInput').addEventListener('input', function () {
      state.search = this.value;
      if (state.dashboard) renderTable(state.dashboard.rows);
    });

    $('ragFilter').addEventListener('change', function () {
      state.filterRag = this.value;
      if (state.dashboard) renderTable(state.dashboard.rows);
    });

    document.querySelectorAll('.tbkl-stat[data-filter]').forEach(function (card) {
      card.addEventListener('click', function () {
        var f = card.getAttribute('data-filter');
        state.filterRag = state.filterRag === f ? '' : f;
        $('ragFilter').value = state.filterRag;
        if (state.dashboard) renderTable(state.dashboard.rows);
      });
    });

    document.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', function () {
        closeModal(el.getAttribute('data-close'));
      });
    });

    $('btnNewCycle').addEventListener('click', function () { openModal('modalCycle'); });
    $('btnAddDirective').addEventListener('click', function () {
      if (!state.currentCycleId) { showToast('Chọn hoặc tạo cuộc họp trước', true); return; }
      openModal('modalDirective');
    });
    $('btnAddTask').addEventListener('click', function () {
      if (!state.dashboard || !(state.dashboard.directives || []).length) {
        showToast('Thêm kết luận trước khi giao đầu việc', true); return;
      }
      openModal('modalTask');
    });

    $('btnLockCycle').addEventListener('click', async function () {
      if (!state.currentCycleId) return;
      if (!confirm('Chốt báo cáo tuần cho toàn bộ đầu việc cuộc họp này?')) return;
      try {
        await TbklServices.lockCycle(state.currentCycleId);
        showToast('Đã chốt báo cáo tuần');
        await refreshCycles(state.currentCycleId);
      } catch (err) { showToast(err.message, true); }
    });

    $('formCycle').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var payload = {
        title: fd.get('title'),
        meeting_date: fd.get('meeting_date') || null,
        source_ref: fd.get('source_ref'),
        conclusion_summary: fd.get('conclusion_summary')
      };
      var seq = fd.get('meeting_seq');
      if (seq) payload.meeting_seq = parseInt(seq, 10);
      try {
        var res = await TbklServices.createCycle(payload);
        closeModal('modalCycle');
        e.target.reset();
        showToast('Đã tạo cuộc họp H' + res.cycle.meeting_seq);
        await refreshCycles(res.cycle.id);
      } catch (err) { showToast(err.message, true); }
    });

    $('formDirective').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var deptSel = $('directiveDeptSelect');
      var deptOpt = deptSel.options[deptSel.selectedIndex];
      var payload = {
        title: fd.get('title'),
        content: fd.get('content'),
        lead_department_id: fd.get('lead_department_id') || null,
        lead_department_name: deptOpt && deptOpt.dataset.name ? deptOpt.dataset.name : deptOpt.textContent,
        supervisor_name: fd.get('supervisor_name'),
        priority: fd.get('priority'),
        deadline: fd.get('deadline') || null
      };
      try {
        await TbklServices.createDirective(state.currentCycleId, payload);
        closeModal('modalDirective');
        e.target.reset();
        showToast('Đã thêm kết luận');
        await loadDashboard(state.currentCycleId);
      } catch (err) { showToast(err.message, true); }
    });

    $('formTask').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var ownerSel = $('taskOwnerSelect');
      var ownerOpt = ownerSel.options[ownerSel.selectedIndex];
      var payload = {
        title: fd.get('title'),
        deliverable: fd.get('deliverable'),
        owner_unit_id: fd.get('owner_unit_id') || null,
        owner_unit_name: ownerOpt && ownerOpt.dataset.name ? ownerOpt.dataset.name : ownerOpt.textContent,
        coordinator_units: fd.get('coordinator_units'),
        assignee_name: fd.get('assignee_name'),
        deadline: fd.get('deadline') || null,
        priority: fd.get('priority')
      };
      var dirId = fd.get('directive_id');
      try {
        await TbklServices.createTask(dirId, payload);
        closeModal('modalTask');
        e.target.reset();
        showToast('Đã thêm đầu việc');
        await loadDashboard(state.currentCycleId);
      } catch (err) { showToast(err.message, true); }
    });

    $('formReport').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var taskId = fd.get('task_id');
      var payload = {
        progress_pct: parseFloat(fd.get('progress_pct') || 0),
        status: fd.get('status'),
        difficulties: fd.get('difficulties'),
        solution: fd.get('solution'),
        recommendation: fd.get('recommendation')
      };
      try {
        await TbklServices.submitReport(taskId, payload);
        closeModal('modalReport');
        showToast('Đã gửi báo cáo tuần');
        await loadDashboard(state.currentCycleId);
      } catch (err) { showToast(err.message, true); }
    });
  }

  async function init() {
    if (!Auth.restoreSession() && !TbklPermissions.getUser()) {
      window.location.href = '/';
      return;
    }
    if (!TbklPermissions.canAccessApp()) {
      alert('Bạn chưa được cấp quyền app Theo dõi KL họp. Liên hệ Phòng NV / Quản trị.');
      window.location.href = '/';
      return;
    }
    renderUserChip();
    bindEvents();
    try {
      state.departments = await TbklServices.loadDepartments();
      fillDeptSelects();
      var ctx = await TbklServices.getContext();
      state.permissions = ctx.permissions || {};
      updateToolbar(state.permissions, null);
      await refreshCycles();
    } catch (err) {
      showToast(err.message || 'Không khởi tạo được TBKL', true);
      $('taskTableBody').innerHTML = '<tr><td colspan="10" class="tbkl-empty">' +
        escapeHtml(err.message) + '<br><small>Chạy schema-tbkl.sql trên Supabase nếu chưa có bảng.</small></td></tr>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
