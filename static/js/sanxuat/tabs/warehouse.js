/**
 * Tab 5: Đóng Gói & Kho - Warehouse/inventory management
 * @module TabWarehouse
 * @depends DataTable, StatsCards, ExportService, SanxuatFactories
 */

const TabWarehouse = (function() {
  'use strict';

  let warehouseItems = [];

  function _db() { return ErpDb.firestore(); }
  function _user() { return window.currentUser; }
  function _factory() { return window.currentFactory; }
  function _showToast(msg, type) { if (window.showToast) window.showToast(msg, type); }
  function _formatDate(d) { return window.formatDate ? window.formatDate(d) : ''; }
  function _formatNumber(n) { return window.formatNumber ? window.formatNumber(n) : String(n); }
  function _generateCode(prefix) { return window.generateCode ? window.generateCode(prefix) : prefix + Date.now(); }
  function _getFactoryShortName() { return SanxuatFactories ? SanxuatFactories.getShortName(_factory()) : ''; }

  var PRODUCTS = ['SVR3L', 'SVR10', 'SVR20', 'RSS', 'LatexHA', 'LatexLA'];

  // === Component Instances ===
  var statsCards = null;
  var dataTable = null;

  function _initComponents() {
    if (!statsCards && document.getElementById('warehouseStats')) {
      statsCards = StatsCards.create('warehouseStats', {
        cards: [
          { id: 'totalInventory', label: 'T\u1ED5ng T\u1ED3n Kho (t\u1EA5n)', icon: '\uD83D\uDCCA', variant: 'info' },
          { id: 'todayPackaged', label: '\u0110\u00F3ng G\u00F3i H\u00F4m Nay (t\u1EA5n)', icon: '\uD83D\uDCE6', variant: 'success' },
          { id: 'todayExport', label: 'Xu\u1EA5t Kho H\u00F4m Nay (t\u1EA5n)', icon: '\uD83D\uDE9B', variant: 'accent' },
          { id: 'lowStock', label: 'S\u1EAFp H\u1EBFt H\u00E0ng', icon: '\u26A0\uFE0F', variant: 'warning' }
        ]
      });
    }

    if (!dataTable && document.getElementById('warehouseDataTable')) {
      dataTable = DataTable.create('warehouseDataTable', {
        columns: [
          { key: 'code', header: 'M\u00E3 Phi\u1EBFu', sortable: true, searchable: true, bold: true },
          { key: 'type', header: 'Lo\u1EA1i', type: 'badge', badgeMap: {
            'in': { label: 'Nh\u1EADp', cls: 'passed' },
            'out': { label: 'Xu\u1EA5t', cls: 'pending' }
          }},
          { key: 'date', header: 'Ng\u00E0y', type: 'date', sortable: true },
          { key: 'product', header: 'S\u1EA3n Ph\u1EA9m', sortable: true, searchable: true },
          { key: 'batchNo', header: 'S\u1ED1 L\u00F4', searchable: true },
          { key: 'quantity', header: 'S\u1ED1 L\u01B0\u1EE3ng (kg)', type: 'number', sortable: true },
          { key: 'location', header: 'V\u1ECB Tr\u00ED Kho' },
          { key: 'notes', header: 'Ghi Ch\u00FA', truncate: true },
          { key: '_actions', header: 'Thao T\u00E1c', type: 'actions', actions: [
            { icon: '\u270F\uFE0F', cls: 'edit', title: 'S\u1EEDa', onClick: function(row) { editWarehouse(row.id); } },
            { icon: '\uD83D\uDDD1\uFE0F', cls: 'delete', title: 'X\u00F3a', onClick: function(row) { deleteWarehouse(row.id); } }
          ]}
        ],
        filters: [
          { key: 'type', label: 'Lo\u1EA1i', options: [
            { value: '', label: 'T\u1EA5t c\u1EA3' },
            { value: 'in', label: 'Nh\u1EADp kho' },
            { value: 'out', label: 'Xu\u1EA5t kho' }
          ]}
        ],
        dateFilter: { key: 'date', label: 'Ng\u00E0y' },
        searchPlaceholder: 'T\u00ECm theo m\u00E3 phi\u1EBFu, s\u1ED1 l\u00F4, s\u1EA3n ph\u1EA9m...',
        showExport: true,
        exportFileName: 'PhieuKho_' + _getFactoryShortName(),
        exportSheetName: 'Phi\u1EBFu Kho',
        toolbar: {
          onCreate: function() { openWarehouseModal(); },
          createLabel: '+ T\u1EA1o Phi\u1EBFu'
        },
        emptyText: 'Ch\u01B0a c\u00F3 phi\u1EBFu xu\u1EA5t/nh\u1EADp kho',
        emptyIcon: '\uD83D\uDCE6',
        pageSize: 20
      });
    }
  }

  async function loadWarehouse() {
    try {
      var snapshot = await _db().collection('warehouseItems').orderBy('createdAt', 'desc').limit(100).get();
      warehouseItems = snapshot.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); })
        .filter(function(d) { return !d.factory || d.factory === _factory(); });
      _initComponents();
      renderWarehouse();
      renderInventoryCards();
      updateWarehouseStats();
    } catch (error) {
      console.error('Error loading warehouse:', error);
      _showToast('L\u1ED7i t\u1EA3i d\u1EEF li\u1EC7u kho', 'error');
    }
  }

  function renderWarehouse() {
    if (dataTable) {
      dataTable.setData(warehouseItems);
      return;
    }
    // Fallback: render to legacy table if DataTable not available
    var tbody = document.getElementById('warehouseTableBody');
    if (!tbody) return;
    if (warehouseItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#64748b;">Ch\u01B0a c\u00F3 phi\u1EBFu xu\u1EA5t/nh\u1EADp kho</td></tr>';
      return;
    }
    tbody.innerHTML = warehouseItems.map(function(w) {
      return '<tr>' +
        '<td><strong>' + (w.code || '') + '</strong></td>' +
        '<td><span class="status-badge ' + (w.type === 'in' ? 'passed' : 'pending') + '">' + (w.type === 'in' ? 'Nh\u1EADp' : 'Xu\u1EA5t') + '</span></td>' +
        '<td>' + _formatDate(w.date) + '</td>' +
        '<td>' + (w.product || '') + '</td>' +
        '<td>' + (w.batchNo || '') + '</td>' +
        '<td>' + _formatNumber(w.quantity) + '</td>' +
        '<td>' + (w.location || '') + '</td>' +
        '<td style="max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + (w.notes || '') + '">' + (w.notes || '') + '</td>' +
        '<td><div class="action-btns">' +
        '<button class="action-btn edit" onclick="TabWarehouse.editWarehouse(\'' + w.id + '\')" title="S\u1EEDa">\u270F\uFE0F</button>' +
        '<button class="action-btn delete" onclick="TabWarehouse.deleteWarehouse(\'' + w.id + '\')" title="X\u00F3a">\uD83D\uDDD1\uFE0F</button>' +
        '</div></td></tr>';
    }).join('');
  }

  function renderInventoryCards() {
    var container = document.getElementById('inventoryList');
    if (!container) return;
    container.innerHTML = PRODUCTS.map(function(product) {
      var inItems = warehouseItems.filter(function(w) { return w.product === product && w.type === 'in'; });
      var outItems = warehouseItems.filter(function(w) { return w.product === product && w.type === 'out'; });
      var totalIn = inItems.reduce(function(s, w) { return s + (w.quantity || 0); }, 0);
      var totalOut = outItems.reduce(function(s, w) { return s + (w.quantity || 0); }, 0);
      var balance = totalIn - totalOut;
      var statusCls = balance > 1000 ? 'passed' : (balance > 0 ? 'pending' : 'failed');
      var statusText = balance > 1000 ? '\u0110\u1EE7 h\u00E0ng' : (balance > 0 ? 'S\u1EAFp h\u1EBFt' : 'H\u1EBFt h\u00E0ng');
      return '<div class="inventory-card">' +
        '<div class="inventory-header"><h4>' + product + '</h4>' +
        '<span class="status-badge ' + statusCls + '">' + statusText + '</span></div>' +
        '<div class="inventory-stats">' +
        '<div class="inventory-stat"><div class="value">' + _formatNumber(totalIn / 1000) + '</div><div class="label">Nh\u1EADp (t\u1EA5n)</div></div>' +
        '<div class="inventory-stat"><div class="value">' + _formatNumber(totalOut / 1000) + '</div><div class="label">Xu\u1EA5t (t\u1EA5n)</div></div>' +
        '<div class="inventory-stat"><div class="value">' + _formatNumber(balance / 1000) + '</div><div class="label">T\u1ED3n (t\u1EA5n)</div></div>' +
        '</div></div>';
    }).join('');
  }

  function updateWarehouseStats() {
    var today = new Date().toISOString().slice(0, 10);
    var todayItems = warehouseItems.filter(function(w) {
      var d = w.date && w.date.toDate ? w.date.toDate() : new Date(w.date);
      return d.toISOString().slice(0, 10) === today;
    });
    var totalIn = warehouseItems.filter(function(w) { return w.type === 'in'; }).reduce(function(s, w) { return s + (w.quantity || 0); }, 0);
    var totalOut = warehouseItems.filter(function(w) { return w.type === 'out'; }).reduce(function(s, w) { return s + (w.quantity || 0); }, 0);
    var balance = totalIn - totalOut;

    var todayIn = todayItems.filter(function(w) { return w.type === 'in'; }).reduce(function(s, w) { return s + (w.quantity || 0); }, 0);
    var todayOut = todayItems.filter(function(w) { return w.type === 'out'; }).reduce(function(s, w) { return s + (w.quantity || 0); }, 0);

    var lowStockCount = 0;
    PRODUCTS.forEach(function(product) {
      var pIn = warehouseItems.filter(function(w) { return w.product === product && w.type === 'in'; }).reduce(function(s, w) { return s + (w.quantity || 0); }, 0);
      var pOut = warehouseItems.filter(function(w) { return w.product === product && w.type === 'out'; }).reduce(function(s, w) { return s + (w.quantity || 0); }, 0);
      if (pIn - pOut <= 1000 && pIn - pOut > 0) lowStockCount++;
    });

    if (statsCards) {
      statsCards.update({
        totalInventory: (balance / 1000).toFixed(1),
        todayPackaged: (todayIn / 1000).toFixed(1),
        todayExport: (todayOut / 1000).toFixed(1),
        lowStock: lowStockCount
      });
    } else {
      // Fallback: direct DOM updates
      var el = function(id) { return document.getElementById(id); };
      if (el('totalInventory')) el('totalInventory').textContent = _formatNumber((balance / 1000).toFixed(1));
      if (el('todayPackaged')) el('todayPackaged').textContent = _formatNumber((todayIn / 1000).toFixed(1));
      if (el('todayExport')) el('todayExport').textContent = _formatNumber((todayOut / 1000).toFixed(1));
      if (el('lowStock')) el('lowStock').textContent = lowStockCount;
    }
  }

  function openWarehouseModal(id) {
    document.getElementById('warehouseModalTitle').textContent = id ? 'Ch\u1EC9nh S\u1EEDa Phi\u1EBFu Kho' : 'T\u1EA1o Phi\u1EBFu Xu\u1EA5t/Nh\u1EADp Kho';
    document.getElementById('warehouseId').value = id || '';
    if (id) {
      var w = warehouseItems.find(function(x) { return x.id === id; });
      if (w) {
        document.getElementById('warehouseCode').value = w.code || '';
        document.getElementById('warehouseType').value = w.type || 'in';
        document.getElementById('warehouseDate').value = w.date && w.date.toDate ? w.date.toDate().toISOString().slice(0,10) : w.date;
        document.getElementById('warehouseProduct').value = w.product || '';
        document.getElementById('warehouseBatchNo').value = w.batchNo || '';
        document.getElementById('warehouseQuantity').value = w.quantity || '';
        document.getElementById('warehouseLocation').value = w.location || '';
        document.getElementById('warehouseNotes').value = w.notes || '';
      }
    } else {
      document.getElementById('warehouseCode').value = _generateCode('PK');
      document.getElementById('warehouseType').value = 'in';
      document.getElementById('warehouseDate').value = new Date().toISOString().slice(0,10);
      ['warehouseProduct','warehouseBatchNo','warehouseQuantity','warehouseLocation','warehouseNotes'].forEach(function(fid) {
        document.getElementById(fid).value = '';
      });
    }
    document.getElementById('warehouseModal').classList.add('active');
  }

  function closeWarehouseModal() { document.getElementById('warehouseModal').classList.remove('active'); }
  function editWarehouse(id) { openWarehouseModal(id); }

  async function saveWarehouse() {
    var id = document.getElementById('warehouseId').value;
    var code = document.getElementById('warehouseCode').value.trim();
    var type = document.getElementById('warehouseType').value;
    var date = document.getElementById('warehouseDate').value;
    var product = document.getElementById('warehouseProduct').value;
    var batchNo = document.getElementById('warehouseBatchNo').value.trim();
    var quantity = parseFloat(document.getElementById('warehouseQuantity').value) || 0;
    var location = document.getElementById('warehouseLocation').value.trim();
    var notes = document.getElementById('warehouseNotes').value.trim();

    if (!code || !date || !product || !quantity) {
      _showToast('Vui l\u00F2ng nh\u1EADp \u0111\u1EA7y \u0111\u1EE7 th\u00F4ng tin b\u1EAFt bu\u1ED9c', 'error');
      return;
    }

    var data = {
      code: code, type: type, date: new Date(date), product: product,
      batchNo: batchNo, quantity: quantity, location: location, notes: notes,
      factory: _factory(),
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(), updatedBy: _user() ? _user().id : null
    };

    try {
      if (id) {
        await _db().collection('warehouseItems').doc(id).update(data);
        _showToast('C\u1EADp nh\u1EADt th\u00E0nh c\u00F4ng!');
      } else {
        data.createdAt = ErpDb.firestore.FieldValue.serverTimestamp();
        data.createdBy = _user() ? _user().id : null;
        await _db().collection('warehouseItems').add(data);
        _showToast('T\u1EA1o phi\u1EBFu th\u00E0nh c\u00F4ng!');
      }
      closeWarehouseModal();
      loadWarehouse();
    } catch (error) {
      console.error('Error saving warehouse:', error);
      _showToast('L\u1ED7i l\u01B0u d\u1EEF li\u1EC7u: ' + error.message, 'error');
    }
  }

  async function deleteWarehouse(id) {
    if (!(await showConfirm('B\u1EA1n c\u00F3 ch\u1EAFc mu\u1ED1n x\u00F3a phi\u1EBFu n\u00E0y?'))) return;
    try {
      await _db().collection('warehouseItems').doc(id).delete();
      _showToast('\u0110\u00E3 x\u00F3a!');
      loadWarehouse();
    } catch (error) {
      console.error('Error deleting warehouse:', error);
      _showToast('L\u1ED7i x\u00F3a d\u1EEF li\u1EC7u', 'error');
    }
  }

  function exportInventory() {
    var inventoryData = PRODUCTS.map(function(product) {
      var totalIn = warehouseItems.filter(function(w) { return w.product === product && w.type === 'in'; }).reduce(function(s, w) { return s + (w.quantity || 0); }, 0);
      var totalOut = warehouseItems.filter(function(w) { return w.product === product && w.type === 'out'; }).reduce(function(s, w) { return s + (w.quantity || 0); }, 0);
      return { product: product, totalIn: totalIn, totalOut: totalOut, balance: totalIn - totalOut };
    });
    ExportService.toExcel({
      data: inventoryData,
      columns: [
        { key: 'product', header: 'S\u1EA3n Ph\u1EA9m', width: 15 },
        { key: 'totalIn', header: 'T\u1ED5ng Nh\u1EADp (kg)', width: 16 },
        { key: 'totalOut', header: 'T\u1ED5ng Xu\u1EA5t (kg)', width: 16 },
        { key: 'balance', header: 'T\u1ED3n Kho (kg)', width: 16 },
        { key: 'balance', header: 'T\u1ED3n Kho (t\u1EA5n)', width: 16, format: function(v) { return (v / 1000).toFixed(2); } }
      ],
      fileName: 'TonKho_' + _getFactoryShortName(),
      sheetName: 'T\u1ED3n Kho'
    });
  }

  return {
    getItems: function() { return warehouseItems; },
    loadWarehouse: loadWarehouse,
    openWarehouseModal: openWarehouseModal,
    closeWarehouseModal: closeWarehouseModal,
    editWarehouse: editWarehouse,
    saveWarehouse: saveWarehouse,
    deleteWarehouse: deleteWarehouse,
    exportInventory: exportInventory,
    init: loadWarehouse
  };
})();
