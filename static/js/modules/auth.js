/**
 * Auth RRIV — phiên đăng nhập Flask + Supabase (không Firebase)
 */
const Auth = (function () {
  'use strict';

  const SESSION_KEY = 'userSession';
  const PROFILE_KEY = 'userProfile';
  const SESSION_TIMEOUT = 8 * 60 * 60 * 1000;

  let currentUser = null;
  let userProfile = null;
  let authListeners = [];

  function _normalizeUser(user) {
    if (!user) return null;
    const id = user.id || user.uid || user.username;
    return {
      ...user,
      id,
      uid: id,
      email: user.email || (user.username ? `${user.username}@rriv.org.vn` : ''),
      displayName: user.name || user.hoTen || user.full_name || user.username || id
    };
  }

  /** Gộp hồ sơ employee vào user hiển thị (header, hub). */
  function mergeDisplayFields(user, profile) {
    if (!user) return profile ? _normalizeUser(profile) : null;
    if (!profile) return _normalizeUser(user);
    const dept = profile.department_name || profile.departmentName || profile.department
      || user.department_name || user.departmentName || user.department || '';
    const pos = profile.position_name || profile.positionName || profile.position
      || user.position_name || user.positionName || user.position || '';
    return _normalizeUser({
      ...user,
      ...profile,
      hoTen: profile.hoTen || profile.full_name || profile.name || user.hoTen || user.name,
      name: profile.hoTen || profile.full_name || profile.name || user.name,
      department: dept,
      department_name: profile.department_name || profile.departmentName || dept,
      departmentName: profile.departmentName || profile.department_name || dept,
      position_name: pos,
      positionName: profile.positionName || profile.position_name || pos,
      position: profile.position || profile.position_name || profile.positionName || pos,
      assignments: profile.assignments || user.assignments,
      employeeCode: profile.employeeCode || profile.employee_code || user.employeeCode
    });
  }

  function storeSession(user, profile) {
    const prof = profile || userProfile;
    userProfile = prof ? _normalizeUser(prof) : null;
    currentUser = mergeDisplayFields(user, userProfile);
    if (!userProfile) userProfile = currentUser;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user: currentUser, profile: userProfile, loginAt: Date.now() }));
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    localStorage.setItem('qtdn_user', JSON.stringify(currentUser));
    if (userProfile) localStorage.setItem(PROFILE_KEY, JSON.stringify(userProfile));
    if (typeof window !== 'undefined') window.currentUser = currentUser;
    try {
      window.dispatchEvent(new CustomEvent('rriv:user-updated', { detail: currentUser }));
    } catch (_) { /* ignore */ }
  }

  function clearStoredSession() {
    currentUser = null;
    userProfile = null;
    ['userSession', 'currentUser', 'qtdn_user', 'userProfile', 'userRole', 'userDept'].forEach((k) => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
  }

  function restoreSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.user) {
          const age = s.loginAt ? Date.now() - s.loginAt : 0;
          if (!s.loginAt || age <= SESSION_TIMEOUT) {
            currentUser = _normalizeUser(s.user);
            userProfile = s.profile ? _normalizeUser(s.profile) : null;
            currentUser = mergeDisplayFields(currentUser, userProfile);
            if (!userProfile) userProfile = currentUser;
            if (typeof window !== 'undefined') window.currentUser = currentUser;
            if (!s.loginAt) persistSession();
            return currentUser;
          }
        }
      }
      const cu = localStorage.getItem('currentUser');
      if (cu) {
        currentUser = _normalizeUser(JSON.parse(cu));
        try {
          const pr = localStorage.getItem(PROFILE_KEY);
          userProfile = pr ? _normalizeUser(JSON.parse(pr)) : null;
        } catch (_) { userProfile = null; }
        currentUser = mergeDisplayFields(currentUser, userProfile);
        if (!userProfile) userProfile = currentUser;
        if (typeof window !== 'undefined') window.currentUser = currentUser;
        persistSession();
        return currentUser;
      }
    } catch (e) {
      console.warn('[Auth] restoreSession', e);
    }
    clearStoredSession();
    return null;
  }

  async function loadUserProfile(username) {
    username = String(username || currentUser?.username || '').trim().toLowerCase();
    if (!username) return userProfile;
    try {
      const res = await fetch(`/api/profile?username=${encodeURIComponent(username)}`);
      if (!res.ok) return userProfile;
      const body = await res.json();
      if (body.profile) {
        userProfile = _normalizeUser(body.profile);
        const base = currentUser || restoreSession() || { username };
        storeSession(base, userProfile);
      }
      return userProfile;
    } catch {
      return userProfile;
    }
  }

  async function login(username, password) {
    const res = await fetch('/api/login-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      return { success: false, error: result.message || 'Đăng nhập thất bại' };
    }
    storeSession(result.user, result.user);
    await loadUserProfile(result.user.username);
    _notify('login');
    return { success: true, user: currentUser, profile: userProfile };
  }

  async function loginWithOtp(username, otpCode) {
    const res = await fetch('/api/verify-login-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, otpCode })
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      return { success: false, error: result.message || 'OTP không hợp lệ' };
    }
    storeSession(result.user, result.user);
    await loadUserProfile(result.user.username);
    _notify('login');
    return { success: true, user: currentUser, profile: userProfile };
  }

  function persistSession() {
    if (currentUser) storeSession(currentUser, userProfile);
  }

  /** Hub / OTP gọi trực tiếp — giữ profile đã load, không ghi đè bằng user thiếu chức vụ. */
  function syncSession(user, profile) {
    const prof = profile || userProfile;
    storeSession(user, prof || user);
  }

  function goHome() {
    persistSession();
    window.location.href = '/';
  }

  function logout() {
    clearStoredSession();
    _notify('logout');
    window.location.href = '/';
  }

  async function init() {
    const u = restoreSession();
    if (u) {
      const hasPos = userProfile?.position_name || userProfile?.positionName || userProfile?.position
        || u.position_name || u.positionName || u.position;
      if (u.username) {
        if (!hasPos) await loadUserProfile(u.username);
        else if (!userProfile) await loadUserProfile(u.username);
      }
      if (typeof Permissions !== 'undefined' && userProfile) {
        try { Permissions.initFromUserData?.(userProfile); } catch (_) { /* ignore */ }
      }
      _notify('login');
    }
    return currentUser || u;
  }

  function _notify(type) {
    authListeners.forEach((fn) => {
      try { fn(type === 'login' ? currentUser : null); } catch (_) { /* ignore */ }
    });
  }

  function onAuthStateChange(cb) {
    authListeners.push(cb);
    setTimeout(() => cb(currentUser), 0);
    return () => { authListeners = authListeners.filter((f) => f !== cb); };
  }

  function isLoggedIn() { return !!currentUser || !!restoreSession(); }
  function getUser() { return currentUser; }
  function getProfile() { return userProfile; }
  function isAuthenticated() { return isLoggedIn(); }
  function isAdmin() { return (currentUser?.role || '').toLowerCase() === 'admin'; }
  function hasRole(role) { return isAdmin() || (currentUser?.role || '') === role; }
  function hasMinRole() { return isLoggedIn(); }

  return {
    init, login, loginWithOtp, logout, goHome, persistSession, syncSession, restoreSession, loadUserProfile,
    mergeDisplayFields,
    getUser, getProfile, isLoggedIn, isAuthenticated, isAdmin, hasRole, hasMinRole,
    onAuthStateChange, clearStoredSession,
    get currentUser() { return currentUser; },
    get userProfile() { return userProfile; }
  };
})();
