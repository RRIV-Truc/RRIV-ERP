// =============================================
// Notification System
// =============================================
var allNotifications = [];

async function loadNotifications() {
  if (!currentUser) return;
  try {
    var snap = await db.collection('notifications')
      .where('recipientId', '==', userData.id)
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get();
    allNotifications = snap.docs.map(function(doc) { return { id: doc.id, ...doc.data() }; });
  } catch (e) {
    // Collection might not exist yet — just ignore
    allNotifications = [];
  }
  renderNotifications();
}

function renderNotifications() {
  var listEl = document.getElementById('notifList');
  var badgeEl = document.getElementById('notifBadge');
  var unread = allNotifications.filter(function(n) { return !n.read; });

  if (unread.length > 0) {
    badgeEl.textContent = unread.length > 9 ? '9+' : unread.length;
    badgeEl.style.display = '';
  } else {
    badgeEl.style.display = 'none';
  }

  if (allNotifications.length === 0) {
    listEl.innerHTML = '<div class="notif-empty">Không có thông báo</div>';
    return;
  }

  var html = '';
  allNotifications.slice(0, 20).forEach(function(n) {
    var time = n.createdAt ? (n.createdAt.toDate ? n.createdAt.toDate() : new Date(n.createdAt)) : null;
    html += '<div class="notif-item ' + (n.read ? '' : 'unread') + '" onclick="onNotifClick(\'' + n.id + '\',\'' + (n.taskId || '') + '\')">';
    html += '<div class="notif-text">' + escapeHtml(n.message || '') + '</div>';
    if (time) html += '<div class="notif-time">' + formatDateTime(time) + '</div>';
    html += '</div>';
  });
  listEl.innerHTML = html;
}

function toggleNotifDropdown() {
  var dd = document.getElementById('notifDropdown');
  dd.classList.toggle('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  var dd = document.getElementById('notifDropdown');
  var bell = e.target.closest('.notif-bell');
  if (!bell && dd && dd.classList.contains('open')) {
    dd.classList.remove('open');
  }
  // Close header more menu
  var hm = document.getElementById('headerMoreMenu');
  var hmBtn = e.target.closest('#headerMoreBtn');
  if (!hmBtn && hm && hm.classList.contains('open')) {
    hm.classList.remove('open');
  }
  // Close dashboard more menus
  if (!e.target.closest('.dash-actions-more')) {
    document.querySelectorAll('.dash-actions-more .header-more-menu.open').forEach(function(m) { m.classList.remove('open'); });
  }
  // Close badge popups
  if (!e.target.closest('.tab-badge-wrap')) {
    closeBadgePopups();
  }
});

function toggleHeaderMore() {
  var menu = document.getElementById('headerMoreMenu');
  menu.classList.toggle('open');
}
function closeHeaderMore() {
  var menu = document.getElementById('headerMoreMenu');
  if (menu) menu.classList.remove('open');
}


