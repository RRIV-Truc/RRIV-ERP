// =============================================
// Gantt Timeline Chart
// =============================================
function populateGanttDeptFilter() {
  var sel = document.getElementById('ganttDeptFilter');
  if (!sel) return;
  sel.innerHTML = '<option value="">Tất cả</option>';
  allDepartments.forEach(function(d) {
    var name = d.tenPhongBan || d.name || d.id;
    sel.innerHTML += '<option value="' + d.id + '">' + escapeHtml(name) + '</option>';
  });
}

var _ganttZoom = 'day';
var _ganttTaskRowMap = {}; // taskId -> row index for dep arrows

function setGanttZoom(level) {
  _ganttZoom = level;
  document.querySelectorAll('.gantt-zoom-btn').forEach(function(b) { b.classList.remove('active'); });
  var btn = document.getElementById('ganttZoom' + level.charAt(0).toUpperCase() + level.slice(1));
  if (btn) btn.classList.add('active');
  renderGanttChart();
}

function scrollGanttToToday() {
  var wrapper = document.getElementById('ganttContainer');
  var todayMarker = wrapper.querySelector('.gantt-today');
  if (todayMarker) {
    var cell = todayMarker.closest('td');
    if (cell) wrapper.scrollLeft = cell.offsetLeft - wrapper.clientWidth / 2;
  }
}

function showGanttTooltip(e, task) {
  var tip = document.getElementById('ganttTooltip');
  var due = task.dueDate ? (task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate)) : null;
  var created = task.createdAt ? (task.createdAt.toDate ? task.createdAt.toDate() : new Date(task.createdAt)) : null;
  var blocked = isTaskBlocked(task);

  var html = '<div class="tt-title">' + escapeHtml(task.title) + '</div>';
  html += '<div class="tt-row"><span>Trạng thái:</span><span>' + getStatusLabel(task.status) + '</span></div>';
  html += '<div class="tt-row"><span>Ưu tiên:</span><span>' + getPrioLabel(task.priority) + '</span></div>';
  if (task.assignedDept) html += '<div class="tt-row"><span>Đơn vị:</span><span>' + escapeHtml(task.assignedDept.name) + '</span></div>';
  if (task.assignedTo) html += '<div class="tt-row"><span>Ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n:</span><span>' + escapeHtml(task.assignedTo.name) + '</span></div>';
  if (created) html += '<div class="tt-row"><span>Bắt đầu:</span><span>' + formatDate(created) + '</span></div>';
  if (due) html += '<div class="tt-row"><span>Hạn:</span><span>' + formatDate(due) + '</span></div>';
  html += '<div class="tt-row"><span>Tiến độ:</span><span>' + (task.progress || 0) + '%</span></div>';
  if (blocked) html += '<div style="color:var(--danger);margin-top:4px;font-weight:600;">\uD83D\uDD12 Bị chặn</div>';

  tip.innerHTML = html;
  tip.style.display = '';
  tip.style.left = Math.min(e.clientX + 12, window.innerWidth - 300) + 'px';
  tip.style.top = (e.clientY + 12) + 'px';
}

function hideGanttTooltip() {
  document.getElementById('ganttTooltip').style.display = 'none';
}

