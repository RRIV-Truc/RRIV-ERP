/* permissions.js — auth helpers, permission checks, secondary auth, session listener.
 * Wraps the global Permissions module from js/utils/permissions.js
 */
(function () {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBCpPDhOKofImy_K8xiV2Mhut_3gbdB1vY",
    authDomain: "quantridoanhnghiepphr.firebaseapp.com",
    projectId: "quantridoanhnghiepphr",
    storageBucket: "quantridoanhnghiepphr.firebasestorage.app",
    messagingSenderId: "1024381876052",
    appId: "1:1024381876052:web:150ee86fc411bd14733ac1"
  };

  let secondaryApp = null;
  let secondaryAuth = null;
  let sessionListener = null;
  let roleDefsUnsub = null;

  function getSecondaryAuth() {
    if (!secondaryApp) {
      secondaryApp = ErpDb.initializeApp(FIREBASE_CONFIG, 'SecondaryApp');
      secondaryAuth = secondaryApp.auth();
    }
    return secondaryAuth;
  }

  function isAdmin(user) {
    if (!user) return false;
    if (typeof Permissions !== 'undefined' && Permissions.isGlobalAdmin && Permissions.isGlobalAdmin()) return true;
    const r = user.role || user.globalRole || '';
    return r === 'admin' || r === 'superadmin';
  }

  function getScope(user) {
    return user?.appRolesCache?.nhansu?.scope || { type: 'none', ids: [] };
  }

  function canViewAll(user) {
    if (isAdmin(user)) return true;
    const sc = getScope(user);
    return sc.type === 'all';
  }

  function canManageEmployees(user) {
    if (isAdmin(user)) return true;
    if (typeof Permissions !== 'undefined' && Permissions.hasPermission) {
      if (Permissions.hasPermission('nhansu', 'employee:create') ||
          Permissions.hasPermission('nhansu', 'employee:update')) return true;
    }
    const sc = getScope(user);
    return sc.type === 'all' || sc.type === 'department' || sc.type === 'team';
  }

  function canDeleteEmployees(user) {
    if (isAdmin(user)) return true;
    if (typeof Permissions !== 'undefined' && Permissions.hasPermission) {
      return Permissions.hasPermission('nhansu', 'employee:delete');
    }
    return false;
  }

  function canManageDepartments(user) {
    if (isAdmin(user)) return true;
    if (typeof Permissions !== 'undefined' && Permissions.hasPermission) {
      return Permissions.hasPermission('nhansu', 'department:manage') ||
             Permissions.hasPermission('nhansu', 'department:create');
    }
    return false;
  }

  function canManagePositions(user) {
    if (isAdmin(user)) return true;
    if (typeof Permissions !== 'undefined' && Permissions.hasPermission) {
      return Permissions.hasPermission('nhansu', 'position:manage') ||
             Permissions.hasPermission('nhansu', 'position:create');
    }
    return false;
  }

  function canManageTeams(user) {
    if (isAdmin(user)) return true;
    if (typeof Permissions !== 'undefined' && Permissions.hasPermission) {
      return Permissions.hasPermission('nhansu', 'team:manage');
    }
    return false;
  }

  function canImport(user) {
    if (isAdmin(user)) return true;
    if (typeof Permissions !== 'undefined' && Permissions.hasPermission) {
      return Permissions.hasPermission('nhansu', 'employee:import');
    }
    return false;
  }

  // Check if current user can edit a specific employee
  function canEditEmployee(user, emp, managedTeams) {
    if (!user || !emp) return false;
    if (isAdmin(user)) return true;
    if (canViewAll(user)) return true;
    const sc = getScope(user);
    if (sc.type === 'department') {
      const ids = sc.ids || [];
      if (ids.includes(emp.department)) return true;
      if ((emp.concurrentPositions || []).some(cp => ids.includes(cp.departmentId))) return true;
    }
    if (sc.type === 'team' || (managedTeams && managedTeams.length)) {
      const teamIds = (managedTeams || []).map(t => t.id || t);
      if (teamIds.includes(emp.team)) return true;
    }
    return false;
  }

  // ============== Session enforcement ==============
  async function isSingleSessionEnabled() {
    try {
      const doc = await window.db.collection('system_settings').doc('auth').get();
      return doc.exists && doc.data().singleSessionEnabled === true;
    } catch { return false; }
  }

  function startSessionListener(userId, onForceLogout) {
    stopSessionListener();
    const localToken = localStorage.getItem('sessionToken');
    if (!localToken) return;
    sessionListener = window.db.collection('user_sessions').doc(userId)
      .onSnapshot(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        if (data.sessionToken && data.sessionToken !== localToken) {
          if (typeof onForceLogout === 'function') onForceLogout('Tài khoản đã đăng nhập trên thiết bị khác');
        }
      }, () => {});
  }

  function stopSessionListener() {
    if (sessionListener) { try { sessionListener(); } catch {} sessionListener = null; }
  }

  function forceLogout(message) {
    try { localStorage.removeItem('sessionToken'); } catch {}
    alert(message || 'Phiên đăng nhập đã kết thúc');
    window.location.href = 'index.html';
  }

  // ============== Role defs subscribe ==============
  function subscribeRoleDefs(userId, onChange) {
    if (typeof Permissions === 'undefined') return;
    try {
      if (typeof Permissions.subscribeToAllPermissions === 'function') {
        const subs = Permissions.subscribeToAllPermissions(window.db, userId, 'nhansu', () => {
          if (typeof onChange === 'function') onChange();
        });
        roleDefsUnsub = subs?.unsubscribeAll || null;
      }
    } catch (e) { /* noop */ }
  }

  function unsubscribeRoleDefs() {
    if (roleDefsUnsub) { try { roleDefsUnsub(); } catch {} roleDefsUnsub = null; }
  }

  window.NhansuPerms = {
    getSecondaryAuth,
    isAdmin, getScope, canViewAll,
    canManageEmployees, canDeleteEmployees,
    canManageDepartments, canManagePositions, canManageTeams,
    canImport, canEditEmployee,
    isSingleSessionEnabled, startSessionListener, stopSessionListener, forceLogout,
    subscribeRoleDefs, unsubscribeRoleDefs
  };
})();
