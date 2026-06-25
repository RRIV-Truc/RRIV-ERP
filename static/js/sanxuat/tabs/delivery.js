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

  // === Helpers ===
  function _db() { return ErpDb.firestore(); }
  function _user() { return window.currentUser; }
  function _showToast(msg, type) { if (window.showToast) window.showToast(msg, type); }
  function _formatNumber(n) { return window.formatNumber ? window.formatNumber(n) : String(n); }
  function _formatDate(d) { return window.formatDate ? window.formatDate(d) : ''; }
  function _generateCode(prefix) { return window.generateCode ? window.generateCode(prefix) : prefix + Date.now(); }
  function _getMapPlots() { return TabGardens ? TabGardens.getMapPlots() : []; }
  function _getGardens() { return TabGardens ? TabGardens.getGardens() : []; }

  // === Component Instances ===
  var dataTable = null;

  function _initTable() {
    if (dataTable || !document.getElementById('deliveryDataTable')) return;
    dataTable = DataTable.create('deliveryDataTable', {
      columns: [
        { key: 'deliveryNo', header: 'S\u1ED1 Phi\u1EBFu', sortable: true, searchable: true, bold: true },
        { key: 'tappingTime', header: 'Ng\u00E0y', type: 'date', sortable: true },
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
          'coagulum': { label: 'M\u1EE7 \u0111\u00F4ng', cls: 'warning' }
        }},
        { key: 'grossWeight', header: 'TL Th\u00F4', type: 'number', sortable: true },
        { key: 'drcPercent', header: 'DRC', type: 'percent', sortable: true, bold: true },
        { key: 'dryWeight', header: 'TL Kh\u00F4', type: 'number', sortable: true, bold: true,
          format: function(v) { return _formatNumber(v) + ' kg'; }
        },
        { key: 'status', header: 'Tr\u1EA1ng Th\u00E1i', type: 'badge', badgeMap: {
          'pending': { label: 'Ch\u1EDD nghi\u1EC7m thu', cls: 'pending' },
          'in_transit': { label: '\u0110ang v\u1EADn chuy\u1EC3n', cls: 'processing' },
          'received': { label: '\u0110\u00E3 ti\u1EBFp nh\u1EADn', cls: 'compliant' }
        }},
        { key: '_actions', header: 'Thao T\u00E1c', type: 'actions', actions: [
          { icon: '\u270F\uFE0F', cls: 'edit', title: 'S\u1EEDa', onClick: function(row) { editDelivery(row.id); } },
          { icon: '\uD83D\uDDD1\uFE0F', cls: 'delete', title: 'X\u00F3a', onClick: function(row) { deleteDelivery(row.id); } }
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

  async function loadDeliveries() {
    var gardens = _getGardens();
    var mapPlots = _getMapPlots();

    // Populate garden/squad dropdown
    var gardenSelect = document.getElementById('deliveryGardenId');
    if (gardenSelect) {
      var squads = [];
      var seen = {};
      mapPlots.forEach(function(p) {
        if (p.squad && !seen[p.squad]) { squads.push(p.squad); seen[p.squad] = true; }
      });
      squads.sort();
      if (squads.length > 0) {
        gardenSelect.innerHTML = '<option value="">-- Chọn Đội SX --</option>' +
          squads.map(function(s) { return '<option value="' + s + '">Đội ' + s + '</option>'; }).join('');
      } else if (gardens.length > 0) {
        gardenSelect.innerHTML = '<option value="">-- Chọn vườn/đội --</option>' +
          gardens.map(function(g) { return '<option value="' + g.id + '">' + g.code + ' - ' + g.ownerName + '</option>'; }).join('');
      }
    }

    // Load from localStorage first
    try {
      var saved = localStorage.getItem('rubberDeliveries');
      if (saved) deliveries = JSON.parse(saved);
    } catch (e) { /* ignore */ }

    // Load from Firestore
    try {
      var snapshot = await _db().collection('rubberDeliveries').orderBy('createdAt', 'desc').limit(100).get();
      deliveries = snapshot.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); });
      localStorage.setItem('rubberDeliveries', JSON.stringify(deliveries));
    } catch (error) {
      console.warn('Firestore deliveries error:', error.message);
    }

    renderDeliveries();
    updateDeliveryStats();
    updateDeliveryTimeline();
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
        '<td>' + _formatDate(d.tappingTime) + '</td>' +
        '<td>' + (d.gardenCode || '') + '</td>' +
        '<td>' + sessionBadge + '</td>' +
        '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (d.plotNames ? d.plotNames.join(', ') : '') + '">' + plotsDisplay + '</td>' +
        '<td>' + getMaterialTypeText(d.materialType) + '</td>' +
        '<td>' + _formatNumber(d.grossWeight) + '</td>' +
        '<td><strong>' + (d.drcPercent || 0) + '%</strong></td>' +
        '<td><strong>' + _formatNumber(d.dryWeight) + ' kg</strong></td>' +
        '<td>' + statusBadge + '</td>' +
        '<td><div class="action-btns">' +
        '<button class="action-btn edit" onclick="TabDelivery.editDelivery(\'' + d.id + '\')" title="S\u1EEDa">\u270F\uFE0F</button>' +
        '<button class="action-btn delete" onclick="TabDelivery.deleteDelivery(\'' + d.id + '\')" title="X\u00F3a">\uD83D\uDDD1\uFE0F</button>' +
        '</div></td></tr>';
    }).join('');
  }

  function getMaterialTypeText(type) {
    return { 'latex': 'Mủ nước', 'coagulum': 'Mủ đông' }[type] || type || 'Mủ nước';
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
    var latexDlvs = todayDlvs.filter(function(d) { return d.materialType === 'latex'; });
    var coagDlvs = todayDlvs.filter(function(d) { return d.materialType === 'coagulum'; });

    var el = function(id) { return document.getElementById(id); };
    if (el('todayDeliveries')) el('todayDeliveries').textContent = todayDlvs.length;
    if (el('totalLatexDelivered')) el('totalLatexDelivered').textContent = _formatNumber(latexDlvs.reduce(function(s,d) { return s + (d.grossWeight||0); }, 0));
    if (el('totalCoagDelivered')) el('totalCoagDelivered').textContent = _formatNumber(coagDlvs.reduce(function(s,d) { return s + (d.grossWeight||0); }, 0));
    if (el('totalDryDelivered')) el('totalDryDelivered').textContent = _formatNumber(todayDlvs.reduce(function(s,d) { return s + (parseFloat(d.dryWeight)||0); }, 0));

    var avgLDRC = latexDlvs.length ? (latexDlvs.reduce(function(s,d) { return s + (d.drcPercent||0); }, 0) / latexDlvs.length).toFixed(1) : '0';
    var avgCDRC = coagDlvs.length ? (coagDlvs.reduce(function(s,d) { return s + (d.drcPercent||0); }, 0) / coagDlvs.length).toFixed(1) : '0';
    if (el('avgLatexDRC')) el('avgLatexDRC').textContent = avgLDRC + '%';
    if (el('avgCoagDRC')) el('avgCoagDRC').textContent = avgCDRC + '%';

    // Latex detail
    if (el('latexGrade1')) el('latexGrade1').textContent = _formatNumber(latexDlvs.filter(function(d) { return d.grade === 'grade1'; }).reduce(function(s,d) { return s + (d.grossWeight||0); }, 0));
    if (el('latexGrade2')) el('latexGrade2').textContent = _formatNumber(latexDlvs.filter(function(d) { return d.grade === 'grade2'; }).reduce(function(s,d) { return s + (d.grossWeight||0); }, 0));
    var phVals = latexDlvs.filter(function(d) { return d.phValue > 0; });
    if (el('latexAvgPH')) el('latexAvgPH').textContent = phVals.length ? (phVals.reduce(function(s,d) { return s + d.phValue; }, 0) / phVals.length).toFixed(1) : '-';
    var nh3Vals = latexDlvs.filter(function(d) { return d.nh3Percent > 0; });
    if (el('latexAvgNH3')) el('latexAvgNH3').textContent = nh3Vals.length ? (nh3Vals.reduce(function(s,d) { return s + d.nh3Percent; }, 0) / nh3Vals.length).toFixed(3) : '-';

    // Coagulum detail
    var ct = { block:0, cup:0, scrap:0, misc:0, earth:0 };
    coagDlvs.forEach(function(d) { var t = d.coagType || 'block'; if (ct[t] !== undefined) ct[t] += (d.grossWeight||0); });
    if (el('coagBlock')) el('coagBlock').textContent = _formatNumber(ct.block);
    if (el('coagCup')) el('coagCup').textContent = _formatNumber(ct.cup);
    if (el('coagScrap')) el('coagScrap').textContent = _formatNumber(ct.scrap);
    if (el('coagMisc')) el('coagMisc').textContent = _formatNumber(ct.misc + ct.earth);
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
    if (latexF && coagF) {
      latexF.style.display = type === 'latex' ? 'block' : 'none';
      coagF.style.display = type === 'latex' ? 'none' : 'block';
    }
  }

  function calculateDeliveryDry() {
    var materialType = document.getElementById('deliveryMaterialType')?.value || 'latex';
    var grossWeight = 0, drc = 0;
    if (materialType === 'latex') {
      grossWeight = parseFloat(document.getElementById('deliveryLatexGross')?.value) || 0;
      drc = parseFloat(document.getElementById('deliveryLatexDRC')?.value) || 0;
    } else {
      grossWeight = parseFloat(document.getElementById('deliveryCoagGross')?.value) || 0;
      drc = parseFloat(document.getElementById('deliveryCoagDRC')?.value) || 0;
    }
    var dryWeight = (grossWeight * drc / 100).toFixed(1);
    var dryEl = document.getElementById('deliveryDryWeight');
    if (dryEl) dryEl.textContent = _formatNumber(dryWeight) + ' kg';
    var resultEl = document.getElementById('deliveryDryResult');
    if (resultEl) resultEl.style.display = drc > 0 ? 'block' : 'none';
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

  function openDeliveryModal(id) {
    var modal = _el('deliveryModal');
    if (!modal) return;

    _el('deliveryModalTitle').textContent = id ? 'Chỉnh Sửa Phiếu Giao Nhận' : 'Tạo Phiếu Giao Nhận Mủ';
    _el('deliveryId').value = id || '';

    if (id) {
      var d = deliveries.find(function(x) { return x.id === id; });
      if (d) {
        _el('deliveryNo').value = d.deliveryNo || '';
        _el('deliveryDateTime').value = _formatDateTimeLocal(d.createdAt || d.tappingTime);
        _el('deliveryTeam').value = d.team || d.gardenId || '';
        _el('deliveryGroup').value = d.group || '';
        _el('deliveryGardenId').value = d.gardenId || '';
        _el('deliveryMaterialType').value = d.materialType || 'latex';
        _el('deliveryGrade').value = d.grade || 'grade1';
        _el('deliveryTappingTime').value = d.tappingTimeOnly || '';
        _el('deliveryCollectionTime').value = d.collectionTime || '';
        _el('deliveryVehicle').value = d.vehicleNo || '';
        _el('deliverySealStatus').value = d.sealStatus || 'sealed';
        _el('deliverySealCode').value = d.sealCode || d.sealNo || '';
        _el('deliveryStatus').value = d.status || 'pending';
        _el('deliveryPerson').value = d.deliveryPerson || '';
        _el('deliveryNotes').value = d.notes || '';
        _el('deliveryTappingSession').value = d.tappingSession || '';
        _el('deliveryTappingDate').value = d.tappingDate ? (d.tappingDate.toDate ? d.tappingDate.toDate().toISOString().slice(0,10) : new Date(d.tappingDate).toISOString().slice(0,10)) : '';

        selectedPlotIds = d.plotIds || [];
        onDeliveryGardenChange();
        toggleMaterialFields(d.materialType);

        if (d.materialType === 'latex') {
          _el('deliveryLatexGross').value = d.grossWeight || '';
          _el('deliveryLatexDRC').value = d.drcPercent || '';
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
        } else {
          _el('deliveryCoagType').value = d.coagType || 'block';
          _el('deliveryCoagGross').value = d.grossWeight || '';
          _el('deliveryCoagDRC').value = d.drcPercent || '';
          _el('deliveryCoagImpurity').value = d.impurityLevel || 'clean';
          updateCoagQualityHint();
        }
        calculateDeliveryDry();
      }
    } else {
      _el('deliveryNo').value = _generateCode('GN');
      _el('deliveryDateTime').value = new Date().toISOString().slice(0, 10);
      _el('deliveryTeam').value = '';
      _el('deliveryGroup').value = '';
      _el('deliveryGardenId').value = '';
      _el('deliveryMaterialType').value = 'latex';
      _el('deliveryGrade').value = 'grade1';
      _el('deliveryTappingTime').value = '';
      _el('deliveryCollectionTime').value = '';
      _el('deliveryVehicle').value = '';
      _el('deliverySealStatus').value = 'sealed';
      _el('deliverySealCode').value = '';
      _el('deliveryStatus').value = 'pending';
      _el('deliveryPerson').value = '';
      _el('deliveryNotes').value = '';
      _el('deliveryLatexGross').value = '';
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
      _el('deliveryCoagType').value = 'block';
      _el('deliveryCoagGross').value = '';
      _el('deliveryCoagDRC').value = '';
      _el('deliveryCoagImpurity').value = 'clean';
      var coagQ = _el('coagQualityCriteria');
      if (coagQ) coagQ.innerHTML = '';
      _el('deliveryDryWeight').textContent = '0 kg';
      toggleMaterialFields('latex');
      _el('deliveryTappingSession').value = '';
      _el('deliveryTappingDate').value = new Date().toISOString().slice(0,10);
      selectedPlotIds = [];
      deliveryPlots = [];
      _el('deliveryPlotsContainer').innerHTML = '<div class="no-plots-message">Chọn Đội SX để hiển thị danh sách lô</div>';
      _el('deliveryPlotsSummary').style.display = 'none';
    }

    modal.classList.add('active');
  }

  function closeDeliveryModal() {
    var m = _el('deliveryModal');
    if (m) m.classList.remove('active');
  }

  function editDelivery(id) { openDeliveryModal(id); }

  async function saveDelivery() {
    var id = _el('deliveryId').value;
    var deliveryNo = _el('deliveryNo').value.trim();
    var deliveryDateTime = _el('deliveryDateTime').value;
    var team = _el('deliveryTeam').value;
    var group = _el('deliveryGroup').value.trim();
    var gardenId = _el('deliveryGardenId').value;
    var materialType = _el('deliveryMaterialType').value;
    var grade = _el('deliveryGrade').value;
    var tappingTimeOnly = _el('deliveryTappingTime').value;
    var collectionTime = _el('deliveryCollectionTime').value;
    var vehicleNo = _el('deliveryVehicle').value.trim();
    var sealStatus = _el('deliverySealStatus').value;
    var sealCode = _el('deliverySealCode').value.trim();
    var status = _el('deliveryStatus').value;
    var deliveryPerson = _el('deliveryPerson').value.trim();
    var notes = _el('deliveryNotes').value.trim();
    var tappingSession = _el('deliveryTappingSession').value;
    var tappingDate = _el('deliveryTappingDate').value;
    var plotIds = getSelectedPlotIds();
    var plotNames = getSelectedPlotNames();

    if (!deliveryNo || !deliveryDateTime) {
      _showToast('Vui lòng nhập đầy đủ thông tin bắt buộc', 'error');
      return;
    }
    if (plotIds.length === 0) {
      _showToast('Vui lòng chọn ít nhất 1 lô thu hoạch (EUDR)', 'error');
      return;
    }

    var gardens = _getGardens();
    var garden = gardens.find(function(g) { return g.id === gardenId; });

    var grossWeight = 0, drcPercent = 0, additionalData = {};
    if (materialType === 'latex') {
      grossWeight = parseFloat(_el('deliveryLatexGross').value) || 0;
      drcPercent = parseFloat(_el('deliveryLatexDRC').value) || 0;
      var purpose = (_el('deliveryLatexPurpose') || {}).value || 'svr_rss';
      additionalData = {
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
    } else {
      grossWeight = parseFloat(_el('deliveryCoagGross').value) || 0;
      drcPercent = parseFloat(_el('deliveryCoagDRC').value) || 0;
      additionalData = {
        coagType: _el('deliveryCoagType').value,
        impurityLevel: _el('deliveryCoagImpurity').value
      };
    }

    var dryWeight = grossWeight * drcPercent / 100;
    if (materialType === 'latex' && drcPercent > 0 && drcPercent < 20) {
      _showToast('DRC mủ nước phải ≥ 20% theo TCCS 111:2023', 'error');
      return;
    }

    var user = _user();
    var data = Object.assign({
      deliveryNo: deliveryNo, team: team, group: group, gardenId: gardenId,
      gardenCode: garden ? (garden.code || gardenId) : gardenId,
      materialType: materialType, grade: grade,
      tappingTimeOnly: tappingTimeOnly, collectionTime: collectionTime,
      vehicleNo: vehicleNo, sealStatus: sealStatus, sealCode: sealCode,
      grossWeight: grossWeight, drcPercent: drcPercent,
      dryWeight: parseFloat(dryWeight.toFixed(2)),
      status: status, deliveryPerson: deliveryPerson, notes: notes,
      tappingSession: tappingSession || null,
      tappingDate: tappingDate ? new Date(tappingDate) : null,
      plotIds: plotIds, plotNames: plotNames, eudrCompliant: true,
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedBy: user ? user.id : null
    }, additionalData);

    var localData = Object.assign({}, data, {
      tappingDate: tappingDate || null,
      updatedAt: new Date().toISOString(),
      createdAt: deliveryDateTime ? new Date(deliveryDateTime).toISOString() : new Date().toISOString()
    });

    try {
      if (id) {
        await _db().collection('rubberDeliveries').doc(id).update(data);
        _showToast('Cập nhật thành công!');
      } else {
        data.createdAt = ErpDb.firestore.FieldValue.serverTimestamp();
        data.createdBy = user ? user.id : null;
        var docRef = await _db().collection('rubberDeliveries').add(data);
        localData.id = docRef.id;
        _showToast('Tạo phiếu thành công!');
      }
    } catch (error) {
      console.warn('Firestore save error, saving locally:', error.message);
      if (id) {
        var idx = deliveries.findIndex(function(d) { return d.id === id; });
        if (idx >= 0) deliveries[idx] = Object.assign({}, deliveries[idx], localData);
      } else {
        localData.id = 'local_' + Date.now();
        localData.createdAt = new Date().toISOString();
        deliveries.unshift(localData);
      }
      localStorage.setItem('rubberDeliveries', JSON.stringify(deliveries));
      _showToast('Đã lưu offline!');
    }

    closeDeliveryModal();
    loadDeliveries();
  }

  async function deleteDelivery(id) {
    if (!(await showConfirm('Bạn có chắc muốn xóa phiếu giao nhận này?'))) return;
    try { await _db().collection('rubberDeliveries').doc(id).delete(); }
    catch (error) { console.warn('Firestore delete error:', error.message); }
    deliveries = deliveries.filter(function(d) { return d.id !== id; });
    localStorage.setItem('rubberDeliveries', JSON.stringify(deliveries));
    _showToast('Đã xóa!');
    loadDeliveries();
  }

  function exportDeliveries() {
    ExportService.toExcel({
      data: deliveries,
      columns: [
        { key: 'deliveryNo', header: 'Số Phiếu', width: 15 },
        { key: 'tappingTime', header: 'Ngày', width: 12, format: function(v) { return _formatDate(v); } },
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
        { key: 'deliveryPerson', header: 'Người Giao', width: 15 },
        { key: 'notes', header: 'Ghi Chú', width: 25 }
      ],
      fileName: 'GiaoNhanMu',
      sheetName: 'Giao Nhận Mủ'
    });
  }

  // ==================== PLOT SELECTION ====================

  function onDeliveryGardenChange() {
    var squadId = document.getElementById('deliveryGardenId')?.value;
    var container = document.getElementById('deliveryPlotsContainer');
    var summary = document.getElementById('deliveryPlotsSummary');
    if (!squadId) {
      if (container) container.innerHTML = '<div class="no-plots-message">Chọn Đội SX để hiển thị danh sách lô</div>';
      if (summary) summary.style.display = 'none';
      deliveryPlots = [];
      selectedPlotIds = [];
      return;
    }
    var mapPlots = _getMapPlots();
    var filteredPlots = mapPlots.filter(function(p) { return p.squad === squadId || p.doi === squadId; });
    if (filteredPlots.length > 0) {
      deliveryPlots = filteredPlots.map(function(p) {
        return { id: p.id || p.code, code: p.code, name: p.name || p.code, squad: p.squad, team: p.team, area: p.area || 0, variety: p.variety, plantingYear: p.plantingYear, eudrStatus: 'compliant', eudrCompliant: true };
      });
    } else {
      deliveryPlots = [];
    }
    renderDeliveryPlots();
  }

  function renderDeliveryPlots() {
    var container = document.getElementById('deliveryPlotsContainer');
    var summary = document.getElementById('deliveryPlotsSummary');
    if (deliveryPlots.length === 0) {
      if (container) container.innerHTML = '<div class="no-plots-message">Không có lô nào trong vườn này</div>';
      if (summary) summary.style.display = 'none';
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
    updateNH3Hints: updateNH3Hints,
    validateNH3Dosage: validateNH3Dosage,
    updateCoagQualityHint: updateCoagQualityHint,
    onDeliveryGardenChange: onDeliveryGardenChange,
    onPlotCheckboxChange: onPlotCheckboxChange,
    selectAllPlots: selectAllPlots,
    deselectAllPlots: deselectAllPlots,
    getSelectedPlotIds: getSelectedPlotIds,
    getSelectedPlotNames: getSelectedPlotNames,
    init: loadDeliveries
  };
})();
