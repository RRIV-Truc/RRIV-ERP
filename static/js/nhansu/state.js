/* state.js — global state + factory list + helpers
 * Exposes window.NhansuState for cross-module access.
 */
(function () {
  'use strict';

  // Viện NC Cao su VN — không dùng nhà máy chế biến (Bố Lá, Cua Paris)
  const DEFAULT_FACTORIES = [];
  const ROOT_LABEL = 'Viện NC Cao su VN';
  // FACTORIES = view trực tiếp lên state.factories nếu đã load, ngược lại trả default
  // Các module khác đọc qua getFactories() để luôn lấy data mới nhất
  function getFactories() {
    return (state.factories && state.factories.length) ? state.factories : DEFAULT_FACTORIES;
  }

  function sortByOrder(arr) {
    return arr.slice().sort((a, b) => {
      const oa = (a.order ?? 999), ob = (b.order ?? 999);
      if (oa !== ob) return oa - ob;
      return (a.label || a.name || '').localeCompare(b.label || b.name || '', 'vi');
    });
  }

  const TEAM_TYPES = {
    sanxuat: 'Sản xuất',
    baove:   'Bảo vệ',
    codong:  'Cơ động',
    hotro:   'Hỗ trợ'
  };

  // Label hiển thị legacy erp_role (user/vpp/admin)
  const ROLE_LABELS = {
    user:  'Nhân viên',
    vpp:   'Quản lý',
    admin: 'Admin'
  };

  /** Nhãn tiếng Việt cho system_role.role_name */
  const SYSTEM_ROLE_LABELS = {
    Super_Admin: 'Quản trị viên',
    Institute_Executive: 'Ban Lãnh đạo Viện',
    Department_Head: 'Lãnh đạo đơn vị',
    Operations_Specialist: 'Chuyên viên Nghiệp vụ',
    Technical_Staff: 'NCV / KTV',
    Staff_Viewer: 'Nhân viên (chỉ xem)'
  };

  /** Chức vụ mặc định — luôn có trong dropdown (kể cả khi category_positions trống). */
  const STANDARD_POSITIONS = [
    { id: 'pos-giam-doc', name: 'Giám đốc', level: 1 },
    { id: 'pos-pho-giam-doc', name: 'Phó giám đốc', level: 2 },
    { id: 'pos-truong-phong', name: 'Trưởng phòng', level: 3 },
    { id: 'pos-pho-phong', name: 'Phó phòng', level: 4 },
    { id: 'pos-phu-trach', name: 'Phụ trách bộ phận', level: 5 },
    { id: 'pos-nhan-vien', name: 'Nhân viên', level: 6 }
  ];

  function normPosKey(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/\u0111/g, 'd').replace(/\u0110/g, 'D')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function isDeputyTitle(k) {
    return /(?:^|\s)pho\s+(?:giam|truong|chanh)|(?:^|\s)pgd\b|phogiam|phophong|phogiamdoc|vice\s*director/.test(k);
  }

  function resolvePositionId(raw, catalog) {
    if (raw === null || raw === undefined || raw === '') return '';
    const list = catalog || state.positions || [];
    const s = String(raw).trim();
    const hitById = list.find(p => p.id === s);
    if (hitById) return hitById.id;
    const key = normPosKey(s);
    const hitByName = list.find(p => normPosKey(p.name) === key || normPosKey(p.id) === key);
    if (hitByName) return hitByName.id;
    return s;
  }

  /** Gộp danh mục DB + mặc định + chức vụ đang gán trên hồ sơ nhân sự. */
  function mergePositionCatalog(dbPositions, personnel) {
    const byKey = new Map();
    const add = (entry) => {
      if (!entry) return;
      const name = String(entry.name || entry.id || '').trim();
      if (!name) return;
      const id = String(entry.id || name).trim();
      const key = normPosKey(id) || normPosKey(name);
      if (!key || byKey.has(key)) return;
      byKey.set(key, { id, name, level: entry.level });
    };

    STANDARD_POSITIONS.forEach(add);
    (dbPositions || []).forEach(add);

    const collectFromPerson = (p) => {
      const raw = p.position || p.position_name || p.positionName;
      if (raw) {
        const resolved = resolvePositionId(raw, [...byKey.values()]);
        add({ id: resolved || raw, name: typeof raw === 'string' ? raw : (posName(raw) || String(raw)) });
      }
      (p.concurrentPositions || []).forEach(cp => {
        const cpRaw = cp.positionId || cp.positionName;
        if (cpRaw) {
          add({
            id: cp.positionId || cpRaw,
            name: cp.positionName || cpRaw
          });
        }
      });
    };
    (personnel || []).forEach(collectFromPerson);

    return sortByOrder([...byKey.values()].map(p => ({ ...p, label: p.name })));
  }

  const state = {
    currentUser: null,
    allPersonnel: [],
    systemRoles: [],
    departments: [],
    positions: [],
    allTeams: [],
    factories: [],
    managedTeams: [],

    // Tree selection
    selection: { type: 'root', id: 'root', label: ROOT_LABEL },
    expanded: new Set(['root']),
    searchTerm: '',
    statusFilter: 'active',

    // Editing state
    editingId: null,
    editingDeptId: null,
    editingPosId: null,
    editingTeamId: null,

    DEBUG: false
  };

  function debugLog(...args) {
    if (state.DEBUG) console.log('[Nhansu]', ...args);
  }

  function esc(t) {
    if (t === null || t === undefined) return '';
    return String(t).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmtDate(d) {
    if (!d) return '';
    const dt = d.toDate ? d.toDate() : (d instanceof Date ? d : new Date(d));
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('vi-VN');
  }

  function ageFrom(dob) {
    if (!dob) return null;
    const dt = dob.toDate ? dob.toDate() : (dob instanceof Date ? dob : new Date(dob));
    if (isNaN(dt.getTime())) return null;
    const now = new Date();
    let a = now.getFullYear() - dt.getFullYear();
    const m = now.getMonth() - dt.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dt.getDate())) a--;
    return a;
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = String(name).trim().split(/\s+/);
    return (parts[parts.length - 1] || '?').charAt(0).toUpperCase();
  }

  function genderClass(g) {
    if (g === 'male' || g === 'Nam') return 'm';
    if (g === 'female' || g === 'Nữ') return 'f';
    return 'd';
  }

  const LEGACY_DEPT_KEYS = {
    'dl-1': ['vien-01'],
    'dl-5': ['vien-03'],
    'dl-6': ['vien-02', 'vien-04'],
    'dl-2': ['vien-05'],
    'dl-3': ['vien-06', 'vien-08', 'vien-09', 'vien-10'],
    'dl-4': ['vien-07'],
  };

  function personInDept(p, deptId) {
    if (!p || !deptId) return false;
    if (p.department === deptId) return true;
    const d = dept(p.department);
    if (d && d.id === deptId) return true;
    return (p.concurrentPositions || []).some(cp =>
      cp.departmentId === deptId || dept(cp.departmentName)?.id === deptId
    );
  }

  function personInTeam(p, teamId) {
    if (!p || !teamId) return false;
    if (p.team === teamId) return true;
    const t = team(p.team);
    return t && t.id === teamId;
  }

  function dept(id) {
    if (!id) return null;
    return state.departments.find(d => d.id === id || d.name === id) || null;
  }

  // Effective factory of a person: prefer p.factory, fall back to their department's factory
  function effFactory(p) {
    if (!p) return null;
    if (p.factory) return p.factory;
    const d = dept(p.department);
    return d?.factory || null;
  }

  function factory(id) {
    if (!id) return null;
    return getFactories().find(f => f.id === id) || null;
  }
  function factoryName(id) { const f = factory(id); return f ? f.name : (id || ''); }

  // Effective order of a person in a given department context.
  // Order is STRICTLY per-dept: orderByDept[deptId] OR concurrentPositions[deptId].order.
  // KHÔNG fallback sang person.order (legacy single value) — sẽ rò qua các PB khác.
  function effOrder(person, deptId) {
    if (!person || !deptId) {
      const meta = person?.metadata || {};
      const ls = person?.listStt ?? meta.listStt;
      return ls !== undefined && ls !== null && ls !== '' ? Number(ls) : 999;
    }
    const meta = person.metadata || {};
    const m = person.orderByDept || meta.orderByDept || {};
    const keys = [deptId, ...(LEGACY_DEPT_KEYS[deptId] || [])];
    for (const k of keys) {
      if (m[k] !== undefined && m[k] !== null && m[k] !== '') return Number(m[k]);
    }
    const ls = person.listStt ?? meta.listStt;
    if (ls !== undefined && ls !== null && ls !== '') return Number(ls);
    const cp = (person.concurrentPositions || []).find(c =>
      c.departmentId === deptId || LEGACY_DEPT_KEYS[deptId]?.includes(c.departmentId)
    );
    if (cp && cp.order !== undefined && cp.order !== null && cp.order !== '') return Number(cp.order);
    return 999;
  }
  function pos(id) {
    if (!id) return null;
    const resolved = resolvePositionId(id, state.positions);
    return state.positions.find(p => p.id === resolved || p.name === resolved || p.id === id || p.name === id) || null;
  }
  function team(id) {
    if (!id) return null;
    return state.allTeams.find(t => t.id === id || t.name === id) || null;
  }
  function deptName(id) { const d = dept(id); return d ? d.name : (id || ''); }
  function posName(id) {
    const p = pos(id);
    if (p) return p.name;
    const s = String(id || '').trim();
    return s;
  }
  function teamName(id) { const t = team(id); return t ? t.name : (id || ''); }

  // Filter personnel by current selection in tree
  function filterBySelection(list) {
    const sel = state.selection;
    if (sel.type === 'root') return list.slice();
    if (sel.type === 'factory') {
      return list.filter(p => effFactory(p) === sel.id);
    }
    if (sel.type === 'department') {
      const d = dept(sel.id);
      const factoryScope = d?.factory || sel.factoryId;
      return list.filter(p => {
        if (!personInDept(p, sel.id)) return false;
        if (factoryScope) return effFactory(p) === factoryScope;
        return true;
      });
    }
    if (sel.type === 'team') return list.filter(p => personInTeam(p, sel.id));
    if (sel.type === 'unteamed') {
      return list.filter(p => personInDept(p, sel.deptId) && !p.team);
    }
    return list.slice();
  }

  // Apply search + status filter on top of selection
  function filterPersonnel(list) {
    let arr = filterBySelection(list);
    const status = state.statusFilter;
    if (status === 'active') arr = arr.filter(p => !p.disabled);
    else if (status === 'inactive') arr = arr.filter(p => p.disabled);

    const q = (state.searchTerm || '').trim().toLowerCase();
    if (q) {
      arr = arr.filter(p => {
        const hay = [
          p.hoTen, p.name, p.employeeCode, p.code,
          p.phone, p.cccd, p.username, p.email
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    return arr;
  }

  // Show toast
  function toast(msg, type = 'success') {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    t.textContent = `${icon} ${msg}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function getSystemRoleLabel(roleNameOrId) {
    if (roleNameOrId == null || roleNameOrId === '') return '';
    const byId = state.systemRoles.find(r => String(r.id) === String(roleNameOrId));
    if (byId) return SYSTEM_ROLE_LABELS[byId.role_name] || byId.description || byId.role_name;
    return SYSTEM_ROLE_LABELS[roleNameOrId] || roleNameOrId;
  }

  function personSystemRoleId(p) {
    if (!p) return '';
    const meta = p.metadata || {};
    return meta.systemRoleId || meta.system_role_id || p.systemRoleId || '';
  }

  function personSystemRoleLabel(p) {
    const rid = personSystemRoleId(p);
    if (rid) return getSystemRoleLabel(rid);
    return ROLE_LABELS[p?.role] || p?.role || '';
  }

  const SYSTEM_ROLE_ID_LEVEL = {
    '1': 1, '2': 2, '3': 3, '4': 5, '5': 6, '6': 7
  };

  const SYSTEM_ROLE_LEVEL = {
    Super_Admin: 1,
    Institute_Executive: 2,
    Department_Head: 3,
    Operations_Specialist: 5,
    Technical_Staff: 6,
    Staff_Viewer: 7
  };

  function inferLevelFromTitle(raw) {
    const k = normPosKey(raw);
    if (!k) return 50;
    if (/^gd\b|\bgd\s/.test(k)) return 1;
    if (/^pgd\b|\bpgd\s/.test(k)) return 2;
    if (/pho\s*giam|phogiam|vice\s*director|pgd/.test(k)) return 2;
    if (/giam\s*doc|giamdoc|director/.test(k) && !isDeputyTitle(k)) return 1;
    if (/chanh\s*van|chanhvan|vien\s*truong/.test(k) && !isDeputyTitle(k)) return 1;
    if (/pho\s*chanh|phochanh/.test(k)) return 2;
    if (/pho\s*truong\s*phong|phophong|(?:^|\s)pho\s+phong/.test(k)) return 4;
    if (/ke\s*toan\s*truong|ketoantruong/.test(k)) return 3;
    if (/truong\s*phong|truongphong|head\s*of/.test(k) && !isDeputyTitle(k)) return 3;
    if (/phu\s*trach|phutrach/.test(k)) return 5;
    if (/to\s*truong|totruong|team\s*lead/.test(k)) return 5;
    if (/chuyen\s*vi|chuyenvi|specialist/.test(k)) return 6;
    if (/cao\s*dang|caodang/.test(k)) return 7;
    if (/\bncv\b|\bktv\b|researcher|technician/.test(k)) return 7;
    if (/nhan\s*vien|nhanvien|staff/.test(k)) return 8;
    return 50;
  }

  function positionRawForDept(person, deptId) {
    if (!person) return '';
    const cps = person.concurrentPositions || [];
    for (const cp of cps) {
      if (cp.departmentId === deptId) return cp.positionName || cp.positionId || '';
      const dn = dept(cp.departmentName);
      if (dn && dn.id === deptId) return cp.positionName || cp.positionId || '';
      if ((LEGACY_DEPT_KEYS[deptId] || []).includes(cp.departmentId)) {
        return cp.positionName || cp.positionId || '';
      }
    }
    const meta = person.metadata || {};
    return person.position || person.position_name || person.positionName
      || person.chucVu || meta.position || meta.position_name || '';
  }

  function allPositionRawsForLeadership(person, deptId) {
    const seen = new Set();
    const raws = [];
    const add = (raw) => {
      const s = String(raw || '').trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      raws.push(s);
    };
    const meta = person?.metadata || {};
    add(person?.position || person?.position_name || person?.positionName || person?.chucVu
      || meta.position || meta.position_name);
    if (deptId) add(positionRawForDept(person, deptId));
    (person?.concurrentPositions || []).forEach(cp => {
      add(cp.positionName || cp.positionId);
    });
    return raws;
  }

  function positionLevel(raw) {
    if (!raw) return 50;
    const inferred = inferLevelFromTitle(raw);
    if (inferred < 50) return inferred;
    const resolved = resolvePositionId(raw, state.positions);
    const hit = state.positions.find(p => p.id === resolved || p.name === resolved);
    if (hit && hit.level != null) return hit.level;
    const key = normPosKey(raw);
    const byName = state.positions.find(p => normPosKey(p.name) === key || normPosKey(p.id) === key);
    if (byName && byName.level != null) return byName.level;
    return 50;
  }

  function systemRoleLevel(person) {
    const rid = personSystemRoleId(person);
    if (rid && SYSTEM_ROLE_ID_LEVEL[String(rid)] != null) {
      return SYSTEM_ROLE_ID_LEVEL[String(rid)];
    }
    if (rid) {
      const row = state.systemRoles.find(r => String(r.id) === String(rid));
      if (row && SYSTEM_ROLE_LEVEL[row.role_name] != null) {
        return SYSTEM_ROLE_LEVEL[row.role_name];
      }
    }
    return 50;
  }

  /** Cấp lãnh đạo (số nhỏ = cao hơn) — dùng sắp xếp danh sách nhân sự. */
  function leadershipRank(person, deptId) {
    const raws = allPositionRawsForLeadership(person, deptId);
    let posLvl = 50;
    raws.forEach(raw => {
      posLvl = Math.min(posLvl, positionLevel(raw));
    });
    const roleLvl = systemRoleLevel(person);
    return Math.min(posLvl, roleLvl);
  }

  window.NhansuState = {
    state,
    DEFAULT_FACTORIES,
    ROOT_LABEL,
    getFactories,
    TEAM_TYPES,
    ROLE_LABELS,
    SYSTEM_ROLE_LABELS,
    STANDARD_POSITIONS,
    getSystemRoleLabel,
    personSystemRoleId,
    personSystemRoleLabel,
    leadershipRank,
    positionLevel,
    normPosKey,
    resolvePositionId,
    mergePositionCatalog,
    debugLog,
    esc, fmtDate, ageFrom, getInitials, genderClass,
    dept, pos, team, deptName, posName, teamName,
    personInDept, personInTeam,
    factory, factoryName, effFactory, effOrder,
    sortByOrder,
    filterBySelection, filterPersonnel,
    toast
  };
})();
