/**
 * Session Manager Module
 * Quản lý sessions với timeout, multiple devices, security
 * @module sessionManager
 */

const SessionManager = (function() {
  'use strict';

  // ==================== CONFIG ====================
  const CONFIG = {
    sessionTimeout: 30 * 60 * 1000,    // 30 phút inactivity timeout
    absoluteTimeout: 8 * 60 * 60 * 1000, // 8 giờ absolute timeout
    warningBefore: 5 * 60 * 1000,      // Warning 5 phút trước khi hết hạn
    maxDevices: 3,                      // Max concurrent devices
    checkInterval: 60000,               // Check interval (1 phút)
    storageKey: 'qtdn_session',
    deviceKey: 'qtdn_device_id',
    activityEvents: ['mousedown', 'keydown', 'touchstart', 'scroll']
  };

  // ==================== STATE ====================
  let currentSession = null;
  let lastActivity = Date.now();
  let checkTimer = null;
  let warningShown = false;
  let onSessionExpire = null;
  let onSessionWarning = null;

  // ==================== DEVICE FINGERPRINT ====================

  /**
   * Generate device fingerprint
   */
  function generateDeviceId() {
    // Check existing device ID
    let deviceId = localStorage.getItem(CONFIG.deviceKey);
    if (deviceId) return deviceId;

    // Generate new device ID based on browser fingerprint
    const fingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || 'unknown',
      navigator.platform
    ].join('|');

    // Simple hash
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    deviceId = 'dev_' + Math.abs(hash).toString(36) + '_' + Date.now().toString(36);
    localStorage.setItem(CONFIG.deviceKey, deviceId);

    return deviceId;
  }

  /**
   * Get device info
   */
  function getDeviceInfo() {
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    let os = 'Unknown';

    // Detect browser
    if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari')) browser = 'Safari';
    else if (ua.includes('Edge')) browser = 'Edge';
    else if (ua.includes('MSIE') || ua.includes('Trident')) browser = 'IE';

    // Detect OS
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    return {
      id: generateDeviceId(),
      browser,
      os,
      userAgent: ua,
      screenSize: `${screen.width}x${screen.height}`,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
  }

  // ==================== SESSION OPERATIONS ====================

  /**
   * Create new session
   * @param {Object} user - User data
   * @param {Object} options - Options
   */
  function create(user, options = {}) {
    const now = Date.now();
    const device = getDeviceInfo();

    const session = {
      id: generateSessionId(),
      userId: user.id || user.uid,
      username: user.username || user.email,
      role: user.role || 'user',
      device,
      createdAt: now,
      lastActivity: now,
      expiresAt: now + CONFIG.absoluteTimeout,
      rememberMe: options.rememberMe || false,
      metadata: options.metadata || {}
    };

    currentSession = session;
    lastActivity = now;
    warningShown = false;

    // Save to storage
    saveSession(session);

    // Start activity tracking
    startActivityTracking();

    // Start expiration check
    startExpirationCheck();

    console.log('[SessionManager] Session created:', session.id);

    return session;
  }

  /**
   * Generate unique session ID
   */
  function generateSessionId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `sess_${timestamp}_${random}`;
  }

  /**
   * Save session to storage
   */
  function saveSession(session) {
    try {
      const data = {
        ...session,
        savedAt: Date.now()
      };

      if (session.rememberMe) {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
      } else {
        sessionStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
      }
    } catch (e) {
      console.error('[SessionManager] Failed to save session:', e);
    }
  }

  /**
   * Load session from storage
   */
  function loadSession() {
    try {
      // Try sessionStorage first
      let data = sessionStorage.getItem(CONFIG.storageKey);
      if (!data) {
        data = localStorage.getItem(CONFIG.storageKey);
      }

      if (!data) return null;

      const session = JSON.parse(data);

      // Validate session
      if (!isValid(session)) {
        destroy();
        return null;
      }

      return session;
    } catch (e) {
      console.error('[SessionManager] Failed to load session:', e);
      return null;
    }
  }

  /**
   * Restore session on page load
   */
  function restore() {
    const session = loadSession();

    if (session) {
      currentSession = session;
      lastActivity = session.lastActivity || Date.now();

      // Start tracking
      startActivityTracking();
      startExpirationCheck();

      console.log('[SessionManager] Session restored:', session.id);
      return session;
    }

    return null;
  }

  /**
   * Check if session is valid
   */
  function isValid(session = currentSession) {
    if (!session) return false;

    const now = Date.now();

    // Check absolute timeout
    if (now > session.expiresAt) {
      console.log('[SessionManager] Session expired (absolute timeout)');
      return false;
    }

    // Check inactivity timeout
    const inactiveTime = now - (session.lastActivity || session.createdAt);
    if (inactiveTime > CONFIG.sessionTimeout) {
      console.log('[SessionManager] Session expired (inactivity)');
      return false;
    }

    return true;
  }

  /**
   * Update session activity
   */
  function touch() {
    if (!currentSession) return;

    const now = Date.now();
    lastActivity = now;
    currentSession.lastActivity = now;
    warningShown = false;

    saveSession(currentSession);
  }

  /**
   * Extend session
   */
  function extend(additionalTime = CONFIG.absoluteTimeout) {
    if (!currentSession) return false;

    const now = Date.now();
    currentSession.expiresAt = now + additionalTime;
    currentSession.lastActivity = now;
    lastActivity = now;
    warningShown = false;

    saveSession(currentSession);

    console.log('[SessionManager] Session extended');
    return true;
  }

  /**
   * Destroy session
   */
  function destroy() {
    if (currentSession) {
      console.log('[SessionManager] Session destroyed:', currentSession.id);
    }

    currentSession = null;
    lastActivity = 0;
    warningShown = false;

    // Clear storage
    sessionStorage.removeItem(CONFIG.storageKey);
    localStorage.removeItem(CONFIG.storageKey);

    // Stop tracking
    stopActivityTracking();
    stopExpirationCheck();
  }

  // ==================== ACTIVITY TRACKING ====================

  let activityHandler = null;

  function startActivityTracking() {
    if (activityHandler) return;

    activityHandler = debounce(() => {
      touch();
    }, 1000);

    CONFIG.activityEvents.forEach(event => {
      document.addEventListener(event, activityHandler, { passive: true });
    });
  }

  function stopActivityTracking() {
    if (!activityHandler) return;

    CONFIG.activityEvents.forEach(event => {
      document.removeEventListener(event, activityHandler);
    });

    activityHandler = null;
  }

  // ==================== EXPIRATION CHECK ====================

  function startExpirationCheck() {
    if (checkTimer) return;

    checkTimer = setInterval(() => {
      checkExpiration();
    }, CONFIG.checkInterval);

    // Also check immediately
    checkExpiration();
  }

  function stopExpirationCheck() {
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
  }

  function checkExpiration() {
    if (!currentSession) return;

    const now = Date.now();
    const timeUntilExpiry = Math.min(
      currentSession.expiresAt - now,
      CONFIG.sessionTimeout - (now - lastActivity)
    );

    // Session expired
    if (timeUntilExpiry <= 0) {
      handleExpiration();
      return;
    }

    // Show warning
    if (timeUntilExpiry <= CONFIG.warningBefore && !warningShown) {
      warningShown = true;
      handleWarning(timeUntilExpiry);
    }
  }

  function handleExpiration() {
    const session = currentSession;
    destroy();

    if (onSessionExpire) {
      onSessionExpire(session);
    } else {
      // Default behavior
      if (typeof Notification !== 'undefined') {
        Notification.warning('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.');
      }
    }
  }

  function handleWarning(timeRemaining) {
    const minutes = Math.ceil(timeRemaining / 60000);

    if (onSessionWarning) {
      onSessionWarning(timeRemaining);
    } else {
      // Default behavior
      if (typeof UI !== 'undefined' && UI.confirm) {
        UI.confirm(
          `Phiên làm việc sẽ hết hạn sau ${minutes} phút. Bạn có muốn gia hạn không?`,
          () => {
            extend();
            if (typeof Notification !== 'undefined') {
              Notification.success('Đã gia hạn phiên làm việc');
            }
          }
        );
      }
    }
  }

  // ==================== MULTI-DEVICE MANAGEMENT ====================

  /**
   * Get all active sessions for user (requires server)
   */
  async function getActiveSessions(userId) {
    // This would typically call a server endpoint
    // For now, return current session info
    if (!currentSession || currentSession.userId !== userId) {
      return [];
    }

    return [{
      ...currentSession,
      current: true
    }];
  }

  /**
   * Terminate session on another device
   */
  async function terminateSession(sessionId) {
    if (currentSession && currentSession.id === sessionId) {
      destroy();
      return true;
    }

    // Would typically call server to terminate other sessions
    console.log('[SessionManager] Request to terminate session:', sessionId);
    return false;
  }

  /**
   * Terminate all other sessions
   */
  async function terminateOtherSessions() {
    // Would typically call server
    console.log('[SessionManager] Request to terminate all other sessions');
    return true;
  }

  // ==================== SECURITY ====================

  /**
   * Validate session integrity
   */
  function validateIntegrity() {
    if (!currentSession) return false;

    const device = getDeviceInfo();

    // Check device fingerprint
    if (currentSession.device.id !== device.id) {
      console.warn('[SessionManager] Device mismatch detected');
      return false;
    }

    return true;
  }

  /**
   * Get session security info
   */
  function getSecurityInfo() {
    if (!currentSession) return null;

    const now = Date.now();
    const sessionAge = now - currentSession.createdAt;
    const inactiveTime = now - lastActivity;

    return {
      sessionId: currentSession.id,
      userId: currentSession.userId,
      device: currentSession.device,
      createdAt: new Date(currentSession.createdAt).toISOString(),
      lastActivity: new Date(lastActivity).toISOString(),
      expiresAt: new Date(currentSession.expiresAt).toISOString(),
      sessionAge: formatDuration(sessionAge),
      inactiveTime: formatDuration(inactiveTime),
      timeUntilTimeout: formatDuration(CONFIG.sessionTimeout - inactiveTime),
      timeUntilAbsoluteExpiry: formatDuration(currentSession.expiresAt - now),
      isValid: isValid()
    };
  }

  // ==================== UTILITIES ====================

  function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function formatDuration(ms) {
    if (ms < 0) return 'Expired';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  // ==================== EVENT HANDLERS ====================

  /**
   * Set session expiration handler
   */
  function onExpire(callback) {
    onSessionExpire = callback;
  }

  /**
   * Set session warning handler
   */
  function onWarning(callback) {
    onSessionWarning = callback;
  }

  // ==================== INITIALIZATION ====================

  // Handle page visibility change
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Check session when page becomes visible
        if (currentSession && !isValid()) {
          handleExpiration();
        }
      }
    });

    // Handle before unload
    window.addEventListener('beforeunload', () => {
      if (currentSession) {
        touch(); // Save last activity
      }
    });
  }

  // ==================== PUBLIC API ====================
  return {
    // Core operations
    create,
    restore,
    destroy,
    touch,
    extend,

    // Validation
    isValid,
    validateIntegrity,

    // Getters
    get current() { return currentSession; },
    get isActive() { return currentSession !== null && isValid(); },
    getSecurityInfo,

    // Multi-device
    getActiveSessions,
    terminateSession,
    terminateOtherSessions,

    // Device
    getDeviceInfo,
    get deviceId() { return generateDeviceId(); },

    // Event handlers
    onExpire,
    onWarning,

    // Config
    CONFIG
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SessionManager;
}
