/**
 * Tab 6: Quản Trị - Nhân sự, Bộ phận, Chức vụ, TCCS
 * Tái sử dụng collections: categoryPersonnel, categoryDepartments, categoryPositions
 * Riêng TCCS: admin_tccs_overrides
 * @module TabAdmin
 * @depends SanxuatFactories, TCCSSpecs, SanxuatStages, SanxuatParams
 */

const TabAdmin = (function() {
  'use strict';

  // === State ===
  let currentSubTab = 0;
  let personnel = [];
  let departments = [];
  let positions = [];
  let tccsOverrides = {};
  let selectedTCCS = '101';
  let lastFactory = null;
  let parentDeptId = null;   // Firestore doc ID of the factory's parent department
  let parentDeptDoc = null;  // Full data of the parent department
  let _secondaryApp = null;
  let _secondaryAuth = null;
  let _employeeProdMap = {};
  let _workGroupLabelMap = {};
  let orgUnits = [];

  /** 3 Trung tâm + 2 Phòng nghiệp vụ (category_departments dl-2 … dl-6) */
  var ORG_UNIT_IDS = ['dl-2', 'dl-3', 'dl-4', 'dl-5', 'dl-6'];
  var ORG_UNITS_FALLBACK = [
    { id: 'dl-2', name: 'Trung t\u00E2m nghi\u00EAn c\u1EE9u ph\u00E1t tri\u1EC3n s\u1EA3n ph\u1EA9m m\u1EDBi', dept_type: 'Trung T\u00E2m' },
    { id: 'dl-3', name: 'Trung t\u00E2m nghi\u00EAn c\u1EE9u ph\u00E1t tri\u1EC3n Gi\u1ED1ng cao su', dept_type: 'Trung T\u00E2m' },
    { id: 'dl-4', name: 'Trung t\u00E2m nghi\u00EAn c\u1EE9u \u1EE9ng d\u1EE5ng n\u00F4ng nghi\u1EC7p c\u00F4ng ngh\u1EC7 cao v\u00E0 chuy\u1EC3n giao k\u1EF9 thu\u1EADt', dept_type: 'Trung T\u00E2m' },
    { id: 'dl-5', name: 'Ph\u00F2ng khoa h\u1ECDc - c\u00F4ng ngh\u1EC7', dept_type: 'Ph\u00F2ng Nghi\u1EC7p V\u1EE5' },
    { id: 'dl-6', name: 'Ph\u00F2ng qu\u1EA3n tr\u1ECB - t\u00E0i ch\u00EDnh k\u1EBF to\u00E1n', dept_type: 'Ph\u00F2ng Nghi\u1EC7p V\u1EE5' }
  ];

  /** Chức vụ mặc định — luôn có trong dropdown thêm nhân sự */
  var STANDARD_POSITIONS = [
    { id: 'pos-giam-doc', name: 'Gi\u00E1m \u0111\u1ED1c', level: 1 },
    { id: 'pos-pho-giam-doc', name: 'Ph\u00F3 gi\u00E1m \u0111\u1ED1c', level: 2 },
    { id: 'pos-truong-phong', name: 'Tr\u01B0\u1EDFng ph\u00F2ng', level: 3 },
    { id: 'pos-pho-phong', name: 'Ph\u00F3 ph\u00F2ng', level: 4 },
    { id: 'pos-phu-trach', name: 'Ph\u1EE5 tr\u00E1ch b\u1ED9 ph\u1EADn', level: 5 },
    { id: 'pos-nhan-vien', name: 'Nh\u00E2n vi\u00EAn', level: 6 }
  ];

  // === Helpers ===
  function _db() { return ErpDb.firestore(); }
  function _user() { return window.currentUser; }
  function _factory() { return window.currentFactory; }
  function _toast(msg, type) { if (window.showToast) window.showToast(msg, type); }
  function _el(id) { return document.getElementById(id); }
  function _ts() { return ErpDb.firestore.FieldValue.serverTimestamp(); }

  // ==================== INIT & SUB-TAB NAV ====================

  function init() {
    var factory = _factory();
    // Reload departments when factory changes
    if (lastFactory !== factory) {
      lastFactory = factory;
      parentDeptId = null;
      parentDeptDoc = null;
      departments = [];
      personnel = [];
      orgUnits = [];
      loadDepartments();
      loadOrgUnits();
      loadPositions();
    }
    showSubTab(currentSubTab);
  }

  function showSubTab(idx) {
    currentSubTab = idx;
    var btns = document.querySelectorAll('#tab6 .sub-tab');
    btns.forEach(function(b, i) { b.classList.toggle('active', i === idx); });
    for (var i = 0; i <= 3; i++) {
      var el = _el('adminSubTab' + i);
      if (el) el.style.display = (i === idx) ? 'block' : 'none';
    }
    switch (idx) {
      case 0: loadPersonnel(); break;
      case 1: renderDepartments(); break;
      case 2: loadPositions().then(function() { renderPositions(); }); break;
      case 3: loadTCCSOverrides(); break;
    }
  }

  async function _loadEmployeeProductionMaps() {
    _employeeProdMap = {};
    _workGroupLabelMap = {};
    try {
      if (typeof EmployeeProductionProfile !== 'undefined') {
        var groups = await EmployeeProductionProfile.loadWorkGroups();
        groups.forEach(function (g) {
          _workGroupLabelMap[g.id] = g.code || g.name || g.id;
        });
      }
      var snap = await _db().collection('employee').get();
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        _employeeProdMap[doc.id] = {
          employee_code: d.employee_code || '',
          team_id: d.team_id || '',
          team_name: d.team_name || '',
          work_group_id: d.work_group_id || ''
        };
      });
    } catch (e) {
      console.warn('_loadEmployeeProductionMaps:', e.message);
    }
  }

  function _prodMeta(personId) {
    return _employeeProdMap[personId] || {};
  }

  function _workGroupLabel(groupId) {
    if (!groupId) return '';
    return _workGroupLabelMap[groupId] || groupId;
  }
  function _deptType(d) {
    return d.dept_type || (d.metadata && d.metadata.dept_type) || '';
  }

  function _isOrgUnit(d) {
    if (!d || d.id === 'dl-1') return false;
    if (ORG_UNIT_IDS.indexOf(d.id) !== -1) return true;
    var t = _deptType(d);
    return t === 'Trung T\u00E2m' || t === 'Ph\u00F2ng Nghi\u1EC7p V\u1EE5';
  }

  async function loadOrgUnits() {
    try {
      var snap = await _db().collection('categoryDepartments').get();
      orgUnits = [];
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        d.id = doc.id;
        if (d.active === false) return;
        if (_isOrgUnit(d)) orgUnits.push(d);
      });
      if (!orgUnits.length) orgUnits = ORG_UNITS_FALLBACK.slice();
      orgUnits.sort(function (a, b) {
        var ta = _deptType(a), tb = _deptType(b);
        if (ta !== tb) {
          if (ta === 'Trung T\u00E2m') return -1;
          if (tb === 'Trung T\u00E2m') return 1;
        }
        return (a.name || '').localeCompare(b.name || '', 'vi');
      });
    } catch (e) {
      console.error('loadOrgUnits error:', e);
      orgUnits = ORG_UNITS_FALLBACK.slice();
    }
  }

  function _getOrgUnitName(unitId) {
    if (!unitId) return '';
    var found = orgUnits.find(function (u) { return u.id === unitId || u.name === unitId; });
    return found ? found.name : '';
  }

  function _getSecondaryAuth() {
    if (!_secondaryApp) {
      var config = ErpDb.app().options;
      _secondaryApp = ErpDb.initializeApp(config, 'SanxuatSecondary');
      _secondaryAuth = _secondaryApp.auth();
    }
    return _secondaryAuth;
  }

  // ==================== NHÂN SỰ (categoryPersonnel) ====================

  async function loadPersonnel() {
    try {
      // Load departments & positions for this factory first (if not loaded)
      if (!orgUnits.length) await loadOrgUnits();
      if (!departments.length && !parentDeptId) await loadDepartments();
      if (!positions.length) await loadPositions();

      // Build lookup: đơn vị Viện + phòng ban nhà máy
      var validDeptIds = [];
      var validDeptNames = [];
      orgUnits.forEach(function (u) {
        validDeptIds.push(u.id);
        if (u.name) validDeptNames.push(u.name);
      });
      // Include the parent department itself (e.g. "Nhà máy chế biến Cao su Cua paris")
      if (parentDeptId) {
        validDeptIds.push(parentDeptId);
        if (parentDeptDoc && parentDeptDoc.name) validDeptNames.push(parentDeptDoc.name);
      }
      // Include all child departments
      departments.forEach(function(d) {
        validDeptIds.push(d.id);
        if (d.name) validDeptNames.push(d.name);
      });

      var snap = await _db().collection('categoryPersonnel')
        .where('status', '==', 'active')
        .get();

      var factory = _factory();
      personnel = [];
      snap.forEach(function(doc) {
        var d = doc.data();
        d.id = doc.id;
        var dept = d.department || '';
        // Match by: factory field OR department belongs to this factory's hierarchy
        var matchByFactory = d.factory && d.factory === factory;
        var matchByDept = dept && (validDeptIds.indexOf(dept) !== -1 || validDeptNames.indexOf(dept) !== -1);
        if (matchByFactory || matchByDept) {
          personnel.push(d);
        }
      });
      personnel.sort(function(a, b) { return (a.hoTen || '').localeCompare(b.hoTen || ''); });
      await _loadEmployeeProductionMaps();
      renderPersonnelTable(true);
    } catch (e) {
      console.error('loadPersonnel error:', e);
      _toast('Lỗi tải nhân sự', 'error');
    }
  }

  function renderPersonnelTable(forceFullRender) {
    var container = _el('adminSubTab0');
    if (!container) return;

    // Only render toolbar once, then update table body on search
    var tableBody = container.querySelector('#personnelTableBody');
    if (!tableBody || forceFullRender) {
      // Full render (first time or after data reload)
      var html = '<div class="admin-toolbar">' +
        '<button class="btn btn-primary btn-sm" onclick="TabAdmin.openPersonnelModal()">+ Thêm nhân sự</button>' +
        '<input class="admin-search-input" id="personnelSearch" type="text" placeholder="Tìm kiếm theo tên, SĐT..." oninput="TabAdmin.filterPersonnel()">' +
        '</div>';
      html += '<div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr><th>STT</th><th>M\u00E3 NV</th><th>H\u1ECD v\u00E0 T\u00EAn</th><th>T\u1ED5 SX</th><th>Nh\u00F3m</th>' +
        '<th>Ch\u1EE9c v\u1EE5</th><th>B\u1ED9 ph\u1EADn</th><th>S\u0110T</th><th>Thao t\u00E1c</th></tr></thead>' +
        '<tbody id="personnelTableBody"></tbody></table></div>';
      container.innerHTML = html;
      tableBody = _el('personnelTableBody');
    }

    var searchVal = (_el('personnelSearch') || {}).value || '';
    var filtered = personnel;
    if (searchVal) {
      var kw = searchVal.toLowerCase();
      filtered = personnel.filter(function(p) {
        return (p.hoTen || '').toLowerCase().indexOf(kw) !== -1 ||
               (p.phone || '').indexOf(kw) !== -1 ||
               _getDepartmentName(p.department).toLowerCase().indexOf(kw) !== -1 ||
               _getPositionName(p.position).toLowerCase().indexOf(kw) !== -1;
      });
    }

    var rows = '';
    if (!filtered.length) {
      rows = '<tr><td colspan="9" style="text-align:center;color:var(--text-secondary)">' +
        (searchVal ? 'Kh\u00F4ng t\u00ECm th\u1EA5y nh\u00E2n s\u1EF1 ph\u00F9 h\u1EE3p' : 'Ch\u01B0a c\u00F3 nh\u00E2n s\u1EF1') + '</td></tr>';
    } else {
      filtered.forEach(function(p, i) {
        var posName = _getPositionName(p.position);
        var deptName = _getDepartmentName(p.department);
        var prod = _prodMeta(p.id);
        rows += '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td>' + (prod.employee_code || '') + '</td>' +
          '<td><strong>' + (p.hoTen || p.name || '') + '</strong></td>' +
          '<td>' + (prod.team_name || '') + '</td>' +
          '<td>' + _workGroupLabel(prod.work_group_id) + '</td>' +
          '<td>' + posName + '</td>' +
          '<td>' + deptName + '</td>' +
          '<td>' + (p.phone || '') + '</td>' +
          '<td class="admin-actions">' +
            '<button class="btn-icon" onclick="TabAdmin.openPersonnelModal(\'' + p.id + '\')" title="S\u1EEDa">\u270F\uFE0F</button>' +
            '<button class="btn-icon btn-danger-icon" onclick="TabAdmin.togglePersonnelStatus(\'' + p.id + '\')" title="V\u00F4 hi\u1EC7u h\u00F3a">\uD83D\uDEAB</button>' +
          '</td></tr>';
      });
    }
    tableBody.innerHTML = rows;
  }

  function filterPersonnel() {
    renderPersonnelTable(false);
  }

  function _getPositionName(posId) {
    if (!posId) return '';
    var found = positions.find(function(p) { return p.id === posId; });
    return found ? found.name : posId;
  }

  function _getDepartmentName(deptId) {
    if (!deptId) return '';
    var orgName = _getOrgUnitName(deptId);
    if (orgName) return orgName;
    // Check parent department first
    if (parentDeptDoc && (deptId === parentDeptId || deptId === parentDeptDoc.name)) {
      return parentDeptDoc.name;
    }
    var found = departments.find(function(d) { return d.id === deptId || d.name === deptId; });
    return found ? found.name : deptId;
  }

  async function openPersonnelModal(id) {
    if (!positions.length) await loadPositions();
    if (!orgUnits.length) await loadOrgUnits();
    if (!departments.length && !parentDeptId) await loadDepartments();

    var p = id ? personnel.find(function(x) { return x.id === id; }) : null;
    var isEdit = !!p;
    var title = isEdit ? 'S\u1EEDa nh\u00E2n s\u1EF1' : 'Th\u00EAm nh\u00E2n s\u1EF1 m\u1EDBi';

    // Đơn vị: 3 Trung tâm + 2 Phòng nghiệp vụ
    var selectedUnit = '';
    if (p) {
      if (orgUnits.some(function (u) { return u.id === p.department; })) {
        selectedUnit = p.department;
      } else if (_getOrgUnitName(p.department)) {
        selectedUnit = p.department;
      }
    }
    var unitOpts = orgUnits.map(function (u) {
      var sel = (selectedUnit === u.id) ? ' selected' : '';
      var tag = _deptType(u) === 'Trung T\u00E2m' ? 'TT' : 'Ph\u00F2ng';
      return '<option value="' + u.id + '"' + sel + '>[' + tag + '] ' + (u.name || u.id) + '</option>';
    }).join('');

    // Bộ phận con (tuỳ chọn — ca SX, QL… trong nhà máy)
    var allDeptOptions = [];
    if (parentDeptDoc) {
      allDeptOptions.push({ id: parentDeptId, name: parentDeptDoc.name });
    }
    departments.forEach(function(d) { allDeptOptions.push(d); });

    var deptOpts = allDeptOptions.map(function(d) {
      var sel = (p && p.department === d.id) ? ' selected' : '';
      return '<option value="' + d.id + '"' + sel + '>' + d.name + '</option>';
    }).join('');

    var posOpts = positions.map(function(pos) {
      var sel = (p && p.position === pos.id) ? ' selected' : '';
      return '<option value="' + pos.id + '"' + sel + '>' + pos.name + '</option>';
    }).join('');

    var prod = id ? (_prodMeta(id) || {}) : {};
    if (id && typeof EmployeeProductionProfile !== 'undefined') {
      try {
        var fresh = await EmployeeProductionProfile.getEmployeeProductionFields(id);
        prod = {
          employee_code: fresh.employee_code || prod.employee_code || '',
          team_id: fresh.team_id || prod.team_id || '',
          work_group_id: fresh.work_group_id || prod.work_group_id || ''
        };
      } catch (e) { /* ignore */ }
    }

    var teams = [];
    var groupOpts = '<option value="">— Chọn nhóm —</option>';
    if (typeof EmployeeProductionProfile !== 'undefined') {
      teams = await EmployeeProductionProfile.loadProductionTeams();
      var groups = await EmployeeProductionProfile.loadWorkGroups(prod.team_id || '');
      groupOpts = EmployeeProductionProfile.workGroupOptionsHtml(groups, prod.work_group_id || '');
    }
    var teamOpts = typeof EmployeeProductionProfile !== 'undefined'
      ? EmployeeProductionProfile.teamOptionsHtml(teams, prod.team_id || '')
      : '<option value="">—</option>';

    // Username/Password fields (chỉ hiện khi thêm mới)
    var authFields = '';
    if (!isEdit) {
      authFields =
        '<div class="form-group"><label>T\u00EAn \u0111\u0103ng nh\u1EADp (username) *</label>' +
          '<input type="text" id="adm_username" class="form-control" placeholder="VD: nguyenvana">' +
          '<small style="color:var(--text-secondary);font-size:12px">S\u1EBD t\u1EA1o t\u00E0i kho\u1EA3n: username@phr.vn</small></div>' +
        '<div class="form-group"><label>M\u1EADt kh\u1EA9u *</label>' +
          '<input type="password" id="adm_password" class="form-control" placeholder="T\u1ED1i thi\u1EC3u 6 k\u00FD t\u1EF1"></div>';
    }

    var html = '<div class="modal-overlay active" id="adminModal">' +
      '<div class="modal" style="max-width:500px">' +
      '<div class="modal-header"><h3>' + title + '</h3><button class="modal-close" onclick="TabAdmin.closeModal()">\u00D7</button></div>' +
      '<div class="modal-body">' +
        '<div class="form-group"><label>H\u1ECD v\u00E0 T\u00EAn *</label>' +
          '<input type="text" id="adm_hoTen" class="form-control" value="' + (p ? (p.hoTen || p.name || '') : '') + '"></div>' +
        authFields +
        '<div class="form-group"><label>\u0110\u01A1n v\u1ECB *</label>' +
          '<select id="adm_unit" class="form-control"><option value="">-- Ch\u1ECDn \u0111\u01A1n v\u1ECB --</option>' + unitOpts + '</select></div>' +
        '<div class="form-group"><label>B\u1ED9 ph\u1EADn</label>' +
          '<select id="adm_department" class="form-control"><option value="">-- Ch\u1ECDn --</option>' + deptOpts + '</select></div>' +
        '<div class="form-group"><label>Ch\u1EE9c v\u1EE5</label>' +
          '<select id="adm_position" class="form-control"><option value="">-- Ch\u1ECDn --</option>' + posOpts + '</select></div>' +
        '<div class="form-group"><label>S\u1ED1 \u0111i\u1EC7n tho\u1EA1i</label>' +
          '<input type="tel" id="adm_phone" class="form-control" value="' + (p ? (p.phone || '') : '') + '"></div>' +
        '<hr style="margin:12px 0;border:none;border-top:1px solid var(--border,#e2e8f0)">' +
        '<p style="font-size:12px;color:var(--text-secondary);margin:0 0 8px">Sản xuất cạo mủ — hiển thị trong tab Sản lượng CN</p>' +
        '<div class="form-group"><label>M\u00E3 NV</label>' +
          '<input type="text" id="adm_employee_code" class="form-control" placeholder="VD: LK-CN-040" value="' + (prod.employee_code || '') + '"></div>' +
        '<div class="form-group"><label>T\u1ED5 s\u1EA3n xu\u1EA5t</label>' +
          '<select id="adm_prod_team" class="form-control">' + teamOpts + '</select></div>' +
        '<div class="form-group"><label>Nh\u00F3m (CN / KH)</label>' +
          '<select id="adm_work_group" class="form-control">' + groupOpts + '</select></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="TabAdmin.closeModal()">H\u1EE7y</button>' +
        '<button class="btn btn-primary" onclick="TabAdmin.savePersonnel(\'' + (id || '') + '\')">L\u01B0u</button>' +
      '</div></div></div>';

    document.body.insertAdjacentHTML('beforeend', html);

    var teamSel = _el('adm_prod_team');
    var groupSel = _el('adm_work_group');
    if (teamSel && groupSel && typeof EmployeeProductionProfile !== 'undefined') {
      teamSel.onchange = function () {
        EmployeeProductionProfile.fillWorkGroupSelect(groupSel, teamSel.value, '');
      };
    }
  }

  async function savePersonnel(id) {
    var hoTen = (_el('adm_hoTen') || {}).value || '';
    if (!hoTen.trim()) { _toast('Vui l\u00F2ng nh\u1EADp h\u1ECD t\u00EAn', 'error'); return; }

    var unitId = (_el('adm_unit') || {}).value || '';
    var dept = (_el('adm_department') || {}).value || '';
    var pos = (_el('adm_position') || {}).value || '';
    var phone = (_el('adm_phone') || {}).value || '';

    if (!unitId && !dept) {
      _toast('Vui l\u00F2ng ch\u1ECDn \u0111\u01A1n v\u1ECB', 'error');
      return;
    }

    var data = {
      hoTen: hoTen.trim(),
      name: hoTen.trim(),
      department: dept || unitId,
      position: pos,
      phone: phone.trim(),
      updatedAt: _ts()
    };

    try {
      var savedId = id;
      if (id) {
        // === CẬP NHẬT ===
        await _db().collection('categoryPersonnel').doc(id).update(data);
        _toast('C\u1EADp nh\u1EADt nh\u00E2n s\u1EF1 th\u00E0nh c\u00F4ng', 'success');
      } else {
        // === THÊM MỚI — tạo tài khoản Firebase Auth ===
        var username = (_el('adm_username') || {}).value || '';
        var password = (_el('adm_password') || {}).value || '';

        if (!username.trim()) {
          _toast('Vui l\u00F2ng nh\u1EADp t\u00EAn \u0111\u0103ng nh\u1EADp', 'error'); return;
        }
        if (!password || password.length < 6) {
          _toast('M\u1EADt kh\u1EA9u ph\u1EA3i c\u00F3 \u00EDt nh\u1EA5t 6 k\u00FD t\u1EF1', 'error'); return;
        }

        var email = username.trim() + '@phr.vn';

        // Kiểm tra username đã tồn tại
        try {
          var existSnap = await _db().collection('categoryPersonnel')
            .where('username', '==', username.trim())
            .limit(1).get();
          if (!existSnap.empty) {
            _toast('Username \u0111\u00E3 t\u1ED3n t\u1EA1i!', 'error'); return;
          }
        } catch (qErr) {
          console.warn('Could not check existing username:', qErr.message);
        }

        // Tạo Firebase Auth user bằng secondary app (không logout admin hiện tại)
        var tempAuth = _getSecondaryAuth();
        var userCred = await tempAuth.createUserWithEmailAndPassword(email, password);
        await tempAuth.signOut();

        data.username = username.trim();
        data.email = email;
        data.status = 'active';
        data.disabled = false;
        data.role = 'user';
        data.createdAt = _ts();
        // Lưu với UID làm document ID (giống app-nhansu)
        await _db().collection('categoryPersonnel').doc(userCred.user.uid).set(data);
        savedId = userCred.user.uid;
        _toast('Th\u00EAm nh\u00E2n s\u1EF1 th\u00E0nh c\u00F4ng', 'success');
      }

      if (typeof EmployeeProductionProfile !== 'undefined' && savedId) {
        var teamId = (_el('adm_prod_team') || {}).value || '';
        var workGroupId = (_el('adm_work_group') || {}).value || '';
        var employeeCode = (_el('adm_employee_code') || {}).value || '';
        if (teamId && !workGroupId) {
          _toast('Ch\u01B0a ch\u1ECDn nh\u00F3m CN/KH \u2014 nh\u00E2n s\u1EF1 ch\u01B0a hi\u1EC7n trong S\u1EA3n l\u01B0\u1EE3ng CN', 'warning');
        }
        await EmployeeProductionProfile.applyProfile(savedId, {
          teamId: teamId,
          workGroupId: workGroupId,
          employeeCode: employeeCode.trim()
        });
      }
      closeModal();
      loadPersonnel();
    } catch (e) {
      console.error('savePersonnel error:', e);
      var errorMsg = e.message;
      if (e.code === 'auth/email-already-in-use') {
        errorMsg = 'Username \u0111\u00E3 t\u1ED3n t\u1EA1i trong h\u1EC7 th\u1ED1ng!';
      } else if (e.code === 'auth/weak-password') {
        errorMsg = 'M\u1EADt kh\u1EA9u qu\u00E1 y\u1EBFu (c\u1EA7n \u00EDt nh\u1EA5t 6 k\u00FD t\u1EF1)';
      } else if (e.code === 'auth/invalid-email') {
        errorMsg = 'Username kh\u00F4ng h\u1EE3p l\u1EC7 (kh\u00F4ng d\u00F9ng k\u00FD t\u1EF1 \u0111\u1EB7c bi\u1EC7t)';
      }
      _toast('L\u1ED7i: ' + errorMsg, 'error');
    }
  }

  async function togglePersonnelStatus(id) {
    if (!(await showConfirm('Bạn có chắc muốn vô hiệu hóa nhân sự này?'))) return;
    try {
      await _db().collection('categoryPersonnel').doc(id).update({
        status: 'inactive',
        disabled: true,
        updatedAt: _ts()
      });
      _toast('Đã vô hiệu hóa', 'success');
      loadPersonnel();
    } catch (e) {
      console.error('togglePersonnelStatus error:', e);
      _toast('Lỗi: ' + e.message, 'error');
    }
  }

  // ==================== BỘ PHẬN (categoryDepartments) ====================

  /**
   * Find the parent department for the current factory.
   * A02 → "Nhà máy chế biến Cao su Cua paris" (match shortName "cua paris")
   * A01 → department matching shortName "bố lá"
   * @param {Array} allDepts - All department docs from Firestore
   * @returns {Object|null} Parent department doc or null
   */
  function _findParentDepartment(allDepts) {
    var factory = _factory();
    if (!factory || typeof SanxuatFactories === 'undefined') return null;

    var config = SanxuatFactories.getConfig(factory);
    if (!config || !config.shortName) return null;

    var searchTerms = [config.shortName.toLowerCase()];
    if (factory === 'A02') searchTerms.push('cua paris', 'cao su tờ');
    // Parent department follows pattern: "Nhà máy chế biến Cao su [factory name]"
    // Must contain BOTH "nhà máy" AND a factory search term to avoid matching sub-departments
    for (var i = 0; i < allDepts.length; i++) {
      var name = (allDepts[i].name || '').toLowerCase();
      if (name.indexOf('nhà máy') === -1) continue;
      for (var j = 0; j < searchTerms.length; j++) {
        if (name.indexOf(searchTerms[j]) !== -1) return allDepts[i];
      }
    }
    return null;
  }

  /**
   * Load departments for current factory using parent-child hierarchy.
   * 1. Find parent department (e.g. "Nhà máy chế biến Cao su Cua paris" for A02)
   * 2. Load child departments: parentId === parent.id OR factory === currentFactory
   */
  async function loadDepartments() {
    try {
      var snap = await _db().collection('categoryDepartments').get();

      // Collect all departments first
      var allDepts = [];
      snap.forEach(function(doc) {
        var d = doc.data();
        d.id = doc.id;
        allDepts.push(d);
      });

      // Find parent department for this factory
      var parent = _findParentDepartment(allDepts);
      parentDeptId = parent ? parent.id : null;
      parentDeptDoc = parent || null;

      // Filter: child departments (parentId matches) OR has factory field matching
      departments = [];
      var factory = _factory();
      allDepts.forEach(function(d) {
        // Skip the parent department itself (it's the factory, not a sub-department)
        if (d.id === parentDeptId) return;
        // Include if parentId matches the factory's parent department
        if (parentDeptId && d.parentId === parentDeptId) { departments.push(d); return; }
        // Backward compat: include if factory field matches (departments created before parentId was added)
        if (d.factory && d.factory === factory) { departments.push(d); return; }
      });

      departments.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    } catch (e) {
      console.error('loadDepartments error:', e);
    }
  }

  function renderDepartments() {
    var container = _el('adminSubTab1');
    if (!container) return;

    var parentName = parentDeptDoc ? parentDeptDoc.name : (typeof SanxuatFactories !== 'undefined' ? SanxuatFactories.getName(_factory()) : _factory());
    var html = '<div class="admin-toolbar">' +
      '<button class="btn btn-primary btn-sm" onclick="TabAdmin.openDepartmentModal()">+ Thêm bộ phận</button>' +
      '<span style="color:var(--text-secondary);font-size:13px">Phòng ban cha: <strong style="color:var(--accent)">' + parentName + '</strong></span>' +
      '</div>';

    html += '<div class="admin-table-wrap"><table class="admin-table">' +
      '<thead><tr><th>STT</th><th>Tên bộ phận</th><th>Loại</th><th>Mã</th><th>Thao tác</th></tr></thead><tbody>';

    if (!departments.length) {
      html += '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary)">Chưa có bộ phận con</td></tr>';
    } else {
      departments.forEach(function(d, i) {
        var typeLabel = d.type === 'ca_sx' ? 'Ca sản xuất' : (d.type === 'ca_tn' ? 'Ca tiếp nhận' : (d.type === 'quan_ly' ? 'Bộ phận QL' : '—'));
        html += '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td><strong>' + (d.name || '') + '</strong></td>' +
          '<td>' + typeLabel + '</td>' +
          '<td>' + (d.code || '') + '</td>' +
          '<td class="admin-actions">' +
            '<button class="btn-icon" onclick="TabAdmin.openDepartmentModal(\'' + d.id + '\')" title="Sửa">✏️</button>' +
            '<button class="btn-icon btn-danger-icon" onclick="TabAdmin.deleteDepartment(\'' + d.id + '\')" title="Xóa">🗑️</button>' +
          '</td></tr>';
      });
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  function openDepartmentModal(id) {
    var d = id ? departments.find(function(x) { return x.id === id; }) : null;
    var title = d ? 'Sửa bộ phận' : 'Thêm bộ phận mới';
    var parentName = parentDeptDoc ? parentDeptDoc.name : (typeof SanxuatFactories !== 'undefined' ? SanxuatFactories.getName(_factory()) : _factory());

    var html = '<div class="modal-overlay active" id="adminModal">' +
      '<div class="modal" style="max-width:450px">' +
      '<div class="modal-header"><h3>' + title + '</h3><button class="modal-close" onclick="TabAdmin.closeModal()">×</button></div>' +
      '<div class="modal-body">' +
        '<div style="background:var(--bg-tertiary);padding:8px 12px;border-radius:8px;margin-bottom:12px;font-size:13px;color:var(--text-secondary)">' +
          'Bộ phận con của: <strong style="color:var(--accent)">' + parentName + '</strong></div>' +
        '<div class="form-group"><label>Tên bộ phận *</label>' +
          '<input type="text" id="adm_deptName" class="form-control" value="' + (d ? (d.name || '') : '') + '"></div>' +
        '<div class="form-group"><label>Mã bộ phận</label>' +
          '<input type="text" id="adm_deptCode" class="form-control" value="' + (d ? (d.code || '') : '') + '" placeholder="VD: CSX1"></div>' +
        '<div class="form-group"><label>Loại</label>' +
          '<select id="adm_deptType" class="form-control">' +
            '<option value="ca_sx"' + (d && d.type === 'ca_sx' ? ' selected' : '') + '>Ca sản xuất</option>' +
            '<option value="ca_tn"' + (d && d.type === 'ca_tn' ? ' selected' : '') + '>Ca tiếp nhận</option>' +
            '<option value="quan_ly"' + (d && d.type === 'quan_ly' ? ' selected' : '') + '>Bộ phận quản lý</option>' +
          '</select></div>' +
        '<div class="form-group"><label>Mô tả</label>' +
          '<input type="text" id="adm_deptDesc" class="form-control" value="' + (d ? (d.description || '') : '') + '"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="TabAdmin.closeModal()">Hủy</button>' +
        '<button class="btn btn-primary" onclick="TabAdmin.saveDepartment(\'' + (id || '') + '\')">Lưu</button>' +
      '</div></div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  async function saveDepartment(id) {
    var name = (_el('adm_deptName') || {}).value || '';
    if (!name.trim()) { _toast('Vui lòng nhập tên bộ phận', 'error'); return; }

    var data = {
      name: name.trim(),
      code: ((_el('adm_deptCode') || {}).value || '').trim(),
      type: (_el('adm_deptType') || {}).value || 'ca_sx',
      description: ((_el('adm_deptDesc') || {}).value || '').trim(),
      factory: _factory(),
      parentId: parentDeptId || null,
      updatedAt: _ts()
    };

    try {
      if (id) {
        await _db().collection('categoryDepartments').doc(id).update(data);
        _toast('Cập nhật bộ phận thành công', 'success');
      } else {
        data.createdAt = _ts();
        await _db().collection('categoryDepartments').add(data);
        _toast('Thêm bộ phận thành công', 'success');
      }
      closeModal();
      await loadDepartments();
      renderDepartments();
    } catch (e) {
      console.error('saveDepartment error:', e);
      _toast('Lỗi lưu bộ phận: ' + e.message, 'error');
    }
  }

  async function deleteDepartment(id) {
    if (!(await showConfirm('Bạn có chắc muốn xóa bộ phận này?'))) return;
    try {
      await _db().collection('categoryDepartments').doc(id).delete();
      _toast('Đã xóa bộ phận', 'success');
      await loadDepartments();
      renderDepartments();
    } catch (e) {
      console.error('deleteDepartment error:', e);
      _toast('Lỗi xóa: ' + e.message, 'error');
    }
  }

  // ==================== CHỨC VỤ (categoryPositions) ====================

  async function loadPositions() {
    try {
      var snap = await _db().collection('categoryPositions').get();
      var byId = {};
      STANDARD_POSITIONS.forEach(function (p) { byId[p.id] = Object.assign({}, p); });
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        d.id = doc.id;
        byId[d.id] = d;
      });
      positions = Object.keys(byId).map(function (k) { return byId[k]; });
      positions.sort(function (a, b) { return (a.level || 99) - (b.level || 99); });
    } catch (e) {
      console.error('loadPositions error:', e);
      positions = STANDARD_POSITIONS.slice();
    }
  }

  function renderPositions() {
    var container = _el('adminSubTab2');
    if (!container) return;

    var html = '<div class="admin-toolbar">' +
      '<button class="btn btn-primary btn-sm" onclick="TabAdmin.openPositionModal()">+ Thêm chức vụ</button>' +
      '</div>';

    html += '<div class="admin-table-wrap"><table class="admin-table">' +
      '<thead><tr><th>STT</th><th>Tên chức vụ</th><th>Mã</th><th>Cấp bậc</th><th>Thao tác</th></tr></thead><tbody>';

    if (!positions.length) {
      html += '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary)">Chưa có chức vụ</td></tr>';
    } else {
      positions.forEach(function(p, i) {
        html += '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td><strong>' + (p.name || '') + '</strong></td>' +
          '<td>' + (p.code || '') + '</td>' +
          '<td>' + (p.level || '') + '</td>' +
          '<td class="admin-actions">' +
            '<button class="btn-icon" onclick="TabAdmin.openPositionModal(\'' + p.id + '\')" title="Sửa">✏️</button>' +
            '<button class="btn-icon btn-danger-icon" onclick="TabAdmin.deletePosition(\'' + p.id + '\')" title="Xóa">🗑️</button>' +
          '</td></tr>';
      });
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  function openPositionModal(id) {
    var p = id ? positions.find(function(x) { return x.id === id; }) : null;
    var title = p ? 'Sửa chức vụ' : 'Thêm chức vụ mới';

    var html = '<div class="modal-overlay active" id="adminModal">' +
      '<div class="modal" style="max-width:450px">' +
      '<div class="modal-header"><h3>' + title + '</h3><button class="modal-close" onclick="TabAdmin.closeModal()">×</button></div>' +
      '<div class="modal-body">' +
        '<div class="form-group"><label>Tên chức vụ *</label>' +
          '<input type="text" id="adm_posName" class="form-control" value="' + (p ? (p.name || '') : '') + '"></div>' +
        '<div class="form-group"><label>Mã chức vụ</label>' +
          '<input type="text" id="adm_posCode" class="form-control" value="' + (p ? (p.code || '') : '') + '" placeholder="VD: CT"></div>' +
        '<div class="form-group"><label>Cấp bậc (1 = cao nhất)</label>' +
          '<input type="number" id="adm_posLevel" class="form-control" min="1" value="' + (p ? (p.level || '') : '') + '"></div>' +
        '<div class="form-group"><label>Mô tả</label>' +
          '<input type="text" id="adm_posDesc" class="form-control" value="' + (p ? (p.description || '') : '') + '"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="TabAdmin.closeModal()">Hủy</button>' +
        '<button class="btn btn-primary" onclick="TabAdmin.savePosition(\'' + (id || '') + '\')">Lưu</button>' +
      '</div></div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  async function savePosition(id) {
    var name = (_el('adm_posName') || {}).value || '';
    if (!name.trim()) { _toast('Vui lòng nhập tên chức vụ', 'error'); return; }

    var data = {
      name: name.trim(),
      code: ((_el('adm_posCode') || {}).value || '').trim(),
      level: parseInt((_el('adm_posLevel') || {}).value) || null,
      description: ((_el('adm_posDesc') || {}).value || '').trim(),
      updatedAt: _ts()
    };

    try {
      if (id) {
        await _db().collection('categoryPositions').doc(id).update(data);
        _toast('Cập nhật chức vụ thành công', 'success');
      } else {
        data.createdAt = _ts();
        await _db().collection('categoryPositions').add(data);
        _toast('Thêm chức vụ thành công', 'success');
      }
      closeModal();
      await loadPositions();
      renderPositions();
    } catch (e) {
      console.error('savePosition error:', e);
      _toast('Lỗi lưu chức vụ: ' + e.message, 'error');
    }
  }

  async function deletePosition(id) {
    if (!(await showConfirm('Bạn có chắc muốn xóa chức vụ này?'))) return;
    try {
      await _db().collection('categoryPositions').doc(id).delete();
      _toast('Đã xóa chức vụ', 'success');
      await loadPositions();
      renderPositions();
    } catch (e) {
      console.error('deletePosition error:', e);
      _toast('Lỗi xóa: ' + e.message, 'error');
    }
  }

  // ==================== TCCS OVERRIDES (admin_tccs_overrides) ====================

  var TCCS_LIST = [
    { code: '101', name: 'TCCS 101:2025', products: 'SVR 3L, SVR 5', specsKey: 'SPECS_101' },
    { code: '103', name: 'TCCS 103:2025', products: 'SVR CV40/50/60', specsKey: 'SPECS_103' },
    { code: '118', name: 'TCCS 118:2023', products: 'SVR L', specsKey: 'SPECS_118' },
    { code: '102', name: 'TCCS 102:2015', products: 'SVR 10, SVR 20', specsKey: 'SPECS_102' },
    { code: '107HA', name: 'TCCS 107:2020 (HA)', products: 'Latex HA', specsKey: 'SPECS_107_HA' },
    { code: '107LA', name: 'TCCS 107:2020 (LA)', products: 'Latex LA', specsKey: 'SPECS_107_LA' }
  ];

  var STAGE_NAMES = {
    tiepnhan: 'Tiếp nhận', xulymu: 'Xử lý mủ', taodong: 'Tạo đông',
    canmu: 'Cán mủ', taohat: 'Tạo hạt', say: 'Sấy',
    epbanh: 'Ép bành', baogoi: 'Bao gói'
  };

  async function loadTCCSOverrides() {
    try {
      var snap = await _db().collection('admin_tccs_overrides').get();
      tccsOverrides = {};
      snap.forEach(function(doc) {
        tccsOverrides[doc.id] = doc.data();
      });
      // Apply overrides to TCCSSpecs module
      if (typeof TCCSSpecs !== 'undefined' && TCCSSpecs.applyOverrides) {
        TCCSSpecs.applyOverrides(tccsOverrides);
      }
      renderTCCSEditor();
    } catch (e) {
      console.error('loadTCCSOverrides error:', e);
      renderTCCSEditor();
    }
  }

  function _getDefaultSpecs(code) {
    if (!TCCSSpecs) return {};
    switch (code) {
      case '101': return TCCSSpecs.SPECS_101;
      case '103': return TCCSSpecs.SPECS_103;
      case '118': return TCCSSpecs.SPECS_118;
      case '102': return TCCSSpecs.SPECS_102;
      case '107HA': return TCCSSpecs.SPECS_107_HA;
      case '107LA': return TCCSSpecs.SPECS_107_LA;
      default: return {};
    }
  }

  function _getParamLabel(paramKey) {
    if (typeof SanxuatParams !== 'undefined') {
      return SanxuatParams.getLabel(paramKey);
    }
    return paramKey;
  }

  function renderTCCSEditor() {
    var container = _el('adminSubTab3');
    if (!container) return;

    // Dropdown to select TCCS
    var selectHtml = TCCS_LIST.map(function(t) {
      var sel = (t.code === selectedTCCS) ? ' selected' : '';
      return '<option value="' + t.code + '"' + sel + '>' + t.name + ' (' + t.products + ')</option>';
    }).join('');

    var html = '<div class="admin-toolbar">' +
      '<select class="form-control" style="max-width:400px;display:inline-block" onchange="TabAdmin.selectTCCS(this.value)">' +
        selectHtml +
      '</select>' +
      '</div>';

    // Get default specs and overrides for selected TCCS
    var defaults = _getDefaultSpecs(selectedTCCS);
    var override = (tccsOverrides[selectedTCCS] || {}).specs || {};

    html += '<div class="admin-table-wrap"><table class="admin-table tccs-table">' +
      '<thead><tr><th>Giai đoạn</th><th>Thông số</th><th>Min (mặc định)</th><th>Max (mặc định)</th><th>Min (tùy chỉnh)</th><th>Max (tùy chỉnh)</th></tr></thead><tbody>';

    var stageKeys = Object.keys(defaults);
    stageKeys.forEach(function(stageKey) {
      var stageSpecs = defaults[stageKey];
      if (!stageSpecs || typeof stageSpecs !== 'object') return;

      var paramKeys = Object.keys(stageSpecs);
      if (!paramKeys.length) return;

      paramKeys.forEach(function(paramKey, pIdx) {
        var spec = stageSpecs[paramKey] || {};
        var ov = (override[stageKey] || {})[paramKey] || {};

        var stageName = (pIdx === 0) ? (STAGE_NAMES[stageKey] || stageKey) : '';
        var rowspan = (pIdx === 0) ? ' rowspan="' + paramKeys.length + '"' : '';
        var stageCell = (pIdx === 0) ? '<td' + rowspan + ' class="stage-cell">' + stageName + '</td>' : '';

        var defMin = spec.min !== undefined ? spec.min : '';
        var defMax = spec.max !== undefined ? spec.max : '';
        var ovMin = ov.min !== undefined ? ov.min : '';
        var ovMax = ov.max !== undefined ? ov.max : '';

        var dataAttr = 'data-stage="' + stageKey + '" data-param="' + paramKey + '"';

        html += '<tr>' + stageCell +
          '<td>' + _getParamLabel(paramKey) + '</td>' +
          '<td class="default-val">' + defMin + '</td>' +
          '<td class="default-val">' + defMax + '</td>' +
          '<td><input type="number" class="tccs-input tccs-min" ' + dataAttr + ' value="' + ovMin + '" placeholder="' + defMin + '" step="any"></td>' +
          '<td><input type="number" class="tccs-input tccs-max" ' + dataAttr + ' value="' + ovMax + '" placeholder="' + defMax + '" step="any"></td>' +
          '</tr>';
      });
    });

    html += '</tbody></table></div>';

    html += '<div class="admin-toolbar" style="margin-top:12px">' +
      '<button class="btn btn-primary" onclick="TabAdmin.saveTCCSOverride()">💾 Lưu thay đổi</button>' +
      '<button class="btn btn-secondary" onclick="TabAdmin.resetTCCSToDefault()" style="margin-left:8px">🔄 Khôi phục mặc định</button>' +
      '</div>';

    container.innerHTML = html;
  }

  function selectTCCS(code) {
    selectedTCCS = code;
    renderTCCSEditor();
  }

  async function saveTCCSOverride() {
    var container = _el('adminSubTab3');
    if (!container) return;

    var inputs = container.querySelectorAll('.tccs-input');
    var specs = {};

    inputs.forEach(function(inp) {
      var stage = inp.dataset.stage;
      var param = inp.dataset.param;
      var val = inp.value.trim();
      if (!val) return;

      if (!specs[stage]) specs[stage] = {};
      if (!specs[stage][param]) specs[stage][param] = {};

      if (inp.classList.contains('tccs-min')) {
        specs[stage][param].min = parseFloat(val);
      } else if (inp.classList.contains('tccs-max')) {
        specs[stage][param].max = parseFloat(val);
      }
    });

    try {
      var user = _user();
      await _db().collection('admin_tccs_overrides').doc(selectedTCCS).set({
        specs: specs,
        updatedAt: _ts(),
        updatedBy: user ? (user.uid || user.id || null) : null
      });
      tccsOverrides[selectedTCCS] = { specs: specs };
      // Apply to live system
      if (typeof TCCSSpecs !== 'undefined' && TCCSSpecs.applyOverrides) {
        TCCSSpecs.applyOverrides(tccsOverrides);
      }
      _toast('Đã lưu thay đổi TCCS ' + selectedTCCS, 'success');
    } catch (e) {
      console.error('saveTCCSOverride error:', e);
      _toast('Lỗi lưu TCCS: ' + e.message, 'error');
    }
  }

  async function resetTCCSToDefault() {
    if (!(await showConfirm('Khôi phục TCCS ' + selectedTCCS + ' về mặc định? Tất cả tùy chỉnh sẽ bị xóa.'))) return;
    try {
      await _db().collection('admin_tccs_overrides').doc(selectedTCCS).delete();
      delete tccsOverrides[selectedTCCS];
      if (typeof TCCSSpecs !== 'undefined' && TCCSSpecs.applyOverrides) {
        TCCSSpecs.applyOverrides(tccsOverrides);
      }
      _toast('Đã khôi phục mặc định TCCS ' + selectedTCCS, 'success');
      renderTCCSEditor();
    } catch (e) {
      console.error('resetTCCSToDefault error:', e);
      _toast('Lỗi: ' + e.message, 'error');
    }
  }

  // ==================== MODAL UTILS ====================

  function closeModal() {
    var modal = _el('adminModal');
    if (modal) modal.remove();
  }

  // ==================== EXTERNAL ACCESS ====================

  /**
   * Get departments by type for external modules (e.g. shift schedule).
   * Auto-loads departments if not loaded or factory changed.
   * @param {string} type - Department type ('ca_sx' | 'quan_ly')
   * @returns {Promise<Array>} Departments matching the type
   */
  async function getDepartmentsByType(type) {
    // Reload if factory changed or never loaded
    if (lastFactory !== _factory() || (!departments.length && !parentDeptId)) {
      lastFactory = _factory();
      parentDeptId = null;
      parentDeptDoc = null;
      departments = [];
      personnel = [];
      await loadDepartments();
    }
    return departments.filter(function(d) { return d.type === type; });
  }

  // ==================== PUBLIC API ====================

  return {
    init: init,
    showSubTab: showSubTab,
    // Personnel
    loadPersonnel: loadPersonnel,
    renderPersonnelTable: renderPersonnelTable,
    filterPersonnel: filterPersonnel,
    openPersonnelModal: openPersonnelModal,
    savePersonnel: savePersonnel,
    togglePersonnelStatus: togglePersonnelStatus,
    // Departments
    getDepartmentsByType: getDepartmentsByType,
    openDepartmentModal: openDepartmentModal,
    saveDepartment: saveDepartment,
    deleteDepartment: deleteDepartment,
    // Positions
    openPositionModal: openPositionModal,
    savePosition: savePosition,
    deletePosition: deletePosition,
    // TCCS
    selectTCCS: selectTCCS,
    saveTCCSOverride: saveTCCSOverride,
    resetTCCSToDefault: resetTCCSToDefault,
    // Modal
    closeModal: closeModal
  };
})();
