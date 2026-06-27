/* services.js — CRUD nhân sự qua ErpDb (Supabase /api/data). */
(function () {
  'use strict';

  const SS = () => ErpDb.firestore.FieldValue.serverTimestamp();
  const getDb = () => window.db;

  /** NV thuộc danh sách Viện — chỉ loại KH sản xuất Lai Khê. */
  function isInstitutePersonnel(p) {
    const meta = p.metadata || {};
    if (meta.hr_scope === 'production_kh') return false;
    const code = (p.employeeCode || p.employee_code || p.code || '').toUpperCase();
    if (/^LK-KH-/.test(code)) return false;
    const wg = p.workGroupId || p.work_group_id || '';
    if (wg === 'wg-lk-kh') return false;
    const pos = String(p.position || p.positionName || p.position_name || '').toLowerCase();
    if (/khoán hộ/.test(pos)) return false;
    return true;
  }

  async function loadSystemRoles() {
    try {
      const res = await fetch('/api/system-roles');
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.roles) return body.roles;
    } catch (e) { /* ignore */ }
    return [
      { id: 1, role_name: 'Super_Admin', description: 'Quản trị viên' },
      { id: 2, role_name: 'Institute_Executive', description: 'Ban Lãnh đạo Viện' },
      { id: 3, role_name: 'Department_Head', description: 'Lãnh đạo đơn vị' },
      { id: 4, role_name: 'Operations_Specialist', description: 'Chuyên viên Nghiệp vụ' },
      { id: 5, role_name: 'Technical_Staff', description: 'NCV / KTV' },
      { id: 6, role_name: 'Staff_Viewer', description: 'Nhân viên (chỉ xem)' }
    ];
  }

  async function syncUserSystemRole(username, systemRoleId) {
    if (!username || !systemRoleId) return;
    const res = await fetch('/api/personnel/system-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, systemRoleId })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      throw new Error(body.message || 'Không cập nhật được vai trò hệ thống');
    }
  }

  async function syncAccessRights(username, employeeId, appRolesCache) {
    if (!username) return;
    const res = await fetch('/api/personnel/access-rights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, employeeId, appRolesCache: appRolesCache || {} })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      throw new Error(body.message || 'Không cập nhật được quyền truy cập');
    }
  }

  function erpRoleFromSystemRoleId(systemRoleId, roles) {
    const row = (roles || []).find(r => String(r.id) === String(systemRoleId));
    const name = row?.role_name || '';
    if (name === 'Super_Admin') return 'admin';
    if (['Institute_Executive', 'Department_Head', 'Operations_Specialist'].includes(name)) return 'vpp';
    return 'user';
  }

  // ============== Personnel ==============
  async function loadPersonnel() {
    const db = getDb();
    const [snap, posSnap] = await Promise.all([
      db.collection('categoryPersonnel').get(),
      db.collection('employeePositions').get().catch(() => ({ docs: [] }))
    ]);
    const positionsMap = {};
    posSnap.docs.forEach(doc => {
      const data = doc.data();
      const userId = data.userId;
      if (!positionsMap[userId]) positionsMap[userId] = [];
      positionsMap[userId].push({
        id: doc.id,
        departmentId: data.departmentId,
        departmentName: data.departmentName,
        positionId: data.positionId,
        positionName: data.positionName,
        isPrimary: data.isPrimary,
        assignmentType: data.assignmentType
      });
    });

    const list = snap.docs.map(doc => {
      const d = doc.data();
      const meta = d.metadata || {};
      return {
        id: doc.id, ...d,
        hoTen: d.hoTen || d.name || '',
        employeeCode: d.employeeCode || d.code || '',
        disabled: d.disabled ?? (d.status === 'inactive' || d.status === 'resigned'),
        concurrentPositions: positionsMap[doc.id] || [],
        systemRoleId: meta.systemRoleId || meta.system_role_id || d.systemRoleId || null,
        appRolesCache: d.appRolesCache || d.app_roles_cache || meta.appRolesCache || {}
      };
    }).filter(isInstitutePersonnel);
    list.sort((a, b) => (a.hoTen || '').localeCompare(b.hoTen || '', 'vi'));
    return list;
  }

  async function savePersonnel(id, data) {
    const db = getDb();
    data.updatedAt = SS();
    if (id) {
      await db.collection('categoryPersonnel').doc(id).update(data);
      return id;
    } else {
      throw new Error('Use createPersonnel() for new users (needs Auth)');
    }
  }

  async function createPersonnelWithAuth(username, password, data) {
    if (!password || password.length < 6) throw new Error('Mật khẩu ≥ 6 ký tự');
    const res = await fetch('/api/personnel/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, data })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      throw new Error(body.message || 'Không tạo được nhân sự');
    }
    return body.id;
  }

  async function deletePersonnel(id) {
    await getDb().collection('categoryPersonnel').doc(id).delete();
  }

  async function togglePersonnelStatus(id, disabled) {
    await getDb().collection('categoryPersonnel').doc(id).update({
      disabled,
      status: disabled ? 'inactive' : 'active',
      updatedAt: SS()
    });
  }

  // Set / clear order for an employee in a specific department
  async function setEmployeeOrder(empId, deptId, order) {
    if (!empId || !deptId) throw new Error('Cần empId + deptId');
    const db = getDb();
    const path = `orderByDept.${deptId}`;
    if (order === null || order === undefined || order === '') {
      await db.collection('categoryPersonnel').doc(empId).update({
        [path]: ErpDb.firestore.FieldValue.delete(),
        updatedAt: SS()
      });
    } else {
      await db.collection('categoryPersonnel').doc(empId).update({
        [path]: Number(order),
        updatedAt: SS()
      });
    }
  }

  // ============== Departments ==============
  async function loadDepartments() {
    const snap = await getDb().collection('categoryDepartments').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function saveDepartment(id, data) {
    const db = getDb();
    data.updatedAt = SS();
    if (id) {
      await db.collection('categoryDepartments').doc(id).update(data);
      return id;
    } else {
      data.createdAt = SS();
      const ref = await db.collection('categoryDepartments').add(data);
      return ref.id;
    }
  }

  async function deleteDepartment(id) {
    await getDb().collection('categoryDepartments').doc(id).delete();
  }

  // ============== Positions ==============
  async function loadPositions() {
    try {
      const snap = await getDb().collection('categoryPositions').orderBy('name').get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      try {
        const snap = await getDb().collection('categoryPositions').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (e2) {
        return [];
      }
    }
  }

  async function savePosition(id, data) {
    const db = getDb();
    data.updatedAt = SS();
    if (id) {
      await db.collection('categoryPositions').doc(id).update(data);
      return id;
    } else {
      data.createdAt = SS();
      const ref = await db.collection('categoryPositions').add(data);
      return ref.id;
    }
  }

  async function deletePosition(id) {
    await getDb().collection('categoryPositions').doc(id).delete();
  }

  // ============== Factories ==============
  async function loadFactories() {
    const snap = await getDb().collection('categoryFactories').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function saveFactory(id, data) {
    const db = getDb();
    data.updatedAt = SS();
    if (id) {
      // Use set+merge so first-time edit of a hardcoded factory creates the doc
      await db.collection('categoryFactories').doc(id).set(data, { merge: true });
      return id;
    } else {
      data.createdAt = SS();
      const ref = await db.collection('categoryFactories').add(data);
      return ref.id;
    }
  }

  async function deleteFactory(id) {
    await getDb().collection('categoryFactories').doc(id).delete();
  }

  // ============== Teams ==============
  async function loadTeams() {
    const snap = await getDb().collection('categoryTeams').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function saveTeam(id, data) {
    const db = getDb();
    data.updatedAt = SS();
    if (id) {
      await db.collection('categoryTeams').doc(id).update(data);
      return id;
    } else {
      data.createdAt = SS();
      const ref = await db.collection('categoryTeams').add(data);
      return ref.id;
    }
  }

  async function deleteTeam(id) {
    await getDb().collection('categoryTeams').doc(id).delete();
  }

  async function setTeamMembership(personnelId, teamId) {
    await getDb().collection('categoryPersonnel').doc(personnelId).update({
      team: teamId || '',
      updatedAt: SS()
    });
  }

  // ============== EmployeePositions (kiêm nhiệm) ==============
  async function loadEmployeePositions(userId) {
    const snap = await getDb().collection('employeePositions')
      .where('userId', '==', userId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function addEmployeePosition(data) {
    data.assignedAt = SS();
    const ref = await getDb().collection('employeePositions').add(data);
    return ref.id;
  }

  async function deleteEmployeePosition(id) {
    await getDb().collection('employeePositions').doc(id).delete();
  }

  async function setPrimaryEmployeePosition(userId, posId) {
    const db = getDb();
    const all = await db.collection('employeePositions').where('userId', '==', userId).get();
    const batch = db.batch();
    all.docs.forEach(d => {
      batch.update(d.ref, { isPrimary: d.id === posId });
    });
    await batch.commit();
  }

  // ============== Auth state ==============
  async function loadCurrentUser(uidOrUsername) {
    const db = getDb();
    let doc = await db.collection('categoryPersonnel').doc(uidOrUsername).get();
    if (!doc.exists) {
      const snap = await db.collection('categoryPersonnel')
        .where('username', '==', uidOrUsername).limit(1).get();
      if (!snap.empty) {
        const d = snap.docs[0];
        return { id: d.id, ...d.data() };
      }
      return null;
    }
    return { id: doc.id, ...doc.data() };
  }

  // Real-time listener for managed teams
  async function loadManagedTeams(userId) {
    if (!userId) return [];
    const snap = await getDb().collection('categoryTeams')
      .where('managerId', '==', userId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ============== Migrate assignments (admin) ==============
  async function migrateAssignments(personnel, departments, positions, onProgress) {
    const db = getDb();
    let updated = 0, skipped = 0;
    let batch = db.batch();
    let count = 0;
    for (const p of personnel) {
      if (!p.department && !p.position) { skipped++; continue; }
      const deptObj = departments.find(d => d.id === p.department);
      const posObj = positions.find(x => x.id === p.position);
      const ref = db.collection('categoryPersonnel').doc(p.id);
      batch.update(ref, {
        assignments: [{
          isPrimary: true,
          departmentId: p.department || '',
          departmentName: deptObj?.name || '',
          positionId: p.position || '',
          positionName: posObj?.name || ''
        }],
        updatedAt: SS()
      });
      count++; updated++;
      if (count >= 400) {
        await batch.commit(); batch = db.batch(); count = 0;
      }
      if (onProgress) onProgress(updated, personnel.length);
    }
    if (count > 0) await batch.commit();
    return { updated, skipped };
  }

  window.NhansuServices = {
    loadPersonnel, savePersonnel, createPersonnelWithAuth,
    deletePersonnel, togglePersonnelStatus, setEmployeeOrder,
    loadSystemRoles, syncUserSystemRole, syncAccessRights, erpRoleFromSystemRoleId,
    loadDepartments, saveDepartment, deleteDepartment,
    loadPositions, savePosition, deletePosition,
    loadFactories, saveFactory, deleteFactory,
    loadTeams, saveTeam, deleteTeam, setTeamMembership,
    loadEmployeePositions, addEmployeePosition,
    deleteEmployeePosition, setPrimaryEmployeePosition,
    loadCurrentUser, loadManagedTeams, migrateAssignments
  };
})();