function renderGanttChart() {
  var container = document.getElementById('ganttContainer');
  var tasks = getVisibleTasks().filter(function(t) {
    return t.status !== 'cancelled' && t.dueDate;
  });

  // Dept filter
  var deptFilter = document.getElementById('ganttDeptFilter');
  if (deptFilter && deptFilter.value) {
    var dId = deptFilter.value;
    tasks = tasks.filter(function(t) {
      return t.assignedDept && t.assignedDept.id === dId;
    });
  }

  // Populate dept filter
  if (deptFilter && deptFilter.options.length <= 1 && allDepartments.length > 0) {
    allDepartments.forEach(function(d) {
      var opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.ten || d.tenPhongBan || d.name || d.id;
      deptFilter.appendChild(opt);
    });
  }

  if (tasks.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">\uD83D\uDCC5</div><div class="empty-state-text">Không có công việc nào có thời hạn</div></div>';
    return;
  }

  var rangeDays = parseInt(document.getElementById('ganttRange').value) || 30;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 3);
  var endDate = new Date(today);
  endDate.setDate(endDate.getDate() + rangeDays);

  var zoom = _ganttZoom;
  var swimBy = document.getElementById('ganttSwimBy').value;

  // Generate time columns based on zoom
  var timeColumns = [];
  if (zoom === 'day') {
    var cur = new Date(startDate);
    while (cur < endDate) {
      timeColumns.push({ date: new Date(cur), label: cur.getDate() + (cur.getDate() === 1 || timeColumns.length === 0 ? '/' + (cur.getMonth() + 1) : '') });
      cur.setDate(cur.getDate() + 1);
    }
  } else if (zoom === 'week') {
    var cur = new Date(startDate);
    cur.setDate(cur.getDate() - cur.getDay() + 1); // Monday
    while (cur < endDate) {
      var weekEnd = new Date(cur); weekEnd.setDate(weekEnd.getDate() + 6);
      timeColumns.push({ date: new Date(cur), label: cur.getDate() + '/' + (cur.getMonth() + 1) });
      cur.setDate(cur.getDate() + 7);
    }
  } else { // month
    var cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (cur < endDate) {
      var monthNames = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];
      timeColumns.push({ date: new Date(cur), label: monthNames[cur.getMonth()] + '/' + (cur.getFullYear() % 100) });
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  var cellWidth = zoom === 'day' ? 22 : (zoom === 'week' ? 60 : 80);

  // Sort tasks
  tasks.sort(function(a, b) {
    var da = a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
    var db2 = b.dueDate.toDate ? b.dueDate.toDate() : new Date(b.dueDate);
    return da - db2;
  });

  // Build headers
  var dayHeaders = '';
  timeColumns.forEach(function(col) {
    var isToday = zoom === 'day' && col.date.toDateString() === today.toDateString();
    var isWeekend = zoom === 'day' && (col.date.getDay() === 0 || col.date.getDay() === 6);
    dayHeaders += '<th style="min-width:' + cellWidth + 'px;' + (isToday ? 'color:var(--primary);font-weight:700;' : '') + (isWeekend ? 'background:rgba(51,65,85,0.3);' : '') + '">' + col.label + '</th>';
  });

  var html = '<table class="gantt-table"><thead><tr><th style="min-width:200px;text-align:left;padding-left:8px;">Công việc</th>' + dayHeaders + '</tr></thead><tbody>';

  _ganttTaskRowMap = {};
  var rowIndex = 0;

  // Group by swimlane
  var taskGroups;
  if (swimBy === 'dept') {
    taskGroups = {};
    tasks.forEach(function(t) {
      var key = t.assignedDept ? t.assignedDept.name : 'Chưa gán';
      if (!taskGroups[key]) taskGroups[key] = [];
      taskGroups[key].push(t);
    });
  } else if (swimBy === 'priority') {
    taskGroups = {};
    ['P1','P2','P3'].forEach(function(p) { taskGroups[p] = []; });
    tasks.forEach(function(t) {
      var p = t.priority || 'P2';
      if (!taskGroups[p]) taskGroups[p] = [];
      taskGroups[p].push(t);
    });
  } else {
    taskGroups = { '': tasks };
  }

  Object.keys(taskGroups).forEach(function(groupKey) {
    var groupTasks = taskGroups[groupKey];
    if (groupTasks.length === 0) return;

    // Swimlane header row
    if (swimBy !== 'none' && groupKey) {
      html += '<tr class="gantt-swimlane-row"><td colspan="' + (timeColumns.length + 1) + '">' + escapeHtml(getPrioLabel(groupKey) || groupKey) + ' (' + groupTasks.length + ')</td></tr>';
      rowIndex++;
    }

    groupTasks.forEach(function(task) {
      var due = task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
      var created = task.createdAt ? (task.createdAt.toDate ? task.createdAt.toDate() : new Date(task.createdAt)) : new Date(due.getTime() - 7*86400000);
      var blocked = isTaskBlocked(task);
      var isMilestone = task.estimatedDays === 0;

      _ganttTaskRowMap[task.id] = rowIndex;
      rowIndex++;

      // Bar position based on zoom
      var barStart, barEnd;
      if (zoom === 'day') {
        barStart = Math.max(0, Math.floor((created - startDate) / 86400000));
        barEnd = Math.floor((due - startDate) / 86400000);
      } else if (zoom === 'week') {
        var weekStart = new Date(startDate); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
        barStart = Math.max(0, Math.floor((created - weekStart) / (7*86400000)));
        barEnd = Math.floor((due - weekStart) / (7*86400000));
      } else {
        var monthOrigin = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        barStart = Math.max(0, (created.getFullYear() - monthOrigin.getFullYear()) * 12 + created.getMonth() - monthOrigin.getMonth());
        barEnd = (due.getFullYear() - monthOrigin.getFullYear()) * 12 + due.getMonth() - monthOrigin.getMonth();
      }
      var barLen = Math.max(barEnd - barStart, 1);

      var barColor = task.status === 'completed' ? '#22c55e' :
                     task.status === 'review' ? '#ec4899' :
                     task.status === 'in_progress' ? '#a78bfa' :
                     task.status === 'approved' ? '#3b82f6' : '#64748b';

      var progress = task.progress || 0;
      var titleShort = (task.title || '').substring(0, 28) + ((task.title || '').length > 28 ? '...' : '');

      html += '<tr>';
      html += '<td class="gantt-task-name" onclick="openTaskDetail(\'' + task.id + '\')" title="' + escapeHtml(task.title) + '">';
      if (blocked) html += '<span style="color:var(--danger);margin-right:2px;">\uD83D\uDD12</span>';
      html += '<span class="badge badge-' + (task.priority || 'p2').toLowerCase() + '" style="margin-right:4px;">' + getPrioLabel(task.priority) + '</span>';
      html += escapeHtml(titleShort);
      html += '</td>';

      for (var d = 0; d < timeColumns.length; d++) {
        var col = timeColumns[d];
        var isToday = zoom === 'day' && col.date.toDateString() === today.toDateString();
        var isWeekend = zoom === 'day' && (col.date.getDay() === 0 || col.date.getDay() === 6);

        html += '<td style="min-width:' + cellWidth + 'px;' + (isWeekend ? 'background:rgba(51,65,85,0.15);' : '') + '">';
        if (d === barStart) {
          if (isMilestone) {
            html += '<div class="gantt-milestone" style="left:50%;margin-left:-8px;" onclick="event.stopPropagation();openTaskDetail(\'' + task.id + '\')" title="\u25C6 ' + escapeHtml(task.title) + '"';
            html += ' onmouseenter="showGanttTooltip(event,allTasks.find(function(t){return t.id===\'' + task.id + '\'}))"';
            html += ' onmouseleave="hideGanttTooltip()"></div>';
          } else {
            html += '<div class="gantt-bar" style="left:0;min-width:' + Math.max(barLen * cellWidth, 20) + 'px;background:' + barColor + ';"';
            html += ' onclick="event.stopPropagation();openTaskDetail(\'' + task.id + '\')"';
            html += ' onmouseenter="showGanttTooltip(event,allTasks.find(function(t){return t.id===\'' + task.id + '\'}))"';
            html += ' onmouseleave="hideGanttTooltip()">';
            html += '<div style="position:absolute;left:0;top:0;bottom:0;width:' + progress + '%;background:rgba(255,255,255,0.2);border-radius:4px;"></div>';
            html += '<span style="position:relative;z-index:1;">' + progress + '%</span>';
            html += '</div>';
          }
        }
        if (isToday) {
          html += '<div class="gantt-today"></div>';
        }
        html += '</td>';
      }
      html += '</tr>';
    });
  });

  html += '</tbody></table>';

  // Dependency arrows SVG overlay
  var svgHtml = '<svg id="ganttDepSvg" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;">';
  svgHtml += '<defs><marker id="ganttArrowHead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" class="gantt-dep-arrow-head"/></marker>';
  svgHtml += '<marker id="ganttArrowHeadCrit" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" class="gantt-dep-arrow-head critical"/></marker></defs>';

  tasks.forEach(function(task) {
    (task.dependencies || []).forEach(function(dep) {
      var depId = getDepId(dep);
      if (_ganttTaskRowMap[depId] !== undefined && _ganttTaskRowMap[task.id] !== undefined) {
        var fromRow = _ganttTaskRowMap[depId];
        var toRow = _ganttTaskRowMap[task.id];
        // Approximate positions: header row = 28px, each data row = 28px, name col = 200px
        var headerH = 28;
        var rowH = 28;
        var nameW = 200;

        // Find bar end position of dep task
        var depTask = allTasks.find(function(t) { return t.id === depId; });
        if (!depTask || !depTask.dueDate) return;
        var depDue = depTask.dueDate.toDate ? depTask.dueDate.toDate() : new Date(depTask.dueDate);
        var depBarEnd;
        if (zoom === 'day') {
          depBarEnd = Math.floor((depDue - startDate) / 86400000);
        } else if (zoom === 'week') {
          var ws = new Date(startDate); ws.setDate(ws.getDate() - ws.getDay() + 1);
          depBarEnd = Math.floor((depDue - ws) / (7*86400000));
        } else {
          var mo = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
          depBarEnd = (depDue.getFullYear() - mo.getFullYear()) * 12 + depDue.getMonth() - mo.getMonth();
        }

        var x1 = nameW + depBarEnd * cellWidth + cellWidth / 2;
        var y1 = headerH + fromRow * rowH + rowH / 2;
        var x2 = nameW + 4;
        var y2 = headerH + toRow * rowH + rowH / 2;

        // Find bar start of successor
        var taskCreated = task.createdAt ? (task.createdAt.toDate ? task.createdAt.toDate() : new Date(task.createdAt)) : new Date();
        var succBarStart;
        if (zoom === 'day') {
          succBarStart = Math.max(0, Math.floor((taskCreated - startDate) / 86400000));
        } else if (zoom === 'week') {
          var ws2 = new Date(startDate); ws2.setDate(ws2.getDate() - ws2.getDay() + 1);
          succBarStart = Math.max(0, Math.floor((taskCreated - ws2) / (7*86400000)));
        } else {
          var mo2 = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
          succBarStart = Math.max(0, (taskCreated.getFullYear() - mo2.getFullYear()) * 12 + taskCreated.getMonth() - mo2.getMonth());
        }
        x2 = nameW + succBarStart * cellWidth;

        var midX = (x1 + x2) / 2;
        svgHtml += '<path class="gantt-dep-line" d="M' + x1 + ',' + y1 + ' C' + midX + ',' + y1 + ' ' + midX + ',' + y2 + ' ' + x2 + ',' + y2 + '" marker-end="url(#ganttArrowHead)"/>';
      }
    });
  });

  svgHtml += '</svg>';

  container.innerHTML = html + svgHtml;

  // Auto-scroll to today
  setTimeout(function() { scrollGanttToToday(); }, 100);
}

