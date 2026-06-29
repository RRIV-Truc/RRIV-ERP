/**
 * Tab 1: Giao Nhận Mủ - Delivery/transport tracking (TCCS 111:2023)
 * @module TabDelivery
 */

const TabDelivery = (function() {
  'use strict';

  // === State ===
  let deliveries = [];
  let deliveryPlots = [];
  let selectedPlotIds = [];
  let companyTeams = [];
  let harvestSections = [];
  let harvestAssignments = [];
  let harvestWeighings = [];

  var FH_DEFAULT_TEAM_ID = 'team-lk';
  var ALLOC_KEY = 'rriv_harvest_allocation';
  var TAP_SESSIONS = ['A', 'B', 'C', 'D'];
  var SESSION_LABELS = { A: 'A', B: 'B', C: 'C', D: 'D' };
  var COAG_TYPES = [
    { key: 'block', label: 'M\u1ee7 kh\u1ed1i', grossId: 'deliveryCoagBlockGross', drcId: 'deliveryCoagBlockDRC' },
    { key: 'cup', label: 'M\u1ee7 ch\u00e9n', grossId: 'deliveryCoagCupGross', drcId: 'deliveryCoagCupDRC' },
    { key: 'scrap', label: 'M\u1ee7 d\u00e2y', grossId: 'deliveryCoagScrapGross', drcId: 'deliveryCoagScrapDRC' },
    { key: 'misc', label: 'M\u1ee7 t\u1ea1p', grossId: 'deliveryCoagMiscGross', drcId: 'deliveryCoagMiscDRC' }
  ];

  // === Helpers ===
  function _db() { return ErpDb.firestore(); }
  function _user() { return window.currentUser; }
  function _showToast(msg, type) { if (window.showToast) window.showToast(msg, type); }
  function _formatNumber(n) { return window.formatNumber ? window.formatNumber(n) : String(n); }
  function _formatDate(d) { return window.formatDate ? window.formatDate(d) : ''; }
  function _generateCode(prefix, dateStr) {
    return window.generateCode ? window.generateCode(prefix, dateStr) : prefix + Date.now();
  }

  function _generateDeliveryNo(dateStr) {
    return _generateCode('GN', dateStr || new Date().toISOString().slice(0, 10));
  }
  function _getMapPlots() { return TabGardens ? TabGardens.getMapPlots() : []; }
  function _getGardens() { return TabGardens ? TabGardens.getGardens() : []; }

  function _parseMeta(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }

  function _assignmentMeta(a) {
    if (!a) return {};
    var meta = _parseMeta(a.metadata);
    ['slots', 'lot_code', 'work_mode', 'tapping_session', 'roles', 'yield_share_pct'].forEach(function (k) {
      if (a[k] != null && a[k] !== '') meta[k] = a[k];
    });
    return meta;
  }

  function _assignmentSession(a) {
    if (!a) return 'A';
    return _assignmentMeta(a).tapping_session || 'A';
  }

  function _isLegacyDemoTeam(t) {
    var id = String(t.id || '');
    var name = String(t.name || '');
    if (['1', '2', '3'].indexOf(id) >= 0 && /^Đội\s*SX\s*\d+$/i.test(name.trim())) return true;
    return false;
  }

  function _productionTeams() {
    var list = companyTeams.filter(function (t) { return !_isLegacyDemoTeam(t); });
    return list.length ? list : companyTeams;
  }

  function _normalizeTeamLabel(name) {
    return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

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
    return String(list[0].id);
  }

  function _teamKeysForId(teamId) {
    if (!teamId) return [];
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
    if (tid === 'team-lk') {
      keys.LK = true;
      keys['Trạm Lai Khê'] = true;
      keys['Tram Lai Khe'] = true;
    }
    return Object.keys(keys);
  }

  function _sectionSquadId(s) {
    if (!s) return '';
    var meta = _parseMeta(s.metadata);
    return String(s.squad || meta.squad || '').trim();
  }

  function _valueInTeamKeys(value, keys) {
    if (!keys || !keys.length || value == null || value === '') return false;
    return keys.indexOf(String(value)) >= 0;
  }

  function _sectionMatchesTeamId(s, teamId) {
    if (!teamId) return false;
    var keys = _teamKeysForId(teamId);
    return _valueInTeamKeys(_sectionSquadId(s), keys) || _valueInTeamKeys(s.team_id, keys);
  }

  function _weighingMeta(w) {
    if (!w) return {};
    var meta = _parseMeta(w.metadata);
    ['weigh_detail', 'tapping_session', 'latex_drc_pct', 'section_total_fresh_kg', 'roles'].forEach(function (k) {
      if (w[k] != null && w[k] !== '') meta[k] = w[k];
    });
    return meta;
  }

  /** Chỉ cộng dòng cân cạo — khớp logic tổng hợp theo phần cạo trong field-harvest. */
  function _isTapperWeighRow(w) {
    var meta = _weighingMeta(w);
    var roles = meta.roles || [];
    if (roles.length) {
      return roles.some(function (r) { return r.role === 'tapper'; });
    }
    return !!(meta.weigh_detail || meta.section_total_fresh_kg);
  }

  /** Phiên cạo theo lịch tuần (CN=A, T2=B, T3=C, T4=D, …) — dùng khi chưa có phân công. */
  function _sessionForRecordDate(dateStr) {
    if (!dateStr) return 'A';
    var d = new Date(String(dateStr) + 'T12:00:00');
    if (isNaN(d.getTime())) return 'A';
    return ['A', 'B', 'C', 'D', 'A', 'B', 'C'][d.getDay()] || 'A';
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

  function _sectionIdsForTeam(teamId) {
    if (!teamId) return [];
    return harvestSections.filter(function (s) {
      return _sectionMatchesTeamId(s, teamId);
    }).map(function (s) { return String(s.id); });
  }

  function _assignmentMatchesTeam(a, teamId) {
    if (!teamId || !a) return false;
    var sid = String(a.tapping_section_id || '');
    if (!sid) return false;
    return _sectionIdsForTeam(teamId).indexOf(sid) >= 0;
  }

  function _weighingMatchesTeam(w, teamId) {
    if (!teamId || !w) return false;
    var sec = _findHarvestSection(w.tapping_section_id);
    return !!(sec && _sectionMatchesTeamId(sec, teamId));
  }

  /** Phiên cạo thực tế trong ngày cạo tại trạm (từ phân công + cân mủ). */
  function _sessionsForTeamDate(teamId, dateStr) {
    var found = {};
    if (!teamId || !dateStr) return [];

    harvestAssignments.filter(function (a) {
      return String(a.record_date || '') === String(dateStr) && _assignmentMatchesTeam(a, teamId);
    }).forEach(function (a) {
      found[_assignmentSession(a)] = true;
    });

    harvestWeighings.filter(function (w) {
      return String(w.record_date || '') === String(dateStr) && _weighingMatchesTeam(w, teamId);
    }).forEach(function (w) {
      var meta = _weighingMeta(w);
      if (meta.tapping_session && TAP_SESSIONS.indexOf(meta.tapping_session) >= 0) {
        found[meta.tapping_session] = true;
        return;
      }
      var asn = harvestAssignments.find(function (a) {
        return String(a.tapping_section_id) === String(w.tapping_section_id) &&
          String(a.record_date || '') === String(dateStr);
      });
      if (asn) found[_assignmentSession(asn)] = true;
    });

    var list = TAP_SESSIONS.filter(function (s) { return found[s]; });
    if (!list.length) list = [_sessionForRecordDate(dateStr)];
    return list;
  }

  function _findHarvestSection(sectionId) {
    return harvestSections.find(function (s) { return String(s.id) === String(sectionId); });
  }

  function _teamNameById(teamId) {
    if (!teamId) return '—';
    var t = companyTeams.find(function (x) { return String(x.id) === String(teamId); });
    return t ? (t.name || t.id) : String(teamId);
  }

  function _deliveryRecordDate(d) {
    if (!d) return '';
    var tap = _deliveryTappingDateStr(d);
    if (tap) return tap;
    if (d.createdAt) return _normalizeDateStr(d.createdAt);
    return '';
  }

  function _normalizeDateStr(val) {
    if (val == null || val === '') return '';
    if (typeof val === 'object') {
      if (typeof val.toDate === 'function') return _isoDateLocal(val.toDate());
      if (val.seconds != null) return _isoDateLocal(new Date(Number(val.seconds) * 1000));
    }
    var s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var d = new Date(s);
    if (!isNaN(d.getTime())) return _isoDateLocal(d);
    return '';
  }

  /** Ngày cạo trên phiếu GN — dùng làm khóa phân bổ sản lượng (không dùng Ngày * / createdAt). */
  /** Ngày cạo trên phiếu GN — dùng làm khóa phân bổ sản lượng (không dùng Ngày lập phiếu / createdAt). */
  function _deliveryTappingDateStr(d) {
    if (!d) return '';
    if (typeof d.tappingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(d.tappingDate).trim())) {
      return String(d.tappingDate).trim();
    }
    if (typeof d.tapping_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(d.tapping_date).trim())) {
      return String(d.tapping_date).trim();
    }
    var fromDate = d.tappingDate ? _normalizeDateStr(d.tappingDate) :
      (d.tapping_date ? _normalizeDateStr(d.tapping_date) : '');
    if (fromDate) return fromDate;
    if (typeof d.tappingTime === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(d.tappingTime).trim())) {
      return String(d.tappingTime).trim();
    }
    return d.tappingTime ? _normalizeDateStr(d.tappingTime) : '';
  }

  function _deliveryDocumentDateStr(d) {
    if (!d) return '';
    if (d.documentDate) return _normalizeDateStr(d.documentDate);
    if (d.createdAt) return _normalizeDateStr(d.createdAt);
    return _deliveryTappingDateStr(d);
  }

  function _deliveryDisplayDate(d) {
    return _deliveryTappingDateStr(d);
  }

  function _normalizeDeliveryRecord(d) {
    if (!d) return d;
    var meta = _parseMeta(d.metadata);
    if (meta && typeof meta === 'object') {
      ['latexDryWeight', 'coagDryWeight', 'latexGrossWeight', 'coagGrossWeight',
        'latexDrcPercent', 'coagDrcPercent', 'tscPercent', 'dryWeight', 'coagByType',
        'plotIds', 'plotNames', 'receivePerson', 'sealStatus', 'sealCode', 'collectionTime',
        'tappingTimeOnly', 'documentDate', 'latexPurpose', 'seasonType'].forEach(function (k) {
        if (d[k] == null && meta[k] != null) d[k] = meta[k];
      });
    }
    var snakeMap = {
      latex_dry_weight: 'latexDryWeight',
      coag_dry_weight: 'coagDryWeight',
      latex_gross_weight: 'latexGrossWeight',
      coag_gross_weight: 'coagGrossWeight',
      latex_drc_percent: 'latexDrcPercent',
      coag_drc_percent: 'coagDrcPercent',
      dry_weight: 'dryWeight',
      gross_weight: 'grossWeight',
      drc_percent: 'drcPercent',
      tapping_date: 'tappingDate',
      team_id: 'team_id',
      garden_id: 'gardenId',
      garden_code: 'gardenCode',
      delivery_no: 'deliveryNo',
      tapping_session: 'tappingSession'
    };
    Object.keys(snakeMap).forEach(function (sk) {
      if (d[sk] != null && d[snakeMap[sk]] == null) d[snakeMap[sk]] = d[sk];
    });
    var tap = _deliveryTappingDateStr(d);
    if (tap) {
      d.tappingDate = tap;
      d.tappingTime = tap;
    }
    return d;
  }

  function _deliveryMatchesTeam(d, teamId) {
    if (!d || !teamId) return false;
    var keys = _teamKeysForId(teamId);
    return _valueInTeamKeys(d.team_id, keys) || _valueInTeamKeys(d.team, keys) ||
      _valueInTeamKeys(d.gardenId, keys) || _valueInTeamKeys(d.garden_id, keys) ||
      _valueInTeamKeys(d.gardenCode, keys) || _valueInTeamKeys(d.garden_code, keys);
  }

  function _ensureDeliveriesLoaded() {
    try {
      var saved = localStorage.getItem('rubberDeliveries');
      if (saved) {
        deliveries = JSON.parse(saved).map(_normalizeDeliveryRecord);
      }
    } catch (e) { /* ignore */ }
  }

  function _deliveriesForAllocation(teamId, dateStr, sessionFilter) {
    dateStr = _normalizeDateStr(dateStr);
    if (!teamId || !dateStr) return [];
    _ensureDeliveriesLoaded();
    var matched = deliveries.filter(function (d) {
      if (!_deliveryMatchesTeam(d, teamId)) return false;
      if (_deliveryTappingDateStr(d) !== dateStr) return false;
      if (sessionFilter && sessionFilter !== '__all__') {
        var sess = String(d.tappingSession || d.tapping_session || '').trim();
        if (sess && sess !== sessionFilter) return false;
      }
      return true;
    });
    if (!matched.length) {
      var onDate = deliveries.filter(function (d) {
        if (_deliveryTappingDateStr(d) !== dateStr) return false;
        if (sessionFilter && sessionFilter !== '__all__') {
          var s2 = String(d.tappingSession || d.tapping_session || '').trim();
          if (s2 && s2 !== sessionFilter) return false;
        }
        return true;
      });
      if (onDate.length === 1) matched = onDate;
    }
    return matched;
  }

  function _isoDateLocal(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function _todayStr() {
    if (typeof Permissions !== 'undefined' && Permissions.todayDateStr) return Permissions.todayDateStr();
    return _isoDateLocal(new Date());
  }

  function _canWriteDeliveryDateStr(dateStr) {
    dateStr = String(dateStr || '').slice(0, 10) || _todayStr();
    if (dateStr === _todayStr()) return true;
    if (typeof Permissions !== 'undefined' && typeof Permissions.canWriteSanxuatDate === 'function') {
      return Permissions.canWriteSanxuatDate(dateStr);
    }
    return false;
  }

  function _canWriteDeliveryRecord(d) {
    if (!d) return _canWriteDeliveryDateStr(_todayStr());
    return _canWriteDeliveryDateStr(_deliveryRecordDate(d));
  }

  function _assertDeliveryWrite(recordOrDate, actionLabel) {
    var dateStr = typeof recordOrDate === 'string'
      ? String(recordOrDate).slice(0, 10)
      : (recordOrDate ? _deliveryRecordDate(recordOrDate) : _todayStr());
    if (_canWriteDeliveryDateStr(dateStr)) return true;
    var msg = typeof Permissions !== 'undefined' && Permissions.sanxuatDateWriteMessage
      ? Permissions.sanxuatDateWriteMessage(dateStr)
      : ('Không được ' + (actionLabel || 'sửa') + ' phiếu ngày trước — liên hệ admin.');
    _showToast(msg, 'error');
    return false;
  }

  function _userDisplayName(user) {
    if (!user) return null;
    return user.display_name || user.ho_ten || user.fullName || user.username || user.id || null;
  }

  function _applyDeliveryModalReadOnly(readonly, viewOnly) {
    var modal = _el('deliveryModal');
    if (!modal) return;
    modal.classList.toggle('delivery-readonly', !!readonly);
    var saveBtn = modal.querySelector('.delivery-save-btn');
    if (saveBtn) saveBtn.style.display = readonly ? 'none' : '';
    var banner = _el('deliveryReadonlyBanner');
    if (banner) {
      banner.style.display = readonly ? 'block' : 'none';
      if (readonly && viewOnly) {
        banner.textContent = typeof Permissions !== 'undefined' && Permissions.sanxuatDateWriteMessage
          ? Permissions.sanxuatDateWriteMessage(_deliveryRecordDate(viewOnly))
          : 'Phiếu ngày trước — chỉ xem, không được sửa.';
      }
    }
    modal.querySelectorAll('input, select, textarea, button.delivery-form-action').forEach(function (el) {
      if (el.classList.contains('delivery-modal-close')) return;
      if (el.classList.contains('delivery-save-btn')) return;
      el.disabled = !!readonly;
    });
  }

  function _lockDeliveryDatesForNonAdmin(isNew) {
    var admin = typeof Permissions !== 'undefined' && Permissions.isSanxuatAdmin && Permissions.isSanxuatAdmin();
    var dateEl = _el('deliveryTappingDate');
    var dtEl = _el('deliveryDateTime');
    if (dateEl) {
      dateEl.disabled = !admin;
      if (isNew && !admin) dateEl.value = _todayStr();
    }
    if (dtEl) {
      dtEl.disabled = !admin;
      if (isNew && !admin) dtEl.value = _todayStr();
    }
  }

  function _loadAllocationStore() {
    try { return JSON.parse(localStorage.getItem(ALLOC_KEY) || '{}'); } catch (e) { return {}; }
  }

  function _saveAllocationStore(store) {
    try { localStorage.setItem(ALLOC_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
  }

  async function _ensureTscConverter() {
    if (typeof TscDrcConverter !== 'undefined') await TscDrcConverter.load();
  }

  async function loadTeams() {
    try {
      var snap = await _db().collection('categoryTeams').get();
      companyTeams = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      companyTeams.sort(function (a, b) {
        return String(a.name || a.id).localeCompare(String(b.name || b.id), undefined, { numeric: true });
      });
    } catch (e) {
      console.warn('loadTeams delivery:', e.message);
      companyTeams = [];
    }
  }

  function _populateStationDropdowns(selectedId) {
    var teams = _productionTeams();
    var defId = selectedId || _resolveDefaultTeamId(teams);
    var html = '<option value="">-- Chọn trạm --</option>' +
      teams.map(function (t) {
        return '<option value="' + t.id + '">' + (t.name || t.id) + '</option>';
      }).join('');
    var teamSel = _el('deliveryTeam');
    var gardenSel = _el('deliveryGardenId');
    if (teamSel) {
      teamSel.innerHTML = html;
      if (defId && teamSel.querySelector('option[value="' + defId + '"]')) teamSel.value = defId;
    }
    if (gardenSel) {
      gardenSel.innerHTML = html.replace('-- Chọn trạm --', '-- Chọn trạm (EUDR) --');
      if (defId && gardenSel.querySelector('option[value="' + defId + '"]')) gardenSel.value = defId;
    }
    return defId;
  }

  async function _loadHarvestSections() {
    try {
      var snap = await _db().collection('tappingSections').get();
      harvestSections = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    } catch (e) {
      console.warn('load tappingSections:', e.message);
      harvestSections = [];
    }
  }

  async function _fetchHarvestContext(teamId, dateStr) {
    harvestAssignments = [];
    harvestWeighings = [];
    if (!teamId || !dateStr) return;
    await _loadHarvestSections();
    try {
      var asnSnap = await _db().collection('sectionWorkerAssignments').where('record_date', '==', dateStr).get();
      harvestAssignments = _dedupeAssignments(asnSnap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      }));
    } catch (e) {
      console.warn('load assignments delivery:', e.message);
      harvestAssignments = [];
    }
    try {
      var wSnap = await _db().collection('fieldWorkerWeighings').where('record_date', '==', dateStr).get();
      harvestWeighings = wSnap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    } catch (e) {
      console.warn('load weighings delivery:', e.message);
      harvestWeighings = [];
    }
  }

  function _refreshDeliverySessions() {
    var sel = _el('deliveryTappingSession');
    if (!sel) return;
    var teamId = (_el('deliveryTeam') || {}).value;
    var dateStr = (_el('deliveryTappingDate') || {}).value;
    var cur = sel.value;

    if (!dateStr) {
      sel.innerHTML = '<option value="">-- Chọn ngày cạo trước --</option>';
      return;
    }
    if (!teamId) {
      sel.innerHTML = '<option value="">-- Chọn trạm trước --</option>';
      return;
    }

    var sessions = _sessionsForTeamDate(teamId, dateStr);
    var html = '<option value="">-- Chọn phiên (tùy chọn) --</option>';
    sessions.forEach(function (s) {
      html += '<option value="' + s + '">' + (SESSION_LABELS[s] || ('Phiên ' + s)) + '</option>';
    });
    sel.innerHTML = html;
    if (cur && sel.querySelector('option[value="' + cur + '"]')) sel.value = cur;
    else if (sessions.length === 1) sel.value = sessions[0];
  }

  function _collectDeliveryLots(teamId, sessionFilter) {
    var seen = {};
    var lots = [];
    function _push(code, name) {
      code = String(code || '').trim();
      if (!code || seen[code]) return;
      seen[code] = true;
      lots.push({ id: code, code: code, name: name || code, area: 0, eudrCompliant: true });
    }
    harvestAssignments.filter(function (a) {
      if (String(a.record_date || '') !== String((_el('deliveryTappingDate') || {}).value || '')) return false;
      if (!_assignmentMatchesTeam(a, teamId)) return false;
      if (sessionFilter && _assignmentSession(a) !== sessionFilter) return false;
      return true;
    }).forEach(function (a) {
      var meta = _assignmentMeta(a);
      _push(meta.lot_code, meta.lot_name);
      var sec = _findHarvestSection(a.tapping_section_id);
      if (sec) {
        var sm = _parseMeta(sec.metadata);
        _push(sec.lot_id || sec.lot_code || sm.lot_code, sec.lot_name || sm.ten_lo);
      }
    });
    return lots.sort(function (a, b) {
      return String(a.code).localeCompare(String(b.code), undefined, { numeric: true });
    });
  }

  function _refreshDeliveryPlots() {
    var teamId = (_el('deliveryTeam') || {}).value;
    var session = (_el('deliveryTappingSession') || {}).value;
    var container = _el('deliveryPlotsContainer');
    var summary = _el('deliveryPlotsSummary');
    if (!teamId) {
      if (container) container.innerHTML = '<div class="no-plots-message">Chọn trạm SX để hiển thị danh sách lô</div>';
      if (summary) summary.style.display = 'none';
      deliveryPlots = [];
      selectedPlotIds = [];
      _syncSelectAllPlotsCheckbox();
      return;
    }
    deliveryPlots = _collectDeliveryLots(teamId, session || null);
    if (!deliveryPlots.length) {
      if (container) container.innerHTML = '<div class="no-plots-message">Chưa có lô phân công cạo cho trạm/ngày này</div>';
      if (summary) summary.style.display = 'none';
      selectedPlotIds = [];
      _syncSelectAllPlotsCheckbox();
      return;
    }
    selectedPlotIds = selectedPlotIds.filter(function (id) {
      return deliveryPlots.some(function (p) { return p.id === id; });
    });
    renderDeliveryPlots();
  }

  async function _computeWorkerMaterialTotals(teamId, dateStr) {
    var out = { latexDry: 0, coagDry: 0, totalDry: 0, latexFresh: 0, coagFresh: 0 };
    if (!teamId || !dateStr) return out;
    await _loadHarvestSections();
    try {
      var snap = await _db().collection('fieldWorkerWeighings').where('record_date', '==', dateStr).get();
      snap.docs.forEach(function (doc) {
        var w = doc.data();
        if (!_isTapperWeighRow(w)) return;
        var sec = _findHarvestSection(w.tapping_section_id);
        if (!sec || !_sectionMatchesTeamId(sec, teamId)) return;
        out.latexDry += parseFloat(w.latex_dry_kg) || 0;
        out.coagDry += parseFloat(w.coag_dry_kg) || 0;
        out.totalDry += parseFloat(w.total_dry_kg) || 0;
        out.latexFresh += parseFloat(w.latex_fresh_kg) || 0;
        out.coagFresh += parseFloat(w.coag_fresh_kg) || 0;
      });
    } catch (e) {
      console.warn('worker material totals:', e.message);
    }
    return out;
  }

  async function _computeWorkerDryKg(teamId, dateStr) {
    var t = await _computeWorkerMaterialTotals(teamId, dateStr);
    return t.totalDry;
  }

  function _normalizeWorkerTotals(workerOverride) {
    if (!workerOverride) return null;
    if (workerOverride.total_dry != null) {
      return {
        totalDry: parseFloat(workerOverride.total_dry) || 0,
        latexDry: parseFloat(workerOverride.latex_dry) || 0,
        coagDry: parseFloat(workerOverride.coag_dry) || 0,
        latexFresh: parseFloat(workerOverride.latex_fresh) || 0,
        coagFresh: parseFloat(workerOverride.coag_fresh) || 0
      };
    }
    return {
      totalDry: parseFloat(workerOverride.totalDry) || 0,
      latexDry: parseFloat(workerOverride.latexDry) || 0,
      coagDry: parseFloat(workerOverride.coagDry) || 0,
      latexFresh: parseFloat(workerOverride.latexFresh) || 0,
      coagFresh: parseFloat(workerOverride.coagFresh) || 0
    };
  }

  function _deliveryDryParts(d) {
    var ld = 0;
    var cd = 0;
    if (d.latexDryWeight != null && d.latexDryWeight !== '') {
      ld = parseFloat(d.latexDryWeight) || 0;
    } else if (d.latex_dry_weight != null && d.latex_dry_weight !== '') {
      ld = parseFloat(d.latex_dry_weight) || 0;
    } else {
      var lg = _deliveryLatexGross(d);
      var lDrc = parseFloat(d.latexDrcPercent || d.latex_drc_percent) || 0;
      if (lg > 0 && lDrc > 0) ld = lg * lDrc / 100;
    }
    if (d.coagDryWeight != null && d.coagDryWeight !== '') {
      cd = parseFloat(d.coagDryWeight) || 0;
    } else if (d.coag_dry_weight != null && d.coag_dry_weight !== '') {
      cd = parseFloat(d.coag_dry_weight) || 0;
    } else {
      var cg = _deliveryCoagGross(d);
      var cDrc = parseFloat(d.coagDrcPercent || d.coag_drc_percent) || 0;
      if (cg > 0 && cDrc > 0) cd = cg * cDrc / 100;
    }
    var totalDry = parseFloat(d.dryWeight || d.dry_weight) || 0;
    if (totalDry > 0) {
      if (ld + cd <= 0) {
        var lg2 = _deliveryLatexGross(d);
        var cg2 = _deliveryCoagGross(d);
        var gross = lg2 + cg2;
        if (gross > 0) {
          ld = totalDry * lg2 / gross;
          cd = totalDry * cg2 / gross;
        } else {
          ld = totalDry;
        }
      } else if (Math.abs(ld + cd - totalDry) > 0.05) {
        var sum = ld + cd;
        ld = ld / sum * totalDry;
        cd = cd / sum * totalDry;
      }
    }
    return { ld: ld, cd: cd };
  }

  /** Tính tỉ lệ phân bổ khô từ phiếu GN + tổng khô vườn (đồng bộ, dùng khi render). */
  function _factoryDryFromDeliveries(teamDeliveries) {
    var fLd = 0;
    var fCd = 0;
    (teamDeliveries || []).forEach(function (d) {
      var parts = _deliveryDryParts(d);
      fLd += parts.ld;
      fCd += parts.cd;
    });
    return { latex: fLd, coag: fCd, total: fLd + fCd };
  }

  function _factoryGrossFromDeliveries(teamDeliveries) {
    var fLg = 0;
    var fCg = 0;
    (teamDeliveries || []).forEach(function (d) {
      fLg += _deliveryLatexGross(d);
      fCg += _deliveryCoagGross(d);
    });
    return { latex: fLg, coag: fCg, total: fLg + fCg };
  }

  function _factoryTotalsFromDeliveries(teamDeliveries) {
    var dry = _factoryDryFromDeliveries(teamDeliveries);
    var gross = _factoryGrossFromDeliveries(teamDeliveries);
    return {
      latexFresh: gross.latex,
      coagFresh: gross.coag,
      totalFresh: gross.total,
      latexDry: dry.latex,
      coagDry: dry.coag,
      totalDry: dry.total
    };
  }

  function _buildAllocationEntry(teamId, dateStr, workerOverride, sessionFilter) {
    dateStr = _normalizeDateStr(dateStr);
    if (!teamId || !dateStr) return null;
    _ensureDeliveriesLoaded();
    var teamDeliveries = _deliveriesForAllocation(teamId, dateStr, sessionFilter);
    var factory = _factoryTotalsFromDeliveries(teamDeliveries);
    var factoryLatexDry = factory.latexDry;
    var factoryCoagDry = factory.coagDry;
    var factoryDry = factory.totalDry;
    var factoryLatexFresh = factory.latexFresh;
    var factoryCoagFresh = factory.coagFresh;
    var worker = _normalizeWorkerTotals(workerOverride) || {
      totalDry: 0, latexDry: 0, coagDry: 0, latexFresh: 0, coagFresh: 0
    };
    var hasReceipt = teamDeliveries.length > 0;
    var latexDryRatio = hasReceipt && worker.latexDry > 0 ? factoryLatexDry / worker.latexDry : 0;
    var coagDryRatio = hasReceipt && worker.coagDry > 0 ? factoryCoagDry / worker.coagDry : 0;
    var latexFreshRatio = hasReceipt && worker.latexFresh > 0 ? factoryLatexFresh / worker.latexFresh : 0;
    var coagFreshRatio = hasReceipt && worker.coagFresh > 0 ? factoryCoagFresh / worker.coagFresh : 0;
    var ratio = hasReceipt && worker.totalDry > 0 ? factoryDry / worker.totalDry : 0;
    return {
      factoryDryKg: parseFloat(factoryDry.toFixed(3)),
      factoryLatexDryKg: parseFloat(factoryLatexDry.toFixed(3)),
      factoryCoagDryKg: parseFloat(factoryCoagDry.toFixed(3)),
      factoryLatexFreshKg: parseFloat(factoryLatexFresh.toFixed(3)),
      factoryCoagFreshKg: parseFloat(factoryCoagFresh.toFixed(3)),
      factoryTotalFreshKg: parseFloat(factory.totalFresh.toFixed(3)),
      workerDryKg: parseFloat(worker.totalDry.toFixed(3)),
      workerLatexDryKg: parseFloat(worker.latexDry.toFixed(3)),
      workerCoagDryKg: parseFloat(worker.coagDry.toFixed(3)),
      workerLatexFreshKg: parseFloat(worker.latexFresh.toFixed(3)),
      workerCoagFreshKg: parseFloat(worker.coagFresh.toFixed(3)),
      ratio: parseFloat(ratio.toFixed(6)),
      latexDryRatio: parseFloat(latexDryRatio.toFixed(6)),
      coagDryRatio: parseFloat(coagDryRatio.toFixed(6)),
      latexFreshRatio: parseFloat(latexFreshRatio.toFixed(6)),
      coagFreshRatio: parseFloat(coagFreshRatio.toFixed(6)),
      receiptCount: teamDeliveries.length,
      updatedAt: new Date().toISOString()
    };
  }

  async function _updateHarvestAllocation(teamId, dateStr, workerOverride) {
    if (!teamId || !dateStr) return;
    dateStr = _normalizeDateStr(dateStr);
    if (!dateStr) return;
    try {
      if (!deliveries.length) await fetchDeliveriesForAllocation(dateStr);
    } catch (e) { /* ignore */ }
    var worker = _normalizeWorkerTotals(workerOverride);
    if (!worker || !(worker.totalDry > 0)) {
      worker = await _computeWorkerMaterialTotals(teamId, dateStr);
    }
    var entry = _buildAllocationEntry(teamId, dateStr, worker);
    if (!entry) return;
    var store = _loadAllocationStore();
    if (!store[teamId]) store[teamId] = {};
    store[teamId][dateStr] = entry;
    _saveAllocationStore(store);
  }

  // === Component Instances ===
  var dataTable = null;

  function _initTable() {
    if (dataTable || !document.getElementById('deliveryDataTable')) return;
    dataTable = DataTable.create('deliveryDataTable', {
      columns: [
        { key: 'deliveryNo', header: 'S\u1ED1 Phi\u1EBFu', sortable: true, searchable: true, bold: true },
        { key: 'tappingDate', header: 'Ng\u00E0y c\u1EA1o', type: 'date', sortable: true,
          format: function(v, row) { return _formatDate(_deliveryDisplayDate(row)); }
        },
        { key: 'gardenCode', header: '\u0110\u1ED9i SX', sortable: true, searchable: true },
        { key: 'tappingSession', header: 'Phi\u00EAn', type: 'html', format: function(v) {
          return v ? '<span class="session-badge ' + v + '">' + v + '</span>' : '-';
        }},
        { key: 'plotNames', header: 'L\u00F4 Thu Ho\u1EA1ch', type: 'html', truncate: true, format: function(v) {
          if (!v || !v.length) return '-';
          if (v.length > 2) return '<span title="' + v.join(', ') + '">' + v.slice(0,2).join(', ') + '... (+' + (v.length - 2) + ')</span>';
          return v.join(', ');
        }},
        { key: 'materialType', header: 'Lo\u1EA1i M\u1EE7', type: 'badge', badgeMap: {
          'latex': { label: 'M\u1EE7 n\u01B0\u1EDBc', cls: 'info' },
          'coagulum': { label: 'M\u1EE7 \u0111\u00F4ng', cls: 'warning' },
          'mixed': { label: 'N\u01B0\u1EDBc + \u0111\u00F4ng', cls: 'info' }
        }},
        { key: 'grossWeight', header: 'TL Th\u00F4', type: 'number', sortable: true,
          format: function(v, row) {
            var lg = _deliveryLatexGross(row);
            var cg = _deliveryCoagGross(row);
            if (row.materialType === 'mixed' || (lg > 0 && cg > 0)) {
              return _formatNumber(lg) + ' / ' + _formatNumber(cg);
            }
            return _formatNumber(v);
          }
        },
        { key: 'drcPercent', header: 'DRC', type: 'html', sortable: true, bold: true,
          format: function(v, row) {
            if (row.materialType === 'mixed' || (row.latexDrcPercent != null && row.coagDrcPercent != null)) {
              var ld = row.latexDrcPercent != null ? row.latexDrcPercent + '%' : '—';
              var cd = row.coagDrcPercent != null ? row.coagDrcPercent + '%' : '—';
              return '<span title="N\u01B0\u1EDBc / \u0110\u00F4ng">' + ld + ' / ' + cd + '</span>';
            }
            return (v || 0) + '%';
          }
        },
        { key: 'dryWeight', header: 'TL Kh\u00F4', type: 'number', sortable: true, bold: true,
          format: function(v, row) { return _formatNumber(_deliveryTotalDry(row)) + ' kg'; }
        },
        { key: 'status', header: 'Tr\u1EA1ng Th\u00E1i', type: 'badge', badgeMap: {
          'pending': { label: 'Ch\u1EDD nghi\u1EC7m thu', cls: 'pending' },
          'in_transit': { label: '\u0110ang v\u1EADn chuy\u1EC3n', cls: 'processing' },
          'received': { label: '\u0110\u00E3 ti\u1EBFp nh\u1EADn', cls: 'compliant' }
        }},
        { key: '_actions', header: 'Thao T\u00E1c', type: 'actions', actions: [
          { icon: '\u270F\uFE0F', cls: 'edit', title: 'S\u1EEDa',
            visible: function(row) { return _canWriteDeliveryRecord(row); },
            onClick: function(row) { editDelivery(row.id); } },
          { icon: '\uD83D\uDC41\uFE0F', cls: 'view', title: 'Xem',
            visible: function(row) { return !_canWriteDeliveryRecord(row); },
            onClick: function(row) { editDelivery(row.id); } },
          { icon: '\uD83D\uDDD1\uFE0F', cls: 'delete', title: 'X\u00F3a',
            visible: function(row) { return _canWriteDeliveryRecord(row); },
            onClick: function(row) { deleteDelivery(row.id); } }
        ]}
      ],
      filters: [
        { key: 'materialType', label: 'Lo\u1EA1i m\u1EE7', options: [
          { value: '', label: 'T\u1EA5t c\u1EA3 lo\u1EA1i m\u1EE7' },
          { value: 'latex', label: 'M\u1EE7 n\u01B0\u1EDBc' },
          { value: 'coagulum', label: 'M\u1EE7 \u0111\u00F4ng' }
        ]},
        { key: 'status', label: 'Tr\u1EA1ng th\u00E1i', options: [
          { value: '', label: 'T\u1EA5t c\u1EA3 tr\u1EA1ng th\u00E1i' },
          { value: 'pending', label: 'Ch\u1EDD nghi\u1EC7m thu' },
          { value: 'in_transit', label: '\u0110ang v\u1EADn chuy\u1EC3n' },
          { value: 'received', label: '\u0110\u00E3 ti\u1EBFp nh\u1EADn' }
        ]}
      ],
      searchPlaceholder: 'T\u00ECm theo s\u1ED1 phi\u1EBFu, \u0111\u1ED9i, bi\u1EC3n s\u1ED1 xe...',
      showExport: true,
      exportFileName: 'PhieuGiaoNhan',
      exportSheetName: 'Giao nh\u1EADn',
      toolbar: {
        onCreate: function() { openDeliveryModal(); },
        createLabel: '+ T\u1EA1o Phi\u1EBFu Giao Nh\u1EADn'
      },
      emptyText: 'Ch\u01B0a c\u00F3 phi\u1EBFu giao nh\u1EADn n\u00E0o',
      emptyIcon: '\uD83D\uDCCB',
      pageSize: 25
    });
  }

  // ==================== CONSTANTS ====================

  // TCCS 111 Điều 12 - Tiêu chí mủ đông
  var COAG_QUALITY_111 = {
    block: { l1:'Trắng/vàng, không lẫn tạp chất nhìn thấy (cây, đất, sợi bao)', l2:'Màu xâm, có lẫn ít tạp chất' },
    cup: { l1:'Trắng vàng/nâu đen theo giống cây, không lẫn tạp chất', l2:'Có lẫn ít tạp chất' },
    scrap: { l1:'Vàng/nâu đen, không lẫn tạp chất nhìn thấy', l2:'Có lẫn ít tạp chất' },
    misc: { l1:'Vàng/nâu đen, không lẫn tạp chất nhìn thấy', l2:'Có lẫn tạp chất' },
    earth: { l1:'Mủ rơi trên mặt đất - xử lý ngoại lệ', l2:'Xử lý ngoại lệ' }
  };

  // ==================== CORE FUNCTIONS ====================

  function _setDeliveriesCache(nextList) {
    deliveries = (nextList || []).map(_normalizeDeliveryRecord);
    try {
      localStorage.setItem('rubberDeliveries', JSON.stringify(deliveries));
    } catch (e) { /* ignore */ }
  }

  function _upsertDeliveryInCache(record, docId) {
    if (!record) return null;
    var merged = Object.assign({}, record);
    if (docId) merged.id = docId;
    if (!merged.id) return null;
    var normalized = _normalizeDeliveryRecord(merged);
    var idx = deliveries.findIndex(function (d) { return d.id === normalized.id; });
    if (idx >= 0) {
      deliveries[idx] = Object.assign({}, deliveries[idx], normalized);
    } else {
      deliveries.unshift(normalized);
    }
    try {
      localStorage.setItem('rubberDeliveries', JSON.stringify(deliveries));
    } catch (e) { /* ignore */ }
    return normalized;
  }

  function _replaceDeliveriesForTappingDate(tappingDate, fetched) {
    tappingDate = _normalizeDateStr(tappingDate);
    var kept = deliveries.filter(function (d) {
      return _deliveryTappingDateStr(d) !== tappingDate;
    });
    fetched.forEach(function (d) {
      if (d && d.id) kept.push(_normalizeDeliveryRecord(d));
    });
    _setDeliveriesCache(kept);
  }

  async function _fetchDeliveriesFromRemote(opts) {
    opts = opts || {};
    try {
      var coll = _db().collection('rubberDeliveries');
      var snapshot;
      if (opts.tappingDate) {
        var tapDate = _normalizeDateStr(opts.tappingDate);
        snapshot = await coll.where('tappingDate', '==', tapDate).get();
        _replaceDeliveriesForTappingDate(tapDate, snapshot.docs.map(function (doc) {
          return Object.assign({ id: doc.id }, doc.data());
        }));
      } else {
        snapshot = await coll.orderBy('createdAt', 'desc').limit(100).get();
        _setDeliveriesCache(snapshot.docs.map(function (doc) {
          return Object.assign({ id: doc.id }, doc.data());
        }));
      }
    } catch (error) {
      console.warn('Supabase deliveries error:', error.message);
      throw error;
    }
  }

  /** Chỉ tải phiếu GN — không render tab Giao nhận. opts.force bỏ qua cache. */
  async function fetchDeliveriesForAllocation(dateStr, opts) {
    opts = opts || {};
    _ensureDeliveriesLoaded();
    dateStr = dateStr ? _normalizeDateStr(dateStr) : '';
    if (dateStr && !opts.force) {
      var hasCached = deliveries.some(function (d) {
        return _deliveryTappingDateStr(d) === dateStr;
      });
      if (hasCached) return;
    }
    if (dateStr) {
      await _fetchDeliveriesFromRemote({ tappingDate: dateStr });
    } else {
      await _fetchDeliveriesFromRemote();
    }
  }

  async function _refreshDeliveryUi() {
    renderDeliveries();
    updateDeliveryStats();
    updateDeliveryTimeline();
  }

  async function loadDeliveries() {
    _ensureDeliveriesLoaded();
    await Promise.all([
      loadTeams().then(function () { _populateStationDropdowns(); }).catch(function () {}),
      _fetchDeliveriesFromRemote()
    ]);
    await _refreshDeliveryUi();
  }

  function initDeliveries() {
    _ensureDeliveriesLoaded();
    loadTeams().then(function () { _populateStationDropdowns(); }).catch(function () {});
    _fetchDeliveriesFromRemote().then(function () {
      _refreshDeliveryUi();
    }).catch(function () {});
  }

  function renderDeliveries(data) {
    _initTable();
    data = data || deliveries;
    if (dataTable) {
      dataTable.setData(data);
      return;
    }
    // Fallback: manual table rendering
    var tbody = document.getElementById('deliveriesTableBody');
    if (!tbody) return;
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#64748b;">Ch\u01B0a c\u00F3 phi\u1EBFu giao nh\u1EADn n\u00E0o</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(function(d) {
      var statusBadge = getDeliveryStatusBadge(d.status);
      var sessionBadge = d.tappingSession ? '<span class="session-badge ' + d.tappingSession + '">' + d.tappingSession + '</span>' : '-';
      var plotsDisplay = d.plotNames && d.plotNames.length > 0
        ? (d.plotNames.length > 2
          ? '<span title="' + d.plotNames.join(', ') + '">' + d.plotNames.slice(0,2).join(', ') + '... (+' + (d.plotNames.length - 2) + ')</span>'
          : d.plotNames.join(', '))
        : '-';
      return '<tr>' +
        '<td><strong>' + (d.deliveryNo || '') + '</strong></td>' +
        '<td>' + _formatDate(_deliveryDisplayDate(d)) + '</td>' +
        '<td>' + (d.gardenCode || '') + '</td>' +
        '<td>' + sessionBadge + '</td>' +
        '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (d.plotNames ? d.plotNames.join(', ') : '') + '">' + plotsDisplay + '</td>' +
        '<td>' + getMaterialTypeText(d.materialType) + '</td>' +
        '<td>' + _formatNumber(_deliveryLatexGross(d) + _deliveryCoagGross(d)) + '</td>' +
        '<td><strong>' + (d.latexDrcPercent != null || d.coagDrcPercent != null ?
          ((d.latexDrcPercent || '—') + ' / ' + (d.coagDrcPercent || '—')) : ((d.drcPercent || 0) + '%')) + '</strong></td>' +
        '<td><strong>' + _formatNumber(_deliveryTotalDry(d)) + ' kg</strong></td>' +
        '<td>' + statusBadge + '</td>' +
        '<td><div class="action-btns">' +
        (_canWriteDeliveryRecord(d)
          ? '<button class="action-btn edit" onclick="TabDelivery.editDelivery(\'' + d.id + '\')" title="S\u1EEDa">\u270F\uFE0F</button>' +
            '<button class="action-btn delete" onclick="TabDelivery.deleteDelivery(\'' + d.id + '\')" title="X\u00F3a">\uD83D\uDDD1\uFE0F</button>'
          : '<button class="action-btn view" onclick="TabDelivery.editDelivery(\'' + d.id + '\')" title="Xem">\uD83D\uDC41\uFE0F</button>') +
        '</div></td></tr>';
    }).join('');
  }

  function getMaterialTypeText(type) {
    return { 'latex': 'Mủ nước', 'coagulum': 'Mủ đông', 'mixed': 'Nước + đông' }[type] || type || 'Nước + đông';
  }

  function _deliveryLatexGross(d) {
    if (!d) return 0;
    if (d.latexGrossWeight != null && d.latexGrossWeight !== '') return parseFloat(d.latexGrossWeight) || 0;
    if (d.materialType === 'latex') return parseFloat(d.grossWeight) || 0;
    if (d.materialType === 'mixed' || d.coagGrossWeight != null) {
      var gross = parseFloat(d.grossWeight) || 0;
      var coag = _deliveryCoagGrossRaw(d);
      if (gross > 0 && coag >= 0 && gross >= coag) return parseFloat((gross - coag).toFixed(3));
    }
    return 0;
  }

  function _deliveryCoagGrossRaw(d) {
    if (!d) return 0;
    if (d.coagGrossWeight != null && d.coagGrossWeight !== '') return parseFloat(d.coagGrossWeight) || 0;
    if (d.materialType === 'coagulum') return parseFloat(d.grossWeight) || 0;
    return 0;
  }

  function _deliveryCoagGross(d) {
    return _deliveryCoagGrossRaw(d);
  }

  function _deliveryTotalDry(d) {
    if (!d) return 0;
    if (d.latexDryWeight != null || d.coagDryWeight != null) {
      return (parseFloat(d.latexDryWeight) || 0) + (parseFloat(d.coagDryWeight) || 0);
    }
    return parseFloat(d.dryWeight) || 0;
  }

  function _deliveryLatexDry(d) {
    if (!d) return 0;
    if (d.latexDryWeight != null && d.latexDryWeight !== '') return parseFloat(d.latexDryWeight) || 0;
    var gross = _deliveryLatexGross(d);
    var drc = d.latexDrcPercent != null ? parseFloat(d.latexDrcPercent) :
      (d.materialType === 'latex' ? parseFloat(d.drcPercent) : 0);
    if (gross > 0 && drc > 0) return gross * drc / 100;
    if (d.materialType === 'latex') return parseFloat(d.dryWeight) || 0;
    return 0;
  }

  function _deliveryCoagDry(d) {
    if (!d) return 0;
    if (d.coagDryWeight != null && d.coagDryWeight !== '') return parseFloat(d.coagDryWeight) || 0;
    var gross = _deliveryCoagGross(d);
    var drc = d.coagDrcPercent != null ? parseFloat(d.coagDrcPercent) :
      (d.materialType === 'coagulum' ? parseFloat(d.drcPercent) : _defaultCoagDrc());
    if (gross > 0 && drc > 0) return gross * drc / 100;
    if (d.materialType === 'coagulum') return parseFloat(d.dryWeight) || 0;
    return 0;
  }

  function _defaultCoagDrc() { return 40; }

  function _readCoagLine(typeDef) {
    var grossEl = _el(typeDef.grossId);
    var drcEl = _el(typeDef.drcId);
    var gross = parseFloat(grossEl && grossEl.value) || 0;
    var drc = drcEl && drcEl.value !== '' ? (parseFloat(drcEl.value) || _defaultCoagDrc()) : _defaultCoagDrc();
    return {
      type: typeDef.key,
      grossKg: gross,
      drcPercent: drc,
      dryKg: gross * drc / 100
    };
  }

  function _readCoagLinesFromForm() {
    return COAG_TYPES.map(_readCoagLine);
  }

  function _coagTotalsFromLines(lines) {
    var gross = 0;
    var dry = 0;
    (lines || []).forEach(function (ln) {
      gross += ln.grossKg || 0;
      dry += ln.dryKg || 0;
    });
    return {
      grossKg: gross,
      dryKg: dry,
      drcPercent: gross > 0 ? dry / gross * 100 : 0
    };
  }

  function _emptyCoagByType() {
    var out = {};
    COAG_TYPES.forEach(function (ct) {
      out[ct.key] = { grossKg: 0, drcPercent: _defaultCoagDrc(), dryKg: 0 };
    });
    return out;
  }

  function _coagByTypeFromRecord(d) {
    if (!d) return null;
    if (d.coagByType && typeof d.coagByType === 'object') return d.coagByType;
    var gross = _deliveryCoagGross(d);
    if (gross <= 0) return null;
    var drc = d.coagDrcPercent != null ? d.coagDrcPercent :
      (d.materialType === 'coagulum' ? (d.drcPercent || _defaultCoagDrc()) : _defaultCoagDrc());
    var type = d.coagType || 'block';
    var out = _emptyCoagByType();
    var line = { grossKg: gross, drcPercent: drc, dryKg: gross * drc / 100 };
    if (out[type] !== undefined) out[type] = line;
    else out.block = line;
    return out;
  }

  function _resetCoagFormFields() {
    COAG_TYPES.forEach(function (ct) {
      var g = _el(ct.grossId);
      var d = _el(ct.drcId);
      if (g) g.value = '';
      if (d) d.value = String(_defaultCoagDrc());
    });
  }

  function _populateCoagFieldsFromRecord(d) {
    _resetCoagFormFields();
    var byType = _coagByTypeFromRecord(d);
    if (!byType) return;
    COAG_TYPES.forEach(function (ct) {
      var ln = byType[ct.key];
      if (!ln) return;
      var g = _el(ct.grossId);
      var dr = _el(ct.drcId);
      if (g && parseFloat(ln.grossKg) > 0) g.value = ln.grossKg;
      if (dr && ln.drcPercent != null && ln.drcPercent !== '') dr.value = ln.drcPercent;
    });
  }

  function _buildCoagByTypeForSave(lines) {
    var out = _emptyCoagByType();
    (lines || []).forEach(function (ln) {
      out[ln.type] = {
        grossKg: ln.grossKg > 0 ? parseFloat(ln.grossKg.toFixed(2)) : 0,
        drcPercent: ln.drcPercent,
        dryKg: ln.grossKg > 0 ? parseFloat(ln.dryKg.toFixed(2)) : 0
      };
    });
    return out;
  }

  /** Thống kê dashboard: luôn tách theo coagByType, chuẩn hóa nếu tổng lệch coagGrossWeight. */
  function _coagStatsByType(d) {
    var byType = _coagByTypeFromRecord(d);
    if (!byType) return _emptyCoagByType();
    var declared = _deliveryCoagGross(d);
    var sum = 0;
    COAG_TYPES.forEach(function (ct) {
      sum += parseFloat(byType[ct.key].grossKg) || 0;
    });
    if (declared > 0 && sum > 0 && Math.abs(sum - declared) > 0.05) {
      var scale = declared / sum;
      COAG_TYPES.forEach(function (ct) {
        var ln = byType[ct.key];
        var g = (parseFloat(ln.grossKg) || 0) * scale;
        ln.grossKg = parseFloat(g.toFixed(2));
        ln.dryKg = parseFloat((g * (parseFloat(ln.drcPercent) || _defaultCoagDrc()) / 100).toFixed(2));
      });
    }
    return byType;
  }

  function _latexGradeKey(d) {
    if (d.concentrateGrade) return d.concentrateGrade;
    if (d.latexPurpose === 'concentrate' && d.grade) return d.grade;
    return d.grade || 'grade1';
  }

  function getDeliveryStatusBadge(status) {
    var map = {
      'pending': '<span class="status-badge pending">Chờ nghiệm thu</span>',
      'in_transit': '<span class="status-badge processing">Đang vận chuyển</span>',
      'received': '<span class="status-badge compliant">Đã tiếp nhận</span>'
    };
    return map[status] || map['pending'];
  }

  function updateDeliveryStats() {
    var today = new Date().toISOString().slice(0, 10);
    var todayDlvs = deliveries.filter(function(d) {
      var date = d.createdAt?.toDate ? d.createdAt.toDate() : new Date(d.createdAt);
      return date.toISOString().slice(0, 10) === today;
    });
    var latexDlvs = todayDlvs.filter(function(d) { return _deliveryLatexGross(d) > 0; });
    var coagDlvs = todayDlvs.filter(function(d) { return _deliveryCoagGross(d) > 0; });

    var el = function(id) { return document.getElementById(id); };
    if (el('todayDeliveries')) el('todayDeliveries').textContent = todayDlvs.length;
    if (el('totalLatexDelivered')) el('totalLatexDelivered').textContent = _formatNumber(todayDlvs.reduce(function(s,d) { return s + _deliveryLatexGross(d); }, 0));
    if (el('totalCoagDelivered')) el('totalCoagDelivered').textContent = _formatNumber(todayDlvs.reduce(function(s,d) { return s + _deliveryCoagGross(d); }, 0));
    if (el('totalDryDelivered')) el('totalDryDelivered').textContent = _formatNumber(todayDlvs.reduce(function(s,d) { return s + _deliveryTotalDry(d); }, 0));

    var avgLDRC = latexDlvs.length ? (latexDlvs.reduce(function(s,d) {
      var lf = _deliveryLatexGross(d);
      var ld = _deliveryLatexDry(d);
      return s + (lf > 0 ? ld / lf * 100 : (d.latexDrcPercent || d.drcPercent || 0));
    }, 0) / latexDlvs.length).toFixed(1) : '0';
    var avgCDRC = coagDlvs.length ? (coagDlvs.reduce(function(s,d) {
      var cf = _deliveryCoagGross(d);
      var cd = _deliveryCoagDry(d);
      return s + (cf > 0 ? cd / cf * 100 : (d.coagDrcPercent || d.drcPercent || 0));
    }, 0) / coagDlvs.length).toFixed(1) : '0';
    if (el('avgLatexDRC')) el('avgLatexDRC').textContent = avgLDRC + '%';
    if (el('avgCoagDRC')) el('avgCoagDRC').textContent = avgCDRC + '%';

    // Latex detail — chỉ KL mủ nước, không lấy grossWeight tổng phiếu
    var latexG1 = 0;
    var latexG2 = 0;
    latexDlvs.forEach(function (d) {
      var kg = _deliveryLatexGross(d);
      var gk = _latexGradeKey(d);
      if (gk === 'grade2') latexG2 += kg;
      else latexG1 += kg;
    });
    if (el('latexGrade1')) el('latexGrade1').textContent = _formatNumber(latexG1);
    if (el('latexGrade2')) el('latexGrade2').textContent = _formatNumber(latexG2);
    var phVals = latexDlvs.filter(function(d) { return d.phValue > 0; });
    if (el('latexAvgPH')) el('latexAvgPH').textContent = phVals.length ? (phVals.reduce(function(s,d) { return s + d.phValue; }, 0) / phVals.length).toFixed(1) : '-';
    var nh3Vals = latexDlvs.filter(function(d) { return d.nh3Percent > 0; });
    if (el('latexAvgNH3')) el('latexAvgNH3').textContent = nh3Vals.length ? (nh3Vals.reduce(function(s,d) { return s + d.nh3Percent; }, 0) / nh3Vals.length).toFixed(3) : '-';

    // Coagulum detail — 4 loại theo phiếu GN
    var counts = { block: 0, cup: 0, scrap: 0, misc: 0, earth: 0 };
    coagDlvs.forEach(function (d) {
      var byType = _coagStatsByType(d);
      COAG_TYPES.forEach(function (def) {
        var ln = byType[def.key];
        if (ln && counts[def.key] !== undefined) counts[def.key] += parseFloat(ln.grossKg) || 0;
      });
    });
    if (el('coagBlock')) el('coagBlock').textContent = _formatNumber(counts.block);
    if (el('coagCup')) el('coagCup').textContent = _formatNumber(counts.cup);
    if (el('coagScrap')) el('coagScrap').textContent = _formatNumber(counts.scrap);
    if (el('coagMisc')) el('coagMisc').textContent = _formatNumber(counts.misc + counts.earth);
  }

  function updateDeliveryTimeline() {
    document.querySelectorAll('.timeline-step').forEach(function(step) {
      step.classList.remove('active', 'completed');
    });
  }

  // ==================== MODAL & CRUD ====================

  function toggleMaterialFields(type) {
    var latexF = document.getElementById('latexFields');
    var coagF = document.getElementById('coagulumFields');
    if (latexF) latexF.style.display = 'block';
    if (coagF) coagF.style.display = 'block';
  }

  function calculateDeliveryDry() {
    var latexGross = parseFloat(document.getElementById('deliveryLatexGross')?.value) || 0;
    var latexDrc = parseFloat(document.getElementById('deliveryLatexDRC')?.value) || 0;
    var coagTotals = _coagTotalsFromLines(_readCoagLinesFromForm());

    var latexDry = latexGross * latexDrc / 100;
    var coagDry = coagTotals.dryKg;
    var totalDry = latexDry + coagDry;

    var latexDryEl = document.getElementById('deliveryLatexDryWeight');
    var coagDryEl = document.getElementById('deliveryCoagDryWeight');
    var dryEl = document.getElementById('deliveryDryWeight');
    if (latexDryEl) latexDryEl.textContent = _formatNumber(latexDry.toFixed(1));
    if (coagDryEl) coagDryEl.textContent = _formatNumber(coagDry.toFixed(1));
    if (dryEl) dryEl.textContent = _formatNumber(totalDry.toFixed(1)) + ' kg';
    var resultEl = document.getElementById('deliveryDryResult');
    if (resultEl) resultEl.style.display = totalDry > 0 ? 'block' : 'none';
  }

  async function onLatexTscChange() {
    await _ensureTscConverter();
    var tscEl = _el('deliveryLatexTSC');
    var drcEl = _el('deliveryLatexDRC');
    if (!tscEl || !drcEl) return;
    var tsc = parseFloat(tscEl.value);
    if (!tsc || tsc <= 0) {
      drcEl.value = '';
      calculateDeliveryDry();
      return;
    }
    var drc = typeof TscDrcConverter !== 'undefined' ? TscDrcConverter.tscToDrc('latex', tsc) : null;
    drcEl.value = drc != null ? String(parseFloat(drc.toFixed(2))) : '';
    calculateDeliveryDry();
  }

  function updateNH3Hints() {
    var season = document.getElementById('deliverySeasonType')?.value;
    var purpose = document.getElementById('deliveryLatexPurpose')?.value;
    var hint = document.getElementById('nh3ConcHint');
    if (hint) hint.textContent = season === 'rainy' ? 'Mùa mưa: NH₃ ~5% (m/m)' : 'Mùa khô: NH₃ ~3% (m/m)';
    var nh3Field = document.getElementById('deliveryLatexNH3');
    if (nh3Field) nh3Field.placeholder = purpose === 'concentrate' ? '≤ 0.3% (Latex cô đặc)' : '≤ 0.03% (SVR/RSS)';
    var concFields = document.getElementById('latexConcentrateFields');
    if (concFields) concFields.style.display = purpose === 'concentrate' ? 'block' : 'none';
    var phField = document.getElementById('deliveryLatexPH');
    if (phField) phField.placeholder = purpose === 'concentrate' ? '≥ 9.0 (Bảng 9.8)' : '6.5-8.0 (Bảng 9.6)';
  }

  function validateNH3Dosage(input) {
    var val = parseFloat(input.value);
    input.classList.toggle('param-warning', val > 10);
    input.classList.toggle('param-ok', val > 0 && val <= 10);
  }

  function updateCoagQualityHint() {
    var ct = document.getElementById('deliveryCoagType')?.value || 'block';
    var c = document.getElementById('coagQualityCriteria');
    if (!c) return;
    var q = COAG_QUALITY_111[ct];
    if (!q) { c.innerHTML = ''; return; }
    c.innerHTML = '<div style="padding:8px;border-radius:8px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);">' +
      '<div style="font-size:12px;font-weight:700;color:#16a34a;margin-bottom:4px;">Loại 1</div>' +
      '<div style="font-size:12px;">' + q.l1 + '</div></div>' +
      '<div style="padding:8px;border-radius:8px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);">' +
      '<div style="font-size:12px;font-weight:700;color:#d97706;margin-bottom:4px;">Loại 2</div>' +
      '<div style="font-size:12px;">' + q.l2 + '</div></div>';
  }

  function _formatDateTimeLocal(date) {
    if (!date) return '';
    var d = date.toDate ? date.toDate() : new Date(date);
    return d.toISOString().slice(0, 10);
  }

  function _el(id) { return document.getElementById(id); }

  function _populateMaterialFieldsFromRecord(d) {
    if (!d) return;
    _el('deliveryLatexGross').value = _deliveryLatexGross(d) || '';
    _populateCoagFieldsFromRecord(d);

    if (_el('deliveryLatexTSC')) _el('deliveryLatexTSC').value = d.tscPercent || '';
    if (!d.tscPercent) {
      _el('deliveryLatexDRC').value = d.latexDrcPercent != null ? d.latexDrcPercent :
        (d.materialType === 'latex' ? (d.drcPercent || '') : '');
    }
    _el('deliveryLatexNH3').value = d.nh3Percent || '';
    _el('deliveryLatexPH').value = d.phValue || '';
    _el('deliverySeasonType').value = d.seasonType || 'dry';
    _el('deliveryNH3Concentration').value = d.nh3Concentration || '';
    _el('deliveryNH3Dosage').value = d.nh3Dosage || '';
    _el('deliveryLatexPurpose').value = d.latexPurpose || 'svr_rss';
    if (d.latexPurpose === 'concentrate') {
      _el('deliveryVFA').value = d.vfa || '';
      _el('deliveryConcentrateGrade').value = d.concentrateGrade || '';
    }
    updateNH3Hints();
  }

  async function openDeliveryModal(id) {
    var modal = _el('deliveryModal');
    if (!modal) return;

    await loadTeams();
    await _ensureTscConverter();

    _el('deliveryModalTitle').textContent = id ? 'Chỉnh Sửa Phiếu Giao Nhận' : 'Tạo Phiếu Giao Nhận Mủ';
    _el('deliveryId').value = id || '';

    if (id) {
      var d = deliveries.find(function(x) { return x.id === id; });
      if (d) {
        var editTeam = d.team_id || d.team || d.gardenId || '';
        _populateStationDropdowns(editTeam);
        _el('deliveryNo').value = d.deliveryNo || '';
        _el('deliveryDateTime').value = _deliveryDocumentDateStr(d) || _todayStr();
        _el('deliveryTeam').value = editTeam;
        _el('deliveryGroup').value = d.group || '';
        _el('deliveryGardenId').value = editTeam;
        _el('deliveryMaterialType').value = 'mixed';
        _el('deliveryGrade').value = d.grade || 'grade1';
        _el('deliveryTappingTime').value = d.tappingTimeOnly || '';
        _el('deliveryCollectionTime').value = d.collectionTime || '';
        _el('deliveryVehicle').value = d.vehicleNo || '';
        _el('deliverySealStatus').value = d.sealStatus || 'sealed';
        _el('deliverySealCode').value = d.sealCode || d.sealNo || '';
        _el('deliveryStatus').value = d.status || 'pending';
        _el('deliveryPerson').value = d.deliveryPerson || '';
        _el('deliveryReceivePerson').value = d.receivePerson || d.deliveryReceivePerson || '';
        _el('deliveryNotes').value = d.notes || '';
        _el('deliveryTappingSession').value = d.tappingSession || '';
        var tapDate = _deliveryTappingDateStr(d) || _todayStr();
        _el('deliveryTappingDate').value = tapDate;

        selectedPlotIds = d.plotIds || [];
        await _fetchHarvestContext(editTeam, tapDate);
        _refreshDeliverySessions();
        if (d.tappingSession) _el('deliveryTappingSession').value = d.tappingSession;
        _refreshDeliveryPlots();
        toggleMaterialFields('mixed');
        _populateMaterialFieldsFromRecord(d);
        if (d.tscPercent && _el('deliveryLatexTSC')) await onLatexTscChange();
        calculateDeliveryDry();
        _applyDeliveryModalReadOnly(!_canWriteDeliveryRecord(d), d);
        if (_canWriteDeliveryRecord(d)) _lockDeliveryDatesForNonAdmin(false);
      }
    } else {
      var defTeam = _populateStationDropdowns();
      var today = _todayStr();
      _el('deliveryNo').value = _generateDeliveryNo(today);
      _el('deliveryDateTime').value = today;
      _el('deliveryTeam').value = defTeam || '';
      _el('deliveryGroup').value = '';
      _el('deliveryGardenId').value = defTeam || '';
      _el('deliveryMaterialType').value = 'mixed';
      _el('deliveryGrade').value = 'grade1';
      _el('deliveryTappingTime').value = '';
      _el('deliveryCollectionTime').value = '';
      _el('deliveryVehicle').value = '';
      _el('deliverySealStatus').value = 'sealed';
      _el('deliverySealCode').value = '';
      _el('deliveryStatus').value = 'pending';
      _el('deliveryPerson').value = '';
      _el('deliveryReceivePerson').value = '';
      _el('deliveryNotes').value = '';
      _el('deliveryLatexGross').value = '';
      if (_el('deliveryLatexTSC')) _el('deliveryLatexTSC').value = '';
      _el('deliveryLatexDRC').value = '';
      _el('deliveryLatexNH3').value = '';
      _el('deliveryLatexPH').value = '';
      _el('deliverySeasonType').value = 'dry';
      _el('deliveryNH3Concentration').value = '';
      _el('deliveryNH3Dosage').value = '';
      _el('deliveryLatexPurpose').value = 'svr_rss';
      _el('deliveryVFA').value = '';
      _el('deliveryConcentrateGrade').value = '';
      var concF = _el('latexConcentrateFields');
      if (concF) concF.style.display = 'none';
      var concV = _el('concentrateValidation');
      if (concV) concV.innerHTML = '';
      _resetCoagFormFields();
      if (_el('deliveryLatexDryWeight')) _el('deliveryLatexDryWeight').textContent = '0';
      if (_el('deliveryCoagDryWeight')) _el('deliveryCoagDryWeight').textContent = '0';
      _el('deliveryDryWeight').textContent = '0 kg';
      toggleMaterialFields('mixed');
      _el('deliveryTappingSession').value = '';
      var tapToday = _todayStr();
      _el('deliveryTappingDate').value = tapToday;
      selectedPlotIds = [];
      deliveryPlots = [];
      if (defTeam) {
        await _fetchHarvestContext(defTeam, tapToday);
        _refreshDeliverySessions();
        _refreshDeliveryPlots();
      } else {
        _el('deliveryPlotsContainer').innerHTML = '<div class="no-plots-message">Chọn trạm SX để hiển thị danh sách lô</div>';
        _el('deliveryPlotsSummary').style.display = 'none';
      }
      _applyDeliveryModalReadOnly(false, null);
      _lockDeliveryDatesForNonAdmin(true);
    }

    modal.classList.add('active');
  }

  function closeDeliveryModal() {
    var m = _el('deliveryModal');
    if (m) {
      m.classList.remove('active');
      m.classList.remove('delivery-readonly');
    }
  }

  function editDelivery(id) { openDeliveryModal(id); }

  async function saveDelivery() {
    var id = _el('deliveryId').value;
    var deliveryNo = _el('deliveryNo').value.trim();
    var deliveryDateTime = _el('deliveryDateTime').value;
    var team = _el('deliveryTeam').value;
    var group = _el('deliveryGroup').value.trim();
    var gardenId = _el('deliveryGardenId').value;
    var materialType = 'mixed';
    var grade = _el('deliveryGrade').value;
    var tappingTimeOnly = _el('deliveryTappingTime').value;
    var collectionTime = _el('deliveryCollectionTime').value;
    var vehicleNo = _el('deliveryVehicle').value.trim();
    var sealStatus = _el('deliverySealStatus').value;
    var sealCode = _el('deliverySealCode').value.trim();
    var status = _el('deliveryStatus').value;
    var deliveryPerson = _el('deliveryPerson').value.trim();
    var receivePerson = _el('deliveryReceivePerson').value.trim();
    var notes = _el('deliveryNotes').value.trim();
    var tappingSession = _el('deliveryTappingSession').value;
    var tappingDate = _el('deliveryTappingDate').value;
    var plotIds = getSelectedPlotIds();
    var plotNames = getSelectedPlotNames();

    if (!deliveryNo || !deliveryDateTime || !team) {
      _showToast('Vui lòng nhập đầy đủ thông tin bắt buộc (số phiếu, ngày, trạm SX)', 'error');
      return;
    }
    if (plotIds.length === 0) {
      _showToast('Vui lòng chọn ít nhất 1 lô thu hoạch (EUDR)', 'error');
      return;
    }

    var tappingDateNorm = _normalizeDateStr(tappingDate);
    if (!tappingDateNorm) {
      _showToast('Vui lòng chọn Ngày cạo (EUDR)', 'error');
      return;
    }
    var documentDateNorm = _normalizeDateStr(deliveryDateTime) || tappingDateNorm;

    var writeDate = tappingDateNorm;
    if (id) {
      var existing = deliveries.find(function (x) { return x.id === id; });
      if (!_assertDeliveryWrite(existing, 'sửa phiếu')) return;
      if (!_assertDeliveryWrite(writeDate, 'sửa phiếu')) return;
    } else {
      if (!_assertDeliveryWrite(writeDate, 'tạo phiếu')) return;
    }

    var latexGross = parseFloat(_el('deliveryLatexGross').value) || 0;
    var coagLines = _readCoagLinesFromForm();
    var coagTotals = _coagTotalsFromLines(coagLines);
    var coagGross = coagTotals.grossKg;
    var tscPercent = parseFloat((_el('deliveryLatexTSC') || {}).value) || null;
    var latexDrc = parseFloat(_el('deliveryLatexDRC').value) || 0;
    if (!latexDrc && tscPercent) {
      await onLatexTscChange();
      latexDrc = parseFloat(_el('deliveryLatexDRC').value) || 0;
    }
    var coagDrc = coagTotals.drcPercent;

    if (latexGross <= 0 && coagGross <= 0) {
      _showToast('Nhập khối lượng mủ nước hoặc mủ đông', 'error');
      return;
    }
    if (latexGross > 0 && (!tscPercent || tscPercent <= 0)) {
      _showToast('Vui lòng nhập TSC% cho mủ nước', 'error');
      return;
    }
    if (latexGross > 0 && latexDrc > 0 && latexDrc < 20) {
      _showToast('DRC mủ nước phải ≥ 20% theo TCCS 111:2023', 'error');
      return;
    }

    var latexDry = latexGross * latexDrc / 100;
    var coagDry = coagTotals.dryKg;
    var totalDry = latexDry + coagDry;
    var totalGross = latexGross + coagGross;
    var blendedDrc = totalGross > 0 ? (totalDry / totalGross * 100) : 0;

    var purpose = (_el('deliveryLatexPurpose') || {}).value || 'svr_rss';
    var additionalData = {
      latexGrossWeight: latexGross > 0 ? latexGross : null,
      latexDrcPercent: latexGross > 0 ? latexDrc : null,
      latexDryWeight: latexGross > 0 ? parseFloat(latexDry.toFixed(2)) : null,
      tscPercent: latexGross > 0 ? tscPercent : null,
      coagGrossWeight: coagGross > 0 ? parseFloat(coagGross.toFixed(2)) : null,
      coagDrcPercent: coagGross > 0 ? parseFloat(coagDrc.toFixed(2)) : null,
      coagDryWeight: coagGross > 0 ? parseFloat(coagDry.toFixed(2)) : null,
      coagByType: coagGross > 0 ? _buildCoagByTypeForSave(coagLines) : null,
      nh3Percent: parseFloat(_el('deliveryLatexNH3').value) || null,
      phValue: parseFloat(_el('deliveryLatexPH').value) || null,
      seasonType: (_el('deliverySeasonType') || {}).value || null,
      nh3Concentration: parseFloat((_el('deliveryNH3Concentration') || {}).value) || null,
      nh3Dosage: parseFloat((_el('deliveryNH3Dosage') || {}).value) || null,
      latexPurpose: purpose
    };
    if (purpose === 'concentrate') {
      additionalData.vfa = parseFloat((_el('deliveryVFA') || {}).value) || null;
      additionalData.concentrateGrade = (_el('deliveryConcentrateGrade') || {}).value || null;
    }

    var user = _user();
    var userName = _userDisplayName(user);
    var teamName = _teamNameById(team);
    var allocDate = tappingDateNorm;
    var data = Object.assign({
      deliveryNo: deliveryNo, team: team, team_id: team, group: group,
      gardenId: gardenId || team, gardenCode: teamName,
      materialType: materialType, grade: grade,
      tappingTimeOnly: tappingTimeOnly, collectionTime: collectionTime,
      vehicleNo: vehicleNo, sealStatus: sealStatus, sealCode: sealCode,
      grossWeight: parseFloat(totalGross.toFixed(2)),
      drcPercent: parseFloat(blendedDrc.toFixed(2)),
      dryWeight: parseFloat(totalDry.toFixed(2)),
      status: status, deliveryPerson: deliveryPerson, receivePerson: receivePerson, notes: notes,
      tappingSession: tappingSession || null,
      tappingDate: tappingDateNorm,
      tappingTime: tappingDateNorm,
      documentDate: documentDateNorm,
      plotIds: plotIds, plotNames: plotNames, eudrCompliant: true,
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedBy: user ? user.id : null,
      updatedByName: userName
    }, additionalData);

    var localData = Object.assign({}, data, {
      tappingDate: tappingDateNorm,
      tappingTime: tappingDateNorm,
      documentDate: documentDateNorm,
      updatedAt: new Date().toISOString()
    });
    if (id) {
      var prev = deliveries.find(function (x) { return x.id === id; });
      if (prev && prev.createdAt) localData.createdAt = prev.createdAt;
    } else {
      localData.createdAt = deliveryDateTime ? new Date(deliveryDateTime).toISOString() : new Date().toISOString();
    }

    var savedId = id;
    var saveOk = false;
    try {
      if (id) {
        await _db().collection('rubberDeliveries').doc(id).update(data);
        _showToast('Cập nhật thành công!');
      } else {
        data.createdAt = ErpDb.firestore.FieldValue.serverTimestamp();
        data.createdBy = user ? user.id : null;
        data.createdByName = userName;
        var docRef = await _db().collection('rubberDeliveries').add(data);
        savedId = docRef.id;
        localData.id = savedId;
        _showToast('Tạo phiếu thành công!');
      }
      saveOk = true;
      _upsertDeliveryInCache(Object.assign({ id: savedId }, localData), savedId);
    } catch (error) {
      console.warn('Supabase save error:', error.message);
      if (id) {
        _upsertDeliveryInCache(Object.assign({ id: id }, localData), id);
      } else {
        localData.id = 'local_' + Date.now();
        _upsertDeliveryInCache(localData);
      }
      _showToast('Không lưu được phiếu: ' + (error.message || error), 'error');
    }

    await _refreshDeliveryUi();
    if (saveOk) {
      try {
        await _fetchDeliveriesFromRemote({ tappingDate: allocDate });
        await _refreshDeliveryUi();
      } catch (fetchErr) {
        console.warn('Refresh deliveries after save:', fetchErr.message);
      }
    }
    if (window.TabFieldHarvest && TabFieldHarvest.renderAllocatedYieldSummary) {
      TabFieldHarvest.renderAllocatedYieldSummary();
    }
    if (team && allocDate) await _updateHarvestAllocation(team, allocDate);

    closeDeliveryModal();
  }

  async function deleteDelivery(id) {
    var target = deliveries.find(function (d) { return d.id === id; });
    if (!_assertDeliveryWrite(target, 'xóa phiếu')) return;
    if (!(await showConfirm('Bạn có chắc muốn xóa phiếu giao nhận này?'))) return;
    try {
      await _db().collection('rubberDeliveries').doc(id).delete();
    } catch (error) {
      console.warn('Supabase delete error:', error.message);
      _showToast('Không xóa được phiếu: ' + (error.message || error), 'error');
      return;
    }
    deliveries = deliveries.filter(function (d) { return d.id !== id; });
    try {
      localStorage.setItem('rubberDeliveries', JSON.stringify(deliveries));
    } catch (e) { /* ignore */ }
    _showToast('Đã xóa!');
    await _refreshDeliveryUi();
    if (target && window.TabFieldHarvest && TabFieldHarvest.renderAllocatedYieldSummary) {
      TabFieldHarvest.renderAllocatedYieldSummary();
    }
    if (target) {
      var tid = target.team_id || target.team || target.gardenId;
      var dt = _deliveryTappingDateStr(target) || _deliveryRecordDate(target);
      if (tid && dt) {
        _updateHarvestAllocation(tid, dt).catch(function () { /* ignore */ });
      }
    }
  }

  function exportDeliveries() {
    ExportService.toExcel({
      data: deliveries,
      columns: [
        { key: 'deliveryNo', header: 'Số Phiếu', width: 15 },
        { key: 'tappingDate', header: 'Ngày cạo', width: 12,
          format: function(v, row) { return _formatDate(_deliveryDisplayDate(row)); }
        },
        { key: 'gardenCode', header: 'Mã Vườn/Đội', width: 15 },
        { key: 'tappingSession', header: 'Phiên Cạo', width: 12 },
        { key: 'plotNames', header: 'Lô Thu Hoạch', width: 25, format: function(v) { return v?.join(', ') || ''; } },
        { key: 'eudrCompliant', header: 'EUDR Compliant', width: 15, format: function(v) { return v ? 'Có' : 'Không'; } },
        { key: 'materialType', header: 'Loại Mủ', width: 12, format: function(v) { return getMaterialTypeText(v); } },
        { key: 'grossWeight', header: 'TL Thô (kg)', width: 14 },
        { key: 'drcPercent', header: 'DRC (%)', width: 10 },
        { key: 'dryWeight', header: 'TL Quy Khô (kg)', width: 16 },
        { key: 'vehicleNo', header: 'Biển Số Xe', width: 14 },
        { key: 'status', header: 'Trạng Thái', width: 16, format: function(v) { return v === 'received' ? 'Đã tiếp nhận' : (v === 'in_transit' ? 'Đang vận chuyển' : 'Chờ nghiệm thu'); } },
        { key: 'deliveryPerson', header: 'Ng\u01B0\u1EDDi Giao', width: 15 },
        { key: 'receivePerson', header: 'Ng\u01B0\u1EDDi Nh\u1EADn', width: 15 },
        { key: 'notes', header: 'Ghi Chú', width: 25 }
      ],
      fileName: 'GiaoNhanMu',
      sheetName: 'Giao Nhận Mủ'
    });
  }

  // ==================== PLOT SELECTION ====================

  async function onDeliveryDateChange() {
    if (_el('deliveryId').value) return;
    var date = (_el('deliveryDateTime') || {}).value;
    if (date) _el('deliveryNo').value = _generateDeliveryNo(date);
  }

  async function onDeliveryTeamChange() {
    var teamId = (_el('deliveryTeam') || {}).value;
    if (_el('deliveryGardenId')) _el('deliveryGardenId').value = teamId || '';
    var date = (_el('deliveryTappingDate') || {}).value;
    selectedPlotIds = [];
    if (teamId && date) {
      await _fetchHarvestContext(teamId, date);
      _refreshDeliverySessions();
      _refreshDeliveryPlots();
    } else {
      _refreshDeliverySessions();
      _refreshDeliveryPlots();
    }
  }

  async function onDeliveryGardenChange() {
    var teamId = (_el('deliveryGardenId') || {}).value;
    if (_el('deliveryTeam')) _el('deliveryTeam').value = teamId || '';
    await onDeliveryTeamChange();
  }

  async function onDeliveryTappingDateChange() {
    var teamId = (_el('deliveryTeam') || {}).value;
    var date = (_el('deliveryTappingDate') || {}).value;
    selectedPlotIds = [];
    if (_el('deliveryTappingSession')) _el('deliveryTappingSession').value = '';
    if (teamId && date) await _fetchHarvestContext(teamId, date);
    else {
      harvestAssignments = [];
      harvestWeighings = [];
    }
    _refreshDeliverySessions();
    _refreshDeliveryPlots();
  }

  function onTappingSessionChange() {
    selectedPlotIds = [];
    _refreshDeliveryPlots();
  }

  function _syncSelectAllPlotsCheckbox() {
    var wrap = _el('deliverySelectAllPlotsWrap');
    var master = _el('deliverySelectAllPlots');
    if (!wrap || !master) return;
    if (!deliveryPlots.length) {
      wrap.style.display = 'none';
      master.checked = false;
      master.indeterminate = false;
      return;
    }
    wrap.style.display = 'inline-flex';
    var n = selectedPlotIds.length;
    var total = deliveryPlots.length;
    master.checked = n > 0 && n === total;
    master.indeterminate = n > 0 && n < total;
  }

  function renderDeliveryPlots() {
    var container = document.getElementById('deliveryPlotsContainer');
    var summary = document.getElementById('deliveryPlotsSummary');
    if (deliveryPlots.length === 0) {
      if (container) container.innerHTML = '<div class="no-plots-message">Không có lô nào trong vườn này</div>';
      if (summary) summary.style.display = 'none';
      _syncSelectAllPlotsCheckbox();
      return;
    }
    var html = '';
    deliveryPlots.forEach(function(plot) {
      var isChecked = selectedPlotIds.indexOf(plot.id) !== -1;
      html += '<label class="plot-checkbox ' + (isChecked ? 'checked' : '') + '" data-plot-id="' + plot.id + '">' +
        '<input type="checkbox" value="' + plot.id + '" ' + (isChecked ? 'checked' : '') + ' onchange="TabDelivery.onPlotCheckboxChange(this)">' +
        '<span class="plot-name">' + plot.name + '</span>' +
        (plot.area ? '<span class="plot-area">(' + plot.area + ' ha)</span>' : '') +
        '<span class="eudr-icon compliant" title="EUDR: compliant">✓</span></label>';
    });
    if (container) container.innerHTML = html;
    if (summary) summary.style.display = 'flex';
    updatePlotsSummary();
    _syncSelectAllPlotsCheckbox();
  }

  function onSelectAllPlotsChange(checkbox) {
    if (checkbox.checked) selectAllPlots();
    else deselectAllPlots();
  }

  function onPlotCheckboxChange(checkbox) {
    var plotId = checkbox.value;
    var label = checkbox.closest('.plot-checkbox');
    if (checkbox.checked) {
      if (selectedPlotIds.indexOf(plotId) === -1) selectedPlotIds.push(plotId);
      if (label) label.classList.add('checked');
    } else {
      selectedPlotIds = selectedPlotIds.filter(function(id) { return id !== plotId; });
      if (label) label.classList.remove('checked');
    }
    updatePlotsSummary();
    _syncSelectAllPlotsCheckbox();
  }

  function updatePlotsSummary() {
    var countEl = document.getElementById('selectedPlotsCount');
    var areaEl = document.getElementById('selectedPlotsArea');
    if (countEl) countEl.textContent = selectedPlotIds.length;
    var totalArea = selectedPlotIds.reduce(function(sum, plotId) {
      var plot = deliveryPlots.find(function(p) { return p.id === plotId; });
      return sum + (plot?.area || 0);
    }, 0);
    if (areaEl) areaEl.textContent = totalArea.toFixed(2);
  }

  function selectAllPlots() { selectedPlotIds = deliveryPlots.map(function(p) { return p.id; }); renderDeliveryPlots(); }
  function deselectAllPlots() { selectedPlotIds = []; renderDeliveryPlots(); }
  function getSelectedPlotIds() { return selectedPlotIds; }
  function getSelectedPlotNames() {
    return selectedPlotIds.map(function(id) {
      var plot = deliveryPlots.find(function(p) { return p.id === id; });
      return plot?.name || id;
    });
  }

  // ==================== PUBLIC API ====================
  return {
    getDeliveries: function() { return deliveries; },
    buildHarvestAllocationEntry: function(teamId, dateStr, workerOverride, sessionFilter) {
      _ensureDeliveriesLoaded();
      dateStr = _normalizeDateStr(dateStr);
      return _buildAllocationEntry(teamId, dateStr, workerOverride, sessionFilter);
    },
    getStoredHarvestAllocation: function(teamId, dateStr) {
      dateStr = _normalizeDateStr(dateStr);
      if (!teamId || !dateStr) return null;
      var store = _loadAllocationStore();
      return store[teamId] && store[teamId][dateStr] ? store[teamId][dateStr] : null;
    },
    ensureDeliveriesLoaded: _ensureDeliveriesLoaded,
    fetchDeliveriesForAllocation: fetchDeliveriesForAllocation,
    loadDeliveries: loadDeliveries,
    renderDeliveries: renderDeliveries,
    openDeliveryModal: openDeliveryModal,
    closeDeliveryModal: closeDeliveryModal,
    editDelivery: editDelivery,
    saveDelivery: saveDelivery,
    deleteDelivery: deleteDelivery,
    exportDeliveries: exportDeliveries,
    toggleMaterialFields: toggleMaterialFields,
    calculateDeliveryDry: calculateDeliveryDry,
    updateDeliveryStats: updateDeliveryStats,
    updateNH3Hints: updateNH3Hints,
    validateNH3Dosage: validateNH3Dosage,
    updateCoagQualityHint: updateCoagQualityHint,
    onDeliveryGardenChange: onDeliveryGardenChange,
    onDeliveryDateChange: onDeliveryDateChange,
    onDeliveryTeamChange: onDeliveryTeamChange,
    onDeliveryTappingDateChange: onDeliveryTappingDateChange,
    onTappingSessionChange: onTappingSessionChange,
    onLatexTscChange: onLatexTscChange,
    onSelectAllPlotsChange: onSelectAllPlotsChange,
    onPlotCheckboxChange: onPlotCheckboxChange,
    selectAllPlots: selectAllPlots,
    deselectAllPlots: deselectAllPlots,
    getSelectedPlotIds: getSelectedPlotIds,
    getSelectedPlotNames: getSelectedPlotNames,
    refreshHarvestAllocation: _updateHarvestAllocation,
    buildAllocationEntry: _buildAllocationEntry,
    init: initDeliveries
  };
})();
