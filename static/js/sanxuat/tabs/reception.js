/**
 * Tab 2: Tiếp Nhận Nguyên Liệu - Reception & weighing (5 sub-tabs)
 * Sub-tabs: Sản lượng xe, Hồ phối liệu, Ngăn mủ tạp, Tồn trữ mủ đông, Sai lệch DRC
 * @module TabReception
 * @depends SanxuatFactories, SanxuatStages
 */

const TabReception = (function() {
  'use strict';

  // === State ===
  let factoryReceipts = [];
  let blendingBatches = [];
  let miscStorageLots = [];
  let miscCompartmentStatus = {};
  let coagStorageLots = []; // kept for backward compat
  let receipts = [];
  let currentSubTab = 0;

  // Real-time listener state
  let _harvestUnsubscribe = null;
  let _manualUnsubscribe = null;
  let _listenDate = null; // date currently being listened to
  let _harvestDocs = [];  // raw snapshot docs from harvestData
  let _manualDocs = [];   // raw snapshot docs from factoryReceipts

  // === Helpers ===
  function _db() { return ErpDb.firestore(); }
  function _user() { return window.currentUser; }
  function _factory() { return window.currentFactory; }
  function _showToast(msg, type) { if (window.showToast) window.showToast(msg, type); }
  function _formatNumber(n) { return window.formatNumber ? window.formatNumber(n) : String(n); }
  function _formatDate(d) { return window.formatDate ? window.formatDate(d) : ''; }
  function _generateCode(prefix) { return window.generateCode ? window.generateCode(prefix) : prefix + Date.now(); }
  function _el(id) { return document.getElementById(id); }

  /** Sync module state to window so inline rendering functions can read it */
  function _syncToWindow() {
    window.factoryReceipts = factoryReceipts;
    window.blendingBatches = blendingBatches;
    window.miscStorageLogs = miscStorageLots;
    window.miscCompartmentStatus = miscCompartmentStatus;
    window.coagStorageLots = coagStorageLots;
  }

  // ==================== SUB-TAB NAVIGATION ====================

  function showSubTab(index) {
    // Stop receipt listeners when leaving sub-tab 0
    if (currentSubTab === 0 && index !== 0) _stopReceiptListeners();
    currentSubTab = index;
    document.querySelectorAll('.sub-tab').forEach(function(tab, i) {
      tab.classList.toggle('active', i === index);
    });
    for (var i = 0; i <= 4; i++) {
      var el = document.getElementById('subTab' + i);
      if (el) el.style.display = (i === index) ? 'block' : 'none';
    }
    switch (index) {
      case 0: loadFactoryReceipts(); break;
      case 1: loadBlendingBatches(); break;
      case 2: loadMiscStorage(); break;
      case 3: loadCoagStorage(); break;
      case 4: loadDiscrepancyData(); break;
    }
  }

  // ==================== SUB-TAB 0: FACTORY RECEIPTS ====================

  /** Process raw snapshot docs into factoryReceipts and render */
  function _processReceiptData() {
    var selectedDate = _listenDate || '';
    factoryReceipts = [];
    var stt = 0;

    var seenSoCt = new Set();
    var skippedPurchase = 0, skippedFactory = 0;
    _harvestDocs.forEach(function(doc) {
      var d = doc.data();
      if (d.source === 'ZEN_PURCHASE') { skippedPurchase++; return; }
      var zenDvcs = (d.zenDvcs || '').toUpperCase();
      if (zenDvcs !== _factory() && zenDvcs !== 'ALL') { skippedFactory++; return; }

      var soCt = d.soCt || doc.id;
      if (seenSoCt.has(soCt)) return;
      seenSoCt.add(soCt);

      stt++;
      factoryReceipts.push({
        id: doc.id, stt: stt,
        receiptNo: 'ZEN-' + selectedDate.replace(/-/g, '') + '-' + stt,
        vehicleNo: d.soXe || d.vehicleNo || '-',
        plantation: d.donVi || '',
        materialType: (d.muNuoc > 0) ? 'latex' : 'misc',
        netWeight: d.muNuoc || 0, drcPercent: d.drc || 0, dryWeight: d.tongQKho || 0,
        muNuoc: d.muNuoc || 0, qkMuNuoc: d.qkMuNuoc || 0,
        muChen: d.muChen || 0, qkMuChen: d.qkMuChen || 0,
        muDay: d.muDay || 0, qkMuDay: d.qkMuDay || 0,
        muDong: d.muDong || 0, qkMuDong: d.qkMuDong || 0,
        tongQKho: d.tongQKho || 0,
        source: 'ZEN', zenDvcs: zenDvcs,
        status: d.assignedTo ? 'assigned' : 'weighed',
        assignedTo: d.assignedTo || ''
      });
    });
    if (skippedPurchase > 0 || skippedFactory > 0) {
      console.log('[Reception] Skipped: ' + skippedPurchase + ' purchase, ' + skippedFactory + ' factory mismatch. Loaded: ' + factoryReceipts.length + ' ZEN records');
    }

    _manualDocs.forEach(function(doc) {
      var d = doc.data();
      stt++;
      factoryReceipts.push({
        id: doc.id, stt: stt,
        receiptNo: d.receiptNo || '', vehicleNo: d.vehicleNo || '',
        plantation: d.plantation || '', materialType: d.materialType || 'latex',
        netWeight: d.netWeight || 0, drcPercent: d.drcPercent || 0,
        dryWeight: d.dryWeight || 0,
        source: 'MANUAL', status: d.status || 'weighed',
        assignedTo: d.assignedTo || ''
      });
    });

    _syncToWindow();
    if (window.renderFactoryReceiptTable) window.renderFactoryReceiptTable();
    if (window.updateFactoryReceiptStats) window.updateFactoryReceiptStats();
  }

  /** Stop active Firestore listeners */
  function _stopReceiptListeners() {
    if (_harvestUnsubscribe) { _harvestUnsubscribe(); _harvestUnsubscribe = null; }
    if (_manualUnsubscribe) { _manualUnsubscribe(); _manualUnsubscribe = null; }
    _harvestDocs = [];
    _manualDocs = [];
    _listenDate = null;
  }

  /** Load factory receipts with real-time onSnapshot listeners */
  function loadFactoryReceipts() {
    var dateInput = _el('factoryReceiptDate');
    if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
    var selectedDate = dateInput.value;

    // If already listening to this date, no need to re-subscribe
    if (_listenDate === selectedDate && _harvestUnsubscribe) return;

    // Stop previous listeners before starting new ones
    _stopReceiptListeners();
    _listenDate = selectedDate;

    var tbody = _el('factoryReceiptBody');
    var tfoot = _el('factoryReceiptFoot');
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#64748b;">\u0110ang t\u1EA3i...</td></tr>';
    tfoot.innerHTML = '';

    var harvestReady = false, manualReady = false;

    // Listener 1: harvestData (ZEN)
    _harvestUnsubscribe = _db().collection('harvestData')
      .where('importDate', '==', selectedDate)
      .onSnapshot(function(snapshot) {
        _harvestDocs = snapshot.docs;
        console.log('[Reception] harvestData realtime: date=' + selectedDate + ', count=' + snapshot.size);
        harvestReady = true;
        if (manualReady) _processReceiptData();
      }, function(error) {
        console.warn('harvestData listener error:', error.message);
        harvestReady = true;
        if (manualReady) _processReceiptData();
      });

    // Listener 2: factoryReceipts (manual)
    _manualUnsubscribe = _db().collection('factoryReceipts')
      .where('date', '==', selectedDate)
      .where('factory', '==', _factory())
      .onSnapshot(function(snapshot) {
        _manualDocs = snapshot.docs;
        manualReady = true;
        if (harvestReady) _processReceiptData();
      }, function(error) {
        console.warn('factoryReceipts listener error:', error.message);
        manualReady = true;
        if (harvestReady) _processReceiptData();
      });
  }

  async function syncFactoryZenData() {
    var dvcs = _el('factoryZenDvcs').value;
    var ngay1 = _el('factoryZenDateFrom').value;
    var ngay2 = _el('factoryZenDateTo').value;
    var clearExisting = (_el('factoryZenClear') || {}).checked || false;
    var btn = _el('btnFactoryZenSync');

    if (!ngay1 || !ngay2) { if (window.showFactoryZenStatus) window.showFactoryZenStatus('\u26A0\uFE0F Vui l\u00F2ng ch\u1ECDn ng\u00E0y', 'error'); return; }
    if (ngay1 > ngay2) { if (window.showFactoryZenStatus) window.showFactoryZenStatus('\u26A0\uFE0F Ng\u00E0y b\u1EAFt \u0111\u1EA7u ph\u1EA3i nh\u1ECF h\u01A1n ng\u00E0y k\u1EBFt th\u00FAc', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '\u23F3 \u0110ang \u0111\u1ED3ng b\u1ED9...';
    if (window.showFactoryZenStatus) window.showFactoryZenStatus('\u23F3 \u0110ang k\u1EBFt n\u1ED1i ZEN API (' + dvcs + ')...', 'loading');

    try {
      var user = ErpDb.auth().currentUser;
      if (!user) { if (window.showFactoryZenStatus) window.showFactoryZenStatus('\u274C Vui l\u00F2ng \u0111\u0103ng nh\u1EADp', 'error'); return; }
      var idToken = await user.getIdToken();

      var response = await fetch('https://us-central1-rriv-erp.cloudfunctions.net/syncZenHarvestData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
        body: JSON.stringify({ data: { dvcs: dvcs, ngay1: ngay1, ngay2: ngay2, clearExisting: clearExisting } })
      });

      var responseData = await response.json();
      var result = responseData.result || responseData;

      if (result.success) {
        var harvestMsg = result.harvestImported ? '\uD83C\uDF3F Khai th\u00E1c: ' + result.harvestImported + ' records' : '';
        var purchaseMsg = result.purchaseImported ? '\uD83C\uDFED Thu mua: ' + result.purchaseImported + ' records' : '';
        if (window.showFactoryZenStatus) window.showFactoryZenStatus('\u2705 ' + result.message + '<br>' + harvestMsg + '<br>' + purchaseMsg, 'success');
        setTimeout(function() {
          if (window.closeFactoryZenSync) window.closeFactoryZenSync();
          // Update receipt date to match synced date range so data shows immediately
          var dateInput = _el('factoryReceiptDate');
          if (dateInput) {
            // Use today's date if within sync range, otherwise use sync start date
            var today = new Date().toISOString().slice(0, 10);
            dateInput.value = (today >= ngay1 && today <= ngay2) ? today : ngay1;
          }
          loadFactoryReceipts();
          _showToast('\u0110\u1ED3ng b\u1ED9 ZEN th\u00E0nh c\u00F4ng!', 'success');
        }, 1500);
      } else {
        if (window.showFactoryZenStatus) window.showFactoryZenStatus('\u274C ' + (result.message || '\u0110\u1ED3ng b\u1ED9 th\u1EA5t b\u1EA1i'), 'error');
      }
    } catch (error) {
      console.error('Factory ZEN sync error:', error);
      if (window.showFactoryZenStatus) window.showFactoryZenStatus('\u274C L\u1ED7i: ' + error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '\uD83D\uDD04 \u0110\u1ED3ng b\u1ED9';
    }
  }

  async function exportFactoryReceipts() {
    if (factoryReceipts.length === 0) { _showToast('Kh\u00F4ng c\u00F3 d\u1EEF li\u1EC7u', 'warning'); return; }

    // Build blending batch mapping for the export
    var batchMap = new Map();
    try {
      var selectedDate = _el('factoryReceiptDate').value;
      if (selectedDate) {
        var snapshot = await _db().collection('blendingBatches')
          .where('date', '==', selectedDate)
          .where('factory', '==', _factory())
          .get();
        snapshot.forEach(function(doc) {
          var b = doc.data();
          if (b.sourceReceipts && b.sourceReceipts.length > 0) {
            b.sourceReceipts.forEach(function(rn) {
              batchMap.set(rn, 'H' + b.tankNo + '/L' + (b.sequence || 1));
            });
          }
        });
      }
    } catch (e) { /* ignore */ }

    var data = factoryReceipts.map(function(r, idx) {
      return {
        'STT': idx + 1,
        'S\u1ED1 Xe': r.vehicleNo,
        'N\u00F4ng Tr\u01B0\u1EDDng': r.plantation,
        'M\u1EE7 n\u01B0\u1EDBc (KG)': r.muNuoc || '',
        'DRC (%)': r.drcPercent || '',
        'MN Q.Kh\u00F4': r.qkMuNuoc || '',
        'M\u1EE7 ch\u00E9n (T\u01B0\u01A1i)': r.muChen || '',
        'MC Q.Kh\u00F4': r.qkMuChen || '',
        'M\u1EE7 d\u00E2y (T\u01B0\u01A1i)': r.muDay || '',
        'MD Q.Kh\u00F4': r.qkMuDay || '',
        'M\u1EE7 \u0111\u00F4ng (T\u01B0\u01A1i)': r.muDong || '',
        'M\u0110 Q.Kh\u00F4': r.qkMuDong || '',
        'T\u1ED5ng Q.Kh\u00F4': r.tongQKho || '',
        'Ngu\u1ED3n': r.source,
        'H\u1ED3 Ph\u1ED1i Li\u1EC7u': batchMap.get(r.id) || batchMap.get(r.receiptNo) || ''
      };
    });
    var ws = XLSX.utils.json_to_sheet(data);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S\u1EA3n l\u01B0\u1EE3ng xe');
    var shortName = window.getFactoryShortName ? window.getFactoryShortName() : _factory();
    XLSX.writeFile(wb, 'SanLuongXe_' + shortName + '_' + _el('factoryReceiptDate').value + '.xlsx');
    _showToast('\u0110\u00E3 xu\u1EA5t Excel!');
  }

  // ==================== SUB-TAB 1: BLENDING BATCHES ====================

  async function loadBlendingBatches() {
    var dateInput = _el('blendingDate');
    if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
    var selectedDate = dateInput.value;

    try {
      var snapshot = await _db().collection('blendingBatches')
        .where('date', '==', selectedDate)
        .orderBy('batchCode', 'asc')
        .get();
      blendingBatches = snapshot.docs.map(function(doc) {
        return Object.assign({ id: doc.id }, doc.data());
      }).filter(function(d) { return !d.factory || d.factory === _factory(); });
    } catch (error) {
      console.warn('Load blending batches error:', error.message);
      blendingBatches = [];
    }

    _syncToWindow();
    if (window.renderTankCards) window.renderTankCards();
    if (window.renderBlendingBatchTable) window.renderBlendingBatchTable();
  }

  function openBlendingBatchModal(id) {
    _el('blendingBatchTitle').textContent = id ? 'S\u1EEDa H\u1ED3 Ph\u1ED1i Li\u1EC7u' : 'T\u1EA1o H\u1ED3 Ph\u1ED1i Li\u1EC7u';
    _el('blendingBatchId').value = id || '';

    var blendingDateVal = _el('blendingDate').value || new Date().toISOString().slice(0, 10);
    _el('bbDate').value = blendingDateVal;

    if (id) {
      var b = null;
      for (var i = 0; i < blendingBatches.length; i++) {
        if (blendingBatches[i].id === id) { b = blendingBatches[i]; break; }
      }
      if (b) {
        _el('bbTankNo').value = b.tankNo;
        _el('bbBatchCode').value = b.batchCode;
        _el('bbSequence').value = 'L\u1EA7n ' + (b.sequence || 1);
        _el('bbStatus').value = b.status;
        if (b.date) _el('bbDate').value = b.date;
        _el('bbTotalWeight').textContent = _formatNumber(b.totalWeight || 0) + ' kg';
        _el('bbAvgDRC').textContent = (b.avgDRC || 0).toFixed(1) + '%';
        _el('bbTotalDry').textContent = _formatNumber(b.totalDryWeight || 0) + ' kg';
      }
    } else {
      _el('bbTankNo').value = '1';
      _el('bbStatus').value = 'filling';
      _el('bbTotalWeight').textContent = '0 kg';
      _el('bbAvgDRC').textContent = '0%';
      _el('bbTotalDry').textContent = '0 kg';
      if (window.previewBatchCode) window.previewBatchCode();
    }

    if (window.renderAvailableLatexReceipts) window.renderAvailableLatexReceipts(id);
    _el('blendingBatchModal').classList.add('active');
  }

  async function saveBlendingBatch() {
    var id = _el('blendingBatchId').value;
    var tankNo = parseInt(_el('bbTankNo').value);
    var batchCode = _el('bbBatchCode').value;
    var status = _el('bbStatus').value;
    var date = _el('bbDate').value || _el('blendingDate').value;

    var checks = document.querySelectorAll('.bb-receipt-check:checked');
    var sourceReceipts = [];
    var totalWeight = 0, totalDry = 0, drcSum = 0, drcWeight = 0;
    checks.forEach(function(c) {
      sourceReceipts.push(c.value);
      var w = parseFloat(c.dataset.weight) || 0;
      var drc = parseFloat(c.dataset.drc) || 0;
      var dry = parseFloat(c.dataset.dry) || 0;
      totalWeight += w; totalDry += dry;
      drcSum += drc * w; drcWeight += w;
    });

    var avgDRC = drcWeight > 0 ? drcSum / drcWeight : 0;
    var sequence = 1;
    if (batchCode.indexOf('/') !== -1) {
      sequence = parseInt(batchCode.split('/')[1]) || 1;
    } else {
      var parts = batchCode.split('-');
      sequence = parseInt(parts[parts.length - 1]) || 1;
    }

    // Khi t\u1EA1o m\u1EDBi: query Firestore tr\u1EF1c ti\u1EBFp \u0111\u1EC3 ki\u1EC3m tra h\u1ED3 c\u0169 c\u00F9ng tank
    if (!id) {
      try {
        var prevSnap = await _db().collection('blendingBatches')
          .where('date', '==', date)
          .where('tankNo', '==', tankNo)
          .where('factory', '==', _factory())
          .get();
        console.log('[BlendingBatch] Tank ' + tankNo + ' date=' + date + ': found ' + prevSnap.size + ' in Firestore');
        for (var pi = 0; pi < prevSnap.docs.length; pi++) {
          var pbDoc = prevSnap.docs[pi];
          var pb = pbDoc.data();
          var prodSnap = await _db().collection('productionBatches')
            .where('sourceTankId', '==', pbDoc.id)
            .get();
          if (prodSnap.empty) {
            _showToast('H\u1ED3 ' + tankNo + ' (' + (pb.batchCode || '') + ') ch\u01B0a t\u1EA1o h\u1ED3 SX. Ho\u00E0n th\u00E0nh t\u1EA1o \u0111\u00F4ng tr\u01B0\u1EDBc.', 'error');
            return;
          }
          var allDone = true;
          prodSnap.forEach(function(doc) {
            if (doc.data().status !== 'taodong_done') allDone = false;
          });
          if (!allDone) {
            _showToast('H\u1ED3 ' + tankNo + ' (' + (pb.batchCode || '') + ') ch\u01B0a xong t\u1EA1o \u0111\u00F4ng. Ho\u00E0n th\u00E0nh tr\u01B0\u1EDBc.', 'error');
            return;
          }
        }
      } catch (e) {
        console.warn('[BlendingBatch] Validation error:', e.message);
      }
    }

    var user = _user();
    var saveData = {
      batchCode: batchCode, tankNo: tankNo, date: date, sequence: sequence,
      sourceReceipts: sourceReceipts,
      totalWeight: totalWeight,
      avgDRC: parseFloat(avgDRC.toFixed(2)),
      totalDryWeight: parseFloat(totalDry.toFixed(2)),
      status: status, factory: _factory(),
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedBy: user ? user.id : null
    };

    try {
      if (id) {
        await _db().collection('blendingBatches').doc(id).update(saveData);
        _showToast('C\u1EADp nh\u1EADt h\u1ED3 ph\u1ED1i li\u1EC7u th\u00E0nh c\u00F4ng!');
      } else {
        saveData.createdAt = ErpDb.firestore.FieldValue.serverTimestamp();
        saveData.createdBy = user ? user.id : null;
        await _db().collection('blendingBatches').add(saveData);
        _showToast('T\u1EA1o h\u1ED3 ph\u1ED1i li\u1EC7u th\u00E0nh c\u00F4ng!');
      }
    } catch (error) {
      console.warn('Save batch error:', error.message);
      _showToast('\u0110\u00E3 l\u01B0u offline!', 'warning');
    }

    if (window.closeBlendingBatchModal) window.closeBlendingBatchModal();
    await loadBlendingBatches();
    // Re-render receipt table to update blending batch column
    if (window.renderFactoryReceiptTable) window.renderFactoryReceiptTable();
  }

  async function deleteBlendingBatch(id) {
    // Check if any production batches reference this blending batch
    try {
      var linked = await _db().collection('productionBatches')
        .where('sourceTankId', '==', id)
        .get();
      if (linked.size > 0) {
        var names = linked.docs.map(function(d) { return d.data().batchNo || d.id; }).join(', ');
        _showToast('\u0110ang c\u00F3 h\u1ED3 s\u1EA3n xu\u1EA5t li\u00EAn k\u1EBFt: ' + names + '. H\u00E3y x\u00F3a h\u1ED3 SX tr\u01B0\u1EDBc.', 'error');
        return;
      }
    } catch (e) { /* ignore query error, proceed with confirm */ }

    if (!(await showConfirm('B\u1EA1n c\u00F3 ch\u1EAFc mu\u1ED1n x\u00F3a h\u1ED3 ph\u1ED1i li\u1EC7u n\u00E0y?'))) return;
    try {
      await _db().collection('blendingBatches').doc(id).delete();
      _showToast('\u0110\u00E3 x\u00F3a!');
      loadBlendingBatches();
      // Re-render receipt table to update blending batch column
      if (window.renderFactoryReceiptTable) window.renderFactoryReceiptTable();
    } catch (error) {
      _showToast('L\u1ED7i x\u00F3a: ' + error.message, 'error');
    }
  }

  // ==================== SUB-TAB 2: MISC STORAGE ====================

  async function loadMiscStorage() {
    var dateInput = _el('miscStorageDate');
    if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);

    try {
      // Load ALL logs for this factory (no date filter — compartments accumulate)
      var factory = _factory();
      var snapshot = await _db().collection('miscStorageLogs')
        .where('factory', '==', factory)
        .orderBy('date', 'asc')
        .get();
      miscStorageLots = snapshot.docs.map(function(doc) {
        return Object.assign({ id: doc.id }, doc.data());
      });

      // Load compartment status documents
      var statusSnap = await _db().collection('miscCompartments')
        .where('factory', '==', factory)
        .get();
      miscCompartmentStatus = {};
      statusSnap.docs.forEach(function(doc) {
        miscCompartmentStatus[doc.id] = Object.assign({ id: doc.id }, doc.data());
      });
    } catch (error) {
      console.warn('Load misc storage error:', error.message);
      miscStorageLots = [];
      miscCompartmentStatus = {};
    }

    _syncToWindow();
    if (window.renderCompartmentCards) window.renderCompartmentCards();
    if (window.renderMiscStorageTable) window.renderMiscStorageTable();
  }

  // ==================== SUB-TAB 3: DRC DISCREPANCY ====================

  async function loadDiscrepancyData() {
    var monthEl = _el('discrepancyMonth');
    var month = monthEl ? monthEl.value : '';
    if (!month) return;
    var startDate = month + '-01';
    var endParts = month.split('-');
    var endD = new Date(parseInt(endParts[0]), parseInt(endParts[1]), 0);
    var endDate = endD.toISOString().slice(0, 10);

    var allDeliveries = window.deliveries || [];
    var fieldData = allDeliveries.filter(function(d) {
      var dt = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString().slice(0, 10) : (d.createdAt || '');
      return dt >= startDate && dt <= endDate && d.materialType === 'latex' && d.drcPercent > 0;
    });

    var tbody = _el('discrepancyBody');
    if (fieldData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;">Kh\u00F4ng c\u00F3 d\u1EEF li\u1EC7u giao nh\u1EADn m\u1EE7 n\u01B0\u1EDBc trong th\u00E1ng n\u00E0y</td></tr>';
      _el('discrepancyCount').textContent = '0';
      _el('avgFieldDRC').textContent = '0%';
      _el('avgFactoryDRC').textContent = '0%';
      _el('avgDiscrepancy').textContent = '0%';
      return;
    }

    var comparisons = [];
    fieldData.forEach(function(fd) {
      var fdDate = fd.createdAt && fd.createdAt.toDate ? fd.createdAt.toDate().toISOString().slice(0, 10) : fd.createdAt;
      var factoryMatch = null;
      for (var i = 0; i < factoryReceipts.length; i++) {
        var fr = factoryReceipts[i];
        if (fr.bienSoXe === fd.vehicleNo && fr.ngay === fdDate && fr.drcMuNuoc > 0) {
          factoryMatch = fr; break;
        }
      }
      comparisons.push({
        date: fdDate, vehicle: fd.vehicleNo || fd.deliveryNo,
        team: fd.team || '-',
        fieldDRC: fd.drcPercent,
        factoryDRC: factoryMatch ? factoryMatch.drcMuNuoc : null,
        diff: factoryMatch ? (fd.drcPercent - factoryMatch.drcMuNuoc).toFixed(1) : null
      });
    });

    var matched = comparisons.filter(function(c) { return c.factoryDRC !== null; });
    var avgField = matched.length ? (matched.reduce(function(s, c) { return s + c.fieldDRC; }, 0) / matched.length).toFixed(1) : '0';
    var avgFactory = matched.length ? (matched.reduce(function(s, c) { return s + c.factoryDRC; }, 0) / matched.length).toFixed(1) : '0';
    var avgDiff = matched.length ? (matched.reduce(function(s, c) { return s + parseFloat(c.diff); }, 0) / matched.length).toFixed(2) : '0';

    _el('discrepancyCount').textContent = matched.length;
    _el('avgFieldDRC').textContent = avgField + '%';
    _el('avgFactoryDRC').textContent = avgFactory + '%';
    _el('avgDiscrepancy').textContent = avgDiff + '%';
    var card = _el('discrepancyCard');
    if (card) card.className = 'summary-card ' + (Math.abs(parseFloat(avgDiff)) > 2 ? 'danger' : 'success');

    tbody.innerHTML = comparisons.map(function(c) {
      var diffAbs = c.diff !== null ? Math.abs(parseFloat(c.diff)) : 0;
      var diffColor = diffAbs > 2 ? 'color:var(--danger);font-weight:700' : diffAbs > 1 ? 'color:#d97706' : 'color:#16a34a';
      return '<tr>' +
        '<td>' + _formatDate(c.date) + '</td>' +
        '<td>' + c.vehicle + '</td>' +
        '<td>' + c.team + '</td>' +
        '<td><strong>' + c.fieldDRC + '%</strong></td>' +
        '<td>' + (c.factoryDRC !== null ? '<strong>' + c.factoryDRC + '%</strong>' : '<em style="color:#94a3b8">Ch\u01B0a c\u00F3</em>') + '</td>' +
        '<td style="' + diffColor + '">' + (c.diff !== null ? (parseFloat(c.diff) > 0 ? '+' : '') + c.diff + '%' : '-') + '</td>' +
        '<td>' + (c.diff === null ? '<span style="color:#94a3b8">Ch\u01B0a match</span>' : diffAbs > 2 ? '<span style="color:var(--danger)">C\u1EA7n ki\u1EC3m tra</span>' : '<span style="color:#16a34a">B\u00ECnh th\u01B0\u1EDDng</span>') + '</td>' +
        '</tr>';
    }).join('');
  }

  // ==================== LEGACY RECEIPTS ====================

  async function loadReceipts() {
    try {
      var snapshot = await _db().collection('materialReceipts')
        .orderBy('createdAt', 'desc').limit(100).get();
      receipts = snapshot.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); })
        .filter(function(d) { return !d.factory || d.factory === _factory(); });
    } catch (error) {
      console.error('Error loading receipts:', error);
    }
    return receipts;
  }

  // ==================== PUBLIC API ====================
  return {
    // State access
    getFactoryReceipts: function() { return factoryReceipts; },
    getBlendingBatches: function() { return blendingBatches; },
    getMiscStorageLots: function() { return miscStorageLots; },
    getCoagStorageLots: function() { return []; }, // deprecated
    getReceipts: function() { return receipts; },

    // Navigation
    showSubTab: showSubTab,

    // Sub-tab 0: Factory Receipts
    loadFactoryReceipts: loadFactoryReceipts,
    stopReceiptListeners: _stopReceiptListeners,
    syncFactoryZenData: syncFactoryZenData,
    exportFactoryReceipts: exportFactoryReceipts,

    // Sub-tab 1: Blending Batches
    loadBlendingBatches: loadBlendingBatches,
    openBlendingBatchModal: openBlendingBatchModal,
    saveBlendingBatch: saveBlendingBatch,
    deleteBlendingBatch: deleteBlendingBatch,

    // Sub-tab 2: Misc Storage
    loadMiscStorage: loadMiscStorage,

    // Sub-tab 3: Discrepancy
    loadDiscrepancyData: loadDiscrepancyData,

    // Legacy
    loadReceipts: loadReceipts,

    // Init
    init: function() {
      var factoryLabel = document.getElementById('tab2FactoryLabel');
      if (factoryLabel) factoryLabel.textContent = SanxuatFactories ? SanxuatFactories.getName(_factory()) : '';
      loadFactoryReceipts();
    }
  };
})();
