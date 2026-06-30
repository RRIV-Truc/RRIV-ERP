/**
 * CRUDService - Reusable CRUD Pattern with localStorage Caching
 * Thay thế 12+ pattern load/save/delete trùng lặp trong các app-*.html
 *
 * Trước: Mỗi entity (gardens, deliveries, batches...) copy-paste 30+ dòng code
 * Sau: 1 dòng - CRUDService.load('rubberGardens', { factory: true })
 *
 * @module CRUDService
 * @requires FirestoreService
 */

const CRUDService = (function() {
  'use strict';

  // ==================== CONFIGURATION ====================

  /**
   * Default options for all operations
   */
  const DEFAULTS = {
    cacheEnabled: true,      // Use localStorage as cache
    cacheTTL: 5 * 60 * 1000, // Cache TTL: 5 minutes
    factoryFilter: false,    // Filter by currentFactory
    orderBy: 'createdAt',
    orderDir: 'desc',
    showToast: true,         // Show toast on save/delete
    confirmDelete: true      // Show confirm dialog before delete
  };

  /**
   * Get localStorage cache key
   * @param {string} collection - Collection name
   * @param {string} [suffix] - Optional suffix for scoping
   * @returns {string}
   */
  function getCacheKey(collection, suffix) {
    return suffix ? `${collection}_${suffix}` : collection;
  }

  // ==================== LOAD ====================

  /**
   * Load documents from Firestore with localStorage fallback
   * Replaces 12+ duplicated load patterns across all apps
   *
   * @param {string} collection - Firestore collection name
   * @param {Object} [options] - Load options
   * @param {boolean} [options.factory] - Filter by current factory
   * @param {string} [options.factoryId] - Specific factory ID to filter
   * @param {Array} [options.where] - Additional where conditions [[field, op, value], ...]
   * @param {string} [options.orderBy='createdAt'] - Order field
   * @param {string} [options.orderDir='desc'] - Order direction
   * @param {number} [options.limit] - Max results
   * @param {boolean} [options.cache=true] - Use localStorage cache
   * @param {string} [options.cacheKey] - Custom cache key
   * @param {Function} [options.transform] - Transform each document after load
   * @returns {Promise<Array>} Array of documents
   */
  async function load(collection, options = {}) {
    const opts = { ...DEFAULTS, ...options };
    const cacheKey = opts.cacheKey || getCacheKey(collection, opts.factoryId);

    // Try localStorage cache first
    if (opts.cache !== false && opts.cacheEnabled) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          const isValid = timestamp && (Date.now() - timestamp < (opts.cacheTTL || DEFAULTS.cacheTTL));
          if (isValid && Array.isArray(data) && data.length > 0) {
            console.log(`📦 [CRUDService] Cache hit: ${collection} (${data.length} items)`);
            let result = data;
            if (opts.transform) result = result.map(opts.transform);
            return result;
          }
        }
      } catch (e) {
        // Cache read failed, continue to Firestore
      }
    }

    // Load from Firestore
    try {
      const factoryId = opts.factoryId || (opts.factory ? _getCurrentFactory() : null);

      let data = await FirestoreService.getDocs(collection, {
        where: opts.where || [],
        orderBy: opts.orderBy || DEFAULTS.orderBy,
        orderDir: opts.orderDir || DEFAULTS.orderDir,
        limit: opts.limit,
        factory: factoryId
      });

      // Transform if provided
      if (opts.transform) {
        data = data.map(opts.transform);
      }

      // Save to cache
      if (opts.cache !== false && opts.cacheEnabled) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            data,
            timestamp: Date.now()
          }));
        } catch (e) {
          // Cache write failed (quota exceeded), silently ignore
        }
      }

      console.log(`🔥 [CRUDService] Loaded: ${collection} (${data.length} items)`);
      return data;

    } catch (error) {
      console.warn(`⚠️ [CRUDService] Load failed for ${collection}:`, error.message);

      // Fallback to cache (even if expired)
      if (opts.cache !== false) {
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            const { data } = JSON.parse(cached);
            if (Array.isArray(data)) {
              console.log(`📦 [CRUDService] Using expired cache: ${collection} (${data.length} items)`);
              return data;
            }
          }
        } catch (e) { }
      }

      return [];
    }
  }

  /**
   * Load documents filtered by date
   * @param {string} collection - Collection name
   * @param {string} dateField - Date field name
   * @param {string} dateValue - Date value (YYYY-MM-DD)
   * @param {Object} [options] - Additional load options
   * @returns {Promise<Array>}
   */
  async function loadByDate(collection, dateField, dateValue, options = {}) {
    return load(collection, {
      ...options,
      where: [
        ...(options.where || []),
        [dateField, '==', dateValue]
      ],
      cacheKey: getCacheKey(collection, dateValue)
    });
  }

  /**
   * Load a single document by ID
   * @param {string} collection - Collection name
   * @param {string} docId - Document ID
   * @returns {Promise<Object|null>}
   */
  async function loadOne(collection, docId) {
    return FirestoreService.getDoc(collection, docId);
  }

  // ==================== SAVE ====================

  /**
   * Save (create or update) a document
   * Replaces 15+ duplicated save patterns
   *
   * @param {string} collection - Collection name
   * @param {Object} data - Document data
   * @param {string} [docId] - Document ID (if updating existing)
   * @param {Object} [options] - Save options
   * @param {boolean} [options.showToast=true] - Show success toast
   * @param {string} [options.successMessage] - Custom success message
   * @param {string} [options.cacheKey] - Cache key to invalidate
   * @param {Function} [options.onSuccess] - Callback after successful save
   * @returns {Promise<string|null>} Document ID if success, null if failed
   */
  async function save(collection, data, docId, options = {}) {
    const opts = { ...DEFAULTS, ...options };

    try {
      let resultId;

      if (docId) {
        await FirestoreService.updateDoc(collection, docId, data);
        resultId = docId;
      } else {
        resultId = await FirestoreService.createDoc(collection, data);
      }

      // Invalidate cache
      _invalidateCache(collection, opts.cacheKey);

      // Show toast
      if (opts.showToast !== false) {
        const msg = opts.successMessage || (docId ? 'Cập nhật thành công!' : 'Thêm mới thành công!');
        _showToast(msg, 'success');
      }

      // Callback
      if (typeof opts.onSuccess === 'function') {
        opts.onSuccess(resultId);
      }

      return resultId;

    } catch (error) {
      console.error(`❌ [CRUDService] Save failed for ${collection}:`, error);
      _showToast('Lỗi: ' + error.message, 'error');
      return null;
    }
  }

  // ==================== DELETE ====================

  /**
   * Delete a document with confirmation
   * Replaces 10+ duplicated delete patterns
   *
   * @param {string} collection - Collection name
   * @param {string} docId - Document ID
   * @param {Object} [options] - Delete options
   * @param {boolean} [options.confirm=true] - Show confirmation dialog
   * @param {string} [options.confirmMessage] - Custom confirmation message
   * @param {boolean} [options.showToast=true] - Show success toast
   * @param {string} [options.cacheKey] - Cache key to invalidate
   * @param {Function} [options.onSuccess] - Callback after delete
   * @returns {Promise<boolean>} True if deleted, false if cancelled/failed
   */
  async function remove(collection, docId, options = {}) {
    const opts = { ...DEFAULTS, ...options };

    // Confirmation
    if (opts.confirm !== false && opts.confirmDelete) {
      const msg = opts.confirmMessage || 'Bạn có chắc muốn xóa?';
      if (!confirm(msg)) return false;
    }

    try {
      await FirestoreService.deleteDoc(collection, docId);

      // Invalidate cache
      _invalidateCache(collection, opts.cacheKey);

      // Show toast
      if (opts.showToast !== false) {
        _showToast('Đã xóa thành công!', 'success');
      }

      // Callback
      if (typeof opts.onSuccess === 'function') {
        opts.onSuccess();
      }

      return true;

    } catch (error) {
      console.error(`❌ [CRUDService] Delete failed for ${collection}:`, error);
      _showToast('Lỗi xóa: ' + error.message, 'error');
      return false;
    }
  }

  // ==================== CACHE MANAGEMENT ====================

  /**
   * Invalidate (clear) cache for a collection
   * @param {string} collection - Collection name
   * @param {string} [customKey] - Custom cache key
   */
  function invalidateCache(collection, customKey) {
    _invalidateCache(collection, customKey);
  }

  /**
   * Clear all CRUD caches
   */
  function clearAllCaches() {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      try {
        const val = JSON.parse(localStorage.getItem(key));
        if (val && val.timestamp && val.data) {
          localStorage.removeItem(key);
        }
      } catch (e) { }
    });
    console.log('🗑️ [CRUDService] All caches cleared');
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Get current factory from global scope
   */
  function _getCurrentFactory() {
    // Support both global variable and Config module
    if (typeof currentFactory !== 'undefined') return currentFactory;
    if (typeof window.currentFactory !== 'undefined') return window.currentFactory;
    return null;
  }

  /**
   * Invalidate cache entries for a collection
   */
  function _invalidateCache(collection, customKey) {
    try {
      if (customKey) {
        localStorage.removeItem(customKey);
      }
      // Remove main cache and any suffixed variants
      localStorage.removeItem(collection);
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(collection + '_')) {
          localStorage.removeItem(key);
        }
      });
    } catch (e) { }
  }

  /**
   * Show toast notification (uses global showToast if available)
   */
  function _showToast(message, type) {
    if (typeof showToast === 'function') {
      showToast(message, type);
    } else if (typeof Toast !== 'undefined' && typeof Toast.show === 'function') {
      Toast.show(message, type);
    } else {
      console.log(`[${type}] ${message}`);
    }
  }

  // ==================== PUBLIC API ====================

  return {
    // Core operations
    load,
    loadByDate,
    loadOne,
    save,
    remove,

    // Cache
    invalidateCache,
    clearAllCaches,

    // Configuration
    DEFAULTS
  };
})();
