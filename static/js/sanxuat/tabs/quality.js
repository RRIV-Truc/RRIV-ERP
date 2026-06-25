/**
 * Tab 4: KCS/Lab - Quality testing & TCCS compliance
 * @module TabQuality
 */

const TabQuality = (function() {
  'use strict';

  let tests = [];

  function _db() { return ErpDb.firestore(); }
  function _user() { return window.currentUser; }
  function _factory() { return window.currentFactory; }
  function _showToast(msg, type) { if (window.showToast) window.showToast(msg, type); }
  function _formatDate(d) { return window.formatDate ? window.formatDate(d) : ''; }
  function _formatNumber(n) { return window.formatNumber ? window.formatNumber(n) : String(n); }
  function _generateCode(prefix) { return window.generateCode ? window.generateCode(prefix) : prefix + Date.now(); }
  function _getBatches() { return window.batches || []; }
  function _getFactoryShortName() { return SanxuatFactories ? SanxuatFactories.getShortName(_factory()) : ''; }

  function getSampleTypeText(type) {
    return { 'raw': 'Nguyên liệu', 'semi': 'Bán thành phẩm', 'finished': 'Thành phẩm' }[type] || type;
  }

  async function loadTests() {
    try {
      var batches = _getBatches();
      if (batches.length === 0) {
        var batchesSnap = await _db().collection('productionBatches').orderBy('createdAt', 'desc').limit(50).get();
        batches = batchesSnap.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); });
        window.batches = batches;
      }

      var batchSelect = document.getElementById('testBatchId');
      if (batchSelect) {
        batchSelect.innerHTML = '<option value="">-- Chọn lô sản xuất --</option>' +
          batches.map(function(b) { return '<option value="' + b.id + '">' + b.batchNo + ' - ' + b.product + '</option>'; }).join('');
      }

      var snapshot = await _db().collection('qualityTests').orderBy('createdAt', 'desc').limit(100).get();
      tests = snapshot.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); })
        .filter(function(d) { return !d.factory || d.factory === _factory(); });
      renderTests();
      updateTestStats();
    } catch (error) {
      console.error('Error loading tests:', error);
      _showToast('Lỗi tải dữ liệu kiểm tra', 'error');
    }
  }

  function renderTests(data) {
    data = data || tests;
    var tbody = document.getElementById('testsTableBody');
    if (!tbody) return;
    var thead = tbody.closest('table').querySelector('thead tr');

    if (data.length === 0) {
      thead.innerHTML = '<th>Số Phiếu</th><th>Ngày</th><th>Số Lô</th><th>Loại Mẫu</th><th>DRC (%)</th><th>Tro (%)</th><th>Tạp Chất (%)</th><th>Độ Dẻo (PRI)</th><th>Kết Quả</th><th>Thao Tác</th>';
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#64748b;">Chưa có kết quả kiểm tra nào</td></tr>';
      return;
    }

    var hasLatex = data.some(function(t) { return t.testResults?.tsc_latex != null || t.testResults?.nh3_latex != null; });
    var hasSVR = data.some(function(t) { return t.testResults?.ash != null || t.testResults?.pri != null; });

    if (hasLatex && !hasSVR) {
      thead.innerHTML = '<th>Số Phiếu</th><th>Ngày</th><th>Số Lô</th><th>Loại Mẫu</th><th>TSC</th><th>DRC</th><th>NH₃</th><th>VFA</th><th>Kết Quả</th><th>Thao Tác</th>';
      tbody.innerHTML = data.map(function(t) {
        return '<tr><td><strong>' + (t.testNo || '') + '</strong></td><td>' + _formatDate(t.date) + '</td>' +
          '<td>' + (t.batchNo || '') + '</td><td>' + getSampleTypeText(t.sampleType) + '</td>' +
          '<td>' + (t.testResults?.tsc_latex || '-') + '</td><td>' + (t.testResults?.drc_latex || '-') + '</td>' +
          '<td>' + (t.testResults?.nh3_latex || '-') + '</td><td>' + (t.testResults?.vfa_latex || '-') + '</td>' +
          '<td><span class="status-badge ' + (t.passed ? 'passed' : 'failed') + '">' + (t.passed ? 'Đạt' : 'Không đạt') + '</span></td>' +
          '<td><div class="action-btns"><button class="action-btn edit" onclick="TabQuality.editTest(\'' + t.id + '\')" title="Sửa">✏️</button>' +
          '<button class="action-btn delete" onclick="TabQuality.deleteTest(\'' + t.id + '\')" title="Xóa">🗑️</button></div></td></tr>';
      }).join('');
    } else {
      thead.innerHTML = '<th>Số Phiếu</th><th>Ngày</th><th>Số Lô</th><th>Loại Mẫu</th><th>DRC (%)</th><th>Tro (%)</th><th>Tạp Chất (%)</th><th>Độ Dẻo (PRI)</th><th>Kết Quả</th><th>Thao Tác</th>';
      tbody.innerHTML = data.map(function(t) {
        var isLt = t.testResults?.tsc_latex != null;
        return '<tr><td><strong>' + (t.testNo || '') + '</strong></td><td>' + _formatDate(t.date) + '</td>' +
          '<td>' + (t.batchNo || '') + '</td><td>' + getSampleTypeText(t.sampleType) + '</td>' +
          '<td>' + (isLt ? (t.testResults?.drc_latex || '-') : (t.testResults?.drc || '-')) + '</td>' +
          '<td>' + (isLt ? (t.testResults?.nh3_latex || '-') : (t.testResults?.ash || '-')) + '</td>' +
          '<td>' + (isLt ? (t.testResults?.vfa_latex || '-') : (t.testResults?.dirt || '-')) + '</td>' +
          '<td>' + (isLt ? (t.testResults?.mst_latex || '-') : (t.testResults?.pri || '-')) + '</td>' +
          '<td><span class="status-badge ' + (t.passed ? 'passed' : 'failed') + '">' + (t.passed ? 'Đạt' : 'Không đạt') + '</span></td>' +
          '<td><div class="action-btns"><button class="action-btn edit" onclick="TabQuality.editTest(\'' + t.id + '\')" title="Sửa">✏️</button>' +
          '<button class="action-btn delete" onclick="TabQuality.deleteTest(\'' + t.id + '\')" title="Xóa">🗑️</button></div></td></tr>';
      }).join('');
    }
  }

  function updateTestStats() {
    var el = function(id) { return document.getElementById(id); };
    if (el('totalTests')) el('totalTests').textContent = tests.length;
    if (el('passedTests')) el('passedTests').textContent = tests.filter(function(t) { return t.passed; }).length;
    if (el('failedTests')) el('failedTests').textContent = tests.filter(function(t) { return !t.passed; }).length;
    var passRate = tests.length > 0
      ? (tests.filter(function(t) { return t.passed; }).length / tests.length * 100).toFixed(1) : 0;
    if (el('passRate')) el('passRate').textContent = passRate + '%';
  }

  function searchTests() {
    var keyword = (document.getElementById('testSearch')?.value || '').toLowerCase();
    var filtered = tests.filter(function(t) {
      return (t.testNo || '').toLowerCase().indexOf(keyword) !== -1 ||
             (t.batchNo || '').toLowerCase().indexOf(keyword) !== -1;
    });
    renderTests(filtered);
  }

  function filterTests() {
    var result = document.getElementById('testResultFilter')?.value || '';
    var dateFilter = document.getElementById('testDateFilter')?.value || '';
    var filtered = tests;
    if (result) filtered = filtered.filter(function(t) { return (result === 'passed') === t.passed; });
    if (dateFilter) {
      filtered = filtered.filter(function(t) {
        var d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
        return d.toISOString().slice(0, 10) === dateFilter;
      });
    }
    renderTests(filtered);
  }

  function openTestModal(id) {
    document.getElementById('testModalTitle').textContent = id ? 'Chỉnh Sửa Kết Quả Kiểm Tra' : 'Nhập Kết Quả Kiểm Tra';
    document.getElementById('testId').value = id || '';
    if (id) {
      var t = tests.find(function(x) { return x.id === id; });
      if (t) {
        document.getElementById('testNo').value = t.testNo || '';
        document.getElementById('testDate').value = t.date?.toDate ? t.date.toDate().toISOString().slice(0,10) : t.date;
        document.getElementById('testBatchId').value = t.batchId || '';
        document.getElementById('testSampleType').value = t.sampleType || 'raw';
        document.getElementById('testDRC').value = t.testResults?.drc || '';
        document.getElementById('testAsh').value = t.testResults?.ash || '';
        document.getElementById('testDirt').value = t.testResults?.dirt || '';
        document.getElementById('testPRI').value = t.testResults?.pri || '';
        document.getElementById('testVolatile').value = t.testResults?.volatile || '';
        document.getElementById('testNitrogen').value = t.testResults?.nitrogen || '';
        document.getElementById('testResult').value = t.passed ? 'passed' : 'failed';
        document.getElementById('testNotes').value = t.notes || '';
        // Latex fields
        ['testTSC_Latex','testDRC_Latex','testNH3_Latex','testVFA_Latex','testKOH_Latex',
         'testMST_Latex','testMg_Latex','testCan_Latex','testDongKet_Latex','testCu_Latex','testMn_Latex']
          .forEach(function(fid, idx) {
            var keys = ['tsc_latex','drc_latex','nh3_latex','vfa_latex','koh_latex','mst_latex','mg_latex','can_latex','dongket_latex','cu_latex','mn_latex'];
            var el = document.getElementById(fid);
            if (el) el.value = t.testResults?.[keys[idx]] || '';
          });
      }
    } else {
      document.getElementById('testNo').value = _generateCode('KQ');
      document.getElementById('testDate').value = new Date().toISOString().slice(0,10);
      document.getElementById('testBatchId').value = '';
      document.getElementById('testSampleType').value = 'raw';
      ['testDRC','testAsh','testDirt','testPRI','testVolatile','testNitrogen'].forEach(function(fid) {
        document.getElementById(fid).value = '';
      });
      document.getElementById('testResult').value = 'passed';
      document.getElementById('testNotes').value = '';
      ['testTSC_Latex','testDRC_Latex','testNH3_Latex','testVFA_Latex','testKOH_Latex',
       'testMST_Latex','testMg_Latex','testCan_Latex','testDongKet_Latex','testCu_Latex','testMn_Latex']
        .forEach(function(fid) { document.getElementById(fid).value = ''; });
    }
    toggleTestFieldsByBatch();
    document.getElementById('testModal').classList.add('active');
  }

  function toggleTestFieldsByBatch() {
    var batchId = document.getElementById('testBatchId')?.value;
    var batches = _getBatches();
    var batch = batches.find(function(b) { return b.id === batchId; });
    var latex = batch && (batch.product === 'LatexHA' || batch.product === 'LatexLA');
    var svrEl = document.getElementById('svrTestFields');
    var latexEl = document.getElementById('latexTestFields');
    if (svrEl) svrEl.style.display = latex ? 'none' : 'block';
    if (latexEl) latexEl.style.display = latex ? 'block' : 'none';
  }

  function closeTestModal() { document.getElementById('testModal').classList.remove('active'); }
  function editTest(id) { openTestModal(id); }

  async function saveTest() {
    var id = document.getElementById('testId').value;
    var testNo = document.getElementById('testNo').value.trim();
    var date = document.getElementById('testDate').value;
    var batchId = document.getElementById('testBatchId').value;
    var sampleType = document.getElementById('testSampleType').value;
    var passed = document.getElementById('testResult').value === 'passed';
    var notes = document.getElementById('testNotes').value.trim();

    var batches = _getBatches();
    var batch = batches.find(function(b) { return b.id === batchId; });
    var isLatex = batch && (batch.product === 'LatexHA' || batch.product === 'LatexLA');

    var testResults = isLatex ? {
      tsc_latex: parseFloat(document.getElementById('testTSC_Latex').value) || null,
      drc_latex: parseFloat(document.getElementById('testDRC_Latex').value) || null,
      nh3_latex: parseFloat(document.getElementById('testNH3_Latex').value) || null,
      vfa_latex: parseFloat(document.getElementById('testVFA_Latex').value) || null,
      koh_latex: parseFloat(document.getElementById('testKOH_Latex').value) || null,
      mst_latex: parseFloat(document.getElementById('testMST_Latex').value) || null,
      mg_latex: parseFloat(document.getElementById('testMg_Latex').value) || null,
      can_latex: parseFloat(document.getElementById('testCan_Latex').value) || null,
      dongket_latex: parseFloat(document.getElementById('testDongKet_Latex').value) || null,
      cu_latex: parseFloat(document.getElementById('testCu_Latex').value) || null,
      mn_latex: parseFloat(document.getElementById('testMn_Latex').value) || null
    } : {
      drc: parseFloat(document.getElementById('testDRC').value) || null,
      ash: parseFloat(document.getElementById('testAsh').value) || null,
      dirt: parseFloat(document.getElementById('testDirt').value) || null,
      pri: parseFloat(document.getElementById('testPRI').value) || null,
      volatile: parseFloat(document.getElementById('testVolatile').value) || null,
      nitrogen: parseFloat(document.getElementById('testNitrogen').value) || null
    };

    if (!testNo || !date || !batchId) {
      _showToast('Vui lòng nhập đầy đủ thông tin bắt buộc', 'error');
      return;
    }

    var data = {
      testNo: testNo, date: new Date(date), batchId: batchId, batchNo: batch?.batchNo || '',
      sampleType: sampleType, testResults: testResults, passed: passed, notes: notes,
      testedBy: _user()?.name || '', factory: _factory(),
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(), updatedBy: _user()?.id || null
    };

    try {
      if (id) {
        await _db().collection('qualityTests').doc(id).update(data);
        _showToast('Cập nhật thành công!');
      } else {
        data.createdAt = ErpDb.firestore.FieldValue.serverTimestamp();
        data.createdBy = _user()?.id || null;
        await _db().collection('qualityTests').add(data);
        _showToast('Lưu kết quả thành công!');
      }
      closeTestModal();
      loadTests();
    } catch (error) {
      console.error('Error saving test:', error);
      _showToast('Lỗi lưu dữ liệu: ' + error.message, 'error');
    }
  }

  async function deleteTest(id) {
    if (!(await showConfirm('B\u1EA1n c\u00F3 ch\u1EAFc mu\u1ED1n x\u00F3a k\u1EBFt qu\u1EA3 ki\u1EC3m tra n\u00E0y?'))) return;
    try {
      if (window.softDelete) {
        await window.softDelete('qualityTests', id);
        _showToast('\u0110\u00E3 x\u00F3a! C\u00F3 th\u1EC3 kh\u00F4i ph\u1EE5c trong Th\u00F9ng r\u00E1c.', 'info');
      } else {
        await _db().collection('qualityTests').doc(id).delete();
        _showToast('\u0110\u00E3 x\u00F3a!');
      }
      loadTests();
    } catch (error) {
      console.error('Error deleting test:', error);
      _showToast('L\u1ED7i x\u00F3a d\u1EEF li\u1EC7u', 'error');
    }
  }

  function exportTests() {
    // Separate latex vs SVR tests for multi-sheet export
    var latexTests = tests.filter(function(t) { return t.testResults?.tsc_latex != null; });
    var svrTests = tests.filter(function(t) { return t.testResults?.tsc_latex == null; });

    var sheets = [];
    if (svrTests.length > 0) {
      sheets.push({
        data: svrTests, sheetName: 'SVR-RSS',
        columns: [
          { key: 'testNo', header: 'Số Phiếu', width: 15 },
          { key: 'date', header: 'Ngày', width: 12, format: function(v) { return _formatDate(v); } },
          { key: 'batchNo', header: 'Số Lô', width: 15 },
          { key: 'sampleType', header: 'Loại Mẫu', width: 14, format: function(v) { return getSampleTypeText(v); } },
          { key: 'testResults.drc', header: 'DRC (%)', width: 10 },
          { key: 'testResults.ash', header: 'Tro (%)', width: 10 },
          { key: 'testResults.dirt', header: 'Tạp Chất (%)', width: 12 },
          { key: 'testResults.pri', header: 'Độ Dẻo (PRI)', width: 13 },
          { key: 'testResults.volatile', header: 'Bay Hơi (%)', width: 12 },
          { key: 'testResults.nitrogen', header: 'Nitrogen (%)', width: 12 },
          { key: 'passed', header: 'Kết Quả', width: 12, format: function(v) { return v ? 'Đạt' : 'Không đạt'; } },
          { key: 'testedBy', header: 'Người Kiểm', width: 15 },
          { key: 'notes', header: 'Ghi Chú', width: 20 }
        ]
      });
    }
    if (latexTests.length > 0) {
      sheets.push({
        data: latexTests, sheetName: 'Latex',
        columns: [
          { key: 'testNo', header: 'Số Phiếu', width: 15 },
          { key: 'date', header: 'Ngày', width: 12, format: function(v) { return _formatDate(v); } },
          { key: 'batchNo', header: 'Số Lô', width: 15 },
          { key: 'sampleType', header: 'Loại Mẫu', width: 14, format: function(v) { return getSampleTypeText(v); } },
          { key: 'testResults.tsc_latex', header: 'TSC (%)', width: 10 },
          { key: 'testResults.drc_latex', header: 'DRC (%)', width: 10 },
          { key: 'testResults.nh3_latex', header: 'NH₃ (%)', width: 10 },
          { key: 'testResults.vfa_latex', header: 'VFA', width: 10 },
          { key: 'testResults.koh_latex', header: 'KOH', width: 10 },
          { key: 'testResults.mst_latex', header: 'MST (s)', width: 10 },
          { key: 'passed', header: 'Kết Quả', width: 12, format: function(v) { return v ? 'Đạt' : 'Không đạt'; } },
          { key: 'testedBy', header: 'Người Kiểm', width: 15 }
        ]
      });
    }

    if (sheets.length > 1) {
      ExportService.toExcelMultiSheet({
        sheets: sheets,
        fileName: 'KetQuaKCS_' + _getFactoryShortName()
      });
    } else if (sheets.length === 1) {
      ExportService.toExcel({
        data: sheets[0].data,
        columns: sheets[0].columns,
        fileName: 'KetQuaKCS_' + _getFactoryShortName(),
        sheetName: sheets[0].sheetName
      });
    } else {
      _showToast('Không có dữ liệu để xuất', 'warning');
    }
  }

  return {
    getTests: function() { return tests; },
    loadTests: loadTests,
    searchTests: searchTests,
    filterTests: filterTests,
    openTestModal: openTestModal,
    closeTestModal: closeTestModal,
    editTest: editTest,
    saveTest: saveTest,
    deleteTest: deleteTest,
    exportTests: exportTests,
    toggleTestFieldsByBatch: toggleTestFieldsByBatch,
    init: loadTests
  };
})();
