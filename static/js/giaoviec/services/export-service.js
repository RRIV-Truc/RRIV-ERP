// CSV Export
// =============================================
function exportTasksCSV() {
  var tasks = getVisibleTasks();
  if (tasks.length === 0) {
    showToast('Không có dữ liệu để xuất', 'warning');
    return;
  }

  var headers = ['Tên công việc', 'Trạng thái', 'Ưu tiên', 'Đơn vị chủ trì', 'Ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n', 'Hạn hoàn thành', 'Tiến độ (%)', 'Nguồn', 'Người tạo', 'Ngày tạo'];
  var rows = [headers.join(',')];

  tasks.forEach(function(t) {
    var due = t.dueDate ? (t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate)) : null;
    var created = t.createdAt ? (t.createdAt.toDate ? t.createdAt.toDate() : new Date(t.createdAt)) : null;
    var row = [
      '"' + (t.title || '').replace(/"/g, '""') + '"',
      getStatusLabel(t.status),
      t.priority || '',
      '"' + (t.assignedDept ? t.assignedDept.name : '').replace(/"/g, '""') + '"',
      '"' + (t.assignedTo ? t.assignedTo.name : '').replace(/"/g, '""') + '"',
      due ? formatDate(due) : '',
      t.progress || 0,
      '"' + ((t.sourceType || '') + (t.sourceRef ? ' - ' + t.sourceRef : '')).replace(/"/g, '""') + '"',
      '"' + (t.createdBy ? t.createdBy.name : '').replace(/"/g, '""') + '"',
      created ? formatDate(created) : ''
    ];
    rows.push(row.join(','));
  });

  var csvContent = '\uFEFF' + rows.join('\n'); // BOM for UTF-8
  var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'giao-viec-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('\u0110\u00E3 xu\u1EA5t ' + tasks.length + ' c\u00F4ng vi\u1EC7c ra file CSV', 'success');
}

// =============================================
// Excel Export (XLSX via SheetJS)
// =============================================
function exportTasksExcel() {
  if (typeof XLSX === 'undefined') { showToast('SheetJS ch\u01B0a t\u1EA3i xong. Vui l\u00F2ng th\u1EED l\u1EA1i.', 'warning'); return; }

  var tasks = getVisibleTasks();
  if (tasks.length === 0) { showToast('Kh\u00F4ng c\u00F3 d\u1EEF li\u1EC7u \u0111\u1EC3 xu\u1EA5t', 'warning'); return; }

  var headers = ['Tên công việc', 'Mô tả', 'Trạng thái', 'Ưu tiên', 'Đơn vị chủ trì', 'Ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n', 'Hạn hoàn thành', 'Tiến độ (%)', 'Nhãn', 'Phụ thuộc', 'Nguồn', 'Người tạo', 'Ngày tạo', 'Ngày hoàn thành'];
  var data = [headers];

  tasks.forEach(function(t) {
    var due = t.dueDate ? (t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate)) : null;
    var created = t.createdAt ? (t.createdAt.toDate ? t.createdAt.toDate() : new Date(t.createdAt)) : null;
    var completed = t.completedAt ? (t.completedAt.toDate ? t.completedAt.toDate() : new Date(t.completedAt)) : null;
    var depTitles = (t.dependencies || []).map(function(dep) {
      var depId = getDepId(dep);
      var dt = allTasks.find(function(x) { return x.id === depId; });
      return dt ? dt.title : depId;
    }).join('; ');

    data.push([
      t.title || '',
      t.description || '',
      getStatusLabel(t.status),
      t.priority || 'P2',
      t.assignedDept ? t.assignedDept.name : '',
      t.assignedTo ? t.assignedTo.name : '',
      due ? due.toISOString().slice(0, 10) : '',
      t.progress || 0,
      (t.tags || []).join(', '),
      depTitles,
      (t.sourceType || '') + (t.sourceRef ? ' - ' + t.sourceRef : ''),
      t.createdBy ? t.createdBy.name : '',
      created ? created.toISOString().slice(0, 10) : '',
      completed ? completed.toISOString().slice(0, 10) : ''
    ]);
  });

  var ws = XLSX.utils.aoa_to_sheet(data);

  // Column widths
  ws['!cols'] = [
    {wch:35}, {wch:50}, {wch:16}, {wch:8}, {wch:20}, {wch:18},
    {wch:14}, {wch:10}, {wch:20}, {wch:25}, {wch:15}, {wch:18}, {wch:12}, {wch:12}
  ];

  // Freeze header row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Công việc');
  XLSX.writeFile(wb, 'giao-viec-' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('\u0110\u00E3 xu\u1EA5t ' + tasks.length + ' c\u00F4ng vi\u1EC7c ra file Excel', 'success');
}

// =============================================
// Excel Import Enhancement
// =============================================
var _importParsedData = null; // {headers: [], rows: [[]]}
var _importColumnMap = {};     // {targetField: sourceColumnIndex}
var _importTargetFields = [
  { key: 'title', label: 'T\u00EAn c\u00F4ng vi\u1EC7c', required: true },
  { key: 'dept', label: '\u0110\u01A1n v\u1ECB' },
  { key: 'priority', label: '\u01AFu ti\u00EAn' },
  { key: 'dueDate', label: 'H\u1EA1n' },
  { key: 'description', label: 'M\u00F4 t\u1EA3' },
  { key: 'tags', label: 'Tags' }
];

// Auto-detect column mapping from header names
var _importHeaderAliases = {
  title: ['t\u00EAn','t\u00EAn c\u00F4ng vi\u1EC7c','title','task','name','c\u00F4ng vi\u1EC7c','n\u1ED9i dung'],
  dept: ['\u0111\u01A1n v\u1ECB','ph\u00F2ng ban','department','dept','\u0111\u01A1n v\u1ECB ch\u1EE7 tr\u00EC','ch\u1EE7 tr\u00EC'],
  priority: ['\u01B0u ti\u00EAn','priority','m\u1EE9c \u0111\u1ED9'],
  dueDate: ['h\u1EA1n','deadline','due','due date','h\u1EA1n ho\u00E0n th\u00E0nh','th\u1EDDi h\u1EA1n','ng\u00E0y h\u1EA1n'],
  description: ['m\u00F4 t\u1EA3','description','chi ti\u1EBFt','ghi ch\u00FA','note'],
  tags: ['tags','nh\u00E3n','label']
};

function handleImportFileDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('dragover');
  if (event.dataTransfer.files.length > 0) parseImportFile(event.dataTransfer.files[0]);
}

function handleImportFileSelect(input) {
  if (input.files.length > 0) parseImportFile(input.files[0]);
  input.value = '';
}

function parseImportFile(file) {
  if (typeof XLSX === 'undefined') { showToast('SheetJS ch\u01B0a t\u1EA3i xong', 'warning'); return; }

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = new Uint8Array(e.target.result);
      var workbook = XLSX.read(data, { type: 'array' });
      var firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      var json = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

      if (json.length < 2) { showToast('File c\u1EA7n \u00EDt nh\u1EA5t 2 d\u00F2ng (header + data)', 'warning'); return; }

      _importParsedData = {
        headers: json[0].map(function(h) { return String(h || '').trim(); }),
        rows: json.slice(1).filter(function(row) { return row.some(function(c) { return c !== undefined && c !== null && String(c).trim(); }); })
      };

      // Auto-detect column mapping
      autoDetectColumnMapping();
      renderColumnMapping();
      applyColumnMapping();

      // Update drop zone to show file name
      document.getElementById('importDropZone').innerHTML = '<div style="font-size:14px;">✅</div><div style="font-size:14px;font-weight:600;color:var(--success);">' + escapeHtml(file.name) + '</div><div style="font-size:12px;color:var(--text-muted);">' + _importParsedData.rows.length + ' dòng dữ liệu · Click để chọn file khác</div>';
    } catch (err) {
      showToast('L\u1ED7i \u0111\u1ECDc file: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function autoDetectColumnMapping() {
  _importColumnMap = {};
  if (!_importParsedData) return;

  _importTargetFields.forEach(function(field) {
    var aliases = _importHeaderAliases[field.key] || [];
    _importParsedData.headers.forEach(function(h, idx) {
      var hLower = h.toLowerCase().trim();
      if (aliases.some(function(a) { return hLower.indexOf(a) !== -1 || a.indexOf(hLower) !== -1; })) {
        if (_importColumnMap[field.key] === undefined) _importColumnMap[field.key] = idx;
      }
    });
  });
}

function renderColumnMapping() {
  var section = document.getElementById('importMappingSection');
  var table = document.getElementById('importMappingTable');
  if (!_importParsedData) { section.style.display = 'none'; return; }
  section.style.display = '';

  var html = '<table class="import-mapping-table"><thead><tr><th>Trường</th><th>Cột trong file</th><th>Mẫu dữ liệu</th></tr></thead><tbody>';
  _importTargetFields.forEach(function(field) {
    var selectedIdx = _importColumnMap[field.key];
    html += '<tr>';
    html += '<td style="font-weight:600;">' + field.label + (field.required ? ' *' : '') + '</td>';
    html += '<td><select class="import-mapping-select" onchange="updateColumnMapping(\'' + field.key + '\',this.value)">';
    html += '<option value="">-- B\u1ECF qua --</option>';
    _importParsedData.headers.forEach(function(h, idx) {
      html += '<option value="' + idx + '"' + (selectedIdx === idx ? ' selected' : '') + '>' + escapeHtml(h) + '</option>';
    });
    html += '</select></td>';
    html += '<td style="font-size:12px;color:var(--text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">';
    if (selectedIdx !== undefined && _importParsedData.rows[0]) {
      html += escapeHtml(String(_importParsedData.rows[0][selectedIdx] || ''));
    }
    html += '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  table.innerHTML = html;
}

function updateColumnMapping(fieldKey, colIdx) {
  if (colIdx === '') {
    delete _importColumnMap[fieldKey];
  } else {
    _importColumnMap[fieldKey] = parseInt(colIdx);
  }
  renderColumnMapping();
  applyColumnMapping();
}

function applyColumnMapping() {
  if (!_importParsedData) return;
  _csvParsedRows = [];

  _importParsedData.rows.forEach(function(row) {
    var getVal = function(key) {
      var idx = _importColumnMap[key];
      return idx !== undefined ? String(row[idx] || '').trim() : '';
    };

    var r = {
      title: getVal('title'),
      dept: getVal('dept'),
      priority: (function(v) { var map = {'khẩn cấp':'P1','bình thường':'P2','không gấp':'P3'}; return map[(v||'').toLowerCase()] || (v||'P2').toUpperCase(); })(getVal('priority')),
      dueDate: getVal('dueDate'),
      description: getVal('description'),
      tags: getVal('tags'),
      valid: true,
      error: ''
    };

    if (!r.title) { r.valid = false; r.error = 'Thi\u1EBFu t\u00EAn'; }
    if (!['P1','P2','P3'].includes(r.priority)) r.priority = 'P2';
    if (r.dueDate && isNaN(Date.parse(r.dueDate))) { r.valid = false; r.error = 'Ng\u00E0y kh\u00F4ng h\u1EE3p l\u1EC7'; }

    _csvParsedRows.push(r);
  });

  // Render preview
  var preview = document.getElementById('csvPreview');
  var validCount = _csvParsedRows.filter(function(r) { return r.valid; }).length;

  var html = '<div style="font-size:14px;color:var(--text-secondary);margin-bottom:6px;">' + _csvParsedRows.length + ' d\u00F2ng, ' + validCount + ' h\u1EE3p l\u1EC7</div>';
  html += '<table class="csv-preview-table"><thead><tr>';
  html += '<th>#</th><th>T\u00EAn</th><th>\u0110\u01A1n v\u1ECB</th><th>\u01AFu ti\u00EAn</th><th>H\u1EA1n</th><th>Status</th>';
  html += '</tr></thead><tbody>';

  _csvParsedRows.forEach(function(row, idx) {
    html += '<tr class="' + (row.valid ? '' : 'csv-row-error') + '">';
    html += '<td>' + (idx + 1) + '</td>';
    html += '<td>' + escapeHtml(row.title) + '</td>';
    html += '<td>' + escapeHtml(row.dept) + '</td>';
    html += '<td><span class="badge badge-' + row.priority.toLowerCase() + '">' + row.priority + '</span></td>';
    html += '<td>' + escapeHtml(row.dueDate) + '</td>';
    html += '<td>' + (row.valid ? '<span style="color:var(--success);">\u2713</span>' : '<span style="color:var(--danger);">' + escapeHtml(row.error) + '</span>') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';

  preview.innerHTML = html;
  document.getElementById('btnImportAll').disabled = validCount === 0;
  document.getElementById('btnImportAll').textContent = 'Nhập ' + validCount + ' công việc';
}

function downloadImportTemplate() {
  if (typeof XLSX === 'undefined') { showToast('SheetJS ch\u01B0a t\u1EA3i xong', 'warning'); return; }

  var headers = ['Tên công việc', 'Đơn vị', 'Ưu tiên (Khẩn cấp/Bình thường/Không gấp)', 'Hạn (YYYY-MM-DD)', 'Mô tả', 'Nhãn'];
  var example = ['Kiểm tra chất lượng batch #45', 'Phòng KCS', 'Khẩn cấp', '2026-03-15', 'Kiểm tra chất lượng sản phẩm batch 45', 'gấp, chất lượng'];
  var data = [headers, example];

  var ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:35},{wch:20},{wch:18},{wch:16},{wch:40},{wch:20}];

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'M\u1EABu');
  XLSX.writeFile(wb, 'import-template-giaoviec.xlsx');
  showToast('\u0110\u00E3 t\u1EA3i template', 'success');
}

function openExcelImport() {
  // Reset state
  _importParsedData = null;
  _importColumnMap = {};
  _csvParsedRows = [];
  document.getElementById('csvInput').value = '';
  document.getElementById('csvPreview').innerHTML = '';
  document.getElementById('importMappingSection').style.display = 'none';
  document.getElementById('btnImportAll').disabled = true;
  document.getElementById('importDropZone').innerHTML = '<div style="font-size:28px;margin-bottom:6px;">\uD83D\uDCCA</div><div style="font-size:14px;font-weight:600;color:var(--text);">Kéo thả file Excel/CSV vào đây</div><div style="font-size:12px;color:var(--text-muted);">hoặc click để chọn (.xlsx, .xls, .csv)</div>';
  openModal('csvImportModal');
}

// =============================================
// Real-time Firestore Listeners
// =============================================
var _taskListener = null;
var _notifListener = null;
var _realtimeReady = false;

function startRealtimeTaskListener() {
  if (_taskListener) return;
  _taskListener = db.collection('workTasks').orderBy('updatedAt', 'desc').limit(100)
    .onSnapshot(function(snapshot) {
      if (!_realtimeReady) {
        _realtimeReady = true;
        document.getElementById('liveDot').style.display = '';
        return; // Skip initial load (already handled by loadAllTasks)
      }

      // Update local cache with changes
      snapshot.docChanges().forEach(function(change) {
        var docData = { id: change.doc.id, ...change.doc.data() };
        if (change.type === 'added' || change.type === 'modified') {
          var idx = allTasks.findIndex(function(t) { return t.id === docData.id; });
          if (idx >= 0) {
            allTasks[idx] = docData;
          } else {
            allTasks.unshift(docData);
          }
        } else if (change.type === 'removed') {
          allTasks = allTasks.filter(function(t) { return t.id !== docData.id; });
        }
      });

      // Refresh all views
      loadDashboard();
      renderDeptPerformance();
      renderTaskList();
      loadMyTasks();
    }, function(err) {
      console.warn('Realtime task listener error:', err);
      document.getElementById('liveDot').style.display = 'none';
    });
}

function startRealtimeNotifListener() {
  if (!userData || _notifListener) return;
  _notifListener = db.collection('notifications')
    .where('recipientId', '==', userData.id)
    .orderBy('createdAt', 'desc')
    .limit(30)
    .onSnapshot(function(snapshot) {
      allNotifications = snapshot.docs.map(function(doc) { return { id: doc.id, ...doc.data() }; });
      renderNotifications();
    }, function(err) {
      console.warn('Realtime notif listener error:', err);
    });
}

function stopRealtimeListeners() {
  if (_taskListener) { _taskListener(); _taskListener = null; }
  if (_notifListener) { _notifListener(); _notifListener = null; }
  document.getElementById('liveDot').style.display = 'none';
}

// =============================================
// KPI Trend Chart (SVG Line Chart)
// =============================================
async function loadKPITrend() {
  var section = document.getElementById('kpiTrendSection');
  section.innerHTML = '<div class="loading-spinner"></div>';
  section.style.display = '';

  try {
    // Get last 6 periods
    var periods = [];
    var now = new Date();
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      periods.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    }

    // Fetch all KPI data for these periods
    var allKpiSnap = await db.collection('kpiEvaluations')
      .where('period', 'in', periods)
      .get();

    var allKpiDocs = allKpiSnap.docs.map(function(doc) { return { id: doc.id, ...doc.data() }; });

    if (allKpiDocs.length === 0) {
      section.innerHTML = '<div class="trend-container"><div class="empty-state"><div class="empty-state-text">Chưa có đủ dữ liệu KPI để vẽ xu hướng</div></div></div>';
      return;
    }

    // Aggregate by period: average totalScore, C, T, Q, F
    var periodData = periods.map(function(p) {
      var docs = allKpiDocs.filter(function(k) { return k.period === p; });
      if (docs.length === 0) return { period: p, avg: null, c: null, t: null, q: null, f: null, count: 0 };
      var avgTotal = docs.reduce(function(s, k) { return s + (k.totalScore || 0); }, 0) / docs.length;
      var avgC = docs.reduce(function(s, k) { return s + (k.completionScore || 0); }, 0) / docs.length;
      var avgT = docs.reduce(function(s, k) { return s + (k.timelinessScore || 0); }, 0) / docs.length;
      var avgQ = docs.reduce(function(s, k) { return s + (k.qualityScore || 0); }, 0) / docs.length;
      var avgF = docs.reduce(function(s, k) { return s + (k.feedbackScore || 0); }, 0) / docs.length;
      return { period: p, avg: avgTotal, c: avgC, t: avgT, q: avgQ, f: avgF, count: docs.length };
    });

    renderKPITrendChart(periodData, periods);
  } catch (e) {
    console.error('Load KPI trend error:', e);
    section.innerHTML = '<div class="trend-container"><div class="empty-state"><div class="empty-state-text">Lỗi tải dữ liệu xu hướng</div></div></div>';
  }
}

function renderKPITrendChart(data, periods) {
  var section = document.getElementById('kpiTrendSection');
  var W = 560, H = 160, padL = 35, padR = 15, padT = 10, padB = 30;
  var chartW = W - padL - padR;
  var chartH = H - padT - padB;

  var svg = '<svg class="trend-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';

  // Grid lines
  [0, 25, 50, 75, 100].forEach(function(v) {
    var y = padT + chartH - (v / 100) * chartH;
    svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="rgba(51,65,85,0.3)" stroke-width="0.5"/>';
    svg += '<text x="' + (padL - 5) + '" y="' + (y + 3) + '" text-anchor="end" font-size="9" fill="#64748b">' + v + '</text>';
  });

  // X-axis labels
  periods.forEach(function(p, i) {
    var x = padL + (i / Math.max(periods.length - 1, 1)) * chartW;
    var label = p.split('-')[1] + '/' + p.split('-')[0].slice(2);
    svg += '<text x="' + x + '" y="' + (H - 5) + '" text-anchor="middle" font-size="9" fill="#64748b">' + label + '</text>';
  });

  // Draw lines for each metric
  var lines = [
    { key: 'avg', color: '#1565a0', label: 'Tổng P' },
    { key: 'c', color: '#3b82f6', label: 'C' },
    { key: 't', color: '#22c55e', label: 'T' },
    { key: 'q', color: '#f59e0b', label: 'Q' },
    { key: 'f', color: '#a78bfa', label: 'F' }
  ];

  lines.forEach(function(line) {
    var points = [];
    data.forEach(function(d, i) {
      if (d[line.key] === null) return;
      var x = padL + (i / Math.max(data.length - 1, 1)) * chartW;
      var y = padT + chartH - (Math.min(d[line.key], 100) / 100) * chartH;
      points.push(x.toFixed(1) + ',' + y.toFixed(1));
    });
    if (points.length > 1) {
      svg += '<polyline points="' + points.join(' ') + '" fill="none" stroke="' + line.color + '" stroke-width="' + (line.key === 'avg' ? '2.5' : '1.5') + '" stroke-linecap="round" stroke-linejoin="round"' + (line.key !== 'avg' ? ' stroke-dasharray="4,3"' : '') + '/>';
    }
    // Data points
    data.forEach(function(d, i) {
      if (d[line.key] === null) return;
      var x = padL + (i / Math.max(data.length - 1, 1)) * chartW;
      var y = padT + chartH - (Math.min(d[line.key], 100) / 100) * chartH;
      svg += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (line.key === 'avg' ? '3.5' : '2.5') + '" fill="' + line.color + '" stroke="var(--bg-secondary)" stroke-width="1.5"/>';
      if (line.key === 'avg') {
        svg += '<text x="' + x.toFixed(1) + '" y="' + (y - 7).toFixed(1) + '" text-anchor="middle" font-size="9" font-weight="700" fill="' + line.color + '">' + d[line.key].toFixed(0) + '</text>';
      }
    });
  });

  svg += '</svg>';

  // Legend
  var legend = '<div class="trend-legend">';
  lines.forEach(function(l) {
    legend += '<div class="trend-legend-item"><div class="trend-legend-dot" style="background:' + l.color + ';"></div><span>' + l.label + '</span></div>';
  });
  legend += '</div>';

  section.innerHTML = '<div class="trend-container">' +
    '<div class="trend-header"><span class="trend-header-title">Xu hướng KPI (6 tháng gần nhất)</span></div>' +
    svg + legend + '</div>';
}

// =============================================
// Print Report
// =============================================
function printReport() {
  window.print();
}
