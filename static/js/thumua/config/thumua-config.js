/**
 * Thu Mua Configuration
 * Cấu hình hệ thống thu mua mủ nguyên liệu
 */
var ThuMuaConfig = (function() {
  'use strict';

  // Loại khách hàng
  var CUSTOMER_TYPES = {
    'K': { name: 'Hộ khoán', prefix: 'K', color: '#22c55e' },
    'F': { name: 'Hộ ngoài thường xuyên', prefix: 'F', color: '#3b82f6' },
    'N': { name: 'Hộ ngoài không thường xuyên', prefix: 'N', color: '#f59e0b' }
  };

  // Loại mủ nguyên liệu
  var RUBBER_TYPES = [
    { id: 'muNuoc', name: 'Mủ nước', unit: 'kg', hasDeduction: true },
    { id: 'muDong', name: 'Mủ đông', unit: 'kg', hasDeduction: false },
    { id: 'muDay', name: 'Mủ dây', unit: 'kg', hasDeduction: false },
    { id: 'muTap', name: 'Mủ tạp', unit: 'kg', hasDeduction: false }
  ];

  // Cấu hình TSC
  var TSC_CONFIG = {
    samplesPerRound: 20,        // 20 mẫu mỗi đợt mã hóa
    tolerance: 2.0,             // Biên độ cho phép chênh lệch TSC (%) giữa QLCL và NM
    lockAfterMidnight: true,    // Khóa chỉnh sửa sau 0h
    dualLab: true               // Kiểm tra song song QLCL + NM
  };

  // Điểm thu mua
  var PURCHASE_POINTS = [
    { id: 'TT', name: 'Trung tâm Công ty', factory: 'A02' },
    { id: 'PARIS', name: 'Nhà máy Cua Paris', factory: 'A02' },
    { id: 'BOLA', name: 'Nhà máy Bố Lá', factory: 'A01' }
  ];

  // Phân quyền thu mua
  var TM_ROLES = {
    'tm_weigher': { name: 'Nhân viên cân', permissions: ['weigh', 'view_daily'] },
    'tm_guard': { name: 'Bảo vệ giám sát', permissions: ['edit_daily', 'view_daily'] },
    'tm_encoder': { name: 'NV mã hóa', permissions: ['encode', 'view_encoding'] },
    'tm_tsc_qlcl': { name: 'NV TSC (QLCL)', permissions: ['tsc_qlcl', 'view_tsc'] },
    'tm_tsc_nm': { name: 'NV TSC (NM)', permissions: ['tsc_nm', 'view_tsc'] },
    'tm_summary': { name: 'NV tổng hợp', permissions: ['view_reports', 'set_price'] },
    'tm_payment': { name: 'NV thanh toán', permissions: ['payment'] },
    'tm_deputy': { name: 'Phó ban TM+', permissions: ['all', 'edit_any', 'view_audit'] }
  };

  // Cấu hình cân (COM port defaults)
  var SCALE_CONFIG = {
    S1: { name: 'Cân đầu vào', portName: 'COM3', baudRate: 1200, parity: 'N', stopBits: 1, dataBits: 8 },
    S2: { name: 'Cân đầu ra', portName: 'COM4', baudRate: 1200, parity: 'N', stopBits: 1, dataBits: 8 }
  };

  return {
    CUSTOMER_TYPES: CUSTOMER_TYPES,
    RUBBER_TYPES: RUBBER_TYPES,
    TSC_CONFIG: TSC_CONFIG,
    PURCHASE_POINTS: PURCHASE_POINTS,
    TM_ROLES: TM_ROLES,
    SCALE_CONFIG: SCALE_CONFIG
  };
})();
