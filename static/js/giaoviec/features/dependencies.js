// =============================================
// Task Dependencies
// =============================================
var _formDeps = [];

function addDependencyToForm() {
  var sel = document.getElementById('taskDependency');
  if (!sel.value) return;
  if (_formDeps.indexOf(sel.value) === -1) _formDeps.push(sel.value);
  sel.value = '';
  renderFormDeps();
}

function removeFormDep(depId) {
  _formDeps = _formDeps.filter(function(id) { return id !== depId; });
  renderFormDeps();
}

function renderFormDeps() {
  var preview = document.getElementById('taskDepsPreview');
  if (_formDeps.length === 0) { preview.innerHTML = ''; return; }
  var html = '';
  _formDeps.forEach(function(depId) {
    var t = allTasks.find(function(t) { return t.id === depId; });
    var title = t ? t.title : depId;
    html += '<div class="dep-item"><span class="dep-arrow">⏳</span><span>' + escapeHtml(title) + '</span>';
    html += '<button class="dep-remove" onclick="removeFormDep(\'' + depId + '\')">&times;</button></div>';
  });
  preview.innerHTML = html;
}

function populateDependencyDropdown() {
  var sel = document.getElementById('taskDependency');
  sel.innerHTML = '<option value="">-- Chọn task --</option>';
  allTasks.forEach(function(t) {
    if (t.status !== 'cancelled') {
      sel.innerHTML += '<option value="' + t.id + '">' + escapeHtml((t.title || '').substring(0, 50)) + '</option>';
    }
  });
}

async function promptAddDependency(taskId) {
  var options = allTasks.filter(function(t) {
    return t.id !== taskId && t.status !== 'cancelled';
  });
  if (options.length === 0) { showToast('Không có công việc khác để liên kết', 'warning'); return; }

  var selectOpts = options.map(function(t) { return { value: t.id, label: t.title }; });
  selectOpts.unshift({ value: '', label: '-- Chọn công việc --' });
  var result = await showInputModal({
    title: 'Thêm phụ thuộc',
    fields: [{ name: 'depId', label: 'C\u00F4ng vi\u1EC7c ph\u1EE5 thu\u1ED9c', type: 'select', options: selectOpts, required: true, searchable: true }]
  });
  if (!result || !result.depId) return;
  var depTask = options.find(function(t) { return t.id === result.depId; });
  if (!depTask) return;

  try {
    await db.collection('workTasks').doc(taskId).update({
      dependencies: ErpDb.firestore.FieldValue.arrayUnion(depTask.id),
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
    });
    showToast('Đã thêm phụ thuộc', 'success');
    await loadAllTasks();
    openTaskDetail(taskId);
  } catch (e) {
    showToast('Lỗi: ' + e.message, 'error');
  }
}

async function removeDependency(taskId, index) {
  var task = allTasks.find(function(t) { return t.id === taskId; });
  if (!task || !task.dependencies) return;
  var deps = task.dependencies.slice();
  deps.splice(index, 1);
  try {
    await db.collection('workTasks').doc(taskId).update({
      dependencies: deps,
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
    });
    await loadAllTasks();
    openTaskDetail(taskId);
  } catch (e) {
    showToast('Lỗi: ' + e.message, 'error');
  }
}

// =============================================
// Dependency Utilities (shared by Kanban, Gantt, Detail)
// =============================================
function getDepId(dep) {
  // Support both old format (string) and new format ({taskId})
  return typeof dep === 'string' ? dep : (dep && dep.taskId ? dep.taskId : '');
}

function isTaskBlocked(task) {
  var deps = task.dependencies || [];
  if (deps.length === 0) return false;
  return deps.some(function(dep) {
    var depId = getDepId(dep);
    var dt = allTasks.find(function(t) { return t.id === depId; });
    return dt && dt.status !== 'completed';
  });
}

function getBlockingTasks(task) {
  var deps = task.dependencies || [];
  var blockers = [];
  deps.forEach(function(dep) {
    var depId = getDepId(dep);
    var dt = allTasks.find(function(t) { return t.id === depId; });
    if (dt && dt.status !== 'completed') blockers.push(dt);
  });
  return blockers;
}

function getDependentTasks(taskId) {
  // Tasks that depend on this task (reverse lookup)
  return allTasks.filter(function(t) {
    return (t.dependencies || []).some(function(dep) {
      return getDepId(dep) === taskId;
    });
  });
}

