/* services.js — Firebase CRUD wrappers for all 5 collections.
 * Reads `db` (ErpDb.firestore() instance) from window.db.
 */
(function () {
  'use strict';

  const SS = () => ErpDb.firestore.FieldValue.serverTimestamp();
  const getDb = () => window.db;

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
      return {
        id: doc.id, ...d,
        hoTen: d.hoTen || d.name || '',
        employeeCode: d.employeeCode || d.code || '',
        disabled: d.disabled ?? (d.status === 'inactive' || d.status === 'resigned'),
        concurrentPositions: positionsMap[doc.id] || []
      };
    });
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
    const db = getDb();
    if (!password || password.length < 6) throw new Error('Mật khẩu ≥ 6 ký tự');
    const email = `${username}@phr.vn`;

    // Check duplicate username
    const existingQuery = await db.collection('categoryPersonnel')
      .where('username', '==', username).limit(1).get().catch(() => null);
    if (existingQuery && !existingQuery.empty) {
      throw new Error('Username đã tồn tại trong danh sách nhân sự');
    }

    // Use secondary auth so admin session not affected
    const tempAuth = window.NhansuPerms.getSecondaryAuth();
    const uc = await tempAuth.createUserWithEmailAndPassword(email, password);
    await tempAuth.signOut();

    data.createdAt = SS();
    data.updatedAt = SS();
    data.email = email;
    data.username = username;
    await db.collection('categoryPersonnel').doc(uc.user.uid).set(data);
    return uc.user.uid;
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
    const snap = await getDb().collection('categoryPositions').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
  async function loadCurrentUser(uid) {
    const doc = await getDb().collection('categoryPersonnel').doc(uid).get();
    if (!doc.exists) return null;
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
    loadDepartments, saveDepartment, deleteDepartment,
    loadPositions, savePosition, deletePosition,
    loadFactories, saveFactory, deleteFactory,
    loadTeams, saveTeam, deleteTeam, setTeamMembership,
    loadEmployeePositions, addEmployeePosition,
    deleteEmployeePosition, setPrimaryEmployeePosition,
    loadCurrentUser, loadManagedTeams, migrateAssignments
  };
})();
