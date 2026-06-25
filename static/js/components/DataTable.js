/**
 * DataTable - Reusable data table component
 * Search, filter, sort, pagination, Excel export, action buttons
 * Follows same IIFE pattern as SearchableSelect
 *
 * @module DataTable
 * @depends ExportService (optional, for Excel export)
 *
 * Usage:
 *   const table = DataTable.create('myContainer', {
 *     columns: [
 *       { key: 'name', header: 'Tên', sortable: true, searchable: true },
 *       { key: 'area', header: 'Diện tích', type: 'number', format: v => v.toFixed(1) },
 *       { key: 'status', header: 'Trạng thái', type: 'badge', badgeMap: { active: { label: 'HĐ', cls: 'compliant' } } },
 *       { key: '_actions', header: 'Thao Tác', type: 'actions', actions: [
 *         { icon: '✏️', cls: 'edit', title: 'Sửa', onClick: (row) => editItem(row) },
 *         { icon: '🗑️', cls: 'delete', title: 'Xóa', onClick: (row) => deleteItem(row) }
 *       ]}
 *     ],
 *     filters: [
 *       { key: 'status', label: 'Trạng thái', options: [{ value: '', label: 'Tất cả' }, { value: 'active', label: 'HĐ' }] }
 *     ],
 *     pageSize: 20,
 *     searchPlaceholder: 'Tìm kiếm...',
 *     emptyText: 'Chưa có dữ liệu',
 *     showExport: true,
 *     exportFileName: 'data-export',
 *     exportSheetName: 'Sheet1',
 *     onRowClick: (row) => {},
 *     toolbar: { onCreate: () => openModal(), createLabel: '+ Thêm mới' }
 *   });
 *   table.setData(myDataArray);
 */

