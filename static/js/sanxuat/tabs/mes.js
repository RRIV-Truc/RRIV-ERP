/**
 * Tab 3: Chế Biến (MES) - Manufacturing Execution System
 * 8-stage production tracking with TCCS validation
 * @module TabMES
 * @depends SanxuatStages, SanxuatParams, TCCSSpecs, TCCSValidator, SanxuatCalculations, BatchProcessor
 *
 * NOTE: This module manages MES state and orchestrates the 8-stage production workflow.
 * Complex rendering functions (renderStepDashboard, renderStepBatchCards) remain inline
 * in app-sanxuat.html during Phase 2 and will be refactored with DataTable/ModalForm
 * components in Phase 3.
 */

const TabMES = (function() {
  'use strict';

  // === State ===
  let batches = [];
  let lineRecords = [];
  let mesTankData = [];
  let selectedMESTank = null;
  let currentStage = 'xulymu';
  let currentProductionLine = 'all';
  let currentWorkspace = null;   // workspace id (e.g. 'muNuoc', 'muTap')
  let currentProduct = '';       // product code filter (e.g. 'SVR3L', '' = all)

  function _db() { return ErpDb.firestore(); }
  function _user() { return window.currentUser; }
  function _factory() { return window.currentFactory; }
  function _showToast(msg, type) { if (window.showToast) window.showToast(msg, type); }
  function _formatNumber(n) { return window.formatNumber ? window.formatNumber(n) : String(n); }
  function _formatDate(d) { return window.formatDate ? window.formatDate(d) : ''; }
  function _generateCode(prefix) { return window.generateCode ? window.generateCode(prefix) : prefix + Date.now(); }

  // === Timeline helper ===
  function _timelineEntry(action, stage, details) {
    var u = _user();
    var entry = {
      action: action,
      stage: stage || '',
      userId: u ? u.id : null,
      userName: u ? (u.hoTen || u.name || '') : '',
      userRole: u ? (u.role || '') : '',
      userDepartment: u ? (u.department || '') : '',
      timestamp: new Date().toISOString()
    };
    if (details) entry.details = details;
    return entry;
  }

  // ==================== BATCH LOADING ====================

  async function loadBatches() {
    try {
      batches = await BatchProcessor.loadBatches(_factory());
      // Share with global scope for cross-tab access
      window.batches = batches;
      renderBatches();
      applyBatchFilters();
      renderStepDashboard(currentStage);
      // Load coag accumulation card
      if (typeof window.loadCoagAccumulation === 'function') window.loadCoagAccumulation();
    } catch (error) {
      console.error('Error loading batches:', error);
      _showToast('Lỗi tải dữ liệu lô sản xuất', 'error');
    }
  }

  // ==================== LINE RECORD LOADING ====================

  async function loadLineRecords() {
    var dateVal = document.getElementById('mesDate') ? document.getElementById('mesDate').value : '';
    try {
      lineRecords = await LineRecordProcessor.loadRecords(_factory(), dateVal);
      window.lineRecords = lineRecords;
    } catch (e) {
      console.error('Error loading line records:', e);
      lineRecords = [];
      window.lineRecords = [];
    }
    // Re-render if currently viewing a line stage
    if (SanxuatStages.isLineStage(currentStage)) {
      renderStepDashboard(currentStage);
    }
  }

  // ==================== RENDERING ====================

  function renderBatches(data) {
    data = data || batches;
    var tbody = document.getElementById('batchesTableBody');
    if (!tbody) return;
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#64748b;">Chưa có lô sản xuất nào</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(function(b) {
      var efficiency = b.inputWeight > 0 ? ((b.outputWeight || 0) / b.inputWeight * 100).toFixed(1) : 0;
      var tccsInfo = TCCSValidator.getTCCSSummary(b);
      var stageText = SanxuatStages.getStageLabel(b.processStage, _factory(), currentProductionLine);
      return '<tr>' +
        '<td><strong>' + (b.batchNo || '') + '</strong></td>' +
        '<td>' + _formatDate(b.date) + '</td>' +
        '<td>' + (b.product || '') + '</td>' +
        '<td>' + (b.sourceTankCode || '-') + '</td>' +
        '<td>' + stageText + '</td>' +
        '<td style="font-size:12px;max-width:180px;white-space:normal">' + tccsInfo + '</td>' +
        '<td>' + _formatNumber(b.inputWeight) + '</td>' +
        '<td>' + _formatNumber(b.outputWeight) + '</td>' +
        '<td>' + efficiency + '%</td>' +
        '<td><span class="status-badge ' + (b.status || 'processing') + '">' + (b.status === 'completed' ? 'Hoàn thành' : 'Đang xử lý') + '</span></td>' +
        '<td><div class="action-btns">' +
        '<button class="action-btn edit" onclick="TabMES.editBatch(\'' + b.id + '\')" title="Sửa">✏️</button>' +
        '<button class="action-btn delete" onclick="TabMES.deleteBatch(\'' + b.id + '\')" title="Xóa">🗑️</button>' +
        '</div></td></tr>';
    }).join('');
  }

  // ==================== FILTERING ====================

  function applyBatchFilters() {
    var filters = {
      productionLineId: currentProductionLine,
      factoryId: _factory(),
      keyword: (document.getElementById('batchSearch')?.value || ''),
      status: (document.getElementById('batchStatusFilter')?.value || ''),
      date: (document.getElementById('mesDate')?.value || ''),
      tankNo: selectedMESTank
    };

    // Filter by specific product if selected
    if (currentProduct) {
      filters.product = currentProduct;
    }

    // Get stage from active chip
    var activeStage = document.querySelector('.process-stage.active');
    if (activeStage) {
      var stageMatch = activeStage.getAttribute('onclick')?.match(/'(\w+)'/);
      if (stageMatch) filters.stage = stageMatch[1];
    }

    var filtered = BatchProcessor.filterBatches(batches, filters);
    renderBatches(filtered);
  }

  // ==================== WORKSPACE TABS ====================

  function initWorkspaceTabs() {
    var container = document.getElementById('workspaceTabs');
    if (!container || !_factory()) return;
    var workspaces = SanxuatStages.WORKSPACE_CONFIG[_factory()] || [];
    if (workspaces.length === 0) { container.style.display = 'none'; return; }
    // Default to first workspace if none selected
    if (!currentWorkspace) currentWorkspace = workspaces[0].id;
    container.style.display = '';
    container.innerHTML = workspaces.map(function(ws) {
      return '<div class="workspace-tab ' + (ws.id === currentWorkspace ? 'active' : '') +
        '" onclick="TabMES.selectWorkspace(\'' + ws.id + '\')">' +
        '<span class="workspace-tab-icon">' + ws.icon + '</span>' +
        '<span class="workspace-tab-name">' + ws.name + '</span></div>';
    }).join('');
    // Populate product dropdown for current workspace
    populateProductDropdown();
  }

  function selectWorkspace(wsId) {
    if (currentWorkspace === wsId) return;
    currentWorkspace = wsId;
    currentProduct = '';
    selectedMESTank = null;
    // Re-render tabs
    var container = document.getElementById('workspaceTabs');
    if (container) {
      container.querySelectorAll('.workspace-tab').forEach(function(tab) {
        tab.classList.toggle('active', tab.getAttribute('onclick').indexOf("'" + wsId + "'") !== -1);
      });
    }
    populateProductDropdown();
    updateStageChipLabels();
    // Sync legacy currentProductionLine for backward compat
    syncLegacyProductionLine();
    var mesDate = document.getElementById('mesDate')?.value;
    if (mesDate) {
      loadMESTanks(mesDate);
      // Re-render shift schedule filtered to this workspace's line group
      if (typeof window.renderDailyShiftSchedule === 'function') {
        window.renderDailyShiftSchedule(mesDate);
      }
    }
    applyBatchFilters();
    renderStepDashboard(currentStage);
    // Load coag accumulation for this workspace
    if (typeof window.loadCoagAccumulation === 'function') window.loadCoagAccumulation();
  }

  function populateProductDropdown() {
    var select = document.getElementById('mesProductSelect');
    var tccsSpan = document.getElementById('mesProductTccs');
    if (!select) return;
    var ws = getActiveWorkspace();
    var products = ws ? ws.products : [];
    select.innerHTML = '<option value="">-- T\u1EA5t c\u1EA3 --</option>' +
      products.map(function(p) {
        return '<option value="' + p.code + '"' + (p.code === currentProduct ? ' selected' : '') + '>' + p.name + '</option>';
      }).join('');
    if (tccsSpan) {
      if (currentProduct) {
        var prod = products.find(function(p) { return p.code === currentProduct; });
        tccsSpan.textContent = prod && prod.tccs ? 'TCCS ' + prod.tccs : '';
      } else {
        tccsSpan.textContent = '';
      }
    }
  }

  function onMESProductChange() {
    var select = document.getElementById('mesProductSelect');
    currentProduct = select ? select.value : '';
    updateStageChipLabels();
    syncLegacyProductionLine();
    applyBatchFilters();
    renderStepDashboard(currentStage);
    // Update TCCS badge
    var tccsSpan = document.getElementById('mesProductTccs');
    if (tccsSpan) {
      var ws = getActiveWorkspace();
      var prod = ws ? ws.products.find(function(p) { return p.code === currentProduct; }) : null;
      tccsSpan.textContent = prod && prod.tccs ? 'TCCS ' + prod.tccs : '';
    }
  }

  function getActiveWorkspace() {
    var workspaces = SanxuatStages.WORKSPACE_CONFIG[_factory()] || [];
    return workspaces.find(function(ws) { return ws.id === currentWorkspace; }) || null;
  }

  /**
   * Sync currentProductionLine for backward compat with BatchProcessor.filterBatches
   */
  function syncLegacyProductionLine() {
    if (!currentProduct) {
      // Map workspace to a reasonable production line
      var ws = getActiveWorkspace();
      if (ws && ws.id === 'muTap') currentProductionLine = 'tccs102';
      else currentProductionLine = 'all';
    } else {
      // Find matching production line from PRODUCTION_LINES
      var lines = SanxuatStages.PRODUCTION_LINES[_factory()] || [];
      var match = lines.find(function(l) { return l.products && l.products.indexOf(currentProduct) !== -1; });
      currentProductionLine = match ? match.id : 'all';
    }
  }

  function updateStageChipLabels() {
    SanxuatStages.STAGE_ORDER.forEach(function(stage) {
      var chip = document.querySelector('.process-stage[onclick*="' + stage + '"]');
      if (chip) {
        var label;
        if (currentProduct) {
          label = SanxuatStages.getStageLabelByProduct(stage, currentProduct);
        } else {
          var ws = getActiveWorkspace();
          label = ws && ws.stageLabels ? (ws.stageLabels[stage] || SanxuatStages.DEFAULT_LABELS[stage]) : SanxuatStages.DEFAULT_LABELS[stage];
        }
        var nameEl = chip.querySelector('.stage-name');
        if (nameEl && nameEl.textContent !== label) nameEl.textContent = label;
      }
    });
  }

  // Legacy compat
  function initProductionLineSelector() { initWorkspaceTabs(); }
  function selectProductionLine(lineId) {
    // Map old lineId to workspace+product
    var lines = SanxuatStages.PRODUCTION_LINES[_factory()] || [];
    var line = lines.find(function(l) { return l.id === lineId; });
    if (line && line.products) {
      // Find which workspace contains these products
      var workspaces = SanxuatStages.WORKSPACE_CONFIG[_factory()] || [];
      for (var i = 0; i < workspaces.length; i++) {
        var wsCodes = workspaces[i].products.map(function(p) { return p.code; });
        if (line.products.some(function(p) { return wsCodes.indexOf(p) !== -1; })) {
          selectWorkspace(workspaces[i].id);
          return;
        }
      }
    }
    currentProductionLine = lineId;
    applyBatchFilters();
  }

  // ==================== STAGE SELECTION ====================

  function selectStage(stage) {
    document.querySelectorAll('.process-stage').forEach(function(el) {
      var isThis = el.getAttribute('onclick')?.indexOf("'" + stage + "'") !== -1;
      el.classList.toggle('active', isThis);
    });
    currentStage = stage;
    renderStepDashboard(stage);
    applyBatchFilters();
  }

  function renderStepDashboard(stage) {
    currentStage = stage || currentStage;
    // Sync module state to window for inline rendering access
    window.mesTankData = mesTankData;
    window.lineRecords = lineRecords;
    window.currentStage = currentStage;
    window.currentProductionLine = currentProductionLine;
    window.currentProduct = currentProduct;
    window.currentWorkspace = currentWorkspace;

    if (SanxuatStages.isLineStage(currentStage)) {
      // Line record stages (steps 3-7): render line record dashboard
      if (typeof window.renderLineRecordDashboard === 'function') {
        window.renderLineRecordDashboard(currentStage);
      }
    } else {
      // Batch stages (steps 1-2): render batch dashboard
      if (typeof window.renderStepDashboard === 'function') {
        window.renderStepDashboard(currentStage);
      }
    }
  }

  // ==================== MES TANK MANAGEMENT ====================

  async function loadMESTanks(dateStr) {
    var ws = getActiveWorkspace();
    var showTanks = ws ? ws.showTanks : true;
    var grid = document.getElementById('mesTankGrid');

    if (!showTanks || !dateStr) {
      if (grid) grid.style.display = 'none';
      mesTankData = [];
      return;
    }

    try {
      mesTankData = await BatchProcessor.loadBlendingTanks(dateStr, _factory());
    } catch (e) {
      mesTankData = [];
    }

    renderMESTankCards();
  }

  function renderMESTankCards() {
    var grid = document.getElementById('mesTankGrid');
    if (!grid) return;
    var ws = getActiveWorkspace();
    var showTanks = ws ? ws.showTanks : true;
    if (!showTanks || mesTankData.length === 0) {
      grid.style.display = 'none';
      return;
    }
    grid.style.display = '';
    var statusText = { empty: 'Trống', filling: 'Đang nạp', full: 'Đầy', processing: 'Đang xử lý', done: 'Hoàn thành' };
    var html = '';
    for (var i = 1; i <= 4; i++) {
      var tankBatches = mesTankData.filter(function(b) { return b.tankNo === i; });
      var active = tankBatches.find(function(b) { return ['filling', 'full', 'processing'].indexOf(b.status) !== -1; });
      var done = tankBatches.find(function(b) { return b.status === 'done'; });
      var batch = active || done;
      var cls = batch ? batch.status : 'empty';
      var weight = batch ? _formatNumber(batch.totalWeight || 0) : '0';
      var drc = batch ? (batch.avgDRC || 0).toFixed(1) : '0';
      var dry = batch ? _formatNumber(batch.totalDryWeight || 0) : '0';
      var st = batch ? (statusText[batch.status] || batch.status) : 'Trống';
      var code = batch ? batch.batchCode : '';
      var receipts = batch ? (batch.sourceReceipts || []).length : 0;
      html += '<div class="tank-card ' + cls + '" data-tank="' + i + '" data-batch-id="' + (batch?.id || '') + '" onclick="TabMES.selectMESTank(' + i + ')" style="cursor:pointer">' +
        '<div class="tank-icon">🛢️</div><div class="tank-name">Hồ ' + i + '</div>' +
        '<div class="tank-weight">' + weight + ' <small>kg</small></div>' +
        (batch ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">DRC ' + drc + '% · Q.Khô ' + dry + ' kg · ' + receipts + ' xe</div>' : '') +
        (code ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">' + code + '</div>' : '') +
        '<div class="tank-status">' + st + '</div></div>';
    }
    grid.innerHTML = html;
    if (selectedMESTank) {
      grid.querySelectorAll('.tank-card').forEach(function(card) {
        var t = parseInt(card.dataset.tank);
        card.style.outline = (t === selectedMESTank) ? '2px solid var(--accent)' : '';
        card.style.outlineOffset = (t === selectedMESTank) ? '2px' : '';
      });
    }
  }

  function selectMESTank(tankNo) {
    if (selectedMESTank === tankNo) selectedMESTank = null;
    else selectedMESTank = tankNo;
    var grid = document.getElementById('mesTankGrid');
    if (grid) {
      grid.querySelectorAll('.tank-card').forEach(function(card) {
        var t = parseInt(card.dataset.tank);
        card.style.outline = (t === selectedMESTank) ? '2px solid var(--accent)' : '';
        card.style.outlineOffset = (t === selectedMESTank) ? '2px' : '';
      });
    }
    applyBatchFilters();
  }

  // ==================== MES DATE ====================

  function initMESDate() {
    var dateInput = document.getElementById('mesDate');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
    document.querySelectorAll('.process-stage').forEach(function(el) {
      el.classList.toggle('active', el.getAttribute('onclick')?.indexOf("'" + currentStage + "'") !== -1);
    });
    onMESDateChange();
  }

  function onMESDateChange() {
    var dateVal = document.getElementById('mesDate')?.value;
    if (!dateVal) return;
    loadMESTanks(dateVal);
    loadLineRecords();
    // Load daily shift schedule for auto-resolution
    if (typeof window.renderDailyShiftSchedule === 'function') {
      window.renderDailyShiftSchedule(dateVal);
    }
    applyBatchFilters();
    renderStepDashboard(currentStage);
  }

  // ==================== BATCH CRUD ====================

  function _el(id) { return document.getElementById(id); }

  function openBatchModal(id) {
    _el('batchModalTitle').textContent = id ? 'Ch\u1EC9nh S\u1EEDa H\u1ED3 Ph\u1ED1i Li\u1EC7u' : 'T\u1EA1o H\u1ED3 Ph\u1ED1i Li\u1EC7u M\u1EDBi';
    _el('batchHeaderFields').style.display = '';
    _el('batchParamOnlyHeader').style.display = 'none';
    _el('batchId').value = id || '';
    // Hide line record fields when opening batch modal
    var lineFields = _el('lineRecordFields');
    if (lineFields) lineFields.style.display = 'none';
    var lineRecordIdEl = _el('lineRecordId');
    if (lineRecordIdEl) lineRecordIdEl.value = '';
    // Re-show shiftSelectorContainer for batch modals
    var shiftCont = _el('shiftSelectorContainer');
    if (shiftCont) shiftCont.style.display = '';

    if (id) {
      var b = batches.find(function(x) { return x.id === id; });
      if (b) {
        _el('batchNo').value = b.batchNo || '';
        _el('batchDate').value = b.date && b.date.toDate ? b.date.toDate().toISOString().slice(0,10) : b.date;
        _el('batchProduct').value = b.product || '';
        _el('batchStage').value = b.processStage || 'xulymu';
        _el('batchInputWeight').value = b.inputWeight || '';
        _el('batchOutputWeight').value = b.outputWeight || '';
        _el('batchStatus').value = b.status || 'processing';
        _el('batchNotes').value = b.notes || '';
        if (window.onProductChange) window.onProductChange();
        if (window.toggleStageParams) window.toggleStageParams();
        if (window.populateStageParams) window.populateStageParams(b.techParams, b.processStage);
        if (b.stageData && b.stageData[b.processStage] && window.loadShiftData) window.loadShiftData(b.stageData[b.processStage], b.processStage);
        if (b.processStage === 'say' && b.stageData && b.stageData.say) {
          if (window.initOvenSelect) window.initOvenSelect();
          if (window.loadOvenData) window.loadOvenData(b.stageData.say);
        }
        populateBatchSourceTank(b.sourceTankId || '');
      }
    } else {
      var batchNoEl = _el('batchNo');
      var now = new Date();
      var dp = now.toISOString().slice(0,10).split('-');
      batchNoEl.value = 'H00/01_' + dp[2] + '/' + dp[1] + '/' + dp[0].slice(2);
      batchNoEl.readOnly = false;
      batchNoEl.style.opacity = '';
      _el('batchDate').value = now.toISOString().slice(0,10);
      _el('batchProduct').value = '';
      _el('batchStage').value = 'xulymu';
      var inputWeightEl = _el('batchInputWeight');
      inputWeightEl.value = '';
      inputWeightEl.readOnly = false;
      inputWeightEl.style.opacity = '';
      _el('batchOutputWeight').value = '';
      _el('batchStatus').value = 'processing';
      _el('batchNotes').value = '';
      if (window.populateStageParams) window.populateStageParams(null, null);
      if (currentProduct) {
        _el('batchProduct').value = currentProduct;
      } else if (currentProductionLine !== 'all') {
        var plLines = SanxuatStages.PRODUCTION_LINES[_factory()] || [];
        var plLine = plLines.find(function(l) { return l.id === currentProductionLine; });
        if (plLine && plLine.products && plLine.products.length > 0) {
          _el('batchProduct').value = plLine.products[0];
        }
      }
      if (window.onProductChange) window.onProductChange();
      if (window.toggleStageParams) window.toggleStageParams();
      populateBatchSourceTank('');
    }

    _el('batchModal').classList.add('active');
  }

  function closeBatchModal() {
    _el('batchModal').classList.remove('active');
  }

  function editBatch(id) { openBatchModal(id); }

  async function populateBatchSourceTank(selectedId) {
    var tankSelect = _el('batchSourceTank');
    var tankRow = _el('sourceTankRow');
    var inputEl = _el('batchInputWeight');
    if (!tankSelect || !tankRow) return;

    var product = (_el('batchProduct') || {}).value || '';
    var needsTank = ['SVR3L','SVR5','SVRCV40','SVRCV50','SVRCV60','SVRL','LatexHA','LatexLA'].indexOf(product) !== -1;
    if (!needsTank) {
      tankRow.style.display = 'none';
      if (inputEl) { inputEl.readOnly = false; inputEl.style.opacity = ''; }
      return;
    }

    var batchDate = (_el('batchDate') || {}).value || '';
    if (!batchDate) { tankRow.style.display = 'none'; return; }

    tankRow.style.display = '';
    tankSelect.innerHTML = '<option value="">Đang tải hồ...</option>';

    var tanks = [];
    try {
      var snapshot = await _db().collection('blendingBatches')
        .where('date', '==', batchDate)
        .orderBy('batchCode', 'asc')
        .get();
      tanks = snapshot.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); })
        .filter(function(d) { return (!d.factory || d.factory === _factory()) && ['full','processing','done'].indexOf(d.status) !== -1; });
    } catch (e) {
      console.warn('Load tanks for batch modal:', e.message);
    }

    // Filter out tanks already used by other production batches
    try {
      var existingSnap = await _db().collection('productionBatches')
        .where('factory', '==', _factory())
        .get();
      var usedTankIds = new Set();
      var usedTankNos = new Set();
      var currentBatchId = (_el('batchId') || {}).value || '';
      existingSnap.forEach(function(doc) {
        if (doc.id === currentBatchId) return;
        var d = doc.data();
        // Normalize date for comparison
        var bd = d.date;
        if (bd && bd.toDate) bd = bd.toDate();
        if (bd instanceof Date) {
          bd = bd.getFullYear() + '-' + String(bd.getMonth() + 1).padStart(2, '0') + '-' + String(bd.getDate()).padStart(2, '0');
        }
        if (bd !== batchDate) return;
        if (d.sourceTankId) usedTankIds.add(d.sourceTankId);
        if (d.sourceTankNo) usedTankNos.add(d.sourceTankNo);
      });
      tanks = tanks.filter(function(t) {
        if (t.id === selectedId) return true;
        if (usedTankIds.has(t.id)) return false;
        if (t.tankNo && usedTankNos.has(t.tankNo)) return false;
        return true;
      });
    } catch (e) {
      console.warn('Filter used tanks:', e.message);
    }

    if (tanks.length === 0) {
      tankSelect.innerHTML = '<option value="">-- Không có hồ khả dụng ngày ' + (window.formatDateVN ? window.formatDateVN(batchDate) : batchDate) + ' --</option>';
      if (inputEl) { inputEl.readOnly = false; inputEl.style.opacity = ''; }
      return;
    }

    tankSelect.innerHTML = '<option value="">-- Chọn hồ phối liệu --</option>' +
      tanks.map(function(b) {
        return '<option value="' + b.id + '" ' + (selectedId === b.id ? 'selected' : '') + '>' +
          'Hồ ' + b.tankNo + ' — ' + b.batchCode + ' | ' + _formatNumber(b.totalWeight) + ' kg | DRC ' + (b.avgDRC||0).toFixed(1) + '% | Q.Khô ' + _formatNumber(b.totalDryWeight||0) + ' kg</option>';
      }).join('');

    tankSelect.onchange = async function() {
      var tb = tanks.find(function(t) { return t.id === tankSelect.value; });
      var infoDiv = _el('sourceTankInfo');
      var detail = _el('sourceTankDetail');
      if (tb) {
        infoDiv.style.display = '';
        detail.innerHTML = '<strong>' + tb.batchCode + '</strong> · Hồ ' + tb.tankNo + '<br>' +
          'Tổng TL: <strong style="color:var(--accent)">' + _formatNumber(tb.totalWeight) + ' kg</strong> · DRC: ' + (tb.avgDRC||0).toFixed(1) + '% · Q.Khô: ' + _formatNumber(tb.totalDryWeight||0) + ' kg<br>' +
          'Xe nạp: ' + (tb.sourceReceipts||[]).length + ' xe';
        if (inputEl) {
          inputEl.value = tb.totalWeight || '';
          inputEl.readOnly = true;
          inputEl.style.opacity = '0.7';
          inputEl.title = 'Tự động từ hồ ' + tb.batchCode;
        }
        // Pre-fill KL hồ thực tế & DRC hồ (editable by user)
        var klHoEl = _el('paramKLHoThucTe');
        if (klHoEl && !klHoEl.value) {
          klHoEl.value = tb.totalWeight || '';
          klHoEl.placeholder = 'Mặc định: ' + _formatNumber(tb.totalWeight) + ' kg (KL xe)';
        }
        var drcTruocEl = _el('paramDRCTruoc');
        if (drcTruocEl && !drcTruocEl.value && tb.avgDRC) {
          drcTruocEl.value = tb.avgDRC.toFixed(1);
        }
        // Auto-generate batch code from selected tank
        var batchNoEl = _el('batchNo');
        if (batchNoEl && !_el('batchId').value) {
          var tankNo = tb.tankNo || 0;
          var dateStr = (_el('batchDate') || {}).value || new Date().toISOString().slice(0, 10);
          var usageCount = 1;
          try {
            var existing = await _db().collection('productionBatches')
              .where('sourceTankNo', '==', tankNo)
              .where('factory', '==', _factory())
              .where('date', '==', dateStr)
              .get();
            usageCount = existing.size + 1;
          } catch(e) {}
          var dp = dateStr.split('-');
          batchNoEl.value = 'H' + String(tankNo).padStart(2, '0') + '/' +
            String(usageCount).padStart(2, '0') + '_' + dp[2] + '/' + dp[1] + '/' + dp[0].slice(2);
          batchNoEl.readOnly = true;
          batchNoEl.style.opacity = '0.7';
        }
      } else {
        infoDiv.style.display = 'none';
        if (inputEl) { inputEl.readOnly = false; inputEl.style.opacity = ''; inputEl.value = ''; inputEl.title = ''; }
        var klHoEl2 = _el('paramKLHoThucTe');
        if (klHoEl2) { klHoEl2.value = ''; klHoEl2.placeholder = 'Cân thực tế tại hồ'; }
        // Reset batch code when tank deselected
        var batchNoEl2 = _el('batchNo');
        if (batchNoEl2 && !_el('batchId').value) {
          var now2 = new Date();
          var dp2 = now2.toISOString().slice(0, 10).split('-');
          batchNoEl2.value = 'H00/01_' + dp2[2] + '/' + dp2[1] + '/' + dp2[0].slice(2);
          batchNoEl2.readOnly = false;
          batchNoEl2.style.opacity = '';
        }
      }
    };

    // When editing existing batch with linked tank, disable dropdown
    var isEdit = !!(_el('batchId') || {}).value;
    if (isEdit && selectedId) {
      tankSelect.disabled = true;
      tankSelect.style.opacity = '0.7';
      tankSelect.title = 'Không thể thay đổi hồ phối liệu khi chỉnh sửa';
    } else {
      tankSelect.disabled = false;
      tankSelect.style.opacity = '';
      tankSelect.title = '';
    }

    if (tankSelect.value) tankSelect.dispatchEvent(new Event('change'));
  }

  var _saving = false;
  async function saveBatch() {
    if (_saving) return;
    _saving = true;
    try { await _doSaveBatch(); } finally { _saving = false; }
  }
  async function _doSaveBatch() {
    var id = _el('batchId').value;
    var batchNo = _el('batchNo').value.trim();
    var date = _el('batchDate').value;
    var product = _el('batchProduct').value;
    var processStage = _el('batchStage').value;
    var inputWeight = parseFloat(_el('batchInputWeight').value) || 0;
    var outputWeight = parseFloat(_el('batchOutputWeight').value) || 0;
    var status = _el('batchStatus').value;
    var notes = _el('batchNotes').value.trim();

    if (!batchNo || !date || !product) {
      _showToast('Vui l\u00F2ng nh\u1EADp \u0111\u1EA7y \u0111\u1EE7 th\u00F4ng tin b\u1EAFt bu\u1ED9c', 'error');
      return;
    }

    // Validate TG tạo đông không trước TG kết thúc xử lý mủ
    if (processStage === 'taodong') {
      var xlEndHint = document.getElementById('taodongTimeHint');
      var xlEnd = xlEndHint?.dataset?.xlEnd || '';
      var tdStart = (_el('paramTGBatDauMuong') || {}).value || '';
      if (xlEnd && tdStart && tdStart.length >= 5 && tdStart < xlEnd) {
        _showToast('TG b\u1EAFt \u0111\u1EA7u xu\u1ED1ng m\u01B0\u01A1ng (' + tdStart + ') kh\u00F4ng \u0111\u01B0\u1EE3c tr\u01B0\u1EDBc TG k\u1EBFt th\u00FAc x\u1EED l\u00FD m\u1EE7 (' + xlEnd + ')', 'error');
        return;
      }
    }

    var techParams = window.collectStageParams ? window.collectStageParams() : {};
    var shiftData = window.collectShiftData ? window.collectShiftData(processStage) : {};
    var ovenData = window.collectOvenData ? window.collectOvenData() : {};

    var sourceTankId = (_el('batchSourceTank') || {}).value || '';
    var sourceTank = mesTankData.find(function(t) { return t.id === sourceTankId; });
    var user = _user();
    var userName = user ? (user.hoTen || user.name || '') : '';
    var now = new Date().toISOString();

    // === Detect changed params & build paramAuthors ===
    var existingBatch = id ? batches.find(function(b) { return b.id === id; }) : null;
    var existingSD = existingBatch && existingBatch.stageData ? existingBatch.stageData[processStage] : null;
    var existingParams = existingSD && existingSD.params ? existingSD.params : {};
    var existingAuthors = existingSD && existingSD.paramAuthors ? existingSD.paramAuthors : {};
    var paramAuthors = Object.assign({}, existingAuthors);
    var changedParamKeys = [];

    Object.keys(techParams).forEach(function(key) {
      var newVal = techParams[key];
      // Skip complex types (arrays, objects) — only track primitive params
      if (Array.isArray(newVal) || (typeof newVal === 'object' && newVal !== null)) return;
      if (newVal === '' || newVal === undefined || newVal === null) return;
      var oldVal = existingParams[key];
      if (String(newVal) !== String(oldVal || '')) {
        paramAuthors[key] = { userId: user ? user.id : null, userName: userName, at: now };
        changedParamKeys.push(key);
      }
    });
    // For new batch, all non-empty primitive params are new
    if (!id) {
      Object.keys(techParams).forEach(function(key) {
        var v = techParams[key];
        if (Array.isArray(v) || (typeof v === 'object' && v !== null)) return;
        if (v !== '' && v !== undefined && v !== null && !paramAuthors[key]) {
          paramAuthors[key] = { userId: user ? user.id : null, userName: userName, at: now };
          changedParamKeys.push(key);
        }
      });
    }

    var stageEntry = Object.assign({ params: techParams, paramAuthors: paramAuthors, updatedAt: now, updatedBy: user ? user.id : null, updatedByName: userName }, shiftData, ovenData);

    var data = {
      batchNo: batchNo, date: date, product: product,
      processStage: processStage, inputWeight: inputWeight, outputWeight: outputWeight,
      status: status, notes: notes, techParams: techParams,
      sourceTankId: sourceTankId || null,
      sourceTankCode: sourceTank ? (sourceTank.batchCode || '') : '',
      sourceTankNo: sourceTank ? (sourceTank.tankNo || null) : null,
      factory: _factory(),
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedBy: user ? user.id : null
    };
    // Add lineGroup from workspace
    var ws = getActiveWorkspace();
    if (ws) data.lineGroup = ws.lineGroup;

    try {
      if (id) {
        // update() interprets dot-notation as nested path — OK
        data['stageData.' + processStage] = stageEntry;
        data.timeline = ErpDb.firestore.FieldValue.arrayUnion(_timelineEntry('stage_saved', processStage, changedParamKeys.length > 0 ? { changedParams: changedParamKeys } : undefined));
        await _db().collection('productionBatches').doc(id).update(data);
        _showToast('C\u1EADp nh\u1EADt th\u00E0nh c\u00F4ng!');
      } else {
        // add() = set(): dot-notation keys are literal field names, NOT nested paths
        // Use nested object to ensure stageData.{stage}.params is accessible
        data.stageData = {};
        data.stageData[processStage] = stageEntry;
        data.createdAt = ErpDb.firestore.FieldValue.serverTimestamp();
        data.createdBy = user ? user.id : null;
        data.timeline = [_timelineEntry('batch_created', processStage, changedParamKeys.length > 0 ? { changedParams: changedParamKeys } : undefined)];
        await _db().collection('productionBatches').add(data);
        _showToast('T\u1EA1o l\u00F4 th\u00E0nh c\u00F4ng!');
      }

      // Cộng dồn mủ bọt/đáy hồ vào mương tích lũy (chỉ thêm delta để tránh double-count)
      if (processStage === 'taodong') {
        var klBotDayNew = parseFloat(techParams.paramKLBotDayHo) || 0;
        var klBotDayOld = 0;
        if (id) {
          var existingBatch = batches.find(function(b) { return b.id === id; });
          klBotDayOld = parseFloat(existingBatch?.stageData?.taodong?.params?.paramKLBotDayHo) || 0;
        }
        var klDelta = klBotDayNew - klBotDayOld;
        if (klDelta !== 0) {
          await _updateCoagAccumulation(_factory(), data.lineGroup || '', klDelta, user);
        }
      }

      closeBatchModal();
      loadBatches();
    } catch (error) {
      console.error('Error saving batch:', error);
      _showToast('L\u1ED7i l\u01B0u d\u1EEF li\u1EC7u: ' + error.message, 'error');
    }
  }

  // Cộng dồn KL mủ bọt+đáy hồ vào mương tích lũy per DC/factory
  async function _updateCoagAccumulation(factory, lineGroup, klAdd, user) {
    if (!factory || !lineGroup || klAdd === 0) return;
    var docId = factory + '_' + lineGroup;
    var ref = _db().collection('coagulumStorage').doc(docId);
    try {
      var doc = await ref.get();
      if (doc.exists) {
        await ref.update({
          totalKl: ErpDb.firestore.FieldValue.increment(klAdd),
          updatedAt: new Date().toISOString(),
          updatedBy: user ? user.id : null
        });
      } else if (klAdd > 0) {
        await ref.set({
          factory: factory,
          lineGroup: lineGroup,
          status: 'tich_luy',
          totalKl: klAdd,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          updatedBy: user ? user.id : null
        });
      }
    } catch (err) {
      console.error('Error updating coagulum accumulation:', err);
    }
  }

  async function deleteBatch(id) {
    var batch = batches.find(function(b) { return b.id === id; });
    if (!batch) return;

    // Check if any line records are linked to this batch
    var linkedRecs = lineRecords.filter(function(r) {
      return (r.linkedBatches || []).some(function(lb) { return lb.batchId === id; });
    });
    if (linkedRecs.length > 0) {
      var recNames = linkedRecs.map(function(r) { return r.recordNo || r.id; }).join(', ');
      _showToast('\u0110ang c\u00F3 phi\u1EBFu DC li\u00EAn k\u1EBFt: ' + recNames + '. H\u00E3y x\u00F3a phi\u1EBFu DC tr\u01B0\u1EDBc.', 'error');
      return;
    }

    if (!(await showConfirm('B\u1EA1n c\u00F3 ch\u1EAFc mu\u1ED1n x\u00F3a l\u00F4 s\u1EA3n xu\u1EA5t n\u00E0y?'))) return;
    try {
      // Revert coagulum accumulation if batch has klBotDayHo
      var klBotDay = parseFloat(batch.stageData?.taodong?.params?.paramKLBotDayHo) || 0;
      if (klBotDay > 0) {
        await _updateCoagAccumulation(_factory(), batch.lineGroup || '', -klBotDay, _user());
      }

      await BatchProcessor.deleteBatch(id);
      _showToast('\u0110\u00E3 x\u00F3a!');
      loadBatches();
      if (window.loadCoagAccumulation) window.loadCoagAccumulation();
    } catch (error) {
      _showToast('L\u1ED7i x\u00F3a d\u1EEF li\u1EC7u', 'error');
    }
  }

  function exportBatches() {
    if (batches.length === 0) { _showToast('Không có dữ liệu để xuất', 'warning'); return; }
    var shortName = SanxuatFactories ? SanxuatFactories.getShortName(_factory()) : '';
    ExportService.toExcel({
      data: batches,
      columns: [
        { key: 'batchNo', header: 'Số Hồ', width: 15 },
        { key: 'date', header: 'Ngày', width: 12, format: function(v) { return _formatDate(v); } },
        { key: 'product', header: 'Sản Phẩm', width: 14 },
        { key: 'sourceTankCode', header: 'Hồ Nguồn', width: 12 },
        { key: 'processStage', header: 'Công Đoạn', width: 18, format: function(v) { return SanxuatStages.getStageLabel(v, _factory(), currentProductionLine); } },
        { key: 'inputWeight', header: 'KL Đầu Vào (kg)', width: 16, format: function(v) { return _formatNumber(v); } },
        { key: 'outputWeight', header: 'KL Đầu Ra (kg)', width: 16, format: function(v) { return _formatNumber(v); } },
        { key: 'inputWeight', header: 'Hiệu Suất (%)', width: 14, format: function(v, item) { return v > 0 ? ((item.outputWeight || 0) / v * 100).toFixed(1) : '0'; } },
        { key: 'status', header: 'Trạng Thái', width: 14, format: function(v) { return v === 'completed' ? 'Hoàn thành' : 'Đang xử lý'; } }
      ],
      fileName: 'LoSanXuat_' + shortName,
      sheetName: 'Lô Sản Xuất'
    });
  }

  function createBatchFromStep() {
    openBatchModal(null);
    setTimeout(function() {
      var stageEl = _el('batchStage');
      if (stageEl) { stageEl.value = currentStage || 'xulymu'; }
      if (window.toggleStageParams) window.toggleStageParams();
    }, 100);
  }

  async function createBatchFromTank(tankId) {
    var tank = mesTankData.find(function(t) { return t.id === tankId; });
    if (!tank) return;

    // Count existing production batches from this tank → usage count
    var tankNo = tank.tankNo || 0;
    var usageCount = 1;
    try {
      var existing = await _db().collection('productionBatches')
        .where('sourceTankNo', '==', tankNo)
        .where('factory', '==', _factory())
        .get();
      usageCount = existing.size + 1;
    } catch(e) { /* fallback to 1 */ }

    // Generate batch code: H{tankNo}/{usageCount}_{DD/MM/YY}
    var dateStr = (_el('mesDate') || {}).value || new Date().toISOString().slice(0, 10);
    var dp = dateStr.split('-');
    var batchCode = 'H' + String(tankNo).padStart(2, '0') + '/' +
      String(usageCount).padStart(2, '0') + '_' +
      dp[2] + '/' + dp[1] + '/' + dp[0].slice(-2);

    openBatchModal(null);
    setTimeout(function() {
      var batchNoEl = _el('batchNo');
      if (batchNoEl) { batchNoEl.value = batchCode; batchNoEl.readOnly = true; batchNoEl.style.opacity = '0.7'; }
      var stageEl = _el('batchStage');
      if (stageEl) stageEl.value = 'xulymu';
      if (window.toggleStageParams) window.toggleStageParams();
      var inputEl = _el('batchInputWeight');
      if (inputEl) { inputEl.value = tank.totalWeight || ''; inputEl.readOnly = true; inputEl.style.opacity = '0.7'; }
      populateBatchSourceTank(tankId);
    }, 150);
  }

  // ==================== LINE RECORD CRUD ====================

  async function openLineRecordModal(recordId) {
    var modal = _el('batchModal');
    if (!modal) return;

    // --- Shift-based access control ---
    var accessCheck = null;
    if (typeof window.canUserAccessLineRecord === 'function') {
      accessCheck = await window.canUserAccessLineRecord();
      if (!accessCheck.allowed) {
        _showToast(accessCheck.reason || 'Kh\u00F4ng c\u00F3 quy\u1EC1n t\u1EA1o phi\u1EBFu', 'error');
        return;
      }
      // When editing, check shift match for ca_sx users
      if (recordId && accessCheck.reason === 'shift') {
        var editRec = lineRecords.find(function(r) { return r.id === recordId; });
        if (editRec && editRec.shift && editRec.shift !== accessCheck.shiftCode) {
          _showToast('B\u1EA1n ch\u1EC9 \u0111\u01B0\u1EE3c s\u1EEDa phi\u1EBFu c\u1EE7a ca m\u00ECnh', 'error');
          return;
        }
      }
    }

    // Switch modal to line record mode
    _el('batchModalTitle').textContent = recordId ? 'Ch\u1EC9nh S\u1EEDa Phi\u1EBFu Ghi Nh\u1EADn' : 'T\u1EA1o Phi\u1EBFu Ghi Nh\u1EADn S\u1EA3n Xu\u1EA5t';
    _el('batchHeaderFields').style.display = 'none';
    _el('batchParamOnlyHeader').style.display = '';
    _el('batchId').value = '';

    // Show line record fields, hide batch param info
    var lineFields = _el('lineRecordFields');
    var paramInfo = _el('batchParamOnlyInfo');
    if (lineFields) lineFields.style.display = '';
    if (paramInfo) paramInfo.style.display = 'none';

    // Populate DC line dropdown — filter by access + already used
    var lineSelect = _el('lineRecordDCLine');
    var mesDateVal0 = (_el('mesDate') || {}).value || new Date().toISOString().slice(0, 10);
    if (lineSelect) {
      var dcLines = SanxuatStages.getDCLinesForFactory(_factory());
      // Filter by shift-based allowed DC lines (ca_sx users only)
      if (accessCheck && accessCheck.reason === 'shift' && accessCheck.allowedDCLines.length > 0) {
        dcLines = dcLines.filter(function(dc) { return accessCheck.allowedDCLines.indexOf(dc.id) !== -1; });
      }
      // Show all DC lines — one DC can process multiple batches (separate records)
      lineSelect.innerHTML = '<option value="">-- Ch\u1ECDn d\u00E2y chuy\u1EC1n --</option>' +
        dcLines.map(function(dc) {
          return '<option value="' + dc.id + '">' + dc.name + '</option>';
        }).join('');
    }

    // Set hidden recordId
    var recordIdEl = _el('lineRecordId');
    if (recordIdEl) recordIdEl.value = recordId || '';

    // Compute default dates: production = mesDate, taodong = mesDate - 1
    var mesDateVal = (_el('mesDate') || {}).value || new Date().toISOString().slice(0, 10);
    var tdDateEl = _el('lineRecordTaodongDate');
    var prodDateEl = _el('lineRecordProductionDate');

    if (recordId) {
      var rec = lineRecords.find(function(r) { return r.id === recordId; });
      if (rec) {
        // Populate DC line
        if (lineSelect) lineSelect.value = rec.productionLine || '';

        // Set dates from saved record
        if (prodDateEl) prodDateEl.value = rec.date || mesDateVal;
        if (tdDateEl) tdDateEl.value = rec.taodongDate || rec.date || mesDateVal;

        // Populate shift dropdown from admin, then set saved value
        if (typeof window._populateLineRecordShifts === 'function') {
          window._populateLineRecordShifts(rec.shift || '');
        }

        // Populate mu\u01A1ng checkboxes from t\u1EA1o \u0111\u00F4ng date, pre-select saved mu\u01A1ng
        if (typeof window._populateLineRecordMuongs === 'function') {
          await window._populateLineRecordMuongs(rec.muongNumbers || []);
        }

        // Hi\u1EC3n th\u00F4ng tin h\u1ED3 m\u1EE7 li\u00EAn k\u1EBFt (lo\u1EA1i m\u1EE7 + m\u01B0\u01A1ng t\u1EA1o \u0111\u00F4ng)
        if (typeof window._populateLineRecordBatchInfo === 'function') {
          window._populateLineRecordBatchInfo(rec);
        }

        // Set stage
        var stageEl = _el('batchStage');
        if (stageEl) stageEl.value = rec.currentStage || currentStage;
        if (window.toggleStageParams) window.toggleStageParams();

        // Hide shiftSelectorContainer (line records use lineRecordShift instead)
        var shiftCont = _el('shiftSelectorContainer');
        if (shiftCont) shiftCont.style.display = 'none';

        // Populate stage params from record
        var stageParams = {};
        if (rec.stageData && rec.stageData[rec.currentStage] && rec.stageData[rec.currentStage].params) {
          stageParams = rec.stageData[rec.currentStage].params;
        }
        if (window.populateStageParams) window.populateStageParams(stageParams, rec.currentStage);
        if (rec.stageData && rec.stageData[rec.currentStage] && window.loadShiftData) {
          window.loadShiftData(rec.stageData[rec.currentStage], rec.currentStage);
        }
        if (rec.currentStage === 'say' && rec.stageData && rec.stageData.say) {
          if (window.initOvenSelect) window.initOvenSelect();
          // Ensure schedule is loaded for production date (not next day)
          var sayProdDate = rec.date || ((_el('lineRecordProductionDate') || {}).value) || '';
          if (sayProdDate && window.renderDailyShiftSchedule) {
            await window.renderDailyShiftSchedule(sayProdDate);
          }
          if (window.loadOvenData) await window.loadOvenData(rec.stageData.say);
        }
      }
    } else {
      // New record defaults
      if (lineSelect) lineSelect.value = '';

      // Default dates: production = mesDate, taodong = mesDate - 1
      if (prodDateEl) prodDateEl.value = mesDateVal;
      if (tdDateEl) {
        var prevDay = new Date(mesDateVal + 'T00:00:00');
        prevDay.setDate(prevDay.getDate() - 1);
        tdDateEl.value = prevDay.getFullYear() + '-' + String(prevDay.getMonth() + 1).padStart(2, '0') + '-' + String(prevDay.getDate()).padStart(2, '0');
      }

      // Populate shift dropdown — auto-select user's shift if ca_sx
      var preSelectShift = (accessCheck && accessCheck.shiftCode) ? accessCheck.shiftCode : '';
      if (typeof window._populateLineRecordShifts === 'function') {
        window._populateLineRecordShifts(preSelectShift);
      }

      // Populate mu\u01A1ng checkboxes from t\u1EA1o \u0111\u00F4ng date (none pre-selected)
      if (typeof window._populateLineRecordMuongs === 'function') {
        await window._populateLineRecordMuongs([]);
      }

      // \u1EA8n th\u00F4ng tin h\u1ED3 li\u00EAn k\u1EBFt (ch\u01B0a c\u00F3 khi t\u1EA1o m\u1EDBi)
      var batchInfoDiv = _el('lineRecordBatchInfo');
      if (batchInfoDiv) { batchInfoDiv.style.display = 'none'; batchInfoDiv.innerHTML = ''; }

      var stageEl2 = _el('batchStage');
      if (stageEl2) stageEl2.value = currentStage || 'canmu';
      if (window.toggleStageParams) window.toggleStageParams();

      // Hide shiftSelectorContainer (line records use lineRecordShift instead)
      var shiftCont2 = _el('shiftSelectorContainer');
      if (shiftCont2) shiftCont2.style.display = 'none';

      if (window.populateStageParams) window.populateStageParams(null, null);
    }

    modal.classList.add('active');
  }

  var _savingLineRecord = false;
  async function saveLineRecord() {
    if (_savingLineRecord) return;
    _savingLineRecord = true;
    try { await _doSaveLineRecord(); } finally { _savingLineRecord = false; }
  }

  async function _doSaveLineRecord() {
    var recordIdEl = _el('lineRecordId');
    var recordId = recordIdEl ? recordIdEl.value : '';
    var lineSelect = _el('lineRecordDCLine');
    var shiftSelect = _el('lineRecordShift');
    var muongInput = _el('lineRecordMuongs');
    var stageEl = _el('batchStage');

    var dcLine = lineSelect ? lineSelect.value : '';
    var shift = shiftSelect ? shiftSelect.value : '';
    var muongStr = muongInput ? muongInput.value.trim() : '';
    var stage = stageEl ? stageEl.value : currentStage;

    if (!dcLine || !shift) {
      _showToast('Vui l\u00F2ng ch\u1ECDn d\u00E2y chuy\u1EC1n v\u00E0 ca s\u1EA3n xu\u1EA5t', 'error');
      return;
    }

    // Shift-based access control validation
    if (typeof window.canUserAccessLineRecord === 'function') {
      var saveAccess = await window.canUserAccessLineRecord();
      if (!saveAccess.allowed) {
        _showToast(saveAccess.reason || 'B\u1EA1n kh\u00F4ng c\u00F3 quy\u1EC1n t\u1EA1o phi\u1EBFu DC', 'error');
        return;
      }
      if (saveAccess.reason === 'shift' && saveAccess.allowedDCLines && saveAccess.allowedDCLines.indexOf(dcLine) === -1) {
        _showToast('B\u1EA1n kh\u00F4ng \u0111\u01B0\u1EE3c ph\u00E2n c\u00F4ng cho d\u00E2y chuy\u1EC1n n\u00E0y', 'error');
        return;
      }
    }

    // Validate canmu time overlap before saving
    if (stage === 'canmu' && typeof window._hasCanmuTimeOverlap === 'function' && window._hasCanmuTimeOverlap()) {
      _showToast('TG c\u00E1n c\u00E1c m\u01B0\u01A1ng b\u1ECB tr\u00F9ng. 1 DC ch\u1EC9 c\u00E1n 1 m\u01B0\u01A1ng t\u1EA1i 1 th\u1EDDi \u0111i\u1EC3m.', 'error');
      return;
    }

    // Parse muong numbers
    var muongNumbers = [];
    if (muongStr) {
      muongNumbers = muongStr.split(/[,\s]+/).map(function(s) { return parseInt(s.trim()); }).filter(function(n) { return !isNaN(n) && n > 0; });
    }

    // Read dates from dedicated date inputs
    var dateVal = (_el('lineRecordProductionDate') || {}).value || (_el('mesDate') || {}).value || new Date().toISOString().slice(0, 10);
    var taodongDateVal = (_el('lineRecordTaodongDate') || {}).value || dateVal;
    var techParams = window.collectStageParams ? window.collectStageParams() : {};
    var shiftData = window.collectShiftData ? window.collectShiftData(stage) : {};
    var ovenData = window.collectOvenData ? window.collectOvenData() : {};

    // Auto-link muongs to batches using taodong date (not production date)
    var linkedBatches = [];
    if (muongNumbers.length > 0) {
      try {
        linkedBatches = await LineRecordProcessor.autoLinkMuongsToBatches(muongNumbers, taodongDateVal, _factory());
      } catch (e) {
        console.warn('Auto-link muongs error:', e);
      }
    }

    var ws = getActiveWorkspace();
    var data = {
      productionLine: dcLine,
      date: dateVal,
      taodongDate: taodongDateVal,
      shift: shift,
      factory: _factory(),
      lineGroup: ws ? ws.lineGroup : 'muNuoc',
      muongNumbers: muongNumbers,
      linkedBatches: linkedBatches,
      currentStage: stage,
      status: 'processing'
    };

    // Build stageData entry with paramAuthors
    var u = _user();
    var uName = u ? (u.hoTen || u.name || '') : '';
    var now = new Date().toISOString();

    // Detect changed params for paramAuthors
    var existingRec = recordId ? lineRecords.find(function(r) { return r.id === recordId; }) : null;
    var existingSD = existingRec && existingRec.stageData ? existingRec.stageData[stage] : null;
    var existingParams = existingSD && existingSD.params ? existingSD.params : {};
    var existingAuthors = existingSD && existingSD.paramAuthors ? existingSD.paramAuthors : {};
    var paramAuthors = Object.assign({}, existingAuthors);
    var changedParamKeys = [];

    Object.keys(techParams).forEach(function(key) {
      var newVal = techParams[key];
      if (Array.isArray(newVal) || (typeof newVal === 'object' && newVal !== null)) return;
      if (newVal === '' || newVal === undefined || newVal === null) return;
      var oldVal = existingParams[key];
      if (String(newVal) !== String(oldVal || '')) {
        paramAuthors[key] = { userId: u ? u.id : null, userName: uName, at: now };
        changedParamKeys.push(key);
      }
    });
    if (!recordId) {
      Object.keys(techParams).forEach(function(key) {
        var v = techParams[key];
        if (Array.isArray(v) || (typeof v === 'object' && v !== null)) return;
        if (v !== '' && v !== undefined && v !== null && !paramAuthors[key]) {
          paramAuthors[key] = { userId: u ? u.id : null, userName: uName, at: now };
          changedParamKeys.push(key);
        }
      });
    }

    // Lưu oven ops chung vào ovenDailyOps (chỉ khi stage === 'say')
    if (stage === 'say' && ovenData && ovenData.ovenId) {
      try {
        await window._saveOvenDailyOps(ovenData.ovenId, dateVal, {
          ovenStartTime: ovenData.ovenStartTime,
          ovenReadyTime: ovenData.ovenReadyTime,
          ovenShutdownTime: ovenData.ovenShutdownTime,
          exitInterval: ovenData.exitInterval,
          tempLog: ovenData.tempLog || []
        }, u);
      } catch (e) {
        console.warn('Save ovenDailyOps error:', e);
      }
    }

    // stageEntry vẫn chứa copy ovenData (backward compat + card rendering)
    var stageEntry = Object.assign({ params: techParams, paramAuthors: paramAuthors, updatedAt: now, updatedBy: u ? u.id : null, updatedByName: uName }, shiftData, ovenData);
    if (!recordId) {
      // New record
      data.recordCode = LineRecordProcessor.generateRecordCode(dcLine, shift, dateVal);
      data.stageData = {};
      data.stageData[stage] = stageEntry;
      data.timeline = [_timelineEntry('record_created', stage, changedParamKeys.length > 0 ? { changedParams: changedParamKeys } : undefined)];
    } else {
      // Update: only set current stage entry
      data['stageData.' + stage] = stageEntry;
      data.timeline = ErpDb.firestore.FieldValue.arrayUnion(_timelineEntry('stage_saved', stage, changedParamKeys.length > 0 ? { changedParams: changedParamKeys } : undefined));
      // Auto-advance currentStage if saving at a higher stage (parallel pipeline)
      if (existingRec) {
        var _existIdx = LineRecordProcessor.getLineStageIndex(existingRec.currentStage);
        var _saveIdx = LineRecordProcessor.getLineStageIndex(stage);
        if (_saveIdx > _existIdx) {
          data.currentStage = stage;
        }
      }
    }

    try {
      await LineRecordProcessor.saveRecord(data, recordId || null, _user());
      // Shift handover saves: keep modal open, suppress toast
      if (window._shiftHandoverSaving) {
        // Just reload records silently
        loadLineRecords();
      } else {
        _showToast(recordId ? 'C\u1EADp nh\u1EADt phi\u1EBFu th\u00E0nh c\u00F4ng!' : 'T\u1EA1o phi\u1EBFu th\u00E0nh c\u00F4ng!');
        _el('batchModal').classList.remove('active');
        loadLineRecords();
      }
    } catch (e) {
      console.error('Save line record error:', e);
      _showToast('L\u1ED7i l\u01B0u phi\u1EBFu: ' + e.message, 'error');
    }
  }

  async function deleteLineRecord(recordId) {
    var rec = lineRecords.find(function(r) { return r.id === recordId; });
    if (!(await showConfirm('B\u1EA1n c\u00F3 ch\u1EAFc mu\u1ED1n x\u00F3a phi\u1EBFu ghi nh\u1EADn n\u00E0y?'))) return;
    try {
      await LineRecordProcessor.deleteRecord(recordId);
      _showToast('\u0110\u00E3 x\u00F3a phi\u1EBFu!');

      // Trả batch về trạng thái taodong nếu không còn phiếu DC nào liên kết
      if (rec && rec.linkedBatches && rec.linkedBatches.length > 0) {
        await _revertLinkedBatches(rec);
      }

      loadLineRecords();
      loadBatches();
    } catch (e) {
      _showToast('L\u1ED7i x\u00F3a phi\u1EBFu', 'error');
    }
  }

  // Kiểm tra và revert linked batches khi xóa phiếu DC
  async function _revertLinkedBatches(deletedRec) {
    var remainingRecs = lineRecords.filter(function(r) { return r.id !== deletedRec.id; });
    for (var i = 0; i < deletedRec.linkedBatches.length; i++) {
      var lb = deletedRec.linkedBatches[i];
      // Kiểm tra batch này còn được phiếu DC nào khác liên kết không
      var stillLinked = remainingRecs.some(function(r) {
        return (r.linkedBatches || []).some(function(rlb) { return rlb.batchId === lb.batchId; });
      });
      if (!stillLinked) {
        // Kh\u00F4ng c\u00F2n phi\u1EBFu n\u00E0o \u2192 tr\u1EA3 batch v\u1EC1 taodong_done (\u0111\u00E3 ho\u00E0n t\u1EA5t t\u1EA1o \u0111\u00F4ng, s\u1EB5n s\u00E0ng li\u00EAn k\u1EBFt l\u1EA1i)
        try {
          await _db().collection('productionBatches').doc(lb.batchId).update({
            status: 'taodong_done',
            updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) {
          console.error('Error reverting batch ' + lb.batchId + ':', e);
        }
      }
    }
  }

  async function advanceLineRecord(recordId) {
    var rec = lineRecords.find(function(r) { return r.id === recordId; });
    if (!rec) return;
    var nextStage = LineRecordProcessor.getNextLineStage(rec.currentStage);
    var label = nextStage ? SanxuatStages.getStageLabelByProduct(nextStage, currentProduct) : 'Ho\u00E0n th\u00E0nh';
    if (!(await showConfirm('Chuy\u1EC3n phi\u1EBFu sang: ' + label + '?'))) return;
    try {
      await LineRecordProcessor.advanceRecord(recordId, rec, _user());
      // Timeline entry for advance
      await _db().collection('productionLineRecords').doc(recordId).update({
        timeline: ErpDb.firestore.FieldValue.arrayUnion(_timelineEntry('record_advanced', rec.currentStage, { fromStage: rec.currentStage, toStage: nextStage || 'completed' }))
      });
      _showToast('Chuy\u1EC3n b\u01B0\u1EDBc th\u00E0nh c\u00F4ng!');
      loadLineRecords();
    } catch (e) {
      _showToast('L\u1ED7i chuy\u1EC3n b\u01B0\u1EDBc: ' + e.message, 'error');
    }
  }

  async function revertLineRecord(recordId) {
    var rec = lineRecords.find(function(r) { return r.id === recordId; });
    if (!rec) return;
    var prevStage = LineRecordProcessor.getPrevLineStage(rec.currentStage);
    if (!prevStage) { _showToast('\u0110\u00E3 \u1EDF b\u01B0\u1EDBc \u0111\u1EA7u ti\u00EAn', 'warning'); return; }
    if (!(await showConfirm('Quay l\u1EA1i b\u01B0\u1EDBc: ' + SanxuatStages.getStageLabelByProduct(prevStage, currentProduct) + '?'))) return;
    try {
      await LineRecordProcessor.revertRecord(recordId, rec, _user());
      // Timeline entry for revert
      await _db().collection('productionLineRecords').doc(recordId).update({
        timeline: ErpDb.firestore.FieldValue.arrayUnion(_timelineEntry('record_reverted', rec.currentStage, { fromStage: rec.currentStage, toStage: prevStage }))
      });
      _showToast('Quay l\u1EA1i b\u01B0\u1EDBc th\u00E0nh c\u00F4ng!');
      loadLineRecords();
    } catch (e) {
      _showToast('L\u1ED7i quay l\u1EA1i: ' + e.message, 'error');
    }
  }

  function createLineRecordFromStep() {
    openLineRecordModal(null);
  }

  async function completeLineRecord(recordId) {
    var rec = lineRecords.find(function(r) { return r.id === recordId; });
    if (!rec) return;
    if (!(await showConfirm('X\u00E1c nh\u1EADn ho\u00E0n th\u00E0nh phi\u1EBFu n\u00E0y?'))) return;
    try {
      var u = _user();
      await _db().collection('productionLineRecords').doc(recordId).update({
        status: 'completed',
        currentStage: 'baogoi',
        'stageData.baogoi.completedAt': ErpDb.firestore.FieldValue.serverTimestamp(),
        'stageData.baogoi.completedBy': u ? u.id : null,
        'stageData.baogoi.completedByName': u ? (u.hoTen || u.name || '') : '',
        updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
        updatedBy: u ? u.id : null,
        timeline: ErpDb.firestore.FieldValue.arrayUnion(
          _timelineEntry('record_completed', 'baogoi')
        )
      });
      _showToast('Phi\u1EBFu \u0111\u00E3 ho\u00E0n th\u00E0nh!', 'success');
      loadLineRecords();
    } catch (e) {
      _showToast('L\u1ED7i ho\u00E0n th\u00E0nh: ' + e.message, 'error');
    }
  }

  // ==================== PUBLIC API ====================
  return {
    // State access
    getBatches: function() { return batches; },
    getLineRecords: function() { return lineRecords; },
    getMesTankData: function() { return mesTankData; },
    getCurrentStage: function() { return currentStage; },
    getCurrentProductionLine: function() { return currentProductionLine; },
    getCurrentWorkspace: function() { return currentWorkspace; },
    getCurrentProduct: function() { return currentProduct; },
    getSelectedMESTank: function() { return selectedMESTank; },

    // Core
    loadBatches: loadBatches,
    loadLineRecords: loadLineRecords,
    renderBatches: renderBatches,
    applyBatchFilters: applyBatchFilters,

    // Workspace
    initWorkspaceTabs: initWorkspaceTabs,
    selectWorkspace: selectWorkspace,
    onMESProductChange: onMESProductChange,

    // Legacy compat
    initProductionLineSelector: initProductionLineSelector,
    selectProductionLine: selectProductionLine,

    // Stage
    selectStage: selectStage,
    renderStepDashboard: renderStepDashboard,

    // MES Tanks
    loadMESTanks: loadMESTanks,
    renderMESTankCards: renderMESTankCards,
    selectMESTank: selectMESTank,

    // Date
    initMESDate: initMESDate,
    onMESDateChange: onMESDateChange,

    // Batch CRUD
    openBatchModal: openBatchModal,
    closeBatchModal: closeBatchModal,
    editBatch: editBatch,
    saveBatch: saveBatch,
    deleteBatch: deleteBatch,
    exportBatches: exportBatches,
    createBatchFromStep: createBatchFromStep,
    createBatchFromTank: createBatchFromTank,
    populateBatchSourceTank: populateBatchSourceTank,

    // Line Record CRUD
    openLineRecordModal: openLineRecordModal,
    saveLineRecord: saveLineRecord,
    deleteLineRecord: deleteLineRecord,
    advanceLineRecord: advanceLineRecord,
    revertLineRecord: revertLineRecord,
    completeLineRecord: completeLineRecord,
    createLineRecordFromStep: createLineRecordFromStep,

    // Internal (exposed for inline code)
    _timelineEntry: _timelineEntry,
    _updateCoagAccumulation: _updateCoagAccumulation,

    // Init
    init: function() {
      loadBatches();
      loadLineRecords();
      initWorkspaceTabs();
      initMESDate();
    }
  };
})();
