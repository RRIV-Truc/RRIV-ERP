// =============================================
// Calendar View
// =============================================
var _calYear = new Date().getFullYear();
var _calMonth = new Date().getMonth(); // 0-based

function calNavigate(dir) {
  _calMonth += dir;
  if (_calMonth < 0) { _calMonth = 11; _calYear--; }
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  renderCalendar();
}

function calGoToday() {
  _calYear = new Date().getFullYear();
  _calMonth = new Date().getMonth();
  renderCalendar();
}

function renderCalendar() {
  var months = ['Th\u00E1ng 1','Th\u00E1ng 2','Th\u00E1ng 3','Th\u00E1ng 4','Th\u00E1ng 5','Th\u00E1ng 6','Th\u00E1ng 7','Th\u00E1ng 8','Th\u00E1ng 9','Th\u00E1ng 10','Th\u00E1ng 11','Th\u00E1ng 12'];
  document.getElementById('calMonthLabel').textContent = months[_calMonth] + ' ' + _calYear;

  var tasks = getVisibleTasks().filter(function(t) { return t.status !== 'cancelled'; });

  // Build task map by date key (dueDate + completedAt)
  var taskMap = {};
  var _addedKeys = {}; // track to avoid duplicates on same day
  var monthStats = { total: 0, completed: 0, inProgress: 0, overdue: 0 };
  var now = new Date();
  tasks.forEach(function(t) {
    var due = t.dueDate ? (t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate)) : null;
    var comp = t.completedAt ? (t.completedAt.toDate ? t.completedAt.toDate() : new Date(t.completedAt)) : null;
    var taskId = t.id;

    // Add to dueDate
    if (due) {
      var dueKey = due.getFullYear() + '-' + String(due.getMonth() + 1).padStart(2, '0') + '-' + String(due.getDate()).padStart(2, '0');
      if (!taskMap[dueKey]) taskMap[dueKey] = [];
      taskMap[dueKey].push({ task: t, type: 'due' });
      _addedKeys[taskId + '_' + dueKey] = true;
      if (due.getMonth() === _calMonth && due.getFullYear() === _calYear) {
        monthStats.total++;
        if (t.status === 'completed' || t.status === 'archived') monthStats.completed++;
        else if (t.status === 'in_progress') monthStats.inProgress++;
        if (due < now && t.status !== 'completed' && t.status !== 'archived') monthStats.overdue++;
      }
    }

    // Add to completedAt (if different from dueDate)
    if (!comp && t.status === 'archived' && t.archivedAt) {
      comp = t.archivedAt.toDate ? t.archivedAt.toDate() : new Date(t.archivedAt);
    }
    if (comp && (t.status === 'completed' || t.status === 'archived')) {
      var compKey = comp.getFullYear() + '-' + String(comp.getMonth() + 1).padStart(2, '0') + '-' + String(comp.getDate()).padStart(2, '0');
      if (!_addedKeys[taskId + '_' + compKey]) {
        if (!taskMap[compKey]) taskMap[compKey] = [];
        taskMap[compKey].push({ task: t, type: 'completed' });
      }
    }
  });

  // Render stats bar
  var statsEl = document.getElementById('calStats');
  if (statsEl) {
    statsEl.innerHTML =
      '<div class="cal-stat"><span class="cal-stat-dot" style="background:var(--text-muted);"></span>T\u1ED5ng: <span class="cal-stat-count">' + monthStats.total + '</span></div>' +
      '<div class="cal-stat"><span class="cal-stat-dot" style="background:var(--success);"></span>Ho\u00E0n th\u00E0nh: <span class="cal-stat-count">' + monthStats.completed + '</span></div>' +
      '<div class="cal-stat"><span class="cal-stat-dot" style="background:var(--info);"></span>\u0110ang l\u00E0m: <span class="cal-stat-count">' + monthStats.inProgress + '</span></div>' +
      (monthStats.overdue > 0 ? '<div class="cal-stat"><span class="cal-stat-dot" style="background:var(--danger);"></span>Qu\u00E1 h\u1EA1n: <span class="cal-stat-count" style="color:var(--danger);">' + monthStats.overdue + '</span></div>' : '') +
      '<div style="border-left:1px solid var(--border);height:16px;margin:0 4px;"></div>' +
      '<div class="cal-stat">\u{1F4CB} H\u1EA1n</div>' +
      '<div class="cal-stat">\u2705 Ho\u00E0n th\u00E0nh</div>';
  }

  var firstDay = new Date(_calYear, _calMonth, 1).getDay();
  var daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
  var prevDays = new Date(_calYear, _calMonth, 0).getDate();
  var today = new Date();
  var todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  var grid = document.getElementById('calGrid');
  var headers = grid.querySelectorAll('.cal-day-header');
  grid.innerHTML = '';
  headers.forEach(function(h) { grid.appendChild(h); });

  var _calNow = new Date();
  function getEntryClass(entry) {
    var t = entry.task;
    if (entry.type === 'completed') return 'type-completed';
    // type === 'due'
    var cls = 'type-due';
    if (t.priority === 'P1') cls += ' priority-p1';
    else if (t.priority === 'P2') cls += ' priority-p2';
    var due = t.dueDate ? (t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate)) : null;
    if (due && due < _calNow && t.status !== 'completed') cls += ' is-overdue';
    return cls;
  }
  function getDotColor(entry) {
    var t = entry.task;
    if (entry.type === 'completed') return 'var(--success)';
    var due = t.dueDate ? (t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate)) : null;
    if (due && due < _calNow && t.status !== 'completed') return 'var(--danger)';
    if (t.priority === 'P1') return 'var(--danger)';
    if (t.priority === 'P2') return 'var(--warning)';
    return 'var(--info)';
  }

  function buildCell(day, dateKey, isOther) {
    var cell = document.createElement('div');
    var cls = 'cal-day';
    if (isOther) cls += ' other-month';
    if (dateKey === todayKey) cls += ' today';
    var dayOfWeek = new Date(dateKey).getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) cls += ' weekend';
    cell.className = cls;

    var h = '<div class="cal-day-num">' + day + '</div>';
    var dayEntries = taskMap[dateKey] || [];
    var maxShow = 3;
    for (var j = 0; j < Math.min(dayEntries.length, maxShow); j++) {
      var entry = dayEntries[j];
      var t = entry.task;
      var typeIcon = entry.type === 'completed' ? '\u2705 ' : '\u{1F4CB} ';
      var typeTitle = entry.type === 'completed' ? '[Ho\u00E0n th\u00E0nh] ' : '[H\u1EA1n] ';
      h += '<div class="cal-day-task ' + getEntryClass(entry) + '" onclick="openTaskDetail(\'' + t.id + '\')" title="' + typeTitle + escapeHtml(t.title) + '">' +
        '<span class="cal-task-dot" style="background:' + getDotColor(entry) + ';"></span>' +
        typeIcon + escapeHtml(t.title) + '</div>';
    }
    if (dayEntries.length > maxShow) {
      h += '<div class="cal-day-more">+' + (dayEntries.length - maxShow) + ' n\u1EEFa</div>';
    }
    cell.innerHTML = h;
    return cell;
  }

  // Previous month padding
  for (var i = firstDay - 1; i >= 0; i--) {
    var d = prevDays - i;
    var pm = _calMonth === 0 ? 11 : _calMonth - 1;
    var py = _calMonth === 0 ? _calYear - 1 : _calYear;
    var dk = py + '-' + String(pm + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    grid.appendChild(buildCell(d, dk, true));
  }

  // Current month
  for (var day = 1; day <= daysInMonth; day++) {
    var dateKey = _calYear + '-' + String(_calMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    grid.appendChild(buildCell(day, dateKey, false));
  }

  // Next month padding
  var totalCells = firstDay + daysInMonth;
  var remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (var k = 1; k <= remaining; k++) {
    var nm = _calMonth === 11 ? 0 : _calMonth + 1;
    var ny = _calMonth === 11 ? _calYear + 1 : _calYear;
    var nk = ny + '-' + String(nm + 1).padStart(2, '0') + '-' + String(k).padStart(2, '0');
    grid.appendChild(buildCell(k, nk, true));
  }
}

// =============================================
// Eisenhower Priority Matrix
// =============================================
function renderEisenhowerMatrix() {
  var tasks = getVisibleTasks().filter(function(t) {
    return t.status !== 'cancelled' && t.status !== 'archived' && t.status !== 'completed';
  });

  var now = new Date();
  var in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  // Classify tasks into quadrants
  var q1 = []; // Urgent + Important (P1, due soon)
  var q2 = []; // Important, not urgent (P1/P2, due later)
  var q3 = []; // Urgent, not important (P3, due soon)
  var q4 = []; // Neither (P3, due later or no due)

  tasks.forEach(function(t) {
    var isImportant = (t.priority === 'P1' || t.priority === 'P2');
    var isUrgent = false;

    if (t.dueDate) {
      var due = t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      if (due <= in48h) isUrgent = true;
      if (due < now) isUrgent = true; // overdue = always urgent
    }

    if (isImportant && isUrgent) q1.push(t);
    else if (isImportant && !isUrgent) q2.push(t);
    else if (!isImportant && isUrgent) q3.push(t);
    else q4.push(t);
  });

  var grid = document.getElementById('eisenhowerGrid');
  var quadrants = [
    { tasks: q1, title: '🔴 Làm ngay', cls: 'eisenhower-q1', subtitle: 'Khẩn cấp + Quan trọng' },
    { tasks: q2, title: '🟡 Lên kế hoạch', cls: 'eisenhower-q2', subtitle: 'Quan trọng, chưa gấp' },
    { tasks: q3, title: '🔵 Ủy quyền', cls: 'eisenhower-q3', subtitle: 'Khẩn cấp, ít quan trọng' },
    { tasks: q4, title: '⚪ Xem xét', cls: 'eisenhower-q4', subtitle: 'Không gấp, không quan trọng' }
  ];

  var html = '';
  quadrants.forEach(function(q) {
    html += '<div class="eisenhower-quadrant ' + q.cls + '">';
    html += '<div class="eisenhower-quadrant-title">' + q.title + ' <span style="font-weight:400;font-size:14px;opacity:0.7;">(' + q.tasks.length + ')</span></div>';
    html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">' + q.subtitle + '</div>';
    q.tasks.slice(0, 8).forEach(function(t) {
      html += '<div class="eisenhower-task" onclick="openTaskDetail(\'' + t.id + '\')">' + escapeHtml(t.title) + '</div>';
    });
    if (q.tasks.length > 8) {
      html += '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">+' + (q.tasks.length - 8) + ' nữa...</div>';
    }
    if (q.tasks.length === 0) {
      html += '<div style="font-size:12px;color:var(--text-muted);opacity:0.5;padding:8px 0;">Không có</div>';
    }
    html += '</div>';
  });

  grid.innerHTML = html;
}

// =============================================
// Task Duplication
// =============================================
async function duplicateTask(taskId) {
  var task = allTasks.find(function(t) { return t.id === taskId; });
  if (!task) { showToast('Không tìm thấy công việc', 'error'); return; }
  if (!(await customConfirm('Nhân bản công việc "' + task.title + '"?'))) return;

  try {
    var newTask = {
      title: task.title + ' (bản sao)',
      description: task.description || '',
      priority: task.priority || 'P3',
      status: 'draft',
      createdBy: { uid: userData.id, name: userData.hoTen || userData.name || '' },
      assignedDept: task.assignedDept || null,
      supportDepts: task.supportDepts || [],
      assignedTo: null,
      approvedBy: null,
      dueDate: task.dueDate || null,
      createdAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      completedAt: null,
      progress: 0,
      comments: [{
        by: { uid: userData.id, name: userData.hoTen || userData.name || '' },
        text: 'Nhân bản từ công việc: ' + task.title,
        at: new Date().toISOString()
      }],
      parentTaskId: task.parentTaskId || null,
      sourceType: task.sourceType || 'manual',
      sourceRef: task.sourceRef || '',
      tags: task.tags || [],
      dependencies: [],
      subtasks: (task.subtasks || []).map(function(st) {
        return { title: st.title, completed: false };
      }),
      raci: null
    };

    var docRef = await db.collection('workTasks').add(newTask);
    showToast('Đã nhân bản công việc thành công', 'success');

    // Reload and open the new task
    await loadAllTasks();
    renderTaskList();
    loadDashboard();
    renderDeptPerformance();
    renderEisenhowerMatrix();
    openTaskDetail(docRef.id);
  } catch (err) {
    console.error('Duplicate task error:', err);
    showToast('Lỗi nhân bản: ' + err.message, 'error');
  }
}