// =============================================
// Batch Operations
// =============================================
var _batchSelected = [];

function toggleBatchSelect(taskId, checked) {
  if (checked) {
    if (_batchSelected.indexOf(taskId) === -1) _batchSelected.push(taskId);
  } else {
    _batchSelected = _batchSelected.filter(function(id) { return id !== taskId; });
  }
  updateBatchBar();
}

function updateBatchBar() {
  var bar = document.getElementById('batchBar');
  var countEl = document.getElementById('batchCount');
  var compareBtn = document.getElementById('batchCompareBtn');
  if (_batchSelected.length > 0 && canCreateTask()) {
    bar.classList.add('show');
    countEl.textContent = _batchSelected.length;
    // Show compare button when exactly 2 selected
    if (compareBtn) compareBtn.style.display = _batchSelected.length === 2 ? '' : 'none';
    var mergeBtn = document.getElementById('batchMergeBtn');
    if (mergeBtn) mergeBtn.style.display = _batchSelected.length === 2 ? '' : 'none';
    // Show delete button for admin
    var deleteBtn = document.getElementById('batchDeleteBtn');
    if (deleteBtn) deleteBtn.style.display = canGV('task:delete') ? '' : 'none';
  } else {
    bar.classList.remove('show');
  }
}

function clearBatchSelection() {
  _batchSelected = [];
  updateBatchBar();
  renderTaskList();
  loadMyTasks();
}

