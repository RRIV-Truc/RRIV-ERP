// =============================================
// Permission Helpers (tích hợp Permissions.js)
// =============================================
function canGV(permission) {
  if (typeof Permissions !== 'undefined' && Permissions.getCurrentPermissions()) {
    if (Permissions.hasPermissionWithOverrides(GV_APP_ID, permission)) return true;
  }
  // Fallback về userRole nếu Permissions.js chưa load
  if (userRole === 'admin') return true;
  var _mgrDenied = ['task:cancel', 'task:delete', 'config:edit', 'template:delete'];
  if (userRole === 'manager') {
    var parts = permission.split(':');
    // task:* chỉ dành cho lãnh đạo công ty bậc ≤ 3, trưởng phòng không được wildcard
    if (parts[1] === '*') return _getCurrentUserLevel() <= 3 && parts[0] !== 'config';
    return _mgrDenied.indexOf(permission) === -1;
  }
  // Lãnh đạo bậc ≤ 4 nhưng userRole chưa match → cấp quyền manager (không wildcard)
  if (isCurrentUserLeader()) {
    var parts2 = permission.split(':');
    if (parts2[1] === '*') return _getCurrentUserLevel() <= 3 && parts2[0] !== 'config';
    return _mgrDenied.indexOf(permission) === -1;
  }
  // Employee
  var employeeAllowed = ['task:view', 'task:submit', 'task:comment'];
  return employeeAllowed.indexOf(permission) !== -1;
}

function _getCurrentUserLevel() {
  if (!userData) return 99;
  var posId = userData.position || '';
  if (posId && allPositions.length > 0) {
    var pos = allPositions.find(function(ps) { return ps.id === posId; });
    if (pos && pos.level) return pos.level;
  }
  return 99;
}

function canGVDept(deptId) {
  if (!deptId) return false;
  if (typeof Permissions !== 'undefined' && Permissions.getCurrentPermissions()) {
    if (Permissions.hasDepartmentScope(GV_APP_ID, deptId)) return true;
  }
  // Admin → quản lý tất cả
  if (userRole === 'admin') return true;
  // Lãnh đạo công ty bậc ≤ 3 → quản lý tất cả phòng
  if (_getCurrentUserLevel() <= 3) return true;
  // Trưởng phòng (bậc 4) hoặc manager → chỉ phòng mình
  var myDeptId = getUserDeptId();
  if (myDeptId && deptId === myDeptId) {
    if (userRole === 'manager' || isCurrentUserLeader()) return true;
  }
  return false;
}

function canGVInDept(permission, deptId) {
  return canGV(permission) && canGVDept(deptId);
}

function getUserDeptId() {
  return userData ? (userData.department || userData.phongBan || '') : '';
}

function applyPermissionUI() {
  var canCreate = canCreateTask();
  var canCreateAny = canCreateAnyTask();
  var canEdit = canGV('task:edit') || !!checkIsAssistant() || isCurrentUserLeader();
  var isAdmin = canGV('config:edit');
  var canViewDashboard = isAdmin || isCompanyLeader();

  var ids = {
    'tabDashboard': canViewDashboard, 'bnavDashboard': canViewDashboard,
    'tabGantt': canViewDashboard, 'drawerGantt': canViewDashboard,
    'tabKanban': canViewDashboard, 'bnavKanban': canViewDashboard,
    'tabCalendar': canViewDashboard, 'drawerCalendar': canViewDashboard,
    'tabActivity': canViewDashboard, 'drawerActivity': canViewDashboard,
    'tabTasks': canCreateAny, 'bnavTasks': canCreateAny, 'btnCreateTask': canCreateAny, 'btnImportCSV': canCreate, 'menuImportCSV': canCreate, 'quickCreateBar': canCreateAny,
    'btnCalcKPI': canGV('kpi:edit') || isCurrentUserLeader(), 'btnAIAnalyzeKPI': canGV('kpi:edit') || isCurrentUserLeader(), 'tabAI': canCreate,
    'btnTemplate': canCreate, 'btnSaveTemplate': canCreate, 'menuTemplate': canCreate,
    'btnKPITrend': canEdit,
    'tabAutomation': isAdmin,
    'batchApprove': isAdmin,
    'btnAssistantConfig': isAdmin,
    'aiConfigSection': isAdmin
  };
  Object.keys(ids).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = ids[id] ? '' : 'none';
  });

  // Nếu đang ở tab bị hạn chế mà không có quyền → chuyển tab
  if (!canViewDashboard) {
    var _restrictedTabIds = ['tab-dashboard', 'tab-gantt', 'tab-kanban', 'tab-calendar', 'tab-activity'];
    var _onRestricted = _restrictedTabIds.some(function(tid) {
      var t = document.getElementById(tid);
      return t && t.classList.contains('active');
    });
    if (_onRestricted) {
      showTab(canCreateAny ? 'tasks' : 'mytasks');
    }
  }
}
// Kiểm tra user hiện tại có phải lãnh đạo công ty (bậc ≤ 3) không
function isCompanyLeader() {
  if (!userData) return false;
  var posId = userData.position || '';
  if (posId && allPositions.length > 0) {
    var pos = allPositions.find(function(ps) { return ps.id === posId; });
    if (pos && pos.level && pos.level <= 3) return true;
  }
  return false;
}

