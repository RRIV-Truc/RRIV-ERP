/* main.js — bootstrap RRIV (Supabase qua Flask, không Firebase). */
(function () {
  'use strict';

  const db = ErpDb.firestore();
  window.db = db;

  const NS = window.NhansuState;
  const SVC = window.NhansuServices;
  const PERMS = window.NhansuPerms;
  const TREE = window.NhansuTree;
  const PANEL = window.NhansuPanel;

  let booted = false;
  let dataLoading = false;

  function ensureModules(bundle) {
    var Lazy = window.NhansuLazy;
    if (!Lazy || !Lazy.ensure) {
      return Promise.reject(new Error('Trình tải module chưa sẵn sàng.'));
    }
    return Lazy.ensure(bundle);
  }

  function scheduleModalsPreload() {
    var run = function () {
      if (window.NhansuLazy && window.NhansuLazy.preloadAll) {
        window.NhansuLazy.preloadAll();
      }
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 3000 });
    } else {
      setTimeout(run, 800);
    }
  }

  function findUserFromOrgData(lookupId, username) {
    const personnel = NS.state._lastOrgRaw?.[0] || NS.state.allPersonnel || [];
    let u = personnel.find(p => p.id === lookupId);
    if (!u && username) {
      const un = String(username).toLowerCase();
      u = personnel.find(p => String(p.username || '').toLowerCase() === un);
    }
    return u || null;
  }

  function buildUserFromAuth(authUser, profile) {
    profile = profile || authUser;
    const lookupId = profile.id || authUser.id || authUser.uid || authUser.username;
    return {
      id: lookupId,
      username: authUser.username,
      hoTen: profile.hoTen || profile.name || authUser.name || authUser.username,
      role: profile.role || authUser.role || 'user',
      department: profile.department || authUser.department || '',
      appRolesCache: profile.appRolesCache || authUser.appRolesCache || {}
    };
  }

  function showBootShell() {
    const head = document.getElementById('panelHead');
    if (!head || head.innerHTML.trim()) return;
    head.innerHTML = `
      <div class="breadcrumb"><span class="current">${NS.esc(NS.ROOT_LABEL)}</span></div>
      <div class="panel-title-row">
        <div class="panel-title">🌿 ${NS.esc(NS.ROOT_LABEL)}</div>
      </div>`;
  }

  function finishBoot(u) {
    NS.state.currentUser = u;
    try { Permissions.initFromUserData?.({ uid: u.id, ...u }); } catch (_) { /* ignore */ }
    updateUserChip(u);
    showBootShell();
    if (typeof RrivAppBar !== 'undefined' && RrivAppBar.refresh) {
      RrivAppBar.refresh(u);
    }
    booted = true;
  }

  async function loadBackgroundData(authUser) {
    if (dataLoading) return;
    dataLoading = true;

    const sessionProfile = Auth.getProfile?.() || authUser;
    let u = buildUserFromAuth(authUser, sessionProfile);
    NS.state.currentUser = u;

    if (!PERMS.canAccessApp(u)) {
      alert('Bạn không có quyền truy cập ứng dụng Nhân sự.');
      window.location.href = '/';
      dataLoading = false;
      return;
    }

    try {
      const [orgData, managedTeams] = await Promise.all([
        fetchOrgData(),
        SVC.loadManagedTeams(u.id).catch(function () { return []; })
      ]);

      NS.state.managedTeams = managedTeams || [];
      applyOrgData(orgData);
      TREE.render();
      PANEL.render();

      scheduleModalsPreload();
      enrichInBackground(authUser, u);
    } catch (e) {
      console.error('Bootstrap error:', e);
      NS.toast('Lỗi tải dữ liệu: ' + e.message, 'error');
    } finally {
      dataLoading = false;
    }
  }

  async function enrichInBackground(authUser, u) {
    try {
      const lookupId = u.id || authUser.id || authUser.uid || authUser.username;
      const rolesPromise = (typeof Permissions?.loadRoleDefinitions === 'function')
        ? Permissions.loadRoleDefinitions(db).catch(function () { /* ignore */ })
        : Promise.resolve();

      const profilePromise = (authUser.username && typeof Auth.loadUserProfile === 'function')
        ? Auth.loadUserProfile(authUser.username).catch(function () { /* offline */ })
        : Promise.resolve();

      await Promise.all([profilePromise, rolesPromise]);

      const profile = Auth.getProfile?.() || authUser;
      localStorage.setItem('currentUser', JSON.stringify(authUser));

      let loaded = findUserFromOrgData(lookupId, authUser.username);
      if (!loaded) {
        loaded = await SVC.loadCurrentUser(lookupId);
        if (!loaded && authUser.username) {
          loaded = await SVC.loadCurrentUser(authUser.username);
        }
      }
      if (loaded) u = loaded;
      NS.state.currentUser = u;

      if (typeof Auth.persistSession === 'function') Auth.persistSession();

      try { Permissions.initFromUserData?.({ uid: u.id, ...u }); } catch (_) { /* ignore */ }

      updateUserChip(u);
      if (typeof RrivAppBar !== 'undefined' && RrivAppBar.refresh) {
        RrivAppBar.refresh(u);
      }

      if (await PERMS.isSingleSessionEnabled()) {
        PERMS.startSessionListener(u.id, msg => PERMS.forceLogout(msg));
      }

      PERMS.subscribeRoleDefs(u.id, () => { if (booted) refresh(); });

      if (NS.state._lastOrgRaw) {
        applyOrgData(NS.state._lastOrgRaw);
        TREE.render();
        PANEL.render();
      }
    } catch (e) {
      console.warn('[Nhansu] enrich', e);
    }
  }

  async function bootstrap() {
    let authUser = (typeof Auth !== 'undefined' && Auth.restoreSession && Auth.restoreSession()) || null;
    if (!authUser) {
      authUser = await Auth.init();
      if (!authUser) {
        window.location.href = '/';
        return;
      }
    }

    const profile = Auth.getProfile?.() || authUser;
    finishBoot(buildUserFromAuth(authUser, profile));
    loadBackgroundData(authUser);
  }

  function normalizeOrgIds(personnel, depts, teams) {
    personnel.forEach(p => {
      if (p.department && !depts.some(d => d.id === p.department)) {
        const d = depts.find(x => x.name === p.department || x.id === p.department);
        if (d) p.department = d.id;
      }
      if (p.team && !teams.some(t => t.id === p.team)) {
        const t = teams.find(x => x.name === p.team || x.id === p.team);
        if (t) p.team = t.id;
      }
    });
  }

  async function fetchOrgData() {
    return Promise.all([
      SVC.loadPersonnel(),
      SVC.loadDepartments(),
      SVC.loadPositions(),
      SVC.loadTeams(),
      SVC.loadFactories().catch(function () { return []; }),
      SVC.loadSystemRoles()
    ]);
  }

  function applyOrgData(orgData) {
    NS.state._lastOrgRaw = orgData;
    const [personnel, depts, poss, teams, factories, systemRoles] = orgData;

    const factMap = new Map();
    factories.forEach(f => factMap.set(f.id, { ...f }));

    const u = NS.state.currentUser;
    let filtered = personnel;
    if (!PERMS.canViewAll(u)) {
      const sc = PERMS.getScope(u);
      const userDept = u?.department;
      const allowedDepts = (sc.ids && sc.type === 'department') ? sc.ids : (userDept ? [userDept] : []);
      const allowedTeams = (sc.type === 'team') ? sc.ids :
                           (NS.state.managedTeams.map(t => t.id));
      if (allowedDepts.length || allowedTeams.length) {
        filtered = personnel.filter(p => {
          if (allowedDepts.includes(p.department)) return true;
          if ((p.concurrentPositions || []).some(cp => allowedDepts.includes(cp.departmentId))) return true;
          if (allowedTeams.includes(p.team)) return true;
          return false;
        });
      }
    }

    NS.state.allPersonnel = filtered;
    NS.state.systemRoles = systemRoles || [];
    NS.state.departments = depts.filter(d => d.active !== false && !d.metadata?.retired);
    normalizeOrgIds(filtered, NS.state.departments, teams);
    NS.state.positions = NS.mergePositionCatalog(poss, filtered);
    filtered.forEach(p => {
      const raw = p.position || p.position_name || p.positionName;
      const resolved = NS.resolvePositionId(raw, NS.state.positions);
      if (resolved) p.position = resolved;
    });
    NS.state.allTeams = teams.filter(t => !t.metadata?.retired);
    NS.state.factories = Array.from(factMap.values());

    filtered.forEach(p => {
      (p.concurrentPositions || []).forEach(cp => {
        if (!cp.departmentId && cp.departmentName) {
          const d = depts.find(x => x.name === cp.departmentName || x.id === cp.departmentId);
          if (d) cp.departmentId = d.id;
        }
        if (!cp.positionId && cp.positionName) {
          const pos = NS.state.positions.find(x => x.name === cp.positionName || x.id === cp.positionId);
          if (pos) cp.positionId = pos.id;
        }
      });
    });

    NS.state.expanded.add('root');
  }

  async function loadAll() {
    const root = document.getElementById('treeRoot');
    if (root) root.innerHTML = '<div class="tree-loading"><div class="spinner"></div></div>';

    const orgData = await fetchOrgData();
    applyOrgData(orgData);
    TREE.render();
    PANEL.render();
  }

  async function refresh() {
    await loadAll();
    NS.toast('Đã làm mới');
  }

  function updateUserChip(u) {
    const chip = document.getElementById('userChip');
    if (!chip) return;
    const initials = NS.getInitials(u.hoTen);
    const roleBadge = u.role && u.role !== 'user' ? ` · ${NS.ROLE_LABELS[u.role] || u.role}` : '';
    chip.innerHTML = `
      <div class="avatar">${NS.esc(initials)}</div>
      <div class="name">${NS.esc(u.hoTen || 'User')}${NS.esc(roleBadge)}</div>
    `;
    chip.onclick = () => {
      ensureModules('modals').then(function () {
        window.NhansuModals?.openMyPerms();
      }).catch(function (e) {
        NS.toast(e.message || 'Không tải được form quyền', 'error');
      });
    };
  }

  function bindSearch() {
    const input = document.getElementById('searchInput');
    const wrap = input?.closest('.header-search');
    const clear = wrap?.querySelector('.clear-btn');
    if (!input) return;

    let timer = null;
    input.addEventListener('input', () => {
      const v = input.value;
      if (wrap) wrap.classList.toggle('has-value', !!v);
      clearTimeout(timer);
      timer = setTimeout(() => {
        NS.state.searchTerm = v;
        PANEL.render();
      }, 250);
    });
    if (clear) clear.onclick = () => {
      input.value = '';
      wrap.classList.remove('has-value');
      NS.state.searchTerm = '';
      PANEL.render();
      input.focus();
    };
  }

  function bindHeader() {
    document.getElementById('btnHome')?.addEventListener('click', () => {
      if (typeof Auth !== 'undefined' && typeof Auth.goHome === 'function') Auth.goHome();
      else window.location.href = '/';
    });
    document.getElementById('btnHamburger')?.addEventListener('click', () => TREE.toggleDrawer());
    document.getElementById('btnRefresh')?.addEventListener('click', refresh);
    document.getElementById('drawerBackdrop')?.addEventListener('click', () => TREE.closeDrawer());

    document.getElementById('btnTreeExpand')?.addEventListener('click', () => TREE.expandAll());
    document.getElementById('btnTreeCollapse')?.addEventListener('click', () => TREE.collapseAll());
    document.getElementById('btnTreeRoot')?.addEventListener('click', () => TREE.selectRoot());
  }

  async function exportExcel() {
    await ensureModules('export');
    const list = NS.filterPersonnel(NS.state.allPersonnel);
    const rows = list.map(p => ({
      'Mã NV': p.employeeCode || '',
      'Họ tên': p.hoTen || '',
      'Username': p.username || '',
      'Email': p.email || p.personalEmail || '',
      'SĐT': p.phone || '',
      'CCCD': p.cccd || '',
      'Phòng ban': p.department ? NS.deptName(p.department) : '',
      'Chức vụ': p.position ? NS.posName(p.position) : '',
      'Tổ': p.team ? NS.teamName(p.team) : '',
      'Vai trò': NS.personSystemRoleLabel(p),
      'Trạng thái': p.disabled ? 'Nghỉ việc' : 'Đang làm',
      'Ngày vào': NS.fmtDate(p.hireDate),
      'Loại HĐ': p.contractType || '',
      'Địa chỉ': p.permanentAddress || ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Nhân sự');
    const fname = `nhansu_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fname);
    NS.toast('Đã xuất Excel');
  }

  function init() {
    bindSearch();
    bindHeader();
    bootstrap();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NhansuMain = { refresh, loadAll, exportExcel };
})();
