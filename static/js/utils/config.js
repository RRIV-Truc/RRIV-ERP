/**
 * Config RRIV — Flask + Supabase (không Firebase)
 */
const Config = (function () {
  'use strict';

  const ENV = { PRODUCTION: 'production', DEVELOPMENT: 'development' };
  const currentEnv = /localhost|127\.0\.0\.1/.test(window.location.hostname)
    ? ENV.DEVELOPMENT : ENV.PRODUCTION;

  const API = {
    baseUrl: '',
    dataUrl: '/api/data',
    authUrl: '/api',
    functionsUrl: '/api/functions',
    timeout: { default: 30000, upload: 120000 }
  };

  const APP = {
    name: 'Hệ Thống Quản Lý RRIV',
    company: 'Viện Nghiên Cứu Cao Su Việt Nam',
    version: '2.0.0',
    session: { timeout: 8 * 60 * 60 * 1000 },
    locale: 'vi-VN',
    timezone: 'Asia/Ho_Chi_Minh'
  };

  const AUTH = {
    emailDomain: '@rriv.org.vn',
    roles: { ADMIN: 'admin', USER: 'user' }
  };

  /** Tên collection nghiệp vụ (map Firestore → Supabase erp_collections) */
  const COLLECTIONS = {
    personnel: 'categoryPersonnel',
    departments: 'categoryDepartments',
    positions: 'categoryPositions',
    teams: 'categoryTeams',
    factories: 'categoryFactories',
    appPermissions: 'appPermissions',
    roleDefinitions: 'roleDefinitions',
    userRoles: 'userRoles',
    workTasks: 'workTasks',
    vppProducts: 'vpp_products',
    vppOrders: 'vpp_orders',
    dieuxeRequests: 'dieuxe_requests',
    vanbanDocuments: 'vanban_documents',
    productionBatches: 'productionBatches',
    rubberGardens: 'rubberGardens'
  };

  const APP_ROUTES = {
    vanphongpham: '/app/vanphongpham',
    doanhnghiep: '/app/doanhnghiep',
    dieuhanhxe: '/app/dieuhanhxe',
    vanbannoibo: '/app/vanbannoibo',
    nhansu: '/app/nhansu',
    dautu: '/app/dautu',
    diemdanh: '/app/diemdanh',
    vuoncay: '/app/vuoncay',
    sanxuat: '/app/sanxuat',
    chatluong: '/app/chatluong',
    thoitiet: '/app/thoitiet',
    baocao: '/app/baocao',
    thongbao: '/app/thongbao',
    phanquyen: '/app/phanquyen'
  };

  /**
   * Bật/tắt app trên màn hình hub (index).
   * Đổi thành true khi app đã hoàn thiện — không cần sửa index.html.
   */
  const HUB_APP_ENABLED = {
    vanphongpham: false,
    doanhnghiep: false,
    dieuhanhxe: false,
    vanbannoibo: false,
    nhansu: true,
    dautu: false,
    diemdanh: false,
    vuoncay: false,
    sanxuat: true,
    chatluong: false,
    thoitiet: false,
    baocao: false,
    thongbao: false,
    phanquyen: false
  };

  function isHubAppEnabled(appId) {
    return HUB_APP_ENABLED[appId] === true;
  }

  function getCollection(key) { return COLLECTIONS[key] || key; }
  function isDevelopment() { return currentEnv === ENV.DEVELOPMENT; }

  return {
    ENV, currentEnv, API, APP, AUTH, COLLECTIONS, APP_ROUTES, HUB_APP_ENABLED,
    getCollection, isDevelopment, isHubAppEnabled
  };
})();