// Kiểm tra user hiện tại có phải lãnh đạo (bậc ≤ 4) không
function isCurrentUserLeader() {
  if (!userData) return false;
  // Check position level via categoryPositions
  var posId = userData.position || '';
  if (posId && allPositions.length > 0) {
    var pos = allPositions.find(function(ps) { return ps.id === posId; });
    if (pos && pos.level && pos.level <= LEADER_LEVEL) return true;
  }
  // Fallback: check chucVu text
  var cv = (userData.chucVu || '').toLowerCase().trim();
  if (LEADER_TITLES.indexOf(cv) !== -1) return true;
  // Fallback: check role
  if (userData.role === 'manager') return true;
  return false;
}

// Kiểm tra user có quyền tạo task loại nào
// LĐ công ty (level≤3): directed, collaboration
// Trưởng phòng (level≤4): routine
// NV: initiative (đề xuất)
function canCreateTask(taskType) {
  if (canGV('config:edit')) return true;          // Admin
  if (checkIsAssistant()) return true;            // Trợ lý (soạn hộ LĐ)
  if (taskType === 'initiative') return true;     // Mọi NV được tạo Đề xuất
  if (isCompanyLeader()) {
    return taskType === 'directed' || taskType === 'collaboration' || !taskType;
  }
  if (isCurrentUserLeader()) {
    return taskType === 'routine' || !taskType;   // TP chỉ tạo Chuyên môn
  }
  if (canGV('task:create')) return true;          // Có quyền đặc biệt
  return false;
}
function canCreateAnyTask() {
  return canCreateTask('initiative');             // Mọi NV đều tạo được Đề xuất
}
// Lấy danh sách loại task user được phép tạo
function getAllowedTaskTypes() {
  if (canGV('config:edit') || checkIsAssistant()) return ['routine','directed','initiative','collaboration'];
  if (isCompanyLeader()) return ['directed','collaboration'];
  if (isCurrentUserLeader()) return ['routine'];
  return ['initiative'];
}

async function loadAllTasks() {
  try {
    var query = db.collection('workTasks').orderBy('createdAt', 'desc');

    // Employee sees only tasks assigned to them or their department
    if (!canCreateTask()) {
      // We'll filter client-side for flexibility
    }

    var snap = await query.get();
    allTasks = snap.docs.map(function(doc) { return { id: doc.id, ...doc.data() }; });
  } catch (e) {
    console.error('Load tasks error:', e);
    allTasks = [];
  }
}

function getVisibleTasks() {
  // Admin xem tất cả
  if (canGV('task:*')) return allTasks;

  var myDeptId = getUserDeptId();

  // Manager xem: CV phòng quản lý + CV tự tạo + phòng phối hợp + CV trợ lý soạn
  if (canCreateTask()) {
    return allTasks.filter(function(t) {
      if (t.assignedDept && canGVDept(t.assignedDept.id)) return true;
      if (t.createdBy && t.createdBy.uid === userData.id) return true;
      if (t.draftedBy && t.draftedBy.uid === userData.id) return true;
      if (t.draftedForLeader === userData.id) return true;
      if (t.supportDepts && t.supportDepts.some(function(d) { return canGVDept(d.id); })) return true;
      return false;
    });
  }

  // Employee xem: CV được giao + CV tự tạo + CV trợ lý soạn + CV phòng mình + CV có subtask giao cho mình
  return allTasks.filter(function(t) {
    if (t.assignedTo && t.assignedTo.uid === userData.id) return true;
    if (t.createdBy && t.createdBy.uid === userData.id) return true;
    if (t.draftedBy && t.draftedBy.uid === userData.id) return true;
    if (t.draftedForLeader === userData.id) return true;
    if (canGV('task:view_dept') && myDeptId && t.assignedDept && t.assignedDept.id === myDeptId) return true;
    if (t.subtasks && t.subtasks.some(function(s) { return s.assignee && s.assignee.uid === userData.id; })) return true;
    if (t.supportDepts && t.supportDepts.some(function(d) { var nd = normalizeSupportDept(d); return nd.assignedTo && nd.assignedTo.uid === userData.id; })) return true;
    return false;
  });
}
