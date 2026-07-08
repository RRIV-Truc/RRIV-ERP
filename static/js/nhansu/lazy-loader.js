/**
 * lazy-loader.js — modals / Excel chỉ tải khi cần; preload ngầm sau khi shell hiện.
 */
(function () {
  'use strict';

  var loaded = Object.create(null);
  var loading = Object.create(null);

  var BUNDLES = {
    modals: [
      '/static/js/nhansu/access-rights.js?v=2',
      '/static/js/nhansu/modals.js?v=37'
    ],
    export: [
      'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js'
    ]
  };

  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    if (loading[src]) return loading[src];

    loading[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () {
        loaded[src] = Promise.resolve();
        resolve();
      };
      s.onerror = function () {
        delete loading[src];
        reject(new Error('Không tải được: ' + src));
      };
      document.head.appendChild(s);
    });
    return loading[src];
  }

  function loadBundle(name) {
    var urls = BUNDLES[name];
    if (!urls) return Promise.reject(new Error('Bundle không tồn tại: ' + name));
    return urls.reduce(function (chain, url) {
      return chain.then(function () { return loadScript(url); });
    }, Promise.resolve());
  }

  function ensure(input) {
    var names = typeof input === 'string' ? [input] : (input || []).slice();
    return names.reduce(function (chain, name) {
      return chain.then(function () { return loadBundle(name); });
    }, Promise.resolve());
  }

  var preloadPromise = null;

  function preloadAll() {
    if (!preloadPromise) {
      preloadPromise = loadBundle('modals').catch(function (e) {
        console.warn('[NhansuLazy] preload', e);
        preloadPromise = null;
      });
    }
    return preloadPromise;
  }

  window.NhansuLazy = {
    ensure: ensure,
    preloadAll: preloadAll,
    loadBundle: loadBundle
  };
})();
