// =============================================
// Data Loading
// =============================================
async function loadDepartments() {
  try {
    var snap = await db.collection('categoryDepartments').orderBy('name').get();
    allDepartments = snap.docs.map(function(doc) { return { id: doc.id, ...doc.data() }; });
  } catch (e) {
    console.error('Load departments error:', e);
  }
}

async function loadPersonnel() {
  try {
    var snap = await db.collection('categoryPersonnel').get();
    allPersonnel = snap.docs.map(function(doc) { return { id: doc.id, ...doc.data() }; });
  } catch (e) {
    console.error('Load personnel error:', e);
  }
}

async function loadPositions() {
  try {
    var snap = await db.collection('categoryPositions').get();
    allPositions = snap.docs.map(function(doc) { return { id: doc.id, ...doc.data() }; });
  } catch (e) {
    console.warn('Load positions error:', e);
  }
}

async function loadAssistantLeaderMapping() {
  try {
    var doc = await db.collection('appConfig').doc('assistantLeaderMapping').get();
    assistantLeaderMappings = doc.exists ? (doc.data().mappings || []) : [];
  } catch (e) {
    console.warn('Load assistant mapping error:', e);
  }
}

function checkIsAssistant() {
  if (!userData) return null;
  var mapping = assistantLeaderMappings.find(function(m) { return m.assistantId === userData.id; });
  return mapping ? mapping.leaderId : null;
}

function getAssistantLeaderName() {
  var mapping = assistantLeaderMappings.find(function(m) { return m.assistantId === userData.id; });
  return mapping ? mapping.leaderName : null;
}

function getLeaderAssistants(leaderId) {
  return assistantLeaderMappings.filter(function(m) { return m.leaderId === leaderId; });
}

// Tìm trưởng bộ phận theo deptId
// Cache employeePositions (ki\u00EAm nhi\u1EC7m)
var _employeePositionsCache = null;
async function _loadEmployeePositions() {
  if (_employeePositionsCache) return _employeePositionsCache;
  try {
    var snap = await db.collection('employeePositions').get();
    _employeePositionsCache = snap.docs.map(function(doc) { return { id: doc.id, userId: doc.data().userId, departmentId: doc.data().departmentId, positionId: doc.data().positionId }; });
  } catch(e) { _employeePositionsCache = []; }
  return _employeePositionsCache;
}

function getDeptHead(deptId) {
  if (!deptId) return null;
  // 1. T\u00ECm trong allDepartments xem c\u00F3 field manager/truongPhong
  var dept = allDepartments.find(function(d) { return d.id === deptId; });
  if (dept && (dept.manager || dept.truongPhong)) {
    var mgrId = dept.manager || dept.truongPhong;
    var mgrPerson = allPersonnel.find(function(p) { return p.id === mgrId; });
    if (mgrPerson) return { uid: mgrId, name: mgrPerson.hoTen || mgrPerson.name || '' };
  }
  // 2. T\u00ECm trong allPersonnel theo phongBan + ki\u00EAm nhi\u1EC7m
  var candidates = allPersonnel.filter(function(p) {
    if (p.department === deptId || p.phongBan === deptId) return true;
    // Check ki\u00EAm nhi\u1EC7m
    if (_employeePositionsCache) {
      if (_employeePositionsCache.some(function(ep) { return ep.userId === p.id && ep.departmentId === deptId; })) return true;
    }
    return false;
  });
  if (candidates.length === 0) return null;
  // G\u1EAFn level cho t\u1EEBng candidate
  var withLevel = candidates.map(function(p) {
    var level = 99;
    if (p.position && allPositions.length > 0) {
      var pos = allPositions.find(function(ps) { return ps.id === p.position; });
      if (pos && pos.level) level = pos.level;
    }
    // Fallback: check role/chucVu text
    if (level === 99) {
      if (p.role === 'manager' || p.chucVu === 'Tr\u01B0\u1EDFng ph\u00F2ng') level = 4;
      else if (p.chucVu === 'Ph\u00F3 ph\u00F2ng') level = 5;
    }
    return { person: p, level: level };
  });
  // S\u1EAFp x\u1EBFp theo b\u1EADc th\u1EA5p nh\u1EA5t (ch\u1EE9c v\u1EE5 cao nh\u1EA5t)
  withLevel.sort(function(a, b) { return a.level - b.level; });
  // L\u1EA5y ng\u01B0\u1EDDi c\u00F3 b\u1EADc th\u1EA5p nh\u1EA5t (ch\u1EE9c v\u1EE5 cao nh\u1EA5t) trong \u0111\u01A1n v\u1ECB
  var best = withLevel[0];
  if (best && best.level <= 10) {
    return { uid: best.person.id, name: best.person.hoTen || best.person.name || '' };
  }
  return null;
}

// Xác định phòng ban thực tế của nhân viên cho KPI/Stats
// Ưu tiên: phòng ban mà người này là trưởng phòng (manager/truongPhong) > phòng ban trong hồ sơ nhân sự
function getPersonEffectiveDeptId(personId) {
  // 1. Kiểm tra nếu người này là trưởng phòng (manager/truongPhong) của phòng ban nào
  var managedDept = allDepartments.find(function(d) {
    return d.manager === personId || d.truongPhong === personId;
  });
  if (managedDept) return managedDept.id;
  // 2. Fallback: lấy từ hồ sơ nhân sự
  var person = allPersonnel.find(function(p) { return p.id === personId; });
  return person ? (person.department || person.phongBan || '') : '';
}

// Auto-assign trưởng bộ phận vào taskData nếu chưa có assignedTo
function autoAssignDeptHead(taskData) {
  if (taskData.assignedTo) return;
  if (!taskData.assignedDept || !taskData.assignedDept.id) return;
  var head = getDeptHead(taskData.assignedDept.id);
  if (head) {
    taskData.assignedTo = head;
    taskData.status = 'in_progress';
  }
}

function normalizeSupportDept(dept) {
  var assignee = dept.assignedTo || null;
  if (!assignee && dept.id) {
    assignee = getDeptHead(dept.id);
  }
  return {
    id: dept.id,
    name: dept.name || '',
    status: dept.status || 'pending',
    assignedTo: assignee,
    task: dept.task || '',
    note: dept.note || '',
    completedAt: dept.completedAt || null,
    evidences: dept.evidences || []
  };
}

function initSupportDeptsForTask(depts) {
  if (!depts || !Array.isArray(depts)) return [];
  return depts.map(function(d) {
    var head = getDeptHead(d.id);
    return {
      id: d.id,
      name: d.name || '',
      status: 'pending',
      assignedTo: head,
      task: '',
      note: '',
      completedAt: null,
      evidences: []
    };
  });
}

function normalizeSubtask(st) {
  var status = st.status || (st.done ? 'completed' : 'pending');
  return {
    title: st.title || '',
    status: status,
    assignee: st.assignee || null,
    dueDate: st.dueDate || '',
    createdAt: st.createdAt || '',
    note: st.note || '',
    evidences: st.evidences || [],
    completedAt: st.completedAt || null,
    done: status === 'completed',
    deptId: st.deptId || null,
    createdBy: st.createdBy || null,
    revisionReason: st.revisionReason || ''
  };
}
