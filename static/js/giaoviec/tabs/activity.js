// =============================================
// Activity Log
// =============================================
var _activityLogs = [];
var _activityLimit = 30;

async function loadActivityLog() {
  var listEl = document.getElementById('activityList');
  listEl.innerHTML = '<div class="loading-spinner"></div>';

  try {
    // Build activity from task comments (cross-all tasks)
    _activityLogs = [];
    var visibleTasks = getVisibleTasks();

    visibleTasks.forEach(function(task) {
      var comments = task.comments || [];
      comments.forEach(function(c) {
        var cTime = c.at ? (typeof c.at === 'string' ? new Date(c.at) : (c.at.toDate ? c.at.toDate() : new Date(c.at))) : null;
        _activityLogs.push({
          taskId: task.id,
          taskTitle: task.title || '',
          by: c.by ? c.by.name : 'Hệ thống',
          text: c.text || '',
          at: cTime,
          type: detectActivityType(c.text || '')
        });
      });
    });

    // Sort by time desc
    _activityLogs.sort(function(a, b) {
      if (!a.at) return 1;
      if (!b.at) return -1;
      return b.at - a.at;
    });

    renderActivityLog();
  } catch (e) {
    console.error('Load activity error:', e);
    listEl.innerHTML = '<div class="empty-state"><div class="empty-state-text">Lỗi tải lịch sử</div></div>';
  }
}

function detectActivityType(text) {
  var t = text.toLowerCase();
  if (t.indexOf('tạo') !== -1 && (t.indexOf('công việc') !== -1 || t.indexOf('ai trích') !== -1)) return 'create';
  if (t.indexOf('phê duyệt') !== -1 || t.indexOf('đã duyệt') !== -1) return 'approve';
  if (t.indexOf('từ chối') !== -1) return 'reject';
  if (t.indexOf('gán') !== -1 || t.indexOf('chuyển giao') !== -1 || t.indexOf('pic') !== -1) return 'assign';
  if (t.indexOf('tiến độ') !== -1 || t.indexOf('progress') !== -1) return 'progress';
  if (t.indexOf('hoàn thành') !== -1 || t.indexOf('ph\u00EA duy\u1EC7t') !== -1 || t.indexOf('completed') !== -1) return 'complete';
  return 'comment';
}

function getActivityIcon(type) {
  var icons = {
    create: '➕', approve: '✅', reject: '❌', assign: '👤',
    progress: '📊', complete: '🏆', comment: '💬'
  };
  return icons[type] || '📝';
}

function renderActivityLog() {
  var listEl = document.getElementById('activityList');
  var filter = _feedFilter || 'all';

  var logs = _activityLogs;
  if (filter !== 'all') {
    if (filter === 'status') {
      logs = logs.filter(function(l) { return l.type === 'approve' || l.type === 'reject' || l.type === 'progress' || l.type === 'complete'; });
    } else {
      logs = logs.filter(function(l) { return l.type === filter; });
    }
  }

  var displayLogs = logs.slice(0, _activityLimit);

  if (displayLogs.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📜</div><div class="empty-state-text">Chưa có hoạt động nào</div></div>';
    return;
  }

  var html = '';
  displayLogs.forEach(function(log) {
    html += '<div class="activity-item" ' + (log.taskId ? 'onclick="openTaskDetail(\'' + log.taskId + '\')" style="cursor:pointer;"' : '') + '>';
    html += '<div class="activity-icon act-' + log.type + '">' + getActivityIcon(log.type) + '</div>';
    html += '<div class="activity-body">';
    html += '<div class="activity-text"><strong>' + escapeHtml(log.by) + '</strong> ' + escapeHtml(log.text) + '</div>';
    html += '<div class="activity-meta">';
    if (log.taskTitle) html += escapeHtml(log.taskTitle) + ' · ';
    html += log.at ? formatDateTime(log.at) : '';
    html += '</div>';
    html += '</div>';
    html += '</div>';
  });

  // Show "load more" hint
  if (logs.length > _activityLimit) {
    html += '<div style="text-align:center;padding:12px;font-size:12px;color:var(--text-muted);">Hiển thị ' + _activityLimit + '/' + logs.length + ' mục</div>';
  }

  listEl.innerHTML = html;
}

function loadMoreActivity() {
  _activityLimit += 30;
  renderActivityLog();
}

