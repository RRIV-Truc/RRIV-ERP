/**
 * lazy-loader.js — tải module phòng họp nền sau khi shell hiển thị.
 * Gọi preloadAll() ngay khi mở app; ensure() khi user bấm tính năng (thường đã xong).
 */
(function () {
  'use strict';

  var loaded = Object.create(null);
  var loading = Object.create(null);

  var BUNDLES = {
    forms: [
      '/static/js/vendor/qrcode.min.js',
      'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
      '/static/js/components/ModalForm.js',
      '/static/js/meetings/components/ParticipantTreePicker.js?v=2',
      '/static/js/meetings/components/MeetingForm.js?v=55',
      '/static/js/meetings/components/MeetingDetail.js?v=50'
    ],
    docs: [
      '/static/js/meetings/components/MeetingDocs.js?v=56'
    ],
    session: [
      '/static/js/meetings/pptx-slides.js?v=1',
      '/static/js/meetings/components/MeetingPresenter.js?v=8',
      '/static/js/meetings/components/MeetingScreenShare.js?v=16',
      '/static/js/meetings/components/MeetingChat.js?v=1',
      '/static/js/meetings/components/MeetingRoom.js?v=75'
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

  function normalizeBundles(input) {
    if (!input) return [];
    if (typeof input === 'string') return [input];
    return input.slice();
  }

  function ensure(input) {
    var names = normalizeBundles(input);
    return names.reduce(function (chain, name) {
      return chain.then(function () { return loadBundle(name); });
    }, Promise.resolve());
  }

  function isReady(name) {
    var urls = BUNDLES[name];
    if (!urls) return false;
    return urls.every(function (url) { return !!loaded[url]; });
  }

  var preloadPromise = null;

  function preloadAll() {
    if (!preloadPromise) {
      preloadPromise = Promise.all([
        loadBundle('forms'),
        loadBundle('docs')
      ]).then(function () {
        return loadBundle('session');
      }).catch(function (e) {
        console.warn('[PhonghopLazy] preload', e);
        preloadPromise = null;
      });
    }
    return preloadPromise;
  }

  window.PhonghopLazy = {
    BUNDLES: BUNDLES,
    ensure: ensure,
    preloadAll: preloadAll,
    isReady: isReady,
    loadBundle: loadBundle
  };
})();
