// =============================================
// My Tasks (Tab 3)
// =============================================

// Helper: check if user is next pending cost approver for a task
function _isPendingCostApprover(t) {
  if (!userData) return false;
  var uid = userData.id;
  if (t.costEstimate && t.costEstimate.approvers && t.costEstimate.status === 'pending') {
    var pending = t.costEstimate.approvers.filter(function(a) { return a.status === 'pending'; });
    if (pending.length > 0 && pending[0].uid === uid) return true;
  }
  return false;
}

function loadMyTasks() {
  var uid = userData ? userData.id : '';

  // Việc được giao trực tiếp
  var assignedTasks = allTasks.filter(function(t) {
    if (t.assignedTo && t.assignedTo.uid === uid) return true;
    if (t.supportDepts && t.supportDepts.some(function(d) {
      var nd = normalizeSupportDept(d);
      return nd.assignedTo && nd.assignedTo.uid === uid && nd.status !== 'completed';
    })) return true;
    if (t.subtasks && t.subtasks.some(function(s) {
      var ns = normalizeSubtask(s);
      return ns.assignee && ns.assignee.uid === uid && ns.status !== 'done';
    })) return true;
    return false;
  });

  // Việc chờ phê duyệt chi phí (chỉ task chưa có trong assigned)
  var assignedIds = {};
  assignedTasks.forEach(function(t) { assignedIds[t.id] = true; });
  var costApprovalTasks = allTasks.filter(function(t) {
    if (assignedIds[t.id]) return false;
    return _isPendingCostApprover(t);
  });

  // Gắn tag phân biệt
  assignedTasks.forEach(function(t) { t._myTaskType = 'assigned'; });
  costApprovalTasks.forEach(function(t) { t._myTaskType = 'cost_approval'; });

  myTasks = assignedTasks.concat(costApprovalTasks);

  // Render My Dashboard stats (chỉ tính assigned, không tính cost approval)
  renderMyDashboard(assignedTasks);

  var filtered = myTasks;
  if (currentMyTaskFilter === 'cost_approval') {
    filtered = costApprovalTasks;
  } else if (currentMyTaskFilter !== 'all') {
    filtered = assignedTasks.filter(function(t) { return t.status === currentMyTaskFilter; });
  }

  var listEl = document.getElementById('myTaskList');
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">\uD83D\uDCED</div><div class="empty-state-text">Ch\u01B0a c\u00F3 vi\u1EC7c n\u00E0o</div></div>';
    return;
  }
  var html = '';
  filtered.forEach(function(t) {
    var cardHtml = renderTaskCard(t);
    if (t._myTaskType === 'cost_approval') {
      cardHtml = '<div style="position:relative;">' + cardHtml +
        '<div style="position:absolute;top:8px;right:8px;background:#fff3e0;color:#e65100;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;border:1px solid #e65100;">\uD83D\uDCB0 Ch\u1EDD duy\u1EC7t chi ph\u00ED</div></div>';
    }
    html += cardHtml;
  });
  listEl.innerHTML = html;
}

function filterMyTasks(status) {
  currentMyTaskFilter = status;
  document.querySelectorAll('#myTaskFilterChips .chip').forEach(function(c) { c.classList.remove('active'); });
  event.target.classList.add('active');
  loadMyTasks();
}
