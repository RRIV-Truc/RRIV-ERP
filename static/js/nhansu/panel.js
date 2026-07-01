/* panel.js — right panel renderer.
 * Shows context-aware view based on selection: employee list / dept info / team info / stats.
 * Has 2 view modes: 'list' (default) and 'stats'.
 */
(function () {
  'use strict';

  const NS = window.NhansuState;
  const { state, esc, fmtDate, ageFrom,
          deptName, posName, teamName, filterPersonnel, ROLE_LABELS, TEAM_TYPES, ROOT_LABEL,
          personInDept } = NS;

  let viewMode = 'list'; // 'list' | 'stats'

  function render() {
    renderHeader();
    if (viewMode === 'stats') renderStats();
    else renderList();
  }

  function renderHeader() {
    const sel = state.selection;
    const head = document.getElementById('panelHead');
    if (!head) return;

    const crumbs = buildBreadcrumb();
    const counts = NS.filterBySelection(state.allPersonnel);
    const activeCount = counts.filter(p => !p.disabled).length;
    const totalCount = counts.length;

    const perms = window.NhansuPerms;
    const u = state.currentUser;
    const canAddEmp = perms.canManageEmployees(u);
    const canAddDept = perms.canManageDepartments(u);
    const canAddPos = perms.canManagePositions(u);
    const canAddTeam = perms.canManageTeams(u);
    const canImport = perms.canImport(u);

    let title = sel.label || ROOT_LABEL;
    let titleIcon = '🌿';
    if (sel.type === 'department') titleIcon = '🏢';
    else if (sel.type === 'team') titleIcon = '👥';
    else if (sel.type === 'unteamed') titleIcon = '◦';

    const actions = [];
    if (canAddEmp) actions.push(`<button class="btn btn-primary" data-act="add-employee">➕ Thêm NV</button>`);
    if (canAddDept && sel.type === 'root') actions.push(`<button class="btn" data-act="add-dept">🏢 Thêm phòng ban</button>`);
    if (canAddTeam && (sel.type === 'department')) actions.push(`<button class="btn" data-act="add-team">👥 Thêm tổ</button>`);
    if (canAddPos && sel.type === 'root') actions.push(`<button class="btn" data-act="manage-positions">💼 Chức vụ</button>`);
    if (canImport) actions.push(`<button class="btn btn-ghost" data-act="import">📥 Import</button>`);
    actions.push(`<button class="btn btn-ghost" data-act="export">📊 Excel</button>`);

    if (sel.type === 'department') {
      if (canAddDept) actions.unshift(`<button class="btn btn-sm" data-act="edit-dept" data-id="${esc(sel.id)}">✏️ Sửa PB</button>`);
    }
    if (sel.type === 'team') {
      if (canAddTeam) {
        actions.unshift(`<button class="btn btn-sm" data-act="edit-team" data-id="${esc(sel.id)}">✏️ Sửa tổ</button>`);
        actions.unshift(`<button class="btn btn-sm" data-act="assign-manager" data-id="${esc(sel.id)}">👔 Tổ trưởng</button>`);
      }
    }

    head.innerHTML = `
      <div class="breadcrumb">${crumbs}</div>
      <div class="panel-title-row">
        <div class="panel-title">${titleIcon} ${esc(title)} <span class="badge-count">${activeCount}${totalCount !== activeCount ? ' / ' + totalCount : ''}</span></div>
        <div class="panel-actions">${actions.join('')}</div>
      </div>
      <div class="panel-tabs">
        <button class="panel-tab ${viewMode === 'list' ? 'active' : ''}" data-view="list">👥 Danh sách</button>
        <button class="panel-tab ${viewMode === 'stats' ? 'active' : ''}" data-view="stats">📊 Thống kê</button>
      </div>
      ${viewMode === 'list' ? `
        <div class="panel-filters">
          <select id="statusFilterSel">
            <option value="active" ${state.statusFilter === 'active' ? 'selected' : ''}>✅ Đang làm</option>
            <option value="inactive" ${state.statusFilter === 'inactive' ? 'selected' : ''}>❌ Nghỉ việc</option>
            <option value="all" ${state.statusFilter === 'all' ? 'selected' : ''}>Tất cả</option>
          </select>
        </div>
      ` : ''}
    `;

    head.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      const id = e.target.closest('[data-act]')?.dataset.id;
      if (act) handleAction(act, id);

      const view = e.target.closest('.panel-tab')?.dataset.view;
      if (view && view !== viewMode) { viewMode = view; render(); }
    };
    const statusSel = document.getElementById('statusFilterSel');
    if (statusSel) statusSel.onchange = () => {
      state.statusFilter = statusSel.value;
      render();
    };
  }

  function buildBreadcrumb() {
    const sel = state.selection;
    const items = [];
    items.push({ label: ROOT_LABEL, type: 'root', id: 'root' });
    if (sel.type !== 'root') {
      if (sel.type === 'team' || sel.type === 'unteamed') {
        const d = NS.dept(sel.deptId);
        if (d) items.push({ label: d.name, type: 'department', id: d.id });
      }
      items.push({ label: sel.label, type: sel.type, id: sel.id, current: true });
    } else {
      items[0].current = true;
    }

    return items.map((it, i) => {
      const sep = i > 0 ? '<span class="sep">›</span>' : '';
      if (it.current) return `${sep}<span class="current">${esc(it.label)}</span>`;
      return `${sep}<span class="crumb" data-crumb-type="${it.type}" data-crumb-id="${esc(it.id)}">${esc(it.label)}</span>`;
    }).join('');
  }

  function deptSortKey(d) {
    return d.order ?? d.metadata?.order ?? 999;
  }

  function sortPeople(list, ctxDeptId) {
    return list.slice().sort((a, b) => {
      const ctx = ctxDeptId || a.department;

      const la = NS.leadershipRank(a, ctx);
      const lb = NS.leadershipRank(b, ctx);
      if (la !== lb) return la - lb;

      const oa = NS.effOrder(a, ctx);
      const ob = NS.effOrder(b, ctx);
      if (oa !== ob) return oa - ob;

      return (a.hoTen || '').localeCompare(b.hoTen || '', 'vi');
    });
  }

  function renderList() {
    const body = document.getElementById('panelBody');
    if (!body) return;

    const sel = state.selection;
    let ctxDeptId = null;
    if (sel.type === 'department') ctxDeptId = sel.id;
    else if (sel.type === 'team' || sel.type === 'unteamed') ctxDeptId = sel.deptId;

    const u = state.currentUser;
    const perms = window.NhansuPerms;
    const filtered = filterPersonnel(state.allPersonnel);

    if (filtered.length === 0) {
      body.innerHTML = `
        <div class="state">
          <div class="ico">📭</div>
          <div class="msg">Không có nhân sự${state.searchTerm ? ' khớp tìm kiếm' : ''}</div>
        </div>`;
      bindBodyClicks();
      return;
    }

    if (sel.type === 'root' && !state.searchTerm) {
      const depts = state.departments.slice().sort((a, b) => deptSortKey(a) - deptSortKey(b));
      const sections = [];
      depts.forEach((d, idx) => {
        const inDept = filtered.filter(p => personInDept(p, d.id));
        if (!inDept.length) return;
        const sorted = sortPeople(inDept, d.id);
        sections.push(`
          <section class="emp-section">
            <h3 class="emp-section-title"><span class="dept-idx">${deptSortKey(d) === 999 ? (sections.length + 1) : deptSortKey(d)}</span> ${esc(d.name)} <span class="badge-count">${sorted.length}</span></h3>
            ${empTable(sorted, d.id, u, perms, false)}
          </section>`);
      });
      const orphan = filtered.filter(p =>
        !p.department || !depts.some(d => personInDept(p, d.id))
      );
      if (orphan.length) {
        sections.push(`
          <section class="emp-section">
            <h3 class="emp-section-title">Chưa phân phòng ban <span class="badge-count">${orphan.length}</span></h3>
            ${empTable(sortPeople(orphan, null), null, u, perms, false)}
          </section>`);
      }
      body.innerHTML = `<div class="emp-list-wrap">${sections.join('')}</div>`;
    } else {
      const list = sortPeople(filtered, ctxDeptId);
      body.innerHTML = `<div class="emp-list-wrap">${empTable(list, ctxDeptId, u, perms, sel.type === 'root')}</div>`;
    }
    bindBodyClicks();
  }

  function empTable(list, ctxDeptId, u, perms, showDeptCol) {
    const rows = list.map((p, i) => empRow(p, i, ctxDeptId, u, perms, showDeptCol)).join('');
    return `
      <table class="emp-table">
        <thead>
          <tr>
            <th class="col-stt">STT</th>
            <th class="col-name">Họ và tên</th>
            <th class="col-pos">Chức vụ</th>
            ${showDeptCol ? '<th class="col-dept">Phòng ban</th>' : ''}
            <th class="col-code">Mã NV</th>
            <th class="col-phone">SĐT</th>
            <th class="col-act"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function empRow(p, index, ctxDeptId, u, perms, showDeptCol) {
    const stt = NS.effOrder(p, ctxDeptId || p.department);
    const sttDisp = stt === 999 ? (index + 1) : stt;
    const canEdit = perms.canEditEmployee(u, p, NS.state.managedTeams);
    const dis = p.disabled ? ' row-inactive' : '';
    const orderCell = (ctxDeptId && canEdit)
      ? `<input class="order-input" type="number" min="0" max="9999" placeholder="—"
          data-order-emp="${esc(p.id)}" data-order-dept="${esc(ctxDeptId)}"
          value="${stt === 999 ? '' : stt}" title="Thứ tự trong phòng ban">`
      : esc(sttDisp);

    return `
      <tr class="emp-row${dis}" data-emp-id="${esc(p.id)}">
        <td class="col-stt">${orderCell}</td>
        <td class="col-name"><strong>${esc(p.hoTen)}</strong></td>
        <td class="col-pos">${esc(posName(p.position) || '—')}</td>
        ${showDeptCol ? `<td class="col-dept">${esc(deptName(p.department) || '—')}</td>` : ''}
        <td class="col-code">${esc(p.employeeCode || p.code || '—')}</td>
        <td class="col-phone">${esc(p.phone || '—')}</td>
        <td class="col-act">
          ${canEdit ? `<button class="btn-icon-sm" data-act="edit-emp" data-id="${esc(p.id)}" title="Sửa">✏️</button>` : ''}
          <button class="btn-icon-sm" data-act="detail-emp" data-id="${esc(p.id)}" title="Chi tiết">👁️</button>
        </td>
      </tr>`;
  }

  function renderStats() {
    const body = document.getElementById('panelBody');
    if (!body) return;
    const list = NS.filterBySelection(state.allPersonnel);
    const active = list.filter(p => !p.disabled);
    const male = active.filter(p => p.gender === 'male' || p.gender === 'Nam').length;
    const female = active.filter(p => p.gender === 'female' || p.gender === 'Nữ').length;
    const ages = active.map(p => ageFrom(p.dateOfBirth)).filter(a => a !== null && a > 0);
    const avgAge = ages.length ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : '-';
    const newCount = active.filter(p => {
      if (!p.hireDate) return false;
      const d = p.hireDate.toDate ? p.hireDate.toDate() : new Date(p.hireDate);
      const days = (Date.now() - d.getTime()) / 86400000;
      return days < 90;
    }).length;

    // Department breakdown (only when at root/factory)
    let deptBreakdown = '';
    if (state.selection.type === 'root') {
      const counts = {};
      active.forEach(p => {
        const k = deptName(p.department) || 'Chưa có phòng ban';
        counts[k] = (counts[k] || 0) + 1;
      });
      const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
        .map(([name, n]) => `<div class="stats-row"><span class="name">🏢 ${esc(name)}</span><span class="num">${n}</span></div>`).join('');
      deptBreakdown = rows ? `<div class="stats-section"><h3>Theo phòng ban</h3>${rows}</div>` : '';
    }

    // Team breakdown when in dept or team
    let teamBreakdown = '';
    if (state.selection.type === 'department') {
      const teams = state.allTeams.filter(t => t.department === state.selection.id);
      const rows = teams.map(t => {
        const n = active.filter(p => p.team === t.id).length;
        return `<div class="stats-row"><span class="name">👥 ${esc(t.name)} <small style="color:#9ca3af">(${TEAM_TYPES[t.teamType] || ''})</small></span><span class="num">${n}</span></div>`;
      }).join('');
      teamBreakdown = rows ? `<div class="stats-section"><h3>Tổ trong phòng ban</h3>${rows}</div>` : '';
    }

    body.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="ico">👥</div><div class="val">${active.length}</div><div class="lbl">Đang làm</div></div>
        <div class="stat-card"><div class="ico">👨</div><div class="val">${male}</div><div class="lbl">Nam</div></div>
        <div class="stat-card"><div class="ico">👩</div><div class="val">${female}</div><div class="lbl">Nữ</div></div>
        <div class="stat-card"><div class="ico">🎂</div><div class="val">${avgAge}</div><div class="lbl">Tuổi TB</div></div>
        <div class="stat-card"><div class="ico">🆕</div><div class="val">${newCount}</div><div class="lbl">Mới (&lt;90d)</div></div>
      </div>
      ${deptBreakdown}
      ${teamBreakdown}
      ${renderContextInfo()}
    `;
    bindBodyClicks();
  }

  function renderContextInfo() {
    const sel = state.selection;
    if (sel.type === 'team') {
      const t = NS.team(sel.id);
      if (!t) return '';
      const mgr = state.allPersonnel.find(p => p.id === t.managerId);
      return `
        <div class="info-card">
          <h3>Thông tin tổ</h3>
          <div class="info-row"><span class="lbl">Loại tổ</span><span class="val">${esc(TEAM_TYPES[t.teamType] || '-')}</span></div>
          <div class="info-row"><span class="lbl">Phòng ban</span><span class="val">${esc(deptName(t.department))}</span></div>
          <div class="info-row"><span class="lbl">Tổ trưởng</span><span class="val">${esc(mgr?.hoTen || t.managerName || '(chưa có)')}</span></div>
          ${t.note ? `<div class="info-row"><span class="lbl">Ghi chú</span><span class="val">${esc(t.note)}</span></div>` : ''}
        </div>`;
    }
    if (sel.type === 'department') {
      const d = NS.dept(sel.id);
      if (!d) return '';
      return `
        <div class="info-card">
          <h3>Thông tin phòng ban</h3>
          <div class="info-row"><span class="lbl">Mã</span><span class="val">${esc(d.code || '-')}</span></div>
          ${d.description ? `<div class="info-row"><span class="lbl">Mô tả</span><span class="val">${esc(d.description)}</span></div>` : ''}
        </div>`;
    }
    return '';
  }

  function bindBodyClicks() {
    const body = document.getElementById('panelBody');
    if (!body) return;
    body.onclick = (e) => {
      // Don't open detail when clicking inline order input
      if (e.target.classList.contains('order-input')) return;
      const row = e.target.closest('.emp-row');
      const actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        e.stopPropagation();
        handleAction(actBtn.dataset.act, actBtn.dataset.id);
        return;
      }
      if (row) {
        handleAction('detail-emp', row.dataset.empId);
      }
    };

    // Inline order input: lưu khi blur hoặc Enter
    body.addEventListener('change', handleOrderInput);
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('order-input')) {
        e.target.blur();
      }
    });

    // Breadcrumb clicks
    document.querySelector('#panelHead .breadcrumb')?.addEventListener('click', (e) => {
      const cr = e.target.closest('[data-crumb-type]');
      if (!cr) return;
      const type = cr.dataset.crumbType;
      const id = cr.dataset.crumbId;
      if (type === 'root') {
        window.NhansuTree.selectRoot();
      } else {
        const node = document.querySelector(`#treeRoot .tnode[data-type="${type}"][data-id="${id}"]`);
        if (node) node.click();
      }
    });
  }

  function handleAction(act, id) {
    const M = window.NhansuModals;
    if (!M) return;
    switch (act) {
      case 'add-employee': M.openEmployeeForm(); break;
      case 'edit-emp':     M.openEmployeeForm(id); break;
      case 'detail-emp':   M.openEmployeeDetail(id); break;
      case 'add-dept':     M.openDeptForm(); break;
      case 'edit-dept':    M.openDeptForm(id); break;
      case 'add-team':     M.openTeamForm(null, state.selection.id); break;
      case 'edit-team':    M.openTeamForm(id); break;
      case 'assign-manager': M.openAssignManager(id); break;
      case 'manage-positions': M.openPositionsList(); break;
      case 'import':       M.openImport(); break;
      case 'export':       window.NhansuMain?.exportExcel(); break;
    }
  }

  async function handleOrderInput(e) {
    const inp = e.target;
    if (!inp.classList.contains('order-input')) return;
    const empId = inp.dataset.orderEmp;
    const deptId = inp.dataset.orderDept;
    const v = inp.value.trim();
    const newOrder = v === '' ? null : (parseInt(v, 10));
    if (newOrder !== null && (isNaN(newOrder) || newOrder < 0)) {
      NS.toast('Số không hợp lệ', 'error');
      inp.value = '';
      return;
    }
    try {
      await window.NhansuServices.setEmployeeOrder(empId, deptId, newOrder);
      // Update local cache so re-render shows new order without reload
      const p = state.allPersonnel.find(x => x.id === empId);
      if (p) {
        if (!p.orderByDept) p.orderByDept = {};
        if (newOrder === null) delete p.orderByDept[deptId];
        else p.orderByDept[deptId] = newOrder;
      }
      render();
    } catch (err) {
      NS.toast('Lỗi: ' + err.message, 'error');
    }
  }

  function setView(v) { viewMode = v; render(); }

  window.NhansuPanel = { render, setView };
})();
