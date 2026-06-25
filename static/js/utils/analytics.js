/**
 * Analytics Module
 * User behavior tracking và analytics
 * @module analytics
 */

const Analytics = (function() {
  'use strict';

  // ==================== CONFIG ====================
  const CONFIG = {
    enabled: true,
    trackPageViews: true,
    trackClicks: true,
    trackScrollDepth: true,
    trackTimeOnPage: true,
    trackForms: true,
    sampleRate: 1.0,
    sessionTimeout: 30 * 60 * 1000, // 30 phút
    storageKey: 'qtdn_analytics',
    maxEvents: 500,
    batchSize: 20,
    flushInterval: 60000 // 1 phút
  };

  // ==================== STATE ====================
  const events = [];
  let sessionId = null;
  let sessionStart = null;
  let userId = null;
  let userProperties = {};
  let pageViewStart = null;
  let scrollDepth = 0;
  let isInitialized = false;
  let flushTimer = null;

  // ==================== EVENT TYPES ====================
  const EVENT_TYPES = {
    PAGE_VIEW: 'page_view',
    PAGE_EXIT: 'page_exit',
    CLICK: 'click',
    FORM_START: 'form_start',
    FORM_SUBMIT: 'form_submit',
    FORM_ERROR: 'form_error',
    SCROLL: 'scroll',
    SEARCH: 'search',
    DOWNLOAD: 'download',
    OUTBOUND_LINK: 'outbound_link',
    VIDEO_PLAY: 'video_play',
    VIDEO_COMPLETE: 'video_complete',
    ERROR: 'error',
    CUSTOM: 'custom'
  };

  // ==================== SESSION MANAGEMENT ====================

  /**
   * Initialize or restore session
   */
  function initSession() {
    const stored = loadFromStorage();

    if (stored && stored.sessionId && (Date.now() - stored.lastActivity < CONFIG.sessionTimeout)) {
      // Restore existing session
      sessionId = stored.sessionId;
      sessionStart = stored.sessionStart;
      userId = stored.userId;
      userProperties = stored.userProperties || {};
    } else {
      // Create new session
      sessionId = generateId('sess');
      sessionStart = Date.now();
    }

    // Save session
    saveToStorage();
  }

  /**
   * Generate unique ID
   */
  function generateId(prefix = 'evt') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ==================== CORE TRACKING ====================

  /**
   * Track event
   * @param {string} eventName - Event name
   * @param {Object} properties - Event properties
   */
  function track(eventName, properties = {}) {
    if (!CONFIG.enabled) return null;

    // Sample rate check
    if (Math.random() > CONFIG.sampleRate) return null;

    const event = {
      id: generateId(),
      name: eventName,
      timestamp: Date.now(),
      sessionId,
      userId,
      properties: {
        ...properties,
        url: window.location.href,
        path: window.location.pathname,
        referrer: document.referrer,
        title: document.title
      },
      context: getContext()
    };

    // Store event
    storeEvent(event);

    // Update last activity
    saveToStorage();

    return event;
  }

  /**
   * Get context data
   */
  function getContext() {
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      screenWidth: screen.width,
      screenHeight: screen.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      connection: getConnectionType()
    };
  }

  /**
   * Get connection type
   */
  function getConnectionType() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return conn?.effectiveType || 'unknown';
  }

  // ==================== PAGE VIEW TRACKING ====================

  /**
   * Track page view
   */
  function trackPageView(pageName = null) {
    if (!CONFIG.trackPageViews) return;

    // Track previous page exit if exists
    if (pageViewStart) {
      trackPageExit();
    }

    pageViewStart = Date.now();
    scrollDepth = 0;

    track(EVENT_TYPES.PAGE_VIEW, {
      pageName: pageName || document.title,
      path: window.location.pathname,
      hash: window.location.hash,
      search: window.location.search
    });
  }

  /**
   * Track page exit
   */
  function trackPageExit() {
    if (!pageViewStart) return;

    const timeOnPage = Date.now() - pageViewStart;

    track(EVENT_TYPES.PAGE_EXIT, {
      timeOnPage,
      timeOnPageSeconds: Math.round(timeOnPage / 1000),
      scrollDepth,
      path: window.location.pathname
    });

    pageViewStart = null;
  }

  // ==================== CLICK TRACKING ====================

  /**
   * Setup click tracking
   */
  function setupClickTracking() {
    if (!CONFIG.trackClicks) return;

    document.addEventListener('click', (event) => {
      const target = event.target.closest('a, button, [data-track]');
      if (!target) return;

      const props = {
        element: target.tagName.toLowerCase(),
        text: target.textContent?.trim().slice(0, 100),
        classes: target.className,
        id: target.id || null
      };

      // Link tracking
      if (target.tagName === 'A') {
        const href = target.getAttribute('href');
        props.href = href;

        // Check if outbound link
        if (href && !href.startsWith('#') && !href.startsWith('/')) {
          try {
            const url = new URL(href, window.location.origin);
            if (url.origin !== window.location.origin) {
              track(EVENT_TYPES.OUTBOUND_LINK, {
                ...props,
                destination: url.href
              });
              return;
            }
          } catch (e) {
            // Invalid URL
          }
        }

        // Check if download
        if (target.hasAttribute('download') || /\.(pdf|doc|docx|xls|xlsx|zip|rar)$/i.test(href)) {
          track(EVENT_TYPES.DOWNLOAD, {
            ...props,
            fileName: href.split('/').pop()
          });
          return;
        }
      }

      // Data-track attribute
      if (target.hasAttribute('data-track')) {
        props.trackId = target.getAttribute('data-track');
        props.trackData = target.getAttribute('data-track-data');
      }

      track(EVENT_TYPES.CLICK, props);
    }, true);
  }

  // ==================== SCROLL TRACKING ====================

  /**
   * Setup scroll depth tracking
   */
  function setupScrollTracking() {
    if (!CONFIG.trackScrollDepth) return;

    const thresholds = [25, 50, 75, 90, 100];
    const trackedThresholds = new Set();

    const handler = throttle(() => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      const currentScroll = window.scrollY;
      const currentDepth = scrollHeight > 0 ? Math.round((currentScroll / scrollHeight) * 100) : 100;

      scrollDepth = Math.max(scrollDepth, currentDepth);

      // Track threshold crossings
      for (const threshold of thresholds) {
        if (currentDepth >= threshold && !trackedThresholds.has(threshold)) {
          trackedThresholds.add(threshold);

          track(EVENT_TYPES.SCROLL, {
            depth: threshold,
            path: window.location.pathname
          });
        }
      }
    }, 500);

    window.addEventListener('scroll', handler, { passive: true });

    // Reset on navigation
    window.addEventListener('popstate', () => {
      trackedThresholds.clear();
      scrollDepth = 0;
    });
  }

  // ==================== FORM TRACKING ====================

  /**
   * Setup form tracking
   */
  function setupFormTracking() {
    if (!CONFIG.trackForms) return;

    // Form focus (start)
    document.addEventListener('focusin', (event) => {
      const form = event.target.closest('form');
      if (!form || form.dataset.trackStarted) return;

      form.dataset.trackStarted = 'true';
      form.dataset.trackStartTime = Date.now();

      track(EVENT_TYPES.FORM_START, {
        formId: form.id,
        formName: form.name,
        formAction: form.action
      });
    });

    // Form submit
    document.addEventListener('submit', (event) => {
      const form = event.target;
      const startTime = parseInt(form.dataset.trackStartTime || Date.now());
      const timeToComplete = Date.now() - startTime;

      track(EVENT_TYPES.FORM_SUBMIT, {
        formId: form.id,
        formName: form.name,
        formAction: form.action,
        timeToComplete,
        fieldCount: form.elements.length
      });

      // Reset form tracking state
      delete form.dataset.trackStarted;
      delete form.dataset.trackStartTime;
    });
  }

  // ==================== SEARCH TRACKING ====================

  /**
   * Track search
   */
  function trackSearch(query, results = null, filters = {}) {
    track(EVENT_TYPES.SEARCH, {
      query,
      resultsCount: results,
      filters,
      path: window.location.pathname
    });
  }

  // ==================== USER IDENTIFICATION ====================

  /**
   * Identify user
   */
  function identify(id, properties = {}) {
    userId = id;
    userProperties = { ...userProperties, ...properties };
    saveToStorage();

    track('identify', {
      userId: id,
      ...properties
    });
  }

  /**
   * Set user property
   */
  function setUserProperty(key, value) {
    userProperties[key] = value;
    saveToStorage();
  }

  /**
   * Reset user
   */
  function resetUser() {
    userId = null;
    userProperties = {};
    sessionId = generateId('sess');
    sessionStart = Date.now();
    saveToStorage();
  }

  // ==================== STORAGE ====================

  /**
   * Store event
   */
  function storeEvent(event) {
    events.push(event);

    // Keep only recent events
    if (events.length > CONFIG.maxEvents) {
      events.splice(0, events.length - CONFIG.maxEvents);
    }
  }

  /**
   * Save to storage
   */
  function saveToStorage() {
    try {
      const data = {
        sessionId,
        sessionStart,
        userId,
        userProperties,
        lastActivity: Date.now()
      };
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
    } catch (e) {
      // Storage unavailable
    }
  }

  /**
   * Load from storage
   */
  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(CONFIG.storageKey);
      return stored ? JSON.parse(stored) : null;
    } catch (e) {
      return null;
    }
  }

  // ==================== REPORTING ====================

  /**
   * Get events
   */
  function getEvents(filters = {}) {
    let result = [...events];

    if (filters.name) {
      result = result.filter(e => e.name === filters.name);
    }

    if (filters.since) {
      result = result.filter(e => e.timestamp >= filters.since);
    }

    if (filters.limit) {
      result = result.slice(-filters.limit);
    }

    return result;
  }

  /**
   * Get analytics summary
   */
  function getSummary(period = 'session') {
    const since = period === 'session' ? sessionStart : Date.now() - (period * 1000);
    const periodEvents = events.filter(e => e.timestamp >= since);

    return {
      sessionId,
      sessionDuration: Date.now() - sessionStart,
      userId,
      eventCount: periodEvents.length,
      pageViews: periodEvents.filter(e => e.name === EVENT_TYPES.PAGE_VIEW).length,
      clicks: periodEvents.filter(e => e.name === EVENT_TYPES.CLICK).length,
      formSubmits: periodEvents.filter(e => e.name === EVENT_TYPES.FORM_SUBMIT).length,
      searches: periodEvents.filter(e => e.name === EVENT_TYPES.SEARCH).length,
      maxScrollDepth: scrollDepth,
      topPages: getTopPages(periodEvents),
      eventsByType: countByProperty(periodEvents, 'name')
    };
  }

  /**
   * Get top pages
   */
  function getTopPages(eventList = events) {
    const pageViews = eventList.filter(e => e.name === EVENT_TYPES.PAGE_VIEW);
    const counts = {};

    pageViews.forEach(e => {
      const path = e.properties?.path || '/';
      counts[path] = (counts[path] || 0) + 1;
    });

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));
  }

  /**
   * Count by property
   */
  function countByProperty(arr, prop) {
    return arr.reduce((acc, item) => {
      const key = item[prop];
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Export events
   */
  function exportEvents(format = 'json') {
    if (format === 'csv') {
      const headers = ['id', 'name', 'timestamp', 'sessionId', 'userId', 'url'];
      const rows = events.map(e => [
        e.id,
        e.name,
        new Date(e.timestamp).toISOString(),
        e.sessionId,
        e.userId || '',
        e.properties?.url || ''
      ]);

      return [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
    }

    return JSON.stringify(events, null, 2);
  }

  // ==================== UTILITIES ====================

  /**
   * Throttle function
   */
  function throttle(fn, delay) {
    let lastCall = 0;
    return function(...args) {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        fn.apply(this, args);
      }
    };
  }

  // ==================== INITIALIZATION ====================

  /**
   * Initialize analytics
   */
  function init(options = {}) {
    if (isInitialized) return;

    Object.assign(CONFIG, options);

    initSession();
    setupClickTracking();
    setupScrollTracking();
    setupFormTracking();

    // Track initial page view
    if (CONFIG.trackPageViews) {
      trackPageView();
    }

    // Handle page exit
    window.addEventListener('beforeunload', trackPageExit);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        trackPageExit();
      }
    });

    // Handle SPA navigation
    window.addEventListener('popstate', () => {
      trackPageView();
    });

    isInitialized = true;
    console.log('[Analytics] Analytics initialized');
  }

  // Auto-init
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => init());
    } else {
      init();
    }
  }

  // ==================== PUBLIC API ====================
  return {
    // Core tracking
    track,
    trackPageView,
    trackSearch,

    // User
    identify,
    setUserProperty,
    resetUser,

    // Query
    getEvents,
    getSummary,
    getTopPages,
    exportEvents,

    // Session
    get sessionId() { return sessionId; },
    get userId() { return userId; },
    get sessionDuration() { return Date.now() - sessionStart; },

    // Control
    init,
    enable: () => { CONFIG.enabled = true; },
    disable: () => { CONFIG.enabled = false; },

    // Constants
    EVENT_TYPES,

    // Config
    CONFIG
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Analytics;
}
