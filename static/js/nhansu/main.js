/* main.js — bootstrap. Wire auth, load data, render UI, attach global events.
 * Initializes Firebase using config from permissions.js.
 */
(function () {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBCpPDhOKofImy_K8xiV2Mhut_3gbdB1vY",
    authDomain: "quantridoanhnghiepphr.firebaseapp.com",
    projectId: "quantridoanhnghiepphr",
    storageBucket: "quantridoanhnghiepphr.firebasestorage.app",
    messagingSenderId: "1024381876052",
    appId: "1:1024381876052:web:150ee86fc411bd14733ac1"
  };

  if (!ErpDb.apps.length) ErpDb.initializeApp(FIREBASE_CONFIG);
  const auth = ErpDb.auth();
  const db = ErpDb.firestore();
  window.db = db;
  window.auth = auth;
  auth.setPersistence(ErpDb.auth.Auth.Persistence.LOCAL);

  const NS = window.NhansuState;
  const SVC = window.NhansuServices;
  const PERMS = window.NhansuPerms;
  const TREE = window.NhansuTree;
  const PANEL = window.NhansuPanel;
  const MOD = window.NhansuModals;

  // ============== Bootstrap ==============
  let booted = false;

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = 'index.html';
      return;
    }

    try {
      // Load current user from Firestore
      const u = await SVC.loadCurrentUser(user.uid);
      if (!u) {
        alert('Không tìm thấy thông tin nhân sự — liên hệ admin');
        await auth.signOut();
        return;
      }
      NS.state.currentUser = u;

      // Init Permissions module
      try { Permissions.initFromUserData?.({ uid: user.uid, ...u }); } catch {}

      // Single session enforcement
      if (await PERMS.isSingleSessionEnabled()) {
        PERMS.startSessionListener(user.uid, msg => PERMS.forceLogout(msg));
      }

      // Subscribe role definitions (refresh UI on permission change)
      PERMS.subscribeRoleDefs(user.uid, () => { if (booted) refresh(); });

      // Load managed teams
      NS.state.managedTeams = await SVC.loadManagedTeams(user.uid);

      // Update header user chip
      updateUserChip(u);

      // Initial data load
      await loadAll();
      booted = true;
    } catch (e) {
      console.error('Bootstrap error:', e);
      NS.toast('Lỗi tải dữ liệu: ' + e.message, 'error');
    }
  });

  async function loadAll() {
    const root = document.getElementById('treeRoot');
    if (root) root.innerHTML = '<div class="tree-loading"><div class="spinner"></div></div>';

    const [personnel, depts, poss, teams, factories] = await Promise.all([
      SVC.loadPersonnel(),
      SVC.loadDepartments(),
      SVC.loadPositions(),
      SVC.loadTeams(),
      SVC.loadFactories().catch(() => [])
    ]);

    // Merge factory data: ưu tiên Firestore, bổ sung defaults nếu chưa có doc
    const factMap = new Map();
    NS.DEFAULT_FACTORIES.forEach(f => factMap.set(f.id, { ...f }));
    factories.forEach(f => factMap.set(f.id, { ...factMap.get(f.id), ...f }));

    // Apply scope filter to personnel
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
    NS.state.departments = depts;
    NS.state.positions = poss;
    NS.state.allTeams = teams;
    NS.state.factories = Array.from(factMap.values());

    // Pre-expand root
    NS.state.expanded.add('root');

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
    chip.onclick = () => MOD.openMyPerms();
  }

  // ============== Search ==============
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
        // If searching, auto-expand all and highlight; else collapse to default
        if (v && v.length >= 2) {
          PANEL.render();
        } else {
          PANEL.render();
        }
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

  // ============== Header buttons ==============
  function bindHeader() {
    document.getElementById('btnHome')?.addEventListener('click', () => window.location.href = 'index.html');
    document.getElementById('btnHamburger')?.addEventListener('click', () => TREE.toggleDrawer());
    document.getElementById('btnRefresh')?.addEventListener('click', refresh);
    document.getElementById('drawerBackdrop')?.addEventListener('click', () => TREE.closeDrawer());

    // Tree toolbar
    document.getElementById('btnTreeExpand')?.addEventListener('click', () => TREE.expandAll());
    document.getElementById('btnTreeCollapse')?.addEventListener('click', () => TREE.collapseAll());
    document.getElementById('btnTreeRoot')?.addEventListener('click', () => TREE.selectRoot());
  }

  // ============== Export Excel ==============
  function exportExcel() {
    const list = NS.filterPersonnel(NS.state.allPersonnel);
    const rows = list.map(p => ({
      'Mã NV': p.employeeCode || '',
      'Họ tên': p.hoTen || '',
      'Username': p.username || '',
      'Email': p.email || p.personalEmail || '',
      'SĐT': p.phone || '',
      'CCCD': p.cccd || '',
      'Giới tính': p.gender === 'male' ? 'Nam' : p.gender === 'female' ? 'Nữ' : '',
      'Ngày sinh': NS.fmtDate(p.dateOfBirth),
      'Nhà máy': p.factory || '',
      'Phòng ban': NS.deptName(p.department),
      'Chức vụ': NS.posName(p.position),
      'Tổ': p.team ? NS.teamName(p.team) : '',
      'Vai trò': NS.ROLE_LABELS[p.role] || p.role || '',
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

  // ============== Init when DOM ready ==============
  function init() {
    bindSearch();
    bindHeader();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NhansuMain = { refresh, loadAll, exportExcel };
})();
