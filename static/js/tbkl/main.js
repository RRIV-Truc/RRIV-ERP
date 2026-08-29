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
    search: '',
    cyclePlanEditor: null,
    editPlanEditor: null,
    planTab: 'grid'
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
    var ou = window.TbklOrgUnits;
    if (!ou) return;
    ou.fillSelect($('directiveDeptSelect'), ou.sharedResponsibility(), '', '— Trách nhiệm chung —');
    ou.fillSelect($('taskOwnerSelect'), ou.executors(), '', '— Đơn vị TH —');
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
      return r.lead_department_name || '— Chưa gán trách nhiệm chung —';
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

  function conclusionSideHtml(d) {
    var khcnAssessed = d.is_assessed || (d.progress_pct != null && d.progress_pct > 0);
    var khcnPct = khcnAssessed ? Math.round(d.progress_pct || 0) : null;
    var vtPct = d.is_confirmed ? Math.round(d.confirmed_pct || 0) : null;

    function metricBlock(label, pct, statusLabel, emptyLabel, barExtra) {
      if (pct == null) {
        return '<div class="tbkl-conclusion-metric tbkl-conclusion-metric-empty">' +
          '<span class="tbkl-conclusion-metric-label">' + label + '</span>' +
          '<span class="tbkl-conclusion-metric-empty-val">' + emptyLabel + '</span></div>';
      }
      return '<div class="tbkl-conclusion-metric">' +
        '<span class="tbkl-conclusion-metric-label">' + label + '</span>' +
        '<span class="tbkl-conclusion-metric-val">' + pct + '%</span>' +
        '<div class="tbkl-progress-bar tbkl-progress-bar-sm">' +
        '<div class="tbkl-progress-fill' + (barExtra || '') + '" style="width:' + Math.min(100, pct) + '%"></div></div>' +
        (statusLabel ? ('<span class="tbkl-conclusion-metric-status">' + escapeHtml(statusLabel) + '</span>') : '') +
        '</div>';
    }

    var khcnStatus = khcnAssessed ? (d.status_label || '') : '';
    var vtStatus = d.is_confirmed ? (d.confirmed_status_label || '') : '';

    return '<div class="tbkl-conclusion-side">' +
      '<div class="tbkl-conclusion-metrics">' +
      metricBlock('KHCN ĐG', khcnPct, khcnStatus, 'Chưa ĐG', '') +
      metricBlock('VT XN', vtPct, vtStatus, 'Chưa XN', ' tbkl-progress-confirmed') +
      '</div>' +
      '<div class="tbkl-conclusion-count">' + (d.task_count || 0) + ' đầu việc con</div></div>';
  }

  function conclusionActionsHtml(d) {
    if (isUnitView()) return '';
    var btns = '';
    if (d.can_assess_directive && !d.report_locked) {
      btns += '<button type="button" class="tbkl-btn tbkl-btn-sm tbkl-btn-primary" data-assess-directive="' +
        d.id + '">ĐG KHCN</button>';
    }
    if (d.can_confirm_directive && !d.report_locked) {
      btns += (btns ? ' ' : '') +
        '<button type="button" class="tbkl-btn tbkl-btn-sm tbkl-btn-outline" data-confirm-directive="' +
        d.id + '">XN VT</button>';
    }
    if (!btns) return '';
    return '<div class="tbkl-conclusion-actions">' + btns + '</div>';
  }

  function bindConclusionListEvents(list) {
    if (!list) return;
    list.querySelectorAll('.tbkl-conclusion-item').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('[data-assess-directive], [data-confirm-directive]')) return;
        state.groupBy = 'directive';
        var sel = $('groupBySelect');
        if (sel) sel.value = 'directive';
        var id = card.getAttribute('data-directive-id');
        var details = $('zoneDetails');
        if (details) details.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(function () {
          var target = document.getElementById('dir-group-' + id);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 350);
      });
    });
    list.querySelectorAll('[data-assess-directive]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openAssessDirectiveModal(btn.getAttribute('data-assess-directive'));
      });
    });
    list.querySelectorAll('[data-confirm-directive]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openConfirmDirectiveModal(btn.getAttribute('data-confirm-directive'));
      });
    });
  }

  function renderConclusionList(cycle, directives) {
    var zone = $('zoneConclusions');
    var list = $('conclusionList');
    if (!zone || !list) return;
    var sorted = sortDirectives(directives);
    var hasPdf = cycle && (cycle.has_conclusion_pdf || cycle.conclusion_pdf_url);
    var hasSummary = cycle && (cycle.conclusion_summary || cycle.source_ref);

    if (!sorted.length && !hasPdf && !hasSummary) {
      zone.hidden = true;
      return;
    }
    zone.hidden = false;
    var codeEl = $('overviewMeetingCode');
    if (codeEl && cycle) codeEl.textContent = 'H' + (cycle.meeting_seq || '');

    if (!sorted.length) {
      list.innerHTML = '<p class="tbkl-empty-list">Chưa có kết luận chi tiết — bấm «Kế hoạch triển khai» để thêm mục H' +
        (cycle && cycle.meeting_seq || '') + '-01 và các đầu việc con.</p>';
      return;
    }

    list.innerHTML = sorted.map(function (d) {
      var excerpt = (d.content || d.title || '').slice(0, 220);
      if ((d.content || d.title || '').length > 220) excerpt += '…';
      var meta = [];
      if (d.lead_department_name) meta.push('TC chung: ' + d.lead_department_name);
      if (d.supervisor_name) meta.push('GS: ' + d.supervisor_name);
      if (d.deadline) meta.push('Hạn: ' + fmtDate(d.deadline));
      return '<div class="tbkl-conclusion-item" data-directive-id="' + d.id + '">' +
        '<div class="tbkl-conclusion-code-col">' +
        '<div class="tbkl-conclusion-code">' + escapeHtml(d.code || '') + '</div>' +
        '<span class="' + ragClass(d.rag) + '" style="margin-top:8px;display:inline-block"></span></div>' +
        '<div class="tbkl-conclusion-body">' +
        '<h3>' + escapeHtml(d.title || '') + '</h3>' +
        '<p>' + escapeHtml(excerpt) + '</p>' +
        '<div class="tbkl-conclusion-meta">' + escapeHtml(meta.join(' · ')) + '</div>' +
        conclusionActionsHtml(d) + '</div>' +
        conclusionSideHtml(d) + '</div>';
    }).join('');

    bindConclusionListEvents(list);
  }

  function pctCell(pct, mode) {
    if (mode === 'pkh-empty') {
      return '<span class="tbkl-note">Chưa XN</span>';
    }
    var v = Math.round(pct || 0);
    var barClass = mode === 'pkh'
      ? 'tbkl-progress-fill tbkl-progress-confirmed'
      : 'tbkl-progress-fill';
    return '<strong>' + v + '%</strong>' +
      '<div class="tbkl-progress-bar"><div class="' + barClass + '" style="width:' +
      Math.min(100, v) + '%"></div></div>';
  }

  function renderTable(rows) {
    var tbody = $('taskTableBody');
    if (!tbody) return;
    var unitMode = isUnitView();
    var filtered = sortRowsForDisplay(rows || []);
    var detailsZone = $('zoneDetails');
    if (detailsZone) detailsZone.hidden = !(rows && rows.length);

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="tbkl-empty">' +
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
        html += '<tr class="' + rowClass + '"' + anchor + '><td colspan="11">' +
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
      if (r.can_confirm && !r.report_locked && !unitMode) {
        reportBtn += (reportBtn ? ' ' : '') +
          '<button type="button" class="tbkl-btn tbkl-btn-sm tbkl-btn-outline" data-confirm="' +
          r.task_id + '">XN KHCN</button>';
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
        '<td>' + pctCell(r.progress_pct, 'unit') + '</td>' +
        '<td>' + (r.is_confirmed ? pctCell(r.confirmed_pct, 'pkh') : pctCell(0, 'pkh-empty')) + '</td>' +
        '<td>' + escapeHtml(r.is_confirmed ? (r.confirmed_status_label || r.status_label || '—') : (r.status_label || '—')) + '</td>' +
        '<td class="tbkl-note">' + escapeHtml(note || '—') + '</td>' +
        '<td>' + reportBtn + '</td></tr>';
    });
    tbody.innerHTML = html;

    tbody.querySelectorAll('[data-report]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openReportModal(btn.getAttribute('data-report'));
      });
    });
    tbody.querySelectorAll('[data-confirm]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openConfirmModal(btn.getAttribute('data-confirm'));
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
    var unlockBtn = $('btnUnlockCycle');
    var seedActions = $('seedActions');
    var btnSide = $('btnNewCycleSide');
    var btnEditPlan = $('btnEditPlan');
    var btnNewCycle = $('btnNewCycle');
    var btnAddDirective = $('btnAddDirective');
    var btnAddTask = $('btnAddTask');

    if (manage) manage.hidden = !perms.can_operate;
    if (btnSide) btnSide.hidden = !perms.can_planning;
    if (btnNewCycle) btnNewCycle.hidden = !perms.can_planning;
    if (btnEditPlan) btnEditPlan.hidden = !(perms.can_planning && cycle);
    if (btnAddDirective) btnAddDirective.hidden = !perms.can_operate;
    if (btnAddTask) btnAddTask.hidden = !perms.can_operate;
    if (lockBtn) lockBtn.hidden = !(perms.can_lock && cycle && cycle.status !== 'locked');
    if (unlockBtn) {
      unlockBtn.hidden = !(perms.can_unlock && cycle && cycle.status === 'locked');
    }
    if (seedActions) {
      seedActions.hidden = !(perms.can_admin && !state.cycles.length);
    }
  }

  function updateSourceBanner(cycle) {
    var banner = $('sourceBanner');
    var detail = $('sourceDetail');
    var importBtn = $('btnImportSeed');
    var pdfBtn = $('btnViewConclusionPdf');
    var pdfUpdateBtn = $('btnUpdateCyclePdf');
    var editPlanBtn = $('btnEditPlan');
    if (!banner) return;

    var hasPdf = cycle && (cycle.has_conclusion_pdf || cycle.conclusion_pdf_url);
    var hasText = cycle && (cycle.source_ref || cycle.conclusion_summary);
    var showSeed = state.permissions.can_admin && !state.cycles.length;
    var canPlanning = state.permissions.can_planning;
    var canUpdatePdf = state.permissions.can_update_attachments;

    if (cycle && (hasPdf || hasText || state.permissions.can_operate || canPlanning)) {
      banner.hidden = false;
      var parts = [];
      if (cycle.conclusion_summary) parts.push(cycle.conclusion_summary);
      if (cycle.source_ref) parts.push(cycle.source_ref);
      if (cycle.conclusion_pdf_name) parts.push('PDF: ' + cycle.conclusion_pdf_name);
      if (detail) detail.textContent = parts.join(' · ') || 'Cuộc họp H' + cycle.meeting_seq;
      if (importBtn) importBtn.hidden = !showSeed;
      if (pdfUpdateBtn) pdfUpdateBtn.hidden = !canUpdatePdf;
      if (pdfBtn) {
        pdfBtn.onclick = null;
        if (hasPdf && cycle.conclusion_pdf_url) {
          pdfBtn.hidden = false;
          pdfBtn.href = cycle.conclusion_pdf_url;
        } else if (hasPdf && cycle.id) {
          pdfBtn.hidden = false;
          pdfBtn.href = '#';
          pdfBtn.onclick = async function (ev) {
            ev.preventDefault();
            try {
              var res = await TbklServices.getConclusionPdfUrl(cycle.id);
              window.open(res.url, '_blank', 'noopener');
            } catch (err) { showToast(err.message, true); }
          };
        } else {
          pdfBtn.hidden = true;
        }
      }
      if (editPlanBtn) editPlanBtn.hidden = !canPlanning;
    } else if (showSeed) {
      banner.hidden = false;
      if (detail) detail.textContent = 'Chưa có cuộc họp — nạp TB Viện trưởng 11/08/2026 hoặc tạo cuộc họp mới.';
      if (importBtn) importBtn.hidden = false;
      if (pdfBtn) pdfBtn.hidden = true;
      if (pdfUpdateBtn) pdfUpdateBtn.hidden = true;
      if (editPlanBtn) editPlanBtn.hidden = true;
    } else {
      banner.hidden = true;
    }
  }

  function openCyclePdfModal() {
    if (!state.currentCycleId || !state.dashboard) {
      showToast('Chọn cuộc họp trước', true);
      return;
    }
    if (!state.permissions.can_update_attachments) {
      showToast('Chỉ quản trị TBKL hoặc Phòng Kế hoạch mới cập nhật PDF', true);
      return;
    }
    var cycle = state.dashboard.cycle || {};
    $('cyclePdfModalTitle').textContent = 'Cập nhật PDF — H' + (cycle.meeting_seq || '');
    var hint = $('cyclePdfCurrent');
    if (hint) {
      hint.textContent = cycle.conclusion_pdf_name
        ? ('File hiện tại: ' + cycle.conclusion_pdf_name + '. Chọn file PDF mới để thay thế.')
        : 'Cuộc họp chưa có PDF — chọn file để đính kèm văn bản kết luận.';
    }
    var form = $('formCyclePdf');
    if (form) form.reset();
    openModal('modalCyclePdf');
  }

  function guessNextMeetingSeq() {
    if (!state.cycles.length) return 1;
    var max = state.cycles.reduce(function (m, c) {
      return Math.max(m, parseInt(c.meeting_seq, 10) || 0);
    }, 0);
    return max + 1;
  }

  function updatePlanTemplateLink(seq) {
    var link = $('btnDownloadPlanTemplate');
    if (link) link.href = TbklServices.planTemplateUrl(seq || guessNextMeetingSeq());
  }

  function syncCyclePlanSeq() {
    var seqInput = $('cycleMeetingSeq');
    var seq = seqInput && seqInput.value ? parseInt(seqInput.value, 10) : guessNextMeetingSeq();
    if (state.cyclePlanEditor) state.cyclePlanEditor.setMeetingSeq(seq);
    updatePlanTemplateLink(seq);
  }

  function openCycleModal() {
    if (!state.cyclePlanEditor) {
      state.cyclePlanEditor = TbklPlanEditor.create('cyclePlanEditor', {
        meetingSeq: guessNextMeetingSeq()
      });
    } else {
      state.cyclePlanEditor.reset();
      state.cyclePlanEditor.setMeetingSeq(guessNextMeetingSeq());
    }
    state.planTab = 'grid';
    document.querySelectorAll('[data-plan-tab]').forEach(function (tab) {
      tab.classList.toggle('is-active', tab.getAttribute('data-plan-tab') === 'grid');
    });
    $('planTabGrid').hidden = false;
    $('planTabExcel').hidden = true;
    updatePlanTemplateLink(guessNextMeetingSeq());
    openModal('modalCycle');
  }

  function openPlanModal() {
    if (!state.currentCycleId || !state.dashboard) {
      showToast('Chọn cuộc họp trước', true);
      return;
    }
    var cycle = state.dashboard.cycle || {};
    if (!state.editPlanEditor) {
      state.editPlanEditor = TbklPlanEditor.create('editPlanEditor', {
        meetingSeq: cycle.meeting_seq || 1
      });
    } else {
      state.editPlanEditor.setMeetingSeq(cycle.meeting_seq || 1);
      state.editPlanEditor.reset();
    }
    $('planModalTitle').textContent = 'Kế hoạch triển khai — H' + (cycle.meeting_seq || '');
    var hasExisting = (state.dashboard.directives || []).length > 0;
    $('planReplaceWrap').hidden = !hasExisting;
    $('planReplaceCheck').checked = false;
    openModal('modalPlan');
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
    $('taskTableBody').innerHTML = '<tr><td colspan="11" class="tbkl-empty">Đang tải…</td></tr>';
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
      $('taskTableBody').innerHTML = '<tr><td colspan="11" class="tbkl-empty">' + escapeHtml(err.message) + '</td></tr>';
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
      $('taskTableBody').innerHTML = '<tr><td colspan="11" class="tbkl-empty">Chưa có cuộc họp — Phòng NV tạo mới hoặc nạp TB mẫu.</td></tr>';
    }
  }

  function openAssessDirectiveModal(directiveId) {
    var d = (state.dashboard && state.dashboard.directives || []).find(function (x) {
      return x.id === directiveId;
    });
    if (!d) return;
    $('assessDirectiveId').value = directiveId;
    $('assessDirectiveMeta').textContent = (state.dashboard.meeting_label || '') + ' · ' +
      (d.code || '') + ' — ' + (d.title || '');
    var form = $('formAssessDirective');
    form.progress_pct.value = d.is_assessed ? (d.progress_pct || 0) : (d.avg_progress || 0);
    form.status.value = d.is_assessed ? (d.status || 'in_progress') : 'in_progress';
    form.note.value = d.note || '';
    openModal('modalAssessDirective');
  }

  function openConfirmDirectiveModal(directiveId) {
    var d = (state.dashboard && state.dashboard.directives || []).find(function (x) {
      return x.id === directiveId;
    });
    if (!d) return;
    $('confirmDirectiveId').value = directiveId;
    $('confirmDirectiveMeta').textContent = (state.dashboard.meeting_label || '') + ' · ' +
      (d.code || '') + ' — ' + (d.title || '');
    $('confirmDirectiveKhcnHint').textContent = d.is_assessed
      ? ('KHCN đánh giá: ' + Math.round(d.progress_pct || 0) + '% — ' + (d.status_label || '—') +
        '. RAG mục lớn tính theo xác nhận VT.')
      : 'Chưa có đánh giá KHCN — có thể xác nhận trực tiếp nếu cần.';
    var form = $('formConfirmDirective');
    form.confirmed_pct.value = d.is_confirmed
      ? (d.confirmed_pct || 0)
      : (d.is_assessed ? (d.progress_pct || 0) : (d.avg_confirmed_pct != null ? d.avg_confirmed_pct : d.avg_progress || 0));
    form.confirmed_status.value = d.is_confirmed
      ? (d.confirmed_status || 'in_progress')
      : (d.is_assessed ? (d.status || 'in_progress') : 'in_progress');
    openModal('modalConfirmDirective');
  }

  function openConfirmModal(taskId) {
    var row = (state.dashboard && state.dashboard.rows || []).find(function (r) {
      return r.task_id === taskId;
    });
    if (!row) return;
    $('confirmTaskId').value = taskId;
    $('confirmMeta').textContent = (state.dashboard.meeting_label || '') + ' · ' + row.task_code + ' — ' + row.task_title;
    $('confirmUnitHint').textContent = 'Đơn vị báo cáo: ' + Math.round(row.progress_pct || 0) + '% — ' +
      (row.status_label || '—') + '. RAG trên dashboard tính theo % xác nhận KHCN.';
    var form = $('formConfirm');
    form.confirmed_pct.value = row.is_confirmed ? (row.confirmed_pct || 0) : (row.progress_pct || 0);
    form.confirmed_status.value = row.is_confirmed
      ? (row.confirmed_status || 'in_progress')
      : (row.status || 'in_progress');
    openModal('modalConfirm');
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

    function openCycleModalFn() { openCycleModal(); }
    $('btnNewCycle').addEventListener('click', openCycleModalFn);
    $('btnNewCycleSide').addEventListener('click', openCycleModalFn);
    $('btnEditPlan').addEventListener('click', openPlanModal);
    $('btnUpdateCyclePdf').addEventListener('click', openCyclePdfModal);

    $('formCyclePdf').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!state.currentCycleId) return;
      var input = $('cyclePdfUpdateInput');
      var file = input && input.files && input.files[0];
      if (!file) {
        showToast('Chọn file PDF', true);
        return;
      }
      var fd = new FormData();
      fd.append('conclusion_pdf', file);
      try {
        await TbklServices.uploadCycleAttachments(state.currentCycleId, fd);
        closeModal('modalCyclePdf');
        showToast('Đã cập nhật PDF kết luận');
        await refreshCycles(state.currentCycleId);
      } catch (err) { showToast(err.message, true); }
    });

    var seqInput = $('cycleMeetingSeq');
    if (seqInput) {
      seqInput.addEventListener('input', syncCyclePlanSeq);
      seqInput.addEventListener('change', syncCyclePlanSeq);
    }

    document.querySelectorAll('[data-plan-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        state.planTab = tab.getAttribute('data-plan-tab');
        document.querySelectorAll('[data-plan-tab]').forEach(function (t) {
          t.classList.toggle('is-active', t === tab);
        });
        $('planTabGrid').hidden = state.planTab !== 'grid';
        $('planTabExcel').hidden = state.planTab !== 'excel';
      });
    });

    var planFileInput = $('cyclePlanFileInput');
    if (planFileInput) {
      planFileInput.addEventListener('change', async function () {
        var file = planFileInput.files && planFileInput.files[0];
        if (!file) return;
        try {
          var res = await TbklServices.parsePlanFile(file);
          if (state.cyclePlanEditor) state.cyclePlanEditor.loadPlan(res.plan);
          $('planFileHint').textContent = 'Đã nạp: ' + file.name;
          showToast('Đã đọc bảng từ Excel');
        } catch (err) { showToast(err.message, true); }
      });
    }

    var editPlanFileInput = $('editPlanFileInput');
    if (editPlanFileInput) {
      editPlanFileInput.addEventListener('change', async function () {
        var file = editPlanFileInput.files && editPlanFileInput.files[0];
        if (!file) return;
        try {
          var res = await TbklServices.parsePlanFile(file);
          if (state.editPlanEditor) state.editPlanEditor.loadPlan(res.plan);
          showToast('Đã nạp bảng từ Excel');
        } catch (err) { showToast(err.message, true); }
      });
    }

    $('btnPublishPlan').addEventListener('click', async function () {
      if (!state.currentCycleId || !state.editPlanEditor) return;
      var plan = state.editPlanEditor.getPlan();
      if (!plan.directives.length) {
        showToast('Thêm ít nhất một mục kết luận lớn', true);
        return;
      }
      var replace = $('planReplaceCheck').checked;
      if (replace && !confirm('Ghi đè toàn bộ kết luận và đầu việc hiện có?')) return;
      try {
        var res = await TbklServices.publishPlan(state.currentCycleId, plan, replace);
        closeModal('modalPlan');
        showToast('Đã áp dụng: ' + res.directive_count + ' KL, ' + res.task_count + ' đầu việc');
        await refreshCycles(state.currentCycleId);
      } catch (err) { showToast(err.message, true); }
    });

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

    $('btnUnlockCycle').addEventListener('click', async function () {
      if (!state.currentCycleId) return;
      if (!confirm('Mở chốt cuộc họp này để tiếp tục báo cáo và cập nhật tiến độ?')) return;
      try {
        await TbklServices.unlockCycle(state.currentCycleId);
        showToast('Đã mở chốt — có thể báo cáo và cập nhật tiếp');
        await refreshCycles(state.currentCycleId);
      } catch (err) { showToast(err.message, true); }
    });

    $('btnImportSeed').addEventListener('click', function () {
      if (!confirm('Nạp 7 kết luận và ~18 đầu việc từ TB Viện trưởng 11/08/2026 vào cuộc họp H1?')) return;
      importDefaultSeed(false);
    });

    $('formCycle').addEventListener('submit', async function (e) {
      e.preventDefault();
      var form = e.target;
      var fd = new FormData(form);
      var payload = {
        title: fd.get('title'),
        meeting_date: fd.get('meeting_date') || null,
        source_ref: fd.get('source_ref'),
        conclusion_summary: fd.get('conclusion_summary')
      };
      var seq = fd.get('meeting_seq');
      if (seq) payload.meeting_seq = parseInt(seq, 10);

      var useExcel = state.planTab === 'excel' && fd.get('plan_workbook') && fd.get('plan_workbook').name;
      if (!useExcel && state.cyclePlanEditor) {
        var plan = state.cyclePlanEditor.getPlan();
        if (plan.directives.length) {
          fd.set('plan_json', JSON.stringify(plan));
        }
      }
      fd.set('data', JSON.stringify(payload));
      fd.set('publish_plan', '1');

      try {
        var res = await TbklServices.createCycleFull(fd);
        closeModal('modalCycle');
        form.reset();
        if (state.cyclePlanEditor) state.cyclePlanEditor.reset();
        var msg = 'Đã tạo cuộc họp H' + res.cycle.meeting_seq;
        if (res.directive_count) msg += ' · ' + res.directive_count + ' KL, ' + res.task_count + ' đầu việc';
        showToast(msg);
        await refreshCycles(res.cycle.id);
      } catch (err) { showToast(err.message, true); }
    });

    $('formDirective').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var deptSel = $('directiveDeptSelect');
      var deptOpt = deptSel.options[deptSel.selectedIndex];
      var leadId = fd.get('lead_department_id') || '';
      var leadName = deptOpt && deptOpt.dataset && deptOpt.dataset.name
        ? deptOpt.dataset.name
        : (deptOpt ? deptOpt.textContent : '');
      var supervisor = fd.get('supervisor_name');
      var leadDeptId = leadId || null;
      if (leadId && String(leadId).indexOf('pvt-') === 0) {
        supervisor = leadName;
        leadDeptId = null;
      }
      try {
        await TbklServices.createDirective(state.currentCycleId, {
          title: fd.get('title'),
          content: fd.get('content'),
          lead_department_id: leadDeptId,
          lead_department_name: leadName || null,
          supervisor_name: supervisor,
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

    $('formConfirm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      try {
        await TbklServices.confirmReport(fd.get('task_id'), {
          confirmed_pct: parseFloat(fd.get('confirmed_pct') || 0),
          confirmed_status: fd.get('confirmed_status')
        });
        closeModal('modalConfirm');
        showToast('Đã lưu xác nhận KHCN — RAG cập nhật theo đánh giá Phòng KHCN');
        await loadDashboard(state.currentCycleId);
      } catch (err) { showToast(err.message, true); }
    });

    $('formAssessDirective').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      try {
        await TbklServices.assessDirective(fd.get('directive_id'), {
          progress_pct: parseFloat(fd.get('progress_pct') || 0),
          status: fd.get('status'),
          note: fd.get('note')
        });
        closeModal('modalAssessDirective');
        showToast('Đã lưu đánh giá KHCN cho mục lớn');
        await loadDashboard(state.currentCycleId);
      } catch (err) { showToast(err.message, true); }
    });

    $('formConfirmDirective').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      try {
        await TbklServices.confirmDirective(fd.get('directive_id'), {
          confirmed_pct: parseFloat(fd.get('confirmed_pct') || 0),
          confirmed_status: fd.get('confirmed_status')
        });
        closeModal('modalConfirmDirective');
        showToast('Đã lưu xác nhận VT — RAG mục lớn cập nhật');
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
      $('taskTableBody').innerHTML = '<tr><td colspan="11" class="tbkl-empty">' +
        escapeHtml(err.message) + '</td></tr>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
