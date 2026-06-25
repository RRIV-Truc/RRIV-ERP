/**
 * Error Tracker Module
 * Capture và report JavaScript errors
 * @module errorTracker
 */

const ErrorTracker = (function() {
  'use strict';

  // ==================== CONFIG ====================
  const CONFIG = {
    enabled: true,
    captureGlobalErrors: true,
    captureUnhandledRejections: true,
    captureConsoleErrors: true,
    maxErrors: 100,
    maxStackFrames: 10,
    reportEndpoint: null,
    sampleRate: 1.0,
    ignorePatterns: [
      /ResizeObserver loop/,
      /Script error/,
      /Loading chunk/,
      /Network request failed/
    ],
    storageKey: 'qtdn_error_logs',
    contextLines: 5
  };

  // ==================== STATE ====================
  const errors = [];
  const errorCounts = new Map();
  let isInitialized = false;
  let userId = null;
  let sessionId = null;
  const breadcrumbs = [];
  const MAX_BREADCRUMBS = 50;

  // ==================== ERROR TYPES ====================
  const ERROR_TYPES = {
    JAVASCRIPT: 'javascript',
    PROMISE: 'unhandled_promise',
    NETWORK: 'network',
    RESOURCE: 'resource',
    CONSOLE: 'console',
    CUSTOM: 'custom'
  };

  const SEVERITY = {
    DEBUG: 'debug',
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical'
  };

  // ==================== BREADCRUMBS ====================

  /**
   * Add breadcrumb for context
   */
  function addBreadcrumb(category, message, data = {}) {
    const crumb = {
      timestamp: Date.now(),
      category,
      message,
      data,
      level: data.level || 'info'
    };

    breadcrumbs.push(crumb);

    // Keep only recent breadcrumbs
    if (breadcrumbs.length > MAX_BREADCRUMBS) {
      breadcrumbs.shift();
    }
  }

  /**
   * Get recent breadcrumbs
   */
  function getBreadcrumbs(count = MAX_BREADCRUMBS) {
    return breadcrumbs.slice(-count);
  }

  /**
   * Clear breadcrumbs
   */
  function clearBreadcrumbs() {
    breadcrumbs.length = 0;
  }

  // ==================== ERROR CAPTURE ====================

  /**
   * Capture error
   * @param {Error|string} error - Error object or message
   * @param {Object} options - Additional options
   */
  function captureError(error, options = {}) {
    if (!CONFIG.enabled) return null;

    // Sample rate check
    if (Math.random() > CONFIG.sampleRate) return null;

    const {
      type = ERROR_TYPES.JAVASCRIPT,
      severity = SEVERITY.ERROR,
      tags = {},
      extra = {},
      fingerprint = null
    } = options;

    // Normalize error
    const normalizedError = normalizeError(error);

    // Check ignore patterns
    if (shouldIgnore(normalizedError.message)) {
      return null;
    }

    // Generate fingerprint for deduplication
    const errorFingerprint = fingerprint || generateFingerprint(normalizedError);

    // Check if duplicate
    const existingCount = errorCounts.get(errorFingerprint) || 0;
    errorCounts.set(errorFingerprint, existingCount + 1);

    // Skip if too many duplicates
    if (existingCount > 10) {
      return null;
    }

    // Create error report
    const report = {
      id: generateErrorId(),
      type,
      severity,
      timestamp: Date.now(),
      message: normalizedError.message,
      name: normalizedError.name,
      stack: normalizedError.stack,
      stackFrames: parseStack(normalizedError.stack),
      fingerprint: errorFingerprint,
      count: existingCount + 1,
      context: {
        url: window.location.href,
        userAgent: navigator.userAgent,
        userId,
        sessionId,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        timestamp: new Date().toISOString()
      },
      breadcrumbs: getBreadcrumbs(20),
      tags,
      extra
    };

    // Store error
    storeError(report);

    // Report to endpoint
    if (CONFIG.reportEndpoint) {
      reportError(report);
    }

    // Log to console in development
    console.error('[ErrorTracker]', report.message, report);

    return report;
  }

  /**
   * Capture exception (alias)
   */
  function captureException(error, options = {}) {
    return captureError(error, { ...options, type: ERROR_TYPES.JAVASCRIPT });
  }

  /**
   * Capture message
   */
  function captureMessage(message, options = {}) {
    return captureError(new Error(message), {
      ...options,
      type: ERROR_TYPES.CUSTOM,
      severity: options.severity || SEVERITY.INFO
    });
  }

  // ==================== ERROR NORMALIZATION ====================

  /**
   * Normalize error to standard format
   */
  function normalizeError(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }

    if (typeof error === 'string') {
      return {
        name: 'Error',
        message: error,
        stack: new Error(error).stack
      };
    }

    if (error && typeof error === 'object') {
      return {
        name: error.name || 'Error',
        message: error.message || JSON.stringify(error),
        stack: error.stack || new Error().stack
      };
    }

    return {
      name: 'UnknownError',
      message: String(error),
      stack: new Error().stack
    };
  }

  /**
   * Parse stack trace
   */
  function parseStack(stack) {
    if (!stack) return [];

    const lines = stack.split('\n').slice(1, CONFIG.maxStackFrames + 1);
    const frames = [];

    for (const line of lines) {
      const match = line.match(/at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):(\d+)\)?/);

      if (match) {
        frames.push({
          function: match[1] || 'anonymous',
          file: match[2],
          line: parseInt(match[3], 10),
          column: parseInt(match[4], 10)
        });
      }
    }

    return frames;
  }

  /**
   * Generate fingerprint for deduplication
   */
  function generateFingerprint(error) {
    const key = `${error.name}:${error.message}:${error.stack?.split('\n')[1] || ''}`;
    let hash = 0;

    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString(36);
  }

  /**
   * Generate error ID
   */
  function generateErrorId() {
    return 'err_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Check if error should be ignored
   */
  function shouldIgnore(message) {
    if (!message) return false;

    return CONFIG.ignorePatterns.some(pattern => {
      if (pattern instanceof RegExp) {
        return pattern.test(message);
      }
      return message.includes(pattern);
    });
  }

  // ==================== GLOBAL HANDLERS ====================

  /**
   * Setup global error handlers
   */
  function setupGlobalHandlers() {
    // Global error handler
    if (CONFIG.captureGlobalErrors) {
      window.addEventListener('error', (event) => {
        // Check if it's a resource loading error
        if (event.target && (event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK' || event.target.tagName === 'IMG')) {
          captureError(new Error(`Failed to load resource: ${event.target.src || event.target.href}`), {
            type: ERROR_TYPES.RESOURCE,
            severity: SEVERITY.WARNING,
            extra: {
              element: event.target.tagName,
              src: event.target.src || event.target.href
            }
          });
          return;
        }

        captureError(event.error || event.message, {
          type: ERROR_TYPES.JAVASCRIPT,
          extra: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
          }
        });
      }, true);
    }

    // Unhandled promise rejection handler
    if (CONFIG.captureUnhandledRejections) {
      window.addEventListener('unhandledrejection', (event) => {
        captureError(event.reason, {
          type: ERROR_TYPES.PROMISE,
          severity: SEVERITY.ERROR,
          extra: {
            promise: 'unhandled'
          }
        });
      });
    }

    // Console error capture
    if (CONFIG.captureConsoleErrors) {
      const originalConsoleError = console.error;
      console.error = function(...args) {
        // Capture error
        const message = args.map(arg =>
          arg instanceof Error ? arg.message : String(arg)
        ).join(' ');

        captureError(new Error(message), {
          type: ERROR_TYPES.CONSOLE,
          severity: SEVERITY.ERROR
        });

        // Call original
        originalConsoleError.apply(console, args);
      };
    }
  }

  /**
   * Setup automatic breadcrumbs
   */
  function setupAutoBreadcrumbs() {
    // Click events
    document.addEventListener('click', (event) => {
      const target = event.target;
      const selector = getElementSelector(target);

      addBreadcrumb('ui', 'click', {
        selector,
        text: target.textContent?.slice(0, 50)
      });
    }, true);

    // Navigation
    window.addEventListener('popstate', () => {
      addBreadcrumb('navigation', 'popstate', {
        url: window.location.href
      });
    });

    // XHR requests
    const originalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
      const xhr = new originalXHR();
      const originalOpen = xhr.open;

      xhr.open = function(method, url) {
        xhr._method = method;
        xhr._url = url;
        return originalOpen.apply(xhr, arguments);
      };

      xhr.addEventListener('loadend', () => {
        addBreadcrumb('xhr', `${xhr._method} ${xhr._url}`, {
          status: xhr.status,
          statusText: xhr.statusText
        });
      });

      return xhr;
    };

    // Fetch requests
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      const method = init?.method || 'GET';
      const url = typeof input === 'string' ? input : input.url;

      return originalFetch.apply(window, arguments)
        .then(response => {
          addBreadcrumb('fetch', `${method} ${url}`, {
            status: response.status,
            ok: response.ok
          });
          return response;
        })
        .catch(error => {
          addBreadcrumb('fetch', `${method} ${url}`, {
            error: error.message,
            level: 'error'
          });
          throw error;
        });
    };
  }

  /**
   * Get element selector for breadcrumb
   */
  function getElementSelector(element) {
    if (!element) return '';

    const parts = [];
    let current = element;

    while (current && current !== document.body && parts.length < 5) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector += `#${current.id}`;
      } else if (current.className) {
        const classes = current.className.split(' ').filter(c => c).slice(0, 2);
        if (classes.length) {
          selector += `.${classes.join('.')}`;
        }
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  // ==================== STORAGE ====================

  /**
   * Store error locally
   */
  function storeError(report) {
    errors.push(report);

    // Keep only recent errors
    if (errors.length > CONFIG.maxErrors) {
      errors.shift();
    }

    // Persist to localStorage
    try {
      const stored = errors.slice(-50);
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(stored));
    } catch (e) {
      // Storage full
    }
  }

  /**
   * Load stored errors
   */
  function loadErrors() {
    try {
      const stored = localStorage.getItem(CONFIG.storageKey);
      if (stored) {
        const loaded = JSON.parse(stored);
        errors.push(...loaded);
      }
    } catch (e) {
      // Invalid data
    }
  }

  // ==================== REPORTING ====================

  /**
   * Report error to endpoint
   */
  async function reportError(report) {
    if (!CONFIG.reportEndpoint) return;

    try {
      await fetch(CONFIG.reportEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
        keepalive: true
      });
    } catch (e) {
      // Report failed
      console.warn('[ErrorTracker] Failed to report error');
    }
  }

  /**
   * Flush all pending errors
   */
  async function flush() {
    const pending = errors.filter(e => !e.reported);

    for (const error of pending) {
      await reportError(error);
      error.reported = true;
    }
  }

  // ==================== CONTEXT ====================

  /**
   * Set user context
   */
  function setUser(id, data = {}) {
    userId = id;
    addBreadcrumb('user', 'setUser', { id, ...data });
  }

  /**
   * Set session context
   */
  function setSession(id) {
    sessionId = id;
  }

  /**
   * Add tag
   */
  function setTag(key, value) {
    CONFIG.tags = CONFIG.tags || {};
    CONFIG.tags[key] = value;
  }

  /**
   * Add extra context
   */
  function setExtra(key, value) {
    CONFIG.extra = CONFIG.extra || {};
    CONFIG.extra[key] = value;
  }

  // ==================== QUERY ====================

  /**
   * Get all errors
   */
  function getErrors(filters = {}) {
    let result = [...errors];

    if (filters.type) {
      result = result.filter(e => e.type === filters.type);
    }

    if (filters.severity) {
      result = result.filter(e => e.severity === filters.severity);
    }

    if (filters.since) {
      result = result.filter(e => e.timestamp >= filters.since);
    }

    return result.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get error statistics
   */
  function getStats() {
    const now = Date.now();
    const hour = now - 3600000;
    const day = now - 86400000;

    return {
      total: errors.length,
      lastHour: errors.filter(e => e.timestamp >= hour).length,
      lastDay: errors.filter(e => e.timestamp >= day).length,
      byType: countBy(errors, 'type'),
      bySeverity: countBy(errors, 'severity'),
      topErrors: getTopErrors(5)
    };
  }

  /**
   * Count by property
   */
  function countBy(arr, prop) {
    return arr.reduce((acc, item) => {
      const key = item[prop];
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Get most frequent errors
   */
  function getTopErrors(count = 10) {
    const counts = {};

    errors.forEach(e => {
      counts[e.fingerprint] = counts[e.fingerprint] || { ...e, count: 0 };
      counts[e.fingerprint].count++;
    });

    return Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, count);
  }

  // ==================== INITIALIZATION ====================

  /**
   * Initialize error tracking
   */
  function init(options = {}) {
    if (isInitialized) return;

    Object.assign(CONFIG, options);

    loadErrors();
    setupGlobalHandlers();
    setupAutoBreadcrumbs();

    isInitialized = true;
    console.log('[ErrorTracker] Error tracking initialized');
  }

  // Auto-init
  if (typeof window !== 'undefined') {
    init();
  }

  // ==================== PUBLIC API ====================
  return {
    // Capture
    captureError,
    captureException,
    captureMessage,

    // Breadcrumbs
    addBreadcrumb,
    getBreadcrumbs,
    clearBreadcrumbs,

    // Context
    setUser,
    setSession,
    setTag,
    setExtra,

    // Query
    getErrors,
    getStats,
    getTopErrors,

    // Reporting
    flush,
    setReportEndpoint: (url) => { CONFIG.reportEndpoint = url; },

    // Control
    init,
    enable: () => { CONFIG.enabled = true; },
    disable: () => { CONFIG.enabled = false; },

    // Constants
    ERROR_TYPES,
    SEVERITY,

    // Config
    CONFIG
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ErrorTracker;
}
