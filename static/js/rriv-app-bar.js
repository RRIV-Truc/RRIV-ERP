/**
 * Thanh "Quay về trang chủ" — tự gắn vào mọi mini-app (/app/*)
 */
(function () {
  'use strict';

  var POSITION_ID_LABELS = {
    'pos-giam-doc': 'Giám đốc',
    'pos-pho-giam-doc': 'Phó giám đốc',
    'pos-truong-phong': 'Trường phòng',
    'pos-pho-phong': 'Phó phòng',
    'pos-phu-trach': 'Phụ trách bộ phận',
    'pos-nhan-vien': 'Nhân viên'
  };

  var SYSTEM_ROLE_POSITION = {
    Super_Admin: 'Quản trị viên',
    Institute_Executive: 'Ban Lãnh đạo Viện',
    Department_Head: 'Lãnh đạo đơn vị',
    Operations_Specialist: 'Chuyên viên Nghiệp vụ',
    Technical_Staff: 'NCV / KTV',
    Staff_Viewer: 'Nhân viên'
  };

  function goBackHome() {
    if (typeof Auth !== 'undefined' && typeof Auth.goHome === 'function') {
      Auth.goHome();
      return;
    }
    if (typeof Auth !== 'undefined' && typeof Auth.persistSession === 'function') {
      Auth.persistSession();
    }
    window.location.href = '/';
  }

  window.goBackHome = goBackHome;
  if (!window.goBack) window.goBack = goBackHome;

  function getUser() {
    var user = null;
    var profile = null;
    if (typeof Auth !== 'undefined') {
      if (typeof Auth.getProfile === 'function') profile = Auth.getProfile();
      if (typeof Auth.getUser === 'function') user = Auth.getUser();
      if (typeof Auth.restoreSession === 'function' && !user) user = Auth.restoreSession();
      if (typeof Auth.mergeDisplayFields === 'function' && (user || profile)) {
        return Auth.mergeDisplayFields(user, profile);
      }
      if (profile) return profile;
      if (user) return user;
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
    return user.hoTen || user.full_name || user.name || user.displayName || user.username || 'User';
  }

  function resolveDepartment(user) {
    if (!user) return '';
    var d = user.department_name || user.departmentName || user.phongBan || user.phong_ban;
    if (d) return d;
    d = user.department || user.department_id || user.departmentId || '';
    if (!d) {
      var assignments = user.assignments || [];
      var primary = assignments.find(function (a) { return a.isPrimary; }) || assignments[0];
      if (primary && primary.departmentName) return primary.departmentName;
    }
    return d;
  }

  function resolvePosition(user) {
    if (!user) return '';

    var name = user.position_name || user.positionName || user.position
      || user.chucVu || user.chuc_vu;
    if (name && String(name).trim()) return String(name).trim();

    var assignments = user.assignments || [];
    var primary = assignments.find(function (a) { return a.isPrimary; }) || assignments[0];
    if (primary && primary.positionName) return primary.positionName;

    var posId = user.position || user.position_id || user.positionId || '';
    if (posId && POSITION_ID_LABELS[posId]) return POSITION_ID_LABELS[posId];
    if (posId && !/^pos-/i.test(String(posId))) return String(posId);

    if (user.role === 'admin' || user.isSuperAdmin) return 'Quản trị viên';

    var sysRoles = user.systemRoles || user.system_roles || [];
    for (var i = 0; i < sysRoles.length; i++) {
      var label = SYSTEM_ROLE_POSITION[sysRoles[i]];
      if (label) return label;
    }

    if (user.role === 'vpp') return 'Quản lý';
    return '';
  }

  function roleSuffix(user) {
    if (!user) return '';
    if (typeof Permissions !== 'undefined' && Permissions.isGlobalAdmin && Permissions.isGlobalAdmin(user)) {
      return 'Admin';
    }
    if (user.role === 'admin' || user.isSuperAdmin) return 'Admin';
    if (user.role === 'vpp') return 'Quản lý';
    return '';
  }

  function fillBar(bar, user) {
    if (!bar) return;
    var name = userLabel(user);
    var initial = (name.trim()[0] || 'U').toUpperCase();
    var position = resolvePosition(user);
    var department = resolveDepartment(user);
    var suffix = roleSuffix(user);

    var avatar = bar.querySelector('#rrivGhbAvatar');
    var nameEl = bar.querySelector('#rrivGhbName');
    var posEl = bar.querySelector('#rrivGhbPosition');
    var deptEl = bar.querySelector('#rrivGhbDepartment');

    if (avatar) avatar.textContent = initial;
    if (nameEl) {
      nameEl.textContent = suffix ? (name + ' · ' + suffix) : name;
    }
    if (posEl) posEl.textContent = position || '--';
    if (deptEl) deptEl.textContent = department || '--';
  }

  function buildBar(user) {
    user = user || getUser();
    const bar = document.createElement('div');
    bar.id = 'rrivGlobalHomeBar';
    bar.className = 'rriv-global-home-bar';
    bar.innerHTML =
      '<div class="rriv-ghb-avatar" id="rrivGhbAvatar">?</div>' +
      '<div class="rriv-ghb-details">' +
      '<span class="rriv-ghb-name" id="rrivGhbName">Đang tải...</span>' +
      '<span class="rriv-ghb-meta" id="rrivGhbPosition">--</span>' +
      '<span class="rriv-ghb-meta" id="rrivGhbDepartment">--</span>' +
      '</div>' +
      '<button type="button" class="rriv-ghb-btn" id="rrivGhbBtn">Quay về trang chủ</button>';

    bar.querySelector('#rrivGhbBtn').addEventListener('click', goBackHome);
    fillBar(bar, user);
    return bar;
  }

  async function enrichUser(baseUser) {
    var user = baseUser || getUser();
    if (!user || !user.username) return user;
    if (typeof Auth !== 'undefined' && typeof Auth.loadUserProfile === 'function') {
      try {
        await Auth.loadUserProfile(user.username);
        user = getUser();
        if (!resolvePosition(user) && typeof Auth.getProfile === 'function') {
          var prof = Auth.getProfile();
          if (prof && typeof Auth.mergeDisplayFields === 'function') {
            user = Auth.mergeDisplayFields(Auth.getUser() || user, prof);
          }
        }
      } catch (e) { /* ignore */ }
    }
    return user;
  }

  function refresh(user) {
    var bar = document.getElementById('rrivGlobalHomeBar');
    if (!bar) return;
    fillBar(bar, user || getUser());
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

  async function mount() {
    if (!/^\/app\//.test(window.location.pathname)) return;
    if (document.getElementById('rrivGlobalHomeBar')) {
      refresh(await enrichUser());
      return;
    }

    if (upgradeDoanhnghiepHeader()) return;

    const user = await enrichUser();
    const bar = buildBar(user);
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

  window.RrivAppBar = { refresh: refresh, mount: mount, resolvePosition: resolvePosition, resolveDepartment: resolveDepartment };

  window.addEventListener('rriv:user-updated', function (e) {
    refresh(e.detail || getUser());
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mount(); });
  } else {
    mount();
  }
})();