// Badge popup — show task list on badge click
function toggleBadgePopup(tabType) {
  var popupId = tabType === 'tasks' ? 'badgePopupTasks' : 'badgePopupMyTasks';
  var popup = document.getElementById(popupId);
  if (!popup) return;

  // Close other popups
  document.querySelectorAll('.badge-popup.open').forEach(function(p) {
    if (p.id !== popupId) p.classList.remove('open');
  });

  if (popup.classList.contains('open')) {
    popup.classList.remove('open');
    return;
  }

  var tasks = getVisibleTasks();
  var now = new Date();
  var items = [];

  if (tabType === 'tasks') {
    items = tasks.filter(function(t) {
      if (t.status !== 'pending_approval' || !userData) return false;
      var chain = t.approvalChain || [];
      var isInChain = chain.some(function(step) { return step.approverId === userData.id && step.status === 'pending'; });
      var isDraftedForMe = t.draftedForLeader && t.draftedForLeader === userData.id;
      var hasDesignated = (chain.length > 0) || t.draftedForLeader;
      var canByRole = !hasDesignated && canGV('task:approve') && canGVDept(t.assignedDept ? t.assignedDept.id : '');
      return isInChain || isDraftedForMe || canByRole;
    });
  } else if (tabType === 'mytasks' && userData) {
    items = tasks.filter(function(t) {
      if (!t.assignedTo || t.assignedTo.uid !== userData.id) return false;
      if (t.status === 'completed' || t.status === 'cancelled' || t.status === 'archived') return false;
      var due = t.dueDate ? (t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate)) : null;
      return (due && due < now) || t.status === 'review';
    });
  }

  if (items.length === 0) {
    popup.innerHTML = '<div class="badge-popup-empty">Kh\u00F4ng c\u00F3 c\u00F4ng vi\u1EC7c n\u00E0o</div>';
  } else {
    var headerText = tabType === 'tasks'
      ? items.length + ' c\u00F4ng vi\u1EC7c ch\u1EDD duy\u1EC7t'
      : items.length + ' vi\u1EC7c c\u1EA7n x\u1EED l\u00FD';
    var html = '<div class="badge-popup-header"><span>' + headerText + '</span><button class="bp-close" onclick="event.stopPropagation();closeBadgePopups();">\u00D7</button></div>';
    items.forEach(function(t) {
      var dueStr = '';
      var dueClass = '';
      if (t.dueDate) {
        var due = t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
        dueStr = due.toLocaleDateString('vi-VN');
        if (due < now) dueClass = ' style="color:#c62828;font-weight:600;"';
      }
      var dept = t.assignedDept ? t.assignedDept.name : '';
      html += '<div class="badge-popup-item" onclick="event.stopPropagation();closeBadgePopups();openTaskDetail(\'' + t.id + '\')">' +
        '<div class="bp-priority ' + (t.priority || 'P3') + '"></div>' +
        '<div class="bp-title">' + escapeHtml(t.title || '') + '</div>' +
        (dept ? '<div class="bp-dept">' + escapeHtml(dept) + '</div>' : '') +
        (dueStr ? '<div class="bp-due"' + dueClass + '>' + dueStr + '</div>' : '') +
      '</div>';
    });
    popup.innerHTML = html;
  }

  // Position popup below the badge using fixed coordinates
  var badgeId = tabType === 'tasks' ? 'badgeTasks' : 'badgeMyTasks';
  var badge = document.getElementById(badgeId);
  if (badge) {
    var rect = badge.getBoundingClientRect();
    popup.style.top = (rect.bottom + 6) + 'px';
    popup.style.left = Math.max(8, rect.left + rect.width / 2 - 160) + 'px';
  }

  popup.classList.add('open');
}

function closeBadgePopups() {
  document.querySelectorAll('.badge-popup.open').forEach(function(p) { p.classList.remove('open'); });
}

async function onNotifClick(notifId, taskId) {
  // Mark as read
  try {
    await db.collection('notifications').doc(notifId).update({ read: true });
    var n = allNotifications.find(function(n) { return n.id === notifId; });
    if (n) n.read = true;
    renderNotifications();
  } catch (e) {}

  // Open task if linked
  if (taskId) {
    document.getElementById('notifDropdown').classList.remove('open');
    var task = allTasks.find(function(t) { return t.id === taskId; });
    if (task) {
      openTaskDetail(taskId);
    }
  }
}

async function markAllNotifRead() {
  var unread = allNotifications.filter(function(n) { return !n.read; });
  if (unread.length === 0) return;

  try {
    var batch = db.batch();
    unread.forEach(function(n) {
      batch.update(db.collection('notifications').doc(n.id), { read: true });
      n.read = true;
    });
    await batch.commit();
    renderNotifications();
    showToast('Đã đánh dấu tất cả đã đọc', 'success');
  } catch (e) {
    console.warn('Mark all read error:', e);
  }
}

async function createNotification(recipientId, message, taskId) {
  if (recipientId === userData.id) return; // Don't notify self
  try {
    await db.collection('notifications').add({
      recipientId: recipientId,
      message: message,
      taskId: taskId || '',
      read: false,
      createdAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      createdBy: { uid: userData.id, name: userData.hoTen || userData.name || '' }
    });
  } catch (e) {
    console.warn('Create notification error:', e);
  }
}
