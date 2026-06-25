// =============================================
// Kanban Board View
// =============================================
var _kanbanCollapsed = {};
var _kanbanWipLimits = { draft: 0, pending_approval: 0, revision: 0, approved: 0, in_progress: 10, review: 5, completed: 0, cancelled: 0 }; // 0 = no limit

function toggleKanbanCollapse(status) {
  _kanbanCollapsed[status] = !_kanbanCollapsed[status];
  renderKanbanBoard();
}

function quickAddKanbanTask(status) {
  var input = document.getElementById('kanbanQuickAdd_' + status);
  if (!input) return;
  var title = input.value.trim();
  if (!title) return;
  input.value = '';

  // Quick-create task with minimal fields
  var taskData = {
    title: title,
    description: '',
    priority: 'P2',
    status: status,
    assignedDept: null,
    supportDepts: [],
    assignedTo: null,
    approvedBy: null,
    dueDate: null,
    progress: 0,
    comments: [],
    parentTaskId: null,
    sourceType: 'kanban',
    sourceRef: '',
    tags: [],
    dependencies: [],
    label: null,
    recurring: null,
    recurringEnd: null,
    estimatedDays: null,
    subtasks: [],
    createdBy: { uid: userData.id, name: userData.hoTen || userData.name || '' },
    createdAt: ErpDb.firestore.FieldValue.serverTimestamp(),
    updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
  };

  db.collection('workTasks').add(taskData).then(function() {
    showToast('\u0110\u00E3 t\u1EA1o nhanh: ' + title, 'success');
    loadAllTasks().then(function() { renderKanbanBoard(); });
  }).catch(function(e) {
    showToast('L\u1ED7i: ' + e.message, 'error');
  });
}

function renderKanbanBoard() {
  var tasks = getVisibleTasks().filter(function(t) { return t.status !== 'archived'; });
  var deptFilter = document.getElementById('kanbanDeptFilter').value;
  if (deptFilter) {
    tasks = tasks.filter(function(t) { return t.assignedDept && t.assignedDept.id === deptFilter; });
  }

  // Search filter
  var _searchEl = document.getElementById('kanbanSearch');
  var searchVal = (_searchEl ? _searchEl.value : '').trim().toLowerCase();
  if (searchVal) {
    tasks = tasks.filter(function(t) {
      return (t.title || '').toLowerCase().indexOf(searchVal) !== -1 ||
             (t.assignedTo && t.assignedTo.name && t.assignedTo.name.toLowerCase().indexOf(searchVal) !== -1) ||
             (t.assignedDept && t.assignedDept.name && t.assignedDept.name.toLowerCase().indexOf(searchVal) !== -1);
    });
  }

  // Populate dept filter if empty
  var deptSelect = document.getElementById('kanbanDeptFilter');
  if (deptSelect.options.length <= 1 && allDepartments.length > 0) {
    allDepartments.forEach(function(d) {
      var opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.ten || d.tenPhongBan || d.name || d.id;
      deptSelect.appendChild(opt);
    });
  }

  var swimBy = document.getElementById('kanbanSwimBy').value;

  var columns = [
    { key: 'draft', label: 'Nháp', color: 'var(--text-muted)' },
    { key: 'pending_approval', label: 'Chờ duyệt', color: 'var(--warning)' },
    { key: 'revision', label: 'Cần soạn lại', color: '#f59e0b' },
    { key: 'approved', label: 'Đã duyệt', color: 'var(--info)' },
    { key: 'in_progress', label: 'Đang làm', color: 'var(--primary)' },
    { key: 'review', label: 'Ph\u00EA duy\u1EC7t k\u1EBFt qu\u1EA3', color: '#a78bfa' },
    { key: 'completed', label: 'Hoàn thành', color: 'var(--success)' },
    { key: 'cancelled', label: 'Đã hủy', color: 'var(--danger)' }
  ];

  var html = '';
  columns.forEach(function(col) {
    var colTasks = tasks.filter(function(t) { return t.status === col.key; });
    var isCollapsed = _kanbanCollapsed[col.key];
    var wipLimit = _kanbanWipLimits[col.key] || 0;
    var wipExceeded = wipLimit > 0 && colTasks.length > wipLimit;

    html += '<div class="kanban-column' + (isCollapsed ? ' collapsed' : '') + (wipExceeded ? ' kanban-wip-warning' : '') + '">';

    if (isCollapsed) {
      html += '<div class="kanban-col-title-vertical" onclick="toggleKanbanCollapse(\'' + col.key + '\')" style="color:' + col.color + ';">';
      html += col.label + ' (' + colTasks.length + ')';
      html += '</div>';
      html += '</div>';
      return;
    }

    html += '<div class="kanban-col-header" style="border-bottom-color:' + col.color + ';cursor:pointer;" onclick="toggleKanbanCollapse(\'' + col.key + '\')">';
    html += '<span style="color:' + col.color + ';">' + col.label + '</span>';
    html += '<div style="display:flex;align-items:center;gap:4px;">';
    if (wipLimit > 0) {
      html += '<span class="kanban-wip-badge">' + colTasks.length + '/' + wipLimit + '</span>';
    } else {
      html += '<span class="kanban-col-count">' + colTasks.length + '</span>';
    }
    html += '</div>';
    html += '</div>';
    html += '<div class="kanban-col-body" data-status="' + col.key + '">';

    if (colTasks.length === 0) {
      html += '<div style="text-align:center;padding:20px 8px;font-size:12px;color:var(--text-muted);opacity:0.5;">Trống</div>';
    }

    // Swimlane grouping
    if (swimBy !== 'none' && colTasks.length > 0) {
      var groups = {};
      colTasks.forEach(function(t) {
        var key = swimBy === 'dept' ? (t.assignedDept ? t.assignedDept.name : 'Chưa gán') :
                  swimBy === 'priority' ? (t.priority || 'P3') : 'all';
        if (!groups[key]) groups[key] = [];
        groups[key].push(t);
      });
      Object.keys(groups).sort().forEach(function(gKey) {
        html += '<div class="kanban-swimlane-header">';
        html += '<span>' + escapeHtml(getPrioLabel(gKey) || gKey) + '</span>';
        html += '<span style="font-size:14px;">' + groups[gKey].length + '</span>';
        html += '</div>';
        groups[gKey].forEach(function(t) {
          html += renderKanbanCard(t);
        });
      });
    } else {
      colTasks.forEach(function(t) {
        html += renderKanbanCard(t);
      });
    }

    html += '</div>';

    // Quick add input
    if (col.key !== 'completed' && col.key !== 'cancelled') {
      html += '<div class="kanban-quick-add">';
      html += '<input type="text" id="kanbanQuickAdd_' + col.key + '" placeholder="+ Th\u00EAm c\u00F4ng vi\u1EC7c..." onkeydown="if(event.key===\'Enter\')quickAddKanbanTask(\'' + col.key + '\')">';
      html += '</div>';
    }

    html += '</div>';
  });

  document.getElementById('kanbanContainer').innerHTML = html;
  initKanbanDragDrop();
}

