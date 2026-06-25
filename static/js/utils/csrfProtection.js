/**
 * CSRF Protection Module
 * Token-based protection cho form submissions và API calls
 * @module csrfProtection
 */

const CSRFProtection = (function() {
  'use strict';

  // ==================== CONFIG ====================
  const CONFIG = {
    tokenLength: 32,
    tokenTTL: 3600000,         // 1 giờ
    storageKey: 'qtdn_csrf_token',
    headerName: 'X-CSRF-Token',
    paramName: 'csrf_token',
    cookieName: 'qtdn_csrf',
    autoRefresh: true,
    refreshBefore: 300000      // Refresh 5 phút trước khi hết hạn
  };

  // ==================== STATE ====================
  let currentToken = null;
  let tokenExpiry = 0;
  let refreshTimer = null;

  // ==================== TOKEN GENERATION ====================

  /**
   * Generate cryptographically secure random token
   */
  function generateToken() {
    const array = new Uint8Array(CONFIG.tokenLength);

    // Use crypto API if available
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(array);
    } else {
      // Fallback (less secure)
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }

    // Convert to base64url
    return btoa(String.fromCharCode.apply(null, array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Create new CSRF token
   */
  function createToken() {
    const token = generateToken();
    const expiry = Date.now() + CONFIG.tokenTTL;

    currentToken = token;
    tokenExpiry = expiry;

    // Store token
    storeToken(token, expiry);

    // Set up auto refresh
    if (CONFIG.autoRefresh) {
      scheduleRefresh();
    }

    console.log('[CSRF] Token created');
    return token;
  }

  /**
   * Store token in multiple places for validation
   */
  function storeToken(token, expiry) {
    // Session storage (primary)
    try {
      sessionStorage.setItem(CONFIG.storageKey, JSON.stringify({
        token,
        expiry
      }));
    } catch (e) {
      console.warn('[CSRF] Failed to store token in sessionStorage');
    }

    // Cookie (for server-side validation)
    try {
      document.cookie = `${CONFIG.cookieName}=${token}; path=/; SameSite=Strict; Secure`;
    } catch (e) {
      console.warn('[CSRF] Failed to set cookie');
    }

    // Meta tag for easy access
    let metaTag = document.querySelector('meta[name="csrf-token"]');
    if (!metaTag) {
      metaTag = document.createElement('meta');
      metaTag.name = 'csrf-token';
      document.head.appendChild(metaTag);
    }
    metaTag.content = token;
  }

  /**
   * Load token from storage
   */
  function loadToken() {
    try {
      const stored = sessionStorage.getItem(CONFIG.storageKey);
      if (stored) {
        const { token, expiry } = JSON.parse(stored);
        if (expiry > Date.now()) {
          currentToken = token;
          tokenExpiry = expiry;

          if (CONFIG.autoRefresh) {
            scheduleRefresh();
          }

          return token;
        }
      }
    } catch (e) {
      console.warn('[CSRF] Failed to load token');
    }

    return null;
  }

  /**
   * Schedule token refresh
   */
  function scheduleRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    const refreshIn = tokenExpiry - Date.now() - CONFIG.refreshBefore;
    if (refreshIn > 0) {
      refreshTimer = setTimeout(() => {
        createToken();
      }, refreshIn);
    }
  }

  // ==================== TOKEN OPERATIONS ====================

  /**
   * Get current token (create if not exists)
   */
  function getToken() {
    if (currentToken && tokenExpiry > Date.now()) {
      return currentToken;
    }

    // Try loading from storage
    const loaded = loadToken();
    if (loaded) {
      return loaded;
    }

    // Create new token
    return createToken();
  }

  /**
   * Refresh token manually
   */
  function refreshToken() {
    return createToken();
  }

  /**
   * Validate token
   */
  function validateToken(token) {
    if (!currentToken) {
      loadToken();
    }

    if (!currentToken) {
      return { valid: false, error: 'No token available' };
    }

    if (token !== currentToken) {
      return { valid: false, error: 'Token mismatch' };
    }

    if (Date.now() > tokenExpiry) {
      return { valid: false, error: 'Token expired' };
    }

    return { valid: true };
  }

  /**
   * Clear token
   */
  function clearToken() {
    currentToken = null;
    tokenExpiry = 0;

    sessionStorage.removeItem(CONFIG.storageKey);

    // Clear cookie
    document.cookie = `${CONFIG.cookieName}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;

    // Clear meta tag
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    if (metaTag) {
      metaTag.content = '';
    }

    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  // ==================== FORM PROTECTION ====================

  /**
   * Add CSRF token to form
   */
  function protectForm(form) {
    if (typeof form === 'string') {
      form = document.querySelector(form);
    }

    if (!form || form.tagName !== 'FORM') {
      console.warn('[CSRF] Invalid form element');
      return false;
    }

    // Check if already protected
    let input = form.querySelector(`input[name="${CONFIG.paramName}"]`);

    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = CONFIG.paramName;
      form.appendChild(input);
    }

    input.value = getToken();
    return true;
  }

  /**
   * Protect all forms on page
   */
  function protectAllForms() {
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
      // Skip forms with data-csrf-ignore attribute
      if (!form.hasAttribute('data-csrf-ignore')) {
        protectForm(form);
      }
    });
  }

  /**
   * Add submit handler to validate CSRF
   */
  function addFormValidation(form, onInvalid = null) {
    if (typeof form === 'string') {
      form = document.querySelector(form);
    }

    if (!form) return;

    form.addEventListener('submit', (e) => {
      const input = form.querySelector(`input[name="${CONFIG.paramName}"]`);
      const token = input?.value;

      const validation = validateToken(token);

      if (!validation.valid) {
        e.preventDefault();

        if (onInvalid) {
          onInvalid(validation.error);
        } else {
          console.error('[CSRF] Validation failed:', validation.error);
          if (typeof Notification !== 'undefined') {
            Notification.error('Phiên làm việc không hợp lệ. Vui lòng tải lại trang.');
          }
        }
      }
    });
  }

  // ==================== FETCH PROTECTION ====================

  /**
   * Create fetch wrapper with CSRF token
   */
  function createSecureFetch() {
    const originalFetch = window.fetch;

    return function(url, options = {}) {
      // Only add token for same-origin requests
      const urlObj = new URL(url, window.location.origin);
      if (urlObj.origin !== window.location.origin) {
        return originalFetch(url, options);
      }

      // Skip GET and HEAD requests
      const method = (options.method || 'GET').toUpperCase();
      if (method === 'GET' || method === 'HEAD') {
        return originalFetch(url, options);
      }

      // Add CSRF header
      const headers = new Headers(options.headers || {});
      headers.set(CONFIG.headerName, getToken());

      return originalFetch(url, {
        ...options,
        headers
      });
    };
  }

  /**
   * Install secure fetch globally
   */
  function installSecureFetch() {
    window.fetch = createSecureFetch();
    console.log('[CSRF] Secure fetch installed');
  }

  /**
   * Get headers object with CSRF token
   */
  function getHeaders(existingHeaders = {}) {
    return {
      ...existingHeaders,
      [CONFIG.headerName]: getToken()
    };
  }

  // ==================== AXIOS INTERCEPTOR ====================

  /**
   * Create Axios interceptor
   */
  function createAxiosInterceptor(axios) {
    axios.interceptors.request.use((config) => {
      // Skip GET and HEAD
      if (['get', 'head'].includes(config.method?.toLowerCase())) {
        return config;
      }

      // Add CSRF token
      config.headers = config.headers || {};
      config.headers[CONFIG.headerName] = getToken();

      return config;
    });

    console.log('[CSRF] Axios interceptor installed');
  }

  // ==================== DOUBLE SUBMIT COOKIE ====================

  /**
   * Validate double submit cookie pattern
   * (Compare cookie value with header/param value)
   */
  function validateDoubleSubmit(headerOrParamToken) {
    // Get cookie token
    const cookies = document.cookie.split(';');
    let cookieToken = null;

    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === CONFIG.cookieName) {
        cookieToken = value;
        break;
      }
    }

    if (!cookieToken) {
      return { valid: false, error: 'No cookie token' };
    }

    if (cookieToken !== headerOrParamToken) {
      return { valid: false, error: 'Cookie and header token mismatch' };
    }

    return { valid: true };
  }

  // ==================== MUTATION OBSERVER ====================

  /**
   * Auto-protect new forms added to DOM
   */
  function enableAutoProtect() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if it's a form
            if (node.tagName === 'FORM' && !node.hasAttribute('data-csrf-ignore')) {
              protectForm(node);
            }
            // Check for forms inside the added node
            const forms = node.querySelectorAll?.('form:not([data-csrf-ignore])');
            forms?.forEach(form => protectForm(form));
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[CSRF] Auto-protect enabled');
    return observer;
  }

  // ==================== INITIALIZATION ====================

  // Initialize on load
  if (typeof document !== 'undefined') {
    // Load existing token or create new one
    if (!loadToken()) {
      createToken();
    }

    // Protect existing forms when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', protectAllForms);
    } else {
      protectAllForms();
    }
  }

  // ==================== PUBLIC API ====================
  return {
    // Token operations
    getToken,
    refreshToken,
    validateToken,
    clearToken,

    // Form protection
    protectForm,
    protectAllForms,
    addFormValidation,

    // Fetch protection
    createSecureFetch,
    installSecureFetch,
    getHeaders,

    // Axios
    createAxiosInterceptor,

    // Double submit
    validateDoubleSubmit,

    // Auto protect
    enableAutoProtect,

    // Config
    CONFIG,
    get headerName() { return CONFIG.headerName; },
    get paramName() { return CONFIG.paramName; }
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CSRFProtection;
}
