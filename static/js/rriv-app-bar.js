/**
 * Thanh "Quay về trang chủ" — tự gắn vào mọi mini-app (/app/*)
 */
(function () {
  'use strict';

  function goBackHome() {
    window.location.href = '/';
  }

  window.goBackHome = goBackHome;
  if (!window.goBack) window.goBack = goBackHome;

  function getUser() {
    if (typeof Auth !== 'undefined') {
      if (typeof Auth.restoreSession === 'function') Auth.restoreSession();
      if (typeof Auth.getUser === 'function') return Auth.getUser();
    }
    try {
      return JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch {
      return null;
    }
  }

  function esc(text) {
    const el = document.createElement('span');
    el.textContent = text == null ? '' : String(text);
    return el.innerHTML;
  }

  function userLabel(user) {
    if (!user) return 'Đang tải...';
    return user.name || user.hoTen || user.username || 'User';
  }

  function buildBar() {
    const user = getUser();
    const name = userLabel(user);
    const initial = name.charAt(0).toUpperCase();
    const position = user && (user.position || user.chucVu || user.chuc_vu);
    const department = user && (user.department || user.phongBan || user.phong_ban);

    const bar = document.createElement('div');
    bar.id = 'rrivGlobalHomeBar';
    bar.className = 'rriv-global-home-bar';
    bar.innerHTML =
      '<div class="rriv-ghb-avatar" id="rrivGhbAvatar">' + esc(initial) + '</div>' +
      '<div class="rriv-ghb-details">' +
      '<span class="rriv-ghb-name" id="rrivGhbName">' + esc(name) + '</span>' +
      '<span class="rriv-ghb-meta" id="rrivGhbPosition">' + esc(position || '--') + '</span>' +
      '<span class="rriv-ghb-meta" id="rrivGhbDepartment">' + esc(department || '--') + '</span>' +
      '</div>' +
      '<button type="button" class="rriv-ghb-btn" id="rrivGhbBtn">Quay về trang chủ</button>';

    bar.querySelector('#rrivGhbBtn').addEventListener('click', goBackHome);
    return bar;
  }

  function wireHomeControl(el) {
    el.classList.add('rriv-ghb-styled');
    if (el.tagName === 'A') {
      el.setAttribute('href', '/');
      el.addEventListener('click', function (e) {
        e.preventDefault();
        goBackHome();
      });
    } else {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        goBackHome();
      });
    }
  }

  function upgradeDoanhnghiepHeader() {
    const btn = document.querySelector('.user-info .btn-home');
    if (!btn) return false;
    wireHomeControl(btn);
    return true;
  }

  function hideLegacyHomeButtons() {
    document.querySelectorAll('header button, header a, .app-header button, .app-header a, #app-screen > nav button, #app-screen > nav a').forEach(function (el) {
      if (el.closest('#rrivGlobalHomeBar')) return;
      const text = (el.textContent || '').trim();
      if (el.classList.contains('back-btn') || /^←$|^🏠$/.test(text) || /quay về trang chủ/i.test(text)) {
        el.style.display = 'none';
      }
    });
  }

  function findHeaderHost() {
    const selectors = [
      'header .user-info',
      'header.app-header',
      '.app-header',
      'header',
      '#app-screen > nav .container > div:last-child',
      '#app-screen > nav'
    ];
    for (let i = 0; i < selectors.length; i++) {
      const el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function mount() {
    if (!/^\/app\//.test(window.location.pathname)) return;
    if (document.getElementById('rrivGlobalHomeBar')) return;

    if (upgradeDoanhnghiepHeader()) return;

    const bar = buildBar();
    const host = findHeaderHost();

    if (host) {
      host.appendChild(bar);
      hideLegacyHomeButtons();
      return;
    }

    bar.classList.add('rriv-global-home-bar--fixed');
    document.body.appendChild(bar);
    hideLegacyHomeButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