function renderKanbanCard(t) {
  var due = t.dueDate ? (t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate)) : null;
  var isOverdue = due && due < new Date() && t.status !== 'completed' && t.status !== 'cancelled';
  var deptName = t.assignedDept ? t.assignedDept.name : '';
  var picName = t.assignedTo ? t.assignedTo.name : '';
  var blocked = isTaskBlocked(t);
  var subtasksDone = (t.subtasks || []).filter(function(s) { return s.done; }).length;
  var subtasksTotal = (t.subtasks || []).length;

  var html = '<div class="kanban-card' + (blocked ? ' blocked' : '') + '" draggable="' + (blocked ? 'false' : 'true') + '" data-task-id="' + t.id + '" data-task-status="' + t.status + '" onclick="openTaskDetail(\'' + t.id + '\')">';
  html += '<div style="display:flex;justify-content:space-between;align-items:start;gap:4px;">';
  html += '<div class="kanban-card-title">';
  if (blocked) html += '<span style="color:var(--danger);margin-right:2px;" title="Bị chặn bởi task phụ thuộc">\uD83D\uDD12</span>';
  html += escapeHtml(t.title);
  html += '</div>';
  html += '<span class="badge badge-' + (t.priority || 'p3').toLowerCase() + '">' + getPrioLabel(t.priority) + '</span>';
  html += '</div>';
  html += '<div class="kanban-card-meta">';
  if (picName) {
    var initial = (picName || '?')[0].toUpperCase();
    html += '<span class="kanban-card-assignee" title="' + escapeHtml(picName) + '">' + initial + '</span>';
  }
  if (deptName) html += '<span class="kanban-card-dept">' + escapeHtml(deptName) + '</span>';
  if (due) html += '<span style="' + (isOverdue ? 'color:var(--danger);font-weight:600;' : '') + '">' + formatDate(due) + '</span>';
  if (subtasksTotal > 0) html += '<span style="font-size:14px;">\uD83D\uDCDD ' + subtasksDone + '/' + subtasksTotal + '</span>';
  if (t.recurring) html += '<span class="recurring-badge">\uD83D\uDD04 ' + (RECUR_LABELS[t.recurring] || t.recurring) + '</span>';
  html += getSLABadge(t);
  html += '</div>';
  if (t.progress > 0 && t.status !== 'completed') {
    html += '<div class="progress-bar" style="height:3px;margin-top:6px;"><div class="progress-bar-fill" style="width:' + t.progress + '%;"></div></div>';
  }
  html += '</div>';
  return html;
}
