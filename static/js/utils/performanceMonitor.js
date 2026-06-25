/**
 * Performance Monitor Module
 * Đo lường Core Web Vitals và performance metrics
 * @module performanceMonitor
 */

const PerformanceMonitor = (function() {
  'use strict';

  // ==================== CONFIG ====================
  const CONFIG = {
    enabled: true,
    sampleRate: 1.0,           // 100% sampling
    reportEndpoint: null,       // Custom endpoint for reporting
    thresholds: {
      // Core Web Vitals thresholds (Good / Needs Improvement)
      LCP: { good: 2500, poor: 4000 },    // Largest Contentful Paint
      FID: { good: 100, poor: 300 },       // First Input Delay
      CLS: { good: 0.1, poor: 0.25 },      // Cumulative Layout Shift
      FCP: { good: 1800, poor: 3000 },     // First Contentful Paint
      TTFB: { good: 800, poor: 1800 },     // Time to First Byte
      INP: { good: 200, poor: 500 }        // Interaction to Next Paint
    },
    storageKey: 'qtdn_perf_metrics',
    maxStoredMetrics: 100
  };

  // ==================== STATE ====================
  const metrics = {};
  const observers = [];
  let reportQueue = [];
  let isInitialized = false;

  // ==================== CORE WEB VITALS ====================

  /**
   * Measure Largest Contentful Paint (LCP)
   */
  function measureLCP() {
    if (!('PerformanceObserver' in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];

        metrics.LCP = {
          value: lastEntry.startTime,
          rating: getRating('LCP', lastEntry.startTime),
          element: lastEntry.element?.tagName || 'unknown',
          url: lastEntry.url || null,
          timestamp: Date.now()
        };

        reportMetric('LCP', metrics.LCP);
      });

      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      observers.push(observer);
    } catch (e) {
      console.warn('[PerfMon] LCP measurement not supported');
    }
  }

  /**
   * Measure First Input Delay (FID)
   */
  function measureFID() {
    if (!('PerformanceObserver' in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const firstEntry = entries[0];

        metrics.FID = {
          value: firstEntry.processingStart - firstEntry.startTime,
          rating: getRating('FID', firstEntry.processingStart - firstEntry.startTime),
          eventType: firstEntry.name,
          timestamp: Date.now()
        };

        reportMetric('FID', metrics.FID);
      });

      observer.observe({ type: 'first-input', buffered: true });
      observers.push(observer);
    } catch (e) {
      console.warn('[PerfMon] FID measurement not supported');
    }
  }

  /**
   * Measure Cumulative Layout Shift (CLS)
   */
  function measureCLS() {
    if (!('PerformanceObserver' in window)) return;

    let clsValue = 0;
    let clsEntries = [];
    let sessionValue = 0;
    let sessionEntries = [];

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            const firstSessionEntry = sessionEntries[0];
            const lastSessionEntry = sessionEntries[sessionEntries.length - 1];

            // Start new session if gap > 1s or session > 5s
            if (sessionValue &&
                (entry.startTime - lastSessionEntry.startTime > 1000 ||
                 entry.startTime - firstSessionEntry.startTime > 5000)) {
              if (sessionValue > clsValue) {
                clsValue = sessionValue;
                clsEntries = [...sessionEntries];
              }
              sessionValue = 0;
              sessionEntries = [];
            }

            sessionValue += entry.value;
            sessionEntries.push(entry);
          }
        }

        // Update if current session is larger
        if (sessionValue > clsValue) {
          clsValue = sessionValue;
          clsEntries = [...sessionEntries];
        }

        metrics.CLS = {
          value: clsValue,
          rating: getRating('CLS', clsValue),
          entries: clsEntries.length,
          timestamp: Date.now()
        };

        reportMetric('CLS', metrics.CLS);
      });

      observer.observe({ type: 'layout-shift', buffered: true });
      observers.push(observer);
    } catch (e) {
      console.warn('[PerfMon] CLS measurement not supported');
    }
  }

  /**
   * Measure First Contentful Paint (FCP)
   */
  function measureFCP() {
    if (!('PerformanceObserver' in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const fcpEntry = entries.find(e => e.name === 'first-contentful-paint');

        if (fcpEntry) {
          metrics.FCP = {
            value: fcpEntry.startTime,
            rating: getRating('FCP', fcpEntry.startTime),
            timestamp: Date.now()
          };

          reportMetric('FCP', metrics.FCP);
        }
      });

      observer.observe({ type: 'paint', buffered: true });
      observers.push(observer);
    } catch (e) {
      console.warn('[PerfMon] FCP measurement not supported');
    }
  }

  /**
   * Measure Time to First Byte (TTFB)
   */
  function measureTTFB() {
    try {
      const navEntry = performance.getEntriesByType('navigation')[0];

      if (navEntry) {
        const ttfb = navEntry.responseStart - navEntry.requestStart;

        metrics.TTFB = {
          value: ttfb,
          rating: getRating('TTFB', ttfb),
          timestamp: Date.now()
        };

        reportMetric('TTFB', metrics.TTFB);
      }
    } catch (e) {
      console.warn('[PerfMon] TTFB measurement failed');
    }
  }

  /**
   * Measure Interaction to Next Paint (INP)
   */
  function measureINP() {
    if (!('PerformanceObserver' in window)) return;

    const interactions = [];

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.interactionId) {
            interactions.push({
              duration: entry.duration,
              type: entry.name
            });
          }
        }

        // INP is the 98th percentile of interactions
        if (interactions.length > 0) {
          const sorted = interactions.map(i => i.duration).sort((a, b) => a - b);
          const p98Index = Math.floor(sorted.length * 0.98);
          const inp = sorted[p98Index] || sorted[sorted.length - 1];

          metrics.INP = {
            value: inp,
            rating: getRating('INP', inp),
            interactions: interactions.length,
            timestamp: Date.now()
          };

          reportMetric('INP', metrics.INP);
        }
      });

      observer.observe({ type: 'event', buffered: true, durationThreshold: 16 });
      observers.push(observer);
    } catch (e) {
      console.warn('[PerfMon] INP measurement not supported');
    }
  }

  // ==================== CUSTOM METRICS ====================

  /**
   * Measure custom timing
   * @param {string} name - Metric name
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp (optional, defaults to now)
   */
  function measureTiming(name, startTime, endTime = performance.now()) {
    const duration = endTime - startTime;

    metrics[name] = {
      value: duration,
      timestamp: Date.now(),
      type: 'custom'
    };

    reportMetric(name, metrics[name]);
    return duration;
  }

  /**
   * Create timing marker
   */
  function mark(name) {
    performance.mark(name);
    return performance.now();
  }

  /**
   * Measure between two marks
   */
  function measure(name, startMark, endMark) {
    try {
      performance.measure(name, startMark, endMark);
      const entries = performance.getEntriesByName(name, 'measure');
      const entry = entries[entries.length - 1];

      if (entry) {
        metrics[name] = {
          value: entry.duration,
          timestamp: Date.now(),
          type: 'measure'
        };

        reportMetric(name, metrics[name]);
        return entry.duration;
      }
    } catch (e) {
      console.warn(`[PerfMon] Failed to measure ${name}:`, e);
    }
    return null;
  }

  /**
   * Measure async operation
   */
  async function measureAsync(name, asyncFn) {
    const startTime = performance.now();

    try {
      const result = await asyncFn();
      measureTiming(name, startTime);
      return result;
    } catch (error) {
      measureTiming(name + '_error', startTime);
      throw error;
    }
  }

  // ==================== RESOURCE TIMING ====================

  /**
   * Get resource timing data
   */
  function getResourceTimings() {
    const resources = performance.getEntriesByType('resource');

    return resources.map(r => ({
      name: r.name,
      type: r.initiatorType,
      duration: r.duration,
      size: r.transferSize,
      cached: r.transferSize === 0 && r.decodedBodySize > 0
    }));
  }

  /**
   * Get slow resources
   */
  function getSlowResources(threshold = 1000) {
    return getResourceTimings().filter(r => r.duration > threshold);
  }

  /**
   * Get resource summary by type
   */
  function getResourceSummary() {
    const resources = getResourceTimings();
    const summary = {};

    resources.forEach(r => {
      if (!summary[r.type]) {
        summary[r.type] = {
          count: 0,
          totalDuration: 0,
          totalSize: 0
        };
      }
      summary[r.type].count++;
      summary[r.type].totalDuration += r.duration;
      summary[r.type].totalSize += r.size || 0;
    });

    return summary;
  }

  // ==================== MEMORY ====================

  /**
   * Get memory usage (Chrome only)
   */
  function getMemoryUsage() {
    if (performance.memory) {
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
        totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576),
        limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
      };
    }
    return null;
  }

  // ==================== NAVIGATION TIMING ====================

  /**
   * Get navigation timing breakdown
   */
  function getNavigationTiming() {
    const nav = performance.getEntriesByType('navigation')[0];

    if (!nav) return null;

    return {
      // DNS
      dns: nav.domainLookupEnd - nav.domainLookupStart,
      // TCP connection
      tcp: nav.connectEnd - nav.connectStart,
      // SSL handshake
      ssl: nav.secureConnectionStart > 0
        ? nav.connectEnd - nav.secureConnectionStart
        : 0,
      // Time to First Byte
      ttfb: nav.responseStart - nav.requestStart,
      // Download time
      download: nav.responseEnd - nav.responseStart,
      // DOM parsing
      domParsing: nav.domInteractive - nav.responseEnd,
      // DOM content loaded
      domContentLoaded: nav.domContentLoadedEventEnd - nav.domContentLoadedEventStart,
      // Load event
      loadEvent: nav.loadEventEnd - nav.loadEventStart,
      // Total page load
      total: nav.loadEventEnd - nav.fetchStart
    };
  }

  // ==================== RATING ====================

  /**
   * Get rating based on thresholds
   */
  function getRating(metric, value) {
    const threshold = CONFIG.thresholds[metric];
    if (!threshold) return 'unknown';

    if (value <= threshold.good) return 'good';
    if (value <= threshold.poor) return 'needs-improvement';
    return 'poor';
  }

  /**
   * Get color for rating
   */
  function getRatingColor(rating) {
    switch (rating) {
      case 'good': return '#0cce6b';
      case 'needs-improvement': return '#ffa400';
      case 'poor': return '#ff4e42';
      default: return '#999';
    }
  }

  // ==================== REPORTING ====================

  /**
   * Report metric
   */
  function reportMetric(name, data) {
    if (!CONFIG.enabled) return;

    // Sample rate check
    if (Math.random() > CONFIG.sampleRate) return;

    const report = {
      name,
      ...data,
      url: window.location.href,
      userAgent: navigator.userAgent,
      connection: getConnectionInfo()
    };

    reportQueue.push(report);

    // Store locally
    storeMetric(report);

    // Log to console in development
    if (process?.env?.NODE_ENV === 'development') {
      const color = getRatingColor(data.rating);
      console.log(
        `%c[PerfMon] ${name}: ${formatValue(name, data.value)} (${data.rating || 'N/A'})`,
        `color: ${color}; font-weight: bold`
      );
    }
  }

  /**
   * Format metric value for display
   */
  function formatValue(name, value) {
    if (name === 'CLS') return value.toFixed(3);
    return `${Math.round(value)}ms`;
  }

  /**
   * Get connection info
   */
  function getConnectionInfo() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return null;

    return {
      effectiveType: conn.effectiveType,
      downlink: conn.downlink,
      rtt: conn.rtt,
      saveData: conn.saveData
    };
  }

  /**
   * Store metric locally
   */
  function storeMetric(metric) {
    try {
      let stored = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '[]');
      stored.push(metric);

      // Keep only recent metrics
      if (stored.length > CONFIG.maxStoredMetrics) {
        stored = stored.slice(-CONFIG.maxStoredMetrics);
      }

      localStorage.setItem(CONFIG.storageKey, JSON.stringify(stored));
    } catch (e) {
      // Storage full or unavailable
    }
  }

  /**
   * Flush report queue to endpoint
   */
  async function flushReports() {
    if (reportQueue.length === 0 || !CONFIG.reportEndpoint) return;

    const toSend = [...reportQueue];
    reportQueue = [];

    try {
      await fetch(CONFIG.reportEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSend),
        keepalive: true
      });
    } catch (e) {
      // Put back failed reports
      reportQueue.unshift(...toSend);
    }
  }

  // ==================== SUMMARY ====================

  /**
   * Get all metrics summary
   */
  function getSummary() {
    return {
      coreWebVitals: {
        LCP: metrics.LCP || null,
        FID: metrics.FID || null,
        CLS: metrics.CLS || null,
        FCP: metrics.FCP || null,
        TTFB: metrics.TTFB || null,
        INP: metrics.INP || null
      },
      navigation: getNavigationTiming(),
      resources: getResourceSummary(),
      memory: getMemoryUsage(),
      connection: getConnectionInfo(),
      score: calculateScore()
    };
  }

  /**
   * Calculate overall performance score (0-100)
   */
  function calculateScore() {
    const weights = {
      LCP: 25,
      FID: 25,
      CLS: 25,
      FCP: 15,
      TTFB: 10
    };

    let totalWeight = 0;
    let weightedScore = 0;

    for (const [metric, weight] of Object.entries(weights)) {
      if (metrics[metric]) {
        totalWeight += weight;
        const rating = metrics[metric].rating;
        const score = rating === 'good' ? 100 : rating === 'needs-improvement' ? 50 : 0;
        weightedScore += score * weight;
      }
    }

    return totalWeight > 0 ? Math.round(weightedScore / totalWeight) : null;
  }

  // ==================== INITIALIZATION ====================

  /**
   * Initialize performance monitoring
   */
  function init() {
    if (isInitialized || !CONFIG.enabled) return;

    // Wait for page load for accurate measurements
    if (document.readyState === 'complete') {
      startMeasurements();
    } else {
      window.addEventListener('load', startMeasurements);
    }

    // Flush reports before page unload
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushReports();
      }
    });

    isInitialized = true;
    console.log('[PerfMon] Performance monitoring initialized');
  }

  function startMeasurements() {
    measureLCP();
    measureFID();
    measureCLS();
    measureFCP();
    measureINP();

    // TTFB can be measured immediately
    setTimeout(measureTTFB, 0);
  }

  /**
   * Destroy and cleanup
   */
  function destroy() {
    observers.forEach(obs => obs.disconnect());
    observers.length = 0;
    isInitialized = false;
  }

  // Auto-init
  if (typeof window !== 'undefined') {
    init();
  }

  // ==================== PUBLIC API ====================
  return {
    // Core Web Vitals
    get LCP() { return metrics.LCP; },
    get FID() { return metrics.FID; },
    get CLS() { return metrics.CLS; },
    get FCP() { return metrics.FCP; },
    get TTFB() { return metrics.TTFB; },
    get INP() { return metrics.INP; },

    // Custom measurements
    mark,
    measure,
    measureTiming,
    measureAsync,

    // Resources
    getResourceTimings,
    getSlowResources,
    getResourceSummary,

    // System
    getMemoryUsage,
    getNavigationTiming,
    getConnectionInfo,

    // Summary
    getSummary,
    calculateScore,
    get metrics() { return { ...metrics }; },

    // Reporting
    flushReports,
    setReportEndpoint: (url) => { CONFIG.reportEndpoint = url; },

    // Control
    init,
    destroy,
    enable: () => { CONFIG.enabled = true; },
    disable: () => { CONFIG.enabled = false; },

    // Config
    CONFIG
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PerformanceMonitor;
}
