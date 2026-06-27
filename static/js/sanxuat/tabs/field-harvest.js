/**
 * Tab: Sản lượng công nhân tại vườn
 * 1 cột Trạng thái → số dòng (1/2/3) cho cả cạo + trút + bốc
 * @module TabFieldHarvest
 */
const TabFieldHarvest = (function () {
  'use strict';

  let sections = [];
  let workers = [];
  let companyTeams = [];
  let assignments = [];
  let weighings = [];
  let selectedTeam = '';
  let selectedSession = 'A';
  let assignDraft = {};
  let weighSectionId = null;
  let weighDraft = {};
  let quickWeighActive = false;
  /** @type {Array<object>} */
  let quickWeighRows = [];
  var FH_QUICK_COAG_TARE_KG = 0;
  /** Ngày làm việc trước khi đổi (để hủy đổi ngày khi còn bản nháp). */
  let _fhLastRecordDate = '';
  let _fhSaveInProgress = false;
  let summaryTeam = '__all__';
  let summaryViewMode = 'section';
  let summaryPeriod = 'day';
  let summarySession = '__all__';
  let summaryWeighings = [];
  let summaryRangeLabel = '';
  let lotCatalog = [];
  let workerGroupMap = {};
  /** @type {{ mode: string, teamIds: string[], departmentIds: string[], locked: boolean, label: string }} */
  let _teamScope = { mode: 'all', teamIds: [], departmentIds: [], locked: false, label: '' };

  var TAP_SESSIONS = ['A', 'B', 'C', 'D'];
  var FH_DEFAULT_BIN_COUNT = 3;
  var FH_DEFAULT_TARE_KG = 1;
  var FH_WEIGH_KG_STEP = 0.1;
  var FH_DEFAULT_COAG_DRC = 40;
  var FH_MATERIAL_TYPES = [
    { v: 1, l: 'Loại 1' },
    { v: 2, l: 'Loại 2' },
    { v: 3, l: 'Loại 3' }
  ];
  var FH_SESSION_KEY = 'fh_last_tapping_session';
  var FH_TEAM_KEY = 'fh_last_production_team';
  var FH_DEFAULT_TEAM_ID = 'team-lk';
  /** Tăng khi đổi cách lưu/lọc phân công — buộc xóa cache cũ trên máy. */
  var FH_ASSIGNMENTS_CACHE_VER = '8';
  var WORK_MODES = [
    { v: 'solo', l: '1 mình', n: 1 },
    { v: 'coop_2', l: 'Phối hợp (2)', n: 2 },
    { v: 'coop_3', l: 'Phối hợp (3)', n: 3 }
  ];

  var STAGES = [
    { id: 'tapper', idKey: 'tapper_id', pctKey: 'tapper_pct', label: 'Cạo' },
    { id: 'stripper', idKey: 'stripper_id', pctKey: 'stripper_pct', label: 'Trút' },
    { id: 'collector', idKey: 'collector_id', pctKey: 'collector_pct', label: 'Bốc' }
  ];

  function _db() { return ErpDb.firestore(); }
  function _user() { return window.currentUser; }
  function _toast(msg, type) { if (window.showToast) window.showToast(msg, type || 'success'); }
  function _formatDateShort(iso) {
    if (typeof window.formatDateVN === 'function') return window.formatDateVN(iso);
    if (!iso) return '';
    var p = String(iso).split('-');
    return p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0]) : iso;
  }

  function _isoDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function _summaryDateRange(period, refDateStr) {
    refDateStr = refDateStr || _dateVal();
    var ref = new Date(refDateStr + 'T12:00:00');
    if (isNaN(ref.getTime())) {
      return { from: refDateStr, to: refDateStr, label: 'Ngày ' + _formatDateShort(refDateStr) };
    }
    if (period === 'week') {
      var dow = ref.getDay();
      var monOff = dow === 0 ? -6 : 1 - dow;
      var mon = new Date(ref);
      mon.setDate(ref.getDate() + monOff);
      var sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      var from = _isoDate(mon);
      var to = _isoDate(sun);
      return {
        from: from,
        to: to,
        label: 'Tuần ' + _formatDateShort(from) + ' → ' + _formatDateShort(to)
      };
    }
    if (period === 'month') {
      var first = new Date(ref.getFullYear(), ref.getMonth(), 1);
      var last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      var mFrom = _isoDate(first);
      var mTo = _isoDate(last);
      return {
        from: mFrom,
        to: mTo,
        label: 'Tháng ' + (ref.getMonth() + 1) + '/' + ref.getFullYear()
      };
    }
    if (period === 'year') {
      var y = ref.getFullYear();
      return { from: y + '-01-01', to: y + '-12-31', label: 'Năm ' + y };
    }
    return { from: refDateStr, to: refDateStr, label: 'Ngày ' + _formatDateShort(refDateStr) };
  }

  function _summaryPeriodLabel(period) {
    if (period === 'week') return 'Tuần';
    if (period === 'month') return 'Tháng';
    if (period === 'year') return 'Năm';
    return 'Ngày';
  }

  function _readSummaryFilters() {
    var periodEl = _el('fhSummaryPeriod');
    summaryPeriod = (periodEl && periodEl.value) || 'day';
    var sessionEl = _el('fhSummarySession');
    summarySession = (sessionEl && sessionEl.value) || '__all__';
    var viewEl = _el('fhSummaryView');
    summaryViewMode = (viewEl && viewEl.value) || 'section';
    var teamEl = _el('fhSummaryTeam');
    summaryTeam = (teamEl && teamEl.value) ? teamEl.value : '__all__';
  }

  async function loadSummaryWeighings() {
    _readSummaryFilters();
    var range = _summaryDateRange(summaryPeriod, _dateVal());
    summaryRangeLabel = range.label;
    if (summaryPeriod === 'day') {
      summaryWeighings = weighings.slice();
      return;
    }
    if (!_isOnline()) {
      summaryWeighings = [];
      return;
    }
    try {
      var url = '/api/harvest/weighings/range?from=' + encodeURIComponent(range.from) +
        '&to=' + encodeURIComponent(range.to);
      var res = await fetch(url);
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok || body.success === false) {
        throw new Error(body.message || ('HTTP ' + res.status));
      }
      summaryWeighings = body.data || [];
    } catch (e) {
      console.warn('loadSummaryWeighings:', e.message);
      summaryWeighings = [];
    }
  }

  async function _refreshYieldSummary() {
    await loadSummaryWeighings();
    renderYieldSummary();
  }

  function _setSaveButtonBusy(busy) {
    var btn = document.querySelector('button[onclick*="saveAllAssignments"]');
    if (!btn) return;
    btn.disabled = !!busy;
    btn.style.opacity = busy ? '0.65' : '';
    btn.textContent = busy ? '⏳ Đang lưu...' : '💾 Lưu phân công';
  }
  function _el(id) { return document.getElementById(id); }
  function _today() { return new Date().toISOString().slice(0, 10); }

  function _offlineReady() {
    return typeof FieldHarvestOffline !== 'undefined';
  }

  function _isOnline() {
    return !_offlineReady() || FieldHarvestOffline.isOnline();
  }

  /** Chỉ coi là mất mạng thật — lỗi API/validation không fallback offline. */
  function _isTransientNetworkError(e) {
    if (!e) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    var msg = String(e.message || e).toLowerCase();
    if (e.name === 'TypeError' && (msg.indexOf('fetch') >= 0 || msg.indexOf('network') >= 0)) return true;
    if (msg.indexOf('failed to fetch') >= 0 || msg.indexOf('networkerror') >= 0) return true;
    if (msg.indexOf('load failed') >= 0 || msg.indexOf('network request failed') >= 0) return true;
    if (/http (502|503|504|429)/.test(msg)) return true;
    return false;
  }

  async function _commitDbBatch(ops) {
    if (!ops.length) return;
    var CHUNK = 80;
    for (var i = 0; i < ops.length; i += CHUNK) {
      var batch = _db().batch();
      var slice = ops.slice(i, i + CHUNK);
      slice.forEach(function (item) {
        if (item.type === 'delete') batch.delete(item.ref);
        else if (item.type === 'update') batch.update(item.ref, item.data);
        else batch.set(item.ref, item.data, { merge: true });
      });
      await batch.commit();
    }
  }

  async function _bulkSaveAssignmentsApi(payload) {
    var res = await fetch('/api/harvest/assignments/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok || body.success === false) {
      throw new Error(body.message || ('HTTP ' + res.status));
    }
    return body;
  }

  function _workersAllKey() {
    return FieldHarvestOffline.WORKERS_ALL_KEY || 'workers:all';
  }

  async function _fetchAllWorkersFromServer() {
    var allWorkers = [];
    var fromView = false;
    workerGroupMap = {};
    try {
      var vSnap = await _db().collection('vProductionWorkforce').get();
      vSnap.forEach(function (doc) {
        var d = Object.assign({ id: doc.id }, doc.data());
        d.id = d.employee_id || doc.id;
        if (d.disabled || d.employment_status === 'resigned' || d.status === 'inactive') return;
        d.team_id = d.production_team_id || d.team_id;
        d.team = d.production_team_name || d.team;
        d.ho_ten = d.full_name || d.ho_ten;
        d.hoTen = d.full_name || d.hoTen;
        if (d.work_group_code) workerGroupMap[String(d.id)] = d.work_group_code;
        allWorkers.push(d);
      });
      fromView = allWorkers.length > 0;
    } catch (e) { /* view chưa có — fallback */ }

    if (!fromView) {
      var snap = await _db().collection('categoryPersonnel').get();
      snap.forEach(function (doc) {
        var d = Object.assign({ id: doc.id }, doc.data());
        if (!d.disabled && d.status !== 'inactive') allWorkers.push(d);
      });
    }
    allWorkers.sort(function (a, b) { return _workerName(a).localeCompare(_workerName(b)); });
    if (_offlineReady()) await FieldHarvestOffline.cachePut(_workersAllKey(), allWorkers);
    return allWorkers;
  }

  function _filterWorkersList(all) {
    return (all || []).filter(function (d) {
      if (d.disabled || d.status === 'inactive') return false;
      if (selectedTeam && !_workerMatchesTeam(d)) return false;
      return true;
    });
  }

  async function _loadWorkersFromCache() {
    if (!_offlineReady()) { workers = []; return; }
    var all = await FieldHarvestOffline.cacheGet(_workersAllKey());
    if (!all || !all.length) all = await FieldHarvestOffline.cacheGet('workers') || [];
    workerGroupMap = {};
    (all || []).forEach(function (d) {
      if (d.work_group_code) workerGroupMap[String(d.id)] = d.work_group_code;
    });
    workers = _filterWorkersList(all);
    workers.sort(function (a, b) { return _workerName(a).localeCompare(_workerName(b)); });
  }

  async function _silentMasterCacheRefresh() {
    if (!_isOnline() || !_offlineReady()) return;
    try {
      await loadTeams();
      var allWorkers = await _fetchAllWorkersFromServer();
      await loadSections();
      await FieldHarvestOffline.saveMasterBundle({
        teams: companyTeams,
        workers: allWorkers,
        sections: sections
      });
      var date = _dateVal();
      if (_isOnline()) {
        try {
          var aSnap = await _db().collection('sectionWorkerAssignments').where('record_date', '==', date).get();
          var aRows = aSnap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
          await FieldHarvestOffline.saveAssignmentsForDate(date, aRows);
          var wSnap = await _db().collection('fieldWorkerWeighings').where('record_date', '==', date).get();
          var wRows = wSnap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
          await FieldHarvestOffline.saveWeighingsForDate(date, wRows);
        } catch (e) { /* optional */ }
      }
      if (typeof TscDrcConverter !== 'undefined') await TscDrcConverter.load();
    } catch (e) {
      console.warn('[FieldHarvest] silent cache:', e.message);
    }
  }

  async function _saveAssignmentsOffline(sectionId, cfg, date) {
    _applyAssignmentsLocal(sectionId, cfg, date);
    await _saveSectionLot(sectionId, cfg.lot_code || '');
    await FieldHarvestOffline.enqueueDeduped({
      type: 'assignments',
      date: date,
      session: selectedSession,
      teamId: selectedTeam,
      sectionId: sectionId,
      cfg: cfg
    }, 'assign:' + date + ':' + sectionId);
  }

  async function _saveAssignmentsWithFallback(sectionId, cfg, date) {
    if (!_isOnline() && _offlineReady()) {
      await _saveAssignmentsOffline(sectionId, cfg, date);
      return 'offline';
    }
    try {
      await _upsertSectionAssignments(sectionId, cfg, date);
      await _saveSectionLot(sectionId, cfg.lot_code || '');
      _applyAssignmentsLocal(sectionId, cfg, date);
      return 'online';
    } catch (e) {
      if (!_offlineReady() || !_isTransientNetworkError(e)) throw e;
      console.warn('[FieldHarvest] fallback offline assign:', e.message);
      await _saveAssignmentsOffline(sectionId, cfg, date);
      return 'fallback';
    }
  }

  function _localId(prefix) {
    if (window.crypto && crypto.randomUUID) return prefix + crypto.randomUUID();
    return prefix + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  async function _persistAssignmentsCache() {
    if (!_offlineReady()) return;
    await FieldHarvestOffline.saveAssignmentsForDate(_dateVal(), assignments);
  }

  async function _persistWeighingsCache() {
    if (!_offlineReady()) return;
    await FieldHarvestOffline.saveWeighingsForDate(_dateVal(), weighings);
  }

  async function _updateOfflineUI() {
    var el = _el('fhOfflineStatus');
    if (!el || !_offlineReady()) return;
    var pending = 0;
    try { pending = await FieldHarvestOffline.queueCount(); } catch (e) { /* ignore */ }
    var syncBtn = _el('fhSyncBtn');
    if (syncBtn) syncBtn.style.display = pending > 0 ? '' : 'none';
    if (!_isOnline()) {
      el.innerHTML = '<span class="fh-offline-badge fh-offline-warn">📴 Offline — dữ liệu lưu trên máy' +
        (pending ? ' · <strong>' + pending + '</strong> chờ đồng bộ' : '') + '</span>';
      return;
    }
    if (pending > 0) {
      el.innerHTML = '<span class="fh-offline-badge fh-offline-pending">⏳ <strong>' + pending +
        '</strong> thao tác chờ đồng bộ</span>';
    } else {
      el.innerHTML = '<span class="fh-offline-badge fh-offline-ok">🌐 Online</span>';
    }
  }

  function _workerName(w) {
    var n = w.ho_ten || w.hoTen || w.username || w.id || '';
    return String(n).replace(/^\[?\s*CN\s*\]?\s+/i, '').trim();
  }

  function _sectionLabel(id) {
    var s = sections.find(function (x) { return x.id === id; });
    return s ? (s.section_code || s.id) : id;
  }

  function _workerLabel(id) {
    var w = workers.find(function (x) { return x.id === id; });
    if (!w) return id;
    return _workerGroupLabel(id) + _workerName(w);
  }

  function _workerGroupCode(workerId) {
    if (!workerId) return '';
    var w = workers.find(function (x) { return x.id === workerId; });
    if (w && (w.work_group_code || w.workGroupCode)) return w.work_group_code || w.workGroupCode;
    return workerGroupMap[String(workerId)] || '';
  }

  /** Hiển thị mã tổ: bỏ tiền tố CN (CN / CN01 / [CN] → rỗng hoặc 01). */
  function _workerGroupDisplayCode(code) {
    if (!code) return '';
    var s = String(code).trim();
    if (/^CN$/i.test(s) || /^\[CN\]$/i.test(s)) return '';
    s = s.replace(/^\[?\s*CN\s*\]?/i, '').trim();
    return s;
  }

  function _workerGroupLabel(workerId) {
    var g = _workerGroupDisplayCode(_workerGroupCode(workerId));
    if (!g || /^CN$/i.test(g)) return '';
    return '[' + g + '] ';
  }

  function _isLegacyDemoTeam(t) {
    if (!t) return false;
    var id = String(t.id);
    var name = String(t.name || '');
    if (['1', '2', '3'].indexOf(id) >= 0 && /^Đội\s*SX\s*\d+$/i.test(name.trim())) return true;
    return false;
  }

  function _productionTeams() {
    var list = companyTeams.filter(function (t) { return !_isLegacyDemoTeam(t); });
    if (list.length) return list;
    return companyTeams;
  }

  function _normalizeTeamLabel(name) {
    return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** Mặc định: Trạm Lai Khê (team-lk). */
  function _resolveDefaultTeamId(teams) {
    var list = teams && teams.length ? teams : _productionTeams();
    if (!list.length) return '';
    var byId = list.find(function (t) { return String(t.id) === FH_DEFAULT_TEAM_ID; });
    if (byId) return String(byId.id);
    var labels = ['đội sản xuất lai khê', 'tổ sx lai khê'];
    for (var i = 0; i < labels.length; i++) {
      var want = labels[i];
      var hit = list.find(function (t) {
        var n = _normalizeTeamLabel(t.name);
        return n === want || (n.indexOf('lai khê') !== -1 && n.indexOf('đội') !== -1) ||
          (n.indexOf('lai khê') !== -1 && n.indexOf('tổ') !== -1);
      });
      if (hit) return String(hit.id);
    }
    return '';
  }

  function _sectionLotId(section) {
    if (!section) return '';
    var meta = _sectionMeta(section);
    return String(section.lot_id || section.lot_code || meta.lot_code || '').trim();
  }

  function _sectionPcLabel(section) {
    if (!section) return '';
    if (section.section_no != null && section.section_no !== '') {
      return String(section.section_no);
    }
    var code = String(section.section_code || '');
    var m = code.match(/\|PC\|(\d+)$/i);
    if (m) return m[1];
    return code || section.id;
  }

  function _lotOptionLabel(lot) {
    var code = String((lot && lot.lot_code) || '').trim();
    var name = String((lot && (lot.lot_name || lot.ten_lo)) || '').trim();
    if (name && name !== code) return name + ' · ' + code;
    return code;
  }

  function _lotsForTeam() {
    var seen = {};
    var out = [];
    var session = selectedSession || 'A';
    function _push(code, name) {
      code = String(code || '').trim();
      if (!code || seen[code]) return;
      seen[code] = true;
      out.push({ lot_code: code, lot_name: name || code });
    }
    _filteredSections().forEach(function (s) {
      _push(_sectionLotId(s), s.lot_name || _sectionMeta(s).ten_lo);
    });
    assignments.forEach(function (a) {
      if (_assignmentSession(a) !== session) return;
      var meta = _assignmentMeta(a);
      _push(meta.lot_code, meta.lot_name);
      var sec = _findSectionById(a.tapping_section_id);
      if (sec) _push(_sectionLotId(sec), sec.lot_name || _sectionMeta(sec).ten_lo);
    });
    lotCatalog.forEach(function (l) {
      _push(l.lot_code, l.lot_name || l.ten_lo);
    });
    out.sort(function (a, b) {
      return a.lot_code.localeCompare(b.lot_code, undefined, { numeric: true });
    });
    return out;
  }

  function _sectionsForLot(lotCode) {
    lotCode = String(lotCode || '').trim();
    if (!lotCode) return [];
    var session = selectedSession || 'A';
    var byId = {};
    _filteredSections().forEach(function (s) {
      if (_sectionLotId(s) === lotCode) byId[s.id] = s;
    });
    assignments.forEach(function (a) {
      if (_assignmentSession(a) !== session) return;
      var sec = _findSectionById(a.tapping_section_id);
      if (!sec) return;
      var meta = _assignmentMeta(a);
      if (_sectionLotId(sec) !== lotCode && meta.lot_code !== lotCode) return;
      byId[sec.id] = sec;
    });
    return Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) {
      var na = parseInt(a.section_no, 10) || 0;
      var nb = parseInt(b.section_no, 10) || 0;
      if (na !== nb) return na - nb;
      return String(a.section_code || '').localeCompare(String(b.section_code || ''));
    });
  }

  function _lotSelectHtml(lotCode, sectionId) {
    var lots = _lotsForTeam();
    var html = '<option value="">— Chọn lô —</option>';
    lots.forEach(function (l) {
      var sel = l.lot_code === lotCode ? ' selected' : '';
      var label = _lotOptionLabel(l);
      html += '<option value="' + _escapeHtml(l.lot_code) + '"' + sel +
        ' title="' + _escapeHtml(label) + '">' + _escapeHtml(label) + '</option>';
    });
    return '<select class="fh-sel fh-lot-sel" data-section-id="' + _escapeHtml(sectionId) + '">' + html + '</select>';
  }

  function _sectionSelectHtml(section, lotCode) {
    var currentId = section ? section.id : '';
    var candidates = _sectionsForLot(lotCode);
    if (section && currentId && !candidates.some(function (s) { return s.id === currentId; })) {
      candidates = candidates.concat([section]);
      candidates.sort(function (a, b) {
        var na = parseInt(a.section_no, 10) || 0;
        var nb = parseInt(b.section_no, 10) || 0;
        if (na !== nb) return na - nb;
        return String(a.section_code || '').localeCompare(String(b.section_code || ''));
      });
    }
    var html = '<option value="">—</option>';
    candidates.forEach(function (s) {
      var sel = s.id === currentId ? ' selected' : '';
      var label = _sectionPcLabel(s);
      var title = (s.lot_name ? s.lot_name + ' · ' : '') + (s.section_code || '');
      html += '<option value="' + _escapeHtml(s.id) + '"' + sel + ' title="' + _escapeHtml(title) + '">' +
        _escapeHtml(label) + '</option>';
    });
    return '<select class="fh-sel fh-section-sel" data-section-id="' + _escapeHtml(currentId) + '">' + html + '</select>';
  }

  function _escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function _parseMeta(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }

  /** API Supabase flatten metadata → đọc cả cột metadata lẫn field top-level. */
  function _assignmentMeta(a) {
    if (!a) return {};
    var meta = _parseMeta(a.metadata);
    ['slots', 'lot_code', 'work_mode', 'tapping_session', 'roles', 'yield_share_pct'].forEach(function (k) {
      if (a[k] != null && a[k] !== '') meta[k] = a[k];
    });
    return meta;
  }

  function _weighingMeta(w) {
    if (!w) return {};
    var meta = _parseMeta(w.metadata);
    ['weigh_detail', 'tapping_session', 'latex_drc_pct', 'section_total_fresh_kg', 'roles'].forEach(function (k) {
      if (w[k] != null && w[k] !== '') meta[k] = w[k];
    });
    return meta;
  }

  /** Luôn có trạm SX (mặc định Trạm Lai Khê) trước khi render phân công. */
  function _ensureProductionTeamSelected() {
    var el = _el('fhTeamFilter');
    if (selectedTeam && _isTeamAllowed(selectedTeam)) {
      if (el && el.value !== selectedTeam) el.value = selectedTeam;
      return selectedTeam;
    }
    var pool = _visibleTeams().length ? _visibleTeams() : _productionTeams();
    var defId = _resolveDefaultTeamId(pool);
    if (defId && _isTeamAllowed(defId)) {
      selectedTeam = defId;
      if (el) el.value = defId;
      try { localStorage.setItem(FH_TEAM_KEY, defId); } catch (e) { /* ignore */ }
      return selectedTeam;
    }
    if (el && el.value && _isTeamAllowed(el.value)) {
      selectedTeam = el.value;
      return selectedTeam;
    }
    return selectedTeam || '';
  }

  /** Phiên cạo theo lịch tuần (CN=A, T2=B, T3=C, T4=D, …). */
  function _sessionForRecordDate(dateStr) {
    if (!dateStr) return 'A';
    var d = new Date(String(dateStr) + 'T12:00:00');
    if (isNaN(d.getTime())) return 'A';
    return ['A', 'B', 'C', 'D', 'A', 'B', 'C'][d.getDay()] || 'A';
  }

  function _setSessionFilter(session) {
    if (!session || TAP_SESSIONS.indexOf(session) < 0) session = 'A';
    selectedSession = session;
    var el = _el('fhSessionFilter');
    if (el) el.value = session;
    try { localStorage.setItem(FH_SESSION_KEY, session); } catch (e) { /* ignore */ }
    _updateSessionHint();
  }

  function _dominantSessionFromRows(rows) {
    var counts = {};
    (rows || []).forEach(function (a) {
      var s = _assignmentSession(a);
      counts[s] = (counts[s] || 0) + 1;
    });
    var best = '';
    var bestN = 0;
    TAP_SESSIONS.forEach(function (s) {
      var n = counts[s] || 0;
      if (n > bestN) {
        bestN = n;
        best = s;
      }
    });
    return bestN > 0 ? best : '';
  }

  /** Sau khi tải phân công: đồng bộ trạm + phiên để bảng không trống oan. */
  function _repairAssignmentViewFilters() {
    _ensureProductionTeamSelected();
    if (!assignments.length) {
      if (!_assignDraftCount()) {
        _setSessionFilter(_sessionForRecordDate(_dateVal()));
      }
      return;
    }
    _syncSessionFilterFromAssignments();
    if (_displayedAssignSections().length) return;
    var counts = {};
    assignments.forEach(function (a) {
      var s = _assignmentSession(a);
      counts[s] = (counts[s] || 0) + 1;
    });
    var best = selectedSession || 'A';
    var bestN = -1;
    TAP_SESSIONS.forEach(function (s) {
      var n = counts[s] || 0;
      if (n > bestN) {
        bestN = n;
        best = s;
      }
    });
    if (bestN > 0 && best !== selectedSession) {
      _setSessionFilter(best);
    }
  }

  function _sectionSession(s) {
    if (!s) return 'A';
    var rows = assignments.filter(function (a) { return _sameSectionId(a.tapping_section_id, s.id); });
    if (rows.length) {
      if (rows.length === 1) return _assignmentSession(rows[0]);
      var cur = selectedSession || 'A';
      var match = rows.find(function (a) { return _assignmentSession(a) === cur; });
      return match ? _assignmentSession(match) : _assignmentSession(rows[0]);
    }
    if (s.tapping_session) return s.tapping_session;
    return _parseMeta(s.metadata).tapping_session || 'A';
  }

  function _sectionSquadId(s) {
    if (!s) return '';
    var v = s.squad != null && s.squad !== '' ? s.squad : s.team_id;
    return v != null && v !== '' ? String(v).trim() : '';
  }

  function _teamMatchKeys() {
    if (!selectedTeam) return [];
    var tid = String(selectedTeam);
    var keys = { tid: true };
    var team = companyTeams.find(function (t) { return String(t.id) === tid; });
    if (team) {
      if (team.name) keys[String(team.name)] = true;
      var meta = _parseMeta(team.metadata);
      if (meta.code) keys[String(meta.code)] = true;
      if (meta.squad) keys[String(meta.squad)] = true;
      var num = String(team.name || '').match(/\d+/);
      if (num) keys[num[0]] = true;
    }
    return Object.keys(keys);
  }

  function _matchesTeamKey(value) {
    if (!selectedTeam || value == null || value === '') return false;
    var v = String(value);
    return _teamMatchKeys().indexOf(v) >= 0;
  }

  function _sectionMatchesTeam(s) {
    if (!selectedTeam) return false;
    return _matchesTeamKey(_sectionSquadId(s)) || _matchesTeamKey(s.team_id);
  }

  function _workerMatchesTeam(w) {
    if (!selectedTeam) return false;
    return _matchesTeamKey(w.team) || _matchesTeamKey(w.department) ||
      _matchesTeamKey(w.team_id) || _matchesTeamKey(w.production_team_id);
  }

  function _teamKeysForId(teamId) {
    if (!teamId || teamId === '__all__') return [];
    var tid = String(teamId);
    var keys = { tid: true };
    var team = companyTeams.find(function (t) { return String(t.id) === tid; });
    if (team) {
      if (team.name) keys[String(team.name)] = true;
      var meta = _parseMeta(team.metadata);
      if (meta.code) keys[String(meta.code)] = true;
      if (meta.squad) keys[String(meta.squad)] = true;
      var num = String(team.name || '').match(/\d+/);
      if (num) keys[num[0]] = true;
    }
    if (tid === 'team-lk') keys.LK = true;
    return Object.keys(keys);
  }

  function _valueInTeamKeys(value, keys) {
    if (!keys || !keys.length || value == null || value === '') return false;
    return keys.indexOf(String(value)) >= 0;
  }

  function _sectionMatchesTeamId(s, teamId) {
    if (!teamId || teamId === '__all__') return true;
    var keys = _teamKeysForId(teamId);
    return _valueInTeamKeys(_sectionSquadId(s), keys) || _valueInTeamKeys(s.team_id, keys);
  }

  function _workerMatchesTeamId(w, teamId) {
    if (!teamId || teamId === '__all__') return true;
    var keys = _teamKeysForId(teamId);
    return _valueInTeamKeys(w.team, keys) || _valueInTeamKeys(w.department, keys) ||
      _valueInTeamKeys(w.team_id, keys) || _valueInTeamKeys(w.production_team_id, keys);
  }

  function _teamNameById(teamId) {
    if (!teamId) return '—';
    var t = companyTeams.find(function (x) { return String(x.id) === String(teamId); });
    if (t) return t.name || ('Đội ' + teamId);
    return 'Đội ' + teamId;
  }

  function _visibleTeams() {
    var base = _productionTeams();
    if (_teamScope.mode === 'all') return base;
    if (_teamScope.mode === 'departments') {
      var depts = _teamScope.departmentIds || [];
      if (depts.indexOf('*') >= 0) return base;
      return base.filter(function (t) {
        return depts.indexOf(String(t.department || '')) >= 0 ||
          depts.indexOf(String(t.departmentId || '')) >= 0;
      });
    }
    var allowed = _teamScope.teamIds || [];
    if (!allowed.length) return [];
    return base.filter(function (t) {
      return allowed.indexOf(String(t.id)) >= 0;
    });
  }

  function _isTeamAllowed(teamId) {
    if (!teamId) return false;
    if (_teamScope.mode === 'all') return true;
    var visible = _visibleTeams();
    if (!visible.length && _teamScope.mode === 'teams') return false;
    return visible.some(function (t) { return String(t.id) === String(teamId); });
  }

  function _assertTeamAllowed(teamId, actionLabel) {
    if (_isTeamAllowed(teamId)) return true;
    _toast('Bạn không có quyền ' + (actionLabel || 'thao tác') + ' cho đội này. Liên hệ Phân quyền nếu được thay thế tạm.', 'error');
    return false;
  }

  function _updateTeamScopeHint() {
    var hint = _el('fhTeamScopeHint');
    if (!hint) return;
    if (!_teamScope.label) {
      hint.textContent = '';
      hint.style.display = 'none';
      return;
    }
    hint.textContent = '🔐 ' + _teamScope.label;
    hint.style.display = 'inline';
    hint.style.fontSize = '12px';
    hint.style.color = _teamScope.locked ? '#b45309' : '#64748b';
    hint.style.marginLeft = '4px';
  }

  async function _loadTeamScope() {
    if (typeof Permissions === 'undefined' || !Permissions.resolveTeamScope) {
      _teamScope = { mode: 'all', teamIds: [], departmentIds: [], locked: false, label: '' };
      return;
    }
    try {
      if (_isOnline() && Permissions.refreshUserProfile) {
        await Permissions.refreshUserProfile(_db(), _user()?.id);
      } else {
        Permissions.initFromUserData(_user());
      }
      if (Permissions.loadRoleDefinitions && _isOnline()) await Permissions.loadRoleDefinitions(_db());
      if (Permissions.loadPositionBasedRoles && _isOnline()) await Permissions.loadPositionBasedRoles(_db());
      if (Permissions.mergePositionRolesIntoCache) Permissions.mergePositionRolesIntoCache();
      _teamScope = await Permissions.resolveTeamScope('sanxuat', _db());
    } catch (e) {
      console.warn('[FieldHarvest] team scope:', e.message);
      _teamScope = { mode: 'all', teamIds: [], departmentIds: [], locked: false, label: '' };
    }
    _updateTeamScopeHint();
  }

  function _applyTeamScopeToSelection() {
    var el = _el('fhTeamFilter');
    var visible = _visibleTeams();
    if (_teamScope.mode !== 'all' && !visible.length && _teamScope.mode === 'teams') {
      selectedTeam = '';
      if (el) el.value = '';
      return;
    }
    if (_teamScope.locked && visible.length === 1) {
      selectedTeam = String(visible[0].id);
      if (el) {
        el.value = selectedTeam;
        el.disabled = true;
      }
      try { localStorage.setItem(FH_TEAM_KEY, selectedTeam); } catch (e) { /* ignore */ }
      return;
    }
    if (el) el.disabled = false;
    if (selectedTeam && !_isTeamAllowed(selectedTeam)) {
      selectedTeam = visible.length === 1 ? String(visible[0].id) : '';
      if (el) el.value = selectedTeam;
      try {
        if (selectedTeam) localStorage.setItem(FH_TEAM_KEY, selectedTeam);
        else localStorage.removeItem(FH_TEAM_KEY);
      } catch (e) { /* ignore */ }
    }
    if (!selectedTeam && el) {
      var defId = _resolveDefaultTeamId(visible.length ? visible : _productionTeams());
      if (defId && _isTeamAllowed(defId)) {
        selectedTeam = defId;
        el.value = selectedTeam;
        try { localStorage.setItem(FH_TEAM_KEY, selectedTeam); } catch (e) { /* ignore */ }
      }
    }
  }

  function _refreshTeamFilterOptions() {
    var el = _el('fhTeamFilter');
    if (!el) return;
    var current = selectedTeam || el.value || '';
    var html = '<option value="">— Chọn tổ/đội SX —</option>';
    var teams = _visibleTeams();
    if (teams.length) {
      teams.forEach(function (t) {
        var tid = String(t.id);
        var label = t.name || ('Đội ' + tid);
        html += '<option value="' + _escapeHtml(tid) + '"' + (current === tid ? ' selected' : '') + '>' +
          _escapeHtml(label) + '</option>';
      });
    } else if (_teamScope.mode === 'all' && _productionTeams().length) {
      _productionTeams().forEach(function (t) {
        var tid = String(t.id);
        var label = t.name || ('Đội ' + tid);
        html += '<option value="' + _escapeHtml(tid) + '"' + (current === tid ? ' selected' : '') + '>' +
          _escapeHtml(label) + '</option>';
      });
    }
    el.innerHTML = html;
    _applyTeamScopeToSelection();
  }

  function _sectionMeta(s) {
    return _parseMeta(s && s.metadata);
  }

  function _sectionLotCode(section) {
    if (!section) return '';
    var draft = _getAssignDraft(section.id);
    if (draft && draft.lot_code) return String(draft.lot_code).trim();
    var rows = _assignmentsForSection(section.id);
    if (rows.length) {
      var am = _assignmentMeta(rows[0]);
      if (am.lot_code) return String(am.lot_code).trim();
    }
    var meta = _sectionMeta(section);
    return String(section.lot_id || meta.lot_code || section.lot_code || '').trim();
  }

  function _lotFromCfg(cfg, section) {
    if (cfg && cfg.lot_code) return String(cfg.lot_code).trim();
    return _sectionLotCode(section);
  }

  async function loadLotCatalog() {
    var seen = {};
    lotCatalog = [];

    function _add(code, squad, areaHa, lotName) {
      code = String(code || '').trim();
      if (!code || seen[code]) return;
      seen[code] = true;
      var sq = String(squad || '').match(/\d+/);
      lotCatalog.push({
        lot_code: code,
        lot_name: lotName || code,
        squad: sq ? sq[0] : (squad || ''),
        area_ha: parseFloat(areaHa) || 0
      });
    }

    try {
      if (_isOnline()) {
        var snap = await _db().collection('rubberLots').get();
        snap.forEach(function (doc) {
          var d = Object.assign({ id: doc.id }, doc.data());
          var meta = _parseMeta(d.metadata);
          _add(d.lot_code || d.id, d.squad, d.area_ha, meta.ten_lo);
        });
      }
    } catch (e) { /* ignore */ }

    sections.forEach(function (s) {
      _add(_sectionLotId(s), s.squad, 0, s.lot_name || _sectionMeta(s).ten_lo);
    });

    try {
      var saved = localStorage.getItem('rrivLotGeoJson') || localStorage.getItem('rubberLotGeoJson');
      if (saved) {
        var data = JSON.parse(saved);
        (data.features || []).forEach(function (f) {
          var p = f.properties || {};
          _add(
            p.Ma_lo || p.Ma_lo_2026 || p.Malo || p.malo,
            p.Doi_2025 || p.doi_2025 || p.Nong_truong || p.nong_truong,
            p.Dtich2026_ha || p.Dien_tich_2025 || p.Dientich || p.dientich,
            p.Ten_lo || p.ten_lo
          );
        });
      }
    } catch (e) { /* ignore */ }

    if (typeof TabGardens !== 'undefined' && TabGardens.getMapPlots) {
      TabGardens.getMapPlots().forEach(function (p) {
        _add(p.code || p.id, p.squad || p.doi, (parseFloat(p.area) || 0) / 10000, p.name);
      });
    }

    lotCatalog.sort(function (a, b) {
      return a.lot_code.localeCompare(b.lot_code, undefined, { numeric: true });
    });
    _refreshLotDatalist();
  }

  function _refreshLotDatalist() {
    var el = _el('fhLotDatalist');
    if (!el) return;
    el.innerHTML = lotCatalog.map(function (l) {
      var label = l.lot_code + (l.squad ? ' · Đội ' + l.squad : '');
      return '<option value="' + _escapeHtml(l.lot_code) + '">' + _escapeHtml(label) + '</option>';
    }).join('');
  }

  function _lotInputHtml(lotCode) {
    return '<input type="text" class="fh-lot-inp" list="fhLotDatalist" value="' +
      _escapeHtml(lotCode || '') + '" placeholder="Mã lô" title="Mã lô cao su (từ bản đồ vườn cây)">';
  }

  function _modeCount(mode) {
    var m = WORK_MODES.find(function (x) { return x.v === mode; });
    return m ? m.n : 1;
  }

  function _evenShares(n) {
    if (n <= 1) return [100];
    var base = Math.floor(100 / n);
    var shares = [];
    var i;
    for (i = 0; i < n - 1; i++) shares.push(base);
    shares.push(100 - base * (n - 1));
    return shares;
  }

  function _intPct(v) {
    if (v === '' || v == null || isNaN(v)) return '';
    return Math.max(0, Math.min(100, Math.round(parseFloat(v))));
  }

  function _emptySlot() {
    return {
      tapper_id: '', tapper_pct: '',
      stripper_id: '', stripper_pct: '',
      collector_id: '', collector_pct: ''
    };
  }

  /** Gợi ý ban đầu: trút/bốc = người cạo (chỉ khi ô còn trống). Không ghi đè sau khi user đã chọn */
  function _syncSlotStripCollFromTapper(slot) {
    if (!slot || !slot.tapper_id) return slot;
    if (!slot.stripper_id) slot.stripper_id = slot.tapper_id;
    if (!slot.collector_id) slot.collector_id = slot.tapper_id;
    return slot;
  }

  /** Cắt/đủ số dòng theo trạng thái — không chia lại % (giữ tỉ lệ user đã chọn) */
  function _trimSlotsToMode(slots, mode) {
    var n = _modeCount(mode);
    var out = [];
    var i;
    for (i = 0; i < n; i++) {
      out.push(Object.assign(_emptySlot(), (slots && slots[i]) ? slots[i] : _emptySlot()));
    }
    return out;
  }

  /** Chuẩn hóa khi mới tạo / đổi trạng thái — dòng 1 mặc định trút/bốc = cạo; dòng 2+ để trống */
  function _normalizeSlots(slots, mode) {
    var n = _modeCount(mode);
    var out = [];
    var i;
    for (i = 0; i < n; i++) {
      var src = (slots && slots[i]) ? Object.assign(_emptySlot(), slots[i]) : _emptySlot();
      if (i > 0 && !slots) src = _emptySlot();
      if (i === 0) _syncSlotStripCollFromTapper(src);
      out.push(src);
    }
    STAGES.forEach(function (st) {
      _rebalanceStageInSlots(out, st.idKey, st.pctKey, true);
    });
    return out;
  }

  /** Chia tỉ lệ 1 công đoạn. forceEven: chỉ reset khi thêm/bớt người hoặc tổng chưa hợp lệ */
  function _rebalanceStageInSlots(slots, idKey, pctKey, forceEven) {
    var filled = [];
    slots.forEach(function (s, idx) {
      if (s[idKey]) filled.push(idx);
    });
    if (filled.length <= 1) {
      slots.forEach(function (s) {
        if (s[idKey] && filled.length === 1) s[pctKey] = 100;
        else if (!s[idKey]) s[pctKey] = '';
      });
      return slots;
    }
    if (!forceEven) {
      var sum = 0;
      var hasAll = true;
      filled.forEach(function (idx) {
        var p = slots[idx][pctKey];
        if (p === '' || p == null) hasAll = false;
        else sum += parseFloat(p) || 0;
      });
      if (hasAll && Math.round(sum) === 100) {
        slots.forEach(function (s) {
          if (!s[idKey]) s[pctKey] = '';
        });
        return slots;
      }
    }
    var shares = _evenShares(filled.length);
    var si = 0;
    slots.forEach(function (s) {
      if (s[idKey]) {
        s[pctKey] = shares[si++];
      } else {
        s[pctKey] = '';
      }
    });
    return slots;
  }

  /** Khi sửa % 1 người → các người khác (cùng công đoạn) tự chỉnh sao cho tổng = 100 */
  function _rebalanceOnPctEdit(slots, idKey, pctKey, editedSlot, newPct) {
    var val = _intPct(newPct);
    if (val === '') val = 0;
    var filled = [];
    slots.forEach(function (s, idx) {
      if (s[idKey]) filled.push(idx);
    });
    if (filled.length <= 1) {
      if (filled.length === 1) slots[filled[0]][pctKey] = 100;
      return slots;
    }
    if (filled.indexOf(editedSlot) < 0) return slots;

    slots[editedSlot][pctKey] = val;
    var others = filled.filter(function (i) { return i !== editedSlot; });
    var remaining = 100 - val;
    if (others.length === 1) {
      slots[others[0]][pctKey] = remaining;
      return slots;
    }
    var base = Math.floor(remaining / others.length);
    var used = 0;
    others.forEach(function (idx, oi) {
      if (oi === others.length - 1) {
        slots[idx][pctKey] = remaining - used;
      } else {
        slots[idx][pctKey] = base;
        used += base;
      }
    });
    return slots;
  }

  function _stagePeople(slots, idKey, pctKey) {
    return slots.filter(function (s) { return s[idKey]; }).map(function (s) {
      return { worker_id: s[idKey], yield_share_pct: s[pctKey] };
    });
  }

  function _sumStage(slots, idKey, pctKey) {
    return _stagePeople(slots, idKey, pctKey)
      .reduce(function (sum, p) { return sum + (parseFloat(p.yield_share_pct) || 0); }, 0);
  }

  function _legacyToSlots(meta) {
    var mode = meta.work_mode || meta.tap_mode || 'solo';
    var n = _modeCount(mode);
    var slots = [];
    var i;
    var tappers = meta.tappers || (meta.default_worker_id ? [{ worker_id: meta.default_worker_id, yield_share_pct: 100 }] : []);
    var strippers = meta.strippers || (meta.stripper_id ? [{ worker_id: meta.stripper_id, yield_share_pct: 100 }] : []);
    var collectors = meta.collectors || (meta.collector_id ? [{ worker_id: meta.collector_id, yield_share_pct: 100 }] : []);
    for (i = 0; i < n; i++) {
      var sl = _emptySlot();
      if (tappers[i]) {
        sl.tapper_id = tappers[i].worker_id || '';
        sl.tapper_pct = tappers[i].yield_share_pct != null ? tappers[i].yield_share_pct : '';
      }
      if (strippers[i]) {
        sl.stripper_id = strippers[i].worker_id || '';
        sl.stripper_pct = strippers[i].yield_share_pct != null ? strippers[i].yield_share_pct : '';
      }
      if (collectors[i]) {
        sl.collector_id = collectors[i].worker_id || '';
        sl.collector_pct = collectors[i].yield_share_pct != null ? collectors[i].yield_share_pct : '';
      }
      slots.push(sl);
    }
    return _normalizeSlots(slots, mode);
  }

  /** Bảng phân công trống cho một ngày (không lấy mặc định phần cạo). */
  function _blankAssignConfig(workMode) {
    var mode = workMode || 'solo';
    return { work_mode: mode, slots: _normalizeSlots([_emptySlot()], mode), notes: '', lot_code: '' };
  }

  function _assignmentSession(a) {
    if (!a) return 'A';
    return _assignmentMeta(a).tapping_session || 'A';
  }

  /** Khi đổi ngày, tự chọn phiên có nhiều phân công nhất nếu phiên hiện tại không có dòng nào. */
  function _syncSessionFilterFromAssignments() {
    if (!assignments.length) return false;
    var counts = {};
    assignments.forEach(function (a) {
      var s = _assignmentSession(a);
      counts[s] = (counts[s] || 0) + 1;
    });
    var session = selectedSession || 'A';
    if ((counts[session] || 0) > 0) return false;
    var best = session;
    var bestN = 0;
    TAP_SESSIONS.forEach(function (s) {
      var n = counts[s] || 0;
      if (n > bestN) {
        bestN = n;
        best = s;
      }
    });
    if (bestN <= 0 || best === session) return false;
    selectedSession = best;
    var el = _el('fhSessionFilter');
    if (el) el.value = best;
    try { localStorage.setItem(FH_SESSION_KEY, best); } catch (e) { /* ignore */ }
    _updateSessionHint();
    return true;
  }

  function _assignmentsForSection(sectionId) {
    var session = selectedSession || 'A';
    return assignments.filter(function (a) {
      if (!_sameSectionId(a.tapping_section_id, sectionId)) return false;
      return _assignmentSession(a) === session;
    });
  }

  function _sectionHasAssignmentsOnDate(sectionId) {
    return assignments.some(function (a) { return a.tapping_section_id === sectionId; });
  }

  function _configFromAssignmentRows(rows) {
    if (!rows || !rows.length) return null;

    var ri;
    for (ri = 0; ri < rows.length; ri++) {
      var metaSlots = _assignmentMeta(rows[ri]);
      if (metaSlots.slots && metaSlots.slots.length) {
        var modeFromMeta = metaSlots.work_mode || 'solo';
        return {
          work_mode: modeFromMeta,
          slots: _normalizeSlots(metaSlots.slots, modeFromMeta),
          notes: rows[ri].notes || rows[0].notes || '',
          lot_code: metaSlots.lot_code || ''
        };
      }
    }

    var notes = '';
    var work_mode = 'solo';
    var lot_code = '';
    var tapByWorker = {};
    var stripByWorker = {};
    var collByWorker = {};

    rows.forEach(function (a) {
      var meta = _assignmentMeta(a);
      if (meta.work_mode) work_mode = meta.work_mode;
      if (a.notes) notes = a.notes;
      if (meta.lot_code && !lot_code) lot_code = meta.lot_code;

      function _add(map, role, wid, pct) {
        if (!wid) return;
        if (!map[wid]) map[wid] = { worker_id: wid, yield_share_pct: pct };
      }

      if (meta.roles && meta.roles.length) {
        meta.roles.forEach(function (rr) {
          var pct = rr.yield_share_pct != null ? parseFloat(rr.yield_share_pct) : null;
          if (rr.role === 'tapper' || rr.role === 'primary') _add(tapByWorker, 'tap', a.worker_id, pct);
          else if (rr.role === 'stripper') _add(stripByWorker, 'strip', a.worker_id, pct);
          else if (rr.role === 'collector') _add(collByWorker, 'coll', a.worker_id, pct);
        });
        return;
      }

      var role = a.assignment_role || 'tapper';
      var pct = meta.yield_share_pct != null ? parseFloat(meta.yield_share_pct) : null;
      if (role === 'primary' || role === 'tapper') _add(tapByWorker, 'tap', a.worker_id, pct);
      else if (role === 'stripper') _add(stripByWorker, 'strip', a.worker_id, pct);
      else if (role === 'collector') _add(collByWorker, 'coll', a.worker_id, pct);
    });

    var tapList = Object.keys(tapByWorker).map(function (k) { return tapByWorker[k]; });
    var stripList = Object.keys(stripByWorker).map(function (k) { return stripByWorker[k]; });
    var collList = Object.keys(collByWorker).map(function (k) { return collByWorker[k]; });

    if (tapList.length >= 3) work_mode = 'coop_3';
    else if (tapList.length === 2) work_mode = 'coop_2';

    var n = _modeCount(work_mode);
    var slots = [];
    var i;
    for (i = 0; i < n; i++) {
      var sl = _emptySlot();
      if (tapList[i]) {
        sl.tapper_id = tapList[i].worker_id;
        sl.tapper_pct = tapList[i].yield_share_pct != null ? tapList[i].yield_share_pct : '';
      }
      if (stripList[i]) {
        sl.stripper_id = stripList[i].worker_id;
        sl.stripper_pct = stripList[i].yield_share_pct != null ? stripList[i].yield_share_pct : '';
      }
      if (collList[i]) {
        sl.collector_id = collList[i].worker_id;
        sl.collector_pct = collList[i].yield_share_pct != null ? collList[i].yield_share_pct : '';
      }
      slots.push(sl);
    }
    return { work_mode: work_mode, slots: _normalizeSlots(slots, work_mode), notes: notes, lot_code: lot_code };
  }

  function _sameSectionId(a, b) {
    return String(a || '') === String(b || '');
  }

  function _findSectionById(sectionId) {
    if (sectionId == null || sectionId === '') return null;
    return sections.find(function (s) { return _sameSectionId(s.id, sectionId); }) || null;
  }

  /** Phần cạo cho tổng hợp sản lượng — master + fallback từ phân công đã tải. */
  function _sectionForSummaryWeighing(sectionId) {
    var sec = _findSectionById(sectionId);
    if (sec && sec.active !== false) return sec;
    var resolved = _resolveSectionForUi(sectionId);
    if (resolved && resolved.active !== false) return resolved;
    var rows = assignments.filter(function (a) {
      return _sameSectionId(a.tapping_section_id, sectionId);
    });
    if (!rows.length) return sec || null;
    var meta = _assignmentMeta(rows[0]);
    var sid = String(sectionId);
    var sectionNo = null;
    var pcM = sid.match(/-pc(\d+)$/i);
    if (pcM) sectionNo = parseInt(pcM[1], 10);
    var lotCode = meta.lot_code || '';
    return {
      id: sid,
      section_code: lotCode ? (lotCode + '|PC|' + (sectionNo || '')) : sid,
      section_no: sectionNo,
      lot_id: lotCode,
      team_id: (sec && sec.team_id) || selectedTeam || '',
      squad: sec && sec.squad,
      active: true
    };
  }

  function _draftKey(sectionId) {
    return String(sectionId || '');
  }

  function _getAssignDraft(sectionId) {
    var k = _draftKey(sectionId);
    if (Object.prototype.hasOwnProperty.call(assignDraft, k)) return assignDraft[k];
    if (Object.prototype.hasOwnProperty.call(assignDraft, sectionId)) return assignDraft[sectionId];
    return null;
  }

  function _setAssignDraft(sectionId, cfg) {
    assignDraft[_draftKey(sectionId)] = cfg;
    _persistAssignDraftCache();
  }

  function _assignDraftCacheKey(date) {
    return 'fh-draft:' + (date || _dateVal()) + ':' + (selectedTeam || '') + ':' + (selectedSession || 'A');
  }

  function _assignDraftCount() {
    return Object.keys(assignDraft).length;
  }

  function _persistAssignDraftCache(date) {
    try {
      var key = _assignDraftCacheKey(date);
      if (!_assignDraftCount()) {
        sessionStorage.removeItem(key);
        return;
      }
      sessionStorage.setItem(key, JSON.stringify(assignDraft));
    } catch (e) { /* ignore */ }
  }

  function _restoreAssignDraftCache(date) {
    try {
      var raw = sessionStorage.getItem(_assignDraftCacheKey(date));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function _clearAssignDraftCache(date) {
    try { sessionStorage.removeItem(_assignDraftCacheKey(date)); } catch (e) { /* ignore */ }
  }

  function _sortSectionsByCode(list) {
    return (list || []).slice().sort(function (a, b) {
      return String(a.section_code || '').localeCompare(String(b.section_code || ''), undefined, { numeric: true });
    });
  }

  function _configForSection(section) {
    var draft = _getAssignDraft(section.id);
    if (draft) {
      if (!draft.lot_code) draft.lot_code = _sectionLotCode(section);
      return draft;
    }
    var saved = _configFromAssignmentRows(_assignmentsForSection(section.id));
    if (saved) {
      if (!saved.lot_code) saved.lot_code = _sectionLotCode(section);
      return saved;
    }
    return Object.assign(_blankAssignConfig(), { lot_code: _sectionLotCode(section) });
  }

  /** Cấu hình hiển thị — ưu tiên draft/lưu DB; DOM chỉ ghi đè khi người dùng đã chọn lô. */
  function _resolveAssignCfg(section) {
    var cfg = _getAssignDraft(section.id) || _configForSection(section);
    if (cfg && !cfg.lot_code) cfg.lot_code = _sectionLotCode(section);
    if (!cfg.slots || !cfg.slots.length) {
      var saved = _configForSection(section);
      cfg.slots = (saved && saved.slots && saved.slots.length) ? saved.slots : _normalizeSlots([], cfg.work_mode || 'solo');
    }
    var domState = _collectSectionState(section.id);
    if (!domState) return cfg;
    return Object.assign({}, cfg, domState, {
      lot_code: (domState.lot_code && String(domState.lot_code).trim()) ? domState.lot_code : cfg.lot_code,
      slots: (domState.slots && domState.slots.length) ? domState.slots : cfg.slots
    });
  }

  function _filteredSections() {
    var session = selectedSession || 'A';
    if (!selectedTeam) return [];
    return sections.filter(function (s) {
      if (s.active === false) return false;
      if (!_sectionMatchesTeam(s)) return false;
      if (_getAssignDraft(s.id)) return true;
      if (_assignmentsForSection(s.id).length) return true;
      if (_sectionHasAssignmentsOnDate(s.id)) return false;
      var master = s.tapping_session || _parseMeta(s.metadata).tapping_session || '';
      if (!master) return true;
      return master === session;
    });
  }

  function _resolveSectionForUi(sectionId) {
    var sec = _findSectionById(sectionId);
    var session = selectedSession || 'A';
    var rows = assignments.filter(function (a) {
      return _sameSectionId(a.tapping_section_id, sectionId) && _assignmentSession(a) === session;
    });
    var cfg = _getAssignDraft(sectionId);
    if (!rows.length && !cfg) return null;
    if (sec && sec.active === false && !rows.length) return null;

    var meta = rows.length ? _assignmentMeta(rows[0]) : {};
    var lotCode = (cfg && cfg.lot_code) || meta.lot_code || (sec && _sectionLotId(sec)) || '';
    if (sec) {
      return Object.assign({}, sec, {
        lot_id: lotCode || sec.lot_id,
        lot_code: lotCode || sec.lot_code
      });
    }
    var sid = String(sectionId);
    var sectionNo = null;
    var pcM = sid.match(/-pc(\d+)$/i);
    if (pcM) sectionNo = parseInt(pcM[1], 10);
    return {
      id: sid,
      section_code: lotCode ? (lotCode + '|PC|' + (sectionNo || '')) : sid,
      section_no: sectionNo,
      lot_id: lotCode,
      lot_code: lotCode,
      active: true,
      team_id: selectedTeam || FH_DEFAULT_TEAM_ID
    };
  }

  /** Phần cạo hiển thị trên bảng — assignDraft (nạp/nháp) + phân công đã lưu ngày + phiên. */
  function _displayedAssignSections() {
    _ensureProductionTeamSelected();
    var session = selectedSession || 'A';
    if (!selectedTeam) return [];
    var byId = {};

    Object.keys(assignDraft).forEach(function (sid) {
      var sec = _resolveSectionForUi(sid);
      if (sec) byId[_draftKey(sec.id)] = sec;
    });

    assignments.forEach(function (a) {
      if (_assignmentSession(a) !== session) return;
      var sec = _resolveSectionForUi(a.tapping_section_id);
      if (sec) byId[_draftKey(sec.id)] = sec;
    });

    return _sortSectionsByCode(Object.keys(byId).map(function (k) { return byId[k]; }));
  }

  function _initSessionFilter() {
    var el = _el('fhSessionFilter');
    var saved = '';
    try { saved = localStorage.getItem(FH_SESSION_KEY) || ''; } catch (e) { /* ignore */ }
    if (el) {
      if (saved && TAP_SESSIONS.indexOf(saved) >= 0) el.value = saved;
      selectedSession = el.value || 'A';
    } else {
      selectedSession = (saved && TAP_SESSIONS.indexOf(saved) >= 0) ? saved : 'A';
    }
    _updateSessionHint();
  }

  function _fitWorkerSelectWidth(sel) {
    if (!sel || !sel.options) return;
    var probe = _fitWorkerSelectWidth._probe;
    if (!probe) {
      probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;visibility:hidden;pointer-events:none;';
      document.body.appendChild(probe);
      _fitWorkerSelectWidth._probe = probe;
    }
    var style = window.getComputedStyle(sel);
    probe.style.font = style.font;
    probe.style.fontSize = style.fontSize;
    probe.style.fontWeight = style.fontWeight;
    probe.style.fontFamily = style.fontFamily;
    probe.style.letterSpacing = style.letterSpacing;
    var opt = sel.options[sel.selectedIndex];
    probe.textContent = (opt && opt.textContent) ? opt.textContent : '— Không —';
    var textW = probe.offsetWidth;
    probe.textContent = '  ';
    var pad = probe.offsetWidth + 26;
    sel.style.width = Math.ceil(textW + pad) + 'px';
  }

  function _stageCellHtml(workerId, selClass, pctClass, pctVal, hasWorker, hidePct) {
    var pctHtml = hidePct ? '' : (
      '<input type="number" class="fh-share-inp ' + pctClass + '" min="0" max="100" step="1" value="' +
      (pctVal !== '' && pctVal != null ? _intPct(pctVal) : '') + '"' +
      (hasWorker ? '' : ' disabled') + ' placeholder="0" title="Tỉ lệ %">'
    );
    var nameLabel = workerId ? _workerLabel(workerId) : '';
    var selTitle = nameLabel ? (' title="' + _escapeHtml(nameLabel) + '"') : '';
    return '<td class="fh-stage-cell fh-td-stage"><div class="fh-stage-inline">' +
      '<div class="fh-worker-cell">' +
      _workerSelectHtml(workerId, selClass, selTitle) +
      '</div>' + pctHtml + '</div></td>';
  }

  /** Phần cạo thuộc đội đang chọn (dùng khi nạp phân công từ ngày khác). */
  function _sectionEligibleForCopy(sectionId, rows) {
    var sec = _findSectionById(sectionId);
    if (sec && sec.active === false) return false;
    if (sec && selectedTeam && !_sectionMatchesTeamId(sec, selectedTeam)) return false;
    if (!sec) return !!(rows && rows.length);
    return true;
  }

  function _workerSelectHtml(selectedId, extraClass, extraAttrs) {
    var html = '<option value="">— Không —</option>';
    var foundSelected = false;
    workers.forEach(function (w) {
      var sel = _sameSectionId(w.id, selectedId) ? ' selected' : '';
      if (sel) foundSelected = true;
      var label = _workerGroupLabel(w.id) + _workerName(w);
      html += '<option value="' + w.id + '"' + sel + '>' + _escapeHtml(label) + '</option>';
    });
    if (selectedId && !foundSelected) {
      html += '<option value="' + _escapeHtml(String(selectedId)) + '" selected>' +
        _escapeHtml(_workerLabel(selectedId)) + '</option>';
    }
    var cls = extraClass ? ('fh-sel ' + extraClass) : 'fh-sel';
    return '<select class="' + cls + '"' + (extraAttrs || '') + '>' + html + '</select>';
  }

  function _modeSelectHtml(mode) {
    return WORK_MODES.map(function (m) {
      var sel = m.v === mode ? ' selected' : '';
      return '<option value="' + m.v + '"' + sel + '>' + m.l + '</option>';
    }).join('');
  }

  function _sessionBadge(session) {
    var cls = { A: 'fh-session-a', B: 'fh-session-b', C: 'fh-session-c', D: 'fh-session-d' };
    return '<span class="fh-session-badge ' + (cls[session] || 'fh-session-a') + '">' + session + '</span>';
  }

  function _mergeSlotFromFallback(domSlot, fbSlot) {
    if (!fbSlot) return domSlot;
    var out = Object.assign({}, domSlot);
    STAGES.forEach(function (st) {
      if (!out[st.idKey] && fbSlot[st.idKey]) {
        out[st.idKey] = fbSlot[st.idKey];
        if ((out[st.pctKey] === '' || out[st.pctKey] == null) &&
            fbSlot[st.pctKey] !== '' && fbSlot[st.pctKey] != null) {
          out[st.pctKey] = fbSlot[st.pctKey];
        }
      }
    });
    return out;
  }

  function _mergeAssignCfgFromFallback(collected, fallback) {
    if (!fallback) return collected;
    if (!collected) return fallback;
    var mode = collected.work_mode || fallback.work_mode || 'solo';
    var n = Math.max((collected.slots || []).length, (fallback.slots || []).length);
    var merged = [];
    var i;
    for (i = 0; i < n; i++) {
      merged.push(_mergeSlotFromFallback(
        (collected.slots || [])[i] || _emptySlot(),
        (fallback.slots || [])[i]
      ));
    }
    return {
      work_mode: mode,
      slots: _trimSlotsToMode(merged, mode),
      notes: collected.notes || fallback.notes || '',
      lot_code: collected.lot_code || fallback.lot_code || ''
    };
  }

  function _collectSectionState(sectionId) {
    var group = document.querySelectorAll('#fhAssignBody tr[data-section-id="' + sectionId + '"]');
    if (!group.length) return _getAssignDraft(sectionId) || null;

    var draftFallback = _getAssignDraft(sectionId) || null;
    var first = group[0];
    var modeEl = first.querySelector('.fh-mode-sel');
    var work_mode = modeEl ? modeEl.value : (draftFallback ? draftFallback.work_mode : 'solo');
    var slots = [];
    group.forEach(function (tr) {
      var slot = parseInt(tr.getAttribute('data-slot'), 10);
      if (isNaN(slot)) return;
      slots[slot] = {
        tapper_id: (tr.querySelector('.fh-tapper-sel') || {}).value || '',
        tapper_pct: (function () {
          var el = tr.querySelector('.fh-tap-share-inp');
          return el && el.value !== '' ? _intPct(el.value) : '';
        })(),
        stripper_id: (tr.querySelector('.fh-stripper-sel') || {}).value || '',
        stripper_pct: (function () {
          var el = tr.querySelector('.fh-strip-share-inp');
          return el && el.value !== '' ? _intPct(el.value) : '';
        })(),
        collector_id: (tr.querySelector('.fh-collector-sel') || {}).value || '',
        collector_pct: (function () {
          var el = tr.querySelector('.fh-coll-share-inp');
          return el && el.value !== '' ? _intPct(el.value) : '';
        })()
      };
    });
    var notesEl = first.querySelector('.fh-notes-inp');
    var lotEl = first.querySelector('.fh-lot-sel') || first.querySelector('.fh-lot-inp');
    var lotFromDom = lotEl ? lotEl.value.trim() : '';
    var lotFromSaved = '';
    if (!lotFromDom) {
      if (draftFallback && draftFallback.lot_code) lotFromSaved = draftFallback.lot_code;
      else {
        var savedCfg = _configFromAssignmentRows(_assignmentsForSection(sectionId));
        if (savedCfg && savedCfg.lot_code) lotFromSaved = savedCfg.lot_code;
        else lotFromSaved = _sectionLotCode(_findSectionById(sectionId));
      }
    }
    var outSlots = _trimSlotsToMode(slots, work_mode);
    if (work_mode === 'solo' && outSlots[0]) {
      if (outSlots[0].tapper_id) outSlots[0].tapper_pct = 100;
      if (outSlots[0].stripper_id) outSlots[0].stripper_pct = 100;
      if (outSlots[0].collector_id) outSlots[0].collector_pct = 100;
    }
    var result = {
      work_mode: work_mode,
      slots: outSlots,
      notes: notesEl ? notesEl.value.trim() : (draftFallback ? draftFallback.notes : ''),
      lot_code: lotFromDom || lotFromSaved || ''
    };
    return draftFallback ? _mergeAssignCfgFromFallback(result, draftFallback) : result;
  }

  function _collectAllAssignStates() {
    var draft = {};
    _displayedAssignSections().forEach(function (s) {
      var st = _collectSectionState(s.id);
      if (st) draft[_draftKey(s.id)] = st;
    });
    return draft;
  }

  /** Mọi phần cạo cần lưu — giao diện + mọi key trong assignDraft. */
  function _sectionsForAssignSave(extraSectionIds) {
    var byId = {};
    _displayedAssignSections().forEach(function (s) { byId[_draftKey(s.id)] = s; });
    (extraSectionIds || []).forEach(function (sid) {
      if (byId[_draftKey(sid)]) return;
      var sec = _resolveSectionForUi(sid);
      if (sec) byId[_draftKey(sec.id)] = sec;
    });
    return _sortSectionsByCode(Object.keys(byId).map(function (k) { return byId[k]; }));
  }

  function _labelStage(people) {
    return people.map(function (p) {
      return _workerLabel(p.worker_id) + ' ' + (p.yield_share_pct || 0) + '%';
    }).join(', ');
  }

  function getSectionWeighRows() {
    var rows = [];
    _displayedAssignSections().forEach(function (s) {
      var cfg = _getAssignDraft(s.id) || _configForSection(s);
      var slots = cfg.slots || [];
      var tappers = _stagePeople(slots, 'tapper_id', 'tapper_pct');
      if (!tappers.length) return;
      rows.push({
        tapping_section_id: s.id,
        section_code: s.section_code || s.id,
        lot_code: _lotFromCfg(cfg, s),
        tappers: tappers,
        strippers: _stagePeople(slots, 'stripper_id', 'stripper_pct'),
        collectors: _stagePeople(slots, 'collector_id', 'collector_pct'),
        tap_label: _labelStage(tappers),
        strip_label: _labelStage(_stagePeople(slots, 'stripper_id', 'stripper_pct')),
        coll_label: _labelStage(_stagePeople(slots, 'collector_id', 'collector_pct'))
      });
    });
    return rows;
  }

  function _dateVal() {
    var el = _el('fhRecordDate');
    return (el && el.value) ? el.value : _today();
  }

  function _drcFromTsc(materialType, tsc) {
    if (typeof TscDrcConverter === 'undefined') return null;
    return TscDrcConverter.tscToDrc(materialType, tsc);
  }

  function _parseTscPct(val) {
    if (val === '' || val == null) return 0;
    var t = parseFloat(val);
    return isNaN(t) || t < 0 ? 0 : t;
  }

  function _parseCoagDrcPct(val) {
    if (val === '' || val == null) return 0;
    var d = parseFloat(val);
    return isNaN(d) || d < 0 ? 0 : d;
  }

  /** Mủ nước: TSC trống = 0 → DRC = 0 → quy khô thùng = 0. */
  function _latexBinMetrics(bin) {
    var net = _netKg(bin.gross_kg, bin.tare_kg);
    var tsc = _parseTscPct(bin.tsc_pct);
    var drc = tsc > 0 ? (_drcFromTsc('latex', tsc) || 0) : 0;
    var dry = _dryFromFreshDrc(net, drc);
    return { net: net, tsc: tsc, drc: drc, dry: dry };
  }

  /** Mủ đông: nhập DRC trực tiếp; trống = 0. */
  function _coagBinMetrics(bin) {
    var net = _netKg(bin.gross_kg, bin.tare_kg);
    var drc = _parseCoagDrcPct(bin.drc_pct);
    var dry = _dryFromFreshDrc(net, drc);
    return { net: net, drc: drc, dry: dry };
  }

  function _enrichBinsForSave(latexBins, coagBins) {
    return {
      latex_bins: (latexBins || []).map(function (b) {
        var m = _latexBinMetrics(b);
        return Object.assign({}, b, {
          tsc_pct: b.tsc_pct === '' || b.tsc_pct == null ? '' : m.tsc,
          net_kg: m.net,
          drc_pct: m.drc,
          dry_kg: m.dry
        });
      }),
      coag_bins: (coagBins || []).map(function (b) {
        var m = _coagBinMetrics(b);
        return Object.assign({}, b, {
          net_kg: m.net,
          drc_pct: b.drc_pct === '' || b.drc_pct == null ? '' : m.drc,
          dry_kg: m.dry
        });
      })
    };
  }

  function _dryFromFreshDrc(fresh, drc) {
    if (typeof TscDrcConverter !== 'undefined') {
      return TscDrcConverter.dryKg(fresh, drc);
    }
    var f = parseFloat(fresh) || 0;
    var d = parseFloat(drc) || 0;
    return f > 0 && d > 0 ? parseFloat((f * d / 100).toFixed(3)) : 0;
  }

  function _updateSessionHint() {
    var hint = _el('fhSessionHint');
    if (!hint) return;
    var catalog = _filteredSections();
    var displayed = _displayedAssignSections();
    if (!selectedTeam) {
      hint.textContent = 'Chọn đội sản xuất để phân công phiên ' + selectedSession;
      return;
    }
    if (!displayed.length) {
      hint.textContent = catalog.length
        ? ('Phiên ' + selectedSession + ': chưa phân công ngày này — dùng «Nạp phân công»')
        : ('Phiên ' + selectedSession + ': chưa có phần cạo trong danh mục đội này');
      return;
    }
    hint.textContent = 'Phiên ' + selectedSession + ': ' + displayed.length + ' phần cạo · ' +
      getSectionWeighRows().length + ' đã phân cạo';
  }

  async function loadSections() {
    var fromCache = false;
    try {
      if (_isOnline()) {
        var snap = await _db().collection('tappingSections').get();
        sections = snap.docs.map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        });
        sections.sort(function (a, b) {
          return String(a.section_code || '').localeCompare(String(b.section_code || ''));
        });
        if (_offlineReady()) await FieldHarvestOffline.cachePut('sections', sections);
      } else {
        fromCache = true;
      }
    } catch (e) {
      console.warn('loadSections:', e.message);
      fromCache = true;
    }
    if (_isOnline() && !sections.length) {
      try {
        var retry = await _db().collection('tappingSections').get();
        sections = retry.docs.map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        });
        if (sections.length && _offlineReady()) await FieldHarvestOffline.cachePut('sections', sections);
      } catch (e2) {
        console.warn('loadSections retry:', e2.message);
      }
    }
    if (fromCache && _offlineReady()) {
      sections = await FieldHarvestOffline.cacheGet('sections') || [];
    } else if (fromCache) {
      sections = [];
    }
  }

  async function loadTeams() {
    var fromCache = false;
    try {
      if (_isOnline()) {
        var snap = await _db().collection('categoryTeams').get();
        companyTeams = snap.docs.map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        });
        companyTeams.sort(function (a, b) {
          return String(a.name || a.id).localeCompare(String(b.name || b.id), undefined, { numeric: true });
        });
        if (_offlineReady()) await FieldHarvestOffline.cachePut('teams', companyTeams);
      } else {
        fromCache = true;
      }
    } catch (e) {
      fromCache = true;
    }
    if (fromCache && _offlineReady()) {
      companyTeams = await FieldHarvestOffline.cacheGet('teams') || [];
    } else if (fromCache) {
      companyTeams = [];
    }
    _refreshTeamFilterOptions();
    _refreshSummaryTeamOptions();
  }

  async function loadWorkers() {
    var fromCache = false;
    try {
      if (_isOnline()) {
        var allWorkers = await _fetchAllWorkersFromServer();
        workers = _filterWorkersList(allWorkers);
      } else {
        fromCache = true;
      }
    } catch (e) {
      fromCache = true;
    }
    if (fromCache) await _loadWorkersFromCache();
  }

  async function _ensureAssignmentsCacheFresh() {
    if (!_offlineReady() || !_isOnline()) return;
    var meta = await FieldHarvestOffline.getMeta();
    if (meta.assignmentsCacheVer === FH_ASSIGNMENTS_CACHE_VER) return;
    await FieldHarvestOffline.clearAllAssignmentCaches();
    await FieldHarvestOffline.setMeta({ assignmentsCacheVer: FH_ASSIGNMENTS_CACHE_VER });
  }

  async function loadAssignments(opts) {
    opts = opts || {};
    var date = _dateVal();
    var memDraft = (!opts.clearDraft && _assignDraftCount())
      ? JSON.parse(JSON.stringify(assignDraft)) : null;
    assignDraft = {};
    var fromCache = false;
    try {
      if (_isOnline()) {
        await _ensureAssignmentsCacheFresh();
        var snap = await _db().collection('sectionWorkerAssignments').where('record_date', '==', date).get();
        assignments = _dedupeAssignments(snap.docs.map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        }));
        if (_offlineReady()) {
          await FieldHarvestOffline.saveAssignmentsForDate(date, assignments);
          await FieldHarvestOffline.setMeta({ assignmentsCacheVer: FH_ASSIGNMENTS_CACHE_VER });
        }
      } else {
        fromCache = true;
      }
    } catch (e) {
      console.warn('loadAssignments:', e);
      fromCache = true;
    }
    if (fromCache && _offlineReady()) {
      assignments = _dedupeAssignments(await FieldHarvestOffline.getAssignmentsForDate(date));
    } else if (fromCache) {
      assignments = [];
    }
    if (_isOnline() && !assignments.length) {
      try {
        var retry = await _db().collection('sectionWorkerAssignments').where('record_date', '==', date).get();
        var retryRows = _dedupeAssignments(retry.docs.map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        }));
        if (retryRows.length) {
          assignments = retryRows;
          if (_offlineReady()) await FieldHarvestOffline.saveAssignmentsForDate(date, assignments);
        }
      } catch (e2) {
        console.warn('loadAssignments retry:', e2);
      }
    }
    if (memDraft) {
      assignDraft = memDraft;
    } else {
      var cachedDraft = _restoreAssignDraftCache(date);
      if (cachedDraft && Object.keys(cachedDraft).length) assignDraft = cachedDraft;
    }
    _repairAssignmentViewFilters();
    renderAssignmentTable();
    renderAssignmentStats();
    if (weighSectionId) renderSectionWeighPanel();
    _updateOfflineUI();
  }

  async function loadWeighings() {
    weighDraft = {};
    var date = _dateVal();
    var fromCache = false;
    try {
      if (_isOnline()) {
        var snap = await _db().collection('fieldWorkerWeighings').where('record_date', '==', date).get();
        weighings = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        if (_offlineReady()) await FieldHarvestOffline.saveWeighingsForDate(date, weighings);
      } else {
        fromCache = true;
      }
    } catch (e) {
      fromCache = true;
    }
    if (fromCache && _offlineReady()) {
      weighings = await FieldHarvestOffline.getWeighingsForDate(date);
    } else if (fromCache) {
      weighings = [];
    }
    try {
      renderAssignmentStats();
    } catch (e) {
      console.warn('renderAssignmentStats:', e.message);
    }
    await _refreshYieldSummary();
    if (weighSectionId) {
      weighDraft[weighSectionId] = _buildWeighDraft(weighSectionId);
      renderSectionWeighPanel();
    } else {
      renderAssignmentTable();
    }
    _updateOfflineUI();
  }


  function renderAssignmentStats() {
    var el = _el('fhAssignStats');
    if (!el) return;
    var weighRows = getSectionWeighRows();
    var weighed = weighRows.filter(function (r) {
      return weighings.some(function (w) {
        return w.tapping_section_id === r.tapping_section_id && parseFloat(w.total_fresh_kg) > 0;
      });
    }).length;
    el.innerHTML =
      '<span class="fh-stat">Phiên <strong>' + selectedSession + '</strong></span>' +
      '<span class="fh-stat">Phần cạo: <strong>' + _displayedAssignSections().length + '</strong></span>' +
      '<span class="fh-stat">Đã phân: <strong>' + weighRows.length + '</strong></span>' +
      '<span class="fh-stat">Đã cân: <strong>' + weighed + '</strong></span>';
    _updateSessionHint();
  }

  function _sumsHtml(slots, sectionId) {
    var warns = [];
    STAGES.forEach(function (st) {
      var sum = _sumStage(slots, st.idKey, st.pctKey);
      var filled = _stagePeople(slots, st.idKey, st.pctKey).length;
      if (filled > 0 && Math.round(sum) !== 100) {
        warns.push('<div class="fh-share-sum fh-share-warn">' + st.label + ' ≠ 100% (' + Math.round(sum) + '%)</div>');
      }
    });
    if (!warns.length) return '';
    return '<div id="fh-sums-' + sectionId + '" class="fh-share-warns">' + warns.join('') + '</div>';
  }

  function onAssignLotChange(sectionId) {
    assignDraft = _collectAllAssignStates();
    var cfg = assignDraft[sectionId];
    var tr = document.querySelector('#fhAssignBody tr[data-section-id="' + sectionId + '"]');
    var lotEl = tr ? tr.querySelector('.fh-lot-sel') : null;
    var lotCode = lotEl ? lotEl.value : (cfg ? cfg.lot_code : '');
    if (cfg) cfg.lot_code = lotCode;
    var sec = sections.find(function (s) { return s.id === sectionId; });
    if (sec && _sectionLotId(sec) !== lotCode) {
      var candidates = _sectionsForLot(lotCode);
      if (candidates.length) {
        onAssignSectionChange(sectionId, candidates[0].id);
        return;
      }
    }
    assignDraft[sectionId] = cfg;
    renderAssignmentTable();
  }

  function onAssignSectionChange(oldSectionId, newSectionId) {
    if (!newSectionId || oldSectionId === newSectionId) return;
    assignDraft = _collectAllAssignStates();
    var cfg = assignDraft[oldSectionId] || _blankAssignConfig();
    delete assignDraft[oldSectionId];
    var newSec = sections.find(function (s) { return s.id === newSectionId; });
    if (newSec) cfg.lot_code = _sectionLotId(newSec);
    assignDraft[newSectionId] = cfg;
    renderAssignmentTable();
  }

  function _fillLotSelectEl(el, selectedCode) {
    if (!el) return;
    var lots = _lotsForTeam();
    var html = '<option value="">— Chọn lô —</option>';
    lots.forEach(function (l) {
      var sel = l.lot_code === selectedCode ? ' selected' : '';
      var label = _lotOptionLabel(l);
      html += '<option value="' + _escapeHtml(l.lot_code) + '"' + sel +
        ' title="' + _escapeHtml(label) + '">' + _escapeHtml(label) + '</option>';
    });
    el.innerHTML = html;
  }

  function _fillAssignRowSectionSelect(lotCode, selectedSectionId) {
    var el = _el('fhAssignRowSection');
    if (!el) return;
    var candidates = _sectionsForLot(lotCode);
    var html = '<option value="">—</option>';
    candidates.forEach(function (s) {
      var sel = s.id === selectedSectionId ? ' selected' : '';
      html += '<option value="' + _escapeHtml(s.id) + '" title="' +
        _escapeHtml(s.section_code || '') + '">' + _escapeHtml(_sectionPcLabel(s)) + '</option>';
    });
    el.innerHTML = html;
  }

  function openAssignRowModal() {
    if (!selectedTeam) { _toast('Chọn tổ/đội sản xuất trước', 'warning'); return; }
    var lotEl = _el('fhAssignRowLot');
    _fillLotSelectEl(lotEl, '');
    _fillAssignRowSectionSelect('', '');
    _el('fhAssignRowModal').classList.add('active');
  }

  function closeAssignRowModal() {
    _el('fhAssignRowModal').classList.remove('active');
  }

  function onAssignRowLotChange() {
    var lotCode = (_el('fhAssignRowLot') && _el('fhAssignRowLot').value) || '';
    _fillAssignRowSectionSelect(lotCode, '');
  }

  function confirmAssignRow() {
    var lotCode = (_el('fhAssignRowLot') && _el('fhAssignRowLot').value) || '';
    var sectionId = (_el('fhAssignRowSection') && _el('fhAssignRowSection').value) || '';
    if (!lotCode) { _toast('Chọn lô', 'warning'); return; }
    if (!sectionId) { _toast('Chọn phần cạo', 'warning'); return; }
    if (assignDraft[sectionId] || _assignmentsForSection(sectionId).length) {
      _toast('Phần cạo này đã có trong danh sách phân công', 'warning');
      return;
    }
    assignDraft[sectionId] = Object.assign(_blankAssignConfig(), { lot_code: lotCode });
    closeAssignRowModal();
    renderAssignmentTable();
    renderAssignmentStats();
  }

  function onWorkModeChange(sectionId) {
    assignDraft = _collectAllAssignStates();
    var section = sections.find(function (s) { return s.id === sectionId; });
    var cfg = _getAssignDraft(sectionId) || _configForSection(section);
    var el = document.querySelector('#fhAssignBody tr[data-section-id="' + sectionId + '"] .fh-mode-sel');
    cfg.work_mode = el ? el.value : 'solo';
    if (cfg.work_mode === 'solo') {
      cfg.slots = _normalizeSlots([cfg.slots[0] || _emptySlot()], 'solo');
    } else {
      cfg.slots = _normalizeSlots(cfg.slots, cfg.work_mode);
    }
    assignDraft[sectionId] = cfg;
    renderAssignmentTable();
  }

  function onSlotWorkerChange(sectionId, stageIdKey, slotIndex) {
    assignDraft = _collectAllAssignStates();
    var section = sections.find(function (s) { return s.id === sectionId; });
    var cfg = _getAssignDraft(sectionId) || _configForSection(section);
    var sl = cfg.slots[slotIndex];
    if (stageIdKey === 'tapper_id' && sl) {
      if (sl.tapper_id) {
        if (slotIndex === 0) _syncSlotStripCollFromTapper(sl);
      } else {
        sl.tapper_pct = '';
        if (slotIndex === 0) {
          sl.stripper_id = '';
          sl.collector_id = '';
          sl.stripper_pct = '';
          sl.collector_pct = '';
        }
      }
      _rebalanceStageInSlots(cfg.slots, 'tapper_id', 'tapper_pct', true);
      if (slotIndex === 0) {
        _rebalanceStageInSlots(cfg.slots, 'stripper_id', 'stripper_pct', true);
        _rebalanceStageInSlots(cfg.slots, 'collector_id', 'collector_pct', true);
      }
    } else {
      var st = STAGES.find(function (x) { return x.idKey === stageIdKey; });
      if (st) _rebalanceStageInSlots(cfg.slots, st.idKey, st.pctKey, true);
    }
    assignDraft[sectionId] = cfg;
    renderAssignmentTable();
  }

  function onSlotPctChange(sectionId, stageIdKey, slot, newPct) {
    assignDraft = _collectAllAssignStates();
    var section = sections.find(function (s) { return s.id === sectionId; });
    var cfg = _getAssignDraft(sectionId) || _configForSection(section);
    var st = STAGES.find(function (x) { return x.idKey === stageIdKey; });
    if (st) _rebalanceOnPctEdit(cfg.slots, st.idKey, st.pctKey, slot, newPct);
    assignDraft[sectionId] = cfg;
    renderAssignmentTable();
  }

  function _bindAssignRowEvents() {
    var tbody = _el('fhAssignBody');
    if (!tbody) return;

    tbody.querySelectorAll('.fh-mode-sel').forEach(function (el) {
      el.addEventListener('change', function () {
        onWorkModeChange(el.closest('tr').getAttribute('data-section-id'));
      });
    });

    STAGES.forEach(function (st) {
      var cls = '.fh-' + st.id + '-sel';
      tbody.querySelectorAll(cls).forEach(function (el) {
        _fitWorkerSelectWidth(el);
        el.addEventListener('change', function () {
          _fitWorkerSelectWidth(el);
          var tr = el.closest('tr');
          onSlotWorkerChange(
            tr.getAttribute('data-section-id'),
            st.idKey,
            parseInt(tr.getAttribute('data-slot'), 10)
          );
        });
      });
    });

    var pctMap = [
      { cls: 'fh-tap-share-inp', idKey: 'tapper_id' },
      { cls: 'fh-strip-share-inp', idKey: 'stripper_id' },
      { cls: 'fh-coll-share-inp', idKey: 'collector_id' }
    ];
    pctMap.forEach(function (pm) {
      tbody.querySelectorAll('.' + pm.cls).forEach(function (el) {
        el.addEventListener('input', function () {
          var sid = el.closest('tr').getAttribute('data-section-id');
          document.querySelectorAll('#fhAssignBody tr[data-section-id="' + sid + '"]').forEach(function (tr) {
            tr.classList.add('fh-row-changed');
          });
        });
        el.addEventListener('change', function () {
          var tr = el.closest('tr');
          var sid = tr.getAttribute('data-section-id');
          var slot = parseInt(tr.getAttribute('data-slot'), 10);
          onSlotPctChange(sid, pm.idKey, slot, el.value);
        });
      });
    });

    tbody.querySelectorAll('.fh-notes-inp').forEach(function (el) {
      el.addEventListener('input', function () {
        var sid = el.closest('tr').getAttribute('data-section-id');
        document.querySelectorAll('#fhAssignBody tr[data-section-id="' + sid + '"]').forEach(function (tr) {
          tr.classList.add('fh-row-changed');
        });
      });
    });

    tbody.querySelectorAll('.fh-lot-sel').forEach(function (el) {
      el.addEventListener('change', function () {
        onAssignLotChange(el.closest('tr').getAttribute('data-section-id'));
      });
    });

    tbody.querySelectorAll('.fh-section-sel').forEach(function (el) {
      el.addEventListener('change', function () {
        var tr = el.closest('tr');
        var oldId = tr.getAttribute('data-section-id');
        var newId = el.value;
        onAssignSectionChange(oldId, newId);
      });
    });

    tbody.querySelectorAll('.fh-lot-inp').forEach(function (el) {
      el.addEventListener('input', function () {
        var sid = el.closest('tr').getAttribute('data-section-id');
        document.querySelectorAll('#fhAssignBody tr[data-section-id="' + sid + '"]').forEach(function (tr) {
          tr.classList.add('fh-row-changed');
        });
      });
      el.addEventListener('change', function () {
        assignDraft = _collectAllAssignStates();
      });
    });
  }

  function renderAssignmentTable() {
    var tbody = _el('fhAssignBody');
    if (!tbody) return;
    var secs = _displayedAssignSections();
    if (!secs.length) {
      var emptyMsg = !selectedTeam
        ? 'Chọn tổ/đội sản xuất ở trên để phân công.'
        : ('Chưa có phân công ngày ' + _dateVal() + ' — bấm «+ Thêm phân công» hoặc «Nạp phân công».');
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#64748b;">' + emptyMsg + '</td></tr>';
      return;
    }

    var html = [];
    secs.forEach(function (s, idx) {
      var cfg = _getAssignDraft(s.id) || _configForSection(s);
      if ((!cfg.slots || !cfg.slots.length) && _assignmentsForSection(s.id).length) {
        var savedCfg = _configFromAssignmentRows(_assignmentsForSection(s.id));
        if (savedCfg) cfg = Object.assign({}, cfg, savedCfg);
      }
      if (cfg && !cfg.lot_code) cfg.lot_code = _sectionLotCode(s);
      var n = _modeCount(cfg.work_mode);
      var assignRows = _assignmentsForSection(s.id);
      var session = assignRows.length ? _assignmentSession(assignRows[0]) : (selectedSession || 'A');
      var saved = !!_configFromAssignmentRows(_assignmentsForSection(s.id));
      var rowCls = saved ? '' : (_stagePeople(cfg.slots, 'tapper_id', 'tapper_pct').length ? ' fh-row-default' : '');
      var hidePct = cfg.work_mode === 'solo';

      var lotCode = cfg.lot_code || _sectionLotCode(s);

      var r;
      for (r = 0; r < n; r++) {
        var sl = cfg.slots[r] || _emptySlot();
        html.push('<tr class="' + rowCls.trim() +
          ' fh-mode-' + cfg.work_mode +
          (r === 0 && idx > 0 ? ' fh-section-start' : '') +
          (r > 0 ? ' fh-tapper-sub' : '') +
          '" data-section-id="' + s.id + '" data-slot="' + r + '">');

        if (r === 0) {
          html.push('<td rowspan="' + n + '">' + (idx + 1) + '</td>');
          html.push('<td class="fh-td-lot" rowspan="' + n + '">' + _lotSelectHtml(lotCode, s.id) + '</td>');
          var weighed = _sectionIsWeighed(s.id);
          html.push('<td class="fh-td-pc" rowspan="' + n + '"><div class="fh-section-cell">' +
            _sectionSelectHtml(s, lotCode) +
            '<button type="button" class="fh-section-weigh-btn" title="Cân mủ phần cạo này" onclick="TabFieldHarvest.openSectionWeigh(\'' +
            s.id + '\')">⚖️</button>' +
            (weighed ? '<span class="fh-weigh-done">✓</span>' : '') +
            '<button type="button" class="fh-section-del" title="Xóa phân công phiên này" onclick="TabFieldHarvest.deleteSection(\'' +
            s.id + '\')">🗑️</button></div></td>');
          html.push('<td rowspan="' + n + '" style="text-align:center;">' + _sessionBadge(session) + '</td>');
          html.push('<td rowspan="' + n + '"><select class="fh-sel fh-mode-sel">' + _modeSelectHtml(cfg.work_mode) + '</select>' +
            _sumsHtml(cfg.slots, s.id) + '</td>');
        }

        html.push(_stageCellHtml(sl.tapper_id, 'fh-tapper-sel', 'fh-tap-share-inp', sl.tapper_pct, !!sl.tapper_id, hidePct));
        html.push(_stageCellHtml(sl.stripper_id, 'fh-stripper-sel', 'fh-strip-share-inp', sl.stripper_pct, !!sl.stripper_id, hidePct));
        html.push(_stageCellHtml(sl.collector_id, 'fh-collector-sel', 'fh-coll-share-inp', sl.collector_pct, !!sl.collector_id, hidePct));

        if (r === 0) {
          html.push('<td rowspan="' + n + '"><input type="text" class="fh-notes-inp" value="' +
            _escapeHtml(cfg.notes) + '" placeholder="Tùy chọn"></td>');
        }
        html.push('</tr>');
      }
    });
    tbody.innerHTML = html.join('');
    _bindAssignRowEvents();
    renderAssignmentStats();
  }

  function _weighingsForSection(sectionId) {
    return weighings.filter(function (w) { return w.tapping_section_id === sectionId; });
  }

  function _sectionIsWeighed(sectionId) {
    return _weighingsForSection(sectionId).some(function (w) {
      return parseFloat(w.total_fresh_kg) > 0;
    });
  }

  function _getWeighWorkers(sectionId) {
    var section = sections.find(function (s) { return s.id === sectionId; });
    if (!section) return [];
    var cfg = _getAssignDraft(sectionId) || _configForSection(section);
    return _stagePeople(cfg.slots, 'tapper_id', 'tapper_pct').map(function (p) {
      return {
        worker_id: p.worker_id,
        name: _workerLabel(p.worker_id),
        yield_share_pct: p.yield_share_pct
      };
    });
  }

  function _emptyLatexBin() {
    return { material_type: 1, gross_kg: '', tare_kg: FH_DEFAULT_TARE_KG, tsc_pct: '' };
  }

  function _emptyCoagBin() {
    return { material_type: 1, gross_kg: '', tare_kg: FH_DEFAULT_TARE_KG, drc_pct: FH_DEFAULT_COAG_DRC };
  }

  function _roundWeighKg(val) {
    var n = parseFloat(val);
    if (isNaN(n) || n < 0) return '';
    return Math.round(n / FH_WEIGH_KG_STEP) * FH_WEIGH_KG_STEP;
  }

  function _formatWeighKg(val) {
    var n = _roundWeighKg(val);
    if (n === '') return '';
    return Number(n).toFixed(1);
  }

  function _netKg(gross, tare) {
    var g = parseFloat(gross) || 0;
    var t = parseFloat(tare);
    if (isNaN(t)) t = FH_DEFAULT_TARE_KG;
    return Math.max(0, parseFloat((g - t).toFixed(1)));
  }

  function _matTypeOptions(selected) {
    return FH_MATERIAL_TYPES.map(function (mt) {
      var sel = (parseInt(selected, 10) || 1) === mt.v ? ' selected' : '';
      return '<option value="' + mt.v + '"' + sel + '>' + mt.l + '</option>';
    }).join('');
  }

  function _summaryByType(bins) {
    var s = { 1: 0, 2: 0, 3: 0 };
    (bins || []).forEach(function (b) {
      var net = _netKg(b.gross_kg, b.tare_kg);
      var t = parseInt(b.material_type, 10) || 1;
      s[t] += net;
    });
    s.tt = parseFloat((s[1] + s[2] + s[3]).toFixed(3));
    return s;
  }

  function _summaryDryByType(bins, kind) {
    var s = { 1: 0, 2: 0, 3: 0 };
    (bins || []).forEach(function (b) {
      var m = kind === 'latex' ? _latexBinMetrics(b) : _coagBinMetrics(b);
      var t = parseInt(b.material_type, 10) || 1;
      s[t] += m.dry;
    });
    s.tt = parseFloat((s[1] + s[2] + s[3]).toFixed(3));
    return s;
  }

  function _workerWeighFromRecord(rec) {
    var meta = rec ? _parseMeta(rec.metadata) : {};
    if (meta.weigh_detail && meta.weigh_detail.latex_bins && meta.weigh_detail.latex_bins.length) {
      var lb = meta.weigh_detail.latex_bins;
      var cb = (meta.weigh_detail.coag_bins || []).slice();
      while (cb.length < lb.length) cb.push(_emptyCoagBin());
      return {
        binCount: meta.weigh_detail.binCount || lb.length,
        latex_bins: lb,
        coag_bins: cb
      };
    }
    var n = FH_DEFAULT_BIN_COUNT;
    var latex_bins = [];
    var coag_bins = [];
    var i;
    for (i = 0; i < n; i++) {
      latex_bins.push(_emptyLatexBin());
      coag_bins.push(_emptyCoagBin());
    }
    if (rec) {
      if (parseFloat(rec.latex_fresh_kg) > 0) {
        latex_bins[0].gross_kg = parseFloat((parseFloat(rec.latex_fresh_kg) + FH_DEFAULT_TARE_KG).toFixed(2));
        if (rec.latex_tsc_pct != null) latex_bins[0].tsc_pct = rec.latex_tsc_pct;
      }
      if (parseFloat(rec.coag_fresh_kg) > 0) {
        coag_bins[0].gross_kg = parseFloat((parseFloat(rec.coag_fresh_kg) + FH_DEFAULT_TARE_KG).toFixed(2));
        coag_bins[0].drc_pct = rec.coag_drc_pct != null ? rec.coag_drc_pct : FH_DEFAULT_COAG_DRC;
      }
    }
    return { binCount: n, latex_bins: latex_bins, coag_bins: coag_bins };
  }

  function _buildWeighDraft(sectionId) {
    var workers = _getWeighWorkers(sectionId);
    var out = { workers: {} };
    workers.forEach(function (w) {
      var rec = weighings.find(function (r) {
        return r.tapping_section_id === sectionId && r.worker_id === w.worker_id;
      });
      out.workers[w.worker_id] = _workerWeighFromRecord(rec);
    });
    return out;
  }

  function _getSectionWeighRow(sectionId) {
    var rows = getSectionWeighRows();
    return rows.find(function (r) { return r.tapping_section_id === sectionId; }) || null;
  }

  function _collectWeighDraftFromDom() {
    if (!weighSectionId) return;
    var draft = weighDraft[weighSectionId];
    if (!draft) return;
    var panel = _el('fhWeighContent');
    if (!panel) return;

    panel.querySelectorAll('[data-weigh-field]').forEach(function (el) {
      var wid = el.getAttribute('data-wid');
      var kind = el.getAttribute('data-kind');
      var bin = parseInt(el.getAttribute('data-bin'), 10);
      var field = el.getAttribute('data-weigh-field');
      if (!draft.workers[wid] || isNaN(bin)) return;
      var bins = kind === 'coag' ? draft.workers[wid].coag_bins : draft.workers[wid].latex_bins;
      if (!bins[bin]) return;
      if (field === 'material_type') bins[bin][field] = parseInt(el.value, 10) || 1;
      else if (field === 'gross_kg' || field === 'tare_kg') {
        bins[bin][field] = el.value === '' ? '' : _roundWeighKg(el.value);
      } else if (field === 'drc_pct') bins[bin][field] = el.value === '' ? '' : parseFloat(el.value);
      else bins[bin][field] = el.value;
    });
  }

  function _bindWeighPanelEvents() {
    var panel = _el('fhWeighContent');
    if (!panel) return;
    panel.querySelectorAll('[data-weigh-field]').forEach(function (el) {
      el.addEventListener('input', function () {
        _collectWeighDraftFromDom();
        _updateWeighRowCalc(el);
      });
      el.addEventListener('change', function () {
        var field = el.getAttribute('data-weigh-field');
        if (field === 'gross_kg' || field === 'tare_kg') {
          var rounded = _roundWeighKg(el.value);
          if (rounded !== '') el.value = _formatWeighKg(rounded);
        }
        _collectWeighDraftFromDom();
        _updateWeighRowCalc(el);
        _updateWeighSummary(el.getAttribute('data-wid'));
      });
    });
  }

  function _updateWeighRowCalc(el) {
    if (!el) return;
    var wid = el.getAttribute('data-wid');
    var kind = el.getAttribute('data-kind');
    var bin = el.getAttribute('data-bin');
    var row = el.closest('tr');
    if (!row) return;
    var grossEl = row.querySelector('[data-weigh-field="gross_kg"]');
    var tareEl = row.querySelector('[data-weigh-field="tare_kg"]');
    var netCell = row.querySelector('.fh-w-net-val');
    var drcCell = row.querySelector('.fh-w-drc-val');
    var net = _netKg(grossEl ? grossEl.value : 0, tareEl ? tareEl.value : FH_DEFAULT_TARE_KG);
    if (netCell) netCell.textContent = net > 0 ? net.toFixed(1) : '—';
    if (drcCell && kind === 'latex') {
      var tscEl = row.querySelector('[data-weigh-field="tsc_pct"]');
      var tsc = _parseTscPct(tscEl ? tscEl.value : '');
      var drc = tsc > 0 ? (_drcFromTsc('latex', tsc) || 0) : 0;
      drcCell.textContent = net > 0 ? Number(drc).toFixed(1) : '—';
    }
    _updateWeighSummary(wid);
  }

  function _updateWeighSummary(wid) {
    if (!weighSectionId || !wid) return;
    var draft = weighDraft[weighSectionId];
    if (!draft || !draft.workers[wid]) return;
    _collectWeighDraftFromDom();
    var wdata = draft.workers[wid];
    var latexSum = _summaryByType(wdata.latex_bins);
    var coagSum = _summaryByType(wdata.coag_bins);
    ['latex', 'coag'].forEach(function (kind) {
      var sum = kind === 'latex' ? latexSum : coagSum;
      FH_MATERIAL_TYPES.forEach(function (mt) {
        var cell = _el('fh-sum-' + kind + '-' + wid + '-t' + mt.v);
        if (cell) cell.textContent = sum[mt.v] > 0 ? sum[mt.v].toFixed(2) : '0';
      });
      var tt = _el('fh-sum-' + kind + '-' + wid + '-tt');
      if (tt) tt.textContent = sum.tt > 0 ? sum.tt.toFixed(2) : '0';
    });
  }

  function _renderWeighBinRows(wid, kind, bins) {
    var isLatex = kind === 'latex';
    var html = [];
    var i;
    for (i = 0; i < bins.length; i++) {
      var b = bins[i];
      var net = _netKg(b.gross_kg, b.tare_kg);
      var drc = isLatex
        ? (_parseTscPct(b.tsc_pct) > 0 ? _drcFromTsc('latex', _parseTscPct(b.tsc_pct)) : 0)
        : _parseCoagDrcPct(b.drc_pct);
      html.push('<tr data-wid="' + wid + '" data-kind="' + kind + '" data-bin="' + i + '">' +
        '<td>' + (i + 1) + '</td>' +
        '<td><select class="fh-w-sel" data-wid="' + wid + '" data-kind="' + kind + '" data-bin="' + i + '" data-weigh-field="material_type">' +
        _matTypeOptions(b.material_type) + '</select></td>' +
        '<td><input type="number" step="' + FH_WEIGH_KG_STEP + '" min="0" class="fh-w-inp" data-wid="' + wid + '" data-kind="' + kind + '" data-bin="' + i +
        '" data-weigh-field="gross_kg" value="' + (b.gross_kg !== '' && b.gross_kg != null ? _formatWeighKg(b.gross_kg) : '') + '"></td>' +
        '<td><input type="number" step="' + FH_WEIGH_KG_STEP + '" min="0" class="fh-w-inp" data-wid="' + wid + '" data-kind="' + kind + '" data-bin="' + i +
        '" data-weigh-field="tare_kg" value="' + (b.tare_kg != null && b.tare_kg !== '' ? _formatWeighKg(b.tare_kg) : _formatWeighKg(FH_DEFAULT_TARE_KG)) + '"></td>' +
        '<td class="fh-w-net"><span class="fh-w-net-val">' + (net > 0 ? net.toFixed(1) : '—') + '</span></td>');
      if (isLatex) {
        html.push('<td><input type="number" step="0.1" min="0" max="100" class="fh-w-inp fh-w-inp-tsc" data-wid="' + wid +
          '" data-kind="' + kind + '" data-bin="' + i + '" data-weigh-field="tsc_pct" value="' +
          (b.tsc_pct !== '' && b.tsc_pct != null ? b.tsc_pct : '') + '"></td>' +
          '<td class="fh-w-drc"><span class="fh-w-drc-val">' + (net > 0 ? Number(drc || 0).toFixed(1) : '—') + '</span></td>');
      } else {
        html.push('<td><input type="number" step="0.1" min="0" max="100" class="fh-w-inp fh-w-inp-tsc" data-wid="' + wid +
          '" data-kind="' + kind + '" data-bin="' + i + '" data-weigh-field="drc_pct" value="' +
          (b.drc_pct != null && b.drc_pct !== '' ? b.drc_pct : FH_DEFAULT_COAG_DRC) + '"></td>');
      }
      html.push('</tr>');
    }
    return html.join('');
  }

  function _renderWeighSummaryTable(wid, kind, bins) {
    var sum = _summaryByType(bins);
    var label = kind === 'latex' ? 'Mủ nước (kg)' : 'Mủ đông (kg)';
    return '<tr><th>' + label + '</th>' +
      '<td id="fh-sum-' + kind + '-' + wid + '-t1">' + sum[1].toFixed(2) + '</td>' +
      '<td id="fh-sum-' + kind + '-' + wid + '-t2">' + sum[2].toFixed(2) + '</td>' +
      '<td id="fh-sum-' + kind + '-' + wid + '-t3">' + sum[3].toFixed(2) + '</td>' +
      '<td class="fh-w-tt" id="fh-sum-' + kind + '-' + wid + '-tt">' + sum.tt.toFixed(2) + '</td></tr>';
  }

  function renderSectionWeighPanel() {
    var content = _el('fhWeighContent');
    var title = _el('fhWeighTitle');
    if (!content || !weighSectionId) return;
    var section = sections.find(function (s) { return s.id === weighSectionId; });
    var code = section ? (section.section_code || section.id) : weighSectionId;
    if (title) {
      var lot = section ? _lotFromCfg(assignDraft[weighSectionId] || _configForSection(section), section) : '';
      title.textContent = '⚖️ Cân mủ — ' + code + (lot ? (' · Lô ' + lot) : '');
    }

    if (!weighDraft[weighSectionId]) {
      weighDraft[weighSectionId] = _buildWeighDraft(weighSectionId);
    }
    var workers = _getWeighWorkers(weighSectionId);
    if (!workers.length) {
      content.innerHTML = '<p style="color:#64748b;">Chưa phân công cạo. Quay về và phân công trước.</p>';
      return;
    }

    var html = [];
    workers.forEach(function (w) {
      var wdata = weighDraft[weighSectionId].workers[w.worker_id];
      if (!wdata) {
        wdata = _workerWeighFromRecord(null);
        weighDraft[weighSectionId].workers[w.worker_id] = wdata;
      }
      html.push('<div class="fh-weigh-worker-block" id="fh-worker-' + w.worker_id + '">' +
        '<div class="fh-weigh-worker-title">' +
        '<h4>👤 ' + _escapeHtml(w.name) + ' <span style="font-weight:normal;color:#64748b;">(' + (w.yield_share_pct || 0) + '%)</span></h4>' +
        '<div class="fh-weigh-bin-ctrl">Thùng chứa: ' +
        '<button type="button" onclick="TabFieldHarvest.setWorkerBinCount(\'' + weighSectionId + '\',\'' + w.worker_id + '\',-1)">−</button>' +
        '<strong>' + wdata.binCount + '</strong>' +
        '<button type="button" onclick="TabFieldHarvest.setWorkerBinCount(\'' + weighSectionId + '\',\'' + w.worker_id + '\',1)">+</button>' +
        '</div></div>');

      html.push('<div class="fh-weigh-subtitle latex">Mủ nước</div>' +
        '<table class="fh-weigh-table"><thead><tr>' +
        '<th>Thùng</th><th>Loại NL</th><th>KL (kg)</th><th>Bì (kg)</th><th>Ròng</th><th>TSC%</th><th>DRC%</th>' +
        '</tr></thead><tbody>' + _renderWeighBinRows(w.worker_id, 'latex', wdata.latex_bins) + '</tbody></table>');

      html.push('<div class="fh-weigh-subtitle coag">Mủ đông</div>' +
        '<table class="fh-weigh-table"><thead><tr>' +
        '<th>Thùng</th><th>Loại NL</th><th>KL (kg)</th><th>Bì (kg)</th><th>Ròng</th><th>DRC%</th>' +
        '</tr></thead><tbody>' + _renderWeighBinRows(w.worker_id, 'coag', wdata.coag_bins) + '</tbody></table>');

      html.push('<table class="fh-weigh-summary"><thead><tr>' +
        '<th>Trạng thái</th><th>Loại 1</th><th>Loại 2</th><th>Loại 3</th><th>TT</th></tr></thead><tbody>' +
        _renderWeighSummaryTable(w.worker_id, 'latex', wdata.latex_bins) +
        _renderWeighSummaryTable(w.worker_id, 'coag', wdata.coag_bins) +
        '</tbody></table></div>');
    });
    content.innerHTML = html.join('');
    _bindWeighPanelEvents();
  }

  function setWorkerBinCount(sectionId, workerId, delta) {
    _collectWeighDraftFromDom();
    if (!weighDraft[sectionId] || !weighDraft[sectionId].workers[workerId]) return;
    var w = weighDraft[sectionId].workers[workerId];
    var newCount = Math.max(1, Math.min(20, w.binCount + delta));
    while (w.latex_bins.length < newCount) {
      w.latex_bins.push(_emptyLatexBin());
      w.coag_bins.push(_emptyCoagBin());
    }
    while (w.latex_bins.length > newCount) {
      w.latex_bins.pop();
      w.coag_bins.pop();
    }
    w.binCount = newCount;
    if (weighSectionId === sectionId) renderSectionWeighPanel();
  }

  function openSectionWeigh(sectionId) {
    assignDraft = _collectAllAssignStates();
    if (quickWeighActive) closeQuickWeigh();
    var workers = _getWeighWorkers(sectionId);
    if (!workers.length) {
      _toast('Chưa phân công cạo cho phần cạo này', 'warning');
      return;
    }
    weighSectionId = sectionId;
    if (!weighDraft[sectionId]) {
      weighDraft[sectionId] = _buildWeighDraft(sectionId);
    }
    var assignPanel = _el('fhAssignPanel');
    var weighPanel = _el('fhWeighPanel');
    if (assignPanel) assignPanel.style.display = 'none';
    if (weighPanel) weighPanel.style.display = 'block';
    renderSectionWeighPanel();
  }

  function closeSectionWeigh() {
    _collectWeighDraftFromDom();
    weighSectionId = null;
    var assignPanel = _el('fhAssignPanel');
    var weighPanel = _el('fhWeighPanel');
    if (assignPanel) assignPanel.style.display = 'block';
    if (weighPanel) weighPanel.style.display = 'none';
    renderAssignmentTable();
    renderAssignmentStats();
  }

  function _quickRowKey(sectionId, workerId) {
    return String(sectionId) + '|' + String(workerId);
  }

  function _emptyQuickCoagBin() {
    return { material_type: 1, gross_kg: '', tare_kg: FH_QUICK_COAG_TARE_KG, drc_pct: FH_DEFAULT_COAG_DRC };
  }

  function _quickRowFromWorker(sectionId, sectionCode, worker) {
    var rec = weighings.find(function (r) {
      return r.tapping_section_id === sectionId && r.worker_id === worker.worker_id;
    });
    var row = {
      section_id: sectionId,
      section_code: sectionCode,
      worker_id: worker.worker_id,
      worker_name: worker.name,
      yield_share_pct: worker.yield_share_pct,
      latex: _emptyLatexBin(),
      coag: _emptyQuickCoagBin()
    };
    if (!rec) return row;
    var wdata = _workerWeighFromRecord(rec);
    var lb = wdata.latex_bins[0] || _emptyLatexBin();
    var cb = wdata.coag_bins[0] || _emptyQuickCoagBin();
    row.latex = {
      material_type: parseInt(lb.material_type, 10) || 1,
      gross_kg: lb.gross_kg !== '' && lb.gross_kg != null ? lb.gross_kg : '',
      tare_kg: lb.tare_kg != null && lb.tare_kg !== '' ? lb.tare_kg : FH_DEFAULT_TARE_KG,
      tsc_pct: lb.tsc_pct != null && lb.tsc_pct !== '' ? lb.tsc_pct : ''
    };
    row.coag = {
      material_type: parseInt(cb.material_type, 10) || 1,
      gross_kg: cb.gross_kg !== '' && cb.gross_kg != null ? cb.gross_kg : '',
      tare_kg: cb.tare_kg != null && cb.tare_kg !== '' ? cb.tare_kg : FH_QUICK_COAG_TARE_KG,
      drc_pct: cb.drc_pct != null && cb.drc_pct !== '' ? cb.drc_pct : FH_DEFAULT_COAG_DRC
    };
    return row;
  }

  function _buildQuickWeighRows() {
    var rows = [];
    getSectionWeighRows().forEach(function (r) {
      r.tappers.forEach(function (w) {
        rows.push(_quickRowFromWorker(r.tapping_section_id, r.section_code, {
          worker_id: w.worker_id,
          name: _workerLabel(w.worker_id),
          yield_share_pct: w.yield_share_pct
        }));
      });
    });
    return rows;
  }

  function _collectQuickWeighFromDom() {
    var body = _el('fhQuickWeighBody');
    if (!body) return;
    body.querySelectorAll('tr[data-qkey]').forEach(function (tr) {
      var key = tr.getAttribute('data-qkey');
      var row = quickWeighRows.find(function (x) { return _quickRowKey(x.section_id, x.worker_id) === key; });
      if (!row) return;
      tr.querySelectorAll('[data-qfield]').forEach(function (el) {
        var kind = el.getAttribute('data-kind');
        var field = el.getAttribute('data-qfield');
        var bin = kind === 'coag' ? row.coag : row.latex;
        if (field === 'material_type') bin[field] = parseInt(el.value, 10) || 1;
        else if (field === 'gross_kg' || field === 'tare_kg') {
          bin[field] = el.value === '' ? '' : _roundWeighKg(el.value);
        } else if (field === 'drc_pct') bin[field] = el.value === '' ? '' : parseFloat(el.value);
        else if (field === 'tsc_pct') bin[field] = el.value;
      });
    });
  }

  function _updateQuickWeighRowCalc(tr) {
    if (!tr) return;
    var latexGross = tr.querySelector('[data-kind="latex"][data-qfield="gross_kg"]');
    var latexTare = tr.querySelector('[data-kind="latex"][data-qfield="tare_kg"]');
    var netCell = tr.querySelector('.fh-q-latex-net');
    var net = _netKg(latexGross ? latexGross.value : 0, latexTare ? latexTare.value : FH_DEFAULT_TARE_KG);
    if (netCell) netCell.textContent = net > 0 ? net.toFixed(1) : '—';
  }

  function _bindQuickWeighEvents() {
    var body = _el('fhQuickWeighBody');
    if (!body) return;
    body.querySelectorAll('[data-qfield]').forEach(function (el) {
      el.addEventListener('input', function () {
        _collectQuickWeighFromDom();
        _updateQuickWeighRowCalc(el.closest('tr'));
      });
      el.addEventListener('change', function () {
        var field = el.getAttribute('data-qfield');
        if (field === 'gross_kg' || field === 'tare_kg') {
          var rounded = _roundWeighKg(el.value);
          if (rounded !== '') el.value = _formatWeighKg(rounded);
        }
        _collectQuickWeighFromDom();
        _updateQuickWeighRowCalc(el.closest('tr'));
      });
    });
  }

  function _renderQuickWeighRow(row) {
    var key = _quickRowKey(row.section_id, row.worker_id);
    var latexNet = _netKg(row.latex.gross_kg, row.latex.tare_kg);
    return '<tr data-qkey="' + _escapeHtml(key) + '">' +
      '<td class="fh-q-pc">' + _escapeHtml(row.section_code || row.section_id) + '</td>' +
      '<td class="fh-q-worker">' + _escapeHtml(row.worker_name) +
      ' <span style="color:#64748b;font-weight:normal;">(' + (row.yield_share_pct || 0) + '%)</span></td>' +
      '<td><select class="fh-q-sel" data-kind="latex" data-qfield="material_type">' +
      _matTypeOptions(row.latex.material_type) + '</select></td>' +
      '<td><input type="number" step="' + FH_WEIGH_KG_STEP + '" min="0" class="fh-q-inp fh-q-inp-kl" data-kind="latex" data-qfield="gross_kg" value="' +
      (row.latex.gross_kg !== '' && row.latex.gross_kg != null ? _formatWeighKg(row.latex.gross_kg) : '') + '"></td>' +
      '<td><input type="number" step="' + FH_WEIGH_KG_STEP + '" min="0" class="fh-q-inp" data-kind="latex" data-qfield="tare_kg" value="' +
      _formatWeighKg(row.latex.tare_kg != null && row.latex.tare_kg !== '' ? row.latex.tare_kg : FH_DEFAULT_TARE_KG) + '"></td>' +
      '<td class="fh-q-net fh-q-latex-net">' + (latexNet > 0 ? latexNet.toFixed(1) : '—') + '</td>' +
      '<td><input type="number" step="0.1" min="0" max="100" class="fh-q-inp fh-q-inp-tsc" data-kind="latex" data-qfield="tsc_pct" value="' +
      (row.latex.tsc_pct !== '' && row.latex.tsc_pct != null ? row.latex.tsc_pct : '') + '"></td>' +
      '<td><input type="number" step="' + FH_WEIGH_KG_STEP + '" min="0" class="fh-q-inp fh-q-inp-kl" data-kind="coag" data-qfield="gross_kg" value="' +
      (row.coag.gross_kg !== '' && row.coag.gross_kg != null ? _formatWeighKg(row.coag.gross_kg) : '') + '"></td>' +
      '<td><select class="fh-q-sel" data-kind="coag" data-qfield="material_type">' +
      _matTypeOptions(row.coag.material_type) + '</select></td>' +
      '<td><input type="number" step="' + FH_WEIGH_KG_STEP + '" min="0" class="fh-q-inp" data-kind="coag" data-qfield="tare_kg" value="' +
      _formatWeighKg(row.coag.tare_kg != null && row.coag.tare_kg !== '' ? row.coag.tare_kg : FH_QUICK_COAG_TARE_KG) + '"></td>' +
      '<td><input type="number" step="0.1" min="0" max="100" class="fh-q-inp fh-q-inp-tsc" data-kind="coag" data-qfield="drc_pct" value="' +
      (row.coag.drc_pct != null && row.coag.drc_pct !== '' ? row.coag.drc_pct : FH_DEFAULT_COAG_DRC) + '"></td>' +
      '</tr>';
  }

  function renderQuickWeighPanel() {
    var body = _el('fhQuickWeighBody');
    var title = _el('fhQuickWeighTitle');
    if (!body) return;
    if (title) {
      title.textContent = '⚡ Cân nhanh — Phiên ' + selectedSession + ' · ' + quickWeighRows.length + ' công nhân cạo';
    }
    if (!quickWeighRows.length) {
      body.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#64748b;">Chưa có phân công cạo. Phân công và lưu trước khi cân nhanh.</td></tr>';
      return;
    }
    body.innerHTML = quickWeighRows.map(_renderQuickWeighRow).join('');
    _bindQuickWeighEvents();
  }

  function _weighDraftFromQuickSectionRows(sectionId, rows) {
    var draft = { workers: {} };
    rows.forEach(function (r) {
      draft.workers[r.worker_id] = {
        binCount: 1,
        latex_bins: [{
          material_type: r.latex.material_type,
          gross_kg: r.latex.gross_kg,
          tare_kg: r.latex.tare_kg,
          tsc_pct: r.latex.tsc_pct
        }],
        coag_bins: [{
          material_type: r.coag.material_type,
          gross_kg: r.coag.gross_kg,
          tare_kg: r.coag.tare_kg,
          drc_pct: r.coag.drc_pct
        }]
      };
    });
    return draft;
  }

  function openQuickWeigh() {
    if (!selectedTeam) { _toast('Chọn đội sản xuất trước', 'warning'); return; }
    assignDraft = _collectAllAssignStates();
    quickWeighRows = _buildQuickWeighRows();
    if (!quickWeighRows.length) {
      _toast('Chưa phân công cạo — không có dòng để cân nhanh', 'warning');
      return;
    }
    if (weighSectionId) closeSectionWeigh();
    quickWeighActive = true;
    var assignPanel = _el('fhAssignPanel');
    var quickPanel = _el('fhQuickWeighPanel');
    var weighPanel = _el('fhWeighPanel');
    if (assignPanel) assignPanel.style.display = 'none';
    if (weighPanel) weighPanel.style.display = 'none';
    if (quickPanel) quickPanel.style.display = 'block';
    renderQuickWeighPanel();
  }

  function closeQuickWeigh() {
    _collectQuickWeighFromDom();
    quickWeighActive = false;
    var assignPanel = _el('fhAssignPanel');
    var quickPanel = _el('fhQuickWeighPanel');
    if (assignPanel) assignPanel.style.display = 'block';
    if (quickPanel) quickPanel.style.display = 'none';
    renderAssignmentTable();
    renderAssignmentStats();
  }

  async function saveQuickWeigh() {
    if (!quickWeighActive) return;
    if (!selectedTeam) { _toast('Chọn đội sản xuất trước', 'warning'); return; }
    if (!_assertTeamAllowed(selectedTeam, 'cân nhanh')) return;
    if (typeof Permissions !== 'undefined' && Permissions.canWriteFieldHarvest && !Permissions.canWriteFieldHarvest()) {
      _toast('Bạn không có quyền cân mủ', 'error');
      return;
    }
    _collectQuickWeighFromDom();
    var bySection = {};
    quickWeighRows.forEach(function (r) {
      if (!bySection[r.section_id]) bySection[r.section_id] = [];
      bySection[r.section_id].push(r);
    });
    var sectionIds = Object.keys(bySection);
    var saved = 0;
    var hasAny = quickWeighRows.some(function (r) {
      var draft = _weighDraftFromQuickSectionRows(r.section_id, [r]);
      var wdata = draft.workers[r.worker_id];
      if (!wdata) return false;
      return _aggregateWorkerBins(wdata).total_fresh_kg > 0;
    });
    if (!hasAny) {
      _toast('Nhập khối lượng cân mủ', 'error');
      return;
    }
    try {
      var si;
      for (si = 0; si < sectionIds.length; si++) {
        var sectionId = sectionIds[si];
        var draft = _weighDraftFromQuickSectionRows(sectionId, bySection[sectionId]);
        var any = Object.keys(draft.workers).some(function (wid) {
          return _aggregateWorkerBins(draft.workers[wid]).total_fresh_kg > 0;
        });
        if (!any) continue;
        weighDraft[sectionId] = draft;
        await _persistSectionWeighings(sectionId, draft, { refreshPanel: false, toast: false });
        saved++;
      }
      if (!saved) {
        _toast('Nhập khối lượng cân mủ', 'error');
        return;
      }
      quickWeighRows = _buildQuickWeighRows();
      renderQuickWeighPanel();
      renderAssignmentStats();
      _toast('Đã lưu cân nhanh ' + saved + ' phần cạo');
    } catch (e) {
      _toast('Lỗi lưu: ' + e.message, 'error');
    }
  }

  function _aggregateWorkerBins(wdata) {
    var latexNet = 0;
    var latexDry = 0;
    var latexTscSum = 0;
    var latexDrcSum = 0;
    var coagNet = 0;
    var coagDry = 0;
    var coagDrcSum = 0;
    var i;
    var enriched = _enrichBinsForSave(wdata.latex_bins, wdata.coag_bins);

    for (i = 0; i < enriched.latex_bins.length; i++) {
      var lm = _latexBinMetrics(enriched.latex_bins[i]);
      latexNet += lm.net;
      latexDry += lm.dry;
      latexTscSum += lm.net * lm.tsc;
      latexDrcSum += lm.net * lm.drc;
    }
    for (i = 0; i < enriched.coag_bins.length; i++) {
      var cm = _coagBinMetrics(enriched.coag_bins[i]);
      coagNet += cm.net;
      coagDry += cm.dry;
      coagDrcSum += cm.net * cm.drc;
    }

    latexNet = parseFloat(latexNet.toFixed(3));
    coagNet = parseFloat(coagNet.toFixed(3));
    latexDry = parseFloat(latexDry.toFixed(3));
    coagDry = parseFloat(coagDry.toFixed(3));

    var latexTsc = latexNet > 0 ? parseFloat((latexTscSum / latexNet).toFixed(3)) : null;
    var latexDrc = latexNet > 0 ? parseFloat((latexDrcSum / latexNet).toFixed(3)) : null;
    var coagDrc = coagNet > 0 ? parseFloat((coagDrcSum / coagNet).toFixed(3)) : null;

    return {
      latex_fresh_kg: latexNet,
      latex_tsc_pct: latexTsc,
      latex_drc_pct: latexDrc,
      latex_dry_kg: latexDry,
      coag_fresh_kg: coagNet,
      coag_drc_pct: coagDrc,
      coag_dry_kg: coagDry,
      total_fresh_kg: parseFloat((latexNet + coagNet).toFixed(3)),
      total_dry_kg: parseFloat((latexDry + coagDry).toFixed(3)),
      weigh_detail: {
        binCount: wdata.binCount,
        latex_bins: enriched.latex_bins,
        coag_bins: enriched.coag_bins,
        latex_by_type: _summaryByType(wdata.latex_bins),
        coag_by_type: _summaryByType(wdata.coag_bins),
        latex_dry_by_type: _summaryDryByType(enriched.latex_bins, 'latex'),
        coag_dry_by_type: _summaryDryByType(enriched.coag_bins, 'coag')
      }
    };
  }

  function openSectionModal() {
    if (!selectedTeam) { _toast('Chọn tổ/đội sản xuất trước', 'warning'); return; }
    var team = companyTeams.find(function (t) { return String(t.id) === String(selectedTeam); });
    var meta = team ? _parseMeta(team.metadata) : {};
    _el('fhSectionSquad').value = meta.code || selectedTeam || '';
    _fillLotSelectEl(_el('fhSectionLot'), '');
    var pcEl = _el('fhSectionPcNo');
    if (pcEl) pcEl.value = '';
    _el('fhSectionCode').value = '';
    var sessEl = _el('fhSectionSession');
    if (sessEl) sessEl.value = selectedSession || 'A';
    _el('fhSectionModal').classList.add('active');
  }

  function closeSectionModal() {
    _el('fhSectionModal').classList.remove('active');
  }

  function _findSectionByCode(code) {
    var norm = (code || '').trim().toLowerCase();
    if (!norm) return null;
    return sections.find(function (s) {
      return String(s.section_code || '').trim().toLowerCase() === norm;
    }) || null;
  }

  function _isDuplicateKeyError(err) {
    var msg = String((err && err.message) || '').toLowerCase();
    return msg.indexOf('unique') >= 0 || msg.indexOf('duplicate') >= 0 || msg.indexOf('23505') >= 0;
  }

  function _validateStageSlots(slots, idKey, pctKey, label, sectionCode) {
    var people = _stagePeople(slots, idKey, pctKey);
    if (!people.length) return true;
    var sum = _sumStage(slots, idKey, pctKey);
    if (Math.round(sum) !== 100) {
      _toast(sectionCode + ' — ' + label + ': tổng tỉ lệ = 100% (hiện ' + Math.round(sum) + '%)', 'error');
      return false;
    }
    return true;
  }

  async function _saveSectionLot(sectionId, lotCode) {
    var sec = sections.find(function (s) { return s.id === sectionId; });
    if (!sec) return;
    var meta = _sectionMeta(sec);
    meta.lot_code = lotCode || null;
    sec.metadata = meta;
    if (_isOnline()) {
      await _db().collection('tappingSections').doc(sectionId).update({ metadata: meta });
    } else if (_offlineReady()) {
      await FieldHarvestOffline.cachePut('sections', sections);
    }
  }

  function _normWorkerId(wid) {
    return String(wid || '').trim();
  }

  function _mergeWorkersFromCfg(cfg) {
    var merged = {};
    var notes = cfg.notes || '';

    function _queue(role, wid, pct) {
      wid = _normWorkerId(wid);
      if (!wid) return;
      if (!merged[wid]) merged[wid] = { worker_id: wid, roles: [] };
      merged[wid].roles.push({ role: role, yield_share_pct: pct });
    }

    (cfg.slots || []).forEach(function (sl) {
      if (sl.tapper_id) _queue('tapper', sl.tapper_id, sl.tapper_pct);
      if (sl.stripper_id) _queue('stripper', sl.stripper_id, sl.stripper_pct);
      if (sl.collector_id) _queue('collector', sl.collector_id, sl.collector_pct);
    });
    return { merged: merged, notes: notes };
  }

  function _assignmentPayload(date, sectionId, wid, m, notes, cfg) {
    return {
      record_date: date,
      tapping_section_id: sectionId,
      worker_id: wid,
      assignment_role: m.roles[0].role,
      notes: notes,
      metadata: {
        tapping_session: selectedSession,
        work_mode: cfg.work_mode,
        slots: cfg.slots,
        roles: m.roles,
        yield_share_pct: m.roles[0].yield_share_pct,
        lot_code: cfg.lot_code || null
      }
    };
  }

  function _buildAssignmentRows(sectionId, cfg, date) {
    var pack = _mergeWorkersFromCfg(cfg);
    return Object.keys(pack.merged).map(function (wid) {
      var m = pack.merged[wid];
      return Object.assign({
        id: _localId('local-swa-'),
        _offlinePending: true
      }, _assignmentPayload(date, sectionId, wid, m, pack.notes, cfg));
    });
  }

  function _assignmentDocId(date, sectionId, workerId) {
    return 'swa-' + String(date || '').replace(/-/g, '') + '-' + sectionId + '-' + workerId;
  }

  function _dedupeAssignments(rows) {
    var byKey = {};
    (rows || []).forEach(function (a) {
      var key = String(a.record_date) + '|' + a.tapping_section_id + '|' + a.worker_id;
      var prev = byKey[key];
      if (!prev) {
        byKey[key] = a;
        return;
      }
      var prefer = function (row) {
        var score = 0;
        if (String(row.id || '').indexOf('swa-lk-') === 0 || String(row.id || '').indexOf('swa-') === 0) score += 2;
        if (_assignmentSession(row) === 'B') score += 1;
        return score;
      };
      byKey[key] = prefer(a) >= prefer(prev) ? a : prev;
    });
    return Object.keys(byKey).map(function (k) { return byKey[k]; });
  }

  function _applyAssignmentsLocal(sectionId, cfg, date) {
    assignments = assignments.filter(function (a) {
      return !(a.record_date === date && a.tapping_section_id === sectionId);
    });
    assignments = assignments.concat(_buildAssignmentRows(sectionId, cfg, date));
  }

  function _assignmentOpsForSection(sectionId, cfg, date, existingRows) {
    var ops = [];
    (existingRows || []).forEach(function (row) {
      if (String(row.id || '').indexOf('local-') === 0) return;
      ops.push({
        type: 'delete',
        ref: _db().collection('sectionWorkerAssignments').doc(row.id)
      });
    });
    var pack = _mergeWorkersFromCfg(cfg);
    Object.keys(pack.merged).forEach(function (wid) {
      var m = pack.merged[wid];
      ops.push({
        type: 'set',
        ref: _db().collection('sectionWorkerAssignments').doc(_assignmentDocId(date, sectionId, wid)),
        data: _assignmentPayload(date, sectionId, wid, m, pack.notes, cfg)
      });
    });
    return ops;
  }

  async function _upsertSectionAssignments(sectionId, cfg, date) {
    date = date || _dateVal();
    var existingRows = assignments.filter(function (a) {
      return a.record_date === date && _sameSectionId(a.tapping_section_id, sectionId);
    });
    if (_isOnline()) {
      try {
        var snap = await _db().collection('sectionWorkerAssignments')
          .where('record_date', '==', date)
          .where('tapping_section_id', '==', sectionId)
          .get();
        existingRows = snap.docs.map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        });
      } catch (e) {
        console.warn('[FieldHarvest] assign query fallback:', e.message);
      }
    }
    await _commitDbBatch(_assignmentOpsForSection(sectionId, cfg, date, existingRows));
  }

  async function _batchSaveAllAssignments(toSave, date) {
    var existingBySection = {};
    assignments.filter(function (a) { return a.record_date === date; }).forEach(function (a) {
      var sid = a.tapping_section_id;
      if (!existingBySection[sid]) existingBySection[sid] = [];
      existingBySection[sid].push(a);
    });
    if (_isOnline()) {
      var snap = await _db().collection('sectionWorkerAssignments').where('record_date', '==', date).get();
      snap.docs.forEach(function (d) {
        var row = Object.assign({ id: d.id }, d.data());
        var sid = row.tapping_section_id;
        if (!existingBySection[sid]) existingBySection[sid] = [];
        var seen = existingBySection[sid].some(function (x) { return x.id === row.id; });
        if (!seen) existingBySection[sid].push(row);
      });
    }

    var items = [];
    var sectionMetaUpdates = [];
    var si;
    for (si = 0; si < toSave.length; si++) {
      var item = toSave[si];
      var sectionId = item.section.id;
      var cfg = item.cfg;
      var rows = existingBySection[sectionId] || [];
      var deleteIds = [];
      var ri;
      for (ri = 0; ri < rows.length; ri++) {
        if (String(rows[ri].id || '').indexOf('local-') === 0) continue;
        deleteIds.push(rows[ri].id);
      }
      var pack = _mergeWorkersFromCfg(cfg);
      var upsertRows = Object.keys(pack.merged).map(function (wid) {
        var m = pack.merged[wid];
        return Object.assign(
          { id: _assignmentDocId(date, sectionId, wid) },
          _assignmentPayload(date, sectionId, wid, m, pack.notes, cfg)
        );
      });
      items.push({ sectionId: sectionId, deleteIds: deleteIds, rows: upsertRows });
      var sec = sections.find(function (s) { return s.id === sectionId; });
      if (sec) {
        var meta = _sectionMeta(sec);
        meta.lot_code = cfg.lot_code || null;
        sec.metadata = meta;
        sectionMetaUpdates.push({ sectionId: sectionId, metadata: meta });
      }
      _applyAssignmentsLocal(sectionId, cfg, date);
    }
    await _bulkSaveAssignmentsApi({
      date: date,
      items: items,
      sectionMetaUpdates: sectionMetaUpdates
    });
  }

  async function saveAllAssignments() {
    if (_fhSaveInProgress) {
      _toast('Đang lưu phân công — vui lòng đợi hoàn tất', 'warning');
      return;
    }
    if (!selectedTeam) { _toast('Chọn đội sản xuất trước khi lưu', 'warning'); return; }
    if (!_assertTeamAllowed(selectedTeam, 'lưu phân công')) return;
    if (typeof Permissions !== 'undefined' && Permissions.canWriteFieldHarvest && !Permissions.canWriteFieldHarvest()) {
      _toast('Bạn không có quyền lưu phân công', 'error');
      return;
    }

    var date = _dateVal();
    var priorDraft = JSON.parse(JSON.stringify(assignDraft));
    var collected = _collectAllAssignStates();
    assignDraft = {};
    var saveIds = {};
    Object.keys(priorDraft).forEach(function (sid) { saveIds[_draftKey(sid)] = true; });
    Object.keys(collected).forEach(function (sid) { saveIds[_draftKey(sid)] = true; });
    Object.keys(saveIds).forEach(function (sid) {
      var merged = _mergeAssignCfgFromFallback(
        collected[sid] || collected[_draftKey(sid)],
        priorDraft[sid] || priorDraft[_draftKey(sid)]
      );
      if (merged) _setAssignDraft(sid, merged);
    });
    var secs = _sectionsForAssignSave(Object.keys(saveIds));

    var toSave = [];
    var si;
    for (si = 0; si < secs.length; si++) {
      var cfg = _getAssignDraft(secs[si].id) || _configForSection(secs[si]);
      var code = secs[si].section_code || secs[si].id;
      if (!_stagePeople(cfg.slots, 'tapper_id', 'tapper_pct').length) continue;
      if (!_validateStageSlots(cfg.slots, 'tapper_id', 'tapper_pct', 'Cạo', code)) {
        assignDraft = priorDraft;
        _persistAssignDraftCache(date);
        return;
      }
      if (!_validateStageSlots(cfg.slots, 'stripper_id', 'stripper_pct', 'Trút', code)) {
        assignDraft = priorDraft;
        _persistAssignDraftCache(date);
        return;
      }
      if (!_validateStageSlots(cfg.slots, 'collector_id', 'collector_pct', 'Bốc', code)) {
        assignDraft = priorDraft;
        _persistAssignDraftCache(date);
        return;
      }
      toSave.push({ section: secs[si], cfg: cfg });
    }

    if (!toSave.length) {
      _toast('Không có phần cạo nào để lưu (thiếu công nhân cạo)', 'warning');
      assignDraft = priorDraft;
      _persistAssignDraftCache(date);
      return;
    }

    _fhSaveInProgress = true;
    _setSaveButtonBusy(true);
    _toast('Đang lưu ' + toSave.length + ' phần cạo ngày ' + _formatDateShort(date) + '...', 'info');

    var offlineUsed = false;
    var fallbackUsed = false;
    try {
      if (!_isOnline() && _offlineReady()) {
        var oi;
        for (oi = 0; oi < toSave.length; oi++) {
          await _saveAssignmentsOffline(toSave[oi].section.id, toSave[oi].cfg, date);
        }
        offlineUsed = true;
      } else {
        try {
          await _batchSaveAllAssignments(toSave, date);
        } catch (e) {
          if (!_offlineReady() || !_isTransientNetworkError(e)) throw e;
          console.warn('[FieldHarvest] batch save fallback offline:', e.message);
          var fi;
          for (fi = 0; fi < toSave.length; fi++) {
            await _saveAssignmentsOffline(toSave[fi].section.id, toSave[fi].cfg, date);
          }
          fallbackUsed = true;
        }
      }

      var savedCount = toSave.length;
      assignDraft = {};
      _clearAssignDraftCache(date);

      if (offlineUsed || fallbackUsed) {
        await _persistAssignmentsCache();
        _toast(fallbackUsed
          ? ('Mạng gián đoạn — đã lưu ' + savedCount + ' phần cạo trên máy, sẽ tự đồng bộ khi có sóng')
          : ('Đã lưu ' + savedCount + ' phần cạo trên máy — tự đồng bộ khi có mạng'), 'success');
        renderAssignmentTable();
        renderAssignmentStats();
      } else {
        _toast('Đã lưu phân công (' + savedCount + ' phần cạo) ngày ' + _formatDateShort(date), 'success');
        var dateEl = _el('fhRecordDate');
        if (dateEl && dateEl.value !== date) dateEl.value = date;
        _fhLastRecordDate = date;
        await loadAssignments({ clearDraft: true });
        var reloaded = _displayedAssignSections().length;
        if (reloaded < savedCount) {
          _toast('Đã ghi ' + savedCount + ' phần cạo nhưng tải lại chỉ thấy ' + reloaded +
            ' — thử refresh trang hoặc kiểm tra quyền/mạng', 'warning');
        }
        await loadWeighings();
        await _syncPending();
      }
      _updateOfflineUI();
    } catch (e) {
      assignDraft = priorDraft;
      _persistAssignDraftCache(date);
      _toast('Lỗi lưu: ' + e.message, 'error');
    } finally {
      _fhSaveInProgress = false;
      _setSaveButtonBusy(false);
    }
  }

  async function saveSection() {
    var lotCode = (_el('fhSectionLot') && _el('fhSectionLot').value || '').trim();
    var pcNo = parseInt((_el('fhSectionPcNo') && _el('fhSectionPcNo').value) || '', 10);
    if (!lotCode) { _toast('Chọn ID LÔ', 'error'); return; }
    if (!pcNo || pcNo < 1) { _toast('Nhập PC SỐ (số thứ tự phần cạo)', 'error'); return; }
    if (!selectedTeam) { _toast('Chọn tổ/đội sản xuất trước', 'warning'); return; }
    if (!_assertTeamAllowed(selectedTeam, 'thêm phần cạo')) return;

    var section_code = lotCode + '|PC|' + pcNo;
    _el('fhSectionCode').value = section_code;

    var team = companyTeams.find(function (t) { return String(t.id) === String(selectedTeam); });
    var teamMeta = team ? _parseMeta(team.metadata) : {};
    var squad = teamMeta.code || 'LK';
    _el('fhSectionSquad').value = squad;

    var lotName = '';
    lotCatalog.forEach(function (l) {
      if (l.lot_code === lotCode) lotName = l.lot_name || '';
    });
    var session = (_el('fhSectionSession') && _el('fhSectionSession').value) || 'A';
    var existing = sections.find(function (s) {
      return _sectionLotId(s) === lotCode && String(s.section_no) === String(pcNo);
    }) || _findSectionByCode(section_code);

    if (existing && existing.active !== false) {
      _toast('Phần cạo ' + _sectionPcLabel(existing) + ' của lô này đã có.', 'warning');
      return;
    }

    try {
      var sectionId;
      if (existing && existing.active === false) {
        sectionId = existing.id;
        var meta = _sectionMeta(existing);
        meta.tapping_session = session;
        meta.work_mode = meta.work_mode || 'solo';
        meta.lot_code = lotCode;
        if (!meta.slots || !meta.slots.length) meta.slots = [_emptySlot()];
        await _db().collection('tappingSections').doc(sectionId).update({
          section_code: section_code,
          lot_id: lotCode,
          lot_name: lotName || existing.lot_name || null,
          section_no: pcNo,
          squad: squad,
          team_id: selectedTeam || null,
          active: true,
          metadata: meta
        });
      } else {
        var docRef = await _db().collection('tappingSections').add({
          section_code: section_code,
          lot_id: lotCode,
          lot_name: lotName || null,
          section_no: pcNo,
          squad: squad,
          team_id: selectedTeam || null,
          active: true,
          metadata: {
            tapping_session: session,
            work_mode: 'solo',
            slots: [_emptySlot()],
            lot_code: lotCode
          }
        });
        sectionId = docRef && docRef.id ? docRef.id : docRef;
      }
      if (sectionId) assignDraft[sectionId] = Object.assign(_blankAssignConfig(), { lot_code: lotCode });
      closeSectionModal();
      _toast('Đã thêm ' + section_code);
      await loadSections();
      await loadLotCatalog();
      renderAssignmentTable();
    } catch (e) {
      if (_isDuplicateKeyError(e)) {
        _toast('Phần cạo lô ' + lotCode + ' PC ' + pcNo + ' đã có rồi.', 'warning');
      } else {
        _toast('Lỗi: ' + e.message, 'error');
      }
    }
  }

  async function deleteSection(sectionId) {
    var section = _findSectionById(sectionId);
    var code = (section && (section.section_code || section.section_no)) || sectionId;
    var date = _dateVal();
    var session = selectedSession || 'A';
    var msg = 'Xóa phân công phần cạo "' + code + '" phiên ' + session +
      ' ngày ' + _formatDateShort(date) + '?';
    if (!(await showConfirm(msg))) return;
    try {
      var k = _draftKey(sectionId);
      delete assignDraft[k];
      delete assignDraft[sectionId];
      _persistAssignDraftCache(date);

      var rowsToDelete = assignments.filter(function (a) {
        return a.record_date === date &&
          _sameSectionId(a.tapping_section_id, sectionId) &&
          _assignmentSession(a) === session;
      });

      if (_isOnline()) {
        var snap = await _db().collection('sectionWorkerAssignments')
          .where('record_date', '==', date)
          .where('tapping_section_id', '==', sectionId)
          .get();
        snap.docs.forEach(function (doc) {
          var row = Object.assign({ id: doc.id }, doc.data());
          if (_assignmentSession(row) !== session) return;
          if (!rowsToDelete.some(function (x) { return x.id === row.id; })) {
            rowsToDelete.push(row);
          }
        });
      }

      var ops = [];
      rowsToDelete.forEach(function (row) {
        if (String(row.id || '').indexOf('local-') === 0) return;
        ops.push({
          type: 'delete',
          ref: _db().collection('sectionWorkerAssignments').doc(row.id)
        });
      });
      if (ops.length) await _commitDbBatch(ops);

      assignments = assignments.filter(function (a) {
        return !(a.record_date === date &&
          _sameSectionId(a.tapping_section_id, sectionId) &&
          _assignmentSession(a) === session);
      });

      if (_offlineReady()) {
        var dayRows = assignments.filter(function (a) { return a.record_date === date; });
        await FieldHarvestOffline.saveAssignmentsForDate(date, dayRows);
      }

      _toast('Đã xóa phân công phiên ' + session + ' — ' + code);
      renderAssignmentTable();
      renderAssignmentStats();
    } catch (e) {
      _toast('Không xóa được: ' + e.message, 'error');
    }
  }

  async function copyFromDate() {
    if (!selectedTeam) { _toast('Chọn đội sản xuất trước', 'warning'); return; }
    if (!_assertTeamAllowed(selectedTeam, 'nạp phân công')) return;
    var srcEl = _el('fhCopyFromDate');
    var srcDate = (srcEl && srcEl.value) ? srcEl.value : '';
    if (!srcDate) { _toast('Chọn ngày nguồn để sao chép', 'warning'); return; }
    if (srcDate === _dateVal()) { _toast('Chọn ngày khác ngày đang làm việc', 'warning'); return; }
    try {
      if (!sections.length) await loadSections();
      var targetDate = _dateVal();
      var allSrcRows = [];
      if (_isOnline()) {
        var snap = await _db().collection('sectionWorkerAssignments').where('record_date', '==', srcDate).get();
        allSrcRows = snap.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
        if (_offlineReady() && allSrcRows.length) {
          await FieldHarvestOffline.saveAssignmentsForDate(srcDate, allSrcRows);
        }
      }
      if (!allSrcRows.length && _offlineReady()) {
        allSrcRows = await FieldHarvestOffline.getAssignmentsForDate(srcDate);
      }
      if (!allSrcRows.length) {
        _toast('Không có phân công ngày ' + srcDate, 'warning');
        return;
      }
      if (!_isOnline() && !_offlineReady()) {
        _toast('Không có mạng', 'error');
        return;
      }
      var eligibleSrc = allSrcRows.filter(function (d) {
        return _sectionEligibleForCopy(d.tapping_section_id, [d]);
      });
      if (!eligibleSrc.length) eligibleSrc = allSrcRows;
      var srcSession = _dominantSessionFromRows(eligibleSrc);
      if (!srcSession) {
        _toast('Không có phân công ngày ' + srcDate, 'warning');
        return;
      }
      var bySection = {};
      eligibleSrc.forEach(function (d) {
        if (_assignmentSession(d) !== srcSession) return;
        if (!bySection[d.tapping_section_id]) bySection[d.tapping_section_id] = [];
        bySection[d.tapping_section_id].push(d);
      });
      if (!Object.keys(bySection).length) {
        _toast('Không có phân công phiên ' + srcSession + ' ngày ' + srcDate + ' cho đội này', 'warning');
        return;
      }
      var copied = 0;
      var skipped = 0;
      assignDraft = {};
      _setSessionFilter(srcSession);
      Object.keys(bySection).forEach(function (sectionId) {
        var rows = bySection[sectionId];
        if (!_sectionEligibleForCopy(sectionId, rows)) {
          skipped++;
          return;
        }
        var cfg = _configFromAssignmentRows(rows);
        if (!cfg) return;
        _setAssignDraft(sectionId, cfg);
        copied++;
      });
      if (!copied) {
        _toast('Không có phân công phiên ' + srcSession + ' ngày ' + srcDate + ' cho đội này', 'warning');
        return;
      }
      renderAssignmentTable();
      renderAssignmentStats();
      _persistAssignDraftCache(targetDate);
      var msg = 'Đã nạp ' + copied + ' phần cạo (phiên ' + srcSession + ') từ ' + srcDate +
        ' — bấm «Lưu phân công» trước khi đổi ngày';
      if (skipped) msg += ' (' + skipped + ' phần cạo ngoài đội, bỏ qua)';
      _toast(msg);
    } catch (e) {
      _toast('Lỗi: ' + e.message, 'error');
    }
  }

  /** Chỉ gửi cột có trên mọi DB; latex_drc_pct lưu trong metadata nếu bảng chưa có cột. */
  function _normalizeWeighingPayload(data) {
    var meta = _parseMeta(data.metadata);
    if (data.latex_drc_pct != null && data.latex_drc_pct !== '') {
      meta.latex_drc_pct = data.latex_drc_pct;
    }
    if (data.coag_tsc_pct != null && data.coag_tsc_pct !== '') {
      meta.coag_tsc_pct = data.coag_tsc_pct;
    }
    var out = {
      record_date: data.record_date,
      tapping_section_id: data.tapping_section_id,
      worker_id: data.worker_id,
      session_no: data.session_no != null ? data.session_no : 1,
      latex_fresh_kg: data.latex_fresh_kg,
      latex_tsc_pct: data.latex_tsc_pct,
      latex_dry_kg: data.latex_dry_kg,
      coag_fresh_kg: data.coag_fresh_kg,
      coag_drc_pct: data.coag_drc_pct,
      coag_dry_kg: data.coag_dry_kg,
      total_fresh_kg: data.total_fresh_kg,
      total_dry_kg: data.total_dry_kg,
      created_by: data.created_by,
      metadata: meta
    };
    if (data.notes != null) out.notes = data.notes;
    return out;
  }

  async function _saveWorkerWeighing(sectionId, workerId, payload) {
    var row = _normalizeWeighingPayload(payload);
    var existing = weighings.find(function (w) {
      return w.tapping_section_id === sectionId && w.worker_id === workerId;
    });
    if (existing && existing.id && !String(existing.id).startsWith('local-fw-')) {
      await _db().collection('fieldWorkerWeighings').doc(existing.id).update(row);
    } else if (_isOnline()) {
      await _db().collection('fieldWorkerWeighings').add(row);
    }
  }

  function _applyWeighingLocal(sectionId, workerId, payload) {
    var row = _normalizeWeighingPayload(payload);
    var existingIdx = -1;
    var i;
    for (i = 0; i < weighings.length; i++) {
      if (weighings[i].tapping_section_id === sectionId && weighings[i].worker_id === workerId) {
        existingIdx = i;
        break;
      }
    }
    var localRow = Object.assign({ id: existingIdx >= 0 ? weighings[existingIdx].id : _localId('local-fw-') }, row, {
      _offlinePending: true
    });
    if (existingIdx >= 0) weighings[existingIdx] = localRow;
    else weighings.push(localRow);
    return localRow;
  }

  async function _persistSectionWeighings(sectionId, draft, opts) {
    opts = opts || {};
    var row = _getSectionWeighRow(sectionId);
    if (!row) throw new Error('Không tìm thấy phần cạo');

    var workers = _getWeighWorkers(sectionId);
    var sectionLatex = 0;
    var sectionCoag = 0;
    var sectionLatexDry = 0;
    var sectionCoagDry = 0;
    var date = _dateVal();
    var tapperIds = {};
    var wi;
    var offline = !_isOnline() && _offlineReady();
    var pendingPayloads = [];
    var usedFallback = false;

    for (wi = 0; wi < workers.length; wi++) {
      var wid = workers[wi].worker_id;
      var wdata = draft.workers[wid];
      if (!wdata) continue;
      var agg = _aggregateWorkerBins(wdata);
      if (agg.total_fresh_kg <= 0) continue;

      tapperIds[wid] = true;
      sectionLatex += agg.latex_fresh_kg;
      sectionCoag += agg.coag_fresh_kg;
      sectionLatexDry += agg.latex_dry_kg;
      sectionCoagDry += agg.coag_dry_kg;

      var tapPayload = {
        record_date: date,
        tapping_section_id: sectionId,
        worker_id: wid,
        session_no: 1,
        latex_fresh_kg: agg.latex_fresh_kg,
        latex_tsc_pct: agg.latex_tsc_pct,
        latex_drc_pct: agg.latex_drc_pct,
        latex_dry_kg: agg.latex_dry_kg,
        coag_fresh_kg: agg.coag_fresh_kg,
        coag_drc_pct: agg.coag_drc_pct,
        coag_dry_kg: agg.coag_dry_kg,
        total_fresh_kg: agg.total_fresh_kg,
        total_dry_kg: agg.total_dry_kg,
        created_by: _user() ? _user().id : null,
        metadata: {
          roles: [{ role: 'tapper', yield_share_pct: workers[wi].yield_share_pct }],
          weigh_detail: agg.weigh_detail,
          section_total_fresh_kg: agg.total_fresh_kg
        }
      };
      if (offline) {
        _applyWeighingLocal(sectionId, wid, tapPayload);
        pendingPayloads.push({ workerId: wid, payload: tapPayload });
      } else {
        try {
          await _saveWorkerWeighing(sectionId, wid, tapPayload);
        } catch (netErr) {
          if (!_offlineReady()) throw netErr;
          usedFallback = true;
          _applyWeighingLocal(sectionId, wid, tapPayload);
          pendingPayloads.push({ workerId: wid, payload: tapPayload });
        }
      }
    }

    if (sectionLatex + sectionCoag <= 0) {
      throw new Error('Nhập khối lượng cân mủ');
    }

    var byWorker = {};
    function _acc(wid, part) {
      if (!wid) return;
      if (!byWorker[wid]) {
        byWorker[wid] = { latex_fresh_kg: 0, latex_dry_kg: 0, coag_fresh_kg: 0, coag_dry_kg: 0, roles: [] };
      }
      Object.keys(part).forEach(function (k) {
        if (k === 'roles') byWorker[wid].roles = byWorker[wid].roles.concat(part.roles);
        else byWorker[wid][k] += part[k];
      });
    }

    row.strippers.forEach(function (t) {
      if (tapperIds[t.worker_id]) return;
      var p = (parseFloat(t.yield_share_pct) || 0) / 100;
      _acc(t.worker_id, {
        latex_fresh_kg: sectionLatex * p,
        latex_dry_kg: sectionLatexDry * p,
        roles: [{ role: 'stripper', yield_share_pct: t.yield_share_pct }]
      });
    });
    row.collectors.forEach(function (t) {
      if (tapperIds[t.worker_id]) return;
      var p = (parseFloat(t.yield_share_pct) || 0) / 100;
      _acc(t.worker_id, {
        coag_fresh_kg: sectionCoag * p,
        coag_dry_kg: sectionCoagDry * p,
        roles: [{ role: 'collector', yield_share_pct: t.yield_share_pct }]
      });
    });

    var extraWids = Object.keys(byWorker);
    for (wi = 0; wi < extraWids.length; wi++) {
      var ew = extraWids[wi];
      var b = byWorker[ew];
      var extraPayload = {
        record_date: date,
        tapping_section_id: sectionId,
        worker_id: ew,
        session_no: 1,
        latex_fresh_kg: parseFloat(b.latex_fresh_kg.toFixed(3)),
        latex_tsc_pct: null,
        latex_drc_pct: null,
        latex_dry_kg: parseFloat(b.latex_dry_kg.toFixed(3)),
        coag_fresh_kg: parseFloat(b.coag_fresh_kg.toFixed(3)),
        coag_drc_pct: null,
        coag_dry_kg: parseFloat(b.coag_dry_kg.toFixed(3)),
        total_fresh_kg: parseFloat(((b.latex_fresh_kg || 0) + (b.coag_fresh_kg || 0)).toFixed(3)),
        total_dry_kg: parseFloat(((b.latex_dry_kg || 0) + (b.coag_dry_kg || 0)).toFixed(3)),
        created_by: _user() ? _user().id : null,
        metadata: { roles: b.roles, section_total_fresh_kg: sectionLatex + sectionCoag }
      };
      if (offline || usedFallback) {
        _applyWeighingLocal(sectionId, ew, extraPayload);
        pendingPayloads.push({ workerId: ew, payload: extraPayload });
      } else {
        try {
          await _saveWorkerWeighing(sectionId, ew, extraPayload);
        } catch (netErr) {
          if (!_offlineReady()) throw netErr;
          usedFallback = true;
          _applyWeighingLocal(sectionId, ew, extraPayload);
          pendingPayloads.push({ workerId: ew, payload: extraPayload });
        }
      }
    }

    if (offline || usedFallback) {
      await FieldHarvestOffline.enqueueDeduped({
        type: 'section_weigh',
        date: date,
        sectionId: sectionId,
        teamId: selectedTeam,
        payloads: pendingPayloads
      }, 'weigh:' + date + ':' + sectionId);
      await _persistWeighingsCache();
      if (opts.toast !== false) {
        _toast(usedFallback
          ? 'Mạng gián đoạn — đã lưu cân mủ trên máy, sẽ tự đồng bộ'
          : 'Đã lưu cân mủ ' + (row.section_code || sectionId) + ' trên máy — tự đồng bộ khi có mạng', 'success');
      }
      renderAssignmentStats();
      await _refreshYieldSummary();
      if (opts.refreshPanel !== false && weighSectionId === sectionId) renderSectionWeighPanel();
    } else {
      if (opts.toast !== false) _toast('Đã lưu cân mủ ' + (row.section_code || sectionId));
      await loadWeighings();
      await _syncPending();
    }
    _updateOfflineUI();
  }

  async function saveSectionWeigh() {
    if (!weighSectionId) return;
    if (!selectedTeam) { _toast('Chọn đội sản xuất trước', 'warning'); return; }
    if (!_assertTeamAllowed(selectedTeam, 'cân mủ')) return;
    if (typeof Permissions !== 'undefined' && Permissions.canWriteFieldHarvest && !Permissions.canWriteFieldHarvest()) {
      _toast('Bạn không có quyền cân mủ', 'error');
      return;
    }
    _collectWeighDraftFromDom();
    var sectionId = weighSectionId;
    var draft = weighDraft[sectionId];
    if (!draft) return;
    try {
      await _persistSectionWeighings(sectionId, draft, { refreshPanel: true });
    } catch (e) {
      _toast(e.message || ('Lỗi lưu: ' + e), 'error');
    }
  }

  async function onDateChange() {
    var dateEl = _el('fhRecordDate');
    if (_fhSaveInProgress) {
      _toast('Đang lưu phân công — vui lòng đợi xong rồi mới đổi ngày', 'warning');
      if (dateEl && _fhLastRecordDate) dateEl.value = _fhLastRecordDate;
      return;
    }
    var newDate = (dateEl && dateEl.value) ? dateEl.value : _today();
    var draftN = _assignDraftCount();
    if (draftN > 0) {
      var discard = await showConfirm(
        'Có ' + draftN + ' phần cạo chưa lưu (ngày ' + (_fhLastRecordDate || newDate) + ').\n\n' +
        'Bấm OK = bỏ bản nháp và chuyển ngày.\n' +
        'Bấm Cancel = ở lại (nên bấm «Lưu phân công» trước khi đổi ngày).'
      );
      if (!discard) {
        if (dateEl && _fhLastRecordDate) dateEl.value = _fhLastRecordDate;
        return;
      }
      _clearAssignDraftCache(_fhLastRecordDate || newDate);
      assignDraft = {};
    }
    if (weighSectionId) closeSectionWeigh();
    if (quickWeighActive) closeQuickWeigh();
    _fhLastRecordDate = newDate;
    await loadAssignments({ clearDraft: true });
    await loadWeighings();
  }

  async function onTeamChange() {
    assignDraft = {};
    var next = (_el('fhTeamFilter') && _el('fhTeamFilter').value) || '';
    if (next && !_isTeamAllowed(next)) {
      _toast('Không có quyền thao tác đội này', 'error');
      _applyTeamScopeToSelection();
      return;
    }
    selectedTeam = next;
    try {
      if (selectedTeam) localStorage.setItem(FH_TEAM_KEY, selectedTeam);
      else localStorage.removeItem(FH_TEAM_KEY);
    } catch (e) { /* ignore */ }
    await loadWorkers();
    await loadLotCatalog();
    if (weighSectionId) closeSectionWeigh();
    if (quickWeighActive) closeQuickWeigh();
    _repairAssignmentViewFilters();
    renderAssignmentTable();
    _refreshSummaryTeamOptions();
    await _refreshYieldSummary();
  }

  function _initTeamFilter() {
    var el = _el('fhTeamFilter');
    var saved = '';
    try { saved = localStorage.getItem(FH_TEAM_KEY) || ''; } catch (e) { /* ignore */ }
    if (saved) selectedTeam = saved;
    _refreshTeamFilterOptions();
    if (el && saved) el.value = saved;
  }
  function onSessionFilterChange() {
    _persistAssignDraftCache(_dateVal());
    selectedSession = (_el('fhSessionFilter') && _el('fhSessionFilter').value) || 'A';
    try { localStorage.setItem(FH_SESSION_KEY, selectedSession); } catch (e) { /* ignore */ }
    _updateSessionHint();
    assignDraft = _restoreAssignDraftCache(_dateVal()) || {};
    if (weighSectionId) closeSectionWeigh();
    renderAssignmentTable();
    renderAssignmentStats();
    _refreshYieldSummary();
  }

  function _emptyWeighTotals() {
    return {
      latex_fresh: 0, coag_fresh: 0, latex_dry: 0, coag_dry: 0,
      total_fresh: 0, total_dry: 0, row_count: 0
    };
  }

  function _mergeWeighTotals(dest, src) {
    dest.latex_fresh += src.latex_fresh;
    dest.coag_fresh += src.coag_fresh;
    dest.latex_dry += src.latex_dry;
    dest.coag_dry += src.coag_dry;
    dest.total_fresh += src.total_fresh;
    dest.total_dry += src.total_dry;
    dest.row_count += src.row_count || 0;
  }

  function _totalsFromWeighing(w) {
    return {
      latex_fresh: parseFloat(w.latex_fresh_kg) || 0,
      coag_fresh: parseFloat(w.coag_fresh_kg) || 0,
      latex_dry: parseFloat(w.latex_dry_kg) || 0,
      coag_dry: parseFloat(w.coag_dry_kg) || 0,
      total_fresh: parseFloat(w.total_fresh_kg) || 0,
      total_dry: parseFloat(w.total_dry_kg) || 0,
      row_count: 1
    };
  }

  function _fmtSummaryKg(n) {
    var v = parseFloat(n) || 0;
    return v > 0 ? v.toFixed(2) : '—';
  }

  function _weighingMatchesSummarySession(w, sec) {
    if (summarySession === '__all__') return true;
    var meta = _weighingMeta(w);
    if (meta.tapping_session) return String(meta.tapping_session) === summarySession;
    if (sec) {
      var rows = assignments.filter(function (a) {
        return _sameSectionId(a.tapping_section_id, sec.id) && _assignmentSession(a) === summarySession;
      });
      if (rows.length) return true;
      return _sectionSession(sec) === summarySession;
    }
    return true;
  }

  function _summaryWeighPool() {
    return summaryPeriod === 'day' ? weighings : summaryWeighings;
  }

  function _weighingsForSummary() {
    return _summaryWeighPool().filter(function (w) {
      if ((parseFloat(w.total_fresh_kg) || 0) <= 0 &&
          (parseFloat(w.latex_fresh_kg) || 0) <= 0 &&
          (parseFloat(w.coag_fresh_kg) || 0) <= 0) return false;
      var sec = _sectionForSummaryWeighing(w.tapping_section_id);
      if (!sec || sec.active === false) return false;
      if (!_weighingMatchesSummarySession(w, sec)) return false;
      return _sectionMatchesTeamId(sec, summaryTeam);
    });
  }

  function _refreshSummaryTeamOptions() {
    var el = _el('fhSummaryTeam');
    if (!el) return;
    var cur = el.value || summaryTeam || '__all__';
    var html = '';
    var teams = _visibleTeams();
    var showAll = _teamScope.mode === 'all' || teams.length > 1;
    if (showAll) html += '<option value="__all__">Tất cả đội</option>';
    if (teams.length) {
      teams.forEach(function (t) {
        html += '<option value="' + _escapeHtml(String(t.id)) + '">' + _escapeHtml(t.name || t.id) + '</option>';
      });
    } else if (_teamScope.mode === 'all' && _productionTeams().length) {
      _productionTeams().forEach(function (t) {
        html += '<option value="' + _escapeHtml(String(t.id)) + '">' + _escapeHtml(t.name || t.id) + '</option>';
      });
    } else if (teams.length === 1) {
      html += '<option value="' + _escapeHtml(String(teams[0].id)) + '">' + _escapeHtml(teams[0].name || teams[0].id) + '</option>';
    }
    el.innerHTML = html;
    if (cur && el.querySelector('option[value="' + cur + '"]')) el.value = cur;
    else if (!showAll && teams.length === 1) el.value = String(teams[0].id);
    else el.value = showAll ? '__all__' : (el.options[0] ? el.options[0].value : '__all__');
    summaryTeam = el.value;
  }

  function _summaryLabelColspan(mode) {
    var showTeam = summaryTeam === '__all__';
    mode = mode || summaryViewMode;
    if (mode === 'lot') return showTeam ? 3 : 2;
    if (mode === 'worker') return showTeam ? 4 : 3;
    return showTeam ? 5 : 4;
  }

  function _summaryTotalsCells(t, labelColspan, label) {
    return '<td colspan="' + labelColspan + '" class="fh-sum-text">' + _escapeHtml(label) + '</td>' +
      '<td>' + _fmtSummaryKg(t.latex_fresh) + '</td>' +
      '<td>' + _fmtSummaryKg(t.coag_fresh) + '</td>' +
      '<td>' + _fmtSummaryKg(t.total_fresh) + '</td>' +
      '<td>' + _fmtSummaryKg(t.latex_dry) + '</td>' +
      '<td>' + _fmtSummaryKg(t.coag_dry) + '</td>' +
      '<td>' + _fmtSummaryKg(t.total_dry) + '</td>';
  }

  function _buildSectionSummaryData() {
    var map = {};
    _weighingsForSummary().forEach(function (w) {
      var sid = w.tapping_section_id;
      if (!map[sid]) {
        var sec = _sectionForSummaryWeighing(sid);
        var teamId = sec ? String(sec.team_id || sec.squad || selectedTeam || '') : '';
        map[sid] = {
          key: sid,
          team_id: teamId,
          team_name: _teamNameById(teamId),
          section_code: sec ? (sec.section_code || sid) : sid,
          lot_code: sec ? _sectionLotCode(sec) : '',
          session: summaryPeriod === 'day' ? (sec ? _sectionSession(sec) : '') : '—',
          worker_id: '',
          worker_name: '',
          totals: _emptyWeighTotals()
        };
      }
      _mergeWeighTotals(map[sid].totals, _totalsFromWeighing(w));
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      var tc = a.team_name.localeCompare(b.team_name, undefined, { numeric: true });
      if (tc !== 0) return tc;
      return String(a.section_code).localeCompare(String(b.section_code), undefined, { numeric: true });
    });
  }

  function _buildWorkerSummaryData() {
    var map = {};
    _weighingsForSummary().forEach(function (w) {
      var wid = w.worker_id;
      if (!map[wid]) {
        var wr = workers.find(function (x) { return _sameSectionId(x.id, wid); });
        var sec = _sectionForSummaryWeighing(w.tapping_section_id);
        var teamId = wr ? String(wr.team_id || wr.team || wr.production_team_id || '') :
          (sec ? String(sec.team_id || sec.squad || selectedTeam || '') : '');
        map[wid] = {
          key: wid,
          team_id: teamId,
          team_name: _teamNameById(teamId),
          section_code: '',
          session: '',
          worker_id: wid,
          worker_name: wr ? _workerName(wr) : _workerLabel(wid),
          totals: _emptyWeighTotals()
        };
      }
      _mergeWeighTotals(map[wid].totals, _totalsFromWeighing(w));
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      var tc = a.team_name.localeCompare(b.team_name, undefined, { numeric: true });
      if (tc !== 0) return tc;
      return a.worker_name.localeCompare(b.worker_name, undefined, { numeric: true });
    });
  }

  function _buildLotSummaryData() {
    var map = {};
    _weighingsForSummary().forEach(function (w) {
      var sec = _sectionForSummaryWeighing(w.tapping_section_id);
      var wMeta = _weighingMeta(w);
      var lotCode = _sectionLotCode(sec) || wMeta.lot_code || '(Chưa gán lô)';
      var teamId = sec ? String(sec.team_id || sec.squad || selectedTeam || '') : '';
      if (!map[lotCode]) {
        map[lotCode] = {
          key: lotCode,
          team_id: teamId,
          team_name: _teamNameById(teamId),
          lot_code: lotCode,
          totals: _emptyWeighTotals()
        };
      }
      _mergeWeighTotals(map[lotCode].totals, _totalsFromWeighing(w));
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      var tc = a.team_name.localeCompare(b.team_name, undefined, { numeric: true });
      if (tc !== 0) return tc;
      return String(a.lot_code).localeCompare(String(b.lot_code), undefined, { numeric: true });
    });
  }

  function _renderSummaryBodyRows(rows, mode) {
    var showTeam = summaryTeam === '__all__';
    var grand = _emptyWeighTotals();
    var teamSub = _emptyWeighTotals();
    var lastTeam = null;
    var html = [];
    var stt = 0;
    var labelColspan = _summaryLabelColspan(mode);

    function _flushSubtotal(teamId) {
      if (!showTeam || !lastTeam) return;
      html.push('<tr class="fh-summary-subtotal">' +
        _summaryTotalsCells(teamSub, labelColspan, 'Cộng ' + _teamNameById(teamId)) + '</tr>');
      teamSub = _emptyWeighTotals();
    }

    rows.forEach(function (row) {
      var tid = row.team_id || '';
      if (showTeam && lastTeam !== null && tid !== lastTeam) _flushSubtotal(lastTeam);
      lastTeam = tid;
      stt++;
      _mergeWeighTotals(teamSub, row.totals);
      _mergeWeighTotals(grand, row.totals);

      html.push('<tr>');
      html.push('<td style="text-align:center;">' + stt + '</td>');
      if (showTeam) html.push('<td class="fh-sum-text">' + _escapeHtml(row.team_name) + '</td>');
      if (mode === 'section') {
        html.push('<td class="fh-sum-text"><strong>' + _escapeHtml(row.section_code) + '</strong></td>');
        html.push('<td class="fh-sum-text">' + _escapeHtml(row.lot_code || '—') + '</td>');
        html.push('<td style="text-align:center;">' + _sessionBadge(row.session) + '</td>');
      } else if (mode === 'lot') {
        html.push('<td class="fh-sum-text"><strong>' + _escapeHtml(row.lot_code) + '</strong></td>');
      } else {
        html.push('<td class="fh-sum-text">' + _escapeHtml(row.worker_id) + '</td>');
        html.push('<td class="fh-sum-text">' + _escapeHtml(row.worker_name) + '</td>');
      }
      html.push('<td>' + _fmtSummaryKg(row.totals.latex_fresh) + '</td>');
      html.push('<td>' + _fmtSummaryKg(row.totals.coag_fresh) + '</td>');
      html.push('<td>' + _fmtSummaryKg(row.totals.total_fresh) + '</td>');
      html.push('<td>' + _fmtSummaryKg(row.totals.latex_dry) + '</td>');
      html.push('<td>' + _fmtSummaryKg(row.totals.coag_dry) + '</td>');
      html.push('<td>' + _fmtSummaryKg(row.totals.total_dry) + '</td>');
      html.push('</tr>');
    });

    if (showTeam && lastTeam) _flushSubtotal(lastTeam);
    return { html: html.join(''), grand: grand, labelColspan: labelColspan };
  }

  function renderYieldSummary() {
    var head = _el('fhSummaryHead');
    var body = _el('fhSummaryBody');
    var foot = _el('fhSummaryFoot');
    var hint = _el('fhSummaryHint');
    if (!head || !body || !foot) return;

    _readSummaryFilters();
    var range = _summaryDateRange(summaryPeriod, _dateVal());
    summaryRangeLabel = range.label;
    var mode = summaryViewMode === 'worker' ? 'worker' : (summaryViewMode === 'lot' ? 'lot' : 'section');
    var showTeam = summaryTeam === '__all__';
    var rows = mode === 'worker'
      ? _buildWorkerSummaryData()
      : (mode === 'lot' ? _buildLotSummaryData() : _buildSectionSummaryData());

    if (hint) {
      var sessLabel = summarySession === '__all__' ? 'Tất cả phiên' : ('Phiên ' + summarySession);
      var offlineNote = (summaryPeriod !== 'day' && !_isOnline()) ? ' · Cần mạng để tải kỳ dài' : '';
      hint.textContent = summaryRangeLabel + ' · ' + sessLabel + ' · ' +
        (rows.length ? rows.length + ' dòng' : 'Chưa có dữ liệu cân') + offlineNote;
    }

    var headCols = '<tr><th>STT</th>';
    if (showTeam) headCols += '<th>Đội SX</th>';
    if (mode === 'section') {
      headCols += '<th>Phần cạo</th><th>Lô</th><th>Phiên</th>';
    } else if (mode === 'lot') {
      headCols += '<th>Mã lô</th>';
    } else {
      headCols += '<th>Mã CN</th><th>Công nhân</th>';
    }
    headCols += '<th class="fh-sum-col-latex">Mủ nước (tươi)</th>' +
      '<th class="fh-sum-col-coag">Mủ đông (tươi)</th>' +
      '<th class="fh-sum-col-total">Tổng tươi</th>' +
      '<th class="fh-sum-col-latex">Mủ nước (khô)</th>' +
      '<th class="fh-sum-col-coag">Mủ đông (khô)</th>' +
      '<th class="fh-sum-col-total">Tổng khô</th></tr>';
    head.innerHTML = headCols;

    if (!rows.length) {
      var colSpan = _summaryLabelColspan(mode) + 6;
      var emptyMsg = summaryPeriod !== 'day' && !_isOnline()
        ? 'Cần có mạng để tổng hợp theo tuần / tháng / năm'
        : ('Chưa có sản lượng cân — ' + summaryRangeLabel +
          (summarySession !== '__all__' ? (' · phiên ' + summarySession) : '') +
          (summaryTeam !== '__all__' ? (' · ' + _teamNameById(summaryTeam)) : ''));
      body.innerHTML = '<tr class="fh-sum-empty"><td colspan="' + colSpan + '">' +
        _escapeHtml(emptyMsg) + '</td></tr>';
      foot.innerHTML = '';
      return;
    }

    var rendered = _renderSummaryBodyRows(rows, mode);
    body.innerHTML = rendered.html;
    foot.innerHTML = '<tr class="fh-summary-grand">' +
      _summaryTotalsCells(rendered.grand, rendered.labelColspan, 'TỔNG CỘNG') + '</tr>';
  }

  async function onSummaryFilterChange() {
    await _refreshYieldSummary();
  }

  function _summaryViewLabel(mode) {
    if (mode === 'lot') return 'Lô';
    if (mode === 'worker') return 'Công nhân';
    return 'Phần cạo';
  }

  function _kgExportNum(n) {
    var v = parseFloat(n) || 0;
    return v > 0 ? Math.round(v * 100) / 100 : '';
  }

  function _getSummaryExportContext() {
    _readSummaryFilters();
    var range = _summaryDateRange(summaryPeriod, _dateVal());

    var mode = summaryViewMode === 'worker' ? 'worker'
      : (summaryViewMode === 'lot' ? 'lot' : 'section');
    var showTeam = summaryTeam === '__all__';
    var rows = mode === 'worker' ? _buildWorkerSummaryData()
      : (mode === 'lot' ? _buildLotSummaryData() : _buildSectionSummaryData());
    var teamLabel = summaryTeam === '__all__' ? 'Tất cả đội' : _teamNameById(summaryTeam);
    var sessionLabel = summarySession === '__all__' ? 'Tất cả phiên' : ('Phiên ' + summarySession);

    var headers = ['STT'];
    if (showTeam) headers.push('Đội SX');
    if (mode === 'section') {
      headers.push('Phần cạo', 'Lô', 'Phiên');
    } else if (mode === 'lot') {
      headers.push('Mã lô');
    } else {
      headers.push('Mã CN', 'Công nhân');
    }
    headers.push(
      'Mủ nước (tươi)', 'Mủ đông (tươi)', 'Tổng tươi',
      'Mủ nước (khô)', 'Mủ đông (khô)', 'Tổng khô'
    );

    var body = [];
    rows.forEach(function (row, i) {
      var r = [i + 1];
      if (showTeam) r.push(row.team_name || '');
      if (mode === 'section') {
        r.push(row.section_code || '', row.lot_code || '', row.session || '');
      } else if (mode === 'lot') {
        r.push(row.lot_code || '');
      } else {
        r.push(row.worker_id || '', row.worker_name || '');
      }
      var t = row.totals;
      r.push(
        _kgExportNum(t.latex_fresh), _kgExportNum(t.coag_fresh), _kgExportNum(t.total_fresh),
        _kgExportNum(t.latex_dry), _kgExportNum(t.coag_dry), _kgExportNum(t.total_dry)
      );
      body.push(r);
    });

    var grand = rows.length ? _renderSummaryBodyRows(rows, mode).grand : _emptyWeighTotals();
    var labelCols = headers.length - 6;
    var footer = ['TỔNG CỘNG'];
    for (var p = 1; p < labelCols; p++) footer.push('');
    footer.push(
      _kgExportNum(grand.latex_fresh), _kgExportNum(grand.coag_fresh), _kgExportNum(grand.total_fresh),
      _kgExportNum(grand.latex_dry), _kgExportNum(grand.coag_dry), _kgExportNum(grand.total_dry)
    );

    return {
      date: _dateVal(),
      dateFrom: range.from,
      dateTo: range.to,
      period: summaryPeriod,
      periodLabel: _summaryPeriodLabel(summaryPeriod),
      rangeLabel: range.label,
      session: sessionLabel,
      teamLabel: teamLabel,
      viewLabel: _summaryViewLabel(mode),
      headers: headers,
      body: body,
      footer: footer,
      rowCount: rows.length
    };
  }

  function _summaryExportFileBase(ctx) {
    var team = String(ctx.teamLabel || 'TatCa')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'TatCa';
    return 'SanLuongCN_' + (ctx.period || 'day') + '_' + ctx.dateFrom + '_' + ctx.dateTo + '_' + team;
  }

  function exportSummaryExcel() {
    if (typeof XLSX === 'undefined') {
      _toast('Thư viện Excel chưa tải — thử refresh trang (Ctrl+F5)', 'error');
      return;
    }
    var ctx = _getSummaryExportContext();
    if (!ctx.rowCount) {
      _toast('Chưa có dữ liệu cân để xuất', 'warning');
      return;
    }
    var aoa = [
      ['Tổng hợp sản lượng công nhân tại vườn'],
      ['Kỳ', ctx.periodLabel, 'Từ', ctx.dateFrom, 'Đến', ctx.dateTo],
      ['Phiên', ctx.session, 'Đội/Tổ', ctx.teamLabel, 'Hiển thị theo', ctx.viewLabel],
      [],
      ctx.headers
    ];
    ctx.body.forEach(function (r) { aoa.push(r); });
    aoa.push(ctx.footer);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = ctx.headers.map(function (_, i) {
      return { wch: i === 0 ? 6 : (i < ctx.headers.length - 6 ? 22 : 14) };
    });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'San luong');
    XLSX.writeFile(wb, _summaryExportFileBase(ctx) + '.xlsx');
    _toast('Đã xuất Excel', 'success');
  }

  function _loadPdfFont(doc) {
    if (typeof RobotoRegularFont !== 'undefined' && RobotoRegularFont && RobotoRegularFont.length > 100) {
      try {
        doc.addFileToVFS('Roboto-Regular.ttf', RobotoRegularFont);
        doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
        doc.setFont('Roboto', 'normal');
        return 'Roboto';
      } catch (e) { /* fallback below */ }
    }
    return '';
  }

  function _openSummaryPrintView(ctx) {
    var headCells = ctx.headers.map(function (h) {
      return '<th>' + _escapeHtml(h) + '</th>';
    }).join('');
    var bodyRows = ctx.body.map(function (row) {
      return '<tr>' + row.map(function (c) {
        return '<td>' + _escapeHtml(c === '' ? '—' : String(c)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var footCells = ctx.footer.map(function (c, i) {
      var tag = i === 0 ? 'th' : 'td';
      return '<' + tag + '>' + _escapeHtml(c === '' ? '' : String(c)) + '</' + tag + '>';
    }).join('');

    var html = '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Báo cáo sản lượng CN</title>' +
      '<style>' +
      'body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#0f172a;}' +
      'h1{font-size:18px;margin:0 0 8px;}' +
      '.meta{font-size:13px;color:#475569;margin-bottom:16px;}' +
      'table{border-collapse:collapse;width:100%;font-size:12px;}' +
      'th,td{border:1px solid #cbd5e1;padding:6px 8px;}' +
      'thead th{background:#1e40af;color:#fff;}' +
      'tfoot th,tfoot td{background:#fef3c7;font-weight:700;}' +
      'tbody tr:nth-child(even){background:#f8fafc;}' +
      '@media print{body{margin:12px;} button{display:none;}}' +
      '</style></head><body>' +
      '<h1>📊 Tổng hợp sản lượng</h1>' +
      '<div class="meta"><strong>' + _escapeHtml(ctx.rangeLabel) + '</strong> · ' +
      _escapeHtml(ctx.session) + ' · ' + _escapeHtml(ctx.teamLabel) +
      ' · Hiển thị theo <strong>' + _escapeHtml(ctx.viewLabel) + '</strong></div>' +
      '<table><thead><tr>' + headCells + '</tr></thead><tbody>' + bodyRows +
      '</tbody><tfoot><tr>' + footCells + '</tr></tfoot></table>' +
      '<p style="margin-top:16px;font-size:12px;color:#64748b;">In hoặc chọn <em>Lưu thành PDF</em> trong hộp thoại in.</p>' +
      '<button onclick="window.print()" style="margin-top:8px;padding:8px 14px;cursor:pointer;">🖨️ In / Lưu PDF</button>' +
      '</body></html>';

    var w = window.open('', '_blank');
    if (!w) {
      _toast('Trình duyệt chặn cửa sổ mới — cho phép popup để xuất PDF', 'warning');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) { /* user prints manually */ } }, 400);
  }

  function exportSummaryPdf() {
    var ctx = _getSummaryExportContext();
    if (!ctx.rowCount) {
      _toast('Chưa có dữ liệu cân để xuất', 'warning');
      return;
    }

    var JsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!JsPDF) {
      _openSummaryPrintView(ctx);
      _toast('Đã mở bản in — chọn Lưu thành PDF', 'info');
      return;
    }

    var doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    var fontName = _loadPdfFont(doc);
    if (!fontName) {
      _openSummaryPrintView(ctx);
      _toast('Đã mở bản in — chọn Lưu thành PDF', 'info');
      return;
    }

    doc.setFont(fontName, 'normal');
    doc.setFontSize(14);
    doc.text('TỔNG HỢP SẢN LƯỢNG CÔNG NHÂN', 148, 12, { align: 'center' });
    doc.setFontSize(10);
    doc.text(
      ctx.rangeLabel + '  |  ' + ctx.session + '  |  ' + ctx.teamLabel + '  |  Theo: ' + ctx.viewLabel,
      14, 20
    );

    var tableBody = ctx.body.map(function (row) {
      return row.map(function (c) { return c === '' ? '—' : c; });
    });
    var footRow = ctx.footer.map(function (c, i) {
      return c === '' ? (i === 0 ? 'TỔNG CỘNG' : '') : c;
    });

    doc.autoTable({
      startY: 26,
      head: [ctx.headers],
      body: tableBody,
      foot: [footRow],
      theme: 'grid',
      styles: { font: fontName, fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 64, 175], textColor: 255, halign: 'center', font: fontName },
      footStyles: { fillColor: [254, 243, 199], textColor: [15, 23, 42], fontStyle: 'bold', font: fontName },
      columnStyles: { 0: { halign: 'center', cellWidth: 10 } }
    });

    doc.save(_summaryExportFileBase(ctx) + '.pdf');
    _toast('Đã xuất PDF', 'success');
  }

  function _initSummaryPanel() {
    _refreshSummaryTeamOptions();
    var periodEl = _el('fhSummaryPeriod');
    if (periodEl) summaryPeriod = periodEl.value || 'day';
    var sessionEl = _el('fhSummarySession');
    if (sessionEl) summarySession = sessionEl.value || '__all__';
    var viewEl = _el('fhSummaryView');
    if (viewEl) summaryViewMode = viewEl.value || 'section';
    var teamEl = _el('fhSummaryTeam');
    if (selectedTeam && teamEl) {
      var opt = teamEl.querySelector('option[value="' + selectedTeam + '"]');
      if (opt) {
        teamEl.value = selectedTeam;
        summaryTeam = selectedTeam;
      }
    }
  }

  async function _syncPending() {
    if (!_offlineReady() || !_isOnline()) return 0;
    var queue = await FieldHarvestOffline.getQueue();
    if (!queue.length) {
      _updateOfflineUI();
      return 0;
    }
    var synced = 0;
    for (var qi = 0; qi < queue.length; qi++) {
      var item = queue[qi];
      try {
        if (item.type === 'assignments') {
          await _upsertSectionAssignments(item.sectionId, item.cfg, item.date);
          await _saveSectionLot(item.sectionId, (item.cfg && item.cfg.lot_code) || '');
          _applyAssignmentsLocal(item.sectionId, item.cfg, item.date);
        } else if (item.type === 'section_weigh') {
          var pl = item.payloads || [];
          for (var pi = 0; pi < pl.length; pi++) {
            await _saveWorkerWeighing(item.sectionId, pl[pi].workerId, pl[pi].payload);
          }
        }
        await FieldHarvestOffline.removeFromQueue(item.id);
        synced++;
      } catch (e) {
        console.warn('Sync failed:', item.type, e.message);
        _toast('Đồng bộ thất bại: ' + e.message, 'error');
        break;
      }
    }
    if (synced > 0) {
      await loadSections();
      await loadAssignments({ clearDraft: true });
      await loadWeighings();
      _toast('Đã đồng bộ ' + synced + ' thao tác lên server', 'success');
    }
    _updateOfflineUI();
    return synced;
  }

  async function prefetchOfflineData() {
    if (!_offlineReady()) {
      _toast('Trình duyệt không hỗ trợ lưu offline', 'error');
      return;
    }
    if (!_isOnline()) {
      _toast('Đang offline — dùng dữ liệu đã lưu trên máy', 'info');
      await loadTeams();
      await loadSections();
      await _loadWorkersFromCache();
      var date = _dateVal();
      await loadAssignments();
      await loadWeighings();
      _updateOfflineUI();
      return;
    }
    try {
      await _silentMasterCacheRefresh();
      await loadWorkers();
      var date = _dateVal();
      await loadAssignments();
      await loadWeighings();
      await loadLotCatalog();
      _toast('Đã cập nhật bản sao trên máy — có thể làm việc khi mất mạng', 'success');
      _updateOfflineUI();
    } catch (e) {
      _toast('Lỗi tải dữ liệu: ' + e.message, 'error');
    }
  }

  async function syncNow() {
    if (!_isOnline()) {
      _toast('Chưa có mạng — không đồng bộ được', 'warning');
      return;
    }
    var n = await _syncPending();
    if (!n) _toast('Không có thao tác chờ đồng bộ');
  }

  function _bindOfflineEvents() {
    if (!_offlineReady() || window._fhOfflineBound) return;
    window._fhOfflineBound = true;
    window.addEventListener('online', function () {
      _syncPending();
      _silentMasterCacheRefresh();
      loadAssignments();
      loadWeighings();
      _updateOfflineUI();
    });
    window.addEventListener('offline', function () {
      _toast('Mất mạng — tiếp tục nhập, dữ liệu lưu trên máy và tự đồng bộ sau', 'warning');
      _updateOfflineUI();
    });
  }

  function _bindAutoSync() {
    if (window._fhAutoSyncBound) return;
    window._fhAutoSyncBound = true;
    setInterval(function () {
      if (_isOnline()) _syncPending();
    }, 45000);
  }

  function _bindPermissionRefresh() {
    if (window._fhPermRefreshBound) return;
    window._fhPermRefreshBound = true;
    window.addEventListener('focus', function () {
      _loadTeamScope().then(function () {
        _refreshTeamFilterOptions();
        _refreshSummaryTeamOptions();
      });
      if (_isOnline()) {
        loadAssignments();
        loadWeighings();
      }
    });
  }

  async function init() {
    var dateEl = _el('fhRecordDate');
    if (dateEl && !dateEl.value) dateEl.value = _today();
    _fhLastRecordDate = (dateEl && dateEl.value) ? dateEl.value : _today();
    _initSessionFilter();
    if (_offlineReady()) {
      try { await FieldHarvestOffline.init(); } catch (e) { console.warn('Offline DB:', e.message); }
      _bindOfflineEvents();
    }
    _bindPermissionRefresh();
    _bindAutoSync();
    await _loadTeamScope();
    if (typeof TscDrcConverter !== 'undefined') await TscDrcConverter.load();
    await loadTeams();
    _initTeamFilter();
    _applyTeamScopeToSelection();
    if (_isOnline()) {
      await _silentMasterCacheRefresh();
    } else if (_offlineReady()) {
      var meta = await FieldHarvestOffline.getMeta();
      if (meta.lastMasterCache) {
        _toast('Offline — dùng dữ liệu lưu ' + new Date(meta.lastMasterCache).toLocaleString('vi-VN'), 'info');
      } else {
        _toast('Offline — chưa có bản sao trên máy. Cần mở app khi có mạng ít nhất một lần.', 'warning');
      }
    }
    _initSummaryPanel();
    await loadSections();
    await loadLotCatalog();
    await loadWorkers();
    await loadAssignments();
    await loadWeighings();
    if (_isOnline()) await _syncPending();
    _updateOfflineUI();
  }

  return {
    init: init, onDateChange: onDateChange, onTeamChange: onTeamChange,
    onSessionFilterChange: onSessionFilterChange, onSummaryFilterChange: onSummaryFilterChange,
    renderYieldSummary: renderYieldSummary,
    exportSummaryExcel: exportSummaryExcel,
    exportSummaryPdf: exportSummaryPdf,
    saveAllAssignments: saveAllAssignments,
    prefetchOfflineData: prefetchOfflineData,
    syncNow: syncNow,
    openSectionModal: openSectionModal, closeSectionModal: closeSectionModal,
    saveSection: saveSection, deleteSection: deleteSection, copyFromDate: copyFromDate,
    openAssignRowModal: openAssignRowModal, closeAssignRowModal: closeAssignRowModal,
    onAssignRowLotChange: onAssignRowLotChange, confirmAssignRow: confirmAssignRow,
    openSectionWeigh: openSectionWeigh, closeSectionWeigh: closeSectionWeigh,
    saveSectionWeigh: saveSectionWeigh, setWorkerBinCount: setWorkerBinCount,
    openQuickWeigh: openQuickWeigh, closeQuickWeigh: closeQuickWeigh, saveQuickWeigh: saveQuickWeigh
  };
})();
