/* tree.js — OrgTree builder + renderer
 * Builds tree from departments + teams + personnel (counts) and renders to #treeRoot.
 * Handles expand/collapse, click selection, search filter.
 */
(function () {
  'use strict';

  const { state, getFactories, esc, effFactory, sortByOrder } = window.NhansuState;

  // Build tree data structure.
  // Hierarchy:
  //   Toàn công ty
  //     ├ Nhà máy A01 → các phòng ban thuộc A01 → tổ
  //     ├ Nhà máy A02 → các phòng ban thuộc A02 → tổ
  //     └ Các Ban / Phòng cấp công ty (không thuộc nhà máy nào) → tổ
  function build() {
    const personnel = state.allPersonnel;
    const depts = state.departments;
    const teams = state.allTeams;

    const totalCount = personnel.filter(p => !p.disabled).length;
    const peffF = new Map();
    personnel.forEach(p => peffF.set(p.id, effFactory(p)));

    function buildDeptNode(d, factoryId) {
      const deptTeams = teams.filter(t => t.department === d.id);
      const matchFactory = (p) => factoryId ? peffF.get(p.id) === factoryId : true;
      const childNodes = deptTeams.map(t => ({
        type: 'team',
        id: t.id,
        label: t.name,
        icon: '👥',
        order: t.order ?? 999,
        count: personnel.filter(p => p.team === t.id && matchFactory(p) && !p.disabled).length,
        deptId: d.id,
        factoryId: factoryId || undefined
      }));
      const noTeamCount = personnel.filter(p =>
        p.department === d.id && !p.team && matchFactory(p) && !p.disabled
      ).length;
      // "Trực thuộc phòng" — NV không thuộc tổ con nào (default group, đặt đầu)
      if (noTeamCount > 0 && deptTeams.length > 0) {
        childNodes.push({
          type: 'unteamed',
          id: `unteamed_${d.id}_${factoryId || 'co'}`,
          label: 'Trực thuộc phòng',
          icon: '👤',
          order: 0,
          count: noTeamCount,
          deptId: d.id,
          factoryId: factoryId || undefined
        });
      }
      const teamNodes = sortByOrder(childNodes);
      return {
        type: 'department',
        id: d.id,
        label: d.name,
        icon: '🏢',
        order: d.order,
        count: personnel.filter(p =>
          (p.department === d.id ||
            (p.concurrentPositions || []).some(cp => cp.departmentId === d.id))
          && matchFactory(p) && !p.disabled
        ).length,
        factoryId: factoryId || undefined,
        children: teamNodes
      };
    }

    // Factory nodes — chỉ chứa phòng ban có dept.factory === f.id
    const factoryNodes = getFactories().map(f => {
      const factDepts = sortByOrder(
        depts.filter(d => d.factory === f.id).map(d => buildDeptNode(d, f.id))
      );
      return {
        type: 'factory',
        id: f.id,
        label: f.name,
        icon: f.icon,
        order: f.order,
        count: personnel.filter(p => peffF.get(p.id) === f.id && !p.disabled).length,
        children: factDepts
      };
    });

    // Phòng ban cấp công ty — không có factory
    const companyDeptNodes = depts
      .filter(d => !d.factory)
      .map(d => buildDeptNode(d, null));

    // Top-level: factories + company depts gộp lại, sort theo order
    const topLevel = sortByOrder([...factoryNodes, ...companyDeptNodes]);

    return {
      type: 'root',
      id: 'root',
      label: 'Toàn công ty',
      icon: '🏛️',
      count: totalCount,
      children: topLevel
    };
  }

  // Render
  function render() {
    const root = document.getElementById('treeRoot');
    if (!root) return;
    const tree = build();
    root.innerHTML = renderNode(tree, 0);
    bindClicks(root);
  }

  function renderNode(node, depth) {
    const sel = state.selection;
    const isSelected = sel.type === node.type && sel.id === node.id;
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = state.expanded.has(node.id);
    const cls = ['tnode'];
    if (isSelected) cls.push('selected');
    if (!hasChildren) cls.push('leaf');
    if (isExpanded) cls.push('expanded');

    const dataAttrs = `data-type="${node.type}" data-id="${esc(node.id)}"` +
      (node.deptId ? ` data-dept-id="${esc(node.deptId)}"` : '') +
      (node.factoryId ? ` data-factory-id="${esc(node.factoryId)}"` : '');

    let html = `<div class="${cls.join(' ')}" ${dataAttrs}>` +
      `<span class="twist">▶</span>` +
      `<span class="ico">${esc(node.icon)}</span>` +
      `<span class="lbl">${esc(node.label)}</span>` +
      `<span class="cnt">${node.count || 0}</span>` +
      `</div>`;

    if (hasChildren) {
      html += `<div class="tchildren${isExpanded ? ' open' : ''}" data-parent="${esc(node.id)}">`;
      node.children.forEach(child => { html += renderNode(child, depth + 1); });
      html += `</div>`;
    }
    return html;
  }

  function bindClicks(root) {
    root.onclick = (e) => {
      const node = e.target.closest('.tnode');
      if (!node) return;
      const type = node.dataset.type;
      const id = node.dataset.id;
      const isTwist = e.target.classList.contains('twist');
      const hasChildren = !node.classList.contains('leaf');

      // Twist toggle, OR clicking same selected node toggles
      if (isTwist && hasChildren) {
        toggleExpand(id);
        return;
      }

      // Select
      const sel = { type, id, label: node.querySelector('.lbl').textContent };
      if (node.dataset.deptId) sel.deptId = node.dataset.deptId;
      if (node.dataset.factoryId) sel.factoryId = node.dataset.factoryId;
      state.selection = sel;

      // Auto-expand on click if has children and not expanded
      if (hasChildren && !state.expanded.has(id)) {
        state.expanded.add(id);
      }

      render();
      window.NhansuPanel?.render();
      // Close drawer on mobile after select
      if (window.innerWidth < 768 && type !== 'root' && type !== 'factory') {
        closeDrawer();
      }
    };
  }

  function toggleExpand(id) {
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    render();
  }

  function expandAll() {
    const tree = build();
    walk(tree, n => state.expanded.add(n.id));
    render();
  }
  function collapseAll() {
    state.expanded.clear();
    state.expanded.add('root');
    render();
  }
  function walk(node, fn) {
    fn(node);
    (node.children || []).forEach(c => walk(c, fn));
  }

  // Drawer toggle (mobile)
  function openDrawer() {
    document.getElementById('treeSidebar')?.classList.add('open');
    document.getElementById('drawerBackdrop')?.classList.add('open');
  }
  function closeDrawer() {
    document.getElementById('treeSidebar')?.classList.remove('open');
    document.getElementById('drawerBackdrop')?.classList.remove('open');
  }
  function toggleDrawer() {
    const isOpen = document.getElementById('treeSidebar')?.classList.contains('open');
    if (isOpen) closeDrawer(); else openDrawer();
  }

  // Reset selection to root
  function selectRoot() {
    state.selection = { type: 'root', id: 'root', label: 'Toàn công ty' };
    state.expanded.add('root');
    render();
    window.NhansuPanel?.render();
  }

  window.NhansuTree = {
    render, build, expandAll, collapseAll,
    openDrawer, closeDrawer, toggleDrawer, selectRoot
  };
})();
