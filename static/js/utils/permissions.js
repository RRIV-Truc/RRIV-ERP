/**
 * Permissions RRIV — RBAC đa app (đọc appRolesCache, hỗ trợ hết hạn / ủy quyền tạm)
 */
const Permissions = (function () {
  'use strict';

  const APP_IDS = {
    VPP: 'vanphongpham',
    DIEUXE: 'dieuhanhxe',
    VANBAN: 'vanbannoibo',
    NHANSU: 'nhansu',
    DIEMDANH: 'diemdanh',
    VUONCAY: 'vuoncay',
    SANXUAT: 'sanxuat',
    CHATLUONG: 'chatluong',
    BAOCAO: 'baocao',
    THONGBAO: 'thongbao',
    PHANQUYEN: 'phanquyen'
  };

  const BROAD_SANXUAT_ROLES = ['admin', 'supervisor', 'manager', 'director'];
  const TEAM_SCOPED_ROLES = ['team_leader', 'doi_truong', 'staff', 'viewer'];

  const DEFAULT_ROLE_DEFS = {
    sanxuat_admin: {
      appId: 'sanxuat', roleId: 'admin', scope: { type: 'all' },
      permissions: ['harvest:*', 'field:*', 'factory:*']
    },
    sanxuat_supervisor: {
      appId: 'sanxuat', roleId: 'supervisor', scope: { type: 'department' },
      permissions: ['harvest:*', 'field:all_teams', 'factory:view', 'harvest:manage_personnel']
    },
    sanxuat_manager: {
      appId: 'sanxuat', roleId: 'manager', scope: { type: 'department' },
      permissions: ['harvest:*', 'field:all_teams', 'factory:view', 'harvest:manage_personnel']
    },
    sanxuat_team_leader: {
      appId: 'sanxuat', roleId: 'team_leader', scope: { type: 'team' },
      permissions: ['harvest:view', 'harvest:assign', 'harvest:weigh', 'harvest:manage_sections', 'harvest:manage_personnel']
    },
    sanxuat_doi_truong: {
      appId: 'sanxuat', roleId: 'doi_truong', scope: { type: 'team' },
      permissions: ['harvest:view', 'harvest:assign', 'harvest:weigh', 'harvest:manage_sections', 'harvest:manage_personnel']
    },
    sanxuat_staff: {
      appId: 'sanxuat', roleId: 'staff', scope: { type: 'team' },
      permissions: ['harvest:view', 'harvest:assign', 'harvest:weigh']
    },
    sanxuat_viewer: {
      appId: 'sanxuat', roleId: 'viewer', scope: { type: 'team' },
      permissions: ['harvest:view']
    }
  };

  let _user = null;
  let _cache = null;
  let _roleDefs = [];
  let _positionRoles = [];
  let _managedTeamIds = [];

  function getCurrentUser() {
    if (_user) return _user;
    try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch { return null; }
  }

  function parseTs(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val.toDate === 'function') return val.toDate();
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  function isAppPermActive(appData) {
    if (!appData) return false;
    const exp = parseTs(appData.expiresAt) || parseTs(appData.delegatedUntil);
    if (exp && exp < new Date()) return false;
    return (appData.roles && appData.roles.length > 0) ||
      (appData.customPermissions && (appData.customPermissions.granted?.length || appData.customPermissions.denied?.length)) ||
      (appData.scopes && Object.keys(appData.scopes).length > 0);
  }

  function isSuperAdmin(user) {
    user = user || getCurrentUser();
    if (!user) return false;
    if (user.isSuperAdmin === true) return true;
    const roles = user.systemRoles || user.system_roles || [];
    return roles.some(function (r) {
      const n = String(r).toLowerCase().replace(/_/g, '');
      return n === 'superadmin' || n === 'instituteexecutive';
    });
  }

  function isGlobalAdmin(user) {
    user = user || getCurrentUser();
    if (!user) return false;
    if (isSuperAdmin(user)) return true;
    return String(user.role || '').toLowerCase() === 'admin';
  }

  function _normalizeAppEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const roles = Array.isArray(entry.roles)
      ? entry.roles.slice()
      : (entry.role ? [entry.role] : []);
    return {
      roles: roles,
      scopes: entry.scopes || {},
      customPermissions: entry.customPermissions || { granted: [], denied: [] },
      expiresAt: entry.expiresAt,
      delegatedUntil: entry.delegatedUntil
    };
  }

  function _normalizeAppRolesCache(cache) {
    if (!cache || typeof cache !== 'object') return {};
    const out = {};
    Object.keys(cache).forEach(function (appId) {
      const norm = _normalizeAppEntry(cache[appId]);
      if (norm && (norm.roles.length || Object.keys(norm.scopes).length)) {
        out[appId] = norm;
      }
    });
    return out;
  }

  function initFromUserData(profile) {
    _user = profile || getCurrentUser();
    const raw = _user?.appRolesCache || _user?.app_roles_cache || _user?.appPermissions || null;
    _cache = _normalizeAppRolesCache(raw);
  }

  function clearCache() {
    _cache = null;
    _roleDefs = [];
    _positionRoles = [];
    _managedTeamIds = [];
  }

  async function refreshUserProfile(db, userId) {
    userId = userId || getCurrentUser()?.id || getCurrentUser()?.uid;
    if (!userId) return getCurrentUser();

    try {
      if (db && db.collection) {
        const doc = await db.collection('categoryPersonnel').doc(userId).get();
        if (doc.exists) {
          const data = doc.data() || {};
          _user = Object.assign({ id: doc.id, uid: doc.id }, data);
          _cache = _normalizeAppRolesCache(_user.appRolesCache || _user.app_roles_cache || {});
          localStorage.setItem('currentUser', JSON.stringify(_user));
          return _user;
        }
      }
      const username = getCurrentUser()?.username;
      if (username) {
        const res = await fetch('/api/profile?username=' + encodeURIComponent(username));
        if (res.ok) {
          const body = await res.json();
          if (body.profile) {
            _user = Object.assign({ id: body.profile.id || userId }, body.profile);
            _cache = _normalizeAppRolesCache(_user.appRolesCache || _user.app_roles_cache || {});
            localStorage.setItem('currentUser', JSON.stringify(_user));
            return _user;
          }
        }
      }
    } catch (e) {
      console.warn('[Permissions] refreshUserProfile', e.message);
    }
    return getCurrentUser();
  }

  function _normalizeRoleDef(raw) {
    if (!raw) return null;
    const meta = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
    const appId = raw.appId || raw.app_id || meta.app_id || '';
    let roleId = raw.roleId || raw.role_id || meta.role_id || '';
    if (!appId && roleId && String(roleId).includes('_')) {
      const parts = String(roleId).split('_');
      if (parts.length >= 2) {
        roleId = parts.slice(1).join('_');
      }
    }
    const perms = raw.permissions || meta.permissions || [];
    return {
      id: raw.id,
      appId: appId,
      roleId: roleId,
      roleName: raw.roleName || raw.role_name || raw.name || meta.role_name || roleId,
      permissions: Array.isArray(perms) ? perms : [],
      scope: raw.scope || (raw.scope_type || meta.scope_type ? { type: raw.scope_type || meta.scope_type } : {})
    };
  }

  async function loadRoleDefinitions(db) {
    if (_roleDefs.length) return _roleDefs;

    try {
      const res = await fetch('/api/role-definitions?active_only=true');
      if (res.ok) {
        const body = await res.json();
        const roles = (body.roles || []).map(_normalizeRoleDef).filter(function (r) {
          return r && r.appId && r.roleId;
        });
        if (roles.length) {
          _roleDefs = roles;
          return _roleDefs;
        }
      }
    } catch (e) {
      console.warn('[Permissions] loadRoleDefinitions API', e.message);
    }

    try {
      if (db && db.collection) {
        const snap = await db.collection('roleDefinitions').get();
        _roleDefs = snap.docs.map(function (d) {
          return _normalizeRoleDef(Object.assign({ id: d.id }, d.data()));
        }).filter(function (r) { return r && r.appId && r.roleId; });
      }
    } catch (e) {
      console.warn('[Permissions] loadRoleDefinitions Firestore', e.message);
    }

    if (!_roleDefs.length) {
      _roleDefs = Object.keys(DEFAULT_ROLE_DEFS).map(function (k) {
        return DEFAULT_ROLE_DEFS[k];
      });
    }
    return _roleDefs;
  }

  async function loadPositionBasedRoles(db) {
    _positionRoles = [];
    const user = getCurrentUser();
    if (!user || !db?.collection) return [];

    try {
      await loadRoleDefinitions(db);
      const prSnap = await db.collection('positionRoles').get();
      const allPR = prSnap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });

      const userPosIds = new Set();
      if (user.positionId) userPosIds.add(user.positionId);
      (user.assignments || []).forEach(function (a) {
        if (a.positionId) userPosIds.add(a.positionId);
      });

      try {
        const epSnap = await db.collection('employeePositions').where('userId', '==', user.id || user.uid).get();
        epSnap.forEach(function (d) {
          const pid = d.data().positionId;
          if (pid) userPosIds.add(pid);
        });
      } catch (e) { /* optional collection */ }

      _positionRoles = allPR.filter(function (pr) {
        return userPosIds.has(pr.positionId);
      });
    } catch (e) {
      console.warn('[Permissions] loadPositionBasedRoles', e.message);
    }
    return _positionRoles;
  }

  function mergePositionRolesIntoCache() {
    /* merged at read time in getEffectiveAppData */
  }

  function getRoleDef(appId, roleId) {
    const fromDb = _roleDefs.find(function (r) {
      return r.appId === appId && r.roleId === roleId;
    });
    if (fromDb) return fromDb;
    return DEFAULT_ROLE_DEFS[appId + '_' + roleId] || null;
  }

  function getEffectiveAppData(appId) {
    if (!_cache) {
      const u = getCurrentUser();
      const raw = u?.appRolesCache || u?.app_roles_cache;
      if (raw) _cache = _normalizeAppRolesCache(raw);
    }
    const base = (_cache || {})[appId];
    if (!base || !isAppPermActive(base)) {
      return { roles: [], scopes: {}, customPermissions: { granted: [], denied: [] } };
    }

    const merged = {
      roles: Array.isArray(base.roles)
        ? [...base.roles]
        : (base.role ? [base.role] : []),
      scopes: JSON.parse(JSON.stringify(base.scopes || {})),
      customPermissions: {
        granted: [...(base.customPermissions?.granted || [])],
        denied: [...(base.customPermissions?.denied || [])]
      }
    };

    _positionRoles.forEach(function (pr) {
      if (pr.appId !== appId) return;
      const user = getCurrentUser();
      if (pr.departments?.length && !pr.departments.includes('*')) {
        let userDept = user?.departmentId || user?.department;
        if (!userDept && user?.assignments?.length) {
          const primary = user.assignments.find(function (a) { return a.isPrimary; }) || user.assignments[0];
          userDept = primary?.departmentId;
        }
        if (userDept && !pr.departments.includes(userDept)) return;
      }
      (pr.roles || []).forEach(function (r) {
        if (!merged.roles.includes(r)) merged.roles.push(r);
      });
      if (pr.departments?.length) {
        merged.scopes.departments = merged.scopes.departments || [];
        pr.departments.forEach(function (d) {
          if (!merged.scopes.departments.includes(d)) merged.scopes.departments.push(d);
        });
      }
    });

    return merged;
  }

  function getAppRoles(appId) {
    return getEffectiveAppData(appId).roles || [];
  }

  function getAppScopes(appId) {
    return getEffectiveAppData(appId).scopes || {};
  }

  function hasAnyAppRole(appId, roleIds) {
    if (isGlobalAdmin()) return true;
    const roles = getAppRoles(appId);
    return roleIds.some(function (r) { return roles.includes(r); });
  }

  function permissionMatches(granted, required) {
    if (!granted || !required) return false;
    if (granted === required) return true;
    if (granted.endsWith(':*')) {
      return required.indexOf(granted.slice(0, -1)) === 0;
    }
    return false;
  }

  function collectRolePermissions(appId, roles) {
    const set = new Set();
    roles.forEach(function (roleId) {
      const def = getRoleDef(appId, roleId);
      (def?.permissions || []).forEach(function (p) { set.add(p); });
    });
    return set;
  }

  function hasPermission(appId, permission) {
    if (isGlobalAdmin()) return true;
    const appData = getEffectiveAppData(appId);
    const rolePerms = collectRolePermissions(appId, appData.roles || []);
    for (const p of rolePerms) {
      if (permissionMatches(p, permission)) return true;
    }
    return false;
  }

  function hasPermissionWithOverrides(appId, permission) {
    if (isGlobalAdmin()) return true;
    const appData = getEffectiveAppData(appId);
    const denied = appData.customPermissions?.denied || [];
    if (denied.some(function (p) { return permissionMatches(p, permission); })) return false;

    if (hasPermission(appId, permission)) return true;

    const granted = appData.customPermissions?.granted || [];
    return granted.some(function (p) { return permissionMatches(p, permission); });
  }

  async function loadManagedTeamIds(db, userId) {
    userId = userId || getCurrentUser()?.id || getCurrentUser()?.uid;
    if (!userId || !db?.collection) return [];
    try {
      const snap = await db.collection('categoryTeams').where('managerId', '==', userId).get();
      _managedTeamIds = snap.docs.map(function (d) { return String(d.id); });
    } catch (e) {
      console.warn('[Permissions] loadManagedTeamIds', e.message);
      _managedTeamIds = [];
    }
    return _managedTeamIds;
  }

  /**
   * Phạm vi đội SX cho tab phân công / cân mủ.
   * @returns {{ mode: 'all'|'teams'|'departments', teamIds: string[], departmentIds: string[], locked: boolean, label: string }}
   */
  async function resolveTeamScope(appId, db) {
    if (isGlobalAdmin()) {
      return { mode: 'all', teamIds: [], departmentIds: [], locked: false, label: 'Quản trị — mọi đội' };
    }

    const appData = getEffectiveAppData(appId);
    const roles = appData.roles || [];
    const scopes = appData.scopes || {};

    if ((scopes.teams || []).includes('*')) {
      return { mode: 'all', teamIds: [], departmentIds: [], locked: false, label: 'Mọi đội SX' };
    }

    if (hasPermission(appId, 'field:all_teams') || hasPermission(appId, 'harvest:*') || hasPermission(appId, 'field:*')) {
      return { mode: 'all', teamIds: [], departmentIds: [], locked: false, label: 'BGD / quản lý — mọi đội' };
    }

    if (roles.some(function (r) { return BROAD_SANXUAT_ROLES.indexOf(r) >= 0; })) {
      const depts = scopes.departments || [];
      if (!depts.length || depts.includes('*')) {
        return { mode: 'all', teamIds: [], departmentIds: [], locked: false, label: 'Quản lý — mọi đội' };
      }
      return {
        mode: 'departments',
        teamIds: [],
        departmentIds: depts,
        locked: false,
        label: 'Theo phòng ban được gán'
      };
    }

    const teamIds = new Set();
    (scopes.teams || []).forEach(function (t) { if (t && t !== '*') teamIds.add(String(t)); });

    const hasTeamRole = roles.some(function (r) { return TEAM_SCOPED_ROLES.indexOf(r) >= 0; });
    if (hasTeamRole || teamIds.size > 0) {
      await loadManagedTeamIds(db);
      _managedTeamIds.forEach(function (t) { teamIds.add(t); });

      if (!teamIds.size) {
        return {
          mode: 'teams',
          teamIds: [],
          departmentIds: [],
          locked: true,
          label: 'Chưa gán đội — liên hệ Phân quyền'
        };
      }
      return {
        mode: 'teams',
        teamIds: Array.from(teamIds),
        departmentIds: [],
        locked: teamIds.size === 1,
        label: teamIds.size === 1 ? 'Đội được phép' : teamIds.size + ' đội được phép'
      };
    }

    await loadManagedTeamIds(db);
    if (_managedTeamIds.length) {
      return {
        mode: 'teams',
        teamIds: _managedTeamIds.slice(),
        departmentIds: [],
        locked: _managedTeamIds.length === 1,
        label: 'Đội trưởng (theo hồ sơ tổ)'
      };
    }

    if (!roles.length && !isAppPermActive((_cache || {})[appId])) {
      return { mode: 'all', teamIds: [], departmentIds: [], locked: false, label: '' };
    }

    return {
      mode: 'teams',
      teamIds: [],
      departmentIds: [],
      locked: true,
      label: 'Không có quyền đội — liên hệ Phân quyền'
    };
  }

  function todayDateStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function _normalizeIsoDate(dateStr) {
    if (!dateStr) return '';
    const s = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = parseTs(s);
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  /** Chỉ admin SX (hoặc quản trị hệ thống) được sửa dữ liệu ngày trước. */
  function isSanxuatAdmin(user) {
    user = user || getCurrentUser();
    if (isSuperAdmin(user)) return true;
    // Chỉ role admin trong app Sản xuất — không dùng user.role legacy 'admin'
    return (getAppRoles(APP_IDS.SANXUAT) || []).includes('admin');
  }

  /**
   * Người nhập / quản lý / đội trưởng chỉ ghi trong ngày hiện tại.
   * Admin SX được ghi mọi ngày.
   */
  function canWriteSanxuatDate(dateStr, user) {
    user = user || getCurrentUser();
    const iso = _normalizeIsoDate(dateStr);
    if (!iso) return false;
    if (isSanxuatAdmin(user)) return true;
    return iso === todayDateStr();
  }

  function sanxuatDateWriteMessage(dateStr) {
    const iso = _normalizeIsoDate(dateStr) || dateStr || '—';
    return 'Chỉ được nhập/sửa dữ liệu ngày ' + todayDateStr() +
      '. Ngày ' + iso + ' chỉ admin mới được chỉnh (bảo vệ dữ liệu cũ).';
  }

  function canWriteFieldHarvest() {
    return hasPermissionWithOverrides('sanxuat', 'harvest:assign') ||
      hasPermissionWithOverrides('sanxuat', 'harvest:weigh') ||
      hasPermissionWithOverrides('sanxuat', 'harvest:*');
  }

  /** Quản trị nhân sự theo trạm SX (tab Quản trị → Nhân sự). */
  function canManageStationPersonnel() {
    if (isGlobalAdmin()) return true;
    return hasPermissionWithOverrides('sanxuat', 'harvest:manage_personnel') ||
      hasPermissionWithOverrides('sanxuat', 'harvest:*');
  }

  async function loadAppPermissions() {
    try {
      return await CRUDService.load('appPermissions', { cache: true });
    } catch {
      return [];
    }
  }

  async function apiCall(endpoint, data = {}) {
    const res = await fetch(`${Config.API.functionsUrl}/${encodeURIComponent(endpoint)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`API ${endpoint}: HTTP ${res.status}`);
    return res.json();
  }

  function canAccessApp(appId, user) {
    user = user || getCurrentUser();
    if (!user) return false;
    if (isGlobalAdmin(user)) return true;
    const allowed = user.allowedApps || user.appPermissions;
    if (Array.isArray(allowed)) return allowed.includes(appId);
    const appData = (_cache || user.appRolesCache || {})[appId];
    return isAppPermActive(appData) || true;
  }

  function hasRole(required, user) {
    user = user || getCurrentUser();
    if (!user) return false;
    if (isGlobalAdmin(user)) return true;
    return (user.role || 'user') === required;
  }

  return {
    APP_IDS,
    getCurrentUser,
    isAdmin: isGlobalAdmin,
    isGlobalAdmin,
    isSuperAdmin,
    canAccessApp,
    hasRole,
    initFromUserData,
    clearCache,
    refreshUserProfile,
    loadRoleDefinitions,
    loadPositionBasedRoles,
    mergePositionRolesIntoCache,
    getAppRoles,
    getAppScopes,
    hasAnyAppRole,
    hasPermission,
    hasPermissionWithOverrides,
    resolveTeamScope,
    todayDateStr,
    isSanxuatAdmin,
    canWriteSanxuatDate,
    sanxuatDateWriteMessage,
    canWriteFieldHarvest,
    canManageStationPersonnel,
    isAppPermActive,
    loadManagedTeamIds,
    loadAppPermissions,
    apiCall
  };
})();
