/* modals.js — all modal dialogs.
 * Owns the modal HTML (created on first open) and form logic.
 */
(function () {
  'use strict';

  const NS = window.NhansuState;
  const SVC = () => window.NhansuServices;
  const { state, esc, fmtDate, getFactories, TEAM_TYPES, ROLE_LABELS, SYSTEM_ROLE_LABELS,
    getSystemRoleLabel, personSystemRoleId, personSystemRoleLabel, deptName, posName, teamName,
    resolvePositionId } = NS;

  // ============== Generic helpers ==============
  function ensureModalRoot() {
    let root = document.getElementById('modalRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'modalRoot';
      document.body.appendChild(root);
    }
    return root;
  }

  function show(id) { document.getElementById(id)?.classList.add('show'); }
  function hide(id) { document.getElementById(id)?.classList.remove('show'); }
  function val(id)  { return (document.getElementById(id)?.value || '').trim(); }
  function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
  function setDate(id, d) {
    if (!d) { setVal(id, ''); return; }
    const dt = d.toDate ? d.toDate() : (d instanceof Date ? d : new Date(d));
    if (isNaN(dt.getTime())) { setVal(id, ''); return; }
    const iso = dt.toISOString().slice(0, 10);
    setVal(id, iso);
  }

  function confirmDialog(message, onConfirm) {
    const root = ensureModalRoot();
    if (!document.getElementById('confirmModal')) {
      root.insertAdjacentHTML('beforeend', `
        <div class="modal-bg center" id="confirmModal">
          <div class="modal confirm-modal">
            <div class="modal-head"><h3>⚠️ Xác nhận</h3>
              <button class="modal-close" data-close="confirmModal">✕</button>
            </div>
            <div class="modal-body" id="confirmMsg"></div>
            <div class="modal-foot">
              <button class="btn" data-close="confirmModal">Hủy</button>
              <button class="btn btn-danger" id="confirmOk">Xác nhận</button>
            </div>
          </div>
        </div>`);
      bindClose();
    }
    document.getElementById('confirmMsg').innerHTML = message;
    document.getElementById('confirmOk').onclick = async () => {
      try { await onConfirm(); } finally { hide('confirmModal'); }
    };
    show('confirmModal');
  }

  function bindClose() {
    // Chỉ đóng qua nút X / Hủy có data-close. Click backdrop KHÔNG đóng modal
    // (tránh mất dữ liệu form khi lỡ click ra ngoài).
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.close) hide(t.dataset.close);
    });
  }

  // ============== Employee Form ==============
  function ensureEmployeeForm() {
    const root = ensureModalRoot();
    if (document.getElementById('employeeModal')) return;
    root.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" id="employeeModal">
        <div class="modal" style="max-width:720px">
          <div class="modal-head">
            <h3 id="empModalTitle">➕ Thêm nhân sự</h3>
            <button class="modal-close" data-close="employeeModal">✕</button>
          </div>
          <div class="modal-body">
            <form id="employeeForm" autocomplete="off">
              <div class="form-section">
                <h4>📋 Thông tin cơ bản</h4>
                <div class="form-grid">
                  <div class="form-field span-2"><label>Họ tên <span class="req">*</span></label><input type="text" class="form-input" id="inputHoTen" required></div>
                  <div class="form-field"><label>Mã NV</label><input type="text" class="form-input" id="inputCode"></div>
                  <div class="form-field"><label>SĐT</label><input type="tel" class="form-input" id="inputPhone"></div>
                  <div class="form-field"><label>CCCD</label><input type="text" class="form-input" id="inputCccd"></div>
                  <div class="form-field"><label>Email cá nhân</label><input type="email" class="form-input" id="inputEmail"></div>
                </div>
              </div>
              <div class="form-section">
                <h4>🔐 Tài khoản</h4>
                <div class="form-grid">
                  <div class="form-field"><label>Username <span class="req">*</span></label><input type="text" class="form-input" id="inputUsername" required></div>
                  <div class="form-field span-2"><label>Mật khẩu <span class="req" id="pwdReq">*</span></label><input type="password" class="form-input" id="inputPassword" placeholder="Để trống khi sửa"></div>
                </div>
              </div>
              <div class="form-section">
                <h4>🏢 Tổ chức</h4>
                <div class="form-grid">
                  <div class="form-field nhansu-hidden"><label>Nhà máy</label>
                    <select class="form-input" id="inputFactory"><option value="">-- Chọn --</option></select>
                  </div>
                  <div class="form-field"><label>Phòng ban</label>
                    <select class="form-input" id="inputDepartment"><option value="">-- Chọn --</option></select>
                  </div>
                  <div class="form-field"><label>Chức vụ</label>
                    <select class="form-input" id="inputPosition"><option value="">-- Chọn chức vụ --</option></select>
                    <span class="field-hint">Chức danh công việc (VD: Giám đốc TT, Trưởng phòng…)</span>
                  </div>
                  <div class="form-field"><label>Tổ</label>
                    <select class="form-input" id="inputPersonnelTeam"><option value="">-- Chọn tổ --</option></select>
                  </div>
                  <div class="form-field"><label>Vai trò hệ thống</label>
                    <select class="form-input" id="inputSystemRole"><option value="">-- Chọn vai trò --</option></select>
                    <span class="field-hint">Quyền ERP: Quản trị viên, Lãnh đạo đơn vị… (khác chức vụ)</span>
                  </div>
                  <div class="form-field"><label>Trạng thái</label>
                    <select class="form-input" id="inputStatus">
                      <option value="active">Đang làm</option>
                      <option value="inactive">Nghỉ việc</option>
                    </select>
                  </div>
                </div>
              </div>
              <div class="form-section" id="accessRightsSection">
                <h4>🔐 Quyền truy cập ứng dụng</h4>
                <div id="accessRightsRoot"></div>
              </div>
              <div class="form-section">
                <h4>🌳 Sản xuất cạo mủ</h4>
                <p style="font-size:12px;color:var(--text-muted,#64748b);margin:0 0 8px">Gán tổ SX + nhóm CN/KH để hiện trong tab Sản lượng CN (Mã NV nhập ở trên)</p>
                <div class="form-grid">
                  <div class="form-field"><label>Tổ sản xuất</label>
                    <select class="form-input" id="inputProdTeam"><option value="">-- Không gán --</option></select>
                  </div>
                  <div class="form-field"><label>Nhóm (CN / KH)</label>
                    <select class="form-input" id="inputWorkGroup"><option value="">-- Chọn nhóm --</option></select>
                  </div>
                </div>
              </div>
              <div class="form-section">
                <h4>👤 Thông tin cá nhân</h4>
                <div class="form-grid">
                  <div class="form-field"><label>Giới tính</label>
                    <select class="form-input" id="inputGender"><option value="">--</option><option value="male">Nam</option><option value="female">Nữ</option></select>
                  </div>
                  <div class="form-field"><label>Ngày sinh</label><input type="date" class="form-input" id="inputDob"></div>
                  <div class="form-field"><label>Hôn nhân</label>
                    <select class="form-input" id="inputMaritalStatus">
                      <option value="">--</option>
                      <option value="single">Độc thân</option>
                      <option value="married">Đã kết hôn</option>
                      <option value="divorced">Đã ly hôn</option>
                      <option value="widowed">Góa</option>
                    </select>
                  </div>
                  <div class="form-field"><label>Nơi sinh</label><input type="text" class="form-input" id="inputPlaceOfBirth"></div>
                  <div class="form-field"><label>Dân tộc</label><input type="text" class="form-input" id="inputEthnicity"></div>
                  <div class="form-field"><label>Tôn giáo</label><input type="text" class="form-input" id="inputReligion"></div>
                </div>
              </div>
              <div class="form-section">
                <h4>🏠 Địa chỉ</h4>
                <div class="form-grid cols-1">
                  <div class="form-field"><label>Thường trú</label><input type="text" class="form-input" id="inputPermanentAddress"></div>
                  <div class="form-field"><label>Tạm trú (nếu khác)</label><input type="text" class="form-input" id="inputCurrentAddress"></div>
                </div>
              </div>
              <div class="form-section">
                <h4>📅 Lao động</h4>
                <div class="form-grid">
                  <div class="form-field"><label>Ngày vào</label><input type="date" class="form-input" id="inputHireDate"></div>
                  <div class="form-field"><label>Hết thử việc</label><input type="date" class="form-input" id="inputProbationEndDate"></div>
                  <div class="form-field"><label>Hình thức</label>
                    <select class="form-input" id="inputEmploymentType">
                      <option value="">--</option>
                      <option value="fulltime">Toàn thời gian</option>
                      <option value="parttime">Bán thời gian</option>
                      <option value="contract">Khoán</option>
                      <option value="intern">Thực tập</option>
                    </select>
                  </div>
                  <div class="form-field span-2"><label>Loại HĐ</label>
                    <select class="form-input" id="inputContractType">
                      <option value="">--</option>
                      <option value="probation">Thử việc</option>
                      <option value="definite_1y">Xác định 1 năm</option>
                      <option value="definite_3y">Xác định 3 năm</option>
                      <option value="indefinite">Không xác định</option>
                      <option value="seasonal">Thời vụ</option>
                    </select>
                  </div>
                  <div class="form-field"><label>Nơi làm việc</label><input type="text" class="form-input" id="inputWorkLocation"></div>
                </div>
              </div>
              <div class="form-section">
                <h4>📞 Liên hệ khẩn</h4>
                <div class="form-grid">
                  <div class="form-field"><label>Họ tên</label><input type="text" class="form-input" id="inputEmergencyName"></div>
                  <div class="form-field"><label>Quan hệ</label>
                    <select class="form-input" id="inputEmergencyRelation">
                      <option value="">--</option>
                      <option value="spouse">Vợ/Chồng</option>
                      <option value="parent">Bố/Mẹ</option>
                      <option value="child">Con</option>
                      <option value="sibling">Anh/Chị/Em</option>
                      <option value="other">Khác</option>
                    </select>
                  </div>
                  <div class="form-field"><label>SĐT</label><input type="tel" class="form-input" id="inputEmergencyPhone"></div>
                </div>
              </div>
              <div class="form-section">
                <h4>💰 Thuế & BHXH</h4>
                <div class="form-grid">
                  <div class="form-field"><label>Mã số thuế</label><input type="text" class="form-input" id="inputTaxCode"></div>
                  <div class="form-field"><label>Sổ BHXH</label><input type="text" class="form-input" id="inputSocialInsuranceNo"></div>
                  <div class="form-field"><label>Thẻ BHYT</label><input type="text" class="form-input" id="inputHealthInsuranceNo"></div>
                </div>
              </div>
              <div class="form-section">
                <h4>🏦 Tài khoản ngân hàng</h4>
                <div class="form-grid">
                  <div class="form-field"><label>Ngân hàng</label><input type="text" class="form-input" id="inputBankName"></div>
                  <div class="form-field"><label>Số TK</label><input type="text" class="form-input" id="inputBankAccountNo"></div>
                  <div class="form-field"><label>Chi nhánh</label><input type="text" class="form-input" id="inputBankBranch"></div>
                  <div class="form-field full"><label>Tên trên thẻ</label><input type="text" class="form-input" id="inputBankAccountName"></div>
                </div>
              </div>
            </form>
          </div>
          <div class="modal-foot">
            <button class="btn" data-close="employeeModal">Hủy</button>
            <button class="btn btn-primary" id="btnSaveEmployee">💾 Lưu</button>
          </div>
        </div>
      </div>`);
    document.getElementById('btnSaveEmployee').onclick = saveEmployee;
    document.getElementById('inputDepartment').onchange = () => {
      populateTeamDropdown();
    };
    document.getElementById('inputSystemRole')?.addEventListener('change', () => {
      if (window.NhansuAccessRights && !state.editingId) {
        window.NhansuAccessRights.applyTemplateFromForm();
      }
    });
    document.getElementById('inputHoTen')?.addEventListener('blur', suggestUsernameFromName);
    const prodTeamSel = document.getElementById('inputProdTeam');
    if (prodTeamSel && typeof EmployeeProductionProfile !== 'undefined') {
      prodTeamSel.onchange = () => {
        EmployeeProductionProfile.fillWorkGroupSelect(
          document.getElementById('inputWorkGroup'),
          prodTeamSel.value,
          ''
        );
      };
    }
  }

  function populateFactoryDropdown(selId, currentValue) {
    const sel = document.getElementById(selId);
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Chọn --</option>';
    getFactories().forEach(f => sel.insertAdjacentHTML('beforeend', `<option value="${esc(f.id)}">${esc(f.name)}</option>`));
    if (currentValue) sel.value = currentValue;
  }

  function populateSystemRoleDropdown(selectedId) {
    const sel = document.getElementById('inputSystemRole');
    if (!sel) return;
    const roles = state.systemRoles || [];
    sel.innerHTML = '<option value="">-- Chọn vai trò --</option>';
    roles.forEach(r => {
      const label = SYSTEM_ROLE_LABELS[r.role_name] || r.description || r.role_name;
      sel.insertAdjacentHTML('beforeend',
        `<option value="${r.id}">${esc(label)}</option>`);
    });
    if (selectedId) sel.value = String(selectedId);
    else {
      const viewer = roles.find(r => r.role_name === 'Staff_Viewer');
      if (viewer) sel.value = String(viewer.id);
    }
  }

  function removeVietnameseAccents(str) {
    return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }

  function usernameFromFullName(fullName) {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1) {
      return 'rriv.' + removeVietnameseAccents(parts[0]).toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    const given = parts[parts.length - 1];
    const initials = parts.slice(0, -1).map(p => removeVietnameseAccents(p).charAt(0)).join('').toLowerCase();
    const givenNorm = removeVietnameseAccents(given).toLowerCase().replace(/[^a-z0-9]/g, '');
    return 'rriv.' + initials + givenNorm;
  }

  function suggestUsernameFromName() {
    if (state.editingId) return;
    const hoTen = val('inputHoTen');
    const userEl = document.getElementById('inputUsername');
    if (!hoTen || !userEl || userEl.value.trim()) return;
    const u = usernameFromFullName(hoTen);
    if (u) userEl.value = u;
  }

  function populateDeptDropdown() {
    const sel = document.getElementById('inputDepartment');
    sel.innerHTML = '<option value="">-- Chọn --</option>';
    state.departments.forEach(d => {
      sel.insertAdjacentHTML('beforeend', `<option value="${d.id}">${esc(d.name)}</option>`);
    });
  }
  function populatePositionDropdown(selectedRaw) {
    const sel = document.getElementById('inputPosition');
    if (!sel) return;
    const selectedId = selectedRaw ? resolvePositionId(selectedRaw, state.positions) : '';
    sel.innerHTML = '<option value="">-- Chọn chức vụ --</option>';
    const sorted = [...state.positions].sort((a, b) => {
      const la = a.level || 999;
      const lb = b.level || 999;
      if (la !== lb) return la - lb;
      return (a.name || '').localeCompare(b.name || '', 'vi');
    });
    sorted.forEach(p => {
      const lvl = p.level ? ` (Bậc ${p.level})` : '';
      sel.insertAdjacentHTML('beforeend', `<option value="${esc(p.id)}">${esc(p.name)}${lvl}</option>`);
    });
    if (selectedId && !sorted.some(p => p.id === selectedId)) {
      sel.insertAdjacentHTML(
        'beforeend',
        `<option value="${esc(selectedId)}">${esc(posName(selectedId) || selectedId)}</option>`
      );
    }
    if (selectedId) sel.value = selectedId;
  }
  function populateTeamDropdown(selectedTeamId) {
    const sel = document.getElementById('inputPersonnelTeam');
    const deptId = document.getElementById('inputDepartment').value;
    sel.innerHTML = '<option value="">-- Chọn tổ --</option>';
    state.allTeams.filter(t => t.department === deptId).forEach(t => {
      sel.insertAdjacentHTML('beforeend', `<option value="${t.id}">${esc(t.name)}</option>`);
    });
    if (selectedTeamId) sel.value = selectedTeamId;
  }

  async function populateProdTeamDropdown(selectedTeamId, selectedGroupId) {
    const teamSel = document.getElementById('inputProdTeam');
    const groupSel = document.getElementById('inputWorkGroup');
    if (!teamSel || !groupSel || typeof EmployeeProductionProfile === 'undefined') return;
    const teams = await EmployeeProductionProfile.loadProductionTeams();
    teamSel.innerHTML = EmployeeProductionProfile.teamOptionsHtml(teams, selectedTeamId || '');
    const groups = await EmployeeProductionProfile.loadWorkGroups(selectedTeamId || '');
    groupSel.innerHTML = EmployeeProductionProfile.workGroupOptionsHtml(groups, selectedGroupId || '');
  }

  async function openEmployeeForm(id) {
    ensureEmployeeForm();
    populateFactoryDropdown('inputFactory');
    populateDeptDropdown();

    state.editingId = id || null;
    const isNew = !id;
    document.getElementById('empModalTitle').textContent = isNew ? '➕ Thêm nhân sự' : '✏️ Sửa nhân sự';
    document.getElementById('pwdReq').style.display = isNew ? 'inline' : 'none';
    document.getElementById('inputPassword').required = isNew;

    const form = document.getElementById('employeeForm');
    form.reset();

    let selectedPosition = '';
    if (id) {
      const p = state.allPersonnel.find(x => x.id === id);
      if (!p) { NS.toast('Không tìm thấy nhân sự', 'error'); return; }
      selectedPosition = p.position || p.position_name || p.positionName || '';
      setVal('inputHoTen', p.hoTen);
      setVal('inputCode', p.employeeCode || p.code);
      setVal('inputPhone', p.phone);
      setVal('inputCccd', p.cccd);
      setVal('inputEmail', p.personalEmail);
      setVal('inputUsername', p.username);
      document.getElementById('inputUsername').disabled = true;
      setVal('inputFactory', p.factory);
      setVal('inputDepartment', p.department);
      populateTeamDropdown(p.team);
      setVal('inputSystemRole', personSystemRoleId(p) || legacyRoleToSystemId(p.role));
      setVal('inputStatus', p.disabled ? 'inactive' : 'active');
      setVal('inputGender', p.gender);
      setDate('inputDob', p.dateOfBirth);
      setVal('inputPlaceOfBirth', p.placeOfBirth);
      setVal('inputEthnicity', p.ethnicity);
      setVal('inputReligion', p.religion);
      setVal('inputMaritalStatus', p.maritalStatus);
      setVal('inputPermanentAddress', p.permanentAddress);
      setVal('inputCurrentAddress', p.currentAddress);
      setDate('inputHireDate', p.hireDate);
      setDate('inputProbationEndDate', p.probationEndDate);
      setVal('inputContractType', p.contractType);
      setVal('inputEmploymentType', p.employmentType);
      setVal('inputWorkLocation', p.workLocation);
      setVal('inputEmergencyName', p.emergencyContact?.name);
      setVal('inputEmergencyRelation', p.emergencyContact?.relation);
      setVal('inputEmergencyPhone', p.emergencyContact?.phone);
      setVal('inputTaxCode', p.taxCode);
      setVal('inputSocialInsuranceNo', p.socialInsuranceNo);
      setVal('inputHealthInsuranceNo', p.healthInsuranceNo);
      setVal('inputBankName', p.bankAccount?.bankName);
      setVal('inputBankAccountNo', p.bankAccount?.accountNo);
      setVal('inputBankAccountName', p.bankAccount?.accountName);
      setVal('inputBankBranch', p.bankAccount?.branch);
      if (typeof EmployeeProductionProfile !== 'undefined') {
        const prod = await EmployeeProductionProfile.getEmployeeProductionFields(id);
        await populateProdTeamDropdown(prod.team_id, prod.work_group_id);
        if (prod.employee_code && !(p.employeeCode || p.code)) {
          setVal('inputCode', prod.employee_code);
        }
      }
    } else {
      document.getElementById('inputUsername').disabled = false;
      // Pre-select context from tree
      const sel = state.selection;
      if (sel.factoryId && sel.factoryId !== 'unassigned') setVal('inputFactory', sel.factoryId);
      if (sel.type === 'department') setVal('inputDepartment', sel.id);
      if (sel.type === 'team') {
        setVal('inputDepartment', sel.deptId);
        populateTeamDropdown(sel.id);
      } else {
        populateTeamDropdown();
      }
      await populateProdTeamDropdown();
    }

    populatePositionDropdown(selectedPosition);

    let selectedSystemRole = null;
    if (id) {
      const pEdit = state.allPersonnel.find(x => x.id === id);
      if (pEdit) selectedSystemRole = personSystemRoleId(pEdit) || legacyRoleToSystemId(pEdit.role);
    }
    populateSystemRoleDropdown(selectedSystemRole);

    const canAccess = window.NhansuPerms?.canManageAccessRights?.(state.currentUser);
    const accessSec = document.getElementById('accessRightsSection');
    if (accessSec) accessSec.style.display = canAccess ? '' : 'none';
    if (canAccess && window.NhansuAccessRights) {
      const cache = id ? (state.allPersonnel.find(x => x.id === id)?.appRolesCache || {}) : {};
      await window.NhansuAccessRights.render('accessRightsRoot', cache, { readonly: false });
      if (!id) window.NhansuAccessRights.applyTemplateFromForm();
    }

    show('employeeModal');
  }

  function legacyRoleToSystemId(erpRole) {
    const roles = state.systemRoles || [];
    const map = { admin: 'Super_Admin', vpp: 'Department_Head', user: 'Staff_Viewer' };
    const want = map[erpRole] || 'Staff_Viewer';
    const hit = roles.find(r => r.role_name === want);
    return hit ? hit.id : (roles.find(r => r.role_name === 'Staff_Viewer')?.id || '');
  }

  async function saveEmployee() {
    const hoTen = val('inputHoTen');
    const username = val('inputUsername');
    const password = document.getElementById('inputPassword').value;
    if (!hoTen || !username) { NS.toast('Nhập họ tên + username', 'error'); return; }
    if (!state.editingId && !password) { NS.toast('Nhập mật khẩu', 'error'); return; }

    const department = val('inputDepartment');
    const position = val('inputPosition');
    const team = val('inputPersonnelTeam');

    const systemRoleId = val('inputSystemRole');
    const erpRole = SVC().erpRoleFromSystemRoleId(systemRoleId, state.systemRoles);

    const data = {
      hoTen, name: hoTen, username,
      employeeCode: val('inputCode'),
      code: val('inputCode'),
      phone: val('inputPhone'),
      cccd: val('inputCccd'),
      personalEmail: val('inputEmail'),
      factory: val('inputFactory'),
      department, position, team,
      role: erpRole,
      systemRoleId: systemRoleId ? Number(systemRoleId) : null,
      gender: val('inputGender'),
      disabled: val('inputStatus') === 'inactive',
      status: val('inputStatus'),
      placeOfBirth: val('inputPlaceOfBirth'),
      ethnicity: val('inputEthnicity'),
      religion: val('inputReligion'),
      maritalStatus: val('inputMaritalStatus'),
      permanentAddress: val('inputPermanentAddress'),
      currentAddress: val('inputCurrentAddress'),
      contractType: val('inputContractType'),
      employmentType: val('inputEmploymentType'),
      workLocation: val('inputWorkLocation'),
      emergencyContact: {
        name: val('inputEmergencyName'),
        relation: val('inputEmergencyRelation'),
        phone: val('inputEmergencyPhone')
      },
      taxCode: val('inputTaxCode'),
      socialInsuranceNo: val('inputSocialInsuranceNo'),
      healthInsuranceNo: val('inputHealthInsuranceNo'),
      bankAccount: {
        bankName: val('inputBankName'),
        accountNo: val('inputBankAccountNo'),
        accountName: val('inputBankAccountName'),
        branch: val('inputBankBranch')
      }
    };
    // Sync assignments
    const deptObj = state.departments.find(d => d.id === department);
    const posObj = state.positions.find(p => p.id === position || p.name === position);
    data.assignments = [{
      isPrimary: true,
      departmentId: department || '',
      departmentName: deptObj?.name || '',
      positionId: position || '',
      positionName: posObj?.name || position || ''
    }];
    // Date fields
    const dobVal = val('inputDob');
    if (dobVal) data.dateOfBirth = new Date(dobVal);
    const hireDateVal = val('inputHireDate');
    if (hireDateVal) data.hireDate = new Date(hireDateVal);
    const probationEndVal = val('inputProbationEndDate');
    if (probationEndVal) data.probationEndDate = new Date(probationEndVal);

    try {
      let savedId = state.editingId;
      if (state.editingId) {
        await SVC().savePersonnel(state.editingId, data);
        if (systemRoleId) await SVC().syncUserSystemRole(username, systemRoleId);
        if (window.NhansuPerms?.canManageAccessRights?.(state.currentUser) && window.NhansuAccessRights) {
          await SVC().syncAccessRights(username, savedId, window.NhansuAccessRights.collect());
        }
        NS.toast('Đã cập nhật');
      } else {
        if (window.NhansuPerms?.canManageAccessRights?.(state.currentUser) && window.NhansuAccessRights) {
          data.appRolesCache = window.NhansuAccessRights.collect();
        }
        savedId = await SVC().createPersonnelWithAuth(username, password, data);
        if (window.NhansuPerms?.canManageAccessRights?.(state.currentUser) && data.appRolesCache) {
          await SVC().syncAccessRights(username, savedId, data.appRolesCache);
        }
        NS.toast('Đã thêm nhân viên');
      }

      if (typeof EmployeeProductionProfile !== 'undefined' && savedId) {
        const teamId = val('inputProdTeam');
        const workGroupId = val('inputWorkGroup');
        const employeeCode = val('inputCode');
        if (teamId && !workGroupId) {
          NS.toast('Chưa chọn nhóm CN/KH — nhân sự chưa hiện trong Sản lượng CN', 'warning');
        }
        await EmployeeProductionProfile.applyProfile(savedId, {
          teamId,
          workGroupId,
          employeeCode
        });
      }

      hide('employeeModal');
      state.editingId = null;
      await window.NhansuMain?.refresh();
    } catch (e) {
      console.error('Save employee error:', e);
      let msg = e.message;
      if (e.code === 'auth/email-already-in-use') msg = 'Username đã tồn tại';
      else if (e.code === 'auth/weak-password') msg = 'Mật khẩu quá yếu';
      else if (e.code === 'auth/invalid-email') msg = 'Username không hợp lệ';
      NS.toast('Lỗi: ' + msg, 'error');
    }
  }

  // ============== Employee Detail ==============
  function ensureEmployeeDetail() {
    const root = ensureModalRoot();
    if (document.getElementById('detailModal')) return;
    root.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" id="detailModal">
        <div class="modal" style="max-width:600px">
          <div class="modal-head">
            <h3>👤 Chi tiết nhân sự</h3>
            <button class="modal-close" data-close="detailModal">✕</button>
          </div>
          <div class="modal-body" id="detailContent"></div>
          <div class="modal-foot" id="detailFoot"></div>
        </div>
      </div>`);
  }

  async function openEmployeeDetail(id) {
    ensureEmployeeDetail();
    const p = state.allPersonnel.find(x => x.id === id);
    if (!p) { NS.toast('Không tìm thấy', 'error'); return; }

    if (window.NhansuAccessRights?.loadCatalog) {
      await window.NhansuAccessRights.loadCatalog();
    }

    const u = state.currentUser;
    const perms = window.NhansuPerms;
    const canEdit = perms.canEditEmployee(u, p, state.managedTeams);
    const canDelete = perms.canDeleteEmployees(u);

    const row = (lbl, v) => v ? `<div class="detail-row"><span class="lbl">${esc(lbl)}</span><span class="val">${esc(v)}</span></div>` : '';
    const dateRow = (lbl, d) => d ? row(lbl, fmtDate(d)) : '';

    document.getElementById('detailContent').innerHTML = `
      <div class="detail-section">
        <h4>📋 Thông tin cơ bản</h4>
        ${row('Họ tên', p.hoTen)}
        ${row('Mã NV', p.employeeCode)}
        ${row('SĐT', p.phone)}
        ${row('CCCD', p.cccd)}
        ${row('Email cá nhân', p.personalEmail)}
        ${row('Email hệ thống', p.email)}
        ${row('Username', p.username)}
        ${row('Vai trò', personSystemRoleLabel(p))}
        ${row('Trạng thái', p.disabled ? '❌ Nghỉ việc' : '✅ Đang làm')}
      </div>
      <div class="detail-section">
        <h4>🔐 Quyền truy cập ứng dụng</h4>
        ${window.NhansuAccessRights ? window.NhansuAccessRights.summarize(p.appRolesCache) : row('App', '—')}
      </div>
      <div class="detail-section">
        <h4>🏢 Tổ chức</h4>
        ${row('Phòng ban', deptName(p.department))}
        ${row('Chức vụ', posName(p.position))}
        ${row('Tổ', p.team ? teamName(p.team) : '')}
        ${row('Nơi làm việc', p.workLocation)}
      </div>
      <div class="detail-section">
        <h4>👤 Thông tin cá nhân</h4>
        ${row('Giới tính', p.gender === 'male' ? 'Nam' : p.gender === 'female' ? 'Nữ' : '')}
        ${dateRow('Ngày sinh', p.dateOfBirth)}
        ${row('Nơi sinh', p.placeOfBirth)}
        ${row('Dân tộc', p.ethnicity)}
        ${row('Tôn giáo', p.religion)}
        ${row('Hôn nhân', p.maritalStatus)}
      </div>
      ${(p.permanentAddress || p.currentAddress) ? `
        <div class="detail-section">
          <h4>🏠 Địa chỉ</h4>
          ${row('Thường trú', p.permanentAddress)}
          ${row('Tạm trú', p.currentAddress)}
        </div>` : ''}
      <div class="detail-section">
        <h4>📅 Lao động</h4>
        ${dateRow('Ngày vào', p.hireDate)}
        ${dateRow('Hết thử việc', p.probationEndDate)}
        ${row('Loại HĐ', p.contractType)}
        ${row('Hình thức', p.employmentType)}
      </div>
      ${p.emergencyContact?.name ? `
        <div class="detail-section">
          <h4>📞 Liên hệ khẩn</h4>
          ${row('Họ tên', p.emergencyContact.name)}
          ${row('Quan hệ', p.emergencyContact.relation)}
          ${row('SĐT', p.emergencyContact.phone)}
        </div>` : ''}
      ${(p.taxCode || p.socialInsuranceNo || p.healthInsuranceNo) ? `
        <div class="detail-section">
          <h4>💰 Thuế & BHXH</h4>
          ${row('MST', p.taxCode)}
          ${row('Sổ BHXH', p.socialInsuranceNo)}
          ${row('Thẻ BHYT', p.healthInsuranceNo)}
        </div>` : ''}
      ${p.bankAccount?.bankName ? `
        <div class="detail-section">
          <h4>🏦 Ngân hàng</h4>
          ${row('Ngân hàng', p.bankAccount.bankName)}
          ${row('Số TK', p.bankAccount.accountNo)}
          ${row('Tên TK', p.bankAccount.accountName)}
          ${row('Chi nhánh', p.bankAccount.branch)}
        </div>` : ''}
      ${(p.concurrentPositions || []).length > 0 ? `
        <div class="detail-section">
          <h4>👔 Chức vụ kiêm nhiệm</h4>
          ${p.concurrentPositions.map(cp =>
            `<div class="detail-row"><span class="lbl">${esc(cp.positionName || cp.positionId)}${cp.isPrimary ? ' ⭐' : ''}</span><span class="val">${esc(cp.departmentName || '-')}</span></div>`
          ).join('')}
        </div>` : ''}
    `;

    const footActions = [];
    if (canDelete) footActions.push(`<button class="btn btn-danger" id="btnDeleteEmp">🗑️ Xóa</button>`);
    if (canEdit) footActions.push(`<button class="btn" id="btnPositionsEmp">👔 Kiêm nhiệm</button>`);
    if (canEdit) footActions.push(`<button class="btn btn-primary" id="btnEditEmp">✏️ Sửa</button>`);
    document.getElementById('detailFoot').innerHTML = footActions.join('');

    document.getElementById('btnEditEmp')?.addEventListener('click', () => {
      hide('detailModal');
      openEmployeeForm(id);
    });
    document.getElementById('btnDeleteEmp')?.addEventListener('click', () => {
      confirmDialog(`Xóa <b>${esc(p.hoTen)}</b>?<br><small>(Tài khoản Auth không bị xóa)</small>`, async () => {
        try {
          await SVC().deletePersonnel(id);
          NS.toast('Đã xóa');
          hide('detailModal');
          await window.NhansuMain?.refresh();
        } catch (e) { NS.toast('Lỗi: ' + e.message, 'error'); }
      });
    });
    document.getElementById('btnPositionsEmp')?.addEventListener('click', () => {
      hide('detailModal');
      openMultiPosition(id);
    });

    show('detailModal');
  }

  // ============== Department Form ==============
  function ensureDeptForm() {
    const root = ensureModalRoot();
    if (document.getElementById('deptModal')) return;
    root.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" id="deptModal">
        <div class="modal" style="max-width:480px">
          <div class="modal-head">
            <h3 id="deptModalTitle">🏢 Thêm phòng ban</h3>
            <button class="modal-close" data-close="deptModal">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <div class="form-field full"><label>Tên <span class="req">*</span></label><input type="text" class="form-input" id="inputDeptName"></div>
              <div class="form-field"><label>Mã</label><input type="text" class="form-input" id="inputDeptCode"></div>
              <div class="form-field"><label>Thứ tự (số nhỏ = trước)</label><input type="number" class="form-input" id="inputDeptOrder" placeholder="VD: 10" min="0" max="9999"></div>
              <div class="form-field full nhansu-hidden"><label>Nhà máy</label>
                <select class="form-input" id="inputDeptFactory">
                  <option value="">-- Không gán (cấp công ty) --</option>
                </select>
              </div>
              <div class="form-field full"><label>Mô tả</label><textarea class="form-input" id="inputDeptDesc" rows="2"></textarea></div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn" id="btnDeleteDept" style="display:none">🗑️ Xóa</button>
            <button class="btn" data-close="deptModal">Hủy</button>
            <button class="btn btn-primary" id="btnSaveDept">💾 Lưu</button>
          </div>
        </div>
      </div>`);
    document.getElementById('btnSaveDept').onclick = saveDept;
  }

  function openDeptForm(id) {
    ensureDeptForm();
    state.editingDeptId = id || null;
    document.getElementById('deptModalTitle').textContent = id ? '✏️ Sửa phòng ban' : '🏢 Thêm phòng ban';
    // Repopulate factory dropdown each time (factories may have been edited)
    const fSel = document.getElementById('inputDeptFactory');
    fSel.innerHTML = '<option value="">-- Không gán (cấp công ty) --</option>';
    getFactories().forEach(f => fSel.insertAdjacentHTML('beforeend', `<option value="${esc(f.id)}">${esc(f.name)}</option>`));
    setVal('inputDeptName', '');
    setVal('inputDeptCode', '');
    setVal('inputDeptOrder', '');
    setVal('inputDeptFactory', '');
    setVal('inputDeptDesc', '');
    const delBtn = document.getElementById('btnDeleteDept');
    delBtn.style.display = 'none';
    if (id) {
      const d = state.departments.find(x => x.id === id);
      if (!d) return;
      setVal('inputDeptName', d.name);
      setVal('inputDeptCode', d.code);
      setVal('inputDeptOrder', d.order);
      setVal('inputDeptFactory', d.factory);
      setVal('inputDeptDesc', d.description);
      if (window.NhansuPerms.canManageDepartments(state.currentUser)) {
        delBtn.style.display = '';
        delBtn.onclick = () => deleteDept(id, d.name);
      }
    }
    show('deptModal');
  }

  async function saveDept() {
    const name = val('inputDeptName');
    if (!name) { NS.toast('Nhập tên phòng ban', 'error'); return; }
    const orderRaw = val('inputDeptOrder');
    const data = {
      name,
      code: val('inputDeptCode'),
      order: orderRaw === '' ? null : (parseInt(orderRaw, 10) || null),
      factory: val('inputDeptFactory'),
      description: val('inputDeptDesc')
    };
    try {
      await SVC().saveDepartment(state.editingDeptId, data);
      NS.toast('Đã lưu');
      hide('deptModal');
      await window.NhansuMain?.refresh();
    } catch (e) { NS.toast('Lỗi: ' + e.message, 'error'); }
  }

  function deleteDept(id, name) {
    confirmDialog(`Xóa phòng ban <b>${esc(name)}</b>?`, async () => {
      try {
        await SVC().deleteDepartment(id);
        NS.toast('Đã xóa');
        hide('deptModal');
        await window.NhansuMain?.refresh();
      } catch (e) { NS.toast('Lỗi: ' + e.message, 'error'); }
    });
  }

  // ============== Factory Form ==============
  function ensureFactoryForm() {
    const root = ensureModalRoot();
    if (document.getElementById('factoryModal')) return;
    root.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" id="factoryModal">
        <div class="modal" style="max-width:480px">
          <div class="modal-head">
            <h3 id="factoryModalTitle">🏭 Thêm nhà máy</h3>
            <button class="modal-close" data-close="factoryModal">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <div class="form-field full"><label>Tên nhà máy <span class="req">*</span></label><input type="text" class="form-input" id="inputFactoryName" placeholder="VD: NM Bố Lá (A01)"></div>
              <div class="form-field"><label>Mã / ID <span class="req">*</span></label><input type="text" class="form-input" id="inputFactoryId" placeholder="VD: A01"></div>
              <div class="form-field"><label>Icon</label><input type="text" class="form-input" id="inputFactoryIcon" placeholder="🏭" maxlength="4"></div>
              <div class="form-field"><label>Thứ tự</label><input type="number" class="form-input" id="inputFactoryOrder" placeholder="1" min="0" max="9999"></div>
            </div>
            <div style="margin-top:8px;font-size:11px;color:var(--text2)">
              <b>Lưu ý:</b> Mã/ID dùng để liên kết với <code>employee.factory</code> và <code>department.factory</code>.
              <span id="factoryIdHint">Đổi ID có thể làm vỡ liên kết — chỉ đổi khi chưa có dữ liệu.</span>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-danger" id="btnDeleteFactory" style="display:none">🗑️ Xóa</button>
            <button class="btn" data-close="factoryModal">Hủy</button>
            <button class="btn btn-primary" id="btnSaveFactory">💾 Lưu</button>
          </div>
        </div>
      </div>`);
    document.getElementById('btnSaveFactory').onclick = saveFactory;
  }

  let editingFactoryId = null;

  function openFactoryForm(id) {
    ensureFactoryForm();
    editingFactoryId = id || null;
    document.getElementById('factoryModalTitle').textContent = id ? '✏️ Sửa nhà máy' : '🏭 Thêm nhà máy';
    setVal('inputFactoryName', '');
    setVal('inputFactoryId', '');
    setVal('inputFactoryIcon', '🏭');
    setVal('inputFactoryOrder', '');
    const idInput = document.getElementById('inputFactoryId');
    const delBtn = document.getElementById('btnDeleteFactory');
    delBtn.style.display = 'none';

    if (id) {
      const f = getFactories().find(x => x.id === id);
      if (!f) return;
      setVal('inputFactoryName', f.name);
      setVal('inputFactoryId', f.id);
      setVal('inputFactoryIcon', f.icon || '🏭');
      setVal('inputFactoryOrder', f.order);
      idInput.disabled = true;
      delBtn.style.display = '';
      delBtn.onclick = () => deleteFactoryConfirm(id, f.name);
    } else {
      idInput.disabled = false;
    }
    show('factoryModal');
  }

  async function saveFactory() {
    const name = val('inputFactoryName');
    const id = val('inputFactoryId').toUpperCase();
    if (!name || !id) { NS.toast('Nhập tên + mã/ID', 'error'); return; }
    if (!/^[A-Z0-9_-]+$/.test(id)) { NS.toast('Mã chỉ chứa chữ in/số/_/-', 'error'); return; }
    const orderRaw = val('inputFactoryOrder');
    const data = {
      name,
      icon: val('inputFactoryIcon') || '🏭',
      order: orderRaw === '' ? null : (parseInt(orderRaw, 10) || null)
    };
    try {
      // For new: pass id explicitly so doc ID = factory ID
      await SVC().saveFactory(editingFactoryId || id, data);
      NS.toast('Đã lưu');
      hide('factoryModal');
      await window.NhansuMain?.refresh();
    } catch (e) { NS.toast('Lỗi: ' + e.message, 'error'); }
  }

  function deleteFactoryConfirm(id, name) {
    const empCount = state.allPersonnel.filter(p => NS.effFactory(p) === id).length;
    const deptCount = state.departments.filter(d => d.factory === id).length;
    if (empCount > 0 || deptCount > 0) {
      NS.toast(`Còn ${empCount} NV và ${deptCount} PB thuộc nhà máy — gỡ trước khi xóa`, 'error');
      return;
    }
    confirmDialog(`Xóa nhà máy <b>${esc(name)}</b>?`, async () => {
      try {
        await SVC().deleteFactory(id);
        NS.toast('Đã xóa');
        hide('factoryModal');
        await window.NhansuMain?.refresh();
      } catch (e) { NS.toast('Lỗi: ' + e.message, 'error'); }
    });
  }

  // ============== Position Form & List ==============
  function ensurePositionsList() {
    const root = ensureModalRoot();
    if (document.getElementById('posListModal')) return;
    root.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" id="posListModal">
        <div class="modal" style="max-width:520px">
          <div class="modal-head">
            <h3>💼 Danh mục chức vụ</h3>
            <button class="modal-close" data-close="posListModal">✕</button>
          </div>
          <div class="modal-body">
            <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
              <button class="btn btn-primary btn-sm" id="btnAddPos">➕ Thêm chức vụ</button>
            </div>
            <div id="posListBody"></div>
          </div>
        </div>
      </div>`);
    document.getElementById('btnAddPos').onclick = () => openPosForm();
  }

  function openPositionsList() {
    ensurePositionsList();
    renderPositionsList();
    show('posListModal');
  }

  function renderPositionsList() {
    const body = document.getElementById('posListBody');
    const sorted = [...state.positions].sort((a, b) => (a.level || 999) - (b.level || 999));
    body.innerHTML = sorted.length ? sorted.map(p => {
      const count = state.allPersonnel.filter(x =>
        resolvePositionId(x.position, state.positions) === p.id && !x.disabled
      ).length;
      return `
        <div class="emp-card" style="cursor:default">
          <div class="emp-info">
            <div class="emp-name">💼 ${esc(p.name)} ${p.level ? `<span class="badge user">Bậc ${p.level}</span>` : ''}</div>
            <div class="emp-meta">${count} nhân viên${p.code ? ' · ' + esc(p.code) : ''}</div>
          </div>
          <div class="emp-actions">
            <button class="btn-icon-sm" data-pos-edit="${esc(p.id)}" title="Sửa">✏️</button>
          </div>
        </div>`;
    }).join('') : '<div class="state"><div class="msg">Chưa có chức vụ</div></div>';
    body.onclick = (e) => {
      const id = e.target.closest('[data-pos-edit]')?.dataset.posEdit;
      if (id) openPosForm(id);
    };
  }

  function ensurePosForm() {
    const root = ensureModalRoot();
    if (document.getElementById('posModal')) return;
    root.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" id="posModal">
        <div class="modal" style="max-width:440px">
          <div class="modal-head">
            <h3 id="posModalTitle">💼 Thêm chức vụ</h3>
            <button class="modal-close" data-close="posModal">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-grid cols-1">
              <div class="form-field"><label>Tên <span class="req">*</span></label><input type="text" class="form-input" id="inputPosName"></div>
              <div class="form-field"><label>Mã</label><input type="text" class="form-input" id="inputPosCode"></div>
              <div class="form-field"><label>Bậc (level, 1=cao nhất)</label><input type="number" class="form-input" id="inputPosLevel" min="1" max="100"></div>
              <div class="form-field"><label>Mô tả</label><textarea class="form-input" id="inputPosDesc" rows="2"></textarea></div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn" id="btnDeletePos" style="display:none">🗑️ Xóa</button>
            <button class="btn" data-close="posModal">Hủy</button>
            <button class="btn btn-primary" id="btnSavePos">💾 Lưu</button>
          </div>
        </div>
      </div>`);
    document.getElementById('btnSavePos').onclick = savePos;
  }

  function openPosForm(id) {
    ensurePosForm();
    state.editingPosId = id || null;
    document.getElementById('posModalTitle').textContent = id ? '✏️ Sửa chức vụ' : '💼 Thêm chức vụ';
    setVal('inputPosName', '');
    setVal('inputPosCode', '');
    setVal('inputPosLevel', '');
    setVal('inputPosDesc', '');
    const delBtn = document.getElementById('btnDeletePos');
    delBtn.style.display = 'none';
    if (id) {
      const p = state.positions.find(x => x.id === id);
      if (!p) return;
      setVal('inputPosName', p.name);
      setVal('inputPosCode', p.code);
      setVal('inputPosLevel', p.level);
      setVal('inputPosDesc', p.description);
      delBtn.style.display = '';
      delBtn.onclick = () => deletePos(id, p.name);
    }
    show('posModal');
  }

  async function savePos() {
    const name = val('inputPosName');
    if (!name) { NS.toast('Nhập tên chức vụ', 'error'); return; }
    const data = {
      name, code: val('inputPosCode'),
      level: parseInt(val('inputPosLevel'), 10) || null,
      description: val('inputPosDesc')
    };
    try {
      await SVC().savePosition(state.editingPosId, data);
      NS.toast('Đã lưu');
      hide('posModal');
      await window.NhansuMain?.refresh();
      renderPositionsList();
    } catch (e) { NS.toast('Lỗi: ' + e.message, 'error'); }
  }

  function deletePos(id, name) {
    confirmDialog(`Xóa chức vụ <b>${esc(name)}</b>?`, async () => {
      try {
        await SVC().deletePosition(id);
        NS.toast('Đã xóa');
        hide('posModal');
        await window.NhansuMain?.refresh();
        renderPositionsList();
      } catch (e) { NS.toast('Lỗi: ' + e.message, 'error'); }
    });
  }

  // ============== Team Form ==============
  function ensureTeamForm() {
    const root = ensureModalRoot();
    if (document.getElementById('teamModal')) return;
    root.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" id="teamModal">
        <div class="modal" style="max-width:520px">
          <div class="modal-head">
            <h3 id="teamModalTitle">👥 Thêm tổ</h3>
            <button class="modal-close" data-close="teamModal">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <div class="form-field full"><label>Tên tổ <span class="req">*</span></label><input type="text" class="form-input" id="inputTeamName"></div>
              <div class="form-field"><label>Thứ tự</label><input type="number" class="form-input" id="inputTeamOrder" placeholder="VD: 10" min="0" max="9999"></div>
              <div class="form-field"><label>Loại tổ</label>
                <select class="form-input" id="inputTeamType">
                  ${Object.entries(TEAM_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
                </select>
              </div>
              <div class="form-field full"><label>Phòng ban <span class="req">*</span></label><select class="form-input" id="inputTeamDept"></select></div>
              <div class="form-field full"><label>Tổ trưởng (chọn sau cũng được)</label>
                <select class="form-input" id="inputTeamManager"><option value="">-- Chưa chọn --</option></select>
              </div>
              <div class="form-field full"><label>Ghi chú</label><textarea class="form-input" id="inputTeamNote" rows="2"></textarea></div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-danger" id="btnDeleteTeam" style="display:none">🗑️ Xóa</button>
            <button class="btn" data-close="teamModal">Hủy</button>
            <button class="btn btn-primary" id="btnSaveTeam">💾 Lưu</button>
          </div>
        </div>
      </div>`);
    document.getElementById('btnSaveTeam').onclick = saveTeam;
    document.getElementById('inputTeamDept').onchange = updateTeamManagerOptions;
  }

  function updateTeamManagerOptions(currentMgrId) {
    const deptId = val('inputTeamDept');
    const sel = document.getElementById('inputTeamManager');
    sel.innerHTML = '<option value="">-- Chưa chọn --</option>';
    state.allPersonnel
      .filter(p => p.department === deptId && !p.disabled)
      .forEach(p => sel.insertAdjacentHTML('beforeend', `<option value="${p.id}">${esc(p.hoTen)}</option>`));
    if (currentMgrId) sel.value = currentMgrId;
  }

  function openTeamForm(id, defaultDeptId) {
    ensureTeamForm();
    state.editingTeamId = id || null;
    document.getElementById('teamModalTitle').textContent = id ? '✏️ Sửa tổ' : '👥 Thêm tổ';

    // Populate dept dropdown
    const deptSel = document.getElementById('inputTeamDept');
    deptSel.innerHTML = '<option value="">-- Chọn --</option>';
    state.departments.forEach(d => deptSel.insertAdjacentHTML('beforeend', `<option value="${d.id}">${esc(d.name)}</option>`));

    setVal('inputTeamName', '');
    setVal('inputTeamOrder', '');
    setVal('inputTeamType', 'sanxuat');
    setVal('inputTeamNote', '');
    const delBtn = document.getElementById('btnDeleteTeam');
    delBtn.style.display = 'none';

    if (id) {
      const t = state.allTeams.find(x => x.id === id);
      if (!t) return;
      setVal('inputTeamName', t.name);
      setVal('inputTeamOrder', t.order);
      setVal('inputTeamDept', t.department);
      setVal('inputTeamType', t.teamType || 'sanxuat');
      setVal('inputTeamNote', t.note);
      updateTeamManagerOptions(t.managerId);
      delBtn.style.display = '';
      delBtn.onclick = () => deleteTeam(id, t.name);
    } else {
      if (defaultDeptId) setVal('inputTeamDept', defaultDeptId);
      updateTeamManagerOptions();
    }
    show('teamModal');
  }

  async function saveTeam() {
    const name = val('inputTeamName');
    const dept = val('inputTeamDept');
    if (!name || !dept) { NS.toast('Nhập tên + phòng ban', 'error'); return; }
    const mgrId = val('inputTeamManager');
    const mgr = state.allPersonnel.find(p => p.id === mgrId);
    const orderRaw = val('inputTeamOrder');
    const data = {
      name,
      order: orderRaw === '' ? null : (parseInt(orderRaw, 10) || null),
      department: dept,
      departmentName: NS.deptName(dept),
      teamType: val('inputTeamType') || 'sanxuat',
      managerId: mgrId || null,
      managerName: mgr?.hoTen || null,
      note: val('inputTeamNote')
    };
    try {
      await SVC().saveTeam(state.editingTeamId, data);
      NS.toast('Đã lưu');
      hide('teamModal');
      await window.NhansuMain?.refresh();
    } catch (e) { NS.toast('Lỗi: ' + e.message, 'error'); }
  }

  function deleteTeam(id, name) {
    const memberCount = state.allPersonnel.filter(p => p.team === id).length;
    if (memberCount > 0) {
      NS.toast(`Tổ còn ${memberCount} thành viên — gỡ thành viên trước khi xóa`, 'error');
      return;
    }
    confirmDialog(`Xóa tổ <b>${esc(name)}</b>?`, async () => {
      try {
        await SVC().deleteTeam(id);
        NS.toast('Đã xóa');
        hide('teamModal');
        await window.NhansuMain?.refresh();
      } catch (e) { NS.toast('Lỗi: ' + e.message, 'error'); }
    });
  }

  // Assign manager standalone (from team header action)
  function openAssignManager(teamId) {
    openTeamForm(teamId);
    setTimeout(() => document.getElementById('inputTeamManager')?.focus(), 100);
  }

  // ============== Multi-position (kiêm nhiệm) ==============
  function ensureMultiPosition() {
    const root = ensureModalRoot();
    if (document.getElementById('multiPosModal')) return;
    root.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" id="multiPosModal">
        <div class="modal" style="max-width:520px">
          <div class="modal-head">
            <h3>👔 Quản lý kiêm nhiệm</h3>
            <button class="modal-close" data-close="multiPosModal">✕</button>
          </div>
          <div class="modal-body">
            <div id="multiPosName" style="text-align:center;font-weight:600;margin-bottom:12px"></div>
            <div id="multiPosList" class="position-list"></div>
            <div id="multiPosForm" style="display:none;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
              <div class="form-grid">
                <div class="form-field"><label>Phòng ban</label><select class="form-input" id="mpDept"></select></div>
                <div class="form-field"><label>Chức vụ</label><select class="form-input" id="mpPos"></select></div>
                <div class="form-field"><label>Loại</label>
                  <select class="form-input" id="mpType">
                    <option value="primary">Chính</option>
                    <option value="concurrent">Kiêm nhiệm</option>
                  </select>
                </div>
                <div class="form-field"><label>Bắt đầu</label><input type="date" class="form-input" id="mpStart"></div>
              </div>
              <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end">
                <button class="btn btn-sm" id="mpHide">Hủy</button>
                <button class="btn btn-primary btn-sm" id="mpSave">Thêm</button>
              </div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn" data-close="multiPosModal">Đóng</button>
            <button class="btn btn-primary" id="mpShowForm">➕ Thêm</button>
          </div>
        </div>
      </div>`);
    document.getElementById('mpShowForm').onclick = () => {
      document.getElementById('multiPosForm').style.display = '';
    };
    document.getElementById('mpHide').onclick = () => {
      document.getElementById('multiPosForm').style.display = 'none';
    };
    document.getElementById('mpSave').onclick = saveMultiPos;
  }

  let mpUserId = null;

  async function openMultiPosition(userId) {
    ensureMultiPosition();
    mpUserId = userId;
    const p = state.allPersonnel.find(x => x.id === userId);
    document.getElementById('multiPosName').textContent = p?.hoTen || '';

    // Populate dept/position dropdowns
    const dSel = document.getElementById('mpDept');
    const pSel = document.getElementById('mpPos');
    dSel.innerHTML = '<option value="">-- Chọn --</option>';
    state.departments.forEach(d => dSel.insertAdjacentHTML('beforeend', `<option value="${d.id}">${esc(d.name)}</option>`));
    pSel.innerHTML = '<option value="">-- Chọn --</option>';
    state.positions.forEach(po => pSel.insertAdjacentHTML('beforeend', `<option value="${po.id}">${esc(po.name)}</option>`));

    document.getElementById('multiPosForm').style.display = 'none';
    await renderMultiPosList();
    show('multiPosModal');
  }

  async function renderMultiPosList() {
    const list = await SVC().loadEmployeePositions(mpUserId);
    const wrap = document.getElementById('multiPosList');
    if (!list.length) {
      wrap.innerHTML = '<div class="state"><div class="msg">Chưa có chức vụ kiêm nhiệm</div></div>';
      return;
    }
    wrap.innerHTML = list.map(item => `
      <div class="position-item ${item.isPrimary ? 'primary' : ''}">
        <div class="info">
          <div class="pname">${esc(item.positionName || item.positionId)} ${item.isPrimary ? '⭐' : ''}</div>
          <div class="pdept">${esc(item.departmentName || NS.deptName(item.departmentId))}</div>
        </div>
        ${!item.isPrimary ? `<button class="btn-icon-sm" data-mp-primary="${esc(item.id)}" title="Đặt chính">⭐</button>` : ''}
        <button class="btn-icon-sm" data-mp-del="${esc(item.id)}" title="Xóa">🗑️</button>
      </div>`).join('');

    wrap.onclick = async (e) => {
      const primaryId = e.target.closest('[data-mp-primary]')?.dataset.mpPrimary;
      const delId = e.target.closest('[data-mp-del]')?.dataset.mpDel;
      try {
        if (primaryId) {
          await SVC().setPrimaryEmployeePosition(mpUserId, primaryId);
          NS.toast('Đã đặt chính');
          await renderMultiPosList();
        }
        if (delId) {
          confirmDialog('Xóa chức vụ này?', async () => {
            await SVC().deleteEmployeePosition(delId);
            NS.toast('Đã xóa');
            await renderMultiPosList();
          });
        }
      } catch (err) { NS.toast('Lỗi: ' + err.message, 'error'); }
    };
  }

  async function saveMultiPos() {
    const deptId = val('mpDept');
    const posId = val('mpPos');
    const type = val('mpType');
    const start = val('mpStart');
    if (!deptId || !posId) { NS.toast('Chọn phòng ban + chức vụ', 'error'); return; }
    const data = {
      userId: mpUserId,
      departmentId: deptId,
      departmentName: NS.deptName(deptId),
      positionId: posId,
      positionName: NS.posName(posId),
      isPrimary: type === 'primary',
      assignmentType: type,
      startDate: start ? new Date(start) : null
    };
    try {
      await SVC().addEmployeePosition(data);
      if (data.isPrimary) await SVC().setPrimaryEmployeePosition(mpUserId, null);
      NS.toast('Đã thêm');
      document.getElementById('multiPosForm').style.display = 'none';
      await renderMultiPosList();
    } catch (e) { NS.toast('Lỗi: ' + e.message, 'error'); }
  }

  // ============== Import Excel ==============
  let importData = [];
  let importColumns = [];
  let matchResults = [];

  function ensureImport() {
    const root = ensureModalRoot();
    if (document.getElementById('importModal')) return;
    root.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" id="importModal">
        <div class="modal" style="max-width:640px">
          <div class="modal-head">
            <h3>📥 Import CCCD/Email</h3>
            <button class="modal-close" data-close="importModal">✕</button>
          </div>
          <div class="modal-body">
            <div id="importStep1">
              <p style="margin-bottom:12px;font-size:13px;color:var(--text2)">Chọn file Excel chứa dữ liệu CCCD/Email cần import.</p>
              <button class="btn btn-primary" id="btnPickFile">📁 Chọn file Excel</button>
              <input type="file" id="importFileInput" accept=".xlsx,.xls" style="display:none">
            </div>
            <div id="importStep2" style="display:none">
              <div class="import-info" id="importFileInfo"></div>
              <div class="form-grid cols-1">
                <div class="form-field"><label>Cột khớp (Tên/Mã NV)</label><select class="form-input" id="matchColumn"></select></div>
                <div class="form-field"><label>Cột CCCD</label><select class="form-input" id="cccdColumn"><option value="">-- Bỏ qua --</option></select></div>
                <div class="form-field"><label>Cột Email</label><select class="form-input" id="emailColumn"><option value="">-- Bỏ qua --</option></select></div>
              </div>
            </div>
            <div id="importStep3" style="display:none">
              <div class="import-counts">
                <span class="found">✅ <span id="matchedCount">0</span> tìm thấy</span>
                <span class="notfound">❌ <span id="unmatchedCount">0</span> không tìm thấy</span>
              </div>
              <div id="previewTable" class="preview-table"></div>
            </div>
          </div>
          <div class="modal-foot" id="importFoot">
            <button class="btn" data-close="importModal">Hủy</button>
            <button class="btn" id="btnImportBack" style="display:none">← Quay lại</button>
            <button class="btn btn-primary" id="btnImportPreview" style="display:none">Xem trước →</button>
            <button class="btn btn-primary" id="btnImportExec" style="display:none">✅ Thực thi</button>
          </div>
        </div>
      </div>`);
    document.getElementById('btnPickFile').onclick = () => document.getElementById('importFileInput').click();
    document.getElementById('importFileInput').onchange = handleImportFile;
    document.getElementById('btnImportBack').onclick = () => goImportStep(1);
    document.getElementById('btnImportPreview').onclick = previewImport;
    document.getElementById('btnImportExec').onclick = executeImport;
  }

  function openImport() {
    ensureImport();
    importData = []; importColumns = []; matchResults = [];
    goImportStep(1);
    show('importModal');
  }

  function goImportStep(n) {
    document.getElementById('importStep1').style.display = n === 1 ? '' : 'none';
    document.getElementById('importStep2').style.display = n === 2 ? '' : 'none';
    document.getElementById('importStep3').style.display = n === 3 ? '' : 'none';
    document.getElementById('btnImportBack').style.display = n > 1 ? '' : 'none';
    document.getElementById('btnImportPreview').style.display = n === 2 ? '' : 'none';
    document.getElementById('btnImportExec').style.display = n === 3 ? '' : 'none';
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!json.length) { NS.toast('File rỗng', 'error'); return; }
        importData = json;
        importColumns = Object.keys(json[0]);

        document.getElementById('importFileInfo').innerHTML =
          `📄 <b>${esc(file.name)}</b> · ${json.length} dòng · ${importColumns.length} cột`;

        ['matchColumn', 'cccdColumn', 'emailColumn'].forEach(id => {
          const sel = document.getElementById(id);
          sel.innerHTML = id === 'matchColumn' ? '' : '<option value="">-- Bỏ qua --</option>';
          importColumns.forEach(c => sel.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`));
        });
        // Auto-detect
        importColumns.forEach(c => {
          const lc = c.toLowerCase();
          if (lc.includes('họ tên') || lc.includes('hoten') || lc.includes('tên') || lc.includes('name'))
            document.getElementById('matchColumn').value = c;
          if (lc.includes('cccd') || lc.includes('cmnd') || lc.includes('căn cước'))
            document.getElementById('cccdColumn').value = c;
          if (lc.includes('email') || lc.includes('mail'))
            document.getElementById('emailColumn').value = c;
        });

        goImportStep(2);
      } catch (err) { NS.toast('Lỗi đọc file: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(file);
  }

  function previewImport() {
    const matchCol = val('matchColumn');
    const cccdCol = val('cccdColumn');
    const emailCol = val('emailColumn');
    if (!matchCol) { NS.toast('Chọn cột khớp', 'error'); return; }
    if (!cccdCol && !emailCol) { NS.toast('Chọn ít nhất 1 cột CCCD/Email', 'error'); return; }

    matchResults = importData.map(row => {
      const matchVal = String(row[matchCol] || '').trim().toLowerCase();
      let employee = null;
      if (matchVal) {
        employee = state.allPersonnel.find(p => {
          const name = (p.hoTen || '').toLowerCase();
          const code = (p.employeeCode || '').toLowerCase();
          return name === matchVal || code === matchVal || name.includes(matchVal);
        });
      }
      return {
        row,
        matchVal: row[matchCol],
        cccd: cccdCol ? String(row[cccdCol] || '').trim() : '',
        email: emailCol ? String(row[emailCol] || '').trim() : '',
        employee
      };
    });

    const matched = matchResults.filter(r => r.employee).length;
    document.getElementById('matchedCount').textContent = matched;
    document.getElementById('unmatchedCount').textContent = matchResults.length - matched;

    const rows = matchResults.slice(0, 100).map(r => `
      <tr class="${r.employee ? 'matched' : 'unmatched'}">
        <td>${r.employee ? '✅' : '❌'}</td>
        <td>${esc(r.matchVal)}</td>
        <td>${esc(r.cccd)}</td>
        <td>${esc(r.email)}</td>
        <td>${esc(r.employee?.hoTen || '-')}</td>
      </tr>`).join('');
    document.getElementById('previewTable').innerHTML = `
      <table>
        <thead><tr><th></th><th>${esc(val('matchColumn'))}</th><th>CCCD</th><th>Email</th><th>Khớp</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    goImportStep(3);
  }

  async function executeImport() {
    const matched = matchResults.filter(r => r.employee);
    if (!matched.length) { NS.toast('Không có dòng nào khớp', 'error'); return; }
    const db = window.db;
    let batch = db.batch(), count = 0, done = 0;
    try {
      for (const r of matched) {
        const update = {};
        if (r.cccd) update.cccd = r.cccd;
        if (r.email) update.personalEmail = r.email;
        if (Object.keys(update).length === 0) continue;
        update.updatedAt = ErpDb.firestore.FieldValue.serverTimestamp();
        batch.update(db.collection('categoryPersonnel').doc(r.employee.id), update);
        count++; done++;
        if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
      }
      if (count > 0) await batch.commit();
      NS.toast(`Đã cập nhật ${done} nhân sự`);
      hide('importModal');
      await window.NhansuMain?.refresh();
    } catch (e) { NS.toast('Lỗi: ' + e.message, 'error'); }
  }

  // ============== My Permissions ==============
  function ensureMyPerms() {
    const root = ensureModalRoot();
    if (document.getElementById('myPermsModal')) return;
    root.insertAdjacentHTML('beforeend', `
      <div class="modal-bg" id="myPermsModal">
        <div class="modal" style="max-width:520px">
          <div class="modal-head">
            <h3>🔐 Quyền của tôi</h3>
            <button class="modal-close" data-close="myPermsModal">✕</button>
          </div>
          <div class="modal-body" id="myPermsBody"></div>
        </div>
      </div>`);
  }

  function openMyPerms() {
    ensureMyPerms();
    const u = state.currentUser;
    if (!u) return;
    const body = document.getElementById('myPermsBody');
    const isAdm = window.NhansuPerms.isAdmin(u);
    const sc = window.NhansuPerms.getScope(u);
    const role = u.role || u.globalRole || 'user';

    let perms = [];
    try {
      if (typeof Permissions !== 'undefined' && Permissions.getEffectivePermissions) {
        perms = Permissions.getEffectivePermissions('nhansu') || [];
      }
    } catch {}

    body.innerHTML = `
      <div class="detail-section">
        <h4>Vai trò</h4>
        <div class="detail-row"><span class="lbl">Hệ thống</span><span class="val">${esc(role)}${isAdm ? ' 👑' : ''}</span></div>
        <div class="detail-row"><span class="lbl">Phạm vi (nhansu)</span><span class="val">${esc(sc.type || 'none')}${sc.ids?.length ? ' · ' + sc.ids.length + ' ID' : ''}</span></div>
      </div>
      ${perms.length ? `
        <div class="detail-section">
          <h4>Quyền hiệu lực</h4>
          ${perms.map(p => `<div class="detail-row"><span class="val">${esc(p)}</span></div>`).join('')}
        </div>` : ''}
      ${state.managedTeams.length ? `
        <div class="detail-section">
          <h4>Tổ quản lý</h4>
          ${state.managedTeams.map(t => `<div class="detail-row"><span class="val">👥 ${esc(t.name)}</span></div>`).join('')}
        </div>` : ''}
    `;
    show('myPermsModal');
  }

  // ============== Init bindings ==============
  bindClose();

  window.NhansuModals = {
    openEmployeeForm,
    openEmployeeDetail,
    openDeptForm,
    openFactoryForm,
    openPositionsList,
    openTeamForm,
    openAssignManager,
    openMultiPosition,
    openImport,
    openMyPerms,
    confirmDialog
  };
})();
