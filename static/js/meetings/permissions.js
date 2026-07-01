/* permissions.js — phonghop RBAC (wrap Permissions global) */
(function () {
  'use strict';

  var APP_ID = 'phonghop';
  var MANAGER_ROLES = ['admin', 'manager'];

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

  function canCreateMeeting(user) {
    user = user || getUser();
    if (isGlobalAdmin(user)) return true;
    if (typeof Permissions !== 'undefined' && Permissions.hasPermission) {
      if (Permissions.hasPermission(APP_ID, 'meeting:create')) return true;
      if (Permissions.hasPermission(APP_ID, 'meeting:*')) return true;
    }
    var roles = (typeof Permissions !== 'undefined' && Permissions.getAppRoles)
      ? Permissions.getAppRoles(APP_ID) : [];
    return roles.some(function (r) { return MANAGER_ROLES.indexOf(r) >= 0; });
  }

  function canViewMeeting(user) {
    user = user || getUser();
    if (isGlobalAdmin(user)) return true;
    if (typeof Permissions !== 'undefined' && Permissions.hasPermission) {
      return Permissions.hasPermission(APP_ID, 'meeting:view') ||
        Permissions.hasPermission(APP_ID, 'meeting:*');
    }
    return canAccessApp(user);
  }

  function canDeleteMeeting(user) {
    return canCreateMeeting(user);
  }

  window.PhonghopPerms = {
    APP_ID: APP_ID,
    getUser: getUser,
    canAccessApp: canAccessApp,
    canCreateMeeting: canCreateMeeting,
    canDeleteMeeting: canDeleteMeeting,
    canViewMeeting: canViewMeeting,
    isGlobalAdmin: isGlobalAdmin
  };
})();
