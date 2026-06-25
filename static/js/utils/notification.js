/**
 * Notification/Toast Utility Module
 * Hiển thị thông báo toast cho người dùng
 * @module notification
 */

const Toast = (function() {
  'use strict';

  // ==================== CONFIGURATION ====================
  const DEFAULTS = {
    duration: {
      success: 3000,
      error: 5000,
      warning: 4000,
      info: 3000
    },
    position: 'top-right', // top-right, top-left, bottom-right, bottom-left, top-center, bottom-center
    maxToasts: 5,
    animation: true
  };

  // Container element
  let container = null;
  let toastQueue = [];
  let activeToasts = 0;

  // ==================== ICONS ====================
  const ICONS = {
    success: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm-1 15l-5-5 1.41-1.41L9 12.17l6.59-6.59L17 7l-8 8z" fill="#22c55e"/></svg>',
    error: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm1 15H9v-2h2v2zm0-4H9V5h2v6z" fill="#ef4444"/></svg>',
    warning: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M1 19h18L10 1 1 19zm10-3H9v-2h2v2zm0-4H9V8h2v4z" fill="#f59e0b"/></svg>',
    info: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm1 15H9V9h2v6zm0-8H9V5h2v2z" fill="#0ea5e9"/></svg>'
  };

  // ==================== STYLES ====================
  const STYLES = `
    .toast-container {
      position: fixed;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px;
      pointer-events: none;
      max-width: 100%;
    }
    .toast-container.top-right { top: 0; right: 0; }
    .toast-container.top-left { top: 0; left: 0; }
    .toast-container.bottom-right { bottom: 0; right: 0; }
    .toast-container.bottom-left { bottom: 0; left: 0; }
    .toast-container.top-center { top: 0; left: 50%; transform: translateX(-50%); }
    .toast-container.bottom-center { bottom: 0; left: 50%; transform: translateX(-50%); }

    .toast-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px;
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.15), 0 2px 10px rgba(0,0,0,0.1);
      pointer-events: auto;
      max-width: 400px;
      min-width: 300px;
      animation: toastSlideIn 0.3s ease;
      border-left: 4px solid #3b82f6;
    }

    .toast-item.success { border-left-color: #22c55e; }
    .toast-item.error { border-left-color: #ef4444; }
    .toast-item.warning { border-left-color: #f59e0b; }
    .toast-item.info { border-left-color: #0ea5e9; }

    .toast-item.removing {
      animation: toastSlideOut 0.3s ease forwards;
    }

    .toast-icon {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      margin-top: 2px;
    }

    .toast-content {
      flex: 1;
      min-width: 0;
    }

    .toast-title {
      font-weight: 600;
      font-size: 14px;
      color: #1f2937;
      margin-bottom: 2px;
    }

    .toast-message {
      font-size: 13px;
      color: #4b5563;
      line-height: 1.4;
      word-wrap: break-word;
    }

    .toast-close {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #9ca3af;
      border-radius: 4px;
      transition: all 0.2s;
      background: none;
      border: none;
      padding: 0;
    }

    .toast-close:hover {
      background: #f3f4f6;
      color: #4b5563;
    }

    .toast-progress {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 3px;
      background: rgba(0,0,0,0.1);
      border-radius: 0 0 0 10px;
    }

    .toast-item.success .toast-progress { background: #22c55e; }
    .toast-item.error .toast-progress { background: #ef4444; }
    .toast-item.warning .toast-progress { background: #f59e0b; }
    .toast-item.info .toast-progress { background: #0ea5e9; }

    @keyframes toastSlideIn {
      from {
        opacity: 0;
        transform: translateX(100%);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    @keyframes toastSlideOut {
      from {
        opacity: 1;
        transform: translateX(0);
      }
      to {
        opacity: 0;
        transform: translateX(100%);
      }
    }

    @keyframes toastProgress {
      from { width: 100%; }
      to { width: 0%; }
    }

    /* Mobile responsive */
    @media (max-width: 480px) {
      .toast-container {
        padding: 12px;
      }
      .toast-item {
        min-width: auto;
        max-width: 100%;
      }
    }
  `;

  // ==================== INITIALIZATION ====================

  /**
   * Initialize toast system
   */
  function init() {
    if (container) return;

    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);

    // Create container
    container = document.createElement('div');
    container.className = `toast-container ${DEFAULTS.position}`;
    document.body.appendChild(container);
  }

  // ==================== CORE FUNCTIONS ====================

  /**
   * Hiển thị toast
   * @param {string} message - Nội dung thông báo
   * @param {string} type - Loại: success, error, warning, info
   * @param {Object} options - Tùy chọn
   * @returns {HTMLElement} Toast element
   */
  function show(message, type = 'info', options = {}) {
    init();

    const {
      title = null,
      duration = DEFAULTS.duration[type] || 3000,
      closable = true,
      showProgress = true,
      onClick = null
    } = options;

    // Queue if max toasts reached
    if (activeToasts >= DEFAULTS.maxToasts) {
      toastQueue.push({ message, type, options });
      return null;
    }

    activeToasts++;

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast-item ${type}`;
    toast.innerHTML = `
      <div class="toast-icon">${ICONS[type] || ICONS.info}</div>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}
        <div class="toast-message">${escapeHtml(message)}</div>
      </div>
      ${closable ? `<button class="toast-close" aria-label="Đóng">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>` : ''}
      ${showProgress && duration > 0 ? `<div class="toast-progress" style="animation: toastProgress ${duration}ms linear forwards"></div>` : ''}
    `;

    // Click handler
    if (onClick) {
      toast.style.cursor = 'pointer';
      toast.addEventListener('click', (e) => {
        if (!e.target.closest('.toast-close')) {
          onClick();
        }
      });
    }

    // Close button handler
    if (closable) {
      const closeBtn = toast.querySelector('.toast-close');
      closeBtn.addEventListener('click', () => remove(toast));
    }

    // Add to container
    container.appendChild(toast);

    // Auto remove
    let timeoutId = null;
    if (duration > 0) {
      timeoutId = setTimeout(() => remove(toast), duration);
    }

    // Pause on hover
    toast.addEventListener('mouseenter', () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        const progress = toast.querySelector('.toast-progress');
        if (progress) {
          progress.style.animationPlayState = 'paused';
        }
      }
    });

    toast.addEventListener('mouseleave', () => {
      if (duration > 0) {
        const progress = toast.querySelector('.toast-progress');
        if (progress) {
          progress.style.animationPlayState = 'running';
        }
        timeoutId = setTimeout(() => remove(toast), duration / 2);
      }
    });

    return toast;
  }

  /**
   * Remove toast
   * @param {HTMLElement} toast - Toast element
   */
  function remove(toast) {
    if (!toast || !toast.parentNode) return;

    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
      activeToasts--;

      // Process queue
      if (toastQueue.length > 0 && activeToasts < DEFAULTS.maxToasts) {
        const { message, type, options } = toastQueue.shift();
        show(message, type, options);
      }
    }, 300);
  }

  /**
   * Remove all toasts
   */
  function removeAll() {
    if (!container) return;
    const toasts = container.querySelectorAll('.toast-item');
    toasts.forEach(toast => remove(toast));
    toastQueue = [];
  }

  // ==================== CONVENIENCE METHODS ====================

  function success(message, options = {}) {
    return show(message, 'success', options);
  }

  function error(message, options = {}) {
    return show(message, 'error', options);
  }

  function warning(message, options = {}) {
    return show(message, 'warning', options);
  }

  function info(message, options = {}) {
    return show(message, 'info', options);
  }

  // ==================== HELPER FUNCTIONS ====================

  /**
   * Escape HTML để tránh XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Set position
   * @param {string} position - Position: top-right, top-left, etc.
   */
  function setPosition(position) {
    DEFAULTS.position = position;
    if (container) {
      container.className = `toast-container ${position}`;
    }
  }

  // ==================== COMPATIBILITY ====================

  /**
   * Backward compatible with existing showNotification function
   * @param {string} message - Message
   * @param {string} type - Type
   */
  function showNotification(message, type = 'info') {
    // Map old types to new types
    const typeMap = {
      'success': 'success',
      'error': 'error',
      'warning': 'warning',
      'info': 'info',
      'danger': 'error'
    };
    return show(message, typeMap[type] || 'info');
  }

  // ==================== PUBLIC API ====================
  return {
    init,
    show,
    remove,
    removeAll,
    success,
    error,
    warning,
    info,
    setPosition,
    showNotification
  };
})();

// Make showNotification globally available for backward compatibility
if (typeof window !== 'undefined') {
  window.showNotification = Toast.showNotification;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Toast;
}
