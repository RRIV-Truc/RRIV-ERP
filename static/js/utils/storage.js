/**
 * Storage Utility Module
 * Wrapper an toàn cho localStorage/sessionStorage với fallback
 * @module storage
 */

const Storage = (function() {
  'use strict';

  // ==================== CONSTANTS ====================
  const PREFIX = 'qtdn_'; // Quản trị doanh nghiệp prefix
  const EXPIRY_SUFFIX = '_expiry';

  // ==================== STORAGE AVAILABILITY ====================

  /**
   * Kiểm tra localStorage có available không
   */
  function isLocalStorageAvailable() {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Kiểm tra sessionStorage có available không
   */
  function isSessionStorageAvailable() {
    try {
      const test = '__storage_test__';
      sessionStorage.setItem(test, test);
      sessionStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  // In-memory fallback
  const memoryStorage = {};

  // ==================== LOCAL STORAGE ====================

  /**
   * Lưu vào localStorage
   * @param {string} key - Key
   * @param {*} value - Value (sẽ được JSON stringify)
   * @param {number} ttl - Time to live in milliseconds (optional)
   */
  function setLocal(key, value, ttl = null) {
    const prefixedKey = PREFIX + key;

    try {
      const serialized = JSON.stringify(value);

      if (isLocalStorageAvailable()) {
        localStorage.setItem(prefixedKey, serialized);

        if (ttl) {
          const expiryTime = Date.now() + ttl;
          localStorage.setItem(prefixedKey + EXPIRY_SUFFIX, expiryTime.toString());
        }
      } else {
        // Fallback to memory
        memoryStorage[prefixedKey] = serialized;
        if (ttl) {
          memoryStorage[prefixedKey + EXPIRY_SUFFIX] = Date.now() + ttl;
        }
      }

      return true;
    } catch (e) {
      console.warn('Storage.setLocal error:', e);
      return false;
    }
  }

  /**
   * Lấy từ localStorage
   * @param {string} key - Key
   * @param {*} defaultValue - Default value nếu không tìm thấy
   * @returns {*} Parsed value hoặc defaultValue
   */
  function getLocal(key, defaultValue = null) {
    const prefixedKey = PREFIX + key;

    try {
      let serialized;
      let expiry;

      if (isLocalStorageAvailable()) {
        serialized = localStorage.getItem(prefixedKey);
        expiry = localStorage.getItem(prefixedKey + EXPIRY_SUFFIX);
      } else {
        serialized = memoryStorage[prefixedKey];
        expiry = memoryStorage[prefixedKey + EXPIRY_SUFFIX];
      }

      if (serialized === null || serialized === undefined) {
        return defaultValue;
      }

      // Check expiry
      if (expiry && Date.now() > parseInt(expiry, 10)) {
        removeLocal(key);
        return defaultValue;
      }

      return JSON.parse(serialized);
    } catch (e) {
      console.warn('Storage.getLocal error:', e);
      return defaultValue;
    }
  }

  /**
   * Xóa từ localStorage
   * @param {string} key - Key
   */
  function removeLocal(key) {
    const prefixedKey = PREFIX + key;

    try {
      if (isLocalStorageAvailable()) {
        localStorage.removeItem(prefixedKey);
        localStorage.removeItem(prefixedKey + EXPIRY_SUFFIX);
      } else {
        delete memoryStorage[prefixedKey];
        delete memoryStorage[prefixedKey + EXPIRY_SUFFIX];
      }
      return true;
    } catch (e) {
      console.warn('Storage.removeLocal error:', e);
      return false;
    }
  }

  // ==================== SESSION STORAGE ====================

  /**
   * Lưu vào sessionStorage
   * @param {string} key - Key
   * @param {*} value - Value
   */
  function setSession(key, value) {
    const prefixedKey = PREFIX + key;

    try {
      const serialized = JSON.stringify(value);

      if (isSessionStorageAvailable()) {
        sessionStorage.setItem(prefixedKey, serialized);
      } else {
        memoryStorage['session_' + prefixedKey] = serialized;
      }

      return true;
    } catch (e) {
      console.warn('Storage.setSession error:', e);
      return false;
    }
  }

  /**
   * Lấy từ sessionStorage
   * @param {string} key - Key
   * @param {*} defaultValue - Default value
   * @returns {*} Parsed value hoặc defaultValue
   */
  function getSession(key, defaultValue = null) {
    const prefixedKey = PREFIX + key;

    try {
      let serialized;

      if (isSessionStorageAvailable()) {
        serialized = sessionStorage.getItem(prefixedKey);
      } else {
        serialized = memoryStorage['session_' + prefixedKey];
      }

      if (serialized === null || serialized === undefined) {
        return defaultValue;
      }

      return JSON.parse(serialized);
    } catch (e) {
      console.warn('Storage.getSession error:', e);
      return defaultValue;
    }
  }

  /**
   * Xóa từ sessionStorage
   * @param {string} key - Key
   */
  function removeSession(key) {
    const prefixedKey = PREFIX + key;

    try {
      if (isSessionStorageAvailable()) {
        sessionStorage.removeItem(prefixedKey);
      } else {
        delete memoryStorage['session_' + prefixedKey];
      }
      return true;
    } catch (e) {
      console.warn('Storage.removeSession error:', e);
      return false;
    }
  }

  // ==================== CLEAR ====================

  /**
   * Xóa tất cả data của app từ localStorage
   */
  function clearLocal() {
    try {
      if (isLocalStorageAvailable()) {
        const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX));
        keys.forEach(k => localStorage.removeItem(k));
      }

      // Clear memory storage too
      Object.keys(memoryStorage).forEach(k => {
        if (k.startsWith(PREFIX) && !k.startsWith('session_')) {
          delete memoryStorage[k];
        }
      });

      return true;
    } catch (e) {
      console.warn('Storage.clearLocal error:', e);
      return false;
    }
  }

  /**
   * Xóa tất cả data của app từ sessionStorage
   */
  function clearSession() {
    try {
      if (isSessionStorageAvailable()) {
        const keys = Object.keys(sessionStorage).filter(k => k.startsWith(PREFIX));
        keys.forEach(k => sessionStorage.removeItem(k));
      }

      // Clear memory storage too
      Object.keys(memoryStorage).forEach(k => {
        if (k.startsWith('session_' + PREFIX)) {
          delete memoryStorage[k];
        }
      });

      return true;
    } catch (e) {
      console.warn('Storage.clearSession error:', e);
      return false;
    }
  }

  /**
   * Xóa tất cả
   */
  function clearAll() {
    clearLocal();
    clearSession();
  }

  // ==================== SPECIFIC HELPERS ====================

  /**
   * Lưu user preferences
   * @param {Object} prefs - Preferences object
   */
  function savePreferences(prefs) {
    const current = getLocal('preferences', {});
    return setLocal('preferences', { ...current, ...prefs });
  }

  /**
   * Lấy user preferences
   * @returns {Object}
   */
  function getPreferences() {
    return getLocal('preferences', {});
  }

  /**
   * Lấy một preference
   * @param {string} key - Preference key
   * @param {*} defaultValue - Default value
   */
  function getPreference(key, defaultValue = null) {
    const prefs = getPreferences();
    return prefs[key] !== undefined ? prefs[key] : defaultValue;
  }

  /**
   * Cache data với TTL
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   * @param {number} ttlMinutes - TTL in minutes
   */
  function cache(key, data, ttlMinutes = 30) {
    return setLocal('cache_' + key, data, ttlMinutes * 60 * 1000);
  }

  /**
   * Lấy cached data
   * @param {string} key - Cache key
   * @returns {*} Cached data hoặc null nếu expired/không có
   */
  function getCached(key) {
    return getLocal('cache_' + key, null);
  }

  /**
   * Xóa cache
   * @param {string} key - Cache key (optional, nếu không truyền sẽ xóa tất cả cache)
   */
  function clearCache(key = null) {
    if (key) {
      return removeLocal('cache_' + key);
    }

    // Clear all cache
    try {
      if (isLocalStorageAvailable()) {
        const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX + 'cache_'));
        keys.forEach(k => localStorage.removeItem(k));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // ==================== RECENT ITEMS ====================

  /**
   * Thêm vào danh sách recent items
   * @param {string} listKey - Key của danh sách
   * @param {*} item - Item cần thêm
   * @param {number} maxItems - Số item tối đa giữ lại
   */
  function addToRecent(listKey, item, maxItems = 10) {
    const recent = getLocal('recent_' + listKey, []);

    // Remove if exists
    const filtered = recent.filter(r => {
      if (typeof r === 'object' && typeof item === 'object') {
        return JSON.stringify(r) !== JSON.stringify(item);
      }
      return r !== item;
    });

    // Add to beginning
    filtered.unshift(item);

    // Keep only max items
    const trimmed = filtered.slice(0, maxItems);

    return setLocal('recent_' + listKey, trimmed);
  }

  /**
   * Lấy danh sách recent items
   * @param {string} listKey - Key của danh sách
   * @returns {Array}
   */
  function getRecent(listKey) {
    return getLocal('recent_' + listKey, []);
  }

  /**
   * Xóa danh sách recent
   * @param {string} listKey - Key của danh sách
   */
  function clearRecent(listKey) {
    return removeLocal('recent_' + listKey);
  }

  // ==================== STORAGE INFO ====================

  /**
   * Lấy thông tin sử dụng storage
   * @returns {Object} { used, quota, percent }
   */
  function getStorageInfo() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().then(estimate => ({
          used: estimate.usage,
          quota: estimate.quota,
          percent: Math.round((estimate.usage / estimate.quota) * 100)
        }));
      }

      // Fallback estimate
      let totalSize = 0;
      if (isLocalStorageAvailable()) {
        for (let key in localStorage) {
          if (localStorage.hasOwnProperty(key)) {
            totalSize += localStorage[key].length * 2; // UTF-16
          }
        }
      }

      return Promise.resolve({
        used: totalSize,
        quota: 5 * 1024 * 1024, // 5MB typical
        percent: Math.round((totalSize / (5 * 1024 * 1024)) * 100)
      });
    } catch (e) {
      return Promise.resolve({ used: 0, quota: 0, percent: 0 });
    }
  }

  // ==================== PUBLIC API ====================
  return {
    // Availability checks
    isLocalStorageAvailable,
    isSessionStorageAvailable,

    // localStorage
    setLocal,
    getLocal,
    removeLocal,
    clearLocal,

    // sessionStorage
    setSession,
    getSession,
    removeSession,
    clearSession,

    // Clear all
    clearAll,

    // Preferences
    savePreferences,
    getPreferences,
    getPreference,

    // Cache
    cache,
    getCached,
    clearCache,

    // Recent items
    addToRecent,
    getRecent,
    clearRecent,

    // Info
    getStorageInfo
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Storage;
}
