// Task Templates
// =============================================
var allTemplates = [];

async function loadTemplates() {
  try {
    var snap = await db.collection('taskTemplates').orderBy('name').get();
    allTemplates = snap.docs.map(function(doc) { return { id: doc.id, ...doc.data() }; });
  } catch (e) {
    // Collection might not exist yet
    allTemplates = [];
  }
  renderTemplates();
}

function renderTemplates() {
  var grid = document.getElementById('templateGrid');
  if (!grid) return;
  if (allTemplates.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:16px;"><div class="empty-state-text">Chưa có mẫu nào. Bấm "+ Lưu mẫu mới" để tạo.</div></div>';
    return;
  }

  var html = '';
  allTemplates.forEach(function(tpl) {
    var priority = tpl.priority || 'P2';
    html += '<div class="template-card">';
    html += '<div class="template-card-title">' + escapeHtml(tpl.name || '') + '</div>';
    html += '<div class="template-card-meta">';
    html += '<span class="badge badge-' + priority.toLowerCase() + '">' + getPrioLabel(priority) + '</span>';
    if (tpl.department) html += ' · ' + escapeHtml(tpl.department);
    if (tpl.subtaskCount) html += ' · ' + tpl.subtaskCount + ' đầu việc';
    html += '</div>';
    html += '<div class="template-card-actions">';
    html += '<button class="btn btn-primary btn-sm" onclick="createFromTemplate(\'' + tpl.id + '\')">Dùng mẫu</button>';
    if (canGV('template:delete')) {
      html += '<button class="btn btn-outline btn-sm" onclick="deleteTemplate(\'' + tpl.id + '\')" style="color:var(--danger);">Xóa</button>';
    }
    html += '</div>';
    html += '</div>';
  });
  grid.innerHTML = html;
}

function toggleTemplateSection() {
  var sec = document.getElementById('templateSection');
  sec.style.display = sec.style.display === 'none' ? '' : 'none';
}

async function openSaveTemplateForm() {
  var result = await showInputModal({
    title: 'Tạo mẫu công việc',
    fields: [
      { name: 'name', label: 'Tên mẫu', type: 'text', placeholder: 'Nhập tên mẫu...', required: true },
      { name: 'title', label: 'Tên công việc mặc định', type: 'text', placeholder: 'Tên công việc khi dùng mẫu' },
      { name: 'desc', label: 'Mô tả mặc định', type: 'textarea', placeholder: 'Mô tả công việc...' },
      { name: 'priority', label: 'Ưu tiên', type: 'select', value: 'P2', options: [
        { value: 'P1', label: 'Khẩn cấp' }, { value: 'P2', label: 'Bình thường' }, { value: 'P3', label: 'Không gấp' }
      ]},
      { name: 'subtasks', label: 'Đầu việc con', type: 'text', placeholder: 'Ngăn cách bằng dấu ; (VD: Bước 1; Bước 2)' }
    ],
    confirmText: 'Lưu mẫu'
  });
  if (!result) return;

  var subtasks = result.subtasks ? result.subtasks.split(';').map(function(s) { return s.trim(); }).filter(function(s) { return s; }) : [];

  saveTemplate({
    name: result.name.trim(),
    title: result.title || '',
    description: result.desc || '',
    priority: (result.priority || 'P2').toUpperCase(),
    subtasks: subtasks,
    subtaskCount: subtasks.length
  });
}

async function saveTemplate(tplData) {
  try {
    tplData.createdBy = { uid: userData.id, name: userData.hoTen || userData.name || '' };
    tplData.createdAt = ErpDb.firestore.FieldValue.serverTimestamp();
    await db.collection('taskTemplates').add(tplData);
    showToast('Đã lưu mẫu "' + tplData.name + '"', 'success');
    await loadTemplates();
  } catch (e) {
    showToast('Lỗi lưu mẫu: ' + e.message, 'error');
  }
}

async function deleteTemplate(templateId) {
  if (!(await customConfirm('Xóa mẫu công việc này?'))) return;
  try {
    await db.collection('taskTemplates').doc(templateId).delete();
    showToast('Đã xóa mẫu', 'success');
    await loadTemplates();
  } catch (e) {
    showToast('Lỗi: ' + e.message, 'error');
  }
}

function createFromTemplate(templateId) {
  var tpl = allTemplates.find(function(t) { return t.id === templateId; });
  if (!tpl) { showToast('Không tìm thấy mẫu', 'error'); return; }

  // Pre-fill the create form
  document.getElementById('editTaskId').value = '';
  document.getElementById('taskFormTitle').textContent = 'Tạo từ mẫu: ' + tpl.name;
  document.getElementById('taskTitle').value = tpl.title || '';
  document.getElementById('taskDesc').value = tpl.description || '';
  selectPriority(tpl.priority || 'P2');
  selectTaskType('directed');
  document.getElementById('taskDueDate').value = '';
  document.getElementById('taskDept').value = '';
  document.getElementById('taskSourceType').value = 'manual';
  document.getElementById('taskSourceRef').value = '';
  document.querySelectorAll('#supportDeptCheckboxes input').forEach(function(cb) { cb.checked = false; });
  updateSupportDeptTags();

  // Store template subtasks to add after save
  window._pendingTemplateSubtasks = tpl.subtasks || [];

  openModal('taskFormModal');
}

// Override saveTask to add template subtasks (deferred)
var _origSaveTask = null;
document.addEventListener('DOMContentLoaded', function() { _origSaveTask = typeof saveTask === 'function' ? saveTask : null; });

