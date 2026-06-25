// =============================================
// Recurring Tasks
// =============================================
var RECUR_LABELS = { daily: 'Hàng ngày', weekly: 'Hàng tuần', monthly: 'Hàng tháng' };

function toggleRecurringOptions() {
  var val = document.getElementById('taskRecurring').value;
  document.getElementById('recurringEndGroup').style.display = val ? '' : 'none';
  // Gợi ý loại Chuyên môn khi chọn lặp lại (nếu TP)
  if (val && isCurrentUserLeader() && !isCompanyLeader()) {
    var allowed = getAllowedTaskTypes();
    if (allowed.indexOf('routine') !== -1) selectTaskType('routine');
  }
}

// Tính ngày hạn kỳ tiếp theo, đảm bảo >= today
function _calcNextRecurDue(baseDue, recurType) {
  var now = new Date();
  var next = new Date(baseDue);
  // Bước 1 kỳ từ baseDue
  if (recurType === 'daily') next.setDate(next.getDate() + 1);
  else if (recurType === 'weekly') next.setDate(next.getDate() + 7);
  else if (recurType === 'monthly') next.setMonth(next.getMonth() + 1);
  // Nếu đã qua → dời lên kỳ gần nhất từ hôm nay
  while (next < now) {
    if (recurType === 'daily') next.setDate(next.getDate() + 1);
    else if (recurType === 'weekly') next.setDate(next.getDate() + 7);
    else if (recurType === 'monthly') next.setMonth(next.getMonth() + 1);
  }
  return next;
}

// Tạo bản mới cho task lặp lại (gọi khi hoàn thành hoặc khi init)
async function createNextRecurringInstance(task) {
  var now = new Date();
  // Kiểm tra ngày kết thúc lặp
  var recurEnd = task.recurringEnd ? (task.recurringEnd.toDate ? task.recurringEnd.toDate() : new Date(task.recurringEnd)) : null;
  if (recurEnd && recurEnd < now) return false;

  // Tính nextDue từ dueDate gốc
  var baseDue = task.dueDate ? (task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate)) : now;
  var nextDue = _calcNextRecurDue(baseDue, task.recurring);

  // Guard chống tạo trùng
  var recurKey = task.recurring + '_' + nextDue.toISOString().slice(0, 10);
  if (task.lastRecurId === recurKey) return false;

  // Tạo task mới — status in_progress, giữ assignedTo
  var newTask = {
    title: task.title,
    description: task.description || '',
    priority: task.priority || 'P2',
    taskType: task.taskType || 'routine',
    status: 'in_progress',
    createdBy: task.createdBy || null,
    assignedDept: task.assignedDept || null,
    supportDepts: task.supportDepts || [],
    assignedTo: task.assignedTo || null,
    approvedBy: task.approvedBy || task.createdBy,
    dueDate: ErpDb.firestore.Timestamp.fromDate(nextDue),
    createdAt: ErpDb.firestore.FieldValue.serverTimestamp(),
    updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
    completedAt: null,
    progress: 0,
    comments: [{ by: { uid: 'system', name: 'Hệ thống' }, text: 'Tự động tạo từ công việc lặp lại', at: new Date().toISOString() }],
    parentTaskId: task.parentTaskId || null,
    sourceType: task.sourceType || 'manual',
    sourceRef: task.sourceRef || '',
    tags: task.tags || [],
    dependencies: [],
    recurring: task.recurring,
    recurringEnd: task.recurringEnd || null,
    recurringParentId: task.recurringParentId || task.id
  };

  await db.collection('workTasks').add(newTask);
  // Đánh dấu task gốc đã tạo kỳ này
  await db.collection('workTasks').doc(task.id).update({ lastRecurId: recurKey });
  return true;
}

// Chạy khi init — xử lý các task recurring đã hoàn thành nhưng chưa tạo kỳ mới
async function processRecurringTasks() {
  try {
    var snap = await db.collection('workTasks')
      .where('recurring', 'in', ['daily', 'weekly', 'monthly'])
      .where('status', '==', 'completed')
      .get();

    var count = 0;
    for (var i = 0; i < snap.docs.length; i++) {
      var doc = snap.docs[i];
      var task = doc.data();
      task.id = doc.id;
      var created = await createNextRecurringInstance(task);
      if (created) count++;
    }

    if (count > 0) {
      console.log('Created ' + count + ' recurring task(s)');
      await loadAllTasks();
      renderTaskList();
    }
  } catch (err) {
    console.error('Recurring tasks error:', err);
  }
}

