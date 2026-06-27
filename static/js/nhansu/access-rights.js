/**
 * Ma trận quyền truy cập nhân sự — mô hình ERP 3 tầng.
 * Danh mục app + role đọc từ DB: /api/app-registry, /api/role-definitions
 */
(function () {
  'use strict';

  const NS = () => window.NhansuState;
  const esc = (s) => NS().esc(String(s == null ? '' : s));

  /** @type {Array<{id:string,name:string,scope:string,roles:Array<{id:string,label:string}>}>} */
  let APPS = [];
  let _catalogLoaded = false;
  let _prodTeams = [];
  let _readonly = false;

  async function loadCatalog(force) {
    if (_catalogLoaded && !force) return APPS;
    const [appsRes, rolesRes] = await Promise.all([
      fetch('/api/app-registry?assignable=true').then(r => r.json()).catch(() => ({ apps: [] })),
      fetch('/api/role-definitions?active_only=true').then(r => r.json()).catch(() => ({ roles: [] }))
    ]);
    const apps = appsRes.apps || [];
    const roles = rolesRes.roles || [];
    const rolesByApp = {};
    roles.forEach(function (r) {
      const appId = r.appId || r.app_id;
      if (!appId) return;
      if (!rolesByApp[appId]) rolesByApp[appId] = [];
      rolesByApp[appId].push({
        id: r.roleId || r.role_id,
        label: r.roleName || r.role_name || r.name || r.roleId || r.role_id,
        sortOrder: r.sortOrder || r.sort_order || 999
      });
    });
    Object.keys(rolesByApp).forEach(function (k) {
      rolesByApp[k].sort(function (a, b) {
        return (a.sortOrder || 999) - (b.sortOrder || 999);
      });
    });
    APPS = apps.map(function (a) {
      const id = a.appId || a.app_id;
      return {
        id: id,
        name: a.name || id,
        scope: a.scopeType || a.scope_type || 'department',
        roles: rolesByApp[id] || []
      };
    }).filter(function (a) { return a.roles.length > 0; });
    _catalogLoaded = true;
    return APPS;
  }

  function _roleNameById(systemRoleId) {
    const roles = NS().state.systemRoles || [];
    const hit = roles.find(r => String(r.id) === String(systemRoleId));
    return hit ? hit.role_name : '';
  }

  function _entryEnabled(entry) {
    return !!(entry && entry.roles && entry.roles.length);
  }

  function _normalizeCache(cache) {
    cache = cache && typeof cache === 'object' ? cache : {};
    const out = {};
    APPS.forEach(app => {
      const raw = cache[app.id];
      if (!raw) return;
      out[app.id] = {
        roles: Array.isArray(raw.roles) ? raw.roles.slice() : (raw.role ? [raw.role] : []),
        scopes: Object.assign({}, raw.scopes || {})
      };
    });
    return out;
  }

  /** Mẫu quyền theo vai trò tổ chức — role id phải tồn tại trong role_definitions (DB). */
  function buildTemplate(systemRoleName, ctx) {
    ctx = ctx || {};
    const dept = ctx.departmentId || '';
    const deptScope = dept ? [dept] : [];
    const allDept = ['*'];
    const allTeam = ['*'];

    function app(role, scopeKey, scopeVal) {
      const scopes = {};
      if (scopeKey === 'department') scopes.departments = scopeVal;
      if (scopeKey === 'team') scopes.teams = scopeVal;
      return { roles: [role], scopes: scopes };
    }

    function pick(appId, roleId, scopeKey, scopeVal) {
      const def = APPS.find(a => a.id === appId);
      if (!def) return null;
      const hasRole = def.roles.some(r => r.id === roleId);
      if (!hasRole) return null;
      return app(hasRole ? roleId : (def.roles[0]?.id || 'viewer'), scopeKey, scopeVal);
    }

    const out = {};
    switch (systemRoleName) {
      case 'Super_Admin':
        APPS.forEach(function (a) {
          const admin = a.roles.find(r => r.id === 'admin') || a.roles[0];
          if (!admin) return;
          if (a.scope === 'team') out[a.id] = app(admin.id, 'team', allTeam);
          else if (a.scope === 'department') out[a.id] = app(admin.id, 'department', allDept);
          else out[a.id] = app(admin.id, 'none', {});
        });
        break;
      case 'Institute_Executive':
        if (pick('nhansu', 'viewer', 'department', allDept)) out.nhansu = pick('nhansu', 'viewer', 'department', allDept);
        if (pick('sanxuat', 'viewer', 'team', allTeam)) out.sanxuat = pick('sanxuat', 'viewer', 'team', allTeam);
        if (pick('vuoncay', 'viewer', 'department', allDept)) out.vuoncay = pick('vuoncay', 'viewer', 'department', allDept);
        if (pick('baocao', 'viewer', 'department', allDept)) out.baocao = pick('baocao', 'viewer', 'department', allDept);
        if (pick('thongbao', 'viewer', 'department', allDept)) out.thongbao = pick('thongbao', 'viewer', 'department', allDept);
        break;
      case 'Department_Head':
        if (pick('nhansu', 'manager', 'department', deptScope.length ? deptScope : allDept)) {
          out.nhansu = pick('nhansu', 'manager', 'department', deptScope.length ? deptScope : allDept);
        }
        if (pick('sanxuat', 'supervisor', 'team', deptScope.length ? deptScope : allTeam)) {
          out.sanxuat = pick('sanxuat', 'supervisor', 'team', deptScope.length ? deptScope : allTeam);
        }
        if (pick('vuoncay', 'staff', 'department', deptScope)) out.vuoncay = pick('vuoncay', 'staff', 'department', deptScope);
        if (pick('baocao', 'viewer', 'department', deptScope)) out.baocao = pick('baocao', 'viewer', 'department', deptScope);
        if (pick('thongbao', 'staff', 'department', deptScope)) out.thongbao = pick('thongbao', 'staff', 'department', deptScope);
        break;
      case 'Operations_Specialist':
        if (pick('nhansu', 'staff', 'department', allDept)) out.nhansu = pick('nhansu', 'staff', 'department', allDept);
        if (pick('sanxuat', 'viewer', 'team', allTeam)) out.sanxuat = pick('sanxuat', 'viewer', 'team', allTeam);
        if (pick('baocao', 'staff', 'department', allDept)) out.baocao = pick('baocao', 'staff', 'department', allDept);
        if (pick('thongbao', 'staff', 'department', allDept)) out.thongbao = pick('thongbao', 'staff', 'department', allDept);
        break;
      case 'Technical_Staff':
        if (pick('nhansu', 'viewer', 'department', deptScope)) out.nhansu = pick('nhansu', 'viewer', 'department', deptScope);
        if (pick('sanxuat', 'staff', 'team', [])) out.sanxuat = pick('sanxuat', 'staff', 'team', []);
        if (pick('vuoncay', 'staff', 'department', deptScope)) out.vuoncay = pick('vuoncay', 'staff', 'department', deptScope);
        if (pick('thongbao', 'viewer', 'department', deptScope)) out.thongbao = pick('thongbao', 'viewer', 'department', deptScope);
        break;
      case 'Staff_Viewer':
      default:
        if (pick('nhansu', 'viewer', 'department', deptScope)) out.nhansu = pick('nhansu', 'viewer', 'department', deptScope);
        if (pick('sanxuat', 'viewer', 'team', [])) out.sanxuat = pick('sanxuat', 'viewer', 'team', []);
        if (pick('vuoncay', 'viewer', 'department', deptScope)) out.vuoncay = pick('vuoncay', 'viewer', 'department', deptScope);
        if (pick('thongbao', 'viewer', 'department', deptScope)) out.thongbao = pick('thongbao', 'viewer', 'department', deptScope);
        break;
    }
    return out;
  }

  async function _loadProdTeams() {
    if (_prodTeams.length) return _prodTeams;
    if (typeof EmployeeProductionProfile !== 'undefined') {
      _prodTeams = await EmployeeProductionProfile.loadProductionTeams();
    } else {
      try {
        const snap = await window.db.collection('categoryTeams').get();
        _prodTeams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (e) { _prodTeams = []; }
    }
    return _prodTeams;
  }

  function _scopeOptionsHtml(app, selectedScopes) {
    selectedScopes = selectedScopes || {};
    if (app.scope === 'none') {
      return '<option value="">—</option>';
    }
    if (app.scope === 'department') {
      const cur = (selectedScopes.departments || [])[0] || '';
      let html = '<option value="">Theo phòng NV</option>';
      html += '<option value="__ALL__"' + (cur === '*' ? ' selected' : '') + '>Toàn Viện</option>';
      (NS().state.departments || []).forEach(function (d) {
        const sel = cur === d.id ? ' selected' : '';
        html += '<option value="' + esc(d.id) + '"' + sel + '>' + esc(d.name) + '</option>';
      });
      return html;
    }
    if (app.scope === 'team') {
      const cur = (selectedScopes.teams || [])[0] || '';
      let html = '<option value="">Không giới hạn trạm</option>';
      html += '<option value="__ALL__"' + (cur === '*' ? ' selected' : '') + '>Mọi trạm SX</option>';
      _prodTeams.forEach(function (t) {
        const sel = cur === t.id ? ' selected' : '';
        html += '<option value="' + esc(t.id) + '"' + sel + '>' + esc(t.name || t.id) + '</option>';
      });
      return html;
    }
    return '<option value="">—</option>';
  }

  function _roleOptionsHtml(app, selectedRole) {
    if (!app.roles.length) {
      return '<option value="">— Chưa có role trong DB —</option>';
    }
    return app.roles.map(function (r) {
      const sel = r.id === selectedRole ? ' selected' : '';
      return '<option value="' + esc(r.id) + '"' + sel + '>' + esc(r.label) + '</option>';
    }).join('');
  }

  async function render(containerId, cache, opts) {
    opts = opts || {};
    _readonly = !!opts.readonly;
    await loadCatalog();
    await _loadProdTeams();

    const el = document.getElementById(containerId);
    if (!el) return;

    cache = _normalizeCache(cache || opts.cache || {});

    if (!APPS.length) {
      el.innerHTML =
        '<div class="access-rights-head">' +
        '<p class="access-hint warn">Chưa có danh mục role trong database. ' +
        'Chạy <code>supabase/migrate-role-definitions-erp.sql</code> rồi ' +
        '<code>python scripts/seed_role_definitions.py</code>, hoặc cấu hình qua app Phân quyền.</p></div>';
      return;
    }

    let rows = '';
    APPS.forEach(function (app) {
      const entry = cache[app.id];
      const enabled = _entryEnabled(entry);
      const role = enabled ? (entry.roles[0] || app.roles[0]?.id || 'viewer') : (app.roles[0]?.id || 'viewer');
      const scopes = enabled ? (entry.scopes || {}) : {};
      const dis = _readonly ? ' disabled' : '';
      rows += '<tr data-app="' + esc(app.id) + '">' +
        '<td><label class="access-check"><input type="checkbox" class="access-enable"' + (enabled ? ' checked' : '') + dis + '> ' + esc(app.name) + '</label></td>' +
        '<td><select class="form-input access-role"' + dis + '>' + _roleOptionsHtml(app, role) + '</select></td>' +
        '<td><select class="form-input access-scope"' + dis + '>' + _scopeOptionsHtml(app, scopes) + '</select></td>' +
        '</tr>';
    });

    el.innerHTML =
      '<div class="access-rights-head">' +
        '<p class="access-hint">Mô hình ERP: <strong>Vai trò tổ chức</strong> → áp mẫu → tinh chỉnh quyền từng app. ' +
        'Danh sách role lấy từ bảng <code>role_definitions</code> — sửa tên/quyền trong DB hoặc app Phân quyền.</p>' +
        (_readonly ? '' :
          '<button type="button" class="btn btn-sm" id="btnApplyAccessTemplate">⚡ Áp dụng mẫu theo vai trò tổ chức</button>') +
      '</div>' +
      '<div class="access-matrix-wrap"><table class="access-matrix">' +
        '<thead><tr><th>Ứng dụng</th><th>Vai trò trong app</th><th>Phạm vi dữ liệu</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';

    if (!_readonly) {
      const btn = document.getElementById('btnApplyAccessTemplate');
      if (btn) btn.onclick = applyTemplateFromForm;
      el.querySelectorAll('.access-enable').forEach(function (cb) {
        cb.onchange = function () {
          const tr = cb.closest('tr');
          const on = cb.checked;
          tr.querySelectorAll('.access-role, .access-scope').forEach(function (sel) {
            sel.disabled = !on || _readonly;
          });
        };
        cb.dispatchEvent(new Event('change'));
      });
    }
  }

  async function applyTemplateFromForm() {
    await loadCatalog();
    const systemRoleId = (document.getElementById('inputSystemRole') || {}).value;
    const deptId = (document.getElementById('inputDepartment') || {}).value || '';
    const roleName = _roleNameById(systemRoleId);
    const template = buildTemplate(roleName, { departmentId: deptId });
    await render('accessRightsRoot', template, { readonly: _readonly });
    NS().toast('Đã áp dụng mẫu quyền: ' + (window.NhansuState.getSystemRoleLabel(roleName) || roleName), 'info');
  }

  function collect() {
    const root = document.getElementById('accessRightsRoot');
    const cache = {};
    if (!root) return cache;

    root.querySelectorAll('tbody tr[data-app]').forEach(function (tr) {
      const appId = tr.dataset.app;
      const app = APPS.find(a => a.id === appId);
      if (!app) return;
      const enabled = tr.querySelector('.access-enable')?.checked;
      if (!enabled) return;
      const role = tr.querySelector('.access-role')?.value || app.roles[0]?.id || 'viewer';
      const scopeVal = tr.querySelector('.access-scope')?.value || '';
      const scopes = {};
      if (app.scope === 'department') {
        if (scopeVal === '__ALL__') scopes.departments = ['*'];
        else if (scopeVal) scopes.departments = [scopeVal];
        else {
          const dept = (document.getElementById('inputDepartment') || {}).value;
          if (dept) scopes.departments = [dept];
        }
      } else if (app.scope === 'team') {
        if (scopeVal === '__ALL__') scopes.teams = ['*'];
        else if (scopeVal) scopes.teams = [scopeVal];
        else scopes.teams = [];
      }
      cache[appId] = { roles: [role], scopes: scopes };
    });
    return cache;
  }

  function _roleLabel(appId, roleId) {
    const app = APPS.find(a => a.id === appId);
    const hit = app?.roles?.find(r => r.id === roleId);
    return hit ? hit.label : roleId;
  }

  function summarize(cache) {
    cache = _normalizeCache(cache);
    const lines = [];
    APPS.forEach(function (app) {
      const e = cache[app.id];
      if (!_entryEnabled(e)) return;
      const role = e.roles[0] || 'viewer';
      let scope = '';
      if (app.scope === 'department') {
        const d = (e.scopes.departments || [])[0];
        if (d === '*') scope = ' · Toàn Viện';
        else if (d) {
          const dept = (NS().state.departments || []).find(x => x.id === d);
          scope = ' · ' + (dept?.name || d);
        }
      } else if (app.scope === 'team') {
        const t = (e.scopes.teams || [])[0];
        if (t === '*') scope = ' · Mọi trạm';
        else if (t) {
          const team = _prodTeams.find(x => x.id === t);
          scope = ' · ' + (team?.name || t);
        }
      }
      lines.push('<li><strong>' + esc(app.name) + '</strong>: ' + esc(_roleLabel(app.id, role)) + scope + '</li>');
    });
    if (!lines.length) return '<p class="muted">Chưa cấp quyền app nào (chỉ vai trò tổ chức).</p>';
    return '<ul class="access-summary">' + lines.join('') + '</ul>';
  }

  window.NhansuAccessRights = {
    loadCatalog,
    getApps: function () { return APPS.slice(); },
    buildTemplate,
    render,
    collect,
    summarize,
    applyTemplateFromForm
  };
})();
