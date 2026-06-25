/**
 * Lazy Loading Module
 * Quản lý lazy loading cho scripts, images, và components
 * @module lazyLoad
 */

const LazyLoad = (function() {
  'use strict';

  // ==================== STATE ====================
  const loadedScripts = new Set();
  const loadingPromises = new Map();
  const observers = new Map();

  // ==================== SCRIPT LOADING ====================

  /**
   * Load script dynamically
   * @param {string} src - Script URL
   * @param {Object} options - Options
   * @returns {Promise}
   */
  function loadScript(src, options = {}) {
    const {
      async = true,
      defer = false,
      id = null,
      onLoad = null,
      onError = null
    } = options;

    // Return if already loaded
    if (loadedScripts.has(src)) {
      return Promise.resolve();
    }

    // Return existing promise if currently loading
    if (loadingPromises.has(src)) {
      return loadingPromises.get(src);
    }

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = async;
      script.defer = defer;

      if (id) script.id = id;

      script.onload = () => {
        loadedScripts.add(src);
        loadingPromises.delete(src);
        if (onLoad) onLoad();
        resolve();
      };

      script.onerror = (error) => {
        loadingPromises.delete(src);
        if (onError) onError(error);
        reject(new Error(`Failed to load script: ${src}`));
      };

      document.head.appendChild(script);
    });

    loadingPromises.set(src, promise);
    return promise;
  }

  /**
   * Load multiple scripts in sequence
   * @param {string[]} urls - Array of script URLs
   * @returns {Promise}
   */
  async function loadScriptsSequence(urls) {
    for (const url of urls) {
      await loadScript(url);
    }
  }

  /**
   * Load multiple scripts in parallel
   * @param {string[]} urls - Array of script URLs
   * @returns {Promise}
   */
  function loadScriptsParallel(urls) {
    return Promise.all(urls.map(url => loadScript(url)));
  }

  // ==================== CSS LOADING ====================

  /**
   * Load CSS dynamically
   * @param {string} href - CSS URL
   * @param {Object} options - Options
   * @returns {Promise}
   */
  function loadCSS(href, options = {}) {
    const { id = null, media = 'all' } = options;

    // Check if already loaded
    if (document.querySelector(`link[href="${href}"]`)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.media = media;

      if (id) link.id = id;

      link.onload = resolve;
      link.onerror = () => reject(new Error(`Failed to load CSS: ${href}`));

      document.head.appendChild(link);
    });
  }

  // ==================== IMAGE LAZY LOADING ====================

  /**
   * Initialize lazy loading for images
   * @param {string} selector - CSS selector for lazy images
   * @param {Object} options - IntersectionObserver options
   */
  function initImageLazyLoad(selector = '[data-lazy-src]', options = {}) {
    const {
      root = null,
      rootMargin = '50px 0px',
      threshold = 0.01
    } = options;

    // Use native lazy loading if supported
    if ('loading' in HTMLImageElement.prototype) {
      document.querySelectorAll(selector).forEach(img => {
        if (img.dataset.lazySrc) {
          img.src = img.dataset.lazySrc;
          img.loading = 'lazy';
          delete img.dataset.lazySrc;
        }
      });
      return;
    }

    // Fallback to IntersectionObserver
    if (!('IntersectionObserver' in window)) {
      // Fallback: load all images immediately
      document.querySelectorAll(selector).forEach(img => {
        if (img.dataset.lazySrc) {
          img.src = img.dataset.lazySrc;
        }
      });
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          loadImage(img);
          observer.unobserve(img);
        }
      });
    }, { root, rootMargin, threshold });

    document.querySelectorAll(selector).forEach(img => {
      observer.observe(img);
    });

    observers.set('images', observer);
  }

  /**
   * Load single image
   * @param {HTMLImageElement} img
   */
  function loadImage(img) {
    const src = img.dataset.lazySrc || img.dataset.src;
    if (!src) return;

    // Add loading class
    img.classList.add('lazy-loading');

    // Create temp image to preload
    const tempImg = new Image();

    tempImg.onload = () => {
      img.src = src;
      img.classList.remove('lazy-loading');
      img.classList.add('lazy-loaded');
      delete img.dataset.lazySrc;
      delete img.dataset.src;
    };

    tempImg.onerror = () => {
      img.classList.remove('lazy-loading');
      img.classList.add('lazy-error');
      // Set fallback image
      img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23f3f4f6" width="100" height="100"/%3E%3Ctext fill="%239ca3af" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3E?%3C/text%3E%3C/svg%3E';
    };

    tempImg.src = src;
  }

  // ==================== COMPONENT LAZY LOADING ====================

  /**
   * Lazy load component when element is visible
   * @param {string} selector - CSS selector
   * @param {Function} loadFn - Function to load component
   * @param {Object} options - Options
   */
  function lazyLoadComponent(selector, loadFn, options = {}) {
    const {
      rootMargin = '100px 0px',
      threshold = 0,
      once = true
    } = options;

    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          loadFn(entry.target);
          if (once) {
            observer.unobserve(entry.target);
          }
        }
      });
    }, { rootMargin, threshold });

    elements.forEach(el => observer.observe(el));

    return observer;
  }

  // ==================== MODULE LAZY LOADING ====================

  /**
   * Define lazy module
   * @param {string} name - Module name
   * @param {string[]} dependencies - Script URLs
   * @param {Function} factory - Factory function
   */
  const modules = new Map();

  function defineModule(name, dependencies, factory) {
    modules.set(name, { dependencies, factory, loaded: false, instance: null });
  }

  /**
   * Load and get module
   * @param {string} name - Module name
   * @returns {Promise}
   */
  async function requireModule(name) {
    const module = modules.get(name);
    if (!module) {
      throw new Error(`Module not found: ${name}`);
    }

    if (module.loaded) {
      return module.instance;
    }

    // Load dependencies
    if (module.dependencies && module.dependencies.length > 0) {
      await loadScriptsSequence(module.dependencies);
    }

    // Execute factory
    module.instance = module.factory();
    module.loaded = true;

    return module.instance;
  }

  // ==================== PRELOADING ====================

  /**
   * Preload resources
   * @param {string[]} urls - URLs to preload
   * @param {string} as - Resource type (script, style, image, font)
   */
  function preload(urls, as = 'script') {
    urls.forEach(url => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.href = url;
      link.as = as;

      if (as === 'font') {
        link.crossOrigin = 'anonymous';
      }

      document.head.appendChild(link);
    });
  }

  /**
   * Prefetch resources for future navigation
   * @param {string[]} urls - URLs to prefetch
   */
  function prefetch(urls) {
    // Use requestIdleCallback if available
    const prefetchFn = () => {
      urls.forEach(url => {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = url;
        document.head.appendChild(link);
      });
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(prefetchFn, { timeout: 2000 });
    } else {
      setTimeout(prefetchFn, 100);
    }
  }

  // ==================== INFINITE SCROLL ====================

  /**
   * Setup infinite scroll loading
   * @param {Object} options
   * @returns {Object} Controller
   */
  function infiniteScroll(options = {}) {
    const {
      container = document.documentElement,
      sentinel = null,
      threshold = 200,
      onLoadMore = null
    } = options;

    let loading = false;
    let hasMore = true;

    const checkScroll = () => {
      if (loading || !hasMore) return;

      let shouldLoad = false;

      if (sentinel) {
        const rect = sentinel.getBoundingClientRect();
        shouldLoad = rect.top < window.innerHeight + threshold;
      } else {
        const scrollTop = container.scrollTop || window.pageYOffset;
        const scrollHeight = container.scrollHeight || document.documentElement.scrollHeight;
        const clientHeight = container.clientHeight || window.innerHeight;

        shouldLoad = scrollTop + clientHeight >= scrollHeight - threshold;
      }

      if (shouldLoad && onLoadMore) {
        loading = true;
        Promise.resolve(onLoadMore())
          .then((more) => {
            loading = false;
            if (more === false) hasMore = false;
          })
          .catch(() => {
            loading = false;
          });
      }
    };

    const scrollHandler = Helpers?.throttle ? Helpers.throttle(checkScroll, 100) : checkScroll;

    window.addEventListener('scroll', scrollHandler, { passive: true });

    return {
      check: checkScroll,
      setLoading: (val) => { loading = val; },
      setHasMore: (val) => { hasMore = val; },
      destroy: () => {
        window.removeEventListener('scroll', scrollHandler);
      }
    };
  }

  // ==================== CLEANUP ====================

  /**
   * Destroy all observers
   */
  function destroy() {
    observers.forEach(observer => observer.disconnect());
    observers.clear();
  }

  // ==================== PUBLIC API ====================
  return {
    // Scripts
    loadScript,
    loadScriptsSequence,
    loadScriptsParallel,

    // CSS
    loadCSS,

    // Images
    initImageLazyLoad,
    loadImage,

    // Components
    lazyLoadComponent,

    // Modules
    defineModule,
    requireModule,

    // Preloading
    preload,
    prefetch,

    // Infinite scroll
    infiniteScroll,

    // Cleanup
    destroy,

    // State
    get loadedScripts() { return [...loadedScripts]; }
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LazyLoad;
}
