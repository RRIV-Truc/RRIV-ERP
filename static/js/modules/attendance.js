/**
 * Attendance Module
 * Quản lý điểm danh bằng Face ID
 * @module attendance
 */

const Attendance = (function() {
  'use strict';

  // ==================== STATE ====================
  let employees = [];
  let checkins = [];
  let currentDate = new Date();
  let videoStream = null;
  let isProcessing = false;

  // ==================== CONSTANTS ====================
  const COLLECTION_EMPLOYEES = 'diemdanh_employees';
  const COLLECTION_CHECKINS = 'diemdanh_checkins';

  const STATUS = {
    present: { label: 'Có mặt', color: '#22c55e', bgColor: '#f0fdf4' },
    absent: { label: 'Vắng', color: '#ef4444', bgColor: '#fef2f2' },
    late: { label: 'Đi trễ', color: '#f59e0b', bgColor: '#fffbeb' },
    leave: { label: 'Nghỉ phép', color: '#3b82f6', bgColor: '#eff6ff' }
  };

  // ==================== INITIALIZATION ====================

  /**
   * Khởi tạo module
   */
  async function init() {
    console.log('Initializing Attendance module...');
    setCurrentDate(new Date());
    await loadEmployees();
    await loadCheckins();
    renderDashboard();
    bindEvents();
  }

  /**
   * Load danh sách nhân viên
   */
  async function loadEmployees() {
    try {
      const db = API.getFirestore();
      if (!db) return;

      const snapshot = await db.collection(COLLECTION_EMPLOYEES)
        .orderBy('name')
        .get();

      employees = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log(`Loaded ${employees.length} employees`);

    } catch (error) {
      ErrorHandler.handle(error, 'Attendance.loadEmployees');
    }
  }

  /**
   * Load danh sách checkin theo ngày
   */
  async function loadCheckins(date = currentDate) {
    try {
      const db = API.getFirestore();
      if (!db) return;

      const startOfDay = Helpers.getStartOf(date, 'day');
      const endOfDay = Helpers.getEndOf(date, 'day');

      const snapshot = await db.collection(COLLECTION_CHECKINS)
        .where('date', '>=', startOfDay)
        .where('date', '<=', endOfDay)
        .get();

      checkins = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log(`Loaded ${checkins.length} checkins for ${Helpers.formatDate(date)}`);

    } catch (error) {
      ErrorHandler.handle(error, 'Attendance.loadCheckins');
    }
  }

  // ==================== DATE MANAGEMENT ====================

  /**
   * Set ngày hiện tại và reload data
   */
  async function setCurrentDate(date) {
    currentDate = date;
    updateDateDisplay();
    await loadCheckins(date);
    renderAttendanceList();
  }

  /**
   * Update hiển thị ngày
   */
  function updateDateDisplay() {
    const dateEl = document.getElementById('attendanceCurrentDate');
    if (dateEl) {
      dateEl.textContent = Helpers.formatDate(currentDate, { format: 'date' });
    }
  }

  /**
   * Chuyển ngày trước
   */
  async function previousDay() {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() - 1);
    await setCurrentDate(newDate);
  }

  /**
   * Chuyển ngày sau
   */
  async function nextDay() {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + 1);

    // Không cho phép chọn ngày tương lai
    if (newDate > new Date()) {
      Toast.warning('Không thể chọn ngày trong tương lai');
      return;
    }

    await setCurrentDate(newDate);
  }

  /**
   * Về ngày hôm nay
   */
  async function goToToday() {
    await setCurrentDate(new Date());
  }

  // ==================== DASHBOARD ====================

  /**
   * Render dashboard thống kê
   */
  function renderDashboard() {
    const stats = calculateStats();

    const elements = {
      'attendanceStatTotal': employees.length,
      'attendanceStatPresent': stats.present,
      'attendanceStatAbsent': stats.absent,
      'attendanceStatLate': stats.late
    };

    Object.entries(elements).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
  }

  /**
   * Tính toán thống kê
   */
  function calculateStats() {
    const checkedInIds = checkins.map(c => c.employeeId);

    return {
      present: checkins.filter(c => c.status === 'present').length,
      late: checkins.filter(c => c.status === 'late').length,
      absent: employees.filter(e => !checkedInIds.includes(e.id)).length,
      leave: checkins.filter(c => c.status === 'leave').length
    };
  }

  // ==================== ATTENDANCE LIST ====================

  /**
   * Render danh sách điểm danh
   */
  function renderAttendanceList() {
    const container = document.getElementById('attendanceListContainer');
    if (!container) return;

    // Merge employees với checkin data
    const attendanceData = employees.map(emp => {
      const checkin = checkins.find(c => c.employeeId === emp.id);
      return {
        ...emp,
        checkin: checkin || null,
        status: checkin?.status || 'absent',
        checkinTime: checkin?.time || null
      };
    });

    if (attendanceData.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:40px;color:#6b7280">
          <div style="font-size:48px;margin-bottom:16px">👤</div>
          <p>Chưa có nhân viên nào được đăng ký</p>
        </div>
      `;
      return;
    }

    let html = `
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:12px;text-align:left;font-weight:600;border-bottom:2px solid #e5e7eb">Nhân viên</th>
            <th style="padding:12px;text-align:center;font-weight:600;border-bottom:2px solid #e5e7eb">Trạng thái</th>
            <th style="padding:12px;text-align:center;font-weight:600;border-bottom:2px solid #e5e7eb">Giờ vào</th>
            <th style="padding:12px;text-align:center;font-weight:600;border-bottom:2px solid #e5e7eb">Thao tác</th>
          </tr>
        </thead>
        <tbody>
    `;

    attendanceData.forEach(emp => {
      const statusInfo = STATUS[emp.status] || STATUS.absent;
      const checkinTime = emp.checkinTime
        ? Helpers.formatDate(emp.checkinTime.toDate ? emp.checkinTime.toDate() : emp.checkinTime, { format: 'time' })
        : '-';

      html += `
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:12px">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:40px;height:40px;border-radius:50%;background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-weight:600;color:#4b5563">
                ${emp.name?.charAt(0) || '?'}
              </div>
              <div>
                <div style="font-weight:500;color:#1f2937">${Validation.sanitizeHTML(emp.name || '')}</div>
                <div style="font-size:12px;color:#6b7280">${Validation.sanitizeHTML(emp.department || '')}</div>
              </div>
            </div>
          </td>
          <td style="padding:12px;text-align:center">
            <span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:500;background:${statusInfo.bgColor};color:${statusInfo.color}">
              ${statusInfo.label}
            </span>
          </td>
          <td style="padding:12px;text-align:center;color:#4b5563">${checkinTime}</td>
          <td style="padding:12px;text-align:center">
            ${!emp.checkin ? `
              <button onclick="Attendance.manualCheckin('${emp.id}')" style="padding:6px 12px;background:#22c55e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">
                ✅ Điểm danh
              </button>
            ` : `
              <button onclick="Attendance.editCheckin('${emp.checkin.id}')" style="padding:6px 12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">
                ✏️ Sửa
              </button>
            `}
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ==================== CHECKIN OPERATIONS ====================

  /**
   * Điểm danh thủ công
   */
  async function manualCheckin(employeeId) {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) {
      Toast.error('Không tìm thấy nhân viên');
      return;
    }

    const confirmed = await UI.confirm(
      `Xác nhận điểm danh cho "${employee.name}"?`,
      { type: 'info', confirmText: 'Điểm danh' }
    );

    if (!confirmed) return;

    try {
      const now = new Date();
      const workStartTime = new Date(currentDate);
      workStartTime.setHours(8, 0, 0, 0); // 8:00 AM

      const status = now > workStartTime ? 'late' : 'present';

      const result = await API.createDoc(COLLECTION_CHECKINS, {
        employeeId,
        employeeName: employee.name,
        date: currentDate,
        time: now,
        status,
        method: 'manual',
        checkedBy: Auth.userProfile?.username || 'system'
      });

      if (result.success) {
        Toast.success('Điểm danh thành công');
        await loadCheckins();
        renderAttendanceList();
        renderDashboard();
      } else {
        Toast.error(result.error);
      }

    } catch (error) {
      ErrorHandler.handle(error, 'Attendance.manualCheckin');
    }
  }

  /**
   * Sửa checkin
   */
  async function editCheckin(checkinId) {
    const checkin = checkins.find(c => c.id === checkinId);
    if (!checkin) return;

    // Show status selection
    const statusOptions = Object.entries(STATUS)
      .map(([key, val]) => `<option value="${key}" ${checkin.status === key ? 'selected' : ''}>${val.label}</option>`)
      .join('');

    const modal = UI.createModal({
      title: 'Cập nhật trạng thái',
      content: `
        <div style="margin-bottom:16px">
          <label style="display:block;margin-bottom:8px;font-weight:500">Nhân viên</label>
          <input type="text" value="${Validation.sanitizeHTML(checkin.employeeName || '')}" disabled
            style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb">
        </div>
        <div>
          <label style="display:block;margin-bottom:8px;font-weight:500">Trạng thái</label>
          <select id="editCheckinStatus" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px">
            ${statusOptions}
          </select>
        </div>
      `,
      footer: `
        <button class="cancel-btn" style="padding:8px 16px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;cursor:pointer">Hủy</button>
        <button class="save-btn" style="padding:8px 16px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer">Lưu</button>
      `
    });

    modal.querySelector('.cancel-btn').onclick = () => modal.remove();
    modal.querySelector('.save-btn').onclick = async () => {
      const newStatus = document.getElementById('editCheckinStatus').value;

      const result = await API.updateDoc(COLLECTION_CHECKINS, checkinId, {
        status: newStatus,
        updatedBy: Auth.userProfile?.username,
        updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
      });

      if (result.success) {
        Toast.success('Cập nhật thành công');
        modal.remove();
        await loadCheckins();
        renderAttendanceList();
        renderDashboard();
      } else {
        Toast.error(result.error);
      }
    };
  }

  // ==================== FACE ID ====================

  /**
   * Mở camera để điểm danh Face ID
   */
  async function openFaceIdCamera() {
    const modal = UI.createModal({
      id: 'faceIdModal',
      title: 'Điểm danh Face ID',
      content: `
        <div style="text-align:center">
          <video id="faceIdVideo" autoplay playsinline style="width:100%;max-width:400px;border-radius:8px;background:#000"></video>
          <p id="faceIdStatus" style="margin-top:12px;color:#6b7280">Đang khởi tạo camera...</p>
        </div>
      `,
      size: 'md',
      onClose: stopCamera
    });

    try {
      const video = document.getElementById('faceIdVideo');
      const status = document.getElementById('faceIdStatus');

      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 }
      });

      video.srcObject = videoStream;
      status.textContent = 'Đưa khuôn mặt vào khung hình để điểm danh';

      // Simulate face detection (trong thực tế sẽ dùng Face API)
      setTimeout(() => {
        status.innerHTML = '<span style="color:#22c55e">✅ Đã nhận diện khuôn mặt</span>';
        // Process face recognition...
      }, 2000);

    } catch (error) {
      ErrorHandler.handle(error, 'Attendance.openFaceIdCamera');
      Toast.error('Không thể truy cập camera');
    }
  }

  /**
   * Dừng camera
   */
  function stopCamera() {
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      videoStream = null;
    }
  }

  // ==================== EMPLOYEE MANAGEMENT ====================

  /**
   * Mở modal đăng ký nhân viên mới
   */
  function openAddEmployeeModal() {
    UI.resetForm('addEmployeeForm');
    UI.showModal('addEmployeeModal');
  }

  /**
   * Lưu nhân viên mới
   */
  async function saveEmployee() {
    const formData = {
      name: document.getElementById('empName')?.value?.trim(),
      department: document.getElementById('empDepartment')?.value?.trim(),
      position: document.getElementById('empPosition')?.value?.trim(),
      phone: document.getElementById('empPhone')?.value?.trim()
    };

    // Validate
    if (!formData.name) {
      Toast.error('Vui lòng nhập tên nhân viên');
      return;
    }

    try {
      const result = await API.createDoc(COLLECTION_EMPLOYEES, formData);

      if (result.success) {
        Toast.success('Thêm nhân viên thành công');
        UI.hideModal('addEmployeeModal');
        await loadEmployees();
        renderAttendanceList();
        renderDashboard();
      } else {
        Toast.error(result.error);
      }

    } catch (error) {
      ErrorHandler.handle(error, 'Attendance.saveEmployee');
    }
  }

  // ==================== EXPORT ====================

  /**
   * Xuất báo cáo điểm danh
   */
  function exportReport() {
    const attendanceData = employees.map(emp => {
      const checkin = checkins.find(c => c.employeeId === emp.id);
      return {
        'Họ tên': emp.name || '',
        'Phòng ban': emp.department || '',
        'Trạng thái': STATUS[checkin?.status || 'absent']?.label || 'Vắng',
        'Giờ vào': checkin?.time ? Helpers.formatDate(checkin.time.toDate ? checkin.time.toDate() : checkin.time, { format: 'time' }) : '',
        'Ghi chú': checkin?.note || ''
      };
    });

    const ws = XLSX.utils.json_to_sheet(attendanceData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Điểm danh');
    XLSX.writeFile(wb, `DiemDanh_${Helpers.formatDate(currentDate, { format: 'date' }).replace(/\//g, '-')}.xlsx`);

    Toast.success('Xuất báo cáo thành công');
  }

  // ==================== EVENT BINDING ====================

  /**
   * Bind events
   */
  function bindEvents() {
    // Date navigation is handled via onclick in HTML
  }

  // ==================== PUBLIC API ====================
  return {
    // Initialization
    init,

    // Date navigation
    previousDay,
    nextDay,
    goToToday,
    setCurrentDate,

    // Checkin operations
    manualCheckin,
    editCheckin,

    // Face ID
    openFaceIdCamera,
    stopCamera,

    // Employee management
    openAddEmployeeModal,
    saveEmployee,

    // Export
    exportReport,

    // Getters
    get employees() { return employees; },
    get checkins() { return checkins; },
    get currentDate() { return currentDate; },
    STATUS
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Attendance;
}
