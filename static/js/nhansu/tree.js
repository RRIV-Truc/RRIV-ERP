/* tree.js — Cây tổ chức Viện (Ban/Phòng/Trung tâm — không nhà máy) */
(function () {
  'use strict';

  const { state, esc, sortByOrder, ROOT_LABEL, personInDept, personInTeam } = window.NhansuState;

  function build() {
    const personnel = state.allPersonnel;
    const depts = state.departments;
    const teams = state.allTeams;

    const totalCount = personnel.filter(p => !p.disabled).length;

    function buildDeptNode(d) {
      const deptTeams = sortByOrder(
        teams.filter(t => t.department === d.id && !t.metadata?.retired)
      );
      const childNodes = deptTeams.map(t => ({
        type: 'team',
        id: t.id,
        label: t.name,
        icon: '👥',
        order: t.order ?? 999,
        count: personnel.filter(p => personInTeam(p, t.id) && !p.disabled).length,
        deptId: d.id
      }));
      const noTeamCount = personnel.filter(p =>
        personInDept(p, d.id) && !p.team && !p.disabled
      ).length;
      if (noTeamCount > 0 && deptTeams.length > 0 && d.id !== 'dl-3') {
        childNodes.push({
          type: 'unteamed',
          id: `unteamed_${d.id}`,
          label: 'Trực thuộc phòng',
          icon: '👤',
          order: 0,
          count: noTeamCount,
          deptId: d.id
        });
      }
      return {
        type: 'department',
        id: d.id,
        label: d.name,
        icon: deptIcon(d),
        order: d.order ?? d.metadata?.order ?? 999,
        count: personnel.filter(p => personInDept(p, d.id) && !p.disabled).length,
        children: sortByOrder(childNodes)
      };
    }

    function deptIcon(d) {
      const t = (d.dept_type || d.metadata?.dept_type || '').toLowerCase();
      if (t.includes('ban')) return '🏛️';
      if (t.includes('trung')) return '🔬';
      return '🏢';
    }

    const topLevel = sortByOrder(depts.map(buildDeptNode));

    return {
      type: 'root',
      id: 'root',
      label: ROOT_LABEL,
      icon: '🌿',
      count: totalCount,
      children: topLevel
    };
  }

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
      (node.deptId ? ` data-dept-id="${esc(node.deptId)}"` : '');

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

      if (isTwist && hasChildren) {
        toggleExpand(id);
        return;
      }

      const sel = { type, id, label: node.querySelector('.lbl').textContent };
      if (node.dataset.deptId) sel.deptId = node.dataset.deptId;
      state.selection = sel;

      if (hasChildren && !state.expanded.has(id)) {
        state.expanded.add(id);
      }

      render();
      window.NhansuPanel?.render();
      if (window.innerWidth < 768 && type !== 'root') {
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

  function selectRoot() {
    state.selection = { type: 'root', id: 'root', label: ROOT_LABEL };
    state.expanded.add('root');
    render();
    window.NhansuPanel?.render();
  }

  window.NhansuTree = {
    render, build, expandAll, collapseAll,
    openDrawer, closeDrawer, toggleDrawer, selectRoot
  };
})();
