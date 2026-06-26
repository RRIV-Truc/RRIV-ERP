/**

 * Service Worker thống nhất RRIV ERP — cache shell hub + mini-app, không cache API.

 */

var SHELL_CACHE = 'rriv-erp-shell-v4';

var RUNTIME_CACHE = 'rriv-erp-runtime-v4';

var OFFLINE_URL = '/offline.html';



var PRECACHE = [

  '/',

  '/manifest.json',

  OFFLINE_URL,

  '/static/manifest.json',

  '/static/style.css',

  '/static/offline.html',

  '/static/logo.png',

  '/icon-192.png',

  '/icon-512.png',

  '/favicon-32.png',

  '/apple-touch-icon.png',

  '/static/icon-192.png',

  '/static/icon-512.png',

  '/static/favicon-32.png',

  '/static/apple-touch-icon.png',

  '/static/css/rriv-app-bar.css',

  '/static/css/app-layout.css',

  '/static/css/app-components.css',

  '/static/css/base.css',

  '/static/js/utils/config.js',

  '/static/js/utils/pwa.js',

  '/static/js/services/SupabaseService.js',

  '/static/js/services/FirestoreService.js',

  '/static/js/services/CRUDService.js',

  '/static/js/services/ErpDb.js',

  '/static/js/modules/auth.js',

  '/static/js/utils/permissions.js',

  '/static/js/utils/validation.js',

  '/static/js/utils/errorHandler.js',

  '/static/js/rriv-app-bar.js',

  '/static/css/app-sanxuat.css',

  '/static/js/sanxuat/services/TscDrcConverter.js',

  '/static/js/sanxuat/services/FieldHarvestOffline.js',

  '/static/js/sanxuat/tabs/field-harvest.js'

];



function isAppNavigation(pathname) {

  return pathname === '/' || pathname.indexOf('/app/') === 0;

}



self.addEventListener('install', function (event) {

  event.waitUntil(

    caches.open(SHELL_CACHE).then(function (cache) {

      return cache.addAll(PRECACHE).catch(function () { /* partial ok */ });

    }).then(function () { return self.skipWaiting(); })

  );

});



self.addEventListener('activate', function (event) {

  event.waitUntil(

    caches.keys().then(function (keys) {

      return Promise.all(keys.filter(function (k) {

        return (k.indexOf('rriv-erp-') === 0 || k.indexOf('rriv-sanxuat-') === 0) &&

          k !== SHELL_CACHE && k !== RUNTIME_CACHE;

      }).map(function (k) { return caches.delete(k); }));

    }).then(function () { return self.clients.claim(); })

  );

});



self.addEventListener('message', function (event) {

  var data = event.data || {};

  if (data.type === 'CHECK_CACHE_STATUS') {

    caches.open(SHELL_CACHE).then(function (cache) {

      return cache.keys();

    }).then(function (keys) {

      var payload = {

        type: 'CACHE_STATUS',

        appFilesCached: keys.length,

        modelFilesCached: 0,

        modelsReady: false,

        offlineReady: keys.length > 0

      };

      if (event.source) {

        event.source.postMessage(payload);

      }

    });

  }

  if (data.type === 'SKIP_WAITING') {

    self.skipWaiting();

  }

});



function offlineFallback() {

  return caches.match(OFFLINE_URL).then(function (page) {

    return page || caches.match('/static/offline.html').then(function (p) {

      return p || caches.match('/');

    });

  });

}



self.addEventListener('fetch', function (event) {

  var req = event.request;

  if (req.method !== 'GET') return;



  var url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  if (url.pathname.indexOf('/api/') === 0) return;



  var isStatic = url.pathname.indexOf('/static/') === 0;

  var isRootAsset = /^\/(icon-192|icon-512|favicon-32|apple-touch-icon|logo)\.png$/.test(url.pathname);

  var isNav = req.mode === 'navigate' && isAppNavigation(url.pathname);



  if (!isStatic && !isNav && !isRootAsset && url.pathname !== '/manifest.json') return;



  if (isStatic || isRootAsset || url.pathname === '/manifest.json') {

    event.respondWith(

      caches.match(req).then(function (cached) {

        var network = fetch(req).then(function (res) {

          if (res && res.status === 200) {

            var clone = res.clone();

            caches.open(RUNTIME_CACHE).then(function (c) { c.put(req, clone); });

          }

          return res;

        }).catch(function () { return cached; });

        return cached || network;

      })

    );

    return;

  }



  event.respondWith(

    fetch(req).then(function (res) {

      if (res && res.status === 200) {

        var clone = res.clone();

        caches.open(RUNTIME_CACHE).then(function (c) { c.put(req, clone); });

      }

      return res;

    }).catch(function () {

      return caches.match(req).then(function (cached) {

        return cached || offlineFallback();

      });

    })

  );

});

