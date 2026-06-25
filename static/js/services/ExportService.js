/**
 * ExportService - Centralized Excel/CSV Export
 * Abstraction cho SheetJS (XLSX) export dùng chung
 * Thay thế 5+ hàm export trùng lặp trong các app-*.html
 *
 * @module ExportService
 * @requires XLSX (SheetJS library loaded from CDN)
 */

const ExportService = (function() {
  'use strict';

  /**
   * Export data array to Excel (.xlsx) file
   *
   * @param {Object} config - Export configuration
   * @param {Array<Object>} config.data - Array of data objects to export
   * @param {Array<Object>} config.columns - Column definitions
   *   Each column: { key: 'fieldName', header: 'Column Title', width: 20, format: (val) => displayVal }
   * @param {string} [config.fileName='export'] - File name (without extension)
   * @param {string} [config.sheetName='Sheet1'] - Sheet name
   * @param {string} [config.title] - Optional title row
   * @param {boolean} [config.autoWidth=true] - Auto-fit column widths
   * @param {Object} [config.headerStyle] - Custom header style
   *
   * @example
   * ExportService.toExcel({
   *   data: gardens,
   *   columns: [
   *     { key: 'name', header: 'Tên vườn', width: 25 },
   *     { key: 'area', header: 'Diện tích (ha)', width: 15, format: v => v?.toFixed(2) || '' },
   *     { key: 'eudrStatus', header: 'EUDR', width: 12 },
   *   ],
   *   fileName: 'vuon-cay-cao-su',
   *   sheetName: 'Vườn cây',
   *   title: 'DANH SÁCH VƯỜN CÂY CAO SU - RRIV'
   * });
   */
  function toExcel(config) {
    if (typeof XLSX === 'undefined') {
      console.error('[ExportService] XLSX library not loaded');
      _showToast('Lỗi: Thư viện xuất Excel chưa được tải', 'error');
      return;
    }

    const {
      data = [],
      columns = [],
      fileName = 'export',
      sheetName = 'Sheet1',
      title = null,
      autoWidth = true
    } = config;

    if (!data.length) {
      _showToast('Không có dữ liệu để xuất', 'warning');
      return;
    }

    try {
      // Build worksheet data
      const wsData = [];
      let rowOffset = 0;

      // Title row
      if (title) {
        wsData.push([title]);
        wsData.push([]); // Empty row after title
        rowOffset = 2;
      }

      // Header row
      const headers = columns.map(col => col.header || col.key);
      wsData.push(headers);

      // Data rows
      for (const item of data) {
        const row = columns.map(col => {
          let val = _getNestedValue(item, col.key);
          if (typeof col.format === 'function') {
            val = col.format(val, item);
          }
          return val !== null && val !== undefined ? val : '';
        });
        wsData.push(row);
      }

      // Create worksheet
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Column widths
      if (autoWidth) {
        ws['!cols'] = columns.map((col, i) => {
          if (col.width) return { wch: col.width };
          // Auto-calculate width from data
          let maxLen = (col.header || col.key).length;
          for (const item of data) {
            const val = _getNestedValue(item, col.key);
            const str = val != null ? String(val) : '';
            maxLen = Math.max(maxLen, str.length);
          }
          return { wch: Math.min(maxLen + 2, 50) };
        });
      }

      // Title merge (if title exists)
      if (title && columns.length > 1) {
        ws['!merges'] = [
          { s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } }
        ];
      }

      // Create workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);

      // Generate filename with date
      const dateStr = new Date().toISOString().slice(0, 10);
      const fullFileName = `${fileName}_${dateStr}.xlsx`;

      // Download
      XLSX.writeFile(wb, fullFileName);

      _showToast(`Đã xuất ${data.length} dòng → ${fullFileName}`, 'success');
      console.log(`📊 [ExportService] Exported ${data.length} rows to ${fullFileName}`);

    } catch (error) {
      console.error('[ExportService] Export failed:', error);
      _showToast('Lỗi xuất file: ' + error.message, 'error');
    }
  }

  /**
   * Export data to CSV format
   * @param {Object} config - Same as toExcel config
   */
  function toCSV(config) {
    const { data = [], columns = [], fileName = 'export' } = config;

    if (!data.length) {
      _showToast('Không có dữ liệu để xuất', 'warning');
      return;
    }

    try {
      const headers = columns.map(col => col.header || col.key);
      const rows = data.map(item =>
        columns.map(col => {
          let val = _getNestedValue(item, col.key);
          if (typeof col.format === 'function') val = col.format(val, item);
          val = val != null ? String(val) : '';
          // Escape CSV special characters
          if (val.includes(',') || val.includes('"') || val.includes('\n')) {
            val = '"' + val.replace(/"/g, '""') + '"';
          }
          return val;
        }).join(',')
      );

      const csv = [headers.join(','), ...rows].join('\n');
      const BOM = '\uFEFF'; // UTF-8 BOM for Excel compatibility
      const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const dateStr = new Date().toISOString().slice(0, 10);
      const fullFileName = `${fileName}_${dateStr}.csv`;

      const link = document.createElement('a');
      link.href = url;
      link.download = fullFileName;
      link.click();
      URL.revokeObjectURL(url);

      _showToast(`Đã xuất ${data.length} dòng → ${fullFileName}`, 'success');
    } catch (error) {
      console.error('[ExportService] CSV export failed:', error);
      _showToast('Lỗi xuất file: ' + error.message, 'error');
    }
  }

  /**
   * Export multiple sheets to one Excel file
   * @param {Object} config - Multi-sheet config
   * @param {Array<Object>} config.sheets - Array of { data, columns, sheetName }
   * @param {string} [config.fileName='export'] - File name
   * @param {string} [config.title] - Title for each sheet
   */
  function toExcelMultiSheet(config) {
    if (typeof XLSX === 'undefined') {
      _showToast('Lỗi: Thư viện xuất Excel chưa được tải', 'error');
      return;
    }

    const { sheets = [], fileName = 'export' } = config;

    try {
      const wb = XLSX.utils.book_new();

      for (const sheet of sheets) {
        const wsData = [];
        const { data = [], columns = [], sheetName = 'Sheet' } = sheet;

        if (sheet.title) {
          wsData.push([sheet.title]);
          wsData.push([]);
        }

        wsData.push(columns.map(col => col.header || col.key));

        for (const item of data) {
          wsData.push(columns.map(col => {
            let val = _getNestedValue(item, col.key);
            if (typeof col.format === 'function') val = col.format(val, item);
            return val != null ? val : '';
          }));
        }

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = columns.map(col => ({ wch: col.width || 15 }));

        XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `${fileName}_${dateStr}.xlsx`);

      const totalRows = sheets.reduce((sum, s) => sum + (s.data?.length || 0), 0);
      _showToast(`Đã xuất ${totalRows} dòng (${sheets.length} sheets)`, 'success');
    } catch (error) {
      console.error('[ExportService] Multi-sheet export failed:', error);
      _showToast('Lỗi xuất file: ' + error.message, 'error');
    }
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Get nested value from object using dot notation
   * @param {Object} obj - Source object
   * @param {string} path - Dot-separated path (e.g., 'stageData.tiepnhan.drc')
   * @returns {*} Value at path
   */
  function _getNestedValue(obj, path) {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((acc, key) => {
      return acc && acc[key] !== undefined ? acc[key] : undefined;
    }, obj);
  }

  /**
   * Show toast notification
   */
  function _showToast(message, type) {
    if (typeof showToast === 'function') {
      showToast(message, type);
    } else if (typeof Toast !== 'undefined' && typeof Toast.show === 'function') {
      Toast.show(message, type);
    } else {
      console.log(`[${type}] ${message}`);
    }
  }

  // ==================== PUBLIC API ====================

  return {
    toExcel,
    toCSV,
    toExcelMultiSheet
  };
})();
