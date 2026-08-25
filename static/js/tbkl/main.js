/* main.js — TBKL dashboard */
(function () {
  'use strict';

  var STORAGE_KEY = 'tbkl_selected_cycle';

  var state = {
    cycles: [],
    currentCycleId: null,
    dashboard: null,
    departments: [],
    permissions: {},
    user: {},
    viewMode: 'all',
    groupBy: 'directive',
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

  function isUnitView() {
    if (state.permissions.is_unit_only) return true;
    return state.viewMode === 'unit';
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
    ['directiveDeptSelect', 'taskOwnerSelect'].forEach(function (sid) {
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

  function renderMeetingList() {
    var list = $('meetingList');
    if (!list) return;
    if (!state.cycles.length) {
      list.innerHTML = '<p class="tbkl-empty-list">Chưa có cuộc họp nào.</p>';
      return;
    }
    list.innerHTML = state.cycles.map(function (c) {
      var active = c.id === state.currentCycleId ? ' is-active' : '';
      var status = c.status === 'locked' ? '🔒 Đã chốt' : 'Đang theo dõi';
      return '<button type="button" class="tbkl-meeting-card' + active + '" data-cycle-id="' + c.id + '">' +
        '<div class="tbkl-meeting-card-top">' +
        '<span class="tbkl-meeting-badge">H' + c.meeting_seq + '</span>' +
        '<span class="tbkl-meeting-status">' + status + '</span></div>' +
        '<div class="tbkl-meeting-card-title">' + escapeHtml(c.title || 'Cuộc họp') + '</div>' +
        '<div class="tbkl-meeting-card-meta">' +
        (c.meeting_date ? ('📅 ' + fmtDate(c.meeting_date) + ' · ') : '') +
        (c.directive_count || 0) + ' KL · ' + (c.task_count || 0) + ' đầu việc</div></button>';
    }).join('');

    list.querySelectorAll('[data-cycle-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectCycle(btn.getAttribute('data-cycle-id'));
      });
    });
  }

  function renderMeetingHead(cycle, data) {
    var head = $('meetingHead');
    if (!head || !cycle) { if (head) head.hidden = true; return; }
    head.hidden = false;
    $('meetingTitle').textContent = 'H' + cycle.meeting_seq + ' — ' + (cycle.title || 'Cuộc họp');
    var meta = [];
    if (cycle.meeting_date) meta.push('Ngày họp: ' + fmtDate(cycle.meeting_date));
    if (cycle.source_ref) meta.push(cycle.source_ref);
    meta.push((data.directives || []).length + ' kết luận · ' + (data.rows || []).length + ' dòng theo dõi');
    $('meetingMeta').textContent = meta.join(' · ');

    var tabs = $('viewTabs');
    if (tabs) {
      if (state.permissions.is_unit_only) {
        tabs.hidden = true;
      } else {
        tabs.hidden = false;
        tabs.querySelectorAll('.tbkl-tab').forEach(function (tab) {
          tab.classList.toggle('is-active', tab.getAttribute('data-view') === state.viewMode);
        });
      }
    }
  }

  function updateUnitBanner(data) {
    var banner = $('unitBanner');
    if (!banner) return;
    var show = isUnitView() && state.permissions.can_report;
    banner.hidden = !show;
    if (!show) return;
    var dept = (data && data.department_name) || state.user.department_name || 'đơn vị của bạn';
    var pending = (data && data.pending_report_count) || 0;
    $('unitBannerTitle').textContent = 'Báo cáo tuần — ' + dept + ' nhập liệu';
    $('unitBannerText').textContent = pending
      ? ('Còn ' + pending + ' đầu việc cần báo cáo tuần này. Bấm 「Nhập BC」 để cập nhật % tiến độ, khó khăn và giải pháp.')
      : 'Các đơn vị được giao việc tự nhập % tiến độ, khó khăn và giải pháp hàng tuần.';
  }

  function sortDirectives(list) {
    return (list || []).slice().sort(function (a, b) {
      return (a.seq_no || 999) - (b.seq_no || 999);
    });
  }

  function sortRows(list) {
    return (list || []).slice().sort(function (a, b) {
      var da = a.directive_seq_no || 999;
      var db = b.directive_seq_no || 999;
      if (da !== db) return da - db;
      return (a.task_seq_no || 999) - (b.task_seq_no || 999);
    });
  }

  function applyFilters(rows) {
    var q = (state.search || '').toLowerCase();
    var rag = state.filterRag;
    return (rows || []).filter(function (r) {
      if (rag && r.rag !== rag) return false;
      if (!q) return true;
      var blob = [
        r.task_code, r.directive_code, r.task_title, r.directive_title,
        r.owner_unit_name, r.lead_department_name, r.difficulties, r.solution
      ].join(' ').toLowerCase();
      return blob.indexOf(q) >= 0;
    });
  }

  function compareTaskCode(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'vi', { numeric: true });
  }

  function sortRowsForDisplay(rows) {
    var list = applyFilters(rows);
    if (state.groupBy === 'task') {
      return list.slice().sort(function (a, b) { return compareTaskCode(a.task_code, b.task_code); });
    }
    if (state.groupBy === 'lead_dept') {
      return list.slice().sort(function (a, b) {
        var la = (a.lead_department_name || 'zzz').toLocaleLowerCase('vi');
        var lb = (b.lead_department_name || 'zzz').toLocaleLowerCase('vi');
        if (la !== lb) return la.localeCompare(lb, 'vi');
        var da = (a.directive_seq_no || 999) - (b.directive_seq_no || 999);
        if (da) return da;
        return (a.task_seq_no || 999) - (b.task_seq_no || 999);
      });
    }
    if (state.groupBy === 'owner_unit') {
      return list.slice().sort(function (a, b) {
        var la = (a.owner_unit_name || 'zzz').toLocaleLowerCase('vi');
        var lb = (b.owner_unit_name || 'zzz').toLocaleLowerCase('vi');
        if (la !== lb) return la.localeCompare(lb, 'vi');
        var da = a.directive_seq_no - b.directive_seq_no;
        if (da) return da;
        return (a.task_seq_no || 0) - (b.task_seq_no || 0);
      });
    }
    return sortRows(list);
  }

  function groupLabel(r) {
    if (state.groupBy === 'lead_dept') {
      return r.lead_department_name || '— Chưa gán phòng chủ trì —';
    }
    if (state.groupBy === 'owner_unit') {
      return r.owner_unit_name || '— Chưa gán đơn vị TH —';
    }
    if (state.groupBy === 'directive') {
      return (r.directive_code || '') + ' — ' + (r.directive_title || '');
    }
    return null;
  }

  function groupKey(r) {
    if (state.groupBy === 'task') return null;
    if (state.groupBy === 'lead_dept') return r.lead_department_name || '__none_lead__';
    if (state.groupBy === 'owner_unit') return r.owner_unit_name || '__none_owner__';
    return r.directive_id;
  }

  function renderSummary(summary) {
    summary = summary || { green: 0, yellow: 0, red: 0, gray: 0 };
    $('statGreen').textContent = summary.green || 0;
    $('statYellow').textContent = summary.yellow || 0;
    $('statRed').textContent = summary.red || 0;
    $('statGray').textContent = summary.gray || 0;
  }

  function renderConclusionList(cycle, directives) {
    var zone = $('zoneConclusions');
    var list = $('conclusionList');
    if (!zone || !list) return;
    var sorted = sortDirectives(directives);
    if (!sorted.length) {
      zone.hidden = true;
      return;
    }
    zone.hidden = false;
    var codeEl = $('overviewMeetingCode');
    if (codeEl && cycle) codeEl.textContent = 'H' + (cycle.meeting_seq || '');

    list.innerHTML = sorted.map(function (d) {
      var excerpt = (d.content || d.title || '').slice(0, 220);
      if ((d.content || d.title || '').length > 220) excerpt += '…';
      var meta = [];
      if (d.lead_department_name) meta.push('Phòng CT: ' + d.lead_department_name);
      if (d.supervisor_name) meta.push('GS: ' + d.supervisor_name);
      if (d.deadline) meta.push('Hạn: ' + fmtDate(d.deadline));
      return '<button type="button" class="tbkl-conclusion-item" data-directive-id="' + d.id + '">' +
        '<div class="tbkl-conclusion-code-col">' +
        '<div class="tbkl-conclusion-code">' + escapeHtml(d.code || '') + '</div>' +
        '<span class="' + ragClass(d.rag) + '" style="margin-top:8px;display:inline-block"></span></div>' +
        '<div class="tbkl-conclusion-body">' +
        '<h3>' + escapeHtml(d.title || '') + '</h3>' +
        '<p>' + escapeHtml(excerpt) + '</p>' +
        '<div class="tbkl-conclusion-meta">' + escapeHtml(meta.join(' · ')) + '</div></div>' +
        '<div class="tbkl-conclusion-side">' +
        '<div class="tbkl-conclusion-progress">' + Math.round(d.avg_progress || 0) + '%</div>' +
        '<div class="tbkl-conclusion-count">' + (d.task_count || 0) + ' đầu việc</div></div></button>';
    }).join('');

    list.querySelectorAll('[data-directive-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.groupBy = 'directive';
        var sel = $('groupBySelect');
        if (sel) sel.value = 'directive';
        var id = btn.getAttribute('data-directive-id');
        var details = $('zoneDetails');
        if (details) details.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(function () {
          var target = document.getElementById('dir-group-' + id);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 350);
      });
    });
  }

  function renderTable(rows) {
    var tbody = $('taskTableBody');
    if (!tbody) return;
    var unitMode = isUnitView();
    var filtered = sortRowsForDisplay(rows || []);
    var detailsZone = $('zoneDetails');
    if (detailsZone) detailsZone.hidden = !(rows && rows.length);

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="tbkl-empty">' +
        (rows && rows.length
          ? 'Không có dòng phù hợp bộ lọc'
          : (unitMode
            ? 'Không có đầu việc được giao cho đơn vị bạn trong cuộc họp này'
            : 'Chưa có đầu việc — Phòng NV thêm kết luận và giao việc cho đơn vị')) +
        '</td></tr>';
      return;
    }

    var html = '';
    var lastGroup = null;
    filtered.forEach(function (r) {
      var gk = groupKey(r);
      if (gk !== null && gk !== lastGroup) {
        lastGroup = gk;
        var rowClass = state.groupBy === 'owner_unit' || state.groupBy === 'lead_dept'
          ? 'tbkl-group-row tbkl-group-row-unit' : 'tbkl-group-row';
        var anchor = state.groupBy === 'directive' ? (' id="dir-group-' + r.directive_id + '"') : '';
        var prefix = state.groupBy === 'directive'
          ? ('<span class="tbkl-group-code">' + escapeHtml(r.directive_code || '') + '</span>')
          : '';
        html += '<tr class="' + rowClass + '"' + anchor + '><td colspan="10">' +
          prefix + escapeHtml(groupLabel(r) || '') + '</td></tr>';
      }
      var note = [r.difficulties, r.solution].filter(Boolean).join(' → ');
      var reportBtn = '';
      if (r.can_report && !r.report_locked) {
        reportBtn = '<button type="button" class="tbkl-btn tbkl-btn-sm tbkl-btn-primary" data-report="' +
          r.task_id + '">' + (unitMode ? 'Nhập BC' : 'Báo cáo') + '</button>';
      } else if (r.report_locked) {
        reportBtn = '<span class="tbkl-note">Đã chốt</span>';
      } else if (unitMode) {
        reportBtn = '<span class="tbkl-note">Chỉ đơn vị TH</span>';
      }
      html += '<tr data-rag="' + r.rag + '">' +
        '<td><span class="' + ragClass(r.rag) + '"></span></td>' +
        '<td><span class="tbkl-code">' + escapeHtml(r.task_code || '') + '</span>' +
          (state.groupBy !== 'directive'
            ? ('<div class="tbkl-dir-ref">' + escapeHtml(r.directive_code || '') + '</div>') : '') +
        '</td>' +
        '<td><div class="tbkl-task-title">' + escapeHtml(r.task_title || '') + '</div>' +
          (state.groupBy === 'task'
            ? ('<div class="tbkl-dir-ref">' + escapeHtml(r.directive_code || '') + ' — ' +
              escapeHtml((r.directive_title || '').slice(0, 80)) + '</div>') : '') +
          (r.deliverable ? '<div class="tbkl-dir-ref">SP: ' + escapeHtml(r.deliverable) + '</div>' : '') +
        '</td>' +
        '<td>' + escapeHtml(r.lead_department_name || '—') + '</td>' +
        '<td>' + escapeHtml(r.owner_unit_name || '—') + '</td>' +
        '<td>' + fmtDate(r.deadline) + '</td>' +
        '<td><strong>' + Math.round(r.progress_pct || 0) + '%</strong>' +
          '<div class="tbkl-progress-bar"><div class="tbkl-progress-fill" style="width:' +
          Math.min(100, r.progress_pct || 0) + '%"></div></div></td>' +
        '<td>' + escapeHtml(r.status_label || '—') + '</td>' +
        '<td class="tbkl-note">' + escapeHtml(note || '—') + '</td>' +
        '<td>' + reportBtn + '</td></tr>';
    });
    tbody.innerHTML = html;

    tbody.querySelectorAll('[data-report]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openReportModal(btn.getAttribute('data-report'));
      });
    });
  }

  function fillDirectiveSelect(directives) {
    var sel = $('taskDirectiveSelect');
    if (!sel) return;
    sel.innerHTML = '';
    sortDirectives(directives).forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = (d.code || '') + ' — ' + (d.title || '').slice(0, 60);
      sel.appendChild(opt);
    });
  }

  function updateToolbar(perms, cycle) {
    var manage = $('manageActions');
    var lockBtn = $('btnLockCycle');
    var seedActions = $('seedActions');
    var btnSide = $('btnNewCycleSide');
    if (manage) manage.hidden = !perms.can_manage;
    if (btnSide) btnSide.hidden = !perms.can_manage;
    if (lockBtn) lockBtn.hidden = !(perms.can_lock && cycle && cycle.status !== 'locked');
    if (seedActions) seedActions.hidden = !perms.can_manage;
  }

  function updateSourceBanner(cycle) {
    var banner = $('sourceBanner');
    var detail = $('sourceDetail');
    var importBtn = $('btnImportSeed');
    if (!banner) return;
    if (cycle && (cycle.source_ref || cycle.conclusion_summary)) {
      banner.hidden = false;
      var parts = [];
      if (cycle.conclusion_summary) parts.push(cycle.conclusion_summary);
      if (cycle.source_ref) parts.push(cycle.source_ref);
      if (detail) detail.textContent = parts.join(' · ');
      if (importBtn) importBtn.hidden = true;
    } else if (state.permissions.can_manage && !state.cycles.length) {
      banner.hidden = false;
      if (detail) detail.textContent = 'Chưa có cuộc họp — nạp TB Viện trưởng 11/08/2026 hoặc tạo cuộc họp mới.';
      if (importBtn) importBtn.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  async function importDefaultSeed(replace) {
    try {
      var res = await TbklServices.importSeed('vien_truong_20260811', replace);
      showToast('Đã nạp H' + res.meeting_seq + ': ' + res.directive_count + ' kết luận, ' + res.task_count + ' đầu việc');
      await refreshCycles(res.cycle_id);
    } catch (err) {
      if (!replace && err.message && err.message.indexOf('đã tồn tại') >= 0) {
        if (confirm(err.message + '\n\nGhi đè dữ liệu cuộc họp H1?')) return importDefaultSeed(true);
        return;
      }
      showToast(err.message, true);
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function selectCycle(cycleId) {
    if (!cycleId) return;
    state.currentCycleId = cycleId;
    try { localStorage.setItem(STORAGE_KEY, cycleId); } catch (_) {}
    renderMeetingList();
    loadDashboard(cycleId);
  }

  async function loadDashboard(cycleId) {
    if (!cycleId) return;
    $('taskTableBody').innerHTML = '<tr><td colspan="10" class="tbkl-empty">Đang tải…</td></tr>';
    try {
      var data = await TbklServices.getDashboard(cycleId, isUnitView());
      state.dashboard = data;
      state.permissions = data.permissions || state.permissions;
      $('weekBadge').textContent = 'Tuần ' + (data.week_label || '—');
      renderMeetingHead(data.cycle, data);
      renderSummary(data.summary);
      renderConclusionList(data.cycle, data.directives || []);
      renderTable(data.rows || []);
      fillDirectiveSelect(data.directives || []);
      updateToolbar(state.permissions, data.cycle);
      updateSourceBanner(data.cycle);
      updateUnitBanner(data);
    } catch (err) {
      showToast(err.message || 'Lỗi tải dashboard', true);
      $('taskTableBody').innerHTML = '<tr><td colspan="10" class="tbkl-empty">' + escapeHtml(err.message) + '</td></tr>';
    }
  }

  async function refreshCycles(selectId) {
    var res = await TbklServices.listCycles();
    state.cycles = res.cycles || [];
    renderMeetingList();

    var stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (_) {}
    var id = selectId || state.currentCycleId || stored || (state.cycles[0] && state.cycles[0].id);

    if (id && state.cycles.some(function (c) { return c.id === id; })) {
      selectCycle(id);
    } else if (state.cycles.length) {
      selectCycle(state.cycles[0].id);
    } else {
      state.currentCycleId = null;
      $('meetingHead').hidden = true;
      updateSourceBanner(null);
      $('taskTableBody').innerHTML = '<tr><td colspan="10" class="tbkl-empty">Chưa có cuộc họp — Phòng NV tạo mới hoặc nạp TB mẫu.</td></tr>';
    }
  }

  function openReportModal(taskId) {
    var row = (state.dashboard && state.dashboard.rows || []).find(function (r) {
      return r.task_id === taskId;
    });
    if (!row) return;
    $('reportTaskId').value = taskId;
    $('reportMeta').textContent = (state.dashboard.meeting_label || '') + ' · ' + row.task_code + ' — ' + row.task_title;
    $('reportModalTitle').textContent = 'Đơn vị nhập báo cáo tuần ' + (state.dashboard.week_label || '');
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

    $('viewTabs').addEventListener('click', function (e) {
      var tab = e.target.closest('[data-view]');
      if (!tab || state.permissions.is_unit_only) return;
      state.viewMode = tab.getAttribute('data-view');
      if (state.currentCycleId) loadDashboard(state.currentCycleId);
    });

    $('searchInput').addEventListener('input', function () {
      state.search = this.value;
      if (state.dashboard) renderTable(state.dashboard.rows);
    });

    $('ragFilter').addEventListener('change', function () {
      state.filterRag = this.value;
      if (state.dashboard) renderTable(state.dashboard.rows);
    });

    $('groupBySelect').addEventListener('change', function () {
      state.groupBy = this.value || 'directive';
      if (state.dashboard) renderTable(state.dashboard.rows);
    });

    document.querySelectorAll('.tbkl-rag-total[data-filter]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var f = chip.getAttribute('data-filter');
        state.filterRag = state.filterRag === f ? '' : f;
        $('ragFilter').value = state.filterRag;
        if (state.dashboard) renderTable(state.dashboard.rows);
      });
    });

    document.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', function () { closeModal(el.getAttribute('data-close')); });
    });

    function openCycleModal() { openModal('modalCycle'); }
    $('btnNewCycle').addEventListener('click', openCycleModal);
    $('btnNewCycleSide').addEventListener('click', openCycleModal);

    $('btnAddDirective').addEventListener('click', function () {
      if (!state.currentCycleId) { showToast('Chọn cuộc họp bên trái trước', true); return; }
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

    $('btnImportSeed').addEventListener('click', function () {
      if (!confirm('Nạp 7 kết luận và ~18 đầu việc từ TB Viện trưởng 11/08/2026 vào cuộc họp H1?')) return;
      importDefaultSeed(false);
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
      try {
        await TbklServices.createDirective(state.currentCycleId, {
          title: fd.get('title'),
          content: fd.get('content'),
          lead_department_id: fd.get('lead_department_id') || null,
          lead_department_name: deptOpt && deptOpt.dataset.name ? deptOpt.dataset.name : deptOpt.textContent,
          supervisor_name: fd.get('supervisor_name'),
          priority: fd.get('priority'),
          deadline: fd.get('deadline') || null
        });
        closeModal('modalDirective');
        e.target.reset();
        showToast('Đã thêm kết luận vào ' + (state.dashboard && state.dashboard.meeting_label || 'cuộc họp'));
        await refreshCycles(state.currentCycleId);
      } catch (err) { showToast(err.message, true); }
    });

    $('formTask').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var ownerSel = $('taskOwnerSelect');
      var ownerOpt = ownerSel.options[ownerSel.selectedIndex];
      try {
        await TbklServices.createTask(fd.get('directive_id'), {
          title: fd.get('title'),
          deliverable: fd.get('deliverable'),
          owner_unit_id: fd.get('owner_unit_id') || null,
          owner_unit_name: ownerOpt && ownerOpt.dataset.name ? ownerOpt.dataset.name : ownerOpt.textContent,
          coordinator_units: fd.get('coordinator_units'),
          assignee_name: fd.get('assignee_name'),
          deadline: fd.get('deadline') || null,
          priority: fd.get('priority')
        });
        closeModal('modalTask');
        e.target.reset();
        showToast('Đã giao đầu việc cho đơn vị');
        await refreshCycles(state.currentCycleId);
      } catch (err) { showToast(err.message, true); }
    });

    $('formReport').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      try {
        await TbklServices.submitReport(fd.get('task_id'), {
          progress_pct: parseFloat(fd.get('progress_pct') || 0),
          status: fd.get('status'),
          difficulties: fd.get('difficulties'),
          solution: fd.get('solution'),
          recommendation: fd.get('recommendation')
        });
        closeModal('modalReport');
        showToast('Đã gửi báo cáo tuần của đơn vị');
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
      state.user = ctx.user || {};
      if (state.permissions.is_unit_only) state.viewMode = 'unit';
      updateToolbar(state.permissions, null);
      await refreshCycles();
    } catch (err) {
      showToast(err.message || 'Không khởi tạo được TBKL', true);
      $('taskTableBody').innerHTML = '<tr><td colspan="10" class="tbkl-empty">' +
        escapeHtml(err.message) + '</td></tr>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
