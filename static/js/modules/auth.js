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
      displayName: user.name || user.hoTen || user.username || id
    };
  }

  function storeSession(user, profile) {
    currentUser = _normalizeUser(user);
    userProfile = profile || currentUser;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user: currentUser, profile: userProfile, loginAt: Date.now() }));
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    localStorage.setItem('qtdn_user', JSON.stringify(currentUser));
    if (userProfile) localStorage.setItem(PROFILE_KEY, JSON.stringify(userProfile));
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
        if (s.user && s.loginAt && Date.now() - s.loginAt <= SESSION_TIMEOUT) {
          currentUser = _normalizeUser(s.user);
          userProfile = s.profile ? _normalizeUser(s.profile) : currentUser;
          return currentUser;
        }
        clearStoredSession();
        return null;
      }
      const cu = localStorage.getItem('currentUser');
      if (cu) {
        currentUser = _normalizeUser(JSON.parse(cu));
        userProfile = currentUser;
        return currentUser;
      }
    } catch (e) {
      console.warn('[Auth] restoreSession', e);
    }
    return null;
  }

  async function loadUserProfile(username) {
    try {
      const res = await fetch(`/api/profile?username=${encodeURIComponent(username)}`);
      if (!res.ok) return null;
      const body = await res.json();
      if (body.profile) {
        userProfile = _normalizeUser(body.profile);
        if (currentUser) storeSession(currentUser, userProfile);
      }
      return userProfile;
    } catch {
      return null;
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
    storeSession(result.user, null);
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
    storeSession(result.user, null);
    await loadUserProfile(result.user.username);
    _notify('login');
    return { success: true, user: currentUser, profile: userProfile };
  }

  function logout() {
    clearStoredSession();
    _notify('logout');
    window.location.href = '/';
  }

  async function init() {
    const u = restoreSession();
    if (u) {
      if (typeof Permissions !== 'undefined' && userProfile) {
        try { Permissions.initFromUserData?.(userProfile); } catch (_) { /* ignore */ }
      }
      _notify('login');
    }
    return u;
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
    init, login, loginWithOtp, logout, restoreSession, loadUserProfile,
    getUser, getProfile, isLoggedIn, isAuthenticated, isAdmin, hasRole, hasMinRole,
    onAuthStateChange, clearStoredSession,
    get currentUser() { return currentUser; },
    get userProfile() { return userProfile; }
  };
})();