async function batchAction(newStatus) {
  if (_batchSelected.length === 0) return;
  var labels = { approved: 'phê duyệt', in_progress: 'chuyển Đang làm', completed: 'hoàn thành', cancelled: 'hủy' };
  var label = labels[newStatus] || newStatus;

  if (!(await customConfirm('Xác nhận ' + label + ' cho ' + _batchSelected.length + ' công việc?'))) return;

  var success = 0;
  var errors = 0;
  var actorName = userData.hoTen || userData.name || '';

  for (var i = 0; i < _batchSelected.length; i++) {
    try {
      var updateData = {
        status: newStatus,
        updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
      };
      if (newStatus === 'approved') {
        updateData.approvedBy = { uid: userData.id, name: actorName, at: new Date().toISOString() };
      }
      if (newStatus === 'completed') {
        updateData.completedAt = ErpDb.firestore.FieldValue.serverTimestamp();
        updateData.progress = 100;
      }

      await db.collection('workTasks').doc(_batchSelected[i]).update(updateData);
      await db.collection('workTasks').doc(_batchSelected[i]).update({
        comments: ErpDb.firestore.FieldValue.arrayUnion({
          by: { uid: userData.id, name: actorName },
          text: actorName + ' đã ' + label + ' (batch)',
          at: new Date().toISOString()
        })
      });
      success++;
    } catch (e) {
      errors++;
    }
  }

  showToast('Đã ' + label + ' ' + success + ' việc' + (errors > 0 ? ', ' + errors + ' lỗi' : ''), success > 0 ? 'success' : 'error');
  _batchSelected = [];
  updateBatchBar();
  await loadAllTasks();
  loadDashboard();
  renderDeptPerformance();
  renderTaskList();
  loadMyTasks();
}

