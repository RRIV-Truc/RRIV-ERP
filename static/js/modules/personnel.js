/**
 * Personnel Management Module
 * Quản lý nhân sự - MASTER data source
 * @module personnel
 */

const Personnel = (function() {
  'use strict';

  // ==================== STATE ====================
  let personnelList = [];
  let filteredList = [];
  let departments = [];
  let positions = [];
  let teams = [];
  let factories = [];
  let currentEditId = null;
  let isLoading = false;
  let managedTeams = []; // Danh sách tổ mà user hiện tại quản lý (Tổ trưởng)

  // ==================== CONSTANTS ====================
  const COLLECTION = 'categoryPersonnel';
  const ROLES = {
    admin: { label: 'Admin', color: '#dc2626', bgColor: '#fef2f2' },
    vpp: { label: 'Quản lý', color: '#2563eb', bgColor: '#eff6ff' },
    user: { label: 'Nhân viên', color: '#059669', bgColor: '#ecfdf5' }
  };

  // ==================== INITIALIZATION ====================

  /**
   * Khởi tạo module
   */
  async function init() {
    await loadDropdowns();
    await loadManagedTeams();
    await loadList();
    bindEvents();
    updateUIBasedOnPermissions();
  }

  /**
   * Load danh sách tổ mà user hiện tại quản lý (Tổ trưởng)
   */
  async function loadManagedTeams() {
    try {
      const db = API.getFirestore();
      const userProfile = Auth.userProfile;
      if (!db || !userProfile) return;

      // Admin và VPP/Manager không cần check, họ có toàn quyền trong đội
      if (userProfile.role === 'admin' || userProfile.role === 'vpp' || userProfile.role === 'manager') {
        managedTeams = [];
        return;
      }

      // Tìm các tổ mà user là managerId
      const snapshot = await db.collection('categoryTeams')
        .where('managerId', '==', userProfile.id || Auth.currentUser?.uid)
        .get();

      managedTeams = snapshot.docs.map(d => d.id);
      console.log('📋 Managed teams:', managedTeams);
    } catch (error) {
      console.error('Error loading managed teams:', error);
      managedTeams = [];
    }
  }

  /**
   * Cập nhật UI dựa trên quyền của user
   */
  function updateUIBasedOnPermissions() {
    const userProfile = Auth.userProfile;
    if (!userProfile) return;

    const canCreate = canCreatePersonnel();

    // Ẩn/hiện nút thêm nhân sự
    const addBtn = document.getElementById('personnelAddBtn');
    if (addBtn) {
      addBtn.style.display = canCreate ? '' : 'none';
    }

    // Hiển thị thông báo nếu là Tổ trưởng
    if (managedTeams.length > 0 && userProfile.role !== 'admin' && userProfile.role !== 'vpp') {
      const teamNames = teams.filter(t => managedTeams.includes(t.id)).map(t => t.name).join(', ');
      console.log('🔰 Bạn là Tổ trưởng của:', teamNames);
    }
  }

  /**
   * Kiểm tra user có quyền tạo nhân sự không
   */
  function canCreatePersonnel() {
    const userProfile = Auth.userProfile;
    if (!userProfile) return false;

    // Admin, VPP, Manager có thể tạo
    if (['admin', 'vpp', 'manager'].includes(userProfile.role)) return true;

    // Tổ trưởng có thể tạo công nhân trong tổ
    return managedTeams.length > 0;
  }

  /**
   * Kiểm tra user có quyền sửa/xóa 1 nhân sự cụ thể không
   */
  function canEditPerson(person) {
    const userProfile = Auth.userProfile;
    if (!userProfile) return false;

    // Admin có toàn quyền
    if (userProfile.role === 'admin') return true;

    // VPP/Manager có quyền với nhân sự cùng đội
    if (userProfile.role === 'vpp' || userProfile.role === 'manager') {
      return person.department === userProfile.department;
    }

    // Tổ trưởng có quyền với công nhân trong tổ mình
    if (managedTeams.length > 0 && managedTeams.includes(person.team)) {
      return person.department === userProfile.department;
    }

    return false;
  }

  /**
   * Load danh sách dropdown
   */
  async function loadDropdowns() {
    try {
      const db = API.getFirestore();
      if (!db) return;

      // Load in parallel
      const [deptSnap, posSnap, teamSnap, factSnap] = await Promise.all([
        db.collection('categoryDepartments').orderBy('name').get(),
        db.collection('categoryPositions').orderBy('name').get(),
        db.collection('categoryTeams').orderBy('name').get(),
        db.collection('categoryFactories').orderBy('name').get()
      ]);

      departments = deptSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      positions = posSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      teams = teamSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      factories = factSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Populate dropdowns
      populateDropdown('personnelDeptFilter', departments, 'Tất cả phòng ban');
      populateDropdown('personnelDept', departments);
      populateDropdown('personnelPosition', positions);
      populateDropdown('personnelTeam', teams);
      populateDropdown('personnelFactory', factories);

    } catch (error) {
      ErrorHandler.handle(error, 'Personnel.loadDropdowns');
    }
  }

  /**
   * Populate dropdown element
   */
  function populateDropdown(elementId, items, allOption = null) {
    const select = document.getElementById(elementId);
    if (!select) return;

    let html = allOption ? `<option value="">${allOption}</option>` : '<option value="">-- Chọn --</option>';
    items.forEach(item => {
      html += `<option value="${item.id || item.name}">${Validation.sanitizeHTML(item.name)}</option>`;
    });
    select.innerHTML = html;
  }

  // ==================== DATA OPERATIONS ====================

  /**
   * Load danh sách nhân sự
   * - Admin: Xem tất cả
   * - VPP/Manager: Xem nhân sự cùng đội
   * - Tổ trưởng: Xem nhân sự cùng đội (filter tổ ở client)
   * - User thường: Xem nhân sự cùng đội (read-only)
   */
  async function loadList() {
    if (isLoading) return;
    isLoading = true;

    const hideLoading = UI.showLoading('Đang tải danh sách nhân sự...', 'personnelTableContainer');

    try {
      const db = API.getFirestore();
      if (!db) throw new Error('Firestore not initialized');

      const userProfile = Auth.userProfile;
      let query = db.collection(COLLECTION);

      // Filter theo department nếu không phải admin
      if (userProfile && userProfile.role !== 'admin' && userProfile.department) {
        query = query.where('department', '==', userProfile.department);
      }

      const snapshot = await query.orderBy('hoTen').get();

      personnelList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Tổ trưởng: chỉ hiển thị công nhân trong tổ mình quản lý
      if (managedTeams.length > 0 && userProfile.role !== 'admin' && userProfile.role !== 'vpp' && userProfile.role !== 'manager') {
        personnelList = personnelList.filter(p => managedTeams.includes(p.team));
      }

      filteredList = [...personnelList];
      updateStats();
      renderTable();

    } catch (error) {
      ErrorHandler.handle(error, 'Personnel.loadList');
      document.getElementById('personnelTableContainer').innerHTML = `
        <div style="text-align:center;padding:40px;color:#6b7280">
          <div style="font-size:48px;margin-bottom:16px">⚠️</div>
          <p>Không thể tải danh sách nhân sự</p>
          <button onclick="Personnel.loadList()" style="margin-top:16px;padding:8px 16px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer">Thử lại</button>
        </div>
      `;
    } finally {
      hideLoading();
      isLoading = false;
    }
  }

  /**
   * Cập nhật thống kê
   */
  function updateStats() {
    const total = personnelList.length;
    const active = personnelList.filter(p => !p.disabled).length;
    const admins = personnelList.filter(p => p.role === 'admin').length;

    const totalEl = document.getElementById('personnelStatTotal');
    const activeEl = document.getElementById('personnelStatActive');
    const adminEl = document.getElementById('personnelStatAdmin');

    if (totalEl) totalEl.textContent = total;
    if (activeEl) activeEl.textContent = active;
    if (adminEl) adminEl.textContent = admins;
  }

  /**
   * Render bảng nhân sự
   */
  function renderTable() {
    const container = document.getElementById('personnelTableContainer');
    if (!container) return;

    if (filteredList.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:40px;color:#6b7280">
          <div style="font-size:48px;margin-bottom:16px">👥</div>
          <p>Không có nhân sự nào</p>
        </div>
      `;
      return;
    }

    let html = `
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:12px;text-align:left;font-weight:600;border-bottom:2px solid #e5e7eb">Họ tên</th>
            <th style="padding:12px;text-align:left;font-weight:600;border-bottom:2px solid #e5e7eb">Username</th>
            <th style="padding:12px;text-align:left;font-weight:600;border-bottom:2px solid #e5e7eb">Phòng ban</th>
            <th style="padding:12px;text-align:center;font-weight:600;border-bottom:2px solid #e5e7eb">Vai trò</th>
            <th style="padding:12px;text-align:center;font-weight:600;border-bottom:2px solid #e5e7eb">Trạng thái</th>
            <th style="padding:12px;text-align:center;font-weight:600;border-bottom:2px solid #e5e7eb">Thao tác</th>
          </tr>
        </thead>
        <tbody>
    `;

    filteredList.forEach(person => {
      const role = ROLES[person.role] || ROLES.user;
      const dept = departments.find(d => d.id === person.department || d.name === person.department);
      const team = teams.find(t => t.id === person.team);
      const statusColor = person.disabled ? '#9ca3af' : '#22c55e';
      const statusText = person.disabled ? 'Vô hiệu' : 'Hoạt động';
      const canEdit = canEditPerson(person);

      // Render action buttons based on permissions
      let actionButtons = '';
      if (canEdit) {
        actionButtons = `
          <button onclick="Personnel.edit('${person.id}')" style="padding:6px 10px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-right:4px" title="Sửa">✏️</button>
          <button onclick="Personnel.toggleStatus('${person.id}')" style="padding:6px 10px;background:${person.disabled ? '#22c55e' : '#f59e0b'};color:#fff;border:none;border-radius:4px;cursor:pointer;margin-right:4px" title="${person.disabled ? 'Kích hoạt' : 'Vô hiệu hóa'}">${person.disabled ? '✅' : '🚫'}</button>
          <button onclick="Personnel.resetPassword('${person.id}')" style="padding:6px 10px;background:#6366f1;color:#fff;border:none;border-radius:4px;cursor:pointer" title="Reset mật khẩu">🔑</button>
        `;
      } else {
        actionButtons = '<span style="color:#9ca3af;font-size:11px">Chỉ xem</span>';
      }

      html += `
        <tr style="border-bottom:1px solid #f3f4f6" onmouseenter="this.style.backgroundColor='#f9fafb'" onmouseleave="this.style.backgroundColor=''">
          <td style="padding:12px">
            <div style="font-weight:500;color:#1f2937">${Validation.sanitizeHTML(person.hoTen || '')}</div>
            <div style="font-size:12px;color:#6b7280">${Validation.sanitizeHTML(person.phone || '')}</div>
            ${team ? `<div style="font-size:11px;color:#3b82f6">📋 ${Validation.sanitizeHTML(team.name)}</div>` : ''}
          </td>
          <td style="padding:12px;color:#4b5563">${Validation.sanitizeHTML(person.username || '')}</td>
          <td style="padding:12px;color:#4b5563">${Validation.sanitizeHTML(dept?.name || person.department || '-')}</td>
          <td style="padding:12px;text-align:center">
            <span style="display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500;background:${role.bgColor};color:${role.color}">
              ${role.label}
            </span>
          </td>
          <td style="padding:12px;text-align:center">
            <span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:${statusColor}">
              <span style="width:8px;height:8px;border-radius:50%;background:${statusColor}"></span>
              ${statusText}
            </span>
          </td>
          <td style="padding:12px;text-align:center">
            ${actionButtons}
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ==================== FILTERING ====================

  /**
   * Lọc danh sách
   */
  function filter() {
    const searchTerm = (document.getElementById('personnelSearch')?.value || '').toLowerCase();
    const deptFilter = document.getElementById('personnelDeptFilter')?.value || '';
    const roleFilter = document.getElementById('personnelRoleFilter')?.value || '';
    const statusFilter = document.getElementById('personnelStatusFilter')?.value || '';

    filteredList = personnelList.filter(person => {
      // Search
      if (searchTerm) {
        const searchFields = [person.hoTen, person.username, person.phone].filter(Boolean).join(' ').toLowerCase();
        if (!searchFields.includes(searchTerm)) return false;
      }

      // Department
      if (deptFilter && person.department !== deptFilter) return false;

      // Role
      if (roleFilter && person.role !== roleFilter) return false;

      // Status
      if (statusFilter === 'active' && person.disabled) return false;
      if (statusFilter === 'inactive' && !person.disabled) return false;

      return true;
    });

    renderTable();
  }

  // ==================== CRUD OPERATIONS ====================

  /**
   * Mở modal thêm nhân sự
   */
  function openAddModal() {
    // Kiểm tra quyền
    if (!canCreatePersonnel()) {
      Toast.error('Bạn không có quyền thêm nhân sự');
      return;
    }

    currentEditId = null;
    document.getElementById('personnelModalTitle').textContent = 'Thêm nhân sự mới';
    UI.resetForm('personnelForm');

    // Show password fields
    document.getElementById('personnelPasswordGroup').style.display = 'block';
    document.getElementById('personnelPassword').required = true;

    const userProfile = Auth.userProfile;

    // Tự động set department nếu không phải admin
    if (userProfile && userProfile.role !== 'admin' && userProfile.department) {
      const deptSelect = document.getElementById('personnelDept');
      if (deptSelect) {
        deptSelect.value = userProfile.department;
        deptSelect.disabled = true; // Không cho đổi department
      }
    }

    // Tổ trưởng: tự động set team là tổ đầu tiên mà họ quản lý
    if (managedTeams.length > 0 && userProfile.role !== 'admin' && userProfile.role !== 'vpp' && userProfile.role !== 'manager') {
      const teamSelect = document.getElementById('personnelTeam');
      if (teamSelect) {
        teamSelect.value = managedTeams[0];
        // Nếu chỉ quản lý 1 tổ thì không cho đổi
        if (managedTeams.length === 1) {
          teamSelect.disabled = true;
        }
      }

      // Role mặc định là 'user' cho công nhân
      const roleSelect = document.getElementById('personnelRole');
      if (roleSelect) {
        roleSelect.value = 'user';
        roleSelect.disabled = true; // Tổ trưởng không được set role
      }
    }

    UI.showModal('personnelModal');
  }

  /**
   * Mở modal sửa nhân sự
   */
  function edit(id) {
    const person = personnelList.find(p => p.id === id);
    if (!person) {
      Toast.error('Không tìm thấy nhân sự');
      return;
    }

    // Kiểm tra quyền
    if (!canEditPerson(person)) {
      Toast.error('Bạn không có quyền sửa nhân sự này');
      return;
    }

    currentEditId = id;
    document.getElementById('personnelModalTitle').textContent = 'Cập nhật nhân sự';

    // Reset disabled state
    const deptSelect = document.getElementById('personnelDept');
    const teamSelect = document.getElementById('personnelTeam');
    const roleSelect = document.getElementById('personnelRole');
    if (deptSelect) deptSelect.disabled = false;
    if (teamSelect) teamSelect.disabled = false;
    if (roleSelect) roleSelect.disabled = false;

    // Fill form
    document.getElementById('personnelUsername').value = person.username || '';
    document.getElementById('personnelHoTen').value = person.hoTen || '';
    document.getElementById('personnelPhone').value = person.phone || '';
    document.getElementById('personnelRole').value = person.role || 'user';
    document.getElementById('personnelDept').value = person.department || '';
    document.getElementById('personnelPosition').value = person.position || '';
    document.getElementById('personnelTeam').value = person.team || '';
    document.getElementById('personnelFactory').value = person.factory || '';

    const userProfile = Auth.userProfile;

    // Tổ trưởng: không cho đổi department, team, role
    if (managedTeams.length > 0 && userProfile.role !== 'admin' && userProfile.role !== 'vpp' && userProfile.role !== 'manager') {
      if (deptSelect) deptSelect.disabled = true;
      if (teamSelect) teamSelect.disabled = true;
      if (roleSelect) roleSelect.disabled = true;
    }
    // VPP/Manager: không cho đổi department
    else if (userProfile.role !== 'admin') {
      if (deptSelect) deptSelect.disabled = true;
    }

    // Hide password fields for edit
    document.getElementById('personnelPasswordGroup').style.display = 'none';
    document.getElementById('personnelPassword').required = false;

    UI.showModal('personnelModal');
  }

  /**
   * Đóng modal
   */
  function closeModal() {
    UI.hideModal('personnelModal');
    currentEditId = null;

    // Reset disabled state của các input
    const deptSelect = document.getElementById('personnelDept');
    const teamSelect = document.getElementById('personnelTeam');
    const roleSelect = document.getElementById('personnelRole');
    if (deptSelect) deptSelect.disabled = false;
    if (teamSelect) teamSelect.disabled = false;
    if (roleSelect) roleSelect.disabled = false;
  }

  /**
   * Lưu nhân sự (thêm mới hoặc cập nhật)
   */
  async function save() {
    // Validate
    const formData = {
      username: document.getElementById('personnelUsername')?.value?.trim(),
      hoTen: document.getElementById('personnelHoTen')?.value?.trim(),
      phone: document.getElementById('personnelPhone')?.value?.trim(),
      role: document.getElementById('personnelRole')?.value,
      department: document.getElementById('personnelDept')?.value,
      position: document.getElementById('personnelPosition')?.value,
      team: document.getElementById('personnelTeam')?.value,
      factory: document.getElementById('personnelFactory')?.value,
      password: document.getElementById('personnelPassword')?.value
    };

    // Validation rules
    const rules = {
      username: ['required', 'username'],
      hoTen: ['required', { length: { min: 2, max: 100 } }],
      phone: ['phone'],
      role: ['required']
    };

    // Add password rule for new personnel
    if (!currentEditId) {
      rules.password = ['required', { password: true }];
    }

    const validation = Validation.validateForm(formData, rules);
    if (!validation.valid) {
      const firstError = Object.values(validation.errors)[0];
      Toast.error(firstError);
      return;
    }

    const saveBtn = document.querySelector('#personnelModal .save-btn');
    UI.setButtonLoading(saveBtn, true);

    try {
      if (currentEditId) {
        // Update existing
        const result = await API.updateDoc(COLLECTION, currentEditId, {
          hoTen: formData.hoTen,
          phone: formData.phone,
          role: formData.role,
          department: formData.department,
          position: formData.position,
          team: formData.team,
          factory: formData.factory
        });

        if (result.success) {
          Toast.success('Cập nhật nhân sự thành công');
          closeModal();
          await loadList();
        } else {
          Toast.error(result.error || 'Cập nhật thất bại');
        }
      } else {
        // Create new via Cloud Function
        const result = await API.createPersonnel({
          username: formData.username,
          hoTen: formData.hoTen,
          password: formData.password,
          role: formData.role,
          phone: formData.phone,
          department: formData.department,
          position: formData.position,
          team: formData.team,
          factory: formData.factory
        });

        if (result.success) {
          Toast.success('Thêm nhân sự thành công');
          closeModal();
          await loadList();
        } else {
          Toast.error(result.error || 'Thêm nhân sự thất bại');
        }
      }
    } catch (error) {
      ErrorHandler.handle(error, 'Personnel.save');
    } finally {
      UI.setButtonLoading(saveBtn, false);
    }
  }

  /**
   * Toggle trạng thái nhân sự
   */
  async function toggleStatus(id) {
    const person = personnelList.find(p => p.id === id);
    if (!person) return;

    const action = person.disabled ? 'kích hoạt' : 'vô hiệu hóa';
    const confirmed = await UI.confirm(
      `Bạn có chắc muốn ${action} nhân sự "${person.hoTen}"?`,
      { type: person.disabled ? 'info' : 'warning' }
    );

    if (!confirmed) return;

    try {
      const result = await API.updateDoc(COLLECTION, id, {
        disabled: !person.disabled
      });

      if (result.success) {
        Toast.success(`Đã ${action} nhân sự`);
        await loadList();
      } else {
        Toast.error(result.error);
      }
    } catch (error) {
      ErrorHandler.handle(error, 'Personnel.toggleStatus');
    }
  }

  /**
   * Reset mật khẩu
   */
  async function resetPassword(id) {
    const person = personnelList.find(p => p.id === id);
    if (!person) return;

    const newPassword = await UI.prompt(
      `Nhập mật khẩu mới cho "${person.hoTen}":`,
      { title: 'Reset mật khẩu', type: 'password' }
    );

    if (!newPassword) return;

    // Validate password
    const validation = Validation.password(newPassword);
    if (!validation.valid) {
      Toast.error(validation.message);
      return;
    }

    try {
      const result = await API.resetPersonnelPassword(id, newPassword);

      if (result.success) {
        Toast.success('Reset mật khẩu thành công');
      } else {
        Toast.error(result.error || 'Reset mật khẩu thất bại');
      }
    } catch (error) {
      ErrorHandler.handle(error, 'Personnel.resetPassword');
    }
  }

  // ==================== EVENT BINDING ====================

  /**
   * Bind event handlers
   */
  function bindEvents() {
    // Search with debounce
    const searchInput = document.getElementById('personnelSearch');
    if (searchInput) {
      searchInput.oninput = Helpers.debounce(filter, 300);
    }

    // Filter dropdowns
    ['personnelDeptFilter', 'personnelRoleFilter', 'personnelStatusFilter'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.onchange = filter;
    });
  }

  // ==================== EXPORT FUNCTIONS ====================

  /**
   * Xuất danh sách ra Excel
   */
  function exportExcel() {
    if (filteredList.length === 0) {
      Toast.warning('Không có dữ liệu để xuất');
      return;
    }

    const data = filteredList.map((p, idx) => ({
      'STT': idx + 1,
      'Họ tên': p.hoTen || '',
      'Username': p.username || '',
      'Số điện thoại': p.phone || '',
      'Phòng ban': departments.find(d => d.id === p.department)?.name || p.department || '',
      'Chức vụ': positions.find(pos => pos.id === p.position)?.name || p.position || '',
      'Vai trò': ROLES[p.role]?.label || p.role || '',
      'Trạng thái': p.disabled ? 'Vô hiệu' : 'Hoạt động'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Nhân sự');
    XLSX.writeFile(wb, `DanhSachNhanSu_${Helpers.formatDate(new Date(), { format: 'date' }).replace(/\//g, '-')}.xlsx`);

    Toast.success('Xuất Excel thành công');
  }

  // ==================== PUBLIC API ====================
  return {
    // Initialization
    init,

    // Data
    loadList,
    filter,

    // CRUD
    openAddModal,
    edit,
    closeModal,
    save,
    toggleStatus,
    resetPassword,

    // Export
    exportExcel,

    // Permissions
    canCreatePersonnel,
    canEditPerson,

    // Getters
    get list() { return personnelList; },
    get filtered() { return filteredList; },
    get departments() { return departments; },
    get positions() { return positions; },
    get teams() { return teams; },
    get managedTeams() { return managedTeams; },
    get ROLES() { return ROLES; }
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Personnel;
}