const DataTable = (function() {
  'use strict';

  const CSS_STYLES = `
    .dt-wrapper { width: 100%; }
    .dt-toolbar {
      display: flex; align-items: center; gap: 10px;
      flex-wrap: wrap; margin-bottom: 12px;
    }
    .dt-search {
      display: flex; align-items: center; gap: 6px;
      background: var(--card-bg, #1e293b); border: 1px solid var(--border, #334155);
      border-radius: 8px; padding: 6px 12px; flex: 1; min-width: 180px; max-width: 320px;
    }
    .dt-search-icon { color: var(--text-muted, #64748b); font-size: 14px; flex-shrink: 0; }
    .dt-search input {
      border: none; background: transparent; outline: none; width: 100%;
      font-size: 13px; color: var(--text, #e2e8f0);
    }
    .dt-search input::placeholder { color: var(--text-muted, #64748b); }
    .dt-filter-group { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .dt-filter select {
      padding: 7px 10px; border-radius: 8px; font-size: 13px;
      border: 1px solid var(--border, #334155); background: var(--card-bg, #1e293b);
      color: var(--text, #e2e8f0); cursor: pointer;
    }
    .dt-filter-date {
      padding: 7px 10px; border-radius: 8px; font-size: 13px;
      border: 1px solid var(--border, #334155); background: var(--card-bg, #1e293b);
      color: var(--text, #e2e8f0);
    }
    .dt-actions-right { margin-left: auto; display: flex; gap: 8px; }
    .dt-btn {
      padding: 7px 14px; border-radius: 8px; font-size: 13px;
      border: none; cursor: pointer; font-weight: 500; white-space: nowrap;
    }
    .dt-btn-primary { background: var(--accent, #8b5cf6); color: #fff; }
    .dt-btn-primary:hover { opacity: 0.9; }
    .dt-btn-secondary { background: var(--card-bg, #1e293b); color: var(--text, #e2e8f0); border: 1px solid var(--border, #334155); }
    .dt-btn-secondary:hover { background: var(--hover, #334155); }

    .dt-table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid var(--border, #334155); }
    .dt-table {
      width: 100%; border-collapse: collapse; font-size: 13px;
    }
    .dt-table thead { position: sticky; top: 0; z-index: 1; }
    .dt-table th {
      background: var(--card-bg, #1e293b); color: var(--text-muted, #94a3b8);
      padding: 10px 12px; text-align: left; font-weight: 600; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border, #334155); white-space: nowrap;
      user-select: none;
    }
    .dt-table th.dt-sortable { cursor: pointer; }
    .dt-table th.dt-sortable:hover { color: var(--accent, #8b5cf6); }
    .dt-sort-icon { margin-left: 4px; font-size: 10px; opacity: 0.4; }
    .dt-table th.dt-sort-asc .dt-sort-icon,
    .dt-table th.dt-sort-desc .dt-sort-icon { opacity: 1; color: var(--accent, #8b5cf6); }
    .dt-table td {
      padding: 10px 12px; border-bottom: 1px solid var(--border, #334155);
      color: var(--text, #e2e8f0); vertical-align: middle;
    }
    .dt-table tbody tr { transition: background 0.15s; }
    .dt-table tbody tr:hover { background: rgba(139, 92, 246, 0.05); }
    .dt-table tbody tr:last-child td { border-bottom: none; }
    .dt-table td.dt-num { text-align: right; font-variant-numeric: tabular-nums; }
    .dt-table td.dt-truncate {
      max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .dt-empty {
      text-align: center; padding: 40px 20px; color: var(--text-muted, #64748b);
    }
    .dt-empty-icon { font-size: 32px; margin-bottom: 8px; opacity: 0.5; }
    .dt-empty-text { font-size: 14px; }

    .dt-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 0; font-size: 12px; color: var(--text-muted, #94a3b8);
    }
    .dt-page-info { }
    .dt-pagination { display: flex; align-items: center; gap: 4px; }
    .dt-page-btn {
      padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border, #334155);
      background: var(--card-bg, #1e293b); color: var(--text, #e2e8f0);
      cursor: pointer; font-size: 12px; min-width: 32px; text-align: center;
    }
    .dt-page-btn:hover:not(:disabled) { background: var(--hover, #334155); }
    .dt-page-btn:disabled { opacity: 0.4; cursor: default; }
    .dt-page-btn.dt-active {
      background: var(--accent, #8b5cf6); color: #fff; border-color: var(--accent, #8b5cf6);
    }
  `;

  let stylesInjected = false;
  const instances = {};

  function _injectStyles() {
    if (stylesInjected) return;
    var style = document.createElement('style');
    style.id = 'datatable-styles';
    style.textContent = CSS_STYLES;
    document.head.appendChild(style);
    stylesInjected = true;
  }

  function _removeDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function _getNestedValue(obj, path) {
    if (!obj || !path) return undefined;
    return path.split('.').reduce(function(acc, key) {
      return acc && acc[key] !== undefined ? acc[key] : undefined;
    }, obj);
  }

  function _formatNumber(n) {
    if (n === null || n === undefined || n === '') return '';
    if (window.formatNumber) return window.formatNumber(n);
    return Number(n).toLocaleString('vi-VN');
  }

  function _formatDate(d) {
    if (!d) return '';
    if (window.formatDate) return window.formatDate(d);
    var date = d.toDate ? d.toDate() : new Date(d);
    return date.toLocaleDateString('vi-VN');
  }

  /**
   * Create a DataTable instance
   * @param {string} containerId - DOM container ID
   * @param {Object} options - Configuration
   * @returns {Object} DataTable instance
   */
  function create(containerId, options) {
    _injectStyles();
    options = options || {};

    var container = document.getElementById(containerId);
    if (!container) {
      console.error('DataTable: Container #' + containerId + ' not found');
      return null;
    }

    // === Config ===
    var columns = options.columns || [];
    var filters = options.filters || [];
    var pageSize = options.pageSize || 0; // 0 = no pagination
    var searchPlaceholder = options.searchPlaceholder || 'Tìm kiếm...';
    var emptyText = options.emptyText || 'Chưa có dữ liệu';
    var emptyIcon = options.emptyIcon || '📋';
    var showExport = options.showExport || false;
    var exportFileName = options.exportFileName || 'export';
    var exportSheetName = options.exportSheetName || 'Sheet1';
    var exportTitle = options.exportTitle || null;
    var onRowClick = options.onRowClick || null;
    var toolbar = options.toolbar || {};
    var dateFilter = options.dateFilter || null; // { key, label }
    var showSearch = options.showSearch !== false;
    var rowClass = options.rowClass || null; // function(row) => 'css-class'

    // === State ===
    var allData = [];
    var filteredData = [];
    var displayData = [];
    var currentPage = 1;
    var sortKey = null;
    var sortDir = 'asc';
    var searchTerm = '';
    var filterValues = {};
    var dateFilterValue = '';

    // === DOM References ===
    var searchInput, tbody, thead, footerInfo, footerPagination, tableWrap;

    // === Build DOM ===
    function buildDOM() {
      var html = '<div class="dt-wrapper">';

      // Toolbar
      var hasToolbar = showSearch || filters.length > 0 || dateFilter || showExport || toolbar.onCreate;
      if (hasToolbar) {
        html += '<div class="dt-toolbar">';

        // Search box
        if (showSearch) {
          html += '<div class="dt-search">' +
            '<span class="dt-search-icon">🔍</span>' +
            '<input type="text" class="dt-search-input" placeholder="' + searchPlaceholder + '">' +
            '</div>';
        }

        // Filters
        if (filters.length > 0 || dateFilter) {
          html += '<div class="dt-filter-group">';
          filters.forEach(function(f, idx) {
            html += '<select class="dt-filter" data-filter-key="' + f.key + '">';
            (f.options || []).forEach(function(opt) {
              html += '<option value="' + (opt.value || '') + '">' + opt.label + '</option>';
            });
            html += '</select>';
          });
          if (dateFilter) {
            html += '<input type="date" class="dt-filter-date" data-filter-key="' + dateFilter.key + '" title="' + (dateFilter.label || 'Ngày') + '">';
          }
          html += '</div>';
        }

        // Right actions
        html += '<div class="dt-actions-right">';
        if (showExport) {
          html += '<button class="dt-btn dt-btn-secondary dt-export-btn" title="Xuất Excel">📥 Xuất Excel</button>';
        }
        if (toolbar.onCreate) {
          html += '<button class="dt-btn dt-btn-primary dt-create-btn">' + (toolbar.createLabel || '+ Thêm mới') + '</button>';
        }
        // Custom toolbar buttons
        if (toolbar.buttons && toolbar.buttons.length) {
          toolbar.buttons.forEach(function(btn, i) {
            html += '<button class="dt-btn ' + (btn.cls || 'dt-btn-secondary') + ' dt-custom-btn" data-btn-idx="' + i + '">' + (btn.label || '') + '</button>';
          });
        }
        html += '</div></div>'; // close actions-right + toolbar
      }

      // Table
      html += '<div class="dt-table-wrap"><table class="dt-table">';
      html += '<thead><tr>';
      columns.forEach(function(col) {
        var cls = col.sortable ? ' class="dt-sortable"' : '';
        var sortIcon = col.sortable ? '<span class="dt-sort-icon">⇅</span>' : '';
        html += '<th' + cls + ' data-key="' + col.key + '">' + col.header + sortIcon + '</th>';
      });
      html += '</tr></thead>';
      html += '<tbody></tbody></table></div>';

      // Footer (pagination)
      if (pageSize > 0) {
        html += '<div class="dt-footer">' +
          '<div class="dt-page-info"></div>' +
          '<div class="dt-pagination"></div>' +
          '</div>';
      }

      html += '</div>'; // close dt-wrapper
      container.innerHTML = html;

      // Cache DOM refs
      searchInput = container.querySelector('.dt-search-input');
      tbody = container.querySelector('.dt-table tbody');
      thead = container.querySelector('.dt-table thead');
      tableWrap = container.querySelector('.dt-table-wrap');
      footerInfo = container.querySelector('.dt-page-info');
      footerPagination = container.querySelector('.dt-pagination');

      bindEvents();
    }

    function bindEvents() {
      // Search
      if (searchInput) {
        var debounceTimer = null;
        searchInput.addEventListener('input', function() {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(function() {
            searchTerm = searchInput.value;
            currentPage = 1;
            applyAll();
          }, 200);
        });
      }

      // Filters
      container.querySelectorAll('.dt-filter').forEach(function(sel) {
        sel.addEventListener('change', function() {
          filterValues[sel.dataset.filterKey] = sel.value;
          currentPage = 1;
          applyAll();
        });
      });

      // Date filter
      var dateInput = container.querySelector('.dt-filter-date');
      if (dateInput) {
        dateInput.addEventListener('change', function() {
          dateFilterValue = dateInput.value;
          currentPage = 1;
          applyAll();
        });
      }

      // Sort
      if (thead) {
        thead.addEventListener('click', function(e) {
          var th = e.target.closest('th.dt-sortable');
          if (!th) return;
          var key = th.dataset.key;
          if (sortKey === key) {
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            sortKey = key;
            sortDir = 'asc';
          }
          currentPage = 1;
          applyAll();
          updateSortHeaders();
        });
      }

      // Export
      var exportBtn = container.querySelector('.dt-export-btn');
      if (exportBtn) {
        exportBtn.addEventListener('click', doExport);
      }

      // Create button
      var createBtn = container.querySelector('.dt-create-btn');
      if (createBtn && toolbar.onCreate) {
        createBtn.addEventListener('click', toolbar.onCreate);
      }

      // Custom toolbar buttons
      container.querySelectorAll('.dt-custom-btn').forEach(function(btn) {
        var idx = parseInt(btn.dataset.btnIdx);
        if (toolbar.buttons && toolbar.buttons[idx] && toolbar.buttons[idx].onClick) {
          btn.addEventListener('click', toolbar.buttons[idx].onClick);
        }
      });

      // Row click
      if (onRowClick) {
        tbody.addEventListener('click', function(e) {
          // Skip if clicking action button
          if (e.target.closest('.action-btn') || e.target.closest('.dt-action-btn')) return;
          var tr = e.target.closest('tr');
          if (tr && tr.dataset.rowIdx !== undefined) {
            var idx = parseInt(tr.dataset.rowIdx);
            if (displayData[idx]) onRowClick(displayData[idx]);
          }
        });
      }
    }

    // === Data Pipeline ===

    function applyAll() {
      filteredData = applySearch(allData);
      filteredData = applyFilters(filteredData);
      filteredData = applyDateFilter(filteredData);
      filteredData = applySort(filteredData);
      applyPagination();
      render();
    }

    function applySearch(data) {
      if (!searchTerm || !searchTerm.trim()) return data.slice();
      var term = _removeDiacritics(searchTerm.trim());
      var searchCols = columns.filter(function(c) { return c.searchable; });
      if (searchCols.length === 0) {
        // Default: search all string columns
        searchCols = columns.filter(function(c) { return c.type !== 'actions' && c.type !== 'badge'; });
      }
      return data.filter(function(row) {
        return searchCols.some(function(col) {
          var val = _getNestedValue(row, col.key);
          if (val === null || val === undefined) return false;
          return _removeDiacritics(String(val)).indexOf(term) !== -1;
        });
      });
    }

    function applyFilters(data) {
      var result = data;
      for (var key in filterValues) {
        if (!filterValues[key]) continue;
        var fv = filterValues[key];
        var filterDef = filters.find(function(f) { return f.key === key; });
        if (filterDef && filterDef.filterFn) {
          result = result.filter(function(row) { return filterDef.filterFn(row, fv); });
        } else {
          result = result.filter(function(row) {
            return String(_getNestedValue(row, key) || '') === fv;
          });
        }
      }
      return result;
    }

    function applyDateFilter(data) {
      if (!dateFilter || !dateFilterValue) return data;
      var key = dateFilter.key;
      return data.filter(function(row) {
        var val = _getNestedValue(row, key);
        if (!val) return false;
        var d = val.toDate ? val.toDate() : new Date(val);
        return d.toISOString().slice(0, 10) === dateFilterValue;
      });
    }

    function applySort(data) {
      if (!sortKey) return data;
      var col = columns.find(function(c) { return c.key === sortKey; });
      var dir = sortDir === 'asc' ? 1 : -1;
      return data.slice().sort(function(a, b) {
        var va = _getNestedValue(a, sortKey);
        var vb = _getNestedValue(b, sortKey);
        if (va === null || va === undefined) va = '';
        if (vb === null || vb === undefined) vb = '';
        if (col && (col.type === 'number' || col.type === 'percent')) {
          return (Number(va) - Number(vb)) * dir;
        }
        if (col && col.type === 'date') {
          var da = va.toDate ? va.toDate() : new Date(va);
          var db = vb.toDate ? vb.toDate() : new Date(vb);
          return (da - db) * dir;
        }
        return String(va).localeCompare(String(vb), 'vi') * dir;
      });
    }

    function applyPagination() {
      if (pageSize <= 0) {
        displayData = filteredData;
        return;
      }
      var totalPages = Math.ceil(filteredData.length / pageSize) || 1;
      if (currentPage > totalPages) currentPage = totalPages;
      var start = (currentPage - 1) * pageSize;
      displayData = filteredData.slice(start, start + pageSize);
    }

    // === Render ===

    function render() {
      renderBody();
      renderFooter();
    }

    function renderBody() {
      if (!tbody) return;
      if (displayData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="' + columns.length + '">' +
          '<div class="dt-empty"><div class="dt-empty-icon">' + emptyIcon + '</div>' +
          '<div class="dt-empty-text">' + emptyText + '</div></div></td></tr>';
        return;
      }

      var html = '';
      displayData.forEach(function(row, rowIdx) {
        var trCls = rowClass ? rowClass(row) : '';
        var clickable = onRowClick ? ' style="cursor:pointer"' : '';
        html += '<tr data-row-idx="' + rowIdx + '"' + (trCls ? ' class="' + trCls + '"' : '') + clickable + '>';
        columns.forEach(function(col) {
          html += renderCell(row, col);
        });
        html += '</tr>';
      });
      tbody.innerHTML = html;
    }

    function renderCell(row, col) {
      var val = _getNestedValue(row, col.key);
      var cls = '';
      var style = col.style || '';
      var content = '';

      switch (col.type) {
        case 'number':
          cls = ' class="dt-num"';
          content = col.format ? col.format(val, row) : _formatNumber(val);
          break;

        case 'percent':
          cls = ' class="dt-num"';
          if (col.format) {
            content = col.format(val, row);
          } else {
            content = (val !== null && val !== undefined) ? Number(val).toFixed(1) + '%' : '';
          }
          break;

        case 'date':
          content = col.format ? col.format(val, row) : _formatDate(val);
          break;

        case 'badge':
          content = renderBadge(val, col, row);
          break;

        case 'html':
          content = col.format ? col.format(val, row) : (val || '');
          break;

        case 'actions':
          content = renderActions(row, col);
          break;

        default:
          if (col.format) {
            content = col.format(val, row);
          } else {
            content = val !== null && val !== undefined ? String(val) : '';
          }
          if (col.bold) content = '<strong>' + content + '</strong>';
          if (col.truncate) cls = ' class="dt-truncate"';
      }

      if (style) style = ' style="' + style + '"';
      return '<td' + cls + style + '>' + content + '</td>';
    }

    function renderBadge(val, col, row) {
      if (col.badgeMap) {
        var badge = col.badgeMap[val];
        if (badge) {
          return '<span class="status-badge ' + (badge.cls || '') + '">' + (badge.label || val) + '</span>';
        }
      }
      if (col.badgeFn) {
        return col.badgeFn(val, row);
      }
      return val || '';
    }

    function renderActions(row, col) {
      if (!col.actions || !col.actions.length) return '';
      var html = '<div class="action-btns">';
      col.actions.forEach(function(act, actIdx) {
        if (act.visible && !act.visible(row)) return;
        html += '<button class="action-btn dt-action-btn ' + (act.cls || '') +
          '" data-act-idx="' + actIdx + '" data-col-key="' + col.key +
          '" title="' + (act.title || '') + '">' + (act.icon || '') + '</button>';
      });
      html += '</div>';
      return html;
    }

    function renderFooter() {
      if (pageSize <= 0) return;
      var total = filteredData.length;
      var totalPages = Math.ceil(total / pageSize) || 1;
      var start = (currentPage - 1) * pageSize + 1;
      var end = Math.min(currentPage * pageSize, total);

      if (footerInfo) {
        footerInfo.textContent = total > 0
          ? 'Hiển thị ' + start + '-' + end + ' / ' + total
          : 'Không có dữ liệu';
      }

      if (footerPagination) {
        var html = '';
        html += '<button class="dt-page-btn dt-prev-btn"' + (currentPage <= 1 ? ' disabled' : '') + '>‹</button>';

        var startPage = Math.max(1, currentPage - 2);
        var endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

        for (var p = startPage; p <= endPage; p++) {
          html += '<button class="dt-page-btn' + (p === currentPage ? ' dt-active' : '') + '" data-page="' + p + '">' + p + '</button>';
        }
        html += '<button class="dt-page-btn dt-next-btn"' + (currentPage >= totalPages ? ' disabled' : '') + '>›</button>';
        footerPagination.innerHTML = html;

        // Page click events
        footerPagination.querySelectorAll('[data-page]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            currentPage = parseInt(btn.dataset.page);
            applyPagination();
            render();
          });
        });
        var prevBtn = footerPagination.querySelector('.dt-prev-btn');
        if (prevBtn) prevBtn.addEventListener('click', function() {
          if (currentPage > 1) { currentPage--; applyPagination(); render(); }
        });
        var nextBtn = footerPagination.querySelector('.dt-next-btn');
        if (nextBtn) nextBtn.addEventListener('click', function() {
          if (currentPage < totalPages) { currentPage++; applyPagination(); render(); }
        });
      }
    }

    function updateSortHeaders() {
      if (!thead) return;
      thead.querySelectorAll('th').forEach(function(th) {
        th.classList.remove('dt-sort-asc', 'dt-sort-desc');
        if (th.dataset.key === sortKey) {
          th.classList.add(sortDir === 'asc' ? 'dt-sort-asc' : 'dt-sort-desc');
          var icon = th.querySelector('.dt-sort-icon');
          if (icon) icon.textContent = sortDir === 'asc' ? '↑' : '↓';
        } else {
          var icon = th.querySelector('.dt-sort-icon');
          if (icon) icon.textContent = '⇅';
        }
      });
    }

    // === Actions delegation ===
    function setupActionDelegation() {
      if (!tbody) return;
      tbody.addEventListener('click', function(e) {
        var btn = e.target.closest('.dt-action-btn');
        if (!btn) return;
        e.stopPropagation();
        var actIdx = parseInt(btn.dataset.actIdx);
        var colKey = btn.dataset.colKey;
        var tr = btn.closest('tr');
        var rowIdx = parseInt(tr.dataset.rowIdx);
        var row = displayData[rowIdx];
        if (!row) return;
        var col = columns.find(function(c) { return c.key === colKey; });
        if (col && col.actions && col.actions[actIdx] && col.actions[actIdx].onClick) {
          col.actions[actIdx].onClick(row);
        }
      });
    }

    // === Export ===
    function doExport() {
      var exportData = filteredData.length > 0 ? filteredData : allData;
      var exportCols = columns.filter(function(c) { return c.type !== 'actions'; });

      if (typeof ExportService !== 'undefined' && ExportService.toExcel) {
        ExportService.toExcel({
          data: exportData,
          columns: exportCols.map(function(c) {
            return {
              key: c.key,
              header: c.header,
              width: c.exportWidth || c.width || undefined,
              format: c.exportFormat || c.format || undefined
            };
          }),
          fileName: exportFileName,
          sheetName: exportSheetName,
          title: exportTitle
        });
      } else if (typeof XLSX !== 'undefined') {
        // Fallback direct XLSX usage
        var wsData = [exportCols.map(function(c) { return c.header; })];
        exportData.forEach(function(row) {
          wsData.push(exportCols.map(function(c) {
            var val = _getNestedValue(row, c.key);
            if (c.exportFormat) return c.exportFormat(val, row);
            if (c.format) return c.format(val, row);
            return val != null ? val : '';
          }));
        });
        var ws = XLSX.utils.aoa_to_sheet(wsData);
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, exportSheetName);
        XLSX.writeFile(wb, exportFileName + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
      } else {
        console.warn('DataTable: No export library available');
      }
    }

    // === Dynamic columns (e.g. Tests table) ===
    function updateColumns(newColumns) {
      columns = newColumns;
      // Rebuild thead
      if (thead) {
        var thRow = '<tr>';
        columns.forEach(function(col) {
          var cls = col.sortable ? ' class="dt-sortable"' : '';
          var sortIcon = col.sortable ? '<span class="dt-sort-icon">⇅</span>' : '';
          thRow += '<th' + cls + ' data-key="' + col.key + '">' + col.header + sortIcon + '</th>';
        });
        thRow += '</tr>';
        thead.innerHTML = thRow;
      }
      sortKey = null;
      sortDir = 'asc';
      applyAll();
    }

    // === Initialize ===
    buildDOM();
    setupActionDelegation();

    // === Public API ===
    var instance = {
      /**
       * Set data array and re-render
       * @param {Array} data
       */
      setData: function(data) {
        allData = data || [];
        currentPage = 1;
        applyAll();
      },

      /**
       * Get current filtered data
       * @returns {Array}
       */
      getFilteredData: function() {
        return filteredData;
      },

      /**
       * Get all data
       * @returns {Array}
       */
      getData: function() {
        return allData;
      },

      /**
       * Refresh render without changing data
       */
      refresh: function() {
        applyAll();
      },

      /**
       * Update columns dynamically (e.g. SVR vs Latex)
       * @param {Array} newColumns
       */
      updateColumns: updateColumns,

      /**
       * Set search term programmatically
       * @param {string} term
       */
      setSearch: function(term) {
        searchTerm = term;
        if (searchInput) searchInput.value = term;
        currentPage = 1;
        applyAll();
      },

      /**
       * Set filter value programmatically
       * @param {string} key
       * @param {string} value
       */
      setFilter: function(key, value) {
        filterValues[key] = value;
        var sel = container.querySelector('.dt-filter[data-filter-key="' + key + '"]');
        if (sel) sel.value = value;
        currentPage = 1;
        applyAll();
      },

      /**
       * Set date filter programmatically
       * @param {string} dateStr - YYYY-MM-DD
       */
      setDateFilter: function(dateStr) {
        dateFilterValue = dateStr;
        var dateInput = container.querySelector('.dt-filter-date');
        if (dateInput) dateInput.value = dateStr;
        currentPage = 1;
        applyAll();
      },

      /**
       * Sort by column
       * @param {string} key
       * @param {string} [dir='asc']
       */
      sortBy: function(key, dir) {
        sortKey = key;
        sortDir = dir || 'asc';
        currentPage = 1;
        applyAll();
        updateSortHeaders();
      },

      /**
       * Go to specific page
       * @param {number} page
       */
      goToPage: function(page) {
        currentPage = page;
        applyPagination();
        render();
      },

      /**
       * Export current data to Excel
       */
      export: doExport,

      /**
       * Get container element
       * @returns {HTMLElement}
       */
      getContainer: function() { return container; },

      /**
       * Destroy instance and clean up
       */
      destroy: function() {
        container.innerHTML = '';
        delete instances[containerId];
      }
    };

    instances[containerId] = instance;
    return instance;
  }

  /**
   * Get existing instance by container ID
   * @param {string} containerId
   * @returns {Object|null}
   */
  function getInstance(containerId) {
    return instances[containerId] || null;
  }

  return {
    create: create,
    getInstance: getInstance
  };
})();
