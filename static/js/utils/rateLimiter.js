/**
 * Rate Limiter Module
 * Giới hạn requests để chống spam và DDoS
 * @module rateLimiter
 */

const RateLimiter = (function() {
  'use strict';

  // ==================== CONFIG ====================
  const DEFAULT_CONFIG = {
    maxRequests: 100,      // Max requests trong window
    windowMs: 60000,       // Window time (1 phút)
    blockDuration: 300000, // Block duration khi vượt limit (5 phút)
    keyGenerator: null,    // Custom key generator
    onLimitReached: null,  // Callback khi đạt limit
    whitelist: [],         // Keys được bypass
    skipFailedRequests: false,
    skipSuccessfulRequests: false
  };

  // ==================== STATE ====================
  const limiters = new Map();
  const blockedKeys = new Map();
  const requestLogs = new Map();

  // ==================== CORE LIMITER ====================

  /**
   * Tạo rate limiter instance
   * @param {string} name - Tên limiter
   * @param {Object} config - Cấu hình
   * @returns {Object} Limiter instance
   */
  function create(name, config = {}) {
    const settings = { ...DEFAULT_CONFIG, ...config };

    const limiter = {
      name,
      settings,
      requests: new Map(),

      /**
       * Kiểm tra và consume một request
       * @param {string} key - Key để track (user ID, IP, etc.)
       * @returns {Object} { allowed, remaining, resetTime, retryAfter }
       */
      check(key) {
        // Check whitelist
        if (settings.whitelist.includes(key)) {
          return { allowed: true, remaining: Infinity, resetTime: 0 };
        }

        // Check if blocked
        if (blockedKeys.has(`${name}:${key}`)) {
          const blockInfo = blockedKeys.get(`${name}:${key}`);
          if (Date.now() < blockInfo.until) {
            return {
              allowed: false,
              remaining: 0,
              resetTime: blockInfo.until,
              retryAfter: Math.ceil((blockInfo.until - Date.now()) / 1000),
              blocked: true
            };
          }
          blockedKeys.delete(`${name}:${key}`);
        }

        const now = Date.now();
        const windowStart = now - settings.windowMs;

        // Get or create request record
        if (!this.requests.has(key)) {
          this.requests.set(key, []);
        }

        const requests = this.requests.get(key);

        // Remove old requests outside window
        const validRequests = requests.filter(time => time > windowStart);
        this.requests.set(key, validRequests);

        // Check limit
        if (validRequests.length >= settings.maxRequests) {
          // Block the key
          blockedKeys.set(`${name}:${key}`, {
            until: now + settings.blockDuration,
            reason: 'rate_limit_exceeded'
          });

          // Callback
          if (settings.onLimitReached) {
            settings.onLimitReached(key, {
              limiter: name,
              requests: validRequests.length,
              limit: settings.maxRequests
            });
          }

          // Log
          logRateLimitEvent(name, key, 'blocked');

          return {
            allowed: false,
            remaining: 0,
            resetTime: now + settings.blockDuration,
            retryAfter: Math.ceil(settings.blockDuration / 1000),
            blocked: true
          };
        }

        // Allow request
        validRequests.push(now);
        this.requests.set(key, validRequests);

        return {
          allowed: true,
          remaining: settings.maxRequests - validRequests.length,
          resetTime: validRequests[0] + settings.windowMs
        };
      },

      /**
       * Consume request (alias for check)
       */
      consume(key) {
        return this.check(key);
      },

      /**
       * Reset limiter cho một key
       */
      reset(key) {
        this.requests.delete(key);
        blockedKeys.delete(`${name}:${key}`);
      },

      /**
       * Get current status cho một key
       */
      getStatus(key) {
        const now = Date.now();
        const windowStart = now - settings.windowMs;
        const requests = this.requests.get(key) || [];
        const validRequests = requests.filter(time => time > windowStart);

        return {
          key,
          requests: validRequests.length,
          limit: settings.maxRequests,
          remaining: Math.max(0, settings.maxRequests - validRequests.length),
          blocked: blockedKeys.has(`${name}:${key}`)
        };
      },

      /**
       * Clear all data
       */
      clear() {
        this.requests.clear();
        // Clear blocked keys for this limiter
        for (const key of blockedKeys.keys()) {
          if (key.startsWith(`${name}:`)) {
            blockedKeys.delete(key);
          }
        }
      }
    };

    limiters.set(name, limiter);
    return limiter;
  }

  /**
   * Get existing limiter
   */
  function get(name) {
    return limiters.get(name);
  }

  // ==================== PREDEFINED LIMITERS ====================

  // API calls limiter
  const apiLimiter = create('api', {
    maxRequests: 100,
    windowMs: 60000,
    blockDuration: 300000,
    onLimitReached: (key) => {
      console.warn(`[RateLimiter] API limit reached for: ${key}`);
    }
  });

  // Login attempts limiter
  const loginLimiter = create('login', {
    maxRequests: 5,
    windowMs: 300000,      // 5 phút
    blockDuration: 900000, // Block 15 phút
    onLimitReached: (key) => {
      console.warn(`[RateLimiter] Login attempts exceeded for: ${key}`);
      if (typeof Notification !== 'undefined') {
        Notification.error('Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 15 phút.');
      }
    }
  });

  // Form submission limiter
  const formLimiter = create('form', {
    maxRequests: 10,
    windowMs: 60000,
    blockDuration: 120000,
    onLimitReached: (key) => {
      console.warn(`[RateLimiter] Form submission limit reached for: ${key}`);
    }
  });

  // Export limiter
  const exportLimiter = create('export', {
    maxRequests: 5,
    windowMs: 300000,
    blockDuration: 600000,
    onLimitReached: (key) => {
      console.warn(`[RateLimiter] Export limit reached for: ${key}`);
      if (typeof Notification !== 'undefined') {
        Notification.warning('Bạn đã xuất quá nhiều báo cáo. Vui lòng đợi 10 phút.');
      }
    }
  });

  // ==================== MIDDLEWARE ====================

  /**
   * Tạo middleware wrapper cho function
   * @param {Function} fn - Function cần wrap
   * @param {string} limiterName - Tên limiter
   * @param {string|Function} keyFn - Key hoặc function tạo key
   */
  function withRateLimit(fn, limiterName, keyFn = 'default') {
    const limiter = limiters.get(limiterName);
    if (!limiter) {
      console.warn(`[RateLimiter] Limiter not found: ${limiterName}`);
      return fn;
    }

    return async function(...args) {
      const key = typeof keyFn === 'function' ? keyFn(...args) : keyFn;
      const result = limiter.check(key);

      if (!result.allowed) {
        const error = new Error('Rate limit exceeded');
        error.code = 'RATE_LIMIT_EXCEEDED';
        error.retryAfter = result.retryAfter;
        throw error;
      }

      return fn.apply(this, args);
    };
  }

  /**
   * Decorator style rate limit
   */
  function rateLimit(limiterName, keyFn) {
    return function(target, propertyKey, descriptor) {
      const originalMethod = descriptor.value;
      descriptor.value = withRateLimit(originalMethod, limiterName, keyFn);
      return descriptor;
    };
  }

  // ==================== LOGGING ====================

  function logRateLimitEvent(limiter, key, action) {
    const log = {
      timestamp: Date.now(),
      limiter,
      key,
      action
    };

    if (!requestLogs.has(limiter)) {
      requestLogs.set(limiter, []);
    }

    const logs = requestLogs.get(limiter);
    logs.push(log);

    // Keep only last 1000 entries
    if (logs.length > 1000) {
      logs.shift();
    }
  }

  /**
   * Get rate limit logs
   */
  function getLogs(limiterName = null, options = {}) {
    const { limit = 100, action = null } = options;

    let logs = [];

    if (limiterName) {
      logs = requestLogs.get(limiterName) || [];
    } else {
      for (const [, limiterLogs] of requestLogs) {
        logs = logs.concat(limiterLogs);
      }
    }

    // Filter by action
    if (action) {
      logs = logs.filter(log => log.action === action);
    }

    // Sort by timestamp desc
    logs.sort((a, b) => b.timestamp - a.timestamp);

    return logs.slice(0, limit);
  }

  // ==================== UTILITIES ====================

  /**
   * Unblock a key manually
   */
  function unblock(limiterName, key) {
    blockedKeys.delete(`${limiterName}:${key}`);
    const limiter = limiters.get(limiterName);
    if (limiter) {
      limiter.reset(key);
    }
  }

  /**
   * Check if key is blocked
   */
  function isBlocked(limiterName, key) {
    const blockInfo = blockedKeys.get(`${limiterName}:${key}`);
    if (!blockInfo) return false;
    if (Date.now() >= blockInfo.until) {
      blockedKeys.delete(`${limiterName}:${key}`);
      return false;
    }
    return true;
  }

  /**
   * Get all blocked keys
   */
  function getBlockedKeys() {
    const result = [];
    const now = Date.now();

    for (const [key, info] of blockedKeys) {
      if (info.until > now) {
        const [limiter, userKey] = key.split(':');
        result.push({
          limiter,
          key: userKey,
          until: info.until,
          remainingSeconds: Math.ceil((info.until - now) / 1000),
          reason: info.reason
        });
      }
    }

    return result;
  }

  /**
   * Get statistics
   */
  function getStats() {
    const stats = {};

    for (const [name, limiter] of limiters) {
      let totalRequests = 0;
      let activeKeys = 0;

      for (const [, requests] of limiter.requests) {
        const now = Date.now();
        const windowStart = now - limiter.settings.windowMs;
        const validRequests = requests.filter(time => time > windowStart);
        if (validRequests.length > 0) {
          totalRequests += validRequests.length;
          activeKeys++;
        }
      }

      stats[name] = {
        maxRequests: limiter.settings.maxRequests,
        windowMs: limiter.settings.windowMs,
        totalRequests,
        activeKeys,
        blockedKeys: getBlockedKeys().filter(b => b.limiter === name).length
      };
    }

    return stats;
  }

  // ==================== CLEANUP ====================

  // Cleanup expired blocks periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, info] of blockedKeys) {
      if (info.until <= now) {
        blockedKeys.delete(key);
      }
    }
  }, 60000);

  // ==================== PUBLIC API ====================
  return {
    // Core
    create,
    get,

    // Predefined limiters
    api: apiLimiter,
    login: loginLimiter,
    form: formLimiter,
    export: exportLimiter,

    // Middleware
    withRateLimit,
    rateLimit,

    // Utilities
    unblock,
    isBlocked,
    getBlockedKeys,
    getStats,
    getLogs,

    // Constants
    DEFAULT_CONFIG
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RateLimiter;
}
