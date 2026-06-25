/**
 * Cache Manager Module
 * Quản lý caching cho API responses với TTL và invalidation
 * @module cacheManager
 */

const CacheManager = (function() {
  'use strict';

  // ==================== CONFIG ====================
  const DEFAULT_TTL = 5 * 60 * 1000; // 5 phút
  const CACHE_PREFIX = 'qtdn_cache_';
  const INDEX_KEY = 'qtdn_cache_index';

  // Cache strategies
  const STRATEGIES = {
    CACHE_FIRST: 'cache-first',      // Ưu tiên cache, fallback network
    NETWORK_FIRST: 'network-first',   // Ưu tiên network, fallback cache
    STALE_WHILE_REVALIDATE: 'swr',   // Trả cache ngay, update background
    NETWORK_ONLY: 'network-only',     // Chỉ dùng network
    CACHE_ONLY: 'cache-only'          // Chỉ dùng cache
  };

  // ==================== STATE ====================
  const memoryCache = new Map();
  const pendingRequests = new Map();
  let cacheIndex = loadCacheIndex();

  // ==================== HELPERS ====================

  /**
   * Load cache index từ localStorage
   */
  function loadCacheIndex() {
    try {
      const data = localStorage.getItem(INDEX_KEY);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  }

  /**
   * Save cache index to localStorage
   */
  function saveCacheIndex() {
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(cacheIndex));
    } catch (e) {
      console.warn('[CacheManager] Failed to save cache index:', e);
    }
  }

  /**
   * Generate cache key từ URL và params
   */
  function generateKey(url, params = null) {
    const baseKey = url.replace(/[^a-zA-Z0-9]/g, '_');
    if (params) {
      const paramStr = JSON.stringify(params);
      const hash = simpleHash(paramStr);
      return `${baseKey}_${hash}`;
    }
    return baseKey;
  }

  /**
   * Simple hash function
   */
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Kiểm tra cache có hết hạn không
   */
  function isExpired(entry) {
    if (!entry || !entry.expiresAt) return true;
    return Date.now() > entry.expiresAt;
  }

  /**
   * Serialize data để lưu
   */
  function serialize(data, ttl, tags = []) {
    return {
      data,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      tags
    };
  }

  // ==================== CORE CACHE OPERATIONS ====================

  /**
   * Set cache entry
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   * @param {Object} options - Options
   */
  function set(key, data, options = {}) {
    const {
      ttl = DEFAULT_TTL,
      tags = [],
      persist = true
    } = options;

    const fullKey = CACHE_PREFIX + key;
    const entry = serialize(data, ttl, tags);

    // Memory cache
    memoryCache.set(fullKey, entry);

    // Persist to localStorage
    if (persist) {
      try {
        localStorage.setItem(fullKey, JSON.stringify(entry));

        // Update index
        cacheIndex[fullKey] = {
          expiresAt: entry.expiresAt,
          tags,
          size: JSON.stringify(entry).length
        };
        saveCacheIndex();
      } catch (e) {
        // Quota exceeded - clear old entries
        if (e.name === 'QuotaExceededError') {
          clearExpired();
          try {
            localStorage.setItem(fullKey, JSON.stringify(entry));
          } catch (e2) {
            console.warn('[CacheManager] Storage quota exceeded');
          }
        }
      }
    }
  }

  /**
   * Get cache entry
   * @param {string} key - Cache key
   * @returns {*} Cached data or null
   */
  function get(key) {
    const fullKey = CACHE_PREFIX + key;

    // Check memory cache first
    if (memoryCache.has(fullKey)) {
      const entry = memoryCache.get(fullKey);
      if (!isExpired(entry)) {
        return entry.data;
      }
      memoryCache.delete(fullKey);
    }

    // Check localStorage
    try {
      const stored = localStorage.getItem(fullKey);
      if (stored) {
        const entry = JSON.parse(stored);
        if (!isExpired(entry)) {
          // Restore to memory cache
          memoryCache.set(fullKey, entry);
          return entry.data;
        }
        // Expired - remove
        localStorage.removeItem(fullKey);
        delete cacheIndex[fullKey];
        saveCacheIndex();
      }
    } catch (e) {
      console.warn('[CacheManager] Error reading cache:', e);
    }

    return null;
  }

  /**
   * Check if cache exists and is valid
   */
  function has(key) {
    return get(key) !== null;
  }

  /**
   * Delete cache entry
   */
  function remove(key) {
    const fullKey = CACHE_PREFIX + key;
    memoryCache.delete(fullKey);
    localStorage.removeItem(fullKey);
    delete cacheIndex[fullKey];
    saveCacheIndex();
  }

  /**
   * Clear all cache
   */
  function clear() {
    // Clear memory
    memoryCache.clear();

    // Clear localStorage
    Object.keys(cacheIndex).forEach(key => {
      localStorage.removeItem(key);
    });

    cacheIndex = {};
    saveCacheIndex();
  }

  /**
   * Clear expired entries
   */
  function clearExpired() {
    const now = Date.now();
    let clearedCount = 0;

    Object.entries(cacheIndex).forEach(([key, meta]) => {
      if (meta.expiresAt < now) {
        localStorage.removeItem(key);
        memoryCache.delete(key);
        delete cacheIndex[key];
        clearedCount++;
      }
    });

    if (clearedCount > 0) {
      saveCacheIndex();
      console.log(`[CacheManager] Cleared ${clearedCount} expired entries`);
    }

    return clearedCount;
  }

  /**
   * Invalidate by tags
   * @param {string[]} tags - Tags to invalidate
   */
  function invalidateByTags(tags) {
    const tagsSet = new Set(tags);
    let invalidatedCount = 0;

    Object.entries(cacheIndex).forEach(([key, meta]) => {
      if (meta.tags && meta.tags.some(t => tagsSet.has(t))) {
        localStorage.removeItem(key);
        memoryCache.delete(key);
        delete cacheIndex[key];
        invalidatedCount++;
      }
    });

    if (invalidatedCount > 0) {
      saveCacheIndex();
    }

    return invalidatedCount;
  }

  /**
   * Invalidate by pattern
   * @param {string|RegExp} pattern - Pattern to match keys
   */
  function invalidateByPattern(pattern) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    let invalidatedCount = 0;

    Object.keys(cacheIndex).forEach(key => {
      if (regex.test(key)) {
        localStorage.removeItem(key);
        memoryCache.delete(key);
        delete cacheIndex[key];
        invalidatedCount++;
      }
    });

    if (invalidatedCount > 0) {
      saveCacheIndex();
    }

    return invalidatedCount;
  }

  // ==================== FETCH WITH CACHE ====================

  /**
   * Fetch with caching
   * @param {string} url - URL to fetch
   * @param {Object} options - Options
   * @returns {Promise}
   */
  async function fetch(url, options = {}) {
    const {
      strategy = STRATEGIES.STALE_WHILE_REVALIDATE,
      ttl = DEFAULT_TTL,
      tags = [],
      params = null,
      fetchOptions = {},
      transform = null,
      forceRefresh = false
    } = options;

    const cacheKey = generateKey(url, params);

    // Force refresh - skip cache
    if (forceRefresh) {
      return fetchAndCache(url, cacheKey, { ttl, tags, fetchOptions, transform });
    }

    switch (strategy) {
      case STRATEGIES.CACHE_FIRST:
        return cacheFirst(url, cacheKey, { ttl, tags, fetchOptions, transform });

      case STRATEGIES.NETWORK_FIRST:
        return networkFirst(url, cacheKey, { ttl, tags, fetchOptions, transform });

      case STRATEGIES.STALE_WHILE_REVALIDATE:
        return staleWhileRevalidate(url, cacheKey, { ttl, tags, fetchOptions, transform });

      case STRATEGIES.CACHE_ONLY:
        return Promise.resolve(get(cacheKey));

      case STRATEGIES.NETWORK_ONLY:
      default:
        return fetchAndCache(url, cacheKey, { ttl, tags, fetchOptions, transform });
    }
  }

  /**
   * Cache First strategy
   */
  async function cacheFirst(url, cacheKey, options) {
    const cached = get(cacheKey);
    if (cached !== null) {
      return cached;
    }
    return fetchAndCache(url, cacheKey, options);
  }

  /**
   * Network First strategy
   */
  async function networkFirst(url, cacheKey, options) {
    try {
      return await fetchAndCache(url, cacheKey, options);
    } catch (error) {
      const cached = get(cacheKey);
      if (cached !== null) {
        console.log('[CacheManager] Network failed, returning cached data');
        return cached;
      }
      throw error;
    }
  }

  /**
   * Stale While Revalidate strategy
   */
  async function staleWhileRevalidate(url, cacheKey, options) {
    const cached = get(cacheKey);

    // Revalidate in background
    const fetchPromise = fetchAndCache(url, cacheKey, options).catch(err => {
      console.warn('[CacheManager] Background revalidation failed:', err);
      return cached;
    });

    // Return cached immediately if available
    if (cached !== null) {
      return cached;
    }

    // Wait for network if no cache
    return fetchPromise;
  }

  /**
   * Fetch and cache result
   */
  async function fetchAndCache(url, cacheKey, options) {
    const { ttl, tags, fetchOptions, transform } = options;

    // Dedupe concurrent requests
    if (pendingRequests.has(cacheKey)) {
      return pendingRequests.get(cacheKey);
    }

    const promise = (async () => {
      try {
        const response = await window.fetch(url, fetchOptions);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        let data = await response.json();

        // Transform data if needed
        if (transform && typeof transform === 'function') {
          data = transform(data);
        }

        // Cache the result
        set(cacheKey, data, { ttl, tags });

        return data;
      } finally {
        pendingRequests.delete(cacheKey);
      }
    })();

    pendingRequests.set(cacheKey, promise);
    return promise;
  }

  // ==================== FIRESTORE CACHE ====================

  /**
   * Cache Firestore query result
   * @param {string} collection - Collection name
   * @param {Object} query - Query parameters
   * @param {*} data - Data to cache
   * @param {Object} options - Options
   */
  function cacheQuery(collection, query, data, options = {}) {
    const key = `firestore_${collection}_${simpleHash(JSON.stringify(query))}`;
    set(key, data, {
      ttl: options.ttl || DEFAULT_TTL,
      tags: [collection, 'firestore', ...(options.tags || [])]
    });
  }

  /**
   * Get cached Firestore query
   */
  function getCachedQuery(collection, query) {
    const key = `firestore_${collection}_${simpleHash(JSON.stringify(query))}`;
    return get(key);
  }

  /**
   * Cache single document
   */
  function cacheDocument(collection, docId, data, options = {}) {
    const key = `firestore_${collection}_doc_${docId}`;
    set(key, data, {
      ttl: options.ttl || DEFAULT_TTL,
      tags: [collection, 'firestore', `doc_${docId}`, ...(options.tags || [])]
    });
  }

  /**
   * Get cached document
   */
  function getCachedDocument(collection, docId) {
    const key = `firestore_${collection}_doc_${docId}`;
    return get(key);
  }

  /**
   * Invalidate collection cache
   */
  function invalidateCollection(collection) {
    return invalidateByTags([collection]);
  }

  /**
   * Invalidate document cache
   */
  function invalidateDocument(collection, docId) {
    return invalidateByTags([`doc_${docId}`]);
  }

  // ==================== OFFLINE QUEUE ====================

  const OFFLINE_QUEUE_KEY = 'qtdn_offline_queue';

  /**
   * Add request to offline queue
   */
  function queueOfflineRequest(request) {
    const queue = getOfflineQueue();
    queue.push({
      ...request,
      id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now()
    });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  }

  /**
   * Get offline queue
   */
  function getOfflineQueue() {
    try {
      const data = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Process offline queue
   */
  async function processOfflineQueue(processor) {
    const queue = getOfflineQueue();
    if (queue.length === 0) return { processed: 0, failed: 0 };

    let processed = 0;
    let failed = 0;
    const remainingQueue = [];

    for (const request of queue) {
      try {
        await processor(request);
        processed++;
      } catch (error) {
        console.error('[CacheManager] Failed to process queued request:', error);
        failed++;

        // Keep failed items for retry (max 3 attempts)
        if ((request.attempts || 0) < 3) {
          remainingQueue.push({
            ...request,
            attempts: (request.attempts || 0) + 1,
            lastError: error.message
          });
        }
      }
    }

    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remainingQueue));

    return { processed, failed, remaining: remainingQueue.length };
  }

  /**
   * Clear offline queue
   */
  function clearOfflineQueue() {
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
  }

  // ==================== STATS ====================

  /**
   * Get cache statistics
   */
  function getStats() {
    const entries = Object.entries(cacheIndex);
    const now = Date.now();

    let totalSize = 0;
    let activeCount = 0;
    let expiredCount = 0;
    const tagStats = {};

    entries.forEach(([key, meta]) => {
      totalSize += meta.size || 0;

      if (meta.expiresAt > now) {
        activeCount++;
      } else {
        expiredCount++;
      }

      // Tag statistics
      if (meta.tags) {
        meta.tags.forEach(tag => {
          tagStats[tag] = (tagStats[tag] || 0) + 1;
        });
      }
    });

    return {
      totalEntries: entries.length,
      activeEntries: activeCount,
      expiredEntries: expiredCount,
      totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      memoryEntries: memoryCache.size,
      offlineQueueSize: getOfflineQueue().length,
      tagStats
    };
  }

  /**
   * Format bytes to human readable
   */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // ==================== AUTO CLEANUP ====================

  // Clear expired entries periodically
  if (typeof window !== 'undefined') {
    // Initial cleanup
    setTimeout(clearExpired, 1000);

    // Periodic cleanup every 5 minutes
    setInterval(clearExpired, 5 * 60 * 1000);
  }

  // ==================== PUBLIC API ====================
  return {
    // Core operations
    set,
    get,
    has,
    remove,
    clear,
    clearExpired,

    // Invalidation
    invalidateByTags,
    invalidateByPattern,

    // Fetch with cache
    fetch,

    // Firestore cache
    cacheQuery,
    getCachedQuery,
    cacheDocument,
    getCachedDocument,
    invalidateCollection,
    invalidateDocument,

    // Offline queue
    queueOfflineRequest,
    getOfflineQueue,
    processOfflineQueue,
    clearOfflineQueue,

    // Stats
    getStats,

    // Constants
    STRATEGIES,
    DEFAULT_TTL,

    // Utilities
    generateKey
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CacheManager;
}
