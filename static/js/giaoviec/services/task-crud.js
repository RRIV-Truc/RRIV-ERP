// =============================================
// Task Delegation
// =============================================
function openDelegateForm(taskId) {
  var task = allTasks.find(function(t) { return t.id === taskId; });
  if (!task) return;

  document.getElementById('delegateTaskId').value = taskId;
  document.getElementById('delegateTaskInfo').textContent = 'Công việc: ' + task.title + (task.assignedTo ? '\nPIC hiện tại: ' + task.assignedTo.name : '');
  document.getElementById('delegateReason').value = '';

  var sel = document.getElementById('delegateTo');
  sel.innerHTML = '<option value="">-- Ch\u1ECDn nh\u00E2n vi\u00EAn --</option>';
  var deptId = task.assignedDept ? task.assignedDept.id : '';
  var people = deptId ? allPersonnel.filter(function(p) { return p.department === deptId || p.phongBan === deptId; }) : allPersonnel;
  if (people.length === 0) people = allPersonnel;
  people.forEach(function(p) {
    var pName = p.hoTen || p.name || p.username || p.id;
    if (task.assignedTo && p.id === task.assignedTo.uid) return; // Exclude current PIC
    sel.innerHTML += '<option value="' + p.id + '" data-name="' + escapeHtml(pName) + '">' + escapeHtml(pName) + '</option>';
  });

  closeModal('taskDetailModal');
  openModal('delegateModal');
}

async function executeDelegation() {
  var taskId = document.getElementById('delegateTaskId').value;
  var toSel = document.getElementById('delegateTo');
  var reason = document.getElementById('delegateReason').value.trim();

  if (!toSel.value) { showToast('Vui lòng chọn người nhận', 'warning'); return; }

  var newPicId = toSel.value;
  var newPicName = toSel.selectedOptions[0] ? toSel.selectedOptions[0].dataset.name || '' : '';
  var actorName = userData.hoTen || userData.name || '';

  var task = allTasks.find(function(t) { return t.id === taskId; });
  var oldPicName = task && task.assignedTo ? task.assignedTo.name : 'Kh\u00F4ng c\u00F3';

  var commentText = actorName + ' chuyển giao từ ' + oldPicName + ' sang ' + newPicName;
  if (reason) commentText += '. Lý do: ' + reason;

  try {
    await db.collection('workTasks').doc(taskId).update({
      assignedTo: { uid: newPicId, name: newPicName },
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      comments: ErpDb.firestore.FieldValue.arrayUnion({
        by: { uid: userData.id, name: actorName },
        text: commentText,
        at: new Date().toISOString()
      })
    });

    // Notify new PIC
    createNotification(newPicId, actorName + ' đã chuyển giao công việc "' + (task ? task.title : '') + '" cho bạn.', taskId);
    // Notify old PIC
    if (task && task.assignedTo) {
      createNotification(task.assignedTo.uid, 'Công việc "' + (task ? task.title : '') + '" đã được chuyển giao cho ' + newPicName + '.', taskId);
    }

    showToast('Đã chuyển giao cho ' + newPicName, 'success');
    closeModal('delegateModal');
    await loadAllTasks();
    loadDashboard();
    renderDeptPerformance();
    renderTaskList();
    loadMyTasks();
  } catch (e) {
    showToast('Lỗi chuyển giao: ' + e.message, 'error');
  }
}

