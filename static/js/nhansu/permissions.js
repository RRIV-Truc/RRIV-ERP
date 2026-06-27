/* permissions.js — auth helpers, permission checks (RRIV Supabase, không Firebase). */
(function () {
  'use strict';

  let roleDefsUnsub = null;

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

  function canManageAccessRights(user) {
    if (isAdmin(user)) return true;
    if (typeof Permissions !== 'undefined' && Permissions.hasPermissionWithOverrides) {
      return Permissions.hasPermissionWithOverrides('nhansu', 'access:manage') ||
        Permissions.hasPermissionWithOverrides('nhansu', '*');
    }
    return false;
  }

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

  async function isSingleSessionEnabled() {
    return false;
  }

  function startSessionListener() { /* chưa triển khai trên Supabase */ }

  function stopSessionListener() { /* noop */ }

  function forceLogout(message) {
    if (typeof Auth !== 'undefined') Auth.logout();
    else {
      alert(message || 'Phiên đăng nhập đã kết thúc');
      window.location.href = '/';
    }
  }

  function subscribeRoleDefs(userId, onChange) {
    if (typeof Permissions === 'undefined' || !window.db) return;
    try {
      if (typeof Permissions.subscribeToAllPermissions === 'function') {
        const subs = Permissions.subscribeToAllPermissions(window.db, userId, 'nhansu', () => {
          if (typeof onChange === 'function') onChange();
        });
        roleDefsUnsub = subs?.unsubscribeAll || null;
      }
    } catch (_) { /* noop */ }
  }

  function unsubscribeRoleDefs() {
    if (roleDefsUnsub) { try { roleDefsUnsub(); } catch (_) { /* ignore */ } roleDefsUnsub = null; }
  }

  function canAccessApp(user) {
    if (isAdmin(user)) return true;
    if (typeof Permissions !== 'undefined' && Permissions.hasPermission) {
      if (Permissions.hasPermission('nhansu', 'employee:view')) return true;
    }
    const cache = user?.appRolesCache || user?.app_roles_cache || {};
    const entry = cache.nhansu;
    if (!entry) return false;
    const roles = entry.roles || (entry.role ? [entry.role] : []);
    return roles.length > 0;
  }

  window.NhansuPerms = {
    isAdmin, getScope, canViewAll, canAccessApp,
    canManageEmployees, canDeleteEmployees,
    canManageDepartments, canManagePositions, canManageTeams,
    canImport, canEditEmployee, canManageAccessRights,
    isSingleSessionEnabled, startSessionListener, stopSessionListener, forceLogout,
    subscribeRoleDefs, unsubscribeRoleDefs
  };
})();
