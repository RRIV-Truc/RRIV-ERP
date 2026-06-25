// Relative Time Helper
function relativeDate(date) {
  if (!date) return '';
  var now = new Date();
  var diff = date - now;
  var absDiff = Math.abs(diff);
  var days = Math.floor(absDiff / (1000 * 60 * 60 * 24));
  var hours = Math.floor(absDiff / (1000 * 60 * 60));

  if (days === 0) {
    if (hours === 0) return diff > 0 ? 'H\u00F4m nay' : 'H\u00F4m nay';
    return diff > 0 ? 'C\u00F2n ' + hours + 'h' : hours + 'h tr\u01B0\u1EDBc';
  }
  if (days === 1) return diff > 0 ? 'Ng\u00E0y mai' : 'H\u00F4m qua';
  if (days <= 7) return diff > 0 ? 'C\u00F2n ' + days + ' ng\u00E0y' : days + ' ng\u00E0y tr\u01B0\u1EDBc';
  if (days <= 30) {
    var weeks = Math.floor(days / 7);
    return diff > 0 ? 'C\u00F2n ' + weeks + ' tu\u1EA7n' : weeks + ' tu\u1EA7n tr\u01B0\u1EDBc';
  }
  var months = Math.floor(days / 30);
  return diff > 0 ? 'C\u00F2n ' + months + ' th\u00E1ng' : months + ' th\u00E1ng tr\u01B0\u1EDBc';
}

// Density Mode
function setDensity(mode, btn) {
  var list = document.getElementById('taskList');
  if (list) {
    list.classList.remove('density-compact', 'density-spacious');
    if (mode !== 'normal') list.classList.add('density-' + mode);
  }
  document.querySelectorAll('.density-btn').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  localStorage.setItem('gv_density', mode);
}
// Restore density on load
(function() {
  var saved = localStorage.getItem('gv_density');
  if (saved && saved !== 'normal') {
    setTimeout(function() { setDensity(saved); }, 500);
  }
})();

// Search Typeahead
var _searchDebounce = null;
function onSearchInput() {
  renderTaskList();
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(function() {
    var input = document.getElementById('taskSearchInput');
    var dropdown = document.getElementById('searchTypeahead');
    if (!input || !dropdown) return;
    var q = input.value.trim().toLowerCase();
    if (q.length < 2) { dropdown.classList.remove('open'); return; }
    var matches = allTasks.filter(function(t) {
      if (t.status === 'archived' || t.status === 'cancelled') return false;
      return (t.title && t.title.toLowerCase().indexOf(q) !== -1) ||
             (t.assignedTo && t.assignedTo.name && t.assignedTo.name.toLowerCase().indexOf(q) !== -1) ||
             (t.assignedDept && t.assignedDept.name && t.assignedDept.name.toLowerCase().indexOf(q) !== -1);
    }).slice(0, 8);
    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="search-ta-empty">Kh\u00F4ng t\u00ECm th\u1EA5y</div>';
    } else {
      var statusLabels = { draft:'Nháp', pending_approval:'Chờ duyệt', approved:'Đã duyệt', in_progress:'Đang làm', review:'Chờ PD', completed:'Xong' };
      dropdown.innerHTML = matches.map(function(t) {
        var dept = t.assignedDept ? t.assignedDept.name : '';
        var assignee = t.assignedTo ? t.assignedTo.name : '';
        return '<div class="search-ta-item" onclick="document.getElementById(\'searchTypeahead\').classList.remove(\'open\');document.getElementById(\'taskSearchInput\').value=\'\';openTaskDetail(\'' + t.id + '\')">' +
          '<div class="search-ta-prio ' + (t.priority || 'P3') + '"></div>' +
          '<div class="search-ta-info"><div class="search-ta-title">' + escapeHtml(t.title || '') + '</div>' +
          '<div class="search-ta-meta">' + escapeHtml(dept) + (assignee ? ' \u2022 ' + escapeHtml(assignee) : '') + '</div></div>' +
          '<span class="search-ta-status badge-status badge-' + t.status + '">' + (statusLabels[t.status] || t.status) + '</span></div>';
      }).join('');
    }
    dropdown.classList.add('open');
  }, 200);
}
// Close typeahead on outside click
document.addEventListener('click', function(e) {
  if (!e.target.closest('.search-typeahead-wrap')) {
    var dd = document.getElementById('searchTypeahead');
    if (dd) dd.classList.remove('open');
  }
});

