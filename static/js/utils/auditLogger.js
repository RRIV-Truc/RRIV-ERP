/**
 * Audit Logger Module
 * Ghi log hoạt động user cho compliance và security
 * @module auditLogger
 */

const AuditLogger = (function() {
  'use strict';

  // ==================== CONFIG ====================
  const CONFIG = {
    maxLocalLogs: 1000,        // Max logs lưu local
    batchSize: 50,             // Batch size khi sync
    syncInterval: 300000,      // Sync interval (5 phút)
    storageKey: 'qtdn_audit_logs',
    pendingKey: 'qtdn_audit_pending',
    enabled: true,
    logToConsole: false,       // Debug mode
    sensitiveFields: ['password', 'token', 'secret', 'key', 'otp']
  };

  // ==================== LOG TYPES ====================
  const LOG_TYPES = {
    // Authentication
    LOGIN_SUCCESS: 'auth.login.success',
    LOGIN_FAILED: 'auth.login.failed',
    LOGOUT: 'auth.logout',
    PASSWORD_CHANGE: 'auth.password.change',
    PASSWORD_RESET: 'auth.password.reset',
    SESSION_EXPIRED: 'auth.session.expired',
    MFA_ENABLED: 'auth.mfa.enabled',
    MFA_VERIFIED: 'auth.mfa.verified',

    // Data Access
    DATA_VIEW: 'data.view',
    DATA_CREATE: 'data.create',
    DATA_UPDATE: 'data.update',
    DATA_DELETE: 'data.delete',
    DATA_EXPORT: 'data.export',
    DATA_IMPORT: 'data.import',

    // User Actions
    USER_CREATE: 'user.create',
    USER_UPDATE: 'user.update',
    USER_DELETE: 'user.delete',
    USER_ROLE_CHANGE: 'user.role.change',
    USER_STATUS_CHANGE: 'user.status.change',

    // System
    SETTINGS_CHANGE: 'system.settings.change',
    PERMISSION_CHANGE: 'system.permission.change',
    BACKUP_CREATE: 'system.backup.create',
    BACKUP_RESTORE: 'system.backup.restore',

    // Security
    SECURITY_ALERT: 'security.alert',
    RATE_LIMIT_EXCEEDED: 'security.rate_limit',
    SUSPICIOUS_ACTIVITY: 'security.suspicious',
    ACCESS_DENIED: 'security.access_denied',

    // Navigation
    PAGE_VIEW: 'nav.page_view',
    TAB_CHANGE: 'nav.tab_change',

    // Custom
    CUSTOM: 'custom'
  };

  // ==================== SEVERITY LEVELS ====================
  const SEVERITY = {
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical'
  };

  // ==================== STATE ====================
  let logs = [];
  let pendingSync = [];
  let syncTimer = null;
  let userId = null;
  let sessionId = null;

  // ==================== CORE LOGGING ====================

  /**
   * Log an audit event
   * @param {string} type - Log type from LOG_TYPES
   * @param {Object} data - Event data
   * @param {Object} options - Options
   */
  function log(type, data = {}, options = {}) {
    if (!CONFIG.enabled) return null;

    const {
      severity = SEVERITY.INFO,
      userId: overrideUserId = null,
      metadata = {}
    } = options;

    // Sanitize sensitive data
    const sanitizedData = sanitizeData(data);

    const entry = {
      id: generateLogId(),
      type,
      severity,
      timestamp: Date.now(),
      isoTime: new Date().toISOString(),
      userId: overrideUserId || userId || 'anonymous',
      sessionId: sessionId || null,
      data: sanitizedData,
      metadata: {
        ...metadata,
        url: window.location.href,
        userAgent: navigator.userAgent,
        screenSize: `${screen.width}x${screen.height}`,
        language: navigator.language
      }
    };

    // Add device info if available
    if (typeof SessionManager !== 'undefined') {
      entry.metadata.deviceId = SessionManager.deviceId;
    }

    // Store locally
    storeLog(entry);

    // Add to pending sync
    pendingSync.push(entry);

    // Console log in debug mode
    if (CONFIG.logToConsole) {
      const color = getLogColor(severity);
      console.log(
        `%c[Audit] ${type}`,
        `color: ${color}; font-weight: bold`,
        sanitizedData
      );
    }

    return entry;
  }

  /**
   * Generate unique log ID
   */
  function generateLogId() {
    return 'log_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Get console color based on severity
   */
  function getLogColor(severity) {
    switch (severity) {
      case SEVERITY.CRITICAL: return '#dc3545';
      case SEVERITY.ERROR: return '#fd7e14';
      case SEVERITY.WARNING: return '#ffc107';
      default: return '#17a2b8';
    }
  }

  /**
   * Sanitize sensitive data
   */
  function sanitizeData(data) {
    if (!data || typeof data !== 'object') return data;

    const sanitized = Array.isArray(data) ? [...data] : { ...data };

    for (const key in sanitized) {
      if (CONFIG.sensitiveFields.some(f => key.toLowerCase().includes(f))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object') {
        sanitized[key] = sanitizeData(sanitized[key]);
      }
    }

    return sanitized;
  }

  // ==================== CONVENIENCE METHODS ====================

  // Authentication logs
  function logLogin(username, success, details = {}) {
    return log(
      success ? LOG_TYPES.LOGIN_SUCCESS : LOG_TYPES.LOGIN_FAILED,
      { username, ...details },
      { severity: success ? SEVERITY.INFO : SEVERITY.WARNING }
    );
  }

  function logLogout(reason = 'user_initiated') {
    return log(LOG_TYPES.LOGOUT, { reason });
  }

  function logPasswordChange(targetUserId) {
    return log(LOG_TYPES.PASSWORD_CHANGE, { targetUserId }, { severity: SEVERITY.WARNING });
  }

  // Data access logs
  function logDataView(collection, recordId, details = {}) {
    return log(LOG_TYPES.DATA_VIEW, { collection, recordId, ...details });
  }

  function logDataCreate(collection, recordId, details = {}) {
    return log(LOG_TYPES.DATA_CREATE, { collection, recordId, ...details });
  }

  function logDataUpdate(collection, recordId, changes = {}) {
    return log(LOG_TYPES.DATA_UPDATE, { collection, recordId, changes });
  }

  function logDataDelete(collection, recordId, details = {}) {
    return log(LOG_TYPES.DATA_DELETE, { collection, recordId, ...details }, { severity: SEVERITY.WARNING });
  }

  function logDataExport(collection, format, recordCount) {
    return log(LOG_TYPES.DATA_EXPORT, { collection, format, recordCount });
  }

  // Security logs
  function logSecurityAlert(alertType, details = {}) {
    return log(LOG_TYPES.SECURITY_ALERT, { alertType, ...details }, { severity: SEVERITY.CRITICAL });
  }

  function logAccessDenied(resource, action, reason) {
    return log(LOG_TYPES.ACCESS_DENIED, { resource, action, reason }, { severity: SEVERITY.WARNING });
  }

  // User management logs
  function logUserCreate(newUserId, details = {}) {
    return log(LOG_TYPES.USER_CREATE, { newUserId, ...details });
  }

  function logUserUpdate(targetUserId, changes = {}) {
    return log(LOG_TYPES.USER_UPDATE, { targetUserId, changes });
  }

  function logUserDelete(targetUserId) {
    return log(LOG_TYPES.USER_DELETE, { targetUserId }, { severity: SEVERITY.WARNING });
  }

  function logRoleChange(targetUserId, oldRole, newRole) {
    return log(LOG_TYPES.USER_ROLE_CHANGE, { targetUserId, oldRole, newRole }, { severity: SEVERITY.WARNING });
  }

  // Navigation logs
  function logPageView(page, details = {}) {
    return log(LOG_TYPES.PAGE_VIEW, { page, ...details });
  }

  function logTabChange(from, to) {
    return log(LOG_TYPES.TAB_CHANGE, { from, to });
  }

  // ==================== STORAGE ====================

  function storeLog(entry) {
    logs.push(entry);

    // Trim if exceeds max
    if (logs.length > CONFIG.maxLocalLogs) {
      logs = logs.slice(-CONFIG.maxLocalLogs);
    }

    // Save to localStorage
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(logs.slice(-500)));
    } catch (e) {
      // Storage full - clear old logs
      logs = logs.slice(-100);
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(logs));
    }
  }

  function loadLogs() {
    try {
      const stored = localStorage.getItem(CONFIG.storageKey);
      if (stored) {
        logs = JSON.parse(stored);
      }

      const pending = localStorage.getItem(CONFIG.pendingKey);
      if (pending) {
        pendingSync = JSON.parse(pending);
      }
    } catch (e) {
      console.error('[AuditLogger] Failed to load logs:', e);
    }
  }

  // ==================== SYNC ====================

  /**
   * Sync logs to server
   */
  async function sync() {
    if (pendingSync.length === 0) return { synced: 0 };

    const toSync = pendingSync.splice(0, CONFIG.batchSize);

    try {
      // Sync to Firestore if available
      if (typeof ErpDb !== 'undefined' && ErpDb.firestore) {
        const db = ErpDb.firestore();
        const batch = db.batch();

        toSync.forEach(entry => {
          const ref = db.collection('auditLogs').doc(entry.id);
          batch.set(ref, {
            ...entry,
            syncedAt: ErpDb.firestore.FieldValue.serverTimestamp()
          });
        });

        await batch.commit();
        console.log(`[AuditLogger] Synced ${toSync.length} logs`);
      }

      // Clear pending storage
      localStorage.setItem(CONFIG.pendingKey, JSON.stringify(pendingSync));

      return { synced: toSync.length, pending: pendingSync.length };
    } catch (error) {
      // Put back failed logs
      pendingSync.unshift(...toSync);
      console.error('[AuditLogger] Sync failed:', error);
      return { synced: 0, error: error.message };
    }
  }

  /**
   * Start auto sync
   */
  function startAutoSync() {
    if (syncTimer) return;

    syncTimer = setInterval(() => {
      if (pendingSync.length > 0) {
        sync();
      }
    }, CONFIG.syncInterval);
  }

  /**
   * Stop auto sync
   */
  function stopAutoSync() {
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
  }

  // ==================== QUERY ====================

  /**
   * Get logs with filters
   * @param {Object} filters - Filter options
   */
  function getLogs(filters = {}) {
    const {
      type = null,
      severity = null,
      userId: filterUserId = null,
      startTime = null,
      endTime = null,
      limit = 100,
      offset = 0
    } = filters;

    let result = [...logs];

    // Apply filters
    if (type) {
      result = result.filter(l => l.type === type || l.type.startsWith(type + '.'));
    }

    if (severity) {
      result = result.filter(l => l.severity === severity);
    }

    if (filterUserId) {
      result = result.filter(l => l.userId === filterUserId);
    }

    if (startTime) {
      result = result.filter(l => l.timestamp >= startTime);
    }

    if (endTime) {
      result = result.filter(l => l.timestamp <= endTime);
    }

    // Sort by timestamp desc
    result.sort((a, b) => b.timestamp - a.timestamp);

    // Apply pagination
    return {
      total: result.length,
      logs: result.slice(offset, offset + limit)
    };
  }

  /**
   * Get logs by type category
   */
  function getLogsByCategory(category) {
    return getLogs({ type: category });
  }

  /**
   * Get security-related logs
   */
  function getSecurityLogs(limit = 50) {
    return getLogs({ type: 'security', limit });
  }

  /**
   * Get user activity summary
   */
  function getUserActivitySummary(targetUserId, days = 7) {
    const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const userLogs = logs.filter(l =>
      l.userId === targetUserId && l.timestamp >= startTime
    );

    const summary = {
      userId: targetUserId,
      period: `${days} days`,
      totalActions: userLogs.length,
      byType: {},
      bySeverity: {},
      lastActivity: null
    };

    userLogs.forEach(log => {
      // Count by type
      const baseType = log.type.split('.')[0];
      summary.byType[baseType] = (summary.byType[baseType] || 0) + 1;

      // Count by severity
      summary.bySeverity[log.severity] = (summary.bySeverity[log.severity] || 0) + 1;

      // Track last activity
      if (!summary.lastActivity || log.timestamp > summary.lastActivity.timestamp) {
        summary.lastActivity = log;
      }
    });

    return summary;
  }

  // ==================== EXPORT ====================

  /**
   * Export logs to JSON
   */
  function exportToJSON(filters = {}) {
    const { logs: data } = getLogs({ ...filters, limit: 10000 });
    return JSON.stringify(data, null, 2);
  }

  /**
   * Export logs to CSV
   */
  function exportToCSV(filters = {}) {
    const { logs: data } = getLogs({ ...filters, limit: 10000 });

    const headers = ['ID', 'Type', 'Severity', 'Timestamp', 'User ID', 'Data', 'URL'];
    const rows = data.map(log => [
      log.id,
      log.type,
      log.severity,
      log.isoTime,
      log.userId,
      JSON.stringify(log.data),
      log.metadata?.url || ''
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    return csv;
  }

  // ==================== CONTEXT ====================

  /**
   * Set current user context
   */
  function setUser(id) {
    userId = id;
  }

  /**
   * Set current session context
   */
  function setSession(id) {
    sessionId = id;
  }

  /**
   * Clear context
   */
  function clearContext() {
    userId = null;
    sessionId = null;
  }

  // ==================== STATISTICS ====================

  /**
   * Get audit statistics
   */
  function getStats() {
    const now = Date.now();
    const today = now - (now % (24 * 60 * 60 * 1000));
    const week = now - (7 * 24 * 60 * 60 * 1000);

    return {
      total: logs.length,
      pendingSync: pendingSync.length,
      today: logs.filter(l => l.timestamp >= today).length,
      thisWeek: logs.filter(l => l.timestamp >= week).length,
      bySeverity: {
        info: logs.filter(l => l.severity === SEVERITY.INFO).length,
        warning: logs.filter(l => l.severity === SEVERITY.WARNING).length,
        error: logs.filter(l => l.severity === SEVERITY.ERROR).length,
        critical: logs.filter(l => l.severity === SEVERITY.CRITICAL).length
      },
      securityAlerts: logs.filter(l => l.type.startsWith('security.')).length
    };
  }

  // ==================== INITIALIZATION ====================

  // Load stored logs on init
  loadLogs();

  // Start auto sync
  if (typeof window !== 'undefined') {
    startAutoSync();

    // Sync before page unload
    window.addEventListener('beforeunload', () => {
      localStorage.setItem(CONFIG.pendingKey, JSON.stringify(pendingSync));
    });
  }

  // ==================== PUBLIC API ====================
  return {
    // Core
    log,

    // Convenience methods
    logLogin,
    logLogout,
    logPasswordChange,
    logDataView,
    logDataCreate,
    logDataUpdate,
    logDataDelete,
    logDataExport,
    logSecurityAlert,
    logAccessDenied,
    logUserCreate,
    logUserUpdate,
    logUserDelete,
    logRoleChange,
    logPageView,
    logTabChange,

    // Query
    getLogs,
    getLogsByCategory,
    getSecurityLogs,
    getUserActivitySummary,
    getStats,

    // Export
    exportToJSON,
    exportToCSV,

    // Sync
    sync,
    startAutoSync,
    stopAutoSync,

    // Context
    setUser,
    setSession,
    clearContext,

    // Config
    enable: () => { CONFIG.enabled = true; },
    disable: () => { CONFIG.enabled = false; },
    setDebug: (value) => { CONFIG.logToConsole = value; },

    // Constants
    TYPES: LOG_TYPES,
    SEVERITY
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuditLogger;
}
