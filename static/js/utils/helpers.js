/**
 * Helpers Utility Module
 * Các hàm tiện ích dùng chung
 * @module helpers
 */

const Helpers = (function() {
  'use strict';

  // ==================== DATE & TIME ====================

  /**
   * Format ngày tháng theo locale Việt Nam
   * @param {Date|string|number} date - Ngày cần format
   * @param {Object} options - Tùy chọn format
   * @returns {string}
   */
  function formatDate(date, options = {}) {
    if (!date) return '';

    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';

    const {
      format = 'date', // 'date', 'time', 'datetime', 'relative'
      locale = 'vi-VN'
    } = options;

    if (format === 'relative') {
      return formatRelativeTime(d);
    }

    const formatOptions = {
      date: { day: '2-digit', month: '2-digit', year: 'numeric' },
      time: { hour: '2-digit', minute: '2-digit' },
      datetime: { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    };

    return d.toLocaleString(locale, formatOptions[format] || formatOptions.date);
  }

  /**
   * Format thời gian tương đối (vd: "5 phút trước")
   * @param {Date} date
   * @returns {string}
   */
  function formatRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Vừa xong';
    if (minutes < 60) return `${minutes} phút trước`;
    if (hours < 24) return `${hours} giờ trước`;
    if (days < 7) return `${days} ngày trước`;

    return formatDate(date, { format: 'date' });
  }

  /**
   * Lấy ngày đầu tuần/tháng/năm
   * @param {Date} date
   * @param {string} period - 'week', 'month', 'year'
   * @returns {Date}
   */
  function getStartOf(date, period = 'day') {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);

    switch (period) {
      case 'week':
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        break;
      case 'month':
        d.setDate(1);
        break;
      case 'year':
        d.setMonth(0, 1);
        break;
    }
    return d;
  }

  /**
   * Lấy ngày cuối tuần/tháng/năm
   * @param {Date} date
   * @param {string} period
   * @returns {Date}
   */
  function getEndOf(date, period = 'day') {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);

    switch (period) {
      case 'week':
        const day = d.getDay();
        const diff = d.getDate() + (7 - day);
        d.setDate(diff);
        break;
      case 'month':
        d.setMonth(d.getMonth() + 1, 0);
        break;
      case 'year':
        d.setMonth(11, 31);
        break;
    }
    return d;
  }

  // ==================== NUMBER FORMATTING ====================

  /**
   * Format số với separator
   * @param {number} num - Số cần format
   * @param {Object} options
   * @returns {string}
   */
  function formatNumber(num, options = {}) {
    if (num === null || num === undefined || isNaN(num)) return '0';

    const {
      decimals = 0,
      locale = 'vi-VN'
    } = options;

    return Number(num).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /**
   * Format tiền tệ VND
   * @param {number} amount
   * @returns {string}
   */
  function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '0 ₫';
    return formatNumber(amount) + ' ₫';
  }

  /**
   * Format phần trăm
   * @param {number} value
   * @param {number} decimals
   * @returns {string}
   */
  function formatPercent(value, decimals = 1) {
    if (value === null || value === undefined) return '0%';
    return formatNumber(value, { decimals }) + '%';
  }

  /**
   * Format kích thước file
   * @param {number} bytes
   * @returns {string}
   */
  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
  }

  // ==================== STRING UTILITIES ====================

  /**
   * Truncate string với ellipsis
   * @param {string} str
   * @param {number} maxLength
   * @returns {string}
   */
  function truncate(str, maxLength = 50) {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  /**
   * Capitalize first letter
   * @param {string} str
   * @returns {string}
   */
  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  /**
   * Convert string to slug
   * @param {string} str
   * @returns {string}
   */
  function slugify(str) {
    if (!str) return '';

    // Remove Vietnamese diacritics
    const from = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
    const to = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';

    let result = str.toLowerCase();
    for (let i = 0; i < from.length; i++) {
      result = result.replace(new RegExp(from[i], 'g'), to[i]);
    }

    return result
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Highlight search term trong text
   * @param {string} text
   * @param {string} search
   * @returns {string} HTML với highlight
   */
  function highlightSearch(text, search) {
    if (!text || !search) return text || '';

    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedSearch})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  // ==================== ARRAY UTILITIES ====================

  /**
   * Group array by key
   * @param {Array} array
   * @param {string|Function} key
   * @returns {Object}
   */
  function groupBy(array, key) {
    if (!Array.isArray(array)) return {};

    return array.reduce((result, item) => {
      const groupKey = typeof key === 'function' ? key(item) : item[key];
      (result[groupKey] = result[groupKey] || []).push(item);
      return result;
    }, {});
  }

  /**
   * Sort array by key
   * @param {Array} array
   * @param {string} key
   * @param {string} order - 'asc' or 'desc'
   * @returns {Array}
   */
  function sortBy(array, key, order = 'asc') {
    if (!Array.isArray(array)) return [];

    return [...array].sort((a, b) => {
      let aVal = a[key];
      let bVal = b[key];

      // Handle null/undefined
      if (aVal === null || aVal === undefined) return order === 'asc' ? 1 : -1;
      if (bVal === null || bVal === undefined) return order === 'asc' ? -1 : 1;

      // String comparison
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });
  }

  /**
   * Unique array
   * @param {Array} array
   * @param {string} key - Optional key for objects
   * @returns {Array}
   */
  function unique(array, key = null) {
    if (!Array.isArray(array)) return [];

    if (key) {
      const seen = new Set();
      return array.filter(item => {
        const val = item[key];
        if (seen.has(val)) return false;
        seen.add(val);
        return true;
      });
    }

    return [...new Set(array)];
  }

  /**
   * Chunk array into smaller arrays
   * @param {Array} array
   * @param {number} size
   * @returns {Array}
   */
  function chunk(array, size) {
    if (!Array.isArray(array) || size < 1) return [];

    const result = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  // ==================== OBJECT UTILITIES ====================

  /**
   * Deep clone object
   * @param {Object} obj
   * @returns {Object}
   */
  function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;

    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Array) return obj.map(item => deepClone(item));

    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = deepClone(obj[key]);
      }
    }
    return cloned;
  }

  /**
   * Pick specific keys from object
   * @param {Object} obj
   * @param {Array} keys
   * @returns {Object}
   */
  function pick(obj, keys) {
    if (!obj || !Array.isArray(keys)) return {};

    return keys.reduce((result, key) => {
      if (obj.hasOwnProperty(key)) {
        result[key] = obj[key];
      }
      return result;
    }, {});
  }

  /**
   * Omit specific keys from object
   * @param {Object} obj
   * @param {Array} keys
   * @returns {Object}
   */
  function omit(obj, keys) {
    if (!obj) return {};
    if (!Array.isArray(keys)) return { ...obj };

    const result = { ...obj };
    keys.forEach(key => delete result[key]);
    return result;
  }

  /**
   * Check if object is empty
   * @param {Object} obj
   * @returns {boolean}
   */
  function isEmpty(obj) {
    if (obj === null || obj === undefined) return true;
    if (Array.isArray(obj)) return obj.length === 0;
    if (typeof obj === 'object') return Object.keys(obj).length === 0;
    if (typeof obj === 'string') return obj.trim() === '';
    return false;
  }

  // ==================== DEBOUNCE & THROTTLE ====================

  /**
   * Debounce function
   * @param {Function} func
   * @param {number} wait
   * @returns {Function}
   */
  function debounce(func, wait = 300) {
    let timeoutId;

    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), wait);
    };
  }

  /**
   * Throttle function
   * @param {Function} func
   * @param {number} limit
   * @returns {Function}
   */
  function throttle(func, limit = 100) {
    let inThrottle;

    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // ==================== DOM UTILITIES ====================

  /**
   * Query selector với null safety
   * @param {string} selector
   * @param {Element} context
   * @returns {Element|null}
   */
  function $(selector, context = document) {
    return context.querySelector(selector);
  }

  /**
   * Query selector all
   * @param {string} selector
   * @param {Element} context
   * @returns {Array}
   */
  function $$(selector, context = document) {
    return Array.from(context.querySelectorAll(selector));
  }

  /**
   * Add event listener với auto cleanup
   * @param {Element} element
   * @param {string} event
   * @param {Function} handler
   * @param {Object} options
   * @returns {Function} Cleanup function
   */
  function on(element, event, handler, options = {}) {
    if (!element) return () => {};
    element.addEventListener(event, handler, options);
    return () => element.removeEventListener(event, handler, options);
  }

  /**
   * Create element
   * @param {string} tag
   * @param {Object} attrs
   * @param {string|Element|Array} children
   * @returns {Element}
   */
  function createElement(tag, attrs = {}, children = null) {
    const el = document.createElement(tag);

    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') {
        el.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        el.setAttribute(key, value);
      }
    }

    if (children) {
      if (typeof children === 'string') {
        el.textContent = children;
      } else if (children instanceof Element) {
        el.appendChild(children);
      } else if (Array.isArray(children)) {
        children.forEach(child => {
          if (typeof child === 'string') {
            el.appendChild(document.createTextNode(child));
          } else if (child instanceof Element) {
            el.appendChild(child);
          }
        });
      }
    }

    return el;
  }

  // ==================== ASYNC UTILITIES ====================

  /**
   * Sleep/delay
   * @param {number} ms
   * @returns {Promise}
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retry async function
   * @param {Function} fn
   * @param {number} retries
   * @param {number} delay
   * @returns {Promise}
   */
  async function retry(fn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === retries - 1) throw error;
        await sleep(delay * (i + 1));
      }
    }
  }

  // ==================== ID GENERATORS ====================

  /**
   * Generate unique ID
   * @param {string} prefix
   * @returns {string}
   */
  function generateId(prefix = '') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
  }

  /**
   * Generate UUID v4
   * @returns {string}
   */
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ==================== PUBLIC API ====================
  return {
    // Date & Time
    formatDate,
    formatRelativeTime,
    getStartOf,
    getEndOf,

    // Numbers
    formatNumber,
    formatCurrency,
    formatPercent,
    formatFileSize,

    // Strings
    truncate,
    capitalize,
    slugify,
    highlightSearch,

    // Arrays
    groupBy,
    sortBy,
    unique,
    chunk,

    // Objects
    deepClone,
    pick,
    omit,
    isEmpty,

    // Functions
    debounce,
    throttle,

    // DOM
    $,
    $$,
    on,
    createElement,

    // Async
    sleep,
    retry,

    // IDs
    generateId,
    uuid
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Helpers;
}
