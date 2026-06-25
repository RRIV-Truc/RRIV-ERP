/**
 * Main Application Module
 * Khởi tạo và quản lý ứng dụng chính
 * @module app
 */

const App = (function() {
  'use strict';

  // ==================== STATE ====================
  let currentApp = null;
  let isInitialized = false;

  // ==================== CONFIGURATION ====================
  const APPS = {
    vpp: {
      id: 'vpp',
      name: 'Văn Phòng Phẩm',
      icon: '📋',
      element: 'vppApp',
      init: () => typeof initVPPApp === 'function' && initVPPApp()
    },
    bctt: {
      id: 'bctt',
      name: 'Báo Cáo Tổng Tiến',
      icon: '📊',
      element: 'bcttApp',
      init: () => typeof initBCTTApp === 'function' && initBCTTApp()
    },
    dieuXe: {
      id: 'dieuXe',
      name: 'Điều Xe',
      icon: '🚗',
      element: 'dieuXeApp',
      init: () => typeof initDieuXeApp === 'function' && initDieuXeApp()
    },
    vanBan: {
      id: 'vanBan',
      name: 'Văn Bản',
      icon: '📄',
      element: 'vanBanApp',
      init: () => typeof initVanBanApp === 'function' && initVanBanApp()
    },
    diemDanh: {
      id: 'diemDanh',
      name: 'Điểm Danh',
      icon: '👤',
      element: 'diemDanhApp',
      init: () => typeof initDiemDanhApp === 'function' && initDiemDanhApp()
    },
    nhansu: {
      id: 'nhansu',
      name: 'Quản Lý Nhân Sự',
      icon: '👥',
      element: 'personnelApp',
      init: () => Personnel.init()
    }
  };

  // ==================== INITIALIZATION ====================

  /**
   * Khởi tạo ứng dụng
   */
  async function init() {
    if (isInitialized) return;

    console.log('🚀 Initializing App...');

    try {
      // Initialize Firebase
      await initFirebase();

      // Initialize Auth
      await Auth.init();

      // Check authentication state
      Auth.onAuthStateChange((event, data) => {
        if (event === 'login') {
          onUserLoggedIn(data);
        } else if (event === 'logout') {
          onUserLoggedOut();
        }
      });

      // Setup global event handlers
      setupGlobalHandlers();

      // Check initial auth state
      if (Auth.isAuthenticated()) {
        showAppSelector();
      } else {
        showLoginScreen();
      }

      isInitialized = true;
      console.log('✅ App initialized successfully');

    } catch (error) {
      ErrorHandler.handle(error, 'App.init');
      console.error('❌ App initialization failed:', error);
    }
  }

  /**
   * Khởi tạo Firebase
   */
  async function initFirebase() {
    if (typeof ErpDb === 'undefined') {
      throw new Error('Firebase SDK not loaded');
    }

    // Check if already initialized
    if (ErpDb.apps.length > 0) {
      console.log('Firebase already initialized');
      return;
    }

    // Use config from Config module
    const erpDbConfig = { projectId: 'rriv' };
    ErpDb.initializeApp(erpDbConfig);

    console.log('Firebase initialized');
  }

  // ==================== AUTH HANDLERS ====================

  /**
   * Xử lý khi user đăng nhập
   */
  function onUserLoggedIn(data) {
    console.log('User logged in:', data.profile?.username);
    updateUserInfo(data.profile);
    showAppSelector();
  }

  /**
   * Xử lý khi user đăng xuất
   */
  function onUserLoggedOut() {
    console.log('User logged out');
    currentApp = null;
    showLoginScreen();
  }

  /**
   * Cập nhật thông tin user trên header
   */
  function updateUserInfo(profile) {
    if (!profile) return;

    // Update các elements hiển thị user info
    const elements = {
      'loggedInName': profile.hoTen || profile.username,
      'loggedInRole': Personnel.ROLES?.[profile.role]?.label || profile.role,
      'userDisplayName': profile.hoTen || profile.username
    };

    Object.entries(elements).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });

    // Update avatar
    const avatarEl = document.getElementById('userAvatar');
    if (avatarEl && profile.hoTen) {
      avatarEl.textContent = profile.hoTen.charAt(0).toUpperCase();
    }
  }

  // ==================== SCREEN MANAGEMENT ====================

  /**
   * Hiển thị màn hình login
   */
  function showLoginScreen() {
    hideAllScreens();
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) {
      loginScreen.classList.remove('hidden');
      loginScreen.style.display = 'flex';
    }
  }

  /**
   * Hiển thị app selector
   */
  function showAppSelector() {
    hideAllScreens();
    const appSelector = document.getElementById('appSelector');
    if (appSelector) {
      appSelector.classList.remove('hidden');
      appSelector.style.display = 'block';
    }
  }

  /**
   * Ẩn tất cả screens
   */
  function hideAllScreens() {
    const screens = ['loginScreen', 'appSelector', ...Object.values(APPS).map(a => a.element)];
    screens.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add('hidden');
        el.style.display = 'none';
      }
    });
  }

  // ==================== APP SELECTION ====================

  /**
   * Chọn app
   * @param {string} appName - Tên app
   */
  async function selectApp(appName) {
    const app = APPS[appName];
    if (!app) {
      Toast.error('App không hợp lệ');
      return;
    }

    // Check permission
    if (!canAccessApp(appName)) {
      Toast.error('Bạn không có quyền truy cập ứng dụng này');
      return;
    }

    console.log(`Selecting app: ${appName}`);

    // Hide app selector
    const appSelector = document.getElementById('appSelector');
    if (appSelector) {
      appSelector.classList.add('hidden');
      appSelector.style.display = 'none';
    }

    // Show selected app
    const appElement = document.getElementById(app.element);
    if (appElement) {
      appElement.classList.remove('hidden');
      appElement.style.display = 'block';
    }

    // Initialize app
    if (app.init) {
      try {
        await app.init();
      } catch (error) {
        ErrorHandler.handle(error, `App.selectApp:${appName}`);
      }
    }

    currentApp = appName;

    // Track usage
    trackAppUsage(appName);
  }

  /**
   * Quay về app selector
   */
  function backToAppSelector() {
    if (currentApp) {
      const app = APPS[currentApp];
      if (app) {
        const appElement = document.getElementById(app.element);
        if (appElement) {
          appElement.classList.add('hidden');
          appElement.style.display = 'none';
        }
      }
    }

    currentApp = null;
    showAppSelector();
  }

  /**
   * Kiểm tra quyền truy cập app
   */
  function canAccessApp(appName) {
    const profile = Auth.userProfile;
    if (!profile) return false;

    // Admin có thể truy cập tất cả
    if (profile.role === 'admin') return true;

    // Check app-specific permissions
    const appPermissions = {
      nhansu: ['admin'], // Chỉ admin
      bctt: ['admin', 'vpp'],
      dieuXe: ['admin', 'vpp', 'user'],
      vpp: ['admin', 'vpp', 'user'],
      vanBan: ['admin', 'vpp', 'user'],
      diemDanh: ['admin', 'vpp', 'user']
    };

    const allowedRoles = appPermissions[appName];
    if (!allowedRoles) return true; // No restriction

    return allowedRoles.includes(profile.role);
  }

  // ==================== LOGIN/LOGOUT ====================

  /**
   * Đăng nhập
   */
  async function login() {
    const username = document.getElementById('loginUsername')?.value;
    const password = document.getElementById('loginPassword')?.value;

    if (!username || !password) {
      Toast.error('Vui lòng nhập đầy đủ thông tin');
      return;
    }

    const loginBtn = document.getElementById('loginBtn');
    UI.setButtonLoading(loginBtn, true);

    try {
      const result = await Auth.login(username, password);

      if (result.success) {
        Toast.success('Đăng nhập thành công!');
        // Auth state change sẽ handle việc show app selector
      } else {
        Toast.error(result.error);
      }
    } catch (error) {
      ErrorHandler.handle(error, 'App.login');
    } finally {
      UI.setButtonLoading(loginBtn, false);
    }
  }

  /**
   * Đăng xuất
   */
  async function logout() {
    const confirmed = await UI.confirm('Bạn có chắc muốn đăng xuất?');
    if (!confirmed) return;

    try {
      await Auth.logout();
      Toast.success('Đã đăng xuất');
    } catch (error) {
      ErrorHandler.handle(error, 'App.logout');
    }
  }

  // ==================== TRACKING ====================

  /**
   * Track app usage
   */
  async function trackAppUsage(appName) {
    if (!Auth.isAuthenticated()) return;

    try {
      const db = API.getFirestore();
      if (!db) return;

      await db.collection('user_visits').add({
        userId: Auth.currentUser?.uid,
        username: Auth.userProfile?.username,
        app: appName,
        timestamp: ErpDb.firestore.FieldValue.serverTimestamp(),
        device: Auth.getDeviceInfo()
      });
    } catch (error) {
      // Non-critical, just log
      console.warn('Failed to track app usage:', error);
    }
  }

  // ==================== GLOBAL HANDLERS ====================

  /**
   * Setup global event handlers
   */
  function setupGlobalHandlers() {
    // Handle Enter key on login form
    document.getElementById('loginPassword')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') login();
    });

    // Handle ESC key to close modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
        if (openModal) {
          const closeBtn = openModal.querySelector('.modal-close-btn');
          if (closeBtn) closeBtn.click();
        }
      }
    });

    // Extend session on activity
    let activityTimeout;
    const extendSession = Helpers.throttle(() => {
      if (Auth.isAuthenticated()) {
        Auth.extendSession();
      }
    }, 60000); // Max once per minute

    ['click', 'keydown', 'scroll', 'touchstart'].forEach(event => {
      document.addEventListener(event, extendSession, { passive: true });
    });

    // Handle online/offline
    window.addEventListener('online', () => {
      Toast.success('Đã kết nối mạng');
    });

    window.addEventListener('offline', () => {
      Toast.warning('Mất kết nối mạng');
    });

    // Handle visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Auth.isAuthenticated()) {
        // Refresh data when tab becomes visible
        if (currentApp && APPS[currentApp]?.refresh) {
          APPS[currentApp].refresh();
        }
      }
    });
  }

  // ==================== UTILITY ====================

  /**
   * Get current app info
   */
  function getCurrentApp() {
    return currentApp ? APPS[currentApp] : null;
  }

  /**
   * Check if app is ready
   */
  function isReady() {
    return isInitialized;
  }

  // ==================== PUBLIC API ====================
  return {
    // Initialization
    init,

    // Navigation
    selectApp,
    backToAppSelector,
    showLoginScreen,
    showAppSelector,

    // Auth
    login,
    logout,

    // Utility
    getCurrentApp,
    isReady,
    canAccessApp,

    // Constants
    APPS
  };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  // DOM already loaded
  App.init();
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = App;
}