// Drag & Drop reorder (with custom small ghost image)
var _dragTaskId = null;
var _dragGhost = null;
document.addEventListener('dragstart', function(e) {
  var card = e.target.closest('[data-task-id]');
  if (!card) return;
  _dragTaskId = card.getAttribute('data-task-id');
  card.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
  // Create small custom ghost image instead of full card clone
  _dragGhost = document.createElement('div');
  _dragGhost.textContent = card.querySelector('.tc-title,.task-card-title') ?
    card.querySelector('.tc-title,.task-card-title').textContent.substring(0, 30) : '';
  _dragGhost.style.cssText = 'position:fixed;top:-100px;left:-100px;padding:6px 12px;background:#1976d2;color:#fff;border-radius:6px;font-size:12px;font-weight:600;max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;z-index:99999;';
  document.body.appendChild(_dragGhost);
  e.dataTransfer.setDragImage(_dragGhost, 10, 10);
});
document.addEventListener('dragend', function(e) {
  var card = e.target.closest('[data-task-id]');
  if (card) card.style.opacity = '1';
  document.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
  if (_dragGhost && _dragGhost.parentNode) _dragGhost.parentNode.removeChild(_dragGhost);
  _dragGhost = null;
  _dragTaskId = null;
});
document.addEventListener('dragover', function(e) {
  var card = e.target.closest('[data-task-id]');
  if (!card || card.getAttribute('data-task-id') === _dragTaskId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  card.classList.add('drag-over');
});
document.addEventListener('dragleave', function(e) {
  var card = e.target.closest('[data-task-id]');
  if (card) card.classList.remove('drag-over');
});
document.addEventListener('drop', function(e) {
  e.preventDefault();
  var targetCard = e.target.closest('[data-task-id]');
  if (!targetCard || !_dragTaskId) return;
  targetCard.classList.remove('drag-over');
  var targetId = targetCard.getAttribute('data-task-id');
  if (targetId === _dragTaskId) return;
  var dragCard = document.querySelector('[data-task-id="' + _dragTaskId + '"]');
  if (dragCard && targetCard.parentNode) {
    var rect = targetCard.getBoundingClientRect();
    var mid = rect.top + rect.height / 2;
    if (e.clientY < mid) {
      targetCard.parentNode.insertBefore(dragCard, targetCard);
    } else {
      targetCard.parentNode.insertBefore(dragCard, targetCard.nextSibling);
    }
  }
  _dragTaskId = null;
});

// Task Hover Preview
var _hoverTimer = null;
var _hoverPreview = null;
document.addEventListener('mouseover', function(e) {
  var card = e.target.closest('[data-task-id]');
  if (!card) { clearTimeout(_hoverTimer); hideHoverPreview(); return; }
  clearTimeout(_hoverTimer);
  _hoverTimer = setTimeout(function() {
    var taskId = card.getAttribute('data-task-id');
    var task = allTasks.find(function(t) { return t.id === taskId; });
    if (!task) return;
    showHoverPreview(task, card);
  }, 600);
});
document.addEventListener('mouseout', function(e) {
  var card = e.target.closest('[data-task-id]');
  if (card) { clearTimeout(_hoverTimer); hideHoverPreview(); }
});

function showHoverPreview(task, el) {
  var preview = document.getElementById('taskHoverPreview');
  if (!preview) return;
  var desc = task.description ? escapeHtml(task.description).substring(0, 120) : 'Ch\u01B0a c\u00F3 m\u00F4 t\u1EA3';
  if (task.description && task.description.length > 120) desc += '...';
  var creatorName = task.createdBy ? task.createdBy.name : '';
  var assigneeName = task.assignedTo ? task.assignedTo.name : 'Ch\u01B0a ph\u00E2n';
  var html = '<div class="thp-title">' + escapeHtml(task.title || '') + '</div>';
  html += '<div class="thp-desc">' + desc + '</div>';
  html += '<div class="thp-meta">';
  html += '<span>\uD83D\uDC64 ' + escapeHtml(assigneeName) + '</span>';
  if (creatorName) html += '<span>\u270D ' + escapeHtml(creatorName) + '</span>';
  html += '<span>\uD83D\uDCCA ' + (task.progress || 0) + '%</span>';
  html += '</div>';
  if (task.subtasks && task.subtasks.length > 0) {
    var done = task.subtasks.filter(function(s) { return s.done; }).length;
    var pct = Math.round(done / task.subtasks.length * 100);
    html += '<div class="thp-subtasks">Subtask: ' + done + '/' + task.subtasks.length + ' (' + pct + '%)<div class="thp-subtask-bar"><div class="thp-subtask-fill" style="width:' + pct + '%"></div></div></div>';
  }
  preview.innerHTML = html;
  var rect = el.getBoundingClientRect();
  preview.style.top = Math.min(rect.bottom + 6, window.innerHeight - 200) + 'px';
  preview.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
  preview.classList.add('show');
}

function hideHoverPreview() {
  var preview = document.getElementById('taskHoverPreview');
  if (preview) preview.classList.remove('show');
}
