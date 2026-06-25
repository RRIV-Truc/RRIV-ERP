/**
 * Error Handler Utility Module
 * Xử lý lỗi tập trung cho toàn bộ hệ thống
 * @module errorHandler
 */

const ErrorHandler = (function() {
  'use strict';

  // ==================== ERROR TYPES ====================
  const ErrorTypes = {
    NETWORK: 'NETWORK_ERROR',
    AUTH: 'AUTH_ERROR',
    PERMISSION: 'PERMISSION_ERROR',
    VALIDATION: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND_ERROR',
    SERVER: 'SERVER_ERROR',
    TIMEOUT: 'TIMEOUT_ERROR',
    UNKNOWN: 'UNKNOWN_ERROR',
    FIREBASE: 'FIREBASE_ERROR',
    STORAGE: 'STORAGE_ERROR'
  };

  // ==================== ERROR MESSAGES ====================
  const ErrorMessages = {
    // Network errors
    [ErrorTypes.NETWORK]: 'Không thể kết nối mạng. Vui lòng kiểm tra kết nối internet.',
    [ErrorTypes.TIMEOUT]: 'Yêu cầu quá thời gian chờ. Vui lòng thử lại.',

    // Auth errors
    [ErrorTypes.AUTH]: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    [ErrorTypes.PERMISSION]: 'Bạn không có quyền thực hiện thao tác này.',

    // Data errors
    [ErrorTypes.VALIDATION]: 'Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.',
    [ErrorTypes.NOT_FOUND]: 'Không tìm thấy dữ liệu yêu cầu.',

    // Server errors
    [ErrorTypes.SERVER]: 'Lỗi máy chủ. Vui lòng thử lại sau.',
    [ErrorTypes.UNKNOWN]: 'Đã xảy ra lỗi không xác định.',

    // Firebase specific
    'auth/user-not-found': 'Tài khoản không tồn tại.',
    'auth/wrong-password': 'Mật khẩu không đúng.',
    'auth/email-already-in-use': 'Email đã được sử dụng.',
    'auth/weak-password': 'Mật khẩu quá yếu.',
    'auth/invalid-email': 'Email không hợp lệ.',
    'auth/too-many-requests': 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
    'auth/network-request-failed': 'Lỗi kết nối mạng.',
    'auth/popup-closed-by-user': 'Đăng nhập bị hủy.',
    'auth/requires-recent-login': 'Vui lòng đăng nhập lại để thực hiện thao tác này.',
    'auth/invalid-credential': 'Thông tin đăng nhập không hợp lệ.',

    // Firestore specific
    'permission-denied': 'Bạn không có quyền truy cập dữ liệu này.',
    'not-found': 'Dữ liệu không tồn tại.',
    'already-exists': 'Dữ liệu đã tồn tại.',
    'resource-exhausted': 'Đã vượt quá giới hạn truy cập.',
    'unavailable': 'Dịch vụ tạm thời không khả dụng.',
    'deadline-exceeded': 'Yêu cầu quá thời gian chờ.',

    // Storage specific
    'storage/unauthorized': 'Không có quyền truy cập file.',
    'storage/canceled': 'Upload đã bị hủy.',
    'storage/unknown': 'Lỗi không xác định khi upload file.',
    'storage/object-not-found': 'File không tồn tại.',
    'storage/quota-exceeded': 'Đã hết dung lượng lưu trữ.'
  };

  // ==================== ERROR LOG STORAGE ====================
  let errorLog = [];
  const MAX_LOG_SIZE = 100;

  // ==================== CORE FUNCTIONS ====================

  /**
   * Parse error và trả về thông tin chi tiết
   * @param {Error|Object|string} error - Lỗi cần parse
   * @returns {Object} {type, code, message, originalError}
   */
  function parseError(error) {
    let type = ErrorTypes.UNKNOWN;
    let code = '';
    let message = ErrorMessages[ErrorTypes.UNKNOWN];

    if (!error) {
      return { type, code, message, originalError: null };
    }

    // String error
    if (typeof error === 'string') {
      return { type, code: 'STRING_ERROR', message: error, originalError: error };
    }

    // Firebase Auth error
    if (error.code && error.code.startsWith('auth/')) {
      type = ErrorTypes.AUTH;
      code = error.code;
      message = ErrorMessages[error.code] || error.message || ErrorMessages[ErrorTypes.AUTH];
    }
    // Firebase Firestore error
    else if (error.code && ['permission-denied', 'not-found', 'already-exists', 'resource-exhausted', 'unavailable', 'deadline-exceeded'].includes(error.code)) {
      type = error.code === 'permission-denied' ? ErrorTypes.PERMISSION : ErrorTypes.FIREBASE;
      code = error.code;
      message = ErrorMessages[error.code] || error.message;
    }
    // Firebase Storage error
    else if (error.code && error.code.startsWith('storage/')) {
      type = ErrorTypes.STORAGE;
      code = error.code;
      message = ErrorMessages[error.code] || error.message;
    }
    // Network error
    else if (error.message && (
      error.message.includes('network') ||
      error.message.includes('Network') ||
      error.message.includes('Failed to fetch') ||
      error.message.includes('ERR_INTERNET_DISCONNECTED')
    )) {
      type = ErrorTypes.NETWORK;
      code = 'NETWORK_ERROR';
      message = ErrorMessages[ErrorTypes.NETWORK];
    }
    // Timeout error
    else if (error.message && (
      error.message.includes('timeout') ||
      error.message.includes('Timeout')
    )) {
      type = ErrorTypes.TIMEOUT;
      code = 'TIMEOUT_ERROR';
      message = ErrorMessages[ErrorTypes.TIMEOUT];
    }
    // HTTP error responses
    else if (error.status || error.statusCode) {
      const status = error.status || error.statusCode;
      if (status === 401 || status === 403) {
        type = status === 401 ? ErrorTypes.AUTH : ErrorTypes.PERMISSION;
        code = `HTTP_${status}`;
        message = status === 401 ? ErrorMessages[ErrorTypes.AUTH] : ErrorMessages[ErrorTypes.PERMISSION];
      } else if (status === 404) {
        type = ErrorTypes.NOT_FOUND;
        code = 'HTTP_404';
        message = ErrorMessages[ErrorTypes.NOT_FOUND];
      } else if (status >= 500) {
        type = ErrorTypes.SERVER;
        code = `HTTP_${status}`;
        message = ErrorMessages[ErrorTypes.SERVER];
      }
    }
    // Cloud Function errors
    else if (error.details) {
      code = error.code || 'FUNCTION_ERROR';
      message = error.details || error.message;
      type = code === 'unauthenticated' ? ErrorTypes.AUTH :
             code === 'permission-denied' ? ErrorTypes.PERMISSION :
             ErrorTypes.SERVER;
    }
    // Generic error with message
    else if (error.message) {
      message = error.message;
    }

    return {
      type,
      code,
      message,
      originalError: error
    };
  }

  /**
   * Log error vào console và error log
   * @param {Error|Object|string} error - Lỗi cần log
   * @param {string} context - Context của lỗi (tên function, module)
   */
  function logError(error, context = '') {
    const parsed = parseError(error);
    const timestamp = new Date().toISOString();

    const logEntry = {
      timestamp,
      context,
      type: parsed.type,
      code: parsed.code,
      message: parsed.message,
      stack: error && error.stack ? error.stack : null
    };

    // Console log (development)
    console.error(`[${timestamp}] [${context}] ${parsed.type}:`, parsed.message, error);

    // Store in memory log
    errorLog.push(logEntry);
    if (errorLog.length > MAX_LOG_SIZE) {
      errorLog.shift();
    }

    // Optionally send to analytics/monitoring
    // sendToMonitoring(logEntry);
  }

  /**
   * Handle error và hiển thị thông báo cho user
   * @param {Error|Object|string} error - Lỗi cần xử lý
   * @param {string} context - Context của lỗi
   * @param {Object} options - Tùy chọn xử lý
   * @returns {Object} Parsed error object
   */
  function handle(error, context = '', options = {}) {
    const {
      showToast = true,
      logToConsole = true,
      rethrow = false,
      customMessage = null
    } = options;

    const parsed = parseError(error);

    // Log error
    if (logToConsole) {
      logError(error, context);
    }

    // Show toast notification
    if (showToast && typeof showNotification === 'function') {
      showNotification(customMessage || parsed.message, 'error');
    } else if (showToast) {
      // Fallback alert
      console.warn('showNotification not available, using alert');
      alert(customMessage || parsed.message);
    }

    // Handle specific error types
    if (parsed.type === ErrorTypes.AUTH) {
      handleAuthError(parsed);
    }

    // Rethrow if needed
    if (rethrow) {
      throw error;
    }

    return parsed;
  }

  /**
   * Xử lý đặc biệt cho Auth errors
   * @param {Object} parsed - Parsed error object
   */
  function handleAuthError(parsed) {
    // Redirect to login if session expired
    if (parsed.code === 'auth/requires-recent-login' ||
        parsed.message.includes('đăng nhập lại')) {
      setTimeout(() => {
        if (typeof logout === 'function') {
          logout();
        } else if (typeof ErpDb !== 'undefined' && ErpDb.auth) {
          ErpDb.auth().signOut().then(() => {
            window.location.reload();
          });
        }
      }, 2000);
    }
  }

  /**
   * Wrapper để try-catch async functions
   * @param {Function} fn - Async function cần wrap
   * @param {string} context - Context của function
   * @param {Object} options - Tùy chọn xử lý lỗi
   * @returns {Function} Wrapped function
   */
  function wrapAsync(fn, context = '', options = {}) {
    return async function(...args) {
      try {
        return await fn.apply(this, args);
      } catch (error) {
        handle(error, context, options);
        return null;
      }
    };
  }

  /**
   * Promise wrapper với error handling
   * @param {Promise} promise - Promise cần wrap
   * @param {string} context - Context
   * @returns {Promise} [error, result]
   */
  async function to(promise, context = '') {
    try {
      const result = await promise;
      return [null, result];
    } catch (error) {
      logError(error, context);
      return [parseError(error), null];
    }
  }

  // ==================== UI ERROR DISPLAY ====================

  /**
   * Hiển thị lỗi inline trong element
   * @param {string} elementId - ID của element chứa error
   * @param {string} message - Thông báo lỗi
   */
  function showInlineError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = message;
      element.style.display = 'block';
      element.classList.add('error-message');
    }
  }

  /**
   * Xóa lỗi inline
   * @param {string} elementId - ID của element chứa error
   */
  function clearInlineError(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = '';
      element.style.display = 'none';
    }
  }

  /**
   * Hiển thị error state cho một section/card
   * @param {string} containerId - ID của container
   * @param {string} message - Thông báo lỗi
   * @param {Function} retryFn - Function để retry (optional)
   */
  function showErrorState(containerId, message, retryFn = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const retryButton = retryFn ?
      `<button onclick="(${retryFn.toString()})()" style="margin-top:12px;padding:8px 16px;background:#3b82f6;color:white;border:none;border-radius:6px;cursor:pointer">Thử lại</button>` :
      '';

    container.innerHTML = `
      <div style="text-align:center;padding:40px;color:#6b7280">
        <div style="font-size:48px;margin-bottom:16px">⚠️</div>
        <div style="font-size:14px;margin-bottom:8px">${message}</div>
        ${retryButton}
      </div>
    `;
  }

  // ==================== ERROR BOUNDARY ====================

  /**
   * Setup global error handlers
   */
  function setupGlobalHandlers() {
    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', function(event) {
      logError(event.reason, 'UnhandledRejection');
      event.preventDefault();
    });

    // Global errors
    window.addEventListener('error', function(event) {
      logError(event.error || event.message, 'GlobalError');
    });
  }

  // ==================== ERROR LOG ACCESS ====================

  /**
   * Lấy error log
   * @returns {Array} Error log entries
   */
  function getErrorLog() {
    return [...errorLog];
  }

  /**
   * Clear error log
   */
  function clearErrorLog() {
    errorLog = [];
  }

  /**
   * Export error log as JSON
   * @returns {string} JSON string
   */
  function exportErrorLog() {
    return JSON.stringify(errorLog, null, 2);
  }

  // ==================== INITIALIZE ====================

  // Auto-setup global handlers
  if (typeof window !== 'undefined') {
    setupGlobalHandlers();
  }

  // ==================== PUBLIC API ====================
  return {
    // Types
    ErrorTypes,
    ErrorMessages,

    // Core functions
    parseError,
    logError,
    handle,
    handleAuthError,

    // Utility wrappers
    wrapAsync,
    to,

    // UI functions
    showInlineError,
    clearInlineError,
    showErrorState,

    // Error log
    getErrorLog,
    clearErrorLog,
    exportErrorLog,

    // Setup
    setupGlobalHandlers
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ErrorHandler;
}
