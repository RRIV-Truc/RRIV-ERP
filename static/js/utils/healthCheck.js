/**
 * Health Check Module
 * API và service monitoring
 * @module healthCheck
 */

const HealthCheck = (function() {
  'use strict';

  // ==================== CONFIG ====================
  const CONFIG = {
    enabled: true,
    checkInterval: 60000,      // 1 phút
    timeout: 10000,            // 10 giây timeout
    retryCount: 3,
    retryDelay: 2000,
    storageKey: 'qtdn_health_status',
    onStatusChange: null,
    endpoints: []
  };

  // ==================== STATE ====================
  let checkTimer = null;
  let isRunning = false;
  const healthStatus = new Map();
  const healthHistory = [];
  const MAX_HISTORY = 100;

  // ==================== STATUS ====================
  const STATUS = {
    HEALTHY: 'healthy',
    DEGRADED: 'degraded',
    UNHEALTHY: 'unhealthy',
    UNKNOWN: 'unknown'
  };

  // ==================== CHECK TYPES ====================
  const CHECK_TYPES = {
    HTTP: 'http',
    FIREBASE: 'firebase',
    WEBSOCKET: 'websocket',
    STORAGE: 'storage',
    CUSTOM: 'custom'
  };

  // ==================== ENDPOINT REGISTRATION ====================

  /**
   * Register endpoint to monitor
   * @param {Object} endpoint - Endpoint configuration
   */
  function registerEndpoint(endpoint) {
    const {
      name,
      type = CHECK_TYPES.HTTP,
      url = null,
      method = 'GET',
      headers = {},
      expectedStatus = 200,
      timeout = CONFIG.timeout,
      interval = CONFIG.checkInterval,
      checkFn = null
    } = endpoint;

    if (!name) {
      console.warn('[HealthCheck] Endpoint name is required');
      return;
    }

    CONFIG.endpoints.push({
      name,
      type,
      url,
      method,
      headers,
      expectedStatus,
      timeout,
      interval,
      checkFn,
      lastCheck: null,
      lastStatus: STATUS.UNKNOWN
    });

    // Initialize status
    healthStatus.set(name, {
      status: STATUS.UNKNOWN,
      lastCheck: null,
      latency: null,
      error: null,
      consecutiveFailures: 0
    });

    console.log(`[HealthCheck] Registered endpoint: ${name}`);
  }

  /**
   * Register multiple endpoints
   */
  function registerEndpoints(endpoints) {
    endpoints.forEach(ep => registerEndpoint(ep));
  }

  /**
   * Unregister endpoint
   */
  function unregisterEndpoint(name) {
    const index = CONFIG.endpoints.findIndex(ep => ep.name === name);
    if (index !== -1) {
      CONFIG.endpoints.splice(index, 1);
      healthStatus.delete(name);
    }
  }

  // ==================== HEALTH CHECKS ====================

  /**
   * Check single endpoint
   */
  async function checkEndpoint(endpoint) {
    const startTime = performance.now();
    let status = STATUS.UNKNOWN;
    let error = null;
    let latency = null;

    try {
      switch (endpoint.type) {
        case CHECK_TYPES.HTTP:
          await checkHTTP(endpoint);
          break;

        case CHECK_TYPES.FIREBASE:
          await checkFirebase(endpoint);
          break;

        case CHECK_TYPES.WEBSOCKET:
          await checkWebSocket(endpoint);
          break;

        case CHECK_TYPES.STORAGE:
          await checkStorage(endpoint);
          break;

        case CHECK_TYPES.CUSTOM:
          if (endpoint.checkFn) {
            await endpoint.checkFn();
          }
          break;
      }

      latency = Math.round(performance.now() - startTime);
      status = latency > 3000 ? STATUS.DEGRADED : STATUS.HEALTHY;

    } catch (e) {
      error = e.message;
      status = STATUS.UNHEALTHY;
      latency = Math.round(performance.now() - startTime);
    }

    // Update status
    const currentStatus = healthStatus.get(endpoint.name) || {};
    const previousStatus = currentStatus.status;

    const newStatus = {
      status,
      lastCheck: Date.now(),
      latency,
      error,
      consecutiveFailures: status === STATUS.UNHEALTHY
        ? (currentStatus.consecutiveFailures || 0) + 1
        : 0
    };

    healthStatus.set(endpoint.name, newStatus);

    // Record history
    recordHistory(endpoint.name, newStatus);

    // Notify on status change
    if (previousStatus !== status && CONFIG.onStatusChange) {
      CONFIG.onStatusChange(endpoint.name, status, previousStatus);
    }

    return newStatus;
  }

  /**
   * Check HTTP endpoint
   */
  async function checkHTTP(endpoint) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), endpoint.timeout);

    try {
      const response = await fetch(endpoint.url, {
        method: endpoint.method,
        headers: endpoint.headers,
        signal: controller.signal,
        mode: 'cors',
        cache: 'no-store'
      });

      clearTimeout(timeoutId);

      if (response.status !== endpoint.expectedStatus) {
        throw new Error(`Expected status ${endpoint.expectedStatus}, got ${response.status}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * Check Firebase services
   */
  async function checkFirebase(endpoint) {
    if (typeof ErpDb === 'undefined') {
      throw new Error('Firebase not available');
    }

    const service = endpoint.url || 'firestore';

    switch (service) {
      case 'auth':
        // Check auth service
        await ErpDb.auth().currentUser?.getIdToken(true);
        break;

      case 'firestore':
        // Check Firestore with a simple read
        const db = ErpDb.firestore();
        await db.collection('_health').doc('check').get();
        break;

      case 'storage':
        // Check Storage
        const storage = ErpDb.storage();
        await storage.ref('_health/check.txt').getMetadata().catch(() => {
          // File may not exist, that's ok
        });
        break;

      case 'functions':
        // Check if Functions is available
        if (!ErpDb.functions) {
          throw new Error('Firebase Functions not initialized');
        }
        break;

      default:
        throw new Error(`Unknown Firebase service: ${service}`);
    }
  }

  /**
   * Check WebSocket connection
   */
  async function checkWebSocket(endpoint) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint.url);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, endpoint.timeout);

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve();
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        reject(new Error('WebSocket connection failed'));
      };
    });
  }

  /**
   * Check local storage
   */
  async function checkStorage(endpoint) {
    const testKey = '_health_check_test';
    const testValue = Date.now().toString();

    // Test localStorage
    try {
      localStorage.setItem(testKey, testValue);
      const retrieved = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);

      if (retrieved !== testValue) {
        throw new Error('localStorage read/write mismatch');
      }
    } catch (e) {
      throw new Error(`localStorage error: ${e.message}`);
    }

    // Test sessionStorage
    try {
      sessionStorage.setItem(testKey, testValue);
      sessionStorage.removeItem(testKey);
    } catch (e) {
      throw new Error(`sessionStorage error: ${e.message}`);
    }

    // Check storage quota
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usedPercent = (estimate.usage / estimate.quota) * 100;

      if (usedPercent > 90) {
        throw new Error(`Storage nearly full: ${usedPercent.toFixed(1)}% used`);
      }
    }
  }

  /**
   * Run all health checks
   */
  async function checkAll() {
    const results = {};

    await Promise.all(
      CONFIG.endpoints.map(async (endpoint) => {
        const result = await checkEndpoint(endpoint);
        results[endpoint.name] = result;
      })
    );

    return results;
  }

  /**
   * Run health check with retry
   */
  async function checkWithRetry(endpoint, retries = CONFIG.retryCount) {
    for (let i = 0; i < retries; i++) {
      try {
        const result = await checkEndpoint(endpoint);
        if (result.status !== STATUS.UNHEALTHY) {
          return result;
        }
      } catch (e) {
        if (i < retries - 1) {
          await sleep(CONFIG.retryDelay);
        }
      }
    }

    return healthStatus.get(endpoint.name);
  }

  // ==================== HISTORY ====================

  /**
   * Record health check history
   */
  function recordHistory(name, status) {
    healthHistory.push({
      name,
      ...status,
      recordedAt: Date.now()
    });

    // Keep only recent history
    if (healthHistory.length > MAX_HISTORY) {
      healthHistory.shift();
    }

    // Persist to storage
    saveStatus();
  }

  /**
   * Get health history for endpoint
   */
  function getHistory(name = null, limit = 50) {
    let history = [...healthHistory];

    if (name) {
      history = history.filter(h => h.name === name);
    }

    return history.slice(-limit);
  }

  /**
   * Calculate uptime percentage
   */
  function getUptime(name, periodMs = 24 * 60 * 60 * 1000) {
    const since = Date.now() - periodMs;
    const history = healthHistory.filter(h =>
      h.name === name && h.recordedAt >= since
    );

    if (history.length === 0) return null;

    const healthyCount = history.filter(h => h.status === STATUS.HEALTHY).length;
    return Math.round((healthyCount / history.length) * 100);
  }

  // ==================== STORAGE ====================

  /**
   * Save status to storage
   */
  function saveStatus() {
    try {
      const data = {
        status: Object.fromEntries(healthStatus),
        history: healthHistory.slice(-50),
        savedAt: Date.now()
      };
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
    } catch (e) {
      // Storage unavailable
    }
  }

  /**
   * Load status from storage
   */
  function loadStatus() {
    try {
      const stored = localStorage.getItem(CONFIG.storageKey);
      if (stored) {
        const data = JSON.parse(stored);

        // Restore status
        if (data.status) {
          Object.entries(data.status).forEach(([name, status]) => {
            healthStatus.set(name, status);
          });
        }

        // Restore history
        if (data.history) {
          healthHistory.push(...data.history);
        }
      }
    } catch (e) {
      // Invalid data
    }
  }

  // ==================== MONITORING ====================

  /**
   * Start continuous monitoring
   */
  function startMonitoring() {
    if (isRunning) return;

    isRunning = true;

    // Run initial check
    checkAll();

    // Schedule periodic checks
    checkTimer = setInterval(() => {
      checkAll();
    }, CONFIG.checkInterval);

    console.log('[HealthCheck] Monitoring started');
  }

  /**
   * Stop monitoring
   */
  function stopMonitoring() {
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
    isRunning = false;
    console.log('[HealthCheck] Monitoring stopped');
  }

  // ==================== STATUS SUMMARY ====================

  /**
   * Get overall health status
   */
  function getOverallStatus() {
    const statuses = Array.from(healthStatus.values());

    if (statuses.length === 0) return STATUS.UNKNOWN;

    const hasUnhealthy = statuses.some(s => s.status === STATUS.UNHEALTHY);
    const hasDegraded = statuses.some(s => s.status === STATUS.DEGRADED);

    if (hasUnhealthy) return STATUS.UNHEALTHY;
    if (hasDegraded) return STATUS.DEGRADED;

    return STATUS.HEALTHY;
  }

  /**
   * Get health summary
   */
  function getSummary() {
    const statuses = Array.from(healthStatus.entries());

    return {
      overall: getOverallStatus(),
      timestamp: Date.now(),
      endpoints: statuses.map(([name, status]) => ({
        name,
        ...status,
        uptime24h: getUptime(name)
      })),
      counts: {
        total: statuses.length,
        healthy: statuses.filter(([, s]) => s.status === STATUS.HEALTHY).length,
        degraded: statuses.filter(([, s]) => s.status === STATUS.DEGRADED).length,
        unhealthy: statuses.filter(([, s]) => s.status === STATUS.UNHEALTHY).length,
        unknown: statuses.filter(([, s]) => s.status === STATUS.UNKNOWN).length
      }
    };
  }

  /**
   * Get status for specific endpoint
   */
  function getStatus(name) {
    return healthStatus.get(name) || null;
  }

  // ==================== ALERTS ====================

  /**
   * Get current alerts
   */
  function getAlerts() {
    const alerts = [];

    healthStatus.forEach((status, name) => {
      if (status.status === STATUS.UNHEALTHY) {
        alerts.push({
          level: 'critical',
          endpoint: name,
          message: `${name} is unhealthy: ${status.error || 'Unknown error'}`,
          timestamp: status.lastCheck
        });
      } else if (status.status === STATUS.DEGRADED) {
        alerts.push({
          level: 'warning',
          endpoint: name,
          message: `${name} is degraded: High latency (${status.latency}ms)`,
          timestamp: status.lastCheck
        });
      } else if (status.consecutiveFailures > 0) {
        alerts.push({
          level: 'info',
          endpoint: name,
          message: `${name} recovered after ${status.consecutiveFailures} failures`,
          timestamp: status.lastCheck
        });
      }
    });

    return alerts;
  }

  // ==================== UTILITIES ====================

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==================== DEFAULT ENDPOINTS ====================

  /**
   * Register default Firebase endpoints
   */
  function registerFirebaseEndpoints() {
    registerEndpoints([
      {
        name: 'Firebase Auth',
        type: CHECK_TYPES.FIREBASE,
        url: 'auth'
      },
      {
        name: 'Firebase Firestore',
        type: CHECK_TYPES.FIREBASE,
        url: 'firestore'
      },
      {
        name: 'Local Storage',
        type: CHECK_TYPES.STORAGE
      }
    ]);
  }

  // ==================== INITIALIZATION ====================

  /**
   * Initialize health check
   */
  function init(options = {}) {
    Object.assign(CONFIG, options);

    loadStatus();

    if (options.endpoints) {
      registerEndpoints(options.endpoints);
    }

    if (options.autoStart !== false) {
      startMonitoring();
    }

    console.log('[HealthCheck] Health check initialized');
  }

  // ==================== PUBLIC API ====================
  return {
    // Registration
    registerEndpoint,
    registerEndpoints,
    unregisterEndpoint,
    registerFirebaseEndpoints,

    // Checks
    checkEndpoint,
    checkAll,
    checkWithRetry,

    // Status
    getStatus,
    getOverallStatus,
    getSummary,
    getAlerts,

    // History
    getHistory,
    getUptime,

    // Monitoring
    startMonitoring,
    stopMonitoring,
    get isRunning() { return isRunning; },

    // Control
    init,
    setOnStatusChange: (fn) => { CONFIG.onStatusChange = fn; },

    // Constants
    STATUS,
    CHECK_TYPES,

    // Config
    CONFIG
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HealthCheck;
}
