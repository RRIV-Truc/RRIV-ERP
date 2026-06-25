/* state.js — global state + factory list + helpers
 * Exposes window.NhansuState for cross-module access.
 */
(function () {
  'use strict';

  // Default factories — dùng nếu collection categoryFactories rỗng
  const DEFAULT_FACTORIES = [
    { id: 'A01', name: 'NM Bố Lá (A01)', icon: '🏭', order: 1 },
    { id: 'A02', name: 'NM Cua Paris (A02)', icon: '🏭', order: 2 }
  ];
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

  // Label hiển thị (giá trị nội bộ user/vpp/admin giữ nguyên để không vỡ data cũ)
  const ROLE_LABELS = {
    user:  'Nhân viên',
    vpp:   'Quản lý',
    admin: 'Admin'
  };

  const state = {
    currentUser: null,
    allPersonnel: [],
    departments: [],
    positions: [],
    allTeams: [],
    factories: [],
    managedTeams: [],

    // Tree selection
    selection: { type: 'root', id: null, label: 'Toàn công ty' },
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
    if (!person || !deptId) return 999;
    const m = person.orderByDept || {};
    if (m[deptId] !== undefined && m[deptId] !== null && m[deptId] !== '') return Number(m[deptId]);
    const cp = (person.concurrentPositions || []).find(c => c.departmentId === deptId);
    if (cp && cp.order !== undefined && cp.order !== null && cp.order !== '') return Number(cp.order);
    return 999;
  }
  function pos(id) {
    if (!id) return null;
    return state.positions.find(p => p.id === id || p.name === id) || null;
  }
  function team(id) {
    if (!id) return null;
    return state.allTeams.find(t => t.id === id || t.name === id) || null;
  }
  function deptName(id) { const d = dept(id); return d ? d.name : (id || ''); }
  function posName(id)  { const p = pos(id);  return p ? p.name : (id || ''); }
  function teamName(id) { const t = team(id); return t ? t.name : (id || ''); }

  // Filter personnel by current selection in tree
  function filterBySelection(list) {
    const sel = state.selection;
    if (sel.type === 'root') return list.slice();
    if (sel.type === 'factory') {
      return list.filter(p => effFactory(p) === sel.id);
    }
    if (sel.type === 'department') {
      // If dept has a factory, scope to that factory; else show all in dept (company-level)
      const d = dept(sel.id);
      const factoryScope = d?.factory || sel.factoryId;
      return list.filter(p => {
        const inDept = p.department === sel.id ||
          (p.concurrentPositions || []).some(cp => cp.departmentId === sel.id);
        if (!inDept) return false;
        if (factoryScope) return effFactory(p) === factoryScope;
        return true;
      });
    }
    if (sel.type === 'team') return list.filter(p => p.team === sel.id);
    if (sel.type === 'unteamed') {
      // employees in dept but no team
      return list.filter(p => p.department === sel.deptId && !p.team);
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

  window.NhansuState = {
    state,
    DEFAULT_FACTORIES,
    getFactories,
    TEAM_TYPES,
    ROLE_LABELS,
    debugLog,
    esc, fmtDate, ageFrom, getInitials, genderClass,
    dept, pos, team, deptName, posName, teamName,
    factory, factoryName, effFactory, effOrder,
    sortByOrder,
    filterBySelection, filterPersonnel,
    toast
  };
})();
