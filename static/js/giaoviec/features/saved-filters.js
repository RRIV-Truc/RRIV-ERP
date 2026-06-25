// =============================================
// Saved Filter Presets
// =============================================
var _savedFilters = [];

function loadSavedFilters() {
  try {
    var stored = localStorage.getItem('gv_savedFilters');
    _savedFilters = stored ? JSON.parse(stored) : [];
  } catch(e) { _savedFilters = []; }
  renderSavedFilters();
}

function renderSavedFilters() {
  var bar = document.getElementById('savedFilterBar');
  var html = '<button class="btn btn-outline btn-sm" onclick="saveCurrentFilter()" title="Lưu bộ lọc hiện tại" style="font-size:14px;padding:3px 8px;">💾 Lưu bộ lọc</button>';

  _savedFilters.forEach(function(f, idx) {
    html += '<div class="saved-filter-chip" onclick="applySavedFilter(' + idx + ')">';
    html += escapeHtml(f.name);
    html += '<span class="saved-filter-remove" onclick="event.stopPropagation();removeSavedFilter(' + idx + ')">&times;</span>';
    html += '</div>';
  });

  bar.innerHTML = html;
}

async function saveCurrentFilter() {
  var result = await showInputModal({
    title: 'Lưu bộ lọc',
    fields: [{ name: 'name', label: 'Tên bộ lọc', type: 'text', placeholder: 'Nhập tên...', required: true }],
    confirmText: 'Lưu'
  });
  if (!result) return;
  var name = result.name;
  if (!name.trim()) return;

  var filter = {
    name: name.trim(),
    status: currentTaskFilter,
    dept: document.getElementById('taskDeptFilter').value,
    search: document.getElementById('taskSearchInput').value
  };

  _savedFilters.push(filter);
  localStorage.setItem('gv_savedFilters', JSON.stringify(_savedFilters));
  renderSavedFilters();
  showToast('Đã lưu bộ lọc "' + filter.name + '"', 'success');
}

function applySavedFilter(idx) {
  var f = _savedFilters[idx];
  if (!f) return;

  // Apply status
  currentTaskFilter = f.status || 'all';
  // Update UI chips
  document.querySelectorAll('#taskFilterChips .chip').forEach(function(c) { c.classList.remove('active'); });
  var chipIdx = ['all','pending_approval','revision','approved','in_progress','review','completed','archived'].indexOf(currentTaskFilter);
  var chips = document.querySelectorAll('#taskFilterChips .chip');
  if (chipIdx >= 0 && chips[chipIdx]) chips[chipIdx].classList.add('active');

  // Apply dept
  document.getElementById('taskDeptFilter').value = f.dept || '';

  // Apply search
  document.getElementById('taskSearchInput').value = f.search || '';

  renderTaskList();

  // Highlight active
  document.querySelectorAll('.saved-filter-chip').forEach(function(c) { c.classList.remove('active'); });
  var filterChips = document.querySelectorAll('.saved-filter-chip');
  if (filterChips[idx]) filterChips[idx].classList.add('active');

  showToast('Áp dụng bộ lọc "' + f.name + '"', 'success');
}

async function removeSavedFilter(idx) {
  if (!(await customConfirm('Xóa bộ lọc "' + _savedFilters[idx].name + '"?'))) return;
  _savedFilters.splice(idx, 1);
  localStorage.setItem('gv_savedFilters', JSON.stringify(_savedFilters));
  renderSavedFilters();
}
