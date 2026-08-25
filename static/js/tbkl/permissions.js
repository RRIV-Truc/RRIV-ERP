/* permissions.js — TBKL RBAC */
(function () {
  'use strict';

  var APP_ID = 'tbkl';

  function getUser() {
    if (typeof Permissions !== 'undefined' && Permissions.getCurrentUser) {
      return Permissions.getCurrentUser();
    }
    try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (_) { return null; }
  }

  function isGlobalAdmin(user) {
    user = user || getUser();
    if (!user) return false;
    if (typeof Permissions !== 'undefined' && Permissions.isGlobalAdmin) {
      return Permissions.isGlobalAdmin(user);
    }
    return user.role === 'admin' || user.isSuperAdmin === true;
  }

  function canAccessApp(user) {
    user = user || getUser();
    if (isGlobalAdmin(user)) return true;
    if (typeof Permissions !== 'undefined' && Permissions.canAccessApp) {
      return Permissions.canAccessApp(APP_ID, user);
    }
    var cache = user && (user.appRolesCache || user.app_roles_cache);
    var entry = cache && cache[APP_ID];
    return !!(entry && entry.roles && entry.roles.length);
  }

  function hasPerm(perm, user) {
    user = user || getUser();
    if (isGlobalAdmin(user)) return true;
    if (typeof Permissions !== 'undefined' && Permissions.hasPermission) {
      if (Permissions.hasPermission(APP_ID, perm)) return true;
      if (Permissions.hasPermission(APP_ID, 'tbkl:*')) return true;
    }
    return false;
  }

  window.TbklPermissions = {
    APP_ID: APP_ID,
    getUser: getUser,
    canAccessApp: canAccessApp,
    canManage: function (u) { return hasPerm('tbkl:manage', u) || hasPerm('tbkl:*', u); },
    canReport: function (u) { return hasPerm('tbkl:report', u) || hasPerm('tbkl:manage', u); },
    canLock: function (u) { return hasPerm('tbkl:lock', u) || hasPerm('tbkl:manage', u); }
  };
})();