// Xóa vĩnh viễn các task đã chọn (chỉ admin)
async function batchDeletePermanent() {
  if (!canGV('task:delete')) { showToast('Chỉ admin mới được xóa vĩnh viễn', 'warning'); return; }
  if (_batchSelected.length === 0) return;

  if (!(await customConfirm('⚠️ XÓA VĨNH VIỄN ' + _batchSelected.length + ' công việc?\n\nHành động này KHÔNG THỂ hoàn tác. Tất cả dữ liệu (ghi chú, file đính kèm, lịch sử) sẽ bị xóa hoàn toàn.'))) return;
  if (!(await customConfirm('Xác nhận lần cuối: Bạn chắc chắn muốn xóa ' + _batchSelected.length + ' công việc?'))) return;

  var success = 0;
  var errors = 0;
  for (var i = 0; i < _batchSelected.length; i++) {
    try {
      await db.collection('workTasks').doc(_batchSelected[i]).delete();
      success++;
    } catch (e) {
      errors++;
    }
  }

  showToast('Đã xóa vĩnh viễn ' + success + ' công việc' + (errors > 0 ? ', ' + errors + ' lỗi' : ''), success > 0 ? 'success' : 'error');
  _batchSelected = [];
  updateBatchBar();
  await loadAllTasks();
  loadDashboard();
  renderDeptPerformance();
  renderTaskList();
  loadMyTasks();
}

// Xóa tất cả công việc đã hủy (chỉ admin)
async function deleteAllCancelled() {
  if (!canGV('task:delete')) { showToast('Chỉ admin mới được xóa', 'warning'); return; }

  var cancelledTasks = allTasks.filter(function(t) { return t.status === 'cancelled'; });
  if (cancelledTasks.length === 0) { showToast('Không có công việc đã hủy', 'info'); return; }

  if (!(await customConfirm('⚠️ XÓA VĨNH VIỄN ' + cancelledTasks.length + ' công việc đã hủy?\n\nHành động này KHÔNG THỂ hoàn tác.'))) return;
  if (!(await customConfirm('Xác nhận lần cuối: Xóa hẳn ' + cancelledTasks.length + ' công việc đã hủy?'))) return;

  var success = 0;
  var errors = 0;
  for (var i = 0; i < cancelledTasks.length; i++) {
    try {
      await db.collection('workTasks').doc(cancelledTasks[i].id).delete();
      success++;
    } catch (e) {
      errors++;
    }
  }

  showToast('Đã xóa vĩnh viễn ' + success + ' công việc' + (errors > 0 ? ', ' + errors + ' lỗi' : ''), success > 0 ? 'success' : 'error');
  await loadAllTasks();
  loadDashboard();
  renderDeptPerformance();
  renderTaskList();
  loadMyTasks();
}

