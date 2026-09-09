/**
 * Hub RRIV — khôi phúc phiên + ẩn app theo config (tránh stale cache / bfcache).
 */
const RrivHub = (function () {
  'use strict';

  let currentUser = null;

  function applyHubAppLocks() {
    document.querySelectorAll('.vrg-app-card[data-app]').forEach(function (card) {
      var appId = card.dataset.app;
      var enabled = typeof Config !== 'undefined' && Config.isHubAppEnabled(appId);
      card.classList.toggle('hub-app-locked', !enabled);
    });
  }

  function userDisplayName(user) {
    if (!user) return 'User';
    return user.name || user.displayName || user.hoTen || user.username || 'User';
  }

  function showDashboard(user) {
    currentUser = user || currentUser;
    var authEl = document.getElementById('authContainer');
    var footer = document.getElementById('footerCopyright');
    var dash = document.getElementById('dashboardScreen');
    var login = document.getElementById('loginScreen');
    var otp = document.getElementById('otpScreen');
    var loading = document.getElementById('loadingScreen');

    if (loading) loading.style.display = 'none';
    if (login) login.style.display = 'none';
    if (otp) otp.style.display = 'none';
    if (authEl) authEl.style.display = 'none';
    if (footer) footer.style.display = 'none';

    var welcome = document.getElementById('welcomeUser');
    if (welcome && currentUser) welcome.textContent = userDisplayName(currentUser);
    if (dash) dash.style.display = 'block';

    applyHubAppLocks();
    refreshSpmUnread();

    if (typeof RrivAdminBackup !== 'undefined') {
      RrivAdminBackup.init(currentUser);
    }

    if (typeof RrivPWA !== 'undefined') RrivPWA.showInstallBanner();
  }

  function showLogin() {
    currentUser = null;
    var authEl = document.getElementById('authContainer');
    var dash = document.getElementById('dashboardScreen');
    var login = document.getElementById('loginScreen');

    if (dash) dash.style.display = 'none';
    if (authEl) authEl.style.display = '';
    if (login) login.style.display = 'block';
    applyHubAppLocks();
  }

  function tryRestoreSession() {
    if (typeof Auth === 'undefined' || typeof Auth.restoreSession !== 'function') return null;
    var restored = Auth.restoreSession();
    if (restored) {
      showDashboard(restored);
      return restored;
    }
    showLogin();
    return null;
  }

  function setCurrentUser(user) {
    currentUser = user;
    if (typeof Auth !== 'undefined' && typeof Auth.syncSession === 'function') {
      var profile = (typeof Auth.getProfile === 'function') ? Auth.getProfile() : null;
      Auth.syncSession(user, profile);
      currentUser = Auth.getUser() || user;
    } else {
      localStorage.setItem('userSession', JSON.stringify({ user: user, profile: user, loginAt: Date.now() }));
      localStorage.setItem('currentUser', JSON.stringify(user));
      localStorage.setItem('qtdn_user', JSON.stringify(user));
    }
  }

  function init() {
    applyHubAppLocks();
    if (redirectIfReturnUrl()) return;
    tryRestoreSession();
    if (redirectIfReturnUrl()) return;
  }

  function getSafeReturnUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      var ret = params.get('return');
      if (!ret || !ret.startsWith('/') || ret.startsWith('//')) return null;
      return ret;
    } catch (_) {
      return null;
    }
  }

  function redirectIfReturnUrl() {
    var ret = getSafeReturnUrl();
    if (!ret) return false;
    var loggedIn = (typeof Auth !== 'undefined' && Auth.isLoggedIn && Auth.isLoggedIn())
      || !!currentUser
      || !!(typeof Auth !== 'undefined' && Auth.restoreSession && Auth.restoreSession());
    if (loggedIn) {
      window.location.replace(ret);
      return true;
    }
    showJoinLoginHint(ret);
    return false;
  }

  function showJoinLoginHint(returnPath) {
    if (!returnPath || returnPath.indexOf('phonghop/join') < 0) return;
    var login = document.getElementById('loginScreen');
    if (!login) return;
    var hint = document.getElementById('loginReturnHint');
    if (!hint) {
      hint = document.createElement('p');
      hint.id = 'loginReturnHint';
      hint.className = 'login-return-hint';
      hint.textContent = 'Đăng nhập tài khoản Viện để tham gia cuộc họp qua link/QR.';
      var form = document.getElementById('loginForm');
      if (form && form.parentNode) form.parentNode.insertBefore(hint, form);
    }
    hint.style.display = 'block';
  }

  function onPageShow(event) {
    applyHubAppLocks();
    if (event && event.persisted) {
      tryRestoreSession();
    }
  }

  function getCurrentUser() {
    return currentUser;
  }

  function hubUsername() {
    try {
      var u = currentUser || (typeof Auth !== 'undefined' && Auth.getUser && Auth.getUser()) || {};
      return String(u.username || u.userName || '').toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function applyAppBadge(n) {
    try {
      if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n);
      else if (navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (_) {}
  }

  function ensureSpmBadgeEl() {
    var card = document.querySelector('.vrg-app-card[data-app="spmgv"]');
    if (!card) return null;
    var badge = document.getElementById('spmgvUnread');
    if (badge) return badge;
    badge = document.createElement('span');
    badge.id = 'spmgvUnread';
    badge.className = 'vrg-hub-unread';
    badge.hidden = true;
    badge.setAttribute('aria-label', 'Viec moi');
    card.appendChild(badge);
    return badge;
  }

  function setSpmBadge(n) {
    var badge = ensureSpmBadgeEl();
    if (!badge) return;
    if (n > 0) {
      badge.hidden = false;
      badge.textContent = n > 99 ? '99+' : String(n);
    } else {
      badge.hidden = true;
      badge.textContent = '';
    }
    applyAppBadge(n);
  }

  function refreshSpmUnread() {
    var name = hubUsername();
    if (!name) {
      setSpmBadge(0);
      return;
    }
    var since = '';
    try { since = localStorage.getItem('spm_gv_seen_' + name) || ''; } catch (_) {}
    var url = '/api/spm-gv/unread?username=' + encodeURIComponent(name);
    if (since) url += '&since=' + encodeURIComponent(since);
    fetch(url, { headers: { 'X-RRIV-Username': name } })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (pack) {
        if (!pack.ok) { setSpmBadge(0); return; }
        setSpmBadge(Number((pack.body && pack.body.count) || 0));
      })
      .catch(function () { setSpmBadge(0); });
  }

  if (!refreshSpmUnread._timer) {
    refreshSpmUnread._timer = setInterval(function () {
      var dash = document.getElementById('dashboardScreen');
      if (dash && dash.style.display === 'block') refreshSpmUnread();
    }, 90000);
  }

  return {
    init,
    applyHubAppLocks,
    showDashboard,
    showLogin,
    tryRestoreSession,
    setCurrentUser,
    getCurrentUser,
    getSafeReturnUrl,
    redirectIfReturnUrl,
    onPageShow,
    userDisplayName,
    refreshSpmUnread
  };
})();
